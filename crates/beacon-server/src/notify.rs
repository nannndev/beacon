//! Discord/Slack run summaries (port of notify_discord.py / notify_slack.py).
//! Best-effort: delivery runs on a spawned task and errors are swallowed, so a bad
//! webhook can never affect the run or its history.
use serde_json::{json, Value};
use std::time::Duration;

pub fn is_discord(url: &str) -> bool {
    let u = url.trim();
    u.starts_with("https://") && ["discord.com/api/webhooks/", "discordapp.com/api/webhooks/"].iter().any(|h| u.contains(h))
}

pub fn is_slack(url: &str) -> bool {
    url.trim().starts_with("https://hooks.slack.com/services/")
}

fn n(stats: &Value, k: &str) -> u64 {
    stats[k].as_u64().unwrap_or(0)
}

fn did_fail(stats: &Value, outcome: &str) -> bool {
    outcome != "completed" || n(stats, "errors") > 0
}

fn headline(stats: &Value, outcome: &str) -> (&'static str, &'static str) {
    match outcome {
        "stopped" => ("⏹️", "stopped"),
        "failed" => ("❌", "failed"),
        _ if n(stats, "errors") > 0 => ("❌", "finished with errors"),
        _ if n(stats, "rate_limited") > 0 => ("⚠️", "finished (rate-limited)"),
        _ => ("✅", "finished"),
    }
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

/// Builds the webhook body for one run summary, or None for an unsupported URL.
pub fn summary_payload(webhook: &str, target: &str, mode: &str, stats: &Value, outcome: &str, project: &str) -> Option<Value> {
    let (attempts, success) = (n(stats, "attempts"), n(stats, "success"));
    let rate = if attempts > 0 { format!("{}%", (success as f64 / attempts as f64 * 100.0).round()) } else { "—".into() };
    let (emoji, status) = headline(stats, outcome);
    let fail = did_fail(stats, outcome);
    let amber = n(stats, "rate_limited") > 0;
    let footer = if project.is_empty() { "Beacon".to_string() } else { format!("Beacon · {project}") };
    let (rl, errs) = (n(stats, "rate_limited"), n(stats, "errors"));
    if is_discord(webhook) {
        let title: String = format!("{emoji} {target} — {} run {status}", capitalize(mode)).chars().take(256).collect();
        let color = if fail { 0xEF4444 } else if amber { 0xF59E0B } else { 0x22C55E };
        return Some(json!({ "embeds": [{ "title": title, "color": color, "footer": { "text": footer }, "fields": [
            { "name": "Attempts", "value": attempts.to_string(), "inline": true },
            { "name": "Success", "value": format!("{success} ({rate})"), "inline": true },
            { "name": "Rate-limited", "value": rl.to_string(), "inline": true },
            { "name": "Errors", "value": errs.to_string(), "inline": true },
        ] }] }));
    }
    if is_slack(webhook) {
        let color = if fail { "#EF4444" } else if amber { "#F59E0B" } else { "#22C55E" };
        return Some(json!({ "attachments": [{ "color": color, "blocks": [
            { "type": "section", "text": { "type": "mrkdwn", "text": format!("{emoji} *{target}* — {} run {status}", capitalize(mode)) } },
            { "type": "section", "fields": [
                { "type": "mrkdwn", "text": format!("*Attempts:*\n{attempts}") },
                { "type": "mrkdwn", "text": format!("*Success:*\n{success} ({rate})") },
                { "type": "mrkdwn", "text": format!("*Rate-limited:*\n{rl}") },
                { "type": "mrkdwn", "text": format!("*Errors:*\n{errs}") },
            ] },
            { "type": "context", "elements": [{ "type": "mrkdwn", "text": footer }] },
        ] }] }));
    }
    None
}

/// Fire-and-forget a run summary to every webhook the project's settings ask for.
pub fn maybe_notify(settings: Option<&Value>, target: &str, mode: &str, stats: &Value, outcome: &str, project: &str) {
    let Some(settings) = settings else { return };
    let mode_setting = settings["mode"].as_str().unwrap_or("off");
    if mode_setting == "off" || (mode_setting == "on_failure" && !did_fail(stats, outcome)) {
        return;
    }
    for key in ["discord_webhook", "slack_webhook"] {
        let url = settings[key].as_str().unwrap_or("").trim().to_string();
        if let Some(body) = summary_payload(&url, target, mode, stats, outcome, project) {
            tokio::spawn(async move {
                if let Ok(client) = reqwest::Client::builder().timeout(Duration::from_secs(10)).build() {
                    let _ = client.post(&url).json(&body).send().await;
                }
            });
        }
    }
}

/// Notify using the active project's settings (the project the run belongs to).
pub fn notify_active(state: &crate::state::AppState, target: &str, mode: &str, stats: &Value, outcome: &str) {
    let (settings, project) = {
        let store = state.store.read();
        match store.get_active_project() {
            Some(p) => (p.notifications.clone(), p.name.clone()),
            None => return,
        }
    };
    maybe_notify(settings.as_ref(), target, mode, stats, outcome, &project);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_discord_and_slack_summaries() {
        let stats = json!({ "attempts": 4, "success": 3, "rate_limited": 0, "errors": 1 });
        let d = summary_payload("https://discord.com/api/webhooks/1/abc", "Login", "load", &stats, "completed", "Shop").unwrap();
        assert_eq!(d["embeds"][0]["title"], "❌ Login — Load run finished with errors");
        assert_eq!(d["embeds"][0]["color"], 0xEF4444);
        assert_eq!(d["embeds"][0]["fields"][1]["value"], "3 (75%)");
        let s = summary_payload("https://hooks.slack.com/services/T/B/X", "Login", "load", &json!({ "attempts": 2, "success": 2 }), "completed", "").unwrap();
        assert_eq!(s["attachments"][0]["color"], "#22C55E");
        assert!(summary_payload("https://example.com/hook", "x", "load", &stats, "completed", "").is_none());
    }
}

"""Best-effort Slack webhook notifications for finished runs.

Fired from the run lifecycle (routers/runs.py) after a run finishes. Nothing in
here is allowed to raise into the caller: a bad webhook URL or a network hiccup
must never affect the run itself or its persisted history. Delivery happens on a
throwaway daemon thread so it can't delay the "run_finished" broadcast either.

Per-project settings live on the project dict as:
    "notifications": {"slack_webhook": "<url>", "mode": "off"|"on_failure"|"always"}
"""
import re
import threading

import requests

# Slack webhook URLs look like https://hooks.slack.com/services/T.../B.../X...
_WEBHOOK_RE = re.compile(
    r"^https://hooks\.slack\.com/services/[\w-]+/[\w-]+/[\w-]+/?$",
    re.IGNORECASE,
)

_GREEN = "#22C55E"
_AMBER = "#F59E0B"
_RED = "#EF4444"


def is_valid_webhook(url) -> bool:
    return isinstance(url, str) and bool(_WEBHOOK_RE.match(url.strip()))


def _did_fail(stats: dict, outcome: str) -> bool:
    return outcome != "completed" or (stats or {}).get("errors", 0) > 0


def _color(stats: dict, outcome: str) -> str:
    if _did_fail(stats, outcome):
        return _RED
    if (stats or {}).get("rate_limited", 0) > 0:
        return _AMBER
    return _GREEN


def _build_message(*, target_name, mode, stats, outcome, project_name):
    stats = stats or {}
    attempts = stats.get("attempts", 0)
    success = stats.get("success", 0)
    rate_limited = stats.get("rate_limited", 0)
    errors = stats.get("errors", 0)
    rate = f"{round(success / attempts * 100)}%" if attempts else "—"

    if outcome == "stopped":
        emoji, status = "⏹️", "stopped"
    elif outcome == "failed":
        emoji, status = "❌", "failed"
    elif errors:
        emoji, status = "❌", "finished with errors"
    elif rate_limited:
        emoji, status = "⚠️", "finished (rate-limited)"
    else:
        emoji, status = "✅", "finished"

    title = f"{emoji} *{target_name}* — {str(mode).capitalize()} run {status}"
    
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": title
            }
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Attempts:*\n{attempts}"},
                {"type": "mrkdwn", "text": f"*Success:*\n{success} ({rate})"},
                {"type": "mrkdwn", "text": f"*Rate-limited:*\n{rate_limited}"},
                {"type": "mrkdwn", "text": f"*Errors:*\n{errors}"}
            ]
        }
    ]
    
    footer_text = f"Beacon · {project_name}" if project_name else "Beacon"
    blocks.append({
        "type": "context",
        "elements": [
            {"type": "mrkdwn", "text": footer_text}
        ]
    })
    
    return {
        "attachments": [
            {
                "color": _color(stats, outcome),
                "blocks": blocks
            }
        ]
    }


def _post(webhook_url: str, payload: dict) -> None:
    try:
        requests.post(webhook_url.strip(), json=payload, timeout=10)
    except Exception:
        pass  # best-effort: a failed notification must not surface anywhere


def send_test_message(webhook_url: str):
    """Synchronous send used by the 'Send test message' button so the UI can
    report the result. Returns (ok: bool, error: str | None)."""
    if not is_valid_webhook(webhook_url):
        return False, "That doesn't look like a Slack webhook URL."
    try:
        res = requests.post(
            webhook_url.strip(),
            json={
                "attachments": [{
                    "color": _GREEN,
                    "blocks": [
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": "✅ *Beacon connected*\nRun notifications will be posted to this channel."
                            }
                        },
                        {
                            "type": "context",
                            "elements": [
                                {"type": "mrkdwn", "text": "Beacon"}
                            ]
                        }
                    ]
                }]
            },
            timeout=10,
        )
        if res.status_code >= 400:
            return False, f"Slack rejected the webhook (HTTP {res.status_code})."
        return True, None
    except Exception as e:
        return False, str(e)


def maybe_notify(settings, *, target_name, mode, stats, outcome, project_name=None) -> None:
    """Fire-and-forget a run summary to Slack if the project asks for it."""
    settings = settings or {}
    notify_mode = settings.get("mode", "off")
    webhook = settings.get("slack_webhook", "")
    if notify_mode == "off" or not is_valid_webhook(webhook):
        return
    if notify_mode == "on_failure" and not _did_fail(stats, outcome):
        return
    payload = _build_message(
        target_name=target_name, mode=mode, stats=stats,
        outcome=outcome, project_name=project_name,
    )
    threading.Thread(target=_post, args=(webhook, payload), daemon=True).start()

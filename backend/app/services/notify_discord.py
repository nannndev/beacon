"""Best-effort Discord webhook notifications for finished runs.

Fired from the run lifecycle (routers/runs.py) after a run finishes. Nothing in
here is allowed to raise into the caller: a bad webhook URL or a network hiccup
must never affect the run itself or its persisted history. Delivery happens on a
throwaway daemon thread so it can't delay the "run_finished" broadcast either.

Per-project settings live on the project dict as:
    "notifications": {"discord_webhook": "<url>", "mode": "off"|"on_failure"|"always"}
"""
import re
import threading

import requests

# Discord webhook URLs look like https://discord.com/api/webhooks/<id>/<token>
# (also discordapp.com and canary/ptb subdomains).
_WEBHOOK_RE = re.compile(
    r"^https://([\w-]+\.)?discord(app)?\.com/api/webhooks/\d+/[\w-]+/?$",
    re.IGNORECASE,
)

_GREEN = 0x22C55E
_AMBER = 0xF59E0B
_RED = 0xEF4444


def is_valid_webhook(url) -> bool:
    return isinstance(url, str) and bool(_WEBHOOK_RE.match(url.strip()))


def _did_fail(stats: dict, outcome: str) -> bool:
    return outcome != "completed" or (stats or {}).get("errors", 0) > 0


def _color(stats: dict, outcome: str) -> int:
    if _did_fail(stats, outcome):
        return _RED
    if (stats or {}).get("rate_limited", 0) > 0:
        return _AMBER
    return _GREEN


def _build_embed(*, target_name, mode, stats, outcome, project_name):
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

    fields = [
        {"name": "Attempts", "value": str(attempts), "inline": True},
        {"name": "Success", "value": f"{success} ({rate})", "inline": True},
        {"name": "Rate-limited", "value": str(rate_limited), "inline": True},
        {"name": "Errors", "value": str(errors), "inline": True},
    ]
    title = f"{emoji} {target_name} — {str(mode).capitalize()} run {status}"
    return {
        "title": title[:256],
        "color": _color(stats, outcome),
        "fields": fields,
        "footer": {"text": f"Beacon · {project_name}" if project_name else "Beacon"},
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
        return False, "That doesn't look like a Discord webhook URL."
    try:
        res = requests.post(
            webhook_url.strip(),
            json={
                "embeds": [{
                    "title": "✅ Beacon connected",
                    "description": "Run notifications will be posted to this channel.",
                    "color": _GREEN,
                    "footer": {"text": "Beacon"},
                }]
            },
            timeout=10,
        )
        if res.status_code >= 400:
            return False, f"Discord rejected the webhook (HTTP {res.status_code})."
        return True, None
    except Exception as e:
        return False, str(e)


def maybe_notify(settings, *, target_name, mode, stats, outcome, project_name=None) -> None:
    """Fire-and-forget a run summary to Discord if the project asks for it."""
    settings = settings or {}
    notify_mode = settings.get("mode", "off")
    webhook = settings.get("discord_webhook", "")
    if notify_mode == "off" or not is_valid_webhook(webhook):
        return
    if notify_mode == "on_failure" and not _did_fail(stats, outcome):
        return
    payload = {"embeds": [_build_embed(
        target_name=target_name, mode=mode, stats=stats,
        outcome=outcome, project_name=project_name,
    )]}
    threading.Thread(target=_post, args=(webhook, payload), daemon=True).start()

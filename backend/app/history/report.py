"""Render a run-history detail into a shareable, publication-quality report (HTML or Markdown).

Pure functions over the dict returned by ``HistoryService.get_run`` — no I/O,
no DB access — so they are trivially testable and safe to call from the router.
The HTML is fully self-contained (inline CSS and embedded SVG charts, no external assets)
so a saved file opens correctly offline and produces a publication-ready PDF when printed.
"""
from __future__ import annotations

import html
import math
from datetime import datetime
from typing import Any, List, Optional, Tuple

BEACON_URL = "https://beacon-tester.vercel.app"


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _fmt_ms(value: Optional[float]) -> str:
    if value is None:
        return "—"
    try:
        return f"{round(float(value))} ms"
    except (TypeError, ValueError):
        return "—"


def _fmt_rps(value: Optional[float]) -> str:
    try:
        return f"{float(value):.1f}" if value is not None else "—"
    except (TypeError, ValueError):
        return "—"


def _fmt_duration(ms: Optional[float]) -> str:
    if not ms:
        return "—"
    seconds = float(ms) / 1000.0
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes, secs = divmod(int(seconds), 60)
    return f"{minutes}m {secs}s"


def _fmt_dt(value: Optional[str]) -> str:
    if not value:
        return "—"
    try:
        return datetime.fromisoformat(value).strftime("%Y-%m-%d %H:%M:%S UTC")
    except (TypeError, ValueError):
        return str(value)


def _success_rate(m: dict) -> str:
    attempts = m.get("attempts") or 0
    if not attempts:
        return "—"
    return f"{(m.get('success', 0) / attempts) * 100:.1f}%"


def _summary_rows(detail: dict) -> list[tuple[str, str]]:
    m = detail.get("metrics") or {}
    return [
        ("Attempts", str(m.get("attempts", 0))),
        ("Success", f"{m.get('success', 0)} ({_success_rate(m)})"),
        ("Rate-limited", str(m.get("rate_limited", 0))),
        ("Errors", str(m.get("errors", 0))),
        ("Avg RPS", _fmt_rps(m.get("average_rps"))),
        ("Peak RPS", _fmt_rps(m.get("peak_rps"))),
        ("Latency p50", _fmt_ms(m.get("p50_ms"))),
        ("Latency p75", _fmt_ms(m.get("p75_ms"))),
        ("Latency p90", _fmt_ms(m.get("p90_ms"))),
        ("Latency p95", _fmt_ms(m.get("p95_ms"))),
        ("Latency p99", _fmt_ms(m.get("p99_ms"))),
        ("Latency max", _fmt_ms(m.get("max_latency_ms"))),
        ("Latency min", _fmt_ms(m.get("min_latency_ms"))),
    ]


def _meta_rows(detail: dict) -> list[tuple[str, str]]:
    return [
        ("Project", str(detail.get("project_name") or "—")),
        ("Target Endpoint", str(detail.get("target_name") or "—")),
        ("Execution Mode", str(detail.get("mode") or "—").capitalize()),
        ("Run Status", str(detail.get("status") or "—").capitalize()),
        ("Started At", _fmt_dt(detail.get("started_at"))),
        ("Completed At", _fmt_dt(detail.get("completed_at"))),
        ("Total Duration", _fmt_duration(detail.get("duration_ms"))),
    ]


# --------------------------------------------------------------------------- #
# SVG Trend Chart Generator (Offline, zero-dependency)
# --------------------------------------------------------------------------- #
def _render_svg_chart(points: List[Tuple[float, float]], title: str, stroke_color: str, fill_gradient_id: str, unit: str = "ms") -> str:
    valid_points = [(p[0], p[1]) for p in points if p[0] is not None and p[1] is not None and math.isfinite(p[0]) and math.isfinite(p[1])]
    if len(valid_points) < 2:
        return f'<div class="chart-box"><div class="chart-title">{html.escape(title)}</div><div class="chart-empty">Insufficient telemetry samples for chart rendering</div></div>'

    width, height = 740, 160
    pad_left, pad_right, pad_top, pad_bottom = 45, 15, 15, 25

    min_x = min(p[0] for p in valid_points)
    max_x = max(p[0] for p in valid_points) or 1.0
    if max_x == min_x:
        max_x = min_x + 1.0

    min_y = 0.0
    max_y = max(p[1] for p in valid_points) or 1.0
    max_y_padded = max_y * 1.15

    plot_w = width - pad_left - pad_right
    plot_h = height - pad_top - pad_bottom

    def map_x(val: float) -> float:
        return pad_left + ((val - min_x) / (max_x - min_x)) * plot_w

    def map_y(val: float) -> float:
        return height - pad_bottom - ((val - min_y) / (max_y_padded - min_y)) * plot_h

    coords = [(map_x(x), map_y(y)) for x, y in valid_points]
    poly_str = " ".join(f"{cx:.1f},{cy:.1f}" for cx, cy in coords)
    
    first_cx, last_cx = coords[0][0], coords[-1][0]
    base_cy = height - pad_bottom
    area_str = f"{first_cx:.1f},{base_cy:.1f} {poly_str} {last_cx:.1f},{base_cy:.1f}"

    # Gridlines (3 levels)
    grid_lines = []
    for ratio in [0.0, 0.5, 1.0]:
        y_val = min_y + ratio * (max_y_padded - min_y)
        cy = map_y(y_val)
        lbl = f"{round(y_val)}{unit}" if unit == "ms" else f"{y_val:.1f}{unit}"
        grid_lines.append(
            f'<line x1="{pad_left}" y1="{cy:.1f}" x2="{width - pad_right}" y2="{cy:.1f}" stroke="#e5e7eb" stroke-dasharray="3,3" />'
            f'<text x="{pad_left - 6}" y="{cy + 4:.1f}" fill="#9ca3af" font-size="9" text-anchor="end">{html.escape(lbl)}</text>'
        )

    return f"""
    <div class="chart-box">
      <div class="chart-title">{html.escape(title)}</div>
      <svg viewBox="0 0 {width} {height}" class="svg-chart">
        <defs>
          <linearGradient id="{fill_gradient_id}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="{stroke_color}" stop-opacity="0.3"/>
            <stop offset="100%" stop-color="{stroke_color}" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
        {"".join(grid_lines)}
        <polygon points="{area_str}" fill="url(#{fill_gradient_id})" />
        <polyline points="{poly_str}" fill="none" stroke="{stroke_color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>
    """


# --------------------------------------------------------------------------- #
# Markdown
# --------------------------------------------------------------------------- #
def render_markdown(detail: dict) -> str:
    lines: list[str] = []
    title = detail.get("target_name") or "Run"
    lines.append(f"# Beacon Run Report — {title}")
    lines.append("")
    for k, v in _meta_rows(detail):
        lines.append(f"- **{k}:** {v}")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append("| Metric | Value |")
    lines.append("| --- | --- |")
    for k, v in _summary_rows(detail):
        lines.append(f"| {k} | {v} |")
    lines.append("")

    steps = detail.get("steps") or []
    if len(steps) > 1:
        lines.append("## Steps")
        lines.append("")
        lines.append("| # | Endpoint | Method | Status |")
        lines.append("| --- | --- | --- | --- |")
        for s in steps:
            lines.append(
                f"| {s.get('sequence', '')} | {s.get('endpoint_name') or '—'} "
                f"| {s.get('method') or '—'} | {s.get('status') or '—'} |"
            )
        lines.append("")

    lines.append("---")
    lines.append(f"Generated by [Beacon]({BEACON_URL}) · {_fmt_dt(detail.get('completed_at') or detail.get('started_at'))}")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# HTML
# --------------------------------------------------------------------------- #
def _rows_html(rows: list[tuple[str, str]]) -> str:
    return "".join(
        f"<tr><th>{html.escape(k)}</th><td>{html.escape(v)}</td></tr>" for k, v in rows
    )


def _stat_cards(detail: dict) -> str:
    m = detail.get("metrics") or {}
    cards = [
        ("Attempts", str(m.get("attempts", 0)), "#0ea5e9"),
        ("Success Rate", _success_rate(m), "#10b981"),
        ("Rate-limited", str(m.get("rate_limited", 0)), "#f59e0b"),
        ("Errors", str(m.get("errors", 0)), "#ef4444"),
        ("p95 Latency", _fmt_ms(m.get("p95_ms")), "#8b5cf6"),
        ("Peak RPS", _fmt_rps(m.get("peak_rps")), "#0284c7"),
    ]
    return "".join(
        f'<div class="card"><div class="v" style="color:{c}">{html.escape(v)}</div>'
        f'<div class="l">{html.escape(l)}</div></div>'
        for l, v, c in cards
    )


def _percentile_cards(detail: dict) -> str:
    m = detail.get("metrics") or {}
    pcts = [
        ("p50", _fmt_ms(m.get("p50_ms")), "#0ea5e9"),
        ("p75", _fmt_ms(m.get("p75_ms")), "#3b82f6"),
        ("p90", _fmt_ms(m.get("p90_ms")), "#6366f1"),
        ("p95", _fmt_ms(m.get("p95_ms")), "#8b5cf6"),
        ("p99", _fmt_ms(m.get("p99_ms")), "#a855f7"),
        ("Max", _fmt_ms(m.get("max_latency_ms")), "#ef4444"),
    ]
    return "".join(
        f'<div class="card pct-card"><div class="l" style="color:{c}">{html.escape(l)}</div>'
        f'<div class="v-sm">{html.escape(v)}</div></div>'
        for l, v, c in pcts
    )


def _outcome_bar_html(detail: dict) -> str:
    m = detail.get("metrics") or {}
    attempts = m.get("attempts") or 0
    if not attempts:
        return ""

    success = m.get("success", 0)
    rate_limited = m.get("rate_limited", 0)
    errors = m.get("errors", 0)

    s_pct = (success / attempts) * 100
    r_pct = (rate_limited / attempts) * 100
    e_pct = (errors / attempts) * 100

    return f"""
    <h2>Outcome Breakdown</h2>
    <div class="dist-container">
      <div class="dist-bar">
        <div class="dist-seg seg-success" style="width: {s_pct:.1f}%"></div>
        <div class="dist-seg seg-rl" style="width: {r_pct:.1f}%"></div>
        <div class="dist-seg seg-error" style="width: {e_pct:.1f}%"></div>
      </div>
      <div class="dist-legend">
        <span class="leg-item"><span class="dot bg-success"></span> Success: <strong>{success}</strong> ({s_pct:.1f}%)</span>
        <span class="leg-item"><span class="dot bg-rl"></span> Rate-limited: <strong>{rate_limited}</strong> ({r_pct:.1f}%)</span>
        <span class="leg-item"><span class="dot bg-error"></span> Errors: <strong>{errors}</strong> ({e_pct:.1f}%)</span>
      </div>
    </div>
    """


def _steps_html(detail: dict) -> str:
    steps = detail.get("steps") or []
    if len(steps) <= 1:
        return ""
    rows = "".join(
        f"<tr><td>{html.escape(str(s.get('sequence', 0) + 1))}</td>"
        f"<td>{html.escape(str(s.get('endpoint_name') or '—'))}</td>"
        f"<td><span class=\"badge method\">{html.escape(str(s.get('method') or '—'))}</span></td>"
        f"<td>{html.escape(str(s.get('status') or '—'))}</td></tr>"
        for s in steps
    )
    return (
        '<h2>Scenario Executed Steps</h2><table class="grid">'
        "<thead><tr><th>#</th><th>Endpoint</th><th>Method</th><th>Status</th></tr></thead>"
        f"<tbody>{rows}</tbody></table>"
    )


def render_html(detail: dict) -> str:
    title = html.escape(str(detail.get("target_name") or "Run"))
    project_name = html.escape(str(detail.get("project_name") or "Beacon Project"))
    mode = html.escape(str(detail.get("mode") or "load").capitalize())
    status = html.escape(str(detail.get("status") or "completed"))
    generated = _fmt_dt(detail.get("completed_at") or detail.get("started_at"))

    samples = detail.get("samples") or []
    latency_pts = [(s.get("elapsed_ms", 0), s.get("latency_ms")) for s in samples if s.get("latency_ms") is not None]
    rps_pts = [(s.get("elapsed_ms", 0), s.get("instantaneous_rps")) for s in samples if s.get("instantaneous_rps") is not None]

    latency_chart_html = _render_svg_chart(latency_pts, "Latency Over Time (ms)", "#0ea5e9", "grad_latency", "ms")
    throughput_chart_html = _render_svg_chart(rps_pts, "Throughput Over Time (RPS)", "#10b981", "grad_rps", " rps")

    status_badge_color = "#10b981" if status.lower() == "completed" and (detail.get("metrics") or {}).get("errors", 0) == 0 else "#ef4444"

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Beacon Executive Report — {title}</title>
  <style>
    :root {{ color-scheme: light; }}
    * {{ box-sizing: border-box; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0; background: #f8fafc; color: #0f172a; line-height: 1.5;
    }}
    .wrap {{ max-width: 860px; margin: 0 auto; padding: 32px 24px 64px; }}
    
    /* Top Banner */
    .banner {{
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #fff; border-radius: 16px; padding: 24px 28px; margin-bottom: 24px;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.25);
    }}
    .banner-top {{ display: flex; align-items: center; justify-content: space-between; gap: 12px; }}
    .brand {{ display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 14px; letter-spacing: 0.05em; color: #38bdf8; }}
    .brand-dot {{ width: 10px; height: 10px; border-radius: 50%; background: #38bdf8; box-shadow: 0 0 10px #38bdf8; }}
    .print-btn {{
      background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
      color: #fff; border-radius: 8px; padding: 6px 14px; font-size: 12px; font-weight: 600;
      cursor: pointer; transition: all 0.2s;
    }}
    .print-btn:hover {{ background: rgba(255,255,255,0.2); }}
    .banner h1 {{ font-size: 24px; font-weight: 800; margin: 12px 0 4px; color: #f8fafc; }}
    .banner .meta-subtitle {{ font-size: 13px; color: #94a3b8; }}
    .status-tag {{
      display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase;
      padding: 3px 10px; border-radius: 9999px; color: #fff; margin-left: 8px;
    }}

    /* Stat Cards */
    .cards {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(125px, 1fr)); gap: 12px; margin: 24px 0; }}
    .card {{ background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }}
    .card .v {{ font-size: 22px; font-weight: 800; tracking: -0.02em; }}
    .card .v-sm {{ font-size: 16px; font-weight: 700; font-family: monospace; margin-top: 4px; }}
    .card .l {{ font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; margin-top: 4px; }}
    .pct-card {{ background: #f8fafc; border-color: #cbd5e1; }}

    /* Outcome Bar */
    .dist-container {{ background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px; margin: 16px 0 24px; }}
    .dist-bar {{ display: flex; height: 12px; border-radius: 6px; overflow: hidden; background: #e2e8f0; }}
    .dist-seg {{ height: 100%; transition: width 0.3s; }}
    .seg-success {{ background: #10b981; }}
    .seg-rl {{ background: #f59e0b; }}
    .seg-error {{ background: #ef4444; }}
    .dist-legend {{ display: flex; gap: 20px; font-size: 12px; margin-top: 12px; color: #475569; }}
    .leg-item {{ display: flex; align-items: center; gap: 6px; }}
    .dot {{ width: 8px; height: 8px; border-radius: 50%; }}
    .bg-success {{ background: #10b981; }}
    .bg-rl {{ background: #f59e0b; }}
    .bg-error {{ background: #ef4444; }}

    /* Chart SVG */
    .charts-grid {{ display: grid; gap: 16px; margin: 24px 0; }}
    .chart-box {{ background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px; }}
    .chart-title {{ font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 12px; }}
    .chart-empty {{ font-size: 12px; color: #94a3b8; padding: 40px; text-align: center; font-style: italic; }}
    .svg-chart {{ width: 100%; height: auto; display: block; }}

    /* Section Headings */
    h2 {{ font-size: 16px; font-weight: 700; color: #1e293b; margin: 28px 0 12px; }}

    /* Tables */
    table {{ width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03); }}
    th, td {{ text-align: left; padding: 12px 16px; font-size: 13px; border-bottom: 1px solid #f1f5f9; }}
    table.meta th {{ width: 180px; color: #64748b; font-weight: 600; background: #f8fafc; }}
    table.grid thead th {{ background: #f8fafc; color: #475569; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }}
    tr:last-child td, tr:last-child th {{ border-bottom: none; }}
    .badge.method {{ background: #e0f2fe; color: #0369a1; font-weight: 700; font-size: 11px; padding: 2px 6px; border-radius: 4px; font-mono; }}

    footer {{ margin-top: 40px; font-size: 12px; color: #94a3b8; text-align: center; border-t: 1px solid #e2e8f0; padding-top: 20px; }}
    footer a {{ color: #0284c7; text-decoration: none; font-weight: 600; }}

    /* Print / PDF Export Optimization */
    @media print {{
      body {{ background: #fff !important; color: #000 !important; }}
      .wrap {{ max-width: 100% !important; padding: 0 !important; }}
      .banner {{ background: #1e293b !important; color: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
      .print-btn {{ display: none !important; }}
      .card, .chart-box, table, .dist-container {{ break-inside: avoid; border-color: #cbd5e1 !important; }}
      @page {{ size: A4; margin: 12mm; }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="banner">
      <div class="banner-top">
        <div class="brand"><span class="brand-dot"></span> BEACON EXECUTIVE REPORT</div>
        <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
      </div>
      <h1>{title} <span class="status-tag" style="background:{status_badge_color}">{status}</span></h1>
      <div class="meta-subtitle">{project_name} · {mode} mode run</div>
    </div>

    <div class="cards">{_stat_cards(detail)}</div>

    <h2>Latency Percentiles</h2>
    <div class="cards">{_percentile_cards(detail)}</div>

    {_outcome_bar_html(detail)}

    <h2>Performance Telemetry Trends</h2>
    <div class="charts-grid">
      {latency_chart_html}
      {throughput_chart_html}
    </div>

    <h2>Run Overview</h2>
    <table class="meta"><tbody>{_rows_html(_meta_rows(detail))}</tbody></table>

    <h2>Metrics Summary</h2>
    <table class="meta"><tbody>{_rows_html(_summary_rows(detail))}</tbody></table>

    {_steps_html(detail)}

    <footer>Generated by <a href="{BEACON_URL}">Beacon Performance Workspace</a> · {html.escape(generated)}</footer>
  </div>
</body>
</html>
"""

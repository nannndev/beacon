"""Run orchestration helpers: thread-safe dispatch + WebSocket broadcasts."""
import asyncio
from datetime import datetime

from ..state import store


def dispatch(coro):
    """Run a coroutine on the main loop from any thread, safely."""
    loop = store.main_loop
    if loop and loop.is_running():
        asyncio.run_coroutine_threadsafe(coro, loop)
    else:
        asyncio.run(coro)


async def broadcast_log(run_id: str, message: str):
    ts = datetime.now().strftime("%H:%M:%S")
    entry = f"[{ts}] {message}"
    if run_id in store.current_runs:
        store.current_runs[run_id]["logs"].append(entry)
    for ws in store.active_websockets[:]:
        try:
            await ws.send_json({"type": "log", "run_id": run_id, "message": entry})
        except Exception:
            if ws in store.active_websockets:
                store.active_websockets.remove(ws)


async def broadcast_stats(run_id: str, stats: dict):
    if run_id in store.current_runs:
        store.current_runs[run_id]["stats"] = stats
    for ws in store.active_websockets[:]:
        try:
            await ws.send_json({"type": "stats", "run_id": run_id, "stats": stats})
        except Exception:
            if ws in store.active_websockets:
                store.active_websockets.remove(ws)


async def broadcast_response(run_id: str, response: dict):
    if run_id in store.current_runs:
        responses = store.current_runs[run_id].setdefault("responses", [])
        responses.append(response)
        if len(responses) > 100:
            del responses[:-100]
    for ws in store.active_websockets[:]:
        try:
            await ws.send_json({"type": "response", "run_id": run_id, "response": response})
        except Exception:
            if ws in store.active_websockets:
                store.active_websockets.remove(ws)

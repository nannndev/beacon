import os
import threading

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException

from ..core.tester import APITester
from ..state import store
from ..services import runner

router = APIRouter(tags=["runs"])


@router.post("/run")
async def start_run(data: dict):
    test_id = data["test_id"]
    test = next((t for t in store.current_config.tests if t.id == test_id), None)
    if not test:
        raise HTTPException(status_code=404, detail="Endpoint not found")

    concurrency = int(data.get("concurrency", 1))
    delay = float(data.get("delay", 0.1))
    max_requests = int(data.get("max_requests", 100))
    use_min_delay = data.get("use_min_delay", False)

    run_id = str(os.urandom(8).hex())
    store.current_runs[run_id] = {
        "status": "running",
        "logs": [],
        "responses": [],
        "stats": {"attempts": 0, "success": 0, "rate_limited": 0, "errors": 0},
        "stop_flag": {"stop": False},
    }

    def run_in_thread():
        try:
            tester = APITester(
                test, store.current_config,
                concurrency=concurrency,
                delay=delay if not use_min_delay else 0.001,
                max_requests=max_requests,
                log_callback=lambda m: runner.dispatch(runner.broadcast_log(run_id, m)),
                stats_callback=lambda s: runner.dispatch(runner.broadcast_stats(run_id, s)),
                response_callback=lambda r: runner.dispatch(runner.broadcast_response(run_id, r)),
                stop_flag=store.current_runs[run_id]["stop_flag"],
            )
            results = tester.run()
            # NOTE: extractor-refreshed variables live in current_config in
            # memory (used by chained runs this session). We deliberately do
            # NOT store.save() here — a background thread writing the whole
            # config races with concurrent request handlers and can clobber
            # edits made during a run.
            runner.dispatch(runner.broadcast_log(run_id, f"Finished: {results}"))
        except Exception as e:
            runner.dispatch(runner.broadcast_log(run_id, f"Error: {e}"))
        finally:
            if store.current_runs[run_id]["status"] == "running":
                store.current_runs[run_id]["status"] = "finished"
            runner.dispatch(runner.broadcast_log(run_id, "run_finished"))
            runner.dispatch(runner.broadcast_stats(run_id, store.current_runs[run_id]["stats"]))

    threading.Thread(target=run_in_thread, daemon=True).start()
    return {"run_id": run_id}


@router.post("/stop/{run_id}")
def stop_run(run_id: str):
    if run_id in store.current_runs:
        store.current_runs[run_id]["stop_flag"]["stop"] = True
        store.current_runs[run_id]["status"] = "stopped"
    return {"status": "stopping"}


@router.get("/status/{run_id}")
def get_status(run_id: str):
    if run_id not in store.current_runs:
        raise HTTPException(status_code=404, detail="Run not found")
    run = store.current_runs[run_id]
    return {
        "status": run["status"],
        "stats": run["stats"],
        "logs": run["logs"][-100:],
        "responses": run.get("responses", [])[-100:],
    }


@router.websocket("/ws")
async def websocket_logs(websocket: WebSocket):
    await websocket.accept()
    store.active_websockets.append(websocket)
    try:
        while True:
            await websocket.receive_text()  # keep alive
    except WebSocketDisconnect:
        if websocket in store.active_websockets:
            store.active_websockets.remove(websocket)

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import uvicorn
import json
import os
from typing import Dict, List
from datetime import datetime
import asyncio
from concurrent.futures import ThreadPoolExecutor

from .core.tester import TestConfig, EndpointTest, APITester

app = FastAPI(title="Security Tools API")

# CORS for React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CONFIG_FILE = "config/tests.json"
current_config = TestConfig()
current_runs: Dict[str, dict] = {}
active_websockets: List[WebSocket] = []

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_config()
    yield

app.router.lifespan_context = lifespan

def load_config():
    global current_config
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'r') as f:
            data = json.load(f)
            current_config = TestConfig.from_dict(data)
    else:
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        current_config = TestConfig(
            base_url="https://api.retailku.com",
            variables={"access_token": "", "refresh_token": ""},
            tests=[]
        )
        save_config()

def save_config():
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, 'w') as f:
        json.dump(current_config.to_dict(), f, indent=2)

async def broadcast_log(run_id: str, message: str):
    ts = datetime.now().strftime("%H:%M:%S")
    entry = f"[{ts}] {message}"
    if run_id in current_runs:
        current_runs[run_id]['logs'].append(entry)
    for ws in active_websockets[:]:
        try:
            await ws.send_json({"type": "log", "run_id": run_id, "message": entry})
        except:
            active_websockets.remove(ws)

async def broadcast_stats(run_id: str, stats: dict):
    if run_id in current_runs:
        current_runs[run_id]['stats'] = stats
    for ws in active_websockets[:]:
        try:
            await ws.send_json({"type": "stats", "run_id": run_id, "stats": stats})
        except:
            active_websockets.remove(ws)

@app.get("/config")
def get_config():
    return current_config.to_dict()

@app.post("/config")
def save_config_route(data: dict):
    global current_config
    current_config = TestConfig.from_dict(data)
    save_config()
    return {"status": "saved"}

@app.get("/tests")
def get_tests():
    return current_config.tests

@app.post("/tests")
def add_test(test_data: dict):
    test = EndpointTest.from_dict(test_data)
    current_config.tests.append(test)
    save_config()
    return test.to_dict()

@app.put("/tests/{test_id}")
def update_test(test_id: str, test_data: dict):
    for i, t in enumerate(current_config.tests):
        if t.id == test_id:
            current_config.tests[i] = EndpointTest.from_dict(test_data)
            save_config()
            return current_config.tests[i].to_dict()
    return {"error": "not found"}, 404

@app.delete("/tests/{test_id}")
def delete_test(test_id: str):
    current_config.tests = [t for t in current_config.tests if t.id != test_id]
    save_config()
    return {"status": "deleted"}

@app.post("/tests/{test_id}/duplicate")
def duplicate_test(test_id: str):
    orig = next((t for t in current_config.tests if t.id == test_id), None)
    if not orig:
        return {"error": "not found"}, 404
    new_test = EndpointTest(
        None,
        f"{orig.name} (copy)",
        orig.url,
        orig.method,
        dict(orig.headers),
        dict(orig.payload),
        orig.payload_type,
        dict(orig.extractors)
    )
    current_config.tests.append(new_test)
    save_config()
    return new_test.to_dict()

@app.post("/run")
async def start_run(data: dict):
    test_id = data['test_id']
    test = next((t for t in current_config.tests if t.id == test_id), None)
    if not test:
        return {"error": "Test not found"}, 404

    concurrency = int(data.get('concurrency', 1))
    delay = float(data.get('delay', 0.1))
    max_requests = int(data.get('max_requests', 100))
    use_min_delay = data.get('use_min_delay', False)

    run_id = str(os.urandom(8).hex())

    current_runs[run_id] = {
        'status': 'running',
        'logs': [],
        'stats': {'attempts': 0, 'success': 0, 'rate_limited': 0, 'errors': 0},
        'stop_flag': {'stop': False}
    }

    def run_in_thread():
        try:
            tester = APITester(
                test, current_config,
                concurrency=concurrency,
                delay=delay if not use_min_delay else 0.001,
                max_requests=max_requests,
                log_callback=lambda m: asyncio.run(broadcast_log(run_id, m)),
                stats_callback=lambda s: asyncio.run(broadcast_stats(run_id, s)),
                stop_flag=current_runs[run_id]['stop_flag']
            )
            results = tester.run()
            asyncio.run(broadcast_log(run_id, f"Finished: {results}"))
        except Exception as e:
            asyncio.run(broadcast_log(run_id, f"Error: {e}"))
        finally:
            current_runs[run_id]['status'] = 'finished'
            asyncio.run(broadcast_log(run_id, "run_finished"))

    import threading
    thread = threading.Thread(target=run_in_thread, daemon=True)
    thread.start()

    return {"run_id": run_id}

@app.post("/stop/{run_id}")
def stop_run(run_id: str):
    if run_id in current_runs:
        current_runs[run_id]['stop_flag']['stop'] = True
        current_runs[run_id]['status'] = 'stopped'
    return {"status": "stopping"}

@app.get("/status/{run_id}")
def get_status(run_id: str):
    if run_id not in current_runs:
        return {"error": "not found"}, 404
    run = current_runs[run_id]
    return {
        "status": run['status'],
        "stats": run['stats'],
        "logs": run['logs'][-100:]
    }

@app.websocket("/ws")
async def websocket_logs(websocket: WebSocket):
    await websocket.accept()
    active_websockets.append(websocket)
    try:
        while True:
            await websocket.receive_text()  # keep alive
    except WebSocketDisconnect:
        active_websockets.remove(websocket)

if __name__ == "__main__":
    print("\033[94m[BACKEND]\033[0m \033[1mStarting FastAPI + Uvicorn...\033[0m")
    print("\033[94m[BACKEND]\033[0m → http://localhost:8000")
    print("\033[94m[BACKEND]\033[0m Docs → http://localhost:8000/docs")
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
        use_colors=True,
    )
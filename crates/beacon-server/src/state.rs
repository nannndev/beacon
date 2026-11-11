use crate::store::Store;
use beacon_core::EndpointTest;
use beacon_gateway::{GatewayEngine, GatewayStore};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunStatusResponse {
    pub status: String,
    pub stats: Value,
    pub logs: Vec<String>,
    pub responses: Vec<Value>,
    pub progress: Value,
    pub scenario_steps: Vec<Value>,
    pub recent_events: Vec<Value>,
    pub failure: Option<Value>,
}

pub struct ActiveRun {
    pub id: String,
    pub test_id: String,
    pub status: Arc<RwLock<String>>,
    pub stop_flag: Arc<AtomicBool>,
    pub stats: Arc<RwLock<Value>>,
    pub logs: Arc<RwLock<Vec<String>>>,
    pub responses: Arc<RwLock<Vec<Value>>>,
    pub progress: Arc<RwLock<Value>>,
    pub scenario_steps: Arc<RwLock<Vec<Value>>>,
    pub recent_events: Arc<RwLock<Vec<Value>>>,
    pub failure: Arc<RwLock<Option<Value>>>,
}

impl ActiveRun {
    pub fn new(id: String, test_id: String) -> Self {
        Self {
            id,
            test_id,
            status: Arc::new(RwLock::new("running".into())),
            stop_flag: Arc::new(AtomicBool::new(false)),
            stats: Arc::new(RwLock::new(json!({
                "attempts": 0,
                "success": 0,
                "rate_limited": 0,
                "errors": 0,
            }))),
            logs: Arc::new(RwLock::new(Vec::new())),
            responses: Arc::new(RwLock::new(Vec::new())),
            progress: Arc::new(RwLock::new(json!({}))),
            scenario_steps: Arc::new(RwLock::new(Vec::new())),
            recent_events: Arc::new(RwLock::new(Vec::new())),
            failure: Arc::new(RwLock::new(None)),
        }
    }

    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        *self.status.write() = "stopping".into();
    }
}

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<RwLock<Store>>,
    pub runs: Arc<RwLock<HashMap<String, Arc<ActiveRun>>>>,
    pub ws_broadcast: broadcast::Sender<Value>,
    pub gateway: GatewayEngine,
}

impl AppState {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(500);
        let store = Store::new();
        let data_dir = store.file_path.parent().unwrap_or(Path::new("config"));
        let gw_store = GatewayStore::new(data_dir).unwrap_or_else(|_| GatewayStore::new("config").unwrap());
        let gateway = GatewayEngine::new(gw_store);

        Self {
            store: Arc::new(RwLock::new(store)),
            runs: Arc::new(RwLock::new(HashMap::new())),
            ws_broadcast: tx,
            gateway,
        }
    }

    pub fn find_test(&self, id: &str) -> Option<EndpointTest> {
        let store = self.store.read();
        store.current_config.tests.iter().find(|t| t.id == id).cloned()
    }

    pub fn broadcast_ws(&self, msg: Value) {
        let _ = self.ws_broadcast.send(msg);
    }
}

//! Agent folder tools against the real project store: the tree must survive later endpoint edits.
use beacon_agent::execute_tool;
use beacon_server::store::{ServerWorkspace, Store};
use parking_lot::RwLock;
use serde_json::json;
use std::sync::Arc;

#[tokio::test]
async fn folders_survive_endpoint_edits_and_reload() {
    let dir = std::env::temp_dir().join(format!("beacon-agent-coll-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::env::set_var("BEACON_DATA_DIR", &dir);
    let ws = ServerWorkspace(Arc::new(RwLock::new(Store::new())));

    execute_tool("beacon_create_endpoint", &json!({ "name": "Add Discount", "url": "/d", "method": "POST", "folder": "Discount" }), &ws).await;
    execute_tool("beacon_create_endpoint", &json!({ "name": "Get Product", "url": "/p" }), &ws).await;
    let r = execute_tool("beacon_organize_collection", &json!({ "operations": [
        { "op": "create_folder", "name": "Product" },
        { "op": "move", "items": ["Get Product"], "to": "Product" },
        { "op": "reorder", "order": ["Product", "Discount"] }
    ] }), &ws).await;
    assert_eq!(r["mutated"], true, "{r}");

    // Editing an endpoint rewrites tests; the folder structure must stay.
    execute_tool("beacon_update_endpoint", &json!({ "id": "Get Product", "url": "/products" }), &ws).await;

    let reloaded = ServerWorkspace(Arc::new(RwLock::new(Store::new())));
    let tree = execute_tool("beacon_get_collection", &json!({}), &reloaded).await["tree"].clone();
    std::fs::remove_dir_all(&dir).ok();
    let product = tree.as_array().unwrap().iter().find(|n| n["name"] == "Product").expect("Product folder");
    assert_eq!(tree[0]["name"], "Product", "{tree}");
    assert_eq!(product["items"][0]["url"], "/products");
    assert_eq!(tree[1]["items"][0]["name"], "Add Discount");
}

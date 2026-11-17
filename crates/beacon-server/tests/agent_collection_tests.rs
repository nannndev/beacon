//! Agent folder tools against the real project store: the tree must survive later endpoint edits.
use beacon_agent::execute_tool;
use beacon_server::store::{ServerWorkspace, Store};
use parking_lot::RwLock;
use serde_json::json;
use std::sync::{Arc, Mutex};

// `BEACON_DATA_DIR` is process-global; tests in this file run on separate threads
// within the same test binary, so two tests setting it concurrently can make one
// read the other's directory. Hold this for the env-var-dependent span of each test.
static ENV_GUARD: Mutex<()> = Mutex::new(());

#[tokio::test]
async fn folders_survive_endpoint_edits_and_reload() {
    let _guard = ENV_GUARD.lock().unwrap();
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

#[tokio::test]
async fn duplicate_endpoint_and_import_collection_persist_through_the_real_store() {
    let _guard = ENV_GUARD.lock().unwrap();
    let dir = std::env::temp_dir().join(format!("beacon-agent-dup-import-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::env::set_var("BEACON_DATA_DIR", &dir);
    let ws = ServerWorkspace(Arc::new(RwLock::new(Store::new())));

    let created = execute_tool("beacon_create_endpoint", &json!({ "name": "Get Product", "url": "/p" }), &ws).await;
    let id = created["endpoint"]["id"].as_str().unwrap().to_string();

    let dup = execute_tool("beacon_duplicate_endpoint", &json!({ "id": id }), &ws).await;
    assert_eq!(dup["status"], "duplicated", "{dup}");
    assert_eq!(dup["endpoint"]["name"], "Get Product (copy)");

    let imported = execute_tool(
        "beacon_import_collection",
        &json!({ "data": { "name": "Legacy Import", "base_url": "", "variables": {}, "tests": [{"name": "Legacy Ping", "url": "/ping", "method": "GET"}] } }),
        &ws,
    )
    .await;
    assert_eq!(imported["status"], "imported", "{imported}");
    assert_eq!(imported["imported"], 1);

    // Reload from disk: duplication and import must have persisted, not just lived in memory.
    let reloaded = ServerWorkspace(Arc::new(RwLock::new(Store::new())));
    let tree = execute_tool("beacon_get_collection", &json!({}), &reloaded).await["tree"].clone();
    std::fs::remove_dir_all(&dir).ok();
    let names = flat_names(&tree);
    assert!(names.contains(&"Get Product (copy)".to_string()), "{tree}");
    assert!(names.contains(&"Legacy Ping".to_string()), "{tree}");
}

fn flat_names(tree: &serde_json::Value) -> Vec<String> {
    let mut out = Vec::new();
    for node in tree.as_array().unwrap_or(&Vec::new()) {
        if let Some(name) = node["name"].as_str() {
            out.push(name.to_string());
        }
        out.extend(flat_names(&node["items"]));
    }
    out
}

#[tokio::test]
async fn analyzes_local_code_and_imports_it_as_a_project() {
    let _guard = ENV_GUARD.lock().unwrap();
    let root = std::env::temp_dir().join(format!("beacon-agent-code-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let src = root.join("shop-api");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::write(src.join("package.json"), r#"{"dependencies":{"express":"4"}}"#).unwrap();
    std::fs::write(
        src.join("server.js"),
        "const app = require('express')();\napp.get('/users', h);\napp.post('/users', h);\napp.get('/orders/:id', h);\napp.listen(3000);\n",
    )
    .unwrap();
    std::env::set_var("BEACON_DATA_DIR", root.join("data"));
    let ws = ServerWorkspace(Arc::new(RwLock::new(Store::new())));
    let source = src.to_string_lossy().to_string();

    let analysis = execute_tool("beacon_analyze_code", &json!({ "source": source }), &ws).await;
    assert!(analysis["endpoints_found"].as_u64().unwrap_or(0) >= 3, "{analysis}");

    let imported = execute_tool("beacon_import_code", &json!({ "source": source }), &ws).await;
    assert_eq!(imported["mutated"], true, "{imported}");
    assert_eq!(imported["status"], "project_created");
    let endpoints = execute_tool("beacon_list_endpoints", &json!({}), &ws).await.to_string();
    assert!(endpoints.contains("/orders/"), "{endpoints}");

    // A curated list replaces the detected one and lands in the active project.
    let curated = execute_tool("beacon_import_code", &json!({
        "source": source, "into_active_project": true,
        "endpoints": [{ "method": "post", "path": "/login", "folder": "Auth", "sample_body": { "email": "a@b.c" } }]
    }), &ws).await;
    assert_eq!(curated["endpoints_added"], 1, "{curated}");
    let login = execute_tool("beacon_get_endpoint", &json!({ "id": "POST /login" }), &ws).await.to_string();
    assert!(login.contains("a@b.c"), "{login}");
    std::fs::remove_dir_all(&root).ok();
}

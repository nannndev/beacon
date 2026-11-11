use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use beacon_core::EndpointTest;
use serde_json::{json, Value};
use uuid::Uuid;

pub async fn get_tests(State(state): State<AppState>) -> Json<Vec<EndpointTest>> {
    let store = state.store.read();
    Json(store.current_config.tests.clone())
}

pub async fn add_test(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut test: EndpointTest = match serde_json::from_value(payload) {
        Ok(t) => t,
        Err(e) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "detail": format!("Invalid endpoint test: {}", e) })),
            ));
        }
    };

    if test.id.is_empty() {
        test.id = Uuid::new_v4().to_string();
    }

    let mut store = state.store.write();
    store.current_config.tests.push(test.clone());
    if let Err(e) = store.save() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": format!("Failed to save store: {}", e) })),
        ));
    }

    Ok(Json(serde_json::to_value(&test).unwrap_or(json!({}))))
}

pub async fn update_test(
    State(state): State<AppState>,
    Path(test_id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut updated_test: EndpointTest = match serde_json::from_value(payload) {
        Ok(t) => t,
        Err(e) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "detail": format!("Invalid endpoint test: {}", e) })),
            ));
        }
    };
    updated_test.id = test_id.clone();

    let mut store = state.store.write();
    if let Some(idx) = store.current_config.tests.iter().position(|t| t.id == test_id) {
        store.current_config.tests[idx] = updated_test.clone();
        if let Err(e) = store.save() {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "detail": format!("Failed to save store: {}", e) })),
            ));
        }
        Ok(Json(serde_json::to_value(&updated_test).unwrap_or(json!({}))))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "detail": "Endpoint not found" })),
        ))
    }
}

pub async fn delete_test(
    State(state): State<AppState>,
    Path(test_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut store = state.store.write();
    let initial_len = store.current_config.tests.len();
    store.current_config.tests.retain(|t| t.id != test_id);

    if store.current_config.tests.len() == initial_len {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "detail": "Endpoint not found" })),
        ));
    }

    if let Err(e) = store.save() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": format!("Failed to save store: {}", e) })),
        ));
    }

    Ok(Json(json!({ "status": "deleted" })))
}

pub async fn duplicate_test(
    State(state): State<AppState>,
    Path(test_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut store = state.store.write();
    let orig = store
        .current_config
        .tests
        .iter()
        .find(|t| t.id == test_id)
        .cloned();

    match orig {
        Some(mut copy) => {
            copy.id = Uuid::new_v4().to_string();
            copy.name = format!("{} (copy)", copy.name);
            store.current_config.tests.push(copy.clone());
            if let Err(e) = store.save() {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "detail": format!("Failed to save store: {}", e) })),
                ));
            }
            Ok(Json(serde_json::to_value(&copy).unwrap_or(json!({}))))
        }
        None => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "detail": "Endpoint not found" })),
        )),
    }
}


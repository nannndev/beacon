use crate::state::AppState;
use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
};
use beacon_core::TestConfig;
use serde_json::{json, Value};

pub async fn get_config(State(state): State<AppState>) -> Json<Value> {
    let store = state.store.read();
    Json(serde_json::to_value(&store.current_config).unwrap_or(json!({})))
}

pub async fn save_config(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut store = state.store.write();
    match serde_json::from_value::<TestConfig>(payload) {
        Ok(new_config) => {
            store.current_config = new_config;
            if let Err(e) = store.save() {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "detail": format!("Failed to save config: {}", e) })),
                ));
            }
            Ok(Json(json!({
                "status": "saved",
                "project_id": store.current_project_id
            })))
        }
        Err(e) => Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "detail": format!("Invalid config payload: {}", e) })),
        )),
    }
}

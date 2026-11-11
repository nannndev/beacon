pub mod routes;
pub mod state;
pub mod store;

use axum::{
    routing::{get, post, put},
    Router,
};
use state::AppState;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use std::sync::Arc;

pub fn app_router(state: AppState) -> Router {
    let cors = CorsLayer::permissive();
    let gw_router = beacon_gateway::gateway_router(state.gateway.clone());

    let agent_state = beacon_agent::AgentState {
        orchestrator: Arc::new(beacon_agent::AgentOrchestrator::new(state.gateway.clone())),
        get_config: {
            let store_clone = Arc::clone(&state.store);
            Arc::new(move || store_clone.read().current_config.clone())
        },
    };
    let agent_router = beacon_agent::agent_router(agent_state);

    let app = Router::new()
        .route("/system/info", get(routes::system::system_info))
        .route("/monitor/status", get(routes::system::monitor_status))
        .route(
            "/config",
            get(routes::config::get_config).post(routes::config::save_config),
        )
        .route(
            "/tests",
            get(routes::tests::get_tests).post(routes::tests::add_test),
        )
        .route(
            "/tests/:id",
            put(routes::tests::update_test).delete(routes::tests::delete_test),
        )
        .route(
            "/tests/:id/duplicate",
            post(routes::tests::duplicate_test),
        )
        .route(
            "/projects",
            get(routes::projects::list_projects).post(routes::projects::create_project),
        )
        .route("/projects/:id", put(routes::projects::update_project))
        .route("/projects/reorder", put(routes::projects::reorder_projects))
        .route(
            "/projects/:id/switch",
            post(routes::projects::switch_project),
        )
        .route(
            "/projects/samples/jsonplaceholder",
            post(routes::projects::sample_jsonplaceholder),
        )
        .route(
            "/projects/:id/environments",
            post(routes::environments::create_environment),
        )
        .route(
            "/projects/:id/environments/:env_id/switch",
            post(routes::environments::switch_environment),
        )
        .route(
            "/projects/:id/environments/:env_id/variables/:name",
            put(routes::environments::capture_variable),
        )
        .route("/send", post(routes::runs::send_single))
        .route("/run", post(routes::runs::start_run))
        .route("/status/:run_id", get(routes::runs::get_status))
        .route("/stop/:run_id", post(routes::runs::stop_run))
        .route("/proxy", post(routes::runs::proxy_request))
        .route("/ws", get(routes::ws::ws_handler))
        .with_state(state);

    app.merge(gw_router)
        .merge(agent_router)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}

pub async fn run_server() -> Result<(), Box<dyn std::error::Error>> {
    use std::env;
    use std::net::SocketAddr;
    use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

    let _ = tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "beacon_server=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .try_init();

    let mut port: u16 = env::var("PORT")
        .or_else(|_| env::var("BEACON_PORT"))
        .or_else(|_| env::var("BACKEND_PORT"))
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8000);

    let args: Vec<String> = env::args().collect();
    for i in 0..args.len() {
        if (args[i] == "--port" || args[i] == "-p") && i + 1 < args.len() {
            if let Ok(parsed) = args[i + 1].parse::<u16>() {
                port = parsed;
            }
        }
    }

    let state = AppState::new();
    let app = app_router(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("\x1b[94m[BEACON RUST BACKEND]\x1b[0m \x1b[1mStarting Axum + Tokio...\x1b[0m");
    println!("\x1b[94m[BEACON RUST BACKEND]\x1b[0m → http://localhost:{}", port);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

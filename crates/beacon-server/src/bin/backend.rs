#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    beacon_server::run_server().await
}


mod options;
mod temporal {
    pub mod activities;
    pub mod workflows;
}

use temporalio_client::{Client, ClientOptions, Connection, ConnectionOptions};
use temporalio_sdk::{Runtime, Worker, WorkerOptions};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let address = std::env::var("TEMPORAL_ADDRESS")?;
    let namespace = std::env::var("TEMPORAL_NAMESPACE")?;
    let target: temporalio_client::Url = format!("http://{address}").parse()?;
    let connection = Connection::connect(ConnectionOptions::new(target).build()).await?;
    let client = Client::new(connection, ClientOptions::new(namespace).build())?;
    let runtime = Runtime::from_current_tokio(Default::default())?;

    let worker_options =
        WorkerOptions::new("rust-native-e2e").activity_inbound_interceptor(options::AddSuffix);
    let worker_options = temporal::activities::register(worker_options)?;
    let worker_options = temporal::workflows::register(worker_options)?;
    let worker = Worker::new(&runtime, client, worker_options.build())?;
    worker.run_until(tokio::signal::ctrl_c()).await?;
    Ok(())
}

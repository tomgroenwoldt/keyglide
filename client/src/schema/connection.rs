use anyhow::Result;
use log::error;
use tokio::sync::mpsc::UnboundedSender;

use super::{join::Join, lobby::Lobby, offline::Offline};
use crate::{app::AppMessage, config::Config};

pub enum Connection {
    Join(Join),
    Lobby(Lobby),
    Offline(Offline),
}

impl Connection {
    /// # Create a new connection
    ///
    /// Tries to connect the client to the backend. If this fails it returns the
    /// `Connection::Offline` variant and spawns a task that tries to reconnect
    /// continously.
    /// Notifies the application on a successful reconnect.
    pub async fn new(app_tx: UnboundedSender<AppMessage>, config: &Config) -> Result<Self> {
        let connection = match Join::new(app_tx.clone(), config).await {
            Ok(join) => Connection::Join(join),
            Err(e) => {
                error!("Error connecting to backend service: {e}.");

                let offline = Offline::new(app_tx);
                Connection::Offline(offline)
            }
        };
        Ok(connection)
    }
}

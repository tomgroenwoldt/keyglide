use std::collections::BTreeMap;

use anyhow::Result;
use futures_util::{
    stream::{SplitSink, SplitStream},
    SinkExt, StreamExt,
};
use log::{debug, error, info};
use ratatui::{
    crossterm::event::KeyEvent,
    widgets::{ScrollbarState, TableState},
};
use tokio::{
    net::TcpStream,
    sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender},
};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Error, Message},
    MaybeTlsStream, WebSocketStream,
};
use uuid::Uuid;

use common::{constants::MAX_LOBBY_SIZE, BackendMessage, JoinMode, LobbyListItem, LobbyStatus};

use super::encryption::{Encryption, EncryptionAction};
use crate::{app::AppMessage, config::Config};

pub struct Join {
    pub lobby_list: BTreeMap<Uuid, LobbyListItem>,
    pub selected_lobby: Option<Uuid>,
    pub ws_tx: SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>,
    pub rx: UnboundedReceiver<JoinMessage>,
    pub app_tx: UnboundedSender<AppMessage>,
    pub state: TableState,
    pub scroll_state: ScrollbarState,

    pub encrypted_names: BTreeMap<Uuid, Encryption>,
    pub encrypted_player_counts: BTreeMap<Uuid, Encryption>,
    pub encrypted_status: BTreeMap<Uuid, Encryption>,
}

#[derive(Debug)]
pub enum JoinMessage {
    /// Updates the table showing current lobbies.
    CurrentLobbies(BTreeMap<Uuid, LobbyListItem>),
    /// Closes the websocket connection to the backend service.
    CloseConnection,
    /// Adds a lobby to the lobby list table.
    AddLobby(Uuid, LobbyListItem),
    /// Updates the player count for a lobby in the lobby list table.
    UpdateLobbyPlayerCount { id: Uuid, player_count: usize },
    /// Updates the status for a lobby in the lobby list table.
    UpdateLobbyStatus { id: Uuid, status: LobbyStatus },
    /// Removes a lobby from the lobby list table.
    RemoveLobby(Uuid),
}

impl Join {
    pub async fn new(app_tx: UnboundedSender<AppMessage>, config: &Config) -> Result<Self, Error> {
        let (ws_stream, _) = connect_async(format!(
            "ws://{}:{}/clients",
            config.general.service.address, config.general.service.port
        ))
        .await?;
        let (ws_tx, ws_rx) = ws_stream.split();

        let (tx, rx) = unbounded_channel();
        let message_tx = tx.clone();
        tokio::spawn(Join::handle_backend_message(
            ws_rx,
            message_tx,
            app_tx.clone(),
        ));

        Ok(Self {
            lobby_list: BTreeMap::new(),
            selected_lobby: None,
            ws_tx,
            rx,
            app_tx,
            state: TableState::default(),
            scroll_state: ScrollbarState::default(),

            encrypted_names: BTreeMap::new(),
            encrypted_player_counts: BTreeMap::new(),
            encrypted_status: BTreeMap::new(),
        })
    }

    pub async fn handle_key_event(&mut self, config: &Config, key: KeyEvent) -> Result<()> {
        debug!("Handle key event {:?}.", key);

        // Join a selected lobby.
        if key.eq(&config.key_bindings.join.join_selected) {
            if let Some(lobby_id) = self.selected_lobby {
                self.ws_tx.close().await?;
                let join_mode = JoinMode::Join { lobby_id };
                self.app_tx.send(AppMessage::ConnectToLobby { join_mode })?;
            }
        } else if key.eq(&config.key_bindings.movement.down) {
            self.next_lobby_entry();
        } else if key.eq(&config.key_bindings.movement.up) {
            self.previous_lobby_entry();
        } else if key.eq(&config.key_bindings.join.quickplay) {
            self.ws_tx.close().await?;
            let join_mode = JoinMode::Quickplay;
            self.app_tx.send(AppMessage::ConnectToLobby { join_mode })?;
        } else if key.eq(&config.key_bindings.join.create) {
            debug!("Close client connection.");

            self.ws_tx.close().await?;
            let join_mode = JoinMode::Create;
            self.app_tx.send(AppMessage::ConnectToLobby { join_mode })?;
        }
        Ok(())
    }

    pub async fn handle_message(&mut self, msg: JoinMessage) -> Result<()> {
        debug!("Handle message {:?}.", msg);

        match msg {
            JoinMessage::CurrentLobbies(lobby_list) => {
                for (id, lobby) in lobby_list.iter() {
                    self.encrypted_names
                        .insert(*id, Encryption::new(lobby.name.clone()));
                    self.encrypted_player_counts.insert(
                        *id,
                        Encryption::new(format!("{} / {}", lobby.player_count, MAX_LOBBY_SIZE)),
                    );
                    self.encrypted_status
                        .insert(*id, Encryption::new(lobby.status.to_string()));
                }
                self.lobby_list = lobby_list;
                self.scroll_state = self.scroll_state.content_length(self.lobby_list.len());
            }
            JoinMessage::CloseConnection => {
                info!("Close non-player connection.");
                self.ws_tx.close().await?;
            }
            JoinMessage::AddLobby(lobby_id, lobby) => {
                info!(
                    "Update lobby list with lobby {} and {} players.",
                    lobby.name, lobby.player_count
                );
                self.encrypted_names
                    .insert(lobby_id, Encryption::new(lobby.name.clone()));
                self.encrypted_player_counts.insert(
                    lobby_id,
                    Encryption::new(format!("{} / {}", lobby.player_count, MAX_LOBBY_SIZE)),
                );
                self.encrypted_status
                    .insert(lobby_id, Encryption::new(lobby.status.to_string()));
                self.lobby_list.insert(lobby_id, lobby);
                self.scroll_state = self.scroll_state.content_length(self.lobby_list.len());
            }
            JoinMessage::RemoveLobby(lobby_id) => {
                // If the currently selected lobby was removed, unselect it.
                if let Some(selected_lobby) = self.selected_lobby {
                    if selected_lobby.eq(&lobby_id) {
                        self.selected_lobby = None;
                    }
                }
                if let Some(lobby) = self.lobby_list.remove(&lobby_id) {
                    self.scroll_state = self.scroll_state.content_length(self.lobby_list.len());
                    if let Some(encryption) = self.encrypted_names.get_mut(&lobby_id) {
                        encryption.action = EncryptionAction::Left;
                        encryption.index = encryption.value.len() - 1;
                    }
                    if let Some(encryption) = self.encrypted_player_counts.get_mut(&lobby_id) {
                        encryption.action = EncryptionAction::Left;
                        encryption.index = encryption.value.len() - 1;
                    }
                    if let Some(encryption) = self.encrypted_status.get_mut(&lobby_id) {
                        encryption.action = EncryptionAction::Left;
                        encryption.index = encryption.value.len() - 1;
                    }
                    info!("Remove lobby {} from lobby list.", lobby.name);
                } else {
                    error!("Tried to remove a non-existent lobby with ID {}.", lobby_id);
                }
            }
            JoinMessage::UpdateLobbyPlayerCount { id, player_count } => {
                if let Some(lobby) = self.lobby_list.get_mut(&id) {
                    self.encrypted_player_counts.insert(
                        id,
                        Encryption::new(format!("{} / {}", player_count, MAX_LOBBY_SIZE)),
                    );
                    lobby.player_count = player_count;
                }
            }
            JoinMessage::UpdateLobbyStatus { id, status } => {
                if let Some(lobby) = self.lobby_list.get_mut(&id) {
                    info!(
                        "received lobby status update: {}, status: {:?}",
                        status, self.encrypted_status
                    );
                    self.encrypted_status
                        .insert(id, Encryption::new(status.to_string()));
                    lobby.status = status;
                }
            }
        }
        Ok(())
    }

    pub async fn handle_backend_message(
        mut ws_rx: SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>,
        message_tx: UnboundedSender<JoinMessage>,
        app_tx: UnboundedSender<AppMessage>,
    ) -> Result<()> {
        while let Some(Ok(msg)) = ws_rx.next().await {
            debug!("Handle backend message {:?}.", msg);

            if msg.is_close() {
                return Ok(());
            }
            let backend_message: BackendMessage = msg.into();
            match backend_message {
                BackendMessage::CloseConnection => {
                    message_tx.send(JoinMessage::CloseConnection)?;
                    return Ok(());
                }
                BackendMessage::CurrentLobbies(lobbies) => {
                    message_tx.send(JoinMessage::CurrentLobbies(lobbies))?;
                }
                BackendMessage::AddLobby(lobby_id, lobby) => {
                    message_tx.send(JoinMessage::AddLobby(lobby_id, lobby))?;
                }
                BackendMessage::RemoveLobby(lobby_id) => {
                    message_tx.send(JoinMessage::RemoveLobby(lobby_id))?;
                }
                BackendMessage::ConnectionCounts { clients, players } => {
                    app_tx.send(AppMessage::ConnectionCounts { clients, players })?;
                }
                BackendMessage::UpdateLobbyPlayerCount { id, player_count } => {
                    message_tx.send(JoinMessage::UpdateLobbyPlayerCount { id, player_count })?;
                }
                BackendMessage::UpdateLobbyStatus { id, status } => {
                    message_tx.send(JoinMessage::UpdateLobbyStatus { id, status })?;
                }
                _ => {}
            }
        }

        // We should only arrive here whenever the WS connection is abruptly
        // closed. Therefore remove the current lobby here.
        error!("Backend service disconnected!");
        app_tx.send(AppMessage::ServiceDisconnected)?;
        Ok(())
    }

    /// # Next lobby entry
    ///
    /// Selects the next lobby entry given an already selected lobby. Otherwise
    /// select the first entry.
    pub fn next_lobby_entry(&mut self) {
        let i = match self.state.selected() {
            Some(i) => {
                let length = self.lobby_list.len().checked_sub(1).unwrap_or_default();
                if i >= length {
                    0
                } else {
                    i + 1
                }
            }
            None => 0,
        };
        self.state.select(Some(i));
        self.selected_lobby = self.lobby_list.keys().cloned().nth(i);
        self.scroll_state = self.scroll_state.position(i);
    }

    /// # Previous lobby entry
    ///
    /// Selects the previous lobby entry given an already selected lobby. Otherwise
    /// select the last entry.
    pub fn previous_lobby_entry(&mut self) {
        let i = match self.state.selected() {
            Some(i) => {
                if i == 0 {
                    self.lobby_list.len().checked_sub(1).unwrap_or_default()
                } else {
                    i - 1
                }
            }
            None => 0,
        };
        self.state.select(Some(i));
        self.selected_lobby = self.lobby_list.keys().cloned().nth(i);
        self.scroll_state = self.scroll_state.position(i);
    }

    pub fn on_tick(&mut self) {
        let mut encryptions_to_delete = vec![];

        // Zip the three encryption vectors to iterate over triplets.
        for (((id, name), player_count), status) in self
            .encrypted_names
            .iter_mut()
            .zip(self.encrypted_player_counts.values_mut())
            .zip(self.encrypted_status.values_mut())
        {
            let name_finished = match name.action {
                EncryptionAction::Joined => {
                    if name.index < name.value.len() {
                        name.index += 1;
                    }
                    false
                }
                EncryptionAction::Left => name.value.pop().is_none(),
            };
            let player_count_finished = match player_count.action {
                EncryptionAction::Joined => {
                    if player_count.index < player_count.value.len() {
                        player_count.index += 1;
                    }
                    false
                }
                EncryptionAction::Left => player_count.value.pop().is_none(),
            };
            let status_finished = match status.action {
                EncryptionAction::Joined => {
                    if status.index < status.value.len() {
                        status.index += 1;
                    }
                    false
                }
                EncryptionAction::Left => status.value.pop().is_none(),
            };
            // Only delete encryptions if the encryptions for all three fields
            // are finished animating.
            if name_finished && player_count_finished && status_finished {
                encryptions_to_delete.push(*id);
            }
        }
        for id in encryptions_to_delete {
            self.encrypted_names.remove(&id);
            self.encrypted_player_counts.remove(&id);
            self.encrypted_status.remove(&id);
        }
    }
}

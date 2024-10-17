use std::collections::BTreeMap;

use anyhow::Result;
use common::{
    BackendMessage, ChallengeFiles, ClientMessage, JoinMode, LobbyInformation, LobbyStatus, Player,
};
use futures_util::{
    stream::{SplitSink, SplitStream},
    SinkExt, StreamExt,
};
use log::{debug, error, info};
use ratatui::layout::{Direction, Size};
use tokio::{
    net::TcpStream,
    sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender},
};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
use uuid::Uuid;

use super::{
    chat::Chat,
    editor::Editor,
    encryption::{Encryption, EncryptionAction},
};
use crate::{
    app::AppMessage,
    config::Config,
    schema::{
        focused_component::{ComponentKind, FocusedComponent},
        goal::Goal,
    },
};

#[derive(Debug)]
pub enum LobbyMessage {
    CloseConnection,
    EditorTerminated,
    GoalTerminated,
    AssignOwner { id: Uuid },
    PlayerJoined(Player),
    PlayerLeft(Uuid),
    ReceiveMessage(String),
    RequestStart,
    StatusUpdate { status: LobbyStatus },
    SendMessage { message: String },
    SendProgress { progress: Vec<u8> },
    SetLocalPlayerId { id: Uuid },
    UpdatePlayerProgress { player_id: Uuid, progress: f64 },
}

pub struct Lobby {
    pub name: String,
    pub owner: Option<Uuid>,
    pub players: BTreeMap<Uuid, Player>,
    pub local_player: Option<Uuid>,
    pub encryptions: BTreeMap<Uuid, Encryption>,
    pub waiting_encryptions: BTreeMap<Uuid, Encryption>,
    pub chat: Chat,
    pub ws_tx: SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>,
    pub tx: UnboundedSender<LobbyMessage>,
    pub rx: UnboundedReceiver<LobbyMessage>,
    /// An instance of the users default editor with full interactivity.
    pub editor: Editor,
    /// An instance of the users default editor only capable of resizing.
    pub goal: Goal,
    pub app_size: Size,
    pub challenge_files: ChallengeFiles,
    pub status: LobbyStatus,
    /// Whether to display the two editors horizontally or vertically next to
    /// each other.
    pub terminal_layout_direction: Direction,
}

impl Lobby {
    /// # Create new lobby connection
    ///
    /// Connects the player to the backend. Depending on `join_mode` creates or joins a lobby.
    pub async fn new(
        app_tx: UnboundedSender<AppMessage>,
        join_mode: JoinMode,
        app_size: Size,
        config: &Config,
    ) -> Result<Self> {
        // First, fetch lobby information of the lobby we want to join.
        let url = format!(
            "http://{}:{}/lobbies/{}",
            config.general.service.address, config.general.service.port, join_mode
        );
        let lobby_information = reqwest::get(url).await?.json::<LobbyInformation>().await?;

        // Connect to lobby with given join mode.
        let url = format!(
            "ws://{}:{}/players/{}",
            config.general.service.address, config.general.service.port, lobby_information.id
        );
        let (ws_stream, _) = connect_async(url).await?;

        // Setup messaging channels.
        let (ws_tx, ws_rx) = ws_stream.split();
        let (tx, rx) = unbounded_channel();

        // Spawn task to handle incoming backend messages.
        let message_tx = tx.clone();
        tokio::spawn(Lobby::handle_backend_message(
            ws_rx,
            message_tx,
            app_tx.clone(),
        ));

        debug!("{:?}", lobby_information);

        let mut encryptions = BTreeMap::new();
        let mut waiting_encryptions = BTreeMap::new();
        for (id, player) in lobby_information.players.iter() {
            let mut encryption = Encryption {
                action: EncryptionAction::Joined,
                index: 0,
                value: player.name.clone(),
            };
            if lobby_information
                .owner
                .is_some_and(|owner_id| owner_id.eq(id))
            {
                encryption.value.push_str(" (owner)");
            }
            if player.waiting {
                waiting_encryptions.insert(*id, encryption);
            } else {
                encryptions.insert(*id, encryption);
            }
        }

        let mut editor = Editor::new(
            app_size,
            tx.clone(),
            lobby_information.challenge_files.start_file.clone(),
            false,
        )?;
        let terminal_layout_direction = Direction::Vertical;
        editor.resize(app_size.height, app_size.width, terminal_layout_direction)?;
        let mut goal = Goal::new(
            app_size,
            tx.clone(),
            lobby_information.challenge_files.goal_file.clone(),
            false,
        )?;
        goal.resize(app_size.height, app_size.width, terminal_layout_direction)?;

        Ok(Self {
            name: lobby_information.name,
            owner: lobby_information.owner,
            players: lobby_information.players,
            local_player: None,
            encryptions,
            waiting_encryptions,
            chat: Chat::new(tx.clone()),
            ws_tx,
            tx,
            rx,
            editor,
            goal,
            app_size,
            challenge_files: lobby_information.challenge_files,
            status: lobby_information.status,
            terminal_layout_direction,
        })
    }

    pub async fn handle_message(&mut self, msg: LobbyMessage) -> Result<()> {
        debug!("Handle message {:?}.", msg);

        match msg {
            LobbyMessage::AssignOwner { id } => {
                if let Some(player) = self.players.get(&id) {
                    self.owner = Some(id);
                    info!(
                        "Assigned player {} with ID {} lobby owner.",
                        player.name, player.id
                    );
                    if let Some(owner_encryption) = self.encryptions.get_mut(&id) {
                        owner_encryption.value.push_str(" (owner)");
                    }
                } else {
                    error!("New lobby owner with ID {} was not found!", id);
                }
            }
            LobbyMessage::CloseConnection => {
                info!("Close connection to lobby.");
                self.ws_tx.close().await?;
            }
            LobbyMessage::PlayerJoined(player) => {
                info!("Player {} joined the lobby.", player.name);

                self.chat.add_message(format!("{} joined!", player.name));
                let encryption = Encryption {
                    action: EncryptionAction::Joined,
                    index: 0,
                    value: player.name.clone(),
                };
                if player.waiting {
                    self.waiting_encryptions.insert(player.id, encryption);
                } else {
                    self.encryptions.insert(player.id, encryption);
                }
                self.players.insert(player.id, player);
            }
            LobbyMessage::PlayerLeft(id) => {
                if let Some(player) = self.players.remove(&id) {
                    info!("Player {} left the lobby.", player.name);
                    self.chat.add_message(format!("{} left!", player.name));
                } else {
                    error!("Tried to remove a non-existent player with ID {}.", id);
                }

                if let Some(encryption) = self
                    .encryptions
                    .get_mut(&id)
                    .or(self.waiting_encryptions.get_mut(&id))
                {
                    encryption.index = encryption.value.len() - 1;
                    encryption.action = EncryptionAction::Left;
                }
            }
            LobbyMessage::ReceiveMessage(msg) => {
                self.chat.add_message(msg);
            }
            LobbyMessage::SendMessage { message } => {
                self.ws_tx
                    .send(ClientMessage::SendMessage { message }.into())
                    .await?;
            }
            LobbyMessage::SetLocalPlayerId { id } => {
                info!("Received local player ID {} from the backend.", id);
                self.local_player = Some(id);

                if let Some(local_player) = self
                    .encryptions
                    .get_mut(&id)
                    .or(self.waiting_encryptions.get_mut(&id))
                {
                    local_player.value.push_str(" (you)");
                }
            }
            LobbyMessage::EditorTerminated => {
                // Restart the editor if it terminates.
                self.editor = Editor::new(
                    self.app_size,
                    self.tx.clone(),
                    self.challenge_files.start_file.clone(),
                    self.editor.is_full_screen,
                )?;
                self.editor.resize(
                    self.app_size.height,
                    self.app_size.width,
                    self.terminal_layout_direction,
                )?;
            }
            LobbyMessage::GoalTerminated => {
                // Restart the goal editor if it terminates.
                self.goal = Goal::new(
                    self.app_size,
                    self.tx.clone(),
                    self.challenge_files.goal_file.clone(),
                    self.goal.is_full_screen,
                )?;
                self.goal.resize(
                    self.app_size.height,
                    self.app_size.width,
                    self.terminal_layout_direction,
                )?;
            }
            LobbyMessage::RequestStart => {
                self.ws_tx.send(ClientMessage::RequestStart.into()).await?;
            }
            LobbyMessage::StatusUpdate { status } => {
                self.status = status;
            }
            LobbyMessage::SendProgress { progress } => {
                self.ws_tx
                    .send(ClientMessage::Progress { progress }.into())
                    .await?;
            }
            LobbyMessage::UpdatePlayerProgress {
                player_id,
                progress,
            } => {
                if let Some(player) = self.players.get_mut(&player_id) {
                    player.progress = progress;
                } else {
                    error!(
                        "Tried to update progress of non-existent player with ID {}.",
                        player_id
                    );
                }
            }
        }
        Ok(())
    }

    pub async fn handle_backend_message(
        mut ws_rx: SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>,
        message_tx: UnboundedSender<LobbyMessage>,
        app_tx: UnboundedSender<AppMessage>,
    ) -> Result<()> {
        while let Some(Ok(msg)) = ws_rx.next().await {
            debug!("Handle backend message {:?}.", msg);

            if msg.is_close() {
                return Ok(());
            }
            let backend_message: BackendMessage = msg.into();
            match backend_message {
                BackendMessage::ProvidePlayerId { id } => {
                    message_tx.send(LobbyMessage::SetLocalPlayerId { id })?;
                }
                BackendMessage::AssignOwner { id } => {
                    message_tx.send(LobbyMessage::AssignOwner { id })?;
                }
                BackendMessage::CloseConnection => {
                    message_tx.send(LobbyMessage::CloseConnection)?;
                }
                BackendMessage::SendMessage(msg) => {
                    message_tx.send(LobbyMessage::ReceiveMessage(msg))?;
                }
                BackendMessage::AddPlayer(player) => {
                    message_tx.send(LobbyMessage::PlayerJoined(player))?;
                }
                BackendMessage::RemovePlayer(player_id) => {
                    message_tx.send(LobbyMessage::PlayerLeft(player_id))?;
                }
                BackendMessage::LobbyFull => {
                    app_tx.send(AppMessage::DisconnectLobby)?;
                }
                BackendMessage::LobbyNotWaitingForPlayers => {
                    app_tx.send(AppMessage::DisconnectLobby)?;
                }
                BackendMessage::ConnectionCounts { clients, players } => {
                    app_tx.send(AppMessage::ConnectionCounts { clients, players })?;
                }
                BackendMessage::StatusUpdate { status } => {
                    let component_to_focus = match status {
                        LobbyStatus::WaitingForPlayers
                        | LobbyStatus::AboutToStart(_)
                        | LobbyStatus::Finish(_) => None,
                        LobbyStatus::InProgress(_) => {
                            Some(FocusedComponent::new(ComponentKind::Editor))
                        }
                    };
                    app_tx.send(AppMessage::FocusComponent(component_to_focus))?;
                    message_tx.send(LobbyMessage::StatusUpdate { status })?;
                }
                BackendMessage::UpdatePlayerProgress {
                    player_id,
                    progress,
                } => {
                    message_tx.send(LobbyMessage::UpdatePlayerProgress {
                        player_id,
                        progress,
                    })?;
                }
                _ => {}
            }
        }

        // We should only arrive here whenever the WS connection is abruptly
        // closed. Therefore remove the current lobby here.
        app_tx.send(AppMessage::DisconnectLobby)?;
        Ok(())
    }

    pub fn resize(&mut self, rows: u16, cols: u16) -> Result<()> {
        self.app_size = Size::new(cols, rows);
        self.goal
            .resize(rows, cols, self.terminal_layout_direction)?;
        self.editor
            .resize(rows, cols, self.terminal_layout_direction)?;
        Ok(())
    }

    pub fn on_tick(&mut self) {
        let mut encryptions_to_delete = vec![];
        for (id, encryption) in self
            .encryptions
            .iter_mut()
            .chain(self.waiting_encryptions.iter_mut())
        {
            match encryption.action {
                EncryptionAction::Joined => {
                    if encryption.index < encryption.value.len() {
                        encryption.index += 1;
                    }
                }
                EncryptionAction::Left => {
                    if encryption.value.pop().is_none() {
                        encryptions_to_delete.push(*id);
                    }
                }
            }
        }
        for id in encryptions_to_delete {
            self.encryptions
                .remove(&id)
                .or(self.waiting_encryptions.remove(&id));
        }
    }

    pub fn toggle_terminal_layout(&mut self) {
        if self.terminal_layout_direction == Direction::Vertical {
            self.terminal_layout_direction = Direction::Horizontal;
        } else {
            self.terminal_layout_direction = Direction::Vertical;
        }
    }

    pub fn clean_up(&mut self) -> Result<()> {
        self.goal.terminal.child_killer.kill()?;
        self.editor.terminal.child_killer.kill()?;
        Ok(())
    }
}

// Make sure the terminal instances are killed whenever we drop a lobby.
impl Drop for Lobby {
    fn drop(&mut self) {
        if let Err(e) = self.clean_up() {
            error!("Error cleaning up lobby: {e}");
        }
    }
}

use std::time::{Duration, Instant};

use anyhow::Result;
use common::{JoinMode, LobbyStatus};
use futures_util::SinkExt;
use log::debug;
use ratatui::{
    backend::Backend,
    crossterm::{
        self,
        event::{self, Event, KeyEvent},
    },
    layout::Size,
    Terminal,
};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

#[cfg(feature = "audio")]
use crate::audio::{play_audio, Audio};
use crate::{
    config::Config,
    schema::{
        connection::Connection,
        focused_component::{ComponentKind, FocusedComponent},
        lobby::{Lobby, LobbyMessage},
        tab::Tab,
    },
    ui,
};

pub struct App {
    pub config: Config,
    /// The currently selected tab.
    pub current_tab: Tab,
    /// The current size of the terminal the application is running in.
    pub size: Size,

    pub tx: UnboundedSender<AppMessage>,
    pub rx: UnboundedReceiver<AppMessage>,

    pub connection: Connection,
    /// The total number of clients (non-playing users) currently connected.
    pub total_clients: usize,
    /// The total number playing users.
    pub total_players: usize,
    /// The currently focused component has priority over all other elements
    /// when it comes to user inputs.
    pub focused_component: Option<FocusedComponent>,

    pub exit: bool,
}

#[derive(Debug)]
pub enum AppMessage {
    FocusComponent(Option<FocusedComponent>),
    /// Connects to a lobby via the given join mode.
    ConnectToLobby {
        join_mode: JoinMode,
    },
    /// Disconnects the client from the current lobby.
    DisconnectLobby,
    /// Updates the total connection count on the home page.
    ConnectionCounts {
        players: usize,
        clients: usize,
    },
    /// The backend connection was closed. The app tries to reconnnect.
    ServiceDisconnected,
    /// The backend is back online.
    ServiceBackOnline,
}

impl App {
    pub async fn new(config: Config, size: Size) -> Result<Self> {
        let (tx, rx) = unbounded_channel();
        let connection = Connection::new(tx.clone(), &config).await?;
        let app = App {
            config,
            current_tab: Tab::Home,
            size,
            tx,
            rx,
            connection,
            total_clients: 0,
            total_players: 0,
            focused_component: None,
            exit: false,
        };
        Ok(app)
    }

    pub async fn run<B: Backend>(
        &mut self,
        terminal: &mut Terminal<B>,
        tick_rate: Duration,
    ) -> Result<()> {
        let mut last_tick = Instant::now();
        while !self.exit {
            // Draw the application.
            terminal.draw(|f| ui::draw(f, self))?;

            // Handle terminal events.
            let timeout = tick_rate.saturating_sub(last_tick.elapsed());
            if crossterm::event::poll(timeout)? {
                let event = event::read()?;
                self.handle_event(event, terminal).await?;
            }

            // Handle app messages sent from other tasks.
            if let Ok(msg) = self.rx.try_recv() {
                self.handle_message(msg).await?;
            }

            // Handle messages depending on the current connection.
            self.handle_connection_message().await?;

            // Handle application ticks. This is mainly used for handling
            // animations.
            if last_tick.elapsed() >= tick_rate {
                self.on_tick().await?;
                last_tick = Instant::now();
            }
        }

        Ok(())
    }

    pub fn focused_component_is_kind(&self, kind: ComponentKind) -> bool {
        if let Some(ref component) = self.focused_component {
            if component.kind.eq(&kind) {
                return true;
            }
            return false;
        }
        false
    }

    /// # Move to the next tab
    ///
    /// Selects the next tab.
    pub fn on_right(&mut self) {
        self.current_tab = self.current_tab.next();
    }

    /// # Move to previous tab
    ///
    /// Selects the previous tab.
    pub fn on_left(&mut self) {
        self.current_tab = self.current_tab.previous();
    }

    pub async fn on_key(&mut self, key: KeyEvent) -> Result<()> {
        // Unfocus component or quit the application if no component is focused.
        if key.eq(&self.config.key_bindings.miscellaneous.unfocus) {
            if self.focused_component.is_some() {
                FocusedComponent::clean_up(self)?;
                self.focused_component = None;
            } else {
                self.focused_component = Some(FocusedComponent::new(ComponentKind::ExitPopup));
            }
            return Ok(());
        }

        // Check whether there is a component focused. Such components receive
        // direct user input and take precedence.
        if self.focused_component.is_some() {
            FocusedComponent::handle_key_event(self, key).await?;
        } else {
            // First, handle general purpose key bindings.
            if key.eq(&self.config.key_bindings.movement.left) {
                self.on_left();
            } else if key.eq(&self.config.key_bindings.movement.right) {
                self.on_right();
            } else {
                // Then, handle key bindings per tab.
                self.handle_key_event_per_tab(key).await?;
            }
        };
        Ok(())
    }

    async fn handle_key_event_per_tab(&mut self, key: KeyEvent) -> Result<()> {
        match self.current_tab {
            Tab::Home => {}
            Tab::Play => {
                match self.connection {
                    Connection::Join(_) => {
                        if key.eq(&self.config.key_bindings.join.focus_lobby_list) {
                            self.focused_component =
                                Some(FocusedComponent::new(ComponentKind::Lobbies));
                        }
                    }
                    Connection::Lobby(ref mut lobby) => {
                        // Disconnect from existing lobby.
                        if key.eq(&self.config.key_bindings.lobby.disconnect) {
                            lobby.ws_tx.close().await?;
                            self.connection =
                                Connection::new(self.tx.clone(), &self.config).await?;
                        }
                        // Whenever a lobby is about to start, ignore all key
                        // events except the disconnect one.
                        else if let LobbyStatus::AboutToStart(_) = lobby.status {
                            return Ok(());
                        }
                        // Focus the chat.
                        else if key.eq(&self.config.key_bindings.lobby.focus_chat) {
                            self.focused_component =
                                Some(FocusedComponent::new(ComponentKind::Chat));
                        }
                        // Focus the editor.
                        else if key.eq(&self.config.key_bindings.lobby.focus_editor) {
                            self.focused_component =
                                Some(FocusedComponent::new(ComponentKind::Editor));
                        }
                        // Focus the goal.
                        else if key.eq(&self.config.key_bindings.lobby.focus_goal) {
                            self.focused_component =
                                Some(FocusedComponent::new(ComponentKind::Goal));
                        } else if key.eq(&self.config.key_bindings.lobby.toggle_terminal_layout) {
                            lobby.toggle_terminal_layout();
                            lobby.resize(self.size.height, self.size.width)?;
                        }
                        // Start the lobby as lobby owner.
                        else if key.eq(&self.config.key_bindings.lobby.start)
                            && lobby.status == LobbyStatus::WaitingForPlayers
                            && lobby.owner == lobby.local_player
                            && lobby.local_player.is_some()
                        {
                            lobby.tx.send(LobbyMessage::RequestStart)?;
                        }
                        // Scroll chat down.
                        else if key.eq(&self.config.key_bindings.movement.down) {
                            lobby.chat.next();
                        } else if key.eq(&self.config.key_bindings.movement.up) {
                            lobby.chat.previous();
                        }
                    }
                    Connection::Offline(_) => {}
                }
            }
            Tab::Logs => {}
        };
        Ok(())
    }

    pub async fn handle_message(&mut self, msg: AppMessage) -> Result<()> {
        debug!("Handle message: {:?}.", msg);

        match msg {
            AppMessage::DisconnectLobby => {
                self.focused_component = None;
                if let Connection::Lobby(ref mut lobby) = self.connection {
                    lobby.ws_tx.close().await?;
                    self.connection = Connection::new(self.tx.clone(), &self.config).await?;
                }
            }
            AppMessage::ServiceBackOnline => {
                self.connection = Connection::new(self.tx.clone(), &self.config).await?;

                #[cfg(feature = "audio")]
                play_audio(&self.config, Audio::Reconnected)?;
            }
            AppMessage::ServiceDisconnected => {
                // Make sure to unfocus components on disconnect.
                self.focused_component = None;
                self.connection = Connection::new(self.tx.clone(), &self.config).await?;
            }
            AppMessage::ConnectToLobby { join_mode } => {
                let lobby = Lobby::new(self.tx.clone(), join_mode, self.size, &self.config).await?;
                self.connection = Connection::Lobby(lobby);
                self.focused_component = None;
            }
            AppMessage::ConnectionCounts { players, clients } => {
                self.total_clients = clients;
                self.total_players = players;
            }
            AppMessage::FocusComponent(component) => {
                self.focused_component = component;
            }
        }
        Ok(())
    }

    pub async fn handle_connection_message(&mut self) -> Result<()> {
        match self.connection {
            Connection::Lobby(ref mut lobby) => {
                if let Ok(msg) = lobby.rx.try_recv() {
                    lobby.handle_message(msg).await?;
                }
            }
            Connection::Join(ref mut join) => {
                if let Ok(msg) = join.rx.try_recv() {
                    join.handle_message(msg).await?;
                }
            }
            Connection::Offline(_) => {}
        }
        Ok(())
    }

    pub async fn handle_event<B: Backend>(
        &mut self,
        event: Event,
        terminal: &mut Terminal<B>,
    ) -> Result<()> {
        debug!("Handle event {:?}.", event);

        match event {
            Event::Key(key) => {
                self.on_key(key).await?;
            }
            Event::Resize(cols, rows) => {
                if let Connection::Lobby(ref mut lobby) = self.connection {
                    lobby.resize(rows, cols)?;
                }
                self.size = terminal.size()?;
            }
            _ => {}
        }
        Ok(())
    }

    pub async fn on_tick(&mut self) -> Result<()> {
        match self.connection {
            Connection::Join(ref mut join) => {
                join.on_tick();
            }
            Connection::Lobby(ref mut lobby) => {
                lobby.on_tick();
            }
            Connection::Offline(ref mut offline) => {
                offline.on_tick(&self.config).await?;
            }
        }
        Ok(())
    }
}

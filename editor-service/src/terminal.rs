use axum::{
    body::Bytes,
    extract::ws::{Message, WebSocket},
};
use common::EditorServiceMessage;
use futures::{
    stream::{SplitSink, SplitStream},
    SinkExt, StreamExt,
};
use log::error;
use serde::Deserialize;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::mpsc::{UnboundedReceiver, UnboundedSender},
};

use crate::pty::PtyMaster;

/// # Window size of a terminal
///
/// The client sends this to request a PTY resize. This way the frontend xtermjs
/// instance fits to the helix instance.
#[derive(Deserialize, Debug)]
pub struct WindowSize {
    pub cols: u16,
    pub rows: u16,
}

/// # Send byte stream of PTY to client
///
/// Receives byte stream of PTY and redirects it to the client.
pub async fn write_to_websocket(
    mut outgoing: SplitSink<WebSocket, Message>,
    mut receiver: UnboundedReceiver<Message>,
) {
    while let Some(msg) = receiver.recv().await {
        if let Err(e) = outgoing.send(msg).await {
            error!("Unable to send PTY byte stream to client: {e}");
        }
    }
}

/// # Read stdout of PTY and send it to client
///
/// Constantly reads the stdout of the running helix instance and redirects it
/// to websocket sending channel.
pub async fn handle_pty_incoming(
    mut pty_shell_reader: PtyMaster,
    ws_sender: UnboundedSender<Message>,
) {
    let mut buffer = vec![0; 16384];
    loop {
        buffer[0] = 0u8;
        let mut tail = &mut buffer[1..];
        let n = pty_shell_reader
            .read_buf(&mut tail)
            .await
            .expect("Unable to read PTY buffer");
        if n == 0 {
            break;
        }
        let bytes = Bytes::copy_from_slice(&buffer[..n + 1]);
        if let Err(e) = ws_sender.send(Message::Binary(bytes)) {
            error!("Unable to send PTY byte stream to client: {e}");
        }
    }
}

pub async fn handle_websocket_incoming(
    mut incoming: SplitStream<WebSocket>,
    mut pty_shell_writer: PtyMaster,
    websocket_sender: UnboundedSender<Message>,
) {
    while let Some(msg_result) = incoming.next().await {
        match msg_result {
            Ok(msg) => match msg {
                // User input.
                Message::Text(text) => {
                    let is_nav_key = matches!(
                        text.as_bytes(),
                        // Arrow keys
                        [0x1b, b'[', b'A' | b'B' | b'C' | b'D']
                        // Home / End (CSI H / F)
                        | [0x1b, b'[', b'H']
                        | [0x1b, b'[', b'F']
                    );
                    // Keep track of real key strokes.
                    if is_nav_key || (!text.starts_with("\x1b[") && !text.starts_with("\x1bP")) {
                        let message = EditorServiceMessage::Key(text.to_string());
                        if let Err(e) = websocket_sender.send(Message::Text(
                            serde_json::to_string(&message).unwrap().into(),
                        )) {
                            error!("Unable to send key: {e}");
                        }
                    // Allow asking the terminal who it is.
                    } else if text.starts_with("\x1b[?1;2c") {
                    } else {
                        continue;
                    }

                    if let Err(e) = pty_shell_writer.write_all(text.as_bytes()).await {
                        error!("Failed to write to PTY shell: {e}");
                    }
                }

                // Resize command.
                Message::Binary(vec) => match serde_json::from_slice::<WindowSize>(&vec) {
                    Ok(resize_msg) => {
                        if let Err(e) = pty_shell_writer.resize(resize_msg.cols, resize_msg.rows) {
                            error!("Failed to resize PTY: {e}");
                        }
                    }
                    Err(e) => {
                        error!("Failed to parse resize message: {e}");
                    }
                },

                // Ping and Pong messages.
                Message::Ping(vec) => {
                    if let Err(e) = websocket_sender.send(Message::Pong(vec)) {
                        error!("Failed to send Pong message: {e}");
                    }
                }
                Message::Pong(vec) => {
                    if let Err(e) = websocket_sender.send(Message::Ping(vec)) {
                        error!("Failed to send Ping message: {e}");
                    }
                }

                // Close message.
                Message::Close(_) => {
                    break;
                }
            },
            Err(e) => {
                error!("Error reading message from WebSocket: {e}");
            }
        }
    }
}

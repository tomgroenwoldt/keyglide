use std::{fs::File, io::Write, time::Duration};

use anyhow::{anyhow, Error};
use axum::{
    extract::{ws::WebSocket, Query, WebSocketUpgrade},
    response::IntoResponse,
};
use base64::{engine::general_purpose, Engine};
use futures::StreamExt;
use log::error;
use serde::Deserialize;
use tempfile::TempDir;
use tokio::{io::AsyncWriteExt, process::Command, sync::mpsc::unbounded_channel, time::sleep};

use crate::{
    pty::PtyCommand,
    terminal::{handle_pty_incoming, handle_websocket_incoming, write_to_websocket},
};

#[derive(Deserialize, Debug)]
pub struct Params {
    pub goal: String,
    pub extension: String,
}

pub async fn viewer(Query(params): Query<Params>, ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(async move |socket| {
        if let Err(e) = handle_ws(socket, params).await {
            error!("Error handling editor websocket: {e}");
        }
    })
}

pub async fn handle_ws(ws: WebSocket, params: Params) -> Result<(), Error> {
    let goal_bytes = general_purpose::URL_SAFE.decode(params.goal)?;
    let goal = serde_json::from_slice::<String>(&goal_bytes)?;

    let (ws_outgoing, ws_incoming) = ws.split();
    let (sender, receiver) = unbounded_channel();
    let ws_sender = sender.clone();

    let tmp_dir = TempDir::new().expect("Unable to create temporary directory");
    let file_path = tmp_dir.path().join(format!("goal.{}", params.extension));
    let mut tmp_file = File::create(file_path.clone()).expect("Unable to create file in tempdir");

    tmp_file
        .write_all(goal.as_bytes())
        .expect("Unable to write into file");
    let file_path_str = file_path
        .to_str()
        .expect("Unable to convert file path to string");

    // Start bubblewrapped helix for the user.
    let mut cmd = Command::new("bwrap");
    cmd.args([
        "--ro-bind",
        "/usr/bin/helix",
        "/usr/bin/helix",
        "--ro-bind",
        "/lib/x86_64-linux-gnu",
        "/lib/x86_64-linux-gnu",
        "--ro-bind",
        "/lib64",
        "/lib64",
        "--proc",
        "/proc",
        "--die-with-parent",
        "--clearenv",
        "--tmpfs",
        "/home",
        "--setenv",
        "HOME",
        "/home/user",
        "--setenv",
        "TERM",
        "xterm",
        "--ro-bind",
        "/root/.config/helix",
        "/home/user/.config/helix",
        "--ro-bind",
        file_path_str,
        &format!("/home/user/goal.{}", params.extension),
        "/usr/bin/helix",
        &format!("goal.{}", params.extension),
    ]);

    let mut pty_cmd = PtyCommand::from(cmd);
    let pty_master = match pty_cmd.run().await {
        Ok(pty_master) => pty_master,
        Err(e) => {
            return Err(anyhow!("Unable to run command in PTY: {e}"));
        }
    };
    let mut pty_shell_writer = pty_master.clone();
    let pty_shell_reader = pty_master.clone();

    tokio::select! {
        res = handle_websocket_incoming(ws_incoming, pty_shell_writer.clone(), sender) => res,
        res = handle_pty_incoming(pty_shell_reader, ws_sender.clone()) => res,
        res = write_to_websocket(ws_outgoing, receiver) => res,
    };

    tokio::spawn(async move {
        let quit_sequence = b"\x1b:q!\r";
        for &byte in quit_sequence.iter() {
            if let Err(e) = pty_shell_writer.write_all(&[byte]).await {
                error!("Failed to write byte {byte} to PTY shell: {e}");
                break;
            }
            sleep(Duration::from_millis(500)).await;
        }
    });

    Ok(())
}

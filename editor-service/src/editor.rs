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
    watcher::watch_progress,
};

#[derive(Deserialize, Debug)]
pub struct Params {
    pub start: String,
    pub goal: String,
    pub extension: String,
    pub line_number: Option<String>,
}

fn generate_config(line_number: &Option<String>) -> String {
    let line_number_setting = match line_number.as_deref() {
        Some("relative") => "\nline-number = \"relative\"",
        _ => "",
    };

    format!(
        r#"theme = "custom"

[editor]
true-color = true
insert-final-newline = false{line_number_setting}

[editor.whitespace]
render = "all"

[editor.whitespace.characters]
space = "·"
nbsp = "⍽"
nnbsp = "␣"
tab = "→"
newline = "⏎"
tabpad = "·"

[editor.auto-save.after-delay]
enable = true
timeout = 250
"#
    )
}

pub async fn editor(Query(params): Query<Params>, ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(async move |socket| {
        if let Err(e) = handle_editor_ws(socket, params).await {
            error!("Error handling editor websocket: {e}");
        }
    })
}

pub async fn handle_editor_ws(ws: WebSocket, params: Params) -> Result<(), Error> {
    let start_bytes = general_purpose::URL_SAFE.decode(params.start)?;
    let start = serde_json::from_slice::<String>(&start_bytes)?;
    let goal_bytes = general_purpose::URL_SAFE.decode(params.goal)?;
    let goal = serde_json::from_slice::<String>(&goal_bytes)?;

    let (ws_outgoing, ws_incoming) = ws.split();
    let (sender, receiver) = unbounded_channel();
    let ws_sender = sender.clone();

    let tmp_dir = TempDir::new()?;
    let file_path = tmp_dir.path().join(format!("start.{}", params.extension));
    let mut tmp_file = File::create(file_path.clone())?;

    tmp_file.write_all(start.as_bytes())?;
    let file_path_str = file_path
        .to_str()
        .expect("Unable to convert file path to string");

    // Generate per-session helix config
    let config_path = tmp_dir.path().join("config.toml");
    let mut config_file = File::create(config_path.clone())?;
    config_file.write_all(generate_config(&params.line_number).as_bytes())?;
    let config_path_str = config_path
        .to_str()
        .expect("Unable to convert config path to string");

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
        config_path_str,
        "/home/user/.config/helix/config.toml",
        "--ro-bind",
        "/root/.config/helix/themes",
        "/home/user/.config/helix/themes",
        "--ro-bind",
        "/root/.config/helix/runtime",
        "/home/user/.config/helix/runtime",
        "--bind",
        file_path_str,
        &format!("/home/user/start.{}", params.extension),
        "/usr/bin/helix",
        &format!("start.{}", params.extension),
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
        res = watch_progress(tmp_dir.path(), file_path, goal, ws_sender) => res,
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

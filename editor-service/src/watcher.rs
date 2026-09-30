use std::{
    fs,
    path::{Path, PathBuf},
};

use axum::extract::ws::Message;
use common::EditorServiceMessage;
use log::{error, warn};
use notify::{
    event::AccessKind, Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use strsim::normalized_levenshtein;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

fn async_watcher() -> (RecommendedWatcher, UnboundedReceiver<notify::Result<Event>>) {
    let (tx, rx) = unbounded_channel();
    let watcher = RecommendedWatcher::new(
        move |res| {
            futures::executor::block_on(async {
                if let Err(e) = tx.send(res) {
                    error!("Unable to send via async watcher channel: {e}");
                }
            })
        },
        Config::default(),
    )
    .expect("Unable to build watcher");

    (watcher, rx)
}

pub async fn watch_progress<P: AsRef<Path>>(
    temp_dir: P,
    file_path: PathBuf,
    goal: String,
    ws_sender: UnboundedSender<Message>,
) {
    let (mut watcher, mut rx) = async_watcher();

    // We have to watch recursively inside a folder because of
    // the way editors handle file writes.
    // See https://docs.rs/notify/latest/notify/#editor-behaviour.
    watcher
        .watch(temp_dir.as_ref(), RecursiveMode::Recursive)
        .expect("Unable to start watching");

    while let Some(res) = rx.recv().await {
        match res {
            Ok(event) if event.paths.contains(&file_path) => {
                if let EventKind::Access(AccessKind::Close(_)) = event.kind {
                    close_when_finished(&file_path, &ws_sender, &goal);
                }
            }
            Ok(event) => {
                warn!("Received event of other file: {:?}", event);
            }
            Err(e) => error!("Unable to watch: {e}"),
        }
    }
}

fn close_when_finished(file_path: &PathBuf, ws_sender: &UnboundedSender<Message>, goal: &str) {
    let progress_string = match fs::read_to_string(file_path) {
        Ok(progress) => progress,
        Err(e) => {
            error!("Error reading player start file: {e}");
            return;
        }
    };
    let score = normalized_levenshtein(&progress_string, goal);

    let message = EditorServiceMessage::Progress(score);
    if let Err(e) = ws_sender.send(Message::Text(
        serde_json::to_string(&message).unwrap().into(),
    )) {
        error!("Unable to send progress: {e}");
    }
}

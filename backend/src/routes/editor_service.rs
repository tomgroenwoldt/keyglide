use anyhow::{anyhow, Error};
use axum::{
    extract::{Query, State},
    response::IntoResponse,
    routing::get,
    Router,
};
use axum_tungstenite::{Message, WebSocket, WebSocketUpgrade};
use base64::{engine::general_purpose, Engine};
use chrono::{DateTime, NaiveDate, Utc};
use futures::{
    stream::{FuturesUnordered, SplitSink, SplitStream},
    SinkExt, StreamExt,
};
use log::{error, warn};
use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;
use tokio::sync::oneshot;
use tokio_tungstenite::{
    tungstenite::{client::IntoClientRequest, protocol::CloseFrame, Utf8Bytes},
    MaybeTlsStream, WebSocketStream,
};

use crate::{
    schema::{
        scores::ScoreCreate,
        solutions::{Solution, SolutionCreate},
    },
    state::AppState,
    storage::{challenges, scores, solutions, user_settings},
};
use common::EditorServiceMessage;

#[derive(Clone, Serialize, Debug)]
pub struct Info {
    pub keystroke_count: usize,
}

#[derive(Deserialize, Debug)]
pub struct WsParams {
    pub token: Option<String>,
    pub challenge_id: i64,
}

/// Snapshot of the play target needed to drive the editor websocket.
#[derive(Debug)]
struct PlayTarget {
    challenge_id: i64,
    start: String,
    goal: String,
    extension: String,
    /// Future-availability gate. `None` for a queued challenge, which has no
    /// date yet and is playable as a preview.
    available_on: Option<NaiveDate>,
}

pub(super) fn router(state: AppState) -> Router {
    Router::new()
        .route("/editor_service/edit", get(editor_service_edit))
        .route("/editor_service/view", get(editor_service_view))
        .with_state(state)
}

pub async fn editor_service_edit(
    Query(params): Query<WsParams>,
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(async move |ws| {
        if let Err(e) = handle_editor_service_ws(ws, params, state, "edit").await {
            error!("Error handling editor websocket: {e}");
        }
    })
}

pub async fn editor_service_view(
    Query(params): Query<WsParams>,
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(async move |ws| {
        if let Err(e) = handle_editor_service_ws(ws, params, state, "view").await {
            error!("Error handling viewer websocket: {e}");
        }
    })
}

/// Resolve `WsParams` into a `PlayTarget`, returning `Ok(None)` when the
/// requested target does not exist.
async fn resolve_play_target(
    state: &AppState,
    params: &WsParams,
) -> Result<Option<PlayTarget>, Error> {
    let Some(challenge) = challenges::by_id(&state.postgrest, params.challenge_id).await? else {
        return Ok(None);
    };
    Ok(Some(PlayTarget {
        challenge_id: challenge.id,
        start: challenge.start,
        goal: challenge.goal,
        extension: challenge.extension,
        available_on: challenge.date,
    }))
}

/// Shared function to set up a websocket connection to the editor-service.
async fn handle_editor_service_ws(
    client_ws: WebSocket,
    params: WsParams,
    state: AppState,
    mode: &str,
) -> Result<(), Error> {
    let (mut client_tx, client_rx) = client_ws.split();
    let target = match resolve_play_target(&state, &params).await? {
        Some(target) => target,
        None => {
            let frame = CloseFrame {
                code: 3002.into(),
                reason: "No challenge found.".into(),
            };
            client_tx.send(Message::Close(Some(frame))).await?;
            warn!("No challenge found for id={}", params.challenge_id);
            return Ok(());
        }
    };

    // Prevent future challenges from being accessed (daily only).
    if let Some(available_on) = target.available_on {
        let now = Utc::now();
        if available_on > now.date_naive() {
            let reason = format!(
                "This challenge is not available yet. It's available at 00:00 {} UTC.",
                available_on
            );
            let frame = CloseFrame {
                code: 3003.into(),
                reason: reason.into(),
            };
            client_tx.send(Message::Close(Some(frame))).await?;
            warn!("Challenge {} not yet available", available_on);
            return Ok(());
        }
    }

    let encoded_start = general_purpose::URL_SAFE.encode(serde_json::to_string(&target.start)?);
    let encoded_goal = general_purpose::URL_SAFE.encode(serde_json::to_string(&target.goal)?);
    let extension = &target.extension;

    // Fetch user settings if authenticated
    let mut extra_params = String::new();
    if let Some(token) = &params.token {
        if let Ok(Some(settings)) = user_settings::select_by_token(&state, token).await {
            if settings.line_number != "absolute" {
                extra_params.push_str(&format!("&line_number={}", settings.line_number));
            }
        }
    }

    let request = format!(
        "ws://{}/{mode}?start={encoded_start}&goal={encoded_goal}&extension={extension}{extra_params}",
        state.config.editor_service_addr,
    )
    .into_client_request()?;

    // Connect to upstream editor-service
    let upstream_ws = match tokio_tungstenite::connect_async(request).await {
        Ok((ws_stream, _)) => ws_stream,
        Err(e) => {
            return Err(anyhow!(
                "Unable to connect to editor-service websocket: {e}"
            ));
        }
    };
    let (upstream_tx, upstream_rx) = upstream_ws.split();

    let (submit_tx, submit_rx) = oneshot::channel::<()>();

    let mut futures = FuturesUnordered::new();
    futures.push(tokio::spawn(client_to_server(
        client_rx,
        upstream_tx,
        submit_tx,
    )));
    futures.push(tokio::spawn(server_to_client(
        upstream_rx,
        client_tx,
        state,
        target.challenge_id,
        params.token,
        submit_rx,
    )));

    // Wait for the first future to finish and abort all others
    futures.next().await.unwrap().unwrap();
    for fut in futures.iter() {
        fut.abort();
    }

    Ok(())
}

pub async fn client_to_server(
    mut client_rx: SplitStream<WebSocket>,
    mut upstream_tx: SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>,
    submit_tx: oneshot::Sender<()>,
) {
    let mut submit_tx = Some(submit_tx);
    while let Some(Ok(msg)) = client_rx.next().await {
        let msg = match msg {
            Message::Text(text) => {
                // Do not forward mouse events.
                if text.starts_with("\x1b[M") || text.starts_with("\x1b[<") {
                    continue;
                }
                // Intercept Submit messages from the frontend.
                if let Ok(EditorServiceMessage::Submit) =
                    serde_json::from_str::<EditorServiceMessage>(&text)
                {
                    if let Some(tx) = submit_tx.take() {
                        let _ = tx.send(());
                    }
                    continue;
                }
                Message::text(text)
            }
            msg => msg,
        };
        if upstream_tx.send(msg).await.is_err() {
            break;
        }
    }
}

pub async fn server_to_client(
    mut upstream_rx: SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>,
    mut client_tx: SplitSink<WebSocket, Message>,
    state: AppState,
    challenge_id: i64,
    token: Option<String>,
    submit_rx: oneshot::Receiver<()>,
) {
    let mut keys = Vec::new();
    let mut start_time = Utc::now();
    let mut current_progress = 0.0_f64;
    let mut submit_rx = Some(submit_rx);

    loop {
        // If we have a pending submit receiver, select between upstream messages and submit signal.
        // Otherwise just process upstream messages.
        let msg = if let Some(ref mut rx) = submit_rx {
            tokio::select! {
                msg = upstream_rx.next() => msg,
                Ok(()) = rx => {
                    if current_progress == 1.0 {
                        let close_message = handle_finish(
                            &mut keys, &state, challenge_id, &token, &mut start_time,
                        ).await;
                        let _ = client_tx.send(close_message).await;
                    } else {
                        warn!("Submit received but current_progress is {current_progress}, expected 1.0");
                    }
                    break;
                }
            }
        } else {
            upstream_rx.next().await
        };

        let Some(Ok(msg)) = msg else { break };

        let processed_msg = match msg {
            Message::Text(ref text) => {
                handle_text_message(text, &mut keys, &mut start_time, &mut current_progress)
            }
            msg => msg,
        };

        if client_tx.send(processed_msg).await.is_err() {
            break;
        }
    }
}

/// Handle incoming text messages (keystrokes, etc.)
pub fn handle_text_message(
    text: &str,
    keys: &mut Vec<String>,
    start_time: &mut DateTime<Utc>,
    current_progress: &mut f64,
) -> Message {
    let message = serde_json::from_slice::<EditorServiceMessage>(text.as_bytes()).unwrap();

    match message {
        EditorServiceMessage::Key(key) => {
            if keys.is_empty() {
                *start_time = Utc::now();
            }

            keys.push(key);

            let count = Info {
                keystroke_count: keys.len(),
            };

            Message::Text(Utf8Bytes::from(serde_json::to_string(&count).unwrap()))
        }
        EditorServiceMessage::Progress(progress) => {
            *current_progress = progress;
            Message::Text(text.into())
        }
        EditorServiceMessage::Submit => {
            // Submit from editor-service is unexpected; ignore.
            Message::Text(text.into())
        }
    }
}

/// Handle close messages (challenge completion, scoring, etc.)
async fn handle_finish(
    keys: &mut Vec<String>,
    state: &AppState,
    challenge_id: i64,
    token: &Option<String>,
    start_time: &mut DateTime<Utc>,
) -> Message {
    let mut frame = CloseFrame {
        code: 3000.into(),
        reason: Utf8Bytes::default(),
    };

    let existing_solution = solutions::select_by_keys(state, challenge_id, keys)
        .await
        .unwrap();

    match token {
        Some(token) => {
            frame.reason = process_authenticated_user(
                state,
                challenge_id,
                keys.clone(),
                existing_solution,
                token,
                start_time,
            )
            .await
            .into();
        }
        None => {
            frame.reason = process_guest_user(existing_solution, keys).into();
        }
    }

    Message::Close(Some(frame))
}

/// Handle solution + scoring for authenticated users
async fn process_authenticated_user(
    state: &AppState,
    challenge_id: i64,
    keys: Vec<String>,
    existing_solution: Option<Solution>,
    token: &str,
    start_time: &mut DateTime<Utc>,
) -> String {
    let solution_id = match existing_solution {
        Some(solution) => solution.id,
        None => {
            // Create a new solution
            let solution_create = SolutionCreate {
                challenge_id,
                keys: keys.clone(),
            };
            match solutions::insert(state, token, solution_create).await {
                Ok(id) => id,
                Err(e) => {
                    error!("Could not record solution: {e}");
                    return "Your solution could not be recorded.".to_string();
                }
            }
        }
    };
    handle_scores(state, token, solution_id, start_time).await
}

/// Factor scoring logic into its own function
async fn handle_scores(
    state: &AppState,
    token: &str,
    solution_id: i64,
    start_time: &mut DateTime<Utc>,
) -> String {
    if let Some(score) = scores::select_by_user_and_solution(state, token, solution_id)
        .await
        .unwrap()
    {
        if Utc::now() - *start_time < score.stop_time - score.start_time {
            scores::delete_by_id(state, token, score.id).await.unwrap();
            let score = ScoreCreate {
                solution_id,
                start_time: *start_time,
                stop_time: Utc::now(),
            };
            scores::insert(state, token, score).await.unwrap();
            "Faster this time! Your old score for this solution has been updated.".to_string()
        } else {
            "That was slower! Your previous score remains.".to_string()
        }
    } else {
        let score = ScoreCreate {
            solution_id,
            start_time: *start_time,
            stop_time: Utc::now(),
        };
        scores::insert(state, token, score).await.unwrap();
        "Your score has been recorded!".to_string()
    }
}

/// Handle guest user challenge completion
fn process_guest_user(existing_solution: Option<Solution>, keys: &[String]) -> String {
    match existing_solution {
        None => "You were the first to complete the challenge with this solution! Sign in to share it on the solution board.".to_string(),
        Some(_) => format!("You completed the challenge with {} keystrokes!", keys.len()),
    }
}

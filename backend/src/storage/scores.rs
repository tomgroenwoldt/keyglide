use anyhow::Error;
use log::error;

use crate::{
    schema::{
        claims::verify_token,
        scores::{Score, ScoreCreate},
    },
    state::AppState,
};

/// # Insert a score for a user.
pub async fn insert(state: &AppState, token: &str, score: ScoreCreate) -> Result<(), Error> {
    let response = state
        .postgrest
        .clone()
        .insert_header("Authorization", token)
        .from("scores")
        .auth(token)
        .insert(serde_json::to_string(&score).unwrap())
        .execute()
        .await
        .unwrap();
    if response.status() != 201 {
        error!("Error inserting score: {response:?}");
    }
    Ok(())
}

/// # Fetches a score by user and solution.
///
/// There should only be at most one score per user per solution.
pub async fn select_by_user_and_solution(
    state: &AppState,
    token: &str,
    solution_id: i64,
) -> Result<Option<Score>, Error> {
    let user_id = verify_token(state, token)?;
    let response = state
        .postgrest
        .clone()
        .insert_header("Authorization", token)
        .from("scores")
        .auth(token)
        .select("id, solution_id, start_time, stop_time")
        .eq("user_id", user_id)
        .eq("solution_id", solution_id.to_string())
        .execute()
        .await?;
    if response.status() != 200 {
        error!("Error selecting score: {response:?}");
    }
    let scores: Vec<Score> = serde_json::from_str(&response.text().await?)?;
    Ok(scores.into_iter().next())
}

/// # Deletes a score by user and date.
pub async fn delete_by_id(state: &AppState, token: &str, id: i64) -> Result<(), Error> {
    state
        .postgrest
        .clone()
        .insert_header("Authorization", token)
        .from("scores")
        .auth(token)
        .delete()
        .eq("id", id.to_string())
        .execute()
        .await?
        .text()
        .await?;
    Ok(())
}

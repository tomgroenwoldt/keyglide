use anyhow::{anyhow, Error};
use log::error;
use postgrest::Postgrest;
use serde::Deserialize;

use common::Challenge;

use crate::{schema::challenge::ChallengeInsert, state::AppState};

/// # Fetches a challenge by id.
pub async fn by_id(postgrest: &Postgrest, id: i64) -> Result<Option<Challenge>, Error> {
    let response = postgrest
        .from("challenges")
        .select("*")
        .eq("id", id.to_string())
        .execute()
        .await?
        .text()
        .await?;
    let challenges: Vec<Challenge> = serde_json::from_str(&response)?;
    Ok(challenges.into_iter().next())
}

#[derive(Deserialize)]
struct InsertedRow {
    id: i64,
}

/// Insert a submitted challenge using the user's JWT, so RLS enforces both
/// `auth.uid() = author_id` and `date IS NULL` — a submission joins the queue
/// and cannot claim a day for itself.
pub async fn insert(
    state: &AppState,
    jwt: &str,
    payload: ChallengeInsert<'_>,
) -> Result<i64, Error> {
    let body = serde_json::to_string(&payload)?;

    let response = state
        .postgrest
        .clone()
        .from("challenges")
        .auth(jwt)
        .insert(body)
        .single()
        .execute()
        .await?;

    let status = response.status();
    let text = response.text().await?;

    if !status.is_success() {
        error!("Error inserting submitted challenge ({status}): {text}");
        return Err(anyhow!("postgrest insert failed: {status}"));
    }

    let row: InsertedRow = serde_json::from_str(&text)
        .map_err(|e| anyhow!("could not parse insert response: {e} body={text}"))?;
    Ok(row.id)
}

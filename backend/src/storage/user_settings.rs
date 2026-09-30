use anyhow::Error;
use log::warn;

use crate::{
    schema::{claims::verify_token, user_settings::UserSettings},
    state::AppState,
};

/// Fetches user settings for the authenticated user.
/// Returns None if no settings row exists (user uses defaults).
pub async fn select_by_token(state: &AppState, token: &str) -> Result<Option<UserSettings>, Error> {
    let user_id = verify_token(state, token)?;

    let response = state
        .postgrest
        .clone()
        .insert_header("Authorization", token)
        .from("user_settings")
        .auth(token)
        .select("user_id, line_number")
        .eq("user_id", user_id)
        .execute()
        .await?;

    if response.status() != 200 {
        warn!("Error fetching user settings: {response:?}");
        return Ok(None);
    }

    let settings: Vec<UserSettings> = serde_json::from_str(&response.text().await?)?;
    Ok(settings.into_iter().next())
}

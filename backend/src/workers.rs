use std::time::Duration;

use chrono::{NaiveTime, TimeZone, Utc};
use log::{error, info};
use serde_json::json;
use tokio::time::sleep;

use crate::state::AppState;

// The daily background worker
pub async fn daily_worker(state: AppState) {
    loop {
        let now = Utc::now();
        let tomorrow = now.date_naive().succ_opt().expect("date overflow");
        let next_one_am =
            Utc.from_utc_datetime(&tomorrow.and_time(NaiveTime::from_hms_opt(1, 0, 0).unwrap()));

        let sleep_duration = (next_one_am - now)
            .to_std()
            .unwrap_or(Duration::from_secs(60));
        sleep(sleep_duration).await;

        if let Err(e) = reset_streaks(&state).await {
            error!("Error running streak reset worker: {e}");
        }

        if let Err(e) = promote_challenge(&state).await {
            error!("Error running challenge promotion: {e}");
        }
    }
}

async fn promote_challenge(state: &AppState) -> anyhow::Result<()> {
    let today = Utc::now().date_naive();
    let body = json!({ "target_date": today.to_string() }).to_string();

    let response = state
        .postgrest
        .clone()
        .insert_header("apikey", &state.config.secret_key)
        .rpc("promote_challenge_for_date", body)
        .auth(&state.config.secret_key)
        .execute()
        .await?;

    let status = response.status();
    let text = response.text().await?;

    if !status.is_success() {
        return Err(anyhow::anyhow!(
            "promote_challenge_for_date failed ({status}): {text}"
        ));
    }

    let trimmed = text.trim();
    if trimmed == "null" || trimmed.is_empty() {
        info!("Challenge queue empty (or {today} already filled), skipping promotion.");
    } else {
        info!("Gave queued challenge id={trimmed} the date {today}.");
    }
    Ok(())
}

async fn reset_streaks(state: &AppState) -> anyhow::Result<()> {
    let yesterday = Utc::now().date_naive().pred_opt().expect("date underflow");

    let body = json!({ "target_date": yesterday.to_string() }).to_string();

    let response = state
        .postgrest
        .clone()
        .insert_header("apikey", &state.config.secret_key)
        .rpc("reset_streaks_for_missed_day", body)
        .auth(&state.config.secret_key)
        .execute()
        .await?;

    let status = response.status();
    let text = response.text().await?;

    if !status.is_success() {
        return Err(anyhow::anyhow!(
            "reset_streaks_for_missed_day failed ({status}): {text}"
        ));
    }

    info!(
        "Streak reset for {yesterday}: {} profile(s) updated.",
        text.trim()
    );
    Ok(())
}

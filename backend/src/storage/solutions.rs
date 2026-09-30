use anyhow::{anyhow, Error};
use log::error;

use crate::{
    schema::solutions::{Solution, SolutionCreate},
    state::AppState,
};

/// # Insert a solution for a user, returning its id.
///
/// Runs under the user's JWT so RLS enforces `user_id = auth.uid()`. The
/// returned representation is narrowed to `id` on purpose: an insert echoes
/// the new row back, and `keys` is not selectable by `authenticated`, so
/// asking for the whole row is rejected with 42501.
pub async fn insert(state: &AppState, token: &str, solution: SolutionCreate) -> Result<i64, Error> {
    let response = state
        .postgrest
        .clone()
        .from("solutions")
        .auth(token)
        .insert(serde_json::to_string(&solution)?)
        .select("id")
        .execute()
        .await?;

    let status = response.status();
    let text = response.text().await?;
    if status != 201 {
        error!("Error inserting solution ({status}): {text}");
        return Err(anyhow!("postgrest insert failed: {status}"));
    }

    let rows: Vec<InsertedRow> = serde_json::from_str(&text)?;
    rows.into_iter()
        .next()
        .map(|r| r.id)
        .ok_or_else(|| anyhow!("insert returned no row"))
}

#[derive(serde::Deserialize)]
struct InsertedRow {
    id: i64,
}

/// # Fetches a solution by keys if it exists.
///
/// There should only be at most one solution per key combination per target.
/// Returns `None` if the key combination does not exist yet.
pub async fn select_by_keys(
    state: &AppState,
    challenge_id: i64,
    keys: &Vec<String>,
) -> Result<Option<Solution>, Error> {
    // Authenticates as the service role on purpose: `keys` is not readable by
    // `anon` or `authenticated` any more, and this lookup needs to compare
    // against every existing key sequence to keep solutions deduplicated.
    //
    // The `apikey` header is what selects the role for Supabase's secret key
    // format. Setting only the bearer token leaves the request on `anon`,
    // because a `sb_secret_...` key is not a JWT PostgREST can read.
    let query = state
        .postgrest
        .clone()
        .insert_header("apikey", &state.config.secret_key)
        .from("solutions")
        .auth(&state.config.secret_key)
        .select("id, challenge_id, keys")
        .eq("challenge_id", challenge_id.to_string());
    let response = query.execute().await?;
    let status = response.status();
    let text = response.text().await?;
    if status != 200 {
        // Returning here rather than falling through: the body is an error
        // object, and parsing it as a solution list produced a confusing
        // "expected a sequence" panic further up the call stack.
        error!("Error selecting solution ({status}): {text}");
        return Err(anyhow!("postgrest select failed: {status}"));
    }
    let solutions: Vec<Solution> = serde_json::from_str(&text)?;

    // Unfortunately, I have to check for keys equality in rust. I'd like to do
    // this directly in the database but it's hard to compare these values.
    let solution = solutions
        .into_iter()
        .find(|solution| solution.keys.eq(keys));
    Ok(solution)
}

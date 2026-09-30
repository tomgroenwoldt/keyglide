use anyhow::Error;
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
}

/// # Verifies a Supabase access token and returns the user ID.
///
/// This is the single place where token validation happens. Every caller that
/// needs an authenticated user ID must go through here so that the algorithm
/// and the expected audience stay consistent.
pub fn verify_token(state: &AppState, token: &str) -> Result<String, Error> {
    let mut validation = Validation::new(Algorithm::ES256);
    validation.set_audience(["authenticated"].as_ref());
    let decoding_key = DecodingKey::from_ec_components(
        &state.config.jwt_public_key_x,
        &state.config.jwt_public_key_y,
    )?;
    let verified_token = decode::<Claims>(token, &decoding_key, &validation)?;

    Ok(verified_token.claims.sub)
}

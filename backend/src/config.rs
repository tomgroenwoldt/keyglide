#[derive(clap::Parser, Debug, Clone)]
pub(crate) struct Config {
    /// Supabase related secrets.
    #[clap(long, env)]
    pub supabase_url: String,
    #[clap(long, env)]
    pub publishable_key: String,
    #[clap(long, env)]
    pub secret_key: String,

    /// The `x` and `y` components of the project's ES256 JWT signing key, taken
    /// from the Supabase JWKS endpoint. These are the *public* half of the key
    /// pair and are only used to verify incoming access tokens, so they are not
    /// secret.
    #[clap(long, env)]
    pub jwt_public_key_x: String,
    #[clap(long, env)]
    pub jwt_public_key_y: String,

    /// The address of the editor service.
    #[clap(long, env)]
    pub editor_service_addr: String,
}

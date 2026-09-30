use postgrest::Postgrest;

use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub postgrest: Postgrest,
}

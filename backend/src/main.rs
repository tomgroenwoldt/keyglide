// Keyglide — a daily keybinding puzzle for Helix.
// Copyright (C) 2026 Tom Groenwoldt
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by the
// Free Software Foundation, either version 3 of the License, or (at your
// option) any later version.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
// FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
// for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

use std::net::SocketAddr;

use clap::Parser;

use config::Config;
use postgrest::Postgrest;
use routes::router;
use state::AppState;

use crate::workers::daily_worker;

mod config;
mod routes;
mod schema;
mod state;
mod storage;
mod workers;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv::dotenv().ok();
    env_logger::init();

    let config = Config::parse();

    // Initialize app state.
    let url = format!("{}/rest/v1/", config.supabase_url);
    let postgrest = Postgrest::new(&url).insert_header("apiKey", &config.publishable_key);

    let state = AppState { config, postgrest };

    // Start streak reset background worker.
    let state_clone = state.clone();
    tokio::spawn(async move {
        daily_worker(state_clone).await;
    });

    serve(state).await?;
    Ok(())
}

pub(crate) async fn serve(state: AppState) -> anyhow::Result<()> {
    // Setup API routes.
    let app = router(state);

    // Startup backend.
    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

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

use editor_service::app;
use env_logger::Env;
use tokio::net::TcpListener;

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();
    env_logger::Builder::from_env(Env::default().default_filter_or("info")).init();

    // `[::]` rather than `0.0.0.0`: Fly's private network is IPv6-only, so a
    // service bound to IPv4 alone is unreachable at <app>.internal and the
    // backend gets ECONNREFUSED. Linux dual-stack sockets accept IPv4 on this
    // address too, so local Docker port mapping keeps working.
    let listener = TcpListener::bind("[::]:3001")
        .await
        .expect("Unable to bind TcpListener");
    axum::serve(listener, app())
        .await
        .expect("Error serving the application");
}

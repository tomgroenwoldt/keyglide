use axum::{routing::get, Router};

pub mod editor;
pub mod pty;
pub mod terminal;
pub mod viewer;
pub mod watcher;

pub fn app() -> Router {
    Router::new()
        .route("/edit", get(editor::editor))
        .route("/view", get(viewer::viewer))
}

use axum::{
    response::{Html, IntoResponse, Response},
    Router,
};
use http::{header, StatusCode, Uri};
use rust_embed::Embed;

use crate::state::AppState;

pub(crate) mod challenges;
pub(crate) mod editor_service;

#[derive(Embed)]
#[folder = "../frontend/dist/"]
struct Frontend;

pub(crate) fn router(state: AppState) -> Router {
    Router::new()
        .nest_service(
            "/api",
            editor_service::router(state.clone()).merge(challenges::router(state)),
        )
        .fallback(frontend_handler)
}

async fn frontend_handler(uri: Uri) -> impl IntoResponse {
    let path = uri.path().trim_start_matches('/');

    if path.is_empty() || path == "index.html" {
        return index_html().await;
    }

    match Frontend::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();

            ([(header::CONTENT_TYPE, mime.as_ref())], content.data).into_response()
        }
        None => {
            if path.contains('.') {
                return not_found().await;
            }

            index_html().await
        }
    }
}

async fn index_html() -> Response {
    match Frontend::get("index.html") {
        Some(content) => Html(content.data).into_response(),
        None => not_found().await,
    }
}

async fn not_found() -> Response {
    (StatusCode::NOT_FOUND, "404").into_response()
}

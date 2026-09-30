use axum::{
    extract::{Multipart, State},
    response::IntoResponse,
    Json,
};
use http::{header::AUTHORIZATION, HeaderMap, StatusCode};
use log::{error, warn};

use crate::{
    routes::challenges::{validate_file_content, FileValidationError},
    schema::{
        challenge::{
            ChallengeInsert, CreateChallengeResponse, ErrorCode, ErrorField, ValidationErrorBody,
            ALLOWED_EXTENSIONS, MAX_DESCRIPTION_CHARS, MAX_TITLE_CHARS,
        },
        claims::verify_token,
    },
    state::AppState,
    storage,
};

fn err_response(
    status: StatusCode,
    code: ErrorCode,
    message: &str,
    field: ErrorField,
) -> axum::response::Response {
    let body = ValidationErrorBody {
        error: code,
        message: message.to_string(),
        field,
    };
    (status, Json(body)).into_response()
}

fn extract_jwt(headers: &HeaderMap) -> Option<String> {
    headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string())
}

fn map_file_err(
    err: FileValidationError,
    field: ErrorField,
    label: &str,
) -> axum::response::Response {
    let (code, message, status) = match err {
        FileValidationError::FileTooLarge => (
            ErrorCode::FileTooLarge,
            format!("{label} file exceeds 1KB size limit"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        FileValidationError::InvalidEncoding => (
            ErrorCode::InvalidEncoding,
            format!("{label} file is not valid UTF-8"),
            StatusCode::BAD_REQUEST,
        ),
        FileValidationError::EmptyFile => (
            ErrorCode::EmptyFile,
            format!("{label} file is empty"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        FileValidationError::WhitespaceOnly => (
            ErrorCode::WhitespaceOnly,
            format!("{label} file contains only whitespace"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        FileValidationError::TooManyLines => (
            ErrorCode::TooManyLines,
            format!("{label} file exceeds 50 lines"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        FileValidationError::LineTooLong => (
            ErrorCode::LineTooLong,
            format!("{label} file has a line longer than 200 characters"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    };
    err_response(status, code, &message, field)
}

pub async fn create_challenge(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> impl IntoResponse {
    // 1. Extract and verify JWT
    let token = match extract_jwt(&headers) {
        Some(t) => t,
        None => {
            return err_response(
                StatusCode::UNAUTHORIZED,
                ErrorCode::Unauthorized,
                "Missing or malformed Authorization header",
                ErrorField::Auth,
            );
        }
    };

    let user_id = match verify_token(&state, &token) {
        Ok(user_id) => user_id,
        Err(e) => {
            warn!("JWT verification failed: {e}");
            return err_response(
                StatusCode::UNAUTHORIZED,
                ErrorCode::Unauthorized,
                "Invalid authentication token",
                ErrorField::Auth,
            );
        }
    };

    // 2. Pull multipart fields
    let mut start_bytes: Option<Vec<u8>> = None;
    let mut goal_bytes: Option<Vec<u8>> = None;
    let mut extension: Option<String> = None;
    let mut title: Option<String> = None;
    let mut description: Option<String> = None;

    loop {
        let field = match multipart.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => {
                warn!("Multipart parsing error: {e}");
                return err_response(
                    StatusCode::BAD_REQUEST,
                    ErrorCode::MissingField,
                    "Malformed multipart body",
                    ErrorField::StartFile,
                );
            }
        };
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "startFile" => match field.bytes().await {
                Ok(b) => start_bytes = Some(b.to_vec()),
                Err(_) => {
                    return err_response(
                        StatusCode::BAD_REQUEST,
                        ErrorCode::MissingField,
                        "Could not read startFile bytes",
                        ErrorField::StartFile,
                    );
                }
            },
            "goalFile" => match field.bytes().await {
                Ok(b) => goal_bytes = Some(b.to_vec()),
                Err(_) => {
                    return err_response(
                        StatusCode::BAD_REQUEST,
                        ErrorCode::MissingField,
                        "Could not read goalFile bytes",
                        ErrorField::GoalFile,
                    );
                }
            },
            "extension" => extension = field.text().await.ok(),
            "title" => title = field.text().await.ok(),
            "description" => description = field.text().await.ok(),
            _ => {}
        }
    }

    // 3. Validate required fields presence
    let start_bytes = match start_bytes {
        Some(b) => b,
        None => {
            return err_response(
                StatusCode::BAD_REQUEST,
                ErrorCode::MissingField,
                "Start file is required",
                ErrorField::StartFile,
            );
        }
    };
    let goal_bytes = match goal_bytes {
        Some(b) => b,
        None => {
            return err_response(
                StatusCode::BAD_REQUEST,
                ErrorCode::MissingField,
                "Goal file is required",
                ErrorField::GoalFile,
            );
        }
    };
    let extension = match extension.as_deref().map(str::trim) {
        Some(e) if !e.is_empty() => e.to_string(),
        _ => {
            return err_response(
                StatusCode::BAD_REQUEST,
                ErrorCode::MissingField,
                "Extension is required",
                ErrorField::Extension,
            );
        }
    };

    // 4. Validate extension whitelist
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return err_response(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidExtension,
            "Extension is not in the allowed list",
            ErrorField::Extension,
        );
    }

    // 5. Validate file contents
    let start_str = match validate_file_content(&start_bytes) {
        Ok(s) => s,
        Err(e) => return map_file_err(e, ErrorField::StartFile, "Start"),
    };
    let goal_str = match validate_file_content(&goal_bytes) {
        Ok(s) => s,
        Err(e) => return map_file_err(e, ErrorField::GoalFile, "Goal"),
    };

    // 6. Cross-file rule
    if start_str == goal_str {
        return err_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            ErrorCode::StartEqualsGoal,
            "Start and goal must be different",
            ErrorField::GoalFile,
        );
    }

    // 7. Validate optional metadata
    let title = title
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(t) = &title {
        if t.chars().count() > MAX_TITLE_CHARS {
            return err_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                ErrorCode::TitleTooLong,
                "Title exceeds 80 characters",
                ErrorField::Title,
            );
        }
    }
    let description = description
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(d) = &description {
        if d.chars().count() > MAX_DESCRIPTION_CHARS {
            return err_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                ErrorCode::DescriptionTooLong,
                "Description exceeds 500 characters",
                ErrorField::Description,
            );
        }
    }

    // 8. Insert via PostgREST
    let payload = ChallengeInsert {
        author_id: &user_id,
        start: &start_str,
        goal: &goal_str,
        extension: &extension,
        title: title.as_deref(),
        description: description.as_deref(),
    };

    match storage::challenges::insert(&state, &token, payload).await {
        Ok(id) => (StatusCode::CREATED, Json(CreateChallengeResponse { id })).into_response(),
        Err(e) => {
            error!("Failed to insert challenge: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save challenge",
            )
                .into_response()
        }
    }
}

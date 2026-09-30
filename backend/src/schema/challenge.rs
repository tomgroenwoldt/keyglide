use serde::{Deserialize, Serialize};

/// Validation rules — keep in sync with the migration's CHECK constraints
/// and the frontend client-side validator.
pub const MAX_FILE_BYTES: usize = 1024;
pub const MAX_LINES: usize = 50;
pub const MAX_LINE_CHARS: usize = 200;
pub const MAX_TITLE_CHARS: usize = 80;
pub const MAX_DESCRIPTION_CHARS: usize = 500;

/// Allowed `prog_extension` values, excluding `unknown`.
pub const ALLOWED_EXTENSIONS: &[&str] = &[
    "js", "ts", "py", "cpp", "java", "rb", "go", "rs", "php", "swift",
];

#[derive(Debug, Clone, Serialize)]
pub struct CreateChallengeResponse {
    pub id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChallengeInsert<'a> {
    pub author_id: &'a str,
    pub start: &'a str,
    pub goal: &'a str,
    pub extension: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<&'a str>,
}

/// Field that triggered the validation error, used by the frontend
/// to highlight the right input.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorField {
    StartFile,
    GoalFile,
    Extension,
    Title,
    Description,
    Auth,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub enum ErrorCode {
    MissingField,
    InvalidEncoding,
    InvalidExtension,
    FileTooLarge,
    TooManyLines,
    LineTooLong,
    EmptyFile,
    WhitespaceOnly,
    StartEqualsGoal,
    TitleTooLong,
    DescriptionTooLong,
    Unauthorized,
}

#[derive(Debug, Clone, Serialize)]
pub struct ValidationErrorBody {
    pub error: ErrorCode,
    pub message: String,
    pub field: ErrorField,
}

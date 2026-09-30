use axum::{routing::post, Router};

use crate::state::AppState;

pub mod create;

pub(super) fn router(state: AppState) -> Router {
    Router::new()
        .route("/challenges", post(create::create_challenge))
        .with_state(state)
}

/// Result of validating a single uploaded file's content.
/// Public for unit testing.
pub fn validate_file_content(bytes: &[u8]) -> Result<String, FileValidationError> {
    use crate::schema::challenge::{MAX_FILE_BYTES, MAX_LINES, MAX_LINE_CHARS};

    if bytes.len() > MAX_FILE_BYTES {
        return Err(FileValidationError::FileTooLarge);
    }

    let s = std::str::from_utf8(bytes).map_err(|_| FileValidationError::InvalidEncoding)?;

    let trimmed = s.trim();
    if trimmed.is_empty() {
        // Empty bytes vs whitespace-only: both rejected, but with different codes.
        return if s.is_empty() {
            Err(FileValidationError::EmptyFile)
        } else {
            Err(FileValidationError::WhitespaceOnly)
        };
    }

    let lines: Vec<&str> = s.lines().collect();
    if lines.len() > MAX_LINES {
        return Err(FileValidationError::TooManyLines);
    }
    for line in &lines {
        if line.chars().count() > MAX_LINE_CHARS {
            return Err(FileValidationError::LineTooLong);
        }
    }

    Ok(s.to_string())
}

#[derive(Debug, PartialEq, Eq)]
pub enum FileValidationError {
    FileTooLarge,
    InvalidEncoding,
    EmptyFile,
    WhitespaceOnly,
    TooManyLines,
    LineTooLong,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_files_over_1kb() {
        let big = vec![b'a'; 1025];
        assert_eq!(
            validate_file_content(&big),
            Err(FileValidationError::FileTooLarge)
        );
    }

    #[test]
    fn rejects_invalid_utf8() {
        let bytes = vec![0xff, 0xfe, 0xfd];
        assert_eq!(
            validate_file_content(&bytes),
            Err(FileValidationError::InvalidEncoding)
        );
    }

    #[test]
    fn rejects_empty_file() {
        assert_eq!(
            validate_file_content(b""),
            Err(FileValidationError::EmptyFile)
        );
    }

    #[test]
    fn rejects_whitespace_only() {
        assert_eq!(
            validate_file_content(b"   \n  \t\n"),
            Err(FileValidationError::WhitespaceOnly)
        );
    }

    #[test]
    fn rejects_too_many_lines() {
        // 51 newlines → 52 elements after split, all empty after first
        let mut content = String::new();
        for i in 0..51 {
            content.push_str(&format!("line {i}\n"));
        }
        assert_eq!(
            validate_file_content(content.as_bytes()),
            Err(FileValidationError::TooManyLines)
        );
    }

    #[test]
    fn rejects_line_too_long() {
        let line = "a".repeat(201);
        assert_eq!(
            validate_file_content(line.as_bytes()),
            Err(FileValidationError::LineTooLong)
        );
    }

    #[test]
    fn accepts_a_valid_short_file() {
        let content = b"const x = 1;\nconst y = 2;\n";
        assert!(validate_file_content(content).is_ok());
    }

    #[test]
    fn accepts_exactly_at_limits() {
        // exactly 1024 bytes, exactly 50 lines, exactly 200 chars per line
        let mut content = String::new();
        // 50 lines of "x" (1 char + newline = 2 bytes per line, 100 bytes total)
        for _ in 0..50 {
            content.push_str("x\n");
        }
        assert!(validate_file_content(content.as_bytes()).is_ok());

        let mut at_max = "a".repeat(200);
        at_max.push('\n');
        assert!(validate_file_content(at_max.as_bytes()).is_ok());
    }
}

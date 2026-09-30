use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct UserSettings {
    pub user_id: String,
    pub line_number: String,
}

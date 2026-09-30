use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Challenge {
    pub id: i64,
    /// `None` while the challenge is queued for votes.
    pub date: Option<NaiveDate>,
    pub start: String,
    pub goal: String,
    pub extension: String,
    pub title: Option<String>,
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub enum EditorServiceMessage {
    Progress(f64),
    Key(String),
    Submit,
}

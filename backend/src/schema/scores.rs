use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct Score {
    pub id: i64,
    pub user_id: Uuid,
    pub solution_id: i64,
    #[serde(with = "microsecond_string")]
    pub start_time: DateTime<Utc>,
    #[serde(with = "microsecond_string")]
    pub stop_time: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ScoreCreate {
    pub solution_id: i64,
    #[serde(with = "microsecond_string")]
    pub start_time: DateTime<Utc>,
    #[serde(with = "microsecond_string")]
    pub stop_time: DateTime<Utc>,
}

pub mod microsecond_string {
    use super::*;
    use chrono::NaiveDateTime;
    use serde::{de::Error, Deserializer, Serializer};

    pub fn serialize<S>(date: &DateTime<Utc>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        // Format with microsecond precision
        let s = format!("{}", date.format("%Y-%m-%dT%H:%M:%S%.6f"));
        serializer.serialize_str(&s)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<DateTime<Utc>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        NaiveDateTime::parse_from_str(&s, "%Y-%m-%dT%H:%M:%S%.6f")
            .map(|dt| dt.and_utc())
            .map_err(D::Error::custom)
    }
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct Solution {
    pub id: i64,
    pub challenge_id: i64,
    pub keys: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct SolutionCreate {
    pub challenge_id: i64,
    pub keys: Vec<String>,
}

#[cfg(test)]
mod tests {
    use base64::{engine::general_purpose, Engine};
    use editor_service::app;
    use futures::StreamExt;
    use std::{
        future::IntoFuture,
        net::{Ipv4Addr, SocketAddr},
    };
    use strsim::normalized_levenshtein;
    use tokio_tungstenite::tungstenite;

    #[tokio::test]
    async fn progress_first_stdout_second() {
        let listener = tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0)))
            .await
            .unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(axum::serve(listener, app()).into_future());

        let start = include_str!("static/start.rs");
        let goal = include_str!("static/goal.rs");
        let progress = normalized_levenshtein(start, goal);

        let start_bytes = include_bytes!("static/start.rs");
        let goal_bytes = include_bytes!("static/goal.rs");
        let encoded_start_string = general_purpose::URL_SAFE.encode(start_bytes);
        let encoded_goal_string = general_purpose::URL_SAFE.encode(goal_bytes);

        let (mut socket, _response) = tokio_tungstenite::connect_async(format!(
            "ws://{addr}/edit?start_string={encoded_start_string}&goal_string={encoded_goal_string}"
        ))
        .await
        .unwrap();

        let msg = match socket.next().await.unwrap().unwrap() {
            tungstenite::Message::Text(msg) => msg,
            other => panic!("expected a text message but got {other:?}"),
        };

        assert_eq!(msg.as_str(), progress.to_string());

        let msg = socket.next().await.unwrap().unwrap();
        assert!(msg.is_binary());
    }
}

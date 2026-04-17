use axum::{
    extract::{Query, State},
    http::Request,
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use serde::Deserialize;
use std::sync::Arc;
use tokio::net::TcpListener;
use std::collections::HashMap;
use tokio::sync::RwLock;
use crate::vfs::Storage;

#[derive(Deserialize)]
struct StreamQuery {
    id: String,
    path: String,
}

type StoragesState = Arc<RwLock<HashMap<String, Arc<dyn Storage>>>>;

async fn stream_handler(
    State(storages): State<StoragesState>,
    Query(query): Query<StreamQuery>,
    req: Request<axum::body::Body>,
) -> Response {
    let storages_lock = storages.read().await;
    let storage = match storages_lock.get(&query.id) {
        Some(s) => s.clone(),
        None => {
            return (axum::http::StatusCode::NOT_FOUND, "Connection not found").into_response();
        }
    };
    drop(storages_lock);

    let headers = req.headers().clone();
    
    match storage.stream_file(&query.path, headers).await {
        Ok(res) => res,
        Err(e) => {
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    }
}

pub async fn start_proxy_server(storages: StoragesState) -> std::io::Result<u16> {
    let app = Router::new()
        .route("/stream", get(stream_handler))
        .with_state(storages);

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    Ok(port)
}

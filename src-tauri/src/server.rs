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
use sha2::{Sha256, Digest};
use std::path::PathBuf;

#[derive(Deserialize)]
struct StreamQuery {
    id: String,
    path: String,
    thumb: Option<bool>,
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
    
    if query.thumb.unwrap_or(false) {
        println!(">>> [前端请求] 正在请求缩略图: {}", query.path);
        if let Some(local_path) = storage.get_local_path(&query.path) {
            let thumb_path = get_thumbnail_path(&query.id, &query.path);
            
            // 如果缩略图已存在，直接返回
            if thumb_path.exists() {
                println!("    <<< [缓存命中] 直接返回磁盘缩略图: {}", query.path);
                let service = tower_http::services::ServeFile::new(&thumb_path);
                use tower::ServiceExt;
                let mut req_empty = axum::http::Request::builder()
                    .uri("/")
                    .body(axum::body::Body::empty())
                    .unwrap();
                *req_empty.headers_mut() = headers.clone();
                
                let mut response = service.oneshot(req_empty).await.unwrap();
                if response.status() == axum::http::StatusCode::OK {
                    if req.method() == axum::http::Method::HEAD {
                        let mut builder = axum::response::Response::builder()
                            .status(axum::http::StatusCode::OK);
                            
                        for (k, v) in response.headers() {
                            builder = builder.header(k, v);
                        }
                        
                        builder = builder.header(axum::http::header::CACHE_CONTROL, "public, max-age=86400");
                        
                        return builder.body(axum::body::Body::empty()).unwrap();
                    }
                    
                    response.headers_mut().insert(
                        axum::http::header::CACHE_CONTROL,
                        axum::http::HeaderValue::from_static("public, max-age=86400"),
                    );
                    
                    return response.into_response();
                }
            }
            
            // 如果缩略图不存在，读取原图并生成缩略图
            if let Ok(bytes) = tokio::fs::read(&local_path).await {
                if let Ok(img) = image::load_from_memory(&bytes) {
                    let thumb = img.thumbnail(400, 400); // 生成最大 400x400 的缩略图
                    if let Some(parent) = thumb_path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    // 保存为 JPEG 以节省空间
                    let mut buf = std::io::Cursor::new(Vec::new());
                    if thumb.write_to(&mut buf, image::ImageFormat::Jpeg).is_ok() {
                        let thumb_bytes = buf.into_inner();
                        let _ = tokio::fs::write(&thumb_path, &thumb_bytes).await;
                        
                        let response = axum::response::Response::builder()
                            .status(200)
                            .header("Content-Type", "image/jpeg")
                            .header("Cache-Control", "public, max-age=86400")
                            .body(axum::body::Body::from(thumb_bytes))
                            .unwrap();
                        return response;
                    }
                }
            }
        }
    }

    match storage.stream_file(&query.path, headers).await {
        Ok(res) => res,
        Err(e) => {
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    }
}

fn get_thumbnail_path(id: &str, path: &str) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(id.as_bytes());
    hasher.update(path.as_bytes());
    let result = hasher.finalize();
    let hash_str = hex::encode(result);
    
    std::env::temp_dir()
        .join("nas-file-manager-thumbs")
        .join(format!("{}.jpg", hash_str))
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

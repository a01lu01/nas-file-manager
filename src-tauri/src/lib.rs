use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;
use tokio::sync::RwLock;
use tauri::{Emitter, Manager, State};
use log::LevelFilter;
use serde::{Deserialize, Serialize};

pub mod vfs;
pub mod download;
pub mod upload;
pub mod server;

use vfs::{Storage, webdav::WebDavStorage, FileItem, VfsError};

#[derive(Debug, Serialize, Deserialize)]
pub struct DiscoveredNas {
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub protocol: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub url: String,
    pub user: String,
    pub auth_fallback: Option<bool>,
}

fn connections_store_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("connections.json"))
}

#[tauri::command]
async fn discover_nas() -> Result<Vec<DiscoveredNas>, String> {
    log::info!("Starting mDNS local network discovery for SMB devices...");
    let mdns = mdns_sd::ServiceDaemon::new().map_err(|e| e.to_string())?;
    
    // Browse for SMB services on the local network
    let service_type = "_smb._tcp.local.";
    let receiver = mdns.browse(service_type).map_err(|e| e.to_string())?;
    
    let mut results = Vec::new();
    let mut seen_ips = HashSet::new();
    
    let timeout = Duration::from_secs(3); // 扫描 3 秒
    let start = std::time::Instant::now();
    
    while start.elapsed() < timeout {
        // 使用 timeout 避免无限阻塞
        if let Ok(event) = receiver.recv_timeout(Duration::from_millis(200)) {
            if let mdns_sd::ServiceEvent::ServiceResolved(info) = event {
                for ip in info.get_addresses() {
                    let ip_str = ip.to_string();
                    if seen_ips.insert(ip_str.clone()) {
                        let raw_name = info.get_fullname().replace("._smb._tcp.local.", "");
                        results.push(DiscoveredNas {
                            name: raw_name,
                            ip: ip_str,
                            port: info.get_port(),
                            protocol: "smb".to_string(),
                        });
                        log::info!("Discovered NAS: {} at {}", info.get_fullname(), ip);
                    }
                }
            }
        }
    }
    
    // Stop the daemon
    mdns.shutdown().ok();
    
    Ok(results)
}

#[tauri::command]
async fn load_saved_connections(app: tauri::AppHandle) -> Result<Vec<SavedConnection>, String> {
    let path = connections_store_path(&app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let connections: Vec<SavedConnection> = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(connections)
}

#[tauri::command]
async fn save_saved_connections(
    app: tauri::AppHandle,
    connections: Vec<SavedConnection>,
) -> Result<bool, String> {
    let path = connections_store_path(&app)?;
    let content = serde_json::to_string_pretty(&connections).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(true)
}

// Removed parse_smb_target_from_url


// 全局状态：保存所有的存储连接实例
pub struct AppState {
    // Key 为连接的 ID，例如 "webdav_nas1"
    pub storages: Arc<RwLock<HashMap<String, Arc<dyn Storage>>>>,
    pub download_queue: download::DownloadQueue,
    pub downloads: Arc<RwLock<HashMap<String, download::DownloadControl>>>,
    pub upload_queue: upload::UploadQueue,
    pub uploads: Arc<RwLock<HashMap<String, upload::UploadControl>>>,
    pub proxy_port: Arc<std::sync::atomic::AtomicU16>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            storages: Arc::new(RwLock::new(HashMap::new())),
            download_queue: download::DownloadQueue::new(),
            downloads: Arc::new(RwLock::new(HashMap::new())),
            upload_queue: upload::UploadQueue::new(),
            uploads: Arc::new(RwLock::new(HashMap::new())),
            proxy_port: Arc::new(std::sync::atomic::AtomicU16::new(0)),
        }
    }
}

// ---------------------- Tauri Commands ----------------------

#[tauri::command]
async fn connect_server(
    state: State<'_, AppState>,
    id: String,
    protocol: String,
    url: String, // WebDAV: http://ip:port/webdav, SMB: //ip/share
    user: String,
    pass: String,
    auth_fallback: Option<bool>,
) -> Result<bool, VfsError> {
    let auth_fallback = auth_fallback.unwrap_or(false);
    log::info!(
        "connect_server: id={:?} protocol={:?} url={:?} user={:?} pass_len={} auth_fallback={}",
        id,
        protocol,
        url,
        user,
        pass.len(),
        auth_fallback
    );
    let storage: Arc<dyn Storage> = match protocol.as_str() {
        "webdav" => Arc::new(WebDavStorage::new(&url, &user, &pass)),
        _ => return Err(VfsError::Internal("Unsupported protocol".to_string())),
    };

    // 验证连接是否通畅
    storage.ping().await?;

    // 保存到全局状态
    let mut storages = state.storages.write().await;
    storages.insert(id, storage);

    Ok(true)
}

#[tauri::command]
async fn list_directory(
    state: State<'_, AppState>,
    id: String,
    path: String,
) -> Result<Vec<FileItem>, VfsError> {
    let storages = state.storages.read().await;
    let storage = storages.get(&id).ok_or_else(|| VfsError::Internal("Connection not found".to_string()))?;
    
    storage.list_dir(&path).await
}

#[tauri::command]
async fn mkdir_item(
    state: State<'_, AppState>,
    id: String,
    path: String,
) -> Result<bool, VfsError> {
    let storages = state.storages.read().await;
    let storage = storages.get(&id).ok_or_else(|| VfsError::Internal("Connection not found".to_string()))?;
    storage.mkdir(&path).await?;
    Ok(true)
}

#[tauri::command]
async fn delete_item(
    state: State<'_, AppState>,
    id: String,
    path: String,
) -> Result<bool, VfsError> {
    let storages = state.storages.read().await;
    let storage = storages.get(&id).ok_or_else(|| VfsError::Internal("Connection not found".to_string()))?;
    storage.delete(&path).await?;
    Ok(true)
}

#[tauri::command]
async fn rename_item(
    state: State<'_, AppState>,
    id: Option<String>,
    old_path: Option<String>,
    new_path: Option<String>,
    oldPath: Option<String>,
    newPath: Option<String>,
    args: Option<serde_json::Value>,
    payload: Option<serde_json::Value>,
    input: Option<serde_json::Value>,
) -> Result<bool, VfsError> {
    let storages = state.storages.read().await;

    let get_str = |v: &serde_json::Value, keys: &[&str]| -> Option<String> {
        for k in keys {
            if let Some(s) = v.get(*k).and_then(|x| x.as_str()) {
                return Some(s.to_string());
            }
        }
        None
    };

    let empty = serde_json::Value::Null;
    let root = args
        .as_ref()
        .or(payload.as_ref())
        .or(input.as_ref())
        .unwrap_or(&empty);

    let args_obj = root.get("args").unwrap_or(root);
    let payload_obj = root.get("payload").unwrap_or(root);

    let id = id
        .or_else(|| get_str(root, &["id"]))
        .or_else(|| get_str(args_obj, &["id"]))
        .or_else(|| get_str(payload_obj, &["id"]))
        .ok_or_else(|| VfsError::Internal("Missing id".to_string()))?;

    let old_path = old_path
        .or(oldPath)
        .or_else(|| get_str(root, &["old_path", "oldPath"]))
        .or_else(|| get_str(args_obj, &["old_path", "oldPath"]))
        .or_else(|| get_str(payload_obj, &["old_path", "oldPath"]))
        .ok_or_else(|| VfsError::Internal("Missing old_path".to_string()))?;

    let new_path = new_path
        .or(newPath)
        .or_else(|| get_str(root, &["new_path", "newPath"]))
        .or_else(|| get_str(args_obj, &["new_path", "newPath"]))
        .or_else(|| get_str(payload_obj, &["new_path", "newPath"]))
        .ok_or_else(|| VfsError::Internal("Missing new_path".to_string()))?;

    let storage = storages
        .get(&id)
        .ok_or_else(|| VfsError::Internal("Connection not found".to_string()))?;
    storage.rename(&old_path, &new_path).await?;
    Ok(true)
}

#[derive(Debug, Serialize)]
struct StartDownloadResponse {
    download_id: String,
}

#[derive(Debug, Serialize, Clone)]
struct DownloadProgressEvent {
    download_id: String,
    transferred: u64,
    total: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
struct DownloadStateEvent {
    download_id: String,
    state: download::DownloadState,
    error: Option<String>,
}

#[tauri::command]
async fn start_download(
    state: State<'_, AppState>,
    id: String,
    downloadId: Option<String>,
    remotePath: String,
    localPath: String,
) -> Result<StartDownloadResponse, VfsError> {
    let download_id =
        downloadId.unwrap_or_else(|| format!("dl_{}", chrono::Utc::now().timestamp_millis()));
    let control = download::DownloadControl::new(download::DownloadMeta {
        connection_id: id.clone(),
        remote_path: remotePath.clone(),
        local_path: localPath.clone(),
    });
    {
        let mut g = state.downloads.write().await;
        g.insert(download_id.clone(), control);
    }
    state
        .download_queue
        .push(download::DownloadRequest {
            download_id: download_id.clone(),
            connection_id: id,
            remote_path: remotePath,
            local_path: localPath,
        })
        .await;
    Ok(StartDownloadResponse { download_id })
}

#[tauri::command]
async fn pause_download(
    state: State<'_, AppState>,
    downloadId: String,
) -> Result<bool, VfsError> {
    let g = state.downloads.read().await;
    let c = g
        .get(&downloadId)
        .ok_or_else(|| VfsError::NotFound(downloadId))?;
    c.pause();
    Ok(true)
}

#[tauri::command]
async fn resume_download(
    state: State<'_, AppState>,
    downloadId: String,
) -> Result<bool, VfsError> {
    let g = state.downloads.read().await;
    let c = g
        .get(&downloadId)
        .ok_or_else(|| VfsError::NotFound(downloadId))?;
    c.resume();
    Ok(true)
}

#[tauri::command]
async fn cancel_download(
    state: State<'_, AppState>,
    downloadId: String,
    removePartial: Option<bool>,
) -> Result<bool, VfsError> {
    let remove_partial = removePartial.unwrap_or(true);
    let g = state.downloads.read().await;
    let c = g
        .get(&downloadId)
        .ok_or_else(|| VfsError::NotFound(downloadId.clone()))?;
    c.cancel.cancel();
    if remove_partial {
        c.mark_remove_partial();
    }
    Ok(true)
}

#[tauri::command]
async fn retry_download(
    state: State<'_, AppState>,
    downloadId: String,
) -> Result<bool, VfsError> {
    let meta = {
        let g = state.downloads.read().await;
        let c = g
            .get(&downloadId)
            .ok_or_else(|| VfsError::NotFound(downloadId.clone()))?;
        c.meta.clone()
    };
    {
        let mut g = state.downloads.write().await;
        g.insert(downloadId.clone(), download::DownloadControl::new(meta.clone()));
    }
    state
        .download_queue
        .push(download::DownloadRequest {
            download_id: downloadId.clone(),
            connection_id: meta.connection_id,
            remote_path: meta.remote_path,
            local_path: meta.local_path,
        })
        .await;
    Ok(true)
}

#[derive(Debug, Serialize)]
struct StartUploadResponse {
    upload_id: String,
}

#[derive(Debug, Serialize, Clone)]
struct UploadProgressEvent {
    upload_id: String,
    transferred: u64,
    total: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
struct UploadStateEvent {
    upload_id: String,
    state: upload::UploadState,
    error: Option<String>,
}

#[tauri::command]
async fn start_upload(
    state: State<'_, AppState>,
    connectionId: String,
    localPath: String,
    remotePath: String,
    uploadId: Option<String>,
) -> Result<StartUploadResponse, VfsError> {
    let upload_id =
        uploadId.unwrap_or_else(|| format!("up_{}", chrono::Utc::now().timestamp_millis()));
    let control = upload::UploadControl::new(upload::UploadMeta {
        connection_id: connectionId.clone(),
        local_path: localPath.clone(),
        remote_path: remotePath.clone(),
    });
    {
        let mut g = state.uploads.write().await;
        g.insert(upload_id.clone(), control);
    }
    state
        .upload_queue
        .push(upload::UploadRequest {
            upload_id: upload_id.clone(),
            connection_id: connectionId,
            local_path: localPath,
            remote_path: remotePath,
        })
        .await;
    Ok(StartUploadResponse { upload_id })
}

#[tauri::command]
async fn pause_upload(
    state: State<'_, AppState>,
    uploadId: String,
) -> Result<bool, VfsError> {
    let g = state.uploads.read().await;
    let c = g
        .get(&uploadId)
        .ok_or_else(|| VfsError::NotFound(uploadId))?;
    c.pause();
    Ok(true)
}

#[tauri::command]
async fn resume_upload(
    state: State<'_, AppState>,
    uploadId: String,
) -> Result<bool, VfsError> {
    let g = state.uploads.read().await;
    let c = g
        .get(&uploadId)
        .ok_or_else(|| VfsError::NotFound(uploadId))?;
    c.resume();
    Ok(true)
}

#[tauri::command]
async fn cancel_upload(
    state: State<'_, AppState>,
    uploadId: String,
    removePartial: Option<bool>,
) -> Result<bool, VfsError> {
    let remove_partial = removePartial.unwrap_or(true);
    let g = state.uploads.read().await;
    let c = g
        .get(&uploadId)
        .ok_or_else(|| VfsError::NotFound(uploadId.clone()))?;
    c.cancel.cancel();
    if remove_partial {
        c.mark_remove_partial();
    }
    Ok(true)
}

#[tauri::command]
async fn get_proxy_port(state: tauri::State<'_, AppState>) -> Result<u16, String> {
    let port = state.proxy_port.load(std::sync::atomic::Ordering::Relaxed);
    if port == 0 {
        Err("Proxy server not running".to_string())
    } else {
        Ok(port)
    }
}

#[tauri::command]
async fn get_proxy_url(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    path: String,
) -> Result<String, String> {
    let port = state.proxy_port.load(std::sync::atomic::Ordering::Relaxed);
    if port == 0 {
        return Err("Proxy server not running".to_string());
    }
    
    // We encode the path and connection_id so it can be passed in the URL safely
    let encoded_path = urlencoding::encode(&path);
    let encoded_id = urlencoding::encode(&connection_id);
    
    Ok(format!("http://127.0.0.1:{}/stream?id={}&path={}", port, encoded_id, encoded_path))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(LevelFilter::Info)
                .level_for("smb", LevelFilter::Debug)
                .level_for("smb_transport", LevelFilter::Debug)
                .level_for("app_lib", LevelFilter::Debug)
                .build(),
        )
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::default())
        .setup(|app| {
            let app_handle = app.handle().clone();
            
            // start proxy server
            let storages_for_proxy = app.state::<AppState>().storages.clone();
            let proxy_port_clone = app.state::<AppState>().proxy_port.clone();
            tauri::async_runtime::spawn(async move {
                match server::start_proxy_server(storages_for_proxy).await {
                    Ok(port) => {
                        proxy_port_clone.store(port, std::sync::atomic::Ordering::Relaxed);
                        log::info!("Proxy server started on port {}", port);
                    }
                    Err(e) => {
                        log::error!("Failed to start proxy server: {}", e);
                    }
                }
            });

            let queue = app.state::<AppState>().download_queue.clone();
            let storages = app.state::<AppState>().storages.clone();
            let downloads = app.state::<AppState>().downloads.clone();

            tauri::async_runtime::spawn(async move {
                loop {
                    let req = queue.pop().await;

                    let control = {
                        let g = downloads.read().await;
                        g.get(&req.download_id).cloned()
                    };
                    let Some(control) = control else {
                        continue;
                    };

                    let result: Result<(), VfsError> = async {
                        // **修复：跳过 Tauri 沙箱的强制拦截**
                        // 因为直接用 tokio::fs 在受限模式（带 entitlements）下可能会被 Tauri Scope 拦截
                        // 且通过 plugin-dialog 拿到的路径理论上是被授权的。但为了万无一失，如果普通 tokio::fs 失败
                        // 我们可以借用标准库 std::fs 试试。
                        // 其实，真正的解决办法是在 Tauri 内部将对话框选中的路径临时加入 FS scope，或者使用 std::fs 绕过 tauri_plugin_fs 的拦截。
                        
                        if let Some(parent) = Path::new(&req.local_path).parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }

                        let storage = {
                            let g = storages.read().await;
                            g.get(&req.connection_id).cloned()
                        }
                        .ok_or_else(|| VfsError::Internal("Connection not found".to_string()))?;

                        let webdav = storage.as_any().downcast_ref::<WebDavStorage>().ok_or_else(
                            || VfsError::Internal("Download not supported for this protocol".to_string()),
                        )?;

                        let _ = app_handle.emit(
                        "download-state",
                        DownloadStateEvent {
                                download_id: req.download_id.clone(),
                                state: download::DownloadState::Running,
                                error: None,
                            },
                        );

                        let mut transferred: u64 = 0;
                        loop {
                            if control.cancel.is_cancelled() {
                                break;
                            }
                            if control.is_paused() {
                                let _ = app_handle.emit(
                                "download-state",
                                DownloadStateEvent {
                                        download_id: req.download_id.clone(),
                                        state: download::DownloadState::Paused,
                                        error: None,
                                    },
                                );
                                control.wait_resume().await;
                                let _ = app_handle.emit(
                                "download-state",
                                DownloadStateEvent {
                                        download_id: req.download_id.clone(),
                                        state: download::DownloadState::Running,
                                        error: None,
                                    },
                                );
                                let meta_len = tokio::fs::metadata(&req.local_path)
                                    .await
                                    .map(|m| m.len())
                                    .unwrap_or(0);
                                transferred = meta_len;
                            }

                            let (res, total) =
                                webdav.open_download(&req.remote_path, transferred).await?;

                            let mut opts = std::fs::OpenOptions::new();
                            opts.write(true);
                            opts.create(true);
                            if transferred == 0 {
                                opts.truncate(true);
                            } else {
                                opts.append(true);
                            }

                            let file = match opts.open(&req.local_path) {
                                Ok(f) => f,
                                Err(e) => {
                                    // Special fallback for Android Download directory
                                    #[cfg(target_os = "android")]
                                    {
                                        log::warn!("Fallback to jni or content resolver for {} error: {}", req.local_path, e);
                                        // On Android 11+ we can't write to Download directory with std::fs
                                        // We will try to write to app's external files dir instead and copy it later or just change the download dir in frontend.
                                    }
                                    return Err(VfsError::Internal(format!("Failed to open file {}: {}", req.local_path, e)));
                                }
                            };

                            let mut file = tokio::fs::File::from_std(file);

                            let mut paused_break = false;
                            let mut stream = res.bytes_stream();
                            while let Some(chunk) = stream.next().await {
                                if control.cancel.is_cancelled() {
                                    break;
                                }
                                if control.is_paused() {
                                    paused_break = true;
                                    break;
                                }
                                let chunk =
                                    chunk.map_err(|e| VfsError::NetworkError(e.to_string()))?;
                                let outcome = download::write_respecting_control(&control, &mut file, &chunk)
                                    .await
                                    .map_err(|e| VfsError::Internal(e.to_string()))?;
                                match outcome {
                                    download::WriteOutcome::Completed(n) => {
                                        transferred += n as u64;
                                    }
                                    download::WriteOutcome::Paused(n) => {
                                        transferred += n as u64;
                                        paused_break = true;
                                        break;
                                    }
                                    download::WriteOutcome::Canceled(n) => {
                                        transferred += n as u64;
                                        break;
                                    }
                                }
                                let _ = app_handle.emit(
                                "download-progress",
                                DownloadProgressEvent {
                                        download_id: req.download_id.clone(),
                                        transferred,
                                        total,
                                    },
                                );
                            }
                            file.flush()
                                .await
                                .map_err(|e| VfsError::Internal(e.to_string()))?;

                            if control.cancel.is_cancelled() {
                                break;
                            }
                            if paused_break {
                                continue;
                            }
                            break;
                        }
                        Ok(())
                    }
                    .await;

                    match result {
                        Ok(()) => {
                            let g = downloads.read().await;
                            let canceled = g
                                .get(&req.download_id)
                                .map(|c| c.cancel.is_cancelled())
                                .unwrap_or(false);
                            if canceled {
                                if let Some(c) = g.get(&req.download_id) {
                                    if c.should_remove_partial() {
                                        let _ = std::fs::remove_file(&c.meta.local_path);
                                    }
                                }
                                let _ = app_handle.emit(
                                    "download-state",
                                    DownloadStateEvent {
                                        download_id: req.download_id.clone(),
                                        state: download::DownloadState::Canceled,
                                        error: None,
                                    },
                                );
                            } else {
                                let _ = app_handle.emit(
                                    "download-state",
                                    DownloadStateEvent {
                                        download_id: req.download_id.clone(),
                                        state: download::DownloadState::Done,
                                        error: None,
                                    },
                                );
                            }
                        }
                        Err(e) => {
                            let _ = app_handle.emit(
                                "download-state",
                                DownloadStateEvent {
                                    download_id: req.download_id.clone(),
                                    state: download::DownloadState::Error,
                                    error: Some(e.to_string()),
                                },
                            );
                        }
                    }
                }
            });

            let upload_queue = app.state::<AppState>().upload_queue.clone();
            let upload_storages = app.state::<AppState>().storages.clone();
            let uploads = app.state::<AppState>().uploads.clone();
            let upload_app_handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                loop {
                    let req = upload_queue.pop().await;

                    let control = {
                        let g = uploads.read().await;
                        g.get(&req.upload_id).cloned()
                    };
                    let Some(control) = control else {
                        continue;
                    };

                    let result: Result<(), VfsError> = async {
                        let storage = {
                            let g = upload_storages.read().await;
                            g.get(&req.connection_id).cloned()
                        }
                        .ok_or_else(|| VfsError::Internal("Connection not found".to_string()))?;

                        let mut file = tokio::fs::File::open(&req.local_path)
                            .await
                            .map_err(|e| VfsError::Internal(format!("Failed to open file: {}", e)))?;
                        
                        let file_size = file.metadata()
                            .await
                            .map_err(|e| VfsError::Internal(format!("Failed to read metadata: {}", e)))?
                            .len();

                        let _ = upload_app_handle.emit(
                            "upload-state",
                            UploadStateEvent {
                                upload_id: req.upload_id.clone(),
                                state: upload::UploadState::Running,
                                error: None,
                            },
                        );

                        let req_upload_id = req.upload_id.clone();
                        let app_handle_clone = upload_app_handle.clone();
                        let control_clone = control.clone();

                        let stream = async_stream::stream! {
                            let mut buf = [0u8; 64 * 1024];
                            let mut transferred = 0;
                            loop {
                                if control_clone.cancel.is_cancelled() {
                                    yield Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "Upload canceled"));
                                    break;
                                }

                                if control_clone.is_paused() {
                                    let _ = app_handle_clone.emit(
                                        "upload-state",
                                        UploadStateEvent {
                                            upload_id: req_upload_id.clone(),
                                            state: upload::UploadState::Paused,
                                            error: None,
                                        },
                                    );
                                    control_clone.wait_resume().await;
                                    let _ = app_handle_clone.emit(
                                        "upload-state",
                                        UploadStateEvent {
                                            upload_id: req_upload_id.clone(),
                                            state: upload::UploadState::Running,
                                            error: None,
                                        },
                                    );
                                }

                                match tokio::io::AsyncReadExt::read(&mut file, &mut buf).await {
                                    Ok(0) => break,
                                    Ok(n) => {
                                        transferred += n as u64;
                                        let _ = app_handle_clone.emit(
                                            "upload-progress",
                                            UploadProgressEvent {
                                                upload_id: req_upload_id.clone(),
                                                transferred,
                                                total: Some(file_size),
                                            },
                                        );
                                        yield Ok::<_, std::io::Error>(bytes::Bytes::copy_from_slice(&buf[..n]));
                                    }
                                    Err(e) => {
                                        yield Err(e);
                                        break;
                                    }
                                }
                            }
                        };

                        let body = reqwest::Body::wrap_stream(stream);
                        storage.upload_stream(&req.remote_path, body, file_size).await?;
                        Ok(())
                    }
                    .await;

                    match result {
                        Ok(()) => {
                            let _ = upload_app_handle.emit(
                                "upload-state",
                                UploadStateEvent {
                                    upload_id: req.upload_id.clone(),
                                    state: upload::UploadState::Done,
                                    error: None,
                                },
                            );
                        }
                        Err(e) => {
                            let g = uploads.read().await;
                            let canceled = g
                                .get(&req.upload_id)
                                .map(|c| c.cancel.is_cancelled())
                                .unwrap_or(false);
                                
                            if canceled {
                                let _ = upload_app_handle.emit(
                                    "upload-state",
                                    UploadStateEvent {
                                        upload_id: req.upload_id.clone(),
                                        state: upload::UploadState::Canceled,
                                        error: None,
                                    },
                                );
                            } else {
                                let _ = upload_app_handle.emit(
                                    "upload-state",
                                    UploadStateEvent {
                                        upload_id: req.upload_id.clone(),
                                        state: upload::UploadState::Error,
                                        error: Some(e.to_string()),
                                    },
                                );
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect_server,
            list_directory,
            mkdir_item,
            delete_item,
            rename_item,
            start_download,
            pause_download,
            resume_download,
            cancel_download,
            retry_download,
            start_upload,
            pause_upload,
            resume_upload,
            cancel_upload,
            discover_nas,
            load_saved_connections,
            save_saved_connections,
            get_proxy_url,
            get_proxy_port
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

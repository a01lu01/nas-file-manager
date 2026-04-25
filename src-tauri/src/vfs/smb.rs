use super::{FileItem, Storage, VfsError};
use async_trait::async_trait;
use std::any::Any;
use tokio::process::Command;

pub struct SmbStorage {
    server: String,
    share: String,
    base_path: Option<String>,
    user: String,
    pass: String,
    mount_point: String,
}

impl SmbStorage {
    pub fn new(server: &str, share: Option<&str>, base_path: Option<&str>, user: &str, pass: &str, _auth_fallback: bool) -> Self {
        // We use the exact share name for the native mount point
        let share_name = share.unwrap_or("").to_string();
        
        let mount_point = if share_name.is_empty() {
            String::new()
        } else {
            format!("/Volumes/{}", share_name)
        };
        
        Self {
            server: server.to_string(),
            share: share_name,
            base_path: base_path.map(|s| s.to_string()),
            user: user.to_string(),
            pass: pass.to_string(),
            mount_point,
        }
    }

    async fn ensure_connected(&self) -> Result<(), VfsError> {
        if self.share.is_empty() {
            return Err(VfsError::NetworkError("For macOS native SMB connection, a Share Name must be specified in the URL (e.g. 192.168.2.200/ShareName).".to_string()));
        }

        // Check if it's already mounted natively in /Volumes/ShareName
        if std::path::Path::new(&self.mount_point).exists() {
            if let Ok(mut entries) = tokio::fs::read_dir(&self.mount_point).await {
                if entries.next_entry().await.is_ok() {
                    return Ok(());
                }
            }
        }

        let encoded_user = urlencoding::encode(&self.user);
        let encoded_pass = urlencoding::encode(&self.pass);
        let encoded_share = urlencoding::encode(&self.share);

        let mount_url = if self.user.is_empty() {
            format!("smb://{}/{}", self.server, encoded_share)
        } else {
            format!("smb://{}:{}@{}/{}", encoded_user, encoded_pass, self.server, encoded_share)
        };

        #[cfg(target_os = "macos")]
        {
            // Use AppleScript to mount via Finder, which natively handles encoding, root discovery, and avoiding stale mounts
            let script = format!("mount volume \"{}\"", mount_url);
            
            let output = Command::new("osascript")
                .arg("-e")
                .arg(&script)
                .output()
                .await
                .map_err(|e| VfsError::NetworkError(format!("Failed to execute osascript: {}", e)))?;

            if !output.status.success() {
                let err_msg = String::from_utf8_lossy(&output.stderr);
                return Err(VfsError::NetworkError(format!("Native mount failed: {}", err_msg)));
            }
            
            // Wait briefly for macOS to establish the mount in /Volumes
            tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
            
            if !std::path::Path::new(&self.mount_point).exists() {
                // Sometimes macOS appends "-1" if a stale folder exists. Let's try to find it.
                // But for now, we just return an error and ask user to check Finder.
                return Err(VfsError::NetworkError(format!("Mount succeeded but could not find volume at {}", self.mount_point)));
            }
        }

        Ok(())
    }

    fn resolve_local_path(&self, path: &str) -> std::path::PathBuf {
        let mut local_path = std::path::PathBuf::from(&self.mount_point);
        
        if let Some(base) = &self.base_path {
            for component in base.split('/') {
                if !component.is_empty() {
                    local_path.push(component);
                }
            }
        }
        
        if !path.is_empty() && path != "/" {
            for component in path.trim_start_matches('/').split('/') {
                if !component.is_empty() {
                    local_path.push(component);
                }
            }
        }
        local_path
    }
}

#[async_trait]
impl Storage for SmbStorage {
    fn as_any(&self) -> &dyn Any {
        self
    }

    async fn ping(&self) -> Result<bool, VfsError> {
        self.ensure_connected().await?;
        Ok(true)
    }

    async fn list_dir(&self, path: &str) -> Result<Vec<FileItem>, VfsError> {
        self.ensure_connected().await?;
        let local_path = self.resolve_local_path(path);

        let mut items = Vec::new();
        let mut entries = tokio::fs::read_dir(&local_path)
            .await
            .map_err(|e| VfsError::NetworkError(format!("Failed to read directory: {}", e)))?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| VfsError::NetworkError(e.to_string()))? {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name == "." || file_name == ".." || file_name == ".DS_Store" {
                continue;
            }

            let metadata = entry.metadata().await.map_err(|e| VfsError::NetworkError(e.to_string()))?;
            
            let item_path = if path.ends_with('/') {
                format!("{}{}", path, file_name)
            } else if path.is_empty() || path == "/" {
                format!("/{}", file_name)
            } else {
                format!("{}/{}", path, file_name)
            };

            let modified = metadata.modified().ok().and_then(|t| {
                t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs() as i64)
            });

            items.push(FileItem {
                name: file_name,
                path: item_path,
                is_dir: metadata.is_dir(),
                size: metadata.len(),
                last_modified: modified,
                protocol: "smb".to_string(),
            });
        }
        Ok(items)
    }

    async fn mkdir(&self, path: &str) -> Result<(), VfsError> {
        self.ensure_connected().await?;
        let local_path = self.resolve_local_path(path);
        tokio::fs::create_dir(&local_path)
            .await
            .map_err(|e| VfsError::NetworkError(e.to_string()))?;
        Ok(())
    }

    async fn delete(&self, path: &str) -> Result<(), VfsError> {
        self.ensure_connected().await?;
        let local_path = self.resolve_local_path(path);
        let metadata = tokio::fs::metadata(&local_path)
            .await
            .map_err(|e| VfsError::NetworkError(e.to_string()))?;
            
        if metadata.is_dir() {
            tokio::fs::remove_dir_all(&local_path)
                .await
                .map_err(|e| VfsError::NetworkError(e.to_string()))?;
        } else {
            tokio::fs::remove_file(&local_path)
                .await
                .map_err(|e| VfsError::NetworkError(e.to_string()))?;
        }
        Ok(())
    }

    async fn rename(&self, old_path: &str, new_path: &str) -> Result<(), VfsError> {
        self.ensure_connected().await?;
        let old_local_path = self.resolve_local_path(old_path);
        let new_local_path = self.resolve_local_path(new_path);
        tokio::fs::rename(&old_local_path, &new_local_path)
            .await
            .map_err(|e| VfsError::NetworkError(e.to_string()))?;
        Ok(())
    }

    fn get_local_path(&self, path: &str) -> Option<std::path::PathBuf> {
        Some(self.resolve_local_path(path))
    }

    async fn stream_file(&self, path: &str, req_headers: axum::http::HeaderMap) -> Result<axum::response::Response, VfsError> {
        use axum::response::IntoResponse;
        use tower_http::services::ServeFile;
        use tower::ServiceExt;
        
        self.ensure_connected().await?;
        
        let local_path = self.resolve_local_path(path);
        
        let mut req = axum::http::Request::builder()
            .uri("/")
            .body(axum::body::Body::empty())
            .unwrap();
            
        *req.headers_mut() = req_headers;
        
        let service = ServeFile::new(&local_path);
        
        let mut response = service.oneshot(req).await
            .map_err(|e| VfsError::NetworkError(e.to_string()))?
            .into_response();
            
        // 强制添加 Cache-Control 头，让浏览器缓存图片和资源，解决列表滚动时的重绘和反复请求导致的卡顿
        response.headers_mut().insert(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static("public, max-age=86400")
        );
            
        Ok(response)
    }
}

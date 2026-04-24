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
    pub fn new(server: &str, share: &str, base_path: Option<&str>, user: &str, pass: &str, _auth_fallback: bool) -> Self {
        // 创建一个唯一的挂载点
        let unique_id = uuid::Uuid::new_v4().to_string();
        let mount_point = format!("/tmp/nas_mount_{}", unique_id);
        
        Self {
            server: server.to_string(),
            share: share.to_string(),
            base_path: base_path.map(|s| s.to_string()),
            user: user.to_string(),
            pass: pass.to_string(),
            mount_point,
        }
    }

    async fn ensure_connected(&self) -> Result<(), VfsError> {
        // 检查是否已经挂载
        if std::path::Path::new(&self.mount_point).exists() {
            // 简单验证挂载点是否可用（非空）
            if let Ok(mut entries) = tokio::fs::read_dir(&self.mount_point).await {
                if entries.next_entry().await.is_ok() {
                    return Ok(());
                }
            }
        } else {
            std::fs::create_dir_all(&self.mount_point)
                .map_err(|e| VfsError::Internal(format!("Failed to create mount point: {}", e)))?;
        }

        // 构建挂载 URL
        // macOS smb:// 的密码如果有特殊字符需要 urlencoding
        let encoded_user = urlencoding::encode(&self.user);
        let encoded_pass = urlencoding::encode(&self.pass);
        
        let target_share = if self.share.is_empty() {
            // 如果用户没填 share，macOS 默认不能直接挂载根节点。
            // 这里我们要求用户尽量填，不填的话默认使用第一个找到的 share 或者 IPC$。
            // 但为了通用性，如果没填，我们不要强制加 IPC$，有些 NAS 会拒绝。
            ""
        } else {
            &self.share
        };

        let mount_url = if self.user.is_empty() {
            if target_share.is_empty() {
                format!("smb://{}", self.server)
            } else {
                format!("smb://{}/{}", self.server, target_share)
            }
        } else {
            if target_share.is_empty() {
                format!("smb://{}:{}@{}", encoded_user, encoded_pass, self.server)
            } else {
                format!("smb://{}:{}@{}/{}", encoded_user, encoded_pass, self.server, target_share)
            }
        };

        #[cfg(target_os = "macos")]
        {
            // mount_smbfs 需要一个特定的 share 才能挂载。
            // 如果用户没有指定 share 且 URL 没有路径，mount_smbfs 可能会报错 "No such file or directory"
            // 解决办法：提示用户必须输入 Share 名称
            if target_share.is_empty() {
                return Err(VfsError::NetworkError("For macOS SMB connection, a Share Name (e.g. 'Public', 'Data') is required.".to_string()));
            }

            let output = Command::new("mount_smbfs")
                .arg(&mount_url)
                .arg(&self.mount_point)
                .output()
                .await
                .map_err(|e| VfsError::NetworkError(format!("Failed to execute mount_smbfs: {}", e)))?;

            if !output.status.success() {
                let err_msg = String::from_utf8_lossy(&output.stderr);
                // 尝试卸载残留
                let _ = Command::new("umount").arg(&self.mount_point).output().await;
                return Err(VfsError::NetworkError(format!("Mount failed: {}", err_msg)));
            }
        }

        #[cfg(target_os = "windows")]
        {
            // Windows 挂载逻辑 (net use) - 暂未实现完全，仅保留骨架
            return Err(VfsError::Internal("Windows native mount not fully implemented yet".to_string()));
        }

        Ok(())
    }

    fn resolve_local_path(&self, path: &str) -> std::path::PathBuf {
        let mut local_path = std::path::PathBuf::from(&self.mount_point);
        if let Some(base) = &self.base_path {
            local_path.push(base.trim_matches('/'));
        }
        if !path.is_empty() && path != "/" {
            local_path.push(path.trim_start_matches('/'));
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

impl Drop for SmbStorage {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        {
            // 当连接断开/被丢弃时，自动卸载并删除临时挂载点
            let mount_point = self.mount_point.clone();
            std::thread::spawn(move || {
                let _ = std::process::Command::new("umount")
                    .arg(&mount_point)
                    .output();
                let _ = std::fs::remove_dir(&mount_point);
            });
        }
    }
}

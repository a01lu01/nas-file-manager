use super::{FileItem, Storage, VfsError};
use async_trait::async_trait;
use std::any::Any;
use tokio::process::Command;
use tokio::sync::Mutex;
use std::collections::HashMap;
use smb::auth::SimpleAuthenticator;
use smb::SmbClient;

pub struct SmbStorage {
    server: String,
    share: Option<String>,
    base_path: Option<String>,
    user: String,
    pass: String,
    mounts: Mutex<HashMap<String, String>>,
}

impl SmbStorage {
    pub fn new(server: &str, share: Option<&str>, base_path: Option<&str>, user: &str, pass: &str) -> Self {
        Self {
            server: server.to_string(),
            share: share.map(|s| s.to_string()),
            base_path: base_path.map(|s| s.to_string()),
            user: user.to_string(),
            pass: pass.to_string(),
            mounts: Mutex::new(HashMap::new()),
        }
    }

    async fn ensure_share_mounted(&self, share: &str) -> Result<String, VfsError> {
        let mut mounts = self.mounts.lock().await;
        if let Some(mount_point) = mounts.get(share) {
            // Check if still mounted
            if let Ok(mut entries) = tokio::fs::read_dir(mount_point).await {
                if entries.next_entry().await.is_ok() {
                    return Ok(mount_point.clone());
                }
            }
        }

        let unique_id = uuid::Uuid::new_v4().to_string();
        let mount_point = format!("/tmp/nas_mount_{}_{}", share, unique_id);
        
        std::fs::create_dir_all(&mount_point)
            .map_err(|e| VfsError::Internal(format!("Failed to create mount point: {}", e)))?;

        let encoded_user = urlencoding::encode(&self.user);
        let encoded_pass = urlencoding::encode(&self.pass);
        
        let mount_url = if self.user.is_empty() {
            format!("smb://{}/{}", self.server, share)
        } else {
            format!("smb://{}:{}@{}/{}", encoded_user, encoded_pass, self.server, share)
        };

        #[cfg(target_os = "macos")]
        {
            let output = Command::new("mount_smbfs")
                .arg(&mount_url)
                .arg(&mount_point)
                .output()
                .await
                .map_err(|e| VfsError::NetworkError(format!("Failed to execute mount_smbfs: {}", e)))?;

            if !output.status.success() {
                let err_msg = String::from_utf8_lossy(&output.stderr);
                let _ = Command::new("umount").arg(&mount_point).output().await;
                return Err(VfsError::NetworkError(format!("Mount failed for share '{}': {}", share, err_msg)));
            }
        }

        mounts.insert(share.to_string(), mount_point.clone());
        Ok(mount_point)
    }

    async fn list_shares_via_smb_crate(&self) -> Result<Vec<FileItem>, VfsError> {
        let auth = if self.user.is_empty() {
            SimpleAuthenticator::new_guest()
        } else {
            SimpleAuthenticator::new(&self.user, &self.pass)
        };

        let server_url = format!("tcp://{}:445", self.server);
        
        let client = SmbClient::new(auth, smb::SmbOptions::default())
            .map_err(|e| VfsError::NetworkError(format!("Failed to init SMB client: {}", e)))?;
            
        let session = client.connect(&server_url).await
            .map_err(|e| VfsError::NetworkError(format!("SMB connection failed: {}", e)))?;

        let tree_names = session.list_shares().await
            .map_err(|e| VfsError::NetworkError(format!("Failed to list shares: {}", e)))?;

        let mut items = Vec::new();
        for name in tree_names {
            if name.ends_with('$') { continue; }
            
            items.push(FileItem {
                name: name.clone(),
                path: format!("/{}", name),
                is_dir: true,
                size: 0,
                last_modified: None,
                protocol: "smb".to_string(),
            });
        }
        
        Ok(items)
    }

    fn parse_virtual_path<'a>(&'a self, path: &'a str) -> Result<(String, String), VfsError> {
        let clean_path = path.trim_start_matches('/');
        
        if let Some(fixed_share) = &self.share {
            Ok((fixed_share.clone(), clean_path.to_string()))
        } else {
            if clean_path.is_empty() {
                return Err(VfsError::Internal("Cannot resolve path for root directory".to_string()));
            }
            
            let mut parts = clean_path.splitn(2, '/');
            let share_name = parts.next().unwrap().to_string();
            let rel_path = parts.next().unwrap_or("").to_string();
            
            Ok((share_name, rel_path))
        }
    }

    async fn resolve_local_path_async(&self, path: &str) -> Result<std::path::PathBuf, VfsError> {
        let (share_name, rel_path) = self.parse_virtual_path(path)?;
        
        let mount_point = self.ensure_share_mounted(&share_name).await?;
        let mut local_path = std::path::PathBuf::from(&mount_point);
        
        if let Some(base) = &self.base_path {
            for component in base.split('/') {
                if !component.is_empty() {
                    local_path.push(component);
                }
            }
        }
        
        for component in rel_path.split('/') {
            if !component.is_empty() {
                local_path.push(component);
            }
        }
        
        Ok(local_path)
    }
}

#[async_trait]
impl Storage for SmbStorage {
    fn as_any(&self) -> &dyn Any {
        self
    }

    async fn ping(&self) -> Result<bool, VfsError> {
        if let Some(share) = &self.share {
            self.ensure_share_mounted(share).await?;
        } else {
            let _ = self.list_shares_via_smb_crate().await?;
        }
        Ok(true)
    }

    async fn list_dir(&self, path: &str) -> Result<Vec<FileItem>, VfsError> {
        let clean_path = path.trim_start_matches('/');
        
        if self.share.is_none() && clean_path.is_empty() {
            return self.list_shares_via_smb_crate().await;
        }

        let local_path = self.resolve_local_path_async(path).await?;

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
        let local_path = self.resolve_local_path_async(path).await?;
        tokio::fs::create_dir(&local_path)
            .await
            .map_err(|e| VfsError::NetworkError(e.to_string()))?;
        Ok(())
    }

    async fn delete(&self, path: &str) -> Result<(), VfsError> {
        let local_path = self.resolve_local_path_async(path).await?;
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
        let old_local_path = self.resolve_local_path_async(old_path).await?;
        let new_local_path = self.resolve_local_path_async(new_path).await?;
        tokio::fs::rename(&old_local_path, &new_local_path)
            .await
            .map_err(|e| VfsError::NetworkError(e.to_string()))?;
        Ok(())
    }

    fn get_local_path(&self, path: &str) -> Option<std::path::PathBuf> {
        if let Ok((share_name, rel_path)) = self.parse_virtual_path(path) {
            if let Ok(mounts) = self.mounts.try_lock() {
                if let Some(mount_point) = mounts.get(&share_name) {
                    let mut local_path = std::path::PathBuf::from(mount_point);
                    if let Some(base) = &self.base_path {
                        for c in base.split('/') { if !c.is_empty() { local_path.push(c); } }
                    }
                    for c in rel_path.split('/') { if !c.is_empty() { local_path.push(c); } }
                    return Some(local_path);
                }
            }
        }
        None
    }

    async fn stream_file(&self, path: &str, req_headers: axum::http::HeaderMap) -> Result<axum::response::Response, VfsError> {
        use axum::response::IntoResponse;
        use tower_http::services::ServeFile;
        use tower::ServiceExt;
        
        let local_path = self.resolve_local_path_async(path).await?;
        
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
            if let Ok(mounts) = self.mounts.try_lock() {
                for mount_point in mounts.values() {
                    let mp = mount_point.clone();
                    std::thread::spawn(move || {
                        let _ = std::process::Command::new("umount")
                            .arg(&mp)
                            .output();
                        let _ = std::fs::remove_dir(&mp);
                    });
                }
            }
        }
    }
}

use serde::{Deserialize, Serialize};
use thiserror::Error;
use async_trait::async_trait;
use std::any::Any;
use futures_util::Stream;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileItem {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub last_modified: Option<i64>, // Unix timestamp
    pub protocol: String,           // "webdav"
}

#[derive(Error, Debug, Serialize)]
pub enum VfsError {
    #[error("Authentication failed")]
    AuthFailed,
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Permission denied")]
    PermissionDenied,
    #[error("Network error: {0}")]
    NetworkError(String),
    #[error("Internal error: {0}")]
    Internal(String),
}

// 使得 VfsError 可以在 tauri::command 中作为 Result::Err 抛出并序列化给前端
impl From<anyhow::Error> for VfsError {
    fn from(err: anyhow::Error) -> Self {
        VfsError::Internal(err.to_string())
    }
}

#[async_trait]
pub trait Storage: Send + Sync {
    fn as_any(&self) -> &dyn Any;

    /// 验证连接是否可用
    async fn ping(&self) -> Result<bool, VfsError>;
    
    /// 获取目录下的文件列表
    async fn list_dir(&self, path: &str) -> Result<Vec<FileItem>, VfsError>;
    
    /// 创建目录
    async fn mkdir(&self, path: &str) -> Result<(), VfsError>;
    
    /// 删除文件或目录
    async fn delete(&self, path: &str) -> Result<(), VfsError>;
    
    /// 重命名文件或目录
    async fn rename(&self, old_path: &str, new_path: &str) -> Result<(), VfsError>;
    
    /// 流式读取文件 (用于视频播放、图片预览等)
    async fn stream_file(&self, path: &str, req_headers: axum::http::HeaderMap) -> Result<axum::response::Response, VfsError>;

    /// 返回本地路径（如果有的话，方便直接读取生成缩略图）
    fn get_local_path(&self, _path: &str) -> Option<std::path::PathBuf> {
        None
    }

    async fn upload_stream(
        &self,
        remote_path: &str,
        stream: reqwest::Body,
        content_length: u64,
    ) -> Result<(), VfsError>;
}

pub mod webdav;

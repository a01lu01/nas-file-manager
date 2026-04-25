use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, Notify};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UploadState {
    Queued,
    Running,
    Paused,
    Done,
    Error,
    Canceled,
}

#[derive(Debug, Clone)]
pub struct UploadMeta {
    pub connection_id: String,
    pub local_path: String,
    pub remote_path: String,
}

#[derive(Clone)]
pub struct UploadControl {
    pub meta: UploadMeta,
    pub cancel: CancellationToken,
    paused: Arc<AtomicBool>,
    remove_partial: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl UploadControl {
    pub fn new(meta: UploadMeta) -> Self {
        Self {
            meta,
            cancel: CancellationToken::new(),
            paused: Arc::new(AtomicBool::new(false)),
            remove_partial: Arc::new(AtomicBool::new(false)),
            notify: Arc::new(Notify::new()),
        }
    }

    pub fn pause(&self) {
        self.paused.store(true, Ordering::SeqCst);
    }

    pub fn resume(&self) {
        self.paused.store(false, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }

    pub fn mark_remove_partial(&self) {
        self.remove_partial.store(true, Ordering::SeqCst);
    }

    pub fn should_remove_partial(&self) -> bool {
        self.remove_partial.load(Ordering::SeqCst)
    }

    pub async fn wait_resume(&self) {
        while self.is_paused() {
            self.notify.notified().await;
        }
    }
}

#[derive(Debug, Clone)]
pub struct UploadRequest {
    pub upload_id: String,
    pub connection_id: String,
    pub local_path: String,
    pub remote_path: String,
}

#[derive(Clone)]
pub struct UploadQueue {
    inner: Arc<Mutex<VecDeque<UploadRequest>>>,
    notify: Arc<Notify>,
}

impl UploadQueue {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(VecDeque::new())),
            notify: Arc::new(Notify::new()),
        }
    }

    pub async fn push(&self, req: UploadRequest) {
        let mut g = self.inner.lock().await;
        g.push_back(req);
        drop(g);
        self.notify.notify_one();
    }

    pub async fn pop(&self) -> UploadRequest {
        loop {
            if let Some(v) = self.inner.lock().await.pop_front() {
                return v;
            }
            self.notify.notified().await;
        }
    }
}

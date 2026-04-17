use tokio::fs::OpenOptions;
use tokio::io::{AsyncWrite, AsyncWriteExt};
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, Notify};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadState {
    Queued,
    Running,
    Paused,
    Done,
    Error,
    Canceled,
}

#[derive(Debug, Clone)]
pub struct DownloadMeta {
    pub connection_id: String,
    pub remote_path: String,
    pub local_path: String,
}

#[derive(Clone)]
pub struct DownloadControl {
    pub meta: DownloadMeta,
    pub cancel: CancellationToken,
    paused: Arc<AtomicBool>,
    remove_partial: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl DownloadControl {
    pub fn new(meta: DownloadMeta) -> Self {
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
pub struct DownloadRequest {
    pub download_id: String,
    pub connection_id: String,
    pub remote_path: String,
    pub local_path: String,
}

#[derive(Clone)]
pub struct DownloadQueue {
    inner: Arc<Mutex<VecDeque<DownloadRequest>>>,
    notify: Arc<Notify>,
}

impl DownloadQueue {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(VecDeque::new())),
            notify: Arc::new(Notify::new()),
        }
    }

    pub async fn push(&self, req: DownloadRequest) {
        let mut g = self.inner.lock().await;
        g.push_back(req);
        drop(g);
        self.notify.notify_one();
    }

    pub async fn pop(&self) -> DownloadRequest {
        loop {
            if let Some(v) = self.inner.lock().await.pop_front() {
                return v;
            }
            self.notify.notified().await;
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteOutcome {
    Completed(usize),
    Paused(usize),
    Canceled(usize),
}

pub async fn write_respecting_control<W: AsyncWrite + Unpin>(
    control: &DownloadControl,
    writer: &mut W,
    buf: &[u8],
) -> Result<WriteOutcome, std::io::Error> {
    const STEP: usize = 64 * 1024;
    let mut written: usize = 0;

    while written < buf.len() {
        if control.cancel.is_cancelled() {
            return Ok(WriteOutcome::Canceled(written));
        }
        if control.is_paused() {
            return Ok(WriteOutcome::Paused(written));
        }
        let end = (written + STEP).min(buf.len());
        writer.write_all(&buf[written..end]).await?;
        written = end;
        tokio::task::yield_now().await;
    }

    Ok(WriteOutcome::Completed(written))
}

pub async fn open_local_for_download(
    path: &str,
    offset: u64,
) -> Result<tokio::fs::File, std::io::Error> {
    let mut opts = OpenOptions::new();

    if offset == 0 {
        let _ = tokio::fs::remove_file(path).await;
        
        opts.create(true)
            .write(true)
            .truncate(true)
            .open(path)
            .await
    } else {
        opts.create(true)
            .write(true)
            .append(true)
            .open(path)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::pin::Pin;
    use std::task::{Context, Poll};
    use tokio::io::AsyncWrite;
    use tokio::io::AsyncWriteExt;
    use tokio::sync::oneshot;

    #[tokio::test]
    async fn download_queue_is_fifo() {
        let q = DownloadQueue::new();
        q.push(DownloadRequest {
            download_id: "d1".to_string(),
            connection_id: "c".to_string(),
            remote_path: "/a".to_string(),
            local_path: "/tmp/a".to_string(),
        })
        .await;
        q.push(DownloadRequest {
            download_id: "d2".to_string(),
            connection_id: "c".to_string(),
            remote_path: "/b".to_string(),
            local_path: "/tmp/b".to_string(),
        })
        .await;

        let a = q.pop().await;
        let b = q.pop().await;
        assert_eq!(a.download_id, "d1");
        assert_eq!(b.download_id, "d2");
    }

    #[tokio::test]
    async fn download_control_pause_resume() {
        let c = DownloadControl::new(DownloadMeta {
            connection_id: "c".to_string(),
            remote_path: "/a".to_string(),
            local_path: "/tmp/a".to_string(),
        });
        assert!(!c.is_paused());
        c.pause();
        assert!(c.is_paused());

        let c2 = c.clone();
        let waiter = tokio::spawn(async move {
            c2.wait_resume().await;
        });

        tokio::task::yield_now().await;
        assert!(!waiter.is_finished());
        c.resume();
        waiter.await.unwrap();
    }

    #[tokio::test]
    async fn open_local_for_download_truncates_when_offset_zero() {
        let p = std::env::temp_dir().join(format!(
            "nas-file-manager-test-{}.bin",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        let p = p.to_string_lossy().to_string();

        tokio::fs::write(&p, b"abc").await.unwrap();
        let mut f = open_local_for_download(&p, 0).await.unwrap();
        f.write_all(b"x").await.unwrap();
        f.flush().await.unwrap();
        drop(f);

        let content = tokio::fs::read(&p).await.unwrap();
        assert_eq!(content, b"x");
        let _ = tokio::fs::remove_file(&p).await;
    }

    #[tokio::test]
    async fn open_local_for_download_appends_when_offset_nonzero() {
        let p = std::env::temp_dir().join(format!(
            "nas-file-manager-test-{}.bin",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        let p = p.to_string_lossy().to_string();

        tokio::fs::write(&p, b"abc").await.unwrap();
        let mut f = open_local_for_download(&p, 3).await.unwrap();
        f.write_all(b"d").await.unwrap();
        f.flush().await.unwrap();
        drop(f);

        let content = tokio::fs::read(&p).await.unwrap();
        assert_eq!(content, b"abcd");
        let _ = tokio::fs::remove_file(&p).await;
    }

    struct NotifyWriter {
        buf: Vec<u8>,
        sent: bool,
        tx: Option<oneshot::Sender<()>>,
    }

    impl NotifyWriter {
        fn new(tx: oneshot::Sender<()>) -> Self {
            Self {
                buf: Vec::new(),
                sent: false,
                tx: Some(tx),
            }
        }
    }

    impl AsyncWrite for NotifyWriter {
        fn poll_write(
            mut self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
            buf: &[u8],
        ) -> Poll<Result<usize, std::io::Error>> {
            if !self.sent {
                self.sent = true;
                if let Some(tx) = self.tx.take() {
                    let _ = tx.send(());
                }
            }
            self.buf.extend_from_slice(buf);
            Poll::Ready(Ok(buf.len()))
        }

        fn poll_flush(
            self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
        ) -> Poll<Result<(), std::io::Error>> {
            Poll::Ready(Ok(()))
        }

        fn poll_shutdown(
            self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
        ) -> Poll<Result<(), std::io::Error>> {
            Poll::Ready(Ok(()))
        }
    }

    #[tokio::test]
    async fn write_respecting_control_stops_when_paused_mid_write() {
        let c = DownloadControl::new(DownloadMeta {
            connection_id: "c".to_string(),
            remote_path: "/a".to_string(),
            local_path: "/tmp/a".to_string(),
        });

        let (tx, rx) = oneshot::channel();
        let mut w = NotifyWriter::new(tx);
        let data = vec![1u8; 256 * 1024];
        let data_len = data.len();

        let c2 = c.clone();
        let handle = tokio::spawn(async move { write_respecting_control(&c2, &mut w, &data).await });

        let _ = rx.await;
        c.pause();

        let res = handle.await.unwrap().unwrap();
        match res {
            WriteOutcome::Paused(n) => assert!(n < data_len),
            _ => panic!("expected paused"),
        }
    }
}

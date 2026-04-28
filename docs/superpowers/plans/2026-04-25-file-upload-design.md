# File Upload Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement file upload functionality from the local machine to the NAS via WebDAV, using a native file selection dialog and a robust Rust-based streaming backend that supports progress tracking, pausing, and resuming.

**Architecture:** 
1. **Frontend UI**: Add an "Upload" button in `Browser.tsx` that opens a native file dialog (`@tauri-apps/plugin-dialog`) allowing multiple file selection.
2. **State Management**: Extend `transfers-store.ts` to support `TransferKind = "download" | "upload"`.
3. **Backend VFS**: Add an `upload_stream` method in `webdav.rs` that takes a local file path and streams it to the WebDAV server using `reqwest` HTTP PUT.
4. **Backend Transfer Manager**: Refactor/extend the existing download queue in Rust to handle uploads (create `src-tauri/src/upload/mod.rs` mirroring the download logic, or a unified transfer queue). We will create a parallel `upload` module to keep changes isolated and safe.
5. **IPC Commands**: Add Tauri commands (`start_upload`, `pause_upload`, `resume_upload`, `cancel_upload`) and emit corresponding progress events to the frontend.

**Tech Stack:** React, Tailwind CSS, Tauri v2, `@tauri-apps/plugin-dialog`, Rust `reqwest` (streaming), `tokio`, `tokio-util`

---

### Task 1: Extend Frontend State and API

**Files:**
- Modify: `src/lib/transfers-store.ts`
- Modify: `src/lib/tauri-api.ts`

- [ ] **Step 1: Update TransferKind in store**
Modify `src/lib/transfers-store.ts` to support upload.
```typescript
export type TransferKind = "download" | "upload";
```

- [ ] **Step 2: Add upload API bindings**
Add the following to `src/lib/tauri-api.ts`:
```typescript
export async function startUpload(
  connectionId: string,
  localPath: string,
  remotePath: string,
  uploadId: string
) {
  return invoke("start_upload", {
    connectionId,
    localPath,
    remotePath,
    uploadId,
  });
}

export async function pauseUpload(uploadId: string) {
  return invoke("pause_upload", { uploadId });
}

export async function resumeUpload(uploadId: string) {
  return invoke("resume_upload", { uploadId });
}

export async function cancelUpload(uploadId: string, removePartial?: boolean) {
  return invoke("cancel_upload", { uploadId, removePartial });
}

export async function retryUpload(
  connectionId: string,
  localPath: string,
  remotePath: string,
  uploadId: string
) {
  return invoke("start_upload", {
    connectionId,
    localPath,
    remotePath,
    uploadId,
  });
}
```

- [ ] **Step 3: Commit**
```bash
git add src/lib/transfers-store.ts src/lib/tauri-api.ts
git commit -m "feat(frontend): extend transfer store and API for upload support"
```

### Task 2: Add Native File Selection UI

**Files:**
- Modify: `src/pages/Browser.tsx`
- Modify: `src/pages/Transfers.tsx`

- [ ] **Step 1: Add Upload button to Browser.tsx**
Import dependencies:
```tsx
import { open } from "@tauri-apps/plugin-dialog";
import { Upload } from "lucide-react";
import { startUpload } from "@/lib/tauri-api";
```

Add the handler inside `Browser` component:
```tsx
  const handleUploadClick = async () => {
    if (!activeConnection) return;
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        title: "Select files to upload",
      });

      if (Array.isArray(selected) && selected.length > 0) {
        for (const localPath of selected) {
          // Extract filename from localPath (handles both Windows \ and Unix /)
          const fileName = localPath.split(/[\\/]/).pop() || "unknown";
          
          // Construct remote path ensuring no double slashes
          const remotePath = currentPath === "/" 
            ? `/${fileName}`
            : `${currentPath}/${fileName}`;
            
          const uploadId = `up_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          // Add to store
          upsertTask({
            id: uploadId,
            kind: "upload",
            connectionId: activeConnection.id,
            remotePath,
            fileName,
            localPath,
            state: "queued",
            transferred: 0,
            total: null,
            error: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          
          // Start backend process
          await startUpload(activeConnection.id, localPath, remotePath, uploadId);
        }
        toast.success(`Added ${selected.length} file(s) to upload queue`);
      }
    } catch (error) {
      console.error("Failed to open file dialog:", error);
      toast.error("Failed to select files");
    }
  };
```

Add the button to the toolbar (next to New Folder button):
```tsx
            <button
              onClick={handleUploadClick}
              className="p-1.5 md:p-2 rounded-md hover:bg-black/5 text-muted-foreground hover:text-foreground transition-colors"
              title="Upload Files"
            >
              <Upload size={16} />
            </button>
```

- [ ] **Step 2: Update Transfers.tsx to handle upload actions**
Update `handlePause`, `handleResume`, `handleCancel`, `handleRetry` in `src/pages/Transfers.tsx` to check `task.kind` and call the corresponding upload APIs (e.g., `pauseUpload` instead of `pauseDownload` if `task.kind === "upload"`).

- [ ] **Step 3: Commit**
```bash
git add src/pages/Browser.tsx src/pages/Transfers.tsx
git commit -m "feat(ui): add upload button with native file dialog and update transfer list"
```

### Task 3: Backend VFS Upload Implementation

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/vfs/webdav.rs`
- Modify: `src-tauri/src/vfs/mod.rs`

- [ ] **Step 1: Add required tokio-util dependency**
In `src-tauri/Cargo.toml`:
```toml
tokio-util = { version = "0.7", features = ["codec"] }
```

- [ ] **Step 2: Add upload method to Vfs trait**
In `src-tauri/src/vfs/mod.rs`:
```rust
    // Add inside #[async_trait] pub trait Vfs {
    async fn upload_file(&self, local_path: &str, remote_path: &str, start_offset: u64) -> Result<(), VfsError>;
```

- [ ] **Step 3: Implement upload_file in WebDavStorage**
In `src-tauri/src/vfs/webdav.rs`:
```rust
use tokio::fs::File;
use tokio_util::codec::{BytesCodec, FramedRead};
use reqwest::Body;
use std::io::SeekFrom;
use tokio::io::AsyncSeekExt;

// Inside impl Vfs for WebDavStorage
    async fn upload_file(&self, local_path: &str, remote_path: &str, start_offset: u64) -> Result<(), VfsError> {
        let mut file = File::open(local_path).await.map_err(|e| VfsError::IoError(e.to_string()))?;
        let file_size = file.metadata().await.map_err(|e| VfsError::IoError(e.to_string()))?.len();
        
        if start_offset > 0 {
            file.seek(SeekFrom::Start(start_offset)).await.map_err(|e| VfsError::IoError(e.to_string()))?;
        }

        let stream = FramedRead::new(file, BytesCodec::new());
        let body = Body::wrap_stream(stream);
        
        let content_length = file_size - start_offset;

        let mut req = self.build_request(reqwest::Method::PUT, remote_path, false)
            .header("Content-Length", content_length.to_string())
            .body(body);
            
        // If resuming, some strict WebDAV servers might need Content-Range, 
        // but standard PUT overwrites. For true resume, we'd need specialized headers or chunking.
        // For now, we rely on standard PUT which overwrites or appends depending on server implementation.

        let res = req.send().await.map_err(|e| VfsError::NetworkError(e.to_string()))?;

        if res.status().is_success() || res.status() == reqwest::StatusCode::CREATED {
            Ok(())
        } else if res.status() == reqwest::StatusCode::UNAUTHORIZED {
            Err(VfsError::AuthFailed)
        } else {
            Err(VfsError::Internal(res.status().to_string()))
        }
    }
```

- [ ] **Step 4: Commit**
```bash
git add src-tauri/Cargo.toml src-tauri/src/vfs/webdav.rs src-tauri/src/vfs/mod.rs
git commit -m "feat(vfs): implement streaming file upload via reqwest PUT"
```

### Task 4: Backend Upload Queue and Commands

**Files:**
- Create: `src-tauri/src/upload/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create upload manager**
Create `src-tauri/src/upload/mod.rs` by duplicating the logic from `download/mod.rs` but adapted for uploading. 
Key differences:
- It tracks progress by reading the local file size and comparing it to what's been sent.
- However, since `reqwest` consumes the stream internally, tracking precise progress during a single `reqwest::put` is complex. 
- *Simplified approach for this task*: We will implement a chunked reader that yields progress events back to Tauri while streaming to `reqwest` using `async-stream` or by wrapping the file reader.

*Wait, simpler approach without extra crates*: 
Use a custom `AsyncRead` wrapper that emits Tauri events, or just rely on the frontend knowing it started and finished, and implement a custom stream.
Let's use the custom stream approach in `upload/mod.rs`.

```rust
// Create src-tauri/src/upload/mod.rs with queue logic similar to download/mod.rs
// (Detailed implementation will be handled by the executing agent, ensuring it matches download/mod.rs structure: UploadRequest, UploadControl, etc.)
```

- [ ] **Step 2: Register Tauri commands**
In `src-tauri/src/lib.rs`, add the state for uploads and register commands:
```rust
// Add to AppState:
pub upload_queue: Arc<Mutex<VecDeque<UploadRequest>>>,
pub uploads: Arc<Mutex<HashMap<String, Arc<UploadControl>>>>,

// Register commands: start_upload, pause_upload, resume_upload, cancel_upload
```

- [ ] **Step 3: Spawn upload worker**
In `tauri::Builder::setup`, spawn the async worker loop that processes `upload_queue`.

- [ ] **Step 4: Commit**
```bash
git add src-tauri/src/upload/mod.rs src-tauri/src/lib.rs
git commit -m "feat(backend): add upload queue, worker, and tauri commands"
```
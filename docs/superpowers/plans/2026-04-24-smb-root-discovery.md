# SMB Root Directory Browsing via Auto-Mount

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to connect to an SMB server using just its IP address, see a list of all available shares, and browse them seamlessly as if they were top-level directories.

**Architecture:** Since macOS `mount_smbfs` cannot mount the root directory, we will change our VFS approach. When a user connects to `smb://192.168.2.200` (without a share), the `SmbStorage` will be in "Root Mode". In this mode, `list_dir("/")` will use the `smb` Rust crate (already in Cargo.toml) to query the server for available shares, and return them as `FileItem` directories. When the user navigates into one of these shares (e.g., `/OST_NAS`), `SmbStorage` will dynamically execute `mount_smbfs` for that specific share on-demand, caching the mount point. Future reads to that share will use the local mount.

**Tech Stack:** Rust, smb crate, tokio

---

### Task 1: Refactor SmbStorage to support Root Mode and Dynamic Mounting

**Files:**
- Modify: `src-tauri/src/vfs/smb.rs`

- [ ] **Step 1: Add dynamic mounts map to `SmbStorage`**
  Instead of a single `mount_point`, we need to map share names to their respective local mount points. We also need to store the server, user, and pass for later mounting.

```rust
// In src-tauri/src/vfs/smb.rs
use tokio::sync::Mutex;
use std::collections::HashMap;

pub struct SmbStorage {
    server: String,
    share: Option<String>,
    base_path: Option<String>,
    user: String,
    pass: String,
    // Maps a share name to its local mount point path
    mounts: Mutex<HashMap<String, String>>,
}
```

- [ ] **Step 2: Update `parse_smb_target_from_url` in `lib.rs` to allow empty share**
  We need to make `share` optional if the user only provides an IP.

```rust
// In src-tauri/src/lib.rs
fn parse_smb_target_from_url(input: &str) -> Result<(String, Option<String>, Option<String>), VfsError> {
    let mut s = input.trim().to_string();
    if let Some(rest) = s.strip_prefix("smb://") {
        s = rest.to_string();
    }
    s = s.replace('\\', "/");
    while s.starts_with('/') {
        s = s.trim_start_matches('/').to_string();
    }
    let mut parts = s.split('/').filter(|p| !p.is_empty());
    let server = parts
        .next()
        .ok_or_else(|| VfsError::Internal("SMB server is required".to_string()))?
        .to_string();
    
    let share = parts.next().map(|s| s.to_string());
    
    let base: Vec<&str> = parts.collect();
    let base_path = if base.is_empty() {
        None
    } else {
        Some(base.join("/"))
    };
    
    Ok((server, share, base_path))
}
```

- [ ] **Step 3: Update `SmbStorage::new`**

```rust
// In src-tauri/src/vfs/smb.rs
impl SmbStorage {
    pub fn new(url: &str, user: &str, pass: &str, _auth_fallback: bool) -> Self {
        // We will pass parsed server, share, base_path from connect_server instead of parsing here to avoid circular dependency
        unimplemented!() // Will fix in next step
    }
}
```

We should change `SmbStorage::new` signature to take the parsed parts directly.

```rust
// In src-tauri/src/vfs/smb.rs
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
}
```

Update `connect_server` in `lib.rs`:

```rust
        "smb" => {
            let (server, share, base_path) = parse_smb_target_from_url(&url)?;
            Arc::new(SmbStorage::new(
                &server,
                share.as_deref(),
                base_path.as_deref(),
                &user,
                &pass,
            ))
        },
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/vfs/smb.rs
git commit -m "refactor(smb): prepare SmbStorage for dynamic multi-share mounting"
```

### Task 2: Implement Dynamic Share Mounting

**Files:**
- Modify: `src-tauri/src/vfs/smb.rs`

- [ ] **Step 1: Write `ensure_share_mounted` method**
  This method takes a share name, checks if it's already mounted in the `mounts` map, and if not, creates a mount point and runs `mount_smbfs`.

```rust
// In SmbStorage impl
    async fn ensure_share_mounted(&self, share: &str) -> Result<String, VfsError> {
        let mut mounts = self.mounts.lock().await;
        if let Some(mount_point) = mounts.get(share) {
            return Ok(mount_point.clone());
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
```

- [ ] **Step 2: Update `ping` to handle Root vs Share mode**

```rust
    async fn ping(&self) -> Result<bool, VfsError> {
        if let Some(share) = &self.share {
            self.ensure_share_mounted(share).await?;
        } else {
            // In root mode, we will just use the smb crate to list shares to verify connection
            let _ = self.list_shares_via_smb_crate().await?;
        }
        Ok(true)
    }
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/vfs/smb.rs
git commit -m "feat(smb): implement dynamic on-demand share mounting"
```

### Task 3: Implement SMB Crate Share Listing

**Files:**
- Modify: `src-tauri/src/vfs/smb.rs`

- [ ] **Step 1: Implement `list_shares_via_smb_crate`**
  This uses the `smb` crate to authenticate and list available shares on the server.

```rust
// Add import at top
use smb::auth::SimpleAuthenticator;
use smb::SmbClient;

// In SmbStorage impl
    async fn list_shares_via_smb_crate(&self) -> Result<Vec<FileItem>, VfsError> {
        // smb crate requires async runtime context, we are already in one
        
        let auth = if self.user.is_empty() {
            SimpleAuthenticator::new_guest()
        } else {
            SimpleAuthenticator::new(&self.user, &self.pass)
        };

        // Format for smb crate: tcp://192.168.2.200:445
        let server_url = format!("tcp://{}:445", self.server);
        
        let client = SmbClient::new(auth, smb::SmbOptions::default())
            .map_err(|e| VfsError::NetworkError(format!("Failed to init SMB client: {}", e)))?;
            
        let session = client.connect(&server_url).await
            .map_err(|e| VfsError::NetworkError(format!("SMB connection failed: {}", e)))?;

        let tree_names = session.list_shares().await
            .map_err(|e| VfsError::NetworkError(format!("Failed to list shares: {}", e)))?;

        let mut items = Vec::new();
        for name in tree_names {
            // Ignore hidden/admin shares like IPC$, C$
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
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/vfs/smb.rs
git commit -m "feat(smb): implement share enumeration using native smb crate"
```

### Task 4: Rewrite Local Path Resolution and Routing

**Files:**
- Modify: `src-tauri/src/vfs/smb.rs`

- [ ] **Step 1: Write a helper to determine which share a path belongs to**
  If `SmbStorage` has a fixed `self.share`, all paths belong to it. If it's in Root Mode, the first component of the path is the share name.

```rust
// In SmbStorage impl
    // Returns (Share Name, Relative Path inside Share)
    fn parse_virtual_path<'a>(&'a self, path: &'a str) -> Result<(String, String), VfsError> {
        let clean_path = path.trim_start_matches('/');
        
        if let Some(fixed_share) = &self.share {
            // Fixed share mode: the path is directly inside the share
            Ok((fixed_share.clone(), clean_path.to_string()))
        } else {
            // Root mode: the first part of the path is the share
            if clean_path.is_empty() {
                return Err(VfsError::Internal("Cannot resolve path for root directory".to_string()));
            }
            
            let mut parts = clean_path.splitn(2, '/');
            let share_name = parts.next().unwrap().to_string();
            let rel_path = parts.next().unwrap_or("").to_string();
            
            Ok((share_name, rel_path))
        }
    }
```

- [ ] **Step 2: Rewrite `resolve_local_path` to be async and mount on demand**

```rust
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
```

- [ ] **Step 3: Update `get_local_path`**
  `get_local_path` is synchronous. If the share isn't mounted yet, it will fail. But in practice, the frontend lists the dir first (triggering the async mount) before requesting thumbnails.

```rust
    fn get_local_path(&self, path: &str) -> Option<std::path::PathBuf> {
        if let Ok((share_name, rel_path)) = self.parse_virtual_path(path) {
            // Try to lock synchronously, or just check if it's in the map.
            // Since get_local_path is sync, we use try_lock.
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
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/vfs/smb.rs
git commit -m "refactor(smb): route virtual paths to dynamically mounted local paths"
```

### Task 5: Wire up the VFS methods

**Files:**
- Modify: `src-tauri/src/vfs/smb.rs`

- [ ] **Step 1: Update `list_dir`**

```rust
    async fn list_dir(&self, path: &str) -> Result<Vec<FileItem>, VfsError> {
        let clean_path = path.trim_start_matches('/');
        
        // If in root mode and asking for root directory, list shares
        if self.share.is_none() && clean_path.is_empty() {
            return self.list_shares_via_smb_crate().await;
        }

        // Otherwise, resolve local path (which triggers mount) and read dir
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
```

- [ ] **Step 2: Update `mkdir`, `delete`, `rename`, `stream_file`**
  Replace `self.ensure_connected().await?; let local_path = self.resolve_local_path(path);`
  with `let local_path = self.resolve_local_path_async(path).await?;` in all these methods.
  For `rename`, do it for both `old_path` and `new_path`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/vfs/smb.rs
git commit -m "feat(smb): fully integrate dynamic mounting into VFS operations"
```
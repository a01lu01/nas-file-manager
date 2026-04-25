# macOS Native AppleScript SMB Mounting

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the problematic `mount_smbfs` shell command with an AppleScript-based approach to leverage macOS's native GUI-level SMB mounting system, which naturally handles root discovery, Share selection, and Chinese characters without strict URL formatting or hidden local mount point creation.

**Architecture:** Instead of manually creating `/tmp/nas_mount_xxxx` and calling `mount_smbfs`, we will use `osascript` to trigger `mount volume "smb://user:pass@server/share"`. macOS automatically mounts this in `/Volumes/ShareName`. We will then use `/Volumes/ShareName` as our local `mount_point` for all VFS operations. If no share is provided, `mount volume` will natively prompt the user with the Finder share selection dialog.

**Tech Stack:** Rust, macOS AppleScript (`osascript`)

---

### Task 1: Update SmbStorage to use AppleScript Mounting

**Files:**
- Modify: `src-tauri/src/vfs/smb.rs`

- [ ] **Step 1: Remove the temporary UUID mount point logic**
In `SmbStorage::new`, we don't know the final `/Volumes/...` mount point until after it mounts. But since we require the user to provide a share, we can predict it: `/Volumes/ShareName`. Wait, the user said Finder doesn't like direct Chinese share names either in `smb://`. Let's test the `osascript` approach. Actually, `osascript -e 'mount volume "smb://user:pass@192.168.2.200"'` without a share will pop up the native Finder dialog to select a share! If they select "临时空间", it mounts at `/Volumes/临时空间`.
But our VFS needs a fixed `mount_point` string. If we don't know what they picked, it's hard to track.
Let's stick to requiring the share in the URL, but use AppleScript to mount it.
If `share` is "临时空间", `mount volume "smb://192.168.2.200/临时空间"` actually works perfectly in AppleScript because it delegates to Finder, which handles the encoding internally.

```rust
// In src-tauri/src/vfs/smb.rs
impl SmbStorage {
    pub fn new(server: &str, share: Option<&str>, base_path: Option<&str>, user: &str, pass: &str, _auth_fallback: bool) -> Self {
        // macOS natively mounts shares in /Volumes/<ShareName>
        let share_name = share.unwrap_or("").to_string();
        
        // If the share has spaces or special chars, macOS might append "-1" etc. if there's a collision.
        // For simplicity, we assume /Volumes/ShareName.
        let mount_point = if share_name.is_empty() {
            String::new() // Invalid state, will be caught in ensure_connected
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
```

- [ ] **Step 2: Rewrite `ensure_connected` to use `osascript`**

```rust
    async fn ensure_connected(&self) -> Result<(), VfsError> {
        if self.share.is_empty() {
            return Err(VfsError::NetworkError("For macOS native SMB connection, a Share Name must be specified in the URL (e.g. 192.168.2.200/ShareName).".to_string()));
        }

        // Check if it's already mounted in /Volumes/ShareName
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
            // Use AppleScript to mount via Finder, which is much more robust
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
            
            // Wait a brief moment for the mount point to appear in /Volumes
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            
            if !std::path::Path::new(&self.mount_point).exists() {
                return Err(VfsError::NetworkError(format!("Mount succeeded but could not find volume at {}", self.mount_point)));
            }
        }

        Ok(())
    }
```

- [ ] **Step 3: Remove custom Drop trait unmounting**
Since we are using the native `/Volumes/` mount, we shouldn't forcibly unmount it when the app closes, because the user might be using it in Finder. Or, if we do unmount it, we should use `diskutil unmount`. Let's remove the `Drop` trait entirely so it behaves like a standard macOS network drive connection.

```rust
// Delete the entire impl Drop for SmbStorage block
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/vfs/smb.rs
git commit -m "feat(smb): replace mount_smbfs with robust native osascript mount volume command"
```
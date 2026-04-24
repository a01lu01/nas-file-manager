# SMB Subfolder Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to specify a subfolder path when connecting to an SMB server, enabling connections to specific directories without requiring the root share to be the only mount point.

**Architecture:** We will modify the frontend to include a "Share / Path" field instead of just "URL". The backend `parse_smb_target` will be updated to extract the share name and any subsequent sub-paths. The `mount_smbfs` command will mount the share, and the `Storage` trait will store the sub-path as a base offset.

**Tech Stack:** React, Tailwind CSS, Rust, Tauri API

---

### Task 1: Update Frontend Connection Form

**Files:**
- Modify: `src/pages/Home.tsx`

- [ ] **Step 1: Update the "URL / Path" input placeholder and label**
  Change the label to clarify that it expects `server/share/subfolder`.

```tsx
// Find the URL input field in Home.tsx
<div className="space-y-1.5">
  <label className="text-sm font-medium text-foreground">Server Path</label>
  <input 
    type="text" 
    value={formData.url}
    onChange={(e) => setFormData({...formData, url: e.target.value})}
    placeholder={formData.protocol === "smb" ? "e.g. 192.168.2.200/ShareName/Subfolder" : "e.g. http://192.168.2.200:5005/webdav"} 
    className="w-full bg-background border border-border-standard rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/50 transition-colors"
  />
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Home.tsx
git commit -m "feat(ui): update connection form to clarify SMB path format"
```

### Task 2: Update Backend SMB URL Parsing

**Files:**
- Modify: `src-tauri/src/vfs/smb.rs`

- [ ] **Step 1: Modify `parse_smb_target` to extract share and sub-path**
  The input might be `server/share/subfolder/path`. We need to extract `server`, `share`, and the rest as `base_path`.

```rust
// In src-tauri/src/vfs/smb.rs, find parse_smb_target
fn parse_smb_target(input: &str) -> (String, String, Option<String>) {
    let clean = input.trim_start_matches("smb://").trim_end_matches('/');
    
    if let Some(idx) = clean.find('/') {
        let server = clean[..idx].to_string();
        let rest = &clean[idx + 1..];
        
        if let Some(share_idx) = rest.find('/') {
            let share = rest[..share_idx].to_string();
            let base_path = rest[share_idx + 1..].to_string();
            (server, share, Some(base_path))
        } else {
            (server, rest.to_string(), None)
        }
    } else {
        (clean.to_string(), String::new(), None)
    }
}
```

- [ ] **Step 2: Add `base_path` field to `SmbStorage` struct**

```rust
pub struct SmbStorage {
    pub server: String,
    pub share: String,
    pub user: String,
    pub pass: String,
    pub base_path: Option<String>,
    // ... other fields
}
```

- [ ] **Step 3: Update `SmbStorage::new` to initialize `base_path`**

```rust
impl SmbStorage {
    pub fn new(url: &str, user: &str, pass: &str) -> Result<Self, VfsError> {
        let (server, share, base_path) = parse_smb_target(url);
        // ...
        Ok(Self {
            server,
            share,
            user: user.to_string(),
            pass: pass.to_string(),
            base_path,
            // ...
        })
    }
}
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/vfs/smb.rs
git commit -m "feat(smb): parse and store subfolder path from connection URL"
```

### Task 3: Apply Subfolder Offset in SMB Operations

**Files:**
- Modify: `src-tauri/src/vfs/smb.rs`

- [ ] **Step 1: Modify `resolve_local_path` to include `base_path`**

```rust
// In src-tauri/src/vfs/smb.rs
    fn resolve_local_path(&self, remote_path: &str) -> std::path::PathBuf {
        let mut path = self.local_mount_point();
        
        // Apply base_path offset if configured
        if let Some(base) = &self.base_path {
            path.push(base);
        }
        
        let clean_remote = remote_path.trim_start_matches('/');
        if !clean_remote.is_empty() {
            path.push(clean_remote);
        }
        path
    }
```

- [ ] **Step 2: Ensure `mount_smbfs` only mounts the share**
  The mounting logic is already correct, it uses `self.server` and `target_share`. It does not include `self.base_path` in the `mount_url`, which is exactly what we want.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/vfs/smb.rs
git commit -m "feat(smb): apply base_path offset to all local path resolutions"
```
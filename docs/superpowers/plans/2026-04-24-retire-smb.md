# Retire SMB and Focus on WebDAV

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the problematic SMB protocol implementation from the codebase to focus entirely on WebDAV, which provides superior cross-platform compatibility and stability without relying on OS-level mounting quirks.

**Architecture:** We will delete `src-tauri/src/vfs/smb.rs`, remove SMB-related routing in `lib.rs`, and update the frontend UI to remove SMB from the protocol selection options, making WebDAV the sole and default protocol.

**Tech Stack:** Rust, React, Tauri

---

### Task 1: Remove SMB Backend Code

**Files:**
- Delete: `src-tauri/src/vfs/smb.rs`
- Modify: `src-tauri/src/vfs/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Delete the `smb.rs` file**

```bash
rm src-tauri/src/vfs/smb.rs
```

- [ ] **Step 2: Remove SMB module from `vfs/mod.rs`**

```rust
// In src-tauri/src/vfs/mod.rs
// Remove:
// pub mod smb;
```

- [ ] **Step 3: Remove SMB routing from `lib.rs`**

```rust
// In src-tauri/src/lib.rs
// Remove the `parse_smb_target_from_url` function entirely.

// Inside the `connect_server` function, remove the SMB match branch:
//        "smb" => { ... }
// And make sure to handle unsupported protocols:
        _ => return Err(format!("Unsupported protocol: {}", protocol)),
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/vfs/mod.rs src-tauri/src/lib.rs src-tauri/src/vfs/smb.rs
git commit -m "refactor(backend): remove SMB protocol implementation to focus on WebDAV"
```

### Task 2: Update Frontend UI

**Files:**
- Modify: `src/pages/Home.tsx`

- [ ] **Step 1: Remove SMB from Protocol selection**

```tsx
// In src/pages/Home.tsx
// Find the protocol select dropdown and remove the SMB option
// Default to WebDAV
const [formData, setFormData] = useState<ConnectionFormData>({
    name: "",
    protocol: "webdav", // Change default from smb to webdav
    url: "",
    username: "",
    password: "",
});

// In the UI:
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Protocol</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData({...formData, protocol: "webdav"})}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                      formData.protocol === "webdav" 
                        ? "bg-primary text-primary-foreground border-primary" 
                        : "bg-background text-muted-foreground border-border-standard hover:bg-surface-hover"
                    }`}
                  >
                    WebDAV
                  </button>
                  {/* Remove the SMB button entirely */}
                </div>
              </div>
```

- [ ] **Step 2: Update the URL placeholder**

```tsx
// Change the placeholder logic since protocol is now always webdav
                <input 
                  type="text" 
                  value={formData.url}
                  onChange={(e) => setFormData({...formData, url: e.target.value})}
                  placeholder="e.g. http://192.168.2.200:5005/webdav" 
                  className="w-full bg-background border border-border-standard rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/50 transition-colors"
                />
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/Home.tsx
git commit -m "refactor(ui): remove SMB option and make WebDAV the default protocol"
```
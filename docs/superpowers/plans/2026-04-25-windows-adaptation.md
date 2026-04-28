# Windows Platform Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt the application for the Windows platform by adding proper native window controls (minimize, maximize, close) since the app uses a custom titlebar (`decorations: false`), and dynamically rendering the correct UI style based on the operating system (macOS traffic lights on the left vs Windows controls on the right).

**Architecture:** 
1. Install and configure the Tauri window plugin (`@tauri-apps/plugin-window` and `tauri-plugin-window`) to programmatically control the window state.
2. Create a unified `<Titlebar />` React component to replace the hardcoded macOS traffic lights across all pages (`Home.tsx`, `Browser.tsx`, `Transfers.tsx`).
3. Use Tauri's OS detection API (`type()`) to determine the current platform and render the appropriate window controls and layout.

**Tech Stack:** React, Tailwind CSS, Tauri v2, `@tauri-apps/plugin-window`, `@tauri-apps/plugin-os`

---

### Task 1: Install Required Tauri Plugins

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Install frontend dependencies**

```bash
npm install @tauri-apps/plugin-window @tauri-apps/plugin-os
```

- [ ] **Step 2: Install backend dependencies**

```bash
cd src-tauri && cargo add tauri-plugin-window tauri-plugin-os && cd ..
```

- [ ] **Step 3: Register plugins in Rust backend**

```rust
// In src-tauri/src/lib.rs
// Find the tauri::Builder::default() block around line 456
// Modify it to include the new plugins:
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(LevelFilter::Info)
                .level_for("smb", LevelFilter::Debug)
                .level_for("smb_transport", LevelFilter::Debug)
                .level_for("app_lib", LevelFilter::Debug)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window::init()) // Add this line
        .plugin(tauri_plugin_os::init())     // Add this line
        .manage(AppState::default())
```

- [ ] **Step 4: Update Tauri Permissions**

```bash
// Create or update capability files to allow window controls and OS detection
mkdir -p src-tauri/capabilities
```

Create `src-tauri/capabilities/window.json`:
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "window-controls",
  "description": "Allow window controls",
  "windows": ["main"],
  "permissions": [
    "window:allow-close",
    "window:allow-minimize",
    "window:allow-toggle-maximize",
    "os:allow-type"
  ]
}
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/window.json
git commit -m "feat(tauri): add window and os plugins for cross-platform support"
```

### Task 2: Create a Cross-Platform Titlebar Component

**Files:**
- Create: `src/components/Titlebar.tsx`

- [ ] **Step 1: Create the Titlebar component**

Create `src/components/Titlebar.tsx` with logic to detect the OS and render appropriate controls.

```tsx
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/plugin-window";
import { type } from "@tauri-apps/plugin-os";
import { Moon, Sun, HardDrive, Minus, Square, X } from "lucide-react";
import { useTheme } from "next-themes";

interface TitlebarProps {
  title?: string;
  showIcon?: boolean;
}

export function Titlebar({ title = "NAS File Manager", showIcon = false }: TitlebarProps) {
  const { theme, setTheme } = useTheme();
  const [osType, setOsType] = useState<string>("macos");

  useEffect(() => {
    // Detect OS
    type().then((t) => setOsType(t)).catch(console.error);
  }, []);

  const handleMinimize = async () => {
    const appWindow = getCurrentWindow();
    await appWindow.minimize();
  };

  const handleToggleMaximize = async () => {
    const appWindow = getCurrentWindow();
    await appWindow.toggleMaximize();
  };

  const handleClose = async () => {
    const appWindow = getCurrentWindow();
    await appWindow.close();
  };

  const isMac = osType === "macos";

  return (
    <div data-tauri-drag-region className="titlebar h-10 w-full flex items-center justify-between px-4 border-b border-border-standard bg-panel select-none">
      {/* Left section: Mac controls or Title (Windows) */}
      <div data-tauri-drag-region className="flex items-center gap-2 h-full">
        {isMac ? (
          <div className="flex gap-2 titlebar-button items-center h-full group">
            <button onClick={handleClose} className="w-3 h-3 rounded-full bg-red-500/80 border border-red-600/50 hover:bg-red-500 transition-colors flex items-center justify-center">
              <X size={8} className="text-black/60 opacity-0 group-hover:opacity-100" />
            </button>
            <button onClick={handleMinimize} className="w-3 h-3 rounded-full bg-yellow-500/80 border border-yellow-600/50 hover:bg-yellow-500 transition-colors flex items-center justify-center">
              <Minus size={8} className="text-black/60 opacity-0 group-hover:opacity-100" />
            </button>
            <button onClick={handleToggleMaximize} className="w-3 h-3 rounded-full bg-green-500/80 border border-green-600/50 hover:bg-green-500 transition-colors flex items-center justify-center">
              <Square size={6} className="text-black/60 opacity-0 group-hover:opacity-100" />
            </button>
          </div>
        ) : null}
        
        {!isMac && showIcon && <HardDrive size={14} className="text-primary pointer-events-none" />}
        {!isMac && <div className="text-xs font-medium text-foreground pointer-events-none">{title}</div>}
      </div>

      {/* Center section: Title (Mac only) */}
      {isMac && (
        <div data-tauri-drag-region className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 pointer-events-none absolute left-1/2 -translate-x-1/2">
          {showIcon && <HardDrive size={12} className="text-primary" />}
          {title}
        </div>
      )}

      {/* Right section: Theme toggle and Windows controls */}
      <div className="flex items-center gap-2 h-full">
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="p-1.5 rounded-md hover:bg-ghost text-muted-foreground hover:text-foreground transition-colors titlebar-button"
          title="Toggle Theme"
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        {!isMac && (
          <div className="flex h-full -mr-4 ml-2 titlebar-button">
            <button onClick={handleMinimize} className="h-full px-3 hover:bg-ghost text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center">
              <Minus size={16} />
            </button>
            <button onClick={handleToggleMaximize} className="h-full px-3 hover:bg-ghost text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center">
              <Square size={14} />
            </button>
            <button onClick={handleClose} className="h-full px-3 hover:bg-red-500 hover:text-white text-muted-foreground transition-colors flex items-center justify-center">
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Titlebar.tsx
git commit -m "feat(ui): create cross-platform Titlebar component"
```

### Task 3: Replace Hardcoded Titlebars Across Pages

**Files:**
- Modify: `src/pages/Home.tsx`
- Modify: `src/pages/Browser.tsx`
- Modify: `src/pages/Transfers.tsx`

- [ ] **Step 1: Update Home.tsx**

```tsx
// In src/pages/Home.tsx
// Add import:
import { Titlebar } from "@/components/Titlebar";

// Replace lines 171-189 (the entire titlebar div) with:
      {/* Custom Titlebar Region */}
      <Titlebar />
```

- [ ] **Step 2: Update Browser.tsx**

```tsx
// In src/pages/Browser.tsx
// Add import:
import { Titlebar } from "@/components/Titlebar";

// Replace lines 1063-1084 (the entire titlebar div) with:
      {/* Titlebar */}
      <Titlebar title={activeConnection.name} showIcon={true} />
```

- [ ] **Step 3: Update Transfers.tsx**

```tsx
// In src/pages/Transfers.tsx
// Add import:
import { Titlebar } from "@/components/Titlebar";

// Replace the titlebar div with:
      <Titlebar title="Transfer Manager" showIcon={false} />
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/Home.tsx src/pages/Browser.tsx src/pages/Transfers.tsx
git commit -m "refactor(ui): apply cross-platform Titlebar across all pages"
```
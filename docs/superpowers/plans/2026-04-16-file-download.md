# 文件下载（WebDAV 优先）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在桌面与 Android 上实现“下载单个文件到本地”，提供传输页展示进度，并支持取消/重试/暂停/继续（WebDAV 优先）。

**Architecture:** 前端负责选择保存路径与展示传输任务；后端负责流式下载与本地写文件，通过事件回传进度/状态。第一版使用队列（单 worker）并为 WebDAV 实现 Range 断点续传，SMB 暂不支持下载。

**Tech Stack:** React 18 + react-router-dom 7 + Zustand；Tauri v2（Rust, tokio, reqwest）；Tauri dialog plugin（保存对话框）。

---

## Files Overview

**Frontend**
- Modify: [Browser.tsx](file:///Users/hongyu/%E5%B7%A5%E4%BD%9C/nas-file-manager/src/pages/Browser.tsx)
- Modify: [App.tsx](file:///Users/hongyu/%E5%B7%A5%E4%BD%9C/nas-file-manager/src/App.tsx)
- Modify: [store.ts](file:///Users/hongyu/%E5%B7%A5%E4%BD%9C/nas-file-manager/src/lib/store.ts)（新增 transfers store 或新增独立 store 文件）
- Modify/Create: `src/pages/Transfers.tsx`
- Modify: `src/lib/tauri-api.ts`（新增下载相关 API）
- Create: `src/lib/transfers-store.ts`（推荐：避免 store.ts 变大）

**Rust / Tauri**
- Modify: [lib.rs](file:///Users/hongyu/%E5%B7%A5%E4%BD%9C/nas-file-manager/src-tauri/src/lib.rs)（新增 commands、下载管理器）
- Modify/Create: `src-tauri/src/download/mod.rs`（下载队列、任务状态、控制接口）
- Modify: `src-tauri/src/vfs/mod.rs`（为下载补充必要接口，或由 download 模块直接针对 webdav 实现）
- Modify: `src-tauri/src/vfs/webdav.rs`（WebDAV Range 下载）
- Modify: `src-tauri/Cargo.toml`（如需新增依赖：uuid、tokio-util 等）

**Docs**
- Update: `prd.md`、`README.md`（补充“下载/传输页”说明，完成后更新）

---

## Task 1: 引入“保存对话框”能力（桌面 + Android）

**Files:**
- Modify: `/Users/hongyu/工作/nas-file-manager/package.json`
- Modify: `/Users/hongyu/工作/nas-file-manager/src-tauri/Cargo.toml`
- Modify: `/Users/hongyu/工作/nas-file-manager/src-tauri/src/lib.rs`

- [ ] **Step 1: 确认当前是否已有 dialog 插件**

Run:
```bash
cat package.json | sed -n '1,120p'
cat src-tauri/Cargo.toml | sed -n '1,120p'
```

Expected:
- 前端 dependencies 中暂无 `@tauri-apps/plugin-dialog`
- Rust dependencies 中暂无 `tauri-plugin-dialog`

- [ ] **Step 2: 添加前端 dialog 插件依赖**

Edit `package.json`：
- 添加依赖：`@tauri-apps/plugin-dialog`（版本与 `@tauri-apps/api` 同主版本，建议 `^2.10.1`）

- [ ] **Step 3: 添加 Rust dialog 插件依赖并注册**

Edit `src-tauri/Cargo.toml`：
- 添加依赖：`tauri-plugin-dialog = "2"`

Edit `src-tauri/src/lib.rs`：
- 在 `tauri::Builder::default()` 链上 `.plugin(tauri_plugin_dialog::init())`

- [ ] **Step 4: 验证构建**

Run:
```bash
npm run build
PATH=$PATH:~/.cargo/bin cargo check
```

Expected:
- 两个命令均成功

---

## Task 2: 前端“传输任务”数据结构与 store

**Files:**
- Create: `/Users/hongyu/工作/nas-file-manager/src/lib/transfers-store.ts`
- Modify: `/Users/hongyu/工作/nas-file-manager/src/lib/store.ts`（如需连接 store 与 transfers store）

- [ ] **Step 1: 定义状态与类型（先写最小可用）**

Create `src/lib/transfers-store.ts`：
```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TransferState =
  | "queued"
  | "running"
  | "paused"
  | "done"
  | "error"
  | "canceled";

export type TransferKind = "download";

export interface TransferTask {
  id: string;
  kind: TransferKind;
  connectionId: string;
  remotePath: string;
  fileName: string;
  localPath: string;
  state: TransferState;
  transferred: number;
  total: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

interface TransfersState {
  tasks: TransferTask[];
  lastSaveDir: string | null;
  upsertTask: (task: TransferTask) => void;
  patchTask: (id: string, patch: Partial<TransferTask>) => void;
  setLastSaveDir: (dir: string | null) => void;
  removeTask: (id: string) => void;
  clearFinished: () => void;
}

export const useTransfersStore = create<TransfersState>()(
  persist(
    (set, get) => ({
      tasks: [],
      lastSaveDir: null,
      upsertTask: (task) =>
        set((s) => {
          const idx = s.tasks.findIndex((t) => t.id === task.id);
          if (idx === -1) return { tasks: [task, ...s.tasks] };
          const next = [...s.tasks];
          next[idx] = task;
          return { tasks: next };
        }),
      patchTask: (id, patch) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t
          ),
        })),
      setLastSaveDir: (dir) => set({ lastSaveDir: dir }),
      removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
      clearFinished: () =>
        set((s) => ({
          tasks: s.tasks.filter((t) => !["done", "canceled"].includes(t.state)),
        })),
    }),
    {
      name: "nas-transfers-storage",
      partialize: (s) => ({ lastSaveDir: s.lastSaveDir }),
    }
  )
);
```

- [ ] **Step 2: 运行 TypeScript 构建验证**

Run:
```bash
npm run build
```

Expected:
- 成功

---

## Task 3: 前端新增“传输页”与路由入口

**Files:**
- Create: `/Users/hongyu/工作/nas-file-manager/src/pages/Transfers.tsx`
- Modify: `/Users/hongyu/工作/nas-file-manager/src/App.tsx`
- Modify: `/Users/hongyu/工作/nas-file-manager/src/pages/Browser.tsx`

- [ ] **Step 1: 创建 Transfers 页面（先渲染列表）**

Create `src/pages/Transfers.tsx`：
```tsx
import { useTransfersStore } from "@/lib/transfers-store";
import { ArrowLeft, Download, Trash2, Pause, Play, RotateCw, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Transfers() {
  const navigate = useNavigate();
  const tasks = useTransfersStore((s) => s.tasks);
  const clearFinished = useTransfersStore((s) => s.clearFinished);

  return (
    <div className="h-screen w-full flex flex-col bg-background">
      <div className="titlebar h-10 w-full flex items-center justify-between px-4 border-b border-border-standard bg-panel">
        <div className="titlebar-button flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-md hover:bg-ghost text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={14} />
          </button>
          <div className="text-xs font-medium text-muted-foreground">Transfers</div>
        </div>
        <div className="titlebar-button" />
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-[510] text-foreground">Downloads</div>
          <button
            onClick={clearFinished}
            className="text-xs px-2.5 py-1.5 rounded-md bg-ghost border border-border-standard text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
          >
            Clear finished
          </button>
        </div>

        {tasks.length === 0 ? (
          <div className="text-sm text-muted-foreground">No transfers</div>
        ) : (
          <div className="space-y-2">
            {tasks.map((t) => {
              const pct =
                t.total && t.total > 0 ? Math.min(100, (t.transferred / t.total) * 100) : null;
              return (
                <div
                  key={t.id}
                  className="rounded-xl border border-border-standard bg-surface p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[14px] font-[510] text-foreground truncate flex items-center gap-2">
                        <Download size={14} className="text-muted-foreground" />
                        {t.fileName}
                      </div>
                      <div className="text-[12px] text-muted-foreground truncate">{t.remotePath}</div>
                    </div>
                    <div className="text-[12px] text-muted-foreground whitespace-nowrap">
                      {t.state}
                    </div>
                  </div>

                  <div className="mt-2">
                    <div className="h-2 rounded-full bg-ghost overflow-hidden border border-border-standard">
                      <div
                        className="h-full bg-primary/70"
                        style={{ width: pct === null ? "0%" : `${pct}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[12px] text-muted-foreground">
                      <div>
                        {t.total ? `${(t.transferred / 1024 / 1024).toFixed(1)} / ${(t.total / 1024 / 1024).toFixed(1)} MB` : `${(t.transferred / 1024 / 1024).toFixed(1)} MB`}
                      </div>
                      <div className="truncate max-w-[60%]">{t.error ?? ""}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 注册路由**

Edit `src/App.tsx`：
- 增加 import `Transfers`
- 增加 `<Route path="/transfers" element={<Transfers />} />`

- [ ] **Step 3: 在 Browser 左侧栏加入口**

Edit `src/pages/Browser.tsx`：
- 在 Sidebar Locations 里新增一个按钮 “Transfers” 进入 `/transfers`

- [ ] **Step 4: 验证构建**

Run:
```bash
npm run build
```

Expected:
- 成功

---

## Task 4: 后端下载任务骨架（先通事件与队列，不做真正下载）

**Files:**
- Create: `/Users/hongyu/工作/nas-file-manager/src-tauri/src/download/mod.rs`
- Modify: `/Users/hongyu/工作/nas-file-manager/src-tauri/src/lib.rs`

- [ ] **Step 1: 创建 download 模块与状态类型**

Create `src-tauri/src/download/mod.rs`：
```rust
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::{Mutex, Notify};

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
```

- [ ] **Step 2: 在 AppState 里挂载 queue（先不实现 worker）**

Edit `src-tauri/src/lib.rs`：
- `pub mod download;`
- `AppState` 增加 `download_queue: download::DownloadQueue`
- `Default` 初始化

- [ ] **Step 3: 增加 start_download command（先只入队并返回 download_id）**

Edit `src-tauri/src/lib.rs`：
- 定义 `StartDownloadArgs { id, remote_path, local_path }`
- `start_download` 生成 `download_id`（例如 `dl_<timestamp>`）
- `state.download_queue.push(...)`
- 返回 `{ download_id }`

- [ ] **Step 4: cargo check**

Run:
```bash
PATH=$PATH:~/.cargo/bin cargo check
```

Expected:
- 成功

---

## Task 5: WebDAV 下载实现（Range + 本地写文件）+ 进度事件

**Files:**
- Modify: `/Users/hongyu/工作/nas-file-manager/src-tauri/src/vfs/webdav.rs`
- Modify/Create: `/Users/hongyu/工作/nas-file-manager/src-tauri/src/download/webdav.rs`
- Modify: `/Users/hongyu/工作/nas-file-manager/src-tauri/src/lib.rs`

- [ ] **Step 1: 在 download 模块内实现 webdav worker**

Create `src-tauri/src/download/webdav.rs`：
- 输入：`Arc<WebDavStorage>`、`DownloadRequest`、控制信号（pause/cancel）、`Window` 用于 emit
- 输出：完成/错误

实现要点：
- 获取本地文件已有长度（offset），存在则续传，否则从 0 开始
- GET 时带 Range：`bytes={offset}-`
- 使用 `bytes_stream()` 循环写入 `tokio::fs::File`（append）
- 每写入一段就 emit `download://progress`

- [ ] **Step 2: 定义事件 payload（Rust struct + Serialize）并统一 emit**

在 `download/mod.rs` 或 `lib.rs` 内定义：
- `DownloadProgressEvent { download_id, transferred, total }`
- `DownloadStateEvent { download_id, state, error }`

事件名固定：
- `download://progress`
- `download://state`

- [ ] **Step 3: 在 lib.rs 启动一个后台 worker（单 worker 串行）**

在 `run()` 里（Builder manage 后）启动 tokio task：
- 循环 `pop()` 获取 request
- 根据连接协议分发：
  - webdav：调用 webdav worker
  - smb：emit error state（NotSupported）

注：需要拿到 Window/AppHandle 来 emit。方案：
- 在 `start_download` command 里拿到 `Window` 并把它存到任务表；或统一用 `AppHandle::emit_all`（但更建议按窗口 emit）。

- [ ] **Step 4: 验证**

Run:
```bash
PATH=$PATH:~/.cargo/bin cargo check
```

Expected:
- 成功

---

## Task 6: 暂停/继续/取消（WebDAV）

**Files:**
- Modify: `/Users/hongyu/工作/nas-file-manager/src-tauri/src/download/mod.rs`
- Modify: `/Users/hongyu/工作/nas-file-manager/src-tauri/src/lib.rs`
- Modify: `/Users/hongyu/工作/nas-file-manager/src-tauri/src/download/webdav.rs`

- [ ] **Step 1: 增加任务表与控制句柄**

在 AppState 内增加：
- `downloads: RwLock<HashMap<String, DownloadHandle>>`

`DownloadHandle` 包含：
- cancel token
- pause flag + notify
- latest state

- [ ] **Step 2: 实现 pause_download/resume_download/cancel_download commands**

`pause_download({ download_id })`
- 设置 pause flag

`resume_download({ download_id })`
- 清 pause flag 并 notify

`cancel_download({ download_id, remove_partial })`
- 触发 cancel token
- 若 remove_partial：删除 local_path

- [ ] **Step 3: webdav worker 在循环写入时检查控制信号**
- cancel：立即退出并 emit canceled
- pause：进入 await notify，恢复后继续 Range 续传（再次根据文件长度计算 offset）

---

## Task 7: 前端触发下载（保存对话框 + 调用 start_download）+ 监听事件

**Files:**
- Modify: `/Users/hongyu/工作/nas-file-manager/src/pages/Browser.tsx`
- Modify: `/Users/hongyu/工作/nas-file-manager/src/lib/tauri-api.ts`
- Modify: `/Users/hongyu/工作/nas-file-manager/src/pages/Transfers.tsx`

- [ ] **Step 1: tauri-api 增加下载相关函数**

在 `src/lib/tauri-api.ts` 增加：
- `startDownload`
- `pauseDownload`
- `resumeDownload`
- `cancelDownload`

- [ ] **Step 2: Browser 的文件菜单增加 Download**
- 对文件项菜单增加一项“Download”
- 点击后：
  - 调用 dialog save（带默认文件名，默认目录读取 `useTransfersStore().lastSaveDir`）
  - 保存成功后创建任务（queued）并调用 `startDownload`
  - 更新任务为 running（等待后端 state 事件纠正）

- [ ] **Step 3: Transfers 页面加入控制按钮（取消/重试/暂停/继续）**
- 按任务状态展示按钮
- 调用对应 tauri-api
- 重试：重新走保存策略（默认用同一路径，提供“另存为”入口）

- [ ] **Step 4: 监听下载事件**
- 在 Transfers 页或全局（推荐在 App 根组件）注册 `listen`：
  - `download://progress` 更新 transferred/total
  - `download://state` 更新 state/error

---

## Task 8: 文档与手工验收脚本

**Files:**
- Modify: `/Users/hongyu/工作/nas-file-manager/README.md`
- Modify: `/Users/hongyu/工作/nas-file-manager/prd.md`

- [ ] **Step 1: 更新 README**
- 增加“下载与传输页”说明、已知限制（SMB 未支持）

- [ ] **Step 2: 更新 PRD**
- 增加下载相关能力与路线图（队列 -> 并发；WebDAV -> SMB）

---

## Plan Self-Review
- 覆盖需求：单文件下载 / 传输页 / 记住目录+另存为 / 队列 / 暂停继续（WebDAV）/ SMB 先不支持 ✅
- 无 TODO/TBD 占位 ✅
- 所有文件路径为绝对路径或明确相对到 repo ✅


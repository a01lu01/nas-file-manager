# 文件下载（WebDAV 优先）设计说明

**目标**
- 在桌面与 Android 上支持“下载单个文件到本地”。
- UI 增加“传输页”用于查看下载队列、进度、失败原因，并支持取消/重试/暂停/继续。
- 第一版：队列（单 worker 串行）；暂停/继续仅 WebDAV 支持；SMB 先返回不支持（等待 SMB 功能完善）。

**非目标（第一版不做）**
- 目录下载（递归/打包 zip）
- 多并发下载（后续版本）
- 全量离线缓存管理（仅做下载）

## 交互与体验

### 入口
- 文件列表每个文件项的菜单新增“下载”。
- 左侧栏新增“传输”入口，进入传输页查看任务。

### 保存位置策略
- 默认“记住上次保存目录”，并提供“另存为…”重新选择保存位置。
- 为兼容桌面与 Android：使用 Tauri 对话框插件的保存对话框获取保存路径。
- 若用户取消保存对话框：不创建任务。

### 任务队列
- 第一版：所有下载进入队列，单 worker 串行执行。
- 任务状态：queued / running / paused / done / error / canceled

### 任务控制
- 取消：停止当前下载（可选择删除未完成的本地文件）。
- 重试：对 error/canceled 任务重新入队。
- 暂停/继续（WebDAV）：暂停后保留已下载的本地部分，继续时 Range 续传。
- SMB：下载按钮可显示但会提示“暂不支持”或直接隐藏（由实现决定）。

## 架构

### 前端
- 增加 Transfers 状态仓库（Zustand）：维护任务列表、选中任务、过滤与排序。
- Browser 页面触发下载：
  1) 调用保存对话框（默认目录为上次目录，默认文件名为远端文件名）
  2) 创建任务（queued）
  3) 调用后端开始下载（返回 downloadId）
- 监听后端事件更新任务进度与状态。

### 后端（Tauri/Rust）
- 新增下载管理器：在 AppState 中维护下载任务表（downloadId -> handle）。
- 下载过程在 tokio task 中执行，周期性通过 Window emit 进度事件。
- WebDAV 下载实现：
  - 先 HEAD/PROPFIND 获取 size（若不可得则 total 置为 null）
  - 写文件：按 chunk 流式下载写入本地文件
  - 暂停/继续：通过共享状态 + Range (bytes=offset-) 实现续传
- SMB：返回 NotSupported（或者 Internal("SMB download not supported yet")）。

### IPC / 事件协议
- Commands
  - start_download({ id, remote_path, local_path }) -> { download_id }
  - pause_download({ download_id }) -> bool
  - resume_download({ download_id }) -> bool
  - cancel_download({ download_id, remove_partial }) -> bool
- Events（Window emit）
  - download://progress { download_id, transferred, total, bytes_per_sec? }
  - download://state { download_id, state, error? }

## 错误处理
- 前端统一展示错误文本（传输页任务条目内）。
- 典型错误映射：
  - AuthFailed / PermissionDenied / NetworkError / NotFound / Internal
- 用户取消保存对话框不视为错误。

## 数据持久化
- 仅持久化“上次保存目录”（settings.json）。
- 任务列表不做持久化（第一版重启即清空）。

## 验收标准
- WebDAV：下载单文件成功，大小一致；取消后任务状态正确；暂停/继续可续传（断点续传不重下已完成部分）。
- UI：传输页可看到队列、进度、状态与错误；可重试失败任务；“另存为”可覆盖上次目录。
- 桌面与 Android：都能选保存位置并完成下载（Android 如受限，至少能下载到可访问目录并能打开）。


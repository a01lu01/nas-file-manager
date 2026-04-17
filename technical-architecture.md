## 1. 架构设计
基于 Tauri 2.0 的跨平台架构，前端利用 React + Tailwind + Linear 设计规范打造支持动态主题切换的极致 UI，底层利用 Rust 突破浏览器网络限制。

```mermaid
graph TD
    subgraph 前端渲染层 (Webview - React + Tailwind)
        A["Shadcn/UI 基础组件 (CSS 变量主题)"] --> B["高级业务组件 (文件列表/导航)"]
        B --> C["沉浸式多媒体播放器"]
        D["Framer Motion (微交互与主题切换动效)"] --> B
        L["Theme Provider (亮/暗/跟随系统)"] --> A
    end

    subgraph Tauri 核心层 (Rust)
        E["IPC 指令网关 (Commands)"]
        F["本地 HTTP 代理服务器 (Axum)"]
        G["统一 VFS (虚拟文件系统) 接口"]
        H["SMB 客户端 (如 smb-rs)"]
        I["WebDAV 客户端 (如 reqwest)"]
    end

    subgraph 目标设备
        J["NAS (SMB 445 端口)"]
        K["NAS (WebDAV HTTP/HTTPS)"]
    end

    B <-->|IPC 调用| E
    C <-->|localhost 代理流式读取| F
    
    E --> G
    F --> G
    
    G --> H
    G --> I
    
    H <--> J
    I <--> K
```

## 2. 技术栈说明
### 2.1 生产级前端 UI 层
- **核心框架**: React 18 + TypeScript + Vite
- **样式引擎**: Tailwind CSS v3
  - **动态主题系统**: 在 `tailwind.config.js` 中放弃硬编码颜色，改为使用 CSS 变量（如 `var(--background)`, `var(--brand-indigo)`）。
  - **主题提供者 (Theme Provider)**: 结合 `next-themes` 库，通过监听 `window.matchMedia('(prefers-color-scheme: dark)')` 实现自动跟随系统，并支持用户手动强制覆盖为亮/暗模式。
  - **字体配置**: 引入 `Inter Variable` 并通过 CSS 设置 `font-feature-settings: "cv01", "ss03"`。
- **组件库体系**: `shadcn/ui` (无头组件结合 Tailwind，提供极高的定制自由度与无障碍支持)
- **图标系统**: Lucide React (简洁、现代的线性图标，完美契合克制的 UI 风格)
- **动效库**: Framer Motion (实现复杂的布局切换动画、列表交错进场、物理回弹效果，以及主题切换时的平滑色彩过渡)
- **状态管理**: Zustand (用于管理全局的目录路径状态、视图模式、连接会话)

### 2.2 Tauri 跨平台核心
- **框架版本**: Tauri 2.0 (原生支持 Windows, macOS, Linux, Android, iOS)
- **底层语言**: Rust
- **网络处理**: 
  - `reqwest`: 处理 WebDAV HTTP/HTTPS 协议（支持自签名 HTTPS 证书的宽容模式）。
  - `quick-xml`: 解析 WebDAV `PROPFIND` 的 XML 响应。
  - `smb-rs`: 处理 SMB 访问（当前实现存在与部分 NAS 的 NTLM 兼容性问题，后续计划替换为 `libsmbclient`/Samba 官方引擎）。
  - `mdns-sd`: 局域网 SMB 设备发现（mDNS `_smb._tcp`）。

## 3. 前后端通信定义 (IPC Commands)
前端不直接发起任何网络请求，全部通过 Tauri 提供的 `invoke` 方法调用 Rust 函数，确保安全性与性能。
| Rust Command (指令) | 目的 | 参数示例 |
|---------------------|---------|----------|
| `connect_server` | 验证并建立服务器连接 | `{ id, protocol, url, user, pass, auth_fallback }` |
| `list_directory` | 获取指定目录的文件列表 | `{ id, path: "/movies" }` |
| `mkdir_item` | 创建目录 | `{ id, path: "/movies/new" }` |
| `rename_item` | 重命名文件或目录 | `{ id, old_path, new_path }` |
| `delete_item` | 删除文件或目录 | `{ id, path }` |
| `download_file` | 下载文件到本地设备 | `{ remote_path, local_path }` |
| `discover_nas` | 局域网发现可用 SMB 设备 | `{}` |

## 4. 核心难点解决方案

### 4.1 打造原生级 UI 体验 (基于 Linear 规范的双主题)
为避免 Electron/Webview 应用常见的“网页感”，技术上将采取以下措施：
1. **禁用默认行为**：通过 CSS (`user-select: none`, `-webkit-app-region: drag`) 和 JS 禁用文本默认选中、右键原生菜单、图片默认拖拽。
2. **自定义透明响应式标题栏**：在桌面端隐藏系统默认标题栏，使用前端渲染包含控制按钮的透明标题栏。该标题栏的背景色将通过 CSS 变量与当前主题的面板颜色（暗色为 `#0f1011`，浅色为 `#ffffff`）完美融合。
3. **高性能列表渲染**：当文件夹包含成千上万个文件时，采用虚拟列表（Virtual Scrolling，如 `@tanstack/react-virtual`）结合 Shadcn 的列表组件，确保滚动帧率锁定在 60fps。

### 4.2 视频流式播放 (Streaming & Range Requests)
大体积视频文件必须支持边下边播与随意拖拽。现代浏览器在加载 WebDAV 资源时通常面临严格的 CORS 和 Basic Auth 限制，无法直接给 `<video>` 或 `<img>` 设置带有认证信息的 WebDAV 链接。
1. **本地代理服务器**：在 Tauri 的 Rust 后端通过 `axum` 启动一个 HTTP 代理服务器（绑定 `127.0.0.1:0` 获取随机空闲端口）。
2. **前端转换 URL**：前端渲染时，通过 IPC 调用获取代理链接，形如 `<video src="http://127.0.0.1:48212/stream?id=xxx&path=/movie.mp4" />`。
3. **透传请求与响应**：Rust 层代理接收前端原生播放器发出的 HTTP `Range` 头等，向 NAS 携带对应凭证发起请求，获取对应字节范围的数据块，并通过 `axum` 响应的 Stream 管道传输回 WebView，从而实现完美的高清原图预览与大视频进度条拖拽。

### 4.3 多协议统一抽象 (VFS)
在 Rust 层定义一个 `Storage` Trait（接口），包含 `list`, `read`, `write`, `stat` 等方法。无论是 SMB 还是 WebDAV 驱动都实现此接口。前端只需传递虚拟路径，Rust 内部根据当前连接上下文自动路由，实现高度解耦。

### 4.4 WebDAV 兼容性策略
WebDAV 在实际 NAS 环境下常见的兼容性坑包括：自签名 HTTPS 证书、中文路径编码、目录末尾斜杠、以及带“基路径”的挂载场景（例如 `https://host:5006/临时空间` 代表将该目录作为根）。
当前实现中：
1. 使用宽容的 HTTPS 客户端以支持局域网自签名证书；
2. 对请求路径进行分段编码，避免中文路径被二次编码；
3. 对目录类请求自动补齐末尾 `/`；
4. 将连接 URL 自带的 path 作为“基路径”，并将其映射为应用内的 `/` 根目录。

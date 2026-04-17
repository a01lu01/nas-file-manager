# 开发实施计划 (Development Plan)

基于 Tauri 2.0 和 React + Tailwind (Linear 风格) 的架构，本项目开发将遵循“先骨架、后底层、再 UI、终联调”的原则。为了确保各模块解耦和高质量交付，整个项目划分为以下五个核心阶段。

---

## 阶段一：项目基建与设计系统初始化 (Infrastructure & Design System)
**目标**：搭建跨平台工程环境，确立全局 UI 规范，确保亮/暗模式双主题无缝切换。

1. **工程初始化**
   - 使用 `create-tauri-app` 初始化 Tauri 2.0 项目。
   - 配置前端：React 18 + Vite + TypeScript。
   - 配置 Tailwind CSS v3 并引入 `shadcn/ui` 基础环境。
2. **设计系统落地 (Design Tokens)**
   - 在 `tailwind.config.js` 中定义基于 CSS 变量的 Linear 风格色板、字体（`Inter Variable`）和阴影配置。
   - 引入 `next-themes`，实现亮/暗/跟随系统的主题切换逻辑。
   - 全局禁用浏览器默认行为（右键菜单、文本选中、拖拽）。
3. **沉浸式窗口配置**
   - 在 Tauri 的 `tauri.conf.json` 中配置无边框透明窗口（macOS/Windows）。
   - 前端实现自定义的拖拽标题栏（包含红黄绿按钮或 Windows 控制区），并响应主题颜色。
4. **基础路由与状态**
   - 搭建应用级路由（连接管理页、文件浏览页）。
   - 初始化 Zustand Store，用于管理当前连接会话和全局配置，并在 `localStorage` 中持久化记录（密码以隐藏形式保存，增强隐私与安全性）。

---

## 阶段二：底层协议核心与 VFS 抽象 (Core Networking & VFS)
**目标**：在 Rust 层完成统一文件系统的抽象，打通与 NAS 的底层连接。

1. **统一 VFS 接口定义 (Rust)**
   - 设计 `Storage` Trait，包含 `connect`, `list_dir`, `stat`, `read_file`, `delete`, `rename` 等方法。
   - 编写统一的错误处理枚举（Error Mapping），将不同协议的错误统一转化为前端可识别的提示。
2. **WebDAV 驱动实现**
   - 引入 `reqwest`，实现基于 HTTP 的 WebDAV 认证与目录读取。
   - 处理 XML 格式的 `PROPFIND` 响应，转化为统一的 `FileItem` 结构体。
3. **SMB 驱动实现**
   - 当前引入 `smb-rs` 实现 SMB 认证与连接，映射目录列表到统一 `FileItem`。
   - 已知问题：与部分 NAS 的 NTLM 兼容性存在硬伤（例如 Workstation 字段/认证协商差异导致 `0xc0000022`），后续计划替换为 `libsmbclient`（Samba 官方引擎）以获得工业级兼容性。
4. **IPC 桥接**
   - 编写 Tauri 的 `#[tauri::command]` 暴露给前端（如 `invoke("list_directory")`）。
   - 在前端编写对应的 TypeScript API 封装层。

---

## 阶段三：前端文件浏览器 (UI & Interactions)
**目标**：开发优雅流畅、支持触控的类 Finder 文件浏览体验。

1. **核心布局 (Layout)**
   - 绝对固定宽度的左侧边栏 (240px)，防止缩放时挤压文字。
   - 响应式工具栏 (Toolbar)：宽屏一行，窄屏两行，确保操作按钮永远可用。
   - 面包屑导航防挤压（超长层级自动折叠，超长名字截断）。
2. **列表渲染与自适应 (Responsive List & Grid View)**
   - 列表视图：包含名称、大小、日期、操作菜单，名称支持“自然数”排序。
   - 网格视图：支持大图标布局，图片文件通过本地代理预加载显示缩略图，非图片文件展示独立设计的类型图标（如音频、视频、文档）。
   - 窄窗口模式下自适应隐藏次要列、截断超长文件名，确保右侧“三点操作”按钮绝对可见。
3. **操作交互 (Actions)**
   - 新建文件夹 / 重命名 / 删除功能的 UI 与 API 对接。
   - **全触控支持**：在触摸屏或触摸板上长按行即可呼出操作菜单。
   - 返回上一级、排序切换功能。

---

## 阶段四：多媒体流式播放与高级功能 (Multimedia Streaming & Advanced)
**目标**：攻克大文件预览难题，实现边下边播的极致体验。

1. **本地代理服务器 (Rust `axum`)**
   - 在 Tauri 后端启动一个随机端口的本地 HTTP 代理服务器 (`axum`)。
   - 通过本地代理 URL 绕过前端直接访问 WebDAV 时的 CORS (跨域) 和 Basic Auth 限制。
2. **流式数据管道 (Streaming Pipe)**
   - 代理服务器接收前端原生播放器发出的 HTTP `Range` 请求。
   - 结合 VFS 驱动，向 NAS 请求特定字节块，并将响应头和数据流式转发给前端。
3. **多媒体播放器 UI (极致交互与全触控支持)**
   - 抛弃原生 `controls`，开发完全自定义的极简悬浮播放控件，解决 macOS/WebKit 强制暗色遮罩问题。
   - 触控手势全适配：左右滑动调进度，上下滑动调音量，屏幕/鼠标长按即时 2.0x 倍速播放。
   - 悬浮音量条、倍速菜单、本地音量/静音记忆。
   - 图片浏览支持全局统一的模糊遮罩沉浸感，并适配移动端滑动翻页。
4. **文件下载与传输进度**
   - 实现通过 Rust 驱动直接将 NAS 文件流式写入本地磁盘（避开浏览器内存限制）。
   - 通过 Tauri 的事件系统（`Window::emit`）向前端实时推送传输进度条。

---

## 阶段五：跨端适配与性能优化 (Cross-platform & Optimization)
**目标**：确保在移动端（Android）和不同桌面端均有完美的体验。

1. **移动端响应式重构 (Android/Mobile)**
   - 当检测到屏幕宽度小于 768px 时，隐藏侧边栏，改用汉堡菜单（Drawer）。
   - 列表布局转换为紧凑单列，放大点击热区（Touch Targets）。
   - 用长按手势（Long Press）替代鼠标右键唤出操作菜单。
2. **性能与细节打磨**
   - 优化前端状态更新逻辑（使用 `useMemo` 缓存过滤和排序），避免深层目录切换时的全页面重绘。
   - 完善网络异常断开时的重连机制和友好的 Toast 提示（集成 Sonner）。
3. **打包与发布配置 (TODO)**
   - 配置 Tauri 打包脚本，生成 macOS (.dmg), Windows (.msi) 安装包。
   - 配置 Android APK 构建环境并完成打包测试。

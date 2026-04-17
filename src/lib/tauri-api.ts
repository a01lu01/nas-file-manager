type InvokeFn = <T>(
  cmd: string,
  args?: Record<string, unknown>
) => Promise<T>;

const isTauriRuntime = () =>
  typeof window !== "undefined" &&
  ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);

let cachedInvoke: InvokeFn | null = null;

const getInvoke = async (): Promise<InvokeFn> => {
  if (cachedInvoke) return cachedInvoke;
  if (!isTauriRuntime()) {
    throw new Error("Tauri runtime is not available. Please open in the desktop app.");
  }
  const mod = await import("@tauri-apps/api/core");
  cachedInvoke = mod.invoke as InvokeFn;
  return cachedInvoke;
};

export interface FileItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  last_modified: number | null;
  protocol: "smb" | "webdav";
}

export interface DiscoveredNas {
  name: string;
  ip: string;
  port: number;
  protocol: string;
}

export interface SavedConnection {
  id: string;
  name: string;
  protocol: "smb" | "webdav";
  url: string;
  user: string;
  auth_fallback?: boolean;
}

export const discoverNas = async (): Promise<DiscoveredNas[]> => {
  const invoke = await getInvoke();
  return invoke("discover_nas");
};

export const getProxyUrl = async (
  connectionId: string,
  path: string
): Promise<string> => {
  const invoke = await getInvoke();
  return invoke("get_proxy_url", { connectionId, path });
};

export const getProxyPort = async (): Promise<number> => {
  const invoke = await getInvoke();
  return invoke("get_proxy_port");
};

export const loadSavedConnections = async (): Promise<SavedConnection[]> => {
  const invoke = await getInvoke();
  return invoke("load_saved_connections");
};

export const saveSavedConnections = async (
  connections: SavedConnection[]
): Promise<boolean> => {
  const invoke = await getInvoke();
  return invoke("save_saved_connections", { connections });
};

export const connectServer = async (
  id: string,
  protocol: "smb" | "webdav",
  url: string,
  user: string,
  pass: string,
  authFallback: boolean = false
): Promise<boolean> => {
  const invoke = await getInvoke();
  return invoke("connect_server", { id, protocol, url, user, pass, authFallback });
};

export const listDirectory = async (
  id: string,
  path: string
): Promise<FileItem[]> => {
  const invoke = await getInvoke();
  return invoke("list_directory", { id, path });
};

export const mkdirItem = async (
  id: string,
  path: string
): Promise<boolean> => {
  const invoke = await getInvoke();
  return invoke("mkdir_item", { id, path });
};

export const deleteItem = async (
  id: string,
  path: string
): Promise<boolean> => {
  const invoke = await getInvoke();
  return invoke("delete_item", { id, path });
};

export const renameItem = async (
  id: string,
  oldPath: string,
  newPath: string
): Promise<boolean> => {
  const invoke = await getInvoke();
  return invoke("rename_item", { id, oldPath, newPath });
};

export const startDownload = async (
  id: string,
  downloadId: string,
  remotePath: string,
  localPath: string
): Promise<{ download_id: string }> => {
  const invoke = await getInvoke();
  return invoke("start_download", { id, downloadId, remotePath, localPath });
};

export const pauseDownload = async (downloadId: string): Promise<boolean> => {
  const invoke = await getInvoke();
  return invoke("pause_download", { downloadId });
};

export const resumeDownload = async (downloadId: string): Promise<boolean> => {
  const invoke = await getInvoke();
  return invoke("resume_download", { downloadId });
};

export const cancelDownload = async (
  downloadId: string,
  removePartial: boolean = true
): Promise<boolean> => {
  const invoke = await getInvoke();
  return invoke("cancel_download", { downloadId, removePartial });
};

export const retryDownload = async (downloadId: string): Promise<boolean> => {
  const invoke = await getInvoke();
  return invoke("retry_download", { downloadId });
};

import { useEffect, useState } from "react";
import { HardDrive, Monitor, Moon, Sun, Plus, Loader2, X, Eye, EyeOff, Edit2, Search } from "lucide-react";
import { useTheme } from "next-themes";
import { useNavigate } from "react-router-dom";
import { useConnectionStore } from "@/lib/store";
import { connectServer, discoverNas, DiscoveredNas, loadSavedConnections, saveSavedConnections } from "@/lib/tauri-api";

export default function Home() {
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const connections = useConnectionStore((state) => state.connections);
  const setConnectionStatus = useConnectionStore((state) => state.setConnectionStatus);
  const setActiveConnection = useConnectionStore((state) => state.setActiveConnection);
  const addConnection = useConnectionStore((state) => state.addConnection);
  const setConnections = useConnectionStore((state) => state.setConnections);

  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loadedSavedConnections, setLoadedSavedConnections] = useState(false);
  
  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    protocol: "smb" as "smb" | "webdav",
    url: "",
    user: "",
    pass: "",
    auth_fallback: false
  });
  
  // Discovery state
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredNas[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadSavedConnections();
        if (cancelled) return;
        if (saved.length > 0) {
          const current = useConnectionStore.getState().connections;
          if (current.length === 0) {
            setConnections(
              saved.map((c) => ({
                id: c.id,
                name: c.name,
                protocol: c.protocol,
                url: c.url,
                user: c.user,
                pass: "",
                auth_fallback: c.auth_fallback,
                isConnected: false,
              }))
            );
          }
        }
      } catch {
      } finally {
        if (!cancelled) setLoadedSavedConnections(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setConnections]);

  useEffect(() => {
    if (!loadedSavedConnections) return;
    const conns = useConnectionStore.getState().connections;
    saveSavedConnections(
      conns.map((c) => ({
        id: c.id,
        name: c.name,
        protocol: c.protocol,
        url: c.url,
        user: c.user,
        auth_fallback: c.auth_fallback,
      }))
    ).catch(() => {});
  }, [connections, loadedSavedConnections]);
  
  const handleDiscover = async () => {
    try {
      setIsDiscovering(true);
      setDiscoveredDevices([]);
      const devices = await discoverNas();
      setDiscoveredDevices(devices);
    } catch (err) {
      console.error("Failed to discover NAS:", err);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleConnect = async (connId: string) => {
    try {
      setConnectingId(connId);
      setConnectError(null);
      const conn = connections.find(c => c.id === connId);
      if (!conn) return;

      // Call Rust backend to connect and verify
      await connectServer(conn.id, conn.protocol, conn.url, conn.user, conn.pass, conn.auth_fallback || false);
      
      setConnectionStatus(conn.id, true);
      setActiveConnection(conn.id);
      
      // Navigate to the file browser
      navigate("/browser");
    } catch (error) {
      console.error("Connection failed:", error);
      const errorMessage = typeof error === 'object' && error !== null 
        ? (error as any).NetworkError || (error as any).Internal || (error as any).AuthFailed || (error as any).PermissionDenied || JSON.stringify(error)
        : String(error);
      setConnectError(`Failed: ${errorMessage}`);
    } finally {
      setConnectingId(null);
    }
  };

  const handleAddConnection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.url) {
      alert("Name and URL are required");
      return;
    }
    // We removed the strict check for host/share here so users can just enter IP.
    
    if (editingId) {
      // Update existing connection
      useConnectionStore.getState().connections.forEach(c => {
        if (c.id === editingId) {
          useConnectionStore.getState().removeConnection(c.id);
          addConnection({
            id: editingId,
            ...formData,
            pass: formData.pass === "********" ? c.pass : formData.pass
          });
        }
      });
    } else {
      // Add new connection
      const newId = `conn_${Date.now()}`;
      addConnection({
        id: newId,
        ...formData
      });
    }
    
    // Save to local storage for "memory" feature
    localStorage.setItem("last-connection-form", JSON.stringify(formData));
    
    setIsDialogOpen(false);
    setEditingId(null);
    setFormData({
      name: "",
      protocol: "smb",
      url: "",
      user: "",
      pass: "",
      auth_fallback: false
    });
  };

  return (
    <div className="h-screen w-full flex flex-col bg-background">
      {/* Custom Titlebar Region */}
      <div className="titlebar h-10 w-full flex items-center justify-between px-4 border-b border-border/5 bg-panel">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 titlebar-button">
            <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50 hover:bg-red-500/80 transition-colors"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50 hover:bg-yellow-500/80 transition-colors"></div>
            <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50 hover:bg-green-500/80 transition-colors"></div>
          </div>
        </div>
        <div className="text-xs font-medium text-muted-foreground">NAS File Manager</div>
        <div className="flex items-center gap-2 titlebar-button">
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-1.5 rounded-md hover:bg-ghost text-muted-foreground hover:text-foreground transition-colors"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-6 relative overflow-hidden">
        {/* Decorative background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-primary/5 rounded-[100%] blur-[120px] pointer-events-none"></div>

        <div className="w-full max-w-md relative z-10">
          <div className="flex flex-col items-center mb-10 space-y-4">
            <div className="w-20 h-20 bg-surface rounded-3xl shadow-sm border border-border-standard flex items-center justify-center mb-8 relative">
              <HardDrive size={32} className="text-primary" />
              <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-background rounded-full flex items-center justify-center border border-border/5">
                <Monitor size={14} className="text-muted-foreground" />
              </div>
            </div>
            <h1 className="text-3xl font-[510] tracking-tight-xl text-foreground">
              Connect to Storage
            </h1>
            <p className="text-[15px] text-muted-foreground text-center max-w-[280px] leading-relaxed mb-8">
              Add a new NAS connection via SMB or WebDAV to access your files.
            </p>
          </div>

          <div className="w-full max-w-[420px] mx-auto space-y-3">
            {/* Network Discovery Button */}
            <div className="flex justify-end mb-2">
              <button
                onClick={handleDiscover}
                disabled={isDiscovering}
                className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                {isDiscovering ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                {isDiscovering ? "Scanning network..." : "Discover NAS"}
              </button>
            </div>

            {/* Discovered Devices List */}
            {discoveredDevices.length > 0 && (
              <div className="mb-4 bg-panel border border-border-standard rounded-xl p-2 animate-in fade-in slide-in-from-top-2">
                <div className="text-xs text-muted-foreground px-2 py-1 mb-1 font-medium">Found Devices</div>
                <div className="space-y-1">
                  {discoveredDevices.map((dev, idx) => (
                    <div 
                      key={idx}
                      onClick={() => {
                        setFormData({
                            name: dev.name,
                            protocol: "smb",
                            url: dev.ip, // User doesn't have to specify share now
                            user: "",
                            pass: "",
                            auth_fallback: false
                          });
                        setEditingId(null);
                        setIsDialogOpen(true);
                        setDiscoveredDevices([]);
                      }}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-ghost cursor-pointer group"
                    >
                      <div className="flex items-center gap-2 shrink-0">
                        <Monitor size={14} className="text-primary" />
                        <div>
                          <div className="text-sm font-medium text-foreground">{dev.name}</div>
                          <div className="text-xs text-muted-foreground">{dev.ip}</div>
                        </div>
                      </div>
                      <Plus size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {connections.length === 0 ? (
               <div className="text-center py-6 text-sm text-muted-foreground border border-dashed border-border-standard rounded-xl">
                 No connections yet. Click below to add one.
               </div>
            ) : (
              connections.map((conn) => (
                <div 
                  key={conn.id}
                  onClick={() => connectingId !== conn.id && handleConnect(conn.id)}
                  className={`group p-4 rounded-xl bg-surface border border-border-standard hover:border-primary/50 hover:bg-surface/80 transition-all cursor-pointer shadow-sm relative overflow-hidden ${connectingId === conn.id ? 'opacity-80 pointer-events-none' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 shrink-0 rounded-lg bg-ghost border border-border-subtle flex items-center justify-center">
                        {connectingId === conn.id ? (
                          <Loader2 size={18} className="text-primary animate-spin" />
                        ) : (
                          <Monitor size={18} className="text-foreground" />
                        )}
                      </div>
                      <div className="text-left min-w-0 flex-1 pr-2">
                        <div className="text-[15px] font-[510] text-foreground truncate">{conn.name}</div>
                        <div className="text-[13px] text-muted-foreground font-mono truncate">{conn.url}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-xs font-medium text-muted-foreground px-2.5 py-1 rounded-full border border-border-subtle bg-ghost uppercase tracking-wider">
                        {conn.protocol}
                      </div>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(conn.id);
                            setFormData({
                              name: conn.name,
                              protocol: conn.protocol,
                              url: conn.url,
                              user: conn.user,
                              pass: conn.pass ? "********" : "",
                              auth_fallback: conn.auth_fallback || false
                            });
                            setIsDialogOpen(true);
                          }}
                          className="p-1.5 rounded-md hover:bg-ghost text-muted-foreground hover:text-foreground transition-colors"
                          title="Edit connection"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            useConnectionStore.getState().removeConnection(conn.id);
                          }}
                          className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete connection"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  {/* Progress indicator animation when connecting */}
                  {connectingId === conn.id && (
                    <div className="absolute bottom-0 left-0 h-[2px] bg-primary w-full animate-pulse"></div>
                  )}
                </div>
              ))
            )}

            {connectError && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3">
                {connectError}
              </div>
            )}

            {/* Add New Connection Button */}
            <button 
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                // Load last used connection details for memory feature
                const lastData = localStorage.getItem("last-connection-form");
                if (lastData) {
                  try {
                    const parsed = JSON.parse(lastData);
                    setFormData({
                      name: parsed.name || "",
                      protocol: parsed.protocol || "smb",
                      url: parsed.url || "",
                      user: parsed.user || "",
                      pass: parsed.pass || "",
                      auth_fallback: parsed.auth_fallback || false
                    });
                  } catch (err) {
                    setFormData({
                      name: "",
                      protocol: "smb",
                      url: "",
                      user: "",
                      pass: "",
                      auth_fallback: false
                    });
                  }
                } else {
                  setFormData({
                    name: "",
                    protocol: "smb",
                    url: "",
                    user: "",
                    pass: "",
                    auth_fallback: false
                  });
                }
                setEditingId(null);
                setIsDialogOpen(true);
              }}
              className="w-full p-4 rounded-xl border border-dashed border-border-standard hover:border-muted-foreground/50 hover:bg-ghost transition-all flex items-center justify-center gap-2 group"
            >
              <div className="w-8 h-8 rounded-full bg-ghost flex items-center justify-center text-muted-foreground group-hover:text-foreground transition-colors">
                <Plus size={16} />
              </div>
              <span className="text-[15px] font-[510] text-muted-foreground group-hover:text-foreground transition-colors">
                Add New Connection
              </span>
            </button>
          </div>
        </div>
      </main>

      {/* Add Connection Dialog Overlay */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-surface border border-border-standard rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-standard">
              <h2 className="text-lg font-semibold text-foreground">
                {editingId ? "Edit Connection" : "New Connection"}
              </h2>
              <button 
                onClick={() => {
                  setIsDialogOpen(false);
                  setEditingId(null);
                  setFormData({
                    name: "",
                    protocol: "smb",
                    url: "",
                    user: "",
                    pass: "",
                    auth_fallback: false
                  });
                }}
                className="p-1 rounded-md hover:bg-ghost text-muted-foreground transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddConnection} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Name</label>
                <input 
                  autoFocus
                  type="text" 
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="e.g. Home NAS" 
                  className="w-full bg-background border border-border-standard rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Protocol</label>
                <div className="flex gap-2">
                  <button 
                    type="button"
                    onClick={() => setFormData({...formData, protocol: "smb"})}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${formData.protocol === "smb" ? "bg-primary/10 border-primary/30 text-primary" : "bg-background border-border-standard text-muted-foreground hover:bg-ghost"}`}
                  >
                    SMB
                  </button>
                  <button 
                    type="button"
                    onClick={() => setFormData({...formData, protocol: "webdav"})}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${formData.protocol === "webdav" ? "bg-primary/10 border-primary/30 text-primary" : "bg-background border-border-standard text-muted-foreground hover:bg-ghost"}`}
                  >
                    WebDAV
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">URL / Path</label>
                <input 
                  type="text" 
                  value={formData.url}
                  onChange={(e) => setFormData({...formData, url: e.target.value})}
                  placeholder={formData.protocol === "smb" ? "e.g. 192.168.2.200/ShareName/Subfolder" : "e.g. http://192.168.2.200:5005/webdav"} 
                  className="w-full bg-background border border-border-standard rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Username</label>
                  <input 
                    type="text" 
                    value={formData.user}
                    onChange={(e) => setFormData({...formData, user: e.target.value})}
                    placeholder="Optional" 
                    className="w-full bg-background border border-border-standard rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Password</label>
                  <div className="relative">
                    <input 
                      type={showPassword ? "text" : "password"} 
                      value={formData.pass}
                      onChange={(e) => setFormData({...formData, pass: e.target.value})}
                      placeholder="Optional" 
                      className="w-full bg-background border border-border-standard rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:border-primary/50 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      disabled={formData.pass === "********"}
                      className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-colors ${
                        formData.pass === "********" 
                          ? "text-muted-foreground/30 cursor-not-allowed" 
                          : "hover:bg-ghost text-muted-foreground hover:text-foreground"
                      }`}
                      title={formData.pass === "********" ? "Saved password cannot be viewed" : (showPassword ? "Hide password" : "Show password")}
                    >
                      {showPassword && formData.pass !== "********" ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>
              
              {/* Advanced Options (Hidden by default for WebDAV, useful for auth troubleshooting in SMB) */}
              {formData.protocol === "smb" && (
                <div className="pt-2">
                  <div className="text-xs text-muted-foreground mb-2 flex items-center justify-between">
                    <span>Advanced Options</span>
                    <div className="h-px bg-border-standard flex-1 ml-3"></div>
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input 
                        type="checkbox" 
                        checked={formData.auth_fallback || false}
                        onChange={(e) => setFormData({...formData, auth_fallback: e.target.checked})}
                        className="w-4 h-4 rounded border-border-standard text-primary focus:ring-primary/20 transition-colors"
                      />
                      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                        Use strict NTLM authentication (If getting 0xc0000022)
                      </span>
                    </label>
                  </div>
                </div>
              )}

              <div className="pt-2">
                <button 
                  type="submit"
                  className="w-full bg-foreground text-background font-medium rounded-lg py-2.5 hover:opacity-90 transition-opacity"
                >
                  {editingId ? "Save Changes" : "Save Connection"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

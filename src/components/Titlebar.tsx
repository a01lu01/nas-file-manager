import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
    try {
      setOsType(type());
    } catch (e) {
      console.error(e);
    }
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
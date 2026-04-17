import React, { useEffect, useRef, useState } from "react";
import { useConnectionStore } from "@/lib/store";
import { listDirectory, mkdirItem, deleteItem, renameItem, FileItem, startDownload, getProxyUrl, getProxyPort } from "@/lib/tauri-api";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Folder, File, FileImage, FileVideo, FileAudio, FileArchive, FileText, ChevronRight, HardDrive, Search, LayoutGrid, List, ArrowLeft, MoreHorizontal, LogOut, Sun, Moon, Loader2, ArrowUpDown, FolderPlus, Trash2, Pencil, Download, X, ChevronLeft, Play, Pause, Volume2, VolumeX, Maximize, Menu } from "lucide-react";
import { useTheme } from "next-themes";
import { save } from "@tauri-apps/plugin-dialog";
import { useTransfersStore } from "@/lib/transfers-store";
import { toast } from "sonner";
import { useVirtualizer } from "@tanstack/react-virtual";

// --- 自定义视频播放器组件，替代原生 controls 避免系统级强制遮罩 ---
function CustomVideoPlayer({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(() => localStorage.getItem("nas-video-muted") === "true");
  const [volume, setVolume] = useState(() => {
    const v = localStorage.getItem("nas-video-volume");
    return v !== null ? parseFloat(v) : 1;
  });
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = volume;
    video.muted = isMuted;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleDurationChange = () => setDuration(video.duration);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("durationchange", handleDurationChange);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("durationchange", handleDurationChange);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
    };
  }, []);

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 2500);
  };

  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
  const [initialVolume, setInitialVolume] = useState<number>(0);
  const [initialTime, setInitialTime] = useState<number>(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setTouchStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
      setInitialVolume(videoRef.current?.volume || volume);
      setInitialTime(videoRef.current?.currentTime || currentTime);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStart || !videoRef.current) return;
    
    const deltaX = e.touches[0].clientX - touchStart.x;
    const deltaY = e.touches[0].clientY - touchStart.y;
    
    // 判断滑动意图：水平(进度) 还是 垂直(音量)
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 20) {
      // 左右滑动：快进/快退 (每滑动全屏宽度的一半 = 跳转 30秒)
      const screenWidth = window.innerWidth;
      const timeDelta = (deltaX / (screenWidth / 2)) * 30; 
      let newTime = initialTime + timeDelta;
      newTime = Math.max(0, Math.min(newTime, duration));
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
      setShowControls(true);
    } else if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 20) {
      // 上下滑动：调整音量 (每滑动屏幕高度的三分之一 = 音量 100%)
      const screenHeight = window.innerHeight;
      const volumeDelta = -(deltaY / (screenHeight / 3)); // 向上滑是正，所以取负数
      let newVolume = initialVolume + volumeDelta;
      newVolume = Math.max(0, Math.min(newVolume, 1));
      videoRef.current.volume = newVolume;
      videoRef.current.muted = newVolume === 0;
      setVolume(newVolume);
      setIsMuted(newVolume === 0);
      setShowControls(true);
    }
  };

  const handleTouchEnd = () => {
    setTouchStart(null);
    if (videoRef.current) {
      localStorage.setItem("nas-video-volume", videoRef.current.volume.toString());
      localStorage.setItem("nas-video-muted", String(videoRef.current.volume === 0));
    }
  };

  const [isLongPressing, setIsLongPressing] = useState(false);
  const longPressTimerRef = useRef<NodeJS.Timeout>();

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return; // 仅限左键或触控
    longPressTimerRef.current = setTimeout(() => {
      setIsLongPressing(true);
      if (videoRef.current) {
        videoRef.current.playbackRate = 2.0;
        setPlaybackRate(2.0);
      }
    }, 500); // 长按 500ms 触发
  };

  const handlePointerUpOrLeave = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    if (isLongPressing) {
      setIsLongPressing(false);
      if (videoRef.current) {
        videoRef.current.playbackRate = 1.0;
        setPlaybackRate(1.0);
      }
    }
  };

  const togglePlay = (e?: React.MouseEvent | React.TouchEvent) => {
    e?.stopPropagation();
    if (isLongPressing) return; // 长按触发时不切换播放状态
    if (videoRef.current?.paused) {
      videoRef.current.play();
    } else {
      videoRef.current?.pause();
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoRef.current) {
      const newMuted = !videoRef.current.muted;
      videoRef.current.muted = newMuted;
      setIsMuted(newMuted);
      localStorage.setItem("nas-video-muted", String(newMuted));
      // 如果解除静音时音量为0，恢复到一半
      if (!newMuted && videoRef.current.volume === 0) {
        videoRef.current.volume = 0.5;
        setVolume(0.5);
        localStorage.setItem("nas-video-volume", "0.5");
      }
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const newVolume = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      videoRef.current.muted = newVolume === 0;
      setVolume(newVolume);
      setIsMuted(newVolume === 0);
      localStorage.setItem("nas-video-volume", newVolume.toString());
      localStorage.setItem("nas-video-muted", String(newVolume === 0));
    }
  };

  const toggleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "00:00";
    const m = Math.floor(time / 60).toString().padStart(2, "0");
    const s = Math.floor(time % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-full flex items-center justify-center overflow-hidden shadow-2xl pointer-events-auto touch-none"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        isPlaying && setShowControls(false);
        handlePointerUpOrLeave();
      }}
      onClick={togglePlay}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUpOrLeave}
      onPointerCancel={handlePointerUpOrLeave}
    >
      <video
        ref={videoRef}
        src={url}
        autoPlay
        className="w-full h-full object-contain"
        onClick={e => e.stopPropagation()} // 防止穿透到底层，同时让外层 div 捕捉点击
      />
      
      {/* 长按 2 倍速提示层 */}
      <div 
        className={`absolute top-8 left-1/2 -translate-x-1/2 bg-black/40 backdrop-blur-md px-4 py-1.5 rounded-full text-white/90 text-[13px] font-medium flex items-center gap-2 transition-all duration-300 z-50 ${
          isLongPressing ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4 pointer-events-none"
        }`}
      >
        <Play size={14} className="fill-white" />
        Playing at 2x speed
      </div>

      {/* 控制条 - 只有悬停时显示，并且背景极其克制，绝不影响整体画面亮度 */}
      <div 
        className={`absolute bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-3xl flex items-center gap-4 px-4 py-2.5 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/10 transition-all duration-300 ${
          showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
        }`}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={togglePlay} className="text-white hover:text-primary transition-colors shrink-0">
          {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>

        <div className="text-[12px] text-white/90 font-mono w-12 shrink-0 text-center">
          {formatTime(currentTime)}
        </div>

        <input
          type="range"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={(e) => {
            if (videoRef.current) {
              videoRef.current.currentTime = Number(e.target.value);
              setCurrentTime(Number(e.target.value));
            }
          }}
          className="flex-1 h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
        />

        <div className="text-[12px] text-white/50 font-mono w-12 shrink-0 text-center">
          {formatTime(duration)}
        </div>

        {/* 音量控制组 */}
        <div 
          className="relative flex items-center shrink-0 ml-2 h-full"
          onMouseEnter={() => setShowVolumeSlider(true)}
          onMouseLeave={() => setShowVolumeSlider(false)}
        >
          <button 
            onClick={toggleMute} 
            className="text-white/80 hover:text-white transition-colors p-1"
          >
            {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          
          <div 
            className={`overflow-hidden transition-all duration-300 ease-out flex items-center ${
              showVolumeSlider ? "w-20 opacity-100 ml-2" : "w-0 opacity-0 ml-0"
            }`}
          >
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              onClick={e => e.stopPropagation()}
              className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer accent-white [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
            />
          </div>
        </div>

        {/* 倍速控制组 */}
        <div 
          className="relative flex items-center shrink-0 ml-1 h-full"
          onMouseEnter={() => setShowSpeedMenu(true)}
          onMouseLeave={() => setShowSpeedMenu(false)}
        >
          <button 
            className="text-[13px] font-mono text-white/80 hover:text-white transition-colors px-2 py-1 rounded-md hover:bg-white/10"
          >
            {playbackRate}x
          </button>
          
          {showSpeedMenu && (
            <div className="absolute bottom-full right-0 pb-2 z-50">
              <div className="flex flex-col bg-black/80 backdrop-blur-xl border border-white/10 rounded-lg overflow-hidden py-1 shadow-2xl">
                {[2, 1.75, 1.5, 1.25, 1, 0.75, 0.5].map((rate) => (
                <button
                  key={rate}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (videoRef.current) {
                      videoRef.current.playbackRate = rate;
                      setPlaybackRate(rate);
                      setShowSpeedMenu(false);
                    }
                  }}
                  className={`px-4 py-1.5 text-[12px] font-mono text-left hover:bg-white/10 transition-colors whitespace-nowrap ${
                    playbackRate === rate ? "text-primary font-bold bg-white/5" : "text-white/80"
                  }`}
                >
                  {rate === 1 ? "Normal" : `${rate}x`}
                </button>
                ))}
              </div>
            </div>
          )}

        </div>

        <button onClick={toggleFullscreen} className="text-white/80 hover:text-white transition-colors shrink-0 ml-2">
          <Maximize size={18} />
        </button>
      </div>
    </div>
  );
}

export default function Browser() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme, setTheme } = useTheme();
  const activeConnection = useConnectionStore((state) => state.getActiveConnection());
  const setActiveConnection = useConnectionStore((state) => state.setActiveConnection);
  const hasHydrated = useConnectionStore((state) => state.hasHydrated);
  const lastSaveDir = useTransfersStore((s) => s.lastSaveDir);
  const setLastSaveDir = useTransfersStore((s) => s.setLastSaveDir);
  const upsertTask = useTransfersStore((s) => s.upsertTask);
  const initialPath = searchParams.get("path") || "/";
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<"name" | "date" | "size">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    return (localStorage.getItem("nas-view-mode") as "list" | "grid") || "list";
  });
  const [proxyPort, setProxyPort] = useState<number | null>(null);
  const [openMenuPath, setOpenMenuPath] = useState<string | null>(null);
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileItem | null>(null);
  const [renameName, setRenameName] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ item: FileItem; url: string; type: "image" | "video" | "unknown" } | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const loadSeqRef = useRef(0);
  const [gridCols, setGridCols] = useState(3);
  const [scrollElWidth, setScrollElWidth] = useState(0);
  const breadcrumbs = currentPath.split("/").filter(Boolean);
  const webdavBaseName = (() => {
    if (!activeConnection || activeConnection.protocol !== "webdav") return null;
    try {
      const u = new URL(activeConnection.url);
      const decoded = decodeURIComponent(u.pathname || "/");
      const parts = decoded.split("/").filter(Boolean);
      if (parts.length === 0) return null;
      return parts[parts.length - 1] || null;
    } catch {
      return null;
    }
  })();
  const displayedFiles = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = files
      .filter((f) => f.name !== ".DS_Store" && f.name !== "Thumbs.db")
      .filter((f) => (q ? f.name.toLowerCase().includes(q) : true));
    const sorted = [...filtered].sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      let cmp = 0;
      if (sortKey === "name") {
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      } else if (sortKey === "size") {
        const sa = a.is_dir ? 0 : a.size;
        const sb = b.is_dir ? 0 : b.size;
        cmp = sa - sb;
      } else {
        const da = a.last_modified ?? 0;
        const db = b.last_modified ?? 0;
        cmp = da - db;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [files, searchQuery, sortKey, sortDir]);

  useEffect(() => {
    getProxyPort()
      .then((port) => setProxyPort(port))
      .catch((err) => console.error("Failed to get proxy port:", err));
  }, []);

  useEffect(() => {
    const el = scrollParentRef.current;
    if (!el) return;
    const calc = () => {
      const w = el.clientWidth;
      setScrollElWidth(w);
      let cols = 3;
      if (w >= 1280) cols = 7;
      else if (w >= 1024) cols = 6;
      else if (w >= 768) cols = 5;
      else if (w >= 640) cols = 4;
      setGridCols(cols);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const gridRows = React.useMemo(() => {
    if (viewMode !== "grid") return [] as FileItem[][];
    const rows: FileItem[][] = [];
    for (let i = 0; i < displayedFiles.length; i += gridCols) {
      rows.push(displayedFiles.slice(i, i + gridCols));
    }
    return rows;
  }, [viewMode, displayedFiles, gridCols]);

  const gridRowHeight = React.useMemo(() => {
    const gap = 16; // gap-4 (16px)
    const padding = 32; // p-4 (16px) * 2
    const contentW = Math.max(0, scrollElWidth - padding);
    
    // tileW: 每列的宽度 = (总宽 - 所有间距) / 列数
    const tileW = contentW > 0 ? (contentW - gap * (gridCols - 1)) / gridCols : 160;
    
    // rowHeight = tileW (图片是正方形 aspect-square) + 文字高度(大约 20px) + 下边距(mb-2 即 8px) + 行间距(gap-4 即 16px)
    return Math.max(160, Math.ceil(tileW + 20 + 8 + gap));
  }, [scrollElWidth, gridCols]);

  const gridVirtualizer = useVirtualizer({
    count: viewMode === "grid" ? gridRows.length : 0,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => gridRowHeight,
    overscan: 10,
  });

  useEffect(() => {
    gridVirtualizer.measure();
  }, [gridVirtualizer, gridRowHeight, gridCols]);
  // --- Sequential Preloader (符合用户要求的“进入文件夹后序列加载缓存”) ---
  useEffect(() => {
    if (viewMode !== "grid" || !activeConnection || !proxyPort) return;

    let cancelled = false;
    
    // 只取还没被缓存的图片进行预加载
    const imagesToPreload = getImagesInCurrentDir().filter(file => {
      const url = getThumbUrl(file);
      if (!url) return false;
      // 简单判断一下是否已经加载过了，其实依靠浏览器的 Cache-Control 也行，
      // 但加上这个可以避免不必要的 img.src 赋值触发
      return true; 
    });

    const preloadImages = async () => {
      for (const file of imagesToPreload) {
        if (cancelled) break;
        const url = getThumbUrl(file);
        if (!url) continue;
        
        // 尝试加载图片到浏览器内存缓存中
        try {
          await new Promise<void>((resolve) => {
            const img = new Image();
            // 加上 fetchpriority 告诉浏览器这是后台低优先级预加载
            img.fetchPriority = "low";
            img.src = url;
            
            // 如果图片瞬间加载完成（比如已经在本地磁盘缓存里了），不需要强行等待 20ms
            if (img.complete) {
              resolve();
              return;
            }
            
            img.onload = () => resolve();
            img.onerror = () => resolve(); // 失败也继续
          });
        } catch (e) {
          // ignore
        }
        
        // 缩短延时，加快预加载速度
        if (!cancelled) {
          await new Promise(r => setTimeout(r, 10));
        }
      }
    };

    preloadImages();

    return () => {
      cancelled = true;
    };
  }, [viewMode, activeConnection?.id, currentPath, proxyPort]);

  const loadDirectory = React.useCallback(async (path: string) => {
    if (!activeConnection) return;
    
    setLoading(true);
    setError(null);
    const seq = ++loadSeqRef.current;
    try {
      const items = await listDirectory(activeConnection.id, path);
      if (seq !== loadSeqRef.current) return;
      setFiles(items);
    } catch (err) {
      const msg =
        typeof err === "string"
          ? err
          : (err as any)?.message
          ? String((err as any).message)
          : JSON.stringify(err);
      toast.error("加载目录失败: " + msg);
      if (seq !== loadSeqRef.current) return;
      setError(msg);
    } finally {
      if (seq !== loadSeqRef.current) return;
      setLoading(false);
    }
  }, [activeConnection]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!activeConnection) {
      navigate("/");
      return;
    }

    loadDirectory(currentPath);
  }, [hasHydrated, activeConnection, currentPath, navigate, loadDirectory]);

  useEffect(() => {
    const p = searchParams.get("path") || "/";
    if (p !== currentPath) {
      setCurrentPath(p);
    }
  }, [searchParams, currentPath]);

  useEffect(() => {
    if (!searchParams.get("path")) {
      setSearchParams({ path: currentPath }, { replace: true });
    }
  }, [searchParams, setSearchParams, currentPath]);

  const setPath = (path: string, replace: boolean = false) => {
    setCurrentPath(path);
    setSearchParams({ path }, { replace });
  };

  useEffect(() => {
    if (renameInputRef.current && isRenameOpen) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenameOpen]);

  const getImagesInCurrentDir = () => {
    return displayedFiles.filter(f => {
      if (f.is_dir) return false;
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
    });
  };

  const getThumbUrl = (file: FileItem) => {
    if (!activeConnection || !proxyPort) return null;
    const encodedPath = encodeURIComponent(file.path);
    const encodedId = encodeURIComponent(activeConnection.id);
    return `http://127.0.0.1:${proxyPort}/stream?id=${encodedId}&path=${encodedPath}&thumb=true`;
  };

  const handlePrevImage = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!previewFile || previewFile.type !== 'image') return;
    const images = getImagesInCurrentDir();
    const currentIndex = images.findIndex(img => img.path === previewFile.item.path);
    if (currentIndex > 0) {
      handleItemClick(e, images[currentIndex - 1]);
    }
  };

  const handleNextImage = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!previewFile || previewFile.type !== 'image') return;
    const images = getImagesInCurrentDir();
    const currentIndex = images.findIndex(img => img.path === previewFile.item.path);
    if (currentIndex !== -1 && currentIndex < images.length - 1) {
      handleItemClick(e, images[currentIndex + 1]);
    }
  };

  const [imageTouchStart, setImageTouchStart] = useState<{ x: number, y: number } | null>(null);

  const handleImageTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setImageTouchStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
    }
  };

  const handleImageTouchEnd = (e: React.TouchEvent) => {
    if (!imageTouchStart || !previewFile || previewFile.type !== 'image') return;

    const touchEnd = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    const deltaX = touchEnd.x - imageTouchStart.x;
    const deltaY = touchEnd.y - imageTouchStart.y;

    // 如果主要意图是水平滑动且距离大于 50px
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
      const images = getImagesInCurrentDir();
      const currentIndex = images.findIndex(img => img.path === previewFile.item.path);
      
      if (deltaX > 0 && currentIndex > 0) {
        // 向右滑 -> 上一张
        handleItemClick(e as unknown as React.MouseEvent, images[currentIndex - 1]);
      } else if (deltaX < 0 && currentIndex !== -1 && currentIndex < images.length - 1) {
        // 向左滑 -> 下一张
        handleItemClick(e as unknown as React.MouseEvent, images[currentIndex + 1]);
      }
    }
    setImageTouchStart(null);
  };

  const showPermissionAlertIfNeeded = (err: unknown): boolean => {
    const msg =
      typeof err === "string"
        ? err
        : (err as any)?.message
        ? String((err as any).message)
        : JSON.stringify(err);
    if (
      msg.includes("PermissionDenied") ||
      msg.includes("Permission denied") ||
      msg.includes("HTTP 403")
    ) {
      toast.error("权限不足");
      return true;
    }
    return false;
  };

  const handleNewFolder = () => {
    setNewFolderName("");
    setIsNewFolderOpen(true);
  };

  const handleCreateFolder = async () => {
    if (!activeConnection) return;
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    const p = currentPath === "/" ? `/${trimmed}` : `${currentPath.replace(/\/$/, "")}/${trimmed}`;
    try {
      setIsCreatingFolder(true);
      await mkdirItem(activeConnection.id, p);
      toast.success("文件夹创建成功");
      await loadDirectory(currentPath);
      setIsNewFolderOpen(false);
    } catch (err) {
      if (!showPermissionAlertIfNeeded(err)) {
        toast.error(typeof err === "string" ? err : JSON.stringify(err));
      }
    } finally {
      setIsCreatingFolder(false);
      setOpenMenuPath(null);
    }
  };

  const handleRename = (item: FileItem) => {
    setRenameTarget(item);
    setRenameName(item.name);
    setRenameError(null);
    setIsRenameOpen(true);
    setOpenMenuPath(null);
  };

  const handleConfirmRename = async () => {
    if (!activeConnection || !renameTarget) return;
    const trimmed = (renameInputRef.current?.value ?? renameName).trim();
    if (!trimmed) {
      setRenameError("请输入新名称");
      return;
    }
    if (trimmed === renameTarget.name) {
      setRenameError("名称未变化");
      return;
    }
    const parts = renameTarget.path.split("/").filter(Boolean);
    parts.pop();
    const parent = parts.length ? `/${parts.join("/")}` : "/";
    const newPath = parent === "/" ? `/${trimmed}` : `${parent}/${trimmed}`;
    try {
      setIsRenaming(true);
      setRenameError(null);
      await renameItem(activeConnection.id, renameTarget.path, newPath);
      toast.success("重命名成功");
      await loadDirectory(currentPath);
      setIsRenameOpen(false);
    } catch (err) {
      if (!showPermissionAlertIfNeeded(err)) {
        const msg =
          typeof err === "string"
            ? err
            : (err as any)?.message
            ? String((err as any).message)
            : JSON.stringify(err);
        setRenameError(msg);
      } else {
        setRenameError("权限不足");
      }
    } finally {
      setIsRenaming(false);
      setOpenMenuPath(null);
    }
  };

  const handleDownload = async (item: FileItem) => {
    if (!activeConnection) return;
    if (item.is_dir) return;

    const selected = await save({
      defaultPath: lastSaveDir ? `${lastSaveDir.replace(/\/$/, "")}/${item.name}` : item.name,
    });
    if (!selected) return;

    const p = String(selected);
    const lastSlash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    if (lastSlash > 0) setLastSaveDir(p.slice(0, lastSlash));

    const downloadId = `dl_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    upsertTask({
      id: downloadId,
      kind: "download",
      connectionId: activeConnection.id,
      remotePath: item.path,
      fileName: item.name,
      localPath: p,
      state: "queued",
      transferred: 0,
      total: item.size ?? null,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await startDownload(activeConnection.id, downloadId, item.path, p);
    navigate("/transfers");
  };

  const handleDelete = (item: FileItem) => {
    setDeleteTarget(item);
    setIsDeleteOpen(true);
    setOpenMenuPath(null);
  };

  const handleConfirmDelete = async () => {
    if (!activeConnection || !deleteTarget) return;
    try {
      setIsDeleting(true);
      await deleteItem(activeConnection.id, deleteTarget.path);
      toast.success("删除成功");
      await loadDirectory(currentPath);
      setIsDeleteOpen(false);
    } catch (err) {
      if (!showPermissionAlertIfNeeded(err)) {
        toast.error(typeof err === "string" ? err : JSON.stringify(err));
      }
    } finally {
      setIsDeleting(false);
      setOpenMenuPath(null);
    }
  };

  const [longPressItem, setLongPressItem] = useState<FileItem | null>(null);
  const [isLongPressTriggered, setIsLongPressTriggered] = useState(false);
  const itemLongPressTimerRef = useRef<NodeJS.Timeout>();

  const handleItemPointerDown = (e: React.PointerEvent, file: FileItem) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    setIsLongPressTriggered(false);
    itemLongPressTimerRef.current = setTimeout(() => {
      setIsLongPressTriggered(true);
      setLongPressItem(file);
      setOpenMenuPath(file.path);
      // 可选：触发震动反馈 (如果设备支持)
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, 600); // 600ms 触发菜单
  };

  const handleItemPointerUpOrLeave = () => {
    if (itemLongPressTimerRef.current) {
      clearTimeout(itemLongPressTimerRef.current);
    }
  };

  const handleItemClick = async (e: React.MouseEvent, item: FileItem) => {
    // 如果刚刚触发了长按菜单，则忽略随之而来的点击事件，防止误进文件夹
    if (isLongPressTriggered) {
      setIsLongPressTriggered(false);
      return;
    }
    
    if (item.is_dir) {
      setPath(item.path);
    } else {
      if (!activeConnection) return;
      const ext = item.name.split('.').pop()?.toLowerCase() || '';
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
      const isVideo = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v'].includes(ext);
      
      try {
        const url = await getProxyUrl(activeConnection.id, item.path);
        if (isImage) {
          setPreviewFile({ item, url, type: "image" });
        } else if (isVideo) {
          setPreviewFile({ item, url, type: "video" });
        } else {
          setPreviewFile({ item, url, type: "unknown" });
        }
      } catch (err) {
        toast.error("获取预览失败: " + err);
      }
    }
  };

  const handleBack = () => {
    if (currentPath === "/") return;
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    setPath(parts.length === 0 ? "/" : `/${parts.join("/")}`);
  };

  const handleDisconnect = () => {
    setActiveConnection(null);
    navigate("/");
  };

  if (!activeConnection) return null;

  return (
    <div className="h-screen w-full flex flex-col bg-background">
      {/* Titlebar */}
      <div className="titlebar h-10 w-full flex items-center justify-between px-4 border-b border-border-standard bg-panel">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 titlebar-button">
            <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50 hover:bg-red-500/80 transition-colors"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50 hover:bg-yellow-500/80 transition-colors"></div>
            <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50 hover:bg-green-500/80 transition-colors"></div>
          </div>
        </div>
        <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <HardDrive size={12} className="text-primary" />
          {activeConnection.name}
        </div>
        <div className="flex items-center gap-2 titlebar-button">
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-1.5 rounded-md hover:bg-ghost text-muted-foreground hover:text-foreground transition-colors"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile Sidebar Overlay */}
        {isSidebarOpen && (
          <div 
            className="fixed inset-0 z-40 bg-black/50 md:hidden transition-opacity"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <div className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 w-[240px] shrink-0 border-r border-border-standard bg-panel flex flex-col ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}>
          <div className="p-4 flex-1">
            <div className="text-[11px] font-[510] text-muted-foreground mb-3 px-2 uppercase tracking-widest">Locations</div>
            <div className="space-y-0.5">
              <button 
                onClick={() => {
                  setPath("/");
                  setIsSidebarOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[14px] font-medium transition-colors ${currentPath === "/" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-ghost hover:text-foreground"}`}
              >
                <div className="flex items-center gap-2">
                  <HardDrive size={16} className={currentPath === "/" ? "text-primary" : "text-muted-foreground"} />
                  {activeConnection.name}
                </div>
              </button>
              <button
                onClick={() => {
                  navigate("/transfers");
                  setIsSidebarOpen(false);
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[14px] font-medium transition-colors text-muted-foreground hover:bg-ghost hover:text-foreground"
              >
                <div className="flex items-center gap-2">
                  <Download size={16} className="text-muted-foreground" />
                  Transfers
                </div>
              </button>
            </div>
          </div>
          
          <div className="p-4 border-t border-border-standard">
            <button 
              onClick={() => {
                handleDisconnect();
                setIsSidebarOpen(false);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[14px] font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut size={16} />
              Disconnect
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col bg-background min-w-0">
          {/* Toolbar - Responsive layout for narrow screens */}
          <div className="border-b border-border-standard bg-panel shrink-0 flex flex-col xl:flex-row xl:h-14">
            {/* Breadcrumbs Row */}
            <div className="flex items-center px-4 justify-between gap-4 h-14 xl:flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  className="md:hidden p-1.5 rounded-md hover:bg-ghost text-muted-foreground transition-colors shrink-0"
                >
                  <Menu size={18} />
                </button>
                <button 
                  onClick={handleBack}
                  disabled={currentPath === "/"}
                  className="p-1.5 rounded-md hover:bg-ghost text-muted-foreground disabled:opacity-30 disabled:hover:bg-transparent transition-colors shrink-0"
                >
                  <ArrowLeft size={18} />
                </button>
                
                {/* Breadcrumbs */}
                <div className="flex items-center gap-1 ml-2 text-[14px] font-medium min-w-0 overflow-hidden whitespace-nowrap">
                  <span
                    className="text-muted-foreground cursor-pointer hover:text-foreground transition-colors shrink-0"
                    onClick={() => setPath("/")}
                  >
                    {webdavBaseName || activeConnection.name}
                  </span>
                  
                  {(() => {
                    if (breadcrumbs.length === 0) return null;
                    
                    // 当层级超过 3 层时，折叠中间的路径
                    if (breadcrumbs.length > 3) {
                      const lastTwo = breadcrumbs.slice(-2);
                      return (
                        <>
                          <ChevronRight size={14} className="text-muted-foreground/50 shrink-0" />
                          <span 
                            className="text-muted-foreground cursor-pointer hover:text-foreground transition-colors shrink-0 px-1"
                            title="... (Click to go up)"
                            onClick={() => {
                              const parentPath = "/" + breadcrumbs.slice(0, breadcrumbs.length - 2).join("/");
                              setPath(parentPath);
                            }}
                          >
                            ...
                          </span>
                          {lastTwo.map((seg, idx) => {
                            const originalIdx = breadcrumbs.length - 2 + idx;
                            const p = `/${breadcrumbs.slice(0, originalIdx + 1).join("/")}`;
                            const isLast = idx === 1; // lastTwo 的最后一个
                            return (
                              <span key={`${seg}-${originalIdx}`} className="flex items-center gap-1 min-w-0 shrink-0">
                                <ChevronRight size={14} className="text-muted-foreground/50 shrink-0" />
                                <span
                                  className={`${isLast ? "text-foreground" : "text-muted-foreground cursor-pointer hover:text-foreground transition-colors"} truncate max-w-[120px] md:max-w-[200px] shrink-0`}
                                  onClick={() => !isLast && setPath(p)}
                                  title={seg}
                                >
                                  {seg}
                                </span>
                              </span>
                            );
                          })}
                        </>
                      );
                    }

                    // 层级不深时正常显示
                    return breadcrumbs.map((seg, idx) => {
                      const p = `/${breadcrumbs.slice(0, idx + 1).join("/")}`;
                      const isLast = idx === breadcrumbs.length - 1;
                      return (
                        <span key={`${seg}-${idx}`} className="flex items-center gap-1 min-w-0 shrink-0">
                          <ChevronRight size={14} className="text-muted-foreground/50 shrink-0" />
                          <span
                            className={`${isLast ? "text-foreground" : "text-muted-foreground cursor-pointer hover:text-foreground transition-colors"} truncate max-w-[120px] md:max-w-[200px] shrink-0`}
                            onClick={() => !isLast && setPath(p)}
                            title={seg}
                          >
                            {seg}
                          </span>
                        </span>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Desktop Actions (Hidden on screens < xl) */}
              <div className="hidden xl:flex items-center gap-4 shrink-0">
                <div className="relative group">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
                  <input 
                    type="text" 
                    placeholder="Search files..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-ghost border border-border-standard rounded-md pl-8 pr-3 py-1.5 text-[13px] w-48 focus:outline-none focus:border-primary/50 text-foreground placeholder:text-muted-foreground/50 transition-all focus:w-64"
                  />
                </div>
                <div className="flex items-center gap-2 bg-ghost border border-border-standard rounded-md px-2 py-1">
                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as "name" | "date" | "size")}
                    className="bg-transparent text-[13px] text-muted-foreground focus:outline-none cursor-pointer"
                  >
                    <option value="name" className="bg-panel text-foreground">Name</option>
                    <option value="date" className="bg-panel text-foreground">Date</option>
                    <option value="size" className="bg-panel text-foreground">Size</option>
                  </select>
                  <button
                    onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
                    className="p-1 rounded hover:bg-surface text-muted-foreground hover:text-foreground transition-colors"
                    title={sortDir === "asc" ? "Ascending" : "Descending"}
                  >
                    <ArrowUpDown size={14} className={sortDir === "asc" ? "" : "rotate-180"} />
                  </button>
                </div>
                <button
                  onClick={handleNewFolder}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-ghost border border-border-standard text-[13px] text-muted-foreground hover:text-foreground hover:bg-surface transition-colors whitespace-nowrap shrink-0"
                  title="New folder"
                >
                  <FolderPlus size={14} />
                  <span className="max-w-[92px] truncate">New Folder</span>
                </button>
                <div className="flex bg-ghost border border-border-standard rounded-md p-0.5">
                  <button 
                    onClick={() => {
                      setViewMode("list");
                      localStorage.setItem("nas-view-mode", "list");
                    }}
                    className={`p-1 rounded transition-colors ${viewMode === "list" ? "bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.1)] text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <List size={14} />
                  </button>
                  <button 
                    onClick={() => {
                      setViewMode("grid");
                      localStorage.setItem("nas-view-mode", "grid");
                    }}
                    className={`p-1 rounded transition-colors ${viewMode === "grid" ? "bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.1)] text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <LayoutGrid size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Mobile Actions Row (Shown on screens < xl) */}
            <div className="flex xl:hidden items-center px-4 pb-3 justify-between gap-3 border-t border-border-standard/50 pt-3 bg-surface-elevated/30">
              <div className="relative group flex-1">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <input 
                  type="text" 
                  placeholder="Search files..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-ghost border border-border-standard rounded-md pl-8 pr-3 py-1.5 text-[13px] focus:outline-none focus:border-primary/50 text-foreground placeholder:text-muted-foreground/50 transition-all"
                />
              </div>
              <div className="flex items-center gap-2 bg-ghost border border-border-standard rounded-md px-2 py-1 shrink-0">
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as "name" | "date" | "size")}
                  className="bg-transparent text-[13px] text-muted-foreground focus:outline-none cursor-pointer w-16"
                >
                  <option value="name" className="bg-panel text-foreground">Name</option>
                  <option value="date" className="bg-panel text-foreground">Date</option>
                  <option value="size" className="bg-panel text-foreground">Size</option>
                </select>
                <button
                  onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
                  className="p-1 rounded hover:bg-surface text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowUpDown size={14} className={sortDir === "asc" ? "" : "rotate-180"} />
                </button>
              </div>
              <button
                onClick={handleNewFolder}
                className="p-1.5 rounded-md bg-ghost border border-border-standard text-muted-foreground hover:text-foreground hover:bg-surface transition-colors shrink-0"
                title="New folder"
              >
                <FolderPlus size={14} />
              </button>
              <div className="flex bg-ghost border border-border-standard rounded-md p-0.5 shrink-0">
                <button 
                  onClick={() => {
                    setViewMode("list");
                    localStorage.setItem("nas-view-mode", "list");
                  }}
                  className={`p-1 rounded transition-colors ${viewMode === "list" ? "bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.1)] text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <List size={14} />
                </button>
                <button 
                  onClick={() => {
                    setViewMode("grid");
                    localStorage.setItem("nas-view-mode", "grid");
                  }}
                  className={`p-1 rounded transition-colors ${viewMode === "grid" ? "bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.1)] text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <LayoutGrid size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* File List */}
          <div ref={scrollParentRef} className="flex-1 overflow-auto p-4">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                <Loader2 size={24} className="text-primary animate-spin" />
                <span className="text-sm font-medium">Loading directory...</span>
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-full text-destructive text-sm bg-destructive/10 p-4 rounded-lg mx-4">
                {error}
              </div>
            ) : displayedFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <div className="w-16 h-16 rounded-full bg-ghost border border-border-standard flex items-center justify-center mb-4">
                  <Folder size={24} className="text-muted-foreground/50" />
                </div>
                <p className="text-[15px] font-[510] text-foreground">{searchQuery.trim() ? "No matches" : "This folder is empty"}</p>
                <p className="text-sm mt-1">{searchQuery.trim() ? "Try a different search term" : "No files or directories found"}</p>
              </div>
            ) : viewMode === "grid" ? (
              <div style={{ height: gridVirtualizer.getTotalSize(), position: "relative", width: "100%" }}>
                {gridVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = gridRows[virtualRow.index] || [];
                  return (
                    <div
                      key={virtualRow.key}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: `${virtualRow.size}px`,
                        transform: `translate3d(0, ${virtualRow.start}px, 0)`,
                        willChange: "transform"
                      }}
                    >
                      <div className="grid gap-4 content-start" style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}>
                        {row.map((file) => {
                          const ext = file.name.split(".").pop()?.toLowerCase() || "";
                          const isImage = !file.is_dir && ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext);
                          const isVideo = !file.is_dir && ["mp4", "webm", "mov", "mkv", "avi", "m4v"].includes(ext);
                          const isAudio = !file.is_dir && ["mp3", "wav", "flac", "m4a", "aac", "opus", "ogg"].includes(ext);
                          const isArchive = !file.is_dir && ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext);
                          const isDoc = !file.is_dir && ["txt", "md", "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx"].includes(ext);
                          const thumbUrl = isImage ? getThumbUrl(file) : null;
                          return (
                            <div
                              key={file.path}
                              onClick={(e) => handleItemClick(e, file)}
                              onPointerDown={(e) => handleItemPointerDown(e, file)}
                              onPointerUp={handleItemPointerUpOrLeave}
                              onPointerCancel={handleItemPointerUpOrLeave}
                              onPointerLeave={handleItemPointerUpOrLeave}
                              className="group cursor-pointer flex flex-col items-center select-none relative"
                            >
                              <div className="w-full aspect-square bg-surface rounded-lg overflow-hidden border border-transparent group-hover:border-primary/50 transition-colors relative mb-2 shadow-sm flex items-center justify-center">
                                {isImage ? (
                                  thumbUrl ? (
                                    <div
                                      className="w-full h-full object-cover bg-no-repeat bg-center bg-cover"
                                      style={{ backgroundImage: `url(${thumbUrl})` }}
                                    />
                                  ) : (
                                    <FileImage size={40} className="text-muted-foreground/60" />
                                  )
                                ) : isVideo ? (
                                  <>
                                    <div className="w-full h-full bg-surface-elevated flex items-center justify-center">
                                      <FileVideo size={44} className="text-muted-foreground/40" />
                                    </div>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <div className="w-8 h-8 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-white">
                                        <Play size={14} className="fill-white ml-0.5" />
                                      </div>
                                    </div>
                                  </>
                                ) : isAudio ? (
                                  <FileAudio size={44} className="text-muted-foreground/60" />
                                ) : isArchive ? (
                                  <FileArchive size={44} className="text-muted-foreground/60" />
                                ) : isDoc ? (
                                  <FileText size={44} className="text-muted-foreground/60" />
                                ) : file.is_dir ? (
                                  <Folder size={48} className="text-primary/80" fill="currentColor" fillOpacity={0.2} />
                                ) : (
                                  <File size={40} className="text-muted-foreground/60" />
                                )}

                                {!file.is_dir && (
                                  <div className="absolute bottom-1 right-1 bg-black/60 backdrop-blur text-[10px] px-1 rounded text-white/90 font-mono">
                                    {(file.size / 1024 / 1024).toFixed(1)} MB
                                  </div>
                                )}
                              </div>
                              <div className="text-[13px] text-foreground truncate w-full text-center px-1" title={file.name}>
                                {file.name}
                              </div>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuPath(openMenuPath === file.path ? null : file.path);
                                }}
                                className={`absolute top-1 right-1 p-1 rounded-md transition-all z-10 shadow-sm ${
                                  openMenuPath === file.path
                                    ? "opacity-100 text-foreground bg-panel"
                                    : "opacity-100 md:opacity-0 md:group-hover:opacity-100 bg-panel/80 backdrop-blur hover:bg-panel text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                <MoreHorizontal size={14} />
                              </button>

                              {openMenuPath === file.path && (
                                <div
                                  className="absolute right-0 top-8 mt-1 w-44 rounded-lg border border-border-standard bg-panel shadow-lg overflow-hidden z-50"
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseLeave={() => setOpenMenuPath(null)}
                                >
                                  <div className="p-1 border-b border-border-standard/50">
                                    <div className="px-2 py-1 text-xs text-muted-foreground font-medium truncate" title={file.name}>
                                      {file.name}
                                    </div>
                                  </div>
                                  <div className="p-1 flex flex-col gap-0.5">
                                    <button
                                      onClick={() => {
                                        setOpenMenuPath(null);
                                        handleRename(file);
                                      }}
                                      className="flex items-center gap-2 px-2 py-1.5 text-[13px] text-muted-foreground hover:text-foreground hover:bg-surface rounded-md transition-colors w-full text-left"
                                    >
                                      <Pencil size={14} />
                                      Rename
                                    </button>
                                    {!file.is_dir && (
                                      <button
                                        onClick={() => {
                                          setOpenMenuPath(null);
                                          handleDownload(file);
                                        }}
                                        className="flex items-center gap-2 px-2 py-1.5 text-[13px] text-muted-foreground hover:text-foreground hover:bg-surface rounded-md transition-colors w-full text-left"
                                      >
                                        <Download size={14} />
                                        Download
                                      </button>
                                    )}
                                    <button
                                      onClick={() => {
                                        setOpenMenuPath(null);
                                        handleDelete(file);
                                      }}
                                      className="flex items-center gap-2 px-2 py-1.5 text-[13px] text-red-500/80 hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors w-full text-left mt-1 border-t border-border-standard/50 pt-1.5"
                                    >
                                      <Trash2 size={14} />
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-0.5">
                <div className="grid grid-cols-[auto_1fr_auto] md:grid-cols-[auto_1fr_120px_150px_40px] gap-4 px-3 py-2 text-[12px] font-[510] text-muted-foreground border-b border-border-standard mb-2 uppercase tracking-wider">
                  <div className="w-5"></div>
                  <div className="min-w-0 truncate">Name</div>
                  <div className="text-right hidden md:block">Size</div>
                  <div className="hidden md:block">Date Modified</div>
                  <div></div>
                </div>
                {displayedFiles.map((file, idx) => (
                  <div 
                    key={idx}
                    onClick={(e) => handleItemClick(e, file)}
                    onPointerDown={(e) => handleItemPointerDown(e, file)}
                    onPointerUp={handleItemPointerUpOrLeave}
                    onPointerCancel={handleItemPointerUpOrLeave}
                    onPointerLeave={handleItemPointerUpOrLeave}
                    className="grid grid-cols-[auto_1fr_auto] md:grid-cols-[auto_1fr_120px_150px_40px] gap-4 px-3 py-2.5 rounded-lg hover:bg-surface cursor-pointer items-center group transition-colors border border-transparent hover:border-border-standard select-none"
                  >
                    <div className="text-muted-foreground group-hover:text-primary transition-colors">
                      {file.is_dir ? <Folder size={18} fill="currentColor" fillOpacity={0.2} /> : <File size={18} />}
                    </div>
                    <div className="text-[14px] font-[510] text-foreground truncate min-w-0 pr-4" title={file.name}>
                      {file.name}
                    </div>
                    <div className="text-[13px] text-muted-foreground text-right font-mono hidden md:block">
                      {file.is_dir ? "--" : `${(file.size / 1024 / 1024).toFixed(1)} MB`}
                    </div>
                    <div className="text-[13px] text-muted-foreground hidden md:block">
                      {file.last_modified ? new Date(file.last_modified * 1000).toLocaleDateString() : "--"}
                    </div>
                    <div className="flex justify-end">
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuPath(openMenuPath === file.path ? null : file.path);
                          }}
                          className={`p-1 rounded-md transition-all ${openMenuPath === file.path ? "opacity-100 text-foreground bg-ghost" : "opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:bg-ghost text-muted-foreground hover:text-foreground"}`}
                        >
                          <MoreHorizontal size={16} />
                        </button>
                        {openMenuPath === file.path && (
                          <div
                            className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-border-standard bg-panel shadow-lg overflow-hidden z-50"
                            onClick={(e) => e.stopPropagation()}
                            onMouseLeave={() => setOpenMenuPath(null)}
                          >
                            <button
                              onClick={() => handleRename(file)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-ghost transition-colors"
                            >
                              <Pencil size={14} />
                              Rename
                            </button>
                            {!file.is_dir && (
                              <button
                                onClick={() => handleDownload(file)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-ghost transition-colors"
                              >
                                <Download size={14} />
                                Download
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(file)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            >
                              <Trash2 size={14} />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {isNewFolderOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
          onClick={() => !isCreatingFolder && setIsNewFolderOpen(false)}
        >
          <div
            className="w-[380px] rounded-xl bg-panel border border-border-standard shadow-lg p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[14px] font-[510] text-foreground mb-3">New Folder</div>
            <input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
              }}
              className="w-full bg-ghost border border-border-standard rounded-md px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
              placeholder="Folder name"
              disabled={isCreatingFolder}
            />
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setIsNewFolderOpen(false)}
                disabled={isCreatingFolder}
                className="px-3 py-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-ghost border border-border-standard bg-ghost transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={isCreatingFolder || !newFolderName.trim()}
                className="px-3 py-1.5 rounded-md text-[13px] text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 transition-colors disabled:opacity-50"
              >
                {isCreatingFolder ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
      {isRenameOpen && renameTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
          onClick={() => !isRenaming && setIsRenameOpen(false)}
        >
          <div
            className="w-[420px] rounded-xl bg-panel border border-border-standard shadow-lg p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[14px] font-[510] text-foreground mb-1">Rename</div>
            <div className="text-[12px] text-muted-foreground mb-3 truncate">{renameTarget.name}</div>
            <input
              autoFocus
              ref={renameInputRef}
              value={renameName}
              onChange={(e) => {
                setRenameName(e.target.value);
                if (renameError) setRenameError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirmRename();
              }}
              className="w-full bg-ghost border border-border-standard rounded-md px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
              disabled={isRenaming}
            />
            {renameError && (
              <div className="mt-2 text-[12px] text-destructive truncate">{renameError}</div>
            )}
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setIsRenameOpen(false)}
                disabled={isRenaming}
                className="px-3 py-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-ghost border border-border-standard bg-ghost transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRename}
                disabled={isRenaming}
                className="px-3 py-1.5 rounded-md text-[13px] text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 transition-colors disabled:opacity-50"
              >
                {isRenaming ? "Renaming..." : "Rename"}
              </button>
            </div>
          </div>
        </div>
      )}
      {isDeleteOpen && deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
          onClick={() => !isDeleting && setIsDeleteOpen(false)}
        >
          <div
            className="w-[420px] rounded-xl bg-panel border border-border-standard shadow-lg p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[14px] font-[510] text-foreground mb-1">Delete</div>
            <div className="text-[12px] text-muted-foreground mb-4 truncate">Delete “{deleteTarget.name}”?</div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setIsDeleteOpen(false)}
                disabled={isDeleting}
                className="px-3 py-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-ghost border border-border-standard bg-ghost transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-3 py-1.5 rounded-md text-[13px] text-destructive bg-destructive/10 hover:bg-destructive/20 border border-destructive/20 transition-colors disabled:opacity-50"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      {previewFile && (
        <div
          className="fixed inset-0 z-[100] flex flex-col"
        >
          {/* 
            统一全屏半透明模糊遮罩 
            不管是图片还是视频，都提供一致的沉浸式体验 
            但为了视频播放器能穿透事件，这里只做背景
          */}
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm pointer-events-none" />
          
          {/* 当不是视频时，由这一层拦截背景点击来关闭预览 */}
          {previewFile.type !== "video" && (
            <div className="absolute inset-0" onClick={() => setPreviewFile(null)} />
          )}
          
          <div className="relative h-14 flex items-center justify-between px-4 text-white shrink-0 z-10" onClick={e => e.stopPropagation()}>
            <div className="truncate font-medium text-sm flex-1 drop-shadow-md">{previewFile.item.name}</div>
            <div className="flex items-center gap-3 shrink-0 ml-4">
              <button
                onClick={() => handleDownload(previewFile.item)}
                className="p-2 rounded-full bg-black/20 hover:bg-black/50 backdrop-blur-md transition-colors border border-white/10"
                title="Download"
              >
                <Download size={18} />
              </button>
              <button
                onClick={() => setPreviewFile(null)}
                className="p-2 rounded-full bg-black/20 hover:bg-black/50 backdrop-blur-md transition-colors border border-white/10"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          <div 
            className="relative flex-1 flex items-center justify-center p-4 overflow-hidden z-10 pointer-events-none" 
            onClick={e => previewFile.type !== "video" && e.stopPropagation()}
            onTouchStart={previewFile.type === "image" ? handleImageTouchStart : undefined}
            onTouchEnd={previewFile.type === "image" ? handleImageTouchEnd : undefined}
          >
            {previewFile.type === "image" && (
              <div className="relative w-full h-full flex items-center justify-center group pointer-events-auto">
                <img
                  src={previewFile.url}
                  alt={previewFile.item.name}
                  className="max-w-full max-h-full object-contain select-none"
                />
                
                {/* 翻页按钮 */}
                {(() => {
                  const images = getImagesInCurrentDir();
                  const currentIndex = images.findIndex(img => img.path === previewFile.item.path);
                  return (
                    <>
                      {currentIndex > 0 && (
                        <button 
                          onClick={handlePrevImage}
                          className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-black/20 hover:bg-black/50 text-white/70 hover:text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all border border-white/10"
                        >
                          <ChevronLeft size={28} />
                        </button>
                      )}
                      {currentIndex !== -1 && currentIndex < images.length - 1 && (
                        <button 
                          onClick={handleNextImage}
                          className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-black/20 hover:bg-black/50 text-white/70 hover:text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all border border-white/10"
                        >
                          <ChevronRight size={28} />
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
            {previewFile.type === "video" && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <CustomVideoPlayer url={previewFile.url} />
              </div>
            )}
            {previewFile.type === "unknown" && (
              <div className="bg-panel p-8 rounded-xl flex flex-col items-center gap-4 text-center max-w-sm pointer-events-auto">
                <div className="w-16 h-16 bg-ghost rounded-full flex items-center justify-center border border-border-standard">
                  <File size={32} className="text-muted-foreground" />
                </div>
                <div>
                  <h3 className="text-foreground font-medium mb-1">Preview not available</h3>
                  <p className="text-sm text-muted-foreground">
                    This file type cannot be previewed in the browser. You can download it to open it locally.
                  </p>
                </div>
                <button
                  onClick={() => handleDownload(previewFile.item)}
                  className="mt-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:opacity-90 transition-opacity flex items-center gap-2"
                >
                  <Download size={16} />
                  Download File
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

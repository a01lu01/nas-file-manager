import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import Browser from "@/pages/Browser";
import Transfers from "@/pages/Transfers";
import { ThemeProvider } from "@/components/theme-provider";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTransfersStore } from "@/lib/transfers-store";
import { Toaster } from "sonner";

function DownloadListeners() {
  const patchTask = useTransfersStore((s) => s.patchTask);

  useEffect(() => {
    let unlistenProgress: null | (() => void) = null;
    let unlistenState: null | (() => void) = null;

    (async () => {
      unlistenProgress = await listen<{
        download_id: string;
        transferred: number;
        total: number | null;
      }>("download-progress", (e) => {
        patchTask(e.payload.download_id, {
          transferred: e.payload.transferred,
          total: e.payload.total,
        });
      });

      unlistenState = await listen<{
        download_id: string;
        state: "queued" | "running" | "paused" | "done" | "error" | "canceled";
        error: string | null;
      }>("download-state", (e) => {
        patchTask(e.payload.download_id, {
          state: e.payload.state,
          error: e.payload.error,
        });
      });
    })();

    return () => {
      unlistenProgress?.();
      unlistenState?.();
    };
  }, [patchTask]);

  return null;
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="nas-theme" attribute="class">
      <DownloadListeners />
      <div className="min-h-screen bg-background text-foreground antialiased selection:bg-primary/30">
        <Router>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/browser" element={<Browser />} />
            <Route path="/transfers" element={<Transfers />} />
          </Routes>
        </Router>
        <Toaster position="bottom-center" richColors />
      </div>
    </ThemeProvider>
  );
}

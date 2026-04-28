import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import Browser from "@/pages/Browser";
import Transfers from "@/pages/Transfers";
import { ThemeProvider } from "@/components/theme-provider";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTransfersStore } from "@/lib/transfers-store";
import { Toaster } from "sonner";

function TransferListeners() {
  const patchTask = useTransfersStore((s) => s.patchTask);

  useEffect(() => {
    let unlistenDlProgress: null | (() => void) = null;
    let unlistenDlState: null | (() => void) = null;
    let unlistenUpProgress: null | (() => void) = null;
    let unlistenUpState: null | (() => void) = null;

    (async () => {
      unlistenDlProgress = await listen<{
        download_id: string;
        transferred: number;
        total: number | null;
      }>("download-progress", (e) => {
        patchTask(e.payload.download_id, {
          transferred: e.payload.transferred,
          total: e.payload.total,
        });
      });

      unlistenDlState = await listen<{
        download_id: string;
        state: "queued" | "running" | "paused" | "done" | "error" | "canceled";
        error: string | null;
      }>("download-state", (e) => {
        patchTask(e.payload.download_id, {
          state: e.payload.state,
          error: e.payload.error,
        });
      });

      unlistenUpProgress = await listen<{
        upload_id: string;
        transferred: number;
        total: number | null;
      }>("upload-progress", (e) => {
        patchTask(e.payload.upload_id, {
          transferred: e.payload.transferred,
          total: e.payload.total,
        });
      });

      unlistenUpState = await listen<{
        upload_id: string;
        state: "queued" | "running" | "paused" | "done" | "error" | "canceled";
        error: string | null;
      }>("upload-state", (e) => {
        patchTask(e.payload.upload_id, {
          state: e.payload.state,
          error: e.payload.error,
        });
      });
    })();

    return () => {
      unlistenDlProgress?.();
      unlistenDlState?.();
      unlistenUpProgress?.();
      unlistenUpState?.();
    };
  }, [patchTask]);

  return null;
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="nas-theme" attribute="class">
      <TransferListeners />
      <div 
        className="min-h-screen bg-background text-foreground antialiased selection:bg-primary/30 flex flex-col"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
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

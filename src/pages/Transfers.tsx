import { useTransfersStore } from "@/lib/transfers-store";
import { ArrowLeft, Download, Pause, Play, RotateCw, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cancelDownload, pauseDownload, resumeDownload, retryDownload } from "@/lib/tauri-api";
import { Titlebar } from "@/components/Titlebar";

export default function Transfers() {
  const navigate = useNavigate();
  const tasks = useTransfersStore((s) => s.tasks);
  const clearFinished = useTransfersStore((s) => s.clearFinished);
  const patchTask = useTransfersStore((s) => s.patchTask);

  return (
    <div className="h-screen w-full flex flex-col bg-background">
      <Titlebar title="Transfer Manager" showIcon={false} />

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
                    <div className="flex items-center gap-2">
                      <div className="text-[12px] text-muted-foreground whitespace-nowrap">
                        {t.state}
                      </div>
                      {t.state === "running" && (
                        <button
                          onClick={() => {
                            patchTask(t.id, { state: "paused" });
                            pauseDownload(t.id);
                          }}
                          className="p-1.5 rounded-md hover:bg-ghost text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Pause size={14} />
                        </button>
                      )}
                      {t.state === "paused" && (
                        <button
                          onClick={() => {
                            patchTask(t.id, { state: "running" });
                            resumeDownload(t.id);
                          }}
                          className="p-1.5 rounded-md hover:bg-ghost text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Play size={14} />
                        </button>
                      )}
                      {t.state !== "done" && (
                        <button
                          onClick={() => {
                            patchTask(t.id, { state: "canceled" });
                            cancelDownload(t.id, true);
                          }}
                          className="p-1.5 rounded-md hover:bg-ghost text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X size={14} />
                        </button>
                      )}
                      {(t.state === "error" || t.state === "canceled") && (
                        <button
                          onClick={() => {
                            patchTask(t.id, {
                              state: "queued",
                              transferred: 0,
                              error: null,
                            });
                            retryDownload(t.id);
                          }}
                          className="p-1.5 rounded-md hover:bg-ghost text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <RotateCw size={14} />
                        </button>
                      )}
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
                        {t.total
                          ? `${(t.transferred / 1024 / 1024).toFixed(1)} / ${(t.total / 1024 / 1024).toFixed(1)} MB`
                          : `${(t.transferred / 1024 / 1024).toFixed(1)} MB`}
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

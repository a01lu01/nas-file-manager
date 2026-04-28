import { useState } from "react";
import { useTransfersStore } from "@/lib/transfers-store";
import { ArrowLeft, Download, Pause, Play, RotateCw, X, Upload, Menu } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cancelDownload, pauseDownload, resumeDownload, retryDownload, cancelUpload, pauseUpload, resumeUpload, retryUpload } from "@/lib/tauri-api";
import { Titlebar } from "@/components/Titlebar";
import { useTranslation } from "@/lib/i18n";
import { toast } from "sonner";

interface TransfersProps {
  embedded?: boolean;
  onBack?: () => void;
  onOpenSidebar?: () => void;
}

export default function Transfers({ embedded, onBack, onOpenSidebar }: TransfersProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const tasks = useTransfersStore((s) => s.tasks);
  const clearFinished = useTransfersStore((s) => s.clearFinished);
  const patchTask = useTransfersStore((s) => s.patchTask);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("transfers.copied"));
    } catch {
      toast.error(t("transfers.copy_failed"));
    }
  };

  const handlePause = (task: any) => {
    patchTask(task.id, { state: "paused" });
    if (task.kind === "upload") pauseUpload(task.id);
    else pauseDownload(task.id);
  };

  const handleResume = (task: any) => {
    patchTask(task.id, { state: "running" });
    if (task.kind === "upload") resumeUpload(task.id);
    else resumeDownload(task.id);
  };

  const handleCancel = (task: any) => {
    patchTask(task.id, { state: "canceled" });
    if (task.kind === "upload") cancelUpload(task.id, true);
    else cancelDownload(task.id, true);
  };

  const handleRetry = (task: any) => {
    patchTask(task.id, {
      state: "queued",
      transferred: 0,
      error: null,
    });
    if (task.kind === "upload") retryUpload(task.connectionId, task.localPath, task.remotePath, task.id);
    else retryDownload(task.id);
  };

  return (
    <div className={embedded ? "flex-1 w-full flex flex-col bg-background relative" : "flex-1 w-full flex flex-col bg-background relative overflow-hidden"}>
      {!embedded && <Titlebar title={t('transfers.title')} showIcon={false} />}
      
      {embedded && (
        <div className="h-14 border-b border-border-standard bg-surface/50 backdrop-blur-md flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-3">
            <button 
              onClick={onOpenSidebar}
              className="md:hidden p-1.5 rounded-md hover:bg-ghost text-muted-foreground transition-colors shrink-0"
            >
              <Menu size={18} />
            </button>
            <span className="text-[14px] font-medium text-foreground">{t('transfers.title')}</span>
          </div>
          <button 
            onClick={onBack}
            className="p-1.5 rounded-md hover:bg-ghost text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-[510] text-foreground">{t('transfers.title')}</div>
          <button
            onClick={clearFinished}
            className="text-xs px-2.5 py-1.5 rounded-md bg-ghost border border-border-standard text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
          >
            {t('transfers.clear_finished')}
          </button>
        </div>

        {tasks.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t('transfers.no_transfers')}</div>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => {
              const pct =
                task.total && task.total > 0 ? Math.min(100, (task.transferred / task.total) * 100) : null;
              const sourcePath = task.kind === "download" ? task.remotePath : task.localPath;
              const targetPath = task.kind === "download" ? task.localPath : task.remotePath;
              const expanded = expandedIds.has(task.id);
              return (
                <div
                  key={task.id}
                  className="rounded-xl border border-border-standard bg-surface p-3 cursor-pointer"
                  onClick={() => toggleExpanded(task.id)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[14px] font-[510] text-foreground truncate flex items-center gap-2">
                        {task.kind === "upload" ? (
                          <Upload size={14} className="text-muted-foreground" />
                        ) : (
                          <Download size={14} className="text-muted-foreground" />
                        )}
                        {task.fileName}
                      </div>
                      <div className="text-[12px] text-muted-foreground truncate" title={targetPath}>
                        {targetPath}
                      </div>
                      {expanded && (
                        <div className="mt-2 space-y-1">
                          <div className="text-[12px] text-muted-foreground truncate" title={sourcePath}>
                            {t("transfers.source")}: {sourcePath}
                          </div>
                          <div className="text-[12px] text-muted-foreground truncate" title={targetPath}>
                            {t("transfers.target")}: {targetPath}
                          </div>
                          <div className="flex gap-2 pt-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void copyText(sourcePath);
                              }}
                              className="text-xs px-2 py-1 rounded-md bg-ghost border border-border-standard text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
                            >
                              {t("transfers.copy_source")}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void copyText(targetPath);
                              }}
                              className="text-xs px-2 py-1 rounded-md bg-ghost border border-border-standard text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
                            >
                              {t("transfers.copy_target")}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-[12px] text-muted-foreground whitespace-nowrap">
                        {task.state === "queued" ? t('transfers.queued') :
                         task.state === "running" ? t('transfers.running') :
                         task.state === "paused" ? t('transfers.paused') :
                         task.state === "done" ? t('transfers.done') :
                         task.state === "error" ? t('transfers.error') :
                         task.state === "canceled" ? t('transfers.canceled') : task.state}
                      </div>
                      {task.state === "running" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePause(task);
                          }}
                          className="p-1.5 rounded-md hover:bg-ghost text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Pause size={14} />
                        </button>
                      )}
                      {task.state === "paused" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleResume(task);
                          }}
                          className="p-1.5 rounded-md hover:bg-ghost text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Play size={14} />
                        </button>
                      )}
                      {task.state !== "done" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCancel(task);
                          }}
                          className="p-1.5 rounded-md hover:bg-ghost text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X size={14} />
                        </button>
                      )}
                      {(task.state === "error" || task.state === "canceled") && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRetry(task);
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
                        {task.total
                          ? `${(task.transferred / 1024 / 1024).toFixed(1)} / ${(task.total / 1024 / 1024).toFixed(1)} MB`
                          : `${(task.transferred / 1024 / 1024).toFixed(1)} MB`}
                      </div>
                      <div 
                        className="truncate max-w-[60%] cursor-help"
                        title={task.error ?? ""}
                      >
                        {task.error ?? ""}
                      </div>
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

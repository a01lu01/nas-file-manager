import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TransferState =
  | "queued"
  | "running"
  | "paused"
  | "done"
  | "error"
  | "canceled";

export type TransferKind = "download" | "upload";

export interface TransferTask {
  id: string;
  kind: TransferKind;
  connectionId: string;
  remotePath: string;
  fileName: string;
  localPath: string;
  state: TransferState;
  transferred: number;
  total: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

interface TransfersState {
  tasks: TransferTask[];
  lastSaveDir: string | null;
  upsertTask: (task: TransferTask) => void;
  patchTask: (id: string, patch: Partial<TransferTask>) => void;
  setLastSaveDir: (dir: string | null) => void;
  removeTask: (id: string) => void;
  clearFinished: () => void;
}

export const useTransfersStore = create<TransfersState>()(
  persist(
    (set) => ({
      tasks: [],
      lastSaveDir: null,
      upsertTask: (task) =>
        set((s) => {
          const idx = s.tasks.findIndex((t) => t.id === task.id);
          if (idx === -1) return { tasks: [task, ...s.tasks] };
          const next = [...s.tasks];
          next[idx] = task;
          return { tasks: next };
        }),
      patchTask: (id, patch) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t
          ),
        })),
      setLastSaveDir: (dir) => set({ lastSaveDir: dir }),
      removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
      clearFinished: () =>
        set((s) => ({
          tasks: s.tasks.filter((t) => !["done", "canceled"].includes(t.state)),
        })),
    }),
    {
      name: "nas-transfers-storage",
      partialize: (s) => ({
        lastSaveDir: s.lastSaveDir,
        tasks: s.tasks.map((t) =>
          ["running", "queued"].includes(t.state) ? { ...t, state: "paused" as TransferState } : t
        ),
      }),
    }
  )
);


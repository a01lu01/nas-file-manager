import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ServerConnection {
  id: string;
  name: string;
  protocol: "smb" | "webdav";
  url: string;
  user: string;
  // Note: For a production app, we would use Tauri's secure keystore (stronghold)
  // For this prototype, we're storing it here.
  pass: string; 
  auth_fallback?: boolean;
  isConnected: boolean;
}

interface ConnectionState {
  connections: ServerConnection[];
  activeConnectionId: string | null;
  hasHydrated: boolean;
  
  addConnection: (conn: Omit<ServerConnection, "isConnected">) => void;
  setConnections: (connections: ServerConnection[]) => void;
  removeConnection: (id: string) => void;
  setConnectionStatus: (id: string, isConnected: boolean) => void;
  setActiveConnection: (id: string | null) => void;
  getActiveConnection: () => ServerConnection | undefined;
  setHasHydrated: (v: boolean) => void;
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => ({
      connections: [],
      activeConnectionId: null,
      hasHydrated: false,

      addConnection: (conn) =>
        set((state) => ({
          connections: [...state.connections, { ...conn, isConnected: false }],
        })),

      setConnections: (connections) =>
        set({
          connections: connections.map((c) => ({ ...c, isConnected: false })),
        }),

      removeConnection: (id) =>
        set((state) => ({
          connections: state.connections.filter((c) => c.id !== id),
          activeConnectionId: state.activeConnectionId === id ? null : state.activeConnectionId,
        })),

      setConnectionStatus: (id, isConnected) =>
        set((state) => ({
          connections: state.connections.map((c) =>
            c.id === id ? { ...c, isConnected } : c
          ),
        })),

      setActiveConnection: (id) => set({ activeConnectionId: id }),
      
      getActiveConnection: () => {
        const { connections, activeConnectionId } = get();
        return connections.find(c => c.id === activeConnectionId);
      },
      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: "nas-connections-storage",
      // Only persist the connections list, not their active connected status
      partialize: (state) => ({
        connections: state.connections.map(c => ({ ...c, isConnected: false })),
        activeConnectionId: state.activeConnectionId,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

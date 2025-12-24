/**
 * Aetherium Automata - Log Store
 *
 * Lightweight in-renderer logging pipeline used by the OutputPanel.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'trace';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  source: string;
  message: string;
  data?: unknown;
}

interface LogState {
  logs: LogEntry[];
}

interface LogActions {
  addLog: (entry: Omit<LogEntry, 'id' | 'timestamp'> & { timestamp?: number; id?: string }) => void;
  clearLogs: () => void;
}

type LogStore = LogState & LogActions;

export const useLogStore = create<LogStore>()(
  immer((set) => ({
    logs: [],

    addLog: (entry) => {
      const ts = entry.timestamp ?? Date.now();
      const id = entry.id ?? `${ts}-${Math.random().toString(16).slice(2)}`;

      set((state) => {
        state.logs.push({
          id,
          timestamp: ts,
          level: entry.level,
          source: entry.source,
          message: entry.message,
          data: entry.data,
        });

        // Keep last 500 entries.
        if (state.logs.length > 500) {
          state.logs = state.logs.slice(-500);
        }
      });
    },

    clearLogs: () => {
      set((state) => {
        state.logs = [];
      });
    },
  })),
);

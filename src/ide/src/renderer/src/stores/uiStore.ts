/**
 * Aetherium Automata - UI Store
 * 
 * Manages UI state like panels, tabs, notifications, and layout.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';
import type {
  PanelId,
  PanelState,
  EditorTab,
  LayoutConfig,
  Notification,
  NotificationType,
  EditorMode,
} from '../types';

// ============================================================================
// State Types
// ============================================================================

interface UIState {
  // Layout
  layout: LayoutConfig;
  sidebarCollapsed: boolean;
  
  // Editor
  editorMode: EditorMode;
  tabs: EditorTab[];
  activeTabId: string | null;
  
  // Notifications
  notifications: Notification[];
  
  // Modal/Dialog state
  activeModal: string | null;
  modalData: unknown;
  
  // Context menu
  contextMenu: {
    isOpen: boolean;
    x: number;
    y: number;
    items: Array<{
      id: string;
      label: string;
      icon?: string;
      shortcut?: string;
      disabled?: boolean;
      separator?: boolean;
      onClick?: () => void;
    }>;
  };
  
  // Theme
  theme: 'dark' | 'light';
  
  // Command palette
  commandPaletteOpen: boolean;
}

interface UIActions {
  // Layout
  togglePanel: (panelId: PanelId) => void;
  setPanelSize: (panelId: PanelId, size: number) => void;
  setPanelCollapsed: (panelId: PanelId, collapsed: boolean) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setBottomPanelHeight: (height: number) => void;
  setRightPanelWidth: (width: number) => void;
  
  // Editor mode
  setEditorMode: (mode: EditorMode) => void;
  
  // Tabs
  openTab: (tab: Omit<EditorTab, 'id' | 'isActive'>) => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<EditorTab>) => void;
  closeAllTabs: () => void;
  closeOtherTabs: (tabId: string) => void;
  
  // Notifications
  addNotification: (
    type: NotificationType,
    title: string,
    message: string,
    duration?: number
  ) => string;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  
  // Modal
  openModal: (modalId: string, data?: unknown) => void;
  closeModal: () => void;
  
  // Context menu
  openContextMenu: (x: number, y: number, items: UIState['contextMenu']['items']) => void;
  closeContextMenu: () => void;
  
  // Theme
  toggleTheme: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
  
  // Command palette
  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  
  // Utility
  resetLayout: () => void;
}

type UIStore = UIState & UIActions;

// ============================================================================
// Default Layout
// ============================================================================

const SIDEBAR_PANELS: PanelId[] = ['explorer', 'devices', 'gateway'];
const CENTER_VIEW_PANELS: PanelId[] = ['automata', 'petri', 'network', 'runtime'];
const RIGHT_PANEL_PANELS: PanelId[] = ['properties', 'transitions', 'variables', 'connections'];

const defaultLayout: LayoutConfig = {
  panels: {
    explorer: {
      id: 'explorer',
      isVisible: true,
      size: 250,
      position: 'left',
      isCollapsed: false,
    },
    automata: {
      id: 'automata',
      isVisible: true,
      size: 100,
      position: 'center',
      isCollapsed: false,
    },
    petri: {
      id: 'petri',
      isVisible: false,
      size: 100,
      position: 'center',
      isCollapsed: false,
    },
    network: {
      id: 'network',
      isVisible: false,
      size: 100,
      position: 'center',
      isCollapsed: false,
    },
    devices: {
      id: 'devices',
      isVisible: false,
      size: 300,
      position: 'right',
      isCollapsed: false,
    },
    gateway: {
      id: 'gateway',
      isVisible: false,
      size: 400,
      position: 'left',
      isCollapsed: true,
    },
    runtime: {
      id: 'runtime',
      isVisible: false,
      size: 300,
      position: 'center',
      isCollapsed: true,
    },
    properties: {
      id: 'properties',
      isVisible: true,
      size: 300,
      position: 'right',
      isCollapsed: false,
    },
    transitions: {
      id: 'transitions',
      isVisible: false,
      size: 320,
      position: 'right',
      isCollapsed: true,
    },
    variables: {
      id: 'variables',
      isVisible: false,
      size: 320,
      position: 'right',
      isCollapsed: true,
    },
    connections: {
      id: 'connections',
      isVisible: false,
      size: 320,
      position: 'right',
      isCollapsed: true,
    },
    console: {
      id: 'console',
      isVisible: true,
      size: 200,
      position: 'bottom',
      isCollapsed: false,
    },
  },
  sidebarWidth: 250,
  bottomPanelHeight: 200,
  rightPanelWidth: 300,
};

const normalizePanelGroupVisibility = (
  layout: LayoutConfig,
  group: PanelId[],
  preferred: PanelId,
): void => {
  const visible = group.filter((panelId) => layout.panels[panelId]?.isVisible);

  if (visible.length === 0) {
    if (layout.panels[preferred]) {
      layout.panels[preferred]!.isVisible = true;
    }
    return;
  }

  if (visible.length === 1) {
    return;
  }

  const winner = visible.includes(preferred) ? preferred : visible[0];

  group.forEach((panelId) => {
    const panel = layout.panels[panelId];
    if (panel) {
      panel.isVisible = panelId === winner;
    }
  });
};

const normalizeLayout = (layout: LayoutConfig): LayoutConfig => {
  const normalized: LayoutConfig = {
    ...defaultLayout,
    ...layout,
    panels: Object.fromEntries(
      Object.entries({
        ...defaultLayout.panels,
        ...layout.panels,
      }).map(([panelId, panel]) => [panelId, { ...panel }]),
    ) as LayoutConfig['panels'],
  };

  normalizePanelGroupVisibility(normalized, SIDEBAR_PANELS, 'explorer');
  normalizePanelGroupVisibility(normalized, CENTER_VIEW_PANELS, 'automata');
  normalizePanelGroupVisibility(normalized, RIGHT_PANEL_PANELS, 'properties');

  return normalized;
};

// ============================================================================
// Initial State
// ============================================================================

const initialState: UIState = {
  layout: normalizeLayout(defaultLayout),
  sidebarCollapsed: false,
  editorMode: 'split',
  tabs: [],
  activeTabId: null,
  notifications: [],
  activeModal: null,
  modalData: null,
  contextMenu: {
    isOpen: false,
    x: 0,
    y: 0,
    items: [],
  },
  theme: 'dark',
  commandPaletteOpen: false,
};

// ============================================================================
// Store
// ============================================================================

export const useUIStore = create<UIStore>()(
  persist(
    immer((set, get) => ({
      ...initialState,
      
      // ======================================================================
      // Layout
      // ======================================================================
      
      togglePanel: (panelId: PanelId) => {
        set((state) => {
          const panel = state.layout.panels[panelId];
          if (panel) {
            const willBeVisible = !panel.isVisible;
            panel.isVisible = willBeVisible;
            
            // If enabling a sidebar panel, disable other sidebar panels
            if (willBeVisible && SIDEBAR_PANELS.includes(panelId)) {
              SIDEBAR_PANELS.forEach((id) => {
                if (id !== panelId && state.layout.panels[id]) {
                  state.layout.panels[id]!.isVisible = false;
                }
              });
            }
            
            // If enabling a center view panel, disable the others
            if (willBeVisible && CENTER_VIEW_PANELS.includes(panelId)) {
              CENTER_VIEW_PANELS.forEach((id) => {
                if (id !== panelId && state.layout.panels[id]) {
                  state.layout.panels[id]!.isVisible = false;
                }
              });
            }

            // If enabling a right-side inspector panel, disable the others
            if (willBeVisible && RIGHT_PANEL_PANELS.includes(panelId)) {
              RIGHT_PANEL_PANELS.forEach((id) => {
                if (id !== panelId && state.layout.panels[id]) {
                  state.layout.panels[id]!.isVisible = false;
                }
              });
            }
          }
        });
      },
      
      setPanelSize: (panelId: PanelId, size: number) => {
        set((state) => {
          const panel = state.layout.panels[panelId];
          if (panel) {
            panel.size = size;
          }
        });
      },
      
      setPanelCollapsed: (panelId: PanelId, collapsed: boolean) => {
        set((state) => {
          const panel = state.layout.panels[panelId];
          if (panel) {
            panel.isCollapsed = collapsed;
          }
        });
      },
      
      toggleSidebar: () => {
        set((state) => {
          state.sidebarCollapsed = !state.sidebarCollapsed;
        });
      },
      
      setSidebarWidth: (width: number) => {
        set((state) => {
          state.layout.sidebarWidth = Math.max(180, Math.min(400, width));
        });
      },
      
      setBottomPanelHeight: (height: number) => {
        set((state) => {
          state.layout.bottomPanelHeight = Math.max(100, Math.min(500, height));
        });
      },
      
      setRightPanelWidth: (width: number) => {
        set((state) => {
          state.layout.rightPanelWidth = Math.max(200, Math.min(500, width));
        });
      },
      
      // ======================================================================
      // Editor Mode
      // ======================================================================
      
      setEditorMode: (mode: EditorMode) => {
        set((state) => {
          state.editorMode = mode;
        });
      },
      
      // ======================================================================
      // Tabs
      // ======================================================================
      
      openTab: (tabData: Omit<EditorTab, 'id' | 'isActive'>) => {
        // Check if tab already exists
        const existing = get().tabs.find(
          (t) => t.type === tabData.type && t.targetId === tabData.targetId
        );
        
        if (existing) {
          get().setActiveTab(existing.id);
          return existing.id;
        }
        
        const newTabId = uuid();
        
        set((state) => {
          // Deactivate all tabs
          state.tabs.forEach((tab) => {
            tab.isActive = false;
          });
          
          // Add new tab
          state.tabs.push({
            ...tabData,
            id: newTabId,
            isActive: true,
          });
          
          state.activeTabId = newTabId;
        });
        
        return newTabId;
      },
      
      closeTab: (tabId: string) => {
        set((state) => {
          const index = state.tabs.findIndex((t) => t.id === tabId);
          if (index === -1) return;
          
          const wasActive = state.tabs[index].isActive;
          state.tabs.splice(index, 1);
          
          // If closed tab was active, activate another
          if (wasActive && state.tabs.length > 0) {
            const newActiveIndex = Math.min(index, state.tabs.length - 1);
            state.tabs[newActiveIndex].isActive = true;
            state.activeTabId = state.tabs[newActiveIndex].id;
          } else if (state.tabs.length === 0) {
            state.activeTabId = null;
          }
        });
      },
      
      setActiveTab: (tabId: string) => {
        set((state) => {
          state.tabs.forEach((tab) => {
            tab.isActive = tab.id === tabId;
          });
          state.activeTabId = tabId;
        });
      },
      
      updateTab: (tabId: string, updates: Partial<EditorTab>) => {
        set((state) => {
          const tab = state.tabs.find((t) => t.id === tabId);
          if (tab) {
            Object.assign(tab, updates);
          }
        });
      },
      
      closeAllTabs: () => {
        set((state) => {
          state.tabs = [];
          state.activeTabId = null;
        });
      },
      
      closeOtherTabs: (tabId: string) => {
        set((state) => {
          state.tabs = state.tabs.filter((t) => t.id === tabId);
          if (state.tabs.length > 0) {
            state.tabs[0].isActive = true;
            state.activeTabId = state.tabs[0].id;
          }
        });
      },
      
      // ======================================================================
      // Notifications
      // ======================================================================
      
      addNotification: (
        type: NotificationType,
        title: string,
        message: string,
        duration = 5000
      ) => {
        const id = uuid();
        
        set((state) => {
          state.notifications.push({
            id,
            type,
            title,
            message,
            timestamp: Date.now(),
            duration,
          });
        });
        
        // Auto-remove after duration
        if (duration > 0) {
          setTimeout(() => {
            get().removeNotification(id);
          }, duration);
        }
        
        return id;
      },
      
      removeNotification: (id: string) => {
        set((state) => {
          state.notifications = state.notifications.filter((n) => n.id !== id);
        });
      },
      
      clearNotifications: () => {
        set((state) => {
          state.notifications = [];
        });
      },
      
      // ======================================================================
      // Modal
      // ======================================================================
      
      openModal: (modalId: string, data?: unknown) => {
        set((state) => {
          state.activeModal = modalId;
          state.modalData = data;
        });
      },
      
      closeModal: () => {
        set((state) => {
          state.activeModal = null;
          state.modalData = null;
        });
      },
      
      // ======================================================================
      // Context Menu
      // ======================================================================
      
      openContextMenu: (x: number, y: number, items: UIState['contextMenu']['items']) => {
        set((state) => {
          state.contextMenu = {
            isOpen: true,
            x,
            y,
            items,
          };
        });
      },
      
      closeContextMenu: () => {
        set((state) => {
          state.contextMenu.isOpen = false;
        });
      },
      
      // ======================================================================
      // Theme
      // ======================================================================
      
      toggleTheme: () => {
        set((state) => {
          state.theme = state.theme === 'dark' ? 'light' : 'dark';
        });
      },
      
      setTheme: (theme: 'dark' | 'light') => {
        set((state) => {
          state.theme = theme;
        });
      },
      
      // ======================================================================
      // Command Palette
      // ======================================================================
      
      toggleCommandPalette: () => {
        set((state) => {
          state.commandPaletteOpen = !state.commandPaletteOpen;
        });
      },
      
      setCommandPaletteOpen: (open: boolean) => {
        set((state) => {
          state.commandPaletteOpen = open;
        });
      },
      
      // ======================================================================
      // Utility
      // ======================================================================
      
      resetLayout: () => {
        set((state) => {
          state.layout = normalizeLayout(defaultLayout);
          state.sidebarCollapsed = false;
        });
      },
    })),
    {
      name: 'aetherium-ui-storage',
      partialize: (state) => ({
        layout: state.layout,
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
        editorMode: state.editorMode,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<UIState>;
        const mergedLayout: LayoutConfig = {
          ...currentState.layout,
          ...(persisted.layout || {}),
          panels: {
            ...currentState.layout.panels,
            ...(persisted.layout?.panels || {}),
          },
        };

        return {
          ...currentState,
          ...persisted,
          layout: normalizeLayout(mergedLayout),
        };
      },
    }
  )
);

// ============================================================================
// Selectors
// ============================================================================

export const selectActiveTab = (state: UIStore): EditorTab | null =>
  state.tabs.find((t) => t.isActive) || null;

export const selectPanelState = (panelId: PanelId) => (state: UIStore) =>
  state.layout.panels[panelId];

export const selectVisiblePanels = (position: PanelState['position']) => (state: UIStore) =>
  Object.values(state.layout.panels).filter(
    (p) => p.position === position && p.isVisible && !p.isCollapsed
  );

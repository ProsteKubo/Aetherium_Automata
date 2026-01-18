/**
 * Aetherium Automata - Keyboard Shortcuts System
 * 
 * Centralized keyboard shortcut management with:
 * - Global shortcuts (save, open, etc.)
 * - Editor shortcuts (new state, transition, etc.)
 * - Context-aware shortcuts
 * - Command palette integration
 */

import { useEffect, useRef } from 'react';
import { useProjectStore, useAutomataStore, useUIStore } from '../stores';

// ============================================================================
// Shortcut Types
// ============================================================================

export interface Shortcut {
  id: string;
  name: string;
  description: string;
  keys: string; // Format: "Mod+S" (Mod = Cmd on Mac, Ctrl on Windows/Linux)
  category: 'file' | 'edit' | 'view' | 'editor' | 'navigation' | 'debug';
  context?: 'global' | 'editor' | 'explorer' | 'code';
  action: () => void;
  enabled?: () => boolean;
}

// ============================================================================
// Key Utilities
// ============================================================================

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export function parseShortcut(keys: string): { key: string; modifiers: string[] } {
  const parts = keys.split('+');
  const key = parts.pop()!.toLowerCase();
  const modifiers = parts.map((m) => m.toLowerCase().replace('mod', isMac ? 'meta' : 'control'));
  return { key, modifiers };
}

export function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const { key, modifiers } = parseShortcut(shortcut);
  
  const eventKey = e.key.toLowerCase();
  const matchesKey = eventKey === key || e.code.toLowerCase() === `key${key}`;
  
  const hasCtrl = modifiers.includes('control') || modifiers.includes('ctrl');
  const hasMeta = modifiers.includes('meta') || modifiers.includes('cmd');
  const hasAlt = modifiers.includes('alt') || modifiers.includes('option');
  const hasShift = modifiers.includes('shift');
  
  const ctrlMatch = hasCtrl ? e.ctrlKey : !e.ctrlKey;
  const metaMatch = hasMeta ? e.metaKey : !e.metaKey;
  const altMatch = hasAlt ? e.altKey : !e.altKey;
  const shiftMatch = hasShift ? e.shiftKey : !e.shiftKey;
  
  return matchesKey && ctrlMatch && metaMatch && altMatch && shiftMatch;
}

export function formatShortcutDisplay(keys: string): string {
  return keys
    .replace(/Mod/g, isMac ? '⌘' : 'Ctrl')
    .replace(/Ctrl/g, isMac ? '⌃' : 'Ctrl')
    .replace(/Alt/g, isMac ? '⌥' : 'Alt')
    .replace(/Shift/g, isMac ? '⇧' : 'Shift')
    .replace(/Meta/g, isMac ? '⌘' : 'Win')
    .replace(/\+/g, isMac ? '' : '+');
}

// ============================================================================
// Shortcut Definitions
// ============================================================================

export function createShortcuts(actions: {
  // File actions
  save: () => void;
  saveAs: () => void;
  open: () => void;
  newProject: () => void;
  closeProject: () => void;
  
  // Edit actions
  undo: () => void;
  redo: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  delete: () => void;
  selectAll: () => void;
  
  // Editor actions
  newState: () => void;
  newTransition: () => void;
  quickAdd: () => void;
  toggleLock: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  fitView: () => void;
  
  // View actions
  toggleExplorer: () => void;
  toggleProperties: () => void;
  toggleConsole: () => void;
  toggleCommandPalette: () => void;
  
  // Checks
  hasActiveAutomata: () => boolean;
  hasSelection: () => boolean;
}): Shortcut[] {
  return [
    // ========== File ==========
    {
      id: 'file.save',
      name: 'Save',
      description: 'Save the current project',
      keys: 'Mod+S',
      category: 'file',
      context: 'global',
      action: actions.save,
    },
    {
      id: 'file.saveAs',
      name: 'Save As...',
      description: 'Save the project with a new name',
      keys: 'Mod+Shift+S',
      category: 'file',
      context: 'global',
      action: actions.saveAs,
    },
    {
      id: 'file.open',
      name: 'Open Project...',
      description: 'Open an existing project',
      keys: 'Mod+O',
      category: 'file',
      context: 'global',
      action: actions.open,
    },
    {
      id: 'file.new',
      name: 'New Project',
      description: 'Create a new project',
      keys: 'Mod+Shift+N',
      category: 'file',
      context: 'global',
      action: actions.newProject,
    },
    
    // ========== Edit ==========
    {
      id: 'edit.undo',
      name: 'Undo',
      description: 'Undo the last action',
      keys: 'Mod+Z',
      category: 'edit',
      context: 'global',
      action: actions.undo,
    },
    {
      id: 'edit.redo',
      name: 'Redo',
      description: 'Redo the last undone action',
      keys: 'Mod+Shift+Z',
      category: 'edit',
      context: 'global',
      action: actions.redo,
    },
    {
      id: 'edit.cut',
      name: 'Cut',
      description: 'Cut selection',
      keys: 'Mod+X',
      category: 'edit',
      context: 'editor',
      action: actions.cut,
      enabled: actions.hasSelection,
    },
    {
      id: 'edit.copy',
      name: 'Copy',
      description: 'Copy selection',
      keys: 'Mod+C',
      category: 'edit',
      context: 'editor',
      action: actions.copy,
      enabled: actions.hasSelection,
    },
    {
      id: 'edit.paste',
      name: 'Paste',
      description: 'Paste from clipboard',
      keys: 'Mod+V',
      category: 'edit',
      context: 'editor',
      action: actions.paste,
    },
    {
      id: 'edit.duplicate',
      name: 'Duplicate',
      description: 'Duplicate selection',
      keys: 'Mod+D',
      category: 'edit',
      context: 'editor',
      action: actions.duplicate,
      enabled: actions.hasSelection,
    },
    {
      id: 'edit.delete',
      name: 'Delete',
      description: 'Delete selection',
      keys: 'Delete',
      category: 'edit',
      context: 'editor',
      action: actions.delete,
      enabled: actions.hasSelection,
    },
    {
      id: 'edit.selectAll',
      name: 'Select All',
      description: 'Select all states and transitions',
      keys: 'Mod+A',
      category: 'edit',
      context: 'editor',
      action: actions.selectAll,
      enabled: actions.hasActiveAutomata,
    },
    
    // ========== Editor ==========
    {
      id: 'editor.newState',
      name: 'New State',
      description: 'Create a new state at cursor position',
      keys: 'N',
      category: 'editor',
      context: 'editor',
      action: actions.newState,
      enabled: actions.hasActiveAutomata,
    },
    {
      id: 'editor.newTransition',
      name: 'New Transition',
      description: 'Open transition creation dialog',
      keys: 'T',
      category: 'editor',
      context: 'editor',
      action: actions.newTransition,
      enabled: actions.hasActiveAutomata,
    },
    {
      id: 'editor.quickAdd',
      name: 'Quick Add',
      description: 'Open quick add menu at cursor',
      keys: 'Space',
      category: 'editor',
      context: 'editor',
      action: actions.quickAdd,
      enabled: actions.hasActiveAutomata,
    },
    {
      id: 'editor.toggleLock',
      name: 'Toggle Lock',
      description: 'Lock/unlock canvas editing',
      keys: 'L',
      category: 'editor',
      context: 'editor',
      action: actions.toggleLock,
      enabled: actions.hasActiveAutomata,
    },
    {
      id: 'editor.zoomIn',
      name: 'Zoom In',
      description: 'Zoom in on the canvas',
      keys: 'Mod+=',
      category: 'editor',
      context: 'editor',
      action: actions.zoomIn,
    },
    {
      id: 'editor.zoomOut',
      name: 'Zoom Out',
      description: 'Zoom out on the canvas',
      keys: 'Mod+-',
      category: 'editor',
      context: 'editor',
      action: actions.zoomOut,
    },
    {
      id: 'editor.zoomReset',
      name: 'Reset Zoom',
      description: 'Reset zoom to 100%',
      keys: 'Mod+0',
      category: 'editor',
      context: 'editor',
      action: actions.zoomReset,
    },
    {
      id: 'editor.fitView',
      name: 'Fit to View',
      description: 'Fit all content in view',
      keys: 'Mod+1',
      category: 'editor',
      context: 'editor',
      action: actions.fitView,
    },
    
    // ========== View ==========
    {
      id: 'view.toggleExplorer',
      name: 'Toggle Explorer',
      description: 'Show/hide the explorer panel',
      keys: 'Mod+B',
      category: 'view',
      context: 'global',
      action: actions.toggleExplorer,
    },
    {
      id: 'view.toggleProperties',
      name: 'Toggle Properties',
      description: 'Show/hide the properties panel',
      keys: 'Mod+Shift+P',
      category: 'view',
      context: 'global',
      action: actions.toggleProperties,
    },
    {
      id: 'view.toggleConsole',
      name: 'Toggle Console',
      description: 'Show/hide the console panel',
      keys: 'Mod+`',
      category: 'view',
      context: 'global',
      action: actions.toggleConsole,
    },
    {
      id: 'view.commandPalette',
      name: 'Command Palette',
      description: 'Open the command palette',
      keys: 'Mod+Shift+P',
      category: 'view',
      context: 'global',
      action: actions.toggleCommandPalette,
    },
  ];
}

// ============================================================================
// Shortcut Hook
// ============================================================================

export function useKeyboardShortcuts(shortcuts: Shortcut[]): void {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if in input/textarea (unless it's a global shortcut)
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      
      for (const shortcut of shortcutsRef.current) {
        if (matchesShortcut(e, shortcut.keys)) {
          // Skip non-global shortcuts when in input
          if (isInput && shortcut.context !== 'global' && !e.metaKey && !e.ctrlKey) {
            continue;
          }
          
          // Check if enabled
          if (shortcut.enabled && !shortcut.enabled()) {
            continue;
          }
          
          e.preventDefault();
          e.stopPropagation();
          shortcut.action();
          return;
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

// ============================================================================
// Global Shortcuts Hook
// ============================================================================

export function useGlobalShortcuts(): void {
  const saveProject = useProjectStore((s) => s.saveProject);
  const saveProjectAs = useProjectStore((s) => s.saveProjectAs);
  const openProject = useProjectStore((s) => s.openProject);
  const createProject = useProjectStore((s) => s.createProject);
  
  const undo = useAutomataStore((s) => s.undo);
  const redo = useAutomataStore((s) => s.redo);
  const copy = useAutomataStore((s) => s.copy);
  const cut = useAutomataStore((s) => s.cut);
  const paste = useAutomataStore((s) => s.paste);
  const selectAll = useAutomataStore((s) => s.selectAll);
  const selectedStateIds = useAutomataStore((s) => s.selectedStateIds);
  const selectedTransitionIds = useAutomataStore((s) => s.selectedTransitionIds);
  const activeAutomataId = useAutomataStore((s) => s.activeAutomataId);
  const deleteState = useAutomataStore((s) => s.deleteState);
  const deleteTransition = useAutomataStore((s) => s.deleteTransition);
  
  const togglePanel = useUIStore((s) => s.togglePanel);
  
  const shortcuts = createShortcuts({
    // File
    save: saveProject,
    saveAs: saveProjectAs,
    open: openProject,
    newProject: () => createProject(),
    closeProject: () => {}, // TODO
    
    // Edit
    undo,
    redo,
    cut,
    copy,
    paste: () => paste(),
    duplicate: () => {
      copy();
      paste({ x: 20, y: 20 });
    },
    delete: () => {
      selectedStateIds.forEach(deleteState);
      selectedTransitionIds.forEach(deleteTransition);
    },
    selectAll,
    
    // Editor (these will be handled by AutomataEditor)
    newState: () => {}, // Placeholder
    newTransition: () => {}, // Placeholder
    quickAdd: () => {}, // Placeholder
    toggleLock: () => {}, // Placeholder
    zoomIn: () => {},
    zoomOut: () => {},
    zoomReset: () => {},
    fitView: () => {},
    
    // View
    toggleExplorer: () => togglePanel('explorer'),
    toggleProperties: () => togglePanel('properties'),
    toggleConsole: () => togglePanel('console'),
    toggleCommandPalette: () => {
      // TODO: Open command palette
    },
    
    // Checks
    hasActiveAutomata: () => !!activeAutomataId,
    hasSelection: () => selectedStateIds.length > 0 || selectedTransitionIds.length > 0,
  });
  
  useKeyboardShortcuts(shortcuts);
}

// ============================================================================
// Command Palette Data
// ============================================================================

export interface CommandPaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  shortcut?: string;
  category: string;
  action: () => void;
}

export function getCommandPaletteItems(shortcuts: Shortcut[]): CommandPaletteItem[] {
  return shortcuts.map((s) => ({
    id: s.id,
    title: s.name,
    subtitle: s.description,
    shortcut: formatShortcutDisplay(s.keys),
    category: s.category,
    action: s.action,
  }));
}

/**
 * Aetherium Automata - Project & Network Type Definitions
 * 
 * Defines the hierarchical project structure:
 * Project (.aeth) > Networks > Automata > Sub-Automata
 */

import type { AutomataId, Automata } from './automata';

// ============================================================================
// Project Structure
// ============================================================================

export interface ProjectMetadata {
  name: string;
  version: string;
  description?: string;
  author?: string;
  created: number;
  modified: number;
  tags: string[];
}

/**
 * An Automata Network is a top-level container for related automata.
 * Think of it like a C# project within a solution.
 */
export interface AutomataNetwork {
  id: string;
  name: string;
  description?: string;
  
  /** Root automata IDs (entry points) */
  rootAutomataIds: AutomataId[];
  
  /** All automata in this network (flat map, hierarchy via parentId) */
  automataIds: AutomataId[];
  
  /** Network-level inputs/outputs (interface to external world) */
  inputs?: string[];
  outputs?: string[];
  
  /** File path relative to project root */
  relativePath: string;
  
  /** Visual metadata */
  color?: string;
  icon?: string;
  isExpanded?: boolean;
}

/**
 * Project file structure (.aeth)
 * The main project file stores metadata and references to networks.
 */
export interface Project {
  /** Schema version for migrations */
  schemaVersion: string;
  
  /** Project metadata */
  metadata: ProjectMetadata;
  
  /** Networks in this project */
  networks: AutomataNetwork[];
  
  /** All automata (denormalized for quick access) */
  automata: Record<AutomataId, Automata>;
  
  /** Project-wide settings */
  settings: ProjectSettings;
  
  /** File path (absolute, set at runtime) */
  filePath?: string;
  
  /** Dirty state */
  isDirty?: boolean;
}

// ============================================================================
// Project Settings
// ============================================================================

export interface ProjectSettings {
  /** Default language for new automata */
  defaultLanguage: 'lua';
  
  /** Auto-save interval (0 = disabled) */
  autoSaveInterval: number;
  
  /** Layout type for new automata */
  defaultLayoutType: 'inline' | 'folder';
  
  /** Code folder relative to project */
  codeFolderPath: string;
  
  /** Editor preferences */
  editor: EditorSettings;
  
  /** Build/export settings */
  build: BuildSettings;
}

export interface EditorSettings {
  /** Grid snap */
  snapToGrid: boolean;
  gridSize: number;
  
  /** Auto-layout new states */
  autoLayout: boolean;
  
  /** Show minimap */
  showMinimap: boolean;
  
  /** Transition curve style */
  transitionStyle: 'bezier' | 'smooth' | 'step' | 'straight';
  
  /** Animation speed for transitions */
  animationSpeed: number;
}

export interface BuildSettings {
  /** Output format */
  outputFormat: 'yaml' | 'json' | 'binary';
  
  /** Include debug info */
  includeDebugInfo: boolean;
  
  /** Target platform hints */
  targetPlatforms: ('esp32' | 'mcxn947' | 'pico' | 'linux' | 'ros2')[];
}

// ============================================================================
// Hierarchical Tree Structure (for Explorer)
// ============================================================================

export type TreeNodeType = 'project' | 'network' | 'automata' | 'state' | 'transition';

export interface TreeNode {
  id: string;
  type: TreeNodeType;
  name: string;
  parentId: string | null;
  children: TreeNode[];
  
  /** Reference to actual entity */
  entityId: string;
  
  /** Visual state */
  isExpanded: boolean;
  isSelected: boolean;
  isDirty: boolean;
  
  /** File path (if applicable) */
  filePath?: string;
  
  /** Status indicator */
  status?: 'ok' | 'warning' | 'error';
  statusMessage?: string;
  
  /** Icon override */
  icon?: string;
}

// ============================================================================
// Recent Projects
// ============================================================================

export interface RecentProject {
  name: string;
  filePath: string;
  lastOpened: number;
  thumbnail?: string;
}

// ============================================================================
// File Operations
// ============================================================================

export type FileOperationType = 'create' | 'save' | 'load' | 'delete' | 'rename' | 'move';

export interface FileOperation {
  type: FileOperationType;
  path: string;
  timestamp: number;
  success: boolean;
  error?: string;
}

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  defaultLanguage: 'lua',
  autoSaveInterval: 30000, // 30 seconds
  defaultLayoutType: 'inline',
  codeFolderPath: 'src',
  editor: {
    snapToGrid: true,
    gridSize: 20,
    autoLayout: true,
    showMinimap: true,
    transitionStyle: 'bezier',
    animationSpeed: 300,
  },
  build: {
    outputFormat: 'yaml',
    includeDebugInfo: true,
    targetPlatforms: ['linux'],
  },
};

export const DEFAULT_PROJECT_METADATA: ProjectMetadata = {
  name: 'Aetherium Flagship Workspace',
  version: '0.1.0',
  description: 'Distributed EFSM orchestration workspace centered on named channels, observability, replay, and analyzer insight.',
  author: '',
  created: Date.now(),
  modified: Date.now(),
  tags: ['efsm', 'orchestration', 'runtime', 'replay'],
};

export function createEmptyProject(name: string = 'Aetherium Flagship Workspace'): Project {
  return {
    schemaVersion: '1.0.0',
    metadata: {
      ...DEFAULT_PROJECT_METADATA,
      name,
      created: Date.now(),
      modified: Date.now(),
    },
    networks: [],
    automata: {},
    settings: { ...DEFAULT_PROJECT_SETTINGS },
    isDirty: false,
  };
}

export function createEmptyNetwork(name: string = 'Control Network'): AutomataNetwork {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'network';

  return {
    id: `network_${slug}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    description: '',
    rootAutomataIds: [],
    automataIds: [],
    relativePath: slug,
    isExpanded: true,
  };
}

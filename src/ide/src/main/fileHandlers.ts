/**
 * Aetherium Automata - File System IPC Handlers
 * 
 * Handles all file operations: projects, automata, YAML import/export
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';

// ============================================================================
// Types (mirrored from renderer for IPC)
// ============================================================================

interface ProjectMetadata {
  name: string;
  version: string;
  description?: string;
  author?: string;
  created: number;
  modified: number;
  tags: string[];
}

interface Project {
  schemaVersion: string;
  metadata: ProjectMetadata;
  networks: unknown[];
  automata: Record<string, unknown>;
  settings: unknown;
  filePath?: string;
}

interface SaveResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

interface LoadResult<T> {
  success: boolean;
  data?: T;
  filePath?: string;
  error?: string;
}

// ============================================================================
// File Filters
// ============================================================================

const PROJECT_FILTERS = [
  { name: 'Aetherium Project', extensions: ['aeth'] },
  { name: 'All Files', extensions: ['*'] },
];

const AUTOMATA_FILTERS = [
  { name: 'Automata YAML', extensions: ['yaml', 'yml'] },
  { name: 'Automata JSON', extensions: ['json'] },
  { name: 'All Files', extensions: ['*'] },
];

// ============================================================================
// Project Operations
// ============================================================================

/**
 * Create a new project with dialog
 */
ipcMain.handle('project:create', async (_event, defaultName?: string): Promise<SaveResult> => {
  const window = BrowserWindow.getFocusedWindow();
  
  const result = await dialog.showSaveDialog(window!, {
    title: 'Create New Project',
    defaultPath: defaultName || 'NewProject.aeth',
    filters: PROJECT_FILTERS,
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  
  if (result.canceled || !result.filePath) {
    return { success: false, error: 'Cancelled' };
  }
  
  const projectPath = result.filePath;
  const projectDir = path.dirname(projectPath);
  const projectName = path.basename(projectPath, '.aeth');
  
  // Create project structure
  const project: Project = {
    schemaVersion: '1.0.0',
    metadata: {
      name: projectName,
      version: '0.1.0',
      description: '',
      author: '',
      created: Date.now(),
      modified: Date.now(),
      tags: [],
    },
    networks: [],
    automata: {},
    settings: {
      defaultLanguage: 'lua',
      autoSaveInterval: 30000,
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
    },
  };
  
  try {
    // Create project directory structure
    const srcDir = path.join(projectDir, 'src');
    const networksDir = path.join(projectDir, 'networks');
    
    if (!existsSync(srcDir)) mkdirSync(srcDir, { recursive: true });
    if (!existsSync(networksDir)) mkdirSync(networksDir, { recursive: true });
    
    // Write project file
    await fs.writeFile(projectPath, JSON.stringify(project, null, 2), 'utf-8');
    
    // Add to recent projects
    await addToRecentProjects(projectPath, projectName);
    
    return { success: true, filePath: projectPath };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

/**
 * Open existing project with dialog
 */
ipcMain.handle('project:open', async (): Promise<LoadResult<Project>> => {
  const window = BrowserWindow.getFocusedWindow();
  
  const result = await dialog.showOpenDialog(window!, {
    title: 'Open Project',
    filters: PROJECT_FILTERS,
    properties: ['openFile'],
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'Cancelled' };
  }
  
  return loadProject(result.filePaths[0]);
});

/**
 * Open project from path (for recent projects)
 */
ipcMain.handle('project:openPath', async (_event, filePath: string): Promise<LoadResult<Project>> => {
  return loadProject(filePath);
});

/**
 * Save project
 */
ipcMain.handle('project:save', async (_event, project: Project, filePath?: string): Promise<SaveResult> => {
  console.log('[Main] project:save IPC called');
  console.log('[Main] project:', project);
  console.log('[Main] filePath:', filePath);
  console.log('[Main] project.automata:', project.automata);
  console.log('[Main] project.networks:', project.networks);
  
  let savePath = filePath || project.filePath;
  
  if (!savePath) {
    console.log('[Main] No savePath, showing dialog...');
    // Show save dialog
    const window = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(window!, {
      title: 'Save Project',
      defaultPath: `${project.metadata.name}.aeth`,
      filters: PROJECT_FILTERS,
    });
    
    if (result.canceled || !result.filePath) {
      console.log('[Main] Save dialog cancelled');
      return { success: false, error: 'Cancelled' };
    }
    savePath = result.filePath;
  }
  
  try {
    console.log('[Main] Saving to:', savePath);
    project.metadata.modified = Date.now();
    const jsonString = JSON.stringify(project, null, 2);
    console.log('[Main] JSON string length:', jsonString.length);
    console.log('[Main] First 500 chars:', jsonString.substring(0, 500));
    
    await fs.writeFile(savePath, jsonString, 'utf-8');
    console.log('[Main] File written successfully');
    
    await addToRecentProjects(savePath, project.metadata.name);
    console.log('[Main] Added to recent projects');
    
    return { success: true, filePath: savePath };
  } catch (err) {
    console.error('[Main] Save error:', err);
    return { success: false, error: String(err) };
  }
});

// ============================================================================
// Automata Operations
// ============================================================================

/**
 * Save automata to YAML file
 */
ipcMain.handle('automata:saveYaml', async (_event, automata: unknown, suggestedPath?: string): Promise<SaveResult> => {
  const window = BrowserWindow.getFocusedWindow();
  
  let savePath = suggestedPath;
  
  if (!savePath) {
    const result = await dialog.showSaveDialog(window!, {
      title: 'Save Automata',
      defaultPath: 'automata.yaml',
      filters: AUTOMATA_FILTERS,
    });
    
    if (result.canceled || !result.filePath) {
      return { success: false, error: 'Cancelled' };
    }
    savePath = result.filePath;
  }
  
  try {
    const yaml = automataToYaml(automata);
    await fs.writeFile(savePath, yaml, 'utf-8');
    return { success: true, filePath: savePath };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

/**
 * Load automata from YAML file
 */
ipcMain.handle('automata:loadYaml', async (): Promise<LoadResult<unknown>> => {
  const window = BrowserWindow.getFocusedWindow();
  
  const result = await dialog.showOpenDialog(window!, {
    title: 'Load Automata',
    filters: AUTOMATA_FILTERS,
    properties: ['openFile'],
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'Cancelled' };
  }
  
  try {
    const content = await fs.readFile(result.filePaths[0], 'utf-8');
    const automata = yamlToAutomata(content);
    return { success: true, data: automata, filePath: result.filePaths[0] };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

/**
 * Import automata from file path
 */
ipcMain.handle('automata:import', async (_event, filePath: string): Promise<LoadResult<unknown>> => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const automata = yamlToAutomata(content);
    return { success: true, data: automata, filePath };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// ============================================================================
// Recent Projects
// ============================================================================

const RECENT_PROJECTS_FILE = 'recent-projects.json';

interface RecentProject {
  name: string;
  filePath: string;
  lastOpened: number;
}

async function getRecentProjectsPath(): Promise<string> {
  const { app } = await import('electron');
  return path.join(app.getPath('userData'), RECENT_PROJECTS_FILE);
}

async function addToRecentProjects(filePath: string, name: string): Promise<void> {
  try {
    const recentPath = await getRecentProjectsPath();
    let recent: RecentProject[] = [];
    
    if (existsSync(recentPath)) {
      const content = await fs.readFile(recentPath, 'utf-8');
      recent = JSON.parse(content);
    }
    
    // Remove if exists, add to front
    recent = recent.filter((r) => r.filePath !== filePath);
    recent.unshift({ name, filePath, lastOpened: Date.now() });
    
    // Keep only last 10
    recent = recent.slice(0, 10);
    
    await fs.writeFile(recentPath, JSON.stringify(recent, null, 2), 'utf-8');
  } catch {
    // Ignore errors for recent projects
  }
}

ipcMain.handle('project:getRecent', async (): Promise<RecentProject[]> => {
  try {
    const recentPath = await getRecentProjectsPath();
    if (existsSync(recentPath)) {
      const content = await fs.readFile(recentPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Ignore
  }
  return [];
});

ipcMain.handle('project:clearRecent', async (): Promise<void> => {
  try {
    const recentPath = await getRecentProjectsPath();
    await fs.writeFile(recentPath, '[]', 'utf-8');
  } catch {
    // Ignore
  }
});

// ============================================================================
// Helper Functions
// ============================================================================

async function loadProject(filePath: string): Promise<LoadResult<Project>> {
  try {
    if (!existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }
    
    const content = await fs.readFile(filePath, 'utf-8');
    const project = JSON.parse(content) as Project;
    project.filePath = filePath;
    
    await addToRecentProjects(filePath, project.metadata.name);
    
    return { success: true, data: project, filePath };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Convert automata object to YAML string
 * Note: This is a basic implementation - consider using js-yaml for proper YAML
 */
function automataToYaml(automata: unknown): string {
  // For now, use JSON with .yaml extension
  // TODO: Use proper YAML library (js-yaml)
  const obj = automata as Record<string, unknown>;
  
  const yamlLines: string[] = [
    `version: ${obj.version || '0.0.1'}`,
    '',
    'config:',
    `  name: ${(obj.config as Record<string, unknown>)?.name || 'Unnamed'}`,
    `  type: ${(obj.config as Record<string, unknown>)?.type || 'inline'}`,
    `  language: ${(obj.config as Record<string, unknown>)?.language || 'lua'}`,
    '',
    'automata:',
    `  initial_state: ${obj.initialState || 'Initial'}`,
    '  states:',
  ];
  
  const states = obj.states as Record<string, unknown> || {};
  for (const [stateId, state] of Object.entries(states)) {
    const s = state as Record<string, unknown>;
    yamlLines.push(`    ${stateId}:`);
    yamlLines.push(`      inputs: ${JSON.stringify(s.inputs || [])}`);
    yamlLines.push(`      outputs: ${JSON.stringify(s.outputs || [])}`);
    yamlLines.push(`      variables: ${JSON.stringify(s.variables || [])}`);
    if (s.code) {
      yamlLines.push(`      code: |`);
      const codeLines = String(s.code).split('\n');
      codeLines.forEach((line) => yamlLines.push(`        ${line}`));
    }
  }
  
  yamlLines.push('  transitions:');
  const transitions = obj.transitions as Record<string, unknown> || {};
  for (const [transId, trans] of Object.entries(transitions)) {
    const t = trans as Record<string, unknown>;
    yamlLines.push(`    ${transId}:`);
    yamlLines.push(`      from: ${t.from}`);
    yamlLines.push(`      to: ${t.to}`);
    if (t.condition) yamlLines.push(`      condition: ${t.condition}`);
    if (t.body) yamlLines.push(`      body: ${t.body}`);
    if (t.priority !== undefined) yamlLines.push(`      priority: ${t.priority}`);
  }
  
  return yamlLines.join('\n');
}

/**
 * Parse YAML string to automata object
 * Note: This is a basic implementation - consider using js-yaml for proper YAML
 */
function yamlToAutomata(yaml: string): unknown {
  // For now, try JSON parse first, then basic YAML
  try {
    return JSON.parse(yaml);
  } catch {
    // Basic YAML parsing would go here
    // TODO: Use proper YAML library (js-yaml)
    throw new Error('YAML parsing not fully implemented. Please use JSON format for now.');
  }
}

// ============================================================================
// File Watcher (for external changes)
// ============================================================================

ipcMain.handle('file:watch', async (_event, filePath: string): Promise<boolean> => {
  // TODO: Implement file watching using chokidar or fs.watch
  console.log('File watch requested:', filePath);
  return true;
});

ipcMain.handle('file:unwatch', async (_event, filePath: string): Promise<boolean> => {
  console.log('File unwatch requested:', filePath);
  return true;
});

// ============================================================================
// Export
// ============================================================================

export function registerFileHandlers(): void {
  console.log('[FileHandlers] IPC file handlers registered');
}

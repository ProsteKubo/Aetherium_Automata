/**
 * Aetherium Automata - File System IPC Handlers
 * 
 * Handles all file operations: projects, automata, YAML import/export
 */

import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
const jsYaml = require('js-yaml');

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

interface ShowcaseAutomataEntry {
  id: string;
  name: string;
  category: string;
  relativePath: string;
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

const SHOWCASE_CATALOG_PATH = path.join('example', 'automata', 'showcase', 'CATALOG.txt');

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

/**
 * List curated showcase automata entries from repository catalog.
 */
ipcMain.handle('automata:listShowcase', async (): Promise<LoadResult<ShowcaseAutomataEntry[]>> => {
  try {
    const repoRoot = resolveRepositoryRoot();
    if (!repoRoot) {
      return { success: false, error: `Cannot locate ${SHOWCASE_CATALOG_PATH}` };
    }

    const entries = await loadShowcaseEntries(repoRoot);
    return { success: true, data: entries, filePath: path.join(repoRoot, SHOWCASE_CATALOG_PATH) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

/**
 * Load one showcase automata by relative path or showcase id.
 */
ipcMain.handle('automata:loadShowcase', async (_event, target: string): Promise<LoadResult<unknown>> => {
  try {
    const repoRoot = resolveRepositoryRoot();
    if (!repoRoot) {
      return { success: false, error: `Cannot locate ${SHOWCASE_CATALOG_PATH}` };
    }

    const entries = await loadShowcaseEntries(repoRoot);
    const resolved = entries.find((entry) => entry.id === target || entry.relativePath === target);
    if (!resolved) {
      return { success: false, error: `Showcase automata not found: ${target}` };
    }

    const absolutePath = path.join(repoRoot, resolved.relativePath);
    const content = await fs.readFile(absolutePath, 'utf-8');
    const automata = yamlToAutomata(content);
    return { success: true, data: automata, filePath: absolutePath };
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

function resolveRepositoryRoot(): string | null {
  const candidates = [
    process.env.AETHERIUM_REPO_ROOT,
    process.cwd(),
    app.getAppPath(),
    path.resolve(__dirname, '..', '..', '..', '..'),
    path.resolve(__dirname, '..', '..', '..', '..', '..'),
  ].filter((value): value is string => Boolean(value && value.trim().length > 0));

  for (const candidate of candidates) {
    const found = findCatalogInAncestors(path.resolve(candidate));
    if (found) {
      return found;
    }
  }

  return null;
}

function findCatalogInAncestors(startDir: string): string | null {
  let current = startDir;

  for (let depth = 0; depth < 8; depth += 1) {
    const catalogPath = path.join(current, SHOWCASE_CATALOG_PATH);
    if (existsSync(catalogPath)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

async function loadShowcaseEntries(repoRoot: string): Promise<ShowcaseAutomataEntry[]> {
  const catalogPath = path.join(repoRoot, SHOWCASE_CATALOG_PATH);
  const raw = await fs.readFile(catalogPath, 'utf-8');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  return lines.map((relativePath, index) => {
    const normalizedPath = relativePath.replace(/\\/g, '/');
    const segments = normalizedPath.split('/');
    const categoryRaw = segments[3] || 'showcase';
    const baseName = path.basename(normalizedPath, path.extname(normalizedPath));

    return {
      id: `showcase_${String(index + 1).padStart(2, '0')}`,
      name: humanizeLabel(baseName),
      category: humanizeLabel(categoryRaw.replace(/^\d+_/, '')),
      relativePath: normalizedPath,
    };
  });
}

function humanizeLabel(input: string): string {
  return input
    .split(/[_-]+/)
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : ''))
    .join(' ')
    .trim();
}

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
 */
function automataToYaml(automata: unknown): string {
  const obj = asRecord(automata);
  const config = asRecord(obj.config);
  const states = asRecord(obj.states);
  const transitions = asRecord(obj.transitions);

  const serializedStates = Object.entries(states).reduce<Record<string, unknown>>((acc, [id, rawState]) => {
    const state = asRecord(rawState);
    acc[id] = {
      name: toStringSafe(state.name, id),
      inputs: asStringArray(state.inputs),
      outputs: asStringArray(state.outputs),
      variables: asVariableRefArray(state.variables),
      code: toStringSafe(state.code, ''),
      hooks: asRecord(state.hooks),
    };
    return acc;
  }, {});

  const serializedTransitions = Object.entries(transitions).reduce<Record<string, unknown>>((acc, [id, rawTransition]) => {
    const transition = asRecord(rawTransition);
    const timed = asRecord(transition.timed);
    const event = asRecord(transition.event);
    const entry: Record<string, unknown> = {
      from: transition.from,
      to: transition.to,
      type: transition.type || inferTransitionTypeFromData(transition),
      condition: transition.condition || '',
      priority: toNumber(transition.priority, 0),
      weight: toNumber(transition.weight, 1),
    };

    if (Object.keys(timed).length > 0) {
      entry.timed = {
        mode: timed.mode || 'after',
        delay_ms: toNumber(timed.delay_ms ?? timed.delayMs, 0),
        jitter_ms: toNumber(timed.jitter_ms ?? timed.jitterMs, 0),
      };
    }
    if (Object.keys(event).length > 0) {
      entry.event = {
        triggers: Array.isArray(event.triggers) ? event.triggers : [],
        require_all: Boolean(event.require_all ?? event.requireAll),
        debounce_ms: toNumber(event.debounce_ms ?? event.debounceMs, 0),
      };
    }

    acc[id] = entry;
    return acc;
  }, {});

  const payload = {
    version: toStringSafe(obj.version, '0.0.1'),
    config: {
      name: toStringSafe(config.name, 'Unnamed'),
      type: toStringSafe(config.type, 'inline'),
      language: toStringSafe(config.language, 'lua'),
      description: toStringSafe(config.description, ''),
      tags: asStringArray(config.tags),
      version: toStringSafe(config.version, '1.0.0'),
    },
    automata: {
      initial_state: toStringSafe(obj.initialState, 'Initial'),
      states: serializedStates,
      transitions: serializedTransitions,
    },
    variables: Array.isArray(obj.variables) ? obj.variables : [],
  };

  return jsYaml.dump(payload, { noRefs: true, lineWidth: 120, sortKeys: false });
}

/**
 * Parse YAML string to automata object
 */
function yamlToAutomata(yaml: string): unknown {
  let parsed: unknown;

  try {
    parsed = JSON.parse(yaml);
  } catch {
    parsed = jsYaml.load(yaml);
  }

  return normalizeAutomataDocument(parsed);
}

function normalizeAutomataDocument(input: unknown): Record<string, unknown> {
  const root = asRecord(input);
  const config = asRecord(root.config);
  const automataSection = asRecord(root.automata);
  const source = Object.keys(automataSection).length > 0 ? automataSection : root;

  const rawStates = asRecord(source.states);
  const stateRefToId = new Map<string, string>();
  const states = Object.entries(rawStates).reduce<Record<string, unknown>>((acc, [stateKey, rawState], index) => {
    const state = asRecord(rawState);
    const id = toStringSafe(state.id, stateKey || `State_${index + 1}`);
    const name = toStringSafe(state.name, stateKey || id);

    stateRefToId.set(stateKey, id);
    stateRefToId.set(name, id);
    stateRefToId.set(id, id);

    const hooks = asRecord(state.hooks);
    const legacyHooks = {
      onEnter: toOptionalString(state.on_enter),
      onExit: toOptionalString(state.on_exit),
      onTick: toOptionalString(state.on_tick),
      onError: toOptionalString(state.on_error),
    };

    acc[id] = {
      id,
      name,
      inputs: asStringArray(state.inputs),
      outputs: asStringArray(state.outputs),
      variables: asVariableRefArray(state.variables),
      code: toStringSafe(state.code, ''),
      hooks: {
        ...hooks,
        ...(legacyHooks.onEnter ? { onEnter: legacyHooks.onEnter } : {}),
        ...(legacyHooks.onExit ? { onExit: legacyHooks.onExit } : {}),
        ...(legacyHooks.onTick ? { onTick: legacyHooks.onTick } : {}),
        ...(legacyHooks.onError ? { onError: legacyHooks.onError } : {}),
      },
      isComposite: Boolean(state.isComposite ?? state.is_composite ?? false),
      position: {
        x: toNumber(asRecord(state.position).x, 180 + (index % 4) * 220),
        y: toNumber(asRecord(state.position).y, 80 + Math.floor(index / 4) * 160),
      },
      description: toOptionalString(state.description),
    };

    return acc;
  }, {});

  const resolveStateRef = (value: unknown): string => {
    const key = toStringSafe(value, '');
    if (!key) return '';
    return stateRefToId.get(key) || key;
  };

  const rawTransitions = asRecord(source.transitions);
  const transitions = Object.entries(rawTransitions).reduce<Record<string, unknown>>((acc, [transitionKey, rawTransition]) => {
    const transition = asRecord(rawTransition);
    const id = toStringSafe(transition.id, transitionKey);
    const from = resolveStateRef(transition.from);
    const to = resolveStateRef(transition.to);
    const timedRaw = asRecord(transition.timed);
    const timedSource =
      Object.keys(timedRaw).length > 0
        ? timedRaw
        : inferTimedConfigFromTransition(transition);
    const event = asRecord(transition.event);
    const probabilistic = asRecord(transition.probabilistic);

    const hasExplicitDelayMs =
      timedSource &&
      (timedSource.delayMs !== undefined || timedSource.delay_ms !== undefined);
    const delayRaw = hasExplicitDelayMs
      ? timedSource?.delayMs ?? timedSource?.delay_ms
      : timedSource?.after;

    const hasExplicitWindowMs =
      timedSource &&
      (timedSource.windowEndMs !== undefined || timedSource.window_end_ms !== undefined);
    const windowRaw = hasExplicitWindowMs
      ? timedSource?.windowEndMs ?? timedSource?.window_end_ms
      : timedSource?.window_end;

    acc[id] = {
      id,
      name: toStringSafe(transition.name, id),
      from,
      to,
      type: transition.type || inferTransitionTypeFromData(transition),
      condition: toStringSafe(transition.condition, ''),
      body: toStringSafe(transition.body, ''),
      priority: toNumber(transition.priority, 0),
      weight: toNumber(transition.weight ?? probabilistic.weight, 1),
      timed: timedSource
        ? {
            mode: parseTimedMode(timedSource.mode),
            delayMs: parseDurationMs(delayRaw, 0, hasExplicitDelayMs ? 'ms' : 's'),
            jitterMs: parseDurationMs(timedSource.jitterMs ?? timedSource.jitter_ms, 0),
            absoluteTime: toOptionalNumber(
              timedSource.absoluteTime ??
              timedSource.absolute_time_ms ??
              timedSource.absoluteTimeMs ??
              timedSource.at_ms
            ),
            repeatCount: toOptionalNumber(timedSource.repeatCount ?? timedSource.repeat_count),
            windowEndMs: toOptionalNumber(
              parseDurationMs(
                windowRaw,
                Number.NaN,
                hasExplicitWindowMs ? 'ms' : 's'
              )
            ),
            additionalCondition: toOptionalString(
              timedSource.additionalCondition ??
              timedSource.additional_condition ??
              timedSource.condition
            ),
            showCountdown: timedSource.showCountdown === undefined ? true : Boolean(timedSource.showCountdown),
          }
        : undefined,
      event: Object.keys(event).length > 0
        ? {
            triggers: Array.isArray(event.triggers) ? event.triggers : [],
            requireAll: Boolean(event.requireAll ?? event.require_all),
            debounceMs: toNumber(event.debounceMs ?? event.debounce_ms, 0),
            additionalCondition: toOptionalString(event.additionalCondition),
          }
        : undefined,
      probabilistic: Object.keys(probabilistic).length > 0
        ? {
            enabled: true,
            weight: toNumber(probabilistic.weight, toNumber(transition.weight, 1)),
            condition: toOptionalString(probabilistic.condition),
          }
        : undefined,
    };

    return acc;
  }, {});

  const initialStateRaw =
    source.initial_state ??
    source.initialState ??
    root.initial_state ??
    root.initialState;

  const firstStateId = Object.keys(states)[0] || 'Initial';

  return {
    id: toStringSafe(root.id, `aut_${Date.now().toString(36)}`),
    version: toStringSafe(root.version, '0.0.1'),
    config: {
      name: toStringSafe(config.name ?? root.name, 'Imported Automata'),
      type: toStringSafe(config.type, 'inline'),
      location: toOptionalString(config.location),
      language: 'lua',
      description: toOptionalString(config.description ?? root.description),
      tags: asStringArray(config.tags),
      version: toStringSafe(config.version, '1.0.0'),
      created: Date.now(),
      modified: Date.now(),
    },
    initialState: resolveStateRef(initialStateRaw) || firstStateId,
    states,
    transitions,
    variables: normalizeVariables(root.variables ?? source.variables),
    inputs: asStringArray(root.inputs ?? source.inputs),
    outputs: asStringArray(root.outputs ?? source.outputs),
    nestedAutomataIds: [],
    isDirty: true,
  };
}

function normalizeVariables(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => asRecord(raw))
    .filter((variable) => toStringSafe(variable.name, '') !== '')
    .map((variable) => ({
      id: toOptionalString(variable.id),
      name: toStringSafe(variable.name, ''),
      type: toStringSafe(variable.type, 'any'),
      direction: toStringSafe(variable.direction, 'internal'),
      default: variable.default,
      description: toOptionalString(variable.description),
    }));
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => toStringSafe(entry, '')).filter((entry) => entry.length > 0);
}

function asVariableRefArray(value: unknown): Array<string | Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === 'string') return entry;
    const variable = asRecord(entry);
    if (!variable.name) return toStringSafe(entry, '');
    return {
      id: toOptionalString(variable.id),
      name: toStringSafe(variable.name, ''),
      type: toStringSafe(variable.type, 'any'),
      direction: toOptionalString(variable.direction),
      default: variable.default,
    };
  });
}

function toStringSafe(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function toOptionalString(value: unknown): string | undefined {
  const rendered = toStringSafe(value, '');
  return rendered.length > 0 ? rendered : undefined;
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = toNumber(value, Number.NaN);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function inferTransitionTypeFromData(transition: Record<string, unknown>): string {
  if (transition.timed && Object.keys(asRecord(transition.timed)).length > 0) return 'timed';
  if (inferTimedConfigFromTransition(transition)) return 'timed';
  if (transition.event && Object.keys(asRecord(transition.event)).length > 0) return 'event';
  if (transition.probabilistic && Object.keys(asRecord(transition.probabilistic)).length > 0) return 'probabilistic';
  if (toStringSafe(transition.condition, '').trim() === 'true') return 'immediate';
  return 'classic';
}

function parseTimedMode(value: unknown): string {
  const mode = toStringSafe(value, '').toLowerCase();
  if (mode === 'after' || mode === 'at' || mode === 'every' || mode === 'timeout' || mode === 'window') {
    return mode;
  }
  return 'after';
}

function parseDurationMs(value: unknown, fallback: number, defaultUnit: 'ms' | 's' = 'ms'): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const factor = defaultUnit === 's' ? 1000 : 1;
    return Math.max(0, Math.round(value * factor));
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const raw = value.trim().toLowerCase();
  if (!raw) return fallback;

  const match = raw.match(/^(-?\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/);
  if (!match) return fallback;

  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;

  const unit = match[2] || defaultUnit;
  const factor =
    unit === 'h' ? 3_600_000 :
    unit === 'm' ? 60_000 :
    unit === 's' ? 1_000 :
    1;

  return Math.round(numeric * factor);
}

function inferTimedConfigFromTransition(transition: Record<string, unknown>): Record<string, unknown> | undefined {
  const mode = transition.mode;
  const delayMs = transition.delay_ms ?? transition.delayMs;
  const after = transition.after;
  const jitter = transition.jitter_ms ?? transition.jitterMs;
  const repeatCount = transition.repeat_count ?? transition.repeatCount;
  const windowEndMs = transition.window_end_ms ?? transition.windowEndMs;
  const windowEnd = transition.window_end;
  const absoluteTime =
    transition.absolute_time_ms ??
    transition.absoluteTimeMs ??
    transition.absoluteTime ??
    transition.at_ms;
  const additionalCondition =
    transition.additional_condition ??
    transition.additionalCondition ??
    transition.timed_condition;

  const hasAny =
    mode !== undefined ||
    delayMs !== undefined ||
    after !== undefined ||
    jitter !== undefined ||
    repeatCount !== undefined ||
    windowEndMs !== undefined ||
    windowEnd !== undefined ||
    absoluteTime !== undefined ||
    additionalCondition !== undefined;

  if (!hasAny) {
    return undefined;
  }

  return {
    mode,
    ...(delayMs !== undefined ? { delay_ms: delayMs } : {}),
    ...(after !== undefined ? { after } : {}),
    jitter_ms: jitter,
    repeat_count: repeatCount,
    ...(windowEndMs !== undefined ? { window_end_ms: windowEndMs } : {}),
    ...(windowEnd !== undefined ? { window_end: windowEnd } : {}),
    absolute_time_ms: absoluteTime,
    additional_condition: additionalCondition,
  };
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

import type { Automata } from '../types';

interface NormalizeOptions {
  filePath?: string;
  keepDirty?: boolean;
}

const fallbackId = (): string => `aut_${Math.random().toString(16).slice(2, 10)}`;

const normalizeLayoutType = (raw: unknown): 'inline' | 'folder' =>
  raw === 'folder' ? 'folder' : 'inline';

export function normalizeImportedAutomata(
  imported: Partial<Automata>,
  options?: NormalizeOptions,
): Automata {
  const now = Date.now();
  const id = imported.id || fallbackId();
  const states = imported.states || {};
  const initialState = imported.initialState || Object.keys(states)[0] || 'Initial';
  const config = imported.config;

  return {
    ...(imported as Automata),
    id,
    version: imported.version || '0.0.1',
    config: {
      name: config?.name || `Imported ${id}`,
      type: normalizeLayoutType(config?.type),
      language: 'lua',
      description: config?.description || '',
      tags: config?.tags || [],
      version: config?.version || '1.0.0',
      created: typeof config?.created === 'number' ? config.created : now,
      modified: now,
      ...(config?.location ? { location: config.location } : {}),
    },
    initialState,
    states,
    transitions: imported.transitions || {},
    variables: imported.variables || [],
    inputs: imported.inputs || [],
    outputs: imported.outputs || [],
    nestedAutomataIds: imported.nestedAutomataIds || [],
    isDirty: options?.keepDirty ?? true,
    ...(options?.filePath ? { filePath: options.filePath } : {}),
  };
}

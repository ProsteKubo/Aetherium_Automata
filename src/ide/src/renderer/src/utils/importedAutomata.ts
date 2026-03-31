import type { Automata } from '../types';
import { getAutomataPorts } from './automataBindings';

interface NormalizeOptions {
  filePath?: string;
  keepDirty?: boolean;
}

const fallbackId = (): string => `aut_${Math.random().toString(16).slice(2, 10)}`;

const normalizeLayoutType = (raw: unknown): 'inline' | 'folder' =>
  raw === 'folder' ? 'folder' : 'inline';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry ?? '')).filter((entry) => entry.length > 0)
    : [];
}

function normalizeBlackBox(value: unknown): Automata['blackBox'] | undefined {
  const contract = asRecord(value);
  if (!contract) return undefined;

  const ports = Array.isArray(contract.ports)
    ? contract.ports
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry?.name))
        .map((entry) => ({
          name: String(entry.name),
          direction: String(entry.direction ?? 'internal') as 'input' | 'output' | 'internal',
          type: String(entry.type ?? 'any'),
          observable:
            entry.observable === undefined ? undefined : Boolean(entry.observable),
          faultInjectable:
            entry.faultInjectable === undefined && entry.fault_injectable === undefined
              ? undefined
              : Boolean(entry.faultInjectable ?? entry.fault_injectable),
          description:
            typeof entry.description === 'string' ? entry.description : undefined,
        }))
    : [];

  const resources = Array.isArray(contract.resources)
    ? contract.resources
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry?.name))
        .map((entry) => ({
          name: String(entry.name),
          kind: String(entry.kind ?? 'generic'),
          capacity:
            typeof entry.capacity === 'number' ? entry.capacity : undefined,
          shared: entry.shared === undefined ? undefined : Boolean(entry.shared),
          latencySensitive:
            entry.latencySensitive === undefined && entry.latency_sensitive === undefined
              ? undefined
              : Boolean(entry.latencySensitive ?? entry.latency_sensitive),
          description:
            typeof entry.description === 'string' ? entry.description : undefined,
        }))
    : [];

  return {
    ports,
    observableStates: asStringArray(contract.observableStates ?? contract.observable_states),
    emittedEvents: asStringArray(contract.emittedEvents ?? contract.emitted_events),
    resources,
  };
}

export function normalizeImportedAutomata(
  imported: Partial<Automata>,
  options?: NormalizeOptions,
): Automata {
  const importedRecord = imported as Record<string, unknown>;
  const now = Date.now();
  const id = imported.id || fallbackId();
  const states = imported.states || {};
  const initialState = imported.initialState || Object.keys(states)[0] || 'Initial';
  const config = imported.config;
  const blackBox =
    normalizeBlackBox((imported as Automata).blackBox) ??
    normalizeBlackBox(importedRecord.blackBox || importedRecord.black_box);

  const normalized: Automata = {
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
    ...(blackBox ? { blackBox } : null),
    nestedAutomataIds: imported.nestedAutomataIds || [],
    isDirty: options?.keepDirty ?? true,
    ...(options?.filePath ? { filePath: options.filePath } : {}),
  };

  return {
    ...normalized,
    inputs: getAutomataPorts(normalized, 'input').map((port) => port.name),
    outputs: getAutomataPorts(normalized, 'output').map((port) => port.name),
  };
}

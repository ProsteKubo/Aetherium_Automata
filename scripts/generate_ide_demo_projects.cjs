#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const jsYaml = require('../src/ide/node_modules/js-yaml');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(REPO_ROOT, 'example', 'ide_demo_projects');
const GENERATED_TS = Date.parse('2026-04-01T12:00:00Z');

const DEFAULT_PROJECT_SETTINGS = {
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
};

const DEMO_PROJECTS = [
  {
    fileName: 'petri-signal-chain-demo.aeth',
    metadata: {
      name: 'Petri Signal Chain Demo',
      version: '0.1.0',
      description:
        'Signal-chain showcase project for Petri conversion with derived bindings, shared resources, and one sealed drive black box.',
      author: 'Aetherium Team',
      tags: ['demo', 'petri', 'signal-chain', 'presentation'],
    },
    networks: [
      {
        id: 'network_signal_chain',
        name: 'Signal Chain',
        description:
          'Four automata laid out to highlight Petri grouping, shared field-bus resources, and a sealed drive node.',
        relativePath: 'networks/signal-chain',
        color: '#1f6f78',
        icon: 'network',
        automataPaths: [
          'example/automata/showcase/13_petri_signal_chain/petri_command_router.yaml',
          'example/automata/showcase/13_petri_signal_chain/petri_safety_gate.yaml',
          'example/automata/showcase/13_petri_signal_chain/petri_drive_unit_black_box.yaml',
          'example/automata/showcase/13_petri_signal_chain/petri_telemetry_observer.yaml',
        ],
      },
    ],
  },
  {
    fileName: 'analyzer-contention-demo.aeth',
    metadata: {
      name: 'Analyzer Contention Demo',
      version: '0.1.0',
      description:
        'Shared-resource contention showcase for the analyzer using one allocator and two competing consumers on the dc_bus.',
      author: 'Aetherium Team',
      tags: ['demo', 'analyzer', 'contention', 'presentation'],
    },
    networks: [
      {
        id: 'network_contention',
        name: 'Shared Bus Contention',
        description:
          'Three automata competing for one latency-sensitive dc_bus resource to surface analyzer findings quickly.',
        relativePath: 'networks/shared-bus-contention',
        color: '#c84c09',
        icon: 'analysis',
        automataPaths: [
          'example/automata/showcase/14_petri_contention/petri_power_allocator.yaml',
          'example/automata/showcase/14_petri_contention/petri_charger_node.yaml',
          'example/automata/showcase/14_petri_contention/petri_motion_axis.yaml',
        ],
      },
    ],
  },
  {
    fileName: 'black-box-contract-tour.aeth',
    metadata: {
      name: 'Black Box Contract Tour',
      version: '0.1.0',
      description:
        'Contract-focused showcase project for observable ports, emitted events, latency-sensitive resources, and sealed-unit inspection.',
      author: 'Aetherium Team',
      tags: ['demo', 'black-box', 'contracts', 'presentation'],
    },
    networks: [
      {
        id: 'network_black_box_contracts',
        name: 'Black Box Contracts',
        description:
          'Observable interfaces and resource contracts across a sealed drive unit, safety gate, and a standalone probe.',
        relativePath: 'networks/black-box-contracts',
        color: '#6b7a18',
        icon: 'shield',
        automataPaths: [
          'example/automata/showcase/12_black_box/docker_black_box_probe.yaml',
          'example/automata/showcase/13_petri_signal_chain/petri_drive_unit_black_box.yaml',
          'example/automata/showcase/13_petri_signal_chain/petri_safety_gate.yaml',
          'example/automata/showcase/14_petri_contention/petri_power_allocator.yaml',
        ],
      },
    ],
  },
  {
    fileName: 'backend-capabilities-tour.aeth',
    metadata: {
      name: 'Backend Capabilities Tour',
      version: '0.1.0',
      description:
        'All-in-one presentation project with one network each for Petri conversion, analyzer contention, and black-box contract inspection.',
      author: 'Aetherium Team',
      tags: ['demo', 'petri', 'analyzer', 'black-box', 'presentation'],
    },
    networks: [
      {
        id: 'network_tour_signal_chain',
        name: 'Petri Signal Chain',
        description:
          'Operator-to-drive signal chain with derived bindings and one sealed drive automaton.',
        relativePath: 'networks/tour-petri-signal-chain',
        color: '#1f6f78',
        icon: 'network',
        automataPaths: [
          'example/automata/showcase/13_petri_signal_chain/petri_command_router.yaml',
          'example/automata/showcase/13_petri_signal_chain/petri_safety_gate.yaml',
          'example/automata/showcase/13_petri_signal_chain/petri_drive_unit_black_box.yaml',
          'example/automata/showcase/13_petri_signal_chain/petri_telemetry_observer.yaml',
        ],
      },
      {
        id: 'network_tour_contention',
        name: 'Analyzer Contention',
        description:
          'Allocator plus two consumers sharing one latency-sensitive dc_bus resource.',
        relativePath: 'networks/tour-analyzer-contention',
        color: '#c84c09',
        icon: 'analysis',
        automataPaths: [
          'example/automata/showcase/14_petri_contention/petri_power_allocator.yaml',
          'example/automata/showcase/14_petri_contention/petri_charger_node.yaml',
          'example/automata/showcase/14_petri_contention/petri_motion_axis.yaml',
        ],
      },
      {
        id: 'network_tour_black_boxes',
        name: 'Black Box Contracts',
        description:
          'A compact contract set with observable ports, emitted events, and fault-injectable outputs.',
        relativePath: 'networks/tour-black-box-contracts',
        color: '#6b7a18',
        icon: 'shield',
        automataPaths: [
          'example/automata/showcase/12_black_box/docker_black_box_probe.yaml',
          'example/automata/showcase/13_petri_signal_chain/petri_drive_unit_black_box.yaml',
          'example/automata/showcase/13_petri_signal_chain/petri_safety_gate.yaml',
        ],
      },
    ],
  },
];

function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  DEMO_PROJECTS.forEach((demo) => {
    const project = buildProject(demo);
    const targetPath = path.join(OUTPUT_DIR, demo.fileName);
    fs.writeFileSync(targetPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
    console.log(`wrote ${path.relative(REPO_ROOT, targetPath)}`);
  });
}

function buildProject(demo) {
  const automata = {};
  const networks = demo.networks.map((network) => buildNetwork(network, automata));

  return {
    schemaVersion: '1.0.0',
    metadata: {
      ...demo.metadata,
      created: GENERATED_TS,
      modified: GENERATED_TS,
    },
    networks,
    automata,
    settings: DEFAULT_PROJECT_SETTINGS,
    isDirty: false,
  };
}

function buildNetwork(network, projectAutomata) {
  const automataEntries = network.automataPaths.map((relativePath, index) =>
    loadAutomata(relativePath, {
      networkId: network.id,
      index,
    }),
  );

  automataEntries.forEach((automata) => {
    projectAutomata[automata.id] = automata;
  });

  return {
    id: network.id,
    name: network.name,
    description: network.description,
    rootAutomataIds: automataEntries.map((automata) => automata.id),
    automataIds: automataEntries.map((automata) => automata.id),
    inputs: unique(automataEntries.flatMap((automata) => automata.inputs || [])),
    outputs: unique(automataEntries.flatMap((automata) => automata.outputs || [])),
    relativePath: network.relativePath,
    color: network.color,
    icon: network.icon,
    isExpanded: true,
  };
}

function loadAutomata(relativePath, context) {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  const parsed = raw.trim().startsWith('{') ? JSON.parse(raw) : jsYaml.load(raw);
  const fallbackId = buildAutomataId(relativePath, context.networkId, context.index);
  const automata = normalizeAutomataDocument(parsed, fallbackId);

  return {
    ...automata,
    config: {
      ...automata.config,
      created: GENERATED_TS,
      modified: GENERATED_TS,
    },
    isDirty: false,
  };
}

function buildAutomataId(relativePath, networkId, index) {
  const fileSlug = path.basename(relativePath, path.extname(relativePath)).replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
  return `${networkId}_${String(index + 1).padStart(2, '0')}_${fileSlug}`;
}

function normalizeAutomataDocument(input, fallbackId) {
  const root = asRecord(input);
  const config = asRecord(root.config);
  const automataSection = asRecord(root.automata);
  const source = Object.keys(automataSection).length > 0 ? automataSection : root;
  const blackBox = normalizeBlackBoxContract(root.black_box ?? root.blackBox);

  const rawStates = asRecord(source.states);
  const stateRefToId = new Map();
  const states = Object.entries(rawStates).reduce((acc, [stateKey, rawState], index) => {
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

  const resolveStateRef = (value) => {
    const key = toStringSafe(value, '');
    if (!key) return '';
    return stateRefToId.get(key) || key;
  };

  const rawTransitions = asRecord(source.transitions);
  const transitions = Object.entries(rawTransitions).reduce((acc, [transitionKey, rawTransition]) => {
    const transition = asRecord(rawTransition);
    const id = toStringSafe(transition.id, transitionKey);
    const timedRaw = asRecord(transition.timed);
    const timedSource = Object.keys(timedRaw).length > 0 ? timedRaw : inferTimedConfigFromTransition(transition);
    const event = asRecord(transition.event);
    const probabilistic = asRecord(transition.probabilistic);

    const hasExplicitDelayMs =
      timedSource &&
      (timedSource.delayMs !== undefined || timedSource.delay_ms !== undefined);
    const delayRaw = hasExplicitDelayMs
      ? timedSource.delayMs ?? timedSource.delay_ms
      : timedSource && timedSource.after;

    const hasExplicitWindowMs =
      timedSource &&
      (timedSource.windowEndMs !== undefined || timedSource.window_end_ms !== undefined);
    const windowRaw = hasExplicitWindowMs
      ? timedSource.windowEndMs ?? timedSource.window_end_ms
      : timedSource && timedSource.window_end;

    acc[id] = {
      id,
      name: toStringSafe(transition.name, id),
      from: resolveStateRef(transition.from),
      to: resolveStateRef(transition.to),
      type: transition.type || inferTransitionTypeFromData(transition),
      condition: toStringSafe(transition.condition, ''),
      body: toStringSafe(transition.body, ''),
      triggered: toStringSafe(transition.triggered, ''),
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
                timedSource.at_ms,
            ),
            repeatCount: toOptionalNumber(timedSource.repeatCount ?? timedSource.repeat_count),
            windowEndMs: toOptionalNumber(
              parseDurationMs(windowRaw, Number.NaN, hasExplicitWindowMs ? 'ms' : 's'),
            ),
            additionalCondition: toOptionalString(
              timedSource.additionalCondition ??
                timedSource.additional_condition ??
                timedSource.condition,
            ),
            showCountdown:
              timedSource.showCountdown === undefined ? true : Boolean(timedSource.showCountdown),
          }
        : undefined,
      event:
        Object.keys(event).length > 0
          ? {
              triggers: Array.isArray(event.triggers) ? event.triggers : [],
              requireAll: Boolean(event.requireAll ?? event.require_all),
              debounceMs: toNumber(event.debounceMs ?? event.debounce_ms, 0),
              additionalCondition: toOptionalString(event.additionalCondition),
            }
          : undefined,
      probabilistic:
        Object.keys(probabilistic).length > 0
          ? {
              enabled: true,
              weight: toNumber(probabilistic.weight, toNumber(transition.weight, 1)),
              condition: toOptionalString(probabilistic.condition),
            }
          : undefined,
    };

    return acc;
  }, {});

  const variables = normalizeVariables(root.variables ?? source.variables);
  const initialStateRaw =
    source.initial_state ??
    source.initialState ??
    root.initial_state ??
    root.initialState;
  const firstStateId = Object.keys(states)[0] || 'Initial';
  const inputs = unique([
    ...asStringArray(root.inputs ?? source.inputs),
    ...variables.filter((variable) => variable.direction === 'input').map((variable) => variable.name),
    ...collectBlackBoxPorts(blackBox, 'input'),
  ]);
  const outputs = unique([
    ...asStringArray(root.outputs ?? source.outputs),
    ...variables.filter((variable) => variable.direction === 'output').map((variable) => variable.name),
    ...collectBlackBoxPorts(blackBox, 'output'),
  ]);

  return {
    id: toStringSafe(root.id, fallbackId),
    version: toStringSafe(root.version, '0.0.1'),
    config: {
      name: toStringSafe(config.name ?? root.name, 'Imported Automata'),
      type: toStringSafe(config.type, 'inline'),
      location: toOptionalString(config.location),
      language: 'lua',
      description: toOptionalString(config.description ?? root.description),
      tags: asStringArray(config.tags),
      author: toOptionalString(config.author),
      version: toStringSafe(config.version, '1.0.0'),
      target: asRecord(config.target),
      created: GENERATED_TS,
      modified: GENERATED_TS,
    },
    initialState: resolveStateRef(initialStateRaw) || firstStateId,
    states,
    transitions,
    variables,
    inputs,
    outputs,
    ...(blackBox ? { blackBox } : {}),
    nestedAutomataIds: [],
    isDirty: false,
  };
}

function normalizeBlackBoxContract(value) {
  const contract = asRecord(value);
  if (Object.keys(contract).length === 0) return undefined;

  const ports = Array.isArray(contract.ports)
    ? contract.ports
        .map((raw) => asRecord(raw))
        .filter((port) => toStringSafe(port.name, '').length > 0)
        .map((port) => ({
          name: toStringSafe(port.name, ''),
          direction: toStringSafe(port.direction, 'internal'),
          type: toStringSafe(port.type, 'any'),
          observable: port.observable === undefined ? undefined : Boolean(port.observable),
          faultInjectable:
            port.faultInjectable === undefined && port.fault_injectable === undefined
              ? undefined
              : Boolean(port.faultInjectable ?? port.fault_injectable),
          description: toOptionalString(port.description),
        }))
    : [];

  const resources = Array.isArray(contract.resources)
    ? contract.resources
        .map((raw) => asRecord(raw))
        .filter((resource) => toStringSafe(resource.name, '').length > 0)
        .map((resource) => ({
          name: toStringSafe(resource.name, ''),
          kind: toStringSafe(resource.kind, 'generic'),
          capacity: toOptionalNumber(resource.capacity),
          shared: resource.shared === undefined ? undefined : Boolean(resource.shared),
          latencySensitive:
            resource.latencySensitive === undefined && resource.latency_sensitive === undefined
              ? undefined
              : Boolean(resource.latencySensitive ?? resource.latency_sensitive),
          description: toOptionalString(resource.description),
        }))
    : [];

  return {
    ports,
    observableStates: asStringArray(contract.observableStates ?? contract.observable_states),
    emittedEvents: asStringArray(contract.emittedEvents ?? contract.emitted_events),
    resources,
  };
}

function normalizeVariables(value) {
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

function inferTransitionTypeFromData(transition) {
  if (transition.timed && Object.keys(asRecord(transition.timed)).length > 0) return 'timed';
  if (inferTimedConfigFromTransition(transition)) return 'timed';
  if (transition.event && Object.keys(asRecord(transition.event)).length > 0) return 'event';
  if (transition.probabilistic && Object.keys(asRecord(transition.probabilistic)).length > 0) {
    return 'probabilistic';
  }
  if (toStringSafe(transition.condition, '').trim() === 'true') return 'immediate';
  return 'classic';
}

function inferTimedConfigFromTransition(transition) {
  const keys = [
    'after',
    'after_ms',
    'every',
    'every_ms',
    'timeout',
    'timeout_ms',
    'window_end',
    'window_end_ms',
    'at_ms',
    'absolute_time_ms',
  ];

  const found = keys.find((key) => transition[key] !== undefined);
  if (!found) return undefined;

  if (found.startsWith('every')) {
    return { mode: 'every', delay_ms: transition.every_ms ?? transition.every };
  }
  if (found.startsWith('timeout')) {
    return { mode: 'timeout', delay_ms: transition.timeout_ms ?? transition.timeout };
  }
  if (found.startsWith('window')) {
    return { mode: 'window', window_end_ms: transition.window_end_ms ?? transition.window_end };
  }
  if (found.startsWith('at') || found.startsWith('absolute')) {
    return { mode: 'at', absolute_time_ms: transition.at_ms ?? transition.absolute_time_ms };
  }

  return { mode: 'after', delay_ms: transition.after_ms ?? transition.after };
}

function parseTimedMode(value) {
  const mode = toStringSafe(value, '').toLowerCase();
  if (['after', 'at', 'every', 'timeout', 'window'].includes(mode)) {
    return mode;
  }
  return 'after';
}

function parseDurationMs(value, fallback, defaultUnit = 'ms') {
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
  const factor = unit === 'h' ? 3600000 : unit === 'm' ? 60000 : unit === 's' ? 1000 : 1;
  return Math.round(numeric * factor);
}

function collectBlackBoxPorts(blackBox, direction) {
  return Array.isArray(blackBox && blackBox.ports)
    ? blackBox.ports
        .filter((port) => port.direction === direction)
        .map((port) => port.name)
    : [];
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => toStringSafe(entry, '')).filter((entry) => entry.length > 0)
    : [];
}

function asVariableRefArray(value) {
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

function toStringSafe(value, fallback) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function toOptionalString(value) {
  const rendered = toStringSafe(value, '');
  return rendered.length > 0 ? rendered : undefined;
}

function toNumber(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = toNumber(value, Number.NaN);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

main();

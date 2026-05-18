#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const jsYaml = require('../src/ide/node_modules/js-yaml');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(REPO_ROOT, 'example', 'ide_demo_projects');
const NEW_PROJECT_PATH = path.join(REPO_ROOT, 'NewProject.aeth');
const GENERATED_TS = Date.parse('2026-04-01T12:00:00Z');
const PROJECT_SOURCE_ROOTS = [
  {
    sourceRoot: path.join(REPO_ROOT, 'example', 'automata', 'showcase'),
    outputRoot: path.join(OUTPUT_DIR, 'showcase'),
    colocatedRoot: path.join(REPO_ROOT, 'example', 'automata', 'showcase'),
    tag: 'showcase',
    label: 'Showcase',
  },
  {
    sourceRoot: path.join(REPO_ROOT, 'example', 'automata', 'automata-yaml-examples'),
    outputRoot: path.join(OUTPUT_DIR, 'examples', 'automata-yaml-examples'),
    tag: 'yaml-example',
    label: 'YAML Example',
  },
  {
    sourceRoot: path.join(REPO_ROOT, 'example', 'automata', 'demos'),
    outputRoot: path.join(OUTPUT_DIR, 'examples', 'demos'),
    tag: 'demo',
    label: 'Demo',
  },
];

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

const FLAGSHIP_PROJECTS = [
  {
    fileName: 'backend-capabilities-tour.aeth',
    metadata: {
      name: 'Aetherium Flagship Showcase',
      version: '0.1.0',
      description:
        'Canonical multi-network showcase for the converged package: state-heavy EFSM orchestration, named channels, black boxes, contention, fault paths, and replay/analyzer value in one desktop-runnable project.',
      author: 'Aetherium Team',
      tags: ['flagship', 'efsm', 'orchestration', 'petri', 'analyzer', 'black-box', 'runtime'],
    },
    networks: [
      {
        id: 'network_aetherium_gem',
        name: 'Aetherium Gem Cell',
        description:
          'Single flagship cell for thesis demos: TDD checkpoints, high state churn, fault-injection controls, replay markers, black-box boundary metadata, and a Petri-liftable shared bus demand.',
        relativePath: 'networks/aetherium-gem-cell',
        color: '#2563eb',
        icon: 'spark',
        automataPaths: [
          'example/automata/showcase/15_aetherium_gem/aetherium_gem_cell.yaml',
        ],
      },
      {
        id: 'network_signal_chain',
        name: 'Signal Chain Backbone',
        description:
          'Operator-to-drive backbone. Produces heartbeat, permit, state, and module-status channels that feed other networks.',
        relativePath: 'networks/signal-chain-backbone',
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
        id: 'network_guarded_cell',
        name: 'Guarded Cell Cluster',
        description:
          'State-heavy cell supervision network spanning host and embedded actors. Shares permit and supervisor channels with the backbone.',
        relativePath: 'networks/guarded-cell-cluster',
        color: '#7c3aed',
        icon: 'shield',
        automataPaths: [
          'example/automata/showcase/10_guarded_cell/guarded_cell_safety_supervisor.yaml',
          'example/automata/showcase/10_guarded_cell/guarded_cell_actuation_controller.yaml',
          'example/automata/showcase/10_guarded_cell/guarded_cell_signal_conditioner.yaml',
          'example/automata/showcase/10_guarded_cell/esp32_guarded_cell_alarm_beacon.yaml',
          'example/automata/showcase/10_guarded_cell/esp32_guarded_cell_primary_actuator.yaml',
          'example/automata/showcase/10_guarded_cell/mcxn947_guarded_cell_leader.yaml',
        ],
      },
      {
        id: 'network_power_contention',
        name: 'Power Contention Ring',
        description:
          'Three cooperating automata competing for a latency-sensitive dc_bus so the analyzer and Petri views have real bottlenecks to surface.',
        relativePath: 'networks/power-contention-ring',
        color: '#c84c09',
        icon: 'analysis',
        automataPaths: [
          'example/automata/showcase/14_petri_contention/petri_power_allocator.yaml',
          'example/automata/showcase/14_petri_contention/petri_charger_node.yaml',
          'example/automata/showcase/14_petri_contention/petri_motion_axis.yaml',
        ],
      },
      {
        id: 'network_resilience_watchdog',
        name: 'Resilience Watchdog',
        description:
          'Consumes heartbeat traffic from the backbone and turns missing liveness into explicit recovery and fault states for replay workflows.',
        relativePath: 'networks/resilience-watchdog',
        color: '#0f766e',
        icon: 'pulse',
        automataPaths: [
          'example/automata/showcase/04_resilience/sensor_watchdog_recovery.yaml',
        ],
      },
    ],
  },
];

function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  purgeLegacyProjects();

  const flagshipProjects = [];

  FLAGSHIP_PROJECTS.forEach((projectDefinition) => {
    const project = buildProject(projectDefinition);
    flagshipProjects.push(project);
    const targetPath = path.join(OUTPUT_DIR, projectDefinition.fileName);
    writeProjectFile(targetPath, project);
  });

  if (flagshipProjects[0]) {
    writeProjectFile(NEW_PROJECT_PATH, flagshipProjects[0]);
  }

  writeImportableProjects();
}

function purgeLegacyProjects() {
  const canonicalFiles = new Set(FLAGSHIP_PROJECTS.map((projectDefinition) => projectDefinition.fileName));

  fs.readdirSync(OUTPUT_DIR, { withFileTypes: true }).forEach((entry) => {
    if (!entry.isFile() || path.extname(entry.name) !== '.aeth' || canonicalFiles.has(entry.name)) {
      return;
    }

    fs.rmSync(path.join(OUTPUT_DIR, entry.name));
    console.log(`removed ${path.relative(REPO_ROOT, path.join(OUTPUT_DIR, entry.name))}`);
  });

  ['showcase', 'examples'].forEach((generatedDir) => {
    const absolutePath = path.join(OUTPUT_DIR, generatedDir);
    if (fs.existsSync(absolutePath)) {
      fs.rmSync(absolutePath, { recursive: true, force: true });
      console.log(`removed ${path.relative(REPO_ROOT, absolutePath)}`);
    }
  });
}

function writeProjectFile(targetPath, project) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  console.log(`wrote ${path.relative(REPO_ROOT, targetPath)}`);
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

function writeImportableProjects() {
  PROJECT_SOURCE_ROOTS.forEach((rootDefinition) => {
    if (rootDefinition.colocatedRoot) {
      purgeGeneratedProjectFiles(rootDefinition.colocatedRoot);
    }

    const yamlFiles = discoverYamlFiles(rootDefinition.sourceRoot);
    const filesByDirectory = groupYamlFilesByDirectory(yamlFiles, rootDefinition.sourceRoot);
    Object.entries(filesByDirectory)
      .filter(([, entries]) => entries.length > 0)
      .forEach(([directory, entries]) => {
        const label = directory === '.' ? rootDefinition.label : titleFromSlug(path.basename(directory));
        const automataPaths = entries.map((entry) => normalizePath(path.relative(REPO_ROOT, entry)));
        const project = buildSingleAutomataProject({
          metadataName: `${label} Project`,
          description: `One-click IDE project containing all automata in ${normalizePath(
            path.relative(REPO_ROOT, path.join(rootDefinition.sourceRoot, directory)),
          )}.`,
          tags: [rootDefinition.tag, 'collection', 'generated'],
          networkName: label,
          networkDescription: `Generated collection for ${label}.`,
          automataPaths,
          networkId: `network_${slugify(`${rootDefinition.tag}_${directory}`)}`,
        });
        const targetPath =
          directory === '.'
            ? path.join(rootDefinition.outputRoot, 'all.aeth')
            : path.join(rootDefinition.outputRoot, directory, 'all.aeth');

        writeProjectFile(targetPath, project);
        if (rootDefinition.colocatedRoot) {
          writeProjectFile(path.join(rootDefinition.colocatedRoot, directory, 'all.aeth'), project);
        }
      });
  });
}

function purgeGeneratedProjectFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return;

  const visit = (directory) => {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        return;
      }
      if (!entry.isFile() || path.extname(entry.name) !== '.aeth') {
        return;
      }
      if (!isGeneratedProjectFile(absolutePath)) {
        return;
      }

      fs.rmSync(absolutePath);
      console.log(`removed ${path.relative(REPO_ROOT, absolutePath)}`);
    });
  };

  visit(rootDir);
}

function isGeneratedProjectFile(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const metadata = asRecord(parsed.metadata);
    const tags = asStringArray(metadata.tags);
    return parsed.schemaVersion === '1.0.0' && tags.includes('generated');
  } catch (_error) {
    return false;
  }
}

function buildSingleAutomataProject({ metadataName, description, tags, networkName, networkDescription, automataPaths, networkId }) {
  return buildProject({
    fileName: '',
    metadata: {
      name: metadataName,
      version: '0.1.0',
      description,
      author: 'Aetherium Team',
      tags,
    },
    networks: [
      {
        id: networkId,
        name: networkName,
        description: networkDescription,
        relativePath: `networks/${slugify(networkName)}`,
        color: '#2563eb',
        icon: 'automata',
        automataPaths,
      },
    ],
  });
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
  const automata = normalizeAutomataDocument(parsed, fallbackId, relativePath);

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

function normalizeAutomataDocument(input, fallbackId, sourcePath) {
  const root = asRecord(input);
  const config = asRecord(root.config);
  const automataSection = asRecord(root.automata);
  const source = Object.keys(automataSection).length > 0 ? automataSection : root;
  const blackBox = normalizeBlackBoxContract(root.black_box ?? root.blackBox);

  let rawStates = asRecord(source.states);
  if (Object.keys(rawStates).length === 0) {
    rawStates = Object.entries(source).reduce((acc, [key, value]) => {
      if (isAutomataSectionKey(key)) return acc;
      const record = asRecord(value);
      if (record.from !== undefined || record.to !== undefined) return acc;
      acc[key] = value;
      return acc;
    }, {});
  }
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

  let rawTransitions = asRecord(source.transitions);
  if (Object.keys(rawTransitions).length === 0) {
    rawTransitions = Object.entries(source).reduce((acc, [key, value]) => {
      if (isAutomataSectionKey(key)) return acc;
      const record = asRecord(value);
      if (record.from === undefined && record.to === undefined) return acc;
      acc[key] = value;
      return acc;
    }, {});
  }
  const transitions = Object.entries(rawTransitions).reduce((acc, [transitionKey, rawTransition]) => {
    const transition = asRecord(rawTransition);
    const id = toStringSafe(transition.id, transitionKey);
    const timedRaw = asRecord(transition.timed);
    const timedSource = Object.keys(timedRaw).length > 0 ? timedRaw : inferTimedConfigFromTransition(transition);
    const eventRaw = typeof transition.event === 'string' && transition.event.trim()
      ? { triggers: [{ signal: transition.event.trim(), trigger: 'on_change', signal_type: 'input' }] }
      : transition.event;
    const event = asRecord(eventRaw);
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
    filePath: sourcePath,
    isDirty: false,
  };
}

function discoverYamlFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];

  const found = [];
  const visit = (directory) => {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
        found.push(absolutePath);
      }
    });
  };

  visit(rootDir);
  return found.sort((a, b) => normalizePath(a).localeCompare(normalizePath(b)));
}

function groupYamlFilesByDirectory(files, rootDir) {
  return files.reduce((groups, absolutePath) => {
    const directory = normalizePath(path.dirname(path.relative(rootDir, absolutePath))) || '.';
    groups[directory] = groups[directory] || [];
    groups[directory].push(absolutePath);
    return groups;
  }, {});
}

function slugify(value) {
  const slug = normalizePath(value)
    .replace(/\.(ya?ml)$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return slug || 'project';
}

function titleFromSlug(value) {
  return value
    .replace(/^\d+_/, '')
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function normalizePath(value) {
  return value.replace(/\\/g, '/');
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
  if (transition.event && (typeof transition.event === 'string' || Object.keys(asRecord(transition.event)).length > 0)) return 'event';
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

function isAutomataSectionKey(key) {
  return [
    'initial_state',
    'initialState',
    'states',
    'transitions',
    'inputs',
    'outputs',
    'variables',
  ].includes(key);
}

function asRecord(value) {
  if (Array.isArray(value)) {
    const merged = {};
    let canMerge = value.length > 0;

    value.forEach((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        canMerge = false;
        return;
      }

      Object.assign(merged, entry);
    });

    return canMerge ? merged : {};
  }

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

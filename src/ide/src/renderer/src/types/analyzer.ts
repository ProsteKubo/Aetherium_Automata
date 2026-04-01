import type { AutomataId, DeviceId, ServerId } from './automata';

export type AnalyzerEvidenceMode = 'structural_only' | 'hybrid' | 'observed';
export type AnalyzerScope = 'project' | 'group' | 'deployment';
export type AnalyzerFindingKind =
  | 'shared_resource_contention'
  | 'queue_backlog'
  | 'blocked_handoff'
  | 'starvation_risk'
  | 'unknown_evidence';
export type AnalyzerSeverity = 'info' | 'warning' | 'critical';
export type AnalyzerConfidence = 'declared' | 'inferred' | 'observed' | 'mixed';

export interface AnalyzerQuery {
  scope: AnalyzerScope;
  deploymentIds?: string[];
  automataIds?: AutomataId[];
  serverId?: ServerId;
  afterTs?: number;
  beforeTs?: number;
  includeStructural?: boolean;
  includeTimeline?: boolean;
  limit?: number;
}

export interface AnalyzerDeploymentRef {
  deploymentId: string;
  automataId: AutomataId;
  deviceId?: DeviceId;
  serverId?: ServerId;
  status?: string;
  currentState?: string;
  variables?: Record<string, unknown>;
  deploymentMetadata?: Record<string, unknown>;
}

export interface AnalyzerBindingRef {
  id: string;
  sourceAutomata: AutomataId;
  sourceOutput: string;
  targetAutomata: AutomataId;
  targetInput: string;
  enabled?: boolean;
  bindingType?: string;
}

export interface AnalyzerResourceRef {
  name: string;
  kind?: string;
  capacity?: number;
  shared?: boolean;
  latencySensitive?: boolean;
  description?: string;
  participants: {
    automataIds: AutomataId[];
    deploymentIds: string[];
  };
}

export interface AnalyzerTimelineEvent {
  id: string;
  deploymentId: string;
  automataId?: AutomataId;
  deviceId?: DeviceId;
  timestamp: number;
  kind: string;
  name?: string;
  direction?: string;
  value?: unknown;
  fromState?: string;
  toState?: string;
  transitionId?: string;
  metadata?: Record<string, unknown>;
}

export interface AnalyzerSourceRefs {
  automataIds: AutomataId[];
  deploymentIds: string[];
  connectionIds: string[];
  resourceNames: string[];
}

export interface AnalyzerEvidenceEntry {
  type: string;
  deploymentId?: string;
  eventCount?: number;
}

export interface AnalyzerFinding {
  id: string;
  kind: AnalyzerFindingKind;
  severity: AnalyzerSeverity;
  confidence: AnalyzerConfidence;
  title: string;
  summary: string;
  resource?: AnalyzerResourceRef;
  connection?: AnalyzerBindingRef;
  sourceRefs: AnalyzerSourceRefs;
  metrics?: Record<string, number | string | boolean>;
  evidence: AnalyzerEvidenceEntry[];
}

export interface AnalyzerNode {
  id: string;
  kind: 'deployment' | 'automata' | 'resource' | 'binding';
  label: string;
  subtitle?: string;
  sourceRef?: {
    deploymentId?: string;
    automataId?: AutomataId;
    connectionId?: string;
    resourceName?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface AnalyzerEdge {
  id: string;
  source: string;
  target: string;
  kind: 'resource_link' | 'binding_out' | 'binding_in';
  severity: AnalyzerSeverity;
  metadata?: Record<string, unknown>;
}

export interface AnalyzerGraph {
  nodes: AnalyzerNode[];
  edges: AnalyzerEdge[];
}

export interface AnalyzerBundle {
  query: {
    scope: AnalyzerScope;
    deploymentIds: string[];
    automataIds: AutomataId[];
    afterTs?: number;
    beforeTs?: number;
    includeStructural: boolean;
    includeTimeline: boolean;
    limit: number;
  };
  generatedAt: number;
  evidenceMode: AnalyzerEvidenceMode;
  warnings: string[];
  automata: Array<Record<string, unknown>>;
  deployments: AnalyzerDeploymentRef[];
  connections: AnalyzerBindingRef[];
  resources: AnalyzerResourceRef[];
  timelines: Record<
    string,
    {
      deploymentId: string;
      automataId?: AutomataId;
      deviceId?: DeviceId;
      source?: string;
      backendError?: string;
      events: AnalyzerTimelineEvent[];
      snapshots?: Array<Record<string, unknown>>;
    }
  >;
  findings: AnalyzerFinding[];
  graph: AnalyzerGraph;
  summary: {
    findingCount: number;
    criticalCount: number;
    sharedResourceCount: number;
    observedFindingCount: number;
    structuralFindingCount: number;
    unknownEvidenceCount: number;
  };
  source?: string;
  backendError?: string;
}

export interface AnalyzerInspectorSelection {
  type: 'finding' | 'node' | 'edge';
  id: string;
}

import type { AutomataId, BlackBoxContract } from './automata';

export type PetriViewMode = 'overview' | 'expanded';

export type PetriNodeKind =
  | 'subnet_container'
  | 'state_place'
  | 'input_place'
  | 'output_place'
  | 'binding_place'
  | 'resource_place'
  | 'transition_fire'
  | 'transition_guard';

export interface PetriSourceRef {
  automataId?: AutomataId;
  stateId?: string;
  transitionId?: string;
  bindingId?: string;
  resourceName?: string;
  portName?: string;
}

export interface PetriOverlayMetadata {
  explicitBinding?: boolean;
  derivedBinding?: boolean;
  sourcePlacement?: string;
  targetPlacement?: string;
  sourceTransport?: string;
  targetTransport?: string;
  observedLatencyMs?: number;
  latencyBudgetMs?: number;
  latencyWarningMs?: number;
  latencyKnown: boolean;
  overlayConfidence: 'direct' | 'endpoint_derived' | 'unknown';
}

export interface PetriNode {
  id: string;
  kind: PetriNodeKind;
  label: string;
  subtitle?: string;
  groupId: string;
  source: PetriSourceRef;
  position: { x: number; y: number };
  metadata?: Record<string, unknown>;
}

export interface PetriEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  sourceRef?: PetriSourceRef;
  overlay?: PetriOverlayMetadata;
  metadata?: Record<string, unknown>;
}

export interface PetriGroup {
  id: string;
  label: string;
  automataIds: AutomataId[];
  bindingIds: string[];
  derivedBindingIds: string[];
  bindings: Array<{
    id: string;
    sourceAutomataId: AutomataId;
    targetAutomataId: AutomataId;
    sourceOutputName: string;
    targetInputName: string;
    explicit?: boolean;
    derived?: boolean;
  }>;
  sharedResources: Array<{
    name: string;
    kind: string;
    latencySensitive?: boolean;
    capacity?: number;
    declaredBy: AutomataId[];
    conflicts?: string[];
  }>;
  warnings: string[];
}

export interface PetriGraph {
  mode: PetriViewMode;
  groups: PetriGroup[];
  nodes: PetriNode[];
  edges: PetriEdge[];
  warnings: string[];
}

export interface PetriSelection {
  kind: 'node' | 'edge';
  id: string;
}

export interface PetriDeploymentContext {
  automataId: AutomataId;
  deviceId?: string;
  deploymentId?: string;
  currentState?: string;
  blackBox?: BlackBoxContract;
  placement?: string;
  transport?: string;
  connectorType?: string;
  observedLatencyMs?: number;
  latencyBudgetMs?: number;
  latencyWarningMs?: number;
  metadata?: Record<string, unknown>;
}

export interface PetriBindingDraftLike {
  id: string;
  sourceAutomataId: AutomataId;
  sourceOutputName: string;
  targetAutomataId: AutomataId;
  targetInputName: string;
  sourceType?: string;
  targetType?: string;
  enabled?: boolean;
  derived?: boolean;
  explicit?: boolean;
}

export interface PetriBuildOptions {
  mode: PetriViewMode;
  selectedGroupId?: string;
  expandedAutomataIds?: string[];
  includeDerivedBindings: boolean;
  explicitBindingsOnly: boolean;
  includeResources: boolean;
  hideNonSharedResources: boolean;
  showBindings: boolean;
  showTransport: boolean;
  showLatency: boolean;
  showLabels: boolean;
  hideUnknownOverlayFields: boolean;
}

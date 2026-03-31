import type { Device, ExecutionSnapshot } from '../types';
import type { PetriDeploymentContext, PetriOverlayMetadata } from '../types/petri';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function metadataFromSnapshot(snapshot?: ExecutionSnapshot | null): Record<string, unknown> | undefined {
  if (!snapshot?.deploymentMetadata) return undefined;
  return asRecord(snapshot.deploymentMetadata);
}

export function createDeploymentContext(args: {
  automataId: string;
  device?: Device;
  snapshot?: ExecutionSnapshot | null;
}): PetriDeploymentContext {
  const metadata = metadataFromSnapshot(args.snapshot);
  const latency = asRecord(metadata?.latency);
  const transport = asRecord(metadata?.transport);

  return {
    automataId: args.automataId,
    deviceId: args.snapshot?.deviceId ?? args.device?.id,
    placement: getString(metadata?.placement),
    transport:
      getString(transport?.type) ??
      args.device?.transport ??
      args.device?.connectorType,
    connectorType: args.device?.connectorType,
    observedLatencyMs: getNumber(latency?.observed_ms),
    latencyBudgetMs: getNumber(latency?.budget_ms),
    latencyWarningMs: getNumber(latency?.warning_ms),
    metadata,
    blackBox: args.snapshot?.blackBox,
    currentState: args.snapshot?.currentState ?? args.device?.currentState,
  };
}

export function createOverlayMetadata(
  source: PetriDeploymentContext | undefined,
  target: PetriDeploymentContext | undefined,
  options?: {
    explicitBinding?: boolean;
    derivedBinding?: boolean;
  },
): PetriOverlayMetadata {
  const observedLatencyMs =
    source?.observedLatencyMs ?? target?.observedLatencyMs;
  const latencyBudgetMs =
    source?.latencyBudgetMs ?? target?.latencyBudgetMs;
  const latencyWarningMs =
    source?.latencyWarningMs ?? target?.latencyWarningMs;

  const hasKnownMetadata = Boolean(
    source?.metadata ||
      target?.metadata ||
      source?.transport ||
      target?.transport ||
      observedLatencyMs !== undefined,
  );

  return {
    explicitBinding: options?.explicitBinding,
    derivedBinding: options?.derivedBinding,
    sourcePlacement: source?.placement,
    targetPlacement: target?.placement,
    sourceTransport: source?.transport,
    targetTransport: target?.transport,
    observedLatencyMs,
    latencyBudgetMs,
    latencyWarningMs,
    latencyKnown: observedLatencyMs !== undefined,
    overlayConfidence: hasKnownMetadata ? 'endpoint_derived' : 'unknown',
  };
}

export function formatOverlayLabel(
  overlay: PetriOverlayMetadata | undefined,
  options?: {
    showTransport?: boolean;
    showLatency?: boolean;
    hideUnknown?: boolean;
  },
): string | undefined {
  if (!overlay) return undefined;

  const parts: string[] = [];

  if (options?.showTransport) {
    const transportText =
      overlay.sourceTransport && overlay.targetTransport
        ? overlay.sourceTransport === overlay.targetTransport
          ? overlay.sourceTransport
          : `${overlay.sourceTransport} -> ${overlay.targetTransport}`
        : overlay.sourceTransport || overlay.targetTransport || (options.hideUnknown ? '' : 'transport unknown');
    if (transportText) parts.push(transportText);
  }

  if (options?.showLatency) {
    const latencyText =
      overlay.observedLatencyMs !== undefined
        ? `${Math.round(overlay.observedLatencyMs)} ms`
        : options?.hideUnknown
          ? ''
          : 'unknown RTT';
    if (latencyText) parts.push(latencyText);
  }

  return parts.length > 0 ? parts.join(' · ') : undefined;
}

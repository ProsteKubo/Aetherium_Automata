import { useEffect, useMemo, useRef } from 'react';
import type { FC } from 'react';
import { useExecutionStore, useGatewayStore, useLogStore, useRuntimeViewStore } from '../../stores';
import type { PersistedGatewayEvent } from '../../services/gateway/IGatewayService';

function isRunningLike(status: string): boolean {
  return status === 'running' || status === 'loading' || status === 'paused';
}

function cloneRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  try {
    if (typeof structuredClone === 'function') {
      return structuredClone(value as Record<string, unknown>);
    }
  } catch {
    // fall through
  }

  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function toEpochMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function toCursor(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function mapPersistedEventLevel(event: PersistedGatewayEvent): 'info' | 'warn' | 'error' | 'debug' {
  const kind = String(event.kind ?? '');
  const data = toObjectRecord(event.data);
  const status = String(data?.status ?? '').toUpperCase();

  if (status === 'ERROR') return 'error';
  if (status === 'NAK') return 'warn';
  if (kind.includes('error')) return 'error';
  if (kind.includes('dispatch') || kind.includes('gateway_command')) return 'debug';
  return 'info';
}

function mapPersistedEventMessage(event: PersistedGatewayEvent): string {
  const kind = String(event.kind ?? 'event');
  const data = toObjectRecord(event.data);
  const commandType = String(data?.command_type ?? data?.event ?? '').trim();
  const status = String(data?.status ?? '').trim();
  const reason = String(data?.reason ?? '').trim();

  if (kind === 'server_command_outcome') {
    return `${commandType || 'command'} ${status || 'outcome'}${reason ? ` (${reason})` : ''}`;
  }

  if (kind === 'gateway_command') {
    return `${commandType || 'gateway command'}${status ? ` ${status}` : ''}${reason ? ` (${reason})` : ''}`;
  }

  if (kind === 'dispatch_command') {
    return `dispatch ${commandType || 'command'}${reason ? ` (${reason})` : ''}`;
  }

  return `${kind}${reason ? ` (${reason})` : ''}`;
}

export const GatewayEventBridge: FC = () => {
  const service = useGatewayStore((state) => state.service);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const devicesMap = useGatewayStore((state) => state.devices);
  const updateSnapshot = useExecutionStore((state) => state.updateSnapshot);
  const applyDeploymentStatus = useExecutionStore((state) => state.applyDeploymentStatus);
  const ingestTransition = useRuntimeViewStore((state) => state.ingestTransition);
  const ingestDeploymentStatus = useRuntimeViewStore((state) => state.ingestDeploymentStatus);
  const ingestDeploymentTransfer = useRuntimeViewStore((state) => state.ingestDeploymentTransfer);
  const seedFromDevices = useRuntimeViewStore((state) => state.seedFromDevices);
  const addLog = useLogStore((state) => state.addLog);
  const previousStatusRef = useRef<string>('disconnected');
  const eventCursorRef = useRef<number>(0);
  const devices = useMemo(
    () =>
      Array.from(devicesMap.values()).map((device) => ({
        id: String(device.id),
        status: String(device.status ?? 'unknown'),
        assignedAutomataId: device.assignedAutomataId ? String(device.assignedAutomataId) : undefined,
        currentState: device.currentState ? String(device.currentState) : undefined,
      })),
    [devicesMap],
  );

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      service.on('onExecutionTransition', (event) => {
        const automataId = String(event.automataId ?? '');
        const deviceId = String(event.deviceId ?? '');
        if (!automataId || !deviceId) return;

        const deploymentId = `${automataId}:${deviceId}`;
        ingestTransition({
          deploymentId,
          automataId: automataId as any,
          deviceId: deviceId as any,
          fromState: String(event.fromState ?? ''),
          toState: String(event.toState ?? ''),
          transitionId: event.transitionId ? String(event.transitionId) : undefined,
          timestamp: Number.isFinite(Number(event.timestamp)) ? Number(event.timestamp) : Date.now(),
          variables: cloneRecord(event.variables),
        });
      }),
    );

    unsubs.push(
      service.on('onExecutionSnapshot', (event) => {
        updateSnapshot(event.deviceId, event.snapshot);
      }),
    );

    unsubs.push(
      service.on('onDeploymentStatus', (event) => {
        ingestDeploymentStatus({
          ...event,
          variables: cloneRecord((event as Record<string, unknown>).variables),
        });
        const deviceId = (event.device_id ?? event.deviceId) as any;
        if (deviceId) {
          const automataId = (event.automata_id ?? event.automataId) as any;
          applyDeploymentStatus(deviceId, String(event.status ?? ''), automataId ?? null);
        }
      }),
    );

    unsubs.push(
      service.on('onDeploymentList', (event) => {
        event.deployments.forEach((deployment) => {
          ingestDeploymentStatus({
            ...deployment,
            variables: cloneRecord((deployment as Record<string, unknown>).variables),
          });
        });
      }),
    );

    unsubs.push(
      service.on('onConnectionList', (event) => {
        addLog({
          level: 'debug',
          source: 'Gateway.Runtime',
          message: `Connection list updated (${event.connections.length})`,
        });
      }),
    );

    unsubs.push(
      service.on('onDeploymentTransfer', (event) => {
        ingestDeploymentTransfer(event as Record<string, unknown>);

        const deploymentId = String(event.deployment_id ?? event.deploymentId ?? 'unknown');
        const stage = String(event.stage ?? 'unknown');
        const chunkIndex = Number(event.chunk_index ?? event.chunkIndex ?? 0);
        const totalChunks = Number(event.total_chunks ?? 0);
        const retryCount = Number(event.retry_count ?? event.retryCount ?? 0);
        const maxRetries = Number(event.max_retries ?? event.maxRetries ?? 0);

        const level = stage === 'failed' ? 'error' : stage.includes('retry') ? 'warn' : 'debug';
        const chunkLabel =
          Number.isFinite(totalChunks) && totalChunks > 0
            ? ` chunk ${chunkIndex + 1}/${totalChunks}`
            : '';
        const retryLabel = maxRetries > 0 ? ` retry ${retryCount}/${maxRetries}` : '';

        addLog({
          level,
          source: `Deploy.${deploymentId}`,
          message: `transfer ${stage}${chunkLabel}${retryLabel}${event.error ? ` (${event.error})` : ''}`,
        });
      }),
    );

    unsubs.push(
      service.on('onDeviceLog', (event) => {
        const ts =
          typeof event.timestamp === 'number'
            ? event.timestamp
            : typeof event.timestamp === 'string'
              ? Date.parse(event.timestamp)
              : Date.now();

        addLog({
          timestamp: Number.isNaN(ts) ? Date.now() : ts,
          level:
            event.level === 'error'
              ? 'error'
              : event.level === 'warning'
                ? 'warn'
                : event.level === 'debug'
                  ? 'debug'
                  : event.level === 'trace'
                    ? 'trace'
                    : 'info',
          source: event.device_id ? `Device.${event.device_id}` : 'Device',
          message: event.message || '',
        });
      }),
    );

    unsubs.push(
      service.on('onCommandOutcome', (event) => {
        if (event.status === 'NAK' || event.status === 'ERROR') {
          addLog({
            level: event.status === 'ERROR' ? 'error' : 'warn',
            source: 'Gateway.Command',
            message: `${event.command_type || 'command'} ${event.status}: ${event.reason || 'unknown_reason'}`,
          });
        }
      }),
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [
    addLog,
    applyDeploymentStatus,
    ingestDeploymentStatus,
    ingestDeploymentTransfer,
    ingestTransition,
    service,
    updateSnapshot,
  ]);

  useEffect(() => {
    seedFromDevices(devices);
  }, [devices, seedFromDevices]);

  useEffect(() => {
    const previous = previousStatusRef.current;
    previousStatusRef.current = gatewayStatus;

    if (!(previous !== 'connected' && gatewayStatus === 'connected')) {
      return;
    }

    const runtimeState = useRuntimeViewStore.getState();
    runtimeState.selectedDeploymentIds.forEach((deploymentId) => {
      const deployment = runtimeState.deployments.get(deploymentId);
      if (!deployment || !isRunningLike(deployment.status)) return;

      service
        .getSnapshot(deployment.deviceId)
        .then((snapshot) => updateSnapshot(deployment.deviceId, snapshot.snapshot))
        .catch(() => {
          // Snapshot is best-effort on reconnect.
        });
    });
  }, [gatewayStatus, service, updateSnapshot]);

  useEffect(() => {
    if (gatewayStatus !== 'connected') return;

    let cancelled = false;
    let pollHandle: ReturnType<typeof setInterval> | undefined;

    const ingestPersistedEvents = (events: PersistedGatewayEvent[]) => {
      if (!Array.isArray(events) || events.length === 0) return;

      events.forEach((event) => {
        const cursor = toCursor(event.cursor);
        if (cursor !== undefined && cursor <= eventCursorRef.current) {
          return;
        }

        addLog({
          id: cursor !== undefined ? `gw-event-${cursor}` : undefined,
          timestamp: toEpochMs(event.timestamp),
          level: mapPersistedEventLevel(event),
          source: String(event.source ?? 'Gateway.History'),
          message: mapPersistedEventMessage(event),
          data: toObjectRecord(event.data),
        });

        if (cursor !== undefined) {
          eventCursorRef.current = Math.max(eventCursorRef.current, cursor);
        }
      });
    };

    const pollNewEvents = async () => {
      try {
        const events = await service.listEvents(eventCursorRef.current, 200);
        if (!cancelled) {
          ingestPersistedEvents(events);
        }
      } catch {
        // Polling is best-effort and should not interrupt runtime bridge.
      }
    };

    (async () => {
      try {
        const recent = await service.listRecentEvents(120);
        if (!cancelled) {
          ingestPersistedEvents(recent);
        }
      } catch {
        // Backfill is optional.
      }

      if (!cancelled) {
        pollHandle = setInterval(pollNewEvents, 3000);
      }
    })();

    return () => {
      cancelled = true;
      if (pollHandle) {
        clearInterval(pollHandle);
      }
    };
  }, [addLog, gatewayStatus, service]);

  return null;
};

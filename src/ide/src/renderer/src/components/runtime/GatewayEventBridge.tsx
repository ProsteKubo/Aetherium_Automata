import { useEffect, useMemo, useRef } from 'react';
import type { FC } from 'react';
import { useExecutionStore, useGatewayStore, useLogStore, useRuntimeViewStore } from '../../stores';

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

export const GatewayEventBridge: FC = () => {
  const service = useGatewayStore((state) => state.service);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const devicesMap = useGatewayStore((state) => state.devices);
  const updateSnapshot = useExecutionStore((state) => state.updateSnapshot);
  const applyDeploymentStatus = useExecutionStore((state) => state.applyDeploymentStatus);
  const ingestTransition = useRuntimeViewStore((state) => state.ingestTransition);
  const ingestDeploymentStatus = useRuntimeViewStore((state) => state.ingestDeploymentStatus);
  const seedFromDevices = useRuntimeViewStore((state) => state.seedFromDevices);
  const addLog = useLogStore((state) => state.addLog);
  const previousStatusRef = useRef<string>('disconnected');
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
  }, [addLog, applyDeploymentStatus, ingestDeploymentStatus, ingestTransition, service, updateSnapshot]);

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

  return null;
};

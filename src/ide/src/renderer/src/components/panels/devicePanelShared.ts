import type { Device } from '../../types';
import type { RuntimeDeployment, RuntimeDeploymentTransfer } from '../../types/runtimeView';

export interface ShowcaseAutomataEntry {
  id: string;
  name: string;
  category: string;
  relativePath: string;
}

export interface DeviceDeploymentView {
  deploymentId: string;
  automataId: string;
  deviceId: string;
  status: RuntimeDeployment['status'];
  currentState?: string;
  updatedAt: number;
  source: 'runtime' | 'device';
}

export function isDeviceReachable(status: string): boolean {
  return status === 'online' || status === 'connected';
}

export function deploymentStatusRank(status: DeviceDeploymentView['status']): number {
  switch (status) {
    case 'running':
      return 6;
    case 'loading':
      return 5;
    case 'paused':
      return 4;
    case 'stopped':
      return 3;
    case 'error':
      return 2;
    case 'offline':
      return 1;
    default:
      return 0;
  }
}

export function runtimeStatusToLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export function isRunningLike(status: string): boolean {
  return status === 'running' || status === 'loading' || status === 'paused';
}

export function supportsMultipleDeployments(device?: Device | null): boolean {
  if (!device) return false;
  return device.connectorType === 'host_runtime' || device.transport === 'host_runtime';
}

export function humanizeTransferStage(stage: string): string {
  return stage
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function transferForDevice(
  device: Device,
  transfers: Map<string, RuntimeDeploymentTransfer>,
  deployment?: DeviceDeploymentView | null,
): RuntimeDeploymentTransfer | undefined {
  if (deployment && transfers.has(deployment.deploymentId)) {
    return transfers.get(deployment.deploymentId);
  }

  return Array.from(transfers.values())
    .filter((transfer) => transfer.deviceId === (device.id as RuntimeDeploymentTransfer['deviceId']))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

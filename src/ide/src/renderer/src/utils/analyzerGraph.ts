import type { Edge, Node } from 'reactflow';
import { MarkerType, Position } from 'reactflow';
import type { AnalyzerBundle } from '../types';

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'var(--color-error, #ef4444)';
    case 'warning':
      return 'var(--color-warning, #f59e0b)';
    default:
      return 'var(--color-border-strong, #475569)';
  }
}

function nodeColumn(kind: string): number {
  switch (kind) {
    case 'deployment':
    case 'automata':
      return 0;
    case 'binding':
      return 1;
    case 'resource':
      return 2;
    default:
      return 0;
  }
}

function nodeColors(kind: string): { background: string; border: string } {
  switch (kind) {
    case 'resource':
      return { background: 'rgba(120, 53, 15, 0.85)', border: '#f59e0b' };
    case 'binding':
      return { background: 'rgba(8, 47, 73, 0.85)', border: '#38bdf8' };
    case 'deployment':
      return { background: 'rgba(15, 23, 42, 0.9)', border: '#60a5fa' };
    default:
      return { background: 'rgba(15, 23, 42, 0.9)', border: '#64748b' };
  }
}

export function buildAnalyzerFlow(
  bundle: AnalyzerBundle,
  selectedFindingId: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const highlightedRefs = (() => {
    const selectedFinding = bundle.findings.find((finding) => finding.id === selectedFindingId);
    return {
      deploymentIds: new Set(selectedFinding?.sourceRefs.deploymentIds ?? []),
      automataIds: new Set(selectedFinding?.sourceRefs.automataIds ?? []),
      connectionIds: new Set(selectedFinding?.sourceRefs.connectionIds ?? []),
      resourceNames: new Set(selectedFinding?.sourceRefs.resourceNames ?? []),
    };
  })();

  const perColumnIndex = new Map<number, number>();

  const nodes: Node[] = bundle.graph.nodes.map((node) => {
    const column = nodeColumn(node.kind);
    const row = perColumnIndex.get(column) ?? 0;
    perColumnIndex.set(column, row + 1);

    const colors = nodeColors(node.kind);
    const highlighted =
      (node.sourceRef?.deploymentId && highlightedRefs.deploymentIds.has(node.sourceRef.deploymentId)) ||
      (node.sourceRef?.automataId && highlightedRefs.automataIds.has(node.sourceRef.automataId)) ||
      (node.sourceRef?.connectionId && highlightedRefs.connectionIds.has(node.sourceRef.connectionId)) ||
      (node.sourceRef?.resourceName && highlightedRefs.resourceNames.has(node.sourceRef.resourceName));

    return {
      id: node.id,
      type: 'default',
      position: { x: column * 340, y: row * 130 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: `${node.label}${node.subtitle ? `\n${node.subtitle}` : ''}`,
      },
      style: {
        width: node.kind === 'binding' ? 220 : 240,
        whiteSpace: 'pre-line',
        borderRadius: 16,
        padding: 12,
        color: '#e2e8f0',
        background: colors.background,
        border: `2px solid ${highlighted ? '#f8fafc' : colors.border}`,
        boxShadow: highlighted ? '0 0 0 3px rgba(248, 250, 252, 0.2)' : 'none',
      },
    };
  });

  const edges: Edge[] = bundle.graph.edges.map((edge) => {
    const highlighted =
      highlightedRefs.connectionIds.has(edge.id.replace(/^binding:/, '')) ||
      bundle.findings.some(
        (finding) =>
          finding.id === selectedFindingId &&
          finding.sourceRefs.connectionIds.some((connectionId) => edge.id.includes(connectionId)),
      );

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      animated: edge.severity === 'critical',
      markerEnd: { type: MarkerType.ArrowClosed, color: severityColor(edge.severity) },
      style: {
        stroke: severityColor(edge.severity),
        strokeWidth: highlighted ? 3 : 2,
        opacity: highlighted || !selectedFindingId ? 1 : 0.45,
      },
    };
  });

  return { nodes, edges };
}

import type { AnalyzerConfidence, AnalyzerFinding, AnalyzerSeverity } from '../types';

export function analyzerSeverityRank(severity: AnalyzerSeverity): number {
  switch (severity) {
    case 'critical':
      return 3;
    case 'warning':
      return 2;
    default:
      return 1;
  }
}

export function findingMatchesFilters(
  finding: AnalyzerFinding,
  search: string,
  severity: AnalyzerSeverity | 'all',
  confidence: AnalyzerConfidence | 'all',
  observedOnly: boolean,
): boolean {
  if (severity !== 'all' && finding.severity !== severity) {
    return false;
  }

  if (confidence !== 'all' && finding.confidence !== confidence) {
    return false;
  }

  if (observedOnly && finding.confidence !== 'observed' && finding.confidence !== 'mixed') {
    return false;
  }

  if (!search.trim()) {
    return true;
  }

  const haystack = [
    finding.title,
    finding.summary,
    finding.resource?.name,
    finding.connection?.sourceOutput,
    finding.connection?.targetInput,
    ...finding.sourceRefs.automataIds,
    ...finding.sourceRefs.deploymentIds,
    ...finding.sourceRefs.resourceNames,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(search.trim().toLowerCase());
}

export function formatAnalyzerWarning(warning: string): string {
  switch (warning) {
    case 'timeline_unavailable_for_selected_scope':
      return 'Timeline evidence is unavailable for the selected scope.';
    case 'remote_deployments_not_replayed':
      return 'Some deployments are remote to the selected server and remain structural only.';
    case 'deployment_scope_without_selection':
      return 'No deployment is selected, so the analyzer fell back to project scope.';
    case 'group_scope_without_selection':
      return 'No automata or deployment selection was available, so the analyzer fell back to project scope.';
    default:
      return warning.replaceAll('_', ' ');
  }
}

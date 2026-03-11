import type { Automata, VariableDefinition, VariableType } from '../types';
import type { AutomataBinding } from '../types/connections';
import type { ConnectionDraft } from '../services/gateway';

interface AutomataPort {
  id: string;
  name: string;
  type: VariableType;
}

function bindingTypeCompatible(source: VariableType, target: VariableType): boolean {
  return source === target || source === 'any' || target === 'any';
}

function getVariableDefinitions(automata: Automata): VariableDefinition[] {
  return Array.isArray(automata.variables) ? automata.variables : [];
}

function dedupePorts(ports: AutomataPort[]): AutomataPort[] {
  const seen = new Map<string, AutomataPort>();

  ports.forEach((port) => {
    if (!seen.has(port.name)) {
      seen.set(port.name, port);
    }
  });

  return Array.from(seen.values());
}

export function getAutomataPorts(
  automata: Automata,
  direction: 'input' | 'output',
): AutomataPort[] {
  const variables = getVariableDefinitions(automata);
  const fromVariables = variables
    .filter((entry) => entry.direction === direction)
    .map((entry) => ({
      id: entry.id ?? entry.name,
      name: entry.name,
      type: entry.type ?? 'any',
    }));

  const namesFromSurface =
    direction === 'input'
      ? Array.isArray(automata.inputs)
        ? automata.inputs
        : []
      : Array.isArray(automata.outputs)
        ? automata.outputs
        : [];

  const fromSurface = namesFromSurface.map((name) => {
    const matchingVariable = variables.find(
      (entry) => entry.name === name && entry.direction === direction,
    );

    return {
      id: matchingVariable?.id ?? name,
      name,
      type: matchingVariable?.type ?? 'any',
    };
  });

  return dedupePorts([...fromVariables, ...fromSurface]);
}

export function bindingIdentity(
  binding:
    | Pick<AutomataBinding, 'sourceAutomataId' | 'sourceOutputName' | 'targetAutomataId' | 'targetInputName'>
    | Pick<ConnectionDraft, 'sourceAutomataId' | 'sourceOutputName' | 'targetAutomataId' | 'targetInputName'>,
): string {
  return [
    binding.sourceAutomataId,
    binding.sourceOutputName,
    binding.targetAutomataId,
    binding.targetInputName,
  ].join('::');
}

export function deriveCompatibleBindingDrafts(
  automataList: Automata[],
  existingBindings: Array<
    Pick<AutomataBinding, 'sourceAutomataId' | 'sourceOutputName' | 'targetAutomataId' | 'targetInputName'>
  > = [],
): ConnectionDraft[] {
  const existing = new Set(existingBindings.map((binding) => bindingIdentity(binding)));
  const drafts: ConnectionDraft[] = [];

  automataList.forEach((sourceAutomata) => {
    const sourceOutputs = getAutomataPorts(sourceAutomata, 'output');
    if (sourceOutputs.length === 0) {
      return;
    }

    automataList.forEach((targetAutomata) => {
      if (targetAutomata.id === sourceAutomata.id) {
        return;
      }

      const targetInputs = getAutomataPorts(targetAutomata, 'input');
      if (targetInputs.length === 0) {
        return;
      }

      sourceOutputs.forEach((sourceOutput) => {
        targetInputs
          .filter((targetInput) => targetInput.name === sourceOutput.name)
          .forEach((targetInput) => {
            if (!bindingTypeCompatible(sourceOutput.type, targetInput.type)) {
              return;
            }

            const key = bindingIdentity({
              sourceAutomataId: sourceAutomata.id,
              sourceOutputName: sourceOutput.name,
              targetAutomataId: targetAutomata.id,
              targetInputName: targetInput.name,
            });

            if (existing.has(key)) {
              return;
            }

            existing.add(key);
            drafts.push({
              sourceAutomataId: sourceAutomata.id,
              sourceOutputId: sourceOutput.id,
              sourceOutputName: sourceOutput.name,
              targetAutomataId: targetAutomata.id,
              targetInputId: targetInput.id,
              targetInputName: targetInput.name,
              sourceType: sourceOutput.type,
              targetType: targetInput.type,
              enabled: true,
            });
          });
      });
    });
  });

  return drafts;
}

import type { Automata } from '../types';
import type { PetriNode } from '../types/petri';

const GROUP_GAP_X = 1360;
const GROUP_GAP_Y = 980;

export function groupOrigin(groupIndex: number): { x: number; y: number } {
  const column = groupIndex % 2;
  const row = Math.floor(groupIndex / 2);
  return {
    x: column * GROUP_GAP_X,
    y: row * GROUP_GAP_Y,
  };
}

export function automataSlotOrigin(index: number, base: { x: number; y: number }): { x: number; y: number } {
  const column = index % 2;
  const row = Math.floor(index / 2);
  return {
    x: base.x + column * 620,
    y: base.y + row * 420,
  };
}

export function interfacePlacePosition(
  base: { x: number; y: number },
  lane: 'input' | 'output' | 'resource',
  index: number,
): { x: number; y: number } {
  if (lane === 'input') {
    return { x: base.x - 90, y: base.y + 50 + index * 48 };
  }

  if (lane === 'output') {
    return { x: base.x + 280, y: base.y + 50 + index * 48 };
  }

  return { x: base.x + 40 + index * 90, y: base.y + 210 };
}

export function statePlacePosition(
  stateIndex: number,
  base: { x: number; y: number },
): { x: number; y: number } {
  const column = stateIndex % 3;
  const row = Math.floor(stateIndex / 3);
  return {
    x: base.x + column * 180,
    y: base.y + row * 150,
  };
}

export function transitionPosition(
  fromIndex: number,
  toIndex: number,
  stateMap: Map<number, { x: number; y: number }>,
  fallback: { x: number; y: number },
  sequence: number,
): { x: number; y: number } {
  const from = stateMap.get(fromIndex);
  const to = stateMap.get(toIndex);

  if (from && to) {
    return {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2 + ((sequence % 3) - 1) * 18,
    };
  }

  return {
    x: fallback.x + 120,
    y: fallback.y + 80 + sequence * 32,
  };
}

export function nestedSubnetPosition(
  statePosition: { x: number; y: number },
  index: number,
): { x: number; y: number } {
  return {
    x: statePosition.x + 90,
    y: statePosition.y - 55 - index * 24,
  };
}

export function inferAutomataSort(automata: Automata[]): Automata[] {
  return [...automata].sort((left, right) => left.config.name.localeCompare(right.config.name));
}

export function sortNodes(nodes: PetriNode[]): PetriNode[] {
  return [...nodes].sort((left, right) => {
    if (left.position.y !== right.position.y) return left.position.y - right.position.y;
    if (left.position.x !== right.position.x) return left.position.x - right.position.x;
    return left.label.localeCompare(right.label);
  });
}

/**
 * Aetherium Automata - Stores Index
 */

export * from './gatewayStore';
export * from './automataStore';
export * from './uiStore';
export * from './executionStore';
export * from './projectStore';
export { useLogStore } from './logStore';

// Set up cross-store references to avoid circular dependencies
import { useAutomataStore, setProjectStoreGetter } from './automataStore';
import { useProjectStore, setAutomataStoreGetter } from './projectStore';

setAutomataStoreGetter(() => useAutomataStore.getState());
setProjectStoreGetter(() => useProjectStore.getState());

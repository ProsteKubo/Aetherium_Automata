/**
 * Aetherium Automata - Automata Store
 * 
 * Manages automata definitions and editing state.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuid } from 'uuid';
import type {
  Automata,
  AutomataId,
  State,
  StateId,
  Transition,
  TransitionId,
  VariableSpec,
} from '../types';
import { MockGatewayService } from '../services/gateway';

// Lazy getter to avoid circular dependency
let projectStoreGetter: (() => any) | null = null;
export const setProjectStoreGetter = (getter: () => any) => {
  projectStoreGetter = getter;
};

// ============================================================================
// State Types
// ============================================================================

interface AutomataState {
  // Automata collection
  automata: Map<AutomataId, Automata>;
  
  // Currently active automata in editor
  activeAutomataId: AutomataId | null;
  
  // Selection state
  selectedStateIds: StateId[];
  selectedTransitionIds: TransitionId[];
  
  // Clipboard
  clipboard: {
    states: State[];
    transitions: Transition[];
  } | null;
  
  // History for undo/redo
  history: {
    past: Automata[];
    future: Automata[];
  };
  
  // Loading states
  isLoading: boolean;
  isSaving: boolean;
}

interface AutomataActions {
  // CRUD operations
  fetchAutomata: () => Promise<void>;
  loadAutomata: (automataId: AutomataId) => Promise<void>;
  createAutomata: (name: string, description?: string, parentId?: AutomataId) => Promise<Automata>;
  saveAutomata: (automataId: AutomataId) => Promise<void>;
  deleteAutomata: (automataId: AutomataId) => Promise<void>;
  
  // Active automata
  setActiveAutomata: (automataId: AutomataId | null) => void;
  
  // Automata-level I/O
  updateAutomataIO: (automataId: AutomataId, updates: { inputs?: string[]; outputs?: string[]; variables?: VariableSpec[] }) => void;
  
  // Probabilistic normalization
  normalizeProbabilities: (sourceStateId: StateId) => void;
  
  // State operations
  addState: (state: Omit<State, 'id'>) => StateId;
  updateState: (stateId: StateId, updates: Partial<State>) => void;
  deleteState: (stateId: StateId) => void;
  
  // Transition operations
  addTransition: (transition: Omit<Transition, 'id'>) => TransitionId;
  updateTransition: (transitionId: TransitionId, updates: Partial<Transition>) => void;
  deleteTransition: (transitionId: TransitionId) => void;
  
  // Selection
  selectState: (stateId: StateId, multi?: boolean) => void;
  selectTransition: (transitionId: TransitionId, multi?: boolean) => void;
  setSelectedStates: (stateIds: StateId[]) => void;
  setSelectedTransitions: (transitionIds: TransitionId[]) => void;
  clearSelection: () => void;
  selectAll: () => void;
  
  // Clipboard
  copy: () => void;
  cut: () => void;
  paste: (offset?: { x: number; y: number }) => void;
  
  // History
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
  
  // Utility
  markDirty: (automataId: AutomataId) => void;
  setAutomataMap: (automataMap: Map<AutomataId, Automata>) => void;
  reset: () => void;
}

type AutomataStore = AutomataState & AutomataActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: AutomataState = {
  automata: new Map(),
  activeAutomataId: null,
  selectedStateIds: [],
  selectedTransitionIds: [],
  clipboard: null,
  history: {
    past: [],
    future: [],
  },
  isLoading: false,
  isSaving: false,
};

// ============================================================================
// Store
// ============================================================================

export const useAutomataStore = create<AutomataStore>()(
  immer((set, get) => ({
    ...initialState,
    
    // ========================================================================
    // CRUD Operations
    // ========================================================================
    
    fetchAutomata: async () => {
      // Use MockGatewayService for automata operations since backend doesn't support it yet
      const mockService = new MockGatewayService();
      
      set((state) => {
        state.isLoading = true;
      });
      
      try {
        const response = await mockService.listAutomata();
        
        // Load each automata in detail
        for (const item of response.automata) {
          const fullResponse = await mockService.getAutomata(item.id);
          set((state) => {
            state.automata.set(item.id, fullResponse.automata);
          });
        }
        
        set((state) => {
          state.isLoading = false;
        });
      } catch (error) {
        set((state) => {
          state.isLoading = false;
        });
        throw error;
      }
    },
    
    loadAutomata: async (automataId: AutomataId) => {
      // Use MockGatewayService for automata operations since backend doesn't support it yet
      const mockService = new MockGatewayService();
      
      set((state) => {
        state.isLoading = true;
      });
      
      try {
        const response = await mockService.getAutomata(automataId);
        
        set((state) => {
          state.automata.set(automataId, response.automata);
          state.isLoading = false;
        });
      } catch (error) {
        set((state) => {
          state.isLoading = false;
        });
        throw error;
      }
    },
    
    createAutomata: async (name: string, description?: string, parentId?: AutomataId) => {
      const newAutomata: Omit<Automata, 'id'> = {
        version: '0.0.1',
        config: {
          name,
          type: 'inline',
          language: 'lua',
          description,
          tags: [],
          version: '1.0.0',
          created: Date.now(),
          modified: Date.now(),
        },
        initialState: 'Initial',
        states: {
          Initial: {
            id: 'Initial',
            name: 'Initial',
            inputs: [],
            outputs: [],
            variables: [],
            code: '-- Initial state code\n',
            hooks: {},
            isComposite: false,
            position: { x: 250, y: 150 },
          },
        },
        transitions: {},
        // Automata-level I/O for inter-automata communication
        inputs: [],
        outputs: [],
        // Nested automata support
        parentAutomataId: parentId,
        nestedAutomataIds: [],
      };
      
      // Use MockGatewayService for automata operations since backend doesn't support it yet
      const mockService = new MockGatewayService();
      const created = await mockService.createAutomata(newAutomata);
      
      set((state) => {
        state.automata.set(created.id, created);
        
        // If this is a nested automata, update parent's nestedAutomataIds
        if (parentId) {
          const parent = state.automata.get(parentId);
          if (parent) {
            if (!parent.nestedAutomataIds) {
              parent.nestedAutomataIds = [];
            }
            parent.nestedAutomataIds.push(created.id);
          }
        }
      });
      
      return created;
    },
    
    // Update automata-level I/O
    updateAutomataIO: (automataId: AutomataId, updates: { inputs?: string[]; outputs?: string[]; variables?: VariableSpec[] }) => {
      set((state) => {
        const automata = state.automata.get(automataId);
        if (!automata) return;
        
        if (updates.inputs !== undefined) {
          automata.inputs = updates.inputs;
        }
        if (updates.outputs !== undefined) {
          automata.outputs = updates.outputs;
        }
        automata.isDirty = true;
      });
    },
    
    // Normalize probabilities so they sum to 100%
    normalizeProbabilities: (sourceStateId: StateId) => {
      set((state) => {
        const automata = state.activeAutomataId ? state.automata.get(state.activeAutomataId) : null;
        if (!automata) return;
        
        // Find all transitions from this state
        const transitions = Object.values(automata.transitions).filter(
          (t) => t.from === sourceStateId
        );
        
        if (transitions.length === 0) return;
        
        // Calculate total weight
        const totalWeight = transitions.reduce((sum, t) => sum + (t.weight || 1), 0);
        
        // Normalize each transition's weight to sum to 1
        transitions.forEach((t) => {
          const currentWeight = t.weight || 1;
          const normalizedWeight = currentWeight / totalWeight;
          automata.transitions[t.id].weight = normalizedWeight;
        });
        
        automata.isDirty = true;
      });
    },
    
    saveAutomata: async (automataId: AutomataId) => {
      const automata = get().automata.get(automataId);
      
      if (!automata) return;
      
      set((state) => {
        state.isSaving = true;
      });
      
      try {
        // Use MockGatewayService for automata operations since backend doesn't support it yet
        const mockService = new MockGatewayService();
        await mockService.updateAutomata(automataId, automata);
        
        set((state) => {
          const a = state.automata.get(automataId);
          if (a) {
            a.isDirty = false;
          }
          state.isSaving = false;
        });
      } catch (error) {
        set((state) => {
          state.isSaving = false;
        });
        throw error;
      }
    },
    
    deleteAutomata: async (automataId: AutomataId) => {
      // Use MockGatewayService for automata operations since backend doesn't support it yet
      const mockService = new MockGatewayService();
      await mockService.deleteAutomata(automataId);
      
      set((state) => {
        state.automata.delete(automataId);
        if (state.activeAutomataId === automataId) {
          state.activeAutomataId = null;
        }
      });
    },
    
    // ========================================================================
    // Active Automata
    // ========================================================================
    
    setActiveAutomata: (automataId: AutomataId | null) => {
      set((state) => {
        state.activeAutomataId = automataId;
        state.selectedStateIds = [];
        state.selectedTransitionIds = [];
        state.history = { past: [], future: [] };
      });
    },
    
    // ========================================================================
    // State Operations
    // ========================================================================
    
    addState: (stateData: Omit<State, 'id'>) => {
      const { activeAutomataId } = get();
      if (!activeAutomataId) throw new Error('No active automata');
      
      const stateId = `State_${uuid().slice(0, 8)}`;
      
      get().pushHistory();
      
      set((state) => {
        const automata = state.automata.get(activeAutomataId);
        if (automata) {
          automata.states[stateId] = {
            ...stateData,
            id: stateId,
          };
          automata.isDirty = true;
        }
      });
      
      // Mark project as dirty
      if (projectStoreGetter) {
        try {
          projectStoreGetter().markDirty();
        } catch (err) {
          console.warn('[AutomataStore] Failed to mark project dirty:', err);
        }
      }
      
      return stateId;
    },
    
    updateState: (stateId: StateId, updates: Partial<State>) => {
      const { activeAutomataId } = get();
      if (!activeAutomataId) return;
      
      get().pushHistory();
      
      set((state) => {
        const automata = state.automata.get(activeAutomataId);
        if (automata && automata.states[stateId]) {
          Object.assign(automata.states[stateId], updates);
          automata.isDirty = true;
        }
      });
      
      // Mark project as dirty
      try {
        // Use projectStoreGetter
        projectStoreGetter()?.markDirty();
      } catch {
        // Project store might not be available
      }
    },
    
    deleteState: (stateId: StateId) => {
      const { activeAutomataId } = get();
      if (!activeAutomataId) return;
      
      get().pushHistory();
      
      set((state) => {
        const automata = state.automata.get(activeAutomataId);
        if (automata) {
          // Delete the state
          delete automata.states[stateId];
          
          // Delete transitions connected to this state
          Object.keys(automata.transitions).forEach((transitionId) => {
            const transition = automata.transitions[transitionId];
            if (transition.from === stateId || transition.to === stateId) {
              delete automata.transitions[transitionId];
            }
          });
          
          // Update initial state if needed
          if (automata.initialState === stateId) {
            const remainingStates = Object.keys(automata.states);
            automata.initialState = remainingStates[0] || '';
      
      // Mark project as dirty
      try {
        // Use projectStoreGetter
        projectStoreGetter()?.markDirty();
      } catch {
        // Project store might not be available
      }
          }
          
          automata.isDirty = true;
          
          // Clear from selection
          state.selectedStateIds = state.selectedStateIds.filter((id) => id !== stateId);
        }
      });
    },
    
    // ========================================================================
    // Transition Operations
    // ========================================================================
    
    addTransition: (transitionData: Omit<Transition, 'id'>) => {
      const { activeAutomataId } = get();
      if (!activeAutomataId) throw new Error('No active automata');
      
      const transitionId = `t_${uuid().slice(0, 8)}`;
      
      get().pushHistory();
      
      set((state) => {
        const automata = state.automata.get(activeAutomataId);
        if (automata) {
      // Mark project as dirty
      try {
        // Use projectStoreGetter
        projectStoreGetter()?.markDirty();
      } catch {
        // Project store might not be available
      }
      
          automata.transitions[transitionId] = {
            ...transitionData,
            id: transitionId,
          };
          automata.isDirty = true;
        }
      });
      
      return transitionId;
    },
    
    updateTransition: (transitionId: TransitionId, updates: Partial<Transition>) => {
      const { activeAutomataId } = get();
      if (!activeAutomataId) return;
      
      get().pushHistory();
      
      set((state) => {
        const automata = state.automata.get(activeAutomataId);
        if (automata && automata.transitions[transitionId]) {
          Object.assign(automata.transitions[transitionId], updates);
          automata.isDirty = true;
        }
      });
      
      // Mark project as dirty
      try {
        // Use projectStoreGetter
        projectStoreGetter()?.markDirty();
      } catch {
        // Project store might not be available
      }
    },
    
    deleteTransition: (transitionId: TransitionId) => {
      const { activeAutomataId } = get();
      if (!activeAutomataId) return;
      
      get().pushHistory();
      
      set((state) => {
        const automata = state.automata.get(activeAutomataId);
        if (automata) {
          delete automata.transitions[transitionId];
          automata.isDirty = true;
          
          // Clear from selection
          state.selectedTransitionIds = state.selectedTransitionIds.filter(
            (id) => id !== transitionId
          );
        }
      });
      
      // Mark project as dirty
      try {
        // Use projectStoreGetter
        projectStoreGetter()?.markDirty();
      } catch {
        // Project store might not be available
      }
    },
    
    // ========================================================================
    // Selection
    // ========================================================================
    
    selectState: (stateId: StateId, multi = false) => {
      set((state) => {
        if (multi) {
          if (state.selectedStateIds.includes(stateId)) {
            state.selectedStateIds = state.selectedStateIds.filter((id) => id !== stateId);
          } else {
            state.selectedStateIds.push(stateId);
          }
        } else {
          state.selectedStateIds = [stateId];
          state.selectedTransitionIds = [];
        }
      });
    },
    
    selectTransition: (transitionId: TransitionId, multi = false) => {
      set((state) => {
        if (multi) {
          if (state.selectedTransitionIds.includes(transitionId)) {
            state.selectedTransitionIds = state.selectedTransitionIds.filter(
              (id) => id !== transitionId
            );
          } else {
            state.selectedTransitionIds.push(transitionId);
          }
        } else {
          state.selectedTransitionIds = [transitionId];
          state.selectedStateIds = [];
        }
      });
    },
    
    clearSelection: () => {
      set((state) => {
        state.selectedStateIds = [];
        state.selectedTransitionIds = [];
      });
    },
    
    setSelectedStates: (stateIds: StateId[]) => {
      set((state) => {
        state.selectedStateIds = stateIds;
      });
    },
    
    setSelectedTransitions: (transitionIds: TransitionId[]) => {
      set((state) => {
        state.selectedTransitionIds = transitionIds;
      });
    },
    
    selectAll: () => {
      const { activeAutomataId, automata } = get();
      if (!activeAutomataId) return;
      
      const current = automata.get(activeAutomataId);
      if (!current) return;
      
      set((state) => {
        state.selectedStateIds = Object.keys(current.states);
        state.selectedTransitionIds = Object.keys(current.transitions);
      });
    },
    
    // ========================================================================
    // Clipboard
    // ========================================================================
    
    copy: () => {
      const { activeAutomataId, automata, selectedStateIds, selectedTransitionIds } = get();
      if (!activeAutomataId) return;
      
      const current = automata.get(activeAutomataId);
      if (!current) return;
      
      set((state) => {
        state.clipboard = {
          states: selectedStateIds.map((id) => ({ ...current.states[id] })),
          transitions: selectedTransitionIds.map((id) => ({ ...current.transitions[id] })),
        };
      });
    },
    
    cut: () => {
      const { selectedStateIds, selectedTransitionIds } = get();
      
      get().copy();
      
      // Delete selected items
      selectedStateIds.forEach((id) => get().deleteState(id));
      selectedTransitionIds.forEach((id) => get().deleteTransition(id));
    },
    
    paste: (offset = { x: 50, y: 50 }) => {
      const { clipboard, activeAutomataId } = get();
      if (!clipboard || !activeAutomataId) return;
      
      get().pushHistory();
      
      const stateIdMap = new Map<StateId, StateId>();
      const newStateIds: StateId[] = [];
      const newTransitionIds: TransitionId[] = [];
      
      // Paste states with new IDs
      clipboard.states.forEach((state) => {
        const newId = `State_${uuid().slice(0, 8)}`;
        stateIdMap.set(state.id, newId);
        
        set((s) => {
          const automata = s.automata.get(activeAutomataId);
          if (automata) {
            automata.states[newId] = {
              ...state,
              id: newId,
              name: `${state.name}_copy`,
              position: {
                x: state.position.x + offset.x,
                y: state.position.y + offset.y,
              },
            };
            automata.isDirty = true;
          }
        });
        
        newStateIds.push(newId);
      });
      
      // Paste transitions with updated references
      clipboard.transitions.forEach((transition) => {
        const newFrom = stateIdMap.get(transition.from);
        const newTo = stateIdMap.get(transition.to);
        
        // Only paste if both states were pasted
        if (newFrom && newTo) {
          const newId = `t_${uuid().slice(0, 8)}`;
          
          set((s) => {
            const automata = s.automata.get(activeAutomataId);
            if (automata) {
              automata.transitions[newId] = {
                ...transition,
                id: newId,
                from: newFrom,
                to: newTo,
              };
              automata.isDirty = true;
            }
          });
          
          newTransitionIds.push(newId);
        }
      });
      
      // Select pasted items
      set((state) => {
        state.selectedStateIds = newStateIds;
        state.selectedTransitionIds = newTransitionIds;
      });
    },
    
    // ========================================================================
    // History
    // ========================================================================
    
    pushHistory: () => {
      const { activeAutomataId, automata } = get();
      if (!activeAutomataId) return;
      
      const current = automata.get(activeAutomataId);
      if (!current) return;
      
      // Deep clone current state
      const snapshot = JSON.parse(JSON.stringify(current));
      
      set((state) => {
        state.history.past.push(snapshot);
        state.history.future = [];
        
        // Limit history size
        if (state.history.past.length > 50) {
          state.history.past.shift();
        }
      });
    },
    
    undo: () => {
      const { activeAutomataId, history } = get();
      if (!activeAutomataId || history.past.length === 0) return;
      
      set((state) => {
        const current = state.automata.get(activeAutomataId);
        if (!current) return;
        
        const previous = state.history.past.pop();
        if (previous) {
          state.history.future.push(JSON.parse(JSON.stringify(current)));
          state.automata.set(activeAutomataId, previous);
        }
      });
    },
    
    redo: () => {
      const { activeAutomataId, history } = get();
      if (!activeAutomataId || history.future.length === 0) return;
      
      set((state) => {
        const current = state.automata.get(activeAutomataId);
        if (!current) return;
        
        const next = state.history.future.pop();
        if (next) {
          state.history.past.push(JSON.parse(JSON.stringify(current)));
          state.automata.set(activeAutomataId, next);
        }
      });
    },
    
    // ========================================================================
    // Utility
    // ========================================================================
    
    markDirty: (automataId: AutomataId) => {
      set((state) => {
        const automata = state.automata.get(automataId);
        if (automata) {
          automata.isDirty = true;
        }
      });
    },
    
    setAutomataMap: (automataMap: Map<AutomataId, Automata>) => {
      set((state) => {
        state.automata = automataMap;
        // Set first automata as active if none is active
        if (!state.activeAutomataId && automataMap.size > 0) {
          state.activeAutomataId = automataMap.keys().next().value;
        }
      });
    },
    
    reset: () => {
      set((state) => {
        Object.assign(state, initialState);
      });
    },
  }))
);

// ============================================================================
// Selectors
// ============================================================================

export const selectActiveAutomata = (state: AutomataStore) =>
  state.activeAutomataId ? state.automata.get(state.activeAutomataId) : null;

export const selectAutomataList = (state: AutomataStore) =>
  Array.from(state.automata.values());

export const selectSelectedStates = (state: AutomataStore) => {
  const automata = selectActiveAutomata(state);
  if (!automata) return [];
  return state.selectedStateIds.map((id) => automata.states[id]).filter(Boolean);
};

export const selectSelectedTransitions = (state: AutomataStore) => {
  const automata = selectActiveAutomata(state);
  if (!automata) return [];
  return state.selectedTransitionIds.map((id) => automata.transitions[id]).filter(Boolean);
};

export const selectCanUndo = (state: AutomataStore) => state.history.past.length > 0;
export const selectCanRedo = (state: AutomataStore) => state.history.future.length > 0;

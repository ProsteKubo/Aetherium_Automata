/**
 * Aetherium Automata - Project Store
 * 
 * Manages project state, file operations, and hierarchical automata networks.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  Project,
  RecentProject,
  TreeNode,
  ProjectSettings,
  AutomataNetwork,
} from '../types/project';
import type { Automata, AutomataId } from '../types/automata';
import { createEmptyProject, createEmptyNetwork } from '../types/project';

// Lazy getter to avoid circular dependency
let automataStoreGetter: (() => any) | null = null;
export const setAutomataStoreGetter = (getter: () => any) => {
  automataStoreGetter = getter;
};

const FLAGSHIP_NETWORK_BLUEPRINTS: Array<Pick<AutomataNetwork, 'name' | 'description' | 'relativePath' | 'color' | 'icon'>> = [
  {
    name: 'Hardware Button Showcase',
    description: 'Two-node live demo: FRDM-MCXN947 reads the onboard button and a desktop/C++ controller mirrors the signal.',
    relativePath: 'networks/hardware-button-showcase',
    color: '#f0b75e',
    icon: 'hardware',
  },
  {
    name: 'Signal Chain Backbone',
    description: 'Gateway-to-device backbone for command, permit, heartbeat, and telemetry channels.',
    relativePath: 'networks/signal-chain-backbone',
    color: '#1f6f78',
    icon: 'network',
  },
  {
    name: 'Guarded Cell Cluster',
    description: 'State-heavy supervisory network for coordinated actuation, safety, and recovery.',
    relativePath: 'networks/guarded-cell-cluster',
    color: '#7c3aed',
    icon: 'shield',
  },
  {
    name: 'Power Contention Ring',
    description: 'Shared-resource network reserved for bottleneck, latency, and contention analysis.',
    relativePath: 'networks/power-contention-ring',
    color: '#c84c09',
    icon: 'analysis',
  },
  {
    name: 'Resilience Watchdog',
    description: 'Fault and liveness monitoring network that supports rewind and replay workflows.',
    relativePath: 'networks/resilience-watchdog',
    color: '#0f766e',
    icon: 'pulse',
  },
];

function seedFlagshipNetworks(project: Project): Project {
  if (project.networks.length === 0) {
    project.networks = FLAGSHIP_NETWORK_BLUEPRINTS.map((blueprint) => ({
      ...createEmptyNetwork(blueprint.name),
      ...blueprint,
      isExpanded: true,
    }));
  }

  seedHardwareButtonShowcase(project);

  return project;
}

function seedHardwareButtonShowcase(project: Project): void {
  let hardwareNetwork = project.networks.find((network) => network.relativePath === 'networks/hardware-button-showcase');
  if (!hardwareNetwork) {
    hardwareNetwork = {
      ...createEmptyNetwork('Hardware Button Showcase'),
      description: 'Two-node live demo: FRDM-MCXN947 reads the onboard button and a desktop/C++ controller mirrors the signal.',
      relativePath: 'networks/hardware-button-showcase',
      color: '#f0b75e',
      icon: 'hardware',
      isExpanded: true,
    };
    project.networks.unshift(hardwareNetwork);
  }

  const now = Date.now();
  const nxpId = 'showcase_mcxn947_button_leader' as AutomataId;
  const cppId = 'showcase_cpp_button_observer' as AutomataId;

  const nxpButtonLeader: Automata = {
    id: nxpId,
    version: '0.0.1',
    config: {
      name: 'NXP Button Leader',
      type: 'inline',
      language: 'lua',
      description: 'Reads the FRDM-MCXN947 onboard button on GPIO 23, mirrors it to the local red LED, and publishes leader_button.',
      tags: ['showcase', 'hardware', 'mcxn947', 'button', 'gpio'],
      author: 'Aetherium Team',
      version: '1.0.0',
      target: { profile: 'mcxn947_lua_v1' },
      created: now,
      modified: now,
    },
    initialState: 'Polling',
    states: {
      Polling: {
        id: 'Polling',
        name: 'Polling',
        inputs: [],
        outputs: ['leader_button', 'leader_online'],
        variables: [],
        hooks: {
          onEnter: 'gpio.mode(10, "output")\ngpio.mode(23, "input_pullup")',
        },
        code:
          'local pressed = gpio.read(23) == 0\n\n' +
          'gpio.write(10, pressed)\n\n' +
          'setOutput("leader_button", pressed)\n' +
          'setOutput("leader_online", true)',
        isComposite: false,
        position: { x: 180, y: 160 },
        color: '#f0b75e',
        description: 'Live FRDM-MCXN947 button polling state.',
      },
    },
    transitions: {
      stay_polling: {
        id: 'stay_polling',
        name: 'Stay Polling',
        from: 'Polling',
        to: 'Polling',
        type: 'classic',
        condition: 'false',
        priority: 0,
        weight: 1,
      },
    },
    variables: [
      { name: 'leader_button', type: 'bool', direction: 'output', default: false },
      { name: 'leader_online', type: 'bool', direction: 'output', default: false },
    ],
    inputs: [],
    outputs: ['leader_button', 'leader_online'],
    nestedAutomataIds: [],
  };

  const cppButtonObserver: Automata = {
    id: cppId,
    version: '0.0.1',
    config: {
      name: 'CPP Button Observer',
      type: 'inline',
      language: 'lua',
      description: 'Desktop/C++ target that consumes leader_button and exposes a visible pressed/released state.',
      tags: ['showcase', 'desktop', 'cpp', 'button', 'binding'],
      author: 'Aetherium Team',
      version: '1.0.0',
      target: { profile: 'desktop_v1' },
      created: now,
      modified: now,
    },
    initialState: 'Released',
    states: {
      Released: {
        id: 'Released',
        name: 'Released',
        inputs: ['leader_button'],
        outputs: ['button_state'],
        variables: [],
        hooks: { onEnter: 'setOutput("button_state", "released")' },
        code: 'setOutput("button_state", "released")',
        isComposite: false,
        position: { x: 180, y: 160 },
        color: '#60a5fa',
        description: 'Desktop observer while the board button is not pressed.',
      },
      Pressed: {
        id: 'Pressed',
        name: 'Pressed',
        inputs: ['leader_button'],
        outputs: ['button_state'],
        variables: [],
        hooks: { onEnter: 'setOutput("button_state", "pressed")' },
        code: 'setOutput("button_state", "pressed")',
        isComposite: false,
        position: { x: 520, y: 160 },
        color: '#4ade80',
        description: 'Desktop observer while the board button is pressed.',
      },
    },
    transitions: {
      press: {
        id: 'press',
        name: 'Button Pressed',
        from: 'Released',
        to: 'Pressed',
        type: 'classic',
        condition: 'leader_button == true',
        priority: 0,
        weight: 1,
      },
      release: {
        id: 'release',
        name: 'Button Released',
        from: 'Pressed',
        to: 'Released',
        type: 'classic',
        condition: 'leader_button == false',
        priority: 0,
        weight: 1,
      },
    },
    variables: [
      { name: 'leader_button', type: 'bool', direction: 'input', default: false },
      { name: 'button_state', type: 'string', direction: 'output', default: 'released' },
    ],
    inputs: ['leader_button'],
    outputs: ['button_state'],
    nestedAutomataIds: [],
  };

  project.automata[nxpId] = nxpButtonLeader;
  project.automata[cppId] = cppButtonObserver;
  hardwareNetwork.automataIds = [nxpId, cppId];
  hardwareNetwork.rootAutomataIds = [nxpId, cppId];
  hardwareNetwork.inputs = ['leader_button'];
  hardwareNetwork.outputs = ['leader_button', 'leader_online', 'button_state'];
}

// ============================================================================
// State Types
// ============================================================================

interface ProjectState {
  // Current project
  project: Project | null;
  isLoaded: boolean;
  
  // File state
  filePath: string | null;
  isDirty: boolean;
  lastSavedAt: number | null;
  
  // Recent projects
  recentProjects: RecentProject[];
  
  // Explorer tree
  treeNodes: TreeNode[];
  selectedNodeId: string | null;
  expandedNodeIds: Set<string>;
  
  // Loading states
  isCreating: boolean;
  isLoading: boolean;
  isSaving: boolean;
  
  // Errors
  error: string | null;
}

interface ProjectActions {
  // Project CRUD
  createProject: (name?: string) => Promise<boolean>;
  openProject: () => Promise<boolean>;
  openRecentProject: (filePath: string) => Promise<boolean>;
  saveProject: () => Promise<boolean>;
  saveProjectAs: () => Promise<boolean>;
  closeProject: () => void;
  
  // Recent projects
  loadRecentProjects: () => Promise<void>;
  clearRecentProjects: () => Promise<void>;
  
  // Network operations
  createNetwork: (name: string) => string;
  deleteNetwork: (networkId: string) => void;
  renameNetwork: (networkId: string, newName: string) => void;
  updateNetwork: (networkId: string, patch: Partial<AutomataNetwork>) => void;
  
  // Automata in network
  addAutomataToNetwork: (networkId: string, automata: Automata) => void;
  removeAutomataFromNetwork: (networkId: string, automataId: AutomataId) => void;
  removeAutomataFromProject: (automataId: AutomataId) => void;
  setRootAutomata: (networkId: string, automataId: AutomataId, isRoot: boolean) => void;
  
  // Tree operations
  buildTreeFromProject: () => void;
  selectNode: (nodeId: string | null) => void;
  toggleNodeExpanded: (nodeId: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  
  // Settings
  updateSettings: (settings: Partial<ProjectSettings>) => void;
  
  // Dirty state
  markDirty: () => void;
  markClean: () => void;
  
  // Sync with automata store
  syncAutomataFromEditor: () => void;
  syncAutomataToEditor: () => void;
  
  // Utility
  ensureLocalProject: (name?: string) => void;
  reset: () => void;
}

type ProjectStore = ProjectState & ProjectActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: ProjectState = {
  project: null,
  isLoaded: false,
  filePath: null,
  isDirty: false,
  lastSavedAt: null,
  recentProjects: [],
  treeNodes: [],
  selectedNodeId: null,
  expandedNodeIds: new Set(),
  isCreating: false,
  isLoading: false,
  isSaving: false,
  error: null,
};

// ============================================================================
// Store
// ============================================================================

export const useProjectStore = create<ProjectStore>()(
  immer((set, get) => ({
    ...initialState,
    
    // ========================================================================
    // Project CRUD
    // ========================================================================
    
    createProject: async (name?: string) => {
      set((state) => {
        state.isCreating = true;
        state.error = null;
      });
      
      try {
        const result = await window.api.project.create(name);
        
        if (result.success && result.filePath) {
          const opened = await window.api.project.openPath(result.filePath);

          if (opened.success && opened.data) {
            const project = opened.data as Project;
            project.filePath = opened.filePath || result.filePath;

            set((state) => {
              state.project = project;
              state.filePath = project.filePath || null;
              state.isLoaded = true;
              state.isDirty = false;
              state.lastSavedAt = project.metadata.modified;
              state.isCreating = false;
            });

            get().buildTreeFromProject();
            get().syncAutomataToEditor();
            get().loadRecentProjects();

            return true;
          }

          const project = seedFlagshipNetworks(createEmptyProject(name || 'Aetherium Flagship Workspace'));
          project.filePath = result.filePath;
          
          set((state) => {
            state.project = project;
            state.filePath = result.filePath!;
            state.isLoaded = true;
            state.isDirty = false;
            state.lastSavedAt = Date.now();
            state.isCreating = false;
            state.error = opened.error || null;
          });
          
          get().buildTreeFromProject();
          get().syncAutomataToEditor();
          get().loadRecentProjects();
          
          return true;
        } else {
          set((state) => {
            state.isCreating = false;
            if (result.error !== 'Cancelled') {
              state.error = result.error || 'Failed to create project';
            }
          });
          return false;
        }
      } catch (err) {
        set((state) => {
          state.isCreating = false;
          state.error = String(err);
        });
        return false;
      }
    },
    
    openProject: async () => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      
      try {
        const result = await window.api.project.open();
        
        if (result.success && result.data) {
          const project = result.data as Project;
          project.filePath = result.filePath;
          
          set((state) => {
            state.project = project;
            state.filePath = result.filePath || null;
            state.isLoaded = true;
            state.isDirty = false;
            state.lastSavedAt = project.metadata.modified;
            state.isLoading = false;
          });
          
          get().buildTreeFromProject();
          get().syncAutomataToEditor();
          get().loadRecentProjects();
          
          return true;
        } else {
          set((state) => {
            state.isLoading = false;
            if (result.error !== 'Cancelled') {
              state.error = result.error || 'Failed to open project';
            }
          });
          return false;
        }
      } catch (err) {
        set((state) => {
          state.isLoading = false;
          state.error = String(err);
        });
        return false;
      }
    },
    
    openRecentProject: async (filePath: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      
      try {
        const result = await window.api.project.openPath(filePath);
        
        if (result.success && result.data) {
          const project = result.data as Project;
          project.filePath = result.filePath;
          
          set((state) => {
            state.project = project;
            state.filePath = result.filePath || null;
            state.isLoaded = true;
            state.isDirty = false;
            state.lastSavedAt = project.metadata.modified;
            state.isLoading = false;
          });
          
          get().buildTreeFromProject();
          get().syncAutomataToEditor();
          
          return true;
        } else {
          set((state) => {
            state.isLoading = false;
            state.error = result.error || 'Failed to open project';
          });
          return false;
        }
      } catch (err) {
        set((state) => {
          state.isLoading = false;
          state.error = String(err);
        });
        return false;
      }
    },
    
    saveProject: async () => {
      const { project, filePath } = get();
      
      if (!project) {
        return false;
      }
      
      // Sync automata from automataStore before saving
      try {
        get().syncAutomataFromEditor();
      } catch (err) {
        console.error('[ProjectStore] Failed to sync automata before save:', err);
      }
      
      set((state) => {
        state.isSaving = true;
        state.error = null;
      });
      
      try {
        const result = await window.api.project.save(project, filePath || undefined);
        
        if (result.success) {
          set((state) => {
            state.isDirty = false;
            state.lastSavedAt = Date.now();
            state.isSaving = false;
            if (result.filePath) {
              state.filePath = result.filePath;
              if (state.project) {
                state.project.filePath = result.filePath;
              }
            }
          });
          
          get().loadRecentProjects();
          
          return true;
        } else {
          set((state) => {
            state.isSaving = false;
            if (result.error !== 'Cancelled') {
              state.error = result.error || 'Failed to save project';
            }
          });
          return false;
        }
      } catch (err) {
        console.error('[ProjectStore] Save failed:', err);
        set((state) => {
          state.isSaving = false;
          state.error = String(err);
        });
        return false;
      }
    },
    
    saveProjectAs: async () => {
      const { project } = get();
      
      if (!project) return false;
      
      // Sync automata from automataStore before saving
      get().syncAutomataFromEditor();
      
      set((state) => {
        state.isSaving = true;
        state.error = null;
      });
      
      try {
        // Force save dialog by not passing filePath
        const result = await window.api.project.save(project, undefined);
        
        if (result.success && result.filePath) {
          set((state) => {
            state.isDirty = false;
            state.lastSavedAt = Date.now();
            state.filePath = result.filePath!;
            state.isSaving = false;
            if (state.project) {
              state.project.filePath = result.filePath;
            }
          });
          
          get().loadRecentProjects();
          
          return true;
        } else {
          set((state) => {
            state.isSaving = false;
            if (result.error !== 'Cancelled') {
              state.error = result.error || 'Failed to save project';
            }
          });
          return false;
        }
      } catch (err) {
        set((state) => {
          state.isSaving = false;
          state.error = String(err);
        });
        return false;
      }
    },
    
    closeProject: () => {
      set((state) => {
        state.project = null;
        state.isLoaded = false;
        state.filePath = null;
        state.isDirty = false;
        state.lastSavedAt = null;
        state.treeNodes = [];
        state.selectedNodeId = null;
        state.expandedNodeIds = new Set();
        state.error = null;
      });
    },

    ensureLocalProject: (name = 'Aetherium Flagship Workspace') => {
      const existing = get().project;
      if (existing) {
        set((state) => {
          if (state.project) {
            seedFlagshipNetworks(state.project);
            state.isLoaded = true;
            state.isDirty = true;
            state.error = null;
          }
        });
        get().buildTreeFromProject();
        get().syncAutomataToEditor();
        return;
      }

      const project = seedFlagshipNetworks(createEmptyProject(name));

      set((state) => {
        state.project = project;
        state.filePath = null;
        state.isLoaded = true;
        state.isDirty = true;
        state.lastSavedAt = null;
        state.error = null;
      });

      get().buildTreeFromProject();
      get().syncAutomataToEditor();
    },
    
    // ========================================================================
    // Recent Projects
    // ========================================================================
    
    loadRecentProjects: async () => {
      try {
        const recent = await window.api.project.getRecent();
        set((state) => {
          state.recentProjects = recent;
        });
      } catch {
        // Ignore errors
      }
    },
    
    clearRecentProjects: async () => {
      try {
        await window.api.project.clearRecent();
        set((state) => {
          state.recentProjects = [];
        });
      } catch {
        // Ignore errors
      }
    },
    
    // ========================================================================
    // Network Operations
    // ========================================================================
    
    createNetwork: (name: string) => {
      const network = createEmptyNetwork(name);
      
      set((state) => {
        if (state.project) {
          state.project.networks.push(network);
          state.isDirty = true;
        }
      });
      
      get().buildTreeFromProject();
      
      return network.id;
    },
    
    deleteNetwork: (networkId: string) => {
      set((state) => {
        if (state.project) {
          const index = state.project.networks.findIndex((n) => n.id === networkId);
          if (index !== -1) {
            const network = state.project.networks[index];
            
            // Remove all automata in this network
            network.automataIds.forEach((automataId) => {
              delete state.project!.automata[automataId];
            });
            
            // Remove network
            state.project.networks.splice(index, 1);
            state.isDirty = true;
          }
        }
      });
      
      get().buildTreeFromProject();
    },
    
    renameNetwork: (networkId: string, newName: string) => {
      set((state) => {
        if (state.project) {
          const network = state.project.networks.find((n) => n.id === networkId);
          if (network) {
            network.name = newName;
            state.isDirty = true;
          }
        }
      });
      
      get().buildTreeFromProject();
    },

    updateNetwork: (networkId: string, patch: Partial<AutomataNetwork>) => {
      set((state) => {
        if (state.project) {
          const network = state.project.networks.find((n) => n.id === networkId);
          if (network) {
            Object.assign(network, patch);
            state.isDirty = true;
          }
        }
      });

      get().buildTreeFromProject();
    },
    
    // ========================================================================
    // Automata in Network
    // ========================================================================
    
    addAutomataToNetwork: (networkId: string, automata: Automata) => {
      set((state) => {
        if (state.project) {
          const network = state.project.networks.find((n) => n.id === networkId);
          if (network) {
            // Add to project's automata map
            state.project.automata[automata.id] = automata;
            
            // Add to network's automata list
            if (!network.automataIds.includes(automata.id)) {
              network.automataIds.push(automata.id);
            }
            
            state.isDirty = true;
          }
        }
      });
      
      get().buildTreeFromProject();
    },
    
    removeAutomataFromNetwork: (networkId: string, automataId: AutomataId) => {
      set((state) => {
        if (state.project) {
          const network = state.project.networks.find((n) => n.id === networkId);
          if (network) {
            // Remove from network
            network.automataIds = network.automataIds.filter((id) => id !== automataId);
            network.rootAutomataIds = network.rootAutomataIds.filter((id) => id !== automataId);
            
            // Remove from project
            delete state.project.automata[automataId];
            
            state.isDirty = true;
          }
        }
      });
      
      get().buildTreeFromProject();
    },

    removeAutomataFromProject: (automataId: AutomataId) => {
      set((state) => {
        if (!state.project) return;

        const idsToDelete = new Set<AutomataId>();
        const collectNested = (id: AutomataId) => {
          if (idsToDelete.has(id)) return;
          idsToDelete.add(id);
          const automata = state.project?.automata[id];
          automata?.nestedAutomataIds?.forEach((childId) => collectNested(childId));
          Object.values(state.project?.automata ?? {}).forEach((candidate) => {
            if (candidate.parentAutomataId === id) {
              collectNested(candidate.id);
            }
          });
        };

        collectNested(automataId);

        for (const network of state.project.networks) {
          network.automataIds = network.automataIds.filter((id) => !idsToDelete.has(id));
          network.rootAutomataIds = network.rootAutomataIds.filter((id) => !idsToDelete.has(id));
        }

        for (const automata of Object.values(state.project.automata)) {
          if (automata.nestedAutomataIds) {
            automata.nestedAutomataIds = automata.nestedAutomataIds.filter((id) => !idsToDelete.has(id));
          }
        }

        for (const id of idsToDelete) {
          delete state.project.automata[id];
        }

        state.isDirty = true;
        state.project.metadata.modified = Date.now();
      });

      get().buildTreeFromProject();
    },
    
    setRootAutomata: (networkId: string, automataId: AutomataId, isRoot: boolean) => {
      set((state) => {
        if (state.project) {
          const network = state.project.networks.find((n) => n.id === networkId);
          if (network) {
            if (isRoot && !network.rootAutomataIds.includes(automataId)) {
              network.rootAutomataIds.push(automataId);
            } else if (!isRoot) {
              network.rootAutomataIds = network.rootAutomataIds.filter((id) => id !== automataId);
            }
            state.isDirty = true;
          }
        }
      });
      
      get().buildTreeFromProject();
    },
    
    // ========================================================================
    // Tree Operations
    // ========================================================================
    
    buildTreeFromProject: () => {
      const { project } = get();
      
      if (!project) {
        set((state) => {
          state.treeNodes = [];
        });
        return;
      }
      
      const nodes: TreeNode[] = [];
      
      // Project root node
      const projectNode: TreeNode = {
        id: 'project',
        type: 'project',
        name: project.metadata.name,
        parentId: null,
        children: [],
        entityId: 'project',
        isExpanded: true,
        isSelected: false,
        isDirty: get().isDirty,
        filePath: project.filePath,
        status: 'ok',
      };
      
      // Build network nodes
      for (const network of project.networks) {
        const networkNode: TreeNode = {
          id: `network_${network.id}`,
          type: 'network',
          name: network.name,
          parentId: 'project',
          children: [],
          entityId: network.id,
          isExpanded: get().expandedNodeIds.has(`network_${network.id}`),
          isSelected: get().selectedNodeId === `network_${network.id}`,
          isDirty: false,
          status: 'ok',
          icon: network.icon,
        };
        
        // Build automata nodes (hierarchical)
        const buildAutomataNodes = (automataIds: AutomataId[], parentId: string): TreeNode[] => {
          const automataNodes: TreeNode[] = [];
          
          for (const automataId of automataIds) {
            const automata = project.automata[automataId];
            if (!automata) continue;
            
            const isRoot = network.rootAutomataIds.includes(automataId);
            const nodeId = `automata_${automataId}`;
            
            const automataNode: TreeNode = {
              id: nodeId,
              type: 'automata',
              name: automata.config.name + (isRoot ? ' ★' : ''),
              parentId,
              children: [],
              entityId: automataId,
              isExpanded: get().expandedNodeIds.has(nodeId),
              isSelected: get().selectedNodeId === nodeId,
              isDirty: automata.isDirty || false,
              status: 'ok',
            };
            
            // Add nested automata as children
            if (automata.nestedAutomataIds && automata.nestedAutomataIds.length > 0) {
              automataNode.children = buildAutomataNodes(automata.nestedAutomataIds, nodeId);
            }
            
            automataNodes.push(automataNode);
          }
          
          return automataNodes;
        };
        
        // Start with root automata, then non-root
        const rootAutomata = network.rootAutomataIds;
        const nonRootAutomata = network.automataIds.filter(
          (id) => !network.rootAutomataIds.includes(id) && 
                  !Object.values(project.automata).some((a) => a.nestedAutomataIds?.includes(id))
        );
        
        networkNode.children = buildAutomataNodes([...rootAutomata, ...nonRootAutomata], networkNode.id);
        
        projectNode.children.push(networkNode);
      }
      
      nodes.push(projectNode);
      
      set((state) => {
        state.treeNodes = nodes;
      });
    },
    
    selectNode: (nodeId: string | null) => {
      set((state) => {
        state.selectedNodeId = nodeId;
      });
      get().buildTreeFromProject();
    },
    
    toggleNodeExpanded: (nodeId: string) => {
      set((state) => {
        if (state.expandedNodeIds.has(nodeId)) {
          state.expandedNodeIds.delete(nodeId);
        } else {
          state.expandedNodeIds.add(nodeId);
        }
      });
      get().buildTreeFromProject();
    },
    
    expandAll: () => {
      const { treeNodes } = get();
      const allIds = new Set<string>();
      
      const collectIds = (nodes: TreeNode[]) => {
        for (const node of nodes) {
          if (node.children.length > 0) {
            allIds.add(node.id);
            collectIds(node.children);
          }
        }
      };
      
      collectIds(treeNodes);
      
      set((state) => {
        state.expandedNodeIds = allIds;
      });
      get().buildTreeFromProject();
    },
    
    collapseAll: () => {
      set((state) => {
        state.expandedNodeIds = new Set();
      });
      get().buildTreeFromProject();
    },
    
    // ========================================================================
    // Settings
    // ========================================================================
    
    updateSettings: (settings: Partial<ProjectSettings>) => {
      set((state) => {
        if (state.project) {
          state.project.settings = { ...state.project.settings, ...settings };
          state.isDirty = true;
        }
      });
    },
    
    // ========================================================================
    // Dirty State
    // ========================================================================
    
    markDirty: () => {
      set((state) => {
        state.isDirty = true;
        if (state.project) {
          state.project.metadata.modified = Date.now();
        }
      });
    },
    
    markClean: () => {
      set((state) => {
        state.isDirty = false;
      });
    },
    
    // ========================================================================
    // Sync with Automata Store
    // ========================================================================
    
    syncAutomataFromEditor: () => {
      if (!automataStoreGetter) {
        console.error('[ProjectStore] automataStoreGetter not set!');
        return;
      }
      
      const automataStore = automataStoreGetter();
      const automataMap = automataStore.automata;
      
      console.log('[ProjectStore] syncAutomataFromEditor - automataMap size:', automataMap.size);
      console.log('[ProjectStore] syncAutomataFromEditor - automata:', Array.from(automataMap.entries()));
      
      set((state) => {
        if (state.project) {
          // Convert Map to plain object for JSON serialization
          const automataObj: Record<string, Automata> = {};
          automataMap.forEach((automata, id) => {
            automataObj[id] = automata;
          });
          state.project.automata = automataObj;
          console.log('[ProjectStore] syncAutomataFromEditor - set project.automata to:', automataObj);
        }
      });
    },
    
    syncAutomataToEditor: () => {
      if (!automataStoreGetter) {
        console.error('[ProjectStore] automataStoreGetter not set!');
        return;
      }
      
      const automataStore = automataStoreGetter();
      const { project } = get();
      if (!project) return;
      
      // Load automata from project into automataStore
      const automataMap = new Map<AutomataId, Automata>();
      Object.entries(project.automata).forEach(([id, automata]) => {
        automataMap.set(id, automata as Automata);
      });
      
      automataStore.setAutomataMap(automataMap);
    },
    
    // ========================================================================
    // Utility
    // ========================================================================
    
    reset: () => {
      set(() => ({ ...initialState }));
    },
  }))
);

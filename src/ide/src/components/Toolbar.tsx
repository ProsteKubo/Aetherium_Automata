import { Play, Save, FolderOpen, FileText, GitBranch, Settings, Layout, Code, Pause, RotateCcw, Network, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, PanelBottomClose, PanelBottomOpen } from 'lucide-react';

type ToolbarProps = {
  onRunSimulation: () => void;
  onSaveProject: () => void;
  activeView: 'visual' | 'yaml' | 'network';
  onViewChange: (view: 'visual' | 'yaml' | 'network') => void;
  onToggleSidebar: () => void;
  onToggleProperties: () => void;
  onToggleBottomPanel: () => void;
  sidebarCollapsed: boolean;
  propertiesCollapsed: boolean;
  bottomPanelCollapsed: boolean;
};

export function Toolbar({ 
  onRunSimulation, 
  onSaveProject, 
  activeView, 
  onViewChange,
  onToggleSidebar,
  onToggleProperties,
  onToggleBottomPanel,
  sidebarCollapsed,
  propertiesCollapsed,
  bottomPanelCollapsed
}: ToolbarProps) {
  return (
    <div className="h-12 bg-[#2d2d30] border-b border-[#3e3e42] flex items-center justify-between px-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <GitBranch className="size-5 text-[#007acc]" />
          <span className="text-white text-sm">Aetherium Automata IDE</span>
        </div>
        
        <div className="ml-4 flex items-center gap-1">
          <button
            onClick={() => onViewChange('visual')}
            className={`px-3 py-1.5 text-sm rounded flex items-center gap-2 transition-colors ${
              activeView === 'visual'
                ? 'bg-[#007acc] text-white'
                : 'text-[#cccccc] hover:bg-[#3e3e42]'
            }`}
          >
            <Layout className="size-4" />
            Visual
          </button>
          <button
            onClick={() => onViewChange('yaml')}
            className={`px-3 py-1.5 text-sm rounded flex items-center gap-2 transition-colors ${
              activeView === 'yaml'
                ? 'bg-[#007acc] text-white'
                : 'text-[#cccccc] hover:bg-[#3e3e42]'
            }`}
          >
            <Code className="size-4" />
            YAML
          </button>
          <button
            onClick={() => onViewChange('network')}
            className={`px-3 py-1.5 text-sm rounded flex items-center gap-2 transition-colors ${
              activeView === 'network'
                ? 'bg-[#007acc] text-white'
                : 'text-[#cccccc] hover:bg-[#3e3e42]'
            }`}
          >
            <Network className="size-4" />
            Network
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onSaveProject}
          className="px-3 py-1.5 bg-[#0e639c] hover:bg-[#1177bb] text-white text-sm rounded flex items-center gap-2 transition-colors"
        >
          <Save className="size-4" />
          Save
        </button>
        
        <button
          onClick={onRunSimulation}
          className="px-3 py-1.5 bg-[#16825d] hover:bg-[#1a9970] text-white text-sm rounded flex items-center gap-2 transition-colors"
        >
          <Play className="size-4" />
          Run
        </button>

        <div className="w-px h-6 bg-[#3e3e42] mx-2" />

        <button 
          onClick={onToggleSidebar}
          className="p-1.5 text-[#cccccc] hover:bg-[#3e3e42] rounded transition-colors"
          title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        >
          {sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>

        <button 
          onClick={onToggleBottomPanel}
          className="p-1.5 text-[#cccccc] hover:bg-[#3e3e42] rounded transition-colors"
          title={bottomPanelCollapsed ? "Show console" : "Hide console"}
        >
          {bottomPanelCollapsed ? <PanelBottomOpen className="size-4" /> : <PanelBottomClose className="size-4" />}
        </button>

        <button 
          onClick={onToggleProperties}
          className="p-1.5 text-[#cccccc] hover:bg-[#3e3e42] rounded transition-colors"
          title={propertiesCollapsed ? "Show properties" : "Hide properties"}
        >
          {propertiesCollapsed ? <PanelRightOpen className="size-4" /> : <PanelRightClose className="size-4" />}
        </button>

        <button className="p-1.5 text-[#cccccc] hover:bg-[#3e3e42] rounded transition-colors">
          <Settings className="size-4" />
        </button>
      </div>
    </div>
  );
}
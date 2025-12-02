import { useState } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FileCode, FileText } from 'lucide-react';
import type { AutomataProject } from './AutomataIDE';

type FileExplorerProps = {
  project: AutomataProject;
};

type FileNode = {
  name: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  icon?: any;
};

export function FileExplorer({ project }: FileExplorerProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(['project', 'states', 'transitions'])
  );

  const fileTree: FileNode = {
    name: project.config.name,
    type: 'folder',
    children: [
      {
        name: 'automata.yaml',
        type: 'file',
        icon: FileText
      },
      {
        name: 'states',
        type: 'folder',
        children: Object.keys(project.automata.states).map(stateId => ({
          name: `${stateId}.lua`,
          type: 'file',
          icon: FileCode
        }))
      },
      {
        name: 'transitions',
        type: 'folder',
        children: Object.keys(project.automata.transitions).map(transId => ({
          name: `${transId}.lua`,
          type: 'file',
          icon: FileCode
        }))
      },
      {
        name: 'config',
        type: 'folder',
        children: [
          {
            name: 'settings.json',
            type: 'file',
            icon: File
          }
        ]
      }
    ]
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderNode = (node: FileNode, path: string, depth: number = 0) => {
    const fullPath = path ? `${path}/${node.name}` : node.name;
    const isExpanded = expandedFolders.has(fullPath);
    const Icon = node.icon || (node.type === 'folder' ? Folder : File);

    return (
      <div key={fullPath}>
        <div
          className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-[#2a2d2e] text-[#cccccc] text-sm"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => node.type === 'folder' && toggleFolder(fullPath)}
        >
          {node.type === 'folder' && (
            isExpanded ? <ChevronDown className="size-4 flex-shrink-0" /> : <ChevronRight className="size-4 flex-shrink-0" />
          )}
          {node.type === 'file' && <div className="w-4" />}
          <Icon className="size-4 flex-shrink-0 text-[#519aba]" />
          <span className="truncate">{node.name}</span>
        </div>
        
        {node.type === 'folder' && isExpanded && node.children && (
          <div>
            {node.children.map(child => renderNode(child, fullPath, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[#3e3e42]">
        <span className="text-[#cccccc] text-sm uppercase tracking-wider">Explorer</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {renderNode(fileTree, '', 0)}
      </div>
    </div>
  );
}
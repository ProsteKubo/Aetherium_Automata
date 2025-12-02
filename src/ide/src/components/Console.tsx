import { Terminal, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

type ConsoleProps = {
  output: string[];
  onClear: () => void;
};

export function Console({ output, onClear }: ConsoleProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] border-t border-[#3e3e42]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d30] border-b border-[#3e3e42]">
        <div className="flex items-center gap-2 text-[#cccccc]">
          <Terminal className="size-4" />
          <span className="text-sm">Console</span>
          <span className="text-xs text-[#858585]">({output.length} messages)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onClear}
            className="p-1.5 text-[#cccccc] hover:bg-[#3e3e42] rounded transition-colors"
            title="Clear console"
          >
            <Trash2 className="size-4" />
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 text-[#cccccc] hover:bg-[#3e3e42] rounded transition-colors"
          >
            {isExpanded ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </button>
        </div>
      </div>

      {/* Output */}
      {isExpanded && (
        <div className="flex-1 overflow-y-auto p-2 font-mono text-sm">
          {output.length === 0 ? (
            <div className="text-[#858585] text-center py-8">
              No console output yet. Run your automata to see logs.
            </div>
          ) : (
            output.map((line, i) => {
              const isError = line.includes('[Error]') || line.includes('[error]');
              const isWarning = line.includes('[Warning]') || line.includes('[warn]');
              const isSuccess = line.includes('[Success]') || line.includes('[success]');
              const isSimulation = line.includes('[Simulation]');
              const isSystem = line.includes('[System]');
              const isTDD = line.includes('[TDD]');
              const isNetwork = line.includes('[Network]');
              
              let color = '#cccccc';
              if (isError) color = '#f48771';
              else if (isWarning) color = '#cca700';
              else if (isSuccess) color = '#89d185';
              else if (isSimulation) color = '#4a9eff';
              else if (isSystem) color = '#c586c0';
              else if (isTDD) color = '#569cd6';
              else if (isNetwork) color = '#4fc1ff';
              
              return (
                <div key={i} className="py-0.5" style={{ color }}>
                  {line}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
import { useState } from 'react';
import type { State, Transition } from './AutomataIDE';
import { Code, Settings, Plus, X } from 'lucide-react';
import { CodeEditor } from './CodeEditor';

type PropertiesPanelProps = {
  selectedState: State | null;
  selectedTransition: Transition | null;
  onStateUpdate: (updates: Partial<State>) => void;
  onTransitionUpdate: (updates: Partial<Transition>) => void;
  onClose: () => void;
};

export function PropertiesPanel({
  selectedState,
  selectedTransition,
  onStateUpdate,
  onTransitionUpdate,
  onClose
}: PropertiesPanelProps) {
  const [activeTab, setActiveTab] = useState<'properties' | 'code'>('properties');
  const [newInput, setNewInput] = useState('');
  const [newOutput, setNewOutput] = useState('');
  const [newVariable, setNewVariable] = useState('');

  if (!selectedState && !selectedTransition) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-[#3e3e42]">
          <span className="text-[#cccccc] text-sm uppercase tracking-wider">Properties</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-[#858585] text-sm">
          Select a state or transition to view properties
        </div>
      </div>
    );
  }

  const handleAddInput = () => {
    if (newInput && selectedState) {
      onStateUpdate({
        inputs: [...selectedState.inputs, newInput]
      });
      setNewInput('');
    }
  };

  const handleAddOutput = () => {
    if (newOutput && selectedState) {
      onStateUpdate({
        outputs: [...selectedState.outputs, newOutput]
      });
      setNewOutput('');
    }
  };

  const handleAddVariable = () => {
    if (newVariable && selectedState) {
      onStateUpdate({
        variables: [...selectedState.variables, newVariable]
      });
      setNewVariable('');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#3e3e42] flex items-center justify-between">
        <span className="text-[#cccccc] text-sm uppercase tracking-wider">Properties</span>
        <button
          onClick={onClose}
          className="p-1 text-[#cccccc] hover:bg-[#3e3e42] rounded transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#3e3e42]">
        <button
          className={`flex-1 px-4 py-2 text-sm flex items-center justify-center gap-2 ${
            activeTab === 'properties'
              ? 'bg-[#1e1e1e] text-white border-b-2 border-[#007acc]'
              : 'text-[#cccccc] hover:bg-[#2a2d2e]'
          }`}
          onClick={() => setActiveTab('properties')}
        >
          <Settings className="size-4" />
          Properties
        </button>
        <button
          className={`flex-1 px-4 py-2 text-sm flex items-center justify-center gap-2 ${
            activeTab === 'code'
              ? 'bg-[#1e1e1e] text-white border-b-2 border-[#007acc]'
              : 'text-[#cccccc] hover:bg-[#2a2d2e]'
          }`}
          onClick={() => setActiveTab('code')}
        >
          <Code className="size-4" />
          Code
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'properties' && (
          <div className="p-4 space-y-4">
            {selectedState && (
              <>
                {/* State Name */}
                <div>
                  <label className="block text-[#cccccc] text-sm mb-2">State Name</label>
                  <input
                    type="text"
                    value={selectedState.name}
                    onChange={(e) => onStateUpdate({ name: e.target.value })}
                    className="w-full px-3 py-2 bg-[#3c3c3c] text-white border border-[#3e3e42] rounded text-sm focus:outline-none focus:border-[#007acc]"
                  />
                </div>

                {/* Inputs */}
                <div>
                  <label className="block text-[#cccccc] text-sm mb-2">Inputs</label>
                  <div className="space-y-2">
                    {selectedState.inputs.map((input, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="flex-1 px-3 py-2 bg-[#3c3c3c] text-white border border-[#3e3e42] rounded text-sm">
                          {input}
                        </div>
                        <button
                          onClick={() => {
                            onStateUpdate({
                              inputs: selectedState.inputs.filter((_, idx) => idx !== i)
                            });
                          }}
                          className="p-2 text-[#858585] hover:text-red-400 hover:bg-[#3c3c3c] rounded"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newInput}
                        onChange={(e) => setNewInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddInput()}
                        placeholder="Add input..."
                        className="flex-1 px-3 py-2 bg-[#3c3c3c] text-white border border-[#3e3e42] rounded text-sm focus:outline-none focus:border-[#007acc]"
                      />
                      <button
                        onClick={handleAddInput}
                        className="p-2 text-[#16825d] hover:bg-[#3c3c3c] rounded"
                      >
                        <Plus className="size-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Outputs */}
                <div>
                  <label className="block text-[#cccccc] text-sm mb-2">Outputs</label>
                  <div className="space-y-2">
                    {selectedState.outputs.map((output, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="flex-1 px-3 py-2 bg-[#3c3c3c] text-white border border-[#3e3e42] rounded text-sm">
                          {output}
                        </div>
                        <button
                          onClick={() => {
                            onStateUpdate({
                              outputs: selectedState.outputs.filter((_, idx) => idx !== i)
                            });
                          }}
                          className="p-2 text-[#858585] hover:text-red-400 hover:bg-[#3c3c3c] rounded"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newOutput}
                        onChange={(e) => setNewOutput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddOutput()}
                        placeholder="Add output..."
                        className="flex-1 px-3 py-2 bg-[#3c3c3c] text-white border border-[#3e3e42] rounded text-sm focus:outline-none focus:border-[#007acc]"
                      />
                      <button
                        onClick={handleAddOutput}
                        className="p-2 text-[#c586c0] hover:bg-[#3c3c3c] rounded"
                      >
                        <Plus className="size-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Variables */}
                <div>
                  <label className="block text-[#cccccc] text-sm mb-2">Variables</label>
                  <div className="space-y-2">
                    {selectedState.variables.map((variable, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="flex-1 px-3 py-2 bg-[#3c3c3c] text-white border border-[#3e3e42] rounded text-sm">
                          {variable}
                        </div>
                        <button
                          onClick={() => {
                            onStateUpdate({
                              variables: selectedState.variables.filter((_, idx) => idx !== i)
                            });
                          }}
                          className="p-2 text-[#858585] hover:text-red-400 hover:bg-[#3c3c3c] rounded"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newVariable}
                        onChange={(e) => setNewVariable(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddVariable()}
                        placeholder="Add variable..."
                        className="flex-1 px-3 py-2 bg-[#3c3c3c] text-white border border-[#3e3e42] rounded text-sm focus:outline-none focus:border-[#007acc]"
                      />
                      <button
                        onClick={handleAddVariable}
                        className="p-2 text-[#dcdcaa] hover:bg-[#3c3c3c] rounded"
                      >
                        <Plus className="size-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {selectedTransition && (
              <>
                {/* Transition Name */}
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Transition Name</label>
                  <input
                    type="text"
                    value={selectedTransition.name}
                    onChange={(e) => onTransitionUpdate({ name: e.target.value })}
                    className="w-full px-3 py-2 bg-black/50 text-cyan-400 border border-cyan-500/30 rounded text-sm focus:outline-none focus:border-cyan-400"
                  />
                </div>

                {/* From State */}
                <div>
                  <label className="block text-gray-400 text-sm mb-2">From State</label>
                  <div className="px-3 py-2 bg-black/50 text-cyan-400 border border-cyan-500/30 rounded text-sm">
                    {selectedTransition.from}
                  </div>
                </div>

                {/* To State */}
                <div>
                  <label className="block text-gray-400 text-sm mb-2">To State</label>
                  <div className="px-3 py-2 bg-black/50 text-cyan-400 border border-cyan-500/30 rounded text-sm">
                    {selectedTransition.to}
                  </div>
                </div>

                {/* Priority */}
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Priority</label>
                  <input
                    type="number"
                    value={selectedTransition.priority ?? 0}
                    onChange={(e) => onTransitionUpdate({ priority: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-black/50 text-cyan-400 border border-cyan-500/30 rounded text-sm focus:outline-none focus:border-cyan-400"
                  />
                </div>

                {/* Weight */}
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Weight (optional)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedTransition.weight ?? ''}
                    onChange={(e) => onTransitionUpdate({ weight: parseFloat(e.target.value) })}
                    placeholder="0.0 - 1.0"
                    className="w-full px-3 py-2 bg-black/50 text-cyan-400 border border-cyan-500/30 rounded text-sm focus:outline-none focus:border-cyan-400 placeholder-gray-600"
                  />
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'code' && (
          <div className="h-full">
            {selectedState && (
              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-[#cccccc] text-sm mb-2">State Code</label>
                  <div className="border border-[#3e3e42] rounded overflow-hidden" style={{ height: '200px' }}>
                    <CodeEditor
                      value={selectedState.code || ''}
                      onChange={(value) => onStateUpdate({ code: value })}
                      language="lua"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[#cccccc] text-sm mb-2">On Enter (optional)</label>
                  <div className="border border-[#3e3e42] rounded overflow-hidden" style={{ height: '150px' }}>
                    <CodeEditor
                      value={selectedState.onEnter || ''}
                      onChange={(value) => onStateUpdate({ onEnter: value })}
                      language="lua"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[#cccccc] text-sm mb-2">On Exit (optional)</label>
                  <div className="border border-[#3e3e42] rounded overflow-hidden" style={{ height: '150px' }}>
                    <CodeEditor
                      value={selectedState.onExit || ''}
                      onChange={(value) => onStateUpdate({ onExit: value })}
                      language="lua"
                    />
                  </div>
                </div>
              </div>
            )}

            {selectedTransition && (
              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-[#cccccc] text-sm mb-2">Condition</label>
                  <div className="border border-[#3e3e42] rounded overflow-hidden" style={{ height: '150px' }}>
                    <CodeEditor
                      value={selectedTransition.condition || 'true'}
                      onChange={(value) => onTransitionUpdate({ condition: value })}
                      language="lua"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[#cccccc] text-sm mb-2">Body</label>
                  <div className="border border-[#3e3e42] rounded overflow-hidden" style={{ height: '150px' }}>
                    <CodeEditor
                      value={selectedTransition.body || ''}
                      onChange={(value) => onTransitionUpdate({ body: value })}
                      language="lua"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[#cccccc] text-sm mb-2">Triggered (optional)</label>
                  <div className="border border-[#3e3e42] rounded overflow-hidden" style={{ height: '150px' }}>
                    <CodeEditor
                      value={selectedTransition.triggered || ''}
                      onChange={(value) => onTransitionUpdate({ triggered: value })}
                      language="lua"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
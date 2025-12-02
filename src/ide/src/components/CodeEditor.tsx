import { useState } from 'react';

type CodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  readOnly?: boolean;
};

export function CodeEditor({ value, onChange, readOnly = false }: CodeEditorProps) {
  const [localValue, setLocalValue] = useState(value);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    onChange(newValue);
  };



  const lines = value.split('\n');

  return (
    <div className="relative h-full bg-[#1e1e1e] flex">
      {/* Line numbers */}
      <div className="bg-[#1e1e1e] border-r border-[#3e3e42] px-3 py-4 select-none">
        {lines.map((_, i) => (
          <div
            key={i}
            className="text-[#858585] text-right text-sm"
            style={{ lineHeight: '1.5rem', fontFamily: 'monospace' }}
          >
            {i + 1}
          </div>
        ))}
      </div>

      {/* Editor */}
      <div className="flex-1 relative">
        <textarea
          value={localValue}
          onChange={handleChange}
          readOnly={readOnly}
          className="absolute inset-0 w-full h-full px-4 py-4 bg-transparent text-[#d4d4d4] resize-none outline-none overflow-auto"
          style={{
            fontFamily: 'monospace',
            fontSize: '14px',
            lineHeight: '1.5rem',
            tabSize: 2,
            caretColor: '#d4d4d4'
          }}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
/**
 * Aetherium Automata - Monaco Code Editor Component
 * 
 * Lua code editor for state entry/exit scripts using Monaco Editor.
 */

import React, { useRef, useCallback } from 'react';
import Editor, { OnMount, OnChange, loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import type { editor, languages, IRange } from 'monaco-editor';
import { useAutomataStore, useUIStore } from '../../stores';
import { StateHooks } from '../../types';

// Configure Monaco to use local package instead of CDN
loader.config({ monaco });

// Lua language configuration for Monaco
const luaLanguageConfig = {
  keywords: [
    'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function',
    'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return',
    'then', 'true', 'until', 'while'
  ],
  builtins: [
    'print', 'type', 'tostring', 'tonumber', 'pairs', 'ipairs', 'next',
    'select', 'unpack', 'rawget', 'rawset', 'setmetatable', 'getmetatable',
    'assert', 'error', 'pcall', 'xpcall', 'load', 'loadfile', 'dofile',
    // Aetherium specific
    'emit', 'transition', 'get_context', 'set_context', 'log', 'sleep',
    'get_device', 'send_command', 'get_sensor', 'get_time'
  ]
};

type ScriptType = 'code' | 'onEnter' | 'onExit' | 'onTick' | 'onError';

interface CodeEditorProps {
  stateId: string;
  automataId: string;
  initialScriptType?: ScriptType;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({ stateId, automataId, initialScriptType = 'code' }) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [currentScriptType, setCurrentScriptType] = React.useState<ScriptType>(initialScriptType);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const monacoRef = useRef<any>(null);
  
  // Get state and update functions - using bracket notation for Record access
  const state = useAutomataStore((s) => {
    const automata = s.automata.get(automataId);
    return automata?.states[stateId];
  });
  const updateState = useAutomataStore((s) => s.updateState);
  const updateTab = useUIStore((s) => s.updateTab);
  const activeTab = useUIStore((s) => s.tabs.find((t) => t.targetId === stateId));
  
  // Get the correct script content based on type
  const getScriptContent = (): string => {
    if (!state) return '';
    switch (currentScriptType) {
      case 'code':
        return state.code || '-- Main state code\n-- This is the main logic for this state\n\n';
      case 'onEnter':
        return state.hooks?.onEnter || '-- Entry hook\n-- This runs when entering the state\n\nfunction on_enter(context)\n  -- Your code here\nend';
      case 'onExit':
        return state.hooks?.onExit || '-- Exit hook\n-- This runs when leaving the state\n\nfunction on_exit(context)\n  -- Your code here\nend';
      case 'onTick':
        return state.hooks?.onTick || '-- Tick hook\n-- This runs each execution cycle while in the state\n\nfunction on_tick(context, delta)\n  -- Your code here\nend';
      case 'onError':
        return state.hooks?.onError || '-- Error hook\n-- This runs when an error occurs in this state\n\nfunction on_error(context, error)\n  -- Handle error here\nend';
      default:
        return '';
    }
  };
  
  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    
    // Configure Lua syntax highlighting
    monaco.languages.register({ id: 'lua' });
    
    // Set up custom theme
    monaco.editor.defineTheme('aetherium-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '00d4ff', fontStyle: 'bold' },
        { token: 'string', foreground: '7ee787' },
        { token: 'number', foreground: 'ff7b72' },
        { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
        { token: 'function', foreground: 'd2a8ff' },
        { token: 'variable', foreground: 'ffa657' },
        { token: 'operator', foreground: '79c0ff' },
      ],
      colors: {
        'editor.background': '#0d1117',
        'editor.foreground': '#c9d1d9',
        'editor.lineHighlightBackground': '#161b2233',
        'editor.selectionBackground': '#264f78',
        'editorCursor.foreground': '#00d4ff',
        'editorWhitespace.foreground': '#484f58',
        'editorIndentGuide.background': '#21262d',
        'editorIndentGuide.activeBackground': '#30363d',
        'editor.selectionHighlightBackground': '#3fb95040',
        'editorBracketMatch.background': '#17e5e633',
        'editorBracketMatch.border': '#17e5e6',
      },
    });
    
    monaco.editor.setTheme('aetherium-dark');
    
    // Configure Lua language
    monaco.languages.setMonarchTokensProvider('lua', {
      keywords: luaLanguageConfig.keywords,
      builtins: luaLanguageConfig.builtins,
      
      tokenizer: {
        root: [
          [/--\[=*\[/, 'comment', '@commentBlock'],
          [/--.*$/, 'comment'],
          [/"([^"\\]|\\.)*$/, 'string.invalid'],
          [/'([^'\\]|\\.)*$/, 'string.invalid'],
          [/"/, 'string', '@string."'],
          [/'/, 'string', "@string.'"],
          [/\[\[/, 'string', '@stringBlock'],
          [/\d+(\.\d+)?([eE][-+]?\d+)?/, 'number'],
          [/0[xX][0-9a-fA-F]+/, 'number.hex'],
          [/[a-zA-Z_]\w*/, {
            cases: {
              '@keywords': 'keyword',
              '@builtins': 'function',
              '@default': 'identifier'
            }
          }],
          [/[{}()\[\]]/, '@brackets'],
          [/[<>=~+\-*/%#^]/, 'operator'],
          [/[;,.]/, 'delimiter'],
        ],
        string: [
          [/[^\\"']+/, 'string'],
          [/\\./, 'string.escape'],
          [/"/, 'string', '@pop'],
          [/'/, 'string', '@pop'],
        ],
        stringBlock: [
          [/[^\]]+/, 'string'],
          [/\]\]/, 'string', '@pop'],
          [/\]/, 'string'],
        ],
        commentBlock: [
          [/[^\]]+/, 'comment'],
          [/\]=*\]/, 'comment', '@pop'],
          [/\]/, 'comment'],
        ],
      },
    });
    
    // Add completion provider for Aetherium API
    const getWordRange = (model: editor.ITextModel, position: { lineNumber: number; column: number }): IRange => {
      const word = model.getWordUntilPosition(position);
      return {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
    };

    monaco.languages.registerCompletionItemProvider('lua', {
      provideCompletionItems: (model, position) => {
        const range = getWordRange(model, position);
        const suggestions: languages.CompletionItem[] = [
          // Aetherium API functions
          {
            label: 'emit',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'emit("${1:event_name}")',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Emit an event to trigger transitions',
            range,
          },
          {
            label: 'transition',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'transition("${1:target_state}")',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Force transition to a specific state',
            range,
          },
          {
            label: 'get_context',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'get_context("${1:key}")',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Get a value from the automata context',
            range,
          },
          {
            label: 'set_context',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'set_context("${1:key}", ${2:value})',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Set a value in the automata context',
            range,
          },
          {
            label: 'log',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'log("${1:message}")',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Log a message to the output console',
            range,
          },
          {
            label: 'get_device',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'get_device("${1:device_id}")',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Get a reference to a device',
            range,
          },
          {
            label: 'send_command',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'send_command("${1:device_id}", "${2:command}", {${3:params}})',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Send a command to a device',
            range,
          },
          {
            label: 'get_sensor',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'get_sensor("${1:sensor_id}")',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Get the current value of a sensor',
            range,
          },
        ];
        
        return { suggestions };
      },
    });
  };
  
  const handleEditorChange: OnChange = useCallback((value) => {
    if (!value || !state) return;
    
    // Update the state with new script content
    if (currentScriptType === 'code') {
      updateState(stateId, { code: value });
    } else {
      // Update the appropriate hook
      const hookKey = currentScriptType as keyof StateHooks;
      const newHooks: StateHooks = {
        ...state.hooks,
        [hookKey]: value,
      };
      updateState(stateId, { hooks: newHooks });
    }
    
    // Mark tab as dirty
    if (activeTab) {
      updateTab(activeTab.id, { isDirty: true });
    }
  }, [state, currentScriptType, updateState, stateId, activeTab, updateTab]);
  
  const getScriptTypeLabel = () => {
    switch (currentScriptType) {
      case 'code': return 'Main Code';
      case 'onEnter': return 'Entry Hook';
      case 'onExit': return 'Exit Hook';
      case 'onTick': return 'Tick Hook';
      case 'onError': return 'Error Hook';
      default: return 'Code';
    }
  };
  
  if (!state) {
    return (
      <div className="code-editor-empty">
        <p>State not found</p>
      </div>
    );
  }
  
  return (
    <div className="code-editor">
      <div className="code-editor-header">
        <span className="code-editor-title">
          {state.name} - {getScriptTypeLabel()}
        </span>
        <div className="code-editor-tabs">
          <button 
            className={`code-tab ${currentScriptType === 'code' ? 'active' : ''}`}
            onClick={() => setCurrentScriptType('code')}
          >
            Main
          </button>
          <button 
            className={`code-tab ${currentScriptType === 'onEnter' ? 'active' : ''}`}
            onClick={() => setCurrentScriptType('onEnter')}
          >
            Entry
          </button>
          <button 
            className={`code-tab ${currentScriptType === 'onExit' ? 'active' : ''}`}
            onClick={() => setCurrentScriptType('onExit')}
          >
            Exit
          </button>
          <button 
            className={`code-tab ${currentScriptType === 'onTick' ? 'active' : ''}`}
            onClick={() => setCurrentScriptType('onTick')}
          >
            Tick
          </button>
        </div>
      </div>
      
      <div className="code-editor-content">
        <Editor
          height="100%"
          language="lua"
          value={getScriptContent()}
          onChange={handleEditorChange}
          onMount={handleEditorMount}
          loading={<div className="editor-loading">Loading editor...</div>}
          theme="vs-dark"
          options={{
            fontSize: 14,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            lineNumbers: 'on',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            smoothScrolling: true,
            padding: { top: 16, bottom: 16 },
            renderLineHighlight: 'all',
            bracketPairColorization: { enabled: true },
            guides: {
              bracketPairs: true,
              indentation: true,
            },
          }}
        />
      </div>
    </div>
  );
};

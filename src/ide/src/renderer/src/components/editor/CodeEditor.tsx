/**
 * Aetherium Automata - Lightweight Lua Code Editor
 *
 * The heavyweight editor dependency was intentionally removed from the IDE bundle. This editor keeps the
 * implemented state/hook editing workflow while using native controls styled as
 * a dense JetBrains Graphite workbench surface.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useAutomataStore, useUIStore } from '../../stores';
import { StateHooks } from '../../types';

type ScriptType = 'code' | 'onEnter' | 'onExit' | 'onTick' | 'onError';

interface CodeEditorProps {
  stateId: string;
  automataId: string;
  initialScriptType?: ScriptType;
}

const SCRIPT_TABS: Array<{ id: ScriptType; label: string; shortLabel: string }> = [
  { id: 'code', label: 'Main state code', shortLabel: 'Main' },
  { id: 'onEnter', label: 'Entry hook', shortLabel: 'Entry' },
  { id: 'onExit', label: 'Exit hook', shortLabel: 'Exit' },
  { id: 'onTick', label: 'Tick hook', shortLabel: 'Tick' },
  { id: 'onError', label: 'Error hook', shortLabel: 'Error' },
];

const DEFAULT_SCRIPTS: Record<ScriptType, string> = {
  code: '-- Main state code\n-- Keep state behavior explicit and observable.\n\n',
  onEnter: '-- Entry hook\nfunction on_enter(context)\n  -- runs when entering this state\nend\n',
  onExit: '-- Exit hook\nfunction on_exit(context)\n  -- runs before leaving this state\nend\n',
  onTick: '-- Tick hook\nfunction on_tick(context, delta)\n  -- runs each execution cycle\nend\n',
  onError: '-- Error hook\nfunction on_error(context, error)\n  -- handle state-local errors\nend\n',
};

const API_SNIPPETS = ['emit', 'transition', 'get_context', 'set_context', 'log', 'get_device', 'send_command', 'get_sensor'];

export const CodeEditor: React.FC<CodeEditorProps> = ({ stateId, automataId, initialScriptType = 'code' }) => {
  const [currentScriptType, setCurrentScriptType] = useState<ScriptType>(initialScriptType);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const lineNumberRef = useRef<HTMLDivElement | null>(null);

  const state = useAutomataStore((store) => {
    const automata = store.automata.get(automataId);
    return automata?.states[stateId];
  });
  const updateState = useAutomataStore((store) => store.updateState);
  const updateTab = useUIStore((store) => store.updateTab);
  const activeTab = useUIStore((store) => store.tabs.find((tab) => tab.targetId === stateId));

  const scriptValue = useMemo(() => {
    if (!state) {
      return '';
    }

    if (currentScriptType === 'code') {
      return state.code ?? DEFAULT_SCRIPTS.code;
    }

    return state.hooks?.[currentScriptType as keyof StateHooks] ?? DEFAULT_SCRIPTS[currentScriptType];
  }, [currentScriptType, state]);

  const lineNumbers = useMemo(() => {
    const count = Math.max(scriptValue.split('\n').length, 1);
    return Array.from({ length: count }, (_, index) => index + 1);
  }, [scriptValue]);

  const selectedTab = SCRIPT_TABS.find((tab) => tab.id === currentScriptType);

  const handleScriptChange = useCallback(
    (value: string) => {
      if (!state) {
        return;
      }

      if (currentScriptType === 'code') {
        updateState(stateId, { code: value });
      } else {
        const hookKey = currentScriptType as keyof StateHooks;
        updateState(stateId, {
          hooks: {
            ...state.hooks,
            [hookKey]: value,
          },
        });
      }

      if (activeTab) {
        updateTab(activeTab.id, { isDirty: true });
      }
    },
    [activeTab, currentScriptType, state, stateId, updateState, updateTab],
  );

  const insertSnippet = useCallback(
    (snippet: string) => {
      const textArea = textAreaRef.current;
      const insertion = `${snippet}("${snippet === 'transition' ? 'target_state' : 'value'}")`;

      if (!textArea) {
        const nextValue = scriptValue.endsWith('\n') ? `${scriptValue}${insertion}` : `${scriptValue}\n${insertion}`;
        handleScriptChange(nextValue);
        return;
      }

      const start = textArea.selectionStart;
      const end = textArea.selectionEnd;
      const nextValue = `${scriptValue.slice(0, start)}${insertion}${scriptValue.slice(end)}`;
      handleScriptChange(nextValue);

      requestAnimationFrame(() => {
        textArea.focus();
        const cursor = start + insertion.length;
        textArea.setSelectionRange(cursor, cursor);
      });
    },
    [handleScriptChange, scriptValue],
  );

  const handleScroll = useCallback((event: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumberRef.current) {
      lineNumberRef.current.scrollTop = event.currentTarget.scrollTop;
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Tab') {
        return;
      }

      event.preventDefault();
      const textArea = event.currentTarget;
      const start = textArea.selectionStart;
      const end = textArea.selectionEnd;
      const nextValue = `${scriptValue.slice(0, start)}  ${scriptValue.slice(end)}`;
      handleScriptChange(nextValue);

      requestAnimationFrame(() => {
        textArea.setSelectionRange(start + 2, start + 2);
      });
    },
    [handleScriptChange, scriptValue],
  );

  if (!state) {
    return (
      <div className="code-editor-empty">
        <p>State not found</p>
      </div>
    );
  }

  return (
    <div className="code-editor graphite-code-editor">
      <div className="code-editor-header">
        <div className="code-editor-title-group">
          <span className="code-editor-eyebrow">State Logic</span>
          <span className="code-editor-title">
            {state.name} <span className="code-editor-title-muted">/ {selectedTab?.label ?? 'Code'}</span>
          </span>
        </div>

        <div className="code-editor-tabs" role="tablist" aria-label="Script section">
          {SCRIPT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`code-tab ${currentScriptType === tab.id ? 'active' : ''}`}
              onClick={() => setCurrentScriptType(tab.id)}
              role="tab"
              aria-selected={currentScriptType === tab.id}
            >
              {tab.shortLabel}
            </button>
          ))}
        </div>
      </div>

      <div className="code-editor-workbench">
        <aside className="code-editor-rail" aria-label="Aetherium Lua helpers">
          <span className="code-editor-rail-title">API</span>
          {API_SNIPPETS.map((snippet) => (
            <button key={snippet} type="button" className="code-helper-chip" onClick={() => insertSnippet(snippet)}>
              {snippet}
            </button>
          ))}
        </aside>

        <div className="code-editor-content native-code-surface">
          <div className="code-line-numbers" ref={lineNumberRef} aria-hidden="true">
            {lineNumbers.map((lineNumber) => (
              <span key={lineNumber}>{lineNumber}</span>
            ))}
          </div>
          <textarea
            ref={textAreaRef}
            className="native-code-input"
            spellCheck={false}
            value={scriptValue}
            onChange={(event) => handleScriptChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            aria-label={`${state.name} ${selectedTab?.label ?? 'code'}`}
          />
        </div>
      </div>

      <div className="code-editor-footer">
        <span>{lineNumbers.length} lines</span>
        <span>Lua</span>
        <span>UTF-8</span>
      </div>
    </div>
  );
};

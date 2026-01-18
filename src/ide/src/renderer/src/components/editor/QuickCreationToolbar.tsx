/**
 * Aetherium Automata - Quick Creation Toolbar
 * 
 * Floating toolbar for rapid automata element creation:
 * - Quick-add states at cursor position
 * - Quick-connect mode for fast transition creation
 * - Transition type palette
 * - Radial context menu
 * 
 * Features:
 * - Draggable position
 * - Collapsible/expandable
 * - Keyboard shortcut hints
 * - Touch-friendly
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { TransitionType } from '../../types/transitions';

// ============================================================================
// Icons
// ============================================================================

const StateIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="9" />
  </svg>
);

const InitialStateIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="9" />
    <path d="M4 12L7 12" strokeWidth="3" />
  </svg>
);

const FinalStateIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="6" />
  </svg>
);

const TransitionIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </svg>
);

const ConnectIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="12" r="3" />
    <path d="M9 12h6" />
    <path d="M12 9l3 3-3 3" />
  </svg>
);

const LockIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M7 11V7a5 5 0 1 1 10 0v4" />
  </svg>
);

const UnlockIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </svg>
);

const CollapseIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 15l-6-6-6 6" />
  </svg>
);

const ExpandIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const GridIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
);

const ZoomFitIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
  </svg>
);

// ============================================================================
// Tool Button Component
// ============================================================================

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  isActive?: boolean;
  isDisabled?: boolean;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'success' | 'warning';
}

const ToolButton: React.FC<ToolButtonProps> = ({
  icon,
  label,
  shortcut,
  isActive = false,
  isDisabled = false,
  onClick,
  variant = 'default',
}) => {
  const variantColors = {
    default: 'var(--color-bg-secondary)',
    primary: 'var(--color-primary)',
    success: 'var(--color-success)',
    warning: 'var(--color-warning)',
  };
  
  return (
    <button
      type="button"
      className={`quick-tool-btn ${isActive ? 'active' : ''}`}
      onClick={onClick}
      disabled={isDisabled}
      title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--spacing-2)',
        minWidth: 48,
        minHeight: 48,
        backgroundColor: isActive ? variantColors[variant] : 'var(--color-bg-secondary)',
        border: `1px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-md)',
        color: isActive ? (variant === 'default' ? 'var(--color-primary)' : 'white') : 'var(--color-text-secondary)',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.5 : 1,
        transition: 'all 0.15s ease',
      }}
    >
      {icon}
      <span style={{ fontSize: 9, marginTop: 2 }}>{shortcut}</span>
    </button>
  );
};

// ============================================================================
// Separator Component
// ============================================================================

const ToolSeparator: React.FC<{ vertical?: boolean }> = ({ vertical = true }) => (
  <div
    style={{
      width: vertical ? 1 : '80%',
      height: vertical ? 32 : 1,
      backgroundColor: 'var(--color-border)',
      margin: vertical ? '0 var(--spacing-2)' : 'var(--spacing-2) 10%',
    }}
  />
);

// ============================================================================
// Quick Creation Toolbar Component
// ============================================================================

interface QuickCreationToolbarProps {
  onAddState: (type: 'normal' | 'initial' | 'final') => void;
  onStartConnect: () => void;
  onStopConnect: () => void;
  isConnecting: boolean;
  onAddTransition: (type: TransitionType) => void;
  onToggleLock: () => void;
  isLocked: boolean;
  onToggleGrid: () => void;
  showGrid: boolean;
  onFitView: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'floating';
}

export const QuickCreationToolbar: React.FC<QuickCreationToolbarProps> = ({
  onAddState,
  onStartConnect,
  onStopConnect,
  isConnecting,
  onToggleLock,
  isLocked,
  onToggleGrid,
  showGrid,
  onFitView,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  position = 'top',
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showTransitionPalette, setShowTransitionPalette] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  
  // Dragging state for floating position
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [floatingPos, setFloatingPos] = useState({ x: 50, y: 50 });
  
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (position !== 'floating' || !toolbarRef.current) return;
    setIsDragging(true);
    const rect = toolbarRef.current.getBoundingClientRect();
    setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, [position]);
  
  useEffect(() => {
    if (!isDragging) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      setFloatingPos({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y,
      });
    };
    
    const handleMouseUp = () => setIsDragging(false);
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);
  
  const positionStyles: React.CSSProperties = position === 'floating' 
    ? {
        position: 'fixed',
        left: floatingPos.x,
        top: floatingPos.y,
        zIndex: 1000,
      }
    : position === 'left' || position === 'right'
    ? {
        flexDirection: 'column',
        ...(position === 'left' ? { left: 0 } : { right: 0 }),
      }
    : {
        flexDirection: 'row',
        ...(position === 'top' ? { top: 0 } : { bottom: 0 }),
      };
  
  return (
    <div
      ref={toolbarRef}
      className="quick-creation-toolbar"
      onMouseDown={handleMouseDown}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-1)',
        padding: 'var(--spacing-2)',
        backgroundColor: 'var(--color-bg-primary)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        border: '1px solid var(--color-border)',
        cursor: position === 'floating' ? (isDragging ? 'grabbing' : 'grab') : 'default',
        userSelect: 'none',
        ...positionStyles,
      }}
    >
      {/* Collapse toggle */}
      <button
        type="button"
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          backgroundColor: 'transparent',
          border: 'none',
          color: 'var(--color-text-tertiary)',
          cursor: 'pointer',
        }}
      >
        {isCollapsed ? <ExpandIcon /> : <CollapseIcon />}
      </button>
      
      {!isCollapsed && (
        <>
          {/* States section */}
          <div style={{ display: 'flex', gap: 4 }}>
            <ToolButton
              icon={<StateIcon />}
              label="Add State"
              shortcut="N"
              onClick={() => onAddState('normal')}
            />
            <ToolButton
              icon={<InitialStateIcon />}
              label="Add Initial State"
              shortcut="⇧N"
              onClick={() => onAddState('initial')}
            />
            <ToolButton
              icon={<FinalStateIcon />}
              label="Add Final State"
              shortcut="⌥N"
              onClick={() => onAddState('final')}
            />
          </div>
          
          <ToolSeparator />
          
          {/* Transitions section */}
          <div style={{ display: 'flex', gap: 4 }}>
            <ToolButton
              icon={<ConnectIcon />}
              label={isConnecting ? 'Stop Connecting' : 'Quick Connect'}
              shortcut="C"
              isActive={isConnecting}
              variant={isConnecting ? 'primary' : 'default'}
              onClick={isConnecting ? onStopConnect : onStartConnect}
            />
            <ToolButton
              icon={<TransitionIcon />}
              label="Add Transition"
              shortcut="T"
              onClick={() => setShowTransitionPalette(!showTransitionPalette)}
            />
          </div>
          
          <ToolSeparator />
          
          {/* View controls */}
          <div style={{ display: 'flex', gap: 4 }}>
            <ToolButton
              icon={isLocked ? <LockIcon /> : <UnlockIcon />}
              label={isLocked ? 'Unlock Canvas' : 'Lock Canvas'}
              shortcut="L"
              isActive={isLocked}
              onClick={onToggleLock}
            />
            <ToolButton
              icon={<GridIcon />}
              label={showGrid ? 'Hide Grid' : 'Show Grid'}
              shortcut="#"
              isActive={showGrid}
              onClick={onToggleGrid}
            />
            <ToolButton
              icon={<ZoomFitIcon />}
              label="Fit View"
              shortcut="F"
              onClick={onFitView}
            />
          </div>
          
          <ToolSeparator />
          
          {/* Undo/Redo */}
          <div style={{ display: 'flex', gap: 4 }}>
            <ToolButton
              icon={<span style={{ fontSize: 16 }}>↶</span>}
              label="Undo"
              shortcut="⌘Z"
              isDisabled={!canUndo}
              onClick={onUndo}
            />
            <ToolButton
              icon={<span style={{ fontSize: 16 }}>↷</span>}
              label="Redo"
              shortcut="⌘⇧Z"
              isDisabled={!canRedo}
              onClick={onRedo}
            />
          </div>
        </>
      )}
      
      {/* Transition palette dropdown */}
      {showTransitionPalette && (
        <TransitionPalette
          onSelect={(selectedType) => {
            setShowTransitionPalette(false);
            // TODO: Trigger transition creation with this type
            console.log('Selected transition type:', selectedType);
          }}
          onClose={() => setShowTransitionPalette(false)}
        />
      )}
    </div>
  );
};

// ============================================================================
// Transition Palette Component
// ============================================================================

interface TransitionPaletteProps {
  onSelect: (type: TransitionType) => void;
  onClose: () => void;
}

const TransitionPalette: React.FC<TransitionPaletteProps> = ({ onSelect, onClose }) => {
  const options: { type: TransitionType; label: string; desc: string; shortcut: string; color: string }[] = [
    { type: 'classic', label: 'Guard', desc: 'Condition-based', shortcut: 'G', color: '#4CAF50' },
    { type: 'timed', label: 'After', desc: 'Time delay', shortcut: 'A', color: '#2196F3' },
    { type: 'event', label: 'Input', desc: 'Signal trigger', shortcut: 'I', color: '#FF9800' },
    { type: 'probabilistic', label: 'Random', desc: 'Weighted chance', shortcut: 'P', color: '#9C27B0' },
    { type: 'immediate', label: 'Epsilon', desc: 'Instant fire', shortcut: 'E', color: '#f44336' },
  ];
  
  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const option = options.find((o) => o.shortcut.toLowerCase() === e.key.toLowerCase());
      if (option) {
        onSelect(option.type);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelect, onClose]);
  
  return (
    <div
      className="transition-palette"
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: 'var(--spacing-2)',
        backgroundColor: 'var(--color-bg-primary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        padding: 'var(--spacing-2)',
        zIndex: 100,
        minWidth: 200,
      }}
    >
      <div style={{ marginBottom: 'var(--spacing-2)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
        Select transition type:
      </div>
      {options.map((option) => (
        <button
          key={option.type}
          type="button"
          onClick={() => onSelect(option.type)}
          style={{
            display: 'flex',
            alignItems: 'center',
            width: '100%',
            padding: 'var(--spacing-2)',
            backgroundColor: 'transparent',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: option.color,
              marginRight: 'var(--spacing-2)',
            }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>{option.label}</div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
              {option.desc}
            </div>
          </div>
          <span style={{
            fontSize: 'var(--font-size-xs)',
            padding: '2px 6px',
            backgroundColor: 'var(--color-bg-tertiary)',
            borderRadius: 'var(--radius-sm)',
          }}>
            {option.shortcut}
          </span>
        </button>
      ))}
    </div>
  );
};

// ============================================================================
// Radial Context Menu Component
// ============================================================================

interface RadialMenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  action: () => void;
  color?: string;
}

interface RadialContextMenuProps {
  items: RadialMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

export const RadialContextMenu: React.FC<RadialContextMenuProps> = ({ items, position, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  
  const radius = 80;
  const itemSize = 48;
  
  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);
  
  return (
    <div
      ref={menuRef}
      className="radial-context-menu"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -50%)',
        width: radius * 2 + itemSize,
        height: radius * 2 + itemSize,
        zIndex: 2000,
      }}
    >
      {/* Center indicator */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 16,
          height: 16,
          borderRadius: '50%',
          backgroundColor: 'var(--color-primary)',
          boxShadow: '0 0 10px var(--color-primary)',
        }}
      />
      
      {/* Menu items */}
      {items.map((item, index) => {
        const angle = (index / items.length) * 2 * Math.PI - Math.PI / 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        const isHovered = hoveredItem === item.id;
        
        return (
          <button
            key={item.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              item.action();
              onClose();
            }}
            onMouseEnter={() => setHoveredItem(item.id)}
            onMouseLeave={() => setHoveredItem(null)}
            style={{
              position: 'absolute',
              left: `calc(50% + ${x}px)`,
              top: `calc(50% + ${y}px)`,
              transform: `translate(-50%, -50%) scale(${isHovered ? 1.2 : 1})`,
              width: itemSize,
              height: itemSize,
              borderRadius: '50%',
              backgroundColor: item.color || 'var(--color-bg-secondary)',
              border: `2px solid ${isHovered ? 'var(--color-primary)' : 'var(--color-border)'}`,
              color: isHovered ? 'var(--color-primary)' : 'var(--color-text)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              boxShadow: isHovered ? 'var(--shadow-lg)' : 'var(--shadow-md)',
            }}
            title={item.label}
          >
            {item.icon}
          </button>
        );
      })}
      
      {/* Label for hovered item */}
      {hoveredItem && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, 30px)',
            padding: 'var(--spacing-1) var(--spacing-2)',
            backgroundColor: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-size-sm)',
            whiteSpace: 'nowrap',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {items.find((i) => i.id === hoveredItem)?.label}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Hook for using radial menu
// ============================================================================

export const useRadialMenu = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  
  const open = useCallback((x: number, y: number) => {
    setPosition({ x, y });
    setIsOpen(true);
  }, []);
  
  const close = useCallback(() => {
    setIsOpen(false);
  }, []);
  
  return { isOpen, position, open, close };
};

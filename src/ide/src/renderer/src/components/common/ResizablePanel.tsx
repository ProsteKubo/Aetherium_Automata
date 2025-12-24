/**
 * Aetherium Automata - Resizable Panel Component
 */

import React, { useCallback, useState, useRef, useEffect } from 'react';

interface ResizablePanelProps {
  children: React.ReactNode;
  direction: 'horizontal' | 'vertical';
  defaultSize: number;
  minSize?: number;
  maxSize?: number;
  onResize?: (size: number) => void;
  className?: string;
  resizerPosition?: 'start' | 'end';
}

export const ResizablePanel: React.FC<ResizablePanelProps> = ({
  children,
  direction,
  defaultSize,
  minSize = 100,
  maxSize = 600,
  onResize,
  className = '',
  resizerPosition = 'end',
}) => {
  const [size, setSize] = useState(defaultSize);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef(0);
  const startSizeRef = useRef(0);
  
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
    startSizeRef.current = size;
    
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [direction, size]);
  
  useEffect(() => {
    if (!isResizing) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = resizerPosition === 'end' 
        ? currentPos - startPosRef.current
        : startPosRef.current - currentPos;
      
      const newSize = Math.max(minSize, Math.min(maxSize, startSizeRef.current + delta));
      setSize(newSize);
      onResize?.(newSize);
    };
    
    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, direction, minSize, maxSize, onResize, resizerPosition]);
  
  const style: React.CSSProperties = direction === 'horizontal'
    ? { width: size, minWidth: minSize, maxWidth: maxSize }
    : { height: size, minHeight: minSize, maxHeight: maxSize };
  
  const resizerClassName = `resizer ${direction === 'horizontal' ? 'resizer-horizontal' : 'resizer-vertical'} ${isResizing ? 'active' : ''}`;
  
  return (
    <div
      ref={panelRef}
      className={className}
      style={{ ...style, display: 'flex', flexDirection: direction === 'horizontal' ? 'row' : 'column', position: 'relative' }}
    >
      {resizerPosition === 'start' && (
        <div className={resizerClassName} onMouseDown={handleMouseDown} />
      )}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
      {resizerPosition === 'end' && (
        <div className={resizerClassName} onMouseDown={handleMouseDown} />
      )}
    </div>
  );
};

interface SplitPaneProps {
  children: [React.ReactNode, React.ReactNode];
  direction: 'horizontal' | 'vertical';
  defaultSplit?: number; // percentage 0-100
  minSize?: number;
  className?: string;
}

export const SplitPane: React.FC<SplitPaneProps> = ({
  children,
  direction,
  defaultSplit = 50,
  minSize = 100,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(defaultSplit);
  const [isResizing, setIsResizing] = useState(false);
  
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [direction]);
  
  useEffect(() => {
    if (!isResizing || !containerRef.current) return;
    
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    
    const handleMouseMove = (e: MouseEvent) => {
      const pos = direction === 'horizontal' 
        ? e.clientX - rect.left 
        : e.clientY - rect.top;
      const total = direction === 'horizontal' ? rect.width : rect.height;
      
      const minPercent = (minSize / total) * 100;
      const maxPercent = 100 - minPercent;
      
      const newSplit = Math.max(minPercent, Math.min(maxPercent, (pos / total) * 100));
      setSplit(newSplit);
    };
    
    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, direction, minSize]);
  
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: direction === 'horizontal' ? 'row' : 'column',
    flex: 1,
    overflow: 'hidden',
  };
  
  const firstPaneStyle: React.CSSProperties = direction === 'horizontal'
    ? { width: `${split}%`, overflow: 'hidden' }
    : { height: `${split}%`, overflow: 'hidden' };
  
  const secondPaneStyle: React.CSSProperties = direction === 'horizontal'
    ? { width: `${100 - split}%`, overflow: 'hidden' }
    : { height: `${100 - split}%`, overflow: 'hidden' };
  
  const resizerClassName = `resizer ${direction === 'horizontal' ? 'resizer-horizontal' : 'resizer-vertical'} ${isResizing ? 'active' : ''}`;
  
  return (
    <div ref={containerRef} className={className} style={containerStyle}>
      <div style={firstPaneStyle}>{children[0]}</div>
      <div className={resizerClassName} onMouseDown={handleMouseDown} />
      <div style={secondPaneStyle}>{children[1]}</div>
    </div>
  );
};

import { useState, useRef, useEffect, ReactNode } from 'react';

type ResizablePanelProps = {
  children: ReactNode;
  initialWidth: number;
  onResize: (width: number) => void;
  minWidth: number;
  maxWidth: number;
  side: 'left' | 'right' | 'top' | 'bottom';
};

export function ResizablePanel({
  children,
  initialWidth,
  onResize,
  minWidth,
  maxWidth,
  side
}: ResizablePanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [width, setWidth] = useState(initialWidth);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setWidth(initialWidth);
  }, [initialWidth]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      let newWidth: number;

      if (side === 'left') {
        newWidth = rect.right - e.clientX;
      } else if (side === 'right') {
        newWidth = e.clientX - rect.left;
      } else if (side === 'top') {
        newWidth = rect.bottom - e.clientY;
      } else {
        newWidth = e.clientY - rect.top;
      }

      newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      setWidth(newWidth);
      onResize(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, side, minWidth, maxWidth, onResize]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const isHorizontal = side === 'top' || side === 'bottom';
  const resizeHandleClass = isHorizontal
    ? 'absolute left-0 right-0 h-1 cursor-ns-resize hover:bg-[#007acc] transition-colors'
    : 'absolute top-0 bottom-0 w-1 cursor-ew-resize hover:bg-[#007acc] transition-colors';

  const resizeHandlePosition = isHorizontal
    ? side === 'top' ? 'top-0' : 'bottom-0'
    : side === 'left' ? 'left-0' : 'right-0';

  return (
    <div
      ref={containerRef}
      className="relative flex-shrink-0"
      style={{
        width: isHorizontal ? '100%' : `${width}px`,
        height: isHorizontal ? `${width}px` : '100%'
      }}
    >
      {children}
      <div
        className={`${resizeHandleClass} ${resizeHandlePosition} z-10 ${
          isDragging ? 'bg-[#007acc]' : ''
        }`}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}
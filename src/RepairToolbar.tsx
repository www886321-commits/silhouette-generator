import { useEffect, useRef, useState, type ReactNode } from 'react';

export function RepairToolbar({ children }: { children: ReactNode }) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clamp = (x: number, y: number) => {
    const rect = toolbarRef.current?.getBoundingClientRect();
    return {
      x: Math.max(8, Math.min(x, window.innerWidth - (rect?.width ?? 0) - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - (rect?.height ?? 0) - 8)),
    };
  };
  useEffect(() => {
    const keepVisible = () => setPosition(current => {
      if (!current) return current;
      const next = clamp(current.x, current.y);
      return next.x === current.x && next.y === current.y ? current : next;
    });
    const observer = new ResizeObserver(keepVisible);
    if (toolbarRef.current) observer.observe(toolbarRef.current);
    window.addEventListener('resize', keepVisible);
    return () => { observer.disconnect(); window.removeEventListener('resize', keepVisible); };
  }, []);
  const endDrag = () => { dragRef.current = null; setDragging(false); };
  return <div className="repair-toolbar-anchor">
    <div ref={toolbarRef} className={`mask-status ${dragging ? 'is-dragging' : ''}`}
      role="group" aria-label="轮廓修补工具"
      style={position ? { position: 'fixed', left: position.x, top: position.y, transform: 'none' } : undefined}
      onPointerDown={event => {
        if (event.button !== 0 || !(event.target as Element).closest('.repair-toolbar-grip')) return;
        const rect = event.currentTarget.getBoundingClientRect();
        dragRef.current = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault(); event.stopPropagation(); setDragging(true);
      }}
      onPointerMove={event => {
        const drag = dragRef.current;
        if (!drag || drag.id !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        setPosition(clamp(event.clientX - drag.dx, event.clientY - drag.dy));
      }}
      onPointerUp={event => {
        if (dragRef.current?.id !== event.pointerId) return;
        endDrag();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
      {children}
    </div>
  </div>;
}

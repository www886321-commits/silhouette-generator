import { useCallback, useEffect, useRef, useState, type PointerEvent, type MouseEvent } from 'react';

// This camera changes only the editor view. Image coordinates and exports stay independent.
export function useCanvasView() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const camera = useRef({ x: 0, y: 0, zoom: 1 });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const space = useRef(false);
  const suppressClick = useRef(false);

  const [zoom, setZoom] = useState(1);
  const [handMode, setHandMode] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);

  const paint = useCallback(() => {
    const view = camera.current;
    if (wrapRef.current) wrapRef.current.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  }, []);
  const reset = useCallback(() => {
    camera.current = { x: 0, y: 0, zoom: 1 };
    setZoom(1);
    paint();
  }, [paint]);

  const zoomBy = useCallback((factor: number, clientX?: number, clientY?: number) => {
    if (drag.current) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const view = camera.current;
    const next = Math.max(.1, Math.min(8, view.zoom * factor));
    const x = (clientX ?? rect.left + rect.width / 2) - rect.left - rect.width / 2;
    const y = (clientY ?? rect.top + rect.height / 2) - rect.top - rect.height / 2;
    camera.current = { x: x - (x - view.x) * next / view.zoom, y: y - (y - view.y) * next / view.zoom, zoom: next };
    setZoom(next);
    paint();
  }, [paint]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport!.clientHeight : 1);
      zoomBy(Math.exp(-Math.max(-100, Math.min(100, pixels)) * .002), event.clientX, event.clientY);
    };
    viewport?.addEventListener('wheel', wheel, { passive: false });
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey || target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
      event.preventDefault();
      space.current = true;
      setSpaceHeld(true);
    };
    const releaseSpace = () => { space.current = false; setSpaceHeld(false); };
    const keyUp = (event: KeyboardEvent) => { if (event.code === 'Space') releaseSpace(); };
    const blur = () => {
      releaseSpace();
      const current = drag.current;
      if (current && viewport?.hasPointerCapture(current.id)) viewport.releasePointerCapture(current.id);
      drag.current = null;
      setPanning(false);
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);
    return () => {
      viewport?.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);


    };
  }, [zoomBy]);

  const onPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current || (event.button !== 0 && event.button !== 1)) return;
    const blank = event.target === event.currentTarget;
    const pan = handMode || space.current || event.button === 1 || blank;
    suppressClick.current = pan;
    if (!pan) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setPanning(true);
  };
  const onPointerMoveCapture = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    camera.current.x += event.clientX - current.x;
    camera.current.y += event.clientY - current.y;
    current.x = event.clientX;
    current.y = event.clientY;
    paint();
  };
  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return { viewportRef, wrapRef, zoom, zoomBy, reset, handMode, setHandMode,
    panReady: handMode || spaceHeld, panning,
    handlers: { onPointerDownCapture, onPointerMoveCapture, onPointerUpCapture: endPan,
      onPointerCancelCapture: endPan, onLostPointerCapture: endPan, onClickCapture } };
}


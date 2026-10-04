import { useEffect, useRef, useState, type ReactNode } from 'react';

export type SheetSnap = 'peek' | 'half' | 'full';

const heightFor = (snap: SheetSnap, vh: number) => (snap === 'peek' ? 132 : snap === 'half' ? Math.round(vh * 0.5) : Math.round(vh * 0.88));

/** Draggable bottom sheet for phones and portrait tablets. */
export function BottomSheet({ snap, onSnap, header, children }: {
  snap: SheetSnap;
  onSnap: (s: SheetSnap) => void;
  header: ReactNode;
  children: ReactNode;
}) {
  const [vh, setVh] = useState(window.innerHeight);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; h: number } | null>(null);

  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const height = drag ?? heightFor(snap, vh);

  const onPointerDown = (e: React.PointerEvent) => {
    start.current = { y: e.clientY, h: height };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    setDrag(Math.max(96, Math.min(vh * 0.92, start.current.h + (start.current.y - e.clientY))));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!start.current) return;
    const moved = Math.abs(e.clientY - start.current.y);
    const h = drag ?? height;
    start.current = null;
    setDrag(null);
    if (moved < 6) {
      onSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half');
      return;
    }
    const options: SheetSnap[] = ['peek', 'half', 'full'];
    onSnap(options.reduce((best, s) => (Math.abs(heightFor(s, vh) - h) < Math.abs(heightFor(best, vh) - h) ? s : best)));
  };

  return (
    <section
      className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-2xl flex-col rounded-t-3xl border border-white/10 bg-slate-950/92 shadow-[0_-12px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl"
      style={{ height, transition: drag == null ? 'height 280ms cubic-bezier(.2,.8,.2,1)' : 'none', paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Details panel"
    >
      <div
        className="shrink-0 cursor-grab touch-none select-none px-5 pt-2.5 pb-2 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="mx-auto mb-2.5 h-1.5 w-11 rounded-full bg-white/25" />
        {header}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">{children}</div>
    </section>
  );
}

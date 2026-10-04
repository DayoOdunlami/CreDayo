import type { ReactNode } from 'react';

export function Stat({ label, value, sub, tone = 'default' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'bad' }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-3.5 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${tone === 'bad' ? 'text-rose-300' : 'text-white'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export function Dot({ color, ring }: { color: string; ring?: boolean }) {
  return <span className={`inline-block size-2.5 shrink-0 rounded-full ${ring ? 'ring-2 ring-slate-950' : ''}`} style={{ background: color }} />;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mt-6 mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">{children}</h3>;
}

export function CloseButton({ onClick, label = 'Close' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} aria-label={label} className="grid size-9 shrink-0 place-items-center rounded-full bg-white/8 text-slate-300 hover:bg-white/15 hover:text-white">
      <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
    </button>
  );
}

export function PrimaryButton({ children, onClick, tone = 'danger', disabled }: { children: ReactNode; onClick: () => void; tone?: 'danger' | 'neutral'; disabled?: boolean }) {
  const cls = tone === 'danger'
    ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/25 hover:bg-rose-400'
    : 'bg-white/10 text-white hover:bg-white/15';
  return (
    <button disabled={disabled} onClick={onClick} className={`flex h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-50 ${cls}`}>
      {children}
    </button>
  );
}

export const Bolt = ({ className = 'size-4' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor"><path d="M13.5 2 4 14h6.5L9.5 22 20 9.5h-6.5z" /></svg>
);

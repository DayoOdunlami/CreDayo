import { TIER_BLURB, TIER_LABEL, type Dataset, type Primary } from '../lib/data';
import { fmtInt } from '../lib/format';
import { COLORS } from '../map/GridMap';
import { Bolt, CloseButton, PrimaryButton, SectionTitle, Stat } from './atoms';

export function summarise(data: Dataset, id: string) {
  const primaries: Primary[] = [];
  const stack = [id];
  while (stack.length) {
    const n = stack.pop()!;
    const pi = data.primaryIndex.get(n);
    if (pi != null) primaries.push(data.network.primaries[pi]);
    stack.push(...(data.children.get(n) ?? []));
  }
  return {
    primaries,
    customers: primaries.reduce((s, p) => s + p.customers, 0),
    secondaries: primaries.reduce((s, p) => s + p.secondaries, 0),
    demandMw: primaries.reduce((s, p) => s + (p.demandMw ?? 0), 0),
  };
}

export function NodeHeader({ data, id, onClose }: { data: Dataset; id: string; onClose: () => void }) {
  const node = data.nodeById.get(id)!;
  const tier = data.tierOf.get(id)!;
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: COLORS[tier] }}>
          <span className="size-2 rounded-full" style={{ background: COLORS[tier] }} /> {TIER_LABEL[tier]}
        </div>
        <h2 className="mt-1 truncate text-[22px] font-semibold text-white">{node.name}</h2>
      </div>
      <CloseButton onClick={onClose} />
    </div>
  );
}

export function NodeBody({ data, id, onFail, onSelect }: { data: Dataset; id: string; onFail: () => void; onSelect: (id: string) => void }) {
  const node = data.nodeById.get(id)!;
  const tier = data.tierOf.get(id)!;
  const sum = summarise(data, id);
  const primary = tier === 'primary' ? (node as Primary) : null;

  const chain: string[] = [];
  for (let p = node.parent; p && data.nodeById.has(p); p = data.nodeById.get(p)!.parent) chain.push(p);

  const headroom = primary?.demandMw != null && primary.firmCapacityMw ? primary.demandMw / primary.firmCapacityMw : null;

  return (
    <div className="text-[15px] text-slate-300">
      <p className="text-[14px] leading-snug text-slate-400">
        {primary?.gridFed ? 'A 132 kV grid site that feeds 11 kV streets directly. ' : ''}{TIER_BLURB[tier]}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Stat label="Customers" value={fmtInt(sum.customers)} sub="homes & businesses" />
        <Stat label="Local substations" value={fmtInt(sum.secondaries)} sub={tier === 'primary' ? 'on 11 kV feeders' : `via ${sum.primaries.length} primaries`} />
        {sum.demandMw > 0 && <Stat label="Peak demand" value={`${sum.demandMw.toFixed(1)} MW`} sub="UKPN recorded" />}
        {primary?.firmCapacityMw && <Stat label="Firm capacity" value={`${primary.firmCapacityMw.toFixed(0)} MW`} sub="winter rating" />}
      </div>

      {headroom != null && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-slate-400">
            <span>Loading vs firm capacity</span>
            <span className={headroom > 0.9 ? 'text-rose-300' : headroom > 0.7 ? 'text-amber-300' : 'text-emerald-300'}>{Math.round(headroom * 100)}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10">
            <div className={`h-full rounded-full ${headroom > 0.9 ? 'bg-rose-400' : headroom > 0.7 ? 'bg-amber-300' : 'bg-emerald-400'}`} style={{ width: `${Math.min(100, headroom * 100)}%` }} />
          </div>
        </div>
      )}

      <div className="mt-5">
        <PrimaryButton onClick={onFail}><Bolt /> Simulate failure</PrimaryButton>
      </div>

      {chain.length > 0 && (
        <>
          <SectionTitle>Fed from</SectionTitle>
          <ol className="space-y-1.5">
            {chain.map((pid) => {
              const t = data.tierOf.get(pid)!;
              return (
                <li key={pid}>
                  <button onClick={() => onSelect(pid)} className="flex w-full items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5 text-left hover:bg-white/[0.08]">
                    <span className="size-2.5 rounded-full" style={{ background: COLORS[t] }} />
                    <span className="flex-1 text-white">{data.nodeById.get(pid)!.name}</span>
                    <span className="text-xs text-slate-500">{TIER_LABEL[t]}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-[13px] text-slate-500">Failing a site upstream takes out everything below it. Try it.</p>
        </>
      )}

      {tier !== 'primary' && (
        <>
          <SectionTitle>Feeds {sum.primaries.length} primary substations</SectionTitle>
          <ul className="flex flex-wrap gap-1.5">
            {sum.primaries.slice(0, 24).map((p) => (
              <li key={p.id}><button onClick={() => onSelect(p.id)} className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[13px] text-slate-200 hover:bg-white/[0.12]">{p.name}</button></li>
            ))}
            {sum.primaries.length > 24 && <li className="px-2 py-1.5 text-[13px] text-slate-500">+{sum.primaries.length - 24} more</li>}
          </ul>
        </>
      )}
    </div>
  );
}

import { useState } from 'react';
import type { Dataset } from '../lib/data';
import { fmtCompact, fmtInt } from '../lib/format';
import { COLORS, type LiveFault } from '../map/GridMap';
import { Bolt, Dot, SectionTitle } from './atoms';

export function IntroHeader() {
  return (
    <div>
      <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-300">
        <Bolt /> CreDayo <span className="font-normal text-slate-500">· London grid resilience</span>
      </div>
      <h1 className="mt-1.5 text-[22px] font-semibold leading-tight text-white text-balance">What happens when London's power fails?</h1>
    </div>
  );
}

export function IntroBody({ data, live, liveOn, onToggleLive, onPostcode, onLocate, onScenario }: {
  data: Dataset;
  live: LiveFault[] | null;
  liveOn: boolean;
  onToggleLive: () => void;
  onPostcode: (pc: string) => Promise<string | null>;
  onLocate: () => void;
  onScenario: (id: string) => void;
}) {
  const [pc, setPc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totalCustomers = data.network.primaries.reduce((s, p) => s + p.customers, 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pc.trim()) return;
    setBusy(true);
    setError(await onPostcode(pc.trim()));
    setBusy(false);
  };

  const liveCustomers = live?.reduce((s, f) => s + f.customers, 0) ?? 0;

  return (
    <div className="text-[15px] leading-relaxed text-slate-300">
      <p className="mt-1">
        This is London's real electricity distribution network: {data.network.primaries.length} primary substations feeding{' '}
        {fmtInt(data.network.secondaries.length)} local substations and <span className="text-white">{fmtCompact(totalCustomers)} customers</span>.
        Tap any area on the map to see what it powers, then fail it.
      </p>

      <form onSubmit={submit} className="mt-4">
        <label htmlFor="pc" className="text-xs font-semibold uppercase tracking-wider text-slate-400">Find the substation that powers you</label>
        <div className="mt-2 flex gap-2">
          <input
            id="pc"
            value={pc}
            onChange={(e) => setPc(e.target.value)}
            placeholder="Postcode, e.g. SE1 7EH"
            autoComplete="postal-code"
            className="h-12 min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 text-base text-white placeholder:text-slate-500 focus:border-amber-300/60 focus:outline-none"
          />
          <button disabled={busy} className="h-12 shrink-0 rounded-2xl bg-amber-300 px-4 font-semibold text-slate-950 hover:bg-amber-200 disabled:opacity-60">
            {busy ? '…' : 'Find'}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
        <button type="button" onClick={onLocate} className="mt-2 text-sm text-amber-300/90 hover:text-amber-200">
          or use my location →
        </button>
      </form>

      <SectionTitle>Flood scenarios</SectionTitle>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
        {data.scenarios.map((s) => (
          <button key={s.id} onClick={() => onScenario(s.id)} className="group rounded-2xl border border-blue-400/20 bg-blue-500/10 p-3.5 text-left hover:border-blue-300/40 hover:bg-blue-500/15">
            <div className="flex items-center justify-between font-semibold text-white">
              {s.name}
              <span className="text-blue-300 transition group-hover:translate-x-0.5">Run →</span>
            </div>
            <p className="mt-1 text-[13px] leading-snug text-slate-400">{s.blurb}</p>
          </button>
        ))}
      </div>

      <SectionTitle>Right now</SectionTitle>
      <button onClick={onToggleLive} className="flex w-full items-center gap-3 rounded-2xl border border-orange-400/20 bg-orange-500/10 p-3.5 text-left hover:bg-orange-500/15">
        <span className="relative flex size-3 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-orange-400 opacity-60" />
          <span className="relative inline-flex size-3 rounded-full bg-orange-400" />
        </span>
        <span className="flex-1 text-[14px]">
          {live == null ? 'Checking UK Power Networks for live power cuts…' : live.length === 0
            ? 'No live power cuts reported in London right now.'
            : <><span className="font-semibold text-white">{live.length} live power cut{live.length === 1 ? '' : 's'}</span> in and around London{liveCustomers ? `, ${fmtInt(liveCustomers)} customers affected` : ''}.</>}
        </span>
        {!!live?.length && <span className="text-sm font-medium text-orange-300">{liveOn ? 'Hide' : 'Show'}</span>}
      </button>

      <SectionTitle>Map key</SectionTitle>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
        <li className="flex items-center gap-2"><Dot color={COLORS.gsp} /> Grid supply point</li>
        <li className="flex items-center gap-2"><Dot color={COLORS.grid} /> Grid substation</li>
        <li className="flex items-center gap-2"><Dot color={COLORS.primary} /> Primary substation</li>
        <li className="flex items-center gap-2"><Dot color={COLORS.secondary} /> Local substation</li>
        <li className="flex items-center gap-2"><Dot color={COLORS.sites.hospital} /> Hospital</li>
        <li className="flex items-center gap-2"><Dot color={COLORS.sites.care_home} /> Care home</li>
        <li className="flex items-center gap-2"><Dot color={COLORS.failed} /> Without power</li>
        <li className="flex items-center gap-2"><Dot color={COLORS.live} /> Live power cut</li>
      </ul>

      <Sources data={data} />
    </div>
  );
}

export function Sources({ data }: { data: Dataset }) {
  return (
    <details className="mt-6 rounded-2xl border border-white/8 bg-white/[0.03] p-3.5 text-[13px] text-slate-400">
      <summary className="cursor-pointer font-medium text-slate-300">About this data &amp; its limits</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        {data.network.sources.map((s) => <li key={s}>{s}</li>)}
      </ul>
      <p className="mt-2">
        The cascade is illustrative. Real networks are meshed and interconnected: automatic switching usually restores many
        customers within minutes. This shows the worst case if a substation and everything it feeds is lost.
      </p>
      <p className="mt-2 text-slate-500">Network snapshot built {new Date(data.network.generated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.</p>
    </details>
  );
}

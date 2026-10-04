import { useState } from 'react';
import type { Dataset, SiteKind } from '../lib/data';
import { VOLL_PER_MWH, type Impact } from '../lib/cascade';
import { fmtInt, fmtMoney } from '../lib/format';
import { COLORS } from '../map/GridMap';
import { CloseButton, PrimaryButton, SectionTitle, Stat } from './atoms';
import { Sources } from './IntroView';

export function ImpactHeader({ title, customers, done, onClose }: { title: string; customers: number; done: boolean; onClose: () => void }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold uppercase tracking-wider text-rose-300">{title}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-[30px] font-bold leading-none tabular-nums text-white">{fmtInt(customers)}</span>
          <span className="text-[15px] text-slate-300">customers {done ? 'without power' : 'losing power…'}</span>
        </div>
      </div>
      <CloseButton onClick={onClose} label="End simulation" />
    </div>
  );
}

const CARE: { kind: SiteKind; label: string; note: string }[] = [
  { kind: 'hospital', label: 'Hospitals', note: 'Should switch to standby generators within seconds. Check fuel and transfer.' },
  { kind: 'care_home', label: 'Care homes', note: 'Often have no backup supply. Residents on powered equipment need welfare checks.' },
  { kind: 'hospice', label: 'Hospices', note: 'Medical equipment and heating at risk.' },
];
const KNOCK_ON: { kind: SiteKind; label: string; note: string }[] = [
  { kind: 'telecom', label: 'Mobile & radio masts', note: 'Run on batteries, then go silent. That hits 999 calls and coordination.' },
  { kind: 'rail', label: 'Rail stations', note: 'Signalling has its own feeds, but stations lose lighting, lifts and gates.' },
  { kind: 'water', label: 'Water & sewage sites', note: 'Pumping stops without backup, so pressure drops and sewer overflows become a risk.' },
];

export function ImpactBody({ data, impact, done, onReplay, onReset, onSite, onSelect }: {
  data: Dataset;
  impact: Impact;
  done: boolean;
  onReplay: () => void;
  onReset: () => void;
  onSite: (index: number) => void;
  onSelect: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const hospitals = impact.siteIndexes.filter((i) => data.sites[i].kind === 'hospital' && data.sites[i].name);
  const primaries = impact.failedPrimaries.map((pi) => data.network.primaries[pi]).sort((a, b) => b.customers - a.customers);

  const share = async () => {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: 'CreDayo: London grid failure', url });
      else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    } catch { /* user cancelled */ }
  };

  return (
    <div className="text-[15px] text-slate-300">
      <div className="grid grid-cols-2 gap-2.5">
        <Stat label="Substations down" value={fmtInt(impact.failedSecondaries.length)} sub={`under ${impact.failedPrimaries.length} primar${impact.failedPrimaries.length === 1 ? 'y' : 'ies'}`} tone="bad" />
        <Stat label="Demand lost" value={`${impact.demandMw.toFixed(impact.demandMw < 10 ? 1 : 0)} MW`} sub="at peak" tone="bad" />
        <Stat label="Economic cost" value={`${fmtMoney(impact.costPerHour)}/hr`} sub={<span title={`Value of Lost Load £${fmtInt(VOLL_PER_MWH)}/MWh (London Economics for Ofgem/DECC, 2013)`}>Value of Lost Load ⓘ</span>} tone="bad" />
        <Stat label="Critical care sites" value={fmtInt(impact.siteCounts.hospital + impact.siteCounts.care_home + impact.siteCounts.hospice)} sub="hospitals, care homes, hospices" tone="bad" />
      </div>

      <SectionTitle>Vulnerable people</SectionTitle>
      <ul className="space-y-2">
        {CARE.map((c) => (
          <li key={c.kind} className="flex gap-3 rounded-2xl bg-white/[0.04] p-3">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: COLORS.sites[c.kind] }} />
            <div className="min-w-0 flex-1">
              <div className="flex justify-between gap-2 text-white"><span>{c.label}</span><span className="font-semibold tabular-nums">{impact.siteCounts[c.kind]}</span></div>
              <p className="text-[13px] leading-snug text-slate-400">{c.note}</p>
            </div>
          </li>
        ))}
      </ul>
      {hospitals.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {hospitals.slice(0, 12).map((i) => (
            <li key={i}><button onClick={() => onSite(i)} className="rounded-full border border-rose-300/25 bg-rose-400/10 px-3 py-1.5 text-[13px] text-rose-100 hover:bg-rose-400/20">{data.sites[i].name}</button></li>
          ))}
        </ul>
      )}

      <SectionTitle>Knock-on effects</SectionTitle>
      <ul className="space-y-2">
        {KNOCK_ON.map((c) => (
          <li key={c.kind} className="flex gap-3 rounded-2xl bg-white/[0.04] p-3">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: COLORS.sites[c.kind] }} />
            <div className="min-w-0 flex-1">
              <div className="flex justify-between gap-2 text-white"><span>{c.label}</span><span className="font-semibold tabular-nums">{impact.siteCounts[c.kind]}</span></div>
              <p className="text-[13px] leading-snug text-slate-400">{c.note}</p>
            </div>
          </li>
        ))}
      </ul>

      {primaries.length > 1 && (
        <>
          <SectionTitle>Hardest-hit areas</SectionTitle>
          <ul className="flex flex-wrap gap-1.5">
            {primaries.slice(0, 16).map((p) => (
              <li key={p.id}><button onClick={() => onSelect(p.id)} className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[13px] text-slate-200 hover:bg-white/[0.12]">{p.name}</button></li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-6 grid grid-cols-2 gap-2.5">
        <PrimaryButton tone="neutral" onClick={onReplay} disabled={!done}>↻ Replay</PrimaryButton>
        <PrimaryButton tone="neutral" onClick={share}>{copied ? 'Link copied' : 'Share'}</PrimaryButton>
      </div>
      <button onClick={onReset} className="mt-2.5 h-11 w-full rounded-2xl text-sm font-medium text-slate-400 hover:text-white">Restore power &amp; reset</button>

      <Sources data={data} />
    </div>
  );
}

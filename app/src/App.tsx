import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { loadDataset, type Dataset } from './lib/data';
import { computeImpact, type Impact } from './lib/cascade';
import { fetchLiveFaults } from './lib/live';
import { pointInGeometry } from './lib/geo';
import { fmtInt } from './lib/format';
import { GridMap, COLORS, type LiveFault, type MapClick } from './map/GridMap';
import { BottomSheet, type SheetSnap } from './ui/BottomSheet';
import { IntroBody, IntroHeader } from './ui/IntroView';
import { NodeBody, NodeHeader } from './ui/NodeView';
import { ImpactBody, ImpactHeader } from './ui/ImpactView';
import { CloseButton } from './ui/atoms';

type Mode =
  | { kind: 'intro' }
  | { kind: 'node'; id: string }
  | { kind: 'impact'; title: string; impact: Impact; scenario?: string };

type Popup = { kind: 'site'; index: number } | { kind: 'live'; fault: LiveFault } | { kind: 'message'; text: string };

function useWide() {
  const q = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'intro' });
  const [progress, setProgress] = useState({ customers: 0, done: true });
  const [popup, setPopup] = useState<Popup | null>(null);
  const [live, setLive] = useState<LiveFault[] | null>(null);
  const [liveOn, setLiveOn] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const [snap, setSnap] = useState<SheetSnap>('half');
  const wide = useWide();

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GridMap | null>(null);
  const clickRef = useRef<(c: MapClick) => void>(() => {});

  useEffect(() => {
    loadDataset().then(setData).catch((e) => setLoadError(String(e)));
    fetchLiveFaults().then(setLive).catch(() => setLive([]));
  }, []);

  // Map padding follows the panel so fitted areas aren't hidden behind it.
  const paddingRef = useRef({ wide, snap });
  paddingRef.current = { wide, snap };

  useEffect(() => {
    if (!data || !mapEl.current) return;
    const gm = new GridMap(mapEl.current, data, (c) => clickRef.current(c));
    gm.padding = () => {
      const { wide, snap } = paddingRef.current;
      if (wide) return { top: 60, bottom: 60, left: 460, right: 80 };
      const sheet = snap === 'full' ? window.innerHeight * 0.5 : snap === 'half' ? window.innerHeight * 0.5 : 140;
      return { top: 70, bottom: sheet + 20, left: 30, right: 30 };
    };
    mapRef.current = gm;
    gm.whenReady().then(() => { if (!applyHash(data)) gm.home(); });
    return () => { gm.destroy(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => { mapRef.current?.whenReady().then(() => mapRef.current?.setLive(live ?? [], liveOn)); }, [live, liveOn]);

  // ---------------------------------------------------------------------------
  // Actions

  const select = useCallback((id: string | null, fly = true) => {
    const gm = mapRef.current;
    if (!gm || !data) return;
    gm.clearImpact();
    void gm.showFlood(false);
    gm.setSelected(id);
    setPopup(null);
    if (!id) { setMode({ kind: 'intro' }); setHash(''); return; }
    setMode({ kind: 'node', id });
    setSnap((s) => (s === 'peek' ? 'half' : s));
    setHash(`select=${id}`);
    if (fly) gm.fitTo(gm.bboxOf([id]), 14);
  }, [data]);

  const fail = useCallback((id: string) => {
    const gm = mapRef.current;
    if (!gm || !data) return;
    const impact = computeImpact(data, [id]);
    setPopup(null);
    gm.setSelected(id);
    setMode({ kind: 'impact', title: `If ${data.nodeById.get(id)!.name} fails`, impact });
    setSnap('half');
    setHash(`fail=${id}`);
    gm.fitTo(gm.bboxOf([id]), 14);
    setProgress({ customers: 0, done: false });
    setTimeout(() => gm.playImpact(impact, (customers, done) => setProgress({ customers, done })), 700);
  }, [data]);

  const runScenario = useCallback(async (sid: string) => {
    const gm = mapRef.current;
    if (!gm || !data) return;
    const sc = data.scenarios.find((s) => s.id === sid);
    if (!sc) return;
    gm.setSelected(null);
    const impact = computeImpact(data, sc.failed, sc.failedSecondaries);
    setPopup(null);
    setMode({ kind: 'impact', title: sc.name, impact, scenario: sid });
    setSnap('half');
    setHash(`scenario=${sid}`);
    setProgress({ customers: 0, done: false });
    await gm.showFlood(true, sc.zones);
    gm.fitTo(gm.bboxOf(sc.failed, sc.failedSecondaries), 12);
    setTimeout(() => gm.playImpact(impact, (customers, done) => setProgress({ customers, done })), 900);
  }, [data]);

  const replay = () => {
    if (mode.kind !== 'impact') return;
    if (mode.scenario) void runScenario(mode.scenario);
    else fail(mode.impact.roots[0]);
  };

  const reset = () => {
    const gm = mapRef.current;
    const sel = mode.kind === 'impact' && !mode.scenario ? mode.impact.roots[0] : null;
    gm?.clearImpact();
    void gm?.showFlood(false);
    if (sel) select(sel, false); else select(null);
  };

  const findPrimaryAt = (lon: number, lat: number) =>
    data?.areas.features.find((f) => pointInGeometry(lon, lat, f.geometry))?.properties.id ?? null;

  const lookupPostcode = async (pc: string): Promise<string | null> => {
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
      if (!res.ok) return "We couldn't find that postcode.";
      const { result } = await res.json();
      const id = findPrimaryAt(result.longitude, result.latitude);
      if (!id) return `${result.postcode} isn't in the Greater London area covered by UK Power Networks.`;
      select(id, false);
      mapRef.current?.flyTo(result.longitude, result.latitude, 14);
      return null;
    } catch {
      return 'Postcode lookup failed. Check your connection.';
    }
  };

  const locate = () => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        const id = findPrimaryAt(pos.coords.longitude, pos.coords.latitude);
        if (!id) { setPopup({ kind: 'message', text: "You're outside the Greater London area covered here." }); return; }
        select(id, false);
        mapRef.current?.flyTo(pos.coords.longitude, pos.coords.latitude, 14);
      },
      () => setPopup({ kind: 'message', text: "Couldn't get your location." }),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  };

  clickRef.current = (c) => {
    if (c.kind === 'node') {
      if (mode.kind === 'impact') return setPopup(null);
      select(c.id);
    } else if (c.kind === 'site') setPopup({ kind: 'site', index: c.index });
    else if (c.kind === 'live') setPopup({ kind: 'live', fault: c.fault });
    else setPopup(null);
  };

  const toggle3D = () => { const on = !is3D; setIs3D(on); mapRef.current?.set3D(on); };

  /** Restores a shared link (#fail=…, #select=…, #scenario=…). Returns false if there was nothing to restore. */
  function applyHash(d: Dataset) {
    const [k, v] = location.hash.slice(1).split('=');
    if (k === 'fail' && d.nodeById.has(v)) fail(v);
    else if (k === 'select' && d.nodeById.has(v)) select(v);
    else if (k === 'scenario' && d.scenarios.some((s) => s.id === v)) void runScenario(v);
    else return false;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Panel content

  let header: ReactNode = null;
  let body: ReactNode = null;
  if (data) {
    if (mode.kind === 'intro') {
      header = <IntroHeader />;
      body = <IntroBody data={data} live={live} liveOn={liveOn} onToggleLive={() => setLiveOn((v) => !v)} onPostcode={lookupPostcode} onLocate={locate} onScenario={runScenario} />;
    } else if (mode.kind === 'node') {
      header = <NodeHeader data={data} id={mode.id} onClose={() => select(null)} />;
      body = <NodeBody data={data} id={mode.id} onFail={() => fail(mode.id)} onSelect={(id) => select(id)} />;
    } else {
      header = <ImpactHeader title={mode.title} customers={progress.customers} done={progress.done} onClose={reset} />;
      body = (
        <ImpactBody
          data={data}
          impact={mode.impact}
          done={progress.done}
          onReplay={replay}
          onReset={reset}
          onSite={(i) => { const s = data.sites[i]; setPopup({ kind: 'site', index: i }); mapRef.current?.flyTo(s.lon, s.lat, 15); }}
          onSelect={(id) => select(id)}
        />
      );
    }
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0b1120] text-slate-200">
      {/* inline style: maplibre-gl.css (unlayered) would otherwise override Tailwind's layered `absolute` */}
      <div ref={mapEl} style={{ position: 'absolute', inset: 0 }} />

      {!data && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="mx-auto size-10 animate-spin rounded-full border-2 border-amber-300/30 border-t-amber-300" />
            <p className="mt-4 text-sm text-slate-400">{loadError ?? "Loading London's network…"}</p>
          </div>
        </div>
      )}

      {data && (
        <>
          <MapControls is3D={is3D} onToggle3D={toggle3D} liveOn={liveOn} onToggleLive={() => setLiveOn((v) => !v)} liveCount={live?.length ?? 0} onHome={() => mapRef.current?.home()} onLocate={locate} wide={wide} />

          {wide ? (
            <aside className="absolute top-4 bottom-4 left-4 z-20 flex w-[420px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950/90 shadow-2xl shadow-black/50 backdrop-blur-xl">
              <div className="shrink-0 px-6 pt-5 pb-3">{header}</div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{body}</div>
            </aside>
          ) : (
            <BottomSheet snap={snap} onSnap={setSnap} header={header}>{body}</BottomSheet>
          )}

          {popup && <PopupCard data={data} popup={popup} wide={wide} onClose={() => setPopup(null)} />}
        </>
      )}
    </div>
  );
}

function setHash(h: string) {
  history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
}

function MapControls({ is3D, onToggle3D, liveOn, onToggleLive, liveCount, onHome, onLocate, wide }: {
  is3D: boolean; onToggle3D: () => void; liveOn: boolean; onToggleLive: () => void; liveCount: number; onHome: () => void; onLocate: () => void; wide: boolean;
}) {
  const btn = 'grid size-11 place-items-center rounded-2xl border border-white/10 bg-slate-950/85 text-[13px] font-bold text-slate-200 shadow-lg backdrop-blur-md hover:bg-slate-900 active:scale-95';
  return (
    <div className={`absolute z-10 flex flex-col gap-2 ${wide ? 'top-4 right-4' : 'top-3 right-3'}`} style={{ marginTop: 'env(safe-area-inset-top)' }}>
      <button className={`${btn} ${is3D ? '!bg-amber-300 !text-slate-950' : ''}`} onClick={onToggle3D} aria-pressed={is3D} title="Toggle 3D buildings">{is3D ? '2D' : '3D'}</button>
      <button className={`${btn} relative`} onClick={onToggleLive} aria-pressed={liveOn} title="Live power cuts">
        <span className="size-3 rounded-full" style={{ background: liveOn ? COLORS.live : 'transparent', border: `2px solid ${COLORS.live}` }} />
        {liveCount > 0 && <span className="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-orange-500 px-1 text-[10px] text-white">{liveCount}</span>}
      </button>
      <button className={btn} onClick={onLocate} title="My location" aria-label="My location">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" /></svg>
      </button>
      <button className={btn} onClick={onHome} title="Whole of London" aria-label="Whole of London">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z" /></svg>
      </button>
    </div>
  );
}

function PopupCard({ data, popup, wide, onClose }: { data: Dataset; popup: Popup; wide: boolean; onClose: () => void }) {
  let title: ReactNode;
  let detail: ReactNode;
  if (popup.kind === 'site') {
    const s = data.sites[popup.index];
    const labels = { hospital: 'Hospital', hospice: 'Hospice', care_home: 'Care home', telecom: 'Telecoms mast', rail: 'Rail station', water: 'Water site' };
    const p = data.network.primaries[s.p];
    title = <><span className="mr-2 inline-block size-2.5 rounded-full" style={{ background: COLORS.sites[s.kind] }} />{s.name ?? labels[s.kind]}</>;
    detail = <>{labels[s.kind]} · supplied via <span className="text-white">{p.name}</span> primary</>;
  } else if (popup.kind === 'live') {
    const f = popup.fault;
    title = <><span className="mr-2 inline-block size-2.5 rounded-full" style={{ background: COLORS.live }} />{f.type} power cut</>;
    detail = (
      <>
        {f.customers > 0 && <span className="text-white">{fmtInt(f.customers)} customers · </span>}{f.postcodes}
        <span className="mt-1 block text-slate-400">{f.message}</span>
        {f.restoration && <span className="mt-1 block text-slate-400">Estimated restoration {new Date(f.restoration).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
        <span className="mt-1 block text-[11px] text-slate-500">Source: UK Power Networks live faults</span>
      </>
    );
  } else {
    title = popup.text;
  }
  return (
    <div className={`absolute z-30 rounded-2xl border border-white/10 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-xl ${wide ? 'right-20 bottom-6 w-[360px]' : 'inset-x-3 top-3 mr-14'}`} style={{ marginTop: wide ? undefined : 'env(safe-area-inset-top)' }}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-white">{title}</div>
          {detail && <div className="mt-1 text-[13px] leading-snug text-slate-300">{detail}</div>}
        </div>
        <CloseButton onClick={onClose} />
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bypass } from './components/Bypass.tsx';
import { Events } from './components/Events.tsx';
import { Mimic } from './components/Mimic.tsx';
import { Panel } from './components/Panel.tsx';
import { Points } from './components/Points.tsx';
import { Simulator } from './components/Simulator.tsx';
import { hhmm } from './engine/lcd.ts';
import type { Command, CommandResult } from './engine/types.ts';
import type { PanelView } from './engine/view.ts';
import { RemoteSource, SimSource, type ConnStatus, type PanelSource } from './source/source.ts';

type Tab = 'mimic' | 'points' | 'bypass' | 'events' | 'sim' | 'conn';
interface Settings {
  mode: 'sim' | 'remote';
  url: string;
  token: string;
  operator: string;
}

const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? { ...d, ...JSON.parse(v) } : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  },
};

function defaultUrl() {
  // Set VITE_GATEWAY_URL (e.g. wss://zp3-gateway.example.com/ws) in Vercel to point the hosted app at a gateway.
  const env = import.meta.env.VITE_GATEWAY_URL as string | undefined;
  if (env) return env;
  try {
    if (location.protocol.startsWith('http') && !location.hostname.endsWith('claude.ai') && location.port)
      return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  } catch {
    /* ignore */
  }
  return 'ws://localhost:8080/ws';
}

interface Confirm {
  title: string;
  body: string;
  ok: string;
  danger?: boolean;
  password?: boolean;
  run: (password: string) => void;
}

/** Commands that change the state of the life-safety system need a confirmation step. */
function describe(cmd: Command): { title: string; body: string; ok: string; danger?: boolean } | null {
  if (cmd.t === 'key') {
    switch (cmd.key) {
      case 'RESET':
        return { title: 'Reset the panel?', body: 'Clears latched fire and fault conditions. Anything still present will come straight back.', ok: 'Reset', danger: true };
      case 'SILENCE':
        return { title: 'Silence alarms?', body: 'Stops the sounders. Only silence when the building is confirmed safe or being evacuated under control.', ok: 'Silence alarms', danger: true };
      case 'SOUND':
        return { title: 'Sound alarms?', body: 'Operates all sounders across the building (evacuation).', ok: 'Sound alarms', danger: true };
      case 'SOUNDERS':
        return { title: 'Toggle sounder enable?', body: 'Disabling sounders means a fire will not sound the building alarms.', ok: 'Toggle sounders', danger: true };
      case 'DAY_NIGHT':
        return { title: 'Change day / night mode?', body: 'Day mode adds an investigation delay before sounders operate. During a delay this adds more time.', ok: 'Change mode' };
      default:
        return null;
    }
  }
  if (cmd.t === 'keyswitch' && cmd.on) return { title: 'Turn key switch ON?', body: 'Grants access level 2: reset, silence, sound alarms and day/night.', ok: 'Key ON' };
  if (cmd.t === 'setDisabled')
    return {
      title: `${cmd.disabled ? 'Disable' : 'Enable'} ${cmd.target} ${cmd.addr}?`,
      body: cmd.disabled ? 'A disabled device will not raise a fire alarm. Record why and restore it after repair.' : 'The device will report fire and fault again.',
      ok: cmd.disabled ? 'Disable' : 'Enable',
      danger: cmd.disabled,
    };
  if (cmd.t === 'bypass')
    return {
      title: `Bypass point ${cmd.addr} for ${cmd.minutes >= 60 ? `${cmd.minutes / 60} h` : `${cmd.minutes} min`}?`,
      body: `Reason: ${cmd.reason}. While bypassed this device will NOT detect fire. It is re-enabled automatically when the time ends.`,
      ok: 'Bypass',
      danger: true,
    };
  if (cmd.t === 'unbypass')
    return { title: `Restore point ${cmd.addr}?`, body: 'Ends the bypass. The device reports fire and fault again; if it is still faulty the fault returns.', ok: 'Restore' };
  if (cmd.t === 'sim' && cmd.action.a === 'preset') return { title: 'Load preset?', body: 'Replaces the simulated panel state.', ok: 'Load' };
  return null;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() =>
    store.get<Settings>('zp3.settings', { mode: 'sim', url: defaultUrl(), token: 'operator-demo', operator: 'Praveen' }),
  );
  const [view, setView] = useState<PanelView>();
  const [status, setStatus] = useState<ConnStatus>({ state: 'connecting' });
  const [tab, setTab] = useState<Tab>('mimic');
  const [selected, setSelected] = useState<number | undefined>(1011);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [pw, setPw] = useState('');
  const [toast, setToast] = useState<{ text: string; bad: boolean } | null>(null);
  const [audio, setAudio] = useState(false);
  const [lastAt, setLastAt] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const src = useRef<PanelSource | null>(null);

  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    store.set('zp3.settings', settings);
    const s: PanelSource =
      settings.mode === 'sim' ? new SimSource(settings.operator || 'demo') : new RemoteSource(settings.url, settings.token, settings.operator || 'operator');
    src.current = s;
    setView(undefined);
    const u1 = s.subscribe((v) => {
      setView(v);
      setLastAt(Date.now());
    });
    const u2 = s.onStatus(setStatus);
    return () => {
      u1();
      u2();
      s.close();
    };
  }, [settings]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const raw = useCallback(async (cmd: Command): Promise<CommandResult> => {
    const r = (await src.current?.send(cmd)) ?? { ok: false, message: 'No connection' };
    const quiet = cmd.t === 'key' && !['ACCEPT', 'RESET', 'SILENCE', 'SOUND', 'SOUNDERS', 'DAY_NIGHT'].includes(cmd.key);
    if (!quiet || !r.ok) setToast({ text: r.message, bad: !r.ok });
    return r;
  }, []);

  const access = view?.access ?? 1;
  // Last-known mode: the gateway is unreachable but we still hold its last view.
  const stale = settings.mode === 'remote' && status.state !== 'online' && !!view;
  const linkDown = !!view && !view.state.link.panel;

  const send = useCallback(
    (cmd: Command) => {
      if (stale) {
        setToast({ text: 'Not connected - showing last known status. Operate at the panel.', bad: true });
        return;
      }
      const d = describe(cmd);
      const needs2 = cmd.t === 'key' && ['RESET', 'SILENCE', 'SOUND', 'SOUNDERS', 'DAY_NIGHT'].includes(cmd.key);
      const needs3 = cmd.t === 'setDisabled' || cmd.t === 'bypass' || cmd.t === 'unbypass';
      if (!d) {
        void raw(cmd);
        return;
      }
      if (needs3 && access < 3) {
        setPw('');
        setConfirm({
          ...d,
          body: d.body + ' Needs access level 3 - enter the maintenance password.',
          password: true,
          run: async (p) => {
            const r = await raw({ t: 'login', password: p });
            if (r.ok) void raw(cmd);
          },
        });
        return;
      }
      if (needs2 && access < 2) {
        setConfirm({
          ...d,
          body: d.body + ' The key switch will be turned ON (access level 2) first.',
          ok: `Key ON + ${d.ok}`,
          run: async () => {
            const r = await raw({ t: 'keyswitch', on: true });
            if (r.ok) void raw(cmd);
          },
        });
        return;
      }
      setConfirm({ ...d, run: () => void raw(cmd) });
    },
    [access, raw, stale],
  );

  // Buzzer audio (only after the user turns it on - browsers need a click first).
  const actx = useRef<AudioContext | null>(null);
  const buzzing = !!view?.state.buzzer && audio;
  useEffect(() => {
    if (!buzzing) return;
    const ctx = actx.current ?? new AudioContext();
    actx.current = ctx;
    const beep = () => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 2900;
      g.gain.value = 0.04;
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.35);
    };
    beep();
    const t = setInterval(beep, 1000);
    return () => clearInterval(t);
  }, [buzzing]);

  const counts = view?.counts;
  const st = view?.state;
  const maintLeft = st && st.maintUntil > st.now ? Math.ceil((st.maintUntil - st.now) / 60000) : 0;
  const tabs = useMemo(
    () =>
      [
        ['mimic', 'Master mimic'],
        ['points', 'Diagnostics'],
        ['bypass', 'Bypass'],
        ['events', 'Event log'],
        ...(settings.mode === 'sim' || (status.state === 'online' && status.driver.includes('mock')) ? [['sim', 'Simulator']] : []),
        ['conn', 'Connection'],
      ] as [Tab, string][],
    [settings.mode, status],
  );
  const simAllowed = tabs.some(([t]) => t === 'sim');

  const select = (a: number) => {
    setSelected(a);
    setTab('points');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>ZP3 Remote Console</h1>
          <span>Main Alarm Panel · Node 01 · Ziton ZP3</span>
        </div>
        {counts && (
          <div className="chips" aria-label="Panel summary">
            <span className={'chip' + (counts.fire ? ' fire' : '')}>
              <i className="dot" /> Fire {counts.fire}
            </span>
            <span className={'chip' + (counts.fault ? ' fault' : '')}>
              <i className="dot" /> Fault {counts.fault}
            </span>
            <span className={'chip' + (counts.disabled ? ' disabled' : '')}>
              <i className="dot" /> Disabled {counts.disabled}
            </span>
            <span className={'chip' + (counts.other ? ' info' : '')}>
              <i className="dot" /> Other {counts.other}
            </span>
            {st && st.sounders !== 'off' && <span className="chip fire">Sounders {st.sounders}</span>}
            {st?.remoteAlarm && <span className="chip fire">DECAM signalled</span>}
            {st && !counts.fire && !counts.fault && <span className="chip ok"><i className="dot" /> System normal</span>}
          </div>
        )}
        <div className="spacer" />
        <div className="conn">
          <span
            className={'chip ' + (status.state === 'online' ? 'ok' : status.state === 'connecting' ? 'info' : 'fire')}
          >
            <i className="dot" />
            {status.state === 'online'
              ? `${status.driver} · ${status.role}`
              : status.state === 'connecting'
                ? 'Connecting…'
                : status.reason}
          </span>
          <span className="chip info">Level {access}</span>
        </div>
      </header>

      {!view ? (
        <div className="card card-b">
          {status.state === 'offline' ? (
            <>
              <p>
                Cannot reach the gateway at <span className="mono">{settings.url}</span>: {status.reason}
              </p>
              <button className="btn primary" onClick={() => setSettings({ ...settings, mode: 'sim' })}>
                Use the built-in simulator
              </button>
            </>
          ) : (
            'Connecting to panel…'
          )}
        </div>
      ) : (
        <>
        {stale && (
          <div className="banner bad" role="alert">
            Gateway not reachable. Showing last known status from {hhmm(lastAt)} ({Math.round((clock - lastAt) / 1000)} s ago). Controls are off;
            operate at the panel. {status.state === 'offline' ? status.reason : 'Reconnecting…'}
          </div>
        )}
        {linkDown && !stale && (
          <div className="banner" role="alert">
            Panel link down since {hhmm(view.state.link.since)}: the gateway gets no data from the panel (cable or interface card). Values
            are frozen and commands are blocked. Operate at the panel and call FPC (6258 5191, after hours 9126 1188).
          </div>
        )}
        {status.state === 'online' && status.backup && (
          <div className="banner">Main gateway down. Connected through the backup gateway ({status.url}).</div>
        )}
        <div className={'main' + (stale || linkDown ? ' stale' : '')}>
          <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
            <Panel view={view} send={send} />
            <section className="card">
              <div className="card-h">
                <h2>Remote operation</h2>
                <span className="muted small">
                  Operator: {settings.operator || '—'} · every action is logged
                </span>
              </div>
              <div className="card-b">
                <div className="actions">
                  <button className="act" onClick={() => send({ t: 'key', key: 'ACCEPT' })}>
                    <b>Accept</b>
                    <span>Mute panel buzzer · level 1</span>
                  </button>
                  <button className={'act warn' + (access < 2 ? ' locked' : '')} onClick={() => send({ t: 'key', key: 'SILENCE' })}>
                    <b>Silence</b>
                    <span>Stop sounders · level 2</span>
                  </button>
                  <button className={'act danger' + (access < 2 ? ' locked' : '')} onClick={() => send({ t: 'key', key: 'RESET' })}>
                    <b>Reset</b>
                    <span>Clear latched events · level 2</span>
                  </button>
                  <button className={'act danger' + (access < 2 ? ' locked' : '')} onClick={() => send({ t: 'key', key: 'SOUND' })}>
                    <b>Sound alarms</b>
                    <span>Evacuate · level 2</span>
                  </button>
                </div>
                <div className="access">
                  <button className="btn" onClick={() => send({ t: 'keyswitch', on: !st!.keySwitch })}>
                    Key switch: {st!.keySwitch ? 'ON' : 'OFF'}
                  </button>
                  {maintLeft ? (
                    <>
                      <span className="chip info">Maintenance · {maintLeft} min left</span>
                      <button className="btn sm" onClick={() => void raw({ t: 'logout' })}>
                        Log out
                      </button>
                    </>
                  ) : (
                    <form
                      className="row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void raw({ t: 'login', password: String(f.get('pw') ?? '') });
                        e.currentTarget.reset();
                      }}
                    >
                      <input id="maint-pw" name="pw" type="password" inputMode="numeric" placeholder="Maint. password" aria-label="Maintenance password" />
                      <button className="btn sm" type="submit">
                        Level 3 login
                      </button>
                    </form>
                  )}
                  <label className="row small" style={{ gap: 6 }}>
                    <input id="buzz-audio" type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
                    Play buzzer sound
                  </label>
                </div>
              </div>
            </section>
          </div>

          <section className="card">
            <div className="tabs" role="tablist">
              {tabs.map(([t, label]) => (
                <button key={t} role="tab" className="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                  {label}
                  {t === 'events' && <span className="n">{view.state.events.length}</span>}
                  {t === 'bypass' && view.state.bypasses.length > 0 && <span className="n">{view.state.bypasses.length}</span>}
                </button>
              ))}
            </div>
            <div className="card-b">
              {tab === 'mimic' && <Mimic view={view} send={send} onSelect={select} selected={selected} />}
              {tab === 'points' && <Points view={view} send={send} selected={selected} onSelect={setSelected} simAllowed={simAllowed} />}
              {tab === 'bypass' && <Bypass view={view} send={send} onSelect={select} />}
              {tab === 'events' && <Events events={view.state.events} />}
              {tab === 'sim' && <Simulator view={view} send={send} />}
              {tab === 'conn' && <Connection settings={settings} onApply={setSettings} status={status} view={view} lastAt={lastAt} now={clock} />}
            </div>
          </section>
        </div>
        </>
      )}

      {confirm && (
        <div className="scrim" onClick={() => setConfirm(null)}>
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cf-t"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              confirm.run(pw);
              setConfirm(null);
            }}
          >
            <h3 id="cf-t">{confirm.title}</h3>
            <p>{confirm.body}</p>
            {confirm.password && (
              <input
                id="cf-pw"
                autoFocus
                type="password"
                inputMode="numeric"
                placeholder="Maintenance password (demo 1234)"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--surface)' }}
              />
            )}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button type="submit" className={'btn ' + (confirm.danger ? 'danger' : 'primary')} autoFocus={!confirm.password}>
                {confirm.ok}
              </button>
            </div>
          </form>
        </div>
      )}
      {toast && <div className={'toast' + (toast.bad ? ' bad' : '')} role="status">{toast.text}</div>}
    </div>
  );
}

function Health({ status, view, lastAt, now, mode }: { status: ConnStatus; view: PanelView; lastAt: number; now: number; mode: Settings['mode'] }) {
  const sys = view.state.system;
  const age = Math.round((now - lastAt) / 1000);
  const appOk = mode === 'sim' || status.state === 'online';
  const rows: [string, 'ok' | 'bad' | 'warn', string, string][] = [
    [
      'App to gateway',
      appOk ? (status.state === 'online' && status.backup ? 'warn' : 'ok') : 'bad',
      mode === 'sim' ? 'Built-in simulator, no gateway needed' : status.state === 'online' ? `Online${status.backup ? ' via backup' : ''} · ${status.url ?? ''}` : status.state === 'offline' ? status.reason : 'Connecting…',
      appOk ? 'Connected' : 'Down',
    ],
    [
      'Gateway to panel (serial link)',
      view.state.link.panel ? 'ok' : 'bad',
      view.state.link.panel ? 'Receiving panel data' : `No data since ${hhmm(view.state.link.since)} - check cable and interface card`,
      view.state.link.panel ? 'Connected' : 'Down',
    ],
    ['Panel mains power', sys.mains ? 'ok' : 'bad', sys.mains ? '230 V supply present' : 'Running on batteries', sys.mains ? 'OK' : 'Failed'],
    ['Panel batteries', sys.batteryV >= 24 ? 'ok' : sys.batteryV >= 23 ? 'warn' : 'bad', `${sys.batteryV.toFixed(2)} V (2 × 12 V 18 Ah)`, sys.batteryV >= 23 ? 'OK' : 'Low'],
    view.state.link.panel
      ? ['Last update', age <= 5 ? 'ok' : age <= 30 ? 'warn' : 'bad', `${age} s ago`, age <= 5 ? 'Live' : 'Stale']
      : ['Last update', 'bad', `Panel data frozen since ${hhmm(view.state.link.since)}`, 'Frozen'],
  ];
  return (
    <div className="health">
      {rows.map(([name, st, detail, word]) => (
        <div className="hrow" key={name}>
          <i className={`hdot ${st}`} />
          <div style={{ minWidth: 0 }}>
            <b>{name}</b>
            <div className="muted small">{detail}</div>
          </div>
          <span className={`chip ${st === 'ok' ? 'ok' : st === 'warn' ? 'fault' : 'fire'}`}>{word}</span>
        </div>
      ))}
    </div>
  );
}

function Connection({
  settings,
  onApply,
  status,
  view,
  lastAt,
  now,
}: {
  settings: Settings;
  onApply: (s: Settings) => void;
  status: ConnStatus;
  view: PanelView;
  lastAt: number;
  now: number;
}) {
  const [s, setS] = useState(settings);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onApply({ ...s });
      }}
      style={{ display: 'grid', gap: 12 }}
    >
      <div className="section-t" style={{ marginTop: 0 }}>Connection health</div>
      <Health status={status} view={view} lastAt={lastAt} now={now} mode={settings.mode} />
      <div className="section-t">Settings</div>
      <div className="grid2">
        <label className="field">
          Data source
          <select id="cn-mode" value={s.mode} onChange={(e) => setS({ ...s, mode: e.target.value as Settings['mode'] })}>
            <option value="sim">Built-in simulator (demo, runs in this browser)</option>
            <option value="remote">Remote gateway (WebSocket)</option>
          </select>
        </label>
        <label className="field">
          Operator name (shown in the audit log)
          <input id="cn-op" value={s.operator} onChange={(e) => setS({ ...s, operator: e.target.value })} />
        </label>
        <label className="field">
          Gateway URLs (main first, backups after a comma)
          <input id="cn-url" className="mono" value={s.url} disabled={s.mode === 'sim'} onChange={(e) => setS({ ...s, url: e.target.value })} />
        </label>
        <label className="field">
          Access token
          <input id="cn-token" type="password" value={s.token} disabled={s.mode === 'sim'} onChange={(e) => setS({ ...s, token: e.target.value })} />
        </label>
      </div>
      <div className="row">
        <button className="btn primary" type="submit">
          Connect
        </button>
        <span className="muted small">
          Status: {status.state === 'online' ? `online · ${status.driver} · ${status.role}` : status.state === 'offline' ? status.reason : 'connecting'}
        </span>
      </div>
      <div className="note">
        If the main gateway stops answering, the app tries the next address in the list automatically. If none answers, it keeps
        showing the last known panel status, marked with its age, and blocks all commands. It never switches to simulated data while
        connected to a real panel.
      </div>
      <div className="note">
        The remote gateway (<span className="mono">npm run gateway</span>) streams the panel and accepts commands with token login,
        operator / viewer roles and an audit log. It currently drives the simulated ZP3. Connecting it to the real panel needs the
        panel interface and protocol from the maintenance contractor, and their and the Fire Safety Manager’s approval before
        remote reset, silence or disable are switched on.
      </div>
    </form>
  );
}

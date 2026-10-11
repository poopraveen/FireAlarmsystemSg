import { useState } from 'react';
import type { Command, SimMode } from '../engine/types.ts';
import type { PanelView } from '../engine/view.ts';

interface Props {
  view: PanelView;
  send: (cmd: Command) => void;
}

type Scenario = { title: string; body: string; cmds: Command[] };

const dev = (address: number, mode: SimMode): Command => ({ t: 'sim', action: { a: 'device', address, mode } });
const fix = (address: number): Command => ({ t: 'sim', action: { a: 'repair', address } });

const SCENARIOS: { group: string; items: Scenario[] }[] = [
  {
    group: 'Tonight’s site faults',
    items: [
      { title: 'Repair point 1011 wiring', body: 'Sprinkler pump 2 run input (Z100). Then press RESET.', cmds: [fix(1011)] },
      { title: 'Refit detector head 1029', body: '1st storey corridor smoke (Z001). Then RESET.', cmds: [fix(1029)] },
      { title: 'Reload site snapshot', body: 'Panel as photographed: 2 faults, 7 disabled.', cmds: [{ t: 'sim', action: { a: 'preset', name: 'site' } }] },
      { title: 'Clean system', body: 'No faults, nothing disabled.', cmds: [{ t: 'sim', action: { a: 'preset', name: 'clean' } }] },
    ],
  },
  {
    group: 'Fire alarms',
    items: [
      { title: 'Smoke - 2nd storey lobby', body: 'Point 1046 rises through pre-alarm to fire.', cmds: [dev(1046, 'smoke')] },
      { title: 'Callpoint - roof stair', body: 'Point 2091 glass broken. Immediate alarm.', cmds: [dev(2091, 'mcp')] },
      { title: 'Sprinkler flow - B1A', body: 'Flow switch 1006 operates.', cmds: [dev(1006, 'active')] },
      { title: 'Two-zone fire', body: 'Smoke in 7th storey unit 1 and 8th lobby.', cmds: [dev(2050, 'smoke'), dev(2007, 'smoke')] },
    ],
  },
  {
    group: 'Pumps and tanks (Z100)',
    items: [
      { title: 'Sprinkler pump 1 running', body: 'Input 1010 active.', cmds: [dev(1010, 'active')] },
      { title: 'Jockey pump trip', body: 'Input 1014 active.', cmds: [dev(1014, 'active')] },
      { title: 'Hosereel tank low level', body: 'Input 1022 active.', cmds: [dev(1022, 'active')] },
      { title: 'Pumps back to normal', body: 'Restore 1010, 1014, 1022.', cmds: [fix(1010), fix(1014), fix(1022)] },
    ],
  },
  {
    group: 'Device and system faults',
    items: [
      { title: 'Dirty detector - B1A MDF', body: 'Point 1008 contaminated.', cmds: [dev(1008, 'dirty')] },
      { title: 'Mains failure', body: 'Panel runs on the 2 × 12V 18Ah batteries.', cmds: [{ t: 'sim', action: { a: 'mains', ok: false } }] },
      { title: 'Mains restored', body: 'Charger recovers the batteries.', cmds: [{ t: 'sim', action: { a: 'mains', ok: true } }] },
      { title: 'Battery low', body: 'Battery set to 22.4V.', cmds: [{ t: 'sim', action: { a: 'battery', volts: 22.4 } }] },
      { title: 'Earth fault', body: 'Wiring earth leakage.', cmds: [{ t: 'sim', action: { a: 'earth', fault: true } }] },
      { title: 'Clear earth fault', body: '', cmds: [{ t: 'sim', action: { a: 'earth', fault: false } }] },
      { title: 'Panel link lost', body: 'Serial cable unplugged: data freezes, commands blocked.', cmds: [{ t: 'sim', action: { a: 'link', ok: false } }] },
      { title: 'Panel link restored', body: 'Cable back in: live data resumes.', cmds: [{ t: 'sim', action: { a: 'link', ok: true } }] },
    ],
  },
];

const MODES: SimMode[] = ['normal', 'smoke', 'heat', 'mcp', 'active', 'openCircuit', 'headRemoved', 'dirty'];

export function Simulator({ view, send }: Props) {
  const [addr, setAddr] = useState('1046');
  const [mode, setMode] = useState<SimMode>('smoke');
  const s = view.state.system;
  return (
    <div>
      <div className="row small muted" style={{ gap: 14 }}>
        <span>Mains: <b style={{ color: s.mains ? 'var(--ok)' : 'var(--fire)' }}>{s.mains ? 'OK' : 'FAILED'}</b></span>
        <span>Battery: <b className="mono">{s.batteryV.toFixed(2)} V</b></span>
        <span>Earth: <b>{s.earthFault ? 'FAULT' : 'OK'}</b></span>
        <span>Day/Night: <b>{view.state.dayMode ? 'Day (30s delay)' : 'Night'}</b></span>
      </div>
      {SCENARIOS.map((g) => (
        <div key={g.group}>
          <div className="section-t">{g.group}</div>
          <div className="scen">
            {g.items.map((it) => (
              <button key={it.title} onClick={() => it.cmds.forEach(send)}>
                <b>{it.title}</b>
                {it.body && <span>{it.body}</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="section-t">Any device</div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const a = Number(addr);
          if (a) send(mode === 'normal' ? fix(a) : dev(a, mode));
        }}
      >
        <input id="sim-addr" className="mono" style={{ width: 90, padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--surface)' }} value={addr} onChange={(e) => setAddr(e.target.value.replace(/\D/g, ''))} aria-label="Point address" />
        <select id="sim-mode" value={mode} onChange={(e) => setMode(e.target.value as SimMode)} style={{ padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--surface)' }} aria-label="Condition">
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button className="btn primary" type="submit">
          Apply
        </button>
      </form>
    </div>
  );
}

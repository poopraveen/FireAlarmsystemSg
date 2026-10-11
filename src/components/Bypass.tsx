import { useState } from 'react';
import { hhmm } from '../engine/lcd.ts';
import type { Command, Point } from '../engine/types.ts';
import type { PanelView } from '../engine/view.ts';

interface Props {
  view: PanelView;
  send: (cmd: Command) => void;
  onSelect: (address: number) => void;
}

const DURATIONS: [number, string][] = [
  [60, '1 hour'],
  [240, '4 hours'],
  [480, '8 hours'],
  [720, '12 hours'],
  [1440, '24 hours'],
];
const REASONS = [
  'Detector faulty - awaiting FPC replacement',
  'Wiring / open circuit - awaiting FPC repair',
  'Contractor works nearby (dust, heat, steam)',
  'Device removed for maintenance',
];

function left(ms: number) {
  if (ms <= 0) return 'expiring';
  const m = Math.ceil(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${m} min left`;
}

function Row({ p, send, onSelect }: { p: Point; send: Props['send']; onSelect: Props['onSelect'] }) {
  const [mins, setMins] = useState(240);
  const [reason, setReason] = useState(REASONS[p.type === 'input' || p.type === 'flow' ? 1 : 0]);
  return (
    <div className="byp-row">
      <button className="byp-name" onClick={() => onSelect(p.address)}>
        <b className="mono">{p.address}</b> <span className="cond Fault">Fault</span>
        <span className="muted small"> {p.desc}</span>
        {p.faultText && <span className="small"> · {p.faultText}</span>}
      </button>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          send({ t: 'bypass', addr: p.address, reason, minutes: mins });
        }}
      >
        <select id={`byp-r-${p.address}`} aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select id={`byp-d-${p.address}`} aria-label="Duration" value={mins} onChange={(e) => setMins(Number(e.target.value))}>
          {DURATIONS.map(([m, l]) => (
            <option key={m} value={m}>
              {l}
            </option>
          ))}
        </select>
        <button className="btn sm danger" type="submit">
          Bypass
        </button>
      </form>
    </div>
  );
}

export function Bypass({ view, send, onSelect }: Props) {
  const s = view.state;
  const bypassed = new Set(s.bypasses.map((b) => b.address));
  const faulty = s.points.filter((p) => p.cond === 'Fault' && !p.disabled && !bypassed.has(p.address));
  const panelDisabled = s.points.filter((p) => p.disabled && !bypassed.has(p.address));
  const pt = (a: number) => s.points.find((p) => p.address === a)!;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="note">
        A bypass stops one faulty device from reporting, so its fault stops holding the panel in fault. A bypassed device will
        <b> not detect fire</b>. Every bypass needs a reason, ends automatically, and is logged with your name. Repair the device
        with FPC before the bypass ends.
      </div>

      <section>
        <div className="section-t">Faulty devices ({faulty.length})</div>
        {faulty.length === 0 ? (
          <p className="muted">No devices in fault.</p>
        ) : (
          <div className="byp-list">
            {faulty.map((p) => (
              <Row key={p.address} p={p} send={send} onSelect={onSelect} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="section-t">Active bypasses ({s.bypasses.length})</div>
        {s.bypasses.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Point</th>
                  <th>Location</th>
                  <th>Reason</th>
                  <th>By</th>
                  <th>Ends</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {s.bypasses.map((b) => (
                  <tr key={b.address} onClick={() => onSelect(b.address)}>
                    <td className="mono">{b.address}</td>
                    <td>{pt(b.address).desc}</td>
                    <td>{b.reason}</td>
                    <td>{b.by}</td>
                    <td>
                      <span className="mono">{hhmm(b.until)}</span>
                      <div className="muted small">{left(b.until - s.now)}</div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <button className="btn sm" onClick={() => send({ t: 'bypass', addr: b.address, reason: b.reason, minutes: 240 })}>
                          +4 h
                        </button>
                        <button className="btn sm primary" onClick={() => send({ t: 'unbypass', addr: b.address })}>
                          Restore
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="section-t">Disabled at the panel ({panelDisabled.length})</div>
        <p className="muted small" style={{ margin: '0 0 6px' }}>
          Disabled by the maintenance contractor, with no time limit. Re-enable them from Diagnostics once repaired.
        </p>
        <div className="row">
          {panelDisabled.map((p) => (
            <button key={p.address} className="chip disabled" onClick={() => onSelect(p.address)} title={p.desc}>
              {p.address}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

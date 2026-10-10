import { useEffect, useMemo, useRef, useState } from 'react';
import type { Command, Point, SimMode } from '../engine/types.ts';
import type { PanelView } from '../engine/view.ts';

interface Props {
  view: PanelView;
  send: (cmd: Command) => void;
  selected?: number;
  onSelect: (address: number) => void;
  simAllowed: boolean;
}

const TYPE: Record<Point['type'], string> = {
  smoke: 'Smoke',
  heat: 'Heat',
  mcp: 'Callpoint',
  input: 'Input module',
  flow: 'Flow switch',
  output: 'Output',
};

const CH = ['A1 live', 'A2 previous', 'A3 compensation', 'A4 status', 'A5 type code', 'A6 flags'];

function Cond({ p }: { p: Point }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      <span className={`cond ${p.cond}`}>{p.cond === 'PreAlarm' ? 'Pre-alarm' : p.cond}</span>
      {p.disabled && <span className="cond Disabled">Disabled</span>}
    </span>
  );
}

function Spark({ data, thresh }: { data: number[]; thresh: number }) {
  const W = 320;
  const H = 90;
  const max = Math.max(thresh * 1.25, ...data, 50);
  const x = (i: number) => (data.length < 2 ? W : (i / (data.length - 1)) * (W - 30) + 28);
  const y = (v: number) => H - 6 - (v / max) * (H - 14);
  const path = data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = data[data.length - 1] ?? 0;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Analog A1 history, latest ${last}`}>
      <line x1="28" x2={W} y1={y(thresh)} y2={y(thresh)} stroke="var(--fire)" strokeDasharray="4 3" strokeWidth="1" />
      <text x="0" y={y(thresh) + 3} fontSize="9" fill="var(--fire)">
        {thresh}
      </text>
      <line x1="28" x2={W} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth="1" />
      <text x="0" y={y(0) + 3} fontSize="9" fill="var(--muted)">
        0
      </text>
      {data.length > 1 && (
        <>
          <path d={`${path}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill="var(--accent)" opacity="0.12" />
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.6" />
          <circle cx={x(data.length - 1)} cy={y(last)} r="3" fill="var(--accent)" />
        </>
      )}
    </svg>
  );
}

const SIM_FOR: Record<Point['type'], [SimMode, string][]> = {
  smoke: [
    ['smoke', 'Smoke in chamber'],
    ['dirty', 'Contaminated'],
    ['headRemoved', 'Remove head'],
  ],
  heat: [
    ['heat', 'Heat rise'],
    ['headRemoved', 'Remove head'],
  ],
  mcp: [
    ['mcp', 'Break glass'],
    ['headRemoved', 'Remove device'],
  ],
  input: [
    ['active', 'Operate contact'],
    ['openCircuit', 'Open circuit'],
    ['headRemoved', 'Remove module'],
  ],
  flow: [
    ['active', 'Water flowing'],
    ['openCircuit', 'Open circuit'],
  ],
  output: [],
};

export function Points({ view, send, selected, onSelect, simAllowed }: Props) {
  const [q, setQ] = useState('');
  const [zone, setZone] = useState('all');
  const [status, setStatus] = useState('all');
  const hist = useRef(new Map<number, number[]>());
  const { points, zones } = view.state;

  // Keep a rolling A1 history for every point (one sample per view update).
  useEffect(() => {
    for (const p of view.state.points) {
      const h = hist.current.get(p.address) ?? [];
      h.push(p.analogs[0]);
      if (h.length > 90) h.shift();
      hist.current.set(p.address, h);
    }
  }, [view.state.tick, view.state.points]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return points.filter((p) => {
      if (zone !== 'all' && String(p.zone) !== zone) return false;
      if (status === 'attention' && p.cond === 'Normal' && !p.disabled) return false;
      if (status === 'disabled' && !p.disabled) return false;
      if (status !== 'all' && status !== 'attention' && status !== 'disabled' && p.cond !== status) return false;
      if (!s) return true;
      return `${p.address} ${p.ref} ${p.desc} ${p.id}`.toLowerCase().includes(s);
    });
  }, [points, q, zone, status]);

  const sel = points.find((p) => p.address === selected);
  const zname = (n: number) => zones.find((z) => z.number === n)?.name ?? '';

  return (
    <div>
      <div className="filters">
        <input id="pt-search" placeholder="Search address, ref or location" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search points" />
        <select id="pt-zone" value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zone">
          <option value="all">All zones</option>
          {zones.map((z) => (
            <option key={z.number} value={z.number}>
              Z{String(z.number).padStart(3, '0')} {z.name}
            </option>
          ))}
        </select>
        <select id="pt-status" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="all">All status</option>
          <option value="attention">Needs attention</option>
          <option value="Fire">Fire</option>
          <option value="Fault">Fault</option>
          <option value="Active">Active</option>
          <option value="PreAlarm">Pre-alarm</option>
          <option value="disabled">Disabled</option>
        </select>
        <span className="muted small" style={{ alignSelf: 'center' }}>
          {rows.length} of {points.length} points
        </span>
      </div>

      {sel && (
        <div className="detail" style={{ marginTop: 0, marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <h3>
                Point {sel.address} · {sel.ref}
              </h3>
              <div className="muted small">
                Z{String(sel.zone).padStart(3, '0')} {zname(sel.zone)} · {TYPE[sel.type]} · ID “{sel.id}” · {sel.desc}
              </div>
            </div>
            <Cond p={sel} />
          </div>
          {sel.faultText && sel.cond === 'Fault' && <div className="note">{sel.faultText}</div>}
          <div className="kv">
            {sel.analogs.map((a, i) => (
              <div key={i}>
                <label>{CH[i]}</label>
                <b>{String(a).padStart(3, '0')}</b>
              </div>
            ))}
            <div>
              <label>Threshold</label>
              <b>{sel.thresh}</b>
            </div>
            <div>
              <label>Sensitivity</label>
              <b>{sel.sens}</b>
            </div>
          </div>
          <Spark data={hist.current.get(sel.address) ?? [sel.analogs[0]]} thresh={sel.thresh} />
          <div className="row">
            <button
              className="btn sm"
              onClick={() => send({ t: 'setDisabled', target: 'point', addr: sel.address, disabled: !sel.disabled })}
            >
              {sel.disabled ? 'Enable point' : 'Disable point'}
            </button>
            {simAllowed &&
              SIM_FOR[sel.type].map(([m, label]) => (
                <button key={m} className="btn sm" onClick={() => send({ t: 'sim', action: { a: 'device', address: sel.address, mode: m } })}>
                  Sim: {label}
                </button>
              ))}
            {simAllowed && (
              <button className="btn sm primary" onClick={() => send({ t: 'sim', action: { a: 'repair', address: sel.address } })}>
                Repair device
              </button>
            )}
          </div>
        </div>
      )}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Point</th>
              <th>Ref</th>
              <th>Zone</th>
              <th>Type</th>
              <th>Location</th>
              <th>A1</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const pct = Math.min(100, (p.analogs[0] / Math.max(p.thresh, 1)) * 100);
              return (
                <tr key={p.address} className={p.address === selected ? 'sel' : ''} onClick={() => onSelect(p.address)}>
                  <td className="mono">{p.address}</td>
                  <td>{p.ref}</td>
                  <td className="mono">{String(p.zone).padStart(3, '0')}</td>
                  <td>{TYPE[p.type]}</td>
                  <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.desc}</td>
                  <td>
                    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <span className="mono">{String(p.analogs[0]).padStart(3, '0')}</span>
                      <span className="bar">
                        <i className={p.cond === 'Fire' ? 'hot' : p.cond === 'Fault' ? 'bad' : ''} style={{ width: `${pct}%` }} />
                      </span>
                    </span>
                  </td>
                  <td>
                    <Cond p={p} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

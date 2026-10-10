import { useEffect, useState } from 'react';
import { ORDINAL } from '../engine/preset.ts';
import type { Command, Point } from '../engine/types.ts';
import type { PanelView } from '../engine/view.ts';
import './mimic.css';

interface Props {
  view: PanelView;
  send: (cmd: Command) => void;
  onSelect: (address: number) => void;
  selected?: number;
}

type Tone = 'fire' | 'fault' | 'active' | 'pre' | 'off';

function tone(p: Point): Tone {
  if (p.cond === 'Fire') return 'fire';
  if (p.cond === 'Fault') return 'fault';
  if (p.cond === 'Active') return 'active';
  if (p.cond === 'PreAlarm') return 'pre';
  return 'off';
}

const COLS = ['Lobby MCP', 'Lobby SD', 'Elect', 'Tel', 'Unit 1 PLL', 'Unit 2 PLL', 'Unit 3 PLL', 'Unit 4 PLL', 'Stair 5'];

export function Mimic({ view, send, onSelect, selected }: Props) {
  const [lampTest, setLampTest] = useState(false);
  const pts = view.state.points;
  const byRef = new Map(pts.map((p) => [p.ref, p]));
  const byAddr = new Map(pts.map((p) => [p.address, p]));
  const lampTestPanel = view.state.lampTestUntil > view.state.now;
  const lit = lampTest || lampTestPanel;

  useEffect(() => {
    if (!lampTest) return;
    const t = setTimeout(() => setLampTest(false), 4000);
    return () => clearTimeout(t);
  }, [lampTest]);

  const Led = ({ p }: { p?: Point }) => {
    if (!p) return <span className="mled none" />;
    const t = lit ? 'fire' : tone(p);
    return (
      <button
        className={`mled ${t}${p.disabled ? ' dis' : ''}${p.address === selected ? ' sel' : ''}`}
        title={`${p.ref} · ${p.address} · ${p.desc} · ${p.disabled ? 'DISABLED · ' : ''}${p.cond}`}
        aria-label={`${p.ref} point ${p.address} ${p.desc} ${p.cond}${p.disabled ? ' disabled' : ''}`}
        onClick={() => onSelect(p.address)}
      />
    );
  };

  const StatusTable = ({ title, rows }: { title: string; rows: number[] }) => (
    <div className="mtable">
      <h4>{title}</h4>
      {rows.map((a) => {
        const p = byAddr.get(a)!;
        return (
          <div key={a} className={'mrow' + (p.address === selected ? ' sel' : '')} onClick={() => onSelect(a)}>
            <span className="mdesc">{p.desc}</span>
            <Led p={p} />
            <span className="maddr">{a}</span>
          </div>
        );
      })}
    </div>
  );

  const floorDevices = (zone: number) => pts.filter((p) => p.zone === zone);

  return (
    <div className="mimic">
      <div className="mhead">
        <div className="legend">
          <span>
            <i className="mled fire" /> Fire
          </span>
          <span>
            <i className="mled fault" /> Fault
          </span>
          <span>
            <i className="mled active" /> Running / active
          </span>
          <span>
            <i className="mled pre" /> Pre-alarm
          </span>
          <span>
            <i className="mled off dis" /> Disabled
          </span>
          <span>
            <i className="sys-on" /> System on
          </span>
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => setLampTest(true)}>
            Mimic lamp test
          </button>
          <button className="btn sm" onClick={() => send({ t: 'key', key: 'LAMP_TEST' })}>
            Panel lamp test
          </button>
        </div>
      </div>

      <div className="mgrid">
        <StatusTable title="Sprinkler pumps / tank status" rows={[1010, 1011, 1012, 1013, 1014, 1015, 1016]} />
        <StatusTable title="Hosereel pumps / tank status" rows={[1017, 1018, 1019, 1020, 1021, 1022, 1023]} />
        <StatusTable title="Sprinkler control valve status" rows={[1032]} />
      </div>

      <h4 className="mt">2nd to 12th storey addressing</h4>
      <div className="floorwrap">
        <table className="floors">
          <thead>
            <tr>
              <th />
              {COLS.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 11 }, (_, i) => 12 - i).map((n) => (
              <tr key={n}>
                <th>{ORDINAL[n]} STY</th>
                {COLS.map((_, c) => {
                  const p = byRef.get(`Z${n}-${c + 1}`);
                  return (
                    <td key={c}>
                      <div className="fcell">
                        <Led p={p} />
                        <span>
                          {p?.ref}
                          <br />
                          {p?.address}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mgrid">
        {[
          [13, 'Roof plan'],
          [1, '1st storey plan (you are here)'],
          [16, 'Basement 1A'],
          [15, 'Basement 2A'],
          [14, 'Basement 3A'],
        ].map(([z, title]) => (
          <div className="mtable" key={z}>
            <h4>{title}</h4>
            {floorDevices(z as number).map((p) => (
              <div key={p.address} className={'mrow' + (p.address === selected ? ' sel' : '')} onClick={() => onSelect(p.address)}>
                <span className="mdesc">
                  {p.ref} · {p.type === 'mcp' ? 'Callpoint' : p.type === 'flow' ? 'Flow switch' : p.type === 'heat' ? 'Heat' : 'Smoke'} ·{' '}
                  {p.desc.replace(/^(1ST STY|ROOF|B\dA) /, '')}
                </span>
                <Led p={p} />
                <span className="maddr">{p.address}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { stamp } from '../engine/lcd.ts';
import type { PanelEvent } from '../engine/types.ts';

const GROUPS: Record<string, (e: PanelEvent) => boolean> = {
  all: () => true,
  alarms: (e) => e.kind === 'FIRE' || e.kind === 'PRE-ALARM' || e.kind === 'FAULT' || e.kind === 'ACTIVE' || e.kind === 'CLEAR',
  operator: (e) => ['RESET', 'SILENCE', 'SOUND', 'ACCEPT', 'ACCESS', 'DISABLE', 'ENABLE'].includes(e.kind),
  remote: (e) => e.actor.includes('remote') || e.actor.includes('web'),
};

export function Events({ events }: { events: PanelEvent[] }) {
  const [g, setG] = useState('all');
  const list = events.filter(GROUPS[g]);
  return (
    <div>
      <div className="filters">
        <select id="ev-filter" value={g} onChange={(e) => setG(e.target.value)} aria-label="Filter events">
          <option value="all">All events</option>
          <option value="alarms">Fire, fault and status</option>
          <option value="operator">Operator actions</option>
          <option value="remote">Remote actions only (audit)</option>
        </select>
        <span className="muted small" style={{ alignSelf: 'center' }}>
          {list.length} events · newest first
        </span>
      </div>
      <div className="tablewrap">
        {list.map((e) => (
          <div className="ev" key={e.seq}>
            <time>{stamp(e.time)}</time>
            <span className={`evk ${e.kind}`}>{e.kind}</span>
            <span style={{ minWidth: 0 }}>
              {e.text}
              {e.detail && <span className="muted"> · {e.detail}</span>}
              <span className="muted small"> · by {e.actor}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

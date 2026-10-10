// A PanelView is everything a remote client needs to draw the panel: the raw
// state plus the rendered LCD, LED states and counts. The gateway streams this,
// and the in-browser simulator produces the same object, so both look identical.
import type { PanelEngine } from './engine.ts';
import { renderLcd } from './lcd.ts';
import type { Led, Leds, PanelState } from './types.ts';

export interface PanelView {
  state: PanelState;
  lcd: string[];
  leds: Leds;
  counts: { fire: number; fault: number; disabled: number; other: number };
  access: 1 | 2 | 3;
  selected?: number;
}

const L = (on: boolean, flash = false): Led => (on ? (flash ? 2 : 1) : 0);

export function deriveLeds(eng: PanelEngine): Leds {
  const s = eng.state;
  const pts = s.points;
  const sysFault = Object.keys(s.systemFaultSince).length > 0;
  const anyFire = pts.some((p) => p.latchedFire);
  const anyFault = sysFault || pts.some((p) => p.latchedFault);
  const unaccFire = pts.some((p) => (p.latchedFire ?? 0) > s.lastAcceptAt);
  const unaccFault =
    pts.some((p) => (p.latchedFault ?? 0) > s.lastAcceptAt) ||
    Object.values(s.systemFaultSince).some((t) => t > s.lastAcceptAt);
  const ptDisabled = pts.some((p) => p.disabled);
  const zoneDisabled = s.zones.some((z) => z.disabled);
  const active = pts.some((p) => p.cond === 'Active');
  const prealm = pts.some((p) => p.cond === 'PreAlarm');
  const delayed = s.delayUntil > 0;
  const outputs = s.remoteAlarm || s.sounders === 'active';

  const leds: Leds = {
    fire: L(anyFire, unaccFire),
    fault: L(anyFault, unaccFault),
    disabled: L(ptDisabled || zoneDisabled || !s.soundersEnabled),
    other: L(active || prealm || !s.soundersEnabled || delayed),
    silence: L(s.sounders === 'silenced'),
    sound: L(s.sounders === 'active', true),
    power: L(true, !s.system.mains),
    night: L(!s.dayMode),
    day: L(s.dayMode),
    moreTime: L(delayed, true),
    enableSounders: L(s.soundersEnabled),
    matrix: {
      system: { active: 0, fault: L(sysFault), disable: 0, delayed: 0, prealm: 0, test: 0 },
      zone: {
        active: L(anyFire, unaccFire),
        fault: L(pts.some((p) => p.latchedFault)),
        disable: L(zoneDisabled || ptDisabled),
        delayed: L(delayed),
        prealm: L(prealm),
        test: 0,
      },
      point: {
        active: L(anyFire || active),
        fault: L(pts.some((p) => p.latchedFault)),
        disable: L(ptDisabled),
        delayed: L(delayed),
        prealm: L(prealm),
        test: 0,
      },
      sounders: { active: L(s.sounders === 'active', true), fault: 0, disable: L(!s.soundersEnabled), delayed: L(delayed), prealm: 0, test: 0 },
      remote: { active: L(s.remoteAlarm), fault: 0, disable: 0, delayed: L(delayed), prealm: 0, test: 0 },
      outputs: { active: L(outputs), fault: 0, disable: 0, delayed: L(delayed), prealm: 0, test: 0 },
    },
  };

  if (s.lampTestUntil > s.now) {
    const all = (o: Record<string, unknown>) => {
      for (const k of Object.keys(o)) {
        if (typeof o[k] === 'object') all(o[k] as Record<string, unknown>);
        else o[k] = 1;
      }
    };
    all(leds as unknown as Record<string, unknown>);
    leds.matrix.system.test = 1;
  }
  return leds;
}

export function buildView(eng: PanelEngine): PanelView {
  return {
    state: eng.snapshot(),
    lcd: renderLcd(eng),
    leds: deriveLeds(eng),
    counts: eng.counts(),
    access: eng.accessLevel(),
    selected: eng.selectedPoint()?.address,
  };
}

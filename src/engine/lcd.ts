// Renders the 4 x 40 character LCD exactly as the ZP3 front panel lays it out.
import type { PanelEngine, ListEntry } from './engine.ts';
import type { ListKind, PanelState, Point } from './types.ts';

export const LCD_W = 40;

const fit = (s: string) => (s.length > LCD_W ? s.slice(0, LCD_W) : s.padEnd(LCD_W));
/** Left text and right-aligned text on one 40-char line. */
export const lr = (l: string, r: string) => {
  const room = LCD_W - r.length - 1;
  return fit((l.length > room ? l.slice(0, room) : l.padEnd(room)) + ' ' + r);
};
const n3 = (n: number) => String(n).padStart(3, '0');
const n4 = (n: number) => String(n).padStart(4, '0');
const p2 = (n: number) => String(n).padStart(2, '0');

export function hhmm(t: number) {
  const d = new Date(t);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
export function stamp(t: number) {
  const d = new Date(t);
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const TITLE: Record<ListKind, string> = { fire: 'FIRE', fault: 'FAULT', disabled: 'DISABLED', other: 'OTHER' };

export function condText(p: Point) {
  return p.cond === 'PreAlarm' ? 'PreAlm' : p.cond;
}

function entryLine(kind: ListKind, i: number, e: ListEntry | undefined, mode: 'zones' | 'points'): string {
  if (!e) return fit('');
  const no = n3(i + 1);
  if (e.system) return lr(`${no} SYS  ${e.system}`, e.time ? hhmm(e.time) : '');
  if (mode === 'zones' && kind !== 'disabled' && e.zone) return lr(`${no} Z${n3(e.zone.number)} ${e.zone.name}`, hhmm(e.time));
  if (kind === 'disabled' && !e.point && e.zone) return lr(`${no} Z${n3(e.zone.number)} ${e.zone.name}`, 'ZONE');
  const p = e.point!;
  const right = kind === 'disabled' ? 'DISABLED' : hhmm(e.time);
  return lr(`${no} ${p.address} Z${n3(p.zone)} ${p.id === 'Smoke' || p.id === 'MCP' || p.id === 'Heat' || p.id === 'Flow SW' || p.id === 'Input' ? p.desc : p.id}`, right);
}

export function renderLcd(eng: PanelEngine): string[] {
  const s: PanelState = eng.state;
  if (s.lampTestUntil > s.now) return Array(4).fill('█'.repeat(LCD_W));
  let sc = s.screen;
  if (sc.s === 'message') return [0, 1, 2, 3].map((i) => fit(sc.s === 'message' ? (sc.lines[i] ?? '') : ''));
  if (sc.s === 'auto') sc = eng.autoScreen();

  switch (sc.s) {
    case 'auto': {
      const d = new Date(s.now);
      const c = eng.counts();
      const lvl = eng.accessLevel();
      return [
        lr(`${s.model}  PANEL ${n3(s.panelNo)}`, `NODE ${p2(s.nodeNo)}`),
        fit(c.disabled ? `SYSTEM NORMAL - ${c.disabled} DISABLEMENT${c.disabled > 1 ? 'S' : ''}` : 'SYSTEM NORMAL'),
        lr(s.dayMode ? 'DAY MODE' : 'NIGHT MODE', `Access Level ${lvl}`),
        lr(`${DAYS[d.getDay()]} ${p2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`, `${hhmm(s.now)}:${p2(d.getSeconds())}`),
      ];
    }
    case 'list': {
      const items = eng.list(sc.kind, sc.mode);
      const label = sc.kind === 'disabled' ? (sc.mode === 'points' ? '(Points)' : '(Zones)') : sc.mode === 'zones' ? '(Zones)' : '(Points)';
      const title = TITLE[sc.kind];
      const total = `Total:${n3(items.length)}`;
      const bar = '='.repeat(LCD_W - 11 - 2) + '>';
      return [
        lr(title.padEnd(11) + label, total),
        entryLine(sc.kind, sc.idx, items[sc.idx], sc.mode),
        entryLine(sc.kind, sc.idx + 1, items[sc.idx + 1], sc.mode),
        fit(title.padEnd(11) + (items.length ? bar : 'NONE')),
      ];
    }
    case 'viewpoints': {
      const p = s.points[sc.idx];
      return [
        lr(`VIEW POINTS: PANEL ${n3(s.panelNo)}`, `(${n4(sc.idx + 1)} of ${n4(s.points.length)})`),
        lr(`Point : ${p.address}  Zone: ${p.zone}`, p.ref),
        fit(`ID: ${p.id}  ${p.desc}`),
        lr(`Status: ${condText(p)}${p.disabled ? ' [DISABLED]' : ''}`, `Value:${n3(p.analogs[0])}`),
      ];
    }
    case 'repdisp': {
      const p = s.points[sc.idx];
      return [
        fit(`MAINT: REP. DISP: PANEL ${n3(s.panelNo)} PNT ANALOGS`),
        fit(`Point: ${p.address}`.padEnd(17) + `ID ${p.id}`),
        fit(`Thresh:${p.thresh}`.padEnd(17) + `Sens:${p.sens}`.padEnd(12) + `Cond:${condText(p)}`),
        fit(`Analogs:${p.analogs.map(n3).join(' ')}`),
      ];
    }
    case 'viewdisabled': {
      const items = eng.list('disabled', 'points');
      const e = items[sc.idx];
      if (!e?.point) return [fit('MAINTENANCE: VIEW DISABLED: POINTS'), fit('No points disabled'), fit(''), fit('')];
      const p = e.point;
      return [
        fit('MAINTENANCE: VIEW DISABLED: POINTS'),
        lr(`Point : ${p.address}  Zone: ${p.zone}`, `(${n4(sc.idx + 1)} of ${n4(items.length)})`),
        fit(`Config: [${'Disabled'.padEnd(26)}]`),
        fit(`Status: [${p.latchedFault ? 'Disabled/Fault' : 'Disabled'}]`),
      ];
    }
    case 'help':
      return [
        lr('HELP', `Access Level ${eng.accessLevel()}`),
        fit('FIRE/FAULT/DISABLED/OTHER: view lists'),
        fit('MORE up/dn: scroll  F1: zones/points'),
        fit('VIEW POINTS: browse  MENU: maintenance'),
      ];
    case 'menu':
      return [
        lr('MAIN MENU', `Level ${eng.accessLevel()}`),
        fit('1 View Event Log     2 Lamp Test'),
        fit('3 Maintenance        4 Day/Night'),
        fit('Press 1-4, ESC to exit'),
      ];
    case 'password':
      return [
        fit('MAINTENANCE - ACCESS LEVEL 3'),
        fit(`Enter Password: ${'*'.repeat(sc.buf.length)}_`),
        fit(''),
        fit('ENTER to confirm, ESC to cancel'),
      ];
    case 'maint':
      return [
        lr('MAINTENANCE MENU', 'Level 3'),
        fit('1 Edit Disable       2 Rep. Display'),
        fit('3 View Disabled      4 Event Log'),
        fit('Press 1-4, ESC back, HOME to home'),
      ];
    case 'editdis':
      return [fit('MAINTENANCE: EDIT DISABLE'), fit('1 Disable/Enable Point'), fit('2 Disable/Enable Zone'), fit('Press 1 or 2, ESC back')];
    case 'enteraddr':
      return [
        fit(sc.purpose === 'repdisp' ? 'MAINT: REP. DISP: ENTER POINT' : `EDIT DISABLE: ${sc.target.toUpperCase()}`),
        fit(`Enter Address: ${sc.buf}_`),
        fit(sc.target === 'point' ? '[XXX-]XXXX  Panel No - Point Address' : '[XXX-]XXX  Panel No - Zone Address'),
        fit('ENTER to confirm, ESC back'),
      ];
    case 'confirmdis': {
      const isPt = sc.target === 'point';
      const p = isPt ? eng.point(sc.addr) : undefined;
      const z = isPt ? eng.zone(p!.zone) : eng.zone(sc.addr);
      const cur = isPt ? p!.disabled : z!.disabled;
      return [
        lr(isPt ? `EDIT DISABLE: POINT ${sc.addr}` : `EDIT DISABLE: ZONE ${sc.addr}`, isPt ? `Zone: ${p!.zone}` : ''),
        fit(isPt ? `ID: ${p!.id}  ${p!.desc}` : z!.name),
        lr(`Currently: [${cur ? 'Disabled' : 'Enabled '}]`, `Select: ${sc.choice === 1 ? 'DISABLE' : sc.choice === 2 ? 'ENABLE ' : '-      '}`),
        fit('1 Disable  2 Enable  ENTER to confirm'),
      ];
    }
    case 'eventlog': {
      const ev = s.events[sc.idx];
      if (!ev) return [fit('EVENT LOG'), fit('No events'), fit(''), fit('')];
      return [
        lr('EVENT LOG', `(${n4(sc.idx + 1)} of ${n4(s.events.length)})`),
        lr(stamp(ev.time), ev.kind),
        fit(ev.text),
        lr(ev.detail ?? '', `by ${ev.actor}`),
      ];
    }
    default:
      return Array(4).fill(fit(''));
  }
}

// Behavioural model of the Ziton ZP3 main alarm panel used for the demo.
// It mirrors the real panel's operator workflow: access levels (key switch /
// maintenance password), latching fire & fault, accept, silence, sound, reset,
// investigation delay (day mode), disablements, and the LCD menu system.
import { SITE_DISABLED, buildPoints, buildZones, siteFaultTime } from './preset.ts';
import { buildView, type PanelView } from './view.ts';
import type {
  Command,
  CommandResult,
  EventKind,
  ListKind,
  PanelKey,
  PanelState,
  Point,
  PointCond,
  Screen,
  SimAction,
  Zone,
} from './types.ts';

export interface EngineOptions {
  now?: () => number;
  rng?: () => number;
  preset?: 'site' | 'clean';
  /** Day-mode investigation delay before sounders operate (ms). */
  delayMs?: number;
  /** Maintenance (access level 3) password. */
  maintPassword?: string;
}

const TYPE_CODE = { smoke: 12, heat: 24, mcp: 40, input: 79, flow: 79, output: 88 } as const;
const LEVEL3_MS = 10 * 60_000;
const SCREEN_TIMEOUT_MS = 2 * 60_000;
export const MAX_BYPASS_MIN = 24 * 60;
const fmtMin = (m: number) => (m % 60 === 0 ? `${m / 60}H` : `${m} MIN`);

export interface ListEntry {
  zone?: Zone;
  point?: Point;
  system?: string;
  time: number;
}

export class PanelEngine {
  state: PanelState;
  private clock: () => number;
  private rng: () => number;
  private delayMs: number;
  private password: string;
  private listeners = new Set<(v: PanelView) => void>();

  constructor(opts: EngineOptions = {}) {
    this.clock = opts.now ?? (() => Date.now());
    this.rng = opts.rng ?? Math.random;
    this.delayMs = opts.delayMs ?? 30_000;
    this.password = opts.maintPassword ?? '1234';
    this.state = this.initial(opts.preset ?? 'site');
  }

  // ---------------------------------------------------------------- setup

  private initial(preset: 'site' | 'clean'): PanelState {
    const now = this.clock();
    const s: PanelState = {
      model: 'ZITON ZP3',
      panelNo: 1,
      nodeNo: 1,
      site: 'Main Alarm Panel - Node 01',
      now,
      tick: 0,
      zones: buildZones(),
      points: buildPoints(),
      system: { mains: true, batteryV: 27.3, earthFault: false, chargerFault: false },
      systemFaultSince: {},
      keySwitch: false,
      maintUntil: 0,
      buzzer: false,
      lastAcceptAt: 0,
      sounders: 'off',
      soundersEnabled: true,
      remoteAlarm: false,
      dayMode: false,
      delayUntil: 0,
      lampTestUntil: 0,
      events: [],
      seq: 0,
      disabledOrder: [],
      bypasses: [],
      link: { panel: true, since: now },
      screen: { s: 'auto' },
      lastKeyAt: 0,
    };
    this.state = s;
    for (const p of s.points) {
      this.sample(p);
      this.sample(p);
    }
    if (preset === 'site') {
      // Disablements made earlier by the maintenance contractor.
      const day = 24 * 3600_000;
      SITE_DISABLED.forEach((a, i) => {
        const p = this.point(a)!;
        p.disabled = true;
        s.disabledOrder.push(a);
        this.log('DISABLE', `POINT ${a} DISABLED`, p.desc, 'maintenance', p, now - 3 * day + i * 60_000);
      });
      // The two faults raised at 20:21.
      const t = siteFaultTime(now);
      const f1 = this.point(1011)!;
      f1.sim = 'openCircuit';
      const f2 = this.point(1029)!;
      f2.sim = 'headRemoved';
      for (const p of [f1, f2]) {
        this.sample(p);
        this.sample(p);
        this.evaluate(p, t);
      }
      s.lastAcceptAt = t + 30_000; // faults were already accepted on site
      s.buzzer = false;
    } else {
      for (const p of s.points) this.evaluate(p, now);
    }
    return s;
  }

  subscribe(fn: (v: PanelView) => void): () => void {
    this.listeners.add(fn);
    fn(this.view());
    return () => {
      this.listeners.delete(fn);
    };
  }

  view(): PanelView {
    return buildView(this);
  }

  snapshot(): PanelState {
    return structuredClone(this.state);
  }

  private notify() {
    if (this.listeners.size === 0) return;
    const v = this.view();
    for (const l of this.listeners) l(v);
  }

  // ---------------------------------------------------------------- helpers

  point(address: number): Point | undefined {
    return this.state.points.find((p) => p.address === address);
  }

  zone(n: number): Zone | undefined {
    return this.state.zones.find((z) => z.number === n);
  }

  accessLevel(): 1 | 2 | 3 {
    const s = this.state;
    if (s.maintUntil > s.now) return 3;
    return s.keySwitch ? 2 : 1;
  }

  private isDisabled(p: Point): boolean {
    return p.disabled || !!this.zone(p.zone)?.disabled;
  }

  private log(
    kind: EventKind,
    text: string,
    detail: string | undefined,
    actor: string,
    p?: Point,
    time?: number,
  ) {
    const s = this.state;
    s.seq += 1;
    s.events.unshift({
      seq: s.seq,
      time: time ?? s.now,
      kind,
      text,
      detail,
      address: p?.address,
      zone: p?.zone,
      actor,
    });
    if (s.events.length > 500) s.events.length = 500;
  }

  private jitter(n: number) {
    return Math.round((this.rng() - 0.5) * 2 * n);
  }

  // ---------------------------------------------------------------- analog model

  private sample(p: Point) {
    const prev = p.analogs[0];
    const code = TYPE_CODE[p.type];
    let a1 = 0;
    let comp = 0;
    switch (p.sim) {
      case 'headRemoved':
        p.analogs = [this.rng() < 0.5 ? 0 : 1, 0, 0, 0, 1, 1];
        return;
      case 'openCircuit':
        a1 = 193 + (this.rng() < 0.6 ? 1 : 0);
        comp = 135;
        break;
      case 'smoke':
        p.ramp = Math.min(220, (p.ramp ?? 34) + 14);
        a1 = p.ramp;
        comp = 30;
        break;
      case 'heat':
        p.ramp = Math.min(200, (p.ramp ?? 26) + 9);
        a1 = p.ramp;
        comp = 25;
        break;
      case 'mcp':
        a1 = 200;
        comp = 16;
        break;
      case 'active':
        a1 = 64 + this.jitter(1);
        comp = 135;
        break;
      case 'dirty':
        a1 = 92 + this.jitter(3);
        comp = 88;
        break;
      case 'normal':
      default:
        p.ramp = undefined;
        if (p.type === 'smoke') {
          a1 = 32 + this.jitter(2);
          comp = 30;
        } else if (p.type === 'heat') {
          a1 = 25 + this.jitter(1);
          comp = 25;
        } else {
          a1 = 16 + (p.type === 'mcp' ? 0 : this.jitter(1));
          comp = p.type === 'mcp' ? 16 : 135;
        }
    }
    a1 = Math.max(0, Math.min(255, a1));
    p.analogs = [a1, prev, comp, 1, code, 1];
  }

  /** Raw condition from the live analog value (before latching). */
  classify(p: Point): { cond: PointCond; fault?: string } {
    const a1 = p.analogs[0];
    switch (p.type) {
      case 'smoke':
      case 'heat':
        if (a1 <= 4) return { cond: 'Fault', fault: 'Low analog - head removed / no response' };
        if (p.type === 'smoke' && p.analogs[2] > 70) return { cond: 'Fault', fault: 'Contaminated - clean or replace' };
        if (a1 >= p.thresh) return { cond: 'Fire' };
        if (a1 >= p.thresh * 0.75) return { cond: 'PreAlarm' };
        return { cond: 'Normal' };
      case 'mcp':
        if (a1 <= 4) return { cond: 'Fault', fault: 'No response - device missing' };
        if (a1 >= p.thresh) return { cond: 'Fire' };
        return { cond: 'Normal' };
      case 'flow':
        if (a1 >= p.thresh) return { cond: 'Fault', fault: 'Open/short circuit on monitored line' };
        if (a1 <= 4) return { cond: 'Fault', fault: 'No response - module missing' };
        if (a1 >= 40) return { cond: 'Fire' };
        return { cond: 'Normal' };
      case 'input':
        if (a1 >= p.thresh) return { cond: 'Fault', fault: 'Open/short circuit on monitored line' };
        if (a1 <= 4) return { cond: 'Fault', fault: 'No response - module missing' };
        if (a1 >= 40) return { cond: 'Active' };
        return { cond: 'Normal' };
      default:
        return { cond: 'Normal' };
    }
  }

  private evaluate(p: Point, t: number) {
    const s = this.state;
    const prevNow = s.now;
    s.now = t;
    const dis = this.isDisabled(p);
    const raw = this.classify(p);
    const zoneName = this.zone(p.zone)?.name ?? '';
    const where = `Z${String(p.zone).padStart(3, '0')} ${zoneName}`;

    if (raw.cond === 'Fire' && !dis && !p.latchedFire) {
      p.latchedFire = t;
      this.log('FIRE', `FIRE ${p.address} ${p.id}`, `${where} - ${p.desc}`, 'panel', p, t);
      this.onFire(p);
    }
    // A software bypass also stops the device's faults from holding the panel in fault.
    const bypassed = s.bypasses.some((b) => b.address === p.address);
    if (raw.cond === 'Fault' && !p.latchedFault && !bypassed) {
      p.latchedFault = t;
      p.faultText = raw.fault;
      this.log('FAULT', `FAULT ${p.address} ${p.id}`, `${where} - ${raw.fault}`, 'panel', p, t);
      s.buzzer = true;
    }

    let cond: PointCond;
    if (p.latchedFire) cond = 'Fire';
    else if (p.latchedFault) cond = 'Fault';
    else if (dis) cond = 'Normal';
    else cond = raw.cond === 'Fire' || raw.cond === 'Fault' ? 'Normal' : raw.cond;

    if (cond !== p.cond) {
      if (cond === 'PreAlarm') this.log('PRE-ALARM', `PRE-ALARM ${p.address} ${p.id}`, where, 'panel', p, t);
      if (cond === 'Active') {
        this.log('ACTIVE', `ACTIVE ${p.address}`, p.desc, 'panel', p, t);
        s.buzzer = true;
      }
      if (p.cond === 'Active' && cond === 'Normal') this.log('CLEAR', `NORMAL ${p.address}`, p.desc, 'panel', p, t);
      p.cond = cond;
      p.since = t;
    }
    s.now = Math.max(prevNow, t);
  }

  private onFire(p: Point) {
    const s = this.state;
    s.buzzer = true;
    const alreadyAlarm = s.sounders === 'active' || s.remoteAlarm;
    if (s.sounders === 'silenced') {
      // A new fire after silence re-sounds the alarms.
      this.activateAlarm('New fire after silence');
      return;
    }
    if (alreadyAlarm) return;
    const detector = p.type === 'smoke' || p.type === 'heat';
    if (s.dayMode && detector) {
      if (!s.delayUntil) {
        s.delayUntil = s.now + this.delayMs;
        this.log('SYSTEM', 'INVESTIGATION DELAY STARTED', `${Math.round(this.delayMs / 1000)}s - day mode`, 'panel');
      }
    } else {
      this.activateAlarm();
    }
  }

  private activateAlarm(reason?: string) {
    const s = this.state;
    s.delayUntil = 0;
    s.remoteAlarm = true;
    if (s.soundersEnabled) s.sounders = 'active';
    this.log('SYSTEM', 'ALARMS SOUNDING / DECAM SIGNALLED', reason, 'panel');
  }

  private evaluateSystem() {
    const s = this.state;
    const checks: [string, boolean][] = [
      ['MAINS FAILURE', !s.system.mains],
      ['BATTERY LOW', s.system.batteryV < 23.0],
      ['EARTH FAULT', s.system.earthFault],
      ['CHARGER FAULT', s.system.chargerFault],
    ];
    for (const [name, bad] of checks) {
      const had = s.systemFaultSince[name];
      if (bad && !had) {
        s.systemFaultSince[name] = s.now;
        this.log('FAULT', `SYSTEM FAULT: ${name}`, undefined, 'panel');
        s.buzzer = true;
      } else if (!bad && had) {
        delete s.systemFaultSince[name];
        this.log('CLEAR', `SYSTEM NORMAL: ${name}`, undefined, 'panel');
      }
    }
  }

  // ---------------------------------------------------------------- time

  tick() {
    const s = this.state;
    s.now = this.clock();
    s.tick += 1;
    if (!s.link.panel) {
      // No data from the panel: keep the last known values frozen.
      if (s.screen.s === 'message' && s.now >= s.screen.until) s.screen = s.screen.back;
      this.notify();
      return;
    }
    for (const p of s.points) {
      this.sample(p);
      this.evaluate(p, s.now);
    }
    this.expireBypasses();
    if (!s.system.mains) s.system.batteryV = Math.max(20.5, +(s.system.batteryV - 0.01).toFixed(3));
    else if (s.system.batteryV < 27.3) s.system.batteryV = Math.min(27.3, +(s.system.batteryV + 0.05).toFixed(3));
    this.evaluateSystem();

    if (s.delayUntil && s.now >= s.delayUntil) this.activateAlarm('Investigation delay expired');
    if (s.screen.s === 'message' && s.now >= s.screen.until) s.screen = s.screen.back;
    if (s.screen.s !== 'auto' && s.now - s.lastKeyAt > SCREEN_TIMEOUT_MS) s.screen = { s: 'auto' };
    if (s.maintUntil && s.maintUntil <= s.now) {
      s.maintUntil = 0;
      this.log('ACCESS', 'ACCESS LEVEL 3 TIMED OUT', undefined, 'panel');
    }
    this.notify();
  }

  // ---------------------------------------------------------------- lists

  list(kind: ListKind, mode: 'zones' | 'points'): ListEntry[] {
    const s = this.state;
    const pts = (pred: (p: Point) => boolean, time: (p: Point) => number) =>
      s.points.filter(pred).sort((a, b) => time(a) - time(b) || a.address - b.address);

    let points: Point[] = [];
    let time: (p: Point) => number = () => 0;
    if (kind === 'fire') {
      time = (p) => p.latchedFire ?? 0;
      points = pts((p) => !!p.latchedFire, time);
    } else if (kind === 'fault') {
      time = (p) => p.latchedFault ?? 0;
      points = pts((p) => !!p.latchedFault, time);
    } else if (kind === 'other') {
      time = (p) => p.since ?? 0;
      points = pts((p) => p.cond === 'Active' || p.cond === 'PreAlarm', time);
    } else {
      const order = s.disabledOrder.filter((a) => this.point(a)?.disabled);
      points = order.map((a) => this.point(a)!);
    }

    let out: ListEntry[];
    if (mode === 'points' || kind === 'disabled') {
      out = points.map((p) => ({ point: p, zone: this.zone(p.zone), time: time(p) }));
      if (kind === 'disabled' && mode === 'zones')
        out = s.zones.filter((z) => z.disabled).map((z) => ({ zone: z, time: 0 }));
    } else {
      const seen = new Map<number, ListEntry>();
      for (const p of points) if (!seen.has(p.zone)) seen.set(p.zone, { zone: this.zone(p.zone), point: p, time: time(p) });
      out = [...seen.values()];
    }
    if (kind === 'fault') {
      for (const [name, t] of Object.entries(s.systemFaultSince)) out.push({ system: name, time: t });
    }
    if (kind === 'other') {
      if (!s.soundersEnabled) out.push({ system: 'SOUNDERS DISABLED', time: 0 });
      if (s.delayUntil) out.push({ system: 'INVESTIGATION DELAY RUNNING', time: s.now });
    }
    return out;
  }

  counts() {
    return {
      fire: this.list('fire', 'zones').length,
      fault: this.list('fault', 'zones').length,
      disabled: this.list('disabled', 'points').length + this.state.zones.filter((z) => z.disabled).length,
      other: this.list('other', 'points').length,
    };
  }

  // ---------------------------------------------------------------- commands

  dispatch(cmd: Command, actor = 'panel'): CommandResult {
    const s = this.state;
    s.now = this.clock();
    let r: CommandResult;
    if (!s.link.panel && cmd.t !== 'sim') {
      r = { ok: false, message: 'Panel link is down - operate at the panel and call FPC' };
      this.notify();
      return r;
    }
    switch (cmd.t) {
      case 'key':
        s.lastKeyAt = s.now;
        r = this.key(cmd.key, actor);
        break;
      case 'keyswitch':
        s.keySwitch = cmd.on;
        this.log('ACCESS', `KEY SWITCH ${cmd.on ? 'ON - ACCESS LEVEL 2' : 'OFF - ACCESS LEVEL 1'}`, undefined, actor);
        r = { ok: true, message: `Access level ${this.accessLevel()}` };
        break;
      case 'login':
        r = this.login(cmd.password, actor);
        break;
      case 'logout':
        s.maintUntil = 0;
        this.log('ACCESS', 'MAINTENANCE LOGOUT', undefined, actor);
        r = { ok: true, message: 'Logged out of maintenance' };
        break;
      case 'setDisabled':
        r = this.setDisabled(cmd.target, cmd.addr, cmd.disabled, actor);
        break;
      case 'bypass':
        r = this.bypass(cmd.addr, cmd.reason, cmd.minutes, actor);
        break;
      case 'unbypass':
        r = this.unbypass(cmd.addr, actor, false);
        break;
      case 'sim':
        r = this.sim(cmd.action, actor);
        break;
    }
    // Re-evaluate immediately so the result is visible without waiting a tick.
    // (this.state may have been replaced by a preset load.)
    if (this.state.link.panel) {
      for (const p of this.state.points) this.evaluate(p, this.state.now);
      this.evaluateSystem();
    }
    this.notify();
    return r;
  }

  private login(pw: string, actor: string): CommandResult {
    const s = this.state;
    if (pw !== this.password) {
      this.log('ACCESS', 'INVALID MAINTENANCE PASSWORD', undefined, actor);
      return { ok: false, message: 'Invalid password' };
    }
    s.maintUntil = s.now + LEVEL3_MS;
    this.log('ACCESS', 'ACCESS LEVEL 3 - MAINTENANCE', undefined, actor);
    return { ok: true, message: 'Access level 3 granted for 10 minutes' };
  }

  private flash(lines: string[], ms = 2500, back?: Screen) {
    const s = this.state;
    const prev = s.screen.s === 'message' ? s.screen.back : s.screen;
    s.screen = { s: 'message', lines, until: s.now + ms, back: back ?? prev };
  }

  private need(level: 2 | 3, what: string): CommandResult | null {
    if (this.accessLevel() >= level) return null;
    this.flash(
      level === 2
        ? ['ACCESS DENIED', `${what} needs ACCESS LEVEL 2`, 'Turn the key switch to ON', '']
        : ['ACCESS DENIED', `${what} needs ACCESS LEVEL 3`, 'MENU > 3 Maintenance > password', ''],
    );
    return { ok: false, message: `${what} requires access level ${level}` };
  }

  setDisabled(target: 'point' | 'zone', addr: number, disabled: boolean, actor: string): CommandResult {
    const denied = this.need(3, disabled ? 'Disable' : 'Enable');
    if (denied) return denied;
    const s = this.state;
    if (target === 'point') {
      const p = this.point(addr);
      if (!p) return { ok: false, message: `Point ${addr} not found` };
      if (p.disabled === disabled) return { ok: true, message: `Point ${addr} already ${disabled ? 'disabled' : 'enabled'}` };
      p.disabled = disabled;
      s.bypasses = s.bypasses.filter((b) => b.address !== addr);
      s.disabledOrder = s.disabledOrder.filter((a) => a !== addr);
      if (disabled) s.disabledOrder.push(addr);
      this.log(disabled ? 'DISABLE' : 'ENABLE', `POINT ${addr} ${disabled ? 'DISABLED' : 'ENABLED'}`, p.desc, actor, p);
      return { ok: true, message: `Point ${addr} ${disabled ? 'disabled' : 'enabled'}` };
    }
    const z = this.zone(addr);
    if (!z) return { ok: false, message: `Zone ${addr} not found` };
    z.disabled = disabled;
    this.log(disabled ? 'DISABLE' : 'ENABLE', `ZONE ${addr} ${disabled ? 'DISABLED' : 'ENABLED'}`, z.name, actor);
    return { ok: true, message: `Zone ${addr} ${disabled ? 'disabled' : 'enabled'}` };
  }

  /** Isolate a device for a limited time, with a recorded reason. */
  bypass(addr: number, reason: string, minutes: number, actor: string): CommandResult {
    const denied = this.need(3, 'Bypass');
    if (denied) return denied;
    const s = this.state;
    const p = this.point(addr);
    if (!p) return { ok: false, message: `Point ${addr} not found` };
    const why = reason.trim();
    if (why.length < 3) return { ok: false, message: 'Enter a reason for the bypass' };
    if (!(minutes >= 1 && minutes <= MAX_BYPASS_MIN)) return { ok: false, message: 'Bypass time must be 1 minute to 24 hours' };
    const existing = s.bypasses.find((b) => b.address === addr);
    if (p.disabled && !existing) return { ok: false, message: `Point ${addr} is already disabled at the panel` };
    const until = s.now + minutes * 60_000;
    if (existing) {
      existing.until = until;
      existing.reason = why;
      this.log('BYPASS', `POINT ${addr} BYPASS EXTENDED ${fmtMin(minutes)}`, why, actor, p);
      return { ok: true, message: `Bypass on ${addr} extended to ${fmtMin(minutes)}` };
    }
    p.disabled = true;
    s.disabledOrder = s.disabledOrder.filter((a) => a !== addr);
    s.disabledOrder.push(addr);
    s.bypasses.push({ address: addr, reason: why, at: s.now, until, by: actor });
    // Clear the device's latched fault now; it stays suppressed while bypassed.
    p.latchedFault = undefined;
    p.faultText = undefined;
    if (p.cond === 'Fault') p.cond = 'Normal';
    this.log('BYPASS', `POINT ${addr} BYPASSED ${fmtMin(minutes)}`, `${p.desc} - ${why}`, actor, p);
    return { ok: true, message: `Point ${addr} bypassed for ${fmtMin(minutes)}` };
  }

  /** End a bypass: the device is enabled again and reports normally. */
  unbypass(addr: number, actor: string, expired: boolean): CommandResult {
    if (!expired) {
      const denied = this.need(3, 'Restore');
      if (denied) return denied;
    }
    const s = this.state;
    const b = s.bypasses.find((x) => x.address === addr);
    const p = this.point(addr);
    if (!b || !p) return { ok: false, message: `Point ${addr} is not bypassed` };
    s.bypasses = s.bypasses.filter((x) => x !== b);
    p.disabled = false;
    s.disabledOrder = s.disabledOrder.filter((a) => a !== addr);
    this.log('ENABLE', `POINT ${addr} ${expired ? 'BYPASS EXPIRED - RE-ENABLED' : 'BYPASS ENDED - RE-ENABLED'}`, p.desc, actor, p);
    if (expired) s.buzzer = true;
    return { ok: true, message: `Point ${addr} back in service` };
  }

  private expireBypasses() {
    const s = this.state;
    for (const b of [...s.bypasses]) if (b.until <= s.now) this.unbypass(b.address, 'panel (timer)', true);
  }

  reset(actor: string): CommandResult {
    const denied = this.need(2, 'Reset');
    if (denied) return denied;
    const s = this.state;
    this.log('RESET', 'SYSTEM RESET', undefined, actor);
    for (const p of s.points) {
      p.latchedFire = undefined;
      p.latchedFault = undefined;
      p.faultText = undefined;
      p.cond = 'Normal';
      p.ramp = undefined;
    }
    s.systemFaultSince = {};
    s.sounders = 'off';
    s.remoteAlarm = false;
    s.delayUntil = 0;
    s.buzzer = false;
    s.lastAcceptAt = s.now;
    // Conditions that are still present come straight back, as on the real panel.
    for (const p of s.points) this.evaluate(p, s.now);
    this.evaluateSystem();
    const c = this.counts();
    s.screen = { s: 'auto' };
    this.flash(
      [
        'SYSTEM RESET',
        c.fire || c.fault ? `Conditions still present:` : 'All conditions cleared',
        c.fire || c.fault ? `Fire zones: ${c.fire}   Fault entries: ${c.fault}` : '',
        '',
      ],
      2500,
      { s: 'auto' },
    );
    return { ok: true, message: c.fire || c.fault ? `Reset done - ${c.fire} fire / ${c.fault} fault still present` : 'Reset done - system normal' };
  }

  private key(k: PanelKey, actor: string): CommandResult {
    const s = this.state;
    const ok = (message = 'OK'): CommandResult => ({ ok: true, message });

    // Global keys
    switch (k) {
      case 'ACCEPT':
        s.buzzer = false;
        s.lastAcceptAt = s.now;
        this.log('ACCEPT', 'ACCEPT / BUZZER MUTED', undefined, actor);
        return ok('Buzzer muted');
      case 'RESET':
        return this.reset(actor);
      case 'SILENCE': {
        const d = this.need(2, 'Silence alarms');
        if (d) return d;
        if (s.sounders !== 'active') return ok('Sounders are not sounding');
        s.sounders = 'silenced';
        this.log('SILENCE', 'ALARMS SILENCED', undefined, actor);
        return ok('Alarms silenced');
      }
      case 'SOUND': {
        const d = this.need(2, 'Sound alarms');
        if (d) return d;
        s.sounders = s.soundersEnabled ? 'active' : s.sounders;
        s.delayUntil = 0;
        this.log('SOUND', 'ALARMS SOUNDED (EVACUATE)', undefined, actor);
        return ok(s.soundersEnabled ? 'Alarms sounding' : 'Sounders are disabled');
      }
      case 'DAY_NIGHT': {
        const d = this.need(2, 'Day/Night');
        if (d) return d;
        if (s.delayUntil) {
          s.delayUntil += 60_000;
          this.log('SYSTEM', 'MORE TIME - DELAY EXTENDED 60s', undefined, actor);
          return ok('Delay extended');
        }
        s.dayMode = !s.dayMode;
        this.log('SYSTEM', `${s.dayMode ? 'DAY' : 'NIGHT'} MODE SELECTED`, undefined, actor);
        return ok(s.dayMode ? 'Day mode' : 'Night mode');
      }
      case 'SOUNDERS': {
        const d = this.need(2, 'Sounder enable');
        if (d) return d;
        s.soundersEnabled = !s.soundersEnabled;
        if (!s.soundersEnabled && s.sounders === 'active') s.sounders = 'off';
        this.log(s.soundersEnabled ? 'ENABLE' : 'DISABLE', `SOUNDERS ${s.soundersEnabled ? 'ENABLED' : 'DISABLED'}`, undefined, actor);
        return ok(s.soundersEnabled ? 'Sounders enabled' : 'Sounders disabled');
      }
      case 'LAMP_TEST':
        s.lampTestUntil = s.now + 4000;
        return ok('Lamp test');
      case 'FIRE':
      case 'FAULT':
      case 'DISABLED':
      case 'OTHER': {
        const kind = k.toLowerCase() as ListKind;
        const cur = s.screen;
        if (cur.s === 'list' && cur.kind === kind) s.screen = { ...cur, mode: cur.mode === 'zones' ? 'points' : 'zones', idx: 0 };
        else s.screen = { s: 'list', kind, mode: kind === 'disabled' ? 'points' : 'zones', idx: 0 };
        return ok();
      }
      case 'VIEW_POINTS': {
        const sel = this.selectedPoint();
        s.screen = { s: 'viewpoints', idx: sel ? s.points.indexOf(this.point(sel.address)!) : 0 };
        return ok();
      }
      case 'HELP':
        s.screen = { s: 'help' };
        return ok();
      case 'HOME':
        s.screen = { s: 'auto' };
        return ok();
      case 'MENU':
        s.screen = { s: 'menu' };
        return ok();
      case 'F2': {
        const sel = this.selectedPoint();
        if (!sel) return ok();
        const d = this.need(3, 'Rep. display');
        if (d) return d;
        s.screen = { s: 'repdisp', idx: s.points.indexOf(this.point(sel.address)!) };
        return ok();
      }
      default:
        break;
    }

    const sc = s.screen.s === 'message' ? s.screen.back : s.screen;
    if (s.screen.s === 'message') s.screen = sc;
    const digit = k.startsWith('D') ? Number(k.slice(1)) : -1;
    const step = k === 'UP' || k === 'LEFT' ? -1 : k === 'DOWN' || k === 'RIGHT' ? 1 : 0;

    switch (sc.s) {
      case 'auto':
      case 'list': {
        const cur: Screen = sc.s === 'auto' ? this.autoScreen() : sc;
        if (cur.s !== 'list') return ok();
        if (k === 'F1') {
          s.screen = { ...cur, mode: cur.mode === 'zones' ? 'points' : 'zones', idx: 0 };
          return ok();
        }
        if (step) {
          const n = this.list(cur.kind, cur.mode).length;
          s.screen = { ...cur, idx: Math.max(0, Math.min(Math.max(0, n - 1), cur.idx + step)) };
        }
        if (k === 'ESC') s.screen = { s: 'auto' };
        return ok();
      }
      case 'viewpoints':
      case 'repdisp':
      case 'viewdisabled':
      case 'eventlog': {
        const n =
          sc.s === 'viewdisabled'
            ? this.list('disabled', 'points').length
            : sc.s === 'eventlog'
              ? s.events.length
              : s.points.length;
        if (step) s.screen = { ...sc, idx: (sc.idx + step + n) % Math.max(1, n) };
        if (k === 'ESC') s.screen = sc.s === 'viewpoints' ? { s: 'auto' } : sc.s === 'eventlog' && this.accessLevel() < 3 ? { s: 'menu' } : { s: 'maint' };
        return ok();
      }
      case 'help':
        if (k === 'ESC') s.screen = { s: 'auto' };
        return ok();
      case 'menu':
        if (k === 'ESC') s.screen = { s: 'auto' };
        if (digit === 1) s.screen = { s: 'eventlog', idx: 0 };
        if (digit === 2) s.lampTestUntil = s.now + 4000;
        if (digit === 3) s.screen = this.accessLevel() === 3 ? { s: 'maint' } : { s: 'password', buf: '' };
        if (digit === 4) return this.key('DAY_NIGHT', actor);
        return ok();
      case 'password':
        if (digit >= 0 && sc.buf.length < 8) s.screen = { ...sc, buf: sc.buf + digit };
        if (k === 'LEFT') s.screen = { ...sc, buf: sc.buf.slice(0, -1) };
        if (k === 'ESC') s.screen = { s: 'menu' };
        if (k === 'ENTER') {
          const r = this.login(sc.buf, actor);
          if (r.ok) s.screen = { s: 'maint' };
          else this.flash(['MAINTENANCE PASSWORD', 'INVALID PASSWORD', 'Try again', ''], 2000, { s: 'password', buf: '' });
          return r;
        }
        return ok();
      case 'maint': {
        if (this.accessLevel() < 3) {
          s.screen = { s: 'password', buf: '' };
          return ok();
        }
        if (k === 'ESC') s.screen = { s: 'menu' };
        if (digit === 1) s.screen = { s: 'editdis' };
        if (digit === 2) s.screen = { s: 'enteraddr', target: 'point', purpose: 'repdisp', buf: '' };
        if (digit === 3) s.screen = { s: 'viewdisabled', idx: 0 };
        if (digit === 4) s.screen = { s: 'eventlog', idx: 0 };
        return ok();
      }
      case 'editdis':
        if (k === 'ESC') s.screen = { s: 'maint' };
        if (digit === 1) s.screen = { s: 'enteraddr', target: 'point', purpose: 'edit', buf: '' };
        if (digit === 2) s.screen = { s: 'enteraddr', target: 'zone', purpose: 'edit', buf: '' };
        return ok();
      case 'enteraddr': {
        if (digit >= 0 && sc.buf.length < 7) s.screen = { ...sc, buf: sc.buf + digit };
        if (k === 'LEFT') s.screen = { ...sc, buf: sc.buf.slice(0, -1) };
        if (k === 'ESC') s.screen = sc.purpose === 'edit' ? { s: 'editdis' } : { s: 'maint' };
        if (k === 'ENTER') {
          const max = sc.target === 'point' ? 4 : 3;
          let buf = sc.buf;
          if (buf.length > max) {
            const panel = Number(buf.slice(0, buf.length - max));
            if (panel !== s.panelNo) {
              this.flash(['INVALID ADDRESS', `Panel ${panel} not on network`, '', ''], 2000, { ...sc, buf: '' });
              return { ok: false, message: 'Invalid panel' };
            }
            buf = buf.slice(-max);
          }
          const addr = Number(buf);
          const exists = sc.target === 'point' ? this.point(addr) : this.zone(addr);
          if (!buf || !exists) {
            this.flash(['INVALID ADDRESS', `${sc.target === 'point' ? 'Point' : 'Zone'} ${buf || '-'} not found`, '', ''], 2000, { ...sc, buf: '' });
            return { ok: false, message: 'Address not found' };
          }
          if (sc.purpose === 'repdisp') s.screen = { s: 'repdisp', idx: s.points.indexOf(exists as Point) };
          else s.screen = { s: 'confirmdis', target: sc.target, addr };
        }
        return ok();
      }
      case 'confirmdis': {
        if (digit === 1 || digit === 2) s.screen = { ...sc, choice: digit };
        if (k === 'ESC') s.screen = { s: 'enteraddr', target: sc.target, purpose: 'edit', buf: '' };
        if (k === 'ENTER' && sc.choice) {
          const r = this.setDisabled(sc.target, sc.addr, sc.choice === 1, actor);
          this.flash(['EDIT DISABLE', r.message.toUpperCase(), 'Enter next address or press HOME', ''], 2000, {
            s: 'enteraddr',
            target: sc.target,
            purpose: 'edit',
            buf: '',
          });
          return r;
        }
        return ok();
      }
      default:
        return ok();
    }
  }

  /** The list screen the panel shows automatically (highest priority first). */
  autoScreen(): Screen {
    for (const kind of ['fire', 'fault', 'other'] as const) {
      if (this.list(kind, 'zones').length) return { s: 'list', kind, mode: 'zones', idx: 0 };
    }
    return { s: 'auto' };
  }

  /** Point under the cursor on the current screen, if any. */
  selectedPoint(): Point | undefined {
    const s = this.state;
    const sc = s.screen.s === 'auto' ? this.autoScreen() : s.screen;
    if (sc.s === 'list') return this.list(sc.kind, sc.mode)[sc.idx]?.point;
    if (sc.s === 'viewpoints' || sc.s === 'repdisp') return s.points[sc.idx];
    if (sc.s === 'viewdisabled') return this.list('disabled', 'points')[sc.idx]?.point;
    return undefined;
  }

  // ---------------------------------------------------------------- simulator

  private sim(a: SimAction, actor: string): CommandResult {
    const s = this.state;
    switch (a.a) {
      case 'device': {
        const p = this.point(a.address);
        if (!p) return { ok: false, message: `Point ${a.address} not found` };
        p.sim = a.mode;
        this.sample(p);
        this.sample(p);
        this.log('SIM', `SIM ${a.address}: ${a.mode}`, p.desc, actor, p);
        return { ok: true, message: `Point ${a.address} -> ${a.mode}` };
      }
      case 'repair': {
        const p = this.point(a.address);
        if (!p) return { ok: false, message: `Point ${a.address} not found` };
        p.sim = 'normal';
        this.sample(p);
        this.sample(p);
        this.log('SIM', `SIM ${a.address}: device repaired`, p.desc, actor, p);
        return { ok: true, message: `Point ${a.address} repaired - press RESET to clear` };
      }
      case 'mains':
        s.system.mains = a.ok;
        this.log('SIM', `SIM mains ${a.ok ? 'restored' : 'failed'}`, undefined, actor);
        return { ok: true, message: `Mains ${a.ok ? 'restored' : 'failed'}` };
      case 'battery':
        s.system.batteryV = a.volts;
        this.log('SIM', `SIM battery ${a.volts.toFixed(1)}V`, undefined, actor);
        return { ok: true, message: `Battery ${a.volts.toFixed(1)}V` };
      case 'earth':
        s.system.earthFault = a.fault;
        this.log('SIM', `SIM earth fault ${a.fault ? 'on' : 'off'}`, undefined, actor);
        return { ok: true, message: `Earth fault ${a.fault ? 'on' : 'cleared'}` };
      case 'link':
        s.link = { panel: a.ok, since: s.now };
        this.log('SIM', `SIM panel link ${a.ok ? 'restored' : 'lost'}`, a.ok ? undefined : 'Serial cable / interface card not responding', actor);
        return { ok: true, message: a.ok ? 'Panel link restored' : 'Panel link lost - data frozen' };
      case 'preset': {
        const keep = this.listeners;
        this.state = this.initial(a.name);
        this.listeners = keep;
        return { ok: true, message: a.name === 'site' ? 'Loaded site snapshot (10 Oct 20:21)' : 'Loaded clean system' };
      }
    }
  }
}

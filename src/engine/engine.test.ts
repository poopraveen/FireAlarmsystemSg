import { describe, expect, it } from 'vitest';
import { PanelEngine } from './engine.ts';
import { renderLcd } from './lcd.ts';

const at = new Date('2026-10-10T20:35:00+08:00').getTime();
const make = (preset: 'site' | 'clean' = 'site') => {
  let t = at;
  const e = new PanelEngine({ preset, now: () => t, rng: () => 0.5, delayMs: 5000 });
  return { e, advance: (ms: number) => (t += ms) };
};

describe('site snapshot (panel as photographed)', () => {
  it('shows the two zone faults and 7 disabled points', () => {
    const { e } = make();
    expect(e.counts()).toMatchObject({ fire: 0, fault: 2, disabled: 7 });
    const lcd = renderLcd(e);
    expect(lcd[0]).toMatch(/^FAULT +\(Zones\) +Total:002$/);
    expect(lcd[1]).toContain('Z100 PUMPS AND TANK STATUS');
    expect(lcd[2]).toContain('Z001 1ST STOREY');
  });

  it('REP. DISP for 1011 matches the real screen', () => {
    const { e } = make();
    e.dispatch({ t: 'login', password: '1234' });
    for (const k of ['MENU', 'D3', 'D2', 'D1', 'D0', 'D1', 'D1', 'ENTER'] as const) e.dispatch({ t: 'key', key: k });
    const lcd = renderLcd(e).map((l) => l.trimEnd());
    expect(lcd).toEqual([
      'MAINT: REP. DISP: PANEL 001 PNT ANALOGS',
      'Point: 1011      ID Sec SW N/L',
      'Thresh:138       Sens:2      Cond:Fault',
      'Analogs:194 194 135 001 079 001',
    ]);
  });

  it('view disabled lists 1023 as 0002 of 0007', () => {
    const { e } = make();
    e.dispatch({ t: 'login', password: '1234' });
    for (const k of ['MENU', 'D3', 'D3', 'DOWN'] as const) e.dispatch({ t: 'key', key: k });
    const lcd = renderLcd(e);
    expect(lcd[0].trim()).toBe('MAINTENANCE: VIEW DISABLED: POINTS');
    expect(lcd[1]).toMatch(/Point : 1023  Zone: 100 +\(0002 of 0007\)/);
  });
});

describe('access levels', () => {
  it('reset needs the key switch', () => {
    const { e } = make();
    expect(e.dispatch({ t: 'key', key: 'RESET' }).ok).toBe(false);
    e.dispatch({ t: 'keyswitch', on: true });
    expect(e.dispatch({ t: 'key', key: 'RESET' }).ok).toBe(true);
  });
  it('disable needs the maintenance password', () => {
    const { e } = make();
    e.dispatch({ t: 'keyswitch', on: true });
    expect(e.dispatch({ t: 'setDisabled', target: 'point', addr: 1046, disabled: true }).ok).toBe(false);
    expect(e.dispatch({ t: 'login', password: '0000' }).ok).toBe(false);
    e.dispatch({ t: 'login', password: '1234' });
    expect(e.dispatch({ t: 'setDisabled', target: 'point', addr: 1046, disabled: true }).ok).toBe(true);
    expect(e.point(1046)!.disabled).toBe(true);
  });
});

describe('fault and reset behaviour', () => {
  it('fault returns after reset until the device is repaired', () => {
    const { e } = make();
    e.dispatch({ t: 'keyswitch', on: true });
    e.dispatch({ t: 'key', key: 'RESET' });
    expect(e.counts().fault).toBe(2);
    e.dispatch({ t: 'sim', action: { a: 'repair', address: 1011 } });
    e.dispatch({ t: 'sim', action: { a: 'repair', address: 1029 } });
    e.dispatch({ t: 'key', key: 'RESET' });
    expect(e.counts().fault).toBe(0);
  });
});

describe('fire behaviour', () => {
  it('smoke detector latches fire, sounds alarms; silence and reset work', () => {
    const { e, advance } = make('clean');
    e.dispatch({ t: 'sim', action: { a: 'device', address: 1046, mode: 'smoke' } });
    for (let i = 0; i < 10; i++) {
      advance(1000);
      e.tick();
    }
    expect(e.point(1046)!.cond).toBe('Fire');
    expect(e.state.sounders).toBe('active');
    expect(e.state.remoteAlarm).toBe(true);
    e.dispatch({ t: 'keyswitch', on: true });
    e.dispatch({ t: 'key', key: 'SILENCE' });
    expect(e.state.sounders).toBe('silenced');
    e.dispatch({ t: 'sim', action: { a: 'repair', address: 1046 } });
    e.dispatch({ t: 'key', key: 'RESET' });
    expect(e.counts().fire).toBe(0);
    expect(e.state.sounders).toBe('off');
  });

  it('day mode delays sounders for detectors but not call points', () => {
    const { e, advance } = make('clean');
    e.dispatch({ t: 'keyswitch', on: true });
    e.dispatch({ t: 'key', key: 'DAY_NIGHT' });
    e.dispatch({ t: 'sim', action: { a: 'device', address: 1046, mode: 'smoke' } });
    for (let i = 0; i < 8; i++) {
      advance(1000);
      e.tick();
    }
    expect(e.point(1046)!.cond).toBe('Fire');
    expect(e.state.sounders).toBe('off');
    expect(e.state.delayUntil).toBeGreaterThan(0);
    advance(6000);
    e.tick();
    expect(e.state.sounders).toBe('active');
  });

  it('disabled point does not raise fire', () => {
    const { e, advance } = make('site');
    e.dispatch({ t: 'sim', action: { a: 'device', address: 2005, mode: 'smoke' } });
    for (let i = 0; i < 12; i++) {
      advance(1000);
      e.tick();
    }
    expect(e.counts().fire).toBe(0);
  });
});

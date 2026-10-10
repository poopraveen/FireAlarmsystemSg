// Site preset built from the photos of the real Main Alarm Panel (Node 01)
// and the Master Mimic: addressing, zone names, the 7 disabled points and the
// two active faults seen on 10 Oct 2026 at 20:21.
import type { DeviceType, Point, Zone } from './types.ts';

export const ORDINAL = [
  '',
  '1ST',
  '2ND',
  '3RD',
  '4TH',
  '5TH',
  '6TH',
  '7TH',
  '8TH',
  '9TH',
  '10TH',
  '11TH',
  '12TH',
];

export function buildZones(): Zone[] {
  const zones: Zone[] = [];
  for (let n = 1; n <= 12; n++) zones.push({ number: n, name: `${ORDINAL[n]} STOREY`, disabled: false });
  zones.push({ number: 13, name: 'ROOF', disabled: false });
  zones.push({ number: 14, name: 'BASEMENT 3A', disabled: false });
  zones.push({ number: 15, name: 'BASEMENT 2A', disabled: false });
  zones.push({ number: 16, name: 'BASEMENT 1A', disabled: false });
  zones.push({ number: 100, name: 'PUMPS AND TANK STATUS', disabled: false });
  return zones;
}

const THRESH: Record<DeviceType, number> = {
  smoke: 135,
  heat: 140,
  mcp: 100,
  input: 138,
  flow: 138,
  output: 200,
};

const ID_TEXT: Record<DeviceType, string> = {
  smoke: 'Smoke',
  heat: 'Heat',
  mcp: 'MCP',
  input: 'Input',
  flow: 'Flow SW',
  output: 'Output',
};

function pt(address: number, zone: number, type: DeviceType, desc: string, ref: string, id?: string): Point {
  return {
    address,
    zone,
    type,
    id: id ?? ID_TEXT[type],
    desc,
    ref,
    thresh: THRESH[type],
    sens: 2,
    analogs: [0, 0, 0, 1, 0, 1],
    disabled: false,
    cond: 'Normal',
    sim: 'normal',
  };
}

export function buildPoints(): Point[] {
  const p: Point[] = [];

  // Basements (from mimic)
  p.push(pt(1001, 14, 'flow', 'B3A SPRINKLER PROTECTED AREA', 'Z14-1'));
  p.push(pt(1002, 14, 'smoke', 'B3A LIFT LOBBY', 'Z14-2'));
  p.push(pt(1003, 15, 'flow', 'B2A SPRINKLER PROTECTED AREA', 'Z15-1'));
  p.push(pt(1004, 15, 'smoke', 'B2A LIFT LOBBY', 'Z15-2'));
  p.push(pt(1006, 16, 'flow', 'B1A SPRINKLER PROTECTED AREA', 'Z16-1'));
  p.push(pt(1007, 16, 'mcp', 'B1A FIRE LIFT LOBBY', 'Z16-2'));
  p.push(pt(1008, 16, 'smoke', 'B1A MDF ROOM', 'Z16-3'));
  p.push(pt(1009, 16, 'smoke', 'B1A SWITCH ROOM', 'Z16-4'));

  // Zone 100 - pumps and tank status (master mimic tables)
  const z100: [number, string, string?][] = [
    [1010, 'SPRINKLER PUMP 1 RUN'],
    [1011, 'SPRINKLER PUMP 2 RUN', 'Sec SW N/L'],
    [1012, 'SPRINKLER PUMP CTRL PANEL POWER FAILURE'],
    [1013, 'SPRINKLER JOCKEY PUMP RUN'],
    [1014, 'SPRINKLER JOCKEY PUMP TRIP'],
    [1015, 'SPRINKLER WATER TANK HIGH LEVEL'],
    [1016, 'SPRINKLER WATER TANK LOW LEVEL'],
    [1017, 'HOSEREEL PUMP 1 RUN'],
    [1018, 'HOSEREEL PUMP 1 TRIP'],
    [1019, 'HOSEREEL PUMP 2 RUN'],
    [1020, 'HOSEREEL PUMP 2 TRIP'],
    [1021, 'HOSEREEL WATER TANK HIGH LEVEL'],
    [1022, 'HOSEREEL WATER TANK LOW LEVEL'],
    [1023, 'HOSEREEL PUMP CTRL PANEL POWER FAILURE'],
    [1032, 'SPRINKLER CONTROL VALVE'],
  ];
  for (const [a, d, id] of z100) p.push(pt(a, 100, 'input', d, `P${a}`, id));

  // 1st storey
  p.push(pt(1031, 1, 'mcp', '1ST STY MAIN ALARM PANEL', 'Z1-1'));
  p.push(pt(1024, 1, 'smoke', '1ST STY FIRE COMMAND CENTRE', 'Z1-2'));
  p.push(pt(1025, 1, 'smoke', '1ST STY LIFT LOBBY', 'Z1-3'));
  p.push(pt(1026, 1, 'smoke', '1ST STY ELECT RISER', 'Z1-4'));
  p.push(pt(1027, 1, 'mcp', '1ST STY STAIRCASE', 'Z1-5'));
  p.push(pt(1028, 1, 'smoke', '1ST STY TEL RISER', 'Z1-6'));
  p.push(pt(1030, 1, 'flow', '1ST STY SPRINKLER PROTECTED AREA', 'Z1-7'));
  p.push(pt(1029, 1, 'smoke', '1ST STY CORRIDOR', 'Z1-8'));

  // 2nd - 12th storey: table on the mimic (lobby MCP + smoke, elect, tel, unit 1-4 PLL, stair 5)
  for (let n = 2; n <= 12; n++) {
    const loop1 = n <= 6;
    const base = loop1 ? 1045 + 5 * (n - 2) : 2001 + 5 * (n - 7);
    const units = loop1 ? 1070 + 4 * (n - 2) : 2050 + 4 * (n - 7);
    const f = `${ORDINAL[n]} STY`;
    p.push(pt(base, n, 'mcp', `${f} COMMON LOBBY`, `Z${n}-1`));
    p.push(pt(base + 1, n, 'smoke', `${f} COMMON LOBBY`, `Z${n}-2`));
    p.push(pt(base + 2, n, 'smoke', `${f} ELECT RISER`, `Z${n}-3`));
    p.push(pt(base + 3, n, 'smoke', `${f} TEL RISER`, `Z${n}-4`));
    for (let u = 0; u < 4; u++) p.push(pt(units + u, n, 'smoke', `${f} UNIT ${u + 1} PLL`, `Z${n}-${5 + u}`));
    p.push(pt(base + 4, n, 'smoke', `${f} STAIR 5`, `Z${n}-9`));
  }

  // Roof
  p.push(pt(2031, 13, 'smoke', 'ROOF LIFT MOTOR ROOM', 'Z13-1'));
  p.push(pt(2032, 13, 'smoke', 'ROOF GENSET ROOM', 'Z13-2'));
  p.push(pt(2033, 13, 'smoke', 'ROOF M&E ROOM', 'Z13-3'));
  p.push(pt(2091, 13, 'mcp', 'ROOF STAIRCASE', 'Z13-4'));
  p.push(pt(2090, 13, 'mcp', 'ROOF M&E MV ROOM', 'Z13-5'));

  return p.sort((a, b) => a.address - b.address);
}

/** Order in which the 7 points were disabled (1023 shows as 0002 of 0007). */
export const SITE_DISABLED = [1017, 1023, 1016, 1021, 1029, 2005, 2069];

/** Today's 20:21 local time, or 15 min ago if it is not yet 20:21. */
export function siteFaultTime(now: number): number {
  const d = new Date(now);
  d.setHours(20, 21, 4, 0);
  return d.getTime() <= now ? d.getTime() : now - 15 * 60_000;
}

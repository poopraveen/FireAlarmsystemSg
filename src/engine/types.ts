// Shared types for the ZP3 panel model. Pure TypeScript (no DOM, no Node APIs)
// so the same engine runs in the browser simulator and in the Node gateway.

export type DeviceType = 'smoke' | 'heat' | 'mcp' | 'input' | 'flow' | 'output';

/** What the simulator is forcing a device to do. */
export type SimMode =
  | 'normal'
  | 'smoke' // smoke rising in chamber -> pre-alarm -> fire
  | 'heat' // temperature rising -> fire
  | 'mcp' // manual call point glass broken
  | 'active' // input contact operated (pump running, flow switch flowing, tank level)
  | 'openCircuit' // monitored line open / short (analog pinned high)
  | 'headRemoved' // detector head missing / no response (analog ~000)
  | 'dirty'; // contaminated chamber (drift compensation exhausted)

export type PointCond = 'Normal' | 'PreAlarm' | 'Fire' | 'Fault' | 'Active';

export interface Point {
  address: number; // e.g. 1011 = loop 1, device 011
  zone: number;
  type: DeviceType;
  /** ID text programmed into the panel (shown on REP. DISP screen). */
  id: string;
  /** Description from the master mimic / site drawings. */
  desc: string;
  /** Mimic reference, e.g. "Z1-8". */
  ref: string;
  thresh: number;
  sens: number;
  /** Six analog channels as shown on the panel: A1 = live value. */
  analogs: number[];
  disabled: boolean;
  cond: PointCond;
  faultText?: string;
  /** Epoch ms when the current cond started. */
  since?: number;
  latchedFire?: number;
  latchedFault?: number;
  sim: SimMode;
  /** internal ramp value for smoke/heat simulation */
  ramp?: number;
}

export interface Zone {
  number: number;
  name: string;
  disabled: boolean;
}

export type EventKind =
  | 'FIRE'
  | 'PRE-ALARM'
  | 'FAULT'
  | 'CLEAR'
  | 'ACTIVE'
  | 'DISABLE'
  | 'ENABLE'
  | 'RESET'
  | 'SILENCE'
  | 'SOUND'
  | 'ACCEPT'
  | 'ACCESS'
  | 'SYSTEM'
  | 'SIM';

export interface PanelEvent {
  seq: number;
  time: number;
  kind: EventKind;
  text: string;
  detail?: string;
  address?: number;
  zone?: number;
  actor: string;
}

export type PanelKey =
  | 'ACCEPT'
  | 'RESET'
  | 'FIRE'
  | 'FAULT'
  | 'DISABLED'
  | 'OTHER'
  | 'SILENCE'
  | 'SOUND'
  | 'HELP'
  | 'VIEW_POINTS'
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT'
  | 'ENTER'
  | 'MENU'
  | 'ESC'
  | 'HOME'
  | 'F1'
  | 'F2'
  | 'DAY_NIGHT'
  | 'SOUNDERS'
  | 'LAMP_TEST'
  | 'D0'
  | 'D1'
  | 'D2'
  | 'D3'
  | 'D4'
  | 'D5'
  | 'D6'
  | 'D7'
  | 'D8'
  | 'D9';

export type ListKind = 'fire' | 'fault' | 'disabled' | 'other';

export type Screen =
  | { s: 'auto' }
  | { s: 'list'; kind: ListKind; mode: 'zones' | 'points'; idx: number }
  | { s: 'viewpoints'; idx: number }
  | { s: 'help' }
  | { s: 'menu' }
  | { s: 'password'; buf: string }
  | { s: 'maint' }
  | { s: 'editdis' }
  | { s: 'enteraddr'; target: 'point' | 'zone'; purpose: 'edit' | 'repdisp'; buf: string }
  | { s: 'confirmdis'; target: 'point' | 'zone'; addr: number; choice?: 1 | 2 }
  | { s: 'repdisp'; idx: number }
  | { s: 'viewdisabled'; idx: number }
  | { s: 'eventlog'; idx: number }
  | { s: 'message'; lines: string[]; until: number; back: Screen };

export interface SystemStatus {
  mains: boolean;
  batteryV: number;
  earthFault: boolean;
  chargerFault: boolean;
}

export interface PanelState {
  model: string;
  panelNo: number;
  nodeNo: number;
  site: string;
  now: number;
  tick: number;
  zones: Zone[];
  points: Point[];
  system: SystemStatus;
  systemFaultSince: Record<string, number>;
  keySwitch: boolean; // access level 2 key
  maintUntil: number; // access level 3 (password) expiry
  buzzer: boolean; // panel buzzer sounding
  lastAcceptAt: number;
  sounders: 'off' | 'active' | 'silenced';
  soundersEnabled: boolean;
  remoteAlarm: boolean; // DECAM / fire brigade signal
  dayMode: boolean;
  delayUntil: number; // investigation delay end (day mode), 0 = none
  lampTestUntil: number;
  events: PanelEvent[];
  seq: number;
  /** Point addresses in the order they were disabled (panel lists them this way). */
  disabledOrder: number[];
  screen: Screen;
  lastKeyAt: number;
}

export type SimAction =
  | { a: 'device'; address: number; mode: SimMode }
  | { a: 'repair'; address: number }
  | { a: 'mains'; ok: boolean }
  | { a: 'battery'; volts: number }
  | { a: 'earth'; fault: boolean }
  | { a: 'preset'; name: 'site' | 'clean' };

export type Command =
  | { t: 'key'; key: PanelKey }
  | { t: 'keyswitch'; on: boolean }
  | { t: 'login'; password: string }
  | { t: 'logout' }
  | { t: 'setDisabled'; target: 'point' | 'zone'; addr: number; disabled: boolean }
  | { t: 'sim'; action: SimAction };

export interface CommandResult {
  ok: boolean;
  message: string;
}

/** Light state for one LED: off, steady or flashing. */
export type Led = 0 | 1 | 2;

export interface Leds {
  fire: Led;
  fault: Led;
  disabled: Led;
  other: Led;
  silence: Led;
  sound: Led;
  power: Led;
  night: Led;
  day: Led;
  moreTime: Led;
  enableSounders: Led;
  matrix: Record<
    'system' | 'zone' | 'point' | 'sounders' | 'remote' | 'outputs',
    Record<'active' | 'fault' | 'disable' | 'delayed' | 'prealm' | 'test', Led>
  >;
}

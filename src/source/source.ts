// Data sources for the UI. Both deliver the same PanelView and accept the same
// Commands, so the dashboard behaves identically on the simulator and remotely.
import { PanelEngine } from '../engine/engine.ts';
import type { Command, CommandResult } from '../engine/types.ts';
import type { PanelView } from '../engine/view.ts';

export type ConnStatus =
  | { state: 'connecting'; url?: string }
  | { state: 'online'; role: 'operator' | 'viewer'; driver: string; operator: string; url?: string; backup?: boolean }
  | { state: 'offline'; reason: string; url?: string };

export interface PanelSource {
  readonly kind: 'sim' | 'remote';
  subscribe(cb: (v: PanelView) => void): () => void;
  onStatus(cb: (s: ConnStatus) => void): () => void;
  send(cmd: Command): Promise<CommandResult>;
  close(): void;
}

/** Runs the ZP3 model in the browser - used for the stand-alone demo. */
export class SimSource implements PanelSource {
  readonly kind = 'sim' as const;
  readonly engine: PanelEngine;
  private timer: ReturnType<typeof setInterval>;
  private operator: string;

  constructor(operator = 'demo') {
    this.operator = operator;
    this.engine = new PanelEngine({ preset: 'site' });
    this.timer = setInterval(() => this.engine.tick(), 1000);
  }
  subscribe(cb: (v: PanelView) => void) {
    return this.engine.subscribe(cb);
  }
  onStatus(cb: (s: ConnStatus) => void) {
    cb({ state: 'online', role: 'operator', driver: 'browser simulator', operator: this.operator });
    return () => {};
  }
  async send(cmd: Command) {
    return this.engine.dispatch(cmd, `${this.operator} (web)`);
  }
  close() {
    clearInterval(this.timer);
  }
}

type ServerMsg =
  | { type: 'welcome'; role: 'operator' | 'viewer'; driver: string; operator: string }
  | { type: 'view'; view: PanelView }
  | { type: 'result'; id: number; result: CommandResult }
  | { type: 'error'; message: string };

/**
 * Connects to the gateway (server/gateway.ts) over WebSocket.
 * `url` may list several gateways separated by commas: if one drops, the next
 * is tried. While no gateway answers, the last view received stays available
 * so the app can show it as last-known (stale) status.
 */
export class RemoteSource implements PanelSource {
  readonly kind = 'remote' as const;
  private ws?: WebSocket;
  private views = new Set<(v: PanelView) => void>();
  private statuses = new Set<(s: ConnStatus) => void>();
  private pending = new Map<number, (r: CommandResult) => void>();
  private nextId = 1;
  private last?: PanelView;
  private status: ConnStatus = { state: 'connecting' };
  private closed = false;
  private retry?: ReturnType<typeof setTimeout>;
  private urls: string[];
  private idx = 0;
  private failures = 0;
  private token: string;
  private operator: string;

  constructor(url: string, token: string, operator: string) {
    this.urls = url.split(/[\s,]+/).filter(Boolean);
    if (this.urls.length === 0) this.urls = ['ws://localhost:8080/ws'];
    this.token = token;
    this.operator = operator;
    this.connect();
  }

  private setStatus(s: ConnStatus) {
    this.status = s;
    for (const cb of this.statuses) cb(s);
  }

  private get url() {
    return this.urls.at(this.idx % this.urls.length)!;
  }

  private connect() {
    const url = this.url;
    this.setStatus({ state: 'connecting', url });
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.setStatus({ state: 'offline', reason: String(e), url });
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token: this.token, operator: this.operator }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMsg;
      if (msg.type === 'welcome') {
        this.failures = 0;
        this.setStatus({ state: 'online', role: msg.role, driver: msg.driver, operator: msg.operator, url, backup: this.idx % this.urls.length !== 0 });
      }
      else if (msg.type === 'view') {
        this.last = msg.view;
        for (const cb of this.views) cb(msg.view);
      } else if (msg.type === 'result') {
        this.pending.get(msg.id)?.(msg.result);
        this.pending.delete(msg.id);
      } else if (msg.type === 'error') this.setStatus({ state: 'offline', reason: msg.message, url });
    };
    let ended = false;
    // Some runtimes fire only 'error' (no 'close') when a connection is refused,
    // so both events end this attempt, once.
    ws.onerror = () => {
      if (ws.readyState !== WebSocket.OPEN) end();
    };
    ws.onclose = () => end();
    const end = () => {
      if (ended || ws !== this.ws) return;
      ended = true;
      for (const r of this.pending.values()) r({ ok: false, message: 'Connection lost' });
      this.pending.clear();
      if (this.closed) return;
      const next = this.urls.length > 1 ? ' - trying backup gateway' : ' - retrying';
      if (this.status.state !== 'offline' || !this.status.reason.startsWith('Invalid'))
        this.setStatus({ state: 'offline', reason: `Gateway not reachable${next}`, url });
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (this.closed) return;
    clearTimeout(this.retry);
    this.failures += 1;
    this.idx += 1; // fail over to the next gateway in the list
    const delay = Math.min(30_000, 2000 * Math.ceil(this.failures / this.urls.length));
    this.retry = setTimeout(() => this.connect(), delay);
  }

  subscribe(cb: (v: PanelView) => void) {
    this.views.add(cb);
    if (this.last) cb(this.last);
    return () => {
      this.views.delete(cb);
    };
  }
  onStatus(cb: (s: ConnStatus) => void) {
    this.statuses.add(cb);
    cb(this.status);
    return () => {
      this.statuses.delete(cb);
    };
  }
  send(cmd: Command): Promise<CommandResult> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve({ ok: false, message: 'Not connected to gateway' });
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      ws.send(JSON.stringify({ type: 'cmd', id, cmd }));
      setTimeout(() => {
        if (this.pending.delete(id)) resolve({ ok: false, message: 'Gateway did not respond' });
      }, 8000);
    });
  }
  close() {
    this.closed = true;
    clearTimeout(this.retry);
    this.ws?.close();
  }
}

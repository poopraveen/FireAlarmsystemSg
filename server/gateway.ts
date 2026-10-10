// Remote-control gateway: serves the web app and a WebSocket API that streams
// the panel view and accepts operator commands, with token auth, roles,
// rate limiting and an append-only audit log.
//
//   npm run build && npm run gateway        -> http://localhost:8080
//
// Env: PORT, OPERATOR_TOKEN, VIEWER_TOKEN, MAINT_PASSWORD, DRIVER=mock|ziton,
//      ZITON_PORT, CONTROL_ENABLED=true|false, AUDIT_LOG
import { createReadStream, existsSync, mkdirSync, appendFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Command } from '../src/engine/types.ts';
import type { PanelDriver } from './drivers/driver.ts';
import { MockDriver } from './drivers/mock.ts';
import { ZitonDriver } from './drivers/ziton.ts';

const env = process.env;
const PORT = Number(env.PORT ?? 8080);
const OPERATOR_TOKEN = env.OPERATOR_TOKEN ?? 'operator-demo';
const VIEWER_TOKEN = env.VIEWER_TOKEN ?? 'viewer-demo';
const CONTROL_ENABLED = (env.CONTROL_ENABLED ?? 'true') !== 'false';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(root, 'dist');
const AUDIT = env.AUDIT_LOG ?? join(root, 'logs', 'audit.jsonl');

const driver: PanelDriver =
  env.DRIVER === 'ziton'
    ? new ZitonDriver({ port: env.ZITON_PORT ?? '/dev/ttyUSB0', controlEnabled: CONTROL_ENABLED })
    : new MockDriver({ maintPassword: env.MAINT_PASSWORD });

function audit(entry: Record<string, unknown>) {
  mkdirSync(dirname(AUDIT), { recursive: true });
  appendFileSync(AUDIT, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

// ---------------------------------------------------------------- static files
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};
const http = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, driver: driver.name, clients: wss.clients.size }));
    return;
  }
  let file = normalize(join(DIST, url.pathname));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Build the web app first: npm run build');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

// ---------------------------------------------------------------- websocket
interface Client {
  ws: WebSocket;
  role?: 'operator' | 'viewer';
  operator: string;
  ip: string;
  window: number[];
}
const wss = new WebSocketServer({ server: http, path: '/ws' });
const clients = new Set<Client>();

function send(c: Client, msg: unknown) {
  if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
}

const CONTROL_KEYS = new Set(['RESET', 'SILENCE', 'SOUND', 'DAY_NIGHT', 'SOUNDERS']);

wss.on('connection', (ws, req) => {
  const c: Client = { ws, operator: 'unknown', ip: req.socket.remoteAddress ?? '?', window: [] };
  clients.add(c);
  const helloTimer = setTimeout(() => ws.close(4001, 'hello timeout'), 5000);

  ws.on('message', async (raw) => {
    let msg: { type?: string; token?: string; operator?: string; id?: number; cmd?: Command };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === 'hello') {
      clearTimeout(helloTimer);
      const role = msg.token === OPERATOR_TOKEN ? 'operator' : msg.token === VIEWER_TOKEN ? 'viewer' : undefined;
      if (!role) {
        audit({ event: 'auth_failed', ip: c.ip, operator: msg.operator });
        send(c, { type: 'error', message: 'Invalid access token' });
        ws.close(4003, 'unauthorised');
        return;
      }
      c.role = role;
      c.operator = String(msg.operator || role).slice(0, 40);
      audit({ event: 'connect', ip: c.ip, operator: c.operator, role });
      send(c, { type: 'welcome', role, driver: driver.name, operator: c.operator });
      send(c, { type: 'view', view: driver.view() });
      return;
    }

    if (msg.type === 'cmd' && typeof msg.id === 'number' && msg.cmd) {
      const reply = (ok: boolean, message: string) => send(c, { type: 'result', id: msg.id, result: { ok, message } });
      if (!c.role) return reply(false, 'Not authenticated');
      if (c.role !== 'operator') return reply(false, 'Viewer access is read-only');
      if (!CONTROL_ENABLED) return reply(false, 'Remote control is disabled on this gateway');
      if (msg.cmd.t === 'sim' && !driver.supportsSim) return reply(false, 'Simulation is not available on real hardware');
      const now = Date.now();
      c.window = c.window.filter((t) => now - t < 1000);
      if (c.window.length >= 10) return reply(false, 'Too many commands - slow down');
      c.window.push(now);

      const actor = `${c.operator} (remote)`;
      const result = await driver.dispatch(msg.cmd, actor);
      // Every control action is audited; navigation keys only when they change access.
      const isControl =
        msg.cmd.t !== 'key' || CONTROL_KEYS.has(msg.cmd.key) || msg.cmd.key === 'ACCEPT' || msg.cmd.key === 'ENTER';
      if (isControl) audit({ event: 'command', ip: c.ip, operator: c.operator, cmd: msg.cmd, result });
      send(c, { type: 'result', id: msg.id, result });
    }
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    clients.delete(c);
    if (c.role) audit({ event: 'disconnect', ip: c.ip, operator: c.operator });
  });
});

// Stream the panel view to every authenticated client.
driver.onView((view) => {
  const data = JSON.stringify({ type: 'view', view });
  for (const c of clients) if (c.role && c.ws.readyState === c.ws.OPEN) c.ws.send(data);
});

await driver.start();
http.listen(PORT, () => {
  console.log(`FireAlarmsystemSg gateway on http://localhost:${PORT}  (ws: /ws, driver: ${driver.name})`);
  console.log(`operator token: ${OPERATOR_TOKEN === 'operator-demo' ? 'operator-demo (default - change it!)' : '(set)'}`);
});

const shutdown = async () => {
  await driver.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

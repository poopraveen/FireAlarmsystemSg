# FireAlarmsystemSg

Remote console and simulator for the **Ziton ZP3 main alarm panel (Node 01)** and its master mimic.
The web app reproduces the panel's front fascia — the same 4 × 40 LCD screens, keys, LED matrix,
keypad and key switch — and lets an operator run every panel control remotely: accept, silence,
reset, sound alarms, day/night/more time, sounder enable, lamp test, fault/disabled/other lists,
view points, maintenance menus, rep. display of analogs, and disable/enable of points and zones.

For the demo it runs a behavioural model of the panel, preloaded with the site as it was on
**10 Oct 2026 20:21**: faults on Z100 *Pumps and Tank Status* (point 1011, analog 194) and Z001
*1st Storey* (point 1029 smoke, analog 000), and 7 disabled points
(1017, 1023, 1016, 1021, 1029, 2005, 2069).

## Run it

```bash
npm install
npm run dev          # simulator in the browser: http://localhost:5173
npm test             # engine tests (LCD screens match the real panel)
```

Remote mode, with the gateway serving the app and the WebSocket API:

```bash
npm run build
OPERATOR_TOKEN=change-me VIEWER_TOKEN=view-only MAINT_PASSWORD=1234 npm run gateway
# open http://localhost:8080, Connection tab -> Remote gateway, token change-me
```

Demo credentials: operator token `operator-demo`, viewer token `viewer-demo`, maintenance password `1234`.

## Deploy to Vercel

The web app is a static Vite build, so Vercel hosts it as-is (`vercel.json` is included):

1. vercel.com → **Add New → Project** → import `poopraveen/FireAlarmsystemSg`.
2. Leave the detected settings (Vite, `npm run build`, output `dist`) and click **Deploy**.

The hosted app opens in simulator mode, so the demo works with no server.
Vercel cannot host the WebSocket gateway (serverless functions do not keep WebSocket connections open).
For remote mode, run `npm run gateway` on a host that supports WebSockets (Render, Railway, Fly.io, an Azure/AWS VM),
then set `VITE_GATEWAY_URL=wss://<your-gateway>/ws` in the Vercel project's environment variables and redeploy.

## What's in the app

| Area | What it does |
| --- | --- |
| Panel replica | Every key on the ZP3 fascia and keypad, LCD rendered by the engine, LEDs incl. flashing for unaccepted events |
| Remote operation | One-click Accept / Silence / Reset / Sound with confirmation, key switch (level 2), maintenance login (level 3) |
| Master mimic | Sprinkler and hosereel pump/tank status (1010–1023), control valve 1032, 2nd–12th storey addressing grid, roof, 1st storey, basements |
| Diagnostics | All points with live A1 value, condition and six analog channels, threshold chart, disable/enable |
| Event log | Panel events and the operator audit trail (who did what, from where) |
| Simulator | Fires, call points, sprinkler flow, pump run/trip, tank levels, dirty detector, mains/battery/earth faults, repair devices |

## Panel behaviour modelled

- **Access levels**: 1 = view and accept; 2 = key switch ON (reset, silence, sound, day/night, sounders); 3 = maintenance password (disable/enable, rep. display), times out after 10 minutes.
- **Latching**: fire and fault latch until RESET. Anything still present comes back straight after a reset, like the real panel.
- **Disabled points** do not raise fire or "active", but still report device faults.
- **Day mode** gives detectors a 30 s investigation delay before sounders operate; call points and flow switches alarm immediately; *More time* adds 60 s.
- **New fire after silence** re-sounds the alarms. Fire also signals the remote alarm (DECAM) output.
- **Analog model**: smoke ≈ 032 clean air, fire threshold 135, pre-alarm at 75 %; input modules 016 normal, ~064 active, ≥138 open/short circuit, ≤4 no response.

## Architecture

```
src/engine/   ZP3 model (pure TypeScript - runs in browser and Node)
  engine.ts   state, access levels, latching, menus, simulator actions
  lcd.ts      renders the 4 x 40 LCD exactly as the panel lays it out
  view.ts     PanelView = state + LCD + LEDs (what every client draws)
  preset.ts   site addressing from the master mimic, disabled points, 20:21 faults
src/source/   SimSource (in-browser) and RemoteSource (WebSocket to the gateway)
src/components/  Panel replica, Mimic, Diagnostics, Event log, Simulator
server/gateway.ts   HTTP + WebSocket gateway: token auth, operator/viewer roles,
                    rate limit, audit log (logs/audit.jsonl)
server/drivers/     mock.ts (simulated panel) and ziton.ts (hardware placeholder)
```

WebSocket protocol (`/ws`): client sends `{type:'hello', token, operator}`, then
`{type:'cmd', id, cmd}`; server sends `welcome`, `view` (every second and after each command)
and `result`.

## Connecting the real panel

`server/drivers/ziton.ts` is a placeholder — nothing in this repo talks to the hardware yet.
To connect the real ZP3 you need, from the panel's maintenance contractor (Fire Protection Company):

1. A supported interface on the panel (network / BMS interface card, approved serial event output, or a certified remote panel/gateway).
2. Its protocol documentation (events, analog values, and the accept / silence / reset / disable commands).
3. Agreement from the contractor and the building's Fire Safety Manager before remote silence, reset or disablement is switched on. Start with read-only monitoring (`CONTROL_ENABLED=false`) and add control afterwards.

Then implement the driver and run `DRIVER=ziton npm run gateway`. The web app and protocol stay the same.

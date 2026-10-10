import type { Command, Led, PanelKey } from '../engine/types.ts';
import type { PanelView } from '../engine/view.ts';
import './panel.css';

interface Props {
  view: PanelView;
  send: (cmd: Command) => void;
}

const cls = (led: Led, color: string) => `lamp ${color}${led ? ' on' : ''}${led === 2 ? ' flash' : ''}`;
const dot = (led: Led, green = false) => `pled${green ? ' green' : ''}${led ? ' on' : ''}${led === 2 ? ' flash' : ''}`;

const MATRIX_ROWS = [
  ['system', 'System'],
  ['zone', 'Zone'],
  ['point', 'Point'],
  ['sounders', 'Sounders'],
  ['remote', 'Remote Alarm'],
  ['outputs', 'Control Outputs'],
] as const;
const MATRIX_COLS = [
  ['active', 'Active'],
  ['fault', 'Fault'],
  ['disable', 'Disable'],
  ['delayed', 'Delayed'],
  ['prealm', 'Pre-Alm'],
  ['test', 'Test'],
] as const;

export function Panel({ view, send }: Props) {
  const { leds, lcd, state } = view;
  const key = (k: PanelKey) => () => send({ t: 'key', key: k });
  const locked = view.access < 2 ? ' locked' : '';

  return (
    <div className="zp3" aria-label="Ziton ZP3 main alarm panel">
      <div className="zp3-label">
        <div className="zp3-tag">
          MAIN ALARM PANEL &nbsp;NODE NO : <b>{String(state.nodeNo).padStart(2, '0')}</b>
        </div>
        <div className="zp3-brand">ZITON ZP3 · FIRE ALARM SYSTEM</div>
      </div>

      <div className="fascia">
        <div className="fascia-in">
          {/* Row 1: help / view points, LCD, more */}
          <div className="zp3-row r1">
            <div className="leftkeys">
              <div className="lk">
                <button className="k" aria-label="Help" onClick={key('HELP')} />
                <span>Help</span>
              </div>
              <div className="lk">
                <button className="k" aria-label="View points" onClick={key('VIEW_POINTS')} />
                <span>
                  View
                  <br />
                  Points
                </span>
              </div>
            </div>
            <div className="lcd" role="status" aria-live="polite" aria-label="Panel display">
              {lcd.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
            <div className="morekeys">
              <span className="lbl">▲</span>
              <button className="k" aria-label="More up" onClick={key('UP')} />
              <span className="lbl">More</span>
              <button className="k" aria-label="More down" onClick={key('DOWN')} />
              <span className="lbl">▼</span>
            </div>
          </div>

          {/* Row 2: accept, reset, status keys, silence, sound */}
          <div className="zp3-row r2">
            <div className="cell">
              <span className="lbl">Accept / Mute Buzzer</span>
              <span className="lamp empty" />
              <button className="k" aria-label="Accept, mute buzzer" onClick={key('ACCEPT')} />
            </div>
            <div className="cell">
              <span className="lbl">Reset</span>
              <span className="lamp empty" />
              <button className={'k' + locked} aria-label="Reset" onClick={key('RESET')} />
            </div>
            <div className="cell">
              <span className="lbl">Fire</span>
              <span className={cls(leds.fire, 'red')} />
              <button className="k" aria-label="Fire list" onClick={key('FIRE')} />
            </div>
            <div className="cell">
              <span className="lbl">Fault</span>
              <span className={cls(leds.fault, 'amber')} />
              <button className="k" aria-label="Fault list" onClick={key('FAULT')} />
            </div>
            <div className="cell">
              <span className="lbl">Disabled</span>
              <span className={cls(leds.disabled, 'amber')} />
              <button className="k" aria-label="Disabled list" onClick={key('DISABLED')} />
            </div>
            <div className="cell">
              <span className="lbl">Other</span>
              <span className={cls(leds.other, 'yellow')} />
              <button className="k" aria-label="Other list" onClick={key('OTHER')} />
            </div>
            <div className="cell">
              <span className="lbl">Silence Alarms</span>
              <span className={cls(leds.silence, 'yellow')} />
              <button className={'k' + locked} aria-label="Silence alarms" onClick={key('SILENCE')} />
            </div>
            <div className="cell">
              <span className="lbl">Sound Alarms</span>
              <span className={cls(leds.sound, 'red')} />
              <button className={'k' + locked} aria-label="Sound alarms" onClick={key('SOUND')} />
            </div>
          </div>

          {/* Row 3: day/night, LED matrix, sounders, key switch */}
          <div className="zp3-row r3">
            <div className="modes">
              <div className="m">
                <span className={dot(leds.night)} />
                <span className="lbl">Night</span>
              </div>
              <div className="m">
                <span className={dot(leds.day)} />
                <span className="lbl">Day</span>
              </div>
              <div className="m">
                <span className={dot(leds.moreTime)} />
                <span className="lbl">More Time</span>
              </div>
              <button className={'k' + locked} aria-label="Day, night, more time" onClick={key('DAY_NIGHT')} />
            </div>
            <div className="mx" style={{ minWidth: 0, overflowX: 'auto' }}>
              <table className="matrix">
                <thead>
                  <tr>
                    <th>
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        Power On <span className={dot(leds.power, true)} />
                      </span>
                    </th>
                    {MATRIX_COLS.map(([k, l]) => (
                      <th key={k}>{l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MATRIX_ROWS.map(([r, label]) => (
                    <tr key={r}>
                      <td>{label}</td>
                      {MATRIX_COLS.map(([c]) => (
                        <td key={c}>
                          <span className={dot(leds.matrix[r][c])} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sw">
              <span className="lbl">
                Enable
                <br />
                Sounders
                <br />
                Enable/Disable
              </span>
              <span className={dot(leds.matrix.sounders.disable)} title="Sounders disabled" />
              <button className={'k' + locked} aria-label="Sounders enable or disable" onClick={key('SOUNDERS')} />
            </div>
            <div className="sw">
              <span className="lbl">Controls</span>
              <button
                className={'keyswitch' + (state.keySwitch ? ' on' : '')}
                aria-label={`Key switch ${state.keySwitch ? 'on' : 'off'} - access level 2`}
                aria-pressed={state.keySwitch}
                onClick={() => send({ t: 'keyswitch', on: !state.keySwitch })}
              >
                <i />
              </button>
              <span className="swlbl lbl">
                <span style={{ opacity: state.keySwitch ? 1 : 0.5 }}>On</span>
                <span style={{ opacity: state.keySwitch ? 0.5 : 1 }}>Off</span>
              </span>
            </div>
          </div>
        </div>

        <div className="lower">
          <div className="plate">
            <h4>Disable / Enable Procedure</h4>
            <ol>
              <li>Press MENU, then 3 for Maintenance</li>
              <li>Enter password and press ↵ (demo: 1234)</li>
              <li>Press 1 for Edit Disable</li>
              <li>Press 1 for a point or 2 for a zone</li>
              <li>Enter the address and press ↵</li>
              <li>Press 1 to disable or 2 to enable, then ↵</li>
              <li>Repeat for each point, then press ⌂ Home</li>
            </ol>
          </div>
          <div className="keypad" aria-label="Keypad">
            {(
              [
                ['D1', '1', 'ABC'],
                ['D2', '2', 'DEF'],
                ['D3', '3', 'GHI'],
                ['F1', 'F1'],
                ['UP', '▲'],
                ['D4', '4', 'JKL'],
                ['D5', '5', 'MNO'],
                ['D6', '6', 'PQR'],
                ['F2', 'F2'],
                ['DOWN', '▼'],
                ['D7', '7', 'STU'],
                ['D8', '8', 'VWX'],
                ['D9', '9', 'YZ'],
                ['LEFT', '◀'],
                ['RIGHT', '▶'],
                ['MENU', '☰'],
                ['D0', '0', '[ ]'],
                ['ENTER', '↵'],
                ['ESC', '⎋'],
                ['HOME', '⌂'],
              ] as [PanelKey, string, string?][]
            ).map(([k, l, sub]) => (
              <button
                key={k}
                className="kp"
                aria-label={k === 'MENU' ? 'Menu' : k === 'ESC' ? 'Escape' : k === 'HOME' ? 'Home' : k === 'ENTER' ? 'Enter' : l}
                onClick={key(k)}
              >
                <span>
                  {l}
                  {sub && <small>{sub}</small>}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

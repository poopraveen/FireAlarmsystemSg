import type { Command, CommandResult } from '../../src/engine/types.ts';
import type { PanelView } from '../../src/engine/view.ts';
import type { PanelDriver } from './driver.ts';

/**
 * Placeholder for the real Ziton ZP3 connection.
 *
 * Nothing here talks to hardware yet. To make it real you need, from the
 * panel's maintenance contractor (the panel is serviced by Fire Protection
 * Company / FPC):
 *
 *  1. A supported interface on the panel - e.g. the ZP3 network / BMS
 *     interface card, a manufacturer-approved serial event output, or a
 *     certified remote control panel / gateway on the panel network.
 *  2. The protocol documentation for that interface (event messages for
 *     fire / fault / disable, analog values, and the control commands for
 *     accept, silence, reset, disable / enable).
 *  3. Approval to issue control commands remotely. Remote silence, reset and
 *     disablement of a life-safety system must be agreed with the building's
 *     Fire Safety Manager and the contractor before it is enabled.
 *
 * Implement read-only status first (subscribe to events and map them onto a
 * PanelView), and only then add control commands behind CONTROL_ENABLED.
 */
export class ZitonDriver implements PanelDriver {
  readonly name = 'Ziton ZP3 (hardware)';
  readonly supportsSim = false;

  private readonly opts: { port: string; controlEnabled: boolean };

  constructor(opts: { port: string; controlEnabled: boolean }) {
    this.opts = opts;
  }

  async start() {
    throw new Error(
      `ZitonDriver is not implemented. Configure the panel interface on ${this.opts.port} ` +
        'with the maintenance contractor, then implement the protocol in server/drivers/ziton.ts.',
    );
  }
  async stop() {}
  view(): PanelView {
    throw new Error('not connected');
  }
  onView(): () => void {
    return () => {};
  }
  async dispatch(_cmd: Command): Promise<CommandResult> {
    if (!this.opts.controlEnabled) return { ok: false, message: 'Remote control is disabled for the hardware driver' };
    return { ok: false, message: 'Hardware control not implemented' };
  }
}

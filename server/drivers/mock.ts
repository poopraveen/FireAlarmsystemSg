import { PanelEngine } from '../../src/engine/engine.ts';
import type { Command } from '../../src/engine/types.ts';
import type { PanelView } from '../../src/engine/view.ts';
import type { PanelDriver } from './driver.ts';

/** Runs the ZP3 behavioural model on the server and ticks it every second. */
export class MockDriver implements PanelDriver {
  readonly name = 'mock ZP3 (simulated)';
  readonly supportsSim = true;
  private engine: PanelEngine;
  private timer?: ReturnType<typeof setInterval>;

  constructor(opts: { maintPassword?: string } = {}) {
    this.engine = new PanelEngine({ preset: 'site', maintPassword: opts.maintPassword });
  }
  async start() {
    this.timer = setInterval(() => this.engine.tick(), 1000);
  }
  async stop() {
    clearInterval(this.timer);
  }
  view(): PanelView {
    return this.engine.view();
  }
  onView(cb: (v: PanelView) => void) {
    return this.engine.subscribe(cb);
  }
  async dispatch(cmd: Command, actor: string) {
    return this.engine.dispatch(cmd, actor);
  }
}

import type { Command, CommandResult } from '../../src/engine/types.ts';
import type { PanelView } from '../../src/engine/view.ts';

/**
 * A driver connects the gateway to a panel. The gateway only talks to this
 * interface, so swapping the simulator for real hardware does not change the
 * web app or the WebSocket protocol.
 */
export interface PanelDriver {
  readonly name: string;
  /** Whether simulator commands ({t:'sim'}) are accepted. */
  readonly supportsSim: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  view(): PanelView;
  onView(cb: (v: PanelView) => void): () => void;
  dispatch(cmd: Command, actor: string): Promise<CommandResult>;
}

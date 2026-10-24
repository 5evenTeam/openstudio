import { BridgeState } from "./state.js";
import { StudioCommand } from "./state.js";
import { STUDIO_TIMEOUT_MS, makeCommandId } from "../config.js";
import type { StudioResult } from "./state.js";

export function sendStudioCommand(
  state: BridgeState,
  isStudioConnected: (staleMs: number) => boolean,
  staleMs: number,
  type: StudioCommand["type"],
  payload: Record<string, unknown> = {},
): Promise<StudioResult> {
  if (!isStudioConnected(staleMs)) {
    return Promise.reject(new Error("Roblox Studio is not connected. Run openstudio_connect after starting the plugin."));
  }

  const command: StudioCommand = {
    id: makeCommandId(),
    type,
    payload,
    createdAt: Date.now(),
  };

  state.enqueue(command);

  return new Promise<StudioResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      state.rejectPending(command.id, new Error(`Studio command timed out: ${type}`));
    }, STUDIO_TIMEOUT_MS);

    state.addPending(command.id, resolve, reject, timer);
  });
}

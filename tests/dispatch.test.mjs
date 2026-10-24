import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const { BridgeState } = await import(pathToFileURL(path.join(dist, "bridge", "state.js")).href);
const { HEARTBEAT_STALE_MS } = await import(pathToFileURL(path.join(dist, "config.js")).href);
const dispatch = await import(pathToFileURL(path.join(dist, "bridge", "dispatch.js")).href);

test("sendStudioCommand rejects when Studio is disconnected", async () => {
  const state = new BridgeState();
  await assert.rejects(
    () => dispatch.sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "status", {}),
    /Roblox Studio is not connected/
  );
});

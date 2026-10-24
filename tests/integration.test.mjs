import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const { BridgeState } = await import(pathToFileURL(path.join(dist, "bridge", "state.js")).href);
const { createBridgeHttpServer } = await import(pathToFileURL(path.join(dist, "bridge", "httpServer.js")).href);
const { BRIDGE_PORT, BRIDGE_TOKEN, HEARTBEAT_STALE_MS } = await import(pathToFileURL(path.join(dist, "config.js")).href);
const dispatch = await import(pathToFileURL(path.join(dist, "bridge", "dispatch.js")).href);

test("mock Studio client completes a write_script command", async () => {
  const state = new BridgeState();
  const http = createBridgeHttpServer(state);
  http.listen();
  await new Promise((resolve) => setTimeout(resolve, 50));

  state.setHeartbeat("mock-studio", "0.1.0", ["write_script"]);

  const mock = setInterval(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/commands?token=${BRIDGE_TOKEN}`, {
        headers: { "X-OpenStudio-Token": BRIDGE_TOKEN },
      });
      const body = await response.json();
      for (const command of body.commands ?? []) {
        await fetch(`http://127.0.0.1:${BRIDGE_PORT}/result`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-OpenStudio-Token": BRIDGE_TOKEN },
          body: JSON.stringify({
            id: command.id,
            ok: true,
            data: { path: command.payload.path, updated: true, previousSource: "print('old')" },
          }),
        });
      }
    } catch {
      // ignore transient poll errors
    }
  }, 50);

  const result = await dispatch.sendStudioCommand(
    state,
    state.isStudioConnected.bind(state),
    HEARTBEAT_STALE_MS,
    "write_script",
    { path: "ServerScriptService.Main", source: "print('new')" },
  );

  clearInterval(mock);
  http.close();

  assert.equal(result.ok, true);
  assert.equal(result.data.updated, true);
});

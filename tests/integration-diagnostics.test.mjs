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

test("openstudio collect diagnostics-style command flow", async () => {
  const state = new BridgeState();
  const http = createBridgeHttpServer(state);
  http.listen();
  await new Promise((resolve) => setTimeout(resolve, 50));
  state.setHeartbeat("mock-studio", "0.2.11", ["test_game", "execute_lua"]);

  const mock = setInterval(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/commands?token=${BRIDGE_TOKEN}`, {
        headers: { "X-OpenStudio-Token": BRIDGE_TOKEN },
      });
      const body = await response.json();
      for (const command of body.commands ?? []) {
        const data = command.type === "test_game"
          ? { instanceCount: 5, scriptCount: 2, compileErrorCount: 0, uiIssueCount: 1 }
          : { ok: true, data: "runMode=false; client=true; server=true" };
        await fetch(`http://127.0.0.1:${BRIDGE_PORT}/result`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-OpenStudio-Token": BRIDGE_TOKEN },
          body: JSON.stringify({ id: command.id, ok: true, data }),
        });
      }
    } catch {
    }
  }, 50);

  try {
    const structural = await dispatch.sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "test_game", { root: "game" });
    const runtime = await dispatch.sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "execute_lua", { code: "return 'ok'" });
    assert.equal(structural.ok, true);
    assert.equal(structural.data.uiIssueCount, 1);
    assert.equal(runtime.ok, true);
  } finally {
    clearInterval(mock);
    http.close();
  }
});

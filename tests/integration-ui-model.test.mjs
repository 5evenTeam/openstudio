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

async function runRoundTrip(type, payload, responseData) {
  const state = new BridgeState();
  const http = createBridgeHttpServer(state);
  http.listen();
  await new Promise((resolve) => setTimeout(resolve, 50));
  state.setHeartbeat("mock-studio", "0.2.10", [type]);

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
          body: JSON.stringify({ id: command.id, ok: true, data: responseData }),
        });
      }
    } catch {
      // ignore transient poll errors
    }
  }, 50);

  try {
    const result = await dispatch.sendStudioCommand(
      state,
      state.isStudioConnected.bind(state),
      HEARTBEAT_STALE_MS,
      type,
      payload,
    );
    return result;
  } finally {
    clearInterval(mock);
    http.close();
  }
}

test("import_ui round-trips a UI tree", async () => {
  const result = await runRoundTrip(
    "import_ui",
    { parentPath: "game.StarterGui", node: { name: "StudioUI", className: "ScreenGui", children: [{ name: "Panel", className: "Frame" }] } },
    { root: "game.StarterGui.StudioUI", created: 2 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.created, 2);
});

test("import_model round-trips a part assembly", async () => {
  const result = await runRoundTrip(
    "import_model",
    { parentPath: "game.Workspace", modelName: "Blockout", objects: [{ name: "Base", shape: "block", size: { x: 4, y: 1, z: 4 } }] },
    { root: "game.Workspace.Blockout", created: 1 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.created, 1);
});

test("test_game round-trips a report", async () => {
  const result = await runRoundTrip(
    "test_game",
    { root: "game", maxNodes: 100, maxScripts: 25 },
    { instanceCount: 10, scriptCount: 2, compileErrorCount: 0, uiIssueCount: 0 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.scriptCount, 2);
});
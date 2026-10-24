import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const { BridgeState } = await import(pathToFileURL(path.join(dist, "bridge", "state.js")).href);
const { createBridgeHttpServer } = await import(pathToFileURL(path.join(dist, "bridge", "httpServer.js")).href);
const config = await import(pathToFileURL(path.join(dist, "config.js")).href);

test("BridgeState queues commands", () => {
  const state = new BridgeState();
  state.enqueue({ id: "1", type: "status", payload: {}, createdAt: Date.now() });
  assert.equal(state.dequeueAll().length, 1);
  assert.equal(state.dequeueAll().length, 0);
});

test("BridgeState resolves pending commands", () => {
  const state = new BridgeState();
  const result = new Promise((resolve) => {
    const timer = setTimeout(() => {}, 10);
    state.addPending("abc", resolve, () => {}, timer);
  });
  assert.equal(state.resolvePending({ id: "abc", ok: true }), true);
});

test("permission levels update and gate correctly", () => {
  const state = new BridgeState();
  assert.equal(state.setPermissionLevel("read-only"), true);
  assert.equal(state.hasPermission("scripts-only"), false);
  assert.equal(state.setPermissionLevel("full-edit"), true);
  assert.equal(state.hasPermission("scripts-only"), true);
});

test("bridge health endpoint responds", async () => {
  const state = new BridgeState();
  const http = createBridgeHttpServer(state);
  http.listen();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const response = await fetch(`http://127.0.0.1:${config.BRIDGE_PORT}/health`, {
    headers: { "X-OpenStudio-Token": config.BRIDGE_TOKEN },
  });
  const json = await response.json();
  assert.equal(response.ok, true);
  assert.equal(json.ok, true);
  http.close();
});

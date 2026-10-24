import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeState } from "./bridge/state.js";
import { createBridgeHttpServer } from "./bridge/httpServer.js";
import { registerTools } from "./tools.js";
import { BRIDGE_TOKEN, BRIDGE_VERSION, PROJECT_NAME, runtimeDir, tokenPath } from "./config.js";

async function main(): Promise<void> {
  const dir = runtimeDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tokenPath(), BRIDGE_TOKEN, "utf8");

  const state = new BridgeState();
  const http = createBridgeHttpServer(state);
  http.listen();

  const server = new McpServer({
    name: PROJECT_NAME,
    version: BRIDGE_VERSION,
  });

  registerTools(server, state);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[OpenStudio] MCP server running. Token file: ${tokenPath()}`);
  console.error(`[OpenStudio] Keep this process running while using Roblox Studio.`);

  const shutdown = () => {
    http.close();
    state.rejectAllPending(new Error("OpenStudio bridge shutting down"));
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[OpenStudio] fatal error:", error);
  process.exit(1);
});

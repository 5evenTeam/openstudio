# Architecture

OpenStudio has three parts:

1. MCP server (`src/index.ts`, `src/tools.ts`) exposes tools to OpenCode.
2. HTTP bridge (`src/bridge/*`) stores command queues and results and accepts heartbeats.
3. Roblox Studio plugin (`studio/OpenStudioPlugin.luau`) polls the bridge, executes commands, and reports results.

Command flow:

1. Tool calls `sendStudioCommand`.
2. Bridge enqueues command.
3. Plugin long-polls `/commands?wait=...`.
4. Plugin executes and posts `/result`.
5. Bridge resolves the original Promise.

Logs flow separately through `/heartbeat` and `/log`.

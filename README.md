# OpenStudio

OpenStudio is a local bridge that lets OpenCode inspect and edit scripts in an open Roblox Studio session through MCP.

## Current status

This repository implements **Phase 1**:

- MCP tools for Roblox Studio script read/write/create/delete/list.
- A localhost bridge used by the Studio plugin.
- A launcher `.bat` that validates required processes and runs the bridge.
- A Roblox Studio plugin that polls the bridge and executes commands.

It is a **script-level** bridge. It does not yet perform arbitrary instance tree editing, property writes, playtest control, or output-log capture.

## Requirements

- Node.js 20 or later
- OpenCode
- Roblox Studio
- A Roblox Studio plugin enabled for OpenStudio

## Install

Global install:

```powershell
npm install -g openstudio
```

Then configure OpenCode to run either:
- `openstudio` (Node entrypoint), or
- `C:\path\to\OpenStudio\OpenStudio.bat` on Windows

For Bloxstrap, launch Roblox Studio normally; OpenStudio detects any `*Studio*` process.

Install the Studio plugin from `studio/OpenStudioPlugin.luau` using Roblox Studio's plugin workflow.

Install dependencies and build:

```powershell
cd C:\Users\ianni\OpenStudio
npm install
npm run build
```

## Start OpenCode MCP server through the launcher

Configure OpenCode to launch the launcher (not `node` directly):

```json
{
  "mcp": {
    "openstudio": {
      "type": "local",
      "command": "C:\\Users\\ianni\\OpenStudio\\scripts\\OpenStudio.bat",
      "args": []
    }
  }
}
```

OpenCode will start the `.bat`, which checks that:

- Node.js is available
- OpenCode is running
- Roblox Studio is running
- Port `3777` is available

If all checks pass, it starts the Node bridge and keeps running.

To bypass checks for development, run with `OPENSTUDIO_SKIP_CHECKS=1`.

## Install the Studio plugin

Open Roblox Studio, create a new plugin script, and paste in:

`studio/OpenStudioPlugin.luau`

Or install it as a local plugin using Studio's normal plugin workflow.

## Token

The bridge writes its token to:

`data/token.txt`

By default this is:

`openstudio-local-dev-token`

Make sure the same token is configured in `studio/OpenStudioPlugin.luau` if you override `OPENSTUDIO_TOKEN`.

## Use

In OpenCode, available tools include:

Current Phase 1 and Phase 2 tools:

- Phase 1:
  - `openstudio_connect`
  - `openstudio_status`
  - `openstudio_list_scripts`
  - `openstudio_read_script`
  - `openstudio_write_script`
  - `openstudio_create_script`
  - `openstudio_delete_script`
- Phase 2:
  - `openstudio_get_selection`
  - `openstudio_get_instance_tree`
  - `openstudio_create_instance`
  - `openstudio_set_property`
  - `openstudio_get_output`
  - `openstudio_execute_lua`
- Phase 3:
  - `openstudio_delete_instance`
  - `openstudio_set_permission_level`
  - permission levels: `read-only`, `scripts-only`, `full-edit`
  - confirmation gates for destructive operations

Run `openstudio_connect` after Roblox Studio and the plugin are active.

## Safety

- Connections are local to `127.0.0.1`.
- Destructive operations should be reviewed before use.
- This is a development tool and is not hardened for untrusted environments.

## Limitations

- Play-mode control is not exposed by Roblox Studio plugins; use `openstudio_execute_lua` only for supported Studio/plugin operations. `openstudio_get_output` captures messages that the plugin's log connection forwards.
- Studio-side HTTP access to localhost may be blocked depending on Studio settings. If the plugin cannot reach the bridge, use the file-polling fallback (not implemented yet).
- Process detection in the `.bat` is Windows-specific and may need adjustment for different executable names.
- Studio plugin networking requires HttpService to permit the local request.

# OpenStudio

OpenStudio is a local MCP bridge and Roblox Studio plugin that lets OpenCode (and other MCP clients) inspect, edit, build, test, and capture Roblox Studio workflows.

Current release: **v0.2.9**  
Repository: https://github.com/5evenTeam/openstudio

## Features

- Script read/write/create/delete/list
- Instance tree inspection, creation, rename, search, inspection, deletion
- Declarative Roblox UI generation (StudioUI)
- UI presets: panel, button, toggle, tab bar, toast, animated button
- 3D model/part assembly from structured object descriptions
- Blender scene import through the model builder
- Game-wide structural tests
- Runtime status and assertion helpers
- Script compile checks
- Permission levels and backups
- Console/output capture
- Roblox Studio window screen capture
- Long-polling for near real-time command delivery
- Runtime version checks and update helpers

## Requirements

- Node.js 20+
- OpenCode or another MCP client
- Roblox Studio
- The OpenStudio Roblox Studio plugin

## Install and build

```powershell
git clone https://github.com/5evenTeam/openstudio.git
cd openstudio
npm install
npm run build
```

## OpenCode MCP configuration

Use the launcher so required checks run first:

```json
{
  "mcp": {
    "openstudio": {
      "type": "local",
      "command": "C:\\OpenStudio\\scripts\\OpenStudio.bat",
      "args": []
    }
  }
}
```

The launcher checks for Node.js, OpenCode, Roblox Studio, and port availability.

For development, bypass checks:

```powershell
$env:OPENSTUDIO_SKIP_CHECKS = "1"
npm start
```

## Studio plugin

1. Open Roblox Studio.
2. Create a plugin script from `studio/OpenStudioPlugin.luau`.
3. Enable it.
4. Run `openstudio_connect` from OpenCode.

The plugin long-polls the bridge and executes commands in Studio.

## Permission levels

- `read-only`: inspection only
- `scripts-only`: scripts and read tools
- `full-edit`: instances, UI, models, execution, and destructive ops

Default is controlled by `OPENSTUDIO_PERMISSIONS` (default `scripts-only`). Change at runtime:

```text
openstudio_set_permission_level(level: "read-only" | "scripts-only" | "full-edit")
```

## Scripts

- `openstudio_status`
- `openstudio_connect`
- `openstudio_list_scripts(root?)`
- `openstudio_read_script(path)`
- `openstudio_write_script(path, source)`
- `openstudio_create_script(parentPath, name, scriptType, source)`
- `openstudio_delete_script(path, confirm)`

## Instances

- `openstudio_get_selection`
- `openstudio_get_instance_tree(root?, depth?, maxNodes?)`
- `openstudio_create_instance(parentPath, className, name, properties?)`
- `openstudio_set_property(path, propertyName, valueType, value)`
- `openstudio_rename_instance(path, newName)`
- `openstudio_search_instances(root?, name?, className?, maxResults?, maxNodes?)`
- `openstudio_inspect_instance(path)`
- `openstudio_delete_instance(path, confirm)`

## UI generation (StudioUI)

### Declarative node shape

```json
{
  "name": "MyUI",
  "className": "ScreenGui",
  "properties": [
    { "name": "ResetOnSpawn", "type": "boolean", "value": "false" }
  ],
  "children": [
    {
      "name": "Panel",
      "className": "Frame",
      "properties": [
        { "name": "Size", "type": "UDim2", "value": "0,400,0,300" },
        { "name": "Position", "type": "UDim2", "value": "0.5,0,0.5,0" }
      ]
    }
  ]
}
```

Tools:
- `openstudio_create_ui` (aliases: `openstudio_studio_ui`, `openstudio_import_ui`, `openstudio_build_ui`)
- `openstudio_ui_panel`
- `openstudio_ui_button`
- `openstudio_ui_button_animated`
- `openstudio_ui_toggle`
- `openstudio_ui_tabbar`
- `openstudio_ui_toast`
- `openstudio_ui_card`

## Model generation

`openstudio_model` accepts structured part descriptions or a Blender scene file/objects array.

Primitive example:

```json
{
  "parentPath": "game.Workspace",
  "modelName": "Blockout",
  "objects": [
    { "name": "Base", "shape": "block", "size": { "x": 20, "y": 1, "z": 20 }, "color": "0.3,0.3,0.3", "material": "Concrete" },
    { "name": "Ball", "shape": "ball", "size": { "x": 2, "y": 2, "z": 2 }, "position": { "x": 0, "y": 4, "z": 0 }, "color": "0.9,0.3,0.3", "material": "Neon" }
  ]
}
```

Blender example:

```json
{
  "parentPath": "game.Workspace",
  "modelName": "BlenderImport",
  "filePath": "C:\\path\\to\\scene.json"
}
```

## Testing and validation

- `openstudio_test` / `openstudio_test_game`: compiles scripts and reports UI/structural issues.
- `openstudio_runtime_status`: whether Studio is in run/play mode plus recent logs.
- `openstudio_runtime_assert(code, confirm)`: run Luau checks in the plugin context.
- `openstudio_get_output`: drain buffered Studio output logs.

## Screen capture

- `openstudio_capture_screen(outputPath?, windowTitle?, wholeScreen?)`
- Captures the Roblox Studio window to PNG on Windows and returns the image inline.

## Logs and safety

- `openstudio_get_output`
- `openstudio_cleanup_backups(path, keep?)`
- Destructive operations require `confirm: true`.

## Launcher

`scripts/OpenStudio.bat` validates:
- Node.js available
- Port availability
- Optionally OpenCode and Roblox Studio processes

Development bypass:
```powershell
$env:OPENSTUDIO_SKIP_CHECKS = "1"
```

## Environment variables

- `OPENSTUDIO_PORT`
- `OPENSTUDIO_HOST`
- `OPENSTUDIO_TOKEN`
- `OPENSTUDIO_PERMISSIONS`
- `OPENSTUDIO_STUDIO_TIMEOUT_MS`
- `OPENSTUDIO_HEARTBEAT_STALE_MS`
- `OPENSTUDIO_UPDATE_MANIFEST_URL`

## Development

```powershell
npm run build
npm run lint
npm run test
npm run dev
```

## Notes

- Standard build target is `dist/index.js`.
- Bridge listens on `127.0.0.1:3777` by default.
- Studio plugin networking requires HttpService access to localhost.
PY
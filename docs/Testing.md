# Testing and Validation

## Structural tests

- `openstudio_test`
- `openstudio_test_game`

These compile scripts with `loadstring`, walk the instance tree, and report UI/storage problems.

## Diagnostics

- `openstudio_game_checkup` combines structural tests with runtime mode and recent logs.
- `openstudio_collect_diagnostics` returns bridge, Studio, queue, permission, and log state.

## Runtime checks

- `openstudio_runtime_status`
- `openstudio_runtime_assert`

## Steam/Roblox notes

Play-mode control is still limited by Roblox plugin APIs. Use the official `roblox-studio` MCP or manual Studio controls for start/stop play.
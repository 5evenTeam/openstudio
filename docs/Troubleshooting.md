# Troubleshooting

## MCP server does not connect

- Run the launcher directly and read the error.
- Check that port 3777 is free.
- Check that the configured command points to `scripts/OpenStudio.bat`.
- Confirm Roblox Studio and the plugin are running.

## Port already in use

- Find the Node process and close it.
- Restart OpenCode.
- Avoid multiple bridge instances.

## Plugin cannot reach bridge

- Confirm HttpService can access localhost.
- Confirm the plugin token matches `OPENSTUDIO_TOKEN`.
- Check that `BRIDGE_HOST` and `BRIDGE_PORT` match the plugin constants.

## Capture issues

- Windows only.
- Roblox Studio window must be visible, not minimized.
- Whole-screen capture works if the Studio window cannot be found.

## Validation errors

- UI payloads require `className`.
- Model objects require at least one object entry.
- Malformed JSON is rejected before reaching Studio.
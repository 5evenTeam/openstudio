# Installation

## Prerequisites

- Node.js 20+
- OpenCode or another MCP client
- Roblox Studio
- The OpenStudio Roblox Studio plugin

## Build

```powershell
git clone https://github.com/5evenTeam/openstudio.git
cd openstudio
npm install
npm run build
```

## OpenCode

Use the Windows launcher so checks run:

```json
{
  "mcp": {
    "openstudio": {
      "type": "local",
      "command": "C:\\\\OpenStudio\\\\scripts\\\\OpenStudio.bat",
      "args": []
    }
  }
}
```

## Studio plugin

1. Open `studio/OpenStudioPlugin.luau`.
2. Install it in Roblox Studio.
3. Enable the plugin and click Connect.
4. Call `openstudio_connect` from OpenCode.
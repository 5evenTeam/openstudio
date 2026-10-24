# OpenStudio Examples

This directory provides copy/paste examples for OpenStudio's declarative tools.

## UI (`examples/ui/screen.json`)

Pass the JSON to `openstudio_create_ui` as the `node` parameter. The UI builder recursively creates frames, labels, and buttons with the supplied UDim2 sizes and colors.

## Model (`examples/model/primitive.json`)

Pass to `openstudio_model` as `objects`, or include other fields shown in the file. Each object supports:
- `shape`: block, ball, cylinder, wedge
- `size.x/y/z`
- `position.x/y/z`
- `rotation: [rx, ry, rz]` in degrees
- `color: "r,g,b"` or `[r,g,b]`
- `material`: a Roblox Material enum name such as `Neon`
- `transparency`, `anchored`, `parent`

## Invalid payload (`examples/invalid/bad-ui.json`)

This payload is intentionally invalid for the Zod schema because `className` is missing. It demonstrates how schema validation rejects malformed AI output before reaching Roblox Studio.

## Blender

Blender exports can be imported using `openstudio_model` with `filePath` or `scene`, or the existing `openstudio_import_blender` tool.

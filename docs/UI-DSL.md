# UI DSL

OpenStudio creates Roblox UI through `import_ui` using a node tree. Each node uses:

- `name` (optional)
- `className` (required)
- `properties` (optional array of `{ name, type, value }`)
- `props` (optional simple object)
- `children` (optional array of nodes)

## Value types

- `string`
- `number`
- `boolean`
- `Vector2`
- `Color3`
- `UDim`
- `UDim2`
- `EnumItem`
- `Instance`

## Example

Use the JSON in `examples/ui/screen.json`. Pass it as the `node` argument to `openstudio_create_ui`.

## Common UI types

- `ScreenGui`
- `Frame`
- `ScrollingFrame`
- `TextLabel`
- `TextButton`
- `TextBox`
- `ImageLabel`
- `ImageButton`
- `UICorner`
- `UIStroke`
- `UIListLayout`
- `UIPadding`
- `UIScale`

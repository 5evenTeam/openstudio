# Model Generation

OpenStudio builds 3D assemblies through `openstudio_model`.

## Primitive object shape

```json
{
  "name": "Base",
  "shape": "block",
  "size": { "x": 20, "y": 1, "z": 20 },
  "position": { "x": 0, "y": 0, "z": 0 },
  "rotation": [0, 45, 0],
  "color": "0.35,0.35,0.38",
  "material": "Concrete",
  "transparency": 0,
  "anchored": true,
  "parent": "ModelGroup"
}
```

## Supported shapes

- `block`
- `ball`
- `sphere`
- `cylinder`
- `wedge`
- `cornerwedge`

## Size and rotation

Sizes use `{ x, y, z }`. Positions are scaled by `scale`. Rotations use degrees.

## Blender

Blender exports may be passed as `objects`, `scene`, or `filePath`. The bridge and plugin normalize the object list into Roblox parts.

See `examples/model/primitive.json`.
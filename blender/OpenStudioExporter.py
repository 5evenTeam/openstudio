# OpenStudio Blender exporter
#
# Run this from Blender's Scripting workspace:
#   1. Select the objects you want to export (or leave selection empty for all mesh objects).
#   2. Run: bpy.ops.script.python_file_run(filepath=".../OpenStudioExporter.py")
#      or paste this file into a text block and click Run Script.
#
# By default it writes OpenStudioExport.json beside the current .blend file.
# You can change the output path by editing OUTPUT_PATH below.

import bpy
import json
import os

OUTPUT_PATH = None  # Set to an absolute path if you do not want the default beside the .blend file.

T_MATRIX = (
    (1, 0, 0),
    (0, 0, 1),
    (0, -1, 0),
)


def convert_vector(vector):
    return (vector.x, vector.z, -vector.y)


def convert_matrix(matrix):
    converted = []
    for row in range(3):
        for col in range(3):
            value = 0.0
            for k in range(3):
                value += T_MATRIX[row][k] * matrix[k][col]
            converted.append(value)
    # Apply T to both sides so the result is T * M * T^-1.
    result = []
    for row in range(3):
        for col in range(3):
            value = 0.0
            for k in range(3):
                value += converted[row * 3 + k] * T_MATRIX[col][k]
            result.append(value)
    return result


def material_info(material):
    if material is None:
        return {"material": "Plastic", "color": [1.0, 1.0, 1.0], "transparency": 0.0}

    base_color = [1.0, 1.0, 1.0]
    alpha = 1.0
    transparency = 0.0

    if material.use_nodes:
        principled = material.node_tree.nodes.get("Principled BSDF")
        if principled is not None:
            socket = principled.inputs.get("Base Color")
            if socket is not None:
                base_color = [socket.default_value[0], socket.default_value[1], socket.default_value[2]]
            alpha_socket = principled.inputs.get("Alpha")
            if alpha_socket is not None:
                alpha = alpha_socket.default_value
                transparency = max(0.0, min(1.0, 1.0 - alpha))

    # Blender alpha is 0..1; Roblox transparency is 0..1.
    return {
        "material": "Plastic",
        "color": base_color,
        "transparency": transparency,
    }


def object_to_record(obj):
    world_matrix = obj.matrix_world

    # Use object dimensions. Blender dimensions are local-space and already include scale.
    dimensions = obj.dimensions
    size = (
        float(dimensions.x),
        float(dimensions.z),
        float(dimensions.y),
    )

    position = convert_vector(world_matrix.translation)
    rotation_matrix = convert_matrix(world_matrix.to_3x3())

    info = material_info(obj.active_material)

    return {
        "name": obj.name,
        "parent": obj.parent.name if obj.parent else None,
        "partType": "Block",
        "size": {"x": size[0], "y": size[1], "z": size[2]},
        "position": {"x": position[0], "y": position[1], "z": position[2]},
        "rotationMatrix": rotation_matrix,
        "color": info["color"],
        "material": info["material"],
        "transparency": info["transparency"],
    }


def export_scene():
    if bpy.context.selected_objects:
        objects = [obj for obj in bpy.context.selected_objects if obj.type in {"MESH", "EMPTY"}]
    else:
        objects = [obj for obj in bpy.context.scene.objects if obj.type in {"MESH", "EMPTY"} and not obj.hide_get()]

    records = []
    for obj in objects:
        try:
            records.append(object_to_record(obj))
        except Exception as exc:
            print(f"[OpenStudio] Skipped {obj.name}: {exc}")

    data = {
        "version": 1,
        "scale": 1,
        "objects": records,
    }

    output_path = OUTPUT_PATH
    if not output_path:
        blend_path = bpy.data.filepath
        if blend_path:
            output_path = os.path.join(os.path.dirname(blend_path), "OpenStudioExport.json")
        else:
            output_path = os.path.join(bpy.path.abspath("//"), "OpenStudioExport.json")

    output_path = bpy.path.abspath(output_path)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)

    print(f"[OpenStudio] Exported {len(records)} objects to {output_path}")


export_scene()

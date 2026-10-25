"""Create two rigged first-person arm variants from the CC0 WRAD ARMS GLB.

Usage: blender --background --factory-startup --disable-autoexec \
  --python scripts/convert-pov-arms.py -- <path-to-wrad-arms/arms.glb>

Source: https://github.com/wwwriks/wrad-arms (WRiKS, CC0 1.0).
The game assigns glove and sleeve materials by bone influence while preserving
the original mesh, weights and complete finger skeleton.
"""
import sys
from pathlib import Path
import bpy
from mathutils import Vector

SOURCE = Path(sys.argv[-1]).resolve()
DEST = Path(__file__).resolve().parents[1] / 'assets' / 'weapons'
TEAMS = {
    'sas': {
        'glove': (0.014, 0.019, 0.023, 1),
        'sleeve': (0.014, 0.022, 0.035, 1),
        'cuff': (0.01, 0.013, 0.016, 1),
    },
    'leet': {
        'glove': (0.025, 0.020, 0.015, 1),
        'sleeve': (0.075, 0.055, 0.027, 1),
        'cuff': (0.022, 0.012, 0.006, 1),
    },
}

if not SOURCE.is_file():
    raise SystemExit(f'Missing source: {SOURCE}')

for team, colors in TEAMS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH' and o.vertex_groups)
    bpy.context.view_layer.objects.active = mesh
    bevel = mesh.modifiers.new('POV silhouette smoothing', 'SUBSURF')
    bevel.levels = 1
    while mesh.modifiers.find(bevel.name) > 0:
        bpy.ops.object.modifier_move_up(modifier=bevel.name)
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    for poly in mesh.data.polygons:
        poly.use_smooth = True
    mesh.data.materials.clear()
    for name, color in colors.items():
        mat = bpy.data.materials.new(f'{team}-{name}')
        mat.diffuse_color = color
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = color
        bsdf.inputs['Roughness'].default_value = 0.82 if name == 'glove' else 0.92
        mesh.data.materials.append(mat)

    armature = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    mesh_from_rig = mesh.matrix_world.inverted() @ armature.matrix_world
    wrists = {}
    for side in ('r', 'l'):
        wrist = mesh_from_rig @ armature.data.bones[f'wrist.{side}'].head_local
        elbow = mesh_from_rig @ armature.data.bones[f'forearm.{side}'].head_local
        wrists[side] = (wrist, (wrist - elbow).normalized())

    # A clean ring in bind space avoids a jagged glove/sleeve boundary caused
    # by assigning every triangle from interpolated skin-weight thresholds.
    for poly in mesh.data.polygons:
        center = sum((mesh.data.vertices[vi].co for vi in poly.vertices), Vector()) / len(poly.vertices)
        wrist, axis = min(wrists.values(), key=lambda pair: (center - pair[0]).length_squared)
        distance = (center - wrist).dot(axis)
        material = 'glove' if distance > -.04 else 'cuff' if distance > -.18 else 'sleeve'
        poly.material_index = list(colors).index(material)

    # The input includes an unskinned IK helper sphere. It is not game art.
    for obj in tuple(bpy.context.scene.objects):
        if obj.type == 'MESH' and obj is not mesh:
            bpy.data.objects.remove(obj, do_unlink=True)
    DEST.mkdir(parents=True, exist_ok=True)
    out = DEST / f'arms-{team}.glb'
    bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB',
                              export_yup=True, export_image_format='AUTO')
    print(f'OUTPUT {team} {out.stat().st_size} {out}')

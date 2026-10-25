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

SOURCE = Path(sys.argv[-1]).resolve()
DEST = Path(__file__).resolve().parents[1] / 'assets' / 'weapons'
TEAMS = {
    'sas': {
        'glove': (0.014, 0.019, 0.023, 1),
        'sleeve': (0.035, 0.055, 0.075, 1),
        'cuff': (0.01, 0.013, 0.016, 1),
    },
    'leet': {
        'glove': (0.055, 0.029, 0.012, 1),
        'sleeve': (0.18, 0.10, 0.045, 1),
        'cuff': (0.022, 0.012, 0.006, 1),
    },
}

if not SOURCE.is_file():
    raise SystemExit(f'Missing source: {SOURCE}')

for team, colors in TEAMS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH' and o.vertex_groups)
    mesh.data.materials.clear()
    for name, color in colors.items():
        mat = bpy.data.materials.new(f'{team}-{name}')
        mat.diffuse_color = color
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = color
        bsdf.inputs['Roughness'].default_value = 0.82 if name == 'glove' else 0.92
        mesh.data.materials.append(mat)

    # Face material follows the dominant part of the source's skinning, so
    # glove fingers and sleeves deform together with their authored bones.
    for poly in mesh.data.polygons:
        scores = {'glove': 0.0, 'sleeve': 0.0, 'cuff': 0.0}
        for vi in poly.vertices:
            for weight in mesh.data.vertices[vi].groups:
                bone = mesh.vertex_groups[weight.group].name.lower()
                if bone.startswith('finger') or bone.startswith('wrist'):
                    scores['glove'] += weight.weight
                elif bone.startswith('forearm'):
                    scores['cuff'] += weight.weight
                else:
                    scores['sleeve'] += weight.weight
        poly.material_index = list(colors).index(max(scores, key=scores.get))

    # The input includes an unskinned IK helper sphere. It is not game art.
    for obj in tuple(bpy.context.scene.objects):
        if obj.type == 'MESH' and obj is not mesh:
            bpy.data.objects.remove(obj, do_unlink=True)
    DEST.mkdir(parents=True, exist_ok=True)
    out = DEST / f'arms-{team}.glb'
    bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB',
                              export_yup=True, export_image_format='AUTO')
    print(f'OUTPUT {team} {out.stat().st_size} {out}')

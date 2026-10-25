"""Convert three OpenGameArt CC0 models to locally hosted weapon GLBs.

Usage: blender --background --disable-autoexec --python scripts/convert-oga-assets.py -- .tmp
See weapon-asset-manifest.json for source URLs and archive hashes.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[-1]).resolve()
DEST = ROOT / 'assets' / 'weapons'


def image(path, max_size, color=True):
    loaded = bpy.data.images.load(str(path), check_existing=False)
    loaded.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    if max(loaded.size) > max_size:
        factor = max_size / max(loaded.size)
        loaded.scale(max(1, round(loaded.size[0] * factor)), max(1, round(loaded.size[1] * factor)))
    return loaded


def material(name, color_path=None, metal_path=None, rough_path=None, normal_path=None,
             max_size=1024, base_color=(0.24, 0.25, 0.27, 1), metallic=0.35, roughness=0.55):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    links = mat.node_tree.links
    output = nodes.new('ShaderNodeOutputMaterial')
    pbr = nodes.new('ShaderNodeBsdfPrincipled')
    pbr.inputs['Base Color'].default_value = base_color
    pbr.inputs['Metallic'].default_value = metallic
    pbr.inputs['Roughness'].default_value = roughness
    links.new(pbr.outputs['BSDF'], output.inputs['Surface'])
    for path, input_name, is_color in [(color_path, 'Base Color', True), (metal_path, 'Metallic', False),
                                       (rough_path, 'Roughness', False)]:
        if path and path.is_file():
            node = nodes.new('ShaderNodeTexImage')
            node.image = image(path, max_size, is_color)
            links.new(node.outputs['Color'], pbr.inputs[input_name])
    if normal_path and normal_path.is_file():
        node = nodes.new('ShaderNodeTexImage')
        node.image = image(normal_path, max_size, False)
        normal = nodes.new('ShaderNodeNormalMap')
        links.new(node.outputs['Color'], normal.inputs['Color'])
        links.new(normal.outputs['Normal'], pbr.inputs['Normal'])
    return mat


def export(id, meshes, transform, length, role):
    bpy.context.view_layer.update()
    vertices = [obj.matrix_world @ Vector(c) for obj in meshes for c in obj.bound_box]
    transformed = [transform @ p for p in vertices]
    span = max(max(p[i] for p in transformed) - min(p[i] for p in transformed) for i in range(3))
    root = bpy.data.objects.new(id, None)
    bpy.context.collection.objects.link(root)
    root.scale = (length / span,) * 3
    bpy.context.view_layer.update()
    for obj in meshes:
        world = root.matrix_world @ transform @ obj.matrix_world.copy()
        for mod in list(obj.modifiers):
            if mod.type == 'ARMATURE':
                obj.modifiers.remove(mod)
        obj.parent = root
        obj.matrix_world = world
        obj.name = {'Magazine': 'magazine', 'Slide': 'slide'}.get(obj.name, obj.name)
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    DEST.mkdir(parents=True, exist_ok=True)
    out = DEST / f'{id}-{role}.glb'
    bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True,
                              export_yup=True, export_image_format='AUTO')
    print('OUTPUT', id, role, out.stat().st_size, out)


def convert_deagle(role):
    blend = SOURCE / 'deagle' / 'Export' / 'Desert Eagle Export.blend'
    bpy.ops.wm.open_mainfile(filepath=str(blend), load_ui=False)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and not o.name.startswith('Cube.')
              and o.name != 'Bullets']
    texture_dir = blend.parent / 'Textures'
    size = 1024 if role == 'view' else 512
    pbr_by_name = {}
    for obj in meshes:
        for slot in obj.material_slots:
            original = slot.material
            if not original:
                continue
            key = original.name
            if key not in pbr_by_name:
                stem = f'Desert Eagle 6_{key}_'
                pbr_by_name[key] = material(f'deagle-{key}-{role}',
                    texture_dir / f'{stem}BaseColor.png',
                    texture_dir / f'{stem}Metallic.png',
                    texture_dir / f'{stem}Roughness.png', max_size=size)
            slot.material = pbr_by_name[key]
    # Source barrel points toward -Y. Face the shared game -Z axis after glTF export.
    transform = Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Translation(Vector((0, -0.7, 0.8)))
    export('deagle', meshes, transform, 0.32, role)


def convert_glock(role):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=str(SOURCE / 'Glock_HighPoly.obj'))
    obj = next(o for o in bpy.data.objects if o.type == 'MESH')
    palette = [(0.10, 0.11, 0.12, 1), (0.17, 0.18, 0.19, 1), (0.08, 0.09, 0.10, 1),
               (0.22, 0.23, 0.24, 1), (0.13, 0.14, 0.15, 1), (0.30, 0.31, 0.32, 1)]
    for index, slot in enumerate(obj.material_slots):
        slot.material = material(f'glock-finish-{index}-{role}', base_color=palette[index % len(palette)],
                                 metallic=0.1 if index in (0, 2) else 0.6,
                                 roughness=0.76 if index in (0, 2) else 0.45)
        pbr = next(n for n in slot.material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        finish = bpy.data.images.new(f'glock-finish-{index}-{role}', width=32, height=32, alpha=True)
        base = palette[index % len(palette)]
        pixels = []
        for y in range(32):
            for x in range(32):
                grain = (((x * 19 + y * 37 + index * 11) % 13) - 6) * 0.0014
                pixels.extend((base[0] + grain, base[1] + grain, base[2] + grain, 1))
        finish.pixels[:] = pixels
        finish.pack()
        tex = slot.material.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = finish
        slot.material.node_tree.links.new(tex.outputs['Color'], pbr.inputs['Base Color'])
    # The OBJ lies flat: its long X axis becomes the barrel and Y becomes up.
    rotation = Matrix(((0, 0, -1, 0), (-1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    transform = rotation @ Matrix.Translation(Vector((-2, 0, 0)))
    export('glock', [obj], transform, 0.29, role)


def convert_knife(role):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=str(SOURCE / 'knife' / 'Knife.obj'))
    obj = next(o for o in bpy.data.objects if o.type == 'MESH')
    size = 1024 if role == 'view' else 512
    mat = material(f'knife-pbr-{role}', SOURCE / 'knife' / 'Knife_Diffuse.png',
                   normal_path=SOURCE / 'knife' / 'Knife_Normal.png', max_size=size,
                   metallic=0.55, roughness=0.38)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    if role == 'world':
        modifier = obj.modifiers.new('world-geometry', 'DECIMATE')
        modifier.ratio = 0.44
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    transform = Matrix.Rotation(-math.pi / 2, 4, 'Z') @ Matrix.Translation(Vector((-250, 0, 0)))
    export('knife', [obj], transform, 0.35, role)


for model in (convert_deagle, convert_glock, convert_knife):
    for variant in ('view', 'world'):
        model(variant)

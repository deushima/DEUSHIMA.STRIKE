"""Convert selected, verified 3dmodelscc0 FBX assets to self-contained game GLBs.

Usage: blender --background --factory-startup --disable-autoexec \
  --python scripts/convert-weapon-assets.py -- <extracted Guns&Explosives folder>

The source archive is available from the author at
https://3dmodelscc0.itch.io/free-cc0-guns-explosives-pack (CC0).
Do not commit the source archive. This script emits only runtime GLBs.
"""
import os
import sys
from pathlib import Path

import bpy
import numpy as np


SOURCE = Path(sys.argv[-1]).resolve()
ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'assets' / 'weapons'
MODELS = {
    'ak47': ('AK-47', 'AK47.fbx', 'AK47', .88),
    'm4a1': ('M4A1', 'M4A1.fbx', 'M4A1', .86),
    'he': ('FragGrenade', 'FragGrenadeModel.fbx', 'FragGrenade', .12),
    'flash': ('Flashbang', 'Flashbang.fbx', 'Flashbang', .12),
    'smoke': ('Smoke_Grenade', 'Smoke_Grenade.fbx', 'Smoke_Grenade', .12),
    'c4': ('C4', 'C4.fbx', 'C4', .22),
}


def texture(folder, stem, suffix, max_size, directx=False):
    candidates = sorted(folder.glob(f'{stem}_{suffix}*.png'))
    if not candidates:
        return None
    image = bpy.data.images.load(str(candidates[0]), check_existing=False)
    image.colorspace_settings.name = 'sRGB' if suffix in ('Base_Color', 'Emissive') else 'Non-Color'
    if directx:
        pixels = np.empty(len(image.pixels), dtype=np.float32)
        image.pixels.foreach_get(pixels)
        pixels[1::4] = 1 - pixels[1::4]
        image.pixels.foreach_set(pixels)
        image.update()
    if max(image.size) > max_size:
        factor = max_size / max(image.size)
        image.scale(max(1, round(image.size[0] * factor)), max(1, round(image.size[1] * factor)))
    return image


def connect_image(nodes, links, image, target, input_name):
    if image is None:
        return None
    node = nodes.new('ShaderNodeTexImage')
    node.image = image
    links.new(node.outputs['Color'], target.inputs[input_name])
    return node


def convert(model_id, entry, variant):
    folder_name, fbx_name, stem, desired_length = entry
    folder = SOURCE / folder_name
    fbx = folder / fbx_name
    if not fbx.is_file():
        raise FileNotFoundError(fbx)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(fbx))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    if not meshes:
        raise RuntimeError(f'No geometry: {fbx}')
    quality = variant == 'view'
    max_size = 1024 if quality else 512

    mat = bpy.data.materials.new(f'{model_id}-pbr')
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    links = mat.node_tree.links
    output = nodes.new('ShaderNodeOutputMaterial')
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    links.new(shader.outputs['BSDF'], output.inputs['Surface'])
    connect_image(nodes, links, texture(folder, stem, 'Base_Color', max_size), shader, 'Base Color')
    connect_image(nodes, links, texture(folder, stem, 'Metallic', max_size), shader, 'Metallic')
    connect_image(nodes, links, texture(folder, stem, 'Roughness', max_size), shader, 'Roughness')
    if quality:
        normal_image = texture(folder, stem, 'Normal', max_size,
                               directx=not (folder / f'{stem}_Normal.png').is_file())
        if normal_image:
            image_node = nodes.new('ShaderNodeTexImage')
            image_node.image = normal_image
            normal_node = nodes.new('ShaderNodeNormalMap')
            links.new(image_node.outputs['Color'], normal_node.inputs['Color'])
            links.new(normal_node.outputs['Normal'], shader.inputs['Normal'])
    emissive = texture(folder, stem, 'Emissive', max_size)
    if emissive:
        connect_image(nodes, links, emissive, shader, 'Emission Color')
        shader.inputs['Emission Strength'].default_value = 1
    for obj in meshes:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        if obj.name.lower() == 'magazine':
            obj.name = 'magazine'
        # Meshes are already game-scale. Preserve topology: Blender's decimator
        # can invalidate the source's split UV seams on the receiver.

    # Source pack models point along Blender +Y, which glTF exports as -Z.
    # Preserve separate components and pivots; scale to real-world metres.
    from mathutils import Vector
    bpy.context.view_layer.update()
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    longest = max(max(p[i] for p in points) - min(p[i] for p in points) for i in range(3))
    if longest <= 0:
        raise RuntimeError(f'Invalid bounds: {fbx}')
    root = bpy.data.objects.new(model_id, None)
    bpy.context.collection.objects.link(root)
    for obj in meshes:
        world_matrix = obj.matrix_world.copy()
        obj.parent = root
        obj.matrix_world = world_matrix
    root.scale = (desired_length / longest,) * 3
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    DEST.mkdir(parents=True, exist_ok=True)
    out = DEST / f'{model_id}-{variant}.glb'
    bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True,
                              export_yup=True, export_image_format='AUTO',
                              export_apply=False, export_extras=True)
    print(f'OUTPUT {model_id} {variant} {out.stat().st_size} {out}')


if not SOURCE.is_dir():
    raise SystemExit(f'Extracted source folder missing: {SOURCE}')
for model, spec in MODELS.items():
    for role in ('view', 'world'):
        convert(model, spec, role)

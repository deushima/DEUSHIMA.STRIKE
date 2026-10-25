"""Export Maia Studios' Firearms Kit Free Blender models as game-ready GLBs.

Usage: blender --background --disable-autoexec --python scripts/convert-maia-assets.py -- .tmp/maia

Source and commercial-use grant: https://maiastudios.itch.io/firearms-kit-free
The source ZIP archives and Blender files are intentionally kept out of Git.
"""
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[-1]).resolve()
DEST = ROOT / 'assets' / 'weapons'

# (source folder, source filename, overall metres, grip position in Blender XY/Z)
MODELS = {
    'awp': ('AWP', 'AWP.blend', 0.94, (0, -4.6, 4.6)),
    'mp5': ('MP5', 'MP5.blend', 0.64, (0, -3.0, 1.5)),
    'usp': ('USP', 'USP.blend', 0.29, (0, -1.4, 2.5)),
    'xm1014': ('Auto Shotgun', 'Auto Shotgun.blend', 0.96, (0, -1.4, 1.3)),
    'm3': ('Pump Shotgun', 'Pump Shotgun.blend', 0.95, (0, -3.5, 1.1)),
    'scout': ('Hunting Rifle', 'Hunting Rifle.blend', 0.92, (0, -1.1, 0.5)),
}

PARTS = {
    'awp': {'Pente': 'magazine', 'Camara': 'bolt'},
    'mp5': {'Pente': 'magazine'},
    'usp': {'Pente': 'magazine', 'Inside': 'slide'},
    'm3': {'Punheteira': 'pump'},
    'scout': {'Carregador': 'magazine', 'Camara': 'bolt'},
}

MP5_TEXTURES = {
    'Cano': 'CanoTextura.png',
    'Pente': 'PenteTextura.png',
    'CamaraDeSaida': 'CamaraDeSaidaTextura.png',
    'TravaPente': 'TravaPenteTextura.png',
}


def find_texture(source_dir, obj, material):
    texture_dir = source_dir / 'BLEND' / 'Textura' / source_dir.name
    if source_dir.name == 'MP5':
        candidate = texture_dir / MP5_TEXTURES.get(obj.name, 'TexturesCom_0048Reference_S.png')
        return candidate if candidate.is_file() else None
    if material and material.use_nodes:
        for node in material.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image and node.image.filepath:
                candidate = texture_dir / Path(node.image.filepath.replace('\\', '/')).name
                if candidate.is_file():
                    return candidate
    return None


def export(model_id, spec, role):
    folder, filename, length, center = spec
    source_dir = SOURCE / folder
    blend = source_dir / 'BLEND' / filename
    if not blend.is_file():
        raise FileNotFoundError(blend)
    bpy.ops.wm.open_mainfile(filepath=str(blend), load_ui=False)
    meshes = [obj for obj in bpy.data.objects if obj.type == 'MESH' and obj.name != 'Plane'
              and not obj.name.startswith('Projetil')]
    if not meshes:
        raise RuntimeError(f'No weapon geometry in {blend}')

    bounds = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    span = max(max(p[i] for p in bounds) - min(p[i] for p in bounds) for i in range(3))
    if span <= 0:
        raise RuntimeError(f'Invalid weapon bounds: {blend}')
    scale = length / span
    root = bpy.data.objects.new(model_id, None)
    bpy.context.collection.objects.link(root)
    root.scale = (scale,) * 3
    bpy.context.view_layer.update()
    translation = Matrix.Translation(-Vector(center))
    max_texture_size = 1024 if role == 'view' else 512

    for obj in meshes:
        source_material = obj.data.materials[0] if obj.data.materials else None
        image_path = find_texture(source_dir, obj, source_material)
        mat = bpy.data.materials.new(f'{model_id}-{obj.name}-{role}')
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        nodes.clear()
        output = nodes.new('ShaderNodeOutputMaterial')
        pbr = nodes.new('ShaderNodeBsdfPrincipled')
        pbr.inputs['Metallic'].default_value = 0.38 if obj.name not in ('Cabo', 'Pente', 'Punheteira') else 0.08
        pbr.inputs['Roughness'].default_value = 0.57
        mat.node_tree.links.new(pbr.outputs['BSDF'], output.inputs['Surface'])
        if image_path:
            image = bpy.data.images.load(str(image_path), check_existing=False)
            image.colorspace_settings.name = 'sRGB'
            if max(image.size) > max_texture_size:
                factor = max_texture_size / max(image.size)
                image.scale(max(1, round(image.size[0] * factor)), max(1, round(image.size[1] * factor)))
            texture = nodes.new('ShaderNodeTexImage')
            texture.image = image
            mat.node_tree.links.new(texture.outputs['Color'], pbr.inputs['Base Color'])
        elif source_material:
            mat.diffuse_color = source_material.diffuse_color
            pbr.inputs['Base Color'].default_value = source_material.diffuse_color
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        world = translation @ obj.matrix_world.copy()
        obj.parent = root
        obj.matrix_world = root.matrix_world @ world
        obj.name = PARTS.get(model_id, {}).get(obj.name, obj.name)

    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    DEST.mkdir(parents=True, exist_ok=True)
    destination = DEST / f'{model_id}-{role}.glb'
    bpy.ops.export_scene.gltf(filepath=str(destination), export_format='GLB', use_selection=True,
                              export_yup=True, export_image_format='AUTO', export_apply=False)
    print('OUTPUT', model_id, role, destination.stat().st_size, destination)


if not SOURCE.is_dir():
    raise SystemExit(f'Missing source directory: {SOURCE}')
for name, model in MODELS.items():
    for variant in ('view', 'world'):
        export(name, model, variant)

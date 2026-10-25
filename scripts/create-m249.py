"""Author DEUSHIMA STRIKE's original stylized M249 view and world meshes.

Usage: blender --background --disable-autoexec --python scripts/create-m249.py
The geometry and generated finish maps in this file are original project art.
"""
from pathlib import Path
import math
import bpy
from mathutils import Vector

DEST = Path(__file__).resolve().parents[1] / 'assets' / 'weapons'
DEST.mkdir(parents=True, exist_ok=True)


def finish(name, color, metallic, roughness, role):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    pbr = nodes.new('ShaderNodeBsdfPrincipled')
    pbr.inputs['Metallic'].default_value = metallic
    pbr.inputs['Roughness'].default_value = roughness
    mat.node_tree.links.new(pbr.outputs['BSDF'], out.inputs['Surface'])
    img = bpy.data.images.new(f'{name}-finish', width=64, height=64, alpha=True)
    pixels = []
    for y in range(64):
        for x in range(64):
            n = ((((x * 17) ^ (y * 31)) % 29) - 14) * 0.0009
            pixels.extend((max(0, color[0] + n), max(0, color[1] + n), max(0, color[2] + n), 1))
    img.pixels[:] = pixels
    img.pack()
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = img
    mat.node_tree.links.new(tex.outputs['Color'], pbr.inputs['Base Color'])
    return mat


def box(name, loc, size, mat, bevel=0.003):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new('machined-edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
        normal = obj.modifiers.new('weighted-normals', 'WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=normal.name)
    return obj


def tube(name, a, b, radius, mat, vertices=16):
    a, b = Vector(a), Vector(b)
    direction = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius,
                                        depth=direction.length, location=(a + b) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    obj.data.materials.append(mat)
    return obj


def build(role):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    olive = finish('painted-olive', (0.19, 0.24, 0.16), 0.35, 0.63, role)
    steel = finish('blued-steel', (0.09, 0.11, 0.12), 0.78, 0.39, role)
    dark = finish('black-polymer', (0.052, 0.059, 0.064), 0.06, 0.82, role)
    brass = finish('brass', (0.55, 0.35, 0.10), 0.84, 0.34, role)
    parts = []
    add = parts.append

    # Main receiver, hinged feed cover and ejection assembly.
    add(box('receiver', (0, 0.21, 0.035), (.094, .36, .115), olive, .01))
    add(box('upper-receiver', (0, .23, .092), (.100, .32, .038), steel, .007))
    add(box('feed_cover', (0, .215, .119), (.11, .31, .019), olive, .006))
    add(box('ejection-port', (.050, .27, .042), (.004, .11, .052), steel, .002))
    add(box('charging-handle', (.067, .09, .067), (.07, .013, .014), steel, .003))
    for y in (.12, .30):
        add(box('receiver-pin', (.052, y, -.012), (.007, .008, .008), brass, .002))

    # Long vented handguard, gas tube, barrel, flash hider and raised sights.
    add(box('handguard', (0, .49, .025), (.086, .28, .078), olive, .009))
    for i in range(7):
        y = .385 + i * .034
        for side in (-1, 1):
            add(box('vent', (side * .044, y, .034), (.003, .016, .026), steel, .001))
    add(tube('gas-tube', (0, .53, -.023), (0, .79, -.023), .011, steel))
    add(tube('barrel', (0, .62, .04), (0, .905, .04), .013, steel, 24))
    add(tube('barrel-collar', (0, .64, .04), (0, .69, .04), .024, steel, 24))
    add(tube('flash-hider', (0, .905, .04), (0, .947, .04), .019, steel, 24))
    add(box('front-sight-post', (0, .82, .083), (.008, .016, .057), steel, .002))
    add(box('rear-sight-base', (0, .08, .134), (.054, .036, .028), steel, .003))
    add(box('rear-aperture', (0, .08, .16), (.01, .009, .025), steel, .002))

    # Fixed stock, pistol grip, trigger guard and carry handle.
    add(box('stock', (0, -.085, .018), (.071, .24, .081), dark, .009))
    add(box('stock-pad', (0, -.215, .018), (.083, .024, .102), dark, .005))
    add(box('grip', (0, .027, -.089), (.047, .071, .126), dark, .006))
    add(tube('trigger-guard', (0, .065, -.055), (0, .10, -.07), .004, steel, 10))
    add(tube('carry-handle-left', (-.03, .345, .115), (-.03, .47, .175), .007, steel, 12))
    add(tube('carry-handle-top', (-.03, .47, .175), (.03, .47, .175), .007, dark, 12))
    add(tube('carry-handle-right', (.03, .47, .175), (.03, .35, .11), .007, steel, 12))

    # Distinctive side-fed 200-round ammunition box and visible belt links.
    mag = box('magazine', (-.112, .225, -.055), (.145, .15, .145), olive, .011)
    add(mag)
    add(box('mag-latch', (-.072, .165, .02), (.018, .025, .024), steel, .003))
    if role == 'view':
        for i in range(10):
            x = -.046 - i * .013
            z = .078 - math.sin(i / 9 * math.pi) * .013
            add(tube('belt-round', (x, .31, z), (x, .337, z), .0045, brass, 10))
            add(box('belt-link', (x, .323, z + .008), (.009, .025, .004), steel, .001))

    # Folded bipod and folding pivot.
    add(tube('bipod-hinge', (-.04, .69, -.035), (.04, .69, -.035), .009, steel, 12))
    for side in (-1, 1):
        add(tube('bipod-leg', (side * .031, .69, -.037), (side * .056, .51, -.174), .007, steel, 10))
        add(box('bipod-foot', (side * .056, .51, -.177), (.035, .029, .012), steel, .003))

    root = bpy.data.objects.new('m249', None)
    bpy.context.collection.objects.link(root)
    for obj in parts:
        world = obj.matrix_world.copy()
        obj.parent = root
        obj.matrix_world = world
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    out = DEST / f'm249-{role}.glb'
    bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True,
                              export_yup=True, export_image_format='AUTO')
    print('OUTPUT', role, out.stat().st_size, out)


for quality in ('view', 'world'):
    build(quality)

"""Author an original Scout-pattern bolt-action rifle for DEUSHIMA STRIKE.

Visual references: Steyr Arms' public Scout product specification. Geometry,
finish maps and moving pieces are authored here; no third-party model is used.
Usage: blender --background --disable-autoexec --python scripts/create-scout.py
"""
from pathlib import Path
import math
import bpy
from mathutils import Vector

DEST = Path(__file__).resolve().parents[1] / 'assets' / 'weapons'
DEST.mkdir(parents=True, exist_ok=True)


def finish(name, color, metallic, roughness):
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
            grain = ((((x * 19) ^ (y * 37)) % 31) - 15) * .0010
            pixels.extend((max(0, color[0] + grain), max(0, color[1] + grain),
                           max(0, color[2] + grain), 1))
    img.pixels[:] = pixels
    img.pack()
    image = nodes.new('ShaderNodeTexImage')
    image.image = img
    mat.node_tree.links.new(image.outputs['Color'], pbr.inputs['Base Color'])
    return mat


def box(name, location, size, material, bevel=.004):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    if bevel:
        mod = obj.modifiers.new('rounded-machined-edge', 'BEVEL')
        mod.width, mod.segments = bevel, 3
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = obj.modifiers.new('weighted-normals', 'WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def tube(name, a, b, radius, material, vertices=20):
    a, b = Vector(a), Vector(b)
    axis = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius,
                                        depth=axis.length, location=(a+b)/2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = axis.to_track_quat('Z', 'Y').to_euler()
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def profile(name, outline, width, material, bevel=.008):
    """Beveled polymer side profile; outline is (forward, vertical) points."""
    n = len(outline)
    vertices = [(x, y, z) for x in (-width/2, width/2) for y,z in outline]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
    for i in range(n):
        j = (i+1) % n
        faces.append((i, j, n+j, n+i))
    mesh = bpy.data.meshes.new(name + '-mesh')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(island_margin=.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    if bevel:
        mod = obj.modifiers.new('soft-molded-edge', 'BEVEL')
        mod.width, mod.segments = bevel, 3
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = obj.modifiers.new('weighted-normals', 'WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def build(role):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    polymer = finish('graphite-olive-polymer', (.17,.21,.18), .05, .72)
    rubber = finish('grip-rubber', (.055,.064,.059), .02, .94)
    steel = finish('blued-steel', (.075,.09,.10), .81, .38)
    alloy = finish('receiver-alloy', (.19,.22,.22), .68, .44)
    glass = finish('optical-glass', (.025,.10,.14), .32, .13)
    markings = finish('white-marking', (.62,.66,.60), .03, .65)
    pieces = []
    add = pieces.append

    # The original Scout's slim molded stock and open rear frame distinguish it
    # from a wood hunting rifle. The opening is real empty space between beams.
    add(profile('cheek-comb', [(-.46,.10),(-.42,.13),(-.19,.13),(-.07,.09),
                               (-.05,.04),(-.38,.04),(-.45,.055)], .068, polymer))
    add(profile('lower-stock-strut', [(-.45,-.12),(-.38,-.11),(-.13,-.13),
                                     (-.05,-.10),(-.04,-.065),(-.39,-.065)], .045, polymer))
    add(box('butt-frame', (0,-.45,-.002), (.070,.027,.236), polymer,.008))
    add(box('rubber-butt-pad', (0,-.478,-.003), (.078,.019,.241), rubber,.007))
    for z in (-.060,-.022,.019,.061):
        add(box('butt-spacer', (0,-.465,z), (.071,.005,.004), rubber,.001))
    add(profile('pistol-grip', [(-.095,-.03),(-.035,-.025),(.012,-.09),
                               (-.028,-.18),(-.081,-.168)], .060, rubber,.009))
    for i in range(8):
        z = -.065 - i*.012
        for side in (-1,1):
            add(box('grip-checkering', (side*.030,-.054,z), (.002,.036,.003),polymer,.0005))

    # Receiver, ejection window, recessed safety, detachable five-round magazine.
    add(profile('central-stock', [(-.08,.078),(.20,.085),(.31,.052),(.29,-.050),
                                  (.18,-.073),(-.055,-.056)], .083, polymer,.009))
    add(box('receiver', (0,.105,.074), (.073,.280,.062), alloy,.007))
    add(box('receiver-top-rail', (0,.105,.113), (.063,.24,.014), steel,.003))
    for y in [i*.018 for i in range(-5,12)]:
        if role=='view' or int(y*1000)%2==0:
            add(box('rail-tooth', (0,.10+y,.122),(.063,.009,.008),steel,.001))
    add(box('ejection-port', (-.039,.135,.077),(.003,.082,.027),steel,.001))
    add(box('safety', (-.047,-.015,.099),(.011,.025,.010),rubber,.002))
    magazine = box('magazine', (0,.075,-.097),(.068,.089,.077),rubber,.006)
    add(magazine)
    magazine_floor = box('magazine-floor-plate', (0,.075,-.139),(.073,.097,.009),polymer,.003)
    add(magazine_floor)
    add(box('magazine-release', (-.047,.023,-.048),(.008,.016,.016),steel,.002))
    add(tube('trigger-guard-front',(-.029,-.001,-.057),(-.029,.033,-.103),.004,steel,12))
    add(tube('trigger-guard-bottom',(-.029,-.001,-.103),(-.029,.052,-.103),.004,steel,12))
    add(box('trigger',(-.028,.002,-.067),(.004,.009,.035),steel,.001))

    # Single moving bolt assembly, with an exposed knob on the visible side.
    bolt = bpy.data.objects.new('bolt', None)
    bpy.context.collection.objects.link(bolt)
    bolt.location=(0,.105,.083)
    bolt_parts=[]
    bolt_parts.append(tube('bolt-body',(-.002,.04,.085),(-.002,.18,.085),.010,steel,16))
    bolt_parts.append(tube('bolt-handle',(-.006,.102,.082),(-.090,.095,.040),.006,alloy,12))
    bolt_parts.append(tube('bolt-knob',(-.093,.095,.043),(-.102,.095,.043),.013,rubber,16))
    for obj in bolt_parts:
        matrix=obj.matrix_world.copy();obj.parent=bolt;obj.matrix_world=matrix
    add(bolt)

    # Tapered forend with folded integrated bipod rails and vents.
    add(profile('forend', [(.245,.053),(.49,.054),(.685,.027),(.685,-.016),
                           (.60,-.046),(.30,-.050)], .075,polymer,.009))
    for side in (-1,1):
        add(profile('folded-bipod-leg',[(.38,-.031),(.61,-.026),(.67,-.039),
                                        (.66,-.051),(.43,-.054)],.009,steel,.003))
        pieces[-1].location.x=side*.048
        add(box('bipod-pivot',(side*.049,.39,-.033),(.022,.024,.022),alloy,.003))
        for i in range(4):
            y=.44+i*.044
            add(box('forend-slot',(side*.039,y,.022),(.003,.021,.007),rubber,.001))
    add(tube('free-floating-barrel',(0,.55,.033),(0,.947,.033),.012,steel,24))
    add(tube('barrel-collar',(0,.60,.033),(0,.645,.033),.018,alloy,24))
    add(tube('muzzle-crown',(0,.944,.033),(0,.960,.033),.016,steel,24))
    add(tube('muzzle-opening',(0,.959,.033),(0,.962,.033),.008,rubber,20))

    # Forward mounted, long-eye-relief optic on two rings.
    add(box('scope-rail',(0,.34,.111),(.052,.25,.017),steel,.002))
    for y in (.285,.42):
        add(box('scope-mount',(0,y,.145),(.047,.028,.055),alloy,.004))
        add(tube('scope-ring',(-.035,y,.174),(.035,y,.174),.030,steel,20))
    add(tube('scope-tube',(0,.22,.176),(0,.51,.176),.026,steel,24))
    add(tube('rear-ocular',(0,.17,.176),(0,.225,.176),.036,rubber,24))
    add(tube('front-objective',(0,.505,.176),(0,.555,.176),.041,steel,24))
    add(tube('front-lens',(0,.555,.176),(0,.558,.176),.035,glass,24))
    add(tube('rear-lens',(0,.164,.176),(0,.167,.176),.029,glass,24))
    add(tube('elevation-turret',(0,.37,.20),(0,.37,.245),.016,steel,16))
    add(tube('windage-turret',(-.03,.37,.176),(-.065,.37,.176),.014,steel,16))
    if role=='view':
        for y in (.184,.191,.198,.205,.515,.522,.529,.536):
            add(tube('scope-knurl',(0,y,.176),(0,y+.002,.176),.037,rubber,24))
        for y in (.31,.345,.38,.415):
            add(box('receiver-engraving',(-.040,y,.062),(.001,.017,.002),markings,.0004))

    root=bpy.data.objects.new('scout',None)
    bpy.context.collection.objects.link(root)
    for obj in pieces:
        matrix=obj.matrix_world.copy();obj.parent=root;obj.matrix_world=matrix
    matrix=magazine_floor.matrix_world.copy()
    magazine_floor.parent=magazine
    magazine_floor.matrix_world=matrix
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for obj in pieces:
        obj.select_set(True)
    for obj in bolt_parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active=root
    output=DEST/f'scout-{role}.glb'
    bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',use_selection=True,
                              export_yup=True,export_image_format='AUTO')
    print('SCOUT OUTPUT',role,output.stat().st_size,output)


for quality in ('view','world'):
    build(quality)

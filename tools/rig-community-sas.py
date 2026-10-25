import bpy, json, argparse, sys
from mathutils import Vector, Matrix
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--input',required=True)
parser.add_argument('--output',required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(Path(args.input).resolve()))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
coords=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box]
lo=Vector(tuple(min(c[i] for c in coords) for i in range(3)))
hi=Vector(tuple(max(c[i] for c in coords) for i in range(3)))
scale=1.8/(hi.z-lo.z)
normal=Matrix.Scale(scale,4)@Matrix.Translation(Vector((-(lo.x+hi.x)/2,-(lo.y+hi.y)/2,-lo.z)))
for obj in meshes:
    world=normal@obj.matrix_world
    obj.parent=None
    obj.matrix_world=world
    bpy.context.view_layer.objects.active=obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    obj.select_set(False)
arm=bpy.data.armatures.new('DEUSHIMA_Community_SAS_Rig')
rig=bpy.data.objects.new('DEUSHIMA_Community_SAS_Rig',arm)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
definitions=[]
def add(name,parent,head,tail):definitions.append((name,parent,head,tail))
add('pelvis',None,(0,.91,0),(0,1.1,0))
add('spine','pelvis',(0,1.1,0),(0,1.35,0))
add('chest','spine',(0,1.35,0),(0,1.51,0))
add('neck','chest',(0,1.51,0),(0,1.60,0))
add('head','neck',(0,1.60,0),(0,1.78,0))
for side,s in [('L',1),('R',-1)]:
    add('shoulder.'+side,'chest',(s*.12,1.43,0),(s*.23,1.4,0))
    add('upper_arm.'+side,'shoulder.'+side,(s*.23,1.4,0),(s*.45,1.18,0))
    add('forearm.'+side,'upper_arm.'+side,(s*.45,1.18,0),(s*.66,.96,0))
    add('hand.'+side,'forearm.'+side,(s*.66,.96,0),(s*.72,.90,0))
    add('thigh.'+side,'pelvis',(s*.12,.91,0),(s*.13,.48,0))
    add('shin.'+side,'thigh.'+side,(s*.13,.48,0),(s*.13,.105,.015))
    add('foot.'+side,'shin.'+side,(s*.13,.105,.015),(s*.13,.065,.15))
    add('toe.'+side,'foot.'+side,(s*.13,.065,.15),(s*.13,.055,.21))
for name,parent,head,tail in definitions:
    b=arm.edit_bones.new(name)
    b.head=Vector((head[0],-head[2],head[1]));b.tail=Vector((tail[0],-tail[2],tail[1]))
    if parent:b.parent=arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
# Weight a welded proxy to avoid UV seams breaking the heat solve. Copy only
# vertex weights back; the exported source topology and UV seams stay intact.
obj=meshes[0]
proxy=obj.copy();proxy.data=obj.data.copy();bpy.context.collection.objects.link(proxy)
bpy.ops.object.select_all(action='DESELECT');proxy.select_set(True)
bpy.context.view_layer.objects.active=proxy
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=.00001);bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')
rig.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
for group in proxy.vertex_groups:obj.vertex_groups.new(name=group.name)
for vertex in obj.data.vertices:
    nearest=min(proxy.data.vertices,key=lambda v:(v.co-vertex.co).length_squared)
    for g in nearest.groups:obj.vertex_groups[g.group].add([vertex.index],g.weight,'REPLACE')
obj.parent=rig
modifier=obj.modifiers.new('Community armature','ARMATURE');modifier.object=rig
bpy.data.objects.remove(proxy,do_unlink=True)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
for obj in meshes:obj.select_set(True)
report={'bones':len(arm.bones),'meshes':[]}
for obj in meshes:
    missing=[v.index for v in obj.data.vertices if sum(g.weight for g in v.groups)<.001]
    if missing:raise RuntimeError('Unweighted vertex count: '+str(len(missing)))
    report['meshes'].append({'name':obj.name,'vertices':len(obj.data.vertices),'polygons':len(obj.data.polygons),'uvLayers':len(obj.data.uv_layers),'unweighted':len(missing)})
bpy.ops.wm.save_as_mainfile(filepath=str(out/'sas-rigged.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/'sas-rigged.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True,export_apply=False,export_extras=True,export_skins=True)
(out/'sas-rig-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))

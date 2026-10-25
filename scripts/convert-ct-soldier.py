"""Convert the CC BY 4.0 BAMEN soldier into the project's CT animation rig.

Input: .tmp/ct-candidate/soldier.glb from cktang88/3d-fps. The model is
credited to BAMEN; the intermediary's animation clips are intentionally
excluded from the exported runtime model.
"""

from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / '.tmp/ct-candidate/soldier.glb'
DESTINATION = ROOT / 'assets/characters/community/sas-bamen.glb'

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))

root = next(obj for obj in bpy.context.scene.objects if obj.name == 'BamenMilitarySoldier')
armature = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
names = {
    'Hips': 'pelvis', 'Spine': 'spine', 'Spine1': 'chest',
    'Spine2': 'upper_chest', 'Neck': 'neck', 'Head': 'head',
}
for side in ('Left', 'Right'):
    short = 'L' if side == 'Left' else 'R'
    names.update({
        f'{side}Arm': f'upper_arm.{short}',
        f'{side}ForeArm': f'forearm.{short}',
        f'{side}Hand': f'hand.{short}',
        f'{side}UpLeg': f'thigh.{short}',
        f'{side}Leg': f'shin.{short}',
        f'{side}Foot': f'foot.{short}',
    })
for bone in armature.data.bones:
    original = bone.name.removeprefix('mixamorig:')
    if original in names:
        bone.name = names[original]

required = set(names.values())
actual = {bone.name for bone in armature.data.bones}
assert required <= actual, sorted(required - actual)

for obj in bpy.context.scene.objects:
    obj.animation_data_clear()
    obj.select_set(False)

def belongs_to_model(obj):
    while obj is not None:
        if obj == root:
            return True
        obj = obj.parent
    return False

for obj in bpy.context.scene.objects:
    if belongs_to_model(obj):
        obj.select_set(True)

bpy.context.view_layer.objects.active = armature
DESTINATION.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(DESTINATION), export_format='GLB', use_selection=True,
    export_animations=False, export_cameras=False, export_lights=False,
    export_image_format='AUTO',
)
print(f'CT SOLDIER OUTPUT {DESTINATION} {DESTINATION.stat().st_size} bytes')

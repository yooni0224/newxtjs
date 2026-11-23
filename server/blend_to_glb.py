# Blender(.blend) → GLB 변환 스크립트. Blender 안에서 실행됨 (server/blendConvert.js 가 부름):
#   blender -b --factory-startup -Y 파일.blend --python-exit-code 1 --python blend_to_glb.py -- 결과.glb 텍스처찾을폴더
#
# 하는 일
#   1) 빠진 텍스처를 같이 보낸 파일들 중에서 이름으로 찾아 연결
#   2) 숨김 상태를 기록(glTF 'extras' 의 webtoon_hidden)한 뒤 모두 보이게 → 숨긴 물체도 내보내고, 툴에서 숨김으로 표시
#      숨김으로 보는 것: 눈 아이콘·화면에서 끈 것, 렌더에서 끈 것, 와이어·상자로만 보이는 보조 물체(불리언 자르개 등),
#      숨긴 컬렉션 안의 것. 뷰 레이어에서 뺀(체크 해제) 컬렉션은 아예 안 내보냄
#   3) 컬렉션 = 빈 물체(그룹)로 만들어 그 안에 물체를 넣음 → 툴의 레이어 패널에 Blender 아웃라이너처럼 나옴
#   4) 모디파이어(미러·배열·베벨·서브디비전·불리언·아마추어 포즈 등) 적용한 모양으로 GLB 내보내기
#      (카메라·조명·애니메이션·뼈대·셰이프키는 빼고, 지금 보이는 모양 그대로)
import sys
import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(argv) < 2:
    raise RuntimeError('WEBTOON_ERROR: 사용법: ... -- 결과.glb 텍스처찾을폴더')
out_path, search_dir = argv[0], argv[1]

# 파일을 못 열면 Blender 는 기본 장면(상자 하나)으로 계속 실행됨 → 그걸 내보내지 않게
if not bpy.data.filepath:
    raise RuntimeError('WEBTOON_ERROR: Blender 가 이 파일을 열지 못했어요. (깨진 파일이거나, 더 새 버전 Blender 로 저장한 파일이면 Blender 를 업데이트해 주세요)')

view_layer = bpy.context.view_layer
scene = bpy.context.scene

# 1) 빠진 텍스처 찾기
try:
    bpy.ops.file.find_missing_files(directory=search_dir)
except Exception as err:  # 찾을 게 없거나 버전 차이
    print('WEBTOON: find_missing_files 건너뜀:', err)


def walk_layer_collections(lc):
    yield lc
    for child in lc.children:
        yield from walk_layer_collections(child)


# 2) 뷰 레이어에서 뺀(체크 해제) 컬렉션은 장면에서 떼어 냄 → 내보내지 않음
#    (컬렉션 자체는 남아 있어서, 그걸 '컬렉션 인스턴스'로 놓은 곳에는 그대로 나옴)
def detach_excluded(lc, parent_col):
    for child in list(lc.children):
        if child.exclude:
            parent_col.children.unlink(child.collection)
        else:
            detach_excluded(child, child.collection)


detach_excluded(view_layer.layer_collection, scene.collection)
view_layer.update()

# 3) 숨김 기록 + 모두 보이게
hidden_collections = set()
for lc in walk_layer_collections(view_layer.layer_collection):
    if lc.exclude:
        continue
    col = lc.collection
    if lc != view_layer.layer_collection:
        if lc.hide_viewport or col.hide_viewport or col.hide_render:
            hidden_collections.add(col.name)
        lc.hide_viewport = False
        col.hide_viewport = False

for ob in view_layer.objects:
    hidden = ob.hide_get() or ob.hide_viewport or ob.hide_render or ob.display_type in {'WIRE', 'BOUNDS'}
    if hidden:
        ob['webtoon_hidden'] = 1
    ob.hide_viewport = False
    try:
        ob.hide_set(False)
    except RuntimeError:
        pass

# 4) 컬렉션 → 빈 물체(그룹)
in_layer = {ob.name for ob in view_layer.objects}
collection_empty = {}


def has_objects(col):
    return any(ob.name in in_layer for ob in col.all_objects)


def build_collections(lc, parent):
    for child in lc.children:
        if child.exclude or not has_objects(child.collection):
            continue
        col = child.collection
        empty = bpy.data.objects.new(col.name, None)
        scene.collection.objects.link(empty)
        empty.parent = parent
        empty['webtoon_name'] = col.name  # 물체 이름과 겹치면 Blender 가 '.001' 을 붙여서, 원래 이름을 따로
        if col.name in hidden_collections:
            empty['webtoon_hidden'] = 1
        collection_empty[col.name] = empty
        build_collections(child, empty)


build_collections(view_layer.layer_collection, None)
empties = set(collection_empty.values())
for ob in list(view_layer.objects):
    if ob in empties or ob.parent is not None:
        continue
    for col in ob.users_collection:
        if col.name in collection_empty:
            world = ob.matrix_world.copy()
            ob.parent = collection_empty[col.name]
            ob.matrix_world = world
            break

view_layer.update()

# 5) 내보내기 (Blender 버전마다 있는 옵션만 골라서)
available = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
options = {
    'filepath': out_path,
    'export_format': 'GLB',
    'export_apply': True,
    'export_cameras': False,
    'export_lights': False,
    'export_animations': False,
    'export_skins': False,
    'export_morph': False,
    'export_extras': True,
    'export_yup': True,
    'export_texcoords': True,
    'export_normals': True,
    'export_materials': 'EXPORT',
    'export_image_format': 'AUTO',
    'export_gpu_instances': False,
    'use_visible': False,
    'use_renderable': False,
    'use_selection': False,
    'use_active_collection': False,
    'use_active_scene': True,
    'export_hierarchy_full_collections': False,  # 위에서 직접 만듦 (4.2+ 에만 있는 옵션)
}
options = {k: v for k, v in options.items() if k in available}
result = bpy.ops.export_scene.gltf(**options)
if 'FINISHED' not in result:
    raise RuntimeError('WEBTOON_ERROR: 내보내기 실패 ' + str(result))
print('WEBTOON: OK', out_path)

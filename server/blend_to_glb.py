# Blender(.blend) → GLB 변환 스크립트. Blender 안에서 실행됨 (server/blendConvert.js 가 부름):
#   blender -b --factory-startup -Y 파일.blend --python-exit-code 1 --python blend_to_glb.py -- 결과.glb 텍스처찾을폴더
#   → 결과.glb 와 결과.glb.json(안내: 못 찾은 텍스처 등)
#
# 하는 일
#   1) 빠진 텍스처를 같이 보낸 파일들 중에서 이름으로 찾아 연결 (그래도 없는 것은 이름을 알려 줌)
#   2) 뷰 레이어에서 뺀(체크 해제) 컬렉션은 안 내보냄
#   3) 숨김 상태를 기록(glTF 'extras' 의 webtoon_hidden)한 뒤 모두 보이게 → 숨긴 물체도 내보내고, 툴에서 숨김으로 표시
#      숨김으로 보는 것: 눈 아이콘·화면에서 끈 것, 렌더에서 끈 것, 와이어·상자로만 보이는 보조 물체(불리언 자르개 등),
#      숨긴 컬렉션 안의 것
#   4) 파티클·꼭짓점 인스턴스(흩뿌린 풀·나무·의자 등)를 실제 물체로 (glTF 는 이걸 못 담아서 그냥 두면 빠짐)
#   5) 텍스처를 'UV' 가 아니라 물체·생성 좌표(박스 투영 포함)로 붙인 재질 → 같은 모양이 되도록 UV 를 계산해 넣음
#      (glTF 는 UV 로만 텍스처를 붙여서, 그냥 두면 텍스처가 늘어나거나 뭉개짐 — 건물 벽·바닥에 흔함)
#   6) 컬렉션 = 빈 물체(그룹)로 만들어 그 안에 물체를 넣음 → 툴의 레이어 패널에 Blender 아웃라이너처럼 나옴
#      (물체의 위치 값은 건드리지 않음 — 제약·드라이버가 있는 물체가 엉뚱한 데로 가지 않게)
#   7) 모디파이어(미러·배열·베벨·서브디비전·불리언·아마추어 포즈·지오메트리 노드 등) 적용한 모양으로 GLB 내보내기
#      (카메라·조명·애니메이션·뼈대·셰이프키는 빼고, 지금 보이는 모양 그대로. 재질에서 안 쓰는 꼭짓점 색은 빼기 —
#       넣으면 물체가 검게·얼룩지게 나옴)
import json
import os
import sys
import zlib

import bpy
from mathutils import Euler, Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(argv) < 2:
    raise RuntimeError('WEBTOON_ERROR: 사용법: ... -- 결과.glb 텍스처찾을폴더')
out_path, search_dir = argv[0], argv[1]

# 파일을 못 열면 Blender 는 기본 장면(상자 하나)으로 계속 실행됨 → 그걸 내보내지 않게
if not bpy.data.filepath:
    raise RuntimeError('WEBTOON_ERROR: Blender 가 이 파일을 열지 못했어요. (깨진 파일이거나, 더 새 버전 Blender 로 저장한 파일이면 Blender 를 업데이트해 주세요)')

view_layer = bpy.context.view_layer
scene = bpy.context.scene
info = {'blender': bpy.app.version_string, 'missing_textures': [], 'hair_skipped': 0, 'made_real': 0, 'uv_generated': 0}


def log(*args):
    print('WEBTOON:', *args)


# ---------- 1) 빠진 텍스처 ----------
try:
    bpy.ops.file.find_missing_files(directory=search_dir)
except Exception as err:  # 찾을 게 없거나 버전 차이
    log('find_missing_files 건너뜀:', err)

def material_images():
    """재질(노드 그룹 안 포함)에서 쓰는 그림들 — 배경(월드) HDR 같은 건 빼고"""
    found, seen_trees = set(), set()

    def walk(tree):
        if tree is None or tree in seen_trees:
            return
        seen_trees.add(tree)
        for n in tree.nodes:
            if n.bl_idname == 'ShaderNodeTexImage' and n.image:
                found.add(n.image)
            elif n.bl_idname == 'ShaderNodeGroup':
                walk(n.node_tree)

    for m in bpy.data.materials:
        if m.users and m.use_nodes:
            walk(m.node_tree)
    return found


for img in material_images():
    if img.packed_file or img.source not in {'FILE', 'SEQUENCE', 'TILED'}:
        continue
    try:
        path = bpy.path.abspath(img.filepath, library=img.library)
    except TypeError:
        path = bpy.path.abspath(img.filepath)
    if img.source == 'TILED' or not os.path.isfile(path):
        if img.source == 'TILED' and os.path.isfile(path.replace('<UDIM>', '1001')):
            continue
        name = os.path.basename(img.filepath.replace('\\', '/')) or img.name
        if name not in info['missing_textures']:
            info['missing_textures'].append(name)


def walk_layer_collections(lc):
    yield lc
    for child in lc.children:
        yield from walk_layer_collections(child)


# ---------- 2) 뺀 컬렉션 떼어 내기 ----------
#    (컬렉션 자체는 남아 있어서, 그걸 '컬렉션 인스턴스'로 놓은 곳에는 그대로 나옴)
def detach_excluded(lc, parent_col):
    for child in list(lc.children):
        if child.exclude:
            parent_col.children.unlink(child.collection)
        else:
            detach_excluded(child, child.collection)


detach_excluded(view_layer.layer_collection, scene.collection)
view_layer.update()

# ---------- 3) 숨김 기록 + 모두 보이게 ----------
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
view_layer.update()


# ---------- 4) 파티클·꼭짓점 인스턴스 → 실제 물체 ----------
def select_only(ob):
    for o in view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    view_layer.objects.active = ob


def make_real(ob):
    before = set(bpy.data.objects)
    select_only(ob)
    try:
        bpy.ops.object.duplicates_make_real(use_base_parent=False, use_hierarchy=False)
    except Exception as err:
        log('인스턴스를 실제 물체로 못 바꿈:', ob.name, err)
        return []
    made = [o for o in bpy.data.objects if o not in before]
    for o in made:
        if 'webtoon_hidden' in o:  # 원본에서 복사된 숨김 표시는 지움 (인스턴스는 보여야 함)
            del o['webtoon_hidden']
        if ob.get('webtoon_hidden'):
            o['webtoon_hidden'] = 1
    info['made_real'] += len(made)
    return made


for ob in list(view_layer.objects):
    if ob.type == 'MESH' and ob.particle_systems:
        has_instances = False
        for ps in ob.particle_systems:
            rt = ps.settings.render_type
            if rt in {'OBJECT', 'COLLECTION'}:
                has_instances = True
            elif rt == 'PATH' and ps.settings.type == 'HAIR':
                info['hair_skipped'] += 1
        if has_instances:
            make_real(ob)
            if not ob.show_instancer_for_render:
                ob['webtoon_hidden'] = 1
    elif ob.instance_type in {'VERTS', 'FACES'} and ob.children:
        templates = list(ob.children)
        if make_real(ob):
            for child in templates:  # 꼭짓점 인스턴스의 원본(틀)은 Blender 에서도 그 자리에 안 보임
                child['webtoon_hidden'] = 1
            if not ob.show_instancer_for_render:
                ob['webtoon_hidden'] = 1
view_layer.update()


# ---------- 5) 물체·생성 좌표 텍스처 → UV 계산 ----------
def follow(socket):
    """입력 소켓에 연결된 (노드, 출력 소켓). 경유 노드(Reroute)는 건너뜀"""
    while socket.is_linked:
        link = socket.links[0]
        node = link.from_node
        if node.bl_idname == 'NodeReroute':
            socket = node.inputs[0]
            continue
        return node, link.from_socket
    return None, None


def coord_source(img_node):
    """이미지 노드의 좌표가 물체·생성 좌표면 ('Object'|'Generated', [매핑 노드들(이미지 쪽부터)]), 아니면 None"""
    vec = img_node.inputs.get('Vector')
    if vec is None:
        return None
    node, out = follow(vec)
    maps = []
    while node is not None and node.bl_idname == 'ShaderNodeMapping':
        maps.append(node)
        node, out = follow(node.inputs['Vector'])
    if node is None or node.bl_idname != 'ShaderNodeTexCoord' or out.name not in {'Object', 'Generated'}:
        return None
    if out.name == 'Object' and node.object is not None:  # 다른 물체 기준 좌표는 건너뜀
        return None
    return out.name, maps


def socket_value(node, name, fallback):
    s = node.inputs.get(name)
    if s is None:
        return Vector(getattr(node, name.lower(), fallback))
    return Vector(s.default_value)


def apply_mapping(node, co):
    kind = getattr(node, 'vector_type', 'POINT')
    loc = socket_value(node, 'Location', (0, 0, 0))
    rot = Euler(socket_value(node, 'Rotation', (0, 0, 0))).to_matrix()
    scale = socket_value(node, 'Scale', (1, 1, 1))
    if kind == 'TEXTURE':
        v = rot.inverted() @ (co - loc)
        return Vector((v.x / (scale.x or 1), v.y / (scale.y or 1), v.z / (scale.z or 1)))
    v = rot @ Vector((co.x * scale.x, co.y * scale.y, co.z * scale.z))
    return v + loc if kind == 'POINT' else v


def project(co, normal, projection):
    if projection == 'BOX':  # Cycles 와 같은 축 고르기 (가장 큰 법선 성분)
        ax, ay, az = abs(normal.x), abs(normal.y), abs(normal.z)
        if ax >= ay and ax >= az:
            return co.y, co.z
        if ay >= az:
            return co.x, co.z
        return co.y, co.x
    return co.x, co.y


def bake_object_mesh(ob):
    """모디파이어 적용한 모양을 이 물체만의 메시로 (물체 좌표는 최종 모양 기준이라)"""
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(deps), preserve_all_data_layers=True, depsgraph=deps)
    ob.modifiers.clear()
    ob.data = me


def fill_uvs(me, layer_name, kind, maps, projection, texspace):
    if layer_name in me.uv_layers:
        return True
    if len(me.uv_layers) >= 8:
        return False
    layer = me.uv_layers.new(name=layer_name, do_init=False)
    lo, size = texspace
    verts = me.vertices
    data = layer.data
    for poly in me.polygons:
        n = poly.normal
        for li in poly.loop_indices:
            co = verts[me.loops[li].vertex_index].co.copy()
            if kind == 'Generated':
                co = Vector(((co.x - lo.x) / (size.x or 1), (co.y - lo.y) / (size.y or 1), (co.z - lo.z) / (size.z or 1)))
            for m in reversed(maps):
                co = apply_mapping(m, co)
            data[li].uv = project(co, n, projection)
    return True


# 재질마다 고칠 이미지 노드 찾기
remap = {}  # 재질 → [(이미지 노드, 좌표 종류, 매핑들, UV 이름)]
for mat in bpy.data.materials:
    if not mat.use_nodes or not mat.node_tree:
        continue
    for node in mat.node_tree.nodes:
        if node.bl_idname != 'ShaderNodeTexImage' or node.projection not in {'FLAT', 'BOX'}:
            continue
        src = coord_source(node)
        if src:
            uv_name = 'wt_%08x' % (zlib.crc32((mat.name + '|' + node.name).encode()) & 0xffffffff)
            remap.setdefault(mat, []).append((node, src[0], src[1], uv_name))

if remap:
    done_meshes = set()
    for ob in list(view_layer.objects):
        if ob.type != 'MESH':
            continue
        mats = {slot.material for slot in ob.material_slots if slot.material in remap}
        if not mats:
            continue
        me = ob.data
        texspace = (Vector(me.texspace_location) - Vector(me.texspace_size), Vector(me.texspace_size) * 2)
        needs_object = any(kind == 'Object' for m in mats for _, kind, _, _ in remap[m])
        if needs_object and len(ob.modifiers):
            bake_object_mesh(ob)
            me = ob.data
        for m in mats:
            for node, kind, maps, uv_name in remap[m]:
                if (me.name, uv_name) in done_meshes:
                    continue
                if fill_uvs(me, uv_name, kind, maps, node.projection, texspace):
                    done_meshes.add((me.name, uv_name))
                    info['uv_generated'] += 1
    # 재질: 이미지 노드가 새 UV 를 쓰게 (매핑은 UV 에 이미 넣었음)
    for mat, items in remap.items():
        tree = mat.node_tree
        for node, _, _, uv_name in items:
            uv = tree.nodes.new('ShaderNodeUVMap')
            uv.uv_map = uv_name
            uv.location = node.location - Vector((250, 0))
            tree.links.new(uv.outputs['UV'], node.inputs['Vector'])
            node.projection = 'FLAT'
    view_layer.update()

# ---------- 6) 컬렉션 → 빈 물체(그룹) ----------
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
            # 빈 물체는 원점·회전 없음 → 부모 보정 행렬을 단위 행렬로 두면 위치 값(basis)을 안 바꿔도 제자리
            ob.parent = collection_empty[col.name]
            ob.matrix_parent_inverse = Matrix.Identity(4)
            break
view_layer.update()

# ---------- 7) 내보내기 (Blender 버전마다 있는 옵션만 골라서) ----------
uses_color_attribute = any(
    n.bl_idname in {'ShaderNodeVertexColor', 'ShaderNodeAttribute'}
    for m in bpy.data.materials if m.use_nodes and m.node_tree for n in m.node_tree.nodes
)
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
    'export_gn_mesh': True,  # 지오메트리 노드로 흩뿌린 인스턴스도 (4.1+)
    # 꼭짓점 색: 재질에서 쓸 때만 (4.2+ 는 export_vertex_color, 그 전에는 export_colors)
    'export_vertex_color': 'MATERIAL',
    'export_all_vertex_colors': False,
    'export_active_vertex_color_when_no_material': False,
    'export_colors': uses_color_attribute,
    'use_visible': False,
    'use_renderable': False,
    'use_selection': False,
    'use_active_collection': False,
    'use_active_scene': True,
    'export_hierarchy_full_collections': False,  # 위에서 직접 만듦 (4.2+ 에만 있는 옵션)
}
options = {k: v for k, v in options.items() if k in available}


def drop_image(name):
    """내보내기를 막는 그림(UDIM·저장 안 된 그림 등)을 재질에서 떼어 냄"""
    found = False
    for m in bpy.data.materials:
        if m.use_nodes and m.node_tree:
            for n in m.node_tree.nodes:
                if n.bl_idname == 'ShaderNodeTexImage' and n.image and n.image.name == name:
                    n.image = None
                    found = True
    return found


# UDIM(타일) 그림은 glTF 에 못 담고, 옛 Blender 에서는 내보내기 전체를 실패시킴 → 미리 뺌
info['dropped_images'] = []
for img in list(bpy.data.images):
    if img.source == 'TILED' and drop_image(img.name):
        info['dropped_images'].append(img.name)

# 그래도 그림 하나 때문에 전체가 실패하면 그 그림만 빼고 다시, 그래도 안 되면 텍스처 없이
for attempt in range(8):
    try:
        result = bpy.ops.export_scene.gltf(**options)
        break
    except RuntimeError as err:
        text = str(err)
        names = [n for n in __import__('re').findall(r"Image '([^']+)'", text) if n not in info['dropped_images']]
        if names and any(drop_image(n) for n in names):
            info['dropped_images'] += names
            log('그림을 빼고 다시 내보냄:', names)
            continue
        if options.get('export_image_format') != 'NONE' and 'export_image_format' in available:
            options['export_image_format'] = 'NONE'
            info['no_textures'] = True
            log('텍스처 없이 다시 내보냄:', text[-300:])
            continue
        raise
if 'FINISHED' not in result:
    raise RuntimeError('WEBTOON_ERROR: 내보내기 실패 ' + str(result))
with open(out_path + '.json', 'w', encoding='utf-8') as f:
    json.dump(info, f, ensure_ascii=False)
log('OK', out_path, json.dumps(info, ensure_ascii=False))

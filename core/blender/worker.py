"""Validated Blender operations. No eval, exec, or generated Python is accepted."""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector

job_path = sys.argv[sys.argv.index('--') + 1]
with open(job_path, encoding='utf-8') as f:
    job = json.load(f)
root = os.path.realpath(job['output'])
os.makedirs(root, exist_ok=True)
def output(name):
    p = os.path.realpath(os.path.join(root, name))
    if os.path.commonpath([p, root]) != root:
        raise ValueError('Invalid output path')
    return p
if job.get('input'):
    bpy.ops.wm.open_mainfile(filepath=job['input'], load_ui=False, use_scripts=False)
else:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.context.scene.world.color = (0.07, 0.07, 0.07)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = {'meters':1, 'centimeters':0.01, 'millimeters':0.001}[job['units']]
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.threads_mode = 'FIXED'
scene.render.threads = 2
exports = []
def obj(name):
    o = bpy.data.objects.get(name)
    if not o or o.type not in ('MESH','FONT','LIGHT','CAMERA'):
        raise ValueError('Object unavailable: ' + name)
    return o
def active(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
def transform(o,a):
    if 'location' in a: o.location = a['location']
    if 'rotation' in a: o.rotation_euler = [math.radians(v) for v in a['rotation']]
    if 'scale' in a: o.scale = a['scale']
    if 'dimensions' in a:
        if min(a['dimensions']) <= 0: raise ValueError('Dimensions must be positive')
        # The tool contract specifies LOCAL dimensions before rotation.
        rotation = o.rotation_euler.copy()
        o.rotation_euler = (0, 0, 0)
        bpy.context.view_layer.update()
        o.dimensions = a['dimensions']
        active(o)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        o.rotation_euler = rotation
def modifier(o,a):
    kinds={'bevel':'BEVEL','solidify':'SOLIDIFY','subdivision':'SUBSURF','mirror':'MIRROR'}
    if len(o.modifiers)>=8: raise ValueError('Modifier limit reached')
    m=o.modifiers.new('JARVIS '+a['kind'],kinds[a['kind']])
    if a['kind']=='bevel': m.width=a.get('amount',0.01); m.segments=a.get('segments',3)
    if a['kind']=='solidify': m.thickness=a.get('amount',0.01)
    if a['kind']=='subdivision': m.levels=min(3,a.get('segments',1));m.render_levels=m.levels
    if a.get('apply'): active(o);bpy.ops.object.modifier_apply(modifier=m.name)
for a in job['operations']:
    op=a['op']
    if len(scene.objects)>200: raise ValueError('Scene object limit reached')
    if op in ('create_primitive','create_mesh','add_text','add_light') and bpy.data.objects.get(a['name']):
        raise ValueError('Use transform to edit the existing object: '+a['name'])
    if op=='create_primitive':
        k=a['kind'];v=a.get('vertices',64);r=a.get('radius',1);d=a.get('depth',2)
        if k=='cube': bpy.ops.mesh.primitive_cube_add(size=2)
        elif k=='sphere': bpy.ops.mesh.primitive_uv_sphere_add(segments=v,ring_count=min(v,32),radius=r)
        elif k=='cylinder': bpy.ops.mesh.primitive_cylinder_add(vertices=v,radius=r,depth=d)
        elif k=='cone': bpy.ops.mesh.primitive_cone_add(vertices=v,radius1=r,depth=d)
        elif k=='torus': bpy.ops.mesh.primitive_torus_add(major_segments=v,minor_segments=16,major_radius=r,minor_radius=max(r*0.1,0.001))
        else: bpy.ops.mesh.primitive_plane_add(size=2)
        o=bpy.context.object;o.name=a['name'];transform(o,a)
    elif op=='create_mesh':
        if any(i>=len(a['vertices']) for f in a['faces'] for i in f): raise ValueError('Invalid face index')
        mesh=bpy.data.meshes.new(a['name']);mesh.from_pydata(a['vertices'],[],a['faces']);mesh.validate();mesh.update()
        o=bpy.data.objects.new(a['name'],mesh);scene.collection.objects.link(o)
    elif op=='transform': transform(obj(a['object']),a)
    elif op in ('bevel','add_modifier'):
        modifier(obj(a['object']),{**a,'kind':'bevel' if op=='bevel' else a['kind']})
    elif op=='boolean':
        o=obj(a['object']);c=obj(a['cutter']);active(o)
        if o.type!='MESH' or c.type!='MESH': raise ValueError('Boolean needs mesh objects')
        m=o.modifiers.new('JARVIS boolean','BOOLEAN');m.operation=a['operation'];m.object=c;m.solver='EXACT'
        if a['apply']:
            bpy.ops.object.modifier_apply(modifier=m.name)
            bm=bmesh.new();bm.from_mesh(o.data)
            bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
            bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-8)
            bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();o.data.update()
            if a['removeCutter']: bpy.data.objects.remove(c,do_unlink=True)
        elif a['removeCutter']: raise ValueError('Cannot remove unapplied boolean cutter')
    elif op=='extrude':
        o=obj(a['object'])
        if o.type!='MESH': raise ValueError('Extrusion needs a mesh')
        bm=bmesh.new();bm.from_mesh(o.data)
        top=max(v.co['XYZ'.index(a['axis'])] for v in bm.verts)
        faces=[f for f in bm.faces if all(abs(v.co['XYZ'.index(a['axis'])]-top)<1e-5 for v in f.verts)]
        if not faces: raise ValueError('No planar top faces for extrusion')
        geom=bmesh.ops.extrude_face_region(bm,geom=faces)['geom']
        move=Vector((0,0,0));move['XYZ'.index(a['axis'])]=a['distance']
        bmesh.ops.translate(bm,vec=move,verts=[v for v in geom if isinstance(v,bmesh.types.BMVert)])
        bmesh.ops.delete(bm,geom=faces,context='FACES_ONLY');bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
    elif op=='add_text':
        curve=bpy.data.curves.new(a['name'],'FONT');curve.body=a['text'];curve.size=a['size'];curve.extrude=a['extrude'];curve.align_x='CENTER';curve.align_y='CENTER'
        o=bpy.data.objects.new(a['name'],curve);scene.collection.objects.link(o);transform(o,a)
        if a['convert']: active(o);bpy.ops.object.convert(target='MESH')
    elif op=='create_material':
        m=bpy.data.materials.get(a['name']) or bpy.data.materials.new(a['name']);m.use_nodes=True
        bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=a['color'];bs.inputs['Metallic'].default_value=a['metallic'];bs.inputs['Roughness'].default_value=a['roughness']
        m.diffuse_color=a['color']
        if a.get('emission'): bs.inputs['Emission Color'].default_value=a['emission'];bs.inputs['Emission Strength'].default_value=a.get('strength',1)
    elif op=='assign_material':
        o=obj(a['object']);m=bpy.data.materials.get(a['material'])
        if not m: raise ValueError('Material unavailable')
        o.data.materials.clear();o.data.materials.append(m)
    elif op=='add_light':
        data=bpy.data.lights.new(a['name'],a['kind']);data.energy=a['energy']
        if hasattr(data,'size'): data.size=a['size']
        if a.get('color'): data.color=a['color']
        o=bpy.data.objects.new(a['name'],data);scene.collection.objects.link(o);o.location=a['location'];o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler()
    elif op=='set_light':
        o=obj(a['object'])
        if o.type!='LIGHT': raise ValueError('Select a light object')
        if 'energy' in a: o.data.energy=a['energy']
        if 'size' in a and hasattr(o.data,'size'): o.data.size=a['size']
        if 'color' in a: o.data.color=a['color']
    elif op=='set_camera':
        o=scene.camera
        if not o:
            data=bpy.data.cameras.new('JARVIS Camera');o=bpy.data.objects.new('JARVIS Camera',data);scene.collection.objects.link(o);scene.camera=o
        o.location=a['location'];o.rotation_euler=(Vector(a['target'])-o.location).to_track_quat('-Z','Y').to_euler();o.data.lens=a['lens']
        o.data.type='ORTHO' if a['orthographic'] else 'PERSP';o.data.ortho_scale=a['orthoScale']
        if a.get('fit') and a['orthographic']:
            bpy.context.view_layer.update()
            corners=[mesh.matrix_world @ Vector(corner) for mesh in scene.objects if mesh.type=='MESH' for corner in mesh.bound_box]
            if not corners: raise ValueError('Cannot frame an empty scene')
            low=Vector(tuple(min(v[i] for v in corners) for i in range(3)))
            high=Vector(tuple(max(v[i] for v in corners) for i in range(3)))
            center=(low+high)/2
            direction=o.location-Vector(a['target'])
            if direction.length<1e-6: direction=Vector((1,-1,1))
            o.location=center+direction.normalized()*max((high-low).length*3,0.1)
            o.rotation_euler=(center-o.location).to_track_quat('-Z','Y').to_euler()
            inverse=o.rotation_euler.to_matrix().transposed()
            projected=[inverse @ (v-center) for v in corners]
            o.data.ortho_scale=max(max(v.x for v in projected)-min(v.x for v in projected),max(v.y for v in projected)-min(v.y for v in projected),0.001)*1.3
            o.data.clip_start=0.0001;o.data.clip_end=max(100,(high-low).length*10)
    elif op=='render':
        if 'exposure' in a: scene.view_settings.exposure=a['exposure']
        if not scene.camera: raise ValueError('Set a camera before rendering')
        if not any(o.type=='LIGHT' for o in scene.objects): raise ValueError('Add lighting before rendering')
        scene.render.resolution_x=a['width'];scene.render.resolution_y=a['height'];scene.render.resolution_percentage=100;scene.render.film_transparent=a['transparent'];scene.render.image_settings.file_format='PNG';scene.render.filepath=output('render.png')
        bpy.ops.render.render(write_still=True);exports.append({'format':'PNG','name':'render.png'})
    elif op=='export':
        fmt=a['format'];p=output('model.'+fmt.lower())
        if fmt in ('GLB','GLTF'): bpy.ops.export_scene.gltf(filepath=p,export_format='GLB' if fmt=='GLB' else 'GLTF_SEPARATE',export_cameras=False,export_lights=False)
        elif fmt=='OBJ': bpy.ops.wm.obj_export(filepath=p,export_materials=True)
        elif fmt=='STL': bpy.ops.wm.stl_export(filepath=p)
        else: bpy.ops.export_scene.fbx(filepath=p,use_selection=False,object_types={'MESH'},bake_anim=False)
        exports.append({'format':fmt,'name':os.path.basename(p)})
    elif op not in ('get_scene','save_project'): raise ValueError('Unsupported operation')
bpy.context.view_layer.update()
objects=[]
total=0
for o in scene.objects:
    data={'name':o.name,'type':o.type,'location':list(o.location),'rotation':[math.degrees(v) for v in o.rotation_euler],'dimensions':list(o.dimensions),'materials':[m.name for m in getattr(o.data,'materials',[]) if m]}
    if o.type=='LIGHT': data['energy']=o.data.energy
    if o.type=='MESH':
        mesh=o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        total+=len(mesh.vertices)
        if total>500000: raise ValueError('Evaluated geometry exceeds the safe preview budget')
        bm=bmesh.new();bm.from_mesh(mesh);data['vertices']=len(mesh.vertices);data['faces']=len(mesh.polygons);data['manifold']=all(e.is_manifold for e in bm.edges);bm.free();o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
    objects.append(data)
bpy.ops.wm.save_as_mainfile(filepath=output('scene.blend'),check_existing=False)
with open(output('result.json'),'w',encoding='utf-8') as f: json.dump({'objects':objects,'units':job['units'],'exports':exports,'totalVertices':total},f)
print('JARVIS_BLENDER_COMPLETE',flush=True)

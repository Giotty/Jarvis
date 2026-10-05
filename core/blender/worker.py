"""Validated Blender operations. No eval, exec, or generated Python is accepted."""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector, Matrix

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
for saved in job.get('materialInventory',[]):
    material=bpy.data.materials.get(saved['name'])
    if not material:
        material=bpy.data.materials.new(saved['name']);material.use_nodes=True
        shader=material.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value=saved['color'];material.diffuse_color=saved['color']
        shader.inputs['Metallic'].default_value=saved['metallic'];shader.inputs['Roughness'].default_value=saved['roughness']
    material.use_fake_user=True
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = {'meters':1, 'centimeters':0.01, 'millimeters':0.001}[job['units']]
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
if job.get('renderDevice') == 'GPU':
    try:
        preferences=bpy.context.preferences.addons['cycles'].preferences
        preferences.compute_device_type='OPTIX'
        preferences.get_devices()
        devices=[d for d in preferences.devices if d.type=='OPTIX']
        if devices:
            for device in preferences.devices: device.use=device.type=='OPTIX'
            scene.cycles.device='GPU'
    except Exception:
        scene.cycles.device='CPU'
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
    o.hide_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o

def model_objects():
    return [o for o in scene.objects if o.type=='MESH' and not o.hide_render and o.get('jarvis_role','MODEL')=='MODEL']

def tag_role(o,a):
    o['jarvis_role']=a.get('role','MODEL');o.hide_render=o['jarvis_role']=='CONSTRUCTION'

def clean_mesh(mesh):
    bm=bmesh.new();bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-8)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.update()

def apply_through(o,modifier):
    # Applying a later modifier against an unevaluated earlier stack can bake
    # preceding arrays into the mesh while retaining those arrays a second time.
    active(o)
    for previous in list(o.modifiers):
        name=previous.name;last=previous==modifier
        bpy.ops.object.modifier_apply(modifier=name)
        if last: break

def geometry_budget():
    total=0;graph=bpy.context.evaluated_depsgraph_get()
    for o in scene.objects:
        if o.type!='MESH': continue
        evaluated=o.evaluated_get(graph);mesh=evaluated.to_mesh();total+=len(mesh.vertices);evaluated.to_mesh_clear()
        if total>500000: raise ValueError('Evaluated geometry exceeds the safe preview budget before rendering/export')

def bake_surfaces():
    # Bake UV-based procedural surface detail to embedded PBR textures so the
    # interactive GLB retains the material appearance of the Blender renders.
    pending=[m for m in bpy.data.materials if m.use_nodes and not m.get('jarvis_baked') and any(n.bl_idname in ('ShaderNodeTexNoise','ShaderNodeTexChecker') for n in m.node_tree.nodes)]
    if not pending: return
    for o in scene.objects:
        if o.type=='MESH' and any(m in pending for m in o.data.materials if m) and not o.data.uv_layers:
            active(o);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(island_margin=0.02);bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.mesh.primitive_plane_add(size=2);swatch=bpy.context.object;swatch.name='JARVIS Temporary Material Swatch'
    scene.render.bake.use_clear=True;scene.render.bake.margin=4;scene.cycles.samples=8
    for m in pending:
        nodes=m.node_tree.nodes;links=m.node_tree.links;bs=nodes.get('Principled BSDF');out=next(n for n in nodes if n.bl_idname=='ShaderNodeOutputMaterial')
        if not bs: continue
        uv=nodes.new('ShaderNodeTexCoord')
        for n in list(nodes):
            if n.bl_idname in ('ShaderNodeTexNoise','ShaderNodeTexChecker'): links.new(uv.outputs['UV'],n.inputs['Vector'])
        swatch.data.materials.clear();swatch.data.materials.append(m);active(swatch)
        normal_image=None
        if bs.inputs['Normal'].is_linked:
            normal_image=bpy.data.images.new('JARVIS '+m.name+' Normal',width=512,height=512);normal_image.colorspace_settings.name='Non-Color'
            texture=nodes.new('ShaderNodeTexImage');texture.image=normal_image;nodes.active=texture;bpy.ops.object.bake(type='NORMAL');normal_image.pack()
        color_image=None
        if bs.inputs['Base Color'].is_linked:
            color_image=bpy.data.images.new('JARVIS '+m.name+' Color',width=512,height=512)
            texture=nodes.new('ShaderNodeTexImage');texture.image=color_image;nodes.active=texture
            emission=nodes.new('ShaderNodeEmission');source=bs.inputs['Base Color'].links[0].from_socket
            links.new(source,emission.inputs['Color']);links.new(emission.outputs['Emission'],out.inputs['Surface']);bpy.ops.object.bake(type='EMIT');color_image.pack()
            links.new(bs.outputs['BSDF'],out.inputs['Surface']);nodes.remove(emission)
            color_texture=nodes.new('ShaderNodeTexImage');color_texture.image=color_image;links.new(color_texture.outputs['Color'],bs.inputs['Base Color'])
        if normal_image:
            normal_texture=nodes.new('ShaderNodeTexImage');normal_texture.image=normal_image
            normal_map=nodes.new('ShaderNodeNormalMap');links.new(normal_texture.outputs['Color'],normal_map.inputs['Color']);links.new(normal_map.outputs['Normal'],bs.inputs['Normal'])
        m['jarvis_baked']=True
    bpy.data.objects.remove(swatch,do_unlink=True)
def transform(o,a):
    parent=o.parent
    if parent and a.get('space','WORLD')=='WORLD':
        bpy.context.view_layer.update();world=o.matrix_world.copy();o.parent=None;o.matrix_world=world
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
    if parent and a.get('space','WORLD')=='WORLD':
        bpy.context.view_layer.update();world=o.matrix_world.copy();o.parent=parent;o.matrix_world=world
def modifier(o,a):
    kinds={'bevel':'BEVEL','solidify':'SOLIDIFY','subdivision':'SUBSURF','mirror':'MIRROR','weighted_normals':'WEIGHTED_NORMAL','array':'ARRAY'}
    if len(o.modifiers)>=8: raise ValueError('Modifier limit reached')
    if a['kind']=='array' and o.type=='MESH':
        evaluated=o.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh()
        estimate=len(mesh.vertices)*a.get('count',2);evaluated.to_mesh_clear()
        if estimate>500000: raise ValueError('Array would exceed evaluated geometry budget')
    m=o.modifiers.new('JARVIS '+a['kind'],kinds[a['kind']])
    if a['kind']=='bevel': m.width=a.get('amount',0.01); m.segments=a.get('segments',3)
    if a['kind']=='solidify': m.thickness=a.get('amount',0.01)
    if a['kind']=='subdivision': m.levels=min(3,a.get('segments',1));m.render_levels=m.levels
    if a['kind']=='mirror': m.use_axis=tuple(axis in a.get('axes',['X']) for axis in ['X','Y','Z'])
    if a['kind']=='weighted_normals':
        m.keep_sharp=True
        for p in o.data.polygons: p.use_smooth=True
    if a['kind']=='array':
        m.count=a.get('count',2);m.use_relative_offset=False;m.use_constant_offset=True;m.constant_offset_displace=a.get('offset',[0.1,0,0])
    if a.get('apply'): apply_through(o,m)
for a in job['operations']:
    op=a['op']
    bpy.context.view_layer.update()
    if len(scene.objects)>200: raise ValueError('Scene object limit reached')
    if op in ('create_primitive','create_mesh','add_text','add_light','create_curve','create_lathe','duplicate') and bpy.data.objects.get(a['name']):
        raise ValueError('Use transform to edit the existing object: '+a['name'])
    if op=='create_primitive':
        k=a['kind'];v=a.get('vertices',64);r=a.get('radius',1);d=a.get('depth',2)
        if k=='cube': bpy.ops.mesh.primitive_cube_add(size=2)
        elif k=='sphere': bpy.ops.mesh.primitive_uv_sphere_add(segments=v,ring_count=min(v,32),radius=r)
        elif k=='cylinder': bpy.ops.mesh.primitive_cylinder_add(vertices=v,radius=r,depth=d)
        elif k=='cone': bpy.ops.mesh.primitive_cone_add(vertices=v,radius1=r,depth=d)
        elif k=='torus': bpy.ops.mesh.primitive_torus_add(major_segments=v,minor_segments=16,major_radius=r,minor_radius=max(r*0.1,0.001))
        else: bpy.ops.mesh.primitive_plane_add(size=2)
        o=bpy.context.object;o.name=a['name'];tag_role(o,a);transform(o,a)
        if k in ('sphere','cylinder','cone','torus'):
            for p in o.data.polygons: p.use_smooth=len(p.vertices)<5
    elif op=='create_mesh':
        if any(i>=len(a['vertices']) for f in a['faces'] for i in f): raise ValueError('Invalid face index')
        mesh=bpy.data.meshes.new(a['name']);mesh.from_pydata(a['vertices'],[],a['faces']);mesh.validate();clean_mesh(mesh)
        o=bpy.data.objects.new(a['name'],mesh);scene.collection.objects.link(o);tag_role(o,a)
    elif op=='transform': transform(obj(a['object']),a)
    elif op=='set_role':
        o=obj(a['object']);o['jarvis_role']=a['role'];o.hide_render=a['role']=='CONSTRUCTION'
    elif op=='remove_object':
        o=obj(a['object']);children=[(c,c.matrix_world.copy()) for c in o.children]
        bpy.data.objects.remove(o,do_unlink=True)
        for child,world in children: child.parent=None;child.matrix_world=world
    elif op=='import_glb':
        bpy.ops.import_scene.gltf(filepath=a['path'])
        imported=[o for o in bpy.context.selected_objects if o.type=='MESH']
        if not imported: raise ValueError('GLB has no mesh')
        bpy.ops.object.select_all(action='DESELECT')
        for o in imported: o.select_set(True)
        bpy.context.view_layer.objects.active=imported[0];bpy.ops.object.join();bpy.context.object.name=a['name']
    elif op=='create_curve':
        curve=bpy.data.curves.new(a['name'],'CURVE');curve.dimensions='3D';curve.bevel_depth=a['bevelDepth'];curve.bevel_resolution=4;curve.use_fill_caps=a.get('caps',True)
        spline=curve.splines.new(a.get('interpolation','POLY'))
        if spline.type=='BEZIER':
            spline.bezier_points.add(len(a['points'])-1)
            for p,v in zip(spline.bezier_points,a['points']): p.co=v;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
        else:
            spline.points.add(len(a['points'])-1)
            for p,v in zip(spline.points,a['points']): p.co=(*v,1)
        spline.use_cyclic_u=a['closed'];o=bpy.data.objects.new(a['name'],curve);scene.collection.objects.link(o)
        tag_role(o,a);active(o);bpy.ops.object.convert(target='MESH')
    elif op=='create_lathe':
        vertices=[];faces=[];n=a['segments'];profile=a['profile']
        if any(r<0 for r,z in profile): raise ValueError('Profile radii must be nonnegative')
        for r,z in profile:
            for i in range(n): vertices.append((r*math.cos(2*math.pi*i/n),r*math.sin(2*math.pi*i/n),z))
        for j in range(len(profile)-1):
            for i in range(n): faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
        faces.extend([tuple(reversed(range(n))),tuple((len(profile)-1)*n+i for i in range(n))])
        mesh=bpy.data.meshes.new(a['name']);mesh.from_pydata(vertices,[],faces);clean_mesh(mesh);o=bpy.data.objects.new(a['name'],mesh);scene.collection.objects.link(o);tag_role(o,a);transform(o,a)
    elif op=='duplicate':
        original=obj(a['object']);o=original.copy();o.data=original.data.copy();o.name=a['name'];scene.collection.objects.link(o);transform(o,a)
    elif op=='radial_array':
        original=obj(a['object']);center=Vector(a['center']);source=original.matrix_world.copy()
        if len(scene.objects)+a['count']-1>200: raise ValueError('Radial array exceeds scene object budget')
        for i in range(1,a['count']):
            name=a['namePrefix']+'_'+str(i)
            if bpy.data.objects.get(name): raise ValueError('Radial copy already exists: '+name)
            o=original.copy();o.data=original.data.copy();o.name=name;scene.collection.objects.link(o)
            rotation=Matrix.Rotation(math.radians(a['angle'])*i/a['count'],4,a['axis'])
            o.matrix_world=Matrix.Translation(center) @ rotation @ Matrix.Translation(-center) @ source
    elif op=='align':
        o=obj(a['object']);t=obj(a['target']);axes=range(3) if a['axis']=='ALL' else ['XYZ'.index(a['axis'])]
        world=o.matrix_world.copy()
        for axis in axes: world.translation[axis]=t.matrix_world.translation[axis]+a['offset'][axis]
        o.matrix_world=world
    elif op=='set_parent':
        o=obj(a['object']);p=obj(a['parent'])
        cursor=p
        while cursor:
            if cursor==o: raise ValueError('Hierarchy cycle')
            cursor=cursor.parent
        world=o.matrix_world.copy();o.parent=p;o.matrix_world=world
    elif op=='collection':
        collection=bpy.data.collections.get(a['name']) or bpy.data.collections.new(a['name'])
        if collection.name not in scene.collection.children: scene.collection.children.link(collection)
        for name in a['objects']:
            o=obj(name)
            if o.name not in collection.objects: collection.objects.link(o)
    elif op=='uv_unwrap':
        o=obj(a['object']);active(o);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        if a['method']=='smart': bpy.ops.uv.smart_project()
        else: bpy.ops.uv.cube_project()
        bpy.ops.object.mode_set(mode='OBJECT')
    elif op=='geometry_nodes':
        o=obj(a['object']);m=o.modifiers.new('JARVIS Geometry','NODES');group=bpy.data.node_groups.new('JARVIS Structured Geometry','GeometryNodeTree')
        group.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');group.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
        inp=group.nodes.new('NodeGroupInput');out=group.nodes.new('NodeGroupOutput')
        if a['kind']=='subdivide':
            node=group.nodes.new('GeometryNodeSubdivisionSurface');node.inputs['Level'].default_value=a['level'];group.links.new(inp.outputs['Geometry'],node.inputs['Mesh']);group.links.new(node.outputs['Mesh'],out.inputs['Geometry'])
        else:
            node=group.nodes.new('GeometryNodeMeshToCurve');tube=group.nodes.new('GeometryNodeCurvePrimitiveCircle');tube.inputs['Radius'].default_value=a['amount'];convert=group.nodes.new('GeometryNodeCurveToMesh')
            group.links.new(inp.outputs['Geometry'],node.inputs['Mesh']);group.links.new(node.outputs['Curve'],convert.inputs['Curve']);group.links.new(tube.outputs['Curve'],convert.inputs['Profile Curve']);group.links.new(convert.outputs['Mesh'],out.inputs['Geometry'])
        m.node_group=group
    elif op in ('bevel','add_modifier'):
        modifier(obj(a['object']),{**a,'kind':'bevel' if op=='bevel' else a['kind']})
    elif op=='boolean':
        o=obj(a['object']);c=obj(a['cutter']);active(o)
        if o.type!='MESH' or c.type!='MESH': raise ValueError('Boolean needs mesh objects')
        for array in [m for m in o.modifiers if m.type=='ARRAY' and m.use_constant_offset and m.count>=16]:
            offset=Vector(array.constant_offset_displace);length=offset.length
            if length>1e-9:
                direction=offset.normalized();projected=[v.co.dot(direction) for v in o.data.vertices]
                span=max(projected)-min(projected)
                if length<span*0.25:
                    raise ValueError('Dense self-overlapping array before Boolean on '+o.name+': spacing '+str(round(length,6))+' vs prototype span '+str(round(span,6))+'. Repeating whole plates does not create holes. Use small nonoverlapping repeating elements, an array of hole cutters, or an explicit coherent mesh.')
        m=o.modifiers.new('JARVIS boolean','BOOLEAN');m.operation=a['operation'];m.object=c;m.solver='EXACT'
        if a['apply']:
            apply_through(o,m)
            bm=bmesh.new();bm.from_mesh(o.data)
            bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
            bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-8)
            bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();o.data.update()
            if a['removeCutter']:
                if c.get('jarvis_text'): o['jarvis_applied_text']=json.dumps(json.loads(o.get('jarvis_applied_text','[]'))+[c['jarvis_text']])
                bpy.data.objects.remove(c,do_unlink=True)
            else:
                if c.get('jarvis_text'): o['jarvis_applied_text']=json.dumps(json.loads(o.get('jarvis_applied_text','[]'))+[c['jarvis_text']])
                c.hide_render=True;c.hide_set(True)
        elif a['removeCutter']: raise ValueError('Cannot remove unapplied boolean cutter')
        else: c.hide_render=True;c.hide_set(True)
    elif op=='extrude':
        o=obj(a['object'])
        if o.type!='MESH': raise ValueError('Extrusion needs a mesh')
        bm=bmesh.new();bm.from_mesh(o.data)
        top=(min if a.get('side')=='MIN' else max)(v.co['XYZ'.index(a['axis'])] for v in bm.verts)
        faces=[f for f in bm.faces if all(abs(v.co['XYZ'.index(a['axis'])]-top)<1e-5 for v in f.verts)]
        if not faces: raise ValueError('No planar top faces for extrusion')
        geom=bmesh.ops.extrude_face_region(bm,geom=faces)['geom']
        move=Vector((0,0,0));move['XYZ'.index(a['axis'])]=a['distance']
        bmesh.ops.translate(bm,vec=move,verts=[v for v in geom if isinstance(v,bmesh.types.BMVert)])
        bmesh.ops.delete(bm,geom=faces,context='FACES_ONLY');bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
    elif op=='add_text':
        curve=bpy.data.curves.new(a['name'],'FONT');curve.body=a['text'];curve.size=a['size'];curve.extrude=a['extrude'];curve.align_x='CENTER';curve.align_y='CENTER'
        o=bpy.data.objects.new(a['name'],curve);scene.collection.objects.link(o);transform(o,a);o['jarvis_text']=a['text']
        if a['convert']: active(o);bpy.ops.object.convert(target='MESH')
    elif op=='create_material':
        m=bpy.data.materials.get(a['name']) or bpy.data.materials.new(a['name']);m.use_nodes=True;m.use_fake_user=True
        m.node_tree.nodes.clear();bs=m.node_tree.nodes.new('ShaderNodeBsdfPrincipled');out=m.node_tree.nodes.new('ShaderNodeOutputMaterial');m.node_tree.links.new(bs.outputs['BSDF'],out.inputs['Surface']);m['jarvis_baked']=False
        bs.inputs['Base Color'].default_value=a['color'];bs.inputs['Metallic'].default_value=a['metallic'];bs.inputs['Roughness'].default_value=a['roughness']
        m.diffuse_color=a['color']
        if a.get('emission'): bs.inputs['Emission Color'].default_value=a['emission'];bs.inputs['Emission Strength'].default_value=a.get('strength',1)
        preset=a.get('preset','custom')
        if preset=='glass': bs.inputs['Transmission Weight'].default_value=1;bs.inputs['IOR'].default_value=1.45
        if preset=='brushed_metal': bs.inputs['Anisotropic'].default_value=0.65
        if a.get('bump',0)>0:
            noise=m.node_tree.nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=a.get('detailScale',120);noise.inputs['Detail'].default_value=3
            bump=m.node_tree.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=min(0.25,a['bump']);bump.inputs['Distance'].default_value=0.015
            m.node_tree.links.new(noise.outputs['Fac'],bump.inputs['Height']);m.node_tree.links.new(bump.outputs['Normal'],bs.inputs['Normal'])
        if preset=='carbon':
            checker=m.node_tree.nodes.new('ShaderNodeTexChecker');checker.inputs['Scale'].default_value=70
            checker.inputs['Color1'].default_value=a['color'];checker.inputs['Color2'].default_value=[v*0.45 for v in a['color'][:3]]+[1]
            m.node_tree.links.new(checker.outputs['Color'],bs.inputs['Base Color'])
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
            corners=[mesh.matrix_world @ Vector(corner) for mesh in model_objects() for corner in mesh.bound_box]
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
        geometry_budget();bake_surfaces()
        if 'samples' in a: scene.cycles.samples=a['samples']
        if 'exposure' in a: scene.view_settings.exposure=a['exposure']
        if not scene.camera: raise ValueError('Set a camera before rendering')
        if not any(o.type=='LIGHT' for o in scene.objects): raise ValueError('Add lighting before rendering')
        scene.render.resolution_x=a['width'];scene.render.resolution_y=a['height'];scene.render.resolution_percentage=100;scene.render.film_transparent=a['transparent'];scene.render.image_settings.file_format='PNG';scene.render.filepath=output('render.png')
        bpy.ops.render.render(write_still=True);exports.append({'format':'PNG','name':'render.png'})
    elif op=='render_views':
        geometry_budget();bake_surfaces()
        bpy.context.view_layer.update()
        if not scene.camera: raise ValueError('Set a camera before rendering')
        camera=scene.camera;saved_location=camera.location.copy();saved_rotation=camera.rotation_euler.copy();saved_scale=camera.data.ortho_scale
        corners=[o.matrix_world @ Vector(c) for o in model_objects() for c in o.bound_box]
        if not corners: raise ValueError('Empty scene')
        center=Vector(tuple((min(v[i] for v in corners)+max(v[i] for v in corners))/2 for i in range(3)))
        extent=max((v-center).length for v in corners)
        scene.cycles.samples=a['samples'];scene.render.resolution_x=a['width'];scene.render.resolution_y=a['width'];scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
        studios=[o for o in scene.objects if o.type=='MESH' and o.get('jarvis_role','MODEL')=='STUDIO' and not o.hide_render]
        for index,view in enumerate(a['views']):
            direction=Vector(view['location'])-Vector(view['target'])
            if direction.length<0.001: raise ValueError('Camera direction cannot be zero')
            camera.location=center+direction.normalized()*max(0.1,extent*4);camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
            camera.data.type='ORTHO';inverse=camera.rotation_euler.to_matrix().transposed();projected=[inverse @ (v-center) for v in corners]
            camera.data.ortho_scale=max(max(v.x for v in projected)-min(v.x for v in projected),max(v.y for v in projected)-min(v.y for v in projected))*1.18
            # A floor/backdrop must not occlude a reverse inspection angle.
            # Conservative segment/AABB intersection applies to any staging mesh.
            hidden=[]
            for staging in studios:
                box=[staging.matrix_world @ Vector(c) for c in staging.bound_box]
                low=[min(v[i] for v in box)-1e-6 for i in range(3)]
                high=[max(v[i] for v in box)+1e-6 for i in range(3)]
                start=0.0;end=1.0;delta=center-camera.location
                for axis in range(3):
                    if abs(delta[axis])<1e-9:
                        if not low[axis]<=camera.location[axis]<=high[axis]:end=-1;break
                    else:
                        first=(low[axis]-camera.location[axis])/delta[axis];last=(high[axis]-camera.location[axis])/delta[axis]
                        start=max(start,min(first,last));end=min(end,max(first,last))
                        if start>end:break
                if start<=end and end>0 and start<0.99:
                    staging.hide_render=True;hidden.append(staging)
            label=''.join(c if c.isalnum() or c in '-_' else '_' for c in view['name'])
            name='render.png' if index==0 else 'render-'+label+'.png';scene.render.filepath=output(name);bpy.ops.render.render(write_still=True);exports.append({'format':'PNG','name':name,'view':view['name']})
            for staging in hidden:staging.hide_render=False
        camera.location=saved_location;camera.rotation_euler=saved_rotation;camera.data.ortho_scale=saved_scale
    elif op=='inset':
        o=obj(a['object']);bm=bmesh.new();bm.from_mesh(o.data);axis='XYZ'.index(a['axis']);top=(min if a.get('side')=='MIN' else max)(v.co[axis] for v in bm.verts)
        faces=[f for f in bm.faces if all(abs(v.co[axis]-top)<1e-5 for v in f.verts)]
        if not faces: raise ValueError('Inset needs planar faces on selected axis')
        bmesh.ops.inset_region(bm,faces=faces,thickness=a['thickness'],depth=a['depth'],use_boundary=True);bm.to_mesh(o.data);bm.free()
    elif op=='export':
        geometry_budget();bake_surfaces()
        fmt=a['format'];p=output('model.'+fmt.lower())
        bpy.ops.object.select_all(action='DESELECT')
        for o in model_objects(): o.hide_set(False);o.select_set(True)
        if fmt in ('GLB','GLTF'): bpy.ops.export_scene.gltf(filepath=p,export_format='GLB' if fmt=='GLB' else 'GLTF_SEPARATE',export_cameras=False,export_lights=False,export_apply=True,use_renderable=True,use_selection=True)
        elif fmt in ('OBJ','STL'):
            bpy.ops.object.select_all(action='DESELECT')
            for o in model_objects(): o.hide_set(False);o.select_set(True)
            if fmt=='OBJ': bpy.ops.wm.obj_export(filepath=p,export_materials=True,export_selected_objects=True)
            else: bpy.ops.wm.stl_export(filepath=p,export_selected_objects=True)
        else: bpy.ops.export_scene.fbx(filepath=p,use_selection=True,object_types={'MESH'},bake_anim=False)
        exports.append({'format':fmt,'name':os.path.basename(p)})
    elif op not in ('get_scene','save_project'): raise ValueError('Unsupported operation')
bpy.context.view_layer.update()
objects=[]
total=0
for o in scene.objects:
    data={'name':o.name,'type':o.type,'visible':not o.hide_render,'location':list(o.location),'rotation':[math.degrees(v) for v in o.rotation_euler],'dimensions':list(o.dimensions),'materials':[m.name for m in getattr(o.data,'materials',[]) if m]}
    if o.get('jarvis_text'): data['text']=o['jarvis_text']
    if o.get('jarvis_applied_text'): data['appliedText']=json.loads(o['jarvis_applied_text'])
    data['parent']=o.parent.name if o.parent else None;data['collections']=[c.name for c in o.users_collection]
    data['worldLocation']=list(o.matrix_world.translation)
    data['role']=o.get('jarvis_role','MODEL')
    data['worldRotation']=[math.degrees(v) for v in o.matrix_world.to_euler()]
    data['modifiers']=[{'name':m.name,'type':m.type,**({'count':m.count} if m.type=='ARRAY' else {}),**({'levels':m.levels} if m.type=='SUBSURF' else {})} for m in o.modifiers]
    if o.type=='LIGHT': data['energy']=o.data.energy
    if o.type=='MESH':
        mesh=o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        total+=len(mesh.vertices)
        data['localDimensions']=[(max(v.co[i] for v in mesh.vertices)-min(v.co[i] for v in mesh.vertices))*abs(o.scale[i]) for i in range(3)] if mesh.vertices else [0,0,0]
        if total>500000: raise ValueError('Evaluated geometry exceeds the safe preview budget')
        bm=bmesh.new();bm.from_mesh(mesh);data['vertices']=len(mesh.vertices);data['faces']=len(mesh.polygons);data['manifold']=all(e.is_manifold for e in bm.edges);bm.free();o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
    objects.append(data)
bpy.ops.wm.save_as_mainfile(filepath=output('scene.blend'),check_existing=False)
materials=[]
for m in bpy.data.materials:
    shader=m.node_tree.nodes.get('Principled BSDF') if m.use_nodes else None
    materials.append({'name':m.name,'color':list(m.diffuse_color),'metallic':shader.inputs['Metallic'].default_value if shader else 0,'roughness':shader.inputs['Roughness'].default_value if shader else 0.5,'baked':bool(m.get('jarvis_baked'))})
corners=[o.matrix_world @ Vector(c) for o in model_objects() for c in o.bound_box]
bounds={'min':[min(v[i] for v in corners) for i in range(3)],'max':[max(v[i] for v in corners) for i in range(3)]} if corners else None
with open(output('result.json'),'w',encoding='utf-8') as f: json.dump({'objects':objects,'materials':materials,'bounds':bounds,'units':job['units'],'exports':exports,'totalVertices':total,'renderDevice':scene.cycles.device},f)
print('JARVIS_BLENDER_COMPLETE',flush=True)

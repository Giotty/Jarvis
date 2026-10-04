import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { unwrap } from './types';
function disposeScene(scene: THREE.Object3D) {
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
        m.dispose();
      }
    }
  });
}
export function ModelPreview({ assetId }: { assetId: string }) {
  const root = useRef<HTMLDivElement>(null),
    reset = useRef<() => void>(() => {}),
    [status, setStatus] = useState('LOADING REAL MODEL'),
    [ready, setReady] = useState(false);
  useEffect(() => {
    const container = root.current;
    if (!container || !window.jarvis) return;
    let alive = true,
      renderer: THREE.WebGLRenderer | undefined,
      controls: OrbitControls | undefined,
      model: THREE.Object3D | undefined,
      frame = 0,
      visible = true,
      last = 0,
      dirty = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#04121a');
    const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 10000);
    scene.add(new THREE.HemisphereLight(0xb9efff, 0x243041, 3));
    const key = new THREE.DirectionalLight(0xffffff, 4);
    key.position.set(4, 6, 5);
    scene.add(key);
    let fps = 30;
    const observer = new IntersectionObserver(
      (e) => {
        visible = e.some((i) => i.isIntersecting);
        dirty = true;
      },
      { threshold: 0.05 },
    );
    observer.observe(container);
    const resize = new ResizeObserver(() => {
      if (!renderer) return;
      const width = Math.max(1, container.clientWidth),
        height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // A hidden window may suspend animation callbacks. Keep a static frame
      // after resize instead of relying on the next foreground animation.
      renderer.render(scene, camera);
      dirty = false;
    });
    resize.observe(container);
    const tick = (time: number) => {
      if (!alive) return;
      frame = requestAnimationFrame(tick);
      if (!renderer || !visible || document.hidden) return;
      // Resize/reset clears the buffer. Repaint that change once even when
      // unfocused; continuous controls/damping still pause without focus.
      if (!document.hasFocus() && !dirty) return;
      const loaded = document.querySelector('.gpu-loaded, .ram-loaded, .gaming-active');
      const interval = 1000 / (loaded ? Math.min(fps, 10) : fps);
      if (time - last < interval) return;
      last = time;
      const changed = document.hasFocus() && controls?.update();
      if (dirty || changed) {
        renderer.render(scene, camera);
        dirty = false;
      }
    };
    void unwrap(window.jarvis.snapshot())
      .then((s) => {
        fps = Math.min(60, Math.max(1, s.config.preview3dFps));
      })
      .catch(() => {});
    void unwrap(window.jarvis.modelAsset(assetId))
      .then(async (asset) => {
        const bytes = Uint8Array.from(atob(asset.base64), (c) => c.charCodeAt(0));
        const loader = new GLTFLoader();
        const gltf = await loader.parseAsync(bytes.buffer, '');
        if (!alive) {
          disposeScene(gltf.scene);
          return;
        }
        model = gltf.scene;
        scene.add(model);
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: 'low-power',
          preserveDrawingBuffer: true,
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.setSize(
          Math.max(1, container.clientWidth),
          Math.max(1, container.clientHeight),
          false,
        );
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.appendChild(renderer.domElement);
        camera.aspect = Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight);
        camera.updateProjectionMatrix();
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.12;
        controls.screenSpacePanning = true;
        const box = new THREE.Box3().setFromObject(model),
          center = box.getCenter(new THREE.Vector3()),
          size = box.getSize(new THREE.Vector3()),
          radius = Math.max(size.length() / 2, 0.01);
        reset.current = () => {
          camera.position.copy(center).add(new THREE.Vector3(radius * 1.5, radius, radius * 2));
          camera.near = radius / 100;
          camera.far = radius * 100;
          camera.updateProjectionMatrix();
          controls!.target.copy(center);
          controls!.minDistance = radius * 0.1;
          controls!.maxDistance = radius * 20;
          controls!.update();
          dirty = true;
          renderer!.render(scene, camera);
          dirty = false;
        };
        reset.current();
        // Paint a first frame even while an unfocused card pauses its loop.
        renderer.render(scene, camera);
        dirty = false;
        controls.addEventListener('change', () => {
          dirty = true;
        });
        setReady(true);
        setStatus('DRAG TO ORBIT · SCROLL TO ZOOM');
        frame = requestAnimationFrame(tick);
      })
      .catch(() => {
        if (alive) setStatus('MODEL PREVIEW UNAVAILABLE');
      });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      controls?.dispose();
      if (model) disposeScene(model);
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
    };
  }, [assetId]);
  return (
    <div
      className="model-preview"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="model-canvas" ref={root} />
      <div className="model-toolbar">
        <small role="status">{status}</small>
        <button disabled={!ready} onClick={() => reset.current()}>
          RESET VIEW
        </button>
      </div>
    </div>
  );
}

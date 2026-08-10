"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export type PresenceSceneMode = "idle" | "live" | "muted" | "preparing";

interface PresenceSceneProps {
  mode: PresenceSceneMode;
}

const COLOR_BY_MODE: Record<PresenceSceneMode, { accent: number; fill: number }> = {
  idle: { accent: 0x78d9b0, fill: 0x163f32 },
  preparing: { accent: 0x8fe9c4, fill: 0x235c48 },
  live: { accent: 0x62dbdf, fill: 0x9b5de5 },
  muted: { accent: 0x728a81, fill: 0x252c29 },
};

export function PresenceScene({ mode }: PresenceSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof WebGLRenderingContext === "undefined") {
      if (host) host.dataset.renderer = "fallback";
      return;
    }
    const sceneHost = host;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040806);
    scene.fog = new THREE.Fog(0x040806, 8, 24);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
    camera.position.set(0, 1.1, 8.7);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      host.dataset.renderer = "fallback";
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.86;
    renderer.domElement.className = "presence-scene__canvas";
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.append(renderer.domElement);
    host.dataset.renderer = "webgl";

    const chamber = new THREE.Group();
    scene.add(chamber);

    const graphite = new THREE.MeshStandardMaterial({
      color: 0x111815,
      metalness: 0.72,
      roughness: 0.32,
    });
    const graphiteDark = new THREE.MeshStandardMaterial({
      color: 0x090e0c,
      metalness: 0.52,
      roughness: 0.6,
    });
    const seamMaterial = new THREE.MeshStandardMaterial({
      color: 0x0d2d23,
      emissive: 0x78d9b0,
      emissiveIntensity: 0.45,
      metalness: 0.25,
      roughness: 0.18,
    });
    const membraneMaterial = new THREE.MeshStandardMaterial({
      color: 0x183e33,
      metalness: 0.15,
      opacity: 0.2,
      roughness: 0.28,
      side: THREE.DoubleSide,
      transparent: true,
    });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 28), graphiteDark);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -1.7, -5);
    scene.add(floor);

    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(32, 18), graphiteDark);
    backWall.position.set(0, 2.4, -8.2);
    scene.add(backWall);

    const aperture = new THREE.Mesh(
      new THREE.TorusGeometry(2.35, 0.095, 14, 72),
      graphite,
    );
    aperture.position.set(3.05, 0.15, -2.5);
    aperture.rotation.z = -0.18;
    aperture.scale.set(1, 1.16, 1);
    chamber.add(aperture);

    const innerAperture = new THREE.Mesh(
      new THREE.TorusGeometry(1.83, 0.025, 10, 64),
      seamMaterial,
    );
    innerAperture.position.copy(aperture.position);
    innerAperture.position.z += 0.06;
    innerAperture.rotation.z = aperture.rotation.z;
    innerAperture.scale.copy(aperture.scale);
    chamber.add(innerAperture);

    const membraneGeometry = new THREE.PlaneGeometry(3.55, 4.35, 24, 28);
    const membranePositions = membraneGeometry.attributes.position;
    for (let index = 0; index < membranePositions.count; index += 1) {
      const x = membranePositions.getX(index);
      const y = membranePositions.getY(index);
      const edge = Math.max(Math.abs(x) / 1.78, Math.abs(y) / 2.18);
      const wave = Math.sin(x * 2.1 + y * 1.15) * 0.13 * Math.max(0, 1 - edge);
      membranePositions.setZ(index, wave);
    }
    membraneGeometry.computeVertexNormals();
    const membrane = new THREE.Mesh(membraneGeometry, membraneMaterial);
    membrane.position.set(3.05, 0.14, -2.7);
    membrane.rotation.z = -0.18;
    chamber.add(membrane);

    const finGeometry = new THREE.BoxGeometry(0.12, 5.8, 1.25);
    for (let index = 0; index < 11; index += 1) {
      const fin = new THREE.Mesh(finGeometry, index % 3 === 0 ? graphite : graphiteDark);
      const angle = -0.78 + index * 0.155;
      fin.position.set(3.1 + Math.sin(angle) * 3.42, 0.28, -3.85 + Math.cos(angle) * 0.72);
      fin.rotation.z = angle * 0.08;
      fin.rotation.y = -angle * 0.32;
      fin.scale.y = 0.76 + Math.cos(angle * 1.7) * 0.18;
      chamber.add(fin);
    }

    const seamCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(1.25, -1.15, -1.45),
      new THREE.Vector3(2.05, -0.58, -1.75),
      new THREE.Vector3(3.2, -0.9, -1.95),
      new THREE.Vector3(4.85, 0.42, -2.15),
      new THREE.Vector3(6.7, 1.55, -3.2),
    ]);
    const lightSeam = new THREE.Mesh(
      new THREE.TubeGeometry(seamCurve, 64, 0.018, 6, false),
      seamMaterial,
    );
    chamber.add(lightSeam);

    const ambient = new THREE.HemisphereLight(0xa7c7b9, 0x030504, 0.42);
    scene.add(ambient);

    const keyLight = new THREE.PointLight(0x78d9b0, 22, 11, 1.8);
    keyLight.position.set(3.15, 0.5, 1.6);
    scene.add(keyLight);

    const fillLight = new THREE.PointLight(0x163f32, 11, 14, 2);
    fillLight.position.set(5.7, 2.8, 0.5);
    scene.add(fillLight);

    const rimLight = new THREE.SpotLight(0xc8eee0, 38, 20, 0.42, 0.72, 1.5);
    rimLight.position.set(-3.6, 5.2, 5.8);
    rimLight.target.position.set(3, 0, -2.5);
    scene.add(rimLight, rimLight.target);

    const clock = new THREE.Clock();
    const pointer = new THREE.Vector2();
    let animationFrame = 0;
    let isVisible = !document.hidden;
    let lastRenderAt = 0;
    let renderedFrames = 0;

    function resize() {
      const { height, width } = sceneHost.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      const isCompact = width / height < 0.72;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = isCompact ? 9.6 : 8.7;
      cameraTarget.set(isCompact ? 0.8 : 0.4, 0.05, -2.5);
      chamber.position.x = isCompact ? 1 : 0;
      chamber.scale.setScalar(isCompact ? 0.74 : 1);
      camera.updateProjectionMatrix();
    }

    function updatePointer(event: PointerEvent) {
      if (reduceMotion.matches) return;
      pointer.set(event.clientX / window.innerWidth - 0.5, event.clientY / window.innerHeight - 0.5);
    }

    function updateVisibility() {
      isVisible = !document.hidden;
      if (isVisible) {
        clock.getDelta();
        animationFrame = window.requestAnimationFrame(render);
      } else {
        window.cancelAnimationFrame(animationFrame);
      }
    }

    const targetAccent = new THREE.Color();
    const targetFill = new THREE.Color();
    const cameraTarget = new THREE.Vector3(0.4, 0.05, -2.5);

    function probePixels() {
      const context = renderer.getContext();
      const pixel = new Uint8Array(4);
      const width = renderer.domElement.width;
      const height = renderer.domElement.height;
      let energy = 0;
      let signature = 17;

      for (let row = 1; row <= 3; row += 1) {
        for (let column = 1; column <= 4; column += 1) {
          context.readPixels(
            Math.floor((width * column) / 5),
            Math.floor((height * row) / 4),
            1,
            1,
            context.RGBA,
            context.UNSIGNED_BYTE,
            pixel,
          );
          energy += pixel[0] + pixel[1] + pixel[2];
          signature = (signature * 31 + pixel[0] * 3 + pixel[1] * 5 + pixel[2] * 7) >>> 0;
        }
      }

      sceneHost.dataset.pixelEnergy = String(energy);
      sceneHost.dataset.pixelSignature = String(signature);
    }

    function render(timestamp = 0) {
      if (!reduceMotion.matches && timestamp - lastRenderAt < 32) {
        animationFrame = window.requestAnimationFrame(render);
        return;
      }
      lastRenderAt = timestamp;
      const elapsed = clock.getElapsedTime();
      const activeMode = modeRef.current;
      const palette = COLOR_BY_MODE[activeMode];
      targetAccent.setHex(palette.accent);
      targetFill.setHex(palette.fill);

      keyLight.color.lerp(targetAccent, 0.025);
      fillLight.color.lerp(targetFill, 0.022);
      seamMaterial.emissive.lerp(targetAccent, 0.028);
      membraneMaterial.color.lerp(targetFill, 0.018);

      const energy = activeMode === "live" ? 1 : activeMode === "muted" ? 0.3 : 0.58;
      keyLight.intensity += (18 + energy * 15 - keyLight.intensity) * 0.022;
      fillLight.intensity += (7 + energy * 13 - fillLight.intensity) * 0.018;
      seamMaterial.emissiveIntensity += (0.18 + energy * 0.58 - seamMaterial.emissiveIntensity) * 0.02;

      if (!reduceMotion.matches) {
        membrane.rotation.z = -0.18 + Math.sin(elapsed * 0.24) * 0.018;
        membrane.scale.setScalar(1 + Math.sin(elapsed * 0.42) * 0.012 * energy);
        innerAperture.rotation.z = -0.18 + Math.sin(elapsed * 0.18) * 0.024;
        lightSeam.position.y = Math.sin(elapsed * 0.31) * 0.035;
        chamber.position.y = Math.sin(elapsed * 0.16) * 0.022;
        camera.position.x += (pointer.x * 0.16 - camera.position.x) * 0.018;
        camera.position.y += (1.1 - pointer.y * 0.1 - camera.position.y) * 0.018;
      }

      camera.lookAt(cameraTarget);
      renderer.render(scene, camera);
      renderedFrames += 1;
      if (renderedFrames === 1 || renderedFrames % 15 === 0) probePixels();
      sceneHost.dataset.frame = String(Math.floor(elapsed * 10));
      if (isVisible && !reduceMotion.matches) {
        animationFrame = window.requestAnimationFrame(render);
      }
    }

    const observer = new ResizeObserver(resize);
    observer.observe(sceneHost);
    window.addEventListener("pointermove", updatePointer, { passive: true });
    document.addEventListener("visibilitychange", updateVisibility);
    resize();
    render();

    return () => {
      isVisible = false;
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener("pointermove", updatePointer);
      document.removeEventListener("visibilitychange", updateVisibility);
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="presence-scene"
      data-renderer="pending"
      data-scene-mode={mode}
      ref={hostRef}
    />
  );
}

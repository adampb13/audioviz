// System 4: GÓRY — 3 warstwy ciemnych sylwetek na horyzoncie (ridged FBM),
// rozpuszczone w mgle. Mgła ciemniejsza niż horyzont nieba => efekt sylwetki.
import * as THREE from "three";
import { NOISE_GLSL, FOG_GLSL } from "./glsl.js";

const VERT = /* glsl */ `
uniform float uSeed;
uniform float uAmp;
varying float vH;
varying float vDist;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  vec3 p = position; // plane XY; x szerokość, y wysokość (0 dół .. 1 góra przed skalą)
  float mask = smoothstep(0.05, 0.95, uv.y); // dół zostaje płaski
  float ridge = ridged4(vec3(p.x * 0.012 + uSeed, uSeed * 3.1, p.y * 0.05));
  ridge += 0.35 * ridged4(vec3(p.x * 0.05 + uSeed * 7.0, uSeed, 0.0));
  p.y += ridge * uAmp * mask;
  vH = clamp(p.y / (uAmp * 1.6), 0.0, 1.0);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vDist = length(wp.xyz - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
varying float vH;
varying float vDist;
varying vec3 vWorld;
${FOG_GLSL}
void main() {
  // prawie czarna sylwetka, minimalnie jaśniejsza na szczytach — bez twardych cieni
  vec3 col = uColor * (0.8 + vH * 0.5);
  col = applyFog(col, vDist);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Mountains {
  constructor(fogColor, fogDensity) {
    this.group = new THREE.Group();
    const layers = [
      { z: -170, amp: 7, col: 0x150b05, seed: 1.7 },
      { z: -235, amp: 11, col: 0x120903, seed: 4.3 },
      { z: -310, amp: 16, col: 0x0e0703, seed: 8.9 },
    ];
    for (const { z, amp, col, seed } of layers) {
      const geo = new THREE.PlaneGeometry(700, 60, 220, 24);
      const uniforms = {
        uSeed: { value: seed },
        uAmp: { value: amp },
        uColor: { value: new THREE.Color(col) },
        uFogColor: { value: new THREE.Color(fogColor) },
        uFogDensity: { value: fogDensity },
      };
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, -2, z);
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }
}

// System 3: WSTĘGA WOKALU — jedwabna, świetlista wstęga sunąca przez środek kadru.
// Historia pitch/rms/probe (~6 s) ląduje w DataTexture 300x1 — shader buduje z niej
// pozycję Y (kontur melodii), szerokość i widoczność (voiced gate) każdego segmentu.
// 3 warstwy additive z offsetami => efekt jedwabiu z obrazu referencyjnego.
import * as THREE from "three";
import { NOISE_GLSL, PAL } from "./glsl.js";
import { sampleAt, clamp } from "./data.js";

const SEGS = 300;      // segmenty wzdłuż X
const ACROSS = 20;     // segmenty w poprzek
const TRAIL_S = 6.0;   // sekundy historii na całej długości
const LAYERS = 3;

const VERT = /* glsl */ `
uniform sampler2D uTrail;
uniform float uTime;
uniform float uLayer;
varying vec2 vUv;
varying float vVoiced;
varying float vRms;
varying float vCent;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  vUv = uv;
  vec4 tr = texture2D(uTrail, vec2(uv.x, 0.5));
  float midi = tr.x;
  float rms = tr.y;
  float prob = tr.z;
  float cent = tr.w;

  float voiced = smoothstep(0.04, 0.28, prob);
  float width = mix(0.06, 6.5, voiced * (0.15 + 0.85 * rms));

  // pionowa kurtyna twarzą do kamery: szerokość w osi Y, falowanie głębi w Z
  float x = position.x; // -60..60
  float yBase = 5.2 + (midi - 60.0) * 0.16;
  yBase += sin(x * 0.10 + uTime * 0.5 + uLayer * 2.1) * 0.45 * (0.3 + 0.7 * voiced);
  yBase += snoise(vec3(x * 0.05, uTime * 0.15, uLayer * 7.0)) * 0.55 * voiced;
  yBase += (uLayer - 1.0) * 0.22;

  float y = yBase + (uv.y - 0.5) * width;
  float z = snoise(vec3(x * 0.03, uTime * 0.12, uLayer * 3.0)) * 1.1 * (0.3 + 0.7 * voiced);
  z += (uLayer - 1.0) * 0.4;

  vVoiced = voiced;
  vRms = rms;
  vCent = cent;
  vec4 wp = modelMatrix * vec4(x, y, z, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uLayer;
uniform float uLayerAlpha;
uniform vec3 uGold, uCream;
varying vec2 vUv;
varying float vVoiced;
varying float vRms;
varying float vCent;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  // włókna jedwabiu: rozciągnięty wzdłuż X szum, dwie oktawy
  float f1 = snoise(vec3(vUv.x * 160.0 - uTime * 0.5 + uLayer * 3.7, vUv.y * 4.0, uLayer));
  float f2 = snoise(vec3(vUv.x * 420.0 - uTime * 0.9, vUv.y * 9.0 + uLayer * 13.0, 4.0));
  float fibers = 0.72 + 0.20 * f1 + 0.10 * f2;

  // miękki falloff na krawędziach góra/dół + wygaśnięcie na skrajnych końcach
  float edge = smoothstep(0.0, 0.32, vUv.y) * smoothstep(1.0, 0.68, vUv.y);
  edge *= smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x);

  // pseudo-fresnel z pochodnych — krawędzie świecą mocniej (poczucie objętości)
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(N, V)), 1.6);

  vec3 tint = mix(uGold, uCream, clamp(0.15 + vCent * 0.5 + vRms * 0.25, 0.0, 1.0));
  float glow = 0.10 + 0.55 * vRms * (0.30 + 0.70 * vVoiced);
  vec3 col = tint * glow * fibers;
  col += uCream * fres * 0.12 * (0.2 + 0.8 * vVoiced);
  // nić między frazami: cienka, ale obecna — oko widzi ciągłość wstęgi
  col += uGold * (1.0 - vVoiced) * 0.08;

  float alpha = edge * (0.09 + 0.91 * vVoiced) * uLayerAlpha;
  gl_FragColor = vec4(col, alpha);
}
`;

export class VocalRibbon {
  constructor() {
    const geo = new THREE.PlaneGeometry(120, 1, SEGS - 1, ACROSS - 1);

    this.trailData = new Float32Array(SEGS * 4);
    this.trailTex = new THREE.DataTexture(
      this.trailData, SEGS, 1, THREE.RGBAFormat, THREE.FloatType
    );
    this.trailTex.magFilter = THREE.LinearFilter;
    this.trailTex.minFilter = THREE.LinearFilter;
    this.trailTex.wrapS = THREE.ClampToEdgeWrapping;
    this.trailTex.needsUpdate = true;

    this.group = new THREE.Group();
    // przesunięcie w stronę kamery — powierzchnia wstęgi staje się czytelna,
    // a nie spłaszczona do kreski na skrajnym kącie wzroku
    this.group.position.set(0, 0, 8);
    this.layerMats = [];
    const alphaByLayer = [0.30, 0.55, 0.30];
    for (let l = 0; l < LAYERS; l++) {
      const uniforms = {
        uTrail: { value: this.trailTex },
        uTime: { value: 0 },
        uLayer: { value: l },
        uLayerAlpha: { value: alphaByLayer[l] },
        uGold: { value: new THREE.Color(PAL.gold) },
        uCream: { value: new THREE.Color(PAL.cream) },
      };
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        extensions: { derivatives: true },
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.rotation.x = -0.30; // lekkie pochylenie ku kamerze — czuć grubość jedwabiu
      mesh.renderOrder = 10 + l;
      this.group.add(mesh);
      this.layerMats.push({ mat, uniforms });
    }
  }

  // Próbkowanie historii prosto z analysis (linearna interpolacja klatek) —
  // głowa (prawa krawędź) = teraz, lewa = przeszłość.
  update(t, track) {
    const d = this.trailData;
    for (let i = 0; i < SEGS; i++) {
      const frac = i / (SEGS - 1);
      const ts = t - (1 - frac) * TRAIL_S;
      const o = i * 4;
      d[o] = sampleAt(track.vMidi, track.fps, Math.max(0, ts));
      d[o + 1] = sampleAt(track.vRms, track.fps, Math.max(0, ts));
      d[o + 2] = sampleAt(track.vProb, track.fps, Math.max(0, ts));
      d[o + 3] = clamp(sampleAt(track.vCent, track.fps, Math.max(0, ts)) / track.vCentP95, 0, 1);
    }
    this.trailTex.needsUpdate = true;
    for (const { uniforms } of this.layerMats) uniforms.uTime.value = t;
  }
}

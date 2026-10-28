// OKRĘGI NA PODŁODZE — sekcja rytmiczna (bębny).
// Płaska PlaneGeometry na y=0; okręgi rysuje fragment shader funkcjami dystansu (SDF).
// Każdy onset stopy/werbla = "kropla do wody": nowy pierścień promieniście rozchodzi
// się od środka. Jasność i grubość pierścienia <- peak/siła uderzenia.
// Płaszczyzna NIE porusza się w Y — dynamika wyłącznie w emisji światła.
import * as THREE from "three";

const MAXR = 16; // jednoczesnych pierścieni

const VERT = /* glsl */ `
  varying vec2 vXZ;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vXZ = wp.xz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const FRAG = /* glsl */ `
  #define MAXR ${MAXR}
  uniform float uTime;              // czas utworu
  uniform float uBirth[MAXR];       // czas narodzin pierścienia
  uniform float uAmp[MAXR];         // jasność (z peak)
  uniform float uWid[MAXR];         // grubość (z peak)
  uniform float uSpeed;             // prędkość rozchodzenia (j./s)
  uniform vec3  uColor;
  uniform float uCore;              // ambientowa poświata od rdzenia basu
  uniform float uCoreR;             // promień tej poświaty
  uniform float uFade;              // zanik z wiekiem
  varying vec2 vXZ;

  void main() {
    float r = length(vXZ);
    float glow = 0.0;
    for (int i = 0; i < MAXR; i++) {
      float age = uTime - uBirth[i];
      if (uAmp[i] <= 0.0 || age < 0.0) continue;
      float R = age * uSpeed;
      float band = (r - R) / uWid[i];
      glow += uAmp[i] * exp(-band * band) * exp(-age * uFade);
    }
    // miękka poświata bijąca od rdzenia (bas), bez geometrii
    glow += uCore * exp(-(r * r) / uCoreR);
    // wygaszenie płaszczyzny poza sceną
    float mask = 1.0 - smoothstep(15.0, 23.0, r);
    glow *= mask;
    vec3 col = uColor * glow;
    gl_FragColor = vec4(col, glow);
  }`;

export class DrumRings {
  constructor(scene) {
    this.meshU = {
      uTime: { value: 0 },
      uBirth: { value: new Float32Array(MAXR).fill(-1e3) },
      uAmp: { value: new Float32Array(MAXR) },
      uWid: { value: new Float32Array(MAXR).fill(0.4) },
      uSpeed: { value: 6.5 },
      uColor: { value: new THREE.Color(0xd98a3c) },
      uCore: { value: 0 },
      uCoreR: { value: 6.0 },
      uFade: { value: 0.85 },
    };
    const geo = new THREE.PlaneGeometry(48, 48);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.meshU,
      vertexShader: VERT,
      fragmentShader: FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.0;
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.slot = 0;
    this.spawned = 0; // licznik do HUD/probe
  }

  // pk 0..1 (peak znormalizowany), strength 0..1 (siła onsetu znormalizowana)
  spawn(t, pk, strength) {
    const i = this.slot;
    this.slot = (this.slot + 1) % MAXR;
    this.meshU.uBirth.value[i] = t;
    this.meshU.uAmp.value[i] = 0.16 + 0.75 * pk + 0.30 * strength;
    this.meshU.uWid.value[i] = 0.14 + 0.55 * pk;
    this.spawned++;
  }

  update(t, coreGlow) {
    this.meshU.uTime.value = t;
    this.meshU.uCore.value = coreGlow;
  }

  // wyczyść pierścienie (seek wstecz / restart)
  reset(t) {
    this.meshU.uBirth.value.fill(-1e3);
    this.meshU.uAmp.value.fill(0);
    this.meshU.uTime.value = t;
  }
}

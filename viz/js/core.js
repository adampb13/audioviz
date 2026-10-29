// System 2: SFERA-SERCE — żarząca się kula przy ziemi, źródło impulsów i światła.
// Skala od basu + beatPulse (wykładniczo gasnący), nasycenie/jasność od energii miksu,
// marszczenie powierzchni od wokalu (oddycha, nie szarpie).
import * as THREE from "three";
import { NOISE_GLSL, PAL } from "./glsl.js";

const VERT = /* glsl */ `
uniform float uTime;
uniform float uWobble;
varying vec3 vN;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  vec3 p = position;
  float n = snoise(normal * 2.5 + vec3(0.0, uTime * 0.6, 0.0));
  float n2 = snoise(normal * 6.0 - vec3(uTime * 0.35));
  p += normal * (n * 0.7 + n2 * 0.3) * uWobble;
  vN = normalize(normalMatrix * normal);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColDeep;   // głęboki bursztyn
uniform vec3 uColHot;    // biało-złoty
uniform float uEnergy;   // 0..~1.15
varying vec3 vN;
varying vec3 vWorld;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(N, V)), 2.0);
  vec3 base = mix(uColDeep, uColHot, clamp(uEnergy * 0.85, 0.0, 1.0));
  // rdzeń jaśniejszy w centrum tarczy, krawędzie żarzą się
  vec3 col = base * (0.45 + uEnergy * 0.75);
  col += uColHot * fres * (0.40 + uEnergy * 0.65);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class CoreSphere {
  constructor() {
    const geo = new THREE.SphereGeometry(2.0, 96, 96);
    this.uniforms = {
      uTime: { value: 0 },
      uWobble: { value: 0.04 },
      uEnergy: { value: 0.4 },
      uColDeep: { value: new THREE.Color(PAL.ember) },
      uColHot: { value: new THREE.Color(PAL.cream) },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(0, 1.2, 0); // lekko zagłębiona w ziemi

    // prawdziwe światło punktowe — na wypadek gdyby coś w scenie użyło materiału standardowego
    this.light = new THREE.PointLight(PAL.gold, 60, 90, 2);
    this.mesh.add(this.light);
    this.baseScale = 1;
  }

  // bassRms: tłumiony RMS basu; beatPulse: 1 przy beacie, gaśnie wykładniczo;
  // energy: energia miksu; vocalWobble: rms*voiced_prob wokalu; hot: 0..1 z centroidu
  update(t, bassRms, beatPulse, energy, vocalWobble, hot) {
    this.uniforms.uTime.value = t;
    this.uniforms.uWobble.value = 0.03 + vocalWobble * 0.15;
    this.uniforms.uEnergy.value = energy;
    const s = this.baseScale * (1.0 + bassRms * 0.25 + beatPulse * 0.28);
    this.mesh.scale.setScalar(s);
    this.light.intensity = 50 + energy * 200 + beatPulse * 120;
    // kolor od bursztynu do biało-złotego wg jasności tembru (centroid znormalizowany)
    this.uniforms.uColHot.value
      .set(PAL.goldBright)
      .lerp(new THREE.Color(PAL.cream), Math.min(1, 0.35 + hot * 0.65));
  }
}

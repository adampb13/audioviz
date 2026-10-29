// Post-processing: RenderPass -> UnrealBloom (HDR, ostrożnie) -> grade (CA/vignette/grain)
// -> OutputPass (ACES tone map + sRGB, dokładnie raz).
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uCA: { value: 0.0012 },      // aberracja chromatyczna na obrzeżach
    uVig: { value: 0.34 },       // siła winiety
    uGrain: { value: 0.028 },    // ziarno
    uLift: { value: 0.032 },     // podbicie cieni ku brązowej mgle (jak w referencji)
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uCA, uVig, uGrain, uLift;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 uv = vUv;
      vec2 off = uv - 0.5;
      float r2 = dot(off, off);

      // aberracja: radialne przesunięcie kanałów, rośnie ku krawędziom
      float ca = uCA * r2 * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off * ca).b;

      // ciepła korekta + mgła w cieniach (czernie idą ku brązowi, zero czystej czerni)
      col *= vec3(1.05, 0.99, 0.90);
      col += vec3(1.0, 0.62, 0.34) * uLift * (1.0 - smoothstep(0.0, 0.45, col.g + col.r));

      // winieta
      col *= 1.0 - uVig * smoothstep(0.15, 0.62, r2);

      // ziarno animowane
      float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime) * 43.0) - 0.5;
      col += g * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function createPost(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // bloom w liniowym HDR, przed tone mappingiem; progi chronią przed przepaleniem
  const size = renderer.getSize(new THREE.Vector2());
  const bloom = new UnrealBloomPass(size, 0.55, 0.75, 0.55);
  composer.addPass(bloom);

  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  composer.addPass(new OutputPass());
  return { composer, bloom, grade };
}

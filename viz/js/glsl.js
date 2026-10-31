// Wspólne kawałki GLSL: Ashima simplex noise 3D + FBM + mgła wykładnicza.
// Wszystkie custom shadery sceny składają się z tych bloków, żeby nie dublować kodu.

export const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 mm = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  mm = mm * mm;
  return 42.0 * dot(mm*mm, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// FBM 4 oktawy, wynik w przybliżeniu [-1, 1]
float fbm4(vec3 p){
  float f = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){
    f += a * snoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return f;
}

// Ridged FBM — ostre grzbiety dla gór
float ridged4(vec3 p){
  float f = 0.0, a = 0.55;
  for (int i = 0; i < 4; i++){
    f += a * (1.0 - abs(snoise(p)));
    p *= 2.1;
    a *= 0.52;
  }
  return f;
}
`;

// Ręczna mgła exp2 (custom ShaderMaterial nie dostaje scene.fog automatycznie).
// Kolor mgły celowo CIEMNIEJSZY niż horyzont nieba — dzięki temu dalekie góry
// zostają ciemnymi sylwetkami na tle świecącego pasma horyzontu.
export const FOG_GLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
vec3 applyFog(vec3 color, float dist){
  float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  return mix(color, uFogColor, clamp(f, 0.0, 1.0));
}
`;

// Paleta sceny mieszka w palette.js (PRESETY barwy: złoty / neonowy / deep blue /
// zielony). Trzymanie tu drugiej, zaszytej palety dawało dwie prawdy o kolorze —
// zmiana presetu przestawiała scenę, ale zostawiała stare wartości w konstruktorach.

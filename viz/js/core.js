// System 2: SFERA-SERCE — mały, ciepły żar wpół zagłębiony w ziemi (audit P0-1).
//
// Trzy niezależne wejścia, każde z innej ścieżki:
//   • „inne" -> NAŚWIETLENIE. Błysk na KAŻDYM onsiecie tej ścieżki (klawisze,
//     nagłe dźwięki); między nimi sfera jest przygaszonym bursztynowym żarem.
//     Nic innego nie rusza jasności (ani energia całości, ani bas, ani bębny).
//   • „bas"  -> STRUKTURA, ale WYŁĄCZNIE przy mocno obecnym basie. Poniżej
//     ~0.55 basu kula jest gładka; powyżej 0.90 marszczy się na maksa.
//   • KAŻDY bit „bas" -> kilka cząstek z powierzchni kuli.
//   • DROP (cisza -> głośna muzyka) -> FAJERWERK: salwa 60–90 większych
//     cząstek naraz, w kulistych wybuchach, z większą prędkością i dłuższym życiem.
//   • bębny -> puls rozmiaru (jak dotąd), wokal -> drobne drżenie powierzchni.
//
// Nigdy czysta biel: bursztyn -> krem; pełny exposure tylko na „inne".
import * as THREE from "three";
import { NOISE_GLSL, PAL } from "./glsl.js";

const VERT = /* glsl */ `
uniform float uTime;
uniform float uWobble;
uniform float uStruct;   // 0..1 — obecność basu: gęstszy, głębszy szum
varying vec3 vN;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  vec3 p = position;
  // struktura: przy basie szum gęstnieje i rośnie amplituda, więc kula
  // zmienia fakturę, a nie tylko pulsuje
  float nf = 2.5 + uStruct * 4.5;
  float n = snoise(normal * nf + vec3(0.0, uTime * 0.6, 0.0));
  float n2 = snoise(normal * 6.0 - vec3(uTime * 0.35));
  p += normal * (n * 0.7 + n2 * 0.3) * uWobble;
  // drugi, wolniejszy przebieg tylko od basu — czytelne "przestawienie" fałd
  p += normal * snoise(normal * (nf * 2.2) + vec3(uTime * 0.45)) * 0.22 * uStruct;
  vN = normalize(normalMatrix * normal);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uEnergy; // poziom żaru 0..1 — TYLKO z „inne" (błysk), nie z energii utworu
uniform float uGain;   // jasność — TYLKO z „inne"
uniform float uHot;    // 0..1 z centroidu „inne" — przesuwa bursztyn ku kremowi
varying vec3 vN;
varying vec3 vWorld;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 2.0);
  // nigdy czysta biel: bursztyn #7a3000 -> #ffcf8a (audit v2 P1)
  vec3 deep = vec3(0.40, 0.115, 0.0);
  // górny koniec zostaje POMARAŃCZOWY, nie kremowy: przy bloom+ACES krem
  // odbarwiał się do bieli i kolor przestawał być czytelny
  vec3 hot = mix(vec3(1.0, 0.60, 0.22), vec3(1.0, 0.74, 0.42), uHot * 0.45);
  vec3 base = mix(deep, hot, clamp(uEnergy, 0.0, 1.0));
  vec3 col = base * (0.7 + fres * 0.8) * uGain;
  // miękki sufit: po stacku z halo+bloom nigdy nie dobija do czystej bieli
  col = 1.05 * tanh(col / 1.05);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------- cząstki wypuszczane na mocne uderzenie basu ----------
const P_VERT = /* glsl */ `
attribute float aAlpha;
attribute float aSize;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * 760.0 / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}
`;

const P_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float core = smoothstep(0.5, 0.0, r);
  gl_FragColor = vec4(uColor * (0.35 + core * 0.85), vAlpha * core * core);
}
`;

// miękkie halo wokół żaru (zamiast twardego dysku) — radial gradient z canvas
function haloTexture() {
  const S = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d");
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0, "rgba(255,207,138,0.22)"); // niski center-alpha: nie clipować
  g.addColorStop(0.35, "rgba(217,152,74,0.15)");
  g.addColorStop(1.0, "rgba(217,152,74,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const R_BASE = 0.9;     // promień siatki sfery (bez zmian)
const P_MAX = 460;      // pula cząstek — jedno Points, jedno draw call (fajerwerki!)

export class CoreSphere {
  constructor() {
    this.group = new THREE.Group();

    const geo = new THREE.SphereGeometry(R_BASE, 96, 96);
    this.uniforms = {
      uTime: { value: 0 },
      uWobble: { value: 0.03 },
      uStruct: { value: 0 },
      uEnergy: { value: 0.35 },
      uGain: { value: 0.55 },
      uHot: { value: 0.5 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(0, 0.3, 0); // wkopana w ziemię — jak żar (audit v2 P1)
    this.group.add(this.mesh);

    // miękkie halo zamiast przepalonego dysku
    this.haloMat = new THREE.SpriteMaterial({
      map: haloTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.35,
    });
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.scale.setScalar(2.6);
    this.halo.renderOrder = 5;
    this.mesh.add(this.halo);

    // ziemia ma odbijać to światło, nie płonąć
    this.light = new THREE.PointLight(PAL.gold, 8, 60, 2);
    this.mesh.add(this.light);

    // --- cząstki (jedna pula, jedno Points) ---
    this.pPos = new Float32Array(P_MAX * 3);
    this.pVel = new Float32Array(P_MAX * 3);
    this.pAge = new Float32Array(P_MAX).fill(1e3); // wiek >= życie = martwa
    this.pLife = new Float32Array(P_MAX).fill(1);
    this.pAlpha = new Float32Array(P_MAX);
    this.pSize = new Float32Array(P_MAX);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3));
    pg.setAttribute("aAlpha", new THREE.BufferAttribute(this.pAlpha, 1));
    pg.setAttribute("aSize", new THREE.BufferAttribute(this.pSize, 1));
    // własna kula ograniczająca: pozycje startują w zerze, zanim cokolwiek
    // zostanie wypuszczone — bez tego Three policzyłoby bbox z samych zer
    pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.3, 0), 10);
    this.pGeo = pg;
    this.pMat = new THREE.ShaderMaterial({
      vertexShader: P_VERT,
      fragmentShader: P_FRAG,
      uniforms: { uColor: { value: new THREE.Color(PAL.goldBright) } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(pg, this.pMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.group.add(this.points);
    this.pNext = 0;
    this.pDirty = false;

    // obwiednie (czysto JS)
    this.flash = 0;   // błysk od pojedynczego uderzenia „inne"
    this.glow = 0;    // WYGŁADZONY żar: głośność „inne" + błysk (0..1)
    this.bass = 0;    // obecność basu (struktura)
  }

  // KAŻDY onset w „inne" — jedyne źródło jasności sfery. Niski próg, bo ciche
  // klawisze też mają zaznaczyć się błyskiem; akcenty dostają pełną moc.
  otherHit(strength) {
    const s = Math.min(1, Math.max(0, strength));
    this.flash = Math.max(this.flash, 0.20 + 0.80 * s);
  }

  // mocne uderzenie w „bas" — cząstki z powierzchni kuli
  bassHit(strength) {
    const s = Math.min(1, Math.max(0.2, strength));
    const R = R_BASE * this.mesh.scale.x * 0.94; // z aktualnej powierzchni
    const cy = this.mesh.position.y;
    const n = Math.round(6 + 7 * s);
    for (let k = 0; k < n; k++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % P_MAX;
      // punkt na sferze, równomiernie (bez kumulacji na biegunach)
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.max(0, 1 - u * u));
      const nx = rr * Math.cos(phi);
      const ny = u;
      const nz = rr * Math.sin(phi);
      this.pPos[i * 3] = nx * R;
      this.pPos[i * 3 + 1] = cy + ny * R;
      this.pPos[i * 3 + 2] = nz * R;
      // wzdłuż normalnej, lekki rozrzut, odrobina w górę
      const sp = (0.9 + Math.random() * 1.7) * (0.6 + 0.7 * s);
      this.pVel[i * 3] = nx * sp + (Math.random() - 0.5) * 0.4;
      this.pVel[i * 3 + 1] = ny * sp + 0.45 + Math.random() * 0.4;
      this.pVel[i * 3 + 2] = nz * sp + (Math.random() - 0.5) * 0.4;
      this.pAge[i] = 0;
      this.pLife[i] = 0.8 + Math.random() * 0.7;
      this.pSize[i] = 0.42 + Math.random() * 0.42; // 0.42–0.84 — widoczne z 22 m
    }
    this.pDirty = true;
  }

  // DROP: fajerwerk. Nagła zmiana cisza -> głośna muzyka. Kilka kulistych
  // wybuchów naraz: każdy to stożek cząstek wypuszczonych promieniowo z punktu
  // na powierzchni, z prędkością i życiem większym niż zwykłe uderzenie basu.
  // intensity 0..1 (skok energii) steruje liczbą, rozmiarem i prędkością.
  dropBurst(intensity) {
    const q = Math.min(1, Math.max(0, intensity));
    const R = R_BASE * this.mesh.scale.x * 0.94;
    const cy = this.mesh.position.y;
    const shells = 3 + Math.round(q * 2);              // 3–5 ognisk
    const per = Math.round((60 + 30 * q) / shells);    // razem ~60–90 cząstek
    const sizeMul = 1.3 + q * 0.3;                     // 1.3–1.6x większe niż zwykłe
    for (let sh = 0; sh < shells; sh++) {
      // ognisko wybuchu: punkt na sferze (równomiernie, bez biegunów)
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.max(0, 1 - u * u));
      const cx = rr * Math.cos(phi), cyy = u, cz = rr * Math.sin(phi);
      // baza ortonormalna wokół normalnej ogniska -> stożek wokół promienia
      const tx = Math.abs(cyy) < 0.9 ? 0 : 1, ty = Math.abs(cyy) < 0.9 ? 1 : 0;
      let ax = ty * cz - 0 * cyy, ay = 0 * cx - tx * cz, az = tx * cyy - ty * cx;
      let al = Math.hypot(ax, ay, az) || 1;
      ax /= al; ay /= al; az /= al;
      const bx = cyy * az - cz * ay, by = cz * ax - cx * az, bz = cx * ay - cyy * ax;
      const cone = 0.50 + q * 0.30;                    // rozpiętość stożka (rad)
      for (let k = 0; k < per; k++) {
        const i = this.pNext;
        this.pNext = (this.pNext + 1) % P_MAX;
        const th = Math.random() * Math.PI * 2;
        const rr2 = Math.sqrt(Math.random()) * cone;
        const dx = cx + (ax * Math.cos(th) + bx * Math.sin(th)) * rr2;
        const dy = cyy + (ay * Math.cos(th) + by * Math.sin(th)) * rr2;
        const dz = cz + (az * Math.cos(th) + bz * Math.sin(th)) * rr2;
        const dl = Math.hypot(dx, dy, dz) || 1;
        const nx = dx / dl, ny = dy / dl, nz = dz / dl;
        this.pPos[i * 3] = nx * R;
        this.pPos[i * 3 + 1] = cy + ny * R;
        this.pPos[i * 3 + 2] = nz * R;
        // prędkość: promieniowo, mocniej niż zwykły hit, z rozrzutem i wzniesieniem
        const sp = (4.0 + Math.random() * 2.8) * (0.85 + 0.45 * q);
        this.pVel[i * 3] = nx * sp + (Math.random() - 0.5) * 1.1;
        this.pVel[i * 3 + 1] = ny * sp + 0.9 + Math.random() * 0.9;
        this.pVel[i * 3 + 2] = nz * sp + (Math.random() - 0.5) * 1.1;
        this.pAge[i] = 0;
        this.pLife[i] = 1.2 + Math.random() * 0.9;      // 1.2–2.1 s — dłużej niż zwykłe
        this.pSize[i] = (0.45 + Math.random() * 0.55) * sizeMul;
      }
    }
    this.pDirty = true;
  }

  // energySmooth: wolna energia całości — steruje TYLKO rozmiarem kuli;
  // beatPulse: puls rozmiaru od bębnów; bassEnv: obecność basu (struktura);
  // otherLoud: głośność „inne" (kolor i jasność); otherCent: barwa „inne"
  update(t, dt, energySmooth, beatPulse, bassEnv, otherLoud, otherCent) {
    // STRUKTURA — tylko bas. Szybki atak, szybsze puszczenie: zmiany mają być
    // wyraźne w rytm basu, ale wciąż bez skoków.
    const kb = bassEnv > this.bass ? 9.0 : 2.4;
    this.bass += (bassEnv - this.bass) * (1 - Math.exp(-dt * kb));
    this.flash *= Math.exp(-dt * 7.0); // krótki błysk: każdy klawisz osobno
    // JASNOŚĆ/KOLOR — wyłącznie „inne". Głośność ciągła + akcent onsetu,
    // wygładzone obwiednią, żeby kolor płynął, a nie przeskakiwał.
    const target = Math.min(1, otherLoud * 0.95 + this.flash * 0.55);
    const kg = target > this.glow ? 7.0 : 3.0;
    this.glow += (target - this.glow) * (1 - Math.exp(-dt * kg));

    this.uniforms.uTime.value = t;
    // struktura TYLKO przy MOCNO obecnym basie: poniżej 0.55 kula jest
    // gładka, powyżej 0.90 marszczy się na maksa (smoothstep = bez skoku)
    const st0 = 0.55, st1 = 0.90;
    const q = Math.min(1, Math.max(0, (this.bass - st0) / (st1 - st0)));
    const bassG = q * q * (3 - 2 * q);
    this.uniforms.uStruct.value = bassG;
    this.uniforms.uHot.value = otherCent;
    // szeroki zakres: cisza w „inne" = ciemny bursztyn, głośno = krem
    // szeroki, ale NIGDY przepalony zakres: ciemny bursztyn -> jasny krem
    this.uniforms.uEnergy.value = 0.05 + this.glow * 0.80;
    this.uniforms.uGain.value = 0.30 + this.glow * 0.60;
    // drżenie powierzchni WYŁĄCZNIE od basu (wokal już jej nie rusza)
    this.uniforms.uWobble.value = 0.015 + bassG * 0.28; // do ~0.30 — wyraźne fałdy

    this.mesh.scale.setScalar(1.0 + beatPulse * 0.12 + energySmooth * 0.25);
    // światło rzucane na ziemię: słabe i krótkie — kula ma świecić sobą,
    // nie zalewać sceny (audit: "nie oświetlać jakoś bardzo sceny do góry")
    this.light.intensity = 1.2 + this.glow * 2.8;
    this.light.distance = 15;
    this.haloMat.opacity = 0.06 + this.glow * 0.07;

    // --- cząstki ---
    const pos = this.pPos;
    const vel = this.pVel;
    let alive = false;
    for (let i = 0; i < P_MAX; i++) {
      if (this.pAge[i] >= this.pLife[i]) { this.pAlpha[i] = 0; continue; }
      alive = true;
      this.pAge[i] += dt;
      const drag = 1 - Math.min(0.9, 1.6 * dt);
      vel[i * 3] *= drag;
      vel[i * 3 + 1] = vel[i * 3 + 1] * drag - 2.2 * dt; // lekka grawitacja
      vel[i * 3 + 2] *= drag;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const k2 = 1 - this.pAge[i] / this.pLife[i];
      this.pAlpha[i] = k2 * k2 * 1.2;
    }
    if (alive || this.pDirty) {
      this.pGeo.attributes.position.needsUpdate = true;
      this.pGeo.attributes.aAlpha.needsUpdate = true;
      this.pGeo.attributes.aSize.needsUpdate = true;
      this.pDirty = alive;
    }
  }
}

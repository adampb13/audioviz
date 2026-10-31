// Panel „ustawienia" — dyskretny przycisk w lewym dolnym rogu, po kliknięciu
// rozwija: ścieżki (co widać w scenie), głośność ogólną i preset barwy.
//
// Wyciszenie ścieżki robi DWIE rzeczy: `muted` na elemencie audio (słychać, co
// wypada) i zeruje gain sygnału w main.js (widać, co znika z animacji), więc
// każdą interakcję „ścieżka → obiekt" można testować osobno.
//
// Głośność ogólna to WYŁĄCZNIE poziom dźwięku (el.volume). Nie skaluje sceny:
// animacja czyta dane z analysis.json, a nie sygnał z głośnika, więc ściszenie
// muzyki nie może „zgasić" wizualizacji — inaczej panel przestawałby być
// narzędziem do oglądania utworu przy cichym odsłuchu.
import { PRESETS, PRESET_ORDER, DEFAULT_PRESET } from "./palette.js";

export const STEMS = [
  { id: "wokal", label: "wokal", hint: "wstęga" },
  { id: "bas", label: "bas", hint: "struktura kuli" },
  { id: "bebny", label: "fale", hint: "fale · puls kuli" },
  { id: "inne", label: "inne", hint: "iskry" },
];

const GEAR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/>' +
  '<path d="M12 2.8v2.1M12 19.1v2.1M4.4 12H2.3M21.7 12h-2.1M6.7 6.7 5.2 5.2' +
  'M18.8 18.8l-1.5-1.5M17.3 6.7l1.5-1.5M5.2 18.8l1.5-1.5"/></svg>';

export function createSettings({
  onToggle = () => {},
  onRestart = () => {},
  onVolume = () => {},
  onPreset = () => {},
  preset = DEFAULT_PRESET,
} = {}) {
  const gain = Object.fromEntries(STEMS.map((s) => [s.id, 1]));
  let volume = 1;
  let current = preset in PRESETS ? preset : DEFAULT_PRESET;

  const btn = document.createElement("button");
  btn.id = "gear";
  btn.type = "button";
  btn.title = "ustawienia (klawisz S)";
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = GEAR;

  const panel = document.createElement("div");
  panel.id = "panel";
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", "ustawienia");
  panel.innerHTML =
    '<div class="t">ustawienia</div>' +
    STEMS.map(
      (s) =>
        `<div class="stem" data-stem="${s.id}" role="switch" aria-checked="true" tabindex="0">` +
        `<span class="dot"></span><span class="n">${s.label}</span>` +
        `<span class="h">${s.hint}</span></div>`
    ).join("") +
    // głośność ogólna — suwak, nie przycisk: poziom ma być widoczny, nie cykliczny
    '<div class="rng">' +
    '<div class="rl"><span>głośność</span><span class="rv" id="vol-v">100%</span></div>' +
    '<input id="vol" type="range" min="0" max="100" step="1" value="100" ' +
    'aria-label="głośność ogólna" /></div>' +
    // preset barwy — w miejscu dawnych „cisza + brak animacji" / „wszystko"
    '<div class="phead"><span>preset barwy</span>' +
    `<span class="pv" id="preset-v">${PRESETS[current].label}</span></div>` +
    '<div class="presets" role="radiogroup" aria-label="preset barwy">' +
    PRESET_ORDER.map((k) => {
      const p = PRESETS[k];
      return (
        `<button type="button" class="sw" data-preset="${k}" role="radio" ` +
        `aria-checked="${k === current}" title="${p.label}">` +
        `<span class="chip" style="--a:${p.css.acc};--b:${p.css.acc2}"></span>` +
        `<span class="sl">${p.label}</span></button>`
      );
    }).join("") +
    "</div>" +
    '<div class="foot"><span>odtwarzanie</span>' +
    '<button type="button" id="panel-restart" title="zagraj utwór od początku">od początku</button></div>';

  document.body.append(btn, panel);

  const rows = Array.from(panel.querySelectorAll(".stem"));
  const open = (v) => {
    panel.classList.toggle("open", v);
    btn.classList.toggle("open", v);
    btn.setAttribute("aria-expanded", String(v));
    // panel H (parametry) odsuwa się w prawo, żeby nie wchodzić pod listę
    document.body.classList.toggle("panel-open", v);
  };
  let isOpen = false;
  const togglePanel = (v = !isOpen) => { isOpen = v; open(v); };

  function setStem(id, on) {
    gain[id] = on ? 1 : 0;
    const row = rows.find((r) => r.dataset.stem === id);
    if (row) {
      row.classList.toggle("off", !on);
      row.setAttribute("aria-checked", String(on));
    }
    onToggle(id, on);
  }

  for (const row of rows) {
    const id = row.dataset.stem;
    const flip = () => setStem(id, !gain[id]);
    row.addEventListener("click", flip);
    row.addEventListener("keydown", (e) => {
      if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); flip(); }
    });
  }

  // ---- głośność ogólna ----
  const vol = panel.querySelector("#vol");
  const volV = panel.querySelector("#vol-v");
  const setVolume = (v) => {
    volume = Math.min(1, Math.max(0, v));
    const pct = Math.round(volume * 100);
    vol.value = String(pct);
    volV.textContent = pct + "%";
    // wypełnienie suwaka liczone ze zmiennej --acc, więc idzie za presetem
    vol.style.setProperty("--fill", pct + "%");
    vol.setAttribute("aria-valuetext", pct + " procent");
    onVolume(volume);
  };
  vol.addEventListener("input", () => setVolume(Number(vol.value) / 100));

  // ---- preset ----
  const sws = Array.from(panel.querySelectorAll(".sw"));
  const presetV = panel.querySelector("#preset-v");
  function setPreset(key) {
    if (!(key in PRESETS)) return;
    current = key;
    for (const s of sws) s.setAttribute("aria-checked", String(s.dataset.preset === key));
    presetV.textContent = PRESETS[key].label;
    onPreset(key);
  }
  for (const s of sws) s.addEventListener("click", () => setPreset(s.dataset.preset));

  btn.addEventListener("click", () => togglePanel());
  panel.querySelector("#panel-restart").addEventListener("click", () => {
    onRestart();
    togglePanel(false);
  });
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "KeyS") togglePanel();
    else if (e.code === "Escape" && isOpen) togglePanel(false);
  });
  // klik poza panelem zamyka (ale nie chowa przycisku)
  window.addEventListener("pointerdown", (e) => {
    if (!isOpen) return;
    if (!panel.contains(e.target) && !btn.contains(e.target)) togglePanel(false);
  });

  setVolume(1); // stan startowy także na suwaku (100%)

  return {
    gain, panel, btn, setStem, toggle: togglePanel, setVolume, setPreset,
    get volume() { return volume; },
    get preset() { return current; },
  };
}

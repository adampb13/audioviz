// Panel „ścieżki" — dyskretny przycisk w lewym dolnym rogu, po kliknięciu rozwija
// listę stemów. Wyciszenie ścieżki robi DWIE rzeczy: `muted` na elemencie audio
// (słychać, co wypada) i zeruje gain sygnału w main.js (widać, co znika z animacji),
// więc każdą interakcję „ścieżka → obiekt" można testować osobno.
//
// Wejście: onToggle(id, on) — main.js wycisza tam audio; onRestart() — odtwarza
// utwór od 0 s (zegar, kursory zdarzeń, fale, cząstki). Wyjście: { gain, ... }
// gdzie gain[id] ∈ {0,1} czyta pętla klatek.

export const STEMS = [
  { id: "wokal", label: "wokal", hint: "wstęga" },
  { id: "bas", label: "bas", hint: "struktura" },
  { id: "bebny", label: "bebny", hint: "fale · puls" },
  { id: "inne", label: "inne", hint: "piki · cząstki" },
];

const GEAR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/>' +
  '<path d="M12 2.8v2.1M12 19.1v2.1M4.4 12H2.3M21.7 12h-2.1M6.7 6.7 5.2 5.2' +
  'M18.8 18.8l-1.5-1.5M17.3 6.7l1.5-1.5M5.2 18.8l1.5-1.5"/></svg>';

export function createSettings(onToggle = () => {}, onRestart = () => {}) {
  const gain = Object.fromEntries(STEMS.map((s) => [s.id, 1]));

  const btn = document.createElement("button");
  btn.id = "gear";
  btn.type = "button";
  btn.title = "ścieżki (klawisz S)";
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = GEAR;

  const panel = document.createElement("div");
  panel.id = "panel";
  panel.setAttribute("role", "group");
  panel.innerHTML =
    '<div class="t">ścieżki</div>' +
    STEMS.map(
      (s) =>
        `<div class="stem" data-stem="${s.id}" role="switch" aria-checked="true" tabindex="0">` +
        `<span class="dot"></span><span class="n">${s.label}</span>` +
        `<span class="h">${s.hint}</span></div>`
    ).join("") +
    '<div class="foot"><span>cisza + brak animacji</span>' +
    '<button type="button" id="panel-all">wszystko</button></div>' +
    '<div class="foot"><span>odtwarzanie</span>' +
    '<button type="button" id="panel-restart" title="zagraj utwór od początku">od początku</button></div>';

  document.body.append(btn, panel);

  const rows = Array.from(panel.querySelectorAll(".stem"));
  const open = (v) => {
    panel.classList.toggle("open", v);
    btn.classList.toggle("open", v);
    btn.setAttribute("aria-expanded", String(v));
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

  btn.addEventListener("click", () => togglePanel());
  panel.querySelector("#panel-all").addEventListener("click", () => {
    for (const s of STEMS) setStem(s.id, true);
  });
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

  return { gain, panel, btn, setStem, toggle: togglePanel };
}

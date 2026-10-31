// Tytuły utworów w jednym miejscu.
//
// `?track=` i katalogi w data/ to SLUGI („blindinglights”), a na ekranie ma być
// tytuł („Blinding Lights”). Biblioteka i wizualizacja muszą pokazywać to samo,
// więc mapa siedzi tutaj, a nie w dwóch plikach. Nowy utwór bez wpisu nie
// wywala się — leci wersja ze slugu z wielkich liter.

export const TRACK_TITLES = {
  blindinglights: "Blinding Lights",
  familyties: "Family Ties",
};

export function titleFor(slug) {
  if (!slug) return "";
  if (TRACK_TITLES[slug]) return TRACK_TITLES[slug];
  return slug
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

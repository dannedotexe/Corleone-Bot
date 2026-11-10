// Darstellung vor dem ersten Zeichnen setzen (kein Aufblitzen): Design (corleone/ios/klassisch) und Modus (auto/hell/dunkel).
// „ios“ (Standard) ist style.css allein; „corleone“ ist style.css plus die Ebene corleone.css.
// Wird synchron im <head> geladen; Inline-Skripte sind durch die Content-Security-Policy gesperrt.
(() => {
  // Früher gespeicherte Werte (alte Schlüssel/Namen) werden weiter erkannt.
  const read = key => { try { return localStorage.getItem(`corleone-${key}`); } catch { return null; } };
  // Ohne Auswahl gilt der iOS-Stil (Wunsch der Leitung); „corleone“ und „classic“ nur, wenn auf dem Gerät gewählt.
  const designOf = value => (value === "classic" ? "classic" : value === "corleone" ? "corleone" : "ios");
  const root = document.documentElement, media = window.matchMedia?.("(prefers-color-scheme: light)");
  const apply = () => {
    const design = designOf(read("design"));
    const mode = read("mode") || "dark"; // Standard: Dunkel (Wunsch der Leitung); „Automatisch“ und „Hell“ wählbar
    // Das klassische Design kennt nur Dunkel.
    const light = design !== "classic" && (mode === "light" || (mode === "auto" && media?.matches));
    root.dataset.design = design; root.dataset.theme = light ? "light" : "dark"; root.dataset.mode = mode;
    const link = document.getElementById("theme-css");
    const href = design === "classic" ? "/assets/classic.css" : "/assets/style.css";
    if (link && link.getAttribute("href") !== href) link.setAttribute("href", href);
    const layer = document.getElementById("design-css");
    if (layer) { if (design === "corleone") { if (layer.getAttribute("href") !== "/assets/corleone.css") layer.setAttribute("href", "/assets/corleone.css"); layer.disabled = false; } else layer.disabled = true; }
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", design === "corleone" ? (light ? "#f4f0ea" : "#0b0a0a") : light ? "#f2f2f7" : "#000000");
  };
  window.corleoneAppearance = {
    get: () => ({ design: designOf(read("design")), mode: read("mode") || "dark" }),
    set: ({ design, mode }) => { try { localStorage.setItem("corleone-design", design); localStorage.setItem("corleone-mode", mode); } catch {} apply(); },
  };
  media?.addEventListener?.("change", apply);
  apply();
})();

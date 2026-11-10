// Bot-Vorschläge: Liste, Status setzen, als Text kopieren. Nutzt Hilfsfunktionen aus app.js.
const sugState = { items: [] };
const sugStatus = { open: ["🕓 Offen", "status-open"], accepted: ["✅ Angenommen", "status-accepted"], done: ["🛠️ Umgesetzt", "status-ended"], rejected: ["❌ Abgelehnt", "status-rejected"] };
const sugVisible = () => $("sug-filter").value === "all" ? sugState.items : sugState.items.filter(s => s.status === "open" || s.status === "accepted");

async function loadBotSuggestions() {
  sugState.items = (await api("/api/suggestions")).items;
  $("sug-list").innerHTML = sugVisible().map(s => {
    const [label, cls] = sugStatus[s.status] ?? [s.status, ""];
    const buttons = [s.status !== "accepted" ? btn("✅ Annehmen", "sug-set", { id: s.id, status: "accepted" }) : "", s.status !== "done" ? btn("🛠️ Umgesetzt", "sug-set", { id: s.id, status: "done" }, "approve") : "", s.status !== "rejected" ? btn("❌ Ablehnen", "sug-set", { id: s.id, status: "rejected" }, "reject") : "", s.status !== "open" ? btn("Wieder offen", "sug-set", { id: s.id, status: "open" }) : "", btn("Löschen", "sug-delete", { id: s.id, number: s.number }, "reject")].join("");
    return `<article class="manage-card compact"><div class="manage-card-head"><div><span class="type-pill">#${escapeHtml(s.number ?? "?")}</span><h3>${escapeHtml(s.title)}</h3></div><span class="badge ${cls}">${label}</span></div>
      <p class="manage-meta">${plink(s.user_id)} · ${date(s.created_at)} · 🟢 ${s.up} · 🔴 ${s.down}</p>
      ${s.text && !s.text.startsWith(s.title) ? `<p class="desc">${escapeHtml(s.text)}</p>` : s.text && s.text !== s.title ? `<p class="desc">${escapeHtml(s.text.slice(s.title.length).trim())}</p>` : ""}
      ${s.decided_by ? `<p class="subtle">${escapeHtml(label)} von ${who(s.decided_by)}${s.note ? `: „${escapeHtml(s.note)}“` : ""}</p>` : ""}
      <div class="actions">${buttons}</div></article>`;
  }).join("") || empty("Keine Vorschläge in dieser Ansicht.");
}

/** Alle offenen und angenommenen Vorschläge als Text, beliebteste zuerst. */
function sugCopyText() {
  const list = sugState.items.filter(s => s.status === "open" || s.status === "accepted").sort((a, b) => (b.up - b.down) - (a.up - a.down) || b.number - a.number);
  if (!list.length) return "";
  const day = new Intl.DateTimeFormat("de-AT", { dateStyle: "medium", timeZone: state.timezone }).format(new Date());
  return [`Bot-Vorschläge von Corleone (offen & angenommen), Stand ${day}:`, "",
    ...list.map(s => `#${s.number} [${sugStatus[s.status][0].replace(/^\S+\s/, "")}] ${s.title} (🟢 ${s.up} / 🔴 ${s.down}, von ${state.names[s.user_id] ?? "Mitglied"})${s.text && !s.text.startsWith(s.title) ? `\n   ${s.text.replace(/\n/g, "\n   ")}` : s.text && s.text !== s.title ? `\n   …${s.text.slice(s.title.length).trim().replace(/\n/g, "\n   ")}` : ""}${s.note ? `\n   Team: ${s.note}` : ""}`)].join("\n");
}

$("sug-filter").addEventListener("change", () => loadBotSuggestions().catch(error => notify(error.message, "error")));
loaders.suggestions = loadBotSuggestions;
Object.assign(actions, {
  "sug-copy": async () => {
    const text = sugCopyText();
    if (!text) return notify("Gerade gibt es keine offenen oder angenommenen Vorschläge.", "error");
    try { await navigator.clipboard.writeText(text); notify("Kopiert."); }
    catch { openInfo("Kopieren", `<p class="subtle">Kopieren ging nicht automatisch – Text markieren und kopieren:</p><textarea class="sug-copy" rows="14" readonly>${escapeHtml(text)}</textarea>`, "VORSCHLÄGE", true); }
  },
  "sug-delete": ({ id, number }) => confirmAction(`Vorschlag #${number} löschen?`, "Die Karte und der Diskussions-Thread in Discord werden gelöscht, die Stimmen auch. Das lässt sich nicht rückgängig machen.", "Löschen", () => post(`/api/suggestions/${id}/delete`)),
  "sug-set": ({ id, status }) => openForm({ eyebrow: "VORSCHLAG", title: sugStatus[status][0], intro: "<p>Die Karte in Discord wird aktualisiert, die Person bekommt eine DM.</p>",
    fields: [{ name: "note", label: status === "rejected" ? "Begründung" : "Notiz (optional)", type: "textarea", required: status === "rejected", max: 500 }],
    submit: "Speichern", onSubmit: v => post(`/api/suggestions/${id}/status`, { status, note: v.note }) }),
});

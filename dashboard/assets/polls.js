// Abstimmungen: anlegen, Zwischenstand ansehen, vorzeitig beenden oder abbrechen. Nutzt Hilfsfunktionen aus app.js.
const pollState = { items: [], channels: [], roles: [], defaultChannel: null };
const pollStatus = { open: ["Läuft", "status-open"], closed: ["Beendet", "status-ended"], cancelled: ["Abgebrochen", "status-cancelled"] };

async function loadPolls() {
  const [data, channels, roles] = await Promise.all([api("/api/polls"), api("/api/channels"), api("/api/roles")]);
  Object.assign(pollState, { items: data.polls, defaultChannel: data.defaultChannel, channels: channels.channels, roles: roles.roles });
  if (!$("poll-form").dataset.ready) renderPollForm();
  renderPollList();
}

const POLL_DURATIONS = [["1 h", "1 Std"], ["6 h", "6 Std"], ["1 Tag", "1 Tag"], ["3 Tage", "3 Tage"], ["1 Woche", "1 Woche"], ["custom", "Datum wählen"]];
/** Vorlagen: füllen Antworten (und ggf. Mehrfachauswahl) vor. */
const POLL_TEMPLATES = {
  yesno: { label: "👍 Ja / Nein", options: ["Ja", "Nein"] },
  maybe: { label: "🤔 Ja / Nein / Vielleicht", options: ["Ja", "Nein", "Vielleicht"] },
  dates: { label: "📅 Termin finden", multi: true, options: () => Array.from({ length: 5 }, (_, n) => new Intl.DateTimeFormat("de-AT", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: state.timezone }).format(new Date(Date.now() + (n + 1) * 86_400_000)) + " · 20:00") },
  own: { label: "✏️ Eigene Antworten", options: [] },
};
const pollChip = (action, value, label, active) => `<button type="button" class="chip ${active ? "active" : ""}" data-action="${action}" data-value="${escapeHtml(value)}">${escapeHtml(label)}</button>`;

function renderPollForm() {
  const tomorrow = toLocalInput(new Date(Date.now() + 86_400_000).toISOString());
  $("poll-form").innerHTML = `
    <label>Frage<input name="question" maxlength="250" placeholder="z. B. Wann soll das nächste Familientreffen sein?"></label>
    <div><span class="field-label">Vorlage</span><div class="chips" id="poll-templates">${Object.entries(POLL_TEMPLATES).map(([key, t]) => pollChip("poll-template", key, t.label, key === "yesno")).join("")}</div></div>
    <label>Antworten <small>(eine pro Zeile, 2–10)</small><textarea name="options" rows="4" maxlength="900" placeholder="Freitag 20 Uhr&#10;Samstag 20 Uhr&#10;Sonntag 18 Uhr">Ja
Nein</textarea></label>
    <div><span class="field-label">Läuft</span><div class="chips" id="poll-durations">${POLL_DURATIONS.map(([value, label]) => pollChip("poll-duration", value, label, value === "1 Tag")).join("")}</div>
      <input type="hidden" name="duration" value="1 Tag"><label id="poll-custom-end" hidden>Endet am <small>(${escapeHtml(state.timezone)})</small><input name="endsAt" type="datetime-local" value="${tomorrow}"></label></div>
    <div class="checks"><label class="check"><input type="checkbox" name="multi"> Mehrere Antworten wählbar</label><label class="check"><input type="checkbox" name="remindMissing" checked> 🔔 Vor Ende alle pingen, die noch nicht abgestimmt haben</label><label class="check"><input type="checkbox" name="ping"> 📣 Beim Start die Familie pingen</label></div>
    <details class="poll-more"><summary>Mehr Optionen</summary>
      <div class="form-grid">
        <label>Channel<select name="channelId">${pollState.defaultChannel ? "" : '<option value="">– Channel wählen –</option>'}${pollState.channels.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === pollState.defaultChannel ? "selected" : ""}>#${escapeHtml(c.name)}</option>`).join("")}</select></label>
        <label>Nur diese Rolle darf abstimmen<select name="requiredRoleId"><option value="">Alle Familienmitglieder</option>${pollState.roles.map(r => `<option value="${escapeHtml(r.id)}">@${escapeHtml(r.name)}</option>`).join("")}</select></label>
      </div>
      <div class="checks"><label class="check"><input type="checkbox" name="anonymous"> 🔒 Anonym – niemand sieht, wer was gewählt hat</label><label class="check"><input type="checkbox" name="hideResults"> 🙈 Zwischenstand erst am Ende zeigen</label></div>
    </details>
    <p id="poll-error" class="form-error" role="alert"></p>
    <div class="actions start"><button type="button" class="primary-btn" data-action="poll-create">Abstimmung starten</button></div>`;
  $("poll-form").dataset.ready = "1";
}
const setActiveChip = (box, value) => box.querySelectorAll(".chip").forEach(chip => chip.classList.toggle("active", chip.dataset.value === value));

function renderPollList() {
  $("poll-list").innerHTML = pollState.items.map(p => {
    const [label, cls] = pollStatus[p.status] ?? [p.status, ""];
    const { counts, total } = p.results, max = Math.max(...counts);
    const channel = pollState.channels.find(c => c.id === p.channel_id)?.name ?? "Channel";
    const rows = p.options.map((option, i) => {
      const share = total ? Math.round(counts[i] / total * 100) : 0;
      const voters = p.voters ? p.voters.filter(v => v.option_index === i).map(v => who(v.user_id)).join(", ") : "";
      return `<div class="poll-option ${p.status !== "open" && total && counts[i] === max ? "lead" : ""}"><div class="poll-option-head"><span>${escapeHtml(option)}</span><b>${counts[i]} · ${share} %</b></div><div class="poll-bar"><i data-share="${share}"></i></div>${voters ? `<small>${voters}</small>` : ""}</div>`;
    }).join("");
    const actions = p.status === "open" ? (p.missingCount ? btn(`🔔 ${p.missingCount} erinnern`, "poll-remind", { id: p.id }) : "") + btn("Jetzt beenden", "poll-close", { id: p.id }) + btn("Abbrechen", "poll-cancel", { id: p.id }, "reject") : "";
    const missing = p.status !== "open" || p.missingCount == null ? "" : p.missingCount === 0 ? `<p class="manage-meta ok">✅ Alle haben abgestimmt.</p>` : `<p class="manage-meta">⏳ Noch nicht abgestimmt (${p.missingCount}): ${p.missing ? p.missing.map(who).join(", ") : "anonyme Abstimmung – nur die Anzahl"}</p>`;
    return `<article class="manage-card compact"><div class="manage-card-head"><div><span class="type-pill">#${escapeHtml(channel)}</span><h3>${escapeHtml(p.question)}</h3></div><span class="badge ${cls}">${label}</span></div>
      <p class="manage-meta">${total} ${total === 1 ? "Stimme" : "Stimmen"} · ${p.status === "open" ? `endet ${date(p.ends_at)}` : `beendet ${date(p.closed_at ?? p.ends_at)}`} · von ${who(p.created_by)}${p.anonymous ? " · anonym" : ""}${p.hide_results ? " · Zwischenstand verdeckt" : ""}</p>
      <div class="poll-options">${rows}</div>${missing}<div class="actions">${actions}</div></article>`;
  }).join("") || empty("Noch keine Abstimmungen.");
  // Balkenbreite per CSSOM (Inline-Styles sind durch die Content-Security-Policy gesperrt).
  document.querySelectorAll("#poll-list .poll-bar i").forEach(bar => { bar.style.width = `${bar.dataset.share}%`; });
}

loaders.polls = loadPolls;
Object.assign(actions, {
  "poll-create": async () => {
    const f = $("poll-form"), v = name => f.elements[name]?.value ?? "";
    $("poll-error").textContent = "";
    const custom = v("duration") === "custom";
    const body = { question: v("question"), options: v("options").split("\n"), channelId: v("channelId"), ...(custom ? { endsAt: v("endsAt") } : { duration: v("duration") }), requiredRoleId: v("requiredRoleId"), anonymous: f.elements.anonymous.checked, hideResults: f.elements.hideResults.checked, multi: f.elements.multi.checked, remindMissing: f.elements.remindMissing.checked, ping: f.elements.ping.checked };
    try {
      const result = await post("/api/polls", body);
      notify(result.message); delete f.dataset.ready; renderPollForm(); await loadPolls();
    } catch (error) { $("poll-error").textContent = error.message; }
  },
  "poll-template": ({ value }) => {
    const t = POLL_TEMPLATES[value], f = $("poll-form");
    if (!t) return;
    const options = typeof t.options === "function" ? t.options() : t.options;
    f.elements.options.value = options.join("\n");
    f.elements.multi.checked = Boolean(t.multi);
    setActiveChip($("poll-templates"), value);
    if (!options.length) f.elements.options.focus();
  },
  "poll-duration": ({ value }) => {
    $("poll-form").elements.duration.value = value;
    $("poll-custom-end").hidden = value !== "custom";
    setActiveChip($("poll-durations"), value);
  },
  "poll-remind": ({ id }) => confirmAction("Nicht-Abstimmer erinnern?", "Der Bot antwortet unter der Abstimmung und pingt alle, die noch nicht abgestimmt haben.", "Erinnern", () => post(`/api/polls/${id}/remind`), false),
  "poll-close": ({ id }) => confirmAction("Abstimmung jetzt beenden?", "Die Buttons werden entfernt und das Ergebnis im Channel gepostet.", "Beenden", () => post(`/api/polls/${id}/close`), false),
  "poll-cancel": ({ id }) => confirmAction("Abstimmung abbrechen?", "Die Abstimmung wird ohne Ergebnis geschlossen.", "Abbrechen", () => post(`/api/polls/${id}/cancel`)),
});

/* Einstellungen (nur Leitung). Nutzt die Hilfsfunktionen aus app.js. */
const settingsState = { settings: [], sections: [], roles: [], channels: [], categories: [], section: "access" };
const SOURCE_LABELS = { website: "angepasst", env: "aus .env", standard: "" };
// Zusatzbereiche ohne Einstellungen (eigene Panels auf der Seite).
const SETTINGS_EXTRAS = [{ id: "texts", label: "Discord-Texte", icon: "✏️" }, { id: "check", label: "Channel-Prüfung", icon: "🩺" }, { id: "import", label: "Import aus Nexus", icon: "📥" }, { id: "danger", label: "Gefahrenzone", icon: "⚠️" }];
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function pickList(items, selected, kind) {
  const chosen = new Set((selected ?? []).map(String));
  const known = new Set(items.map(item => item.id));
  const unknown = [...chosen].filter(id => !known.has(id)).map(id => ({ id, name: `Unbekannt (${id})` }));
  return `<div class="pick" data-kind="${kind}"><input class="pick-filter" type="search" placeholder="${kind === "roles" ? "Rollen filtern …" : "Channels filtern …"}" aria-label="Filtern"><div class="pick-list">${[...unknown, ...items].map(item => `<label class="check"><input type="checkbox" value="${escapeHtml(item.id)}" ${chosen.has(item.id) ? "checked" : ""}> ${kind === "roles" ? "@" : "#"}${escapeHtml(item.name)}</label>`).join("") || '<span class="muted">Keine Einträge gefunden.</span>'}</div><small class="pick-count">${chosen.size} ausgewählt</small></div>`;
}
const select = (items, value, empty = "— nicht gesetzt —", prefix = "#") => `<select class="setting-input"><option value="">${empty}</option>${items.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === value ? "selected" : ""}>${prefix}${escapeHtml(item.name)}${item.parent ? ` · ${escapeHtml(item.parent)}` : ""}</option>`).join("")}${value && !items.some(item => item.id === value) ? `<option value="${escapeHtml(value)}" selected>Unbekannt (${escapeHtml(value)})</option>` : ""}</select>`;
const roleSelect = value => select(settingsState.roles, value, "— Rolle wählen —", "@");

function categoryRow(category = {}) {
  return `<div class="row-editor cat-row"><div class="form-grid four"><label>ID<input data-f="id" value="${escapeHtml(category.id ?? "")}" placeholder="support" maxlength="25"></label><label>Name<input data-f="label" value="${escapeHtml(category.label ?? "")}" placeholder="Support" maxlength="100"></label><label>Emoji<input data-f="emoji" value="${escapeHtml(category.emoji ?? "")}" placeholder="🎫" maxlength="20"></label><label>Beschreibung<input data-f="description" value="${escapeHtml(category.description ?? "")}" maxlength="100"></label></div><div class="sub-label">Zuständige Rollen (sehen und bearbeiten diese Tickets zusätzlich zu Staff)</div>${pickList(settingsState.roles, category.roleIds ?? [], "roles")}<button type="button" class="action reject" data-action="row-remove">Kategorie entfernen</button></div>`;
}
const rankRow = (item = {}) => `<div class="row-editor rank-row"><div class="form-grid"><label>Bezeichnung<input data-f="label" value="${escapeHtml(item.label ?? "")}" placeholder="Rang 2" maxlength="80"></label><label>Rolle${roleSelect(item.roleId ?? "")}</label></div><button type="button" class="action reject" data-action="row-remove">Entfernen</button></div>`;

function control(def) {
  const v = def.value;
  switch (def.type) {
    case "roles": return pickList(settingsState.roles, v, "roles");
    case "channels": return pickList(settingsState.channels, v, "channels");
    case "channel": return select(settingsState.channels, v ?? "");
    case "forum": return select(settingsState.forums ?? [], v ?? "");
    case "category": return select(settingsState.categories, v ?? "", "— keine Kategorie —", "📁 ");
    case "number": return `<input class="setting-input" type="number" min="${def.min}" max="${def.max}" value="${escapeHtml(v ?? "")}">`;
    case "money": return `<input class="setting-input" autocomplete="off" placeholder="z. B. 500k – leer = kein Mindestbetrag" value="${v == null ? "" : escapeHtml(String(v / 100).replace(".", ","))}">`;
    case "bool": return `<label class="toggle"><input type="checkbox" class="setting-input" ${v ? "checked" : ""} aria-label="${escapeHtml(def.label)}"><span></span></label>`;
    case "list": case "numberList": return `<input class="setting-input" value="${escapeHtml((v ?? []).join(", "))}" placeholder="kommagetrennt">`;
    case "actions": return `<div class="checks inline">${def.options.map(([key, label]) => `<label class="check"><input type="checkbox" value="${key}" ${(v ?? []).includes(key) ? "checked" : ""}> ${escapeHtml(label)}</label>`).join("")}</div>`;
    case "text": return `<input class="setting-input" value="${escapeHtml(v ?? "")}">`;
    case "select": return `<select class="setting-input">${def.options.map(([key, label]) => `<option value="${escapeHtml(key)}" ${key === v ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
    case "json": return `<textarea class="setting-input mono" rows="6">${escapeHtml(JSON.stringify(v ?? {}, null, 2))}</textarea>`;
    case "ticketCategories": return `<div class="rows-editor">${(v ?? []).map(categoryRow).join("")}</div><button type="button" class="secondary" data-action="row-add" data-template="category">+ Kategorie</button>`;
    case "rankRoles": return `<div class="rows-editor">${(v ?? []).map(rankRow).join("")}</div><button type="button" class="secondary" data-action="row-add" data-template="rank">+ Rang-Rolle</button>`;
    default: return "";
  }
}
const checked = root => [...root.querySelectorAll(":scope input[type=checkbox]:checked")].map(box => box.value);
function readValue(def, root) {
  const input = root.querySelector(".setting-input");
  switch (def.type) {
    case "roles": case "channels": return checked(root.querySelector(".pick"));
    case "actions": return checked(root.querySelector(".checks"));
    case "number": return Number(input.value);
    case "bool": return input.checked;
    case "ticketCategories": return [...root.querySelectorAll(".cat-row")].map(row => {
      const field = name => row.querySelector(`[data-f=${name}]`).value.trim();
      return { id: field("id"), label: field("label"), ...(field("emoji") ? { emoji: field("emoji") } : {}), ...(field("description") ? { description: field("description") } : {}), roleIds: checked(row.querySelector(".pick")) };
    });
    case "rankRoles": return [...root.querySelectorAll(".rank-row")].map(row => ({ label: row.querySelector("[data-f=label]").value.trim(), roleId: row.querySelector("select").value }));
    default: return input.value;
  }
}

function settingRow(def) {
  const source = SOURCE_LABELS[def.source] ? `<span class="source source-${def.source}">${SOURCE_LABELS[def.source]}</span>` : "";
  const reset = def.source === "website" ? `<button type="button" class="link-btn small" data-action="setting-reset" data-key="${def.key}">Auf Standard zurücksetzen</button>` : "";
  const inline = def.type === "bool";
  return `
    <div class="setting ${inline ? "inline" : ""}" data-key="${def.key}" data-section="${def.section}"><div class="setting-head"><div><b title="${def.key}">${escapeHtml(def.label)}</b>${source}${def.help ? `<small>${escapeHtml(def.help)}</small>` : ""}${reset}</div>${inline ? control(def) : ""}</div>
    ${inline ? "" : `<div class="setting-control">${control(def)}</div>`}</div>`;
}
const settingsDirty = () => [...document.querySelectorAll("#settings-view .setting.dirty")];
function updateSaveBar() {
  const n = settingsDirty().length;
  $("settings-savebar").hidden = !n;
  $("settings-dirty").textContent = `${n} ${n === 1 ? "Änderung" : "Änderungen"} nicht gespeichert`;
}
function showSettingsSection(id) {
  settingsState.section = id;
  try { localStorage.setItem("corleone-settings-section", id); } catch {}
  const searching = Boolean(document.querySelector("#tab-settings .search")?.value.trim());
  document.querySelectorAll("#settings-groups .settings-nav-item").forEach(b => b.classList.toggle("active", !searching && b.dataset.section === id));
  document.querySelectorAll("#settings-view .settings-group").forEach(g => { g.hidden = !searching && g.dataset.section !== id; });
  document.querySelectorAll("#tab-settings .settings-extra").forEach(p => { p.hidden = searching || p.dataset.section !== id; });
}
function renderSettings() {
  const sections = settingsState.sections.length ? settingsState.sections : [...new Set(settingsState.settings.map(d => d.section))].map(id => ({ id, label: id, icon: "" }));
  const count = id => settingsState.settings.filter(d => d.section === id && d.source === "website").length;
  $("settings-groups").innerHTML = [...sections, ...SETTINGS_EXTRAS].map(sec => `<button type="button" class="settings-nav-item" data-action="settings-section" data-section="${sec.id}"><span class="settings-nav-icon">${sec.icon}</span><span>${escapeHtml(sec.label)}</span>${count(sec.id) ? `<em>${count(sec.id)}</em>` : ""}</button>`).join("");
  $("settings-view").innerHTML = sections.map(sec => {
    const defs = settingsState.settings.filter(d => d.section === sec.id).sort((a, b) => a.order - b.order);
    const basic = defs.filter(d => !d.advanced), advanced = defs.filter(d => d.advanced);
    const changed = advanced.filter(d => d.source !== "standard").length;
    // Spezialoptionen eingeklappt; die Suche klappt sie bei Treffern auf.
    const more = advanced.length ? `<details class="settings-advanced"><summary>Erweitert · ${advanced.length} ${advanced.length === 1 ? "Option" : "Optionen"}${changed ? ` · ${changed} angepasst` : ""}</summary>${advanced.map(settingRow).join("")}</details>` : "";
    return `<section class="panel settings-group" id="sg-${sec.id}" data-section="${sec.id}"><div class="panel-head"><div><h2>${sec.icon ? `${sec.icon} ` : ""}${escapeHtml(sec.label)}</h2>${sec.description ? `<p class="subtle">${escapeHtml(sec.description)}</p>` : ""}</div></div>${basic.map(settingRow).join("")}${more}</section>`;
  }).join("");
  let saved = null; try { saved = localStorage.getItem("corleone-settings-section"); } catch {}
  const known = [...sections, ...SETTINGS_EXTRAS].map(s => s.id);
  showSettingsSection(known.includes(settingsState.section) ? settingsState.section : known.includes(saved) ? saved : known[0]);
  document.querySelectorAll("#tab-settings .search").forEach(filterList);
  updateSaveBar();
}
// Suche über alle Bereiche: läuft nach der allgemeinen Filterfunktion (app.js) und blendet leere Bereiche aus.
function applySettingsSearch() {
  const box = document.querySelector("#tab-settings .search"), term = box?.value.trim();
  showSettingsSection(settingsState.section);
  if (term) document.querySelectorAll("#settings-view .settings-group").forEach(group => { group.hidden = ![...group.querySelectorAll(".setting")].some(card => !card.hidden); });
}
document.addEventListener("input", event => { if (event.target.matches?.('#tab-settings .search')) applySettingsSearch(); });
// Änderungen merken statt einzeln speichern: geänderte Einstellungen werden markiert, unten erscheint „Speichern“.
for (const type of ["input", "change"]) document.addEventListener(type, event => {
  const row = event.target.closest?.("#settings-view .setting");
  if (!row || event.target.matches(".pick-filter")) return;
  row.classList.add("dirty"); updateSaveBar();
});
document.addEventListener("click", event => {
  if (event.target.closest?.("#settings-view [data-action=row-remove], #settings-view [data-action=row-add]")) setTimeout(() => { event.target.closest?.(".setting")?.classList.add("dirty"); updateSaveBar(); });
});

loaders.settings = async () => {
  const [data, roles, channels, textData] = await Promise.all([api("/api/settings"), api("/api/roles"), api("/api/channels"), api("/api/texts").catch(() => ({ panels: [] }))]);
  Object.assign(settingsState, { settings: data.settings, sections: data.sections ?? [], roles: roles.roles, channels: channels.channels, categories: channels.categories ?? [], forums: channels.forums ?? [] });
  textsState.panels = textData.panels;
  renderSettings(); renderTexts();
};

// ------------------------------------------------------------------ Panel-Texte
const textsState = { panels: [], current: "application" };
function currentTexts() {
  const panel = textsState.panels.find(p => p.id === textsState.current);
  const values = { ...panel.values };
  document.querySelectorAll("#texts-form [data-text]").forEach(input => { values[input.dataset.text] = input.value; });
  return { panel, values };
}
function renderPreview() {
  const { panel, values } = currentTexts();
  const fields = [1, 2, 3].map(n => [values[`field${n}Name`], values[`field${n}Value`], n < 3]).filter(([name, value]) => name && value);
  const extras = panel.id === "activityBoard" ? [[values.scheduledTitle, "**Bizwar** · täglich · 01:05, 19:05 Uhr · nächstes in 2 Stunden", false], [values.flexibleTitle, "**Ladenraub** · alle 3 Stunden möglich", false]].filter(([n]) => n)
    : panel.id === "staffDashboard" ? [["🎫 Offene Tickets", "3 · davon 1 ohne Bearbeiter", true], ["📨 Offene Anträge", "2", true]]
    : panel.id === "leaderboard" ? [[values.weekTitle, "🥇 @Tony · **5** Teilnahmen\n🥈 @Paulie · **3** Teilnahmen", true], [values.monthTitle, "🥇 @Paulie · **14** Teilnahmen\n🥈 @Tony · **12** Teilnahmen", true]] : [];
  if (panel.id === "welcome") { const sample = { "{user}": "@NeuerSpieler", "{name}": "NeuerSpieler", "{server}": "Corleone", "{mitglieder}": "128", "{verifizierung}": "#neue-spieler" }; for (const key of ["content", "author", "title", "description", "footer", "dm"]) values[key] = String(values[key] ?? "").replace(/\{(user|name|server|mitglieder|verifizierung)\}/g, m => sample[m]); }
  if (panel.id === "events") return renderEventPreview(values);
  const buttons = panel.id === "verification" ? `<div class="dc-buttons"><span class="dc-btn ok">${escapeHtml(values.button)}</span><span class="dc-btn">${escapeHtml(values.buttonRename)}</span></div>`
    : panel.id === "application" ? `<div class="dc-buttons"><span class="dc-btn primary">${escapeHtml(values.buttonApply)}</span><span class="dc-btn">${escapeHtml(values.buttonRank)}</span></div>`
    : panel.id === "absence" ? `<div class="dc-buttons"><span class="dc-btn danger">${escapeHtml(values.buttonAbsent)}</span><span class="dc-btn ok">${escapeHtml(values.buttonBack)}</span></div>`
    : panel.id === "welcome" ? (values.button ? `<div class="dc-buttons"><span class="dc-btn">${escapeHtml(values.button)} ↗</span></div>` : "") + (values.dm ? `<div class="sub-label">Private Nachricht (falls aktiviert)</div><div class="dc-desc">${markdown(values.dm)}</div>` : "")
    : panel.id === "ticket" ? `<div class="dc-select">${escapeHtml(values.placeholder)}<span>⌄</span></div>` : panel.id === "staffDashboard" ? '<div class="dc-select">📂 Ansicht wählen …<span>⌄</span></div>' : "";
  $("texts-preview").innerHTML = `<div class="dc-head"><img src="/brand/logo" alt=""><b>Corleone Bot</b><span class="dc-app">APP</span></div>${panel.id === "welcome" && values.content ? `<div class="dc-desc">${markdown(values.content)}</div>` : ""}<div class="dc-embed">${values.author ? `<div class="dc-author">${escapeHtml(values.author)}</div>` : ""}${values.title ? `<div class="dc-title">${escapeHtml(values.title)}</div>` : ""}${values.description ? `<div class="dc-desc">${markdown(values.description)}</div>` : ""}<div class="dc-fields">${[...fields, ...extras].map(([name, value, inline]) => `<div class="dc-field ${inline ? "inline" : ""}"><b>${escapeHtml(name)}</b><div>${markdown(value)}</div></div>`).join("")}</div>${values.footer ? `<div class="dc-footer">${escapeHtml(values.footer)}</div>` : ""}</div>${buttons}`;
  const embed = $("texts-preview").querySelector(".dc-embed");
  if (embed) embed.style.borderLeftColor = /^#[0-9a-f]{6}$/i.test(values.color ?? "") ? values.color : "#f2f2f2";
  document.querySelectorAll("#texts-form [data-text]").forEach(input => { const counter = input.parentElement.querySelector(".counter"); if (counter && input.maxLength > 0) counter.textContent = `${input.value.length}/${input.maxLength}`; });
}
function renderEventPreview(values) {
  const fill = text => markdown(String(text ?? "").replaceAll("{name}", "Bizwar").replaceAll("{zeit}", "Mittwoch, 14. Oktober 2026 19:05").replaceAll("{uhrzeit}", "19:05").replaceAll("{relativ}", "in 2 Stunden").replaceAll("{minuten}", "60").replaceAll("{treffpunkt}", "Hauptquartier").replaceAll("{anmeldung}", "#event-anmeldung"));
  const head = '<div class="dc-head"><img src="/brand/logo" alt=""><b>Corleone Bot</b><span class="dc-app">APP</span></div>';
  const author = values.author ? `<div class="dc-author">${escapeHtml(values.author)}</div>` : "";
  $("texts-preview").innerHTML = `<div class="sub-label">#event-ankündigungen</div>${head}<div class="dc-embed">${author}<div class="dc-desc">${fill(values.announceText)}</div></div><div class="dc-buttons"><span class="dc-btn">${escapeHtml(values.announceButton)} ↗</span></div>
    <div class="sub-label spaced">#event-anmeldung</div>${head}<div class="dc-embed">${author}<div class="dc-title">📅 Bizwar</div><div class="dc-fields"><div class="dc-field inline"><b>🕒 Beginn</b><div>Mittwoch, 14. Oktober 2026 19:05<br>in 2 Stunden</div></div><div class="dc-field"><b>🙋 ${escapeHtml(values.participantsLabel)} (0)</b><div>${escapeHtml(values.emptyParticipants)}</div></div></div><div class="dc-footer">${escapeHtml(values.seriesFooter)} · täglich · 01:05, 19:05 Uhr</div></div><div class="dc-buttons"><span class="dc-btn ok">${escapeHtml(values.joinButton)}</span><span class="dc-btn">${escapeHtml(values.leaveButton)}</span><span class="dc-btn">${escapeHtml(values.dmButton)}</span></div>
    <div class="sub-label spaced">Erinnerung (Antwort auf die Karte)</div>${head}<div class="dc-embed"><div class="dc-desc">${fill(values.reminderText)}</div></div>`;
  $("texts-preview").querySelectorAll(".dc-embed").forEach(embed => { embed.style.borderLeftColor = /^#[0-9a-f]{6}$/i.test(values.color ?? "") ? values.color : "#f2f2f2"; });
  document.querySelectorAll("#texts-form [data-text]").forEach(input => { const counter = input.parentElement.querySelector(".counter"); if (counter && input.maxLength > 0) counter.textContent = `${input.value.length}/${input.maxLength}`; });
}
function renderTexts() {
  if (!textsState.panels.length) { $("texts-form").innerHTML = '<p class="muted">Panel-Texte sind nicht verfügbar.</p>'; return; }
  const panel = textsState.panels.find(p => p.id === textsState.current) ?? textsState.panels[0];
  textsState.current = panel.id;
  $("texts-tabs").innerHTML = textsState.panels.map(p => `<button type="button" class="chip ${p.id === panel.id ? "active" : ""}" data-action="texts-select" data-panel="${p.id}">${escapeHtml(p.label)}${p.custom ? " ✎" : ""}</button>`).join("");
  $("texts-form").innerHTML = panel.fields.map(field => {
    const value = escapeHtml(panel.values[field.key] ?? "");
    const input = field.type === "color" ? `<input data-text="${field.key}" type="color" value="${value}">`
      : field.multiline ? `<textarea data-text="${field.key}" rows="${field.max > 1100 ? 5 : 3}" maxlength="${field.max}">${value}</textarea>`
      : `<input data-text="${field.key}" maxlength="${field.max}" value="${value}">`;
    return `<label>${escapeHtml(field.label)}${field.type === "color" ? "" : ' <small class="counter"></small>'}${input}</label>`;
  }).join("");
  $("texts-hint").textContent = panel.id === "events" ? "Platzhalter: {name} {zeit} {uhrzeit} {relativ} {minuten} {treffpunkt}. {relativ} rechnet Discord beim Lesen neu aus („vor einer Stunde“), {minuten} bleibt fest. Gilt für alle neuen Events; laufende Event-Posts werden beim Speichern aktualisiert." : panel.channelSet ? "Dieses Panel wird automatisch in seinem Channel verwaltet." : "Für dieses Panel ist noch kein Channel eingestellt (Einstellungen → Channels). Ein bereits gepostetes Panel des Bots wird dort automatisch übernommen.";
  renderPreview();
}
document.addEventListener("input", event => { if (event.target.closest?.("#texts-form")) renderPreview(); });

function renderCheck(report) {
  const icon = { ok: "✅", warn: "⚠️", error: "❌", info: "ℹ️" };
  const perms = report.guildPermissions.filter(p => p.needed).map(p => `<div class="check-row ${p.has ? "ok" : "error"}"><span>${p.has ? "✅" : "❌"}</span><div><b>Server-Recht: ${escapeHtml(p.label)}</b><small>${escapeHtml(p.reason)}</small></div></div>`).join("");
  const rows = report.channels.map(r => `<div class="check-row ${r.status}"><span>${icon[r.status]}</span><div><b>${escapeHtml(r.label)}</b>${r.channel ? ` <em>→ ${r.channel.parent ? `${escapeHtml(r.channel.parent)} / ` : ""}${r.channel.category ? "📁 " : "#"}${escapeHtml(r.channel.name)}</em>` : ""}${r.issues.map(x => `<small class="lvl-${x.level}">${icon[x.level]} ${escapeHtml(x.text)}</small>`).join("")}</div><button type="button" class="action" data-action="settings-focus" data-key="${r.key}">Ändern</button></div>`).join("");
  $("channel-check").innerHTML = `<p class="check-summary"><b>${report.summary.ok}</b> passend · <b>${report.summary.warn}</b> mit Hinweis · <b>${report.summary.error}</b> Fehler${report.administrator ? " · ℹ️ Bot hat Administrator-Rechte (nicht nötig)" : ""}</p>${perms}${rows}`;
}

Object.assign(actions, {
  "reset-open": async () => {
    const data = await api("/api/reset");
    openForm({ eyebrow: "GEFAHRENZONE", title: "Testdaten zurücksetzen", danger: true, submit: "Endgültig zurücksetzen",
      intro: "<p>Wähle, was gelöscht wird. <b>Channels, Rollen, Panel-Texte, Panels und Aktivitäten-Vorlagen bleiben immer erhalten.</b> Vor dem Löschen wird automatisch ein Datenbank-Backup angelegt (siehe Status-Seite). Discord-Nachrichten wie alte Event-Karten oder Ticket-Channels werden nicht gelöscht.</p>",
      fields: [{ name: "areas", label: "Bereiche", type: "checks", required: true, options: data.areas.map(a => [a.id, `${a.label} (${a.count})`]), value: data.areas.filter(a => a.default).map(a => a.id) },
        { name: "confirm", label: `Zur Bestätigung „${data.confirmWord}“ eintippen`, required: true, max: 20, placeholder: data.confirmWord }],
      onSubmit: v => post("/api/reset", v) });
  },
  "texts-select": ({ panel }) => { textsState.current = panel; renderTexts(); },
  "texts-save": async () => { const { panel, values } = currentTexts(); const data = await post("/api/texts", { panel: panel.id, values }); textsState.panels = data.panels; notify(data.message); renderTexts(); },
  "texts-reset": () => { const { panel } = currentTexts(); confirmAction(`${panel.label} zurücksetzen?`, "Alle Texte dieses Panels werden auf die Standardtexte zurückgesetzt und in Discord aktualisiert.", "Zurücksetzen", async () => { const data = await post("/api/texts/reset", { panel: panel.id }); textsState.panels = data.panels; renderTexts(); return data; }); },
  "channel-check": async () => { $("channel-check").innerHTML = '<p class="muted">Prüfe …</p>'; renderCheck(await api("/api/channel-check")); },
  "settings-focus": ({ key }) => { const el = document.querySelector(`.setting[data-key="${key}"]`); if (el) { showSettingsSection(el.dataset.section); el.closest("details")?.setAttribute("open", ""); } el?.scrollIntoView({ behavior: "smooth", block: "center" }); el?.classList.add("flash"); setTimeout(() => el?.classList.remove("flash"), 1600); },
  "settings-save-all": async () => {
    const rows = settingsDirty(), errors = [];
    let last = null;
    for (const root of rows) {
      const def = settingsState.settings.find(item => item.key === root.dataset.key);
      try { last = await post("/api/settings", { key: def.key, value: readValue(def, root) }); root.classList.remove("dirty"); }
      catch (error) { errors.push(`${def.label}: ${error.message}`); }
    }
    if (last) settingsState.settings = last.settings;
    const failed = new Set(rows.filter(r => r.classList.contains("dirty")).map(r => r.dataset.key));
    if (!errors.length) { notify(rows.length === 1 ? last.message : `${rows.length} Einstellungen gespeichert. Die Änderungen gelten sofort.`); renderSettings(); return; }
    // Fehlgeschlagene bleiben mit ihren Eingaben stehen (nicht neu zeichnen), damit man sie korrigieren kann.
    notify(errors.join(" · "), "error");
    document.querySelectorAll("#settings-view .setting").forEach(r => { if (!failed.has(r.dataset.key)) r.classList.remove("dirty"); });
    updateSaveBar();
  },
  "settings-discard": () => { renderSettings(); notify("Änderungen verworfen."); },
  "settings-section": ({ section }) => { const box = document.querySelector("#tab-settings .search"); if (box) { box.value = ""; filterList(box); } settingsState.section = section; applySettingsSearch(); const layout = document.querySelector(".settings-layout"); if (layout && layout.getBoundingClientRect().top < 0) window.scrollTo({ top: layout.getBoundingClientRect().top + scrollY - 70 }); },
  "setting-reset": async ({ key }) => {
    const data = await post("/api/settings/reset", { key });
    settingsState.settings = data.settings; notify(data.message); renderSettings();
  },
  "row-add": ({ template }, button) => {
    const container = button.closest(".setting-control")?.querySelector(".rows-editor") ?? null;
    container?.insertAdjacentHTML("beforeend", template === "category" ? categoryRow() : rankRow());
  },
});
document.addEventListener("click", event => {
  const remove = event.target.closest("[data-action=row-remove]");
  if (remove) remove.closest(".row-editor")?.remove();
});
document.addEventListener("input", event => {
  if (event.target.matches?.(".pick-filter")) {
    const term = event.target.value.trim().toLocaleLowerCase("de-AT");
    event.target.closest(".pick").querySelectorAll(".check").forEach(label => { label.hidden = Boolean(term) && !label.textContent.toLocaleLowerCase("de-AT").includes(term); });
  }
});
document.addEventListener("change", event => {
  const pick = event.target.closest?.(".pick");
  if (pick && event.target.type === "checkbox") pick.querySelector(".pick-count").textContent = `${pick.querySelectorAll("input[type=checkbox]:checked").length} ausgewählt`;
});

// ------------------------------------------------------------------ Import aus dem Nexus-Bot (nur Bot-Owner)
// Dateien kommen aus dem Nexus-Bot (Status → „Server kopieren“ / „Einstellungen exportieren“). Erst Vorschau, dann
// mit Bestätigungswort ausführen. Der Server prüft Rechte und Inhalt noch einmal selbst.
const importState = { blueprint: null, settings: null, timer: null };
async function readImportFile(input) {
  const file = input.files?.[0];
  if (!file) return null;
  if (file.size > 2_500_000) throw new Error("Die Datei ist zu groß (max. 2,5 MB).");
  try { return JSON.parse(await file.text()); } catch { throw new Error("Die Datei ist kein gültiges JSON."); }
}
const importList = (items, empty) => items.length ? `<ul class="import-list">${items.join("")}</ul>` : `<p class="muted">${empty}</p>`;
const confirmRow = (id, word, action, label) => `<div class="import-confirm"><label>Zur Bestätigung „${escapeHtml(word)}“ eintippen<input id="${id}" maxlength="20" placeholder="${escapeHtml(word)}" autocomplete="off"></label><button type="button" class="primary" data-action="${action}">${label}</button></div>`;

function renderBlueprintPreview(p) {
  $("import-blueprint-result").innerHTML = `<p><b>Aufbau von „${escapeHtml(p.source)}“</b>${p.capturedAt ? ` · Stand ${escapeHtml(new Date(p.capturedAt).toLocaleString("de-DE"))}` : ""}</p>
    <div class="import-stats"><span><b>${p.roles.create}</b> von ${p.roles.total} Rollen neu</span><span><b>${p.categories.create}</b> von ${p.categories.total} Kategorien neu</span><span><b>${p.channels.create}</b> von ${p.channels.total} Channels neu</span></div>
    ${p.roles.names.length ? `<p class="subtle">Neue Rollen: ${p.roles.names.map(escapeHtml).join(", ")}${p.roles.create > p.roles.names.length ? " …" : ""}</p>` : ""}
    <p class="subtle">Vorhandenes mit gleichem Namen bleibt, es wird nichts gelöscht. Der Bot braucht dafür Administrator-Rechte und seine Rolle ganz oben.</p>
    ${confirmRow("import-blueprint-confirm", p.confirmWord, "import-blueprint-run", "Aufbau starten")}`;
}
function renderBlueprintJob(job) {
  if (!job) return;
  const pct = job.total ? Math.round(job.done / job.total * 100) : 0;
  const state = job.status === "running" ? "⏳" : job.status === "done" ? "✅" : "❌";
  $("import-blueprint-result").innerHTML = `<p><b>${state} ${escapeHtml(job.step)}</b></p>
    <div class="import-progress"><span></span></div>
    <p class="subtle">${job.done} von ${job.total} Schritten · neu: ${job.created.roles} Rollen, ${job.created.categories} Kategorien, ${job.created.channels} Channels · ${job.skipped} schon vorhanden</p>
    ${job.errors.length ? `<p><b>Hinweise:</b></p>${importList(job.errors.map(e => `<li>${escapeHtml(e)}</li>`), "")}` : ""}`;
  const bar = $("import-blueprint-result").querySelector(".import-progress span");
  if (bar) bar.style.width = `${pct}%`;
}
async function pollBlueprint() {
  clearTimeout(importState.timer);
  const { job } = await api("/api/import/blueprint/status");
  renderBlueprintJob(job);
  if (job?.status === "running") importState.timer = setTimeout(() => pollBlueprint().catch(() => {}), 1500);
  else if (job?.status === "done") notify("Server-Aufbau fertig. Jetzt kannst du die Einstellungen hochladen.");
}
function renderSettingsPreview(p, target = "import-settings-result", runAction = "import-settings-run", confirmId = "import-settings-confirm") {
  $(target).innerHTML = `<p><b>Einstellungen von „${escapeHtml(p.source)}“</b></p>
    <h3>Wird übernommen (${p.changes.length} Einstellungen, ${p.texts.length} Panel-Texte)</h3>
    ${importList([...p.changes.map(c => `<li><b>${escapeHtml(c.label)}</b> → ${escapeHtml(c.display)}</li>`), ...p.texts.map(t => `<li><b>Texte: ${escapeHtml(t.label)}</b> (Nexus → Corleone, Farben bleiben)</li>`)], "Nichts Passendes gefunden.")}
    <h3>Nicht gefunden – bitte selbst einstellen (${p.missing.length})</h3>
    ${importList(p.missing.map(m => `<li><b>${escapeHtml(m.label)}</b>: ${escapeHtml(m.reason)}</li>`), "Alles gefunden.")}
    ${p.changes.length || p.texts.length ? confirmRow(confirmId, p.confirmWord, runAction, "Übernehmen") : ""}`;
}
document.addEventListener("change", async event => {
  const id = event.target?.id;
  if (id !== "import-blueprint-file" && id !== "import-settings-file") return;
  const target = id === "import-blueprint-file" ? "import-blueprint-result" : "import-settings-result";
  try {
    const data = await readImportFile(event.target);
    if (!data) return;
    $(target).innerHTML = '<p class="muted">Prüfe die Datei …</p>';
    if (id === "import-blueprint-file") { importState.blueprint = data; renderBlueprintPreview((await post("/api/import/blueprint/preview", { blueprint: data })).preview); }
    else { importState.settings = data; renderSettingsPreview((await post("/api/import/settings/preview", { data })).preview); }
  } catch (error) { $(target).innerHTML = `<p class="lvl-error">${escapeHtml(error.message)}</p>`; event.target.value = ""; }
});
Object.assign(actions, {
  "import-blueprint-run": async () => {
    if (!importState.blueprint) throw new Error("Bitte zuerst die Aufbau-Datei auswählen.");
    const data = await post("/api/import/blueprint", { blueprint: importState.blueprint, confirm: $("import-blueprint-confirm")?.value ?? "" });
    notify(data.message); renderBlueprintJob(data.job); await pollBlueprint();
  },
  "import-blueprint-status": () => pollBlueprint(),
  "import-auto-preview": async () => { $("import-auto-result").innerHTML = '<p class="muted">Suche passende Channels …</p>'; renderSettingsPreview((await post("/api/import/auto/preview", {})).preview, "import-auto-result", "import-auto-run", "import-auto-confirm"); },
  "import-auto-run": async () => {
    const data = await post("/api/import/auto", { confirm: $("import-auto-confirm")?.value ?? "" });
    notify(data.message, data.result.failed.length ? "error" : "success");
    $("import-auto-result").innerHTML = `<p><b>${escapeHtml(data.message)}</b> Die Panels erscheinen jetzt in ihren Channels.</p>${data.missing.length ? `<h3>Noch selbst einstellen (${data.missing.length})</h3>${importList(data.missing.map(m => `<li><b>${escapeHtml(m.label)}</b>: ${escapeHtml(m.reason)}</li>`), "")}` : ""}`;
    if (data.settings && typeof settingsState !== "undefined") settingsState.settings = data.settings;
  },
  "import-settings-run": async () => {
    if (!importState.settings) throw new Error("Bitte zuerst die Einstellungs-Datei auswählen.");
    const data = await post("/api/import/settings", { data: importState.settings, confirm: $("import-settings-confirm")?.value ?? "" });
    notify(data.message, data.result.failed.length ? "error" : "success");
    $("import-settings-result").innerHTML = `<p><b>${escapeHtml(data.message)}</b></p>
      ${data.result.failed.length ? `<h3>Fehlgeschlagen</h3>${importList(data.result.failed.map(f => `<li><b>${escapeHtml(f.label)}</b>: ${escapeHtml(f.error)}</li>`), "")}` : ""}
      <h3>Noch selbst einstellen (${data.missing.length})</h3>${importList(data.missing.map(m => `<li><b>${escapeHtml(m.label)}</b>: ${escapeHtml(m.reason)}</li>`), "Nichts offen.")}`;
    if (data.settings && typeof settingsState !== "undefined") { settingsState.settings = data.settings; }
  },
});

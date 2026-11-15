// Ankündigungen: Editor mit Discord-Vorschau, sofort senden oder planen. Nutzt Hilfsfunktionen aus app.js/admin.js.
const annState = { channels: [], roles: [], items: [], cards: [], defaultChannel: null };
const annStatus = { scheduled: ["Geplant", "status-open"], sending: ["Wird gesendet", "status-open"], sent: ["Gesendet", "status-accepted"], failed: ["Fehlgeschlagen", "status-rejected"], cancelled: ["Abgebrochen", "status-void"] };

async function loadAnnouncements() {
  const [data, channels, roles] = await Promise.all([api("/api/announcements"), api("/api/channels"), api("/api/roles")]);
  Object.assign(annState, { items: data.announcements, defaultChannel: data.defaultChannel, channels: channels.channels, roles: roles.roles });
  if (!$("announce-form").dataset.ready) renderAnnounceForm();
  renderAnnounceList();
  $("infocards-wrap").classList.toggle("hidden", !state.me.capabilities.leaders);
  if (state.me.capabilities.leaders) { annState.cards = (await api("/api/info-cards")).cards; renderInfoCards(); }
}

function renderInfoCards() {
  $("infocards-list").innerHTML = annState.cards.map(c => {
    const channel = annState.channels.find(ch => ch.id === c.channelId)?.name ?? "Channel";
    const text = c.card.description ?? "";
    return `<article class="manage-card compact"><div class="manage-card-head"><div><span class="type-pill">#${escapeHtml(channel)}</span><h3>${escapeHtml(c.card.title || c.card.author || "Info-Karte")}</h3></div></div>
      <p class="manage-meta">${escapeHtml(text.slice(0, 180))}${text.length > 180 ? " …" : ""}<br>zuletzt geändert ${date(c.updatedAt)}${c.updatedBy ? ` · von ${who(c.updatedBy)}` : ""}</p>
      <div class="actions">${btn("Bearbeiten", "infocard-edit", { id: c.id })}${btn("Löschen", "infocard-delete", { id: c.id }, "reject")}</div></article>`;
  }).join("") || empty("Noch keine Info-Karten.");
}

function infoCardForm(card = null) {
  const c = card?.card ?? {};
  const fields = [
    ...(card ? [] : [{ name: "channelId", label: "Channel", type: "select", required: true, options: [["", "– Channel wählen –"], ...annState.channels.map(ch => [ch.id, `${ch.parent ? `${ch.parent} / ` : ""}#${ch.name}`])] }]),
    { name: "author", label: "Kopfzeile", hint: "(optional, klein über dem Titel)", value: c.author, max: 256 },
    { name: "title", label: "Titel", value: c.title, max: 256 },
    { name: "description", label: "Text", hint: "(**fett**, *kursiv*, Zeilenumbrüche wie in Discord)", type: "textarea", rows: 16, max: 4000, value: c.description },
    { name: "footer", label: "Fußzeile", hint: "(optional)", value: c.footer, max: 2048 },
    { name: "color", label: "Farbe", hint: "(z. B. #c9a24b)", value: c.color ?? "#c9a24b", max: 7 },
  ];
  openForm({ eyebrow: "INFO-KARTE", title: card ? "Info-Karte bearbeiten" : "Neue Info-Karte", wide: true, fields, submit: card ? "In Discord speichern" : "Posten",
    intro: card ? "Beim Speichern wird die Nachricht in Discord direkt geändert." : "Der Bot postet die Karte im gewählten Channel.",
    onSubmit: values => post(card ? `/api/info-cards/${card.id}` : "/api/info-cards", values) });
}

function renderAnnounceForm() {
  const caps = state.me.capabilities, f = $("announce-form");
  const channelOptions = annState.channels.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === annState.defaultChannel ? "selected" : ""}>${escapeHtml(c.parent ? `${c.parent} / ` : "")}#${escapeHtml(c.name)}</option>`).join("");
  f.innerHTML = `
    <label>Channel<select name="channelId" required>${annState.defaultChannel ? "" : '<option value="">– Channel wählen –</option>'}${channelOptions}</select></label>
    <label>Text über der Karte <small>(optional, max. 1800 Zeichen)</small><textarea name="content" rows="2" maxlength="1800" placeholder="z. B. Wichtige Info für alle!"></textarea></label>
    <label>Titel der Karte<input name="title" maxlength="256" placeholder="z. B. Familientreffen am Freitag"></label>
    <label>Beschreibung <small>(**fett**, Zeilenumbrüche wie in Discord)</small><textarea name="description" rows="6" maxlength="4000"></textarea></label>
    <div class="form-row"><label>Farbe<input name="color" type="color" value="#c9a24b"></label><label>Fußzeile <small>(optional)</small><input name="footer" maxlength="200" placeholder="CORLEONE  •  Leitung"></label></div>
    <label>Bild <small>(optional, https-Link zu einem Bild)</small><input name="imageUrl" maxlength="500" placeholder="https://…"></label>
    <fieldset class="checks role-checks"><legend>Rollen erwähnen <small>(optional, max. 5)</small></legend>${caps.announceEveryone ? '<label class="check"><input type="checkbox" name="pingEveryone"> @everyone</label>' : ""}${annState.roles.map(r => `<label class="check"><input type="checkbox" name="pingRole" value="${escapeHtml(r.id)}"> @${escapeHtml(r.name)}</label>`).join("")}</fieldset>
    <label>Später senden <small>(leer = sofort, Zeitzone ${escapeHtml(state.timezone)})</small><input name="scheduledAt" type="datetime-local"></label>
    <p id="announce-error" class="form-error" role="alert"></p>
    <div class="actions tight start"><button type="button" class="primary-btn" data-action="announce-send" id="announce-submit">Jetzt senden</button><button type="button" class="action" data-action="announce-clear">Leeren</button></div>`;
  f.dataset.ready = "1";
  renderAnnouncePreview();
}

function announceValues() {
  const f = $("announce-form"), v = name => f.elements[name]?.value ?? "";
  return { channelId: v("channelId"), content: v("content"), title: v("title"), description: v("description"), color: v("color"), footer: v("footer"), imageUrl: v("imageUrl"), scheduledAt: v("scheduledAt"),
    pingEveryone: Boolean(f.elements.pingEveryone?.checked), pingRoleIds: [...f.querySelectorAll('input[name="pingRole"]:checked')].map(box => box.value) };
}

function renderAnnouncePreview() {
  const v = announceValues(), roleName = id => annState.roles.find(r => r.id === id)?.name ?? "Rolle";
  const pings = [...(v.pingEveryone ? ['<span class="dc-mention">@everyone</span>'] : []), ...v.pingRoleIds.map(id => `<span class="dc-mention">@${escapeHtml(roleName(id))}</span>`)].join(" ");
  const content = [pings, v.content ? markdown(v.content) : ""].filter(Boolean).join("<br>");
  const hasEmbed = v.title || v.description;
  // Die Website lädt aus Sicherheitsgründen nur Discord-Bilder direkt; andere Links erscheinen als Platzhalter.
  const image = !/^https:\/\//i.test(v.imageUrl) ? "" : /^https:\/\/cdn\.discordapp\.com\//i.test(v.imageUrl) ? `<img class="dc-image" src="${escapeHtml(v.imageUrl)}" alt="" referrerpolicy="no-referrer">` : `<div class="dc-image-placeholder">Bild wird in Discord angezeigt</div>`;
  $("announce-preview").innerHTML = `<div class="sub-label">#${escapeHtml(annState.channels.find(c => c.id === v.channelId)?.name ?? "channel")}</div><div class="dc-head"><img src="/brand/logo" alt=""><b>Corleone Bot</b><span class="dc-app">APP</span></div>${content ? `<div class="dc-desc">${content}</div>` : ""}${hasEmbed ? `<div class="dc-embed">${v.title ? `<div class="dc-title">${escapeHtml(v.title)}</div>` : ""}${v.description ? `<div class="dc-desc">${markdown(v.description)}</div>` : ""}${image}${v.footer ? `<div class="dc-footer">${escapeHtml(v.footer)}</div>` : ""}</div>` : ""}${!content && !hasEmbed ? '<p class="muted">Schreib einen Text oder Titel – die Vorschau erscheint hier.</p>' : ""}`;
  // Farbe per CSSOM setzen: Inline-style-Attribute blockiert die Content-Security-Policy.
  const card = $("announce-preview").querySelector(".dc-embed"); if (card) card.style.borderLeftColor = /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : "#c9a24b";
  $("announce-submit").textContent = v.scheduledAt ? "Planen" : "Jetzt senden";
}

function renderAnnounceList() {
  $("announce-list").innerHTML = annState.items.map(a => {
    const [label, cls] = annStatus[a.status] ?? [a.status, ""];
    const when = a.status === "scheduled" ? `geplant für ${date(a.scheduled_at)}` : a.sent_at ? `gesendet ${date(a.sent_at)}` : `erstellt ${date(a.created_at)}`;
    const channel = annState.channels.find(c => c.id === a.channel_id)?.name ?? "Channel";
    const pings = [a.ping_everyone ? "@everyone" : "", ...a.ping_role_ids.map(id => `@${annState.roles.find(r => r.id === id)?.name ?? "Rolle"}`)].filter(Boolean).join(", ");
    return `<article class="manage-card compact"><div class="manage-card-head"><div><span class="type-pill">#${escapeHtml(channel)}</span><h3>${escapeHtml(a.embed.title || a.content.slice(0, 80) || "Ankündigung")}</h3></div><span class="badge ${cls}">${label}</span></div>
      <p class="manage-meta">${escapeHtml((a.embed.description || a.content).slice(0, 180))}${(a.embed.description || a.content).length > 180 ? " …" : ""}<br>${when} · von ${who(a.created_by)}${pings ? ` · erwähnt ${escapeHtml(pings)}` : ""}${a.error ? `<br><span class="warn-text">${escapeHtml(a.error)}</span>` : ""}</p>
      <div class="actions">${btn("Als Vorlage", "announce-copy", { id: a.id })}${a.status === "scheduled" ? btn("Abbrechen", "announce-cancel", { id: a.id }, "reject") : ""}</div></article>`;
  }).join("") || empty("Noch keine Ankündigungen.");
}

$("announce-form").addEventListener("input", renderAnnouncePreview);
$("announce-form").addEventListener("change", event => {
  if (event.target.name === "pingRole" && $("announce-form").querySelectorAll('input[name="pingRole"]:checked').length > 5) { event.target.checked = false; notify("Höchstens 5 Rollen erwähnen.", "error"); }
  renderAnnouncePreview();
});

loaders.announcements = loadAnnouncements;
Object.assign(actions, {
  "announce-send": async () => {
    const v = announceValues(); $("announce-error").textContent = "";
    if (!v.channelId) { $("announce-error").textContent = "Bitte einen Channel auswählen."; return; }
    const pings = [v.pingEveryone ? "@everyone" : "", ...v.pingRoleIds.map(id => `@${annState.roles.find(r => r.id === id)?.name}`)].filter(Boolean).join(", ");
    confirmAction(v.scheduledAt ? "Ankündigung planen?" : "Ankündigung jetzt senden?", `${v.scheduledAt ? `Wird am ${escapeHtml(v.scheduledAt.replace("T", " um "))} Uhr gesendet.` : "Wird sofort gepostet."}${pings ? ` Erwähnt: ${escapeHtml(pings)}.` : " Niemand wird erwähnt."}`, v.scheduledAt ? "Planen" : "Senden", async () => {
      const result = await post("/api/announcements", v);
      $("announce-form").reset(); renderAnnouncePreview();
      return result;
    }, false);
  },
  "infocard-new": () => infoCardForm(),
  "infocard-edit": ({ id }) => infoCardForm(annState.cards.find(c => c.id === id)),
  "infocard-delete": ({ id }) => confirmAction("Info-Karte löschen?", "Die Nachricht wird auch in Discord gelöscht.", "Löschen", () => post(`/api/info-cards/${id}/delete`)),
  "announce-clear": () => { $("announce-form").reset(); renderAnnouncePreview(); },
  "announce-cancel": ({ id }) => confirmAction("Geplante Ankündigung abbrechen?", "Sie wird nicht gesendet.", "Abbrechen", () => post(`/api/announcements/${id}/cancel`)),
  "announce-copy": ({ id }) => {
    const a = annState.items.find(item => item.id === id), f = $("announce-form"); if (!a) return;
    for (const [name, value] of Object.entries({ channelId: a.channel_id, content: a.content, title: a.embed.title ?? "", description: a.embed.description ?? "", color: a.embed.color ?? "#c9a24b", footer: a.embed.footer ?? "", imageUrl: a.embed.imageUrl ?? "", scheduledAt: "" })) if (f.elements[name]) f.elements[name].value = value;
    f.querySelectorAll('input[name="pingRole"]').forEach(box => { box.checked = a.ping_role_ids.includes(box.value); });
    if (f.elements.pingEveryone) f.elements.pingEveryone.checked = Boolean(a.ping_everyone);
    renderAnnouncePreview(); f.scrollIntoView({ behavior: "smooth", block: "start" });
  },
  "weekly-report-send": () => confirmAction("Wochenbericht jetzt senden?", "Die Zusammenfassung der Vorwoche wird sofort in den Wochenbericht-Channel gepostet.", "Senden", () => post("/api/weekly-report/send"), false),
});

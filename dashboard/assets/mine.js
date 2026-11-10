// „Mein Bereich“: eigene Daten für jedes Familienmitglied. Nutzt die Hilfsfunktionen aus app.js.
const myDay = value => value ? value.split("-").reverse().join(".") : "—";
const myParticipation = { signed_up: "Angemeldet", present: "Anwesend", absent: "Abwesend", left: "nicht angemeldet" };
const myRankKinds = { promotion: "⬆️ Beförderung", demotion: "⬇️ Degradierung", change: "↔️ Rangwechsel" };
const myWarnStates = { active: "Aktiv", expired: "Abgelaufen", revoked: "Zurückgenommen" };

async function loadMine() {
  const d = await api("/api/my");
  state.cache.mine = d;
  const a = d.account, e = d.events;
  $("my-stats").innerHTML = [
    myStat("Guthaben", a.hasAccount ? money(a.gross) : "kein Konto", "$"),
    myStat("Offene Sanktionen", money(a.openSanctions)),
    myStat("Bei Auszahlung netto", money(a.net), "→"),
    ...(a.minimum ? [myStat("Auszahlung ab", a.gross >= a.minimum ? `${money(a.minimum)} <small class="ok">✓ erreicht</small>` : `${money(a.minimum)} <small>noch ${money(a.minimum - a.gross)}</small>`, "⌁")] : []),
    myStat("Verdient · 7 Tage", money(d.todo.earned.week), "$"),
    myStat("Verdient · 30 Tage", money(d.todo.earned.month), "$"),
    myStat("Rang", escapeHtml(d.rank.current ?? "—"), "★"),
  ].join("");
  $("my-event-stats").innerHTML = [
    myStat("Event-Teilnahmen", escapeHtml(e.stats.participations), "#"),
    myStat("Event-Bilanz", `${e.record.wins} Win · ${e.record.losses} Lose`, "🏆"),
    myStat("Durch Events verdient", money(e.earned), "$"),
    ...(e.kills?.kills ? [myStat("Kills", `${e.kills.kills} <small>Bestwert ${e.kills.best} in einem Event</small>`)] : []),
  ].join("");
  renderMyTasks(d.tasks);
  renderMyTodo(d);
  renderMyPayoutList(d);
  $("my-absence-label").textContent = d.absences.open ? "Abmeldung beenden" : "Abmelden";
  const short = d.shortAbsence;
  $("my-short-label").textContent = short ? `Zurück (kurz weg bis ${new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit", timeZone: state.timezone }).format(new Date(short.ends_at))})` : "⏱️ Kurz weg";
  $("my-transactions").innerHTML = a.transactions.map(t => myRow(`${txLabels[t.type] ?? t.type} · ${t.type === "payout" ? `${money(t.net_cents)} ausgezahlt${t.deduction_cents ? ` (Abzug ${money(t.deduction_cents)})` : ""}` : `${["payout", "correction_debit"].includes(t.type) ? "−" : "+"}${money(t.amount_cents)}`}`, `${date(t.created_at)} · ${escapeHtml(t.reason)}`)).join("") || empty("Noch keine Buchungen.");
  $("my-discipline").innerHTML = [
    ...d.sanctions.map(s => myRow(`Sanktion ${money(s.amount_cents)} · ${statusLabels[s.status] ?? s.status}`, `${escapeHtml(s.reason)} · offen ${money(s.remaining_cents)} · ${date(s.created_at)}`)),
    ...d.warnings.map(w => myRow(`Verwarnung · ${myWarnStates[w.state] ?? w.state}`, `${escapeHtml(w.reason)} · ${date(w.created_at)}${w.revoke_reason ? ` · zurückgenommen: ${escapeHtml(w.revoke_reason)}` : ""}`)),
  ].join("") || empty("Keine Sanktionen oder Verwarnungen. 👍");
  $("my-events").innerHTML = [
    ...e.upcoming.map(ev => myRow(`${escapeHtml(ev.name)} · ${ev.status ? myParticipation[ev.status] ?? ev.status : "nicht angemeldet"}`, `${date(ev.starts_at)}${ev.location ? ` · ${escapeHtml(ev.location)}` : ""} · Anmeldung über Discord`)),
    ...e.past.map(ev => myRow(`${escapeHtml(ev.name)} · ${ev.event_status === "cancelled" ? "abgesagt" : myParticipation[ev.status] ?? ev.status}${ev.outcome === "win" ? " · 🏆 Win" : ev.outcome === "lose" ? " · ❌ Lose" : ""}`, `${date(ev.starts_at)}${ev.won_cents ? ` · +${money(ev.won_cents)} verdient` : " · vergangen"}`)),
  ].join("") || empty("Keine Events.");
  $("my-ranks").innerHTML = d.rank.history.map(r => myRow(`${myRankKinds[r.kind] ?? r.kind}: ${escapeHtml(r.from ?? "—")} → ${escapeHtml(r.to ?? "—")}`, date(r.created_at))).join("") || empty("Noch keine Rangänderung erfasst.");
  $("my-absences").innerHTML = d.absences.list.map(x => myRow(`${myDay(x.starts_on)} – ${myDay(x.ends_on)}${x.ended_at ? " · beendet" : d.absences.open?.id === x.id ? " · läuft" : ""}`, escapeHtml(x.reason))).join("") || empty("Keine Abmeldungen.");
  renderMyBoard();
  window.loadCalendar?.("my").catch(() => {});
}
/** Ganze Auszahlungsliste von oben bis unten; die eigene Zeile ist markiert. */
function renderMyPayoutList(d) {
  const rows = d.payoutList ?? [];
  $("my-payout-sum").textContent = rows.length ? `${rows.length} Mitglieder · gesamt ${money(rows.reduce((sum, r) => sum + r.net, 0))}` : "";
  $("my-payout-list").innerHTML = rows.map((r, n) => myRow(`${n + 1}. ${who(r.userId)}${r.userId === d.userId ? ' <em class="ok">du</em>' : ""} · <b>${money(r.net)}</b>`,
    `${r.deduction ? `brutto ${money(r.gross)} − ${money(r.deduction)} Sanktion` : `brutto ${money(r.gross)}`}${r.eligible ? "" : " · ⏳ unter Mindestbetrag"}`)).join("") || empty("Aktuell hat niemand ausstehendes Guthaben.");
}
/** Was die Person jetzt erledigen sollte, und was als Nächstes ansteht. */
function renderMyTodo(d) {
  const t = d.todo, a = d.account, link = t.logbookUrl ? ` · <a href="${escapeHtml(t.logbookUrl)}" target="_blank" rel="noopener">Ins Event-Logbuch →</a>` : "";
  const signed = d.events.upcoming.filter(ev => ev.status === "signed_up" && new Date(ev.starts_at) > Date.now()).slice(0, 3);
  const pending = d.tasks?.profile?.pending ?? 0;
  $("my-todo").innerHTML = [
    ...t.missingLogs.map(ev => myRow(`⚠️ Event-Log fehlt: <b>${escapeHtml(ev.name)}</b>`, `${date(ev.starts_at)} · Bild vom Event in dein Event-Logbuch posten${link}`)),
    ...(pending ? [myRow(`⏳ ${nLogs(pending)} ${pending === 1 ? "wartet" : "warten"} auf Prüfung`, "Das Team schaut sie sich an – du bekommst Bescheid.")] : []),
    ...(a.hasAccount && a.gross > 0 && (!a.minimum || a.gross >= a.minimum) ? [myRow(`💸 Auszahlung möglich: ${money(a.net)} netto`, "Melde dich bei der Leitung oder Finanzen.")] : []),
    ...(d.absences.open ? [myRow(`🚫 Du bist abgemeldet bis ${myDay(d.absences.open.ends_on)}`, "Früher zurück? Unter „Abmeldung“ beenden.")] : []),
    ...signed.map(ev => myRow(`📅 Angemeldet: <b>${escapeHtml(ev.name)}</b>`, `${date(ev.starts_at)}${ev.location ? ` · ${escapeHtml(ev.location)}` : ""}`)),
  ].join("") || empty("Alles erledigt 👍 Gerade steht nichts an.");
}
const myTaskIcons = { pending: "⏳", approved: "✅", rejected: "❌" };
function renderMyTasks(t) {
  $("my-tasks-empty").hidden = Boolean(t);
  if (!t) { $("my-tasks-panel").hidden = true; return; }
  const p = t.profile, lvl = p.level;
  // Abzeichen: Ring zeigt den Fortschritt zur nächsten Stufe, in der Mitte die Stufen-Nummer; Farbe je Stufe.
  const badge = $("my-level-badge"), rank = lvl.rank ?? 1, ring = 2 * Math.PI * 26;
  badge.className = `level-badge tier-${rank}`;
  badge.setAttribute("aria-label", `Stufe ${rank} von ${lvl.of ?? 7}: ${lvl.name}`);
  badge.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle class="lb-track" cx="32" cy="32" r="26"/><circle class="lb-fill" cx="32" cy="32" r="26" stroke-dasharray="${ring.toFixed(1)}" stroke-dashoffset="${(ring * (1 - Math.max(0.02, lvl.progress))).toFixed(1)}" transform="rotate(-90 32 32)"/></svg><b>${rank}</b><small>STUFE</small>`;
  $("my-level-title").textContent = `Stufe: ${lvl.name}`;
  // Breite per CSSOM (Inline-Styles sind durch die Content-Security-Policy gesperrt).
  requestAnimationFrame(() => { $("my-level-fill").style.width = `${Math.round(lvl.progress * 100)}%`; });
  $("my-level-next").textContent = lvl.next ? `${lvl.count} von ${lvl.next.min} bestätigten Logs – noch ${lvl.next.missing} bis ${lvl.next.emoji} ${lvl.next.name}` : `${lvl.count} Logs – höchste Stufe erreicht 👑`;
  $("my-tasks-stats").innerHTML = [
    myStat("Serie", p.streak ? `🔥 ${p.streak} ${p.streak === 1 ? "Tag" : "Tage"}` : "—"),
    myStat("Diese Woche", `${nLogs(p.week.logs)}${p.week.place ? ` <small>Platz ${p.week.place} von ${p.week.of}</small>` : ""}`),
    myStat("Woche verdient", money(p.week.earned)),
    myStat("Gesamt verdient", `${money(p.total.earned)} <small>${nLogs(p.total.logs)}</small>`),
    ...(p.pending ? [myStat("Wartet auf Prüfung", escapeHtml(p.pending))] : []),
  ].join("");
  $("my-tasks").innerHTML = t.recent.map(l => myRow(`${myTaskIcons[l.status] ?? ""} ${escapeHtml(l.type)}${l.perUnit ? ` ×${l.quantity} ${escapeHtml(l.unit)}` : ""}${l.status === "approved" && l.reward_cents ? ` · <span class="ok">+${money(l.reward_cents)}</span>` : ""}`, `${date(l.created_at)}${l.status === "pending" ? " · wird geprüft" : l.status === "rejected" ? ` · abgelehnt: ${escapeHtml(l.reject_reason ?? "—")}` : ""}`)).join("") || empty("Noch keine Aufgaben-Logs. Reiche erledigte Aufgaben in Discord mit /log und Screenshot ein.");
}
function renderMyBoard() {
  const d = state.cache.mine;
  if (!d) return;
  const rows = d.leaderboard[$("my-board-period").value] ?? [];
  $("my-board").innerHTML = rows.map((r, n) => myRow(`${["🥇", "🥈", "🥉"][n] ?? `${n + 1}.`} ${who(r.userId)}${r.userId === d.userId ? " <em class=\"ok\">du</em>" : ""}`, `${r.count} Teilnahmen · ${r.present} anwesend`)).join("") || empty("Noch keine Teilnahmen in diesem Zeitraum.");
}
$("my-board-period").addEventListener("change", renderMyBoard);

loaders.mine = async () => { await loadMine(); renderApp().catch(() => {}); };
loaders.mypayouts = loaders.myevents = loaders.mytasks = loaders.myabsence = loadMine;
Object.assign(actions, {
  "my-short": () => {
    if (state.cache.mine?.shortAbsence) return post("/api/my/short-absence/end").then(r => { notify(r.message); return refresh(); });
    openForm({ eyebrow: "KURZ WEG", title: "Kurz weg", intro: "<p>Für ein paar Minuten oder Stunden. Für ganze Tage bitte „Abmelden“.</p>",
      fields: [{ name: "until", label: "Wie lange?", required: true, max: 20, placeholder: "30 min, 2h, 1,5 h oder bis 21:30" }, { name: "reason", label: "Grund", hint: "(optional, sieht nur das Team)", max: 200 }],
      submit: "Kurz weg melden", onSubmit: v => post("/api/my/short-absence", v) });
  },
  "my-absence": () => {
    const open = state.cache.mine?.absences.open;
    if (open) return confirmAction("Abmeldung beenden?", `Du bist bis ${myDay(open.ends_on)} abgemeldet. Bist du früher zurück?`, "Ich bin zurück", () => post("/api/my/absence/end"), false);
    openForm({ eyebrow: "ABMELDUNG", title: "Abmelden", intro: `<p>Z. B. Urlaub oder Pause. Höchstens ${state.cache.mine?.absences.maxDays ?? 60} Tage. Den Grund sieht nur das Team.</p>`,
      fields: [{ name: "from", label: "Von", required: true, value: "heute", hint: "heute, morgen, Freitag oder 20.10." }, { name: "until", label: "Bis", required: true, placeholder: "27.10., Sonntag, 3 Tage, 1 Woche" }, { name: "reason", label: "Grund", required: true, max: 300 }],
      submit: "Abmelden", onSubmit: v => post("/api/my/absence", v) });
  },
});

// ------------------------------------------------------------------ Handy-App: installieren & Push
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let installPrompt = null;
window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); installPrompt = event; renderApp().catch(() => {}); });
const urlKey = base64 => { const pad = "=".repeat((4 - base64.length % 4) % 4); const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...raw].map(c => c.charCodeAt(0))); };
async function currentSubscription() { const reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription(); }

async function renderApp() {
  const install = $("app-install"), body = $("push-body");
  if (!install || !body) return;
  const mobile = window.matchMedia?.("(max-width: 900px)").matches;
  // 1. Installieren (nur wenn noch nicht als App geöffnet)
  install.innerHTML = isStandalone() ? "" : installPrompt
    ? `<p class="subtle">Corleone wie eine App vom Home-Bildschirm öffnen – ohne Browserleiste.</p><div class="actions start"><button type="button" class="primary-btn" data-action="app-install">App installieren</button></div>`
    : isIOS() ? `<ol class="app-steps"><li>In <b>Safari</b> unten auf <b>Teilen</b> <span aria-hidden="true">⬆︎</span> tippen</li><li><b>„Zum Home-Bildschirm“</b> wählen</li><li>Corleone vom Home-Bildschirm öffnen – danach hier Benachrichtigungen einschalten</li></ol>`
    : mobile ? `<p class="subtle">Im Browser-Menü <b>„App installieren“</b> bzw. <b>„Zum Startbildschirm hinzufügen“</b> wählen.</p>` : "";
  // 2. Benachrichtigungen
  const note = text => { body.innerHTML = `<p class="subtle">${text}</p>`; };
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return note("Benachrichtigungen gehen nur über die sichere Adresse der Website (https mit gültigem Zertifikat). Sobald sie darüber läuft, kannst du sie hier einschalten.");
  if (isIOS() && !isStandalone()) return note("Auf dem iPhone gehen Benachrichtigungen erst, wenn Corleone auf dem Home-Bildschirm liegt (Schritte oben).");
  if (!("PushManager" in window) || !("Notification" in window)) return note("Dieses Gerät bzw. dieser Browser unterstützt keine Benachrichtigungen.");
  if (Notification.permission === "denied") return note("Benachrichtigungen sind für Corleone blockiert. Erlaube sie in den Einstellungen deines Handys (Mitteilungen → Corleone) und lade die Seite neu.");
  const sub = await currentSubscription().catch(() => null);
  const info = await api(`/api/push${sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ""}`);
  pushState.info = info;
  if (!sub || !info.device) {
    body.innerHTML = `<p class="subtle">Bekomme Gutschriften, Event-Erinnerungen und mehr direkt aufs Handy.</p><div class="actions start"><button type="button" class="primary-btn" data-action="push-enable">Benachrichtigungen einschalten</button></div>`;
    return;
  }
  body.innerHTML = `<div class="push-types">${Object.entries(info.types).map(([type, t]) => `<div class="setting inline"><div class="setting-head"><div><b>${escapeHtml(t.label)}</b><small>${escapeHtml(t.help)}</small></div><label class="toggle"><input type="checkbox" data-push-type="${type}" ${info.device.prefs[type] !== false ? "checked" : ""} aria-label="${escapeHtml(t.label)}"><span></span></label></div></div>`).join("")}</div>
    <div class="actions start"><button type="button" class="action" data-action="push-test">Test schicken</button><button type="button" class="action" data-action="push-disable">Auf diesem Gerät ausschalten</button></div>`;
}
const pushState = { info: null };
async function saveSubscription(sub) {
  const prefs = Object.fromEntries([...document.querySelectorAll("[data-push-type]")].map(box => [box.dataset.pushType, box.checked]));
  return post("/api/push/subscribe", { subscription: sub.toJSON(), prefs: Object.keys(prefs).length ? prefs : undefined });
}
document.addEventListener("change", event => {
  if (!event.target.matches?.("[data-push-type]")) return;
  currentSubscription().then(sub => sub && saveSubscription(sub)).then(r => r && notify("Gespeichert.")).catch(error => notify(error.message, "error"));
});
Object.assign(actions, {
  "app-install": async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice.catch(() => null); installPrompt = null; renderApp(); },
  "push-enable": async () => {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { notify("Ohne Erlaubnis kann Corleone keine Benachrichtigungen schicken.", "error"); return renderApp(); }
    const info = pushState.info ?? await api("/api/push");
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(info.publicKey) });
    notify((await saveSubscription(sub)).message); await renderApp();
  },
  "push-test": async () => notify((await post("/api/push/test")).message),
  "push-disable": async () => {
    const sub = await currentSubscription();
    if (sub) { await post("/api/push/unsubscribe", { endpoint: sub.endpoint }); await sub.unsubscribe().catch(() => {}); }
    notify("Benachrichtigungen auf diesem Gerät sind aus."); await renderApp();
  },
});

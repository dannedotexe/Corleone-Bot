import webpush from "web-push";
import { getSetting, setSetting } from "./database.js";
import { formatMoney } from "./services/finance.js";
import { eligibleVoters } from "./polls.js";

/**
 * Push-Benachrichtigungen für die Handy-App (Web Push). Jedes Gerät meldet sich mit einem Abo an; pro Person lassen
 * sich die Arten ein- und ausschalten. Der Bot verschickt nur, was die Person selbst betrifft.
 */
export const PUSH_TYPES = {
  money: { label: "💰 Geld", help: "Gutschriften, Auszahlungen, Sanktionen" },
  events: { label: "📅 Events", help: "15 Minuten vor Events, für die du angemeldet bist" },
  tasks: { label: "🧾 Aufgaben", help: "Wenn dein Log bestätigt oder abgelehnt wurde" },
  polls: { label: "🗳️ Abstimmungen", help: "Neue Abstimmungen, bei denen du abstimmen darfst" },
};
const ALL_ON = Object.fromEntries(Object.keys(PUSH_TYPES).map(type => [type, true]));
const CURSOR_KEY = "PUSH_CURSOR";
const EVENT_LEAD_MS = 15 * 60_000;

/**
 * VAPID-Schlüssel: aus der .env (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY) oder einmalig erzeugt und in der Datenbank
 * gespeichert (nie über die Website sichtbar). Ohne gültige Schlüssel ist Push aus.
 */
export function vapidKeys(db, guildId) {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  let stored = null;
  try { stored = JSON.parse(getSetting(db, guildId, "PUSH_VAPID") ?? "null"); } catch { stored = null; }
  if (stored?.publicKey && stored?.privateKey) return stored;
  const keys = webpush.generateVAPIDKeys();
  setSetting(db, guildId, "PUSH_VAPID", JSON.stringify(keys));
  return keys;
}
const subject = config => (/^https:\/\//.test(config.DASHBOARD_PUBLIC_URL ?? "") ? config.DASHBOARD_PUBLIC_URL : "mailto:push@yamamoto.invalid");

export function createPushService(db) {
  const now = () => new Date().toISOString();
  const parsePrefs = row => { try { return { ...ALL_ON, ...JSON.parse(row.prefs || "{}") }; } catch { return { ...ALL_ON }; } };
  function subscribe({ guildId, userId, subscription, prefs = ALL_ON }) {
    const endpoint = String(subscription?.endpoint ?? ""), p256dh = String(subscription?.keys?.p256dh ?? ""), auth = String(subscription?.keys?.auth ?? "");
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) throw new Error("Ungültiges Push-Abo.");
    const clean = Object.fromEntries(Object.keys(PUSH_TYPES).map(type => [type, prefs?.[type] !== false]));
    db.prepare(`INSERT INTO push_subscriptions(endpoint,guild_id,user_id,p256dh,auth,prefs,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,guild_id=excluded.guild_id,p256dh=excluded.p256dh,auth=excluded.auth,prefs=excluded.prefs,updated_at=excluded.updated_at,fail_count=0`)
      .run(endpoint, guildId, userId, p256dh, auth, JSON.stringify(clean), now(), now());
    return clean;
  }
  const unsubscribe = ({ userId, endpoint }) => db.prepare("DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?").run(String(endpoint ?? ""), userId).changes > 0;
  const forEndpoint = (userId, endpoint) => { const row = db.prepare("SELECT * FROM push_subscriptions WHERE endpoint=? AND user_id=?").get(String(endpoint ?? ""), userId); return row ? { prefs: parsePrefs(row) } : null; };
  const forUser = (guildId, userId) => db.prepare("SELECT * FROM push_subscriptions WHERE guild_id=? AND user_id=?").all(guildId, userId).map(row => ({ ...row, prefs: parsePrefs(row) }));
  const subscribers = guildId => db.prepare("SELECT DISTINCT user_id FROM push_subscriptions WHERE guild_id=?").all(guildId).map(r => r.user_id);
  return { subscribe, unsubscribe, forEndpoint, forUser, subscribers };
}

/**
 * Schickt eine Benachrichtigung an alle Geräte der Person, die diese Art eingeschaltet haben. dedupeKey verhindert
 * Doppelte (auch nach Neustarts). Abgelaufene Abos (404/410) werden entfernt. send ist für Tests austauschbar.
 */
export async function sendPush({ db, config, guildId, userId, type, payload, dedupeKey = null, force = false, send = webpush.sendNotification.bind(webpush) }) {
  if (dedupeKey && db.prepare("SELECT 1 FROM push_sent WHERE key=?").get(dedupeKey)) return 0;
  const subs = createPushService(db).forUser(guildId, userId).filter(sub => force || sub.prefs[type] !== false);
  if (dedupeKey) db.prepare("INSERT OR IGNORE INTO push_sent(key,sent_at) VALUES(?,?)").run(dedupeKey, new Date().toISOString());
  if (!subs.length) return 0;
  const keys = vapidKeys(db, guildId);
  let delivered = 0;
  for (const sub of subs) {
    try {
      await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload),
        { TTL: 6 * 3600, urgency: "normal", vapidDetails: { subject: subject(config), publicKey: keys.publicKey, privateKey: keys.privateKey } });
      delivered++;
      if (sub.fail_count) db.prepare("UPDATE push_subscriptions SET fail_count=0 WHERE endpoint=?").run(sub.endpoint);
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) db.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").run(sub.endpoint);
      else db.prepare("UPDATE push_subscriptions SET fail_count=fail_count+1 WHERE endpoint=?").run(sub.endpoint);
    }
  }
  return delivered;
}

const clock = (iso, timezone) => new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(iso));

/**
 * Jede Minute: neue Buchungen, Sanktionen, geprüfte Logs, neue Abstimmungen seit dem letzten Lauf und Events, die in
 * 15 Minuten beginnen. Beim ersten Lauf wird nur der Startpunkt gesetzt (keine Flut alter Ereignisse).
 */
export async function runPushNotifications({ db, client, config, reference = new Date(), send }) {
  const guildId = config.DISCORD_GUILD_ID;
  if (!guildId) return 0;
  const subscribers = new Set(createPushService(db).subscribers(guildId));
  const nowIso = reference.toISOString(), since = getSetting(db, guildId, CURSOR_KEY);
  setSetting(db, guildId, CURSOR_KEY, nowIso);
  if (!since || !subscribers.size) return 0;
  const push = (userId, type, payload, dedupeKey) => (subscribers.has(userId) ? sendPush({ db, config, guildId, userId, type, payload, dedupeKey, send }) : 0);
  let sent = 0;

  // Geld (Aufgaben-Belohnungen kommen als eigene Aufgaben-Meldung, nicht doppelt)
  for (const t of db.prepare("SELECT * FROM transactions WHERE guild_id=? AND created_at>? AND created_at<=? ORDER BY created_at").all(guildId, since, nowIso)) {
    if (String(t.idempotency_key ?? "").startsWith("task-log:")) continue;
    const payload = t.type === "payout"
      ? { title: `💸 Auszahlung: ${formatMoney(t.net_cents ?? t.amount_cents)}`, body: t.deduction_cents ? `Davon ${formatMoney(t.deduction_cents)} Sanktionen verrechnet.` : "Dein Guthaben wurde ausgezahlt." }
      : t.type === "credit" || t.type === "correction_credit" ? { title: `💰 +${formatMoney(t.amount_cents)} gutgeschrieben`, body: t.reason }
      : t.type === "correction_debit" ? { title: `💰 −${formatMoney(t.amount_cents)} Korrektur`, body: t.reason } : null;
    if (payload) sent += await push(t.user_id, "money", { ...payload, url: "/#mine", tag: `tx-${t.id}` }, `tx:${t.id}`);
  }
  for (const s of db.prepare("SELECT * FROM sanctions WHERE guild_id=? AND created_at>? AND created_at<=?").all(guildId, since, nowIso))
    sent += await push(s.user_id, "money", { title: `⚖️ Sanktion: ${formatMoney(s.amount_cents)}`, body: `${s.reason} – wird bei der nächsten Auszahlung verrechnet.`, url: "/#mine", tag: `sanction-${s.id}` }, `sanction:${s.id}`);

  // Aufgaben-Logs
  for (const l of db.prepare("SELECT l.*, t.name AS type_name FROM task_logs l LEFT JOIN task_types t ON t.id=l.type_id WHERE l.guild_id=? AND l.status IN ('approved','rejected') AND l.reviewed_at>? AND l.reviewed_at<=?").all(guildId, since, nowIso)) {
    const payload = l.status === "approved"
      ? { title: `✅ Log bestätigt${l.reward_cents ? `: +${formatMoney(l.reward_cents)}` : ""}`, body: l.type_name ?? "Aufgabe" }
      : { title: "❌ Log abgelehnt", body: `${l.type_name ?? "Aufgabe"}${l.reject_reason ? ` – ${l.reject_reason}` : ""}` };
    sent += await push(l.user_id, "tasks", { ...payload, url: "/#mytasks", tag: `task-${l.id}` }, `task:${l.id}:${l.status}`);
  }

  // Events in 15 Minuten (nur Angemeldete)
  const soon = new Date(reference.getTime() + EVENT_LEAD_MS).toISOString();
  for (const e of db.prepare("SELECT * FROM events WHERE guild_id=? AND status='scheduled' AND starts_at>? AND starts_at<=?").all(guildId, nowIso, soon))
    for (const p of db.prepare("SELECT user_id FROM event_participants WHERE event_id=? AND status='signed_up'").all(e.id))
      sent += await push(p.user_id, "events", { title: `📅 ${e.name} um ${clock(e.starts_at, config.TIMEZONE)}`, body: `Geht gleich los${e.location ? ` · ${e.location}` : ""}. Denk an das Bild im Event-Logbuch.`, url: "/#myevents", tag: `event-${e.id}` }, `event:${e.id}:${p.user_id}`);

  // Neue Abstimmungen (nur wer abstimmen darf)
  for (const poll of db.prepare("SELECT * FROM polls WHERE guild_id=? AND status='open' AND created_at>? AND created_at<=?").all(guildId, since, nowIso)) {
    const allowed = eligibleVoters({ client, config, poll: { ...poll, required_role_id: poll.required_role_id } });
    for (const userId of subscribers) if (!allowed || allowed.includes(userId))
      sent += await push(userId, "polls", { title: "🗳️ Neue Abstimmung", body: poll.question, url: poll.message_id ? `https://discord.com/channels/${guildId}/${poll.channel_id}/${poll.message_id}` : "/", tag: `poll-${poll.id}` }, `poll:${poll.id}:${userId}`);
  }
  return sent;
}

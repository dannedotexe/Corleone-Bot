import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { getSetting, setSetting } from "./database.js";
import { BRAND_COLOR } from "./presentation.js";
import { localDay } from "./services/absences.js";
import { zonedTime } from "./services/event-series.js";

const SLOT_KEY = "VERIFY_REMINDER_LAST_SLOT";
const SLOT_WINDOW_MS = 2 * 3_600_000; // verpasste Zeitpunkte (z. B. Neustart) nur bis 2 Std. danach nachholen
const NEW_MEMBER_GRACE_MS = 3_600_000; // frisch Beigetretene haben gerade erst die Willkommensnachricht bekommen
const SEND_GAP_MS = 1500; // Abstand zwischen DMs (Discord-Spam-Schutz)
let batchRunning = false;

/** Link zum Verifizierungs-Panel (direkt zur Nachricht, sonst zum Channel). */
function verifyUrl(db, config) {
  if (!config.DISCORD_GUILD_ID || !config.CHANNEL_VERIFICATION_PANEL) return null;
  const [channelId, messageId] = (getSetting(db, config.DISCORD_GUILD_ID, "PANEL_VERIFICATION") ?? "").split(":");
  return channelId === config.CHANNEL_VERIFICATION_PANEL && messageId
    ? `https://discord.com/channels/${config.DISCORD_GUILD_ID}/${channelId}/${messageId}`
    : `https://discord.com/channels/${config.DISCORD_GUILD_ID}/${config.CHANNEL_VERIFICATION_PANEL}`;
}

/** Die Erinnerungs-DM. count/max für die Fußzeile; test = Vorschau für die Leitung. */
export function verifyReminderPayload({ db, config, name, server = "Corleone", count = 1, max = 0, test = false }) {
  const times = (config.VERIFY_REMINDER_TIMES ?? []).length;
  const embed = new EmbedBuilder().setColor(BRAND_COLOR).setAuthor({ name: "CORLEONE  •  VERIFIZIERUNG" })
    .setTitle("👋 Du bist noch nicht verifiziert")
    .setDescription([
      `Hey **${name}**,`,
      "",
      `du bist auf dem **${server}**-Discord, aber noch nicht verifiziert. Erst danach kannst du im Chat schreiben und überall mitmachen.`,
      "",
      "**So geht's – dauert 30 Sekunden:**",
      "1️⃣ Unten auf **„Jetzt verifizieren“** tippen",
      "2️⃣ Im Channel auf **„✅ Verifizieren“** drücken",
      "3️⃣ Ingame-ID, Vor- und Nachnamen eintragen – fertig!",
    ].join("\n"))
    .setFooter({ text: test ? "TEST – so sieht die Erinnerung für nicht verifizierte Mitglieder aus"
      : `${max ? `Erinnerung ${count} von ${max} · ` : ""}kommt ${times > 1 ? `${times}× täglich` : "täglich"}, bis du verifiziert bist` });
  const url = verifyUrl(db, config);
  const components = url ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Jetzt verifizieren").setEmoji("✅").setURL(url))] : [];
  return { embeds: [embed], components };
}

/** Mitglieder ohne Verifizierung: keine Verifiziert-Rolle und kein Eintrag in member_verifications. */
export function unverifiedMembers({ db, config, members, reference = new Date(), includeNew = false }) {
  const roles = config.ROLE_VERIFIED ?? [], guildId = config.DISCORD_GUILD_ID;
  const verified = new Set(db.prepare("SELECT user_id FROM member_verifications WHERE guild_id=?").all(guildId).map(r => r.user_id));
  return [...members].filter(m => !m.user?.bot && !verified.has(m.id) && !roles.some(r => m.roles?.cache?.has?.(r))
    && (includeNew || !(m.joinedTimestamp && reference.getTime() - m.joinedTimestamp < NEW_MEMBER_GRACE_MS)));
}

/** Aktueller Erinnerungs-Zeitpunkt (heute, schon erreicht, höchstens 2 Std. her) oder null. */
export function currentSlot(config, reference = new Date()) {
  const day = localDay(reference, config.TIMEZONE);
  const [y, m, d] = day.split("-").map(Number);
  let best = null;
  for (const time of config.VERIFY_REMINDER_TIMES ?? []) {
    const [h, mi] = time.split(":").map(Number);
    const at = zonedTime(y, m, d, h, mi, config.TIMEZONE);
    const since = reference.getTime() - at.getTime();
    if (since >= 0 && since < SLOT_WINDOW_MS && (!best || at > best.at)) best = { key: `${day} ${time}`, at };
  }
  return best;
}

/**
 * Zu den eingestellten Uhrzeiten (Standard 12:00 und 19:00) alle nicht Verifizierten per DM erinnern – höchstens
 * VERIFY_REMINDER_MAX-mal pro Person (0 = unbegrenzt). Läuft im Hintergrund mit Pausen zwischen den DMs.
 */
export async function runVerifyReminders({ db, client, config, reference = new Date(), wait = ms => new Promise(r => setTimeout(r, ms)) }) {
  const guildId = config.DISCORD_GUILD_ID;
  if (!config.VERIFY_REMINDER_ENABLED || !guildId || !config.CHANNEL_VERIFICATION_PANEL || batchRunning) return null;
  const slot = currentSlot(config, reference);
  if (!slot || getSetting(db, guildId, SLOT_KEY) === slot.key) return null;
  setSetting(db, guildId, SLOT_KEY, slot.key);
  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return null;
  const all = await guild.members.fetch().catch(() => guild.members.cache);
  const max = config.VERIFY_REMINDER_MAX ?? 0, since = slot.at.toISOString();
  const state = db.prepare("SELECT count,last_at FROM verify_reminders WHERE guild_id=? AND user_id=?");
  const targets = unverifiedMembers({ db, config, members: all.values(), reference }).filter(m => {
    const row = state.get(guildId, m.id);
    return !(row?.last_at >= since) && !(max && (row?.count ?? 0) >= max);
  });
  batchRunning = true;
  const result = { slot: slot.key, targets: targets.length, sent: 0, failed: 0 };
  try {
    for (const member of targets) {
      const count = (state.get(guildId, member.id)?.count ?? 0) + 1;
      const ok = await member.send(verifyReminderPayload({ db, config, name: member.displayName ?? member.user?.username ?? "du", server: guild.name, count, max })).then(() => true).catch(() => false);
      db.prepare("INSERT INTO verify_reminders(guild_id,user_id,count,last_at,failed) VALUES(?,?,1,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET count=count+1,last_at=excluded.last_at,failed=failed+excluded.failed")
        .run(guildId, member.id, reference.toISOString(), ok ? 0 : 1);
      ok ? result.sent++ : result.failed++;
      await wait(SEND_GAP_MS);
    }
  } finally { batchRunning = false; }
  if (result.targets) console.log(`Verifizierungs-Erinnerung ${slot.key}: ${result.sent} gesendet, ${result.failed} nicht zustellbar (DMs geschlossen).`);
  return result;
}

/** Vorschau-DM an eine Person (Website-Knopf bzw. einmalig an die Bot-Owner). */
export async function sendVerifyReminderTest({ db, client, config, userId }) {
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return false;
  const guild = client.guilds.cache.get(config.DISCORD_GUILD_ID);
  const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
  return user.send(verifyReminderPayload({ db, config, name: member?.displayName ?? user.globalName ?? user.username, server: guild?.name ?? "Corleone", test: true })).then(() => true).catch(() => false);
}

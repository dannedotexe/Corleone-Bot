import { randomUUID } from "node:crypto";
import { EmbedBuilder } from "discord.js";
import { audit } from "./database.js";

/**
 * Info-Karten: feste Karten (z. B. Sanktionskatalog, Vergütungen), die der Bot postet und die sich über die Website
 * bearbeiten lassen – statt sie per Webhook neu zu schicken. Die Nachricht wird bearbeitet, nicht neu gepostet.
 */
export class InfoCardError extends Error {}
const COLOR = /^#?[0-9a-f]{6}$/i;
const DEFAULT_COLOR = "#c9a24b";

export function validateInfoCard(input) {
  const str = (value, max, label) => {
    const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
    if (text.length > max) throw new InfoCardError(`${label}: höchstens ${max} Zeichen (aktuell ${text.length}).`);
    return text;
  };
  const card = {
    author: str(input.author, 256, "Kopfzeile"),
    title: str(input.title, 256, "Titel"),
    description: str(input.description, 4000, "Text"),
    footer: str(input.footer, 2048, "Fußzeile"),
    color: COLOR.test(String(input.color ?? "")) ? `#${String(input.color).replace("#", "").toLowerCase()}` : DEFAULT_COLOR,
  };
  if (!card.title && !card.description) throw new InfoCardError("Bitte einen Titel oder Text angeben.");
  if (/@(everyone|here)/i.test(card.description)) throw new InfoCardError("@everyone/@here ist in Info-Karten nicht erlaubt.");
  return card;
}

export function infoCardPayload(card) {
  const embed = new EmbedBuilder().setColor(Number.parseInt(String(card.color ?? DEFAULT_COLOR).replace("#", ""), 16));
  if (card.author) embed.setAuthor({ name: card.author });
  if (card.title) embed.setTitle(card.title);
  if (card.description) embed.setDescription(card.description);
  if (card.footer) embed.setFooter({ text: card.footer });
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

const parse = row => (row ? { ...row, card: JSON.parse(row.embed || "{}") } : null);

export function createInfoCardService(db) {
  const now = () => new Date().toISOString();
  const get = (guildId, id) => parse(db.prepare("SELECT * FROM info_cards WHERE guild_id=? AND id=?").get(guildId, id));
  const list = guildId => db.prepare("SELECT * FROM info_cards WHERE guild_id=? ORDER BY created_at").all(guildId).map(parse);
  function insert({ guildId, channelId, messageId, card, actorId, sourceMessageId = null }) {
    const id = randomUUID();
    db.prepare("INSERT INTO info_cards(id,guild_id,channel_id,message_id,embed,source_message_id,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(id, guildId, channelId, messageId, JSON.stringify(card), sourceMessageId, actorId, actorId, now(), now());
    return get(guildId, id);
  }
  function update({ guildId, id, card, messageId, actorId }) {
    db.prepare("UPDATE info_cards SET embed=?,message_id=?,updated_by=?,updated_at=? WHERE guild_id=? AND id=?").run(JSON.stringify(card), messageId, actorId, now(), guildId, id);
    return get(guildId, id);
  }
  const remove = (guildId, id) => db.prepare("DELETE FROM info_cards WHERE guild_id=? AND id=?").run(guildId, id).changes > 0;
  return { get, list, insert, update, remove };
}

/** Postet eine neue Info-Karte im Channel. */
export async function postInfoCard({ db, client, guildId, channelId, card, actorId }) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) throw new InfoCardError("Channel nicht gefunden oder der Bot darf dort nicht schreiben.");
  const message = await channel.send(infoCardPayload(card));
  const row = createInfoCardService(db).insert({ guildId, channelId, messageId: message.id, card, actorId });
  audit(db, guildId, actorId, "info_card.created", null, { channelId, name: card.title || card.author || "Info-Karte" });
  return row;
}

/** Bearbeitet die vorhandene Nachricht; ist sie gelöscht worden, wird die Karte neu gepostet. */
export async function updateInfoCard({ db, client, guildId, id, card, actorId }) {
  const service = createInfoCardService(db), row = service.get(guildId, id);
  if (!row) throw new InfoCardError("Info-Karte nicht gefunden.");
  const channel = await client.channels.fetch(row.channel_id).catch(() => null);
  if (!channel?.send) throw new InfoCardError("Der Channel der Karte existiert nicht mehr.");
  const message = await channel.messages.fetch(row.message_id).catch(() => null);
  let messageId = row.message_id;
  if (message) await message.edit(infoCardPayload(card));
  else messageId = (await channel.send(infoCardPayload(card))).id;
  audit(db, guildId, actorId, "info_card.updated", null, { channelId: row.channel_id, name: card.title || card.author || "Info-Karte" });
  return { row: service.update({ guildId, id, card, messageId, actorId }), reposted: !message };
}

export async function deleteInfoCard({ db, client, guildId, id, actorId }) {
  const service = createInfoCardService(db), row = service.get(guildId, id);
  if (!row) throw new InfoCardError("Info-Karte nicht gefunden.");
  const channel = await client.channels.fetch(row.channel_id).catch(() => null);
  await channel?.messages?.fetch(row.message_id).then(m => m.delete()).catch(() => {});
  service.remove(guildId, id);
  audit(db, guildId, actorId, "info_card.deleted", null, { channelId: row.channel_id, name: row.card.title || row.card.author || "Info-Karte" });
  return true;
}


import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MessagePayload } from "discord.js";
import { EMOJI_SET } from "./emoji-set.js";

/**
 * Eigene Corleone-Emojis statt Standard-Emojis: Der Bot lädt sie einmalig als Bot-Emojis hoch (belegen keine
 * Server-Plätze) und ersetzt beim Senden jedes bekannte Unicode-Emoji in Text, Karten und Knöpfen.
 * Fehlt ein Emoji (Upload fehlgeschlagen), bleibt das normale Emoji stehen.
 */
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/emojis");
const ids = new Map(); // Name → ID
const status = { checkedAt: null, error: null, failed: 0 };
const variants = new Map(); // Unicode (mit und ohne Variantenzeichen) → Name
for (const [emoji, [name]] of Object.entries(EMOJI_SET)) { variants.set(emoji, name); variants.set(emoji.replace(/️/g, ""), name); }
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Längere Folgen zuerst, damit „⚠️“ nicht als „⚠“ + Rest ersetzt wird.
const PATTERN = new RegExp([...variants.keys()].sort((a, b) => b.length - a.length).map(escape).join("|"), "gu");

const custom = name => (ids.has(name) ? `<:${name}:${ids.get(name)}>` : null);
export function corleoneText(text) {
  if (typeof text !== "string" || !ids.size) return text;
  return text.replace(PATTERN, match => custom(variants.get(match)) ?? match);
}
/** Footer und Kopfzeile zeigen keine eigenen Emojis an – dort werden bekannte Emojis entfernt. */
const stripped = text => (typeof text === "string" && ids.size ? text.replace(PATTERN, "").replace(/^\s+/, "").replace(/\s{2,}/g, " ") : text);

function emojiObject(emoji) {
  if (!emoji || emoji.id || !emoji.name) return emoji;
  const name = variants.get(emoji.name) ?? variants.get(emoji.name.replace(/️/g, ""));
  return name && ids.has(name) ? { id: ids.get(name), name, animated: false } : emoji;
}

function transformEmbed(embed) {
  if (!embed) return embed;
  const out = { ...embed, title: corleoneText(embed.title), description: corleoneText(embed.description) };
  if (embed.fields) out.fields = embed.fields.map(f => ({ ...f, name: corleoneText(f.name), value: corleoneText(f.value) }));
  if (embed.footer?.text) out.footer = { ...embed.footer, text: stripped(embed.footer.text) || embed.footer.text };
  if (embed.author?.name) out.author = { ...embed.author, name: stripped(embed.author.name) || embed.author.name };
  return out;
}

function transformComponent(component) {
  if (!component || typeof component !== "object") return component;
  const out = { ...component };
  if (out.emoji) out.emoji = emojiObject(out.emoji);
  if (Array.isArray(out.options)) out.options = out.options.map(o => (o.emoji ? { ...o, emoji: emojiObject(o.emoji) } : o));
  if (Array.isArray(out.components)) out.components = out.components.map(transformComponent);
  if (out.accessory) out.accessory = transformComponent(out.accessory);
  if (typeof out.content === "string") out.content = corleoneText(out.content);
  return out;
}

/** Wendet die Ersetzung auf einen fertigen Nachrichten-Body (API-Format) an. */
export function transformBody(body) {
  if (!body || !ids.size) return body;
  if (typeof body.content === "string") body.content = corleoneText(body.content);
  if (Array.isArray(body.embeds)) body.embeds = body.embeds.map(transformEmbed);
  if (Array.isArray(body.components)) body.components = body.components.map(transformComponent);
  return body;
}

let patched = false;
function patchPayloads() {
  if (patched) return;
  patched = true;
  const original = MessagePayload.prototype.resolveBody;
  MessagePayload.prototype.resolveBody = function resolveBody(...args) {
    const result = original.apply(this, args);
    try { transformBody(this.body); } catch (error) { console.warn("Corleone-Emojis konnten nicht eingesetzt werden:", error.message); }
    return result;
  };
}

/** Lädt fehlende Emojis als Bot-Emojis hoch und aktiviert die Ersetzung. Gibt die Zahl neu hochgeladener zurück. */
export async function syncCorleoneEmojis(client) {
  status.checkedAt = new Date().toISOString(); status.error = null; status.failed = 0;
  if (!client.application?.id) await client.application?.fetch?.().catch(() => {});
  const manager = client.application?.emojis;
  if (!manager) { status.error = "Bot-Anwendung nicht verfügbar"; return 0; }
  const existing = await manager.fetch().catch(error => { status.error = `Laden fehlgeschlagen: ${error.message}`; console.warn("Bot-Emojis konnten nicht geladen werden:", error.message); return null; });
  if (!existing) return 0;
  for (const emoji of existing.values()) ids.set(emoji.name, emoji.id);
  let uploaded = 0;
  const wanted = [...new Set(Object.values(EMOJI_SET).map(([name]) => name))];
  for (const name of wanted) {
    if (ids.has(name)) continue;
    const file = path.join(DIR, `${name}.png`);
    if (!fs.existsSync(file)) continue;
    try { const emoji = await manager.create({ attachment: file, name }); ids.set(emoji.name, emoji.id); uploaded++; }
    catch (error) { status.failed++; status.error = `Hochladen fehlgeschlagen (${name}): ${error.message}`; console.warn(`Emoji ${name} konnte nicht hochgeladen werden:`, error.message); }
  }
  patchPayloads();
  return uploaded;
}

export const corleoneEmojiStatus = () => ({ active: [...new Set(Object.values(EMOJI_SET).map(([name]) => name))].filter(name => ids.has(name)).length, total: new Set(Object.values(EMOJI_SET).map(([name]) => name)).size, ...status });

/** Nur für Tests: Emoji-IDs direkt setzen. */
export function setCorleoneEmojiIds(map) { ids.clear(); for (const [name, id] of Object.entries(map)) ids.set(name, id); patchPayloads(); }

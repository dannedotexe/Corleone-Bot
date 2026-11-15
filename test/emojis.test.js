import test from "node:test";
import assert from "node:assert/strict";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { corleoneText, setCorleoneEmojiIds, transformBody } from "../src/emojis.js";
import { EMOJI_SET } from "../src/emoji-set.js";
import fs from "node:fs";

test("Corleone-Emojis: jedes Emoji hat ein Bild mit gültigem Namen", () => {
  for (const [name] of Object.values(EMOJI_SET)) {
    assert.match(name, /^[a-z0-9_]{2,32}$/);
    assert.ok(fs.existsSync(new URL(`../assets/emojis/${name}.png`, import.meta.url)), name);
  }
});

test("Corleone-Emojis: Text, Karten und Knöpfe werden ersetzt, Unbekanntes bleibt", () => {
  setCorleoneEmojiIds({ co_check: "111", co_warning: "222", co_trophy: "333" });
  assert.equal(corleoneText("✅ ok ⚠️ achtung ⚠ ohne Zeichen 😀"), "<:co_check:111> ok <:co_warning:222> achtung <:co_warning:222> ohne Zeichen 😀");
  const body = transformBody({
    content: "🏆 Sieger",
    embeds: [new EmbedBuilder().setTitle("🏆 Rangliste").setDescription("✅ fertig").setFooter({ text: "🏆 CORLEONE" }).addFields({ name: "✅ A", value: "⚠️ B" }).toJSON()],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("a").setLabel("Ok").setEmoji("✅").setStyle(ButtonStyle.Success)).toJSON()],
  });
  assert.equal(body.content, "<:co_trophy:333> Sieger");
  assert.equal(body.embeds[0].title, "<:co_trophy:333> Rangliste");
  assert.equal(body.embeds[0].footer.text, "CORLEONE", "Footer kann keine eigenen Emojis – entfernt");
  assert.equal(body.embeds[0].fields[0].value, "<:co_warning:222> B");
  assert.deepEqual(body.components[0].components[0].emoji, { id: "111", name: "co_check", animated: false });
});

test("Corleone-Emojis: neues Bild ersetzt das alte Bot-Emoji, unverändertes bleibt", async () => {
  const { syncCorleoneEmojis } = await import("../src/emojis.js");
  const { EMOJI_SET } = await import("../src/emoji-set.js");
  const names = [...new Set(Object.values(EMOJI_SET).map(([name]) => name))];
  let next = 1; const deleted = [], created = [];
  const emoji = name => ({ id: String(next++), name, delete: async () => { deleted.push(name); } });
  const existing = new Map(names.map(name => { const e = emoji(name); return [e.id, e]; }));
  const client = { application: { id: "app", emojis: { fetch: async () => existing, create: async ({ name }) => { created.push(name); return emoji(name); } } } };
  let stored = null;
  const store = { get: () => stored, set: value => { stored = value; } };
  assert.equal(await syncCorleoneEmojis(client, store), names.length, "ohne Fingerabdruck einmalig alle ersetzt");
  assert.equal(deleted.length, names.length);
  deleted.length = 0; created.length = 0;
  for (const name of names) existing.set(name, emoji(name));
  assert.equal(await syncCorleoneEmojis(client, store), 0, "danach bleibt alles stehen");
  assert.deepEqual([deleted.length, created.length], [0, 0]);
});

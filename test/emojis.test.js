import test from "node:test";
import assert from "node:assert/strict";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { yamamotoText, setYamamotoEmojiIds, transformBody } from "../src/emojis.js";
import { EMOJI_SET } from "../src/emoji-set.js";
import fs from "node:fs";

test("Yamamoto-Emojis: jedes Emoji hat ein Bild mit gültigem Namen", () => {
  for (const [name] of Object.values(EMOJI_SET)) {
    assert.match(name, /^[a-z0-9_]{2,32}$/);
    assert.ok(fs.existsSync(new URL(`../assets/emojis/${name}.png`, import.meta.url)), name);
  }
});

test("Yamamoto-Emojis: Text, Karten und Knöpfe werden ersetzt, Unbekanntes bleibt", () => {
  setYamamotoEmojiIds({ ym_check: "111", ym_warning: "222", ym_trophy: "333" });
  assert.equal(yamamotoText("✅ ok ⚠️ achtung ⚠ ohne Zeichen 😀"), "<:ym_check:111> ok <:ym_warning:222> achtung <:ym_warning:222> ohne Zeichen 😀");
  const body = transformBody({
    content: "🏆 Sieger",
    embeds: [new EmbedBuilder().setTitle("🏆 Rangliste").setDescription("✅ fertig").setFooter({ text: "🏆 YAMAMOTO" }).addFields({ name: "✅ A", value: "⚠️ B" }).toJSON()],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("a").setLabel("Ok").setEmoji("✅").setStyle(ButtonStyle.Success)).toJSON()],
  });
  assert.equal(body.content, "<:ym_trophy:333> Sieger");
  assert.equal(body.embeds[0].title, "<:ym_trophy:333> Rangliste");
  assert.equal(body.embeds[0].footer.text, "YAMAMOTO", "Footer kann keine eigenen Emojis – entfernt");
  assert.equal(body.embeds[0].fields[0].value, "<:ym_warning:222> B");
  assert.deepEqual(body.components[0].components[0].emoji, { id: "111", name: "ym_check", animated: false });
});

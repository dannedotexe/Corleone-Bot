import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers.js";
import { createInfoCardService, updateInfoCard, validateInfoCard } from "../src/info-cards.js";

const G = "100000000000000001";
function fakeChannel(id, name, messages) {
  const sent = [];
  const channel = {
    id, name, isTextBased: () => true, isThread: () => false, sent,
    messages: {
      fetch: async arg => {
        if (typeof arg === "string") { const m = [...messages, ...sent].find(x => x.id === arg); if (!m) throw new Error("unknown"); return m; }
        return new Map(messages.map(m => [m.id, m]));
      },
    },
    send: async payload => { const m = { id: `bot-${sent.length + 1}`, payload, edit: async p => { m.payload = p; } }; sent.push(m); return m; },
  };
  return channel;
}

test("Info-Karte: Prüfung", () => {
  assert.throws(() => validateInfoCard({}), /Titel oder Text/);
  assert.throws(() => validateInfoCard({ description: "@everyone hallo" }), /everyone/);
  assert.equal(validateInfoCard({ title: "a", color: "zzz" }).color, "#f2f2f2");
});

test("Info-Karte: optionales Bild (nur https)", async () => {
  const { infoCardPayload } = await import("../src/info-cards.js");
  const card = validateInfoCard({ title: "a", imageUrl: "https://example.org/banner.png" });
  assert.equal(infoCardPayload(card).embeds[0].data.image.url, "https://example.org/banner.png");
  assert.throws(() => validateInfoCard({ title: "a", imageUrl: "http://example.org/x.png" }), /https/);
  assert.equal(infoCardPayload(validateInfoCard({ title: "a" })).embeds[0].data.image, undefined);
});

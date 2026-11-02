import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers.js";
import { createFinance } from "../src/services/finance.js";
import { createHandler } from "../src/commands.js";
import { loadConfig } from "../src/config.js";

const GUILD = "10000000000000001", FINANCE_ROLE = "20000000000000002", STAFF_ROLE = "20000000000000003";
const FINANCE_USER = "30000000000000001", MEMBER = "30000000000000002", OWNER = "30000000000000003";

function setup() {
  const db = testDb(), finance = createFinance(db);
  const config = loadConfig({ DISCORD_TOKEN: "test-only", DISCORD_CLIENT_ID: "12345678901234567", DISCORD_GUILD_ID: GUILD, ROLE_FINANCE: FINANCE_ROLE, ROLE_STAFF: STAFF_ROLE, BOT_OWNER_IDS: OWNER });
  const dms = [];
  const client = { ws: { ping: 1 }, user: { id: "bot" }, users: { fetch: async id => ({ send: async payload => { dms.push({ id, payload }); } }) } };
  const handler = createHandler({ db, finance, config, client });
  return { db, finance, handler, dms, client };
}

function interaction({ userId, roles = [], command, sub, options = {}, id = String(Math.random()) }) {
  const replies = [];
  return {
    id, replies, commandName: command, guildId: GUILD, user: { id: userId, bot: false },
    member: { roles: { cache: new Map(roles.map(role => [role, true])) } },
    inGuild: () => true, isChatInputCommand: () => true,
    options: {
      getSubcommand: () => sub,
      getUser: name => options[name] ? { id: options[name], bot: false } : null,
      getString: name => options[name] ?? null,
      getInteger: name => options[name] ?? null,
    },
    reply: async payload => { replies.push(payload); return payload; },
  };
}

function buttonFor(previewInteraction, payload, userId, roles) {
  const customId = payload.components[0].components[0].data.custom_id;
  const updates = [], replies = [];
  return {
    customId, updates, replies, guildId: GUILD, user: { id: userId }, member: { roles: { cache: new Map(roles.map(role => [role, true])) } },
    inGuild: () => true, isButton: () => true,
    message: { interaction: { id: previewInteraction.id } },
    update: async p => { updates.push(p); }, reply: async p => { replies.push(p); },
  };
}

const text = payload => JSON.stringify(payload.embeds?.map(e => e.data ?? e) ?? payload.content);

test("normale Mitglieder können keine Gutschrift buchen; Finanzrolle schon", async () => {
  const x = setup();
  const denied = interaction({ userId: MEMBER, command: "konto", sub: "gutschrift", options: { mitglied: MEMBER, betrag: "1000", grund: "Selbstbedienung" } });
  await x.handler.command(denied);
  assert.match(text(denied.replies[0]), /Finanzrolle/);
  assert.equal(x.finance.balance(GUILD, MEMBER), 0);
  const allowed = interaction({ userId: FINANCE_USER, roles: [FINANCE_ROLE], command: "konto", sub: "gutschrift", options: { mitglied: MEMBER, betrag: "1000", grund: "Event" } });
  await x.handler.command(allowed);
  assert.equal(x.finance.balance(GUILD, MEMBER), 100000);
  // Gleiche Interaktions-ID (Discord-Retry) bucht nicht doppelt.
  await x.handler.command({ ...allowed, replies: [], reply: async () => {} });
  assert.equal(x.finance.balance(GUILD, MEMBER), 100000);
});

test("fremde Konten und Sanktionen sind für Mitglieder gesperrt", async () => {
  const x = setup();
  const peek = interaction({ userId: MEMBER, command: "konto", sub: "ansehen", options: { mitglied: FINANCE_USER } });
  await x.handler.command(peek);
  assert.match(text(peek.replies[0]), /Finanzrolle/);
  const sanction = interaction({ userId: MEMBER, command: "sanktion", sub: "erstellen", options: { mitglied: FINANCE_USER, betrag: "10", grund: "x" } });
  await x.handler.command(sanction);
  assert.match(text(sanction.replies[0]), /Staff- oder Sanktions-Rolle/);
  assert.equal(x.db.prepare("SELECT COUNT(*) n FROM sanctions").get().n, 0);
});

test("Bot-Owner-Override funktioniert nur protokolliert", async () => {
  const x = setup();
  await x.handler.command(interaction({ userId: OWNER, command: "sanktion", sub: "erstellen", options: { mitglied: MEMBER, betrag: "10", grund: "Test" } }));
  assert.equal(x.db.prepare("SELECT COUNT(*) n FROM sanctions").get().n, 1);
  assert.match(x.db.prepare("SELECT details FROM audit_logs WHERE action='admin.override'").get().details, /sanktion erstellen/);
});

test("Auszahlung: Vorschau, doppelter Klick und genau eine Buchung", async () => {
  const x = setup();
  x.finance.credit({ guildId: GUILD, userId: MEMBER, actorId: FINANCE_USER, cents: 250_000_000, reason: "Event", key: "seed" });
  x.finance.sanction({ guildId: GUILD, userId: MEMBER, actorId: FINANCE_USER, cents: 50_000_000, reason: "Verstoß" });
  const preview = interaction({ userId: FINANCE_USER, roles: [FINANCE_ROLE], command: "konto", sub: "auszahlen", options: { mitglied: MEMBER } });
  await x.handler.command(preview);
  const previewText = text(preview.replies[0]);
  for (const expected of ["$2.500.000,00", "$500.000,00", "$2.000.000,00", "Verbleibende Sanktionen"]) assert.ok(previewText.includes(expected), expected);
  assert.equal(x.finance.balance(GUILD, MEMBER), 250_000_000, "Vorschau bucht nichts");

  const outsider = buttonFor(preview, preview.replies[0], MEMBER, []);
  await x.handler.button(outsider);
  assert.match(text(outsider.replies[0]), /Finanzrolle/);
  assert.equal(x.finance.balance(GUILD, MEMBER), 250_000_000);

  const first = buttonFor(preview, preview.replies[0], FINANCE_USER, [FINANCE_ROLE]);
  const second = buttonFor(preview, preview.replies[0], FINANCE_USER, [FINANCE_ROLE]);
  await Promise.all([x.handler.button(first), x.handler.button(second)]);
  assert.equal(x.db.prepare("SELECT COUNT(*) n FROM transactions WHERE type='payout'").get().n, 1);
  assert.equal(x.db.prepare("SELECT COUNT(*) n FROM payout_allocations").get().n, 1);
  assert.match(text(second.updates[0]), /bereits verbucht/);
  assert.equal(x.finance.balance(GUILD, MEMBER), 0);
  assert.equal(x.dms.length, 1, "Mitglied wird genau einmal benachrichtigt");
});

test("Tickets: /add und /remove, umbenennen, freigeben – nur Staff, nur offene Tickets", async () => {
  const { db, handler } = setup();
  const now = new Date().toISOString(), CH = "60000000000000009", GUEST = "30000000000000009";
  db.prepare("INSERT INTO tickets(id,guild_id,channel_id,user_id,category,status,claimed_by,created_at,updated_at) VALUES('t1',?,?,?,'support','open',?,?,?)").run(GUILD, CH, MEMBER, OWNER, now, now);
  const overwrites = new Map(), sent = [], names = [];
  const channel = { id: CH, send: async p => { sent.push(p); return {}; }, setName: async n => { names.push(n); }, messages: { fetch: async () => null },
    permissionOverwrites: { cache: overwrites, edit: async (id, perms) => { overwrites.set(id, perms); }, delete: async id => { overwrites.delete(id); } } };
  const run = async (command, sub, options, userId = OWNER, roles = []) => {
    const i = interaction({ userId, roles, command, sub, options }); i.channelId = CH; i.channel = channel; i.options.getUser = name => options[name] ? { id: options[name], bot: false } : null;
    await handler.command(i); return JSON.stringify(i.replies.at(-1));
  };
  assert.match(await run("add", undefined, { mitglied: GUEST }, MEMBER), /Staff/, "Ersteller darf nicht hinzufügen");
  assert.match(await run("add", undefined, { mitglied: GUEST }), /kann das Ticket jetzt sehen/);
  assert.equal(overwrites.get(GUEST).SendMessages, true);
  assert.match(sent.at(-1).content, /hinzugefügt/);
  assert.match(await run("ticketadd", undefined, { mitglied: GUEST }), /bereits/);
  assert.match(await run("ticket", "hinzufuegen", { mitglied: MEMBER }), /Ersteller/);
  assert.match(await run("ticketremove", undefined, { mitglied: GUEST }), /entfernt/);
  assert.equal(overwrites.has(GUEST), false);
  assert.match(await run("ticket", "umbenennen", { name: "Auszahlung Tony!" }), /auszahlung-tony/);
  assert.deepEqual(names, ["auszahlung-tony"]);
  assert.match(await run("ticket", "freigeben", {}), /freigegeben/);
  assert.equal(db.prepare("SELECT claimed_by FROM tickets WHERE id='t1'").get().claimed_by, null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action LIKE 'ticket.member_%'").get().n, 2);
});

import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers.js";
import { buildTournamentBoard, refreshTournamentBoard, tournamentButtons, tournamentStandings, tournamentWindow } from "../src/invite-tournament.js";

const G = "100000000000000001", A = "100000000000000011", B = "100000000000000012";
const config = { DISCORD_GUILD_ID: G, TIMEZONE: "Europe/Vienna", INVITE_TOURNAMENT_START: "2026-10-28", INVITE_TOURNAMENT_END: "2026-11-15", CHANNEL_INVITE_TOURNAMENT: "300000000000000001", TASK_REJECT_REASONS: ["Doppelt eingereicht"] };
function seed(db) {
  const now = "2026-10-28T10:00:00.000Z";
  db.prepare("INSERT INTO task_types(id,guild_id,name,emoji,reward_cents,per_unit,unit,active,sort,invite_min_days,invite_min_events,created_at,updated_at) VALUES('inv',?,'Invite – gute Leute','🤝',5000000,0,'Invite',1,0,2,4,?,?)").run(G, now, now);
  db.prepare("INSERT INTO task_types(id,guild_id,name,emoji,reward_cents,per_unit,unit,active,sort,created_at,updated_at) VALUES('sol',?,'Solar','☀️',100,0,'Stück',1,1,?,?)").run(G, now, now);
  let n = 0;
  const log = (user, type, status, created, reason = null) => db.prepare("INSERT INTO task_logs(id,guild_id,user_id,type_id,status,reject_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(`l${++n}`, G, user, type, status, reason, created, created);
  log(A, "inv", "approved", "2026-10-28T09:00:00.000Z");
  log(A, "inv", "approved", "2026-11-02T09:00:00.000Z");
  log(A, "inv", "rejected", "2026-11-03T09:00:00.000Z", "High-ID (−1 Turnier-Punkt)");
  log(A, "inv", "rejected", "2026-11-03T10:00:00.000Z", "Doppelt eingereicht"); // zählt nicht
  log(B, "inv", "rejected", "2026-11-04T10:00:00.000Z", "−1 im Invite-Turnier");
  log(B, "inv", "approved", "2026-11-15T22:30:00.000Z"); // 23:30 Wien am 15.11. → zählt
  log(B, "inv", "approved", "2026-11-15T23:30:00.000Z"); // 16.11. Wien → zählt nicht
  log(B, "inv", "approved", "2026-10-27T22:30:00.000Z"); // 27.10. 23:30 Wien → zählt nicht
  log(B, "inv", "pending", "2026-11-01T09:00:00.000Z");
  log(B, "sol", "approved", "2026-11-01T09:00:00.000Z"); // keine Invite-Aufgabe
}

test("Invite-Turnier: Punkte nach Einreichungstag, High-ID −1", () => {
  const db = testDb(); seed(db);
  const rows = tournamentStandings(db, G, tournamentWindow(config));
  assert.deepEqual(rows.map(r => [r.userId, r.points, r.plus, r.minus]), [[A, 1, 2, 1], [B, 0, 1, 1]]);
  const board = buildTournamentBoard(db, G, config, new Date("2026-11-01T12:00:00Z")).embeds[0].data;
  assert.equal(board.title, "🏆 Rangliste");
  assert.match(board.description, /🥇 <@100000000000000011> · \*\*1 Punkt\*\* \(\+2 \/ −1\)/);
  assert.equal(buildTournamentBoard(db, G, config, new Date("2026-11-16T12:00:00Z")).embeds[0].data.title, "🏆 Endstand");
});

test("Invite-Turnier: Nachricht wird einmal gepostet und danach nur bei Änderungen bearbeitet", async () => {
  const db = testDb(); seed(db);
  const sent = [], edits = [];
  const channel = { id: config.CHANNEL_INVITE_TOURNAMENT, send: async p => { const m = { id: "m1", edit: async q => edits.push(q) }; sent.push(m); return m; }, messages: { fetch: async id => sent.find(m => m.id === id) } };
  const client = { channels: { fetch: async () => channel } };
  assert.equal(await refreshTournamentBoard({ db, client, config, reference: new Date("2026-11-01T12:00:00Z") }), true);
  assert.equal(await refreshTournamentBoard({ db, client, config, reference: new Date("2026-11-01T12:01:00Z") }), false, "unverändert");
  db.prepare("UPDATE task_logs SET status='approved' WHERE id='l9'").run();
  assert.equal(await refreshTournamentBoard({ db, client, config, reference: new Date("2026-11-01T12:02:00Z") }), true);
  assert.equal(sent.length, 1); assert.equal(edits.length, 1);
});

test("Invite-Turnier: +1/−1-Knöpfe nur bei Invite-Logs während des Turniers", () => {
  const invite = { type_name: "Invite – gute Leute", invite_min_days: 2 }, solar = { type_name: "Solar" };
  assert.equal(tournamentButtons(config, invite, new Date("2026-11-01T12:00:00Z")), true);
  assert.equal(tournamentButtons(config, solar, new Date("2026-11-01T12:00:00Z")), false);
  assert.equal(tournamentButtons(config, invite, new Date("2026-11-15T22:59:00Z")), true, "15.11. 23:59 Wien");
  assert.equal(tournamentButtons(config, invite, new Date("2026-11-15T23:00:00Z")), false, "ab 16.11. wieder normal");
  assert.equal(tournamentButtons({ ...config, CHANNEL_INVITE_TOURNAMENT: "" }, invite, new Date("2026-11-01T12:00:00Z")), false);
});

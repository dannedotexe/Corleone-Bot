import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers.js";
import { guardBotOnlyRoles } from "../src/role-guard.js";

const G = "100000000000000001", ROLE = "200000000000000001", BOT = "900000000000000001", MOD = "300000000000000001";
function setup({ executor, verified = false }) {
  const db = testDb(), removed = [];
  if (verified) db.prepare("INSERT INTO member_verifications(guild_id,user_id,first_name,last_name,ingame_id,nickname,verified_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(G, "u1", "A", "B", "1", "A B | 1", "x", "x");
  const guild = { id: G, fetchAuditLogs: async () => ({ entries: [{ target: { id: "u1" }, createdTimestamp: Date.now(), executor: { id: executor }, changes: [{ key: "$add", new: [{ id: ROLE }] }] }] }) };
  const member = { id: "u1", guild, user: { bot: false }, roles: { cache: new Map([[ROLE, true]]), remove: async id => { removed.push(id); } } };
  const oldMember = { roles: { cache: new Map() } };
  return { db, removed, args: { db, client: { user: { id: BOT } }, config: { ROLE_BOT_ONLY: [ROLE] }, oldMember, member, wait: 0 } };
}

test("Von Hand vergebene Bot-Rolle wird entfernt", async () => {
  const { removed, args } = setup({ executor: MOD });
  assert.deepEqual(await guardBotOnlyRoles(args), [ROLE]);
  assert.deepEqual(removed, [ROLE]);
});

test("Vom Bot vergebene Rolle bleibt, ebenso bei Verifizierten", async () => {
  assert.deepEqual(await guardBotOnlyRoles(setup({ executor: BOT }).args), []);
  assert.deepEqual(await guardBotOnlyRoles(setup({ executor: MOD, verified: true }).args), []);
});

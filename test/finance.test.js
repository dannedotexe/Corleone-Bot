import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers.js";
import { createFinance, parseMoney } from "../src/services/finance.js";

const ctx=()=>{const db=testDb();return {db,finance:createFinance(db),g:"guild-test",user:"member-test",staff:"staff-test"};};
const credit=(x,cents,key="credit-1")=>x.finance.credit({guildId:x.g,userId:x.user,actorId:x.staff,cents,reason:"Event",key});
const sanction=(x,cents)=>x.finance.sanction({guildId:x.g,userId:x.user,actorId:x.staff,cents,reason:"Regelverstoß"});

test("amount parsing uses integer cents",()=>{assert.equal(parseMoney("2500000"),250000000);assert.equal(parseMoney("12,5"),1250);assert.throws(()=>parseMoney("0"));assert.throws(()=>parseMoney("2.500,00"));});
test("sanction does not debit account until payout; full deduction is exact",()=>{const x=ctx();credit(x,250000000);sanction(x,50000000);assert.equal(x.finance.balance(x.g,x.user),250000000);const tx=x.finance.payout({guildId:x.g,userId:x.user,actorId:x.staff,key:"payout-full"});assert.equal(tx.gross_cents,250000000);assert.equal(tx.deduction_cents,50000000);assert.equal(tx.net_cents,200000000);assert.equal(x.finance.balance(x.g,x.user),0);assert.equal(x.db.prepare("SELECT status,remaining_cents FROM sanctions").get().status,"paid");assert.equal(x.db.prepare("SELECT COUNT(*) n FROM payout_allocations WHERE payout_id=?").get(tx.id).n,1);});
test("payout partially applies sanctions and carries only the remainder",()=>{const x=ctx();credit(x,10000);const id=sanction(x,18000);const tx=x.finance.payout({guildId:x.g,userId:x.user,actorId:x.staff,key:"payout-partial"});assert.equal(tx.deduction_cents,10000);assert.equal(tx.net_cents,0);assert.deepEqual({...x.db.prepare("SELECT status,remaining_cents FROM sanctions WHERE id=?").get(id)},{status:"partial",remaining_cents:8000});credit(x,15000,"credit-next");const next=x.finance.payout({guildId:x.g,userId:x.user,actorId:x.staff,key:"payout-next"});assert.equal(next.deduction_cents,8000);assert.equal(next.net_cents,7000);assert.equal(x.db.prepare("SELECT remaining_cents FROM sanctions WHERE id=?").get(id).remaining_cents,0);});
test("repeated payout idempotency key cannot deduct twice",()=>{const x=ctx();credit(x,5000);sanction(x,2000);const first=x.finance.payout({guildId:x.g,userId:x.user,actorId:x.staff,key:"same"});const second=x.finance.payout({guildId:x.g,userId:x.user,actorId:x.staff,key:"same"});assert.equal(second.id,first.id);assert.equal(x.db.prepare("SELECT COUNT(*) n FROM transactions WHERE type='payout'").get().n,1);assert.equal(x.db.prepare("SELECT COUNT(*) n FROM payout_allocations").get().n,1);});
test("a failed sanction allocation rolls the entire payout back",()=>{const x=ctx();credit(x,10000);sanction(x,3000);x.db.exec("CREATE TRIGGER fail_allocation BEFORE INSERT ON payout_allocations BEGIN SELECT RAISE(ABORT,'forced failure'); END;");assert.throws(()=>x.finance.payout({guildId:x.g,userId:x.user,actorId:x.staff,key:"failed"}),/forced failure/);assert.equal(x.finance.balance(x.g,x.user),10000);assert.equal(x.db.prepare("SELECT COUNT(*) n FROM transactions WHERE type='payout'").get().n,0);assert.equal(x.db.prepare("SELECT remaining_cents FROM sanctions").get().remaining_cents,3000);});
test("sanction refund is audited, credited once, and voids any remainder",()=>{const x=ctx();credit(x,10000);const id=sanction(x,6000);x.finance.payout({guildId:x.g,userId:x.user,actorId:x.staff,key:"paid-part"});assert.equal(x.finance.balance(x.g,x.user),0);assert.throws(()=>x.finance.voidSanction({guildId:x.g,sanctionId:id,actorId:x.staff,reason:"Test"}),/Offene Sanktion/);const refund=x.finance.refundSanction({guildId:x.g,sanctionId:id,actorId:x.staff,reason:"Korrektur",key:"refund-1"});assert.equal(refund.amount_cents,6000);assert.equal(x.finance.balance(x.g,x.user),6000);assert.equal(x.db.prepare("SELECT status FROM sanctions WHERE id=?").get(id).status,"void");const repeated=x.finance.refundSanction({guildId:x.g,sanctionId:id,actorId:x.staff,reason:"Korrektur",key:"refund-1"});assert.equal(repeated.id,refund.id);assert.equal(x.finance.balance(x.g,x.user),6000);});

test("Ohne Familienkonto (z. B. Inhaber): kein Konto, keine Gutschrift, andere unverändert", async () => {
  const { setSetting } = await import("../src/database.js");
  const db = testDb(), f = createFinance(db), G = "10000000000000001", OWNER = "20000000000000009", M = "20000000000000001";
  setSetting(db, G, "ACCOUNT_EXCLUDED_USERS", `${OWNER}`);
  assert.equal(f.isExcluded(G, OWNER), true);
  assert.throws(() => f.openAccount({ guildId: G, userId: OWNER, actorId: M }), /kein Familienkonto/);
  assert.throws(() => f.credit({ guildId: G, userId: OWNER, actorId: M, cents: 100, reason: "x", key: "k1" }), /kein Familienkonto/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM accounts WHERE user_id=?").get(OWNER).n, 0);
  f.credit({ guildId: G, userId: M, actorId: OWNER, cents: 100, reason: "x", key: "k2" });
  assert.equal(f.balance(G, M), 100);
});

test("Geldbeträge: k, m, Mio, kk, Tausenderpunkte, Komma – überall gleich", async () => {
  const { parseAmount } = await import("../src/services/finance.js");
  const { toRaw } = await import("../src/services/settings.js");
  const $ = n => Math.round(n * 100);
  const cases = { "25000": 25000, "25.000": 25000, "2.500.000": 2500000, "25 000": 25000, "$12,50": 12.5, "12.5": 12.5, "25k": 25000, "25K": 25000, "1,5k": 1500, "2.5m": 2500000, "2,5 Mio": 2500000, "3kk": 3000000, "1m": 1000000, "250 tsd": 250000, "1,25m": 1250000 };
  for (const [input, dollars] of Object.entries(cases)) assert.equal(parseAmount(input), $(dollars), input);
  for (const bad of ["", "abc", "0", "-5", "5x", "1,2,3", "2000m"]) assert.equal(parseAmount(bad), null, bad);
  assert.equal(parseMoney("250k"), $(250000));
  assert.throws(() => parseMoney("viel"), /250k, 2,5m/);
  assert.equal(toRaw({ type: "money", label: "Mindestbetrag" }, "500k"), String($(500000)));
  assert.equal(toRaw({ type: "money", label: "Mindestbetrag" }, ""), "");
});

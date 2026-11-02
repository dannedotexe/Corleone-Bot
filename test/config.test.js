import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, requireRole } from "../src/config.js";

const ids={DISCORD_TOKEN:"test-only",DISCORD_CLIENT_ID:"12345678901234567"};
test("configuration requires token and valid application id",()=>{assert.throws(()=>loadConfig({}),/Ungültige Konfiguration/);assert.throws(()=>loadConfig({...ids,DISCORD_CLIENT_ID:"bad"}),/DISCORD_CLIENT_ID/);});
test("Bewerbungen laufen über ihr eigenes Panel statt als Ticket-Kategorie",()=>{const cfg=loadConfig({...ids});assert.deepEqual(cfg.TICKET_CATEGORIES_JSON.map(x=>x.id),["support","beschwerde","leitung"]);const custom=loadConfig({...ids,TICKET_CATEGORIES_JSON:JSON.stringify([{id:"bewerbung",label:"Bewerbung",roleIds:[]},{id:"support",label:"Support",roleIds:[]}])});assert.deepEqual(custom.TICKET_CATEGORIES_JSON.map(x=>x.id),["support"]);});
test("missing staff roles fail closed and role strings are parsed",()=>{const cfg=loadConfig({...ids,ROLE_FINANCE:"12345678901234567,12345678901234568"});assert.equal(cfg.ROLE_FINANCE.length,2);assert.match(requireRole({inGuild:()=>true,member:{roles:{cache:new Map()}}},[]),/nicht konfiguriert/);});
test("configured bot owner can use role-restricted commands without a Discord role",()=>{const owner=ids.DISCORD_CLIENT_ID,cfg=loadConfig({...ids,BOT_OWNER_IDS:owner});assert.deepEqual(cfg.BOT_OWNER_IDS,[owner]);const interaction={inGuild:()=>true,user:{id:owner},client:{yamamotoOwnerIds:cfg.BOT_OWNER_IDS},member:{roles:{cache:new Map()}}};assert.equal(requireRole(interaction,[],"Finanzrolle"),null);interaction.user.id="different-user";assert.match(requireRole(interaction,[],"Finanzrolle"),/nicht konfiguriert/);});
test("Staff-Webdashboard bleibt optional, erlaubt Owner-Zugriff und verlangt HTTPS/OAuth",()=>{assert.equal(loadConfig({...ids,DASHBOARD_PUBLIC_URL:""}).DASHBOARD_ENABLED,false);assert.throws(()=>loadConfig({...ids,DASHBOARD_ENABLED:"true"}),/DASHBOARD_PUBLIC_URL/);const common={...ids,DISCORD_GUILD_ID:"22345678901234567",DASHBOARD_ENABLED:"true",DASHBOARD_BIND:"127.0.0.1",DASHBOARD_PUBLIC_URL:"https://130.61.188.221",DISCORD_CLIENT_SECRET:"oauth-secret",DASHBOARD_SESSION_SECRET:"x".repeat(40)};const cfg=loadConfig({...common,ROLE_STAFF:"32345678901234567"});assert.equal(cfg.DASHBOARD_ENABLED,true);assert.equal(loadConfig({...common,BOT_OWNER_IDS:ids.DISCORD_CLIENT_ID}).DASHBOARD_ENABLED,true);assert.throws(()=>loadConfig({...common,DASHBOARD_BIND:"0.0.0.0",ROLE_STAFF:"32345678901234567"}),/DASHBOARD_BIND/);assert.throws(()=>loadConfig({...common}),/BOT_OWNER_IDS/);});

test("Einstellungen: jede Einstellung steht in genau einem Thema der Website", async () => {
  const { SETTINGS, SETTING_SECTIONS } = await import("../src/services/settings.js");
  const listed = SETTING_SECTIONS.flatMap(s => s.keys);
  assert.equal(new Set(listed).size, listed.length, "kein Schlüssel doppelt");
  const missing = SETTINGS.map(s => s.key).filter(k => !listed.includes(k));
  assert.deepEqual(missing, [], "neue Einstellungen bitte in SETTING_SECTIONS eintragen");
  assert.deepEqual(listed.filter(k => !SETTINGS.some(s => s.key === k)), [], "keine Schlüssel ohne Einstellung");
});

test("Sanktions-Rolle darf erstellen und verwalten, Staff nur erstellen", async () => {
  const { accessGroups } = await import("../src/config.js");
  const g = accessGroups({ ROLE_LEADERS: ["L"], ROLE_STAFF: ["S"], ROLE_SANCTIONS: ["R7"] });
  assert.deepEqual(g.sanctions.sort(), ["L", "R7", "S"]);
  assert.deepEqual(g.sanctionManage.sort(), ["L", "R7"]);
});

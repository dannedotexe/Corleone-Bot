import { Client, Events, GatewayIntentBits, MessageFlags, Partials } from "discord.js";
import { accessGroups, configWarnings, loadConfig } from "./src/config.js";
import { getSetting, openDatabase, setSetting } from "./src/database.js";
import { createFinance } from "./src/services/finance.js";
import { createHandler, handleComponent } from "./src/commands.js";
import { LOGBOOK_FORUMS, activeLogbookKinds, archiveLogbook, ensureLogbook, syncLogbookTemplates, applyLogbookTemplate, templateKindOf, familyOf, reopenLogbook, renameLogbook, guardLogbookName, logbookTitle } from "./src/logbooks.js";
import { handleLogbookMessage } from "./src/task-logs.js";
import { refreshEventPosts } from "./src/event-posts.js";
import { handleSuggestionMessage } from "./src/suggestions.js";
import { updateAbsenceList } from "./src/absence-posts.js";
import { startScheduler } from "./src/scheduler.js";
import { ensureFamilyRole, syncFamilyRoles } from "./src/family-role.js";
import { startModeration } from "./src/moderation.js";
import { createSettingsService } from "./src/services/settings.js";
import { createSeriesService } from "./src/services/event-series.js";
import { ensurePanels } from "./src/panels.js";
import { currentVersion } from "./src/version.js";
import { createDashboard } from "./src/dashboard.js";
import { createTicketService } from "./src/services/tickets.js";
import { createAccountClosureService } from "./src/services/account-closures.js";
import { createActivityService } from "./src/services/activity.js";
import { sendWelcome } from "./src/welcome.js";
import { trackRankChange } from "./src/rank-tracking.js";
import { syncCorleoneEmojis } from "./src/emojis.js";
import { guardBotOnlyRoles } from "./src/role-guard.js";

let config;
try { config=loadConfig(); }
catch(error){ console.error(error.message); process.exit(1); }

for(const warning of configWarnings(config))console.warn(`Konfigurationshinweis: ${warning}`);

let db;
try { db=openDatabase(config.DATABASE_PATH); }
catch(error){ console.error(`Datenbank konnte nicht geöffnet werden (${config.DATABASE_PATH}):`,error.message); process.exit(1); }
// Über Website/Discord gespeicherte Einstellungen überschreiben die .env-Startwerte (nur mit DISCORD_GUILD_ID).
const settings=config.DISCORD_GUILD_ID?createSettingsService({db,config,env:{...process.env},guildId:config.DISCORD_GUILD_ID}):null;
if(settings){const {rejected}=settings.apply();for(const item of rejected)console.warn(`Gespeicherte Einstellung ignoriert (ungültig): ${item}`);}
const series=createSeriesService(db);
if(config.DISCORD_GUILD_ID){const seeded=series.seedDefaults(config.DISCORD_GUILD_ID);if(seeded)console.log(`${seeded} Standard-Aktivitäten angelegt (inaktiv). Aktivieren über Website oder /aktivitaeten.`);}
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent],partials:[Partials.Channel,Partials.Message]});
const finance=createFinance(db);
const handlers=createHandler({db,finance,config,client,settings,series});
const dashboard=createDashboard({db,client,config,settings,series});

// Merkt sich, welche Emoji-Bilder schon hochgeladen sind (neues Design → alte Bot-Emojis werden ersetzt).
const emojiStore=config.DISCORD_GUILD_ID?{get:()=>getSetting(db,config.DISCORD_GUILD_ID,"EMOJI_HASHES"),set:value=>setSetting(db,config.DISCORD_GUILD_ID,"EMOJI_HASHES",value)}:null;
client.once(Events.ClientReady,ready=>{
  console.log(`Corleone Bot bereit als ${ready.user.tag} (Version ${currentVersion()}).`);
  startScheduler({db,client,config,series});
  void adoptNamedDefaults();
  // Alle Mitglieder in den Cache laden, damit Rollenwechsel (z. B. neue Familienrolle) zuverlässig erkannt werden.
  if(config.DISCORD_GUILD_ID)void ready.guilds.fetch(config.DISCORD_GUILD_ID).then(g=>g.members.fetch().then(()=>syncFamilyRoles({config,guild:g})).then(r=>{if(r?.added||r?.failed)console.log(`Familienrolle nachgezogen: ${r.added} vergeben, ${r.failed} fehlgeschlagen.`);})).catch(error=>console.warn("Mitglieder konnten nicht geladen werden:",error.message));
});
// Leere Einstellungen einmalig nach Channel-/Rollennamen übernehmen (nur bei genau einem Treffer). Gesetzt wird nur, was
// auf dem konfigurierten Server wirklich existiert und den richtigen Typ hat; jede Übernahme wird protokolliert.
const ADOPT_NAMES={CHANNEL_WELCOME:/^\W*willkommen$/i,CHANNEL_ABSENCES:/^\W*abmeldungen$/i,CHANNEL_BOT_SUGGESTIONS:/^\W*bot-?vorschl(ä|ae)ge$/i,CHANNEL_WEBSITE_PANEL:/^\W*dashboard$/i,CHANNEL_INVITE_TOURNAMENT:/^\W*invite-?turnier$/i};
async function adoptNamedDefaults(){
  // Eigene Corleone-Emojis hochladen bzw. laden, bevor Panels und Karten gebaut werden.
  await syncCorleoneEmojis(client,emojiStore).then(n=>{if(n)console.log(`${n} Corleone-Emojis hochgeladen.`);}).catch(error=>console.warn("Corleone-Emojis:",error.message));
  if(!settings)return;
  const guild=await client.guilds.fetch(config.DISCORD_GUILD_ID).catch(()=>null);
  if(!guild)return;
  const adopt=(key,value,label)=>{try{settings.update({key,value,actorId:client.user.id,actorIsOwner:true});console.log(`${label} eingestellt.`);return true;}catch(error){console.warn(`${label} konnte nicht eingestellt werden:`,error.message);return false;}};
  // Logbücher-Forum („aufgaben-logs“) übernehmen, wenn es genau ein passendes Forum gibt.
  if(!config.CHANNEL_TASK_FORUM&&!getSetting(db,guild.id,"ADOPTED_CHANNEL_TASK_FORUM")){const forums=[...(await guild.channels.fetch().catch(()=>new Map())).values()].filter(ch=>ch?.type===15&&/aufgaben-?logs?/i.test(ch.name));if(forums.length===1&&adopt("CHANNEL_TASK_FORUM",forums[0].id,`Logbücher-Forum (#${forums[0].name})`))setSetting(db,guild.id,"ADOPTED_CHANNEL_TASK_FORUM",new Date().toISOString());}
  if(!config.CHANNEL_EVENT_FORUM&&!getSetting(db,guild.id,"ADOPTED_CHANNEL_EVENT_FORUM")){const forums=[...(await guild.channels.fetch().catch(()=>new Map())).values()].filter(ch=>ch?.type===15&&/event-?logs?/i.test(ch.name));if(forums.length===1&&adopt("CHANNEL_EVENT_FORUM",forums[0].id,`Event-Logbücher-Forum (#${forums[0].name})`))setSetting(db,guild.id,"ADOPTED_CHANNEL_EVENT_FORUM",new Date().toISOString());}
  // Ausgenommene Personen: leeres Konto ohne offene Sanktionen entfernen; mit Guthaben bleibt es, bis die Leitung entscheidet.
  for(const userId of String(getSetting(db,guild.id,"ACCOUNT_EXCLUDED_USERS")??"").split(",").map(v=>v.trim()).filter(Boolean)){
    const account=db.prepare("SELECT balance_cents FROM accounts WHERE guild_id=? AND user_id=?").get(guild.id,userId);
    if(!account)continue;
    const open=db.prepare("SELECT COUNT(*) n FROM sanctions WHERE guild_id=? AND user_id=? AND status IN ('open','partial')").get(guild.id,userId).n;
    if(account.balance_cents===0&&!open){try{finance.closeAccount({guildId:guild.id,userId,actorId:client.user.id,reason:"Ohne Familienkonto (ausgenommen)",key:`account-excluded:${userId}`});console.log(`Familienkonto von ${userId} entfernt (ausgenommen).`);}catch(error){console.warn("Konto konnte nicht entfernt werden:",error.message);}}
    else console.warn(`Familienkonto von ${userId} hat noch Guthaben/Sanktionen – bitte auf der Website auszahlen bzw. löschen.`);
  }
  // Willkommens- und Abmeldungs-Channel nach Namen übernehmen, wenn es genau einen passenden gibt.
  const allChannels=[...(await guild.channels.fetch().catch(()=>new Map())).values()].filter(ch=>ch?.isTextBased?.());
  for(const [key,pattern] of Object.entries(ADOPT_NAMES)){
    if(config[key])continue;
    const plain=ch=>String(ch.name).replace(/^[^a-z0-9äöüß]+/i,"");
    const matches=allChannels.filter(ch=>pattern.test(plain(ch)));
    if(matches.length===1&&adopt(key,matches[0].id,`${{CHANNEL_WELCOME:"Willkommens",CHANNEL_ABSENCES:"Abmeldungs",CHANNEL_BOT_SUGGESTIONS:"Bot-Vorschläge",CHANNEL_WEBSITE_PANEL:"Website-Panel",CHANNEL_INVITE_TOURNAMENT:"Invite-Turnier"}[key]}-Channel (#${matches[0].name})`)&&key!=="CHANNEL_WELCOME")await ensurePanels({db,client,config,series,only:[key]}).catch(()=>{});
  }
  if(!config.CHANNEL_VERIFICATION_PANEL){
    const matches=[...(await guild.channels.fetch().catch(()=>new Map())).values()].filter(ch=>ch?.isTextBased?.()&&/neue-spieler/i.test(ch.name));
    if(matches.length===1&&adopt("CHANNEL_VERIFICATION_PANEL",matches[0].id,`Verifizierungs-Panel-Channel (#${matches[0].name})`))await ensurePanels({db,client,config,series,only:["CHANNEL_VERIFICATION_PANEL"]}).catch(()=>{});
  }
  // Offene Event-Karten bei jedem Start neu aufbauen, damit neue Knöpfe/Texte (z. B. „👥 Verwalten“) auch an älteren Karten erscheinen.
  for(const row of db.prepare("SELECT * FROM events WHERE guild_id=? AND status='scheduled' AND message_id IS NOT NULL AND starts_at>=? ORDER BY starts_at LIMIT 30").all(guild.id,new Date(Date.now()-12*3_600_000).toISOString())){
    await refreshEventPosts({db,client,config,event:row,cardOnly:true}).catch(()=>{});
    await new Promise(r=>setTimeout(r,500));
  }
  await updateAbsenceList({db,client,config,force:true}).catch(()=>{});
  // Geänderte Vorlage (Standardtext oder „Vorlage …“-Post) in die bestehenden Bot-Posts übernehmen.
  for(const kind of activeLogbookKinds(config)){const r=await applyLogbookTemplate({db,client,config,guildId:guild.id,kind,force:false}).catch(()=>({updated:0}));if(r.updated||r.failed)console.log(`${LOGBOOK_FORUMS[kind].label}: Text in ${r.updated} Posts aktualisiert${r.failed?`, ${r.failed} fehlgeschlagen`:""} (Quelle: ${r.source}).`);}
}
client.on(Events.InteractionCreate,async interaction=>{
  try {
    if(interaction.isAutocomplete()) await handlers.autocomplete(interaction);
    else if(interaction.isChatInputCommand()) await handlers.command(interaction);
    else await handleComponent(interaction,handlers);
  } catch(error){
    console.error("Interaction failed:",error);
    if(interaction.isRepliable()&&!interaction.replied&&!interaction.deferred)await interaction.reply({content:"Die Aktion ist fehlgeschlagen. Bitte versuche es später erneut.",flags:MessageFlags.Ephemeral}).catch(()=>{});
  }
});
// Neue Familienmitglieder (Mitglieder-Rolle erhalten) bekommen automatisch ein Familienkonto.
// Rang-Rolle erhalten → Familienrolle dazu (danach greifen Logbücher, Konto usw. über das normale Rollen-Event).
client.on(Events.GuildMemberUpdate,(_old,member)=>{
  if(config.DISCORD_GUILD_ID&&member.guild.id!==config.DISCORD_GUILD_ID)return;
  void ensureFamilyRole({config,member}).then(added=>{if(added)console.log(`Familienrolle vergeben: ${member.displayName??member.id} (Rang-Rolle)`);}).catch(error=>console.warn("Familienrolle konnte nicht vergeben werden:",error.message));
});
client.on(Events.GuildMemberUpdate,(oldMember,member)=>{
  if(config.DISCORD_GUILD_ID&&member.guild.id!==config.DISCORD_GUILD_ID)return;
  void guardBotOnlyRoles({db,client,config,oldMember,member}).then(r=>{if(r.length)console.log(`Von Hand vergebene Bot-Rolle entfernt: ${member.displayName??member.id}`);}).catch(error=>console.warn("Rollenschutz:",error.message));
});
client.on(Events.GuildMemberUpdate,(oldMember,newMember)=>{void trackRankChange({db,config,oldMember,newMember}).catch(error=>console.warn("Rangänderung nicht protokolliert:",error.message));});
client.on(Events.GuildMemberUpdate,(_old,member)=>{
  try{
    if(!config.ACCOUNT_AUTO_OPEN_FOR_MEMBERS||member.user?.bot)return;
    if(config.DISCORD_GUILD_ID&&member.guild.id!==config.DISCORD_GUILD_ID)return;
    if(!(config.ROLE_MEMBERS??[]).some(id=>member.roles.cache.has(id))||finance.isExcluded(member.guild.id,member.id))return;
    finance.openAccount({guildId:member.guild.id,userId:member.id,actorId:client.user?.id??"system",note:"Familienmitglieder-Rolle erhalten"});
  }catch(error){console.error("Familienkonto konnte nicht automatisch angelegt werden:",error.message);}
});
// Familienrolle neu erhalten: Logbücher (Aufgaben, Events) anlegen – nur beim Wechsel von „ohne“ zu „mit“ Familie.
const logbookError=(guildId,message)=>setSetting(db,guildId,"LOGBOOK_LAST_ERROR",JSON.stringify({at:new Date().toISOString(),message}));
client.on(Events.GuildMemberUpdate,(oldMember,member)=>{
  if(!config.LOGBOOK_AUTO_CREATE||member.user?.bot||!activeLogbookKinds(config).length)return;
  if(config.DISCORD_GUILD_ID&&member.guild.id!==config.DISCORD_GUILD_ID)return;
  // Unbekannter Vorher-Zustand zählt als „neu“; doppelte Posts verhindert ensureLogbook.
  const had=oldMember?.partial||!oldMember?.roles?.cache?null:familyOf(config,oldMember.roles.cache);
  if(had===true||!familyOf(config,member.roles.cache))return;
  void (async()=>{
    for(const kind of activeLogbookKinds(config)){
      if(config.LOGBOOK_ARCHIVE)await reopenLogbook({db,client,guildId:member.guild.id,userId:member.id,kind}).catch(()=>{});
      if(had===null&&db.prepare(`SELECT 1 FROM ${LOGBOOK_FORUMS[kind].table} WHERE guild_id=? AND user_id=?`).get(member.guild.id,member.id))continue;
      const r=await ensureLogbook({db,client,config,member,kind}).catch(error=>({status:"error",reason:error.message}));
      if(r.status==="created")console.log(`${LOGBOOK_FORUMS[kind].label} angelegt: ${r.thread.name}`);
      else if(r.status==="skipped"||r.status==="error"){console.warn(`${LOGBOOK_FORUMS[kind].label} nicht angelegt:`,r.reason);logbookError(member.guild.id,`${LOGBOOK_FORUMS[kind].label}: ${r.reason}`);}
    }
  })();
});
// Logbuch-Titel verwaltet nur der Bot: fremde Umbenennungen zurücksetzen.
client.on(Events.ThreadUpdate,(oldThread,thread)=>{void guardLogbookName({db,oldThread,thread}).then(reset=>{if(reset)console.log(`Logbuch-Titel zurückgesetzt: ${thread.id}`);}).catch(()=>{});});
// Server-Name geändert (z. B. „Vorname Nachname | ID“): Logbücher automatisch mit umbenennen.
client.on(Events.GuildMemberUpdate,(oldMember,member)=>{
  if(member.user?.bot||oldMember?.partial||!oldMember?.displayName||oldMember.displayName===member.displayName)return;
  if(config.DISCORD_GUILD_ID&&member.guild.id!==config.DISCORD_GUILD_ID)return;
  const title=/\|\s*\d+\s*$/.test(member.displayName)?member.displayName:logbookTitle(db,member.guild.id,member);
  for(const kind of activeLogbookKinds(config))void renameLogbook({db,client,guildId:member.guild.id,userId:member.id,title,kind}).catch(()=>{});
});
// Familie verlassen: Logbücher archivieren und sperren (Rolle weg oder Server verlassen).
const archiveAll=(member,reason)=>{for(const kind of activeLogbookKinds(config))void archiveLogbook({db,client,guildId:member.guild.id,userId:member.id,reason,kind}).catch(()=>{});};
client.on(Events.GuildMemberUpdate,(oldMember,member)=>{
  if(!config.LOGBOOK_ARCHIVE||member.user?.bot||oldMember?.partial||!oldMember?.roles?.cache)return;
  if(config.DISCORD_GUILD_ID&&member.guild.id!==config.DISCORD_GUILD_ID)return;
  if(familyOf(config,oldMember.roles.cache)&&!familyOf(config,member.roles.cache))archiveAll(member,"Familienrolle entfernt");
});
client.on(Events.GuildMemberRemove,member=>{
  if(!config.LOGBOOK_ARCHIVE||member.user?.bot)return;
  if(config.DISCORD_GUILD_ID&&member.guild.id!==config.DISCORD_GUILD_ID)return;
  archiveAll(member,"Server verlassen");
});
// Familienrolle verloren oder Server verlassen: Löschanfrage für das Familienkonto (Bestätigung über die Website).
const closures=createAccountClosureService(db,finance);
const hasFamilyRole=member=>(config.ROLE_MEMBERS??[]).some(id=>member?.roles?.cache?.has(id));
client.on(Events.GuildMemberUpdate,(oldMember,member)=>{
  try{
    if(member.user?.bot||!(config.ROLE_MEMBERS??[]).length)return;
    if(config.DISCORD_GUILD_ID&&member.guild.id!==config.DISCORD_GUILD_ID)return;
    const before=oldMember?.partial?null:hasFamilyRole(oldMember),now=hasFamilyRole(member);
    if(now){if(before===false||before===null)closures.resolveRejoined({guildId:member.guild.id,userId:member.id,actorId:client.user?.id??"system"});return;}
    if(before===false)return;
    closures.request({guildId:member.guild.id,userId:member.id,reason:"role_removed",actorId:client.user?.id??"system",definite:before===true});
  }catch(error){console.error("Löschanfrage konnte nicht angelegt werden:",error.message);}
});
client.on(Events.GuildMemberRemove,member=>{
  try{
    if(member.user?.bot)return;
    if(config.DISCORD_GUILD_ID&&member.guild.id!==config.DISCORD_GUILD_ID)return;
    closures.request({guildId:member.guild.id,userId:member.id,reason:"left",actorId:client.user?.id??"system"});
  }catch(error){console.error("Löschanfrage konnte nicht angelegt werden:",error.message);}
});
// Begrüßung neuer Spieler (Channel CHANNEL_WELCOME, optional DM). Texte über die Website änderbar.
client.on(Events.GuildMemberAdd,member=>{void sendWelcome({db,client,config,member}).catch(error=>console.warn("Begrüßung fehlgeschlagen:",error.message));});
// Aktivität: nur Zeitpunkt und Anzahl der Nachrichten, nie Inhalte (für Inaktivitäts-Check und Mitgliederprofil).
const activity=createActivityService(db);
// Screenshot im eigenen Logbuch: Bot fragt per Auswahlmenü, welche Aufgabe es ist (kein /log nötig).
// „Vorlage …“-Post bearbeitet: Text gleich in alle Logbücher übernehmen (kurz warten, falls mehrfach hintereinander bearbeitet).
const templateTimers=new Map();
client.on(Events.MessageUpdate,async(_,message)=>{
  if(!message.guildId||(config.DISCORD_GUILD_ID&&message.guildId!==config.DISCORD_GUILD_ID))return;
  // Nur Startnachrichten (ID = Thread-ID); Thread ggf. nachladen, weil archivierte Posts nicht im Speicher sind.
  if(message.id!==message.channelId)return;
  const channel=message.channel??await client.channels.fetch(message.channelId).catch(()=>null);
  const kind=templateKindOf(config,{id:message.id,channel});if(!kind)return;
  clearTimeout(templateTimers.get(kind));
  templateTimers.set(kind,setTimeout(()=>{templateTimers.delete(kind);void syncLogbookTemplates({db,client,config,guildId:message.guildId,kind}).then(n=>{if(n)console.log(`${LOGBOOK_FORUMS[kind].label}: Vorlage geändert – Text in ${n} Posts aktualisiert.`);}).catch(error=>console.warn("Vorlage konnte nicht übernommen werden:",error.message));},5000));
});
client.on(Events.MessageCreate,message=>{
  if(!message.guildId||message.author?.bot||message.webhookId)return;
  if(config.DISCORD_GUILD_ID&&message.guildId!==config.DISCORD_GUILD_ID)return;
  void handleLogbookMessage({db,config,message}).catch(error=>console.warn("Logbuch-Screenshot nicht verarbeitet:",error.message));
  // Bot-Vorschläge: einfach in den Channel schreiben – der Bot macht eine Vorschlags-Karte daraus.
  void handleSuggestionMessage({db,config,message}).catch(error=>console.warn("Vorschlag nicht verarbeitet:",error.message));
});
client.on(Events.MessageCreate,message=>{
  try{
    if(!message.guildId||message.author?.bot||message.webhookId)return;
    if(config.DISCORD_GUILD_ID&&message.guildId!==config.DISCORD_GUILD_ID)return;
    activity.recordMessage(message.guildId,message.author.id,message.createdAt??new Date());
    // Befehls-Channel sauber halten: normale Nachrichten von Mitgliedern verschwinden (Staff darf schreiben).
    if(config.BOT_COMMANDS_CLEANUP&&config.CHANNEL_BOT_COMMANDS&&message.channelId===config.CHANNEL_BOT_COMMANDS){
      const staff=(config.BOT_OWNER_IDS??[]).includes(message.author.id)||accessGroups(config).anyStaff.some(id=>message.member?.roles?.cache?.has(id));
      if(!staff)void message.delete().then(()=>message.channel.send({content:`<@${message.author.id}> Hier bitte nur Bot-Befehle nutzen (z. B. \`/abwesend\`, \`/rangliste\`).`,allowedMentions:{users:[message.author.id]}})).then(hint=>setTimeout(()=>hint?.delete?.().catch(()=>{}),8000)).catch(()=>{});
    }
  }catch(error){console.warn("Aktivität konnte nicht gespeichert werden:",error.message);}
});
// Gelöschte Ticket-Channels: Ticket wird geschlossen und protokolliert, Daten und Transkript bleiben erhalten.
const ticketService=createTicketService(db);
client.on(Events.ChannelDelete,channel=>{
  try{
    const ticket=db.prepare("SELECT id FROM tickets WHERE channel_id=?").get(channel.id);
    if(ticket)ticketService.markChannelMissing({ticketId:ticket.id,actorId:client.user?.id??"system"});
  }catch(error){console.error("Ticket-Channel-Löschung konnte nicht verarbeitet werden:",error.message);}
});
client.on(Events.Error,error=>console.error("Discord client error:",error));
client.on(Events.ShardError,error=>console.error("Discord gateway shard error:",error));
client.on(Events.ShardDisconnect,(_event,id)=>console.warn(`Discord shard ${id} getrennt; Reconnect wird versucht.`));
startModeration({client,db,config});
process.on("unhandledRejection",error=>console.error("Unhandled rejection:",error));
process.on("uncaughtException",error=>{console.error("Uncaught exception:",error);process.exitCode=1;});
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>{console.log(`${signal}: sauberer Shutdown.`);client.destroy();void dashboard.close();db.close();process.exit(0);});
client.login(config.DISCORD_TOKEN).catch(error=>{console.error("Discord-Login fehlgeschlagen:",error.message);db.close();process.exit(1);});

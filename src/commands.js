import { randomUUID } from "node:crypto";
import { ActionRowBuilder, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { audit } from "./database.js";
import { FinanceError, formatMoney } from "./services/finance.js";
import { accessGroups, hasRole } from "./config.js";
import { BRAND_COLOR, applicationInReviewDm, applicationSubmittedDm, presentInteractionPayload } from "./presentation.js";
import { createEventService } from "./services/events.js";
import { createGiveawayService } from "./services/giveaways.js";
import { createTicketService } from "./services/tickets.js";
import { APPLICATION_KINDS, assignRankRole, createApplicationService } from "./services/applications.js";
import { collectStats } from "./services/stats.js";
import { CHANNEL_BINDINGS } from "./channel-setup.js";
import { SETTINGS } from "./services/settings.js";
import { buildPanelPayload, statsEmbed } from "./staff-panel.js";
import { describeSchedule } from "./services/event-series.js";
import { handleAttendanceInteraction } from "./attendance.js";
import { handleTaskInteraction, myTasksView, rewardLabel, submitTaskLog } from "./task-logs.js";
import { createTaskService } from "./services/tasks.js";
import { LOGBOOK_FORUMS, activeLogbookKinds, ensureLogbook, renameLogbook } from "./logbooks.js";
import { createShortAbsenceService } from "./services/short-absences.js";
import { killLeaderboard, killsOf } from "./services/calendar.js";
import { handleEventProofInteraction } from "./event-proofs.js";
import { ControlError, announceControl } from "./state-control.js";
import { prizeLabel } from "./giveaway-cards.js";
import { pingSignup, removeSignupPing } from "./event-signup-pings.js";
import { VerifyError, verifyMemberManually } from "./manual-verify.js";
import { handleSuggestionInteraction } from "./suggestions.js";
import { handleEventManageInteraction, notifyBumped, prioCheck } from "./event-manage.js";
import { buildVerification, createVerificationService } from "./services/verification.js";
import { refreshEventPosts } from "./event-posts.js";
import { panelTexts } from "./services/texts.js";
import { WarningError, createWarningService } from "./services/warnings.js";
import { AbsenceError, createAbsenceService } from "./services/absences.js";
import { createActivityService } from "./services/activity.js";
import { buildLeaderboard } from "./leaderboard.js";
import { MOD_PERMISSIONS } from "./member-moderation.js";
import { PollError, createPollService } from "./polls.js";
import { setQuestionConfig, applicationModal, applicationQuestions, applicationReviewChannel, applicationReviewComponents, buildApplicationPanelPayload, buildApplicationReviewPayload, giveawayCard, payoutListPayload, ticketActions, ticketCard } from "./commands/builders.js";
import { embed, err, fieldsEmbed, isoNow, ticketCategoryLabel, unix } from "./commands/shared.js";
import { createTicketCommands } from "./commands/tickets.js";
import { createAdminCommands } from "./commands/admin.js";
import { createGiveawayCommands } from "./commands/giveaways.js";
import { createApplicationCommands } from "./commands/applications.js";
import { createEventCommands } from "./commands/events.js";
import { createFinanceCommands } from "./commands/finance.js";
import { createPollCommands } from "./commands/polls.js";
import { createModerationCommands } from "./commands/moderation.js";
import { createAbsenceCommands } from "./commands/absences.js";
import { createWarningCommands } from "./commands/warnings.js";
export { ticketCard, ticketClosedCard, ticketActions, ticketClosedActions, applicationQuestions, buildApplicationPanelPayload, buildAccountPanelPayload, buildVerificationPanelPayload, buildAbsencePanelPayload, buildTicketPanelPayload, buildApplicationReviewPayload, applicationReviewComponents, giveawayButtons, giveawayCard, fetchTranscript, payoutListPayload, parseEventDate, eventButtons, eventEmbed, applicationReviewChannelKey } from "./commands/builders.js";
export { buildCommands } from "./commands/definitions.js";

export function createHandler({db,finance,config,client,settings=null,series=null}) {
  client.corleoneOwnerIds=config.BOT_OWNER_IDS??[];
  setQuestionConfig(config);
  // Live berechnet: Rollenänderungen über Website/Discord gelten sofort.
  const groups=new Proxy({}, { get: (_, key) => accessGroups(config)[key] });
  const polls=createPollService(db);
  const verifications=createVerificationService(db),warningService=createWarningService(db),absences=createAbsenceService(db),shortAbsences=createShortAbsenceService(db),activity=createActivityService(db);
  const pendingModeration=new Map();
  const events=createEventService(db),giveaways=createGiveawayService(db),tickets=createTicketService(db),applications=createApplicationService(db);
  const isOwner=i=>config.BOT_OWNER_IDS?.includes(i.user?.id)??false;
  const memberRoleIds=i=>[...(i.member?.roles?.cache?.keys?.()??i.member?.roles??[])];
  const hasRoleOrOwner=(i,roles)=>isOwner(i)||roles.some(r=>i.member?.roles?.cache?.has(r));
  const can=(i,group)=>hasRoleOrOwner(i,groups[group]);
  const describe=i=>i.isChatInputCommand?.()?`/${i.commandName}${i.options.getSubcommand(false)?` ${i.options.getSubcommand(false)}`:""}`:i.customId?.split(":").slice(0,2).join(":");
  /** Serverseitige Rechteprüfung. Bot-Owner ohne passende Rolle werden durchgelassen, aber protokolliert. */
  const guard=(i,group,label)=>{
    if(!i.inGuild())return "Dieser Befehl funktioniert nur auf einem Server.";
    const roles=groups[group]??[];
    if(hasRole(i.member,roles))return null;
    if(isOwner(i)){audit(db,i.guildId,i.user.id,"admin.override",null,{command:describe(i),group});return null;}
    if(!roles.length)return "Die Rollen für diese Aktion sind noch nicht konfiguriert. Bitte ROLE_* in der .env setzen.";
    return `Dafür brauchst du eine ${label}.`;
  };
  const memberGate=i=>!groups.members.length||can(i,"members")||can(i,"anyStaff")?null:"Diese Funktion ist Familienmitgliedern vorbehalten.";
  const answer=(i,options)=>i.reply(presentInteractionPayload(options));
  const followUp=(i,options)=>i.followUp(presentInteractionPayload(options));
  const updateMessage=(i,options)=>i.update(presentInteractionPayload(options));
  const replyError=async(i,e)=>{ const msg=err(e); if(i.deferred||i.replied) return followUp(i,{content:msg,ephemeral:true}).catch(()=>{}); return answer(i,{content:msg,ephemeral:true}).catch(()=>{}); };
  const respond=async(i,content,ephemeral=true)=>answer(i,{content,ephemeral});
  const wrongGuild=i=>!i.inGuild()||(config.DISCORD_GUILD_ID&&i.guildId!==config.DISCORD_GUILD_ID);

  async function autocomplete(i){
    try{
      if(wrongGuild(i))return i.respond([]);
      const g=i.guildId,sub=i.options.getSubcommand(false),focused=i.options.getFocused(true),query=String(focused.value??"").toLocaleLowerCase("de-AT");
      let rows=[],choices=[];
      if(i.commandName==="event"&&(can(i,"events")||sub==="teilnehmer")){
        rows=["anwesenheit","teilnehmer"].includes(sub)
          ?db.prepare("SELECT id,name,starts_at FROM events WHERE guild_id=? AND status IN ('scheduled','ended') ORDER BY starts_at DESC LIMIT 100").all(g)
          :db.prepare("SELECT id,name,starts_at FROM events WHERE guild_id=? AND status='scheduled' ORDER BY starts_at LIMIT 100").all(g);
        choices=rows.map(r=>({name:`${r.name} · ${new Date(r.starts_at).toLocaleString("de-AT",{timeZone:config.TIMEZONE,dateStyle:"short",timeStyle:"short"})}`.slice(0,100),value:r.id}));
      }else if(i.commandName==="antrag"){
        if(sub==="status")rows=db.prepare("SELECT id,kind,status,created_at FROM applications WHERE guild_id=? AND user_id=? AND status IN ('open','review') ORDER BY created_at DESC LIMIT 25").all(g,i.user.id);
        else if(["entscheiden","kommentieren"].includes(sub)&&can(i,"reviewers"))rows=db.prepare("SELECT id,user_id,kind,status,created_at FROM applications WHERE guild_id=? AND status IN ('open','review') ORDER BY created_at LIMIT 100").all(g);
        choices=rows.map(r=>({name:`${r.kind==="rang"?"🏅 Rang-Antrag":"🤝 Bewerbung"} · ${r.status==="review"?"in Bearbeitung":"offen"} · …${r.user_id?.slice(-5)??""} · ${r.id.slice(0,8)}`,value:r.id}));
      }else if(i.commandName==="sanktion"&&can(i,"sanctionManage")){
        if(sub==="aufheben")rows=db.prepare("SELECT s.id,s.user_id,s.remaining_cents AS cents,s.reason FROM sanctions s WHERE s.guild_id=? AND s.status IN ('open','partial') AND NOT EXISTS(SELECT 1 FROM payout_allocations p WHERE p.sanction_id=s.id) ORDER BY s.created_at DESC LIMIT 100").all(g);
        else if(sub==="korrigieren")rows=db.prepare("SELECT s.id,s.user_id,s.amount_cents AS cents,s.reason FROM sanctions s WHERE s.guild_id=? AND s.status<>'void' ORDER BY s.created_at DESC LIMIT 100").all(g);
        else if(sub==="rueckerstatten")rows=db.prepare("SELECT s.id,s.user_id,s.reason,COALESCE((SELECT SUM(amount_cents) FROM payout_allocations p WHERE p.sanction_id=s.id),0)-COALESCE((SELECT SUM(amount_cents) FROM sanction_refunds r WHERE r.sanction_id=s.id),0) AS cents FROM sanctions s WHERE s.guild_id=? AND COALESCE((SELECT SUM(amount_cents) FROM payout_allocations p WHERE p.sanction_id=s.id),0)>COALESCE((SELECT SUM(amount_cents) FROM sanction_refunds r WHERE r.sanction_id=s.id),0) ORDER BY s.created_at DESC LIMIT 100").all(g);
        choices=rows.map(r=>({name:`${r.reason.slice(0,55)} · Mitglied …${r.user_id.slice(-5)} · ${formatMoney(r.cents)}`.slice(0,100),value:r.id}));
      }else if(i.commandName==="umfrage"&&can(i,"staff")){
        choices=polls.list(g,25).filter(p=>p.status==="open").map(p=>({name:`${p.question} · endet ${new Date(p.ends_at).toLocaleString("de-AT",{timeZone:config.TIMEZONE,dateStyle:"short",timeStyle:"short"})}`.slice(0,100),value:p.id}));
      }else if(i.commandName==="einstellungen"&&can(i,"leaders")){
        choices=Object.keys(CHANNEL_BINDINGS).map(key=>{const label=SETTINGS.find(s=>s.key===key)?.label;return {name:`${label?`${label} · `:""}${key}`.slice(0,100),value:key};});
      }else if(i.commandName==="unwarn"&&can(i,"moderation")){
        // Mit gewähltem Mitglied nur dessen Verwarnungen; die Suche läuft über Grund und Referenz statt über Namen.
        const target=i.options.get?.("mitglied")?.value??null;
        const rows=target?warningService.list(g,target,{limit:25,expireDays:config.WARN_EXPIRE_DAYS}).filter(r=>r.state==="active"):warningService.recent(g,{limit:100,activeOnly:true,expireDays:config.WARN_EXPIRE_DAYS});
        const nick=id=>verifications.byUser(g,id)?.nickname??i.guild?.members?.cache?.get?.(id)?.displayName??`Mitglied …${id.slice(-5)}`;
        choices=rows.filter(r=>r.user_id!==i.user.id||isOwner(i)).map(r=>({name:`${target?"":`${nick(r.user_id)} · `}${new Date(r.created_at).toLocaleDateString("de-AT",{timeZone:config.TIMEZONE})} · ${r.reason} · ${r.id.slice(0,8)}`.slice(0,100),value:r.id}));
      }else if(i.commandName==="aktivitaeten"&&series&&can(i,"events")){
        choices=series.list(g).map(r=>({name:`${r.active?"🟢":"⚪"} ${r.name} · ${describeSchedule(r)}`.slice(0,100),value:r.id}));
      }else if(i.commandName==="log"){
        choices=createTaskService(db,{timezone:()=>config.TIMEZONE}).listTypes(g).map(t=>({name:`${t.emoji} ${t.name} · ${rewardLabel(t)}${t.daily_limit?` · max. ${t.daily_limit}×/Tag`:""}`.slice(0,100),value:t.id}));
      }else if(i.commandName==="giveaway"&&sub==="abbrechen"&&can(i,"staff")){
        rows=db.prepare("SELECT id,prize,ends_at FROM giveaways WHERE guild_id=? AND status='active' ORDER BY ends_at LIMIT 100").all(g);
        choices=rows.map(r=>({name:`🎉 ${r.prize.slice(0,65)} · endet ${new Date(r.ends_at).toLocaleDateString("de-AT",{timeZone:config.TIMEZONE})}`,value:r.id}));
      }
      return i.respond(choices.filter(choice=>!query||choice.name.toLocaleLowerCase("de-AT").includes(query)||choice.value.toLowerCase().startsWith(query)).slice(0,25));
    }catch(error){console.warn("Autocomplete konnte nicht geladen werden:",error.message);return i.respond([]).catch(()=>{});}
  }

  async function command(i) {
    if (!i.inGuild()) return respond(i,"Dieser Bot-Befehl funktioniert nur in einem Server.");
    if(config.DISCORD_GUILD_ID&&i.guildId!==config.DISCORD_GUILD_ID)return respond(i,"Der Bot ist für diesen Server nicht freigeschaltet.");
    const g=i.guildId,u=i.user.id,sub=i.options.getSubcommand(false);
    // Mitglieder nutzen Bot-Befehle nur im Befehls-Channel; Staff und Leitung überall.
    if(config.CHANNEL_BOT_COMMANDS&&i.channelId!==config.CHANNEL_BOT_COMMANDS&&!hasRoleOrOwner(i,groups.anyStaff))return respond(i,`Bot-Befehle bitte im <#${config.CHANNEL_BOT_COMMANDS}> nutzen.`);
    try {
      if (i.commandName==="ping") return respond(i,`Pong! ${client.ws.ping} ms`);
      if (i.commandName==="help") return answer(i,{...fieldsEmbed("📚 Corleone Bot – Befehle",[
        {name:"💰 Konto & Sanktionen",value:"`/konto` Guthaben, Gutschriften, Auszahlungen, Korrekturen und Historie\n`/sanktion` Sanktionen und Verwarnungen eintragen, ansehen, korrigieren oder aufheben"},
        {name:"📋 Aufgaben",value:"Screenshot einfach in dein Logbuch posten und die Aufgabe im Menü wählen (oder `/log`) – Belohnung nach Prüfung aufs Konto\n`/aufgaben` deine Stufe, Serie und Verdienst"},
        {name:"🚫 Abmeldung & Aktivität",value:"`/abwesend melden | beenden | liste` Urlaub oder Pause eintragen\n`/rangliste` aktivste Mitglieder nach Event-Teilnahmen"},
        {name:"🛡️ Moderation",value:"`/timeout` `/untimeout` (Moderation) · `/kick` (Staff) · `/ban` `/unban` (Leitung) – mit Grund, DM und Eintrag in der Mitgliederhistorie"},
        {name:"📝 Verwarnungen",value:"`/warn` Mitglied verwarnen (DM, ohne Geldabzug)\n`/warnings` eigene bzw. fremde Verwarnungen ansehen\n`/unwarn` Verwarnung zurücknehmen"},
        {name:"🎫 Support",value:"`/ticket` Ticket-Panel, Übernahme, Schließen und Wiederöffnen"},
        {name:"📅 Familie",value:"`/event` Events verwalten und Teilnahme dokumentieren\n`/antrag` Bewerbung oder Rang-Antrag einreichen, kommentieren und entscheiden"},
        {name:"🎉 Community",value:"`/giveaway` Gewinnspiele verwalten\n`/umfrage erstellen | beenden` Abstimmungen mit Buttons"},
        {name:"🧭 Staff",value:"`/dashboard` Staff-Übersicht und Panel\n`/statistik` Auswertungen nach Zeitraum\n`/automod` Schutzmaßnahmen\n`/einstellungen` Konfiguration prüfen (Leitung)\n`/ping` Bot-Verbindung prüfen"},
      ],"Die verfügbaren Aktionen richten sich nach deiner Rolle."),ephemeral:true});
      if (i.commandName==="konto") return await accountCommand(i,sub,g,u);
      if (i.commandName==="sanktion") return await sanctionCommand(i,sub,g,u);
      if (i.commandName==="warn") return await issueWarning(i,g,u,{target:i.options.getUser("mitglied"),reason:i.options.getString("grund"),caseRef:i.options.getString("fall")});
      if (i.commandName==="warnings") return await warningsCommand(i,g,u);
      if (i.commandName==="unwarn") return await unwarnCommand(i,g,u);
      if (i.commandName==="verifizieren"){
        const denied=guard(i,"staff","Staff-Rolle");if(denied)return respond(i,denied);
        await i.deferReply({flags:MessageFlags.Ephemeral});
        try{
          const r=await verifyMemberManually({db,client:i.client??client,config,guild:i.guild,userId:i.options.getUser("mitglied").id,input:{firstName:i.options.getString("vorname"),lastName:i.options.getString("nachname"),ingameId:i.options.getString("id")},actorId:u});
          return i.editReply(presentInteractionPayload({embeds:[embed(r.before?"✏️ Name geändert":"✅ Manuell verifiziert",`<@${i.options.getUser("mitglied").id}> heißt jetzt **${r.data.nickname}**.${r.before?`\nVorher: ${r.before.nickname}`:""}${r.notes.length?`\n\n⚠️ ${r.notes.join("\n⚠️ ")}`:""}`)]}));
        }catch(error){if(error instanceof VerifyError)return i.editReply(presentInteractionPayload({content:error.message}));throw error;}
      }
      if (i.commandName==="staatliche"){
        const denied=guard(i,"events","Event-Team- oder Leitungsrolle");if(denied)return respond(i,denied);
        try{const r=await announceControl({db,client,config,actorId:u,family:i.options.getString("familie"),when:i.options.getString("wann")??"jetzt",mode:i.options.getString("art")==="attack"?"attack":"defend",max:i.options.getInteger("max")});return respond(i,`🚩 **${r.name}** angekündigt – Beginn <t:${Math.floor(r.startsAt.getTime()/1000)}:t>.`);}
        catch(error){if(error instanceof ControlError)return respond(i,error.message);throw error;}
      }
      if (i.commandName==="log"){const denied=memberGate(i);if(denied)return respond(i,denied);return await submitTaskLog({i,db,client:i.client??client,config});}
      if (i.commandName==="logbuch"){
        const denied=guard(i,"staff","Staff- oder Leitungsrolle");if(denied)return respond(i,denied);
        const wanted=i.options.getString("art"),kinds=activeLogbookKinds(config).filter(k=>!wanted||k===wanted);
        if(!kinds.length)return respond(i,"Dafür ist noch kein Forum eingestellt (Einstellungen → Channels → Aufgaben- bzw. Event-Logbücher).");
        const member=await i.guild.members.fetch(i.options.getUser("mitglied").id).catch(()=>null);
        if(!member)return respond(i,"Dieses Mitglied ist nicht auf dem Server.");
        await i.deferReply({flags:MessageFlags.Ephemeral});
        const lines=[];
        for(const kind of kinds){
          const r=await ensureLogbook({db,client:i.client??client,config,member,actorId:u,kind}).catch(error=>({status:"skipped",reason:`Discord-Fehler: ${error.message}`}));
          const label=LOGBOOK_FORUMS[kind].label;
          lines.push(r.status==="created"?`📒 ${label} angelegt: <#${r.threadId}>`:r.status==="existing"?`${label}: gibt es schon${r.threadId?` – <#${r.threadId}>`:""}.`:`${label}: ${r.reason}`);
        }
        return i.editReply(presentInteractionPayload({content:lines.join("\n")}));
      }
      if (i.commandName==="kills"){
        const period=i.options.getString("zeitraum")??"week",rows=killLeaderboard(db,{guildId:g,timezone:config.TIMEZONE,period,limit:10}),mine=killsOf(db,g,u);
        const medals=["🥇","🥈","🥉"],label={week:"diese Woche",month:"diesen Monat",all:"gesamt"}[period];
        return answer(i,{embeds:[new EmbedBuilder().setColor(BRAND_COLOR).setAuthor({name:"CORLEONE  •  EVENTS"}).setTitle(`🎯 Kill-Bestenliste – ${label}`)
          .setDescription(rows.map((r,n)=>`${medals[n]??`**${n+1}.**`} <@${r.userId}> · **${r.kills}** Kills · ${r.events} Events · Bestwert ${r.best}`).join("\n")||"Noch keine Kills eingetragen. Kills trägt das Team beim Win mit Kill-Prämie ein.")
          .setFooter({text:`Du gesamt: ${mine.kills} Kills · Bestwert ${mine.best}`})],allowedMentions:{parse:[]},ephemeral:true});
      }
      if (i.commandName==="aufgaben"){const denied=memberGate(i);if(denied)return respond(i,denied);return answer(i,{embeds:[myTasksView(db,config,g,u)],ephemeral:true});}
      if (i.commandName==="abwesend") return await absenceCommand(i,sub,g,u);
      if (i.commandName==="umfrage") return await pollCommand(i,sub,g,u);
      if (i.commandName==="rangliste") return answer(i,{...buildLeaderboardView(g,i.options.getString("zeitraum")??"week"),ephemeral:true});
      if (MOD_PERMISSIONS[i.commandName]) return await moderationCommand(i,g,u);
      if (i.commandName==="ticket") return await ticketCommand(i,sub,g,u);
      if (["add","remove","ticketadd","ticketremove"].includes(i.commandName)) return await ticketCommand(i,i.commandName.endsWith("add")?"hinzufuegen":"entfernen",g,u);
      if (i.commandName==="event") return await eventCommand(i,sub,g,u);
      if (i.commandName==="antrag") return await applicationCommand(i,sub,g,u);
      if (i.commandName==="bewerbung-panel") {const denied=guard(i,"reviewers","Reviewer-Rolle");if(denied)return respond(i,denied);await postManagedPanel(i,"CHANNEL_APPLICATION_PANEL","PANEL_APPLICATION",buildApplicationPanelPayload(panelTexts(db,g,"application")));return respond(i,"Bewerbungs-Panel veröffentlicht.");}
      if (i.commandName==="giveaway") return await giveawayCommand(i,sub,g,u);
      if (i.commandName==="dashboard") return await dashboardCommand(i,sub,g,u);
      if (i.commandName==="statistik") {
        const denied=guard(i,"anyStaff","Staff-Rolle");if(denied)return respond(i,denied);
        const days=i.options.getInteger("zeitraum")??30;
        const stats=collectStats(db,g,{days,includeFinance:can(i,"financeView")});
        return answer(i,{embeds:[statsEmbed(stats,{memberCount:i.guild?.memberCount??null})],ephemeral:true});
      }
      if (i.commandName==="einstellungen") return await settingsCommand(i,sub,g,u);
      if (i.commandName==="automod") return await automodCommand(i,sub,g,u);
      if (i.commandName==="aktivitaeten") return await activityCommand(i,sub,g,u);
      return respond(i,"Unbekannter Befehl.");
    } catch(e) { if(!(e instanceof FinanceError||e instanceof WarningError||e instanceof AbsenceError||e instanceof PollError))console.error(`Command ${i.commandName} failed:`,e); return replyError(i,e); }
  }

  /** Kontoansichten, gemeinsam genutzt von Slash-Befehlen und dem „Mein Konto“-Panel. */
  const { issueWarning, unwarnCommand, warningsCommand } = createWarningCommands({ answer, can, client, config, db, groups, guard, isOwner, respond, warningService });
  const { absenceCommand, createAbsence, createShortAbsence, endOwnAbsence, openAbsenceModal, openShortAbsenceModal } = createAbsenceCommands({ absences, answer, client, config, db, guard, memberGate, respond, shortAbsences });
  // ---------------------------------------------------------------- Rangliste
  function buildLeaderboardView(g,period){
    if(period==="all"){
      const rows=activity.leaderboard(g,{period:"all",timezone:config.TIMEZONE,limit:15});
      return fieldsEmbed("🏆 Rangliste · Gesamt",[{name:"Event-Teilnahmen",value:rows.map((r,n)=>`${["🥇","🥈","🥉"][n]??`**${n+1}.**`} <@${r.userId}> · **${r.count}**`).join("\n")||"Noch keine Teilnahmen."}]);
    }
    const texts=panelTexts(db,g,"leaderboard"),payload=buildLeaderboard({activity,guildId:g,timezone:config.TIMEZONE,texts});
    if(period==="month")payload.embeds[0].spliceFields(0,1);else payload.embeds[0].spliceFields(1,1);
    return payload;
  }

  const { confirmModeration, moderationCommand } = createModerationCommands({ answer, client, db, groups, guard, isOwner, pendingModeration, respond, updateMessage });
  const { pollButton, pollCommand } = createPollCommands({ answer, client, config, db, followUp, guard, polls, respond });
  const { accountCommand, balanceView, confirmPayout, historyView, sanctionCommand, sanctionsView } = createFinanceCommands({ answer, can, client, config, db, finance, guard, issueWarning, respond, updateMessage, warningService });
  const { eventCommand } = createEventCommands({ absences, answer, client, config, db, events, guard, respond });
  const { applicationCommand, decideApplication, postApplicationNote, roleAssignmentOffer } = createApplicationCommands({ answer, applications, can, client, config, db, finance, followUp, guard, memberGate, respond });
  const { giveawayCommand } = createGiveawayCommands({ answer, config, db, giveaways, guard, respond });
  const { activityCommand, automodCommand, dashboardCommand, postManagedPanel, settingsCommand, showView } = createAdminCommands({ answer, can, client, config, db, finance, guard, isOwner, memberRoleIds, respond, series, settings });
  async function button(i) {
    try {
      if(wrongGuild(i))return answer(i,{content:"Der Bot ist für diesen Server nicht freigeschaltet.",ephemeral:true});
      const [kind,action,id,extra,expectedDeduction]=i.customId.split(":");const g=i.guildId,u=i.user.id;
      if(kind==="setup")return answer(i,{content:"Dieser Channel-Einrichtungsbefehl wurde entfernt.",ephemeral:true});
      if(kind==="verify"&&action==="open"){
        const existing=verifications.byUser(i.guildId,i.user.id);
        if(existing)return answer(i,{content:`Du bist bereits verifiziert als **${existing.nickname}**.\nUm deinen Namen zu ändern, nutze „Name ändern“. Die Ingame-ID kann nur das Team zurücksetzen – melde dich dafür per Ticket.`,ephemeral:true});
        return openVerification(i);
      }
      if(kind==="verify"&&action==="rename"){
        if(!verifications.byUser(i.guildId,i.user.id))return answer(i,{content:"Du bist noch nicht verifiziert. Bitte klicke zuerst auf „Verifizieren“.",ephemeral:true});
        return openVerification(i,{rename:true});
      }
      if(kind==="poll")return pollButton(i,action,id,extra);
      if(kind==="absence"&&action==="open"){const gate=memberGate(i);if(gate)return answer(i,{content:"Abmeldungen gibt es nur für Mitglieder der Corleone-Familie.",ephemeral:true});return openAbsenceModal(i);}
      if(kind==="absence"&&action==="short"){const gate=memberGate(i);if(gate)return answer(i,{content:"Abmeldungen gibt es nur für Mitglieder der Corleone-Familie.",ephemeral:true});return openShortAbsenceModal(i);}
      if(kind==="absence"&&action==="back")return endOwnAbsence(i);
      if(kind==="mod"&&action==="confirm")return confirmModeration(i,id);
      if(kind==="account"){
        const gate=memberGate(i);if(gate&&!db.prepare("SELECT 1 FROM accounts WHERE guild_id=? AND user_id=?").get(i.guildId,i.user.id))return answer(i,{content:"Das Familienkonto gibt es nur für Mitglieder der Corleone-Familie. Dir fehlt die Familienrolle – bitte melde dich bei der Leitung.",ephemeral:true});
        if(action==="balance")return answer(i,balanceView(g,u));
        if(action==="history")return answer(i,historyView(g,u));
        if(action==="sanctions")return answer(i,sanctionsView(g,u));
      }
      if(kind==="cancel")return updateMessage(i,{content:"Aktion abgebrochen.",embeds:[],components:[]});
      if(kind==="staffpanel"&&action==="refresh"){
        if(!can(i,"anyStaff"))return answer(i,{content:"Das Dashboard ist nur für Staff.",ephemeral:true});
        return updateMessage(i,buildPanelPayload(db,g));
      }
      if(kind==="konto"&&action==="list"){
        const denied=guard(i,"financeView","Finanzrolle");if(denied)return answer(i,{content:denied,ephemeral:true});
        const {ephemeral,...payload}=payoutListPayload(db,g,config.PAYOUT_MINIMUM_CENTS,Number(id));
        return updateMessage(i,payload);
      }
      if(kind==="payout") return await confirmPayout(i,{previewId:action,userId:id,gross:Number(extra),deduction:Number(expectedDeduction)});
      if(kind==="ticket"){
        const t=db.prepare("SELECT * FROM tickets WHERE id=? AND guild_id=?").get(id,g);
        if(!t)return answer(i,{content:"Ticket nicht gefunden.",ephemeral:true});
        if(action==="closeconfirm"){
          if(t.status!=="open")return answer(i,{content:"Ticket ist bereits geschlossen.",ephemeral:true});
          if(t.user_id!==u&&!ticketAllowed(i,t))return answer(i,{content:"Nur der Ersteller oder Staff kann dieses Ticket schließen.",ephemeral:true});
          return answer(i,{content:"Ticket schließen? Der Verlauf wird gespeichert und der Channel bleibt für Staff einsehbar.",components:[closeConfirmRow(id)],ephemeral:true});
        }
        if(action==="close")return await closeTicket(i,t);
        if(action==="claim"){
          if(!ticketAllowed(i,t))return answer(i,{content:"Dafür brauchst du eine Staff- oder zuständige Ticket-Rolle.",ephemeral:true});
          const row=tickets.claim({guildId:g,ticketId:id,actorId:u});
          if(!row)return answer(i,{content:"Ticket wurde bereits übernommen oder geschlossen.",ephemeral:true});
          return updateMessage(i,{embeds:[ticketCard(ticketCategoryLabel(row.category,config),row.user_id,u)],components:ticketActions(id,true)});
        }
        if(action==="reopen")return reopenTicket(i,t,true);
      }
      if(kind==="giveaway"&&(action==="join"||action==="leave")){
        const result=action==="join"
          ?giveaways.join({guildId:g,giveawayId:id,userId:u,memberRoleIds:memberRoleIds(i)})
          :giveaways.leave({guildId:g,giveawayId:id,userId:u});
        const messages={closed:"Dieses Giveaway ist bereits beendet.",missing_role:`Für dieses Giveaway brauchst du die Rolle <@&${result.giveaway?.required_role_id}>.`,already:"Du bist für dieses Giveaway bereits eingetragen.",not_joined:"Du warst für dieses Giveaway nicht eingetragen."};
        if(messages[result.status])return answer(i,{content:messages[result.status],ephemeral:true});
        await i.message?.edit({embeds:[giveawayCard(result.giveaway,giveaways.entryCount(id))]}).catch(()=>{});
        if(action==="leave")return answer(i,{content:"Du bist vom Giveaway abgemeldet.",ephemeral:true});
        return answer(i,{...fieldsEmbed("🎉 Teilnahme bestätigt",[
          {name:"Preis",value:`**${prizeLabel(result.giveaway.prize)}**`,inline:true},
          {name:"Endet",value:`<t:${unix(result.giveaway.ends_at)}:R>`,inline:true},
        ],"Du bist jetzt im Lostopf. Viel Glück!"),ephemeral:true});
      }
      if(kind==="event"&&(action==="join"||action==="leave")){
        if(action==="join"){const gate=memberGate(i);if(gate)return answer(i,{content:gate,ephemeral:true});}
        const result=action==="join"?events.join({guildId:g,eventId:id,userId:u,overlapMinutes:config.EVENT_OVERLAP_EXCLUSIVE?config.EVENT_OVERLAP_MINUTES??0:0,isPrio:prioCheck(config,i.guild)}):events.leave({guildId:g,eventId:id,userId:u});
        if(result.status==="closed")return answer(i,{content:"Dieses Event ist nicht mehr offen.",ephemeral:true});
        if(["joined","left","waitlisted","left_waitlist"].includes(result.status))await refreshEventPosts({db,client,config,event:result.event,cardOnly:true});
        // Nachgerückte von der Warteliste per DM informieren.
        // Ping im eigenen Event-Logbuch (Anmeldung) bzw. Hinweis entfernen (Abmeldung/Wechsel); Nachrücker bekommen ihn auch.
        const pc=i.client??client;
        if(result.status==="joined")void pingSignup({db,client:pc,config,event:result.event,userId:u}).catch(()=>{});
        if(result.bumped)void notifyBumped({db,client:pc,event:result.event,userId:result.bumped,byId:u}).catch(()=>{});
        if(result.status==="left")void removeSignupPing({db,client:pc,eventId:result.event.id,userId:u}).catch(()=>{});
        for(const s of result.switched??[])void removeSignupPing({db,client:pc,eventId:s.event.id,userId:u}).catch(()=>{});
        for(const userId of result.promoted??[])void pingSignup({db,client:pc,config,event:result.event,userId}).catch(()=>{});
        for(const s of result.switched??[])for(const userId of s.promoted)void pingSignup({db,client:pc,config,event:s.event,userId}).catch(()=>{});
        // Gleichzeitiges Event: dort abgemeldet → Karte aktualisieren, Nachgerückte von dort informieren.
        for(const s of result.switched??[]){await refreshEventPosts({db,client,config,event:s.event,cardOnly:true}).catch(()=>{});result.promoted=[...(result.promoted??[]),...s.promoted.map(userId=>({userId,event:s.event}))];}
        for(const entry of result.promoted??[]){const userId=entry.userId??entry,ev=entry.event??result.event;void (i.client??client).users.fetch(userId).then(user=>user.send({embeds:[new EmbedBuilder().setColor(BRAND_COLOR).setAuthor({name:"CORLEONE  •  EVENTS"}).setTitle("🎉 Du bist nachgerückt!").setDescription(`Für **${ev.name}** (<t:${unix(ev.starts_at)}:F>) ist ein Platz frei geworden – du stehst jetzt auf der Teilnehmerliste.\nKannst du doch nicht? Dann bitte über die Event-Karte abmelden.`).setTimestamp()]})).catch(()=>{});
        }
        const titles={joined:"✅ Anmeldung bestätigt",already:"ℹ️ Bereits angemeldet",left:"↩️ Abmeldung bestätigt",not_joined:"ℹ️ Keine aktive Anmeldung",waitlisted:"⏳ Auf der Warteliste",already_waiting:"⏳ Schon auf der Warteliste",left_waitlist:"↩️ Von der Warteliste entfernt"};
        const texts={joined:`Du stehst jetzt auf der Teilnehmerliste.${result.bumped?" ⭐ **Prio Queue:** Das Event war voll – du hast den Platz der zuletzt angemeldeten Person bekommen (sie steht jetzt vorne auf der Warteliste).":""}`,already:"Deine Anmeldung ist bereits gespeichert.",left:"Du wurdest von der Teilnehmerliste entfernt.",not_joined:"Du warst für dieses Event nicht angemeldet.",waitlisted:`Das Event ist voll – du bist **Platz ${result.position}** auf der Warteliste${result.prio?" (⭐ Prio Queue – vor allen ohne Prio)":""}. Wird ein Platz frei, rückst du automatisch nach und bekommst eine DM.`,already_waiting:`Du bist **Platz ${result.position}** auf der Warteliste.`,left_waitlist:"Du stehst nicht mehr auf der Warteliste."};
        return answer(i,{...fieldsEmbed(titles[result.status],[
          {name:"Event",value:`**${result.event.name}**`,inline:true},
          {name:"Beginn",value:`<t:${unix(result.event.starts_at)}:F>`,inline:true},
        ],`${texts[result.status]}${result.switched?.length?`\n\n↩️ Bei **${result.switched.map(s=>s.event.name).join("**, **")}** (gleiche Zeit) wurdest du dafür abgemeldet.`:""}`),ephemeral:true});
      }
      return answer(i,{content:"Diese Schaltfläche ist nicht mehr aktiv.",ephemeral:true});
    } catch(e){if(!(e instanceof FinanceError))console.error("Button action failed:",e);return replyError(i,e);}
  }

  function openVerification(i,{rename=false}={}){
    const previous=verifications.byUser(i.guildId,i.user.id);
    const field=(id,label,max,value,placeholder)=>{const input=new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setMinLength(id==="ingame_id"?1:2).setMaxLength(max).setPlaceholder(placeholder);if(value)input.setValue(value);return new ActionRowBuilder().addComponents(input);};
    // Beim Namen ändern bleibt die Ingame-ID fest; nur Vor- und Nachname sind änderbar.
    const modal=new ModalBuilder().setCustomId(rename?"verify:rename-submit":"verify:submit").setTitle(rename?`Namen ändern (ID ${previous.ingame_id})`.slice(0,45):"Corleone Verifizierung").addComponents(
      ...(rename?[]:[field("ingame_id","Ingame-ID",10,previous?.ingame_id,"z. B. 12345")]),
      field("first_name","Vorname (Ingame)",20,previous?.first_name,"z. B. Tony"),
      field("last_name","Nachname (Ingame)",20,previous?.last_name,"z. B. Romano"),
    );
    return i.showModal(modal);
  }
  async function submitVerification(i,{rename=false}={}){
    let data;
    const stored=rename?verifications.byUser(i.guildId,i.user.id):null;
    if(rename&&!stored)return answer(i,{content:"Du bist noch nicht verifiziert. Bitte klicke zuerst auf „Verifizieren“.",ephemeral:true});
    try{data=buildVerification({ingameId:rename?stored.ingame_id:i.fields.getTextInputValue("ingame_id"),firstName:i.fields.getTextInputValue("first_name"),lastName:i.fields.getTextInputValue("last_name")});verifications.assertAvailable(i.guildId,i.user.id,data.ingameId);}
    catch(error){return answer(i,{content:error.message,ephemeral:true});}
    const verifiedBefore=verifications.byUser(i.guildId,i.user.id);
    await i.deferReply({flags:MessageFlags.Ephemeral});
    const member=await i.guild.members.fetch(i.user.id).catch(()=>null);
    if(!member)return i.editReply(presentInteractionPayload({content:"Du wurdest auf dem Server nicht gefunden. Bitte versuche es erneut."}));
    const isOwner=i.guild.ownerId===i.user.id;
    let nicknameNote="";
    if(isOwner)nicknameNote=`\n\nℹ️ Als Server-Inhaber kann Discord deinen Namen nicht durch Bots ändern. Bitte setze ihn selbst auf **${data.nickname}**.`;
    else{
      const changed=await member.setNickname(data.nickname,"Corleone Verifizierung").then(()=>true).catch(error=>{console.warn("Verifizierung: Name nicht änderbar:",error.message);return false;});
      if(!changed){
        audit(db,i.guildId,i.user.id,"member.verification_failed",i.user.id,{name:data.nickname,reason:"Name konnte nicht geändert werden"});
        return i.editReply(presentInteractionPayload({content:"Dein Name konnte nicht geändert werden. Wahrscheinlich steht deine Rolle über der Bot-Rolle oder dem Bot fehlt „Spitznamen verwalten“. Bitte melde dich per Ticket beim Team – deine Angaben wurden nicht gespeichert."}));
      }
    }
    const roleIds=config.ROLE_VERIFIED??[],failedRoles=[];
    for(const roleId of roleIds){if(member.roles.cache.has(roleId))continue;await member.roles.add(roleId,"Corleone Verifizierung").catch(error=>{failedRoles.push(roleId);console.warn("Verifizierungsrolle nicht vergeben:",error.message);});}
    try{verifications.save({guildId:i.guildId,userId:i.user.id,data,roleResult:roleIds.length?(failedRoles.length?"teilweise fehlgeschlagen":"vergeben"):null});}
    catch(error){return i.editReply(presentInteractionPayload({content:error.message}));}
    for(const kind of Object.keys(LOGBOOK_FORUMS))void renameLogbook({db,client:i.client??client,guildId:i.guildId,userId:i.user.id,title:data.nickname,kind}).catch(()=>{});
    const previousName=verifiedBefore?.nickname;
    if(previousName)return i.editReply(presentInteractionPayload({embeds:[embed("✏️ Name geändert",`${previousName===data.nickname?"Dein Name war bereits":"Dein Name lautet jetzt"} **${data.nickname}**.${previousName!==data.nickname?`\nVorher: ${previousName}`:""}${nicknameNote}`)]}));
    return i.editReply(presentInteractionPayload({embeds:[embed("✅ Verifizierung abgeschlossen",`Willkommen, **${data.firstName} ${data.lastName}**!\nDein Name lautet jetzt **${data.nickname}**.${roleIds.length&&!failedRoles.length?"\nDu kannst jetzt im öffentlichen Chat schreiben.":""}${failedRoles.length?"\n\n⚠️ Eine Rolle konnte nicht vergeben werden – das Team wurde im Protokoll informiert.":""}${nicknameNote}`)]}));
  }

  async function select(i){
    try{
      if(wrongGuild(i))return answer(i,{content:"Der Bot ist für diesen Server nicht freigeschaltet.",ephemeral:true});
      if(i.customId==="staffpanel:view")return showView(i,i.values[0]);
      if(i.customId.startsWith("application:assignrole:"))return await assignRoleSelect(i);
      if(i.customId!=="ticket:create")return answer(i,{content:"Dieses Menü ist nicht mehr aktiv.",ephemeral:true});
      return await createTicket(i);
    }catch(e){console.error("Select action failed:",e);return replyError(i,e);}
  }
  async function assignRoleSelect(i){
    const applicationId=i.customId.split(":")[2],roleId=i.values[0];
    const denied=guard(i,"leaders","Leitungsrolle");if(denied)return answer(i,{content:denied,ephemeral:true});
    if(roleId==="none"){audit(db,i.guildId,i.user.id,"application.role_skipped",applicationId,{});return updateMessage(i,{content:"Es wurde keine Rolle vergeben.",components:[]});}
    const result=await assignRankRole({db,config,guild:i.guild,applicationId,roleId,actorId:i.user.id});
    return updateMessage(i,{content:result.message,components:[]});
  }
  const { closeConfirmRow, closeTicket, createTicket, reopenTicket, ticketAllowed, ticketCommand } = createTicketCommands({ answer, can, client, config, db, groups, guard, isOwner, memberRoleIds, postManagedPanel, respond, tickets });
  async function modal(i){
    try{
      if(wrongGuild(i))return answer(i,{content:"Der Bot ist für diesen Server nicht freigeschaltet.",ephemeral:true});
      if(i.customId.startsWith("application:reject-reason:")){
        const denied=guard(i,"reviewers","Reviewer-Rolle");if(denied)return answer(i,{content:denied,ephemeral:true});
        const id=i.customId.split(":")[2],reason=i.fields.getTextInputValue("reason").trim();
        if(reason.length<3)return answer(i,{content:"Bitte beschreibe den Ablehnungsgrund etwas genauer.",ephemeral:true});
        const result=await decideApplication(i,{id,status:"rejected",note:reason});
        if(!result)return answer(i,{content:"Dieser Antrag wurde bereits entschieden oder nicht gefunden.",ephemeral:true});
        if(i.message)await i.message.edit({...buildApplicationReviewPayload(result.row.kind,result.row.user_id,JSON.parse(result.row.answers),"rejected",reason),components:[]}).catch(()=>{});
        return answer(i,{content:`Antrag abgelehnt. Der Grund wurde gespeichert${result.dmSent?" und dem Antragsteller gesendet":"; die private Nachricht konnte nicht zugestellt werden"}.`,ephemeral:true});
      }
      if(i.customId.startsWith("application:note-submit:")){
        const denied=guard(i,"reviewers","Reviewer-Rolle");if(denied)return answer(i,{content:denied,ephemeral:true});
        const note=i.fields.getTextInputValue("note");
        const result=applications.addNote({guildId:i.guildId,applicationId:i.customId.split(":")[2],authorId:i.user.id,note});
        await postApplicationNote(i.guild,result.application,i.user.id,note.trim());
        return answer(i,{content:"Notiz wurde gespeichert. Sie ist nur für das Team sichtbar.",ephemeral:true});
      }
      if(i.customId==="absence:shortsubmit")return await createShortAbsence(i,{until:i.fields.getTextInputValue("until"),reason:(()=>{try{return i.fields.getTextInputValue("reason");}catch{return "";}})()});
      if(i.customId==="absence:submit")return await createAbsence(i,{from:i.fields.getTextInputValue("from"),until:i.fields.getTextInputValue("until"),reason:i.fields.getTextInputValue("reason")});
      if(i.customId==="verify:submit")return await submitVerification(i);
      if(i.customId==="verify:rename-submit")return await submitVerification(i,{rename:true});
      if(!i.customId.startsWith("application:submit:"))return;
      const kind=i.customId.split(":")[2];if(!APPLICATION_KINDS.includes(kind))return answer(i,{content:"Dieser Antragstyp ist ungültig.",ephemeral:true});
      const answers=Object.fromEntries(applicationQuestions(kind).map(question=>[question.id,i.fields.getTextInputValue(question.id)??""]));
      const id=randomUUID(),ts=isoNow();
      const inserted=db.transaction(()=>{
        const open=db.prepare("SELECT id FROM applications WHERE guild_id=? AND user_id=? AND kind=? AND status IN ('open','review')").get(i.guildId,i.user.id,kind);
        if(open)return open;
        db.prepare("INSERT INTO applications(id,guild_id,user_id,kind,answers,status,created_at,updated_at) VALUES(?,?,?,?,?,'open',?,?)").run(id,i.guildId,i.user.id,kind,JSON.stringify(answers),ts,ts);
        const previous=db.prepare("SELECT COUNT(*) n FROM applications WHERE guild_id=? AND user_id=? AND kind=? AND id<>?").get(i.guildId,i.user.id,kind,id).n;
        audit(db,i.guildId,i.user.id,"application.submitted",id,{kind,applicantId:i.user.id,previousSubmissions:previous});
        return null;
      })();
      if(inserted)return answer(i,{content:`Du hast bereits einen offenen Antrag dieses Typs (Referenz \`${inserted.id.slice(0,8)}\`). Ziehe ihn mit \`/antrag status\` zurück, wenn du neu einreichen möchtest.`,ephemeral:true});
      const channel=await applicationReviewChannel(i.guild,config,kind);
      if(!channel)return answer(i,{content:`Dein Antrag wurde gespeichert, aber der Staff-Channel für ${kind==="rang"?"Rang-Anträge":"Bewerbungen"} wurde nicht gefunden. Bitte melde es der Leitung. Referenz: \`${id}\``,ephemeral:true});
      const previous=db.prepare("SELECT COUNT(*) n FROM applications WHERE guild_id=? AND user_id=? AND kind=? AND id<>?").get(i.guildId,i.user.id,kind,id).n;
      const payload=buildApplicationReviewPayload(kind,i.user.id,answers);
      if(previous)payload.embeds[0].addFields({name:"ℹ️ Hinweis",value:`Neue Einreichung · ${previous} frühere(r) Antrag/Anträge dieses Typs`});
      const msg=await channel.send({...payload,components:applicationReviewComponents(id,"open")});
      db.prepare("UPDATE applications SET message_id=? WHERE id=?").run(msg.id,id);
      const dmSent=await i.user.send(applicationSubmittedDm({kind,applicationId:id})).then(()=>true).catch(()=>false);
      return answer(i,{...fieldsEmbed("📨 Antrag eingereicht",[
        {name:"Antrag",value:kind==="rang"?"🏅 Rang-Antrag":"🤝 Familienbewerbung",inline:true},
        {name:"Status",value:"✅ An das zuständige Team weitergeleitet",inline:true},
        {name:"Referenz",value:`\`${id}\``,inline:false},
        {name:"Private Nachricht",value:dmSent?"Eine Eingangsbestätigung wurde dir per DM geschickt.":"Deine Discord-DMs sind geschlossen. Der Antrag ist trotzdem sicher eingegangen.",inline:false},
      ],"Du wirst privat benachrichtigt, sobald die Prüfung beginnt oder das Team entschieden hat."),ephemeral:true});
    }catch(e){console.error("Modal action failed:",e);return replyError(i,e);}
  }

  async function reviewButton(i){
    try{
      if(wrongGuild(i))return answer(i,{content:"Der Bot ist für diesen Server nicht freigeschaltet.",ephemeral:true});
      const [,action,id]=i.customId.split(":");
      if(action==="open"){
        if(!APPLICATION_KINDS.includes(id))return answer(i,{content:"Dieser Antragstyp ist ungültig.",ephemeral:true});
        if(id==="rang"){const gate=memberGate(i);if(gate)return answer(i,{content:gate,ephemeral:true});}
        return i.showModal(applicationModal(id));
      }
      const denied=guard(i,"reviewers","Reviewer-Rolle");if(denied)return answer(i,{content:denied,ephemeral:true});
      const row=db.prepare("SELECT * FROM applications WHERE id=? AND guild_id=?").get(id,i.guildId);
      if(!row)return answer(i,{content:"Antrag nicht gefunden.",ephemeral:true});
      if(action==="note"){
        const noteModal=new ModalBuilder().setCustomId(`application:note-submit:${id}`).setTitle("Interne Notiz");
        noteModal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("note").setLabel("Notiz (nur für das Team sichtbar)").setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(2).setMaxLength(1000)));
        return i.showModal(noteModal);
      }
      if(!["open","review"].includes(row.status))return answer(i,{content:"Dieser Antrag wurde bereits abgeschlossen.",ephemeral:true});
      if(action==="review"){
        if(row.status==="review"){
          await i.message.edit({...buildApplicationReviewPayload(row.kind,row.user_id,JSON.parse(row.answers),"review","",row.reviewer_id),components:applicationReviewComponents(id,"review")}).catch(()=>{});
          return answer(i,{content:`Dieser Antrag wird bereits von <@${row.reviewer_id}> bearbeitet.`,ephemeral:true});
        }
        const claimed=db.transaction(()=>{
          const changed=db.prepare("UPDATE applications SET status='review',reviewer_id=?,updated_at=? WHERE id=? AND guild_id=? AND status='open' RETURNING user_id,kind,answers,message_id").get(i.user.id,isoNow(),id,i.guildId);
          if(changed)audit(db,i.guildId,i.user.id,"application.claimed",id,{kind:changed.kind,applicantId:changed.user_id,reviewerId:i.user.id});
          return changed;
        })();
        if(!claimed)return answer(i,{content:"Der Antrag wurde gerade bereits übernommen oder entschieden. Bitte aktualisiere die Ansicht.",ephemeral:true});
        await updateMessage(i,{...buildApplicationReviewPayload(claimed.kind,claimed.user_id,JSON.parse(claimed.answers),"review","",i.user.id),components:applicationReviewComponents(id,"review")});
        await client.users.fetch(claimed.user_id).then(user=>user.send(applicationInReviewDm({kind:claimed.kind,applicationId:id,reviewerId:i.user.id}))).catch(()=>{});
        return;
      }
      if(action==="reject"){
        const rejectModal=new ModalBuilder().setCustomId(`application:reject-reason:${id}`).setTitle("Antrag mit Grund ablehnen");
        rejectModal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Ablehnungsgrund für den Antragsteller").setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(3).setMaxLength(1000)));
        return i.showModal(rejectModal);
      }
      if(action!=="accept")return answer(i,{content:"Unbekannte Antragsaktion.",ephemeral:true});
      const result=await decideApplication(i,{id,status:"accepted",note:""});
      if(!result)return answer(i,{content:"Dieser Antrag wurde gerade bereits entschieden.",ephemeral:true});
      await updateMessage(i,{...buildApplicationReviewPayload(result.row.kind,result.row.user_id,JSON.parse(result.row.answers),"accepted"),components:[]});
      const offer=roleAssignmentOffer(i,result.row);
      if(offer)await followUp(i,offer).catch(()=>{});
    }catch(e){console.error("Review action failed:",e);return replyError(i,e);}
  }

  async function eventButton(i){const [,action]=i.customId.split(":");if(action==="join"||action==="leave")return button(i);
    if(action==="dm")return answer(i,{content:"Erinnerungen per DM gibt es nicht mehr – sie kommen im Event-Channel. Der Button verschwindet bei der nächsten Aktualisierung des Posts.",ephemeral:true});
    return answer(i,{content:"Unbekannte Event-Aktion.",ephemeral:true});}

  const attendance=i=>handleAttendanceInteraction({i,db,client:i.client??client,config});
  const eventProofs=i=>handleEventProofInteraction({i,db,config}).catch(e=>{console.error("Event-Nachweis fehlgeschlagen:",e);return replyError(i,e);});
  const tasks=i=>handleTaskInteraction({i,db,client:i.client??client,config}).catch(e=>{console.error("Aufgaben-Aktion fehlgeschlagen:",e);return replyError(i,e);});
  const eventManage=i=>handleEventManageInteraction({i,db,client:i.client??client,config}).catch(e=>{console.error("Teilnehmer-Verwaltung fehlgeschlagen:",e);return replyError(i,e);});
  const suggestions=i=>handleSuggestionInteraction({i,db,client:i.client??client,config}).catch(e=>{console.error("Vorschlag fehlgeschlagen:",e);return replyError(i,e);});
  return {command,autocomplete,button,select,modal,reviewButton,eventButton,attendance,tasks,eventProofs,eventManage,suggestions};
}

export async function handleComponent(i,handlers){if(i.customId?.startsWith("att:")&&handlers.attendance)return handlers.attendance(i);if(i.customId?.startsWith("task:")&&handlers.tasks)return handlers.tasks(i);if(i.customId?.startsWith("evp:")&&handlers.eventProofs)return handlers.eventProofs(i);if(i.customId?.startsWith("evm:")&&handlers.eventManage)return handlers.eventManage(i);if(i.customId?.startsWith("sug:")&&handlers.suggestions)return handlers.suggestions(i);if(i.isButton()){if(i.customId.startsWith("application:"))return handlers.reviewButton(i);if(i.customId.startsWith("event:"))return handlers.eventButton(i);return handlers.button(i);}if(i.isStringSelectMenu())return handlers.select(i);if(i.isModalSubmit())return handlers.modal(i);}

import { CHANNEL_BINDINGS } from "../channel-setup.js";
import { ChannelType, MessageFlags } from "discord.js";
import { PANEL_CHANNEL_KEYS, ensurePanels, panelList } from "../panels.js";
import { autoAssignChannels } from "../nexus-import.js";
import { applyRankNames } from "../rank-names.js";
import { PANEL_SETTING_KEY, VIEWS, buildPanelPayload, buildView } from "../staff-panel.js";
import { audit, getSetting, setSetting } from "../database.js";
import { checkChannels } from "../channel-check.js";
import { configWarnings } from "../config.js";
import { describeSchedule, nextOccurrence } from "../services/event-series.js";
import { embed, fieldsEmbed, unix } from "./shared.js";
import { formatMoney } from "../services/finance.js";
import { panelTexts } from "../services/texts.js";
import { presentInteractionPayload } from "../presentation.js";
import { publishActivityBoard, refreshActivityBoard } from "../activity-board.js";
import { syncNativeAutomod } from "../moderation.js";

/** Aus createHandler (commands.js) ausgelagert; bekommt die gemeinsamen Helfer und Dienste übergeben. */
export function createAdminCommands({ answer, can, client, config, db, finance, guard, isOwner, memberRoleIds, respond, series, settings }) {
  async function dashboardCommand(i,sub,g,u){
    if(sub==="panel"){
      const denied=guard(i,"staff","Staff-Rolle");if(denied)return respond(i,denied);
      const sent=await i.channel.send(buildPanelPayload(db,g,panelTexts(db,g,"staffDashboard")));
      const previous=getSetting(db,g,PANEL_SETTING_KEY);
      setSetting(db,g,PANEL_SETTING_KEY,`${sent.channelId}:${sent.id}`);
      audit(db,g,u,"config.panel_published",sent.id,{channelId:sent.channelId,previous});
      return respond(i,"Das Dashboard-Panel wurde veröffentlicht. Es wird automatisch aktualisiert; Details sieht jede Person nur privat und nur mit passender Rolle.");
    }
    const view=i.options.getString("bereich");
    if(!view){const denied=guard(i,"anyStaff","Staff-Rolle");if(denied)return respond(i,denied);const {components,...payload}=buildPanelPayload(db,g,panelTexts(db,g,"staffDashboard"));return answer(i,{...payload,components,ephemeral:true});}
    return showView(i,view);
  }
  function showView(i,view){
    const definition=VIEWS[view];
    if(!definition)return answer(i,{content:"Unbekannte Ansicht.",ephemeral:true});
    if(!can(i,definition.group))return answer(i,{content:`Für „${definition.label}“ fehlt dir die passende Rolle.`,ephemeral:true});
    return answer(i,{embeds:[buildView(db,i.guildId,view,{config,finance})],ephemeral:true});
  }

  async function settingsCommand(i,sub,g,u){
    const denied=guard(i,"leaders","Leitungsrolle");if(denied)return respond(i,denied);
    if(sub==="anzeigen"){
      const roles=list=>list?.length?list.map(id=>`<@&${id}>`).join(" "):"—";
      const channel=id=>id?`<#${id}>`:"—";
      const warnings=configWarnings(config);
      return answer(i,{...fieldsEmbed("⚙️ Aktive Einstellungen",[
        {name:"Rollen",value:`Leitung: ${roles(config.ROLE_LEADERS)}\nStaff: ${roles(config.ROLE_STAFF)}\nFinanzen: ${roles(config.ROLE_FINANCE)}\nFinanz-Einsicht: ${roles(config.ROLE_FINANCE_VIEWERS)}\nReviewer: ${roles(config.ROLE_REVIEWERS)}\nEvent-Team: ${roles(config.ROLE_EVENT_TEAM)}\nMitglieder: ${roles(config.ROLE_MEMBERS)}`.slice(0,1024)},
        {name:"Channels",value:Object.keys(CHANNEL_BINDINGS).map(key=>`${key}: ${channel(config[key])}`).join("\n").slice(0,1024)},
        {name:"Module",value:`AutoMod: ${config.AUTOMOD_ENABLED?"aktiv":"aus"} · Raid-Aktionen: ${config.RAID_ACTIONS.join(", ")||"keine"}\nRang-Rollenvergabe: ${config.RANK_ROLE_ASSIGNMENT_ENABLED?"aktiv":"aus"} · Webdashboard: ${config.DASHBOARD_ENABLED?"aktiv":"aus"}\nZeitzone: ${config.TIMEZONE} · Erinnerungen: ${config.EVENT_REMINDER_MINUTES.join(", ")||"aus"} Min.\nAuszahlungs-Mindestbetrag: ${config.PAYOUT_MINIMUM_CENTS!=null?formatMoney(config.PAYOUT_MINIMUM_CENTS):"keiner"}`},
        {name:`Hinweise (${warnings.length})`,value:warnings.length?warnings.map(w=>`• ${w}`).join("\n").slice(0,1024):"Keine offenen Konfigurationspunkte."},
      ],"Rollen werden in der .env gepflegt. Funktions-Channels können mit `/einstellungen kanal` gesetzt werden."),ephemeral:true});
    }
    if(sub==="raenge"){
      await i.deferReply({flags:MessageFlags.Ephemeral});
      if(!i.guild)return i.editReply("Nur auf dem Server möglich.");
      const r=await applyRankNames({guild:i.guild,config,settings,actorId:u,actorRoleIds:memberRoleIds(i),actorIsOwner:isOwner(i)}).catch(error=>({lines:[`❌ ${error.message}`],renamed:0,created:0}));
      audit(db,g,u,"ranks.renamed",null,{renamed:r.renamed,created:r.created});
      return i.editReply(presentInteractionPayload({embeds:[embed("🎖️ Rang-Rollen",`${r.lines.join("\n")}\n\nNamen ändern: Website → Einstellungen → Bewerbungen & Ränge → „Rang-Namen“.`.slice(0,4000))]}));
    }
    if(sub==="panels"){
      // Alle Panels in ihre eingestellten Channels senden bzw. aktualisieren (nie doppelt, siehe ensurePanels).
      await i.deferReply({flags:MessageFlags.Ephemeral});
      // Leere Funktions-Channels vorher anhand der Channel-Namen zuordnen (nur eindeutige Treffer, protokolliert).
      const assigned=[];
      if(settings&&i.guild){
        const auto=await autoAssignChannels({guild:i.guild,config}).catch(()=>({changes:[]}));
        for(const c of auto.changes){try{settings.update({key:c.key,value:c.value,actorId:u,actorRoleIds:memberRoleIds(i),actorIsOwner:isOwner(i)});assigned.push(`🔗 **${c.label}** → ${c.display}`);}catch{}}
      }
      const results=await ensurePanels({db,client,config,series}).catch(error=>{console.warn("Panels:",error.message);return [];});
      const status={posted:"✅ neu gesendet",adopted:"✅ übernommen",ok:"✅ aktualisiert",unknown:"⚠️ Discord nicht erreichbar – später erneut",channel_unavailable:"❌ Channel nicht erreichbar (Bot-Rechte prüfen)",not_ready:"⏳ noch nicht bereit",failed:"❌ Senden fehlgeschlagen (Bot-Rechte prüfen)"};
      const done=results.map(r=>`${status[r.status]??r.status} – **${r.panel}**`);
      const missing=panelList().filter(p=>!config[p.channelKey]).map(p=>`➖ **${p.label}** – kein Channel eingestellt (\`/einstellungen kanal\` oder Website)`);
      audit(db,g,u,"panels.sent",null,{results:results.map(r=>`${r.panel}: ${r.status}`).slice(0,20)});
      return i.editReply(presentInteractionPayload({embeds:[embed("📌 Panels",[...(assigned.length?["**Automatisch zugeordnet:**",...assigned,""]:[]),...done,...missing].join("\n").slice(0,4000)||"Keine Panels eingerichtet.")]}));
    }
    if(sub==="pruefen"){
      await i.deferReply({flags:MessageFlags.Ephemeral});
      const report=await checkChannels({guild:i.guild,config});
      const icon={ok:"✅",warn:"⚠️",error:"❌"};
      const lines=report.channels.map(r=>`${icon[r.status]} **${r.label}**${r.channel?` → #${r.channel.name}`:""}${r.issues.filter(x=>x.level!=="info").map(x=>`\n　└ ${x.text}`).join("")}`);
      const perms=report.guildPermissions.filter(p=>p.needed&&!p.has).map(p=>`❌ Bot fehlt **${p.label}** (${p.reason})`);
      const text=`**${report.summary.ok} ok · ${report.summary.warn} Hinweise · ${report.summary.error} Fehler**\n\n${[...perms,...lines].join("\n")}${report.administrator?"\n\nℹ️ Der Bot hat Administrator-Rechte – empfohlen sind nur die nötigen Einzelrechte.":""}`;
      return i.editReply(presentInteractionPayload({embeds:[embed("🔍 Channel-Prüfung",text.slice(0,4000))]}));
    }
    if(sub==="kanal"){
      if(!config.DISCORD_GUILD_ID)return respond(i,"Channel-Einstellungen werden nur mit gesetzter DISCORD_GUILD_ID gespeichert.");
      const key=i.options.getString("schluessel"),channel=i.options.getChannel("kanal");
      if(!Object.hasOwn(CHANNEL_BINDINGS,key))return respond(i,"Unbekannte Einstellung.");
      const wantsCategory=key==="CHANNEL_TICKET_CATEGORY";
      if(wantsCategory!==(channel.type===ChannelType.GuildCategory))return respond(i,wantsCategory?"Bitte eine Kategorie auswählen.":"Bitte einen Text-Channel auswählen.");
      if(settings)settings.update({key,value:channel.id,actorId:u,actorRoleIds:memberRoleIds(i),actorIsOwner:isOwner(i)});
      else{const previous=config[key]??null;setSetting(db,g,key,channel.id);config[key]=channel.id;audit(db,g,u,"config.changed",key,{setting:key,previous,value:channel.id});}
      if(PANEL_CHANNEL_KEYS.includes(key))await ensurePanels({db,client,config,series,only:[key]}).catch(()=>{});
      return respond(i,`Einstellung ${key} wurde aktualisiert: ${channel}. Die Änderung gilt sofort und bleibt nach einem Neustart erhalten.`);
    }
  }

  /** Postet ein Panel per Befehl. Ist für das Panel noch kein Channel eingestellt, wird es automatisch verwaltet. */
  async function postManagedPanel(i,channelKey,settingKey,payload){
    const sent=await i.channel.send(payload);
    if(!config[channelKey]&&config.DISCORD_GUILD_ID){
      setSetting(db,i.guildId,settingKey,`${sent.channelId}:${sent.id}`);
      if(settings)settings.update({key:channelKey,value:sent.channelId,actorId:i.user.id,actorRoleIds:memberRoleIds(i),actorIsOwner:true});
    }
    return sent;
  }

  async function activityCommand(i,sub,g,u){
    if(!series)return respond(i,"Aktivitäten sind nicht verfügbar.");
    if(sub==="liste"){
      const list=series.list(g);
      const lines=list.map(item=>{const next=item.active?nextOccurrence(item,config.TIMEZONE):null;return `${item.active?"🟢":"⚪"} **${item.name}** · ${describeSchedule(item)}${next?` · nächstes <t:${unix(next.toISOString())}:R>`:""}`;});
      return answer(i,{...fieldsEmbed("📆 Aktivitätenplan",[],(lines.join("\n")||"Keine Aktivitäten angelegt.").slice(0,4000)+"\n\n🟢 aktiv (wird automatisch angekündigt) · ⚪ inaktiv"),ephemeral:true});
    }
    const denied=guard(i,"events","Event-Team");if(denied)return respond(i,denied);
    if(sub==="status"){
      const row=series.setActive({guildId:g,id:i.options.getString("aktivitaet"),actorId:u,active:i.options.getBoolean("aktiv")});
      if(!row)return respond(i,"Aktivität nicht gefunden.");
      await refreshActivityBoard({db,client,config,series});
      return respond(i,`**${row.name}** ist jetzt ${row.active?"aktiv. Termine werden automatisch im Event-Channel angekündigt.":"inaktiv. Es werden keine neuen Termine mehr angekündigt."}`);
    }
    if(sub==="board"){
      await publishActivityBoard({db,channel:i.channel,config,series,actorId:u});
      return respond(i,"Die Aktivitäten-Übersicht wurde veröffentlicht und aktualisiert sich automatisch.");
    }
  }

  async function automodCommand(i,sub,g,u){
    if(sub==="status"){
      const denied=guard(i,"staff","Staff-Rolle");if(denied)return respond(i,denied);
      const rows=db.prepare("SELECT rule,COUNT(*) n FROM automod_actions WHERE guild_id=? AND created_at>=? GROUP BY rule").all(g,new Date(Date.now()-7*86_400_000).toISOString());
      const nativeId=getSetting(db,g,"AUTOMOD_NATIVE_RULE_ID");
      return answer(i,{...fieldsEmbed("🛡️ AutoMod & Raid-Schutz",[
        {name:"Status",value:`Bot-AutoMod: **${config.AUTOMOD_ENABLED?"aktiv":"aus"}**\nNative Discord-Regel: ${nativeId?`eingerichtet (\`${nativeId}\`)`:"nicht eingerichtet"}`},
        {name:"Regeln & Aktionen",value:`Spam (${config.AUTOMOD_SPAM_COUNT} in ${config.AUTOMOD_SPAM_WINDOW_SECONDS}s): ${config.AUTOMOD_SPAM_ACTIONS.join(", ")}\nWiederholung (${config.AUTOMOD_DUPLICATE_COUNT}×): ${config.AUTOMOD_DUPLICATE_ACTIONS.join(", ")}\nLinks (erlaubt: ${config.AUTOMOD_ALLOWED_DOMAINS.join(", ")||"keine"}): ${config.AUTOMOD_LINK_ACTIONS.join(", ")}\nBegriffe (${config.AUTOMOD_BLOCKED_TERMS.length}): ${config.AUTOMOD_TERM_ACTIONS.join(", ")}\nEskalation: ${config.AUTOMOD_ESCALATION_COUNT?`${config.AUTOMOD_ESCALATION_COUNT} Verstöße in ${config.AUTOMOD_ESCALATION_WINDOW_MINUTES} Min. → Timeout ${config.AUTOMOD_TIMEOUT_MINUTES} Min.`:"aus"}`.slice(0,1024)},
        {name:"Raid-Schutz",value:`${config.RAID_JOIN_COUNT} Beitritte in ${config.RAID_WINDOW_SECONDS}s → ${config.RAID_ACTIONS.join(", ")||"nur Protokoll"}\nNachrichtenflut: ${config.FLOOD_MESSAGE_COUNT?`${config.FLOOD_MESSAGE_COUNT} in ${config.FLOOD_WINDOW_SECONDS}s → Staff-Meldung`:"aus"}`},
        {name:"Ausnahmen",value:"Mitglieder mit „Nachrichten verwalten“, alle Staff-Rollen sowie AUTOMOD_EXEMPT_ROLES/AUTOMOD_EXEMPT_CHANNELS."},
        {name:"Maßnahmen (7 Tage)",value:rows.length?rows.map(r=>`${r.rule}: ${r.n}`).join("\n"):"Keine"},
      ]),ephemeral:true});
    }
    if(sub==="sync"){
      const denied=guard(i,"leaders","Leitungsrolle");if(denied)return respond(i,denied);
      const result=await syncNativeAutomod({guild:i.guild,db,config,actorId:u,getSetting,setSetting});
      return respond(i,`Native Discord-AutoMod-Regel wurde ${result.created?"erstellt":"aktualisiert"} (${result.terms} Begriffe). Staff-Rollen sind ausgenommen.`);
    }
  }

  return { activityCommand, automodCommand, dashboardCommand, postManagedPanel, settingsCommand, showView };
}

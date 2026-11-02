import { AbsenceError, formatDay, localDay, parseDay } from "../services/absences.js";
import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { cleanupShortAbsencePosts, postAbsence, postShortAbsence, removeAbsencePost, updateAbsenceList } from "../absence-posts.js";
import { fieldsEmbed } from "./shared.js";
import { parseShortUntil } from "../services/short-absences.js";

/** Aus createHandler (commands.js) ausgelagert; bekommt die gemeinsamen Helfer und Dienste übergeben. */
export function createAbsenceCommands({ absences, answer, client, config, db, guard, memberGate, respond, shortAbsences }) {
  // ---------------------------------------------------------------- Abmeldungen
  const today=()=>localDay(new Date(),config.TIMEZONE);
  const absenceEmbed=(row,title="🚫 Abmeldung eingetragen",note="Du zählst in dieser Zeit nicht als inaktiv; Fehlen bei Events gilt als entschuldigt.")=>fieldsEmbed(title,[
    {name:"Zeitraum",value:`**${formatDay(row.starts_on)} – ${formatDay(row.ends_on)}**`,inline:true},{name:"Grund",value:row.reason,inline:true}],note);
  async function createAbsence(i,{from,until,reason}){
    const gate=memberGate(i);if(gate)return answer(i,{content:"Abmeldungen gibt es nur für Mitglieder der Yamamoto-Familie.",ephemeral:true});
    const row=absences.create({guildId:i.guildId,userId:i.user.id,actorId:i.user.id,startsOn:parseDay(from,config.TIMEZONE),endsOn:parseDay(until,config.TIMEZONE,new Date(),{base:parseDay(from,config.TIMEZONE)}),reason,timezone:config.TIMEZONE,maxDays:config.ABSENCE_MAX_DAYS});
    await answer(i,{...absenceEmbed(row),ephemeral:true});
    await postAbsence({db,client,config,row});
    return row;
  }
  /** „Kurz weg“: Minuten/Stunden statt ganzer Tage. */
  function openShortAbsenceModal(i){
    return i.showModal(new ModalBuilder().setCustomId("absence:shortsubmit").setTitle("Kurz weg").addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("until").setLabel("Wie lange?").setPlaceholder("z. B. 30 min, 2h, 1,5 h oder bis 21:30").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Grund (optional, sieht nur das Team)").setPlaceholder("z. B. Essen, Arzt, Arbeit").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200))));
  }
  async function createShortAbsence(i,{until,reason=""}){
    let end;
    try{end=parseShortUntil(until,config.TIMEZONE);}catch(error){if(error instanceof AbsenceError)return answer(i,{content:error.message,ephemeral:true});throw error;}
    const {row}=shortAbsences.create({guildId:i.guildId,userId:i.user.id,until:end,reason});
    await cleanupShortAbsencePosts({client:i.client??client,config,service:shortAbsences}).catch(()=>{});
    await postShortAbsence({db,client:i.client??client,config}).catch(()=>{});
    const t=Math.floor(end.getTime()/1000);
    return answer(i,{content:`⏱️ Du bist **kurz weg** bis <t:${t}:t> (<t:${t}:R>). Früher zurück? **Wieder da** drücken.`,ephemeral:true});
  }
  async function endOwnAbsence(i){
    // Zuerst „Kurz weg“ beenden, falls aktiv.
    const short=shortAbsences.end({guildId:i.guildId,userId:i.user.id});
    if(short){await cleanupShortAbsencePosts({client:i.client??client,config,service:shortAbsences}).catch(()=>{});await updateAbsenceList({db,client:i.client??client,config}).catch(()=>{});return answer(i,{content:"✅ Willkommen zurück! „Kurz weg“ ist beendet.",ephemeral:true});}
    const open=absences.openFor(i.guildId,i.user.id,today());
    if(!open)return answer(i,{content:"Du hast gerade keine offene Abmeldung.",ephemeral:true});
    const row=absences.end({guildId:i.guildId,absenceId:open.id,actorId:i.user.id});
    await answer(i,{...absenceEmbed(row,"✅ Willkommen zurück!","Deine Abmeldung ist beendet."),ephemeral:true});
    await removeAbsencePost({db,client,config,row}).catch(()=>{});
    return row;
  }
  async function absenceCommand(i,sub,g,u){
    if(sub==="melden")return createAbsence(i,{from:i.options.getString("von"),until:i.options.getString("bis"),reason:i.options.getString("grund")});
    if(sub==="beenden")return endOwnAbsence(i);
    if(sub==="kurz")return createShortAbsence(i,{until:i.options.getString("dauer"),reason:i.options.getString("grund")??""});
    if(sub==="liste"){
      const denied=guard(i,"anyStaff","Staff-Rolle");if(denied)return respond(i,denied);
      const now=absences.current(g,today()),next=absences.upcoming(g,today(),10);
      const line=r=>`<@${r.user_id}> · ${formatDay(r.starts_on)} – ${formatDay(r.ends_on)} · ${r.reason}`;
      return answer(i,{...fieldsEmbed("🚫 Abmeldungen",[
        {name:`Gerade abgemeldet (${now.length})`,value:(now.map(line).join("\n")||"Niemand").slice(0,1024)},
        {name:`Geplant (${next.length})`,value:(next.map(line).join("\n")||"Keine").slice(0,1024)},
      ],"Alle Abmeldungen und Inaktivität auch auf der Website im Bereich *Aktivität*."),ephemeral:true});
    }
  }
  function openAbsenceModal(i){
    const field=(id,label,placeholder,style=TextInputStyle.Short,max=20)=>new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setStyle(style).setRequired(true).setMaxLength(max));
    return i.showModal(new ModalBuilder().setCustomId("absence:submit").setTitle("Abmeldung").addComponents(
      field("from","Von","heute, morgen, Freitag oder 20.10."),field("until","Bis","z. B. 27.10., Sonntag, 3 Tage oder 1 Woche"),field("reason","Grund (sieht nur das Team)","z. B. Urlaub",TextInputStyle.Paragraph,300)));
  }

  return { absenceCommand, createAbsence, createShortAbsence, endOwnAbsence, openAbsenceModal, openShortAbsenceModal };
}

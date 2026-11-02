import { audit } from "../database.js";
import { cancelEvent } from "../event-checks.js";
import { deleteEventPosts, publishEvent, refreshEventPosts } from "../event-posts.js";
import { fieldsEmbed, isoNow, statusLabels, targetChannel, unix } from "./shared.js";
import { logEmbed } from "../presentation.js";
import { parseEventDate } from "./builders.js";
import { randomUUID } from "node:crypto";
import { requestAttendance } from "../attendance.js";

/** Aus createHandler (commands.js) ausgelagert; bekommt die gemeinsamen Helfer und Dienste übergeben. */
export function createEventCommands({ absences, answer, client, config, db, events, guard, respond }) {
  async function eventCommand(i,sub,g,u) {
    const invalidDate=()=>respond(i,`Bitte ein gültiges zukünftiges Datum eingeben, z. B. 31.12.2026 19:00 (${config.TIMEZONE}).`);
    const participantsOf=id=>events.participants(id);
    if(sub==="erstellen") {
      const denied=guard(i,"events","Event-Team");if(denied)return respond(i,denied);
      const start=parseEventDate(i.options.getString("start"),config.TIMEZONE);
      if(!start||start.getTime()<Date.now()+60_000)return invalidDate();
      const id=randomUUID();
      const item={id,guild_id:g,name:i.options.getString("name"),description:i.options.getString("beschreibung"),starts_at:start.toISOString(),location:i.options.getString("treffpunkt"),host_id:u,equipment:i.options.getString("ausruestung")??"",notes:i.options.getString("hinweise")??"",max_participants:i.options.getInteger("maximum")};
      const posted=await publishEvent({db,client,config,event:{...item,status:"scheduled"},fallbackChannel:i.channel});
      try{
        db.transaction(()=>{
          db.prepare("INSERT INTO events(id,guild_id,channel_id,message_id,announce_channel_id,announce_message_id,name,description,starts_at,location,host_id,equipment,notes,max_participants,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'scheduled',?)").run(id,g,posted.channelId,posted.messageId,posted.announceChannelId,posted.announceMessageId,item.name,item.description,item.starts_at,item.location,u,item.equipment,item.notes,item.max_participants,isoNow());
          if(i.options.getInteger("mindestens"))db.prepare("UPDATE events SET min_participants=? WHERE id=?").run(i.options.getInteger("mindestens"),id);
          audit(db,g,u,"event.created",id,{name:item.name,startsAt:item.starts_at,channelId:posted.channelId});
        })();
      }catch(error){await deleteEventPosts({client,posted});throw error;}
      return answer(i,{...fieldsEmbed("📅 Event veröffentlicht",[
        {name:"Event",value:`**${item.name}**`,inline:true},{name:"Beginn",value:`<t:${unix(item.starts_at)}:F>`,inline:true},
        {name:"Anmeldung",value:`<#${posted.channelId}>`,inline:true},...(posted.announceChannelId?[{name:"Ankündigung",value:`<#${posted.announceChannelId}>`,inline:true}]:[]),
        {name:"Erinnerungen",value:config.EVENT_REMINDER_MINUTES.length?config.EVENT_REMINDER_MINUTES.map(m=>`${m} Min.`).join(", ")+" vorher":"deaktiviert",inline:true},
      ],"Das Event ist jetzt für die Familie sichtbar."),ephemeral:true});
    }
    if(sub==="liste"||sub==="historie") {
      const rows=sub==="liste"
        ?db.prepare("SELECT * FROM events WHERE guild_id=? AND status='scheduled' ORDER BY starts_at LIMIT 10").all(g)
        :db.prepare("SELECT * FROM events WHERE guild_id=? AND status IN ('ended','cancelled') ORDER BY starts_at DESC LIMIT 10").all(g);
      const items=rows.map(e=>{
        const c=db.prepare("SELECT SUM(status IN ('signed_up','present')) active, SUM(status='present') present, SUM(status='absent') absent FROM event_participants WHERE event_id=?").get(e.id);
        return {name:`${sub==="historie"?`${statusLabels[e.status]} · `:""}${e.name} · <t:${unix(e.starts_at)}:${sub==="liste"?"F":"d"}>`.slice(0,256),value:`**Treffpunkt:** ${e.location}\n**Teilnehmer:** ${c.active??0}${e.max_participants?` / ${e.max_participants}`:""}${sub==="historie"?` · **Anwesend:** ${c.present??0} · **Abwesend:** ${c.absent??0}`:""}\n**Event-ID:** \`${e.id.slice(0,8)}\``.slice(0,1024),inline:false};
      });
      return answer(i,{...fieldsEmbed(sub==="liste"?"📅 Anstehende Familien-Events":"🏁 Event-Historie",items,rows.length?`${rows.length} ${sub==="liste"?"kommende":"vergangene"} Events, maximal 10 angezeigt.`:"Keine passenden Events vorhanden."),ephemeral:true});
    }
    if(sub==="teilnehmer"){
      const event=db.prepare("SELECT * FROM events WHERE id=? AND guild_id=?").get(i.options.getString("id"),g);
      if(!event)return respond(i,"Event nicht gefunden.");
      const rows=db.prepare("SELECT user_id,status FROM event_participants WHERE event_id=? AND status<>'left' ORDER BY updated_at").all(event.id);
      const label={signed_up:"🙋 angemeldet",present:"✅ anwesend",absent:"➖ abwesend"};
      return answer(i,{...fieldsEmbed(`🙋 Teilnehmer · ${event.name}`.slice(0,256),[],rows.length?rows.map(r=>`<@${r.user_id}> · ${label[r.status]??r.status}`).join("\n").slice(0,4000):"Noch keine Teilnehmer."),ephemeral:true});
    }
    if(sub==="bearbeiten"){
      const denied=guard(i,"events","Event-Team");if(denied)return respond(i,denied);
      const id=i.options.getString("id"),old=db.prepare("SELECT * FROM events WHERE id=? AND guild_id=? AND status='scheduled'").get(id,g);
      if(!old)return respond(i,"Geplantes Event nicht gefunden.");
      const startText=i.options.getString("start"),start=startText?parseEventDate(startText,config.TIMEZONE):new Date(old.starts_at);
      if(startText&&(!start||start.getTime()<Date.now()+60_000))return invalidDate();
      const next={name:i.options.getString("name")??old.name,starts_at:start.toISOString(),location:i.options.getString("treffpunkt")??old.location,description:i.options.getString("beschreibung")??old.description,max_participants:i.options.getInteger("maximum")??old.max_participants,equipment:i.options.getString("ausruestung")??old.equipment,notes:i.options.getString("hinweise")??old.notes};
      const changes=Object.fromEntries(Object.entries(next).filter(([key,value])=>value!==old[key]).map(([key,value])=>[key,{alt:old[key],neu:value}]));
      if(!Object.keys(changes).length)return respond(i,"Keine Änderung angegeben.");
      db.transaction(()=>{
        db.prepare("UPDATE events SET name=?,starts_at=?,location=?,description=?,max_participants=?,equipment=?,notes=? WHERE id=? AND status='scheduled'").run(next.name,next.starts_at,next.location,next.description,next.max_participants,next.equipment,next.notes,id);
        if(i.options.getInteger("mindestens"))db.prepare("UPDATE events SET min_participants=?,min_checked_at=NULL WHERE id=?").run(i.options.getInteger("mindestens"),id);
        if(changes.starts_at)db.prepare("DELETE FROM event_reminders WHERE event_id=?").run(id);
        audit(db,g,u,"event.updated",id,{name:next.name,startsAt:next.starts_at,changed:Object.keys(changes).join(", ")});
      })();
      // Höheres Limit: Wartende rücken nach.
      if(changes.max_participants)for(const userId of events.fillFromWaitlist(id))void client.users.fetch(userId).then(user=>user.send(`🎉 Du bist für **${next.name}** von der Warteliste nachgerückt (<t:${unix(next.starts_at)}:F>).`)).catch(()=>{});
      const updated=db.prepare("SELECT * FROM events WHERE id=?").get(id);
      const message=await refreshEventPosts({db,client,config,event:updated});
      return answer(i,{...fieldsEmbed("✏️ Event aktualisiert",[
        {name:"Event",value:`**${updated.name}**`,inline:true},{name:"Beginn",value:`<t:${unix(updated.starts_at)}:F>`,inline:true},
        {name:"Geändert",value:Object.keys(changes).join(", ")},
        {name:"Ankündigung",value:message?"Die veröffentlichte Event-Karte wurde aktualisiert.":"Eventdaten gespeichert; die ursprüngliche Ankündigung war nicht mehr verfügbar."},
      ]),ephemeral:true});
    }
    if(sub==="anwesenheit"){
      const denied=guard(i,"events","Event-Team");if(denied)return respond(i,denied);
      const target=i.options.getUser("mitglied"),status=i.options.getString("status");
      const result=events.setAttendance({guildId:g,eventId:i.options.getString("id"),userId:target.id,status,actorId:u});
      if(!result)return respond(i,"Event nicht gefunden oder abgesagt.");
      const excused=status==="absent"&&absences.wasAbsent(g,target.id,result.event.starts_at,config.TIMEZONE);
      return answer(i,{...fieldsEmbed("📝 Teilnahme dokumentiert",[
        {name:"Event",value:result.event.name,inline:true},{name:"Mitglied",value:`<@${target.id}>`,inline:true},{name:"Ergebnis",value:status==="present"?"✅ Anwesend":excused?"🚫 Abwesend – entschuldigt (abgemeldet)":"➖ Abwesend",inline:true},
      ],result.previous?"Der Teilnahmestatus wurde in der Eventhistorie gespeichert.":"Das Mitglied war nicht angemeldet und wurde nachgetragen."),ephemeral:true});
    }
    if(sub==="beenden"||sub==="absagen") {
      const denied=guard(i,"events","Event-Team");if(denied)return respond(i,denied);
      const status=sub==="beenden"?"ended":"cancelled",id=i.options.getString("id"),reason=i.options.getString("grund")??"";
      if(sub==="absagen"){
        const cancelled=await cancelEvent({db,client,config,eventId:id,actorId:u,reason});
        return respond(i,cancelled?`Event **${cancelled.name}** wurde abgesagt. Die Angemeldeten wurden informiert.`:"Geplantes Event nicht gefunden.");
      }
      const row=db.transaction(()=>{
        const changed=db.prepare("UPDATE events SET status=? WHERE id=? AND guild_id=? AND status='scheduled' RETURNING *").get(status,id,g);
        if(changed)audit(db,g,u,`event.${status}`,id,{name:changed.name,reason});
        return changed;
      })();
      if(!row)return respond(i,"Geplantes Event nicht gefunden.");
      const participants=participantsOf(id);
      const message=await eventMessage(i.guild,row);
      await refreshEventPosts({db,client,config,event:row,state:status});
      if(sub==="beenden")await requestAttendance({db,client,config,event:row}).catch(()=>{});
      if(sub==="absagen"&&participants.length&&message?.channel&&!(row.series_id&&config.EVENT_SERIES_DELETE_ENDED))await message.channel.send({content:`${participants.slice(0,50).map(p=>`<@${p.user_id}>`).join(" ")}`,embeds:[logEmbed("❌ Event abgesagt",`**${row.name}** am <t:${unix(row.starts_at)}:F> findet nicht statt.${reason?`\n**Grund:** ${reason}`:""}`,"warning")],allowedMentions:{users:participants.slice(0,50).map(p=>p.user_id)}}).catch(()=>{});
      return respond(i,sub==="beenden"?`Event **${row.name}** wurde beendet. Bitte jetzt die Anwesenheit eintragen (Button im Event-Log oder Website) – erst danach ist es abgeschlossen.`:`Event **${row.name}** wurde abgesagt.`);
    }
  }
  async function eventMessage(guild,event){const channel=await targetChannel(guild,event.channel_id);return channel&&event.message_id?channel.messages.fetch(event.message_id).catch(()=>null):null;}

  return { eventCommand };
}

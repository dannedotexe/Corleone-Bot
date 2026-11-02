import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import { applicationDecisionDm, logEmbed } from "../presentation.js";
import { applicationModal, applicationReviewChannel, buildApplicationReviewPayload } from "./builders.js";
import { audit } from "../database.js";
import { fieldsEmbed, isoNow, statusLabels, unix } from "./shared.js";

/** Aus createHandler (commands.js) ausgelagert; bekommt die gemeinsamen Helfer und Dienste übergeben. */
export function createApplicationCommands({ answer, applications, can, client, config, db, finance, followUp, guard, memberGate, respond }) {
  async function decideApplication(i,{id,status,note}){
    const row=db.transaction(()=>{
      const changed=db.prepare("UPDATE applications SET status=?,reviewer_id=?,review_note=?,updated_at=? WHERE id=? AND guild_id=? AND status IN ('open','review') RETURNING *").get(status,i.user.id,note,isoNow(),id,i.guildId);
      if(changed)audit(db,i.guildId,i.user.id,`application.${status}`,id,{kind:changed.kind,applicantId:changed.user_id,reviewerId:i.user.id,reason:note});
      return changed;
    })();
    if(!row)return null;
    if(status==="accepted"&&row.kind==="bewerbung"&&config.ACCOUNT_AUTO_OPEN_FOR_MEMBERS&&!finance.isExcluded(i.guildId,row.user_id))finance.openAccount({guildId:i.guildId,userId:row.user_id,actorId:i.user.id,note:"Familienbewerbung angenommen"});
    const channel=await applicationReviewChannel(i.guild,config,row.kind);
    if(channel&&row.message_id){const msg=await channel.messages.fetch(row.message_id).catch(()=>null);if(msg&&msg.id!==i.message?.id)await msg.edit({...buildApplicationReviewPayload(row.kind,row.user_id,JSON.parse(row.answers),status,note),components:[]}).catch(()=>{});}
    const dmSent=await client.users.fetch(row.user_id).then(user=>user.send(applicationDecisionDm({kind:row.kind,status,applicationId:id,reason:note}))).then(()=>true).catch(()=>false);
    return {row,dmSent};
  }
  /** Bietet nach einem angenommenen Rang-Antrag die ausdrücklich konfigurierte Rollenvergabe an (nur Leitung). */
  function roleAssignmentOffer(i,row){
    if(row.kind!=="rang"||!config.RANK_ROLE_ASSIGNMENT_ENABLED||!config.RANK_ROLES_JSON.length||!can(i,"leaders"))return null;
    const select=new StringSelectMenuBuilder().setCustomId(`application:assignrole:${row.id}`).setPlaceholder("Optional: Rang-Rolle vergeben …")
      .addOptions([...config.RANK_ROLES_JSON.map(item=>({label:item.label,value:item.roleId})),{label:"Keine Rolle vergeben",value:"none"}].slice(0,25));
    return {content:`Soll <@${row.user_id}> jetzt eine Rang-Rolle erhalten? Die Vergabe wird protokolliert.`,components:[new ActionRowBuilder().addComponents(select)],ephemeral:true};
  }

  async function applicationCommand(i,sub,g,u) {
    if(sub==="bewerben"){
      const kind=i.options.getString("typ");
      if(kind==="rang"){const gate=memberGate(i);if(gate)return respond(i,gate);}
      await i.showModal(applicationModal(kind));return;
    }
    if(sub==="liste"){
      const denied=guard(i,"reviewers","Reviewer-Rolle");if(denied)return respond(i,denied);
      const rows=db.prepare("SELECT id,user_id,kind,status,reviewer_id,created_at FROM applications WHERE guild_id=? AND status IN ('open','review') ORDER BY created_at LIMIT 20").all(g);
      const items=rows.map(r=>({name:`${r.kind==="rang"?"🏅 Rang-Antrag":"🤝 Familienbewerbung"} · ${statusLabels[r.status]??r.status}`,value:`**Antragsteller:** <@${r.user_id}>\n**Eingereicht:** <t:${unix(r.created_at)}:R>${r.reviewer_id?`\n**Bearbeitung:** <@${r.reviewer_id}>`:""}\n**Antrags-ID:** \`${r.id}\``,inline:false}));
      return answer(i,{...fieldsEmbed("📨 Offene Anträge",items,rows.length?"Wähle den passenden Antrag im jeweiligen Staff-Channel aus.":"Es gibt aktuell keine offenen Anträge."),ephemeral:true});
    }
    if(sub==="kommentieren"){
      const denied=guard(i,"reviewers","Reviewer-Rolle");if(denied)return respond(i,denied);
      const result=applications.addNote({guildId:g,applicationId:i.options.getString("id"),authorId:u,note:i.options.getString("notiz")});
      await postApplicationNote(i.guild,result.application,u,i.options.getString("notiz"));
      return respond(i,"Notiz wurde gespeichert. Sie ist nur für das Team sichtbar.");
    }
    if(sub==="entscheiden"){
      const denied=guard(i,"reviewers","Reviewer-Rolle");if(denied)return respond(i,denied);
      const id=i.options.getString("id"),status=i.options.getString("entscheidung"),note=i.options.getString("kommentar")?.trim()??"";
      if(status==="rejected"&&note.length<3)return respond(i,"Bitte gib bei einer Ablehnung einen Grund an.");
      const result=await decideApplication(i,{id,status,note});
      if(!result)return respond(i,"Offener Antrag nicht gefunden.");
      await respond(i,`${result.row.kind==="rang"?"Der Rang-Antrag":"Die Familienbewerbung"} wurde ${status==="accepted"?"angenommen":"abgelehnt"}.${result.dmSent?"":" Die private Nachricht konnte nicht zugestellt werden."}`);
      const offer=status==="accepted"?roleAssignmentOffer(i,result.row):null;
      if(offer)await followUp(i,offer).catch(()=>{});
      return;
    }
    if(sub==="status"){
      const id=i.options.getString("id"),row=db.prepare("UPDATE applications SET status='withdrawn',updated_at=? WHERE id=? AND guild_id=? AND user_id=? AND status IN ('open','review') RETURNING id,kind,answers,message_id").get(isoNow(),id,g,u);
      if(!row)return respond(i,"Offener eigener Antrag nicht gefunden.");
      audit(db,g,u,"application.withdrawn",id,{kind:row.kind,applicantId:u});
      const channel=await applicationReviewChannel(i.guild,config,row.kind);
      if(channel&&row.message_id){const message=await channel.messages.fetch(row.message_id).catch(()=>null);if(message)await message.edit({...buildApplicationReviewPayload(row.kind,u,JSON.parse(row.answers),"withdrawn"),components:[]}).catch(()=>{});}
      return respond(i,"Dein Antrag wurde zurückgezogen. Das Team sieht den aktualisierten Status.");
    }
  }
  async function postApplicationNote(guild,application,authorId,note){
    const channel=await applicationReviewChannel(guild,config,application.kind);
    if(!channel)return;
    const original=application.message_id?await channel.messages.fetch(application.message_id).catch(()=>null):null;
    const payload={embeds:[logEmbed("💬 Interne Notiz",`**Antrag:** \`${application.id.slice(0,8)}\` · <@${application.user_id}>\n**Von:** <@${authorId}>\n\n${note}`)],allowedMentions:{parse:[]}};
    await (original?original.reply(payload):channel.send(payload)).catch(error=>console.warn("Antragsnotiz konnte nicht gepostet werden:",error.message));
  }

  return { applicationCommand, decideApplication, postApplicationNote, roleAssignmentOffer };
}

import { deliverWarning, deliverySummary } from "../warn-actions.js";
import { embed, fieldsEmbed, unix, warningStateIcon, warningStateLabel } from "./shared.js";
import { hasRole } from "../config.js";
import { presentInteractionPayload } from "../presentation.js";
import { warnBlockReason } from "../services/warnings.js";

/** Aus createHandler (commands.js) ausgelagert; bekommt die gemeinsamen Helfer und Dienste übergeben. */
export function createWarningCommands({ answer, can, client, config, db, groups, guard, isOwner, respond, warningService }) {
  async function issueWarning(i,g,u,{target,reason,caseRef}){
    const denied=guard(i,"moderation","Moderations- oder Staff-Rolle");if(denied)return respond(i,denied);
    const targetMember=i.options.getMember?.("mitglied")??await i.guild?.members?.fetch?.(target.id).catch(()=>null)??null;
    const targetRoleIds=targetMember?.roles?.cache?[...targetMember.roles.cache.keys()]:Array.isArray(targetMember?.roles)?targetMember.roles:[];
    const blocked=warnBlockReason({actorId:u,targetId:target.id,targetIsBot:target.bot,targetRoleIds,staffRoleIds:groups.anyStaff,actorIsLeader:hasRole(i.member,groups.leaders),actorIsOwner:isOwner(i)});
    if(blocked)return respond(i,blocked);
    const warning=warningService.add({guildId:g,userId:target.id,actorId:u,reason,caseRef,expireDays:config.WARN_EXPIRE_DAYS});
    const fields=[{name:"Mitglied",value:`<@${target.id}>`,inline:true},{name:"Aktive Verwarnungen",value:`**${warning.active}**`,inline:true},{name:"Referenz",value:`\`${warning.id.slice(0,8)}\``,inline:true},{name:"Grund",value:reason},...(caseRef?[{name:"Fallbezug",value:caseRef,inline:true}]:[])];
    const note="Verwarnungen haben keinen Einfluss auf das Familienkonto oder Auszahlungen.";
    await answer(i,{...fieldsEmbed("📝 Verwarnung eingetragen",fields,note),ephemeral:true});
    const result=await deliverWarning({db,client,config,guildId:g,userId:target.id,actorId:u,reason,caseRef,warning});
    const summary=deliverySummary(result,config);
    if(summary&&typeof i.editReply==="function")await i.editReply(presentInteractionPayload({...fieldsEmbed("📝 Verwarnung eingetragen",[...fields,{name:"Folgen",value:summary}],note)})).catch(()=>{});
    return result;
  }

  async function warningsCommand(i,g,u){
    const target=i.options.getUser("mitglied")?.id??u;
    if(target!==u&&!can(i,"moderation"))return respond(i,"Fremde Verwarnungen darf nur die Moderation ansehen.");
    const rows=warningService.list(g,target,{limit:15,expireDays:config.WARN_EXPIRE_DAYS});
    const active=warningService.activeCount(g,target,{expireDays:config.WARN_EXPIRE_DAYS});
    const items=rows.map(r=>({name:`${warningStateIcon[r.state]} ${warningStateLabel[r.state]} · <t:${unix(r.created_at)}:d>`.slice(0,256),value:`**Grund:** ${r.reason}${r.case_ref?` · Fall: ${r.case_ref}`:""}\n**Von:** <@${r.actor_id}> · \`${r.id.slice(0,8)}\`${r.revoked_at?`\n**Zurückgenommen:** <@${r.revoked_by}> – ${r.revoke_reason}`:""}`.slice(0,1024)}));
    const expiry=config.WARN_EXPIRE_DAYS>0?` Verwarnungen verfallen nach ${config.WARN_EXPIRE_DAYS} Tagen.`:"";
    return answer(i,{...fieldsEmbed("📝 Verwarnungen",items,rows.length?`Mitglied: <@${target}> · **${active} aktiv** · letzte ${rows.length} Einträge.${expiry}`:`Für <@${target}> gibt es keine Verwarnungen.`),ephemeral:true});
  }

  /** Findet die gemeinte Verwarnung: ausgewählte ID, eingetippte Referenz bzw. Grund, sonst die neueste aktive. */
  function resolveWarning(g,targetId,input){
    const active=warningService.list(g,targetId,{limit:100,expireDays:config.WARN_EXPIRE_DAYS}).filter(r=>r.state==="active");
    const value=String(input??"").trim();
    if(!value)return {row:active[0]??null,active};
    const exact=warningService.get(g,value);
    if(exact)return {row:exact.user_id===targetId?exact:null,active,mismatch:exact.user_id!==targetId};
    const needle=value.toLocaleLowerCase("de-AT");
    const hits=active.filter(r=>r.id.startsWith(needle)||r.reason.toLocaleLowerCase("de-AT").includes(needle));
    return {row:hits.length===1?hits[0]:null,active,ambiguous:hits.length>1};
  }

  async function unwarnCommand(i,g,u){
    const denied=guard(i,"moderation","Moderations- oder Staff-Rolle");if(denied)return respond(i,denied);
    const target=i.options.getUser("mitglied");
    const {row:existing,active,mismatch,ambiguous}=resolveWarning(g,target.id,i.options.getString("warnung"));
    if(mismatch)return respond(i,`Diese Verwarnung gehört nicht zu <@${target.id}>.`);
    if(ambiguous)return respond(i,"Mehrere Verwarnungen passen dazu. Bitte eine aus der Vorschlagsliste wählen.");
    if(!existing)return respond(i,active.length?"Diese Verwarnung wurde nicht gefunden. Bitte aus der Vorschlagsliste wählen oder das Feld leer lassen (dann wird die neueste genommen).":`<@${target.id}> hat keine aktiven Verwarnungen.`);
    // Reine Moderationsrollen nehmen nur eigene Verwarnungen zurück; Staff und Leitung alle.
    if(existing.actor_id!==u&&!can(i,"staff"))return respond(i,"Verwarnungen anderer Teammitglieder kann nur Staff oder die Leitung zurücknehmen.");
    const row=warningService.revoke({guildId:g,warningId:existing.id,actorId:u,allowSelf:isOwner(i),reason:i.options.getString("grund")});
    const remaining=warningService.activeCount(g,row.user_id,{expireDays:config.WARN_EXPIRE_DAYS});
    if(config.WARN_DM_ENABLED)await client.users.fetch(row.user_id).then(user=>user.send({embeds:[embed("✅ Verwarnung zurückgenommen",`Deine Verwarnung vom <t:${unix(row.created_at)}:d> („${row.reason}“) wurde zurückgenommen.\n**Grund:** ${row.revoke_reason}\n**Aktive Verwarnungen:** ${remaining}`)]})).catch(()=>{});
    return answer(i,{...fieldsEmbed("↩️ Verwarnung zurückgenommen",[{name:"Mitglied",value:`<@${row.user_id}>`,inline:true},{name:"Noch aktiv",value:String(remaining),inline:true},{name:"Ursprünglicher Grund",value:row.reason},{name:"Grund der Rücknahme",value:row.revoke_reason}],"Die Verwarnung zählt nicht mehr. In der Historie bleibt sie als „zurückgenommen“ sichtbar."),ephemeral:true});
  }

  return { issueWarning, unwarnCommand, warningsCommand };
}

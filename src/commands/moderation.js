import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { BAN_DELETE_CHOICES, MOD_PERMISSIONS, formatMinutes, hierarchyProblem, performModeration } from "../member-moderation.js";
import { MOD_ACTIONS } from "../services/moderation-log.js";
import { fieldsEmbed } from "./shared.js";
import { hasRole } from "../config.js";
import { warnBlockReason } from "../services/warnings.js";

/** Aus createHandler (commands.js) ausgelagert; bekommt die gemeinsamen Helfer und Dienste übergeben. */
export function createModerationCommands({ answer, client, db, groups, guard, isOwner, pendingModeration, respond, updateMessage }) {
  // ---------------------------------------------------------------- Moderation (Timeout, Kick, Bann)
  async function moderationCommand(i,g,u){
    const action=i.commandName,[group,label]=MOD_PERMISSIONS[action];
    const denied=guard(i,group,label);if(denied)return respond(i,denied);
    const user=i.options.getUser(action==="unban"?"person":"mitglied"),reason=i.options.getString("grund");
    const targetMember=action==="unban"?null:i.options.getMember?.("mitglied")??await i.guild?.members?.fetch?.(user.id).catch(()=>null)??null;
    if(action!=="unban"){
      const targetRoleIds=targetMember?.roles?.cache?[...targetMember.roles.cache.keys()]:[];
      const blocked=warnBlockReason({actorId:u,targetId:user.id,targetIsBot:user.bot,targetRoleIds,staffRoleIds:groups.anyStaff,actorIsLeader:hasRole(i.member,groups.leaders),actorIsOwner:isOwner(i)});
      if(blocked)return respond(i,blocked.replace("verwarnen","moderieren").replace("verwarnt","moderiert"));
      const problem=hierarchyProblem({action,actorMember:i.member,targetMember,actorIsOwner:isOwner(i),guildOwnerId:i.guild?.ownerId});
      if(problem)return respond(i,problem);
    }
    const request={action,userId:user.id,reason,minutes:i.options.getInteger("dauer"),deleteSeconds:i.options.getInteger("nachrichten")??0,actorId:u,expires:Date.now()+120_000};
    if(action==="kick"||action==="ban"){
      for(const [key,value] of pendingModeration)if(value.expires<Date.now())pendingModeration.delete(key);
      pendingModeration.set(i.id,request);
      const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mod:confirm:${i.id}`).setLabel(action==="ban"?"Endgültig bannen":"Kicken").setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId(`cancel:${i.id}`).setLabel("Abbrechen").setStyle(ButtonStyle.Secondary));
      return answer(i,{...fieldsEmbed(`${MOD_ACTIONS[action].emoji} ${MOD_ACTIONS[action].label} bestätigen`,[{name:"Person",value:`<@${user.id}>`,inline:true},{name:"Grund",value:reason},...(action==="ban"&&request.deleteSeconds?[{name:"Nachrichten löschen",value:BAN_DELETE_CHOICES.find(([v])=>v===request.deleteSeconds)?.[1]??"—",inline:true}]:[])],"Die Person bekommt vorher eine DM mit dem Grund. Die Bestätigung gilt 2 Minuten."),components:[row],ephemeral:true});
    }
    return executeModeration(i,request,targetMember,false);
  }
  async function executeModeration(i,request,targetMember,viaButton){
    const result=await performModeration({db,guild:i.guild,client,action:request.action,userId:request.userId,targetMember,actorId:request.actorId,reason:request.reason,minutes:request.minutes,deleteSeconds:request.deleteSeconds});
    const meta=MOD_ACTIONS[request.action];
    const payload=result.ok
      ?fieldsEmbed(`${meta.emoji} ${meta.label} ausgeführt`,[{name:"Person",value:`<@${request.userId}>`,inline:true},...(request.action==="timeout"?[{name:"Dauer",value:formatMinutes(request.minutes),inline:true}]:[]),{name:"Grund",value:request.reason},...(["timeout","kick","ban"].includes(request.action)?[{name:"DM",value:result.dm?"zugestellt":"nicht zustellbar (DMs geschlossen)",inline:true}]:[])],"Eingetragen in der Mitgliederhistorie und im Sanktions-Log.")
      :{content:`${meta.label} fehlgeschlagen: ${result.error}`};
    return viaButton?updateMessage(i,{...payload,components:[]}):answer(i,{...payload,ephemeral:true});
  }
  async function confirmModeration(i,token){
    const request=pendingModeration.get(token);
    if(!request||request.expires<Date.now()){pendingModeration.delete(token);return updateMessage(i,{content:"Die Bestätigung ist abgelaufen. Bitte den Befehl erneut ausführen.",embeds:[],components:[]});}
    if(request.actorId!==i.user.id)return answer(i,{content:"Nur wer die Aktion gestartet hat, kann sie bestätigen.",ephemeral:true});
    const [group,label]=MOD_PERMISSIONS[request.action];const denied=guard(i,group,label);if(denied)return answer(i,{content:denied,ephemeral:true});
    pendingModeration.delete(token);
    const targetMember=request.action==="kick"?await i.guild?.members?.fetch?.(request.userId).catch(()=>null):null;
    if(request.action==="kick"&&!targetMember)return updateMessage(i,{content:"Diese Person ist nicht mehr auf dem Server.",embeds:[],components:[]});
    return executeModeration(i,request,targetMember,true);
  }

  return { confirmModeration, moderationCommand };
}

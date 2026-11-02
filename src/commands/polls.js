import { announcePollResult, eligibleVoters, pollPayload, publishPoll, refreshPollMessage, validatePoll } from "../polls.js";
import { hasRole } from "../config.js";

/** Aus createHandler (commands.js) ausgelagert; bekommt die gemeinsamen Helfer und Dienste übergeben. */
export function createPollCommands({ answer, client, config, db, followUp, guard, polls, respond }) {
  // ---------------------------------------------------------------- Abstimmungen
  async function pollCommand(i,sub,g,u){
    const denied=guard(i,"staff","Staff-Rolle");if(denied)return respond(i,denied);
    if(sub==="erstellen"){
      const channelId=i.options.getChannel?.("kanal")?.id??config.CHANNEL_POLLS??i.channelId;
      const data=validatePoll({question:i.options.getString("frage"),options:i.options.getString("optionen")||"Ja;Nein",duration:i.options.getString?.("dauer")||"1 Tag",multi:i.options.getBoolean?.("mehrfach")??false,remindMissing:i.options.getBoolean?.("erinnern")??true,anonymous:i.options.getBoolean?.("anonym")??false,hideResults:i.options.getBoolean?.("ergebnis_verstecken")??false,requiredRoleId:i.options.getRole?.("rolle")?.id??null,channelId},{timezone:config.TIMEZONE});
      const row=polls.create({guildId:g,actorId:u,data});
      await publishPoll({db,client,config,poll:row,pingRoleIds:i.options.getBoolean?.("pingen")?(data.requiredRoleId?[data.requiredRoleId]:(config.ROLE_MEMBERS??[]).slice(0,1)):[]});
      return respond(i,`Abstimmung gestartet in <#${data.channelId}>. Sie endet <t:${Math.floor(new Date(data.endsAt).getTime()/1000)}:R>.`);
    }
    if(sub==="beenden"){
      const row=polls.close({guildId:g,id:i.options.getString("umfrage"),actorId:u});
      if(!row)return respond(i,"Diese Abstimmung ist nicht (mehr) offen.");
      await refreshPollMessage({db,client,config,pollId:row.id});await announcePollResult({db,client,poll:row});
      return respond(i,"Abstimmung beendet, Ergebnis wurde gepostet.");
    }
  }
  async function pollButton(i,action,pollId,option){
    const poll=polls.byId(pollId);
    if(!poll||poll.guild_id!==i.guildId)return answer(i,{content:"Diese Abstimmung gibt es nicht mehr.",ephemeral:true});
    if(poll.required_role_id&&!hasRole(i.member,[poll.required_role_id]))return answer(i,{content:`Bei dieser Abstimmung dürfen nur Mitglieder mit <@&${poll.required_role_id}> abstimmen.`,ephemeral:true});
    const result=action==="unvote"?polls.unvote({pollId,userId:i.user.id}):polls.vote({pollId,userId:i.user.id,optionIndex:Number(option)});
    if(result.status==="closed")return answer(i,{content:"Diese Abstimmung ist bereits beendet.",ephemeral:true});
    const label=n=>`**${poll.options[n]}**`;
    const picked=()=>result.choices?.length?result.choices.map(label).join(", "):"nichts";
    const text={voted:`Deine Stimme: ${label(result.optionIndex)}. Du kannst sie bis zum Ende ändern.`,changed:`Stimme geändert auf ${label(result.optionIndex)}.`,same:`Du hast bereits für ${label(result.optionIndex)} gestimmt.`,ticked:`✅ ${label(result.optionIndex)} gewählt. Deine Auswahl: ${picked()}.`,unticked:`☐ ${label(result.optionIndex)} abgewählt. Deine Auswahl: ${picked()}.`,removed:"Deine Stimme wurde zurückgezogen.",none:"Du hattest noch nicht abgestimmt.",invalid:"Ungültige Auswahl."}[result.status];
    const fresh=polls.byId(pollId);
    if(["voted","changed","ticked","unticked","removed"].includes(result.status)&&typeof i.update==="function"){
      const eligible=eligibleVoters({client:i.client??client,config,poll:fresh});
      await i.update(pollPayload(fresh,polls.results(pollId),{turnout:eligible?{eligible:eligible.length}:null})).catch(()=>{});
      return followUp(i,{content:text,ephemeral:true});
    }
    return answer(i,{content:text,ephemeral:true});
  }

  return { pollButton, pollCommand };
}

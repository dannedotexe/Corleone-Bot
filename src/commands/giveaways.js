import { audit } from "../database.js";
import { embed, fieldsEmbed, isoNow, targetChannel, unix } from "./shared.js";
import { giveawayButtons, giveawayCard } from "./builders.js";
import { prizeLabel } from "../giveaway-cards.js";
import { randomUUID } from "node:crypto";

/** Aus createHandler (commands.js) ausgelagert; bekommt die gemeinsamen Helfer und Dienste übergeben. */
export function createGiveawayCommands({ answer, config, db, giveaways, guard, respond }) {
  async function giveawayCommand(i,sub,g,u) {
    if(sub==="erstellen"){
      const denied=guard(i,"staff","Staff-Rolle");if(denied)return respond(i,denied);
      const role=i.options.getRole("rolle");
      const targetGiveawayChannel=await targetChannel(i.guild,config.CHANNEL_GIVEAWAYS)??i.channel;
      const row={id:randomUUID(),guild_id:g,prize:i.options.getString("preis"),ends_at:new Date(Date.now()+i.options.getInteger("minuten")*60_000).toISOString(),winner_count:i.options.getInteger("gewinner"),conditions:i.options.getString("bedingungen")??"Keine weiteren Bedingungen",required_role_id:role?.id??null,created_by:u};
      db.transaction(()=>{
        db.prepare("INSERT INTO giveaways(id,guild_id,channel_id,prize,ends_at,winner_count,conditions,status,created_by,created_at,required_role_id) VALUES(?,?,?,?,?,?,?,'active',?,?,?)").run(row.id,g,targetGiveawayChannel.id,row.prize,row.ends_at,row.winner_count,row.conditions,u,isoNow(),row.required_role_id);
        audit(db,g,u,"giveaway.created",row.id,{prize:row.prize,endsAt:row.ends_at,winners:row.winner_count,channelId:i.channelId});
      })();
      let sent;
      try{sent=await targetGiveawayChannel.send({embeds:[giveawayCard(row)],components:[giveawayButtons(row.id)]});}
      catch(error){giveaways.cancel({guildId:g,giveawayId:row.id,actorId:u,reason:`Veröffentlichung fehlgeschlagen: ${error.message}`});throw new Error("Das Giveaway konnte nicht veröffentlicht werden und wurde abgebrochen. Prüfe die Bot-Berechtigungen in diesem Channel.");}
      db.prepare("UPDATE giveaways SET message_id=? WHERE id=?").run(sent.id,row.id);
      return answer(i,{...fieldsEmbed("🎉 Giveaway gestartet",[
        {name:"Preis",value:`**${prizeLabel(row.prize)}**`,inline:true},{name:"Endet",value:`<t:${unix(row.ends_at)}:R>`,inline:true},
        {name:"Veröffentlicht in",value:`${targetGiveawayChannel}`,inline:true},{name:"Verwaltung",value:`Referenz: \`${row.id}\``},
      ],"Die Teilnahme ist ab sofort möglich."),ephemeral:true});
    }
    if(sub==="abbrechen"){
      const denied=guard(i,"staff","Staff-Rolle");if(denied)return respond(i,denied);
      const row=giveaways.cancel({guildId:g,giveawayId:i.options.getString("id"),actorId:u,reason:i.options.getString("grund")??""});
      if(!row)return respond(i,"Aktives Giveaway nicht gefunden.");
      if(row.channel_id&&row.message_id){const ch=await targetChannel(i.guild,row.channel_id);const msg=ch?await ch.messages.fetch(row.message_id).catch(()=>null):null;if(msg)await msg.edit({embeds:[embed("🚫 Giveaway abgebrochen",`**${prizeLabel(row.prize)}** wird nicht mehr verlost. Die Teilnahme ist geschlossen.`)],components:[]}).catch(()=>{});}
      return answer(i,{...fieldsEmbed("🚫 Giveaway abgebrochen",[
        {name:"Preis",value:`**${prizeLabel(row.prize)}**`,inline:true},{name:"Status",value:"Abgebrochen · Es wird kein Gewinner gezogen.",inline:true},
      ],"Die Teilnahmeschaltfläche wurde deaktiviert."),ephemeral:true});
    }
  }

  return { giveawayCommand };
}

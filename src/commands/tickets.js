import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";
import { audit } from "../database.js";
import { buildTicketPanelPayload, fetchTranscript, ticketActions, ticketCard, ticketClosedActions, ticketClosedCard } from "./builders.js";
import { canHandleTicket } from "../services/tickets.js";
import { isoNow, targetChannel, ticketCategoryLabel, unix } from "./shared.js";
import { logEmbed, presentInteractionPayload } from "../presentation.js";
import { moveTicketToClosed, moveTicketToOpen } from "../ticket-channels.js";
import { panelTexts } from "../services/texts.js";
import { randomUUID } from "node:crypto";

/** Aus createHandler (commands.js) ausgelagert; bekommt die gemeinsamen Helfer und Dienste übergeben. */
export function createTicketCommands({ answer, can, client, config, db, groups, guard, isOwner, memberRoleIds, postManagedPanel, respond, tickets }) {
  async function createTicket(i){
    const category=i.values[0],categoryDef=config.TICKET_CATEGORIES_JSON.find(c=>c.id===category);
    if(!categoryDef)return answer(i,{content:"Diese Ticket-Kategorie ist nicht mehr konfiguriert.",ephemeral:true});
    const open=db.prepare("SELECT channel_id FROM tickets WHERE guild_id=? AND user_id=? AND status='open'").all(i.guildId,i.user.id);
    if(open.length>=config.TICKET_MAX_OPEN_PER_USER)return answer(i,{content:`Du hast bereits die maximale Zahl offener Tickets: ${open.map(t=>`<#${t.channel_id}>`).join(", ")}`,ephemeral:true});
    const last=db.prepare("SELECT created_at FROM tickets WHERE guild_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1").get(i.guildId,i.user.id);
    if(last&&Date.now()-new Date(last.created_at).getTime()<config.TICKET_COOLDOWN_SECONDS*1000)return answer(i,{content:"Bitte warte kurz, bevor du ein weiteres Ticket öffnest.",ephemeral:true});
    await i.deferReply({flags:MessageFlags.Ephemeral});
    const staffRoles=[...new Set([...groups.staff,...categoryDef.roleIds])];
    const allow=[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles];
    let channel;
    try{
      channel=await i.guild.channels.create({name:`ticket-${category}-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g,"-").slice(0,90),type:ChannelType.GuildText,parent:config.CHANNEL_TICKET_CATEGORY||undefined,permissionOverwrites:[{id:i.guild.roles.everyone.id,deny:[PermissionFlagsBits.ViewChannel]},{id:i.user.id,allow},{id:client.user.id,allow:[...allow,PermissionFlagsBits.ManageChannels]},...staffRoles.map(id=>({id,allow}))]});
    }catch(error){console.error("Ticket-Channel konnte nicht erstellt werden:",error.message);return i.editReply(presentInteractionPayload({content:"Ticket konnte nicht angelegt werden. Prüfe die Bot-Berechtigungen (Channels verwalten) und die Ticket-Kategorie."}));}
    const id=randomUUID();
    try{
      db.transaction(()=>{
        db.prepare("INSERT INTO tickets(id,guild_id,channel_id,user_id,category,status,created_at,updated_at) VALUES(?,?,?,?,?,'open',?,?)").run(id,i.guildId,channel.id,i.user.id,category,isoNow(),isoNow());
        audit(db,i.guildId,i.user.id,"ticket.created",id,{category,channelId:channel.id});
      })();
    }catch(error){await channel.delete("Ticket konnte nicht gespeichert werden").catch(()=>{});throw error;}
    const ticketMessage=await channel.send({content:`<@${i.user.id}> ${staffRoles.map(r=>`<@&${r}>`).join(" ")}`,embeds:[ticketCard(categoryDef.label,i.user.id)],components:ticketActions(id)}).catch(()=>null);
    if(ticketMessage)db.prepare("UPDATE tickets SET message_id=? WHERE id=?").run(ticketMessage.id,id);
    await sendTicketLog(i.guild,logEmbed("🎫 Neues Support-Ticket",`**Kategorie:** ${categoryDef.label}\n**Mitglied:** <@${i.user.id}>\n**Ticket:** <#${channel.id}>`));
    return i.editReply(presentInteractionPayload({content:`Dein Ticket wurde erstellt: ${channel}`}));
  }

  async function closeTicket(i,t){
    if(t.status!=="open")return answer(i,{content:"Ticket ist bereits geschlossen.",ephemeral:true});
    if(t.user_id!==i.user.id&&!ticketAllowed(i,t))return answer(i,{content:"Nur der Ersteller oder Staff kann dieses Ticket schließen.",ephemeral:true});
    await i.deferReply({flags:MessageFlags.Ephemeral});
    const channel=i.channel?.id===t.channel_id?i.channel:await targetChannel(i.guild,t.channel_id);
    let transcript;
    try{transcript=await fetchTranscript(channel,config.TICKET_TRANSCRIPT_LIMIT);}
    catch(error){return i.editReply(presentInteractionPayload({content:`Der Ticketverlauf konnte nicht gesichert werden (${error.message}). Das Ticket bleibt offen; bitte Bot-Berechtigungen prüfen.`}));}
    const row=tickets.close({guildId:i.guildId,ticketId:t.id,actorId:i.user.id,transcript});
    if(!row)return i.editReply(presentInteractionPayload({content:"Ticket wurde bereits geschlossen."}));
    await channel.permissionOverwrites.edit(t.user_id,{SendMessages:false}).catch(()=>{});
    const added=db.prepare("SELECT user_id FROM ticket_members WHERE ticket_id=?").all(t.id).map(r=>r.user_id);
    for(const id of added)await channel.permissionOverwrites.edit(id,{SendMessages:false}).catch(()=>{});
    const reason=closeReasons.get(t.id)??"";closeReasons.delete(t.id);
    if(config.TICKET_CLOSE_DM&&t.user_id!==i.user.id){
      const user=await (i.client??client).users.fetch(t.user_id).catch(()=>null);
      await user?.send({embeds:[logEmbed("🔒 Dein Ticket wurde geschlossen",`**Kategorie:** ${ticketCategoryLabel(t.category,config)}\n**Geschlossen von:** <@${i.user.id}>${reason?`\n**Grund:** ${reason}`:""}\n\nIst noch etwas offen? Öffne einfach ein neues Ticket.`)],allowedMentions:{parse:[]}}).catch(()=>{});
    }
    await channel.setName(`closed-${t.category}-${t.user_id.slice(-4)}`.slice(0,90)).catch(()=>{});
    const moved=await moveTicketToClosed(channel,config);
    await refreshTicketMessage(channel,{...row,status:"closed"});
    const text=transcript.map(m=>`[${m.createdAt}] ${m.author}: ${m.content}${m.attachments?.length?` [Anhänge: ${m.attachments.map(a=>a.name).join(", ")}]`:""}`).join("\n");
    await sendTicketLog(i.guild,logEmbed("🔒 Ticket geschlossen",`**Kategorie:** ${ticketCategoryLabel(t.category,config)}\n**Mitglied:** <@${t.user_id}>\n**Bearbeiter:** ${t.claimed_by?`<@${t.claimed_by}>`:"—"}\n**Geschlossen von:** <@${i.user.id}>\n${reason?`**Grund:** ${reason}\n`:""}**Eröffnet:** <t:${unix(t.created_at)}:f>\n**Nachrichten im Transkript:** ${transcript.length}`),[new AttachmentBuilder(Buffer.from(text||"(keine Nachrichten)","utf8"),{name:`ticket-${t.id.slice(0,8)}.txt`})]);
    return i.editReply(presentInteractionPayload({content:`Ticket geschlossen. Der Verlauf wurde gespeichert; Staff kann es über die Schaltfläche wieder öffnen.${moved==="failed"?" Hinweis: Der Channel konnte nicht in die Kategorie für geschlossene Tickets verschoben werden (voll oder fehlende Rechte).":""}`}));
  }

  const closeReasons=new Map(); // Grund aus /ticket schliessen bis zur Bestätigung per Knopf
  const ticketAllowed=(i,ticket)=>canHandleTicket({memberRoleIds:memberRoleIds(i),isOwner:isOwner(i)},ticket,config,groups.staff);

  async function ticketCommand(i,sub,g,u){
    if(sub==="panel"){
      const denied=guard(i,"staff","Staff-Rolle");if(denied)return respond(i,denied);
      await postManagedPanel(i,"CHANNEL_TICKET_PANEL","PANEL_TICKET",buildTicketPanelPayload(config,panelTexts(db,g,"ticket")));
      return respond(i,"Das Support-Panel wurde veröffentlicht.");
    }
    const ticket=db.prepare("SELECT * FROM tickets WHERE channel_id=? AND guild_id=?").get(i.channelId,g);
    if(!ticket)return respond(i,"Dieser Channel ist kein Ticket.");
    if(sub==="uebernehmen"){
      if(!ticketAllowed(i,ticket))return respond(i,"Dafür brauchst du eine Staff- oder zuständige Ticket-Rolle.");
      const row=tickets.claim({guildId:g,ticketId:ticket.id,actorId:u});
      if(!row)return respond(i,"Ticket nicht gefunden, geschlossen oder bereits übernommen.");
      await refreshTicketMessage(i.channel,row,u);
      return respond(i,"Du hast das Ticket übernommen. Der Channel zeigt jetzt dich als zuständigen Bearbeiter.");
    }
    if(sub==="wiedereroeffnen")return reopenTicket(i,ticket,false);
    if(sub==="schliessen"){
      if(ticket.status!=="open")return respond(i,"Dies ist kein offenes Ticket.");
      if(ticket.user_id!==u&&!ticketAllowed(i,ticket))return respond(i,"Nur Ersteller oder Staff können dieses Ticket schließen.");
      const reason=String(i.options.getString?.("grund")??"").trim();
      if(reason)closeReasons.set(ticket.id,reason);
      return answer(i,{content:`Ticket wirklich schließen?${reason?` Grund: „${reason}“.`:""} Der Verlauf wird gespeichert und der Channel bleibt für Staff einsehbar.`,components:[closeConfirmRow(ticket.id)],ephemeral:true});
    }
    // Ab hier nur Staff bzw. zuständige Ticket-Rollen, nur in offenen Tickets.
    if(!ticketAllowed(i,ticket))return respond(i,"Dafür brauchst du eine Staff- oder zuständige Ticket-Rolle.");
    if(ticket.status!=="open")return respond(i,"Dieses Ticket ist geschlossen. Zuerst wieder öffnen.");
    if(sub==="hinzufuegen"||sub==="entfernen"){
      const user=i.options.getUser("mitglied");
      if(user.bot)return respond(i,"Bots können nicht hinzugefügt oder entfernt werden.");
      if(user.id===ticket.user_id)return respond(i,sub==="hinzufuegen"?"Das ist der Ersteller – er ist schon im Ticket.":"Den Ersteller kannst du nicht entfernen. Schließe das Ticket stattdessen.");
      const inTicket=Boolean(db.prepare("SELECT 1 FROM ticket_members WHERE ticket_id=? AND user_id=?").get(ticket.id,user.id));
      if(sub==="hinzufuegen"){
        if(inTicket)return respond(i,`<@${user.id}> ist bereits in diesem Ticket.`);
        const ok=await i.channel.permissionOverwrites.edit(user.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true,AttachFiles:true,EmbedLinks:true}).then(()=>true).catch(error=>{console.warn("Ticket: Person nicht hinzugefügt:",error.message);return false;});
        if(!ok)return respond(i,"Konnte die Person nicht hinzufügen – fehlt dem Bot das Recht „Berechtigungen verwalten“ in der Ticket-Kategorie?");
        db.prepare("INSERT OR REPLACE INTO ticket_members(ticket_id,user_id,added_by,added_at) VALUES(?,?,?,?)").run(ticket.id,user.id,u,isoNow());
        audit(db,g,u,"ticket.member_added",user.id,{ticketId:ticket.id,category:ticket.category});
        await i.channel.send({content:`➕ <@${user.id}> wurde von <@${u}> zum Ticket hinzugefügt.`,allowedMentions:{users:[user.id]}}).catch(()=>{});
        return respond(i,`<@${user.id}> kann das Ticket jetzt sehen und schreiben.`);
      }
      if(!inTicket&&!i.channel.permissionOverwrites?.cache?.has?.(user.id))return respond(i,`<@${user.id}> wurde nicht zu diesem Ticket hinzugefügt.`);
      await i.channel.permissionOverwrites.delete(user.id,"Aus dem Ticket entfernt").catch(()=>{});
      db.prepare("DELETE FROM ticket_members WHERE ticket_id=? AND user_id=?").run(ticket.id,user.id);
      audit(db,g,u,"ticket.member_removed",user.id,{ticketId:ticket.id,category:ticket.category});
      await i.channel.send({content:`➖ <@${user.id}> wurde von <@${u}> aus dem Ticket entfernt.`,allowedMentions:{parse:[]}}).catch(()=>{});
      return respond(i,`<@${user.id}> wurde aus dem Ticket entfernt.`);
    }
    if(sub==="umbenennen"){
      const name=String(i.options.getString("name")).toLowerCase().replace(/[^a-z0-9äöüß-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,90);
      if(!name)return respond(i,"Bitte einen Namen mit Buchstaben oder Zahlen angeben.");
      // Discord erlaubt nur 2 Umbenennungen pro 10 Minuten und Channel – nicht hängen bleiben.
      const ok=await Promise.race([i.channel.setName(name,"Ticket umbenannt").then(()=>true).catch(()=>false),new Promise(r=>setTimeout(()=>r(null),4000))]);
      if(ok===null)return respond(i,"Discord lässt Channels nur 2× in 10 Minuten umbenennen – die Änderung kommt gleich von selbst an.");
      if(!ok)return respond(i,"Umbenennen hat nicht geklappt (Recht „Channels verwalten“?).");
      audit(db,g,u,"ticket.renamed",ticket.user_id,{ticketId:ticket.id,name});
      return respond(i,`Ticket heißt jetzt **#${name}**.`);
    }
    if(sub==="freigeben"){
      if(!ticket.claimed_by)return respond(i,"Dieses Ticket hat noch niemand übernommen.");
      if(ticket.claimed_by!==u&&!can(i,"leaders"))return respond(i,`Das Ticket hat <@${ticket.claimed_by}> übernommen – nur er oder die Leitung können es freigeben.`);
      const row=db.prepare("UPDATE tickets SET claimed_by=NULL,claimed_at=NULL,updated_at=? WHERE id=? AND status='open' RETURNING *").get(isoNow(),ticket.id);
      audit(db,g,u,"ticket.unclaimed",ticket.user_id,{ticketId:ticket.id,previous:ticket.claimed_by});
      await refreshTicketMessage(i.channel,row,null);
      await i.channel.send({content:`🔓 <@${u}> hat das Ticket freigegeben – es kann wieder übernommen werden.`,allowedMentions:{parse:[]}}).catch(()=>{});
      return respond(i,"Ticket freigegeben.");
    }
  }
  const closeConfirmRow=id=>new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket:close:${id}`).setLabel("Schließen bestätigen").setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId("cancel:ticket").setLabel("Abbrechen").setStyle(ButtonStyle.Secondary));
  async function refreshTicketMessage(channel,row,claimedBy=null){
    const message=row.message_id?await channel.messages.fetch(row.message_id).catch(()=>null):null;
    const payload=row.status==="closed"
      ?{embeds:[ticketClosedCard(ticketCategoryLabel(row.category,config),row.user_id)],components:ticketClosedActions(row.id)}
      :{embeds:[ticketCard(ticketCategoryLabel(row.category,config),row.user_id,claimedBy??row.claimed_by)],components:ticketActions(row.id,Boolean(claimedBy??row.claimed_by))};
    if(message){await message.edit(payload).catch(()=>{});return;}
    const sent=await channel.send(payload).catch(()=>null);
    if(sent)db.prepare("UPDATE tickets SET message_id=? WHERE id=?").run(sent.id,row.id);
  }
  async function reopenTicket(i,ticket,viaButton){
    const reply=content=>viaButton?answer(i,{content,ephemeral:true}):respond(i,content);
    if(!ticketAllowed(i,ticket))return reply("Dafür brauchst du eine Staff- oder zuständige Ticket-Rolle.");
    const row=tickets.reopen({guildId:i.guildId,ticketId:ticket.id,actorId:i.user.id});
    if(!row)return reply("Geschlossenes Ticket nicht gefunden.");
    const channel=await targetChannel(i.guild,row.channel_id);
    if(channel){
      await channel.permissionOverwrites.edit(row.user_id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}).catch(error=>console.warn("Ticket-Berechtigung nicht wiederhergestellt:",error.message));
      for(const {user_id:id} of db.prepare("SELECT user_id FROM ticket_members WHERE ticket_id=?").all(row.id))await channel.permissionOverwrites.edit(id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}).catch(()=>{});
      await channel.setName(`ticket-${row.category}-${row.user_id.slice(-4)}`.slice(0,90)).catch(()=>{});
      await moveTicketToOpen(channel,config);
      await refreshTicketMessage(channel,row);
    }
    await sendTicketLog(i.guild,logEmbed("🔓 Ticket wieder geöffnet",`**Ticket:** <#${row.channel_id}>\n**Mitglied:** <@${row.user_id}>\n**Durch:** <@${i.user.id}>`));
    return reply("Ticket wieder geöffnet. Der Antragsteller kann den Channel wieder nutzen.");
  }
  async function sendTicketLog(guild,logPayloadEmbed,files=[]){
    if(!config.CHANNEL_TICKET_LOG)return;
    const log=await targetChannel(guild,config.CHANNEL_TICKET_LOG);
    if(log)await log.send({embeds:[logPayloadEmbed],files}).catch(error=>console.warn("Ticket-Log konnte nicht gesendet werden:",error.message));
  }

  return { closeConfirmRow, closeTicket, createTicket, reopenTicket, ticketAllowed, ticketCommand };
}

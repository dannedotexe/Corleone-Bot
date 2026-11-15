import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { colorNumber, defaultsFor } from "../services/texts.js";
import { embed, fieldsEmbed, targetChannel, unix } from "./shared.js";
import { formatMoney } from "../services/finance.js";
import { numberedMentions } from "../presentation.js";
import { prizeLabel } from "../giveaway-cards.js";
import { questionsFor } from "../services/applications.js";

export const ticketCard=(category,requesterId,claimedBy=null)=>embed(`🎫 ${category}`,`**Antragsteller:** <@${requesterId}>\n**Status:** ${claimedBy?`🔎 In Bearbeitung · <@${claimedBy}>`:"🟡 Offen – wartet auf Staff"}\n\nBeschreibe dein Anliegen hier im privaten Ticket. Staff kann das Ticket über die Schaltflächen verwalten.`);
export const ticketClosedCard=(category,requesterId)=>embed(`🔒 ${category} · geschlossen`,`**Antragsteller:** <@${requesterId}>\n**Status:** Geschlossen\n\nDieses Ticket ist abgeschlossen. Der Verlauf bleibt für das zuständige Team gespeichert.`);
export const ticketActions=(id,claimed=false)=>[new ActionRowBuilder().addComponents(...(claimed?[]:[new ButtonBuilder().setCustomId(`ticket:claim:${id}`).setLabel("Übernehmen").setStyle(ButtonStyle.Primary)]),new ButtonBuilder().setCustomId(`ticket:closeconfirm:${id}`).setLabel("Schließen").setStyle(ButtonStyle.Danger))];
export const ticketClosedActions=id=>[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket:reopen:${id}`).setLabel("Wieder öffnen").setEmoji("🔓").setStyle(ButtonStyle.Secondary))];
export const ticketPresentation={
  support:{emoji:"🛠️",description:"Allgemeine Fragen und Hilfe"},
  beschwerde:{emoji:"⚠️",description:"Ein Problem oder eine Beschwerde melden"},
  leitung:{emoji:"👑",description:"Ein wichtiges Anliegen an die Leitung"},
};
// Antragsfragen können per APPLICATION_QUESTIONS_JSON überschrieben werden; createHandler setzt die aktive Konfiguration.
let questionConfig={};
/** createHandler setzt die aktive Fragen-Konfiguration (APPLICATION_QUESTIONS_JSON). */
export const setQuestionConfig=config=>{questionConfig=config;};
export function applicationQuestions(kind,config=questionConfig) {
  return questionsFor(kind,config).map(question=>({...question,style:question.style==="paragraph"?TextInputStyle.Paragraph:TextInputStyle.Short}));
}
export function applicationModal(kind) {
  const isRank=kind==="rang";
  const modal=new ModalBuilder().setCustomId(`application:submit:${kind}`).setTitle(isRank?"Rang-Antrag":"Corleone Bewerbung");
  for(const question of applicationQuestions(kind)){
    const input=new TextInputBuilder().setCustomId(question.id).setLabel(question.label).setStyle(question.style).setRequired(question.required!==false).setMaxLength(question.maxLength);
    if(question.placeholder)input.setPlaceholder(question.placeholder);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}
/** Embed aus bearbeitbaren Texten; leere Teile werden weggelassen (Discord lehnt leere Felder ab). */
export function textEmbed(texts,fields=[]){
  const panel=new EmbedBuilder().setColor(colorNumber(texts.color??"#c9a24b")).setTimestamp();
  if(texts.author)panel.setAuthor({name:texts.author});
  if(texts.title)panel.setTitle(texts.title);
  if(texts.description)panel.setDescription(texts.description);
  const usable=fields.filter(field=>field.name&&field.value);
  if(usable.length)panel.addFields(usable);
  if(texts.footer)panel.setFooter({text:texts.footer});
  return panel;
}
export function buildApplicationPanelPayload(texts=defaultsFor("application")) {
  const panel=textEmbed(texts,[
    {name:texts.field1Name,value:texts.field1Value,inline:true},
    {name:texts.field2Name,value:texts.field2Value,inline:true},
    {name:texts.field3Name,value:texts.field3Value,inline:false},
  ]);
  const buttons=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("application:open:bewerbung").setLabel(texts.buttonApply).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("application:open:rang").setLabel(texts.buttonRank).setStyle(ButtonStyle.Secondary),
  );
  return {embeds:[panel],components:[buttons]};
}
/** Website-Panel: Text + Link-Button zum Dashboard (DASHBOARD_PUBLIC_URL). null ohne Adresse. */
export function buildWebsitePanelPayload(url,texts=defaultsFor("website")) {
  if(!url)return null;
  return {embeds:[textEmbed(texts)],components:[new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(texts.button).setEmoji("🌐").setURL(url))]};
}
export function buildAccountPanelPayload(texts=defaultsFor("account")) {
  return {embeds:[textEmbed(texts)],components:[new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("account:balance").setLabel(texts.buttonBalance).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("account:history").setLabel(texts.buttonHistory).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("account:sanctions").setLabel(texts.buttonSanctions).setStyle(ButtonStyle.Secondary),
  )]};
}
export function buildVerificationPanelPayload(texts=defaultsFor("verification")) {
  return {embeds:[textEmbed(texts)],components:[new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("verify:open").setLabel(texts.button).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("verify:rename").setLabel(texts.buttonRename||"✏️  Name ändern").setStyle(ButtonStyle.Secondary),
  )]};
}
export function buildAbsencePanelPayload(texts=defaultsFor("absence")) {
  return {embeds:[textEmbed(texts)],components:[new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("absence:open").setLabel(texts.buttonAbsent).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("absence:short").setLabel(texts.buttonShort||"⏱️  Kurz weg").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("absence:back").setLabel(texts.buttonBack).setStyle(ButtonStyle.Success),
  )]};
}
export function buildTicketPanelPayload(config,texts=defaultsFor("ticket")) {
  const options=config.TICKET_CATEGORIES_JSON.map(c=>{
    const presentation=ticketPresentation[c.id]??{emoji:"🎫",description:`Ein Ticket für ${c.label}`};
    return {label:c.label,value:c.id,description:c.description??presentation.description,emoji:{name:c.emoji??presentation.emoji}};
  });
  const panel=textEmbed(texts);
  const select=new StringSelectMenuBuilder().setCustomId("ticket:create").setPlaceholder(texts.placeholder).addOptions(options);
  return {embeds:[panel],components:[new ActionRowBuilder().addComponents(select)]};
}
export function buildApplicationReviewPayload(kind,userId,answers,decision=null,reason="",reviewerId=null) {
  const labels=new Map([...questionsFor(kind,{}),...applicationQuestions(kind)].map(question=>[question.id,question.label]));
  const panel=new EmbedBuilder().setColor(0xc9a24b)
    .setAuthor({name:"CORLEONE  •  BEWERBUNGEN"})
    .setTitle(`${kind==="rang"?"🏅 Rang-Antrag":"🤝 Bewerbung"}`)
    .setDescription(`**Antragsteller:** <@${userId}>\n**Eingereichte Angaben:**${decision?`\n\n**Status:** ${decision==="accepted"?"✅ Angenommen":decision==="rejected"?"❌ Abgelehnt":decision==="withdrawn"?"↩️ Zurückgezogen":`🔎 In Prüfung · <@${reviewerId}>`}`:""}`)
    .addFields(Object.entries(answers).map(([key,value])=>({name:labels.get(key)??key,value:String(value||"—").slice(0,1024),inline:false})))
    .setColor(decision==="accepted"?0x2ecc71:decision==="rejected"?0xe74c3c:decision==="withdrawn"?0x7f8c8d:0xc9a24b)
    .setFooter({text:decision==="rejected"?`Ablehnungsgrund: ${reason}`.slice(0,2048):decision==="review"?"CORLEONE  •  Bearbeitung übernommen":decision==="withdrawn"?"CORLEONE  •  Vom Antragsteller zurückgezogen":"CORLEONE  •  Interne Prüfung"})
    .setTimestamp();
  return {embeds:[panel]};
}
/** Reviewer-Schaltflächen je nach Status. */
export function applicationReviewComponents(id,status="open"){
  const buttons=[];
  if(status==="open")buttons.push(new ButtonBuilder().setCustomId(`application:review:${id}`).setLabel("Übernehmen").setStyle(ButtonStyle.Primary));
  buttons.push(
    new ButtonBuilder().setCustomId(`application:accept:${id}`).setLabel("Annehmen").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`application:reject:${id}`).setLabel("Ablehnen").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`application:note:${id}`).setLabel("Notiz").setEmoji("💬").setStyle(ButtonStyle.Secondary),
  );
  return [new ActionRowBuilder().addComponents(...buttons)];
}
export function giveawayButtons(id){
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`giveaway:join:${id}`).setLabel("🎉 Teilnehmen").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`giveaway:leave:${id}`).setLabel("Abmelden").setStyle(ButtonStyle.Secondary),
  );
}
export function giveawayCard(row,entries=0){
  const card=embed(`🎉 ${prizeLabel(row.prize)}`,"Nimm über die Schaltfläche teil. Die Gewinner werden nach Ablauf automatisch gezogen.");
  card.addFields(
    {name:"⏳ Ende",value:`<t:${unix(row.ends_at)}:F> · <t:${unix(row.ends_at)}:R>`,inline:true},
    {name:"🏆 Gewinner",value:String(row.winner_count),inline:true},
    {name:"🙋 Teilnahmen",value:String(entries),inline:true},
    {name:"📌 Bedingungen",value:`${row.conditions}${row.required_role_id?`\nErforderliche Rolle: <@&${row.required_role_id}>`:""}`.slice(0,1024),inline:false},
  );
  return card.setFooter({text:`CORLEONE  •  Giveaway ${row.id.slice(0,8)}`});
}
/** Lädt bis zu `limit` Nachrichten (seitenweise à 100) chronologisch. Wirft bei fehlendem Zugriff. */
export async function fetchTranscript(channel,limit=500){
  if(!channel?.messages)throw new Error("Ticket-Channel nicht erreichbar");
  const collected=[];let before;
  while(collected.length<limit){
    const batch=await channel.messages.fetch({limit:Math.min(100,limit-collected.length),...(before?{before}:{})});
    const items=[...batch.values()];
    if(!items.length)break;
    collected.push(...items);
    before=items.reduce((oldest,m)=>m.createdTimestamp<oldest.createdTimestamp?m:oldest).id;
    if(items.length<100)break;
  }
  return collected.sort((a,b)=>a.createdTimestamp-b.createdTimestamp).map(m=>({id:m.id,author:m.author?.tag??"gelöscht",userId:m.author?.id??null,createdAt:m.createdAt?.toISOString(),content:m.content,attachments:[...(m.attachments?.values?.()??[])].map(a=>({name:a.name,url:a.url}))}));
}
export function payoutListPayload(db,guildId,minimumCents,page=1){
  const total=db.prepare("SELECT COUNT(*) n FROM accounts WHERE guild_id=?").get(guildId).n;
  const pageSize=10,pageCount=Math.max(1,Math.ceil(total/pageSize)),current=Math.min(pageCount,Math.max(1,Number.isInteger(page)?page:1)),offset=(current-1)*pageSize;
  const rows=db.prepare("SELECT a.user_id,a.balance_cents,COALESCE((SELECT SUM(remaining_cents) FROM sanctions s WHERE s.guild_id=a.guild_id AND s.user_id=a.user_id AND s.status IN ('open','partial')),0) AS open_cents FROM accounts a WHERE a.guild_id=? ORDER BY a.balance_cents DESC,a.user_id LIMIT ? OFFSET ?").all(guildId,pageSize,offset);
  const fields=rows.length?[{name:`Mitglieder ${offset+1}–${offset+rows.length}`,value:rows.map((row,index)=>{
    const eligibility=minimumCents==null?"":row.balance_cents>=minimumCents?" · ✅ auszahlbar":" · ⏳ Mindestbetrag fehlt";
    const deduction=Math.min(row.balance_cents,row.open_cents);
    return `**${offset+index+1}.** <@${row.user_id}> · **${formatMoney(row.balance_cents)}**${deduction?` · Abzug −${formatMoney(deduction)} · Netto ${formatMoney(row.balance_cents-deduction)}`:""}${eligibility}`;
  }).join("\n").slice(0,1024),inline:false}]:[];
  const sums=db.prepare("SELECT COALESCE(SUM(balance_cents),0) n FROM accounts WHERE guild_id=?").get(guildId).n;
  const description=total===0?"Es sind noch keine Familienkonten vorhanden.":`${total} Familienkonten · Seite ${current} von ${pageCount}\nAusstehendes Familienguthaben gesamt: ${formatMoney(sums)}${minimumCents==null?"":"\nAuszahlungsgrenze: "+formatMoney(minimumCents)}`;
  const payload=fieldsEmbed("📋 Familien-Auszahlungsliste",fields,description);
  if(pageCount>1)payload.components=[new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`konto:list:${current-1}`).setLabel("← Zurück").setStyle(ButtonStyle.Secondary).setDisabled(current<=1),
    new ButtonBuilder().setCustomId(`konto:list:${current+1}`).setLabel("Weiter →").setStyle(ButtonStyle.Secondary).setDisabled(current>=pageCount),
  )];
  payload.ephemeral=true;
  return payload;
}
export function parseEventDate(value,timezone="Europe/Vienna"){
  const text=String(value??"").trim();
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)){
    const date=new Date(text);return Number.isFinite(date.getTime())?date:null;
  }
  const match=/^(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s+(\d{1,2}):(\d{2})$/.exec(text);
  if(!match)return null;
  const [,dayText,monthText,yearText,hourText,minuteText]=match;
  const desired={year:Number(yearText),month:Number(monthText),day:Number(dayText),hour:Number(hourText),minute:Number(minuteText)};
  const naive=Date.UTC(desired.year,desired.month-1,desired.day,desired.hour,desired.minute);
  const check=new Date(naive);
  if(check.getUTCFullYear()!==desired.year||check.getUTCMonth()+1!==desired.month||check.getUTCDate()!==desired.day||desired.hour>23||desired.minute>59)return null;
  let formatter;
  try{formatter=new Intl.DateTimeFormat("en-GB",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});}catch{return null;}
  const partsAt=epoch=>Object.fromEntries(formatter.formatToParts(new Date(epoch)).filter(part=>part.type!=="literal").map(part=>[part.type,Number(part.value)]));
  const wanted=[desired.year,desired.month,desired.day,desired.hour,desired.minute].join(":");
  const offsets=[naive-36*60*60_000,naive,naive+36*60*60_000].map(epoch=>{const p=partsAt(epoch);return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute)-epoch;});
  const candidates=[...new Set(offsets)].map(offset=>naive-offset).filter(epoch=>{const p=partsAt(epoch);return [p.year,p.month,p.day,p.hour,p.minute].join(":")===wanted;}).sort((a,b)=>a-b);
  return candidates.length?new Date(candidates[0]):null;
}
export function eventButtons(id){return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`event:join:${id}`).setLabel("Teilnehmen").setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId(`event:leave:${id}`).setLabel("Abmelden").setStyle(ButtonStyle.Secondary));}
export function eventEmbed(e,count,participants=[]){
  const list=numberedMentions(participants.map(x=>x.user_id),{empty:"Noch keine Anmeldungen"});
  return embed(`📅 ${e.name}`.slice(0,256),e.description||"Familien-Event").addFields(
    {name:"🕒 Wann",value:`<t:${unix(e.starts_at)}:F> · <t:${unix(e.starts_at)}:R>`,inline:true},
    {name:"📍 Treffpunkt",value:e.location||"Noch nicht angegeben",inline:true},
    {name:"👤 Veranstalter",value:`<@${e.host_id}>`,inline:true},
    {name:"🧰 Ausrüstung",value:e.equipment||"Keine besondere Ausrüstung angegeben",inline:true},
    {name:"ℹ️ Hinweise",value:e.notes||"Keine weiteren Hinweise",inline:true},
    {name:`🙋 Teilnehmende (${count}${e.max_participants?`/${e.max_participants}`:""})`,value:list.slice(0,1024),inline:false},
  );
}
export function applicationReviewChannelKey(kind){return kind==="rang"?"CHANNEL_RANK_REVIEW":"CHANNEL_APPLICATION_REVIEW";}
export async function applicationReviewChannel(guild,config,kind){
  const channelName=kind==="rang"?"rang-anträge":"bewerbungen";
  const configured=await targetChannel(guild,config[applicationReviewChannelKey(kind)]);
  if(configured)return configured;
  const channels=await guild.channels.fetch().catch(()=>null);
  return channels?.find(channel=>channel?.isTextBased()&&channel.name.includes(channelName)&&channel.parent?.name.toLowerCase().includes("staff"))??null;
}

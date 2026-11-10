import { BRAND_COLOR } from "../presentation.js";
import { EmbedBuilder } from "discord.js";

export const isoNow=()=>new Date().toISOString();
export const unix=iso=>Math.floor(new Date(iso).getTime()/1000);
export const embed=(title,description)=>new EmbedBuilder().setColor(BRAND_COLOR).setAuthor({name:"CORLEONE  •  GRAND-RP"}).setTitle(title).setDescription(description).setFooter({text:"CORLEONE  •  Grand-RP"}).setTimestamp();
export const fieldsEmbed=(title,fields,description="")=>{const panel=embed(title,description||null);if(fields.length)panel.addFields(fields.slice(0,25));return {embeds:[panel]};};
export const ticketCategoryLabel=(category,config)=>config.TICKET_CATEGORIES_JSON.find(item=>item.id===category)?.label??category;
export const transactionLabels={credit:"Gutschrift",payout:"Auszahlung",sanction_refund:"Sanktions-Rückerstattung",correction:"Korrektur",correction_credit:"Korrektur (+)",correction_debit:"Korrektur (−)"};
export const statusLabels={open:"Offen",partial:"Teilweise verrechnet",paid:"Beglichen",void:"Aufgehoben",review:"In Prüfung",accepted:"Angenommen",rejected:"Abgelehnt",scheduled:"Geplant",ended:"Beendet",cancelled:"Abgesagt",withdrawn:"Zurückgezogen"};
export const warningStateLabel={active:"Aktiv",expired:"Abgelaufen",revoked:"Zurückgenommen"};
export const warningStateIcon={active:"🟠",expired:"⚪",revoked:"↩️"};
export const err=(e)=>e instanceof Error?e.message:"Die Aktion ist fehlgeschlagen.";
export async function targetChannel(guild,id){return id?guild.channels.fetch(id).catch(()=>null):null;}

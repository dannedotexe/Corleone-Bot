import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { BRAND_COLOR } from "../presentation.js";
import { fieldsEmbed, statusLabels, transactionLabels, unix, warningStateIcon } from "./shared.js";
import { formatMoney, parseMoney } from "../services/finance.js";
import { payoutListPayload } from "./builders.js";

/** Aus createHandler (commands.js) ausgelagert; bekommt die gemeinsamen Helfer und Dienste übergeben. */
export function createFinanceCommands({ answer, can, client, config, db, finance, guard, issueWarning, respond, updateMessage, warningService }) {
  async function accountCommand(i,sub,g,u){
    if (sub==="stand"||sub==="ansehen") {
      const id=sub==="stand"?u:i.options.getUser("mitglied").id;
      if (id!==u&&!can(i,"financeView")) return respond(i,"Fremde Konten darf nur die Finanzrolle ansehen.");
      return answer(i,balanceView(g,id));
    }
    if (sub==="anlegen") {
      const denied=guard(i,"finance","Finanzrolle"); if(denied)return respond(i,denied);
      const target=i.options.getUser("mitglied");
      if(target.bot)return respond(i,"Bots können kein Familienkonto besitzen.");
      const result=finance.openAccount({guildId:g,userId:target.id,actorId:u,note:i.options.getString("notiz")??""});
      return answer(i,{...fieldsEmbed(result.created?"🏦 Familienkonto angelegt":"ℹ️ Konto existiert bereits",[
        {name:"Mitglied",value:`<@${target.id}>`,inline:true},{name:"Kontostand",value:formatMoney(result.balance),inline:true},
      ],result.created?"Das Konto erscheint jetzt in der Auszahlungsliste und kann Gutschriften erhalten.":"Für dieses Mitglied gibt es schon ein Familienkonto; es wurde nichts verändert."),ephemeral:true});
    }
    if (sub==="gutschrift") {
      const denied=guard(i,"finance","Finanzrolle"); if(denied)return respond(i,denied);
      const target=i.options.getUser("mitglied"),cents=parseMoney(i.options.getString("betrag"));
      if(target.bot)return respond(i,"Bots können kein Familienkonto besitzen.");
      const tx=finance.credit({guildId:g,userId:target.id,actorId:u,cents,reason:i.options.getString("grund"),key:`credit:${i.id}`});
      return answer(i,{...fieldsEmbed("✅ Gutschrift verbucht",[
        {name:"Empfänger",value:`<@${target.id}>`,inline:true},{name:"Betrag",value:`**${formatMoney(cents)}**`,inline:true},
        {name:"Neuer Kontostand",value:formatMoney(finance.balance(g,target.id)),inline:true},
        {name:"Buchungsgrund",value:i.options.getString("grund")},{name:"Buchungsreferenz",value:`\`${tx.id}\``},
      ],"Das Familienguthaben wurde aktualisiert."),ephemeral:true});
    }
    if (sub==="korrektur") {
      const denied=guard(i,"leaders","Leitungsrolle"); if(denied)return respond(i,denied);
      const target=i.options.getUser("mitglied"),cents=parseMoney(i.options.getString("betrag")),direction=i.options.getString("richtung"),reason=i.options.getString("grund");
      const tx=finance.correction({guildId:g,userId:target.id,actorId:u,cents,direction,reason,key:`correction:${i.id}`});
      return answer(i,{...fieldsEmbed("🛠️ Korrektur verbucht",[
        {name:"Mitglied",value:`<@${target.id}>`,inline:true},{name:"Korrektur",value:`**${direction==="debit"?"−":"+"}${formatMoney(cents)}**`,inline:true},
        {name:"Neuer Kontostand",value:formatMoney(finance.balance(g,target.id)),inline:true},
        {name:"Grund",value:reason},{name:"Buchungsreferenz",value:`\`${tx.id}\``},
      ],"Die Korrektur ist als eigene, unveränderliche Buchung protokolliert."),ephemeral:true});
    }
    if (sub==="auszahlen") {
      const denied=guard(i,"finance","Finanzrolle"); if(denied)return respond(i,denied);
      const target=i.options.getUser("mitglied"),plan=finance.previewPayout(g,target.id);
      if(plan.gross===0)return respond(i,"Kein auszahlbares Familienguthaben vorhanden.");
      if(config.PAYOUT_MINIMUM_CENTS!=null&&plan.gross<config.PAYOUT_MINIMUM_CENTS)return respond(i,`Das Guthaben liegt unter dem Mindestbetrag von ${formatMoney(config.PAYOUT_MINIMUM_CENTS)}.`);
      const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`payout:${i.id}:${target.id}:${plan.gross}:${plan.deduction}`).setLabel(plan.net===0?"Verrechnung ohne Auszahlung bestätigen":"Auszahlung bestätigen").setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId(`cancel:${i.id}`).setLabel("Abbrechen").setStyle(ButtonStyle.Secondary));
      return answer(i,{...fieldsEmbed("💸 Auszahlung prüfen",[
        {name:"Empfänger",value:`<@${target.id}>`,inline:true},{name:"Brutto",value:`**${formatMoney(plan.gross)}**`,inline:true},
        {name:"Offene Sanktionen",value:formatMoney(plan.openCents),inline:true},
        {name:"Jetzt verrechnet",value:`− ${formatMoney(plan.deduction)}`,inline:true},{name:"Tatsächlicher Auszahlungsbetrag",value:`**${formatMoney(plan.net)}**`,inline:true},
        {name:"Verbleibende Sanktionen",value:formatMoney(plan.remainingAfter),inline:true},
        ...(plan.allocations.length?[{name:"Verrechnete Sanktionen",value:plan.allocations.map(a=>`\`${a.id.slice(0,8)}\` −${formatMoney(a.cents)}${a.remainingAfter?` (Rest ${formatMoney(a.remainingAfter)})`:" (beglichen)"}`).join("\n").slice(0,1024)}]:[]),
      ],`${plan.net===0?"⚠️ Das gesamte Guthaben wird durch Sanktionen aufgebraucht. Es wird nichts ausgezahlt, die Verrechnung wird aber dokumentiert.\n\n":""}Bitte prüfe die Beträge und bestätige die Buchung. Eine bestätigte Auszahlung kann nicht doppelt ausgeführt werden.`),components:[row],ephemeral:true});
    }
    if (sub==="liste") {
      const denied=guard(i,"financeView","Finanzrolle"); if(denied)return respond(i,denied);
      return answer(i,payoutListPayload(db,g,config.PAYOUT_MINIMUM_CENTS,i.options.getInteger("seite")??1));
    }
    if (sub==="historie") {
      const target=i.options.getUser("mitglied")?.id??u;
      if(target!==u&&!can(i,"financeView"))return respond(i,"Fremde Kontohistorien darf nur die Finanzrolle ansehen.");
      return answer(i,historyView(g,target,Math.max(1,i.options.getInteger("seite")??1)));
    }
  }

  async function sanctionCommand(i,sub,g,u){
    if(sub==="erstellen"){
      const denied=guard(i,"sanctions","Staff- oder Sanktions-Rolle");if(denied)return respond(i,denied);
      const target=i.options.getUser("mitglied"),amount=parseMoney(i.options.getString("betrag")),reason=i.options.getString("grund"),caseRef=i.options.getString("fall");
      if(target.bot)return respond(i,"Bots können nicht sanktioniert werden.");
      const id=finance.sanction({guildId:g,userId:target.id,actorId:u,cents:amount,reason,caseRef});
      return answer(i,{...fieldsEmbed("⚠️ Sanktion vorgemerkt",[
        {name:"Betroffenes Mitglied",value:`<@${target.id}>`,inline:true},{name:"Auszahlungsabzug",value:`**${formatMoney(amount)}**`,inline:true},
        {name:"Grund",value:reason},{name:"Sanktionsreferenz",value:`\`${id}\``,inline:true},...(caseRef?[{name:"Fallbezug",value:caseRef,inline:true}]:[]),
      ],"Der Betrag wird noch nicht abgezogen. Er wird bei der nächsten Auszahlung berücksichtigt."),ephemeral:true});
    }
    if(sub==="verwarnung")return issueWarning(i,g,u,{target:i.options.getUser("mitglied"),reason:i.options.getString("grund"),caseRef:i.options.getString("fall")});
    if(sub==="offen"){
      const target=i.options.getUser("mitglied")?.id??u;
      if(target!==u&&!can(i,"sanctions")&&!can(i,"financeView"))return respond(i,"Fremde Sanktionen darf nur Staff ansehen.");
      return answer(i,sanctionsView(g,target));
    }
    if(sub==="historie"){
      const target=i.options.getUser("mitglied")?.id??u;
      if(target!==u&&!can(i,"sanctions")&&!can(i,"financeView"))return respond(i,"Fremde Sanktionshistorien darf nur Staff ansehen.");
      const rows=finance.sanctionDetails(g,target,{limit:15});
      const warnings=warningService.list(g,target,{limit:5,expireDays:config.WARN_EXPIRE_DAYS});
      const items=rows.map(r=>({name:`${statusLabels[r.status]??r.status} · ${formatMoney(r.amount_cents)} · <t:${unix(r.created_at)}:d>`.slice(0,256),value:`**Grund:** ${r.reason}\n**Verrechnet:** ${formatMoney(r.collected_cents)}${r.refunded_cents?` · **Erstattet:** ${formatMoney(r.refunded_cents)}`:""} · **Offen:** ${formatMoney(r.remaining_cents)}\n**Aussteller:** <@${r.actor_id}> · \`${r.id.slice(0,8)}\`${r.case_ref?` · Fall: ${r.case_ref}`:""}`.slice(0,1024)}));
      if(warnings.length)items.push({name:`📝 Verwarnungen (${warnings.length} zuletzt)`,value:warnings.map(w=>`${warningStateIcon[w.state]} <t:${unix(w.created_at)}:d> · ${w.reason} · <@${w.actor_id}>`).join("\n").slice(0,1024)});
      return answer(i,{...fieldsEmbed("📚 Sanktionshistorie",items.slice(0,25),rows.length||warnings.length?`Mitglied: <@${target}> · Letzte 15 Sanktionen`:`Für <@${target}> gibt es keine Sanktionen oder Verwarnungen.`),ephemeral:true});
    }
    if(sub==="korrigieren"){
      const denied=guard(i,"sanctionManage","Leitungs- oder Sanktions-Rolle");if(denied)return respond(i,denied);
      const row=finance.correctSanction({guildId:g,sanctionId:i.options.getString("id"),actorId:u,cents:parseMoney(i.options.getString("betrag")),reason:i.options.getString("grund")});
      return answer(i,{...fieldsEmbed("✏️ Sanktion korrigiert",[{name:"Mitglied",value:`<@${row.user_id}>`,inline:true},{name:"Neuer Betrag",value:formatMoney(row.amount_cents),inline:true},{name:"Noch offen",value:formatMoney(row.remaining_cents),inline:true},{name:"Status",value:statusLabels[row.status]??row.status,inline:true},{name:"Grund",value:i.options.getString("grund")}],"Bereits verrechnete Beträge bleiben unverändert; die Änderung ist in der Sanktionshistorie protokolliert."),ephemeral:true});
    }
    if(sub==="aufheben"){
      const denied=guard(i,"sanctionManage","Leitungs- oder Sanktions-Rolle");if(denied)return respond(i,denied);
      const row=finance.voidSanction({guildId:g,sanctionId:i.options.getString("id"),actorId:u,reason:i.options.getString("grund")});
      return answer(i,{...fieldsEmbed("🚫 Sanktion aufgehoben",[
        {name:"Betroffenes Mitglied",value:`<@${row.user_id}>`,inline:true},{name:"Offener Rest",value:formatMoney(row.remaining_cents),inline:true},
        {name:"Grund der Aufhebung",value:i.options.getString("grund")},{name:"Sanktionsreferenz",value:`\`${row.id}\``,inline:true},
      ],"Die Sanktion ist geschlossen und wird bei künftigen Auszahlungen nicht mehr verrechnet."),ephemeral:true});
    }
    if(sub==="rueckerstatten"){
      const denied=guard(i,"leaders","Leitungsrolle");if(denied)return respond(i,denied);
      const tx=finance.refundSanction({guildId:g,sanctionId:i.options.getString("id"),actorId:u,reason:i.options.getString("grund"),key:`refund:${i.id}`});
      return answer(i,{...fieldsEmbed("↩️ Sanktion erstattet",[{name:"Erstatteter Betrag",value:`**${formatMoney(tx.amount_cents)}**`,inline:true},{name:"Transaktionsreferenz",value:`\`${tx.id}\``,inline:true},{name:"Grund",value:i.options.getString("grund")}],"Der bereits abgezogene Betrag wurde dem Familienkonto gutgeschrieben."),ephemeral:true});
    }
  }

  function balanceView(g,id){
    const plan=finance.previewPayout(g,id);
    const exists=Boolean(db.prepare("SELECT 1 FROM accounts WHERE guild_id=? AND user_id=?").get(g,id));
    return {...fieldsEmbed("💰 Familienkonto",[
        {name:"Mitglied",value:`<@${id}>`,inline:true},
        {name:"Familienguthaben (brutto)",value:`**${formatMoney(plan.gross)}**`,inline:true},
        {name:"Offene Sanktionen",value:formatMoney(plan.openCents),inline:true},
        {name:"Voraussichtliche Auszahlung",value:`**${formatMoney(plan.net)}**`,inline:true},
        ...(plan.remainingAfter?[{name:"Danach noch offene Sanktionen",value:formatMoney(plan.remainingAfter),inline:true}]:[]),
        ...(config.PAYOUT_MINIMUM_CENTS?[{name:"Auszahlung ab",value:plan.gross>=config.PAYOUT_MINIMUM_CENTS?`${formatMoney(config.PAYOUT_MINIMUM_CENTS)} · ✅ erreicht`:`${formatMoney(config.PAYOUT_MINIMUM_CENTS)} · noch ${formatMoney(config.PAYOUT_MINIMUM_CENTS-plan.gross)}`,inline:true}]:[]),
      ],exists?"Yamamoto-Familienguthaben für Grand-RP-Events und Familienaktivitäten. Sanktionen werden erst bei der Auszahlung verrechnet.":"Für dieses Mitglied wurde noch kein Familienkonto angelegt. Es entsteht mit der ersten Gutschrift oder über /konto anlegen."),ephemeral:true};
  }
  function historyView(g,target,page=1){
    const pageSize=10,total=db.prepare("SELECT COUNT(*) n FROM transactions WHERE guild_id=? AND user_id=?").get(g,target).n;
    const rows=db.prepare("SELECT type,amount_cents,gross_cents,deduction_cents,net_cents,reason,created_at,id,actor_id FROM transactions WHERE guild_id=? AND user_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?").all(g,target,pageSize,(page-1)*pageSize);
    const sign=type=>["payout","correction_debit"].includes(type)?"−":"+";
    const items=rows.map(r=>({name:`${transactionLabels[r.type]??"Buchung"} · ${new Date(r.created_at).toLocaleString("de-AT",{timeZone:config.TIMEZONE})}`.slice(0,256),value:`${r.type==="payout"?`**Brutto:** ${formatMoney(r.gross_cents)} · **Abzug:** ${formatMoney(r.deduction_cents)} · **Netto:** ${formatMoney(r.net_cents)}`:`**Betrag:** ${sign(r.type)}${formatMoney(r.amount_cents)}`}\n**Grund:** ${r.reason}\n**Durch:** <@${r.actor_id}> · \`${r.id.slice(0,8)}\``.slice(0,1024),inline:false}));
    return {...fieldsEmbed("🧾 Buchungshistorie",items,total?`Mitglied: <@${target}> · Seite ${page} von ${Math.max(1,Math.ceil(total/pageSize))} · ${total} Buchungen`:"Noch keine Buchungen vorhanden."),ephemeral:true};
  }
  function sanctionsView(g,target){
    const rows=db.prepare("SELECT id,amount_cents,remaining_cents,reason,status,created_at FROM sanctions WHERE guild_id=? AND user_id=? AND status IN ('open','partial') ORDER BY created_at").all(g,target);
    const items=rows.map(r=>({name:`${statusLabels[r.status]??r.status} · ${formatMoney(r.remaining_cents)} offen${r.status==="partial"?` von ${formatMoney(r.amount_cents)}`:""}`,value:`**Grund:** ${r.reason}\n**Seit:** <t:${unix(r.created_at)}:d> · **Referenz:** \`${r.id.slice(0,8)}\``.slice(0,1024),inline:false}));
    const total=rows.reduce((n,r)=>n+r.remaining_cents,0);
    return {...fieldsEmbed("⚠️ Offene Sanktionen",items,rows.length?`Mitglied: <@${target}> · Summe offen: **${formatMoney(total)}**\nDiese Beträge werden erst bei Auszahlungen verrechnet.`:`Für <@${target}> gibt es keine offenen Sanktionen.`),ephemeral:true};
  }

  /** Gemeinsamer Ablauf für /warn und /sanktion verwarnung: Rechte, Schutzregeln, Speichern, DM und Eskalation. */
  async function confirmPayout(i,{previewId,userId,gross,deduction}){
    if(previewId!==i.message.interaction?.id&&previewId!==i.message.interactionMetadata?.id)return answer(i,{content:"Diese Auszahlungsvorschau ist abgelaufen.",ephemeral:true});
    const denied=guard(i,"finance","Finanzrolle");if(denied)return answer(i,{content:denied,ephemeral:true});
    const key=`payout:${previewId}`;
    const existing=db.prepare("SELECT * FROM transactions WHERE idempotency_key=?").get(key);
    let tx=existing;
    if(!tx){
      try{tx=finance.payout({guildId:i.guildId,userId,actorId:i.user.id,key,minimumCents:config.PAYOUT_MINIMUM_CENTS,expectedGross:gross,expectedDeduction:deduction});}
      catch(error){
        if(error.code==="PREVIEW_MISMATCH")return updateMessage(i,{...fieldsEmbed("⚠️ Vorschau nicht mehr aktuell",[
          {name:"Was ist passiert?",value:"Kontostand oder offene Sanktionen haben sich seit der Vorschau geändert. Es wurde nichts gebucht."},
          {name:"Nächster Schritt",value:"Starte `/konto auszahlen` erneut und prüfe die aktuellen Beträge, bevor du bestätigst."},
        ]),components:[]});
        throw error;
      }
    }
    const remaining=finance.openSanctionTotal(i.guildId,userId);
    await updateMessage(i,{...fieldsEmbed(existing?"ℹ️ Auszahlung bereits verbucht":"✅ Auszahlung verbucht",[
      {name:"Empfänger",value:`<@${userId}>`,inline:true},{name:"Brutto",value:`**${formatMoney(tx.gross_cents)}**`,inline:true},
      {name:"Sanktionsabzug",value:`− ${formatMoney(tx.deduction_cents)}`,inline:true},{name:"Tatsächlich ausgezahlt",value:`**${formatMoney(tx.net_cents)}**`,inline:true},
      {name:"Noch offene Sanktionen",value:formatMoney(remaining),inline:true},
      {name:"Buchungsreferenz",value:`\`${tx.id}\``,inline:true},
    ],existing?"Diese Vorschau wurde bereits bestätigt; es wurde nichts doppelt gebucht.":"Die Buchung und alle zugehörigen Sanktionsverrechnungen wurden gemeinsam gespeichert. Bitte zahle den Nettobetrag jetzt im Spiel aus."),components:[]});
    if(!existing){
      const dm=new EmbedBuilder().setColor(BRAND_COLOR).setAuthor({name:"YAMAMOTO  •  FAMILIENKONTO"}).setTitle("💸 Auszahlung verbucht")
        .addFields({name:"Brutto",value:formatMoney(tx.gross_cents),inline:true},{name:"Sanktionsabzug",value:formatMoney(tx.deduction_cents),inline:true},{name:"Auszahlung",value:`**${formatMoney(tx.net_cents)}**`,inline:true},{name:"Referenz",value:`\`${tx.id.slice(0,8)}\``,inline:true})
        .setFooter({text:"YAMAMOTO  •  Private Nachricht"}).setTimestamp();
      await client.users.fetch(userId).then(user=>user.send({embeds:[dm]})).catch(()=>{});
    }
  }

  return { accountCommand, balanceView, confirmPayout, historyView, sanctionCommand, sanctionsView };
}

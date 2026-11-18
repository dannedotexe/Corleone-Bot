import { BAN_DELETE_CHOICES, TIMEOUT_CHOICES } from "../member-moderation.js";
import { ChannelType, SlashCommandBuilder } from "discord.js";
import { PERIODS } from "../services/stats.js";
import { VIEWS } from "../staff-panel.js";

export function buildCommands() {
  const money = new SlashCommandBuilder().setName("konto").setDescription("Corleone-Familienkonto")
    .addSubcommand(s=>s.setName("stand").setDescription("Eigenen Kontostand sehen"))
    .addSubcommand(s=>s.setName("anlegen").setDescription("Familienkonto für ein Mitglied anlegen (Finanzrolle)").addUserOption(o=>o.setName("mitglied").setDescription("Mitglied").setRequired(true)).addStringOption(o=>o.setName("notiz").setDescription("Optionale Notiz, z. B. neues Familienmitglied").setMaxLength(300)))
    .addSubcommand(s=>s.setName("ansehen").setDescription("Kontostand eines Mitglieds (Finanzrolle)").addUserOption(o=>o.setName("mitglied").setDescription("Mitglied").setRequired(true)))
    .addSubcommand(s=>s.setName("gutschrift").setDescription("Geld gutschreiben (Finanzrolle)").addUserOption(o=>o.setName("mitglied").setDescription("Empfänger").setRequired(true)).addStringOption(o=>o.setName("betrag").setDescription("Betrag, z. B. 250k, 2,5m oder 25000").setRequired(true)).addStringOption(o=>o.setName("grund").setDescription("Buchungsgrund").setRequired(true).setMaxLength(300)))
    .addSubcommand(s=>s.setName("auszahlen").setDescription("Guthaben auszahlen und Sanktionen verrechnen").addUserOption(o=>o.setName("mitglied").setDescription("Empfänger").setRequired(true)))
    .addSubcommand(s=>s.setName("korrektur").setDescription("Korrekturbuchung (Leitung)").addUserOption(o=>o.setName("mitglied").setDescription("Mitglied").setRequired(true)).addStringOption(o=>o.setName("richtung").setDescription("Richtung").setRequired(true).addChoices({name:"Guthaben erhöhen",value:"credit"},{name:"Guthaben verringern",value:"debit"})).addStringOption(o=>o.setName("betrag").setDescription("Betrag, z. B. 250k, 2,5m oder 25000").setRequired(true)).addStringOption(o=>o.setName("grund").setDescription("Korrekturgrund").setRequired(true).setMaxLength(300)))
    .addSubcommand(s=>s.setName("liste").setDescription("Auszahlungsliste (Finanzrolle)").addIntegerOption(o=>o.setName("seite").setDescription("Seite der Liste").setMinValue(1)))
    .addSubcommand(s=>s.setName("historie").setDescription("Transaktionshistorie").addUserOption(o=>o.setName("mitglied").setDescription("Mitglied (Finanzrolle)")).addIntegerOption(o=>o.setName("seite").setDescription("Seite").setMinValue(1)));
  const sanction = new SlashCommandBuilder().setName("sanktion").setDescription("Sanktionsverwaltung")
    .addSubcommand(s=>s.setName("erstellen").setDescription("Auszahlungsabzug vormerken").addUserOption(o=>o.setName("mitglied").setDescription("Betroffenes Mitglied").setRequired(true)).addStringOption(o=>o.setName("betrag").setDescription("Betrag, z. B. 250k, 2,5m oder 25000").setRequired(true)).addStringOption(o=>o.setName("grund").setDescription("Grund").setRequired(true).setMaxLength(300)).addStringOption(o=>o.setName("fall").setDescription("Optionale Fall- oder Event-ID").setMaxLength(100)))
    .addSubcommand(s=>s.setName("verwarnung").setDescription("Verwarnung ohne Geldabzug eintragen").addUserOption(o=>o.setName("mitglied").setDescription("Betroffenes Mitglied").setRequired(true)).addStringOption(o=>o.setName("grund").setDescription("Grund").setRequired(true).setMaxLength(300)).addStringOption(o=>o.setName("fall").setDescription("Optionale Fall- oder Event-ID").setMaxLength(100)))
    .addSubcommand(s=>s.setName("offen").setDescription("Offene Sanktionen anzeigen").addUserOption(o=>o.setName("mitglied").setDescription("Mitglied (optional)")))
    .addSubcommand(s=>s.setName("historie").setDescription("Alle Sanktionen und Verwarnungen eines Mitglieds").addUserOption(o=>o.setName("mitglied").setDescription("Mitglied (optional)")))
    .addSubcommand(s=>s.setName("korrigieren").setDescription("Sanktionsbetrag korrigieren (Leitung)").addStringOption(o=>o.setName("id").setDescription("Sanktion auswählen").setRequired(true).setAutocomplete(true)).addStringOption(o=>o.setName("betrag").setDescription("Neuer Gesamtbetrag, z. B. 250k oder 2,5m").setRequired(true)).addStringOption(o=>o.setName("grund").setDescription("Korrekturgrund").setRequired(true).setMaxLength(300)))
    .addSubcommand(s=>s.setName("aufheben").setDescription("Offene Sanktion aufheben").addStringOption(o=>o.setName("id").setDescription("Sanktion auswählen").setRequired(true).setAutocomplete(true)).addStringOption(o=>o.setName("grund").setDescription("Aufhebungsgrund").setRequired(true).setMaxLength(300)))
    .addSubcommand(s=>s.setName("rueckerstatten").setDescription("Bereits abgezogene Sanktion erstatten und aufheben").addStringOption(o=>o.setName("id").setDescription("Sanktion auswählen").setRequired(true).setAutocomplete(true)).addStringOption(o=>o.setName("grund").setDescription("Erstattungsgrund").setRequired(true).setMaxLength(300)));
  const ticket = new SlashCommandBuilder().setName("ticket").setDescription("Ticketsystem")
    .addSubcommand(s=>s.setName("panel").setDescription("Ticket-Panel senden (Staff)"))
    .addSubcommand(s=>s.setName("uebernehmen").setDescription("Dieses Ticket übernehmen (Staff)"))
    .addSubcommand(s=>s.setName("wiedereroeffnen").setDescription("Geschlossenes Ticket wieder öffnen (Staff)"))
    .addSubcommand(s=>s.setName("schliessen").setDescription("Dieses Ticket schließen").addStringOption(o=>o.setName("grund").setDescription("Optional – steht in der DM an den Ersteller und im Log").setMaxLength(300)))
    .addSubcommand(s=>s.setName("hinzufuegen").setDescription("Person zu diesem Ticket hinzufügen (Staff)").addUserOption(o=>o.setName("mitglied").setDescription("Wen?").setRequired(true)))
    .addSubcommand(s=>s.setName("entfernen").setDescription("Person aus diesem Ticket entfernen (Staff)").addUserOption(o=>o.setName("mitglied").setDescription("Wen?").setRequired(true)))
    .addSubcommand(s=>s.setName("umbenennen").setDescription("Ticket-Channel umbenennen (Staff)").addStringOption(o=>o.setName("name").setDescription("Neuer Name, z. B. auszahlung-tony").setRequired(true).setMaxLength(60)))
    .addSubcommand(s=>s.setName("freigeben").setDescription("Übernahme abgeben – jemand anderes kann das Ticket übernehmen (Staff)"));
  // Kurzformen wie bei anderen Ticket-Bots: /add und /remove im Ticket-Channel.
  const ticketAdd = new SlashCommandBuilder().setName("add").setDescription("Person zu diesem Ticket hinzufügen (Staff)").addUserOption(o=>o.setName("mitglied").setDescription("Wen?").setRequired(true));
  const ticketAdd2 = new SlashCommandBuilder().setName("ticketadd").setDescription("Person zu diesem Ticket hinzufügen (Staff)").addUserOption(o=>o.setName("mitglied").setDescription("Wen?").setRequired(true));
  const ticketRemove2 = new SlashCommandBuilder().setName("ticketremove").setDescription("Person aus diesem Ticket entfernen (Staff)").addUserOption(o=>o.setName("mitglied").setDescription("Wen?").setRequired(true));
  const ticketRemove = new SlashCommandBuilder().setName("remove").setDescription("Person aus diesem Ticket entfernen (Staff)").addUserOption(o=>o.setName("mitglied").setDescription("Wen?").setRequired(true));
  const event = new SlashCommandBuilder().setName("event").setDescription("Familien-Events")
    .addSubcommand(s=>s.setName("erstellen").setDescription("Event anlegen").addStringOption(o=>o.setName("name").setDescription("Name").setRequired(true).setMaxLength(100)).addStringOption(o=>o.setName("start").setDescription("Datum und Uhrzeit, z. B. 31.12.2026 19:00 (Server-Zeitzone)").setRequired(true)).addStringOption(o=>o.setName("treffpunkt").setDescription("Treffpunkt").setRequired(true).setMaxLength(100)).addStringOption(o=>o.setName("beschreibung").setDescription("Beschreibung").setRequired(true).setMaxLength(1000)).addIntegerOption(o=>o.setName("maximum").setDescription("Teilnehmerlimit").setMinValue(1).setMaxValue(500)).addIntegerOption(o=>o.setName("mindestens").setDescription("Mindestteilnehmer (sonst Meldung bzw. Absage kurz vor Start)").setMinValue(1).setMaxValue(500)).addStringOption(o=>o.setName("ausruestung").setDescription("Benötigte Ausrüstung").setMaxLength(500)).addStringOption(o=>o.setName("hinweise").setDescription("Teilnahmehinweise").setMaxLength(500)))
    .addSubcommand(s=>s.setName("liste").setDescription("Anstehende Events"))
    .addSubcommand(s=>s.setName("historie").setDescription("Vergangene Events"))
    .addSubcommand(s=>s.setName("teilnehmer").setDescription("Teilnehmerliste eines Events").addStringOption(o=>o.setName("id").setDescription("Event auswählen").setRequired(true).setAutocomplete(true)))
    .addSubcommand(s=>s.setName("bearbeiten").setDescription("Geplantes Event ändern").addStringOption(o=>o.setName("id").setDescription("Event auswählen").setRequired(true).setAutocomplete(true)).addStringOption(o=>o.setName("name").setDescription("Neuer Name").setMaxLength(100)).addStringOption(o=>o.setName("start").setDescription("Datum und Uhrzeit, z. B. 31.12.2026 19:00 (Server-Zeitzone)")).addStringOption(o=>o.setName("treffpunkt").setDescription("Neuer Treffpunkt").setMaxLength(100)).addStringOption(o=>o.setName("beschreibung").setDescription("Neue Beschreibung").setMaxLength(1000)).addIntegerOption(o=>o.setName("maximum").setDescription("Neues Teilnehmerlimit").setMinValue(1).setMaxValue(500)).addIntegerOption(o=>o.setName("mindestens").setDescription("Neue Mindestteilnehmerzahl").setMinValue(1).setMaxValue(500)).addStringOption(o=>o.setName("ausruestung").setDescription("Neue Ausrüstung").setMaxLength(500)).addStringOption(o=>o.setName("hinweise").setDescription("Neue Teilnahmehinweise").setMaxLength(500)))
    .addSubcommand(s=>s.setName("anwesenheit").setDescription("Teilnahme dokumentieren (Event-Team)").addStringOption(o=>o.setName("id").setDescription("Event auswählen").setRequired(true).setAutocomplete(true)).addUserOption(o=>o.setName("mitglied").setDescription("Teilnehmer").setRequired(true)).addStringOption(o=>o.setName("status").setDescription("Teilnahme").setRequired(true).addChoices({name:"Anwesend",value:"present"},{name:"Abwesend",value:"absent"})))
    .addSubcommand(s=>s.setName("beenden").setDescription("Event abschließen").addStringOption(o=>o.setName("id").setDescription("Event auswählen").setRequired(true).setAutocomplete(true)))
    .addSubcommand(s=>s.setName("absagen").setDescription("Event absagen").addStringOption(o=>o.setName("id").setDescription("Event auswählen").setRequired(true).setAutocomplete(true)).addStringOption(o=>o.setName("grund").setDescription("Grund für die Absage").setMaxLength(300)));
  const apps = new SlashCommandBuilder().setName("antrag").setDescription("Bewerbung und Rang-Anträge")
    .addSubcommand(s=>s.setName("bewerben").setDescription("Bewerbung einreichen").addStringOption(o=>o.setName("typ").setDescription("Bewerbungstyp").setRequired(true).addChoices({name:"Familienbeitritt",value:"bewerbung"},{name:"Rang-Antrag",value:"rang"})))
    .addSubcommand(s=>s.setName("liste").setDescription("Offene Anträge (Reviewer)"))
    .addSubcommand(s=>s.setName("kommentieren").setDescription("Interne Notiz zu einem Antrag (Reviewer)").addStringOption(o=>o.setName("id").setDescription("Antrag auswählen").setRequired(true).setAutocomplete(true)).addStringOption(o=>o.setName("notiz").setDescription("Interne Notiz").setRequired(true).setMaxLength(1000)))
    .addSubcommand(s=>s.setName("entscheiden").setDescription("Antrag mit optionalem Kommentar entscheiden (Reviewer)").addStringOption(o=>o.setName("id").setDescription("Antrag auswählen").setRequired(true).setAutocomplete(true)).addStringOption(o=>o.setName("entscheidung").setDescription("Ergebnis").setRequired(true).addChoices({name:"Annehmen",value:"accepted"},{name:"Ablehnen",value:"rejected"})).addStringOption(o=>o.setName("kommentar").setDescription("Begründung für Antragsteller").setMaxLength(1000)))
    .addSubcommand(s=>s.setName("status").setDescription("Eigenen Antrag zurückziehen").addStringOption(o=>o.setName("id").setDescription("Eigenen offenen Antrag auswählen").setRequired(true).setAutocomplete(true)));
  const giveaway = new SlashCommandBuilder().setName("giveaway").setDescription("Giveaways")
    .addSubcommand(s=>s.setName("erstellen").setDescription("Giveaway starten").addStringOption(o=>o.setName("preis").setDescription("Preis").setRequired(true).setMaxLength(200)).addIntegerOption(o=>o.setName("minuten").setDescription("Dauer in Minuten").setRequired(true).setMinValue(1).setMaxValue(43200)).addIntegerOption(o=>o.setName("gewinner").setDescription("Gewinnerzahl").setRequired(true).setMinValue(1).setMaxValue(20)).addStringOption(o=>o.setName("bedingungen").setDescription("Teilnahmebedingungen").setMaxLength(500)).addRoleOption(o=>o.setName("rolle").setDescription("Nur Mitglieder mit dieser Rolle dürfen teilnehmen")))
    .addSubcommand(s=>s.setName("abbrechen").setDescription("Giveaway abbrechen").addStringOption(o=>o.setName("id").setDescription("Giveaway auswählen").setRequired(true).setAutocomplete(true)).addStringOption(o=>o.setName("grund").setDescription("Grund").setMaxLength(300)));
  const dashboard = new SlashCommandBuilder().setName("dashboard").setDescription("Staff-Dashboard")
    .addSubcommand(s=>s.setName("ansicht").setDescription("Private Staff-Übersicht anzeigen").addStringOption(o=>o.setName("bereich").setDescription("Bereich").addChoices(...Object.entries(VIEWS).map(([value,view])=>({name:view.label,value})))))
    .addSubcommand(s=>s.setName("panel").setDescription("Dauerhaftes Dashboard-Panel in diesem Channel veröffentlichen (Staff)"));
  const settings = new SlashCommandBuilder().setName("einstellungen").setDescription("Bot-Einstellungen (Leitung)")
    .addSubcommand(s=>s.setName("anzeigen").setDescription("Aktive Rollen-, Channel- und Moduleinstellungen prüfen"))
    .addSubcommand(s=>s.setName("pruefen").setDescription("Prüft, ob alle Channels zu ihren Funktionen passen (Rechte, Sichtbarkeit, Name)"))
    .addSubcommand(s=>s.setName("panels").setDescription("Alle Panels in ihre Channels senden bzw. aktualisieren (Leitung)"))
    .addSubcommand(s=>s.setName("raenge").setDescription("Rang-Rollen auf die Familien-Rangnamen umbenennen, fehlende anlegen (Leitung)"))
    .addSubcommand(s=>s.setName("kanal").setDescription("Funktions-Channel festlegen").addStringOption(o=>o.setName("schluessel").setDescription("Funktion (tippen zum Suchen)").setRequired(true).setAutocomplete(true)).addChannelOption(o=>o.setName("kanal").setDescription("Channel oder Kategorie").setRequired(true).addChannelTypes(ChannelType.GuildText,ChannelType.GuildCategory,ChannelType.GuildAnnouncement,ChannelType.GuildForum)));
  const automod = new SlashCommandBuilder().setName("automod").setDescription("AutoMod und Raid-Schutz")
    .addSubcommand(s=>s.setName("status").setDescription("AutoMod-Einstellungen und letzte Maßnahmen (Staff)"))
    .addSubcommand(s=>s.setName("sync").setDescription("Gesperrte Begriffe als native Discord-AutoMod-Regel übernehmen (Leitung)"));
  const activities = new SlashCommandBuilder().setName("aktivitaeten").setDescription("Wiederkehrende Familien-Aktivitäten")
    .addSubcommand(s=>s.setName("liste").setDescription("Aktivitätenplan anzeigen"))
    .addSubcommand(s=>s.setName("status").setDescription("Aktivität aktivieren oder deaktivieren (Event-Team)").addStringOption(o=>o.setName("aktivitaet").setDescription("Aktivität auswählen").setRequired(true).setAutocomplete(true)).addBooleanOption(o=>o.setName("aktiv").setDescription("Aktiv = Termine werden automatisch angekündigt").setRequired(true)))
    .addSubcommand(s=>s.setName("board").setDescription("Dauerhafte Aktivitäten-Übersicht in diesem Channel posten (Event-Team)"));
  const warn = new SlashCommandBuilder().setName("warn").setDescription("Mitglied verwarnen (ohne Geldabzug)")
    .addUserOption(o=>o.setName("mitglied").setDescription("Wer verwarnt wird").setRequired(true))
    .addStringOption(o=>o.setName("grund").setDescription("Grund – die Person bekommt ihn per DM").setRequired(true).setMinLength(3).setMaxLength(300))
    .addStringOption(o=>o.setName("fall").setDescription("Optionale Fall-, Ticket- oder Event-ID").setMaxLength(100));
  const warnings = new SlashCommandBuilder().setName("warnings").setDescription("Verwarnungen ansehen")
    .addUserOption(o=>o.setName("mitglied").setDescription("Mitglied (nur Moderation; leer = du selbst)"));
  const unwarn = new SlashCommandBuilder().setName("unwarn").setDescription("Verwarnung zurücknehmen (Moderation)")
    .addUserOption(o=>o.setName("mitglied").setDescription("Wessen Verwarnung zurückgenommen wird").setRequired(true))
    .addStringOption(o=>o.setName("grund").setDescription("Grund der Rücknahme").setRequired(true).setMinLength(3).setMaxLength(300))
    .addStringOption(o=>o.setName("warnung").setDescription("Welche Verwarnung (leer = die neueste aktive)").setAutocomplete(true));
  const verify = new SlashCommandBuilder().setName("verifizieren").setDescription("Mitglied manuell verifizieren (Staff) – setzt „Vorname Nachname | ID“ und die Verifiziert-Rolle")
    .addUserOption(o=>o.setName("mitglied").setDescription("Wen?").setRequired(true))
    .addStringOption(o=>o.setName("vorname").setDescription("Vorname (Ingame)").setRequired(true).setMaxLength(20))
    .addStringOption(o=>o.setName("nachname").setDescription("Nachname (Ingame)").setRequired(true).setMaxLength(20))
    .addStringOption(o=>o.setName("id").setDescription("Ingame-ID").setRequired(true).setMaxLength(10));
  const control = new SlashCommandBuilder().setName("staatliche").setDescription("Staatliche Kontrolle ankündigen (Angriff oder Verteidigung)")
    .addStringOption(o=>o.setName("art").setDescription("Greifen wir an oder werden wir angegriffen?").setRequired(true).addChoices({name:"🛡️ Wir werden angegriffen",value:"defend"},{name:"🚩 Wir greifen an",value:"attack"}))
    .addStringOption(o=>o.setName("familie").setDescription("Welche Familie?").setRequired(true).setMaxLength(60))
    .addStringOption(o=>o.setName("wann").setDescription("jetzt, in 20 (Minuten) oder 16:30").setRequired(false).setMaxLength(20))
    .addIntegerOption(o=>o.setName("max").setDescription("Max. Teilnehmer, danach Warteliste (Standard aus Einstellungen, 0 = unbegrenzt)").setRequired(false).setMinValue(0).setMaxValue(200));
  const absence = new SlashCommandBuilder().setName("abwesend").setDescription("Abmeldung bei der Familie (Urlaub, Pause)")
    .addSubcommand(s=>s.setName("melden").setDescription("Für einen Zeitraum abmelden").addStringOption(o=>o.setName("von").setDescription("Beginn, z. B. heute, morgen, Freitag oder 20.10.").setRequired(true).setMaxLength(20)).addStringOption(o=>o.setName("bis").setDescription("Ende, z. B. 27.10., Sonntag, 3 Tage oder 1 Woche").setRequired(true).setMaxLength(20)).addStringOption(o=>o.setName("grund").setDescription("Grund – sieht nur das Team").setRequired(true).setMinLength(2).setMaxLength(300)))
    .addSubcommand(s=>s.setName("kurz").setDescription("Kurz weg (Minuten/Stunden), z. B. 30 min, 2h oder bis 21:30").addStringOption(o=>o.setName("dauer").setDescription("z. B. 30 min, 2h, 1,5 h oder bis 21:30").setRequired(true).setMaxLength(20)).addStringOption(o=>o.setName("grund").setDescription("Optional – sieht nur das Team").setMaxLength(200)))
    .addSubcommand(s=>s.setName("beenden").setDescription("Eigene Abmeldung oder „Kurz weg“ beenden (wieder da)"))
    .addSubcommand(s=>s.setName("liste").setDescription("Wer gerade abgemeldet ist (Staff)"));
  const leaderboard = new SlashCommandBuilder().setName("rangliste").setDescription("Aktivste Mitglieder nach Event-Teilnahmen")
    .addStringOption(o=>o.setName("zeitraum").setDescription("Zeitraum").addChoices({name:"Diese Woche",value:"week"},{name:"Dieser Monat",value:"month"},{name:"Gesamt",value:"all"}));
  const reasonOption=o=>o.setName("grund").setDescription("Grund – die Person bekommt ihn per DM").setRequired(true).setMinLength(3).setMaxLength(300);
  const timeout = new SlashCommandBuilder().setName("timeout").setDescription("Mitglied stummschalten (Moderation)")
    .addUserOption(o=>o.setName("mitglied").setDescription("Wer stummgeschaltet wird").setRequired(true))
    .addIntegerOption(o=>o.setName("dauer").setDescription("Dauer").setRequired(true).addChoices(...TIMEOUT_CHOICES.map(([value,name])=>({name,value}))))
    .addStringOption(reasonOption);
  const untimeout = new SlashCommandBuilder().setName("untimeout").setDescription("Timeout vorzeitig aufheben (Moderation)")
    .addUserOption(o=>o.setName("mitglied").setDescription("Mitglied").setRequired(true)).addStringOption(o=>o.setName("grund").setDescription("Grund").setRequired(true).setMinLength(3).setMaxLength(300));
  const kick = new SlashCommandBuilder().setName("kick").setDescription("Mitglied vom Server entfernen (Staff, mit Bestätigung)")
    .addUserOption(o=>o.setName("mitglied").setDescription("Mitglied").setRequired(true)).addStringOption(reasonOption);
  const ban = new SlashCommandBuilder().setName("ban").setDescription("Person bannen (Leitung, mit Bestätigung)")
    .addUserOption(o=>o.setName("mitglied").setDescription("Person (auch per ID)").setRequired(true)).addStringOption(reasonOption)
    .addIntegerOption(o=>o.setName("nachrichten").setDescription("Nachrichten der Person löschen").addChoices(...BAN_DELETE_CHOICES.map(([value,name])=>({name,value}))));
  const unban = new SlashCommandBuilder().setName("unban").setDescription("Bann aufheben (Leitung)")
    .addUserOption(o=>o.setName("person").setDescription("Gebannte Person (Benutzer-ID einfügen)").setRequired(true)).addStringOption(o=>o.setName("grund").setDescription("Grund").setRequired(true).setMinLength(3).setMaxLength(300));
  const poll = new SlashCommandBuilder().setName("umfrage").setDescription("Abstimmungen")
    .addSubcommand(s=>s.setName("erstellen").setDescription("Abstimmung starten (Staff)")
      .addStringOption(o=>o.setName("frage").setDescription("Die Frage").setRequired(true).setMinLength(3).setMaxLength(250))
      .addStringOption(o=>o.setName("optionen").setDescription("Antworten, getrennt durch ; (leer = Ja; Nein)").setMaxLength(900))
      .addStringOption(o=>o.setName("dauer").setDescription("Wie lange? z. B. 30 min, 2h, 1 Tag, 1 Woche (Standard 1 Tag)").setMaxLength(20))
      .addBooleanOption(o=>o.setName("mehrfach").setDescription("Mehrere Antworten wählbar (z. B. Termin-Umfrage)"))
      .addBooleanOption(o=>o.setName("anonym").setDescription("Niemand (auch nicht das Team) sieht, wer was gewählt hat"))
      .addBooleanOption(o=>o.setName("ergebnis_verstecken").setDescription("Zwischenstand erst am Ende zeigen"))
      .addRoleOption(o=>o.setName("rolle").setDescription("Nur Mitglieder mit dieser Rolle dürfen abstimmen"))
      .addBooleanOption(o=>o.setName("pingen").setDescription("Beim Start pingen (die gewählte Rolle, sonst die Familienrolle)"))
      .addBooleanOption(o=>o.setName("erinnern").setDescription("Vor Ende alle pingen, die noch nicht abgestimmt haben (Standard: ja)"))
      .addChannelOption(o=>o.setName("kanal").setDescription("Channel (Standard: Abstimmungs-Channel)").addChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement)))
    .addSubcommand(s=>s.setName("beenden").setDescription("Abstimmung vorzeitig beenden (Staff)").addStringOption(o=>o.setName("umfrage").setDescription("Abstimmung auswählen").setRequired(true).setAutocomplete(true)));
  const log = new SlashCommandBuilder().setName("log").setDescription("Erledigte Familien-Aufgabe mit Screenshot einreichen (Belohnung nach Prüfung)")
    .addStringOption(o=>o.setName("aufgabe").setDescription("Welche Aufgabe? (tippen zum Suchen)").setRequired(true).setAutocomplete(true))
    .addAttachmentOption(o=>o.setName("beweis").setDescription("Screenshot – ganzer Bildschirm mit Datum und Uhrzeit").setRequired(true))
    .addIntegerOption(o=>o.setName("menge").setDescription("Wie viele? (nur bei Aufgaben mit Stückzahl, Standard 1)").setMinValue(1).setMaxValue(999))
    .addUserOption(o=>o.setName("eingeladen").setDescription("Nur bei Invites: Wen hast du eingeladen?"))
    .addStringOption(o=>o.setName("notiz").setDescription("Optional, kurze Notiz fürs Team").setMaxLength(300));
  const logbook = new SlashCommandBuilder().setName("logbuch").setDescription("Logbuch im Forum für ein Mitglied anlegen (Staff)")
    .addUserOption(o=>o.setName("mitglied").setDescription("Für wen?").setRequired(true))
    .addStringOption(o=>o.setName("art").setDescription("Welches Logbuch? (Standard: alle eingestellten)").addChoices({name:"Aufgaben-Logbuch",value:"tasks"},{name:"Event-Logbuch",value:"events"}));
  const kills = new SlashCommandBuilder().setName("kills").setDescription("Kill-Bestenliste aus den Events")
    .addStringOption(o=>o.setName("zeitraum").setDescription("Zeitraum").addChoices({name:"Diese Woche",value:"week"},{name:"Dieser Monat",value:"month"},{name:"Gesamt",value:"all"}));
  const myTasks = new SlashCommandBuilder().setName("aufgaben").setDescription("Deine Aufgaben-Logs: Stufe, Serie, Woche und Verdienst");
  const misc = [
    new SlashCommandBuilder().setName("ping").setDescription("Bot-Latenz anzeigen"),
    new SlashCommandBuilder().setName("help").setDescription("Befehlsübersicht"),
    new SlashCommandBuilder().setName("bewerbung-panel").setDescription("Bewerbungs-Panel senden (Reviewer)"),
    new SlashCommandBuilder().setName("statistik").setDescription("Familienstatistik anzeigen (Staff)").addIntegerOption(o=>o.setName("zeitraum").setDescription("Zeitraum").addChoices(...Object.entries(PERIODS).map(([days,label])=>({name:label,value:Number(days)})))),
  ];
  return [verify,log,myTasks,logbook,kills,money,sanction,warn,warnings,unwarn,poll,timeout,untimeout,kick,ban,unban,control,absence,leaderboard,ticket,ticketAdd,ticketRemove,ticketAdd2,ticketRemove2,event,apps,giveaway,dashboard,settings,automod,activities,...misc].map(c=>c.toJSON());
}

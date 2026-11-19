import { PermissionsBitField } from "discord.js";

/**
 * Freund-Rolle: bekommt in jedem Channel und jeder Kategorie genau die Rechte, die die Familienrolle dort hat
 * (sehen, schreiben, Sprach-Channels usw.). Wo die Familie nichts darf (z. B. Staff), bekommt der Freund nichts.
 * Kein Konto, kein Logbuch, kein Rang – nur gemeinsam auf dem Server sein. Bestehende Freund-Rechte werden ersetzt.
 * exclude: Wortteile; Channels/Kategorien, deren Name (oder Kategorie-Name) einen davon enthält, bleiben für Freunde zu
 * (z. B. Events, Aufgaben, Auszahlungen) – dort gesetzte Freund-Rechte werden entfernt.
 */
export const FRIEND_EXCLUDE_DEFAULT = ["event", "aufgabe", "log", "auszahlung", "konto", "sanktion", "abmeld", "bewerb", "rang", "staff", "leitung"];
const plain = name => String(name ?? "").toLowerCase().replace(/[^a-z0-9äöüß-]+/g, " ").trim();
export async function mirrorFamilyAccess({ guild, familyRoleId, friendRoleId, exclude = FRIEND_EXCLUDE_DEFAULT, reason = "Freund-Rolle: gleiche Channel-Rechte wie die Familie" }) {
  if (!familyRoleId || !friendRoleId) throw new Error("Familien- und Freund-Rolle werden gebraucht.");
  if (familyRoleId === friendRoleId) throw new Error("Familien- und Freund-Rolle müssen verschiedene Rollen sein.");
  const channels = [...(await guild.channels.fetch()).values()].filter(c => c?.permissionOverwrites?.cache);
  // Kategorien zuerst, damit synchronisierte Channels danach passen.
  channels.sort((a, b) => (a.type === 4 ? 0 : 1) - (b.type === 4 ? 0 : 1));
  const result = { updated: 0, excluded: 0, failed: [] };
  const words = exclude.map(w => String(w).trim().toLowerCase()).filter(Boolean);
  const nameOf = new Map(channels.map(c => [c.id, c.name]));
  const isExcluded = c => words.some(w => plain(c.name).includes(w) || (c.parentId && plain(nameOf.get(c.parentId)).includes(w)));
  for (const channel of channels) {
    if (isExcluded(channel)) {
      const old = channel.permissionOverwrites.cache.get(friendRoleId);
      if (old) { await (old.delete?.(reason) ?? channel.permissionOverwrites.delete?.(friendRoleId, reason))?.catch?.(() => {}); }
      result.excluded++;
      continue;
    }
    const family = channel.permissionOverwrites.cache.get(familyRoleId);
    if (!family) continue;
    const flags = {};
    for (const name of new PermissionsBitField(family.allow.bitfield).toArray()) flags[name] = true;
    for (const name of new PermissionsBitField(family.deny.bitfield).toArray()) flags[name] = false;
    try { await channel.permissionOverwrites.edit(friendRoleId, flags, { reason }); result.updated++; }
    catch (error) { if (result.failed.length < 10) result.failed.push(`#${channel.name}: ${error.message}`); }
  }
  return result;
}

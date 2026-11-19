import { PermissionsBitField } from "discord.js";

/**
 * Freund-Rolle: bekommt in jedem Channel und jeder Kategorie genau die Rechte, die die Familienrolle dort hat
 * (sehen, schreiben, Sprach-Channels usw.). Wo die Familie nichts darf (z. B. Staff), bekommt der Freund nichts.
 * Kein Konto, kein Logbuch, kein Rang – nur gemeinsam auf dem Server sein. Bestehende Freund-Rechte werden ersetzt.
 */
export async function mirrorFamilyAccess({ guild, familyRoleId, friendRoleId, reason = "Freund-Rolle: gleiche Channel-Rechte wie die Familie" }) {
  if (!familyRoleId || !friendRoleId) throw new Error("Familien- und Freund-Rolle werden gebraucht.");
  if (familyRoleId === friendRoleId) throw new Error("Familien- und Freund-Rolle müssen verschiedene Rollen sein.");
  const channels = [...(await guild.channels.fetch()).values()].filter(c => c?.permissionOverwrites?.cache);
  // Kategorien zuerst, damit synchronisierte Channels danach passen.
  channels.sort((a, b) => (a.type === 4 ? 0 : 1) - (b.type === 4 ? 0 : 1));
  const result = { updated: 0, failed: [] };
  for (const channel of channels) {
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

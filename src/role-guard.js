import { AuditLogEvent } from "discord.js";
import { audit } from "./database.js";

/**
 * Rollen, die nur der Bot vergeben darf (ROLE_BOT_ONLY, z. B. „Grand DE 01“). Vergibt ein Mensch so eine Rolle von
 * Hand, nimmt der Bot sie wieder weg – außer die Person ist beim Bot verifiziert (dann hätte sie die Rolle ohnehin).
 * Wer die Rolle vergeben hat, steht im Discord-Audit-Log (braucht „Audit-Log anzeigen“).
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function grantedBy(guild, userId, roleId) {
  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 10 }).catch(() => null);
  const entry = logs?.entries?.find(e => e.target?.id === userId && Date.now() - e.createdTimestamp < 60_000
    && e.changes?.some(c => c.key === "$add" && (c.new ?? []).some(r => r.id === roleId)));
  return entry?.executor?.id ?? entry?.executorId ?? null;
}

export async function guardBotOnlyRoles({ db, client, config, oldMember, member, wait = 2000 }) {
  const protectedRoles = config.ROLE_BOT_ONLY ?? [];
  if (!protectedRoles.length || member.user?.bot || !oldMember?.roles?.cache || oldMember.partial) return [];
  const added = protectedRoles.filter(id => member.roles.cache.has(id) && !oldMember.roles.cache.has(id));
  if (!added.length) return [];
  // Der Bot speichert die Verifizierung direkt nach dem Vergeben – kurz warten, damit sie sicher da ist.
  if (wait) await pause(wait);
  const verified = Boolean(db.prepare("SELECT 1 FROM member_verifications WHERE guild_id=? AND user_id=?").get(member.guild.id, member.id));
  const removed = [];
  for (const roleId of added) {
    const by = await grantedBy(member.guild, member.id, roleId);
    if (by === client.user?.id) continue;
    if (verified) continue;
    const ok = await member.roles.remove(roleId, "Diese Rolle vergibt nur der Bot (nach der Verifizierung)").then(() => true).catch(() => false);
    audit(db, member.guild.id, by ?? client.user?.id ?? "system", "member.bot_only_role_removed", member.id, { roleId, by, removed: ok });
    if (ok) removed.push(roleId);
  }
  return removed;
}

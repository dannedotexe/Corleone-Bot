/**
 * Rang-Rollen auf die Familien-Namen bringen (Einstellung RANK_NAMES, „10=EL PATRON,9=JEFE,…“). Rang-Rollen heißen
 * „| Nummer - Name“; die Nummer bleibt, nur der Name wird ersetzt. Fehlende Ränge werden angelegt (ohne Server-Rechte,
 * direkt unter dem nächsthöheren Rang). Mehrdeutige Fälle (zwei Rollen mit derselben Nummer) werden nur gemeldet.
 */
const RANK_ROLE = /^[\s|]*(\d{1,2})\s*-\s*(.*)$/;
export const rankRoleName = (number, name) => `| ${number} - ${name}`;

export function parseRankNames(list) {
  const map = new Map();
  for (const entry of list ?? []) {
    const m = /^(\d{1,2})\s*=\s*(.+)$/.exec(String(entry).trim());
    if (m) map.set(Number(m[1]), m[2].trim());
  }
  return map;
}

export async function applyRankNames({ guild, config, settings = null, actorId, actorRoleIds = [], actorIsOwner = false }) {
  const names = parseRankNames(config.RANK_NAMES);
  if (!names.size) return { lines: ["Keine Rang-Namen eingestellt (Einstellung „Rang-Namen“)."], renamed: 0, created: 0 };
  const roles = [...(await guild.roles.fetch()).values()].filter(r => r && !r.managed && r.id !== guild.id);
  const byNumber = new Map();
  for (const role of roles) {
    const m = RANK_ROLE.exec(role.name);
    if (m) byNumber.set(Number(m[1]), [...(byNumber.get(Number(m[1])) ?? []), role]);
  }
  const lines = [];
  let renamed = 0, created = 0;
  const reason = "Rang-Namen der Familie (/einstellungen raenge)";
  for (const [number, name] of [...names.entries()].sort((a, b) => b[0] - a[0])) {
    const wanted = rankRoleName(number, name), hits = byNumber.get(number) ?? [];
    if (hits.length > 1) { lines.push(`⚠️ Rang ${number}: ${hits.length} Rollen mit dieser Nummer – bitte selbst bereinigen`); continue; }
    if (hits.length === 1) {
      const role = hits[0];
      if (role.name === wanted) { lines.push(`✅ ${wanted}`); continue; }
      const ok = await role.setName(wanted, reason).then(() => true).catch(error => { lines.push(`❌ ${role.name} → ${wanted}: ${error.message}`); return false; });
      if (ok) { lines.push(`✏️ ${role.name} → **${wanted}**`); renamed++; }
      continue;
    }
    // Fehlt: anlegen, direkt unter dem nächsthöheren vorhandenen Rang (sonst über dem nächstniedrigeren).
    const above = [...byNumber.entries()].filter(([n, list]) => n > number && list.length === 1).sort((a, b) => a[0] - b[0])[0]?.[1][0];
    const below = [...byNumber.entries()].filter(([n, list]) => n < number && list.length === 1).sort((a, b) => b[0] - a[0])[0]?.[1][0];
    const model = above ?? below;
    try {
      const role = await guild.roles.create({ name: wanted, color: model?.color ?? 0, hoist: model?.hoist ?? false, mentionable: false, permissions: 0n, reason });
      const position = above ? Math.max(1, above.position - 1) : below ? below.position + 1 : null;
      if (position != null) await role.setPosition(position, { reason }).catch(() => {});
      byNumber.set(number, [role]);
      lines.push(`➕ **${wanted}** neu angelegt (ohne Server-Rechte)`); created++;
    } catch (error) { lines.push(`❌ ${wanted} konnte nicht angelegt werden: ${error.message}`); }
  }
  // Rang-Rollen-Einstellung (Rang im Dashboard, Rang-Historie, Familienzugehörigkeit) mit allen Rängen füllen:
  // höchster zuerst; andere, von Hand eingetragene Rollen bleiben dahinter erhalten.
  if (settings) {
    const ranks = [...byNumber.entries()].filter(([n, list]) => names.has(n) && list.length === 1).sort((a, b) => b[0] - a[0])
      .map(([n, [role]]) => ({ label: `${n} - ${names.get(n)}`, roleId: role.id }));
    const current = Array.isArray(config.RANK_ROLES_JSON) ? config.RANK_ROLES_JSON : [];
    const next = [...ranks, ...current.filter(r => !ranks.some(x => x.roleId === r.roleId))].slice(0, 25);
    if (ranks.length && JSON.stringify(next) !== JSON.stringify(current)) {
      try { settings.update({ key: "RANK_ROLES_JSON", value: next, actorId, actorRoleIds, actorIsOwner }); lines.push(`🔁 ${ranks.length} Rang-Rollen in den Einstellungen hinterlegt (Rang im Dashboard, Rang-Historie)`); }
      catch (error) { lines.push(`⚠️ Rang-Rollen-Einstellung nicht angepasst: ${error.message}`); }
    }
  }
  return { lines, renamed, created };
}

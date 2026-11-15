import { ChannelType, PermissionFlagsBits } from "discord.js";

/**
 * Server kopieren: captureBlueprint liest den Aufbau (Rollen, Kategorien, Channels, Rechte) als Datei aus; applyBlueprint
 * baut ihn auf einem anderen Server nach (im Bot der anderen Familie). Nachrichten, Mitglieder und Bot-Daten nicht.
 * Vorhandene Rollen/Channels mit gleichem Namen werden wiederverwendet statt doppelt angelegt; gelöscht wird nichts.
 */
const COPY_TYPES = new Set([ChannelType.GuildCategory, ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildStageVoice]);

export async function captureBlueprint(guild) {
  const roles = [...(await guild.roles.fetch()).values()];
  const everyone = roles.find(r => r.id === guild.id);
  const roleName = new Map(roles.map(r => [r.id, r.name]));
  const channels = [...(await guild.channels.fetch()).values()].filter(c => c && COPY_TYPES.has(c.type));
  const overwrites = c => [...(c.permissionOverwrites?.cache?.values() ?? [])]
    .filter(o => o.type === 0 && roleName.has(o.id))
    .map(o => ({ role: o.id === guild.id ? "@everyone" : roleName.get(o.id), allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() }));
  const describe = c => ({
    name: c.name, type: c.type, position: c.rawPosition ?? c.position ?? 0, parent: c.parent?.name ?? null,
    topic: c.topic ?? null, nsfw: Boolean(c.nsfw), rateLimitPerUser: c.rateLimitPerUser ?? 0,
    bitrate: c.bitrate ?? null, userLimit: c.userLimit ?? null,
    tags: c.type === ChannelType.GuildForum ? (c.availableTags ?? []).map(t => ({ name: t.name, moderated: t.moderated, emoji: t.emoji?.id ? null : t.emoji ?? null })) : null,
    overwrites: overwrites(c),
  });
  return {
    format: "nexus-blueprint-v1", source: guild.name, capturedAt: new Date().toISOString(),
    everyone: everyone?.permissions.bitfield.toString() ?? null,
    // Von oben nach unten (höchste Rolle zuerst). Bot-/Integrationsrollen werden nicht kopiert.
    roles: roles.filter(r => r.id !== guild.id && !r.managed).sort((a, b) => b.position - a.position)
      .map(r => ({ name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions.bitfield.toString() })),
    categories: channels.filter(c => c.type === ChannelType.GuildCategory).sort((a, b) => a.rawPosition - b.rawPosition).map(describe),
    channels: channels.filter(c => c.type !== ChannelType.GuildCategory).sort((a, b) => (a.parent?.rawPosition ?? -1) - (b.parent?.rawPosition ?? -1) || a.rawPosition - b.rawPosition).map(describe),
  };
}

const jobs = new Map(); // Ziel-Server → Fortschritt
export const copyJob = guildId => jobs.get(guildId) ?? null;

/**
 * Baut einen exportierten Aufbau (Datei aus captureBlueprint) im Ziel-Server nach – gedacht für den Bot der neuen
 * Familie. Läuft im Hintergrund; den Stand liefert copyJob(). onDone(job) z. B. fürs Protokoll.
 */
export function applyBlueprint({ blueprint, targetGuild, onDone = () => {} }) {
  if (blueprint?.format !== "nexus-blueprint-v1" || !Array.isArray(blueprint.roles) || !Array.isArray(blueprint.channels)) throw new Error("Das ist keine gültige Aufbau-Datei.");
  const running = jobs.get(targetGuild.id);
  if (running?.status === "running") throw new Error("Für diesen Server läuft bereits eine Kopie.");
  const job = { status: "running", step: "Aufbau auslesen …", done: 0, total: 0, created: { roles: 0, categories: 0, channels: 0 }, skipped: 0, errors: [], startedAt: new Date().toISOString() };
  jobs.set(targetGuild.id, job);
  void (async () => {
    try {
      const bp = blueprint;
      job.total = bp.roles.length + bp.categories.length + bp.channels.length + 1;
      const me = targetGuild.members.me ?? await targetGuild.members.fetchMe();
      if (!me.permissions.has(PermissionFlagsBits.Administrator)) throw new Error("Der Bot braucht auf dem neuen Server Administrator-Rechte (Einladungslink von der Website nutzen).");
      const fail = (what, error) => { if (job.errors.length < 30) job.errors.push(`${what}: ${error.message}`); };

      // Rollen: höchste zuerst anlegen – jede neue Rolle landet ganz unten, so entsteht die richtige Reihenfolge.
      job.step = "Rollen anlegen …";
      const targetRoles = await targetGuild.roles.fetch();
      const roleIds = new Map([["@everyone", targetGuild.id]]);
      for (const r of bp.roles) {
        const existing = [...targetRoles.values()].find(x => x.name === r.name && !x.managed);
        if (existing) { roleIds.set(r.name, existing.id); job.skipped++; job.done++; continue; }
        try {
          const role = await targetGuild.roles.create({ name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: BigInt(r.permissions), reason: `Kopie von ${bp.source}` });
          roleIds.set(r.name, role.id); job.created.roles++;
        } catch (error) { fail(`Rolle ${r.name}`, error); }
        job.done++;
      }
      if (bp.everyone) await targetGuild.roles.everyone.setPermissions(BigInt(bp.everyone), `Kopie von ${bp.source}`).catch(error => fail("@everyone", error));
      job.done++;

      const overwritesFor = item => item.overwrites.filter(o => roleIds.has(o.role)).map(o => ({ id: roleIds.get(o.role), type: 0, allow: BigInt(o.allow), deny: BigInt(o.deny) }));
      const existingChannels = [...(await targetGuild.channels.fetch()).values()].filter(Boolean);
      const categoryIds = new Map();
      job.step = "Kategorien anlegen …";
      for (const c of bp.categories) {
        const existing = existingChannels.find(x => x.type === ChannelType.GuildCategory && x.name === c.name);
        if (existing) { categoryIds.set(c.name, existing.id); job.skipped++; job.done++; continue; }
        try {
          const cat = await targetGuild.channels.create({ name: c.name, type: ChannelType.GuildCategory, permissionOverwrites: overwritesFor(c), reason: `Kopie von ${bp.source}` });
          categoryIds.set(c.name, cat.id); job.created.categories++;
        } catch (error) { fail(`Kategorie ${c.name}`, error); }
        job.done++;
      }

      job.step = "Channels anlegen …";
      for (const c of bp.channels) {
        const parent = c.parent ? categoryIds.get(c.parent) ?? null : null;
        if (existingChannels.some(x => x.name === c.name && x.type === c.type && (x.parentId ?? null) === parent)) { job.skipped++; job.done++; continue; }
        const options = { name: c.name, type: c.type, parent, permissionOverwrites: overwritesFor(c), reason: `Kopie von ${bp.source}` };
        if (c.topic) options.topic = c.topic;
        if (c.nsfw) options.nsfw = true;
        if (c.rateLimitPerUser) options.rateLimitPerUser = c.rateLimitPerUser;
        if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(c.type)) { if (c.bitrate) options.bitrate = Math.min(c.bitrate, 96000); if (c.userLimit) options.userLimit = Math.min(c.userLimit, 99); }
        if (c.type === ChannelType.GuildForum && c.tags?.length) options.availableTags = c.tags.slice(0, 20).map(t => ({ name: t.name, moderated: Boolean(t.moderated), emoji: t.emoji?.name ? { name: t.emoji.name } : null }));
        // Ankündigungs- und Forum-Channels gibt es nur auf Community-Servern – dann als normaler Text-Channel.
        try { await targetGuild.channels.create(options); job.created.channels++; }
        catch (error) {
          if ([ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildStageVoice].includes(c.type)) {
            try { await targetGuild.channels.create({ ...options, type: c.type === ChannelType.GuildStageVoice ? ChannelType.GuildVoice : ChannelType.GuildText, availableTags: undefined }); job.created.channels++; }
            catch (second) { fail(`Channel ${c.name}`, second); }
          } else fail(`Channel ${c.name}`, error);
        }
        job.done++;
      }
      job.status = "done"; job.step = "Fertig";
      onDone(job);
    } catch (error) {
      job.status = "failed"; job.step = error.message;
    }
    job.finishedAt = new Date().toISOString();
  })();
  return job;
}

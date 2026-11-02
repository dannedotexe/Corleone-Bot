import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export function openDatabase(filename) {
  const resolved = path.resolve(filename);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  initializeSchema(db);
  return db;
}

// Vollständiges Yamamoto-Basisschema (frische Installation). Buchungs-, Sanktions- und Audit-Tabellen sind per
// Trigger unveränderlich (nur anhängen).
const BASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS guild_settings (guild_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(guild_id,key));
  CREATE TABLE IF NOT EXISTS accounts (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, balance_cents INTEGER NOT NULL DEFAULT 0 CHECK(balance_cents >= 0), updated_at TEXT NOT NULL, PRIMARY KEY(guild_id,user_id));
  CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, actor_id TEXT NOT NULL, type TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0), gross_cents INTEGER, deduction_cents INTEGER, net_cents INTEGER, reason TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sanctions (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, actor_id TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), remaining_cents INTEGER NOT NULL CHECK(remaining_cents >= 0), reason TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','partial','paid','void')), case_ref TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS payout_allocations (id TEXT PRIMARY KEY, payout_id TEXT NOT NULL REFERENCES transactions(id), sanction_id TEXT NOT NULL REFERENCES sanctions(id), amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), created_at TEXT NOT NULL, UNIQUE(payout_id,sanction_id));
  CREATE TABLE IF NOT EXISTS sanction_refunds (id TEXT PRIMARY KEY, sanction_id TEXT NOT NULL REFERENCES sanctions(id), transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id), amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), reason TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT UNIQUE, user_id TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','closed')), claimed_by TEXT, message_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT, claimed_at TEXT, closed_by TEXT);
  CREATE TABLE IF NOT EXISTS ticket_transcripts (ticket_id TEXT PRIMARY KEY REFERENCES tickets(id), messages TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit_log_deliveries (audit_id TEXT PRIMARY KEY REFERENCES audit_logs(id), attempted_at TEXT NOT NULL, result TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT, message_id TEXT, name TEXT NOT NULL, description TEXT NOT NULL, starts_at TEXT NOT NULL, location TEXT NOT NULL, host_id TEXT NOT NULL, equipment TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', max_participants INTEGER, status TEXT NOT NULL CHECK(status IN ('scheduled','cancelled','ended')), created_at TEXT NOT NULL, series_id TEXT, attendance_closed_at TEXT, attendance_closed_by TEXT, attendance_channel_id TEXT, attendance_message_id TEXT, reminder_channel_id TEXT, reminder_message_id TEXT, outcome TEXT, outcome_cents INTEGER, outcome_by TEXT, outcome_at TEXT, announce_channel_id TEXT, announce_message_id TEXT, min_participants INTEGER, min_checked_at TEXT, signup_closed_at TEXT, log_reminder_at TEXT, start_ping_at TEXT);
  CREATE TABLE IF NOT EXISTS event_participants (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'signed_up' CHECK(status IN ('signed_up','present','absent','left')), updated_at TEXT NOT NULL, PRIMARY KEY(event_id,user_id));
  CREATE TABLE IF NOT EXISTS event_reminders (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, minutes_before INTEGER NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY(event_id,minutes_before));
  CREATE TABLE IF NOT EXISTS applications (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, answers TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','review','accepted','rejected','withdrawn')), reviewer_id TEXT, review_note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, message_id TEXT);
  CREATE TABLE IF NOT EXISTS giveaways (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT, message_id TEXT, prize TEXT NOT NULL, ends_at TEXT NOT NULL, winner_count INTEGER NOT NULL, conditions TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','ended','cancelled')), winners TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, ended_at TEXT, required_role_id TEXT);
  CREATE TABLE IF NOT EXISTS giveaway_entries (giveaway_id TEXT NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE, user_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(giveaway_id,user_id));
  CREATE TABLE IF NOT EXISTS giveaway_announcements (giveaway_id TEXT PRIMARY KEY REFERENCES giveaways(id), sent_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS automod_actions (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, rule TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}');
  CREATE TABLE IF NOT EXISTS sanction_changes (id TEXT PRIMARY KEY, sanction_id TEXT NOT NULL REFERENCES sanctions(id), guild_id TEXT NOT NULL, actor_id TEXT NOT NULL, change_type TEXT NOT NULL CHECK(change_type IN ('created','corrected','voided','refunded','allocated')), old_amount_cents INTEGER, new_amount_cents INTEGER, old_remaining_cents INTEGER, new_remaining_cents INTEGER, reference_id TEXT, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS member_warnings (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, actor_id TEXT NOT NULL, reason TEXT NOT NULL, case_ref TEXT, created_at TEXT NOT NULL, revoked_at TEXT, revoked_by TEXT, revoke_reason TEXT);
  CREATE TABLE IF NOT EXISTS application_notes (id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications(id), guild_id TEXT NOT NULL, author_id TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS application_role_grants (application_id TEXT PRIMARY KEY REFERENCES applications(id), guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL, actor_id TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS member_stats_daily (guild_id TEXT NOT NULL, day TEXT NOT NULL, joins INTEGER NOT NULL DEFAULT 0, leaves INTEGER NOT NULL DEFAULT 0, member_count INTEGER, PRIMARY KEY(guild_id,day));
  CREATE TABLE IF NOT EXISTS event_series (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('scheduled','flexible')), weekdays TEXT NOT NULL DEFAULT '', times TEXT NOT NULL DEFAULT '', availability TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', lead_minutes INTEGER NOT NULL DEFAULT 120 CHECK(lead_minutes BETWEEN 5 AND 1440), max_participants INTEGER, active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)), sort_order INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, min_participants INTEGER, UNIQUE(guild_id,name));
  CREATE TABLE IF NOT EXISTS member_verifications (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, ingame_id TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, nickname TEXT NOT NULL, verified_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(guild_id,user_id));
  CREATE TABLE IF NOT EXISTS member_absences (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, starts_on TEXT NOT NULL, ends_on TEXT NOT NULL, reason TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, ended_at TEXT, ended_by TEXT, role_applied INTEGER NOT NULL DEFAULT 0 CHECK(role_applied IN (0,1)), channel_id TEXT, message_id TEXT, CHECK(ends_on>=starts_on));
  CREATE TABLE IF NOT EXISTS member_activity (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, last_message_at TEXT, messages INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(guild_id,user_id));
  CREATE TABLE IF NOT EXISTS inactivity_notices (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, notified_at TEXT NOT NULL, PRIMARY KEY(guild_id,user_id));
  CREATE TABLE IF NOT EXISTS moderation_actions (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('timeout','untimeout','kick','ban','unban')), reason TEXT NOT NULL, duration_minutes INTEGER, result TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', embed TEXT NOT NULL DEFAULT '{}', ping_role_ids TEXT NOT NULL DEFAULT '', ping_everyone INTEGER NOT NULL DEFAULT 0, scheduled_at TEXT, status TEXT NOT NULL CHECK(status IN ('scheduled','sending','sent','failed','cancelled')), message_id TEXT, error TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, sent_at TEXT);
  CREATE TABLE IF NOT EXISTS rank_changes (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, actor_id TEXT, from_label TEXT, to_label TEXT, kind TEXT NOT NULL CHECK(kind IN ('promotion','demotion','change')), reason TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS polls (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT, question TEXT NOT NULL, options TEXT NOT NULL, anonymous INTEGER NOT NULL DEFAULT 0 CHECK(anonymous IN (0,1)), hide_results INTEGER NOT NULL DEFAULT 0 CHECK(hide_results IN (0,1)), required_role_id TEXT, ends_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','closed','cancelled')), created_by TEXT NOT NULL, created_at TEXT NOT NULL, closed_at TEXT, closed_by TEXT, multi INTEGER NOT NULL DEFAULT 0, remind_missing INTEGER NOT NULL DEFAULT 0, reminded_at TEXT);
  CREATE TABLE IF NOT EXISTS reminder_prefs (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, dm INTEGER NOT NULL DEFAULT 0 CHECK(dm IN (0,1)), updated_at TEXT NOT NULL, PRIMARY KEY(guild_id,user_id));
  CREATE TABLE IF NOT EXISTS noshow_notices (event_id TEXT NOT NULL, user_id TEXT NOT NULL, guild_id TEXT NOT NULL, count INTEGER NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(event_id,user_id));
  CREATE TABLE IF NOT EXISTS account_closures (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL CHECK(reason IN ('role_removed','left')), status TEXT NOT NULL CHECK(status IN ('pending','confirmed','dismissed')), created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, note TEXT);
  CREATE TABLE IF NOT EXISTS access_log (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT, ip TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('visit','login','login_denied')), user_agent TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS role_snapshots (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('auto','manual','before_restore')), actor_id TEXT, member_count INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS noshow_excuses (event_id TEXT NOT NULL, user_id TEXT NOT NULL, guild_id TEXT NOT NULL, actor_id TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, PRIMARY KEY(event_id,user_id));
  CREATE TABLE IF NOT EXISTS event_kills (event_id TEXT NOT NULL, user_id TEXT NOT NULL, kills INTEGER NOT NULL CHECK(kills >= 0 AND kills <= 999), updated_at TEXT NOT NULL, PRIMARY KEY(event_id,user_id));
  CREATE TABLE IF NOT EXISTS task_types (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, name TEXT NOT NULL, emoji TEXT NOT NULL DEFAULT '📋', reward_cents INTEGER NOT NULL DEFAULT 0 CHECK(reward_cents >= 0), per_unit INTEGER NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT 'Stück', daily_limit INTEGER, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, invite_min_days INTEGER, invite_min_events INTEGER);
  CREATE TABLE IF NOT EXISTS task_logs (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, type_id TEXT NOT NULL REFERENCES task_types(id), quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity >= 1 AND quantity <= 999), reward_cents INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', proof_url TEXT, proof_key TEXT, duplicate_of TEXT, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')), reviewer_id TEXT, reviewed_at TEXT, reject_reason TEXT, transaction_id TEXT, channel_id TEXT, message_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, source_channel_id TEXT, source_message_id TEXT, prompt_message_id TEXT, source_index INTEGER, invitee_id TEXT, preapproved_by TEXT, preapproved_at TEXT, progress TEXT);
  CREATE TABLE IF NOT EXISTS logbooks (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, thread_id TEXT, title TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'created', created_at TEXT NOT NULL, archived_at TEXT, reminded_at TEXT, PRIMARY KEY(guild_id,user_id));
  CREATE TABLE IF NOT EXISTS event_logbooks (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, thread_id TEXT, title TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'created', created_at TEXT NOT NULL, archived_at TEXT, reminded_at TEXT, PRIMARY KEY(guild_id,user_id));
  CREATE TABLE IF NOT EXISTS event_waitlist (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id TEXT NOT NULL, created_at TEXT NOT NULL, priority INTEGER, PRIMARY KEY(event_id,user_id));
  CREATE TABLE IF NOT EXISTS event_proofs (message_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, event_id TEXT REFERENCES events(id) ON DELETE SET NULL, user_id TEXT NOT NULL, channel_id TEXT NOT NULL, images INTEGER NOT NULL DEFAULT 1, prompt_message_id TEXT, assigned_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, kills INTEGER);
  CREATE TABLE IF NOT EXISTS short_absences (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, ended_at TEXT, channel_id TEXT, message_id TEXT);
  CREATE TABLE IF NOT EXISTS event_signup_pings (event_id TEXT NOT NULL, user_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(event_id,user_id));
  CREATE TABLE IF NOT EXISTS suggestions (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', note TEXT, decided_by TEXT, decided_at TEXT, channel_id TEXT, message_id TEXT, created_at TEXT NOT NULL, number INTEGER, avatar_url TEXT, image_name TEXT);
  CREATE TABLE IF NOT EXISTS suggestion_votes (suggestion_id TEXT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE, user_id TEXT NOT NULL, vote INTEGER NOT NULL CHECK(vote IN (-1,1)), voted_at TEXT NOT NULL, PRIMARY KEY(suggestion_id,user_id));
  CREATE TABLE IF NOT EXISTS "poll_votes" (poll_id TEXT NOT NULL REFERENCES polls(id), user_id TEXT NOT NULL, option_index INTEGER NOT NULL, voted_at TEXT NOT NULL, PRIMARY KEY(poll_id,user_id,option_index));
  CREATE TABLE IF NOT EXISTS verify_reminders (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, last_at TEXT, failed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(guild_id,user_id));
  CREATE TABLE IF NOT EXISTS auto_roles (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL, granted_at TEXT NOT NULL, PRIMARY KEY(guild_id,user_id,role_id));
  CREATE TABLE IF NOT EXISTS ticket_members (ticket_id TEXT NOT NULL, user_id TEXT NOT NULL, added_by TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY(ticket_id,user_id));
  CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, prefs TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, fail_count INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS push_sent (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS info_cards (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT NOT NULL, embed TEXT NOT NULL, source_message_id TEXT, created_by TEXT, updated_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS transactions_user_time ON transactions(guild_id,user_id,created_at DESC);
  CREATE INDEX IF NOT EXISTS sanctions_open ON sanctions(guild_id,user_id,status);
  CREATE INDEX IF NOT EXISTS audit_time ON audit_logs(guild_id,created_at DESC);
  CREATE INDEX IF NOT EXISTS tickets_user_open ON tickets(guild_id,user_id,status);
  CREATE INDEX IF NOT EXISTS applications_user_open ON applications(guild_id,user_id,status);
  CREATE INDEX IF NOT EXISTS sanction_changes_sanction ON sanction_changes(sanction_id,created_at);
  CREATE INDEX IF NOT EXISTS member_warnings_user ON member_warnings(guild_id,user_id,created_at);
  CREATE INDEX IF NOT EXISTS application_notes_app ON application_notes(application_id,created_at);
  CREATE INDEX IF NOT EXISTS audit_action_time ON audit_logs(guild_id,action,created_at);
  CREATE INDEX IF NOT EXISTS audit_actor_time ON audit_logs(guild_id,actor_id,created_at);
  CREATE INDEX IF NOT EXISTS transactions_type_time ON transactions(guild_id,type,created_at);
  CREATE INDEX IF NOT EXISTS payout_allocations_sanction ON payout_allocations(sanction_id);
  CREATE INDEX IF NOT EXISTS sanction_refunds_sanction ON sanction_refunds(sanction_id);
  CREATE INDEX IF NOT EXISTS automod_time ON automod_actions(guild_id,created_at);
  CREATE INDEX IF NOT EXISTS events_guild_status ON events(guild_id,status,starts_at);
  CREATE INDEX IF NOT EXISTS giveaways_status_end ON giveaways(status,ends_at);
  CREATE UNIQUE INDEX IF NOT EXISTS events_series_occurrence ON events(series_id,starts_at) WHERE series_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS member_verifications_ingame ON member_verifications(guild_id,ingame_id);
  CREATE INDEX IF NOT EXISTS member_absences_user ON member_absences(guild_id,user_id,ends_on);
  CREATE INDEX IF NOT EXISTS member_absences_period ON member_absences(guild_id,starts_on,ends_on);
  CREATE INDEX IF NOT EXISTS moderation_actions_user ON moderation_actions(guild_id,user_id,created_at);
  CREATE INDEX IF NOT EXISTS announcements_due ON announcements(status,scheduled_at);
  CREATE INDEX IF NOT EXISTS rank_changes_user ON rank_changes(guild_id,user_id,created_at);
  CREATE INDEX IF NOT EXISTS polls_status_end ON polls(status,ends_at);
  CREATE UNIQUE INDEX IF NOT EXISTS account_closures_pending ON account_closures(guild_id,user_id) WHERE status='pending';
  CREATE INDEX IF NOT EXISTS access_log_time ON access_log(guild_id,created_at);
  CREATE INDEX IF NOT EXISTS access_log_ip ON access_log(guild_id,ip);
  CREATE INDEX IF NOT EXISTS role_snapshots_time ON role_snapshots(guild_id,created_at);
  CREATE INDEX IF NOT EXISTS task_logs_guild_status ON task_logs(guild_id,status,created_at);
  CREATE INDEX IF NOT EXISTS task_logs_user ON task_logs(guild_id,user_id,created_at);
  CREATE INDEX IF NOT EXISTS event_proofs_event ON event_proofs(event_id,user_id);
  CREATE INDEX IF NOT EXISTS short_absences_user ON short_absences(guild_id,user_id,ends_at);
  CREATE INDEX IF NOT EXISTS suggestions_guild ON suggestions(guild_id,status,created_at);
  CREATE INDEX IF NOT EXISTS poll_votes_user ON poll_votes(poll_id,user_id);
  CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions(guild_id,user_id);
  CREATE INDEX IF NOT EXISTS info_cards_guild ON info_cards(guild_id);
  CREATE TRIGGER IF NOT EXISTS transactions_no_update BEFORE UPDATE ON transactions BEGIN SELECT RAISE(ABORT,'Transaktionen sind unveränderlich'); END;
  CREATE TRIGGER IF NOT EXISTS transactions_no_delete BEFORE DELETE ON transactions BEGIN SELECT RAISE(ABORT,'Transaktionen dürfen nicht gelöscht werden'); END;
  CREATE TRIGGER IF NOT EXISTS payout_allocations_no_update BEFORE UPDATE ON payout_allocations BEGIN SELECT RAISE(ABORT,'Sanktionsverrechnungen sind unveränderlich'); END;
  CREATE TRIGGER IF NOT EXISTS payout_allocations_no_delete BEFORE DELETE ON payout_allocations BEGIN SELECT RAISE(ABORT,'Sanktionsverrechnungen dürfen nicht gelöscht werden'); END;
  CREATE TRIGGER IF NOT EXISTS sanction_refunds_no_update BEFORE UPDATE ON sanction_refunds BEGIN SELECT RAISE(ABORT,'Sanktionserstattungen sind unveränderlich'); END;
  CREATE TRIGGER IF NOT EXISTS sanction_refunds_no_delete BEFORE DELETE ON sanction_refunds BEGIN SELECT RAISE(ABORT,'Sanktionserstattungen dürfen nicht gelöscht werden'); END;
  CREATE TRIGGER IF NOT EXISTS sanction_changes_no_update BEFORE UPDATE ON sanction_changes BEGIN SELECT RAISE(ABORT,'Sanktionsänderungen sind unveränderlich'); END;
  CREATE TRIGGER IF NOT EXISTS sanction_changes_no_delete BEFORE DELETE ON sanction_changes BEGIN SELECT RAISE(ABORT,'Sanktionsänderungen dürfen nicht gelöscht werden'); END;
  CREATE TRIGGER IF NOT EXISTS audit_logs_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT,'Audit-Logs sind unveränderlich'); END;
  CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT,'Audit-Logs dürfen nicht gelöscht werden'); END;
  CREATE TRIGGER IF NOT EXISTS moderation_actions_no_update BEFORE UPDATE ON moderation_actions BEGIN SELECT RAISE(ABORT,'Moderationsmaßnahmen sind unveränderlich'); END;
  CREATE TRIGGER IF NOT EXISTS moderation_actions_no_delete BEFORE DELETE ON moderation_actions BEGIN SELECT RAISE(ABORT,'Moderationsmaßnahmen dürfen nicht gelöscht werden'); END;
  CREATE TRIGGER IF NOT EXISTS rank_changes_no_update BEFORE UPDATE ON rank_changes BEGIN SELECT RAISE(ABORT,'Rangänderungen sind unveränderlich'); END;
  CREATE TRIGGER IF NOT EXISTS rank_changes_no_delete BEFORE DELETE ON rank_changes BEGIN SELECT RAISE(ABORT,'Rangänderungen dürfen nicht gelöscht werden'); END;`;

/**
 * Versionierte Migrationen. Jede Migration ist idempotent (IF NOT EXISTS), läuft genau einmal in einer
 * Transaktion und wird in schema_migrations mit Name und Zeitpunkt festgehalten. Neue Änderungen
 * immer als neue Version anhängen, niemals bestehende Versionen umschreiben.
 */
export const MIGRATIONS = [
  { version: 1, name: "basisschema", up: db => db.exec(BASE_SCHEMA) },
];

export function initializeSchema(db) {
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, name TEXT)");
  for (const migration of MIGRATIONS) {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=?").get(migration.version)) continue;
    const apply = db.transaction(() => {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations(version,applied_at,name) VALUES(?,?,?)").run(migration.version, new Date().toISOString(), migration.name);
    });
    try { apply(); }
    catch (error) { throw new Error(`Datenbank-Migration ${migration.version} (${migration.name}) fehlgeschlagen: ${error.message}`); }
  }
}

export function audit(db, guildId, actorId, action, targetId = null, details = {}) {
  const id = randomUUID();
  db.prepare("INSERT INTO audit_logs(id,guild_id,actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(id, guildId, actorId, action, targetId, JSON.stringify(details), new Date().toISOString());
  return id;
}

export function getSetting(db, guildId, key) {
  return db.prepare("SELECT value FROM guild_settings WHERE guild_id=? AND key=?").get(guildId, key)?.value ?? null;
}

export function setSetting(db, guildId, key, value) {
  db.prepare("INSERT INTO guild_settings(guild_id,key,value,updated_at) VALUES(?,?,?,?) ON CONFLICT(guild_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
    .run(guildId, key, value, new Date().toISOString());
}

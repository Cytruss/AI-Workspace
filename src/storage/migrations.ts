import type { SqliteDatabase } from "./database.js";

const INITIAL_SCHEMA = `
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, root TEXT NOT NULL UNIQUE);
CREATE TABLE active_projects (guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, user_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, PRIMARY KEY (guild_id, channel_id, user_id));
CREATE TABLE sessions (id TEXT PRIMARY KEY, interaction_id TEXT NOT NULL UNIQUE, command TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id), guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, user_id TEXT NOT NULL, question TEXT NOT NULL, debate_config_json TEXT, status TEXT NOT NULL CHECK (status IN ('queued','running','completed','partial','failed','cancelled')), created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, CHECK ((status='queued' AND started_at IS NULL AND finished_at IS NULL) OR (status='running' AND started_at IS NOT NULL AND finished_at IS NULL) OR (status IN ('completed','partial') AND started_at IS NOT NULL AND finished_at IS NOT NULL) OR (status IN ('failed','cancelled') AND finished_at IS NOT NULL)));
CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK (role IN ('user','assistant','system','agent')), agent_id TEXT, content TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE claim_boards (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, version INTEGER NOT NULL CHECK (version > 0), payload_json TEXT NOT NULL, content_hash TEXT NOT NULL, byte_length INTEGER NOT NULL CHECK (byte_length >= 0), created_at TEXT NOT NULL, UNIQUE (session_id, version), UNIQUE (id, session_id));
CREATE TABLE debate_rounds (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, round_number INTEGER NOT NULL CHECK (round_number > 0), phase TEXT NOT NULL CHECK (phase IN ('initial','cross_examination','final')), status TEXT NOT NULL CHECK (status IN ('running','completed','partial','failed','cancelled')), input_board_id TEXT, output_board_id TEXT, created_at TEXT NOT NULL, finished_at TEXT, UNIQUE (session_id, round_number, phase), UNIQUE (id, session_id), UNIQUE (id, session_id, phase, input_board_id), CHECK ((status='running' AND output_board_id IS NULL AND finished_at IS NULL) OR (status<>'running' AND finished_at IS NOT NULL)), FOREIGN KEY (input_board_id, session_id) REFERENCES claim_boards(id, session_id), FOREIGN KEY (output_board_id, session_id) REFERENCES claim_boards(id, session_id));
CREATE TABLE agent_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, agent_id TEXT NOT NULL, requested_model_class TEXT, requested_model_id TEXT, requested_effort TEXT, observed_model_ids_json TEXT NOT NULL, model_verification TEXT NOT NULL, round_id TEXT, phase TEXT NOT NULL CHECK (phase IN ('ask','initial','cross_examination','final')), purpose TEXT NOT NULL, input_board_id TEXT, output_board_id TEXT, request_json TEXT NOT NULL, response_json TEXT, status TEXT NOT NULL CHECK (status IN ('running','completed','failed','cancelled')), exit_code INTEGER, duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0), diagnostics_json TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT, UNIQUE (id, session_id), CHECK ((requested_model_class IS NULL AND requested_model_id IS NULL AND requested_effort IS NULL) OR (requested_model_class IS NOT NULL AND requested_model_id IS NOT NULL)), CHECK (model_verification IN ('verified', 'unverified')), CHECK ((phase='ask' AND round_id IS NULL AND input_board_id IS NULL AND output_board_id IS NULL) OR (phase IN ('initial','cross_examination','final') AND round_id IS NOT NULL)), CHECK ((status='running' AND response_json IS NULL AND output_board_id IS NULL AND finished_at IS NULL) OR (status='completed' AND response_json IS NOT NULL AND finished_at IS NOT NULL) OR (status IN ('failed','cancelled') AND finished_at IS NOT NULL)), FOREIGN KEY (round_id, session_id, phase, input_board_id) REFERENCES debate_rounds(id, session_id, phase, input_board_id), FOREIGN KEY (input_board_id, session_id) REFERENCES claim_boards(id, session_id), FOREIGN KEY (output_board_id, session_id) REFERENCES claim_boards(id, session_id));
CREATE TABLE claims (board_id TEXT NOT NULL REFERENCES claim_boards(id) ON DELETE CASCADE, canonical_id TEXT NOT NULL, normalized_text TEXT NOT NULL, material INTEGER NOT NULL CHECK (material IN (0,1)), created_at TEXT NOT NULL, PRIMARY KEY (board_id, canonical_id));
CREATE TABLE claim_origins (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, canonical_claim_id TEXT NOT NULL, agent_id TEXT NOT NULL, agent_run_id TEXT NOT NULL REFERENCES agent_runs(id), provider_local_id TEXT NOT NULL, FOREIGN KEY (board_id, canonical_claim_id) REFERENCES claims(board_id, canonical_id) ON DELETE CASCADE, UNIQUE (agent_run_id, provider_local_id));
CREATE TABLE evidence_references (board_id TEXT NOT NULL, session_id TEXT NOT NULL, canonical_id TEXT NOT NULL, tracked_path TEXT NOT NULL, line_start INTEGER, line_end INTEGER, content_hash TEXT, resolution TEXT NOT NULL CHECK (resolution IN ('VERIFIED','INVALID','MISSING')), resolved_hash TEXT, PRIMARY KEY (board_id, canonical_id), UNIQUE (board_id, canonical_id, session_id), FOREIGN KEY (board_id) REFERENCES claim_boards(id) ON DELETE CASCADE, FOREIGN KEY (board_id, session_id) REFERENCES claim_boards(id, session_id));
CREATE TABLE evidence_origins (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, session_id TEXT NOT NULL, canonical_evidence_id TEXT NOT NULL, agent_id TEXT NOT NULL, agent_run_id TEXT NOT NULL, provider_local_id TEXT NOT NULL, FOREIGN KEY (board_id, canonical_evidence_id, session_id) REFERENCES evidence_references(board_id, canonical_id, session_id) ON DELETE CASCADE, FOREIGN KEY (agent_run_id, session_id) REFERENCES agent_runs(id, session_id), UNIQUE (agent_run_id, provider_local_id));
CREATE TABLE claim_evidence (board_id TEXT NOT NULL, canonical_claim_id TEXT NOT NULL, canonical_evidence_id TEXT NOT NULL, FOREIGN KEY (board_id, canonical_claim_id) REFERENCES claims(board_id, canonical_id) ON DELETE CASCADE, FOREIGN KEY (board_id, canonical_evidence_id) REFERENCES evidence_references(board_id, canonical_id) ON DELETE CASCADE, PRIMARY KEY (board_id, canonical_claim_id, canonical_evidence_id));
CREATE TABLE stances (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, canonical_claim_id TEXT NOT NULL, round_id TEXT NOT NULL REFERENCES debate_rounds(id), agent_run_id TEXT NOT NULL REFERENCES agent_runs(id), agent_id TEXT NOT NULL, stance TEXT NOT NULL CHECK (stance IN ('ACCEPT','DISPUTE','UNCERTAIN')), reasoning TEXT NOT NULL, FOREIGN KEY (board_id, canonical_claim_id) REFERENCES claims(board_id, canonical_id) ON DELETE CASCADE, UNIQUE (canonical_claim_id, round_id, agent_id), UNIQUE (id, board_id));
CREATE TABLE stance_evidence (stance_id TEXT NOT NULL, board_id TEXT NOT NULL, canonical_evidence_id TEXT NOT NULL, FOREIGN KEY (stance_id, board_id) REFERENCES stances(id, board_id) ON DELETE CASCADE, FOREIGN KEY (board_id, canonical_evidence_id) REFERENCES evidence_references(board_id, canonical_id) ON DELETE CASCADE, PRIMARY KEY (stance_id, canonical_evidence_id));
CREATE TABLE final_positions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, board_id TEXT NOT NULL, round_id TEXT NOT NULL, agent_run_id TEXT NOT NULL UNIQUE, agent_id TEXT NOT NULL, position_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (session_id, agent_id), FOREIGN KEY (board_id, session_id) REFERENCES claim_boards(id, session_id), FOREIGN KEY (round_id, session_id) REFERENCES debate_rounds(id, session_id), FOREIGN KEY (agent_run_id, session_id) REFERENCES agent_runs(id, session_id));
CREATE TABLE final_stances (final_position_id TEXT NOT NULL REFERENCES final_positions(id) ON DELETE CASCADE, board_id TEXT NOT NULL, canonical_claim_id TEXT NOT NULL, stance TEXT NOT NULL CHECK (stance IN ('ACCEPT','DISPUTE','UNCERTAIN')), FOREIGN KEY (board_id, canonical_claim_id) REFERENCES claims(board_id, canonical_id), PRIMARY KEY (final_position_id, canonical_claim_id));
CREATE TABLE verdicts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, board_id TEXT NOT NULL, canonical_claim_id TEXT NOT NULL, round_id TEXT, codex_run_id TEXT, claude_run_id TEXT, classification TEXT NOT NULL CHECK (classification IN ('CONSENSUS','DISAGREEMENT','REJECTED','UNRESOLVED')), evidence_support TEXT NOT NULL CHECK (evidence_support IN ('SUPPORTED','UNSUPPORTED')), verdict_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY (board_id, canonical_claim_id) REFERENCES claims(board_id, canonical_id), FOREIGN KEY (board_id, session_id) REFERENCES claim_boards(id, session_id), FOREIGN KEY (round_id, session_id) REFERENCES debate_rounds(id, session_id), FOREIGN KEY (codex_run_id, session_id) REFERENCES agent_runs(id, session_id), FOREIGN KEY (claude_run_id, session_id) REFERENCES agent_runs(id, session_id), UNIQUE (session_id, canonical_claim_id));
CREATE TABLE errors (id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE, code TEXT NOT NULL, message TEXT NOT NULL, context_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TRIGGER agent_runs_round_tuple_insert BEFORE INSERT ON agent_runs WHEN NEW.round_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM debate_rounds d WHERE d.id=NEW.round_id AND d.session_id=NEW.session_id AND d.phase=NEW.phase AND d.input_board_id IS NEW.input_board_id) BEGIN SELECT RAISE(ABORT, 'agent run round tuple mismatch'); END;
CREATE TRIGGER agent_runs_round_tuple_update BEFORE UPDATE OF round_id,session_id,phase,input_board_id ON agent_runs WHEN NEW.round_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM debate_rounds d WHERE d.id=NEW.round_id AND d.session_id=NEW.session_id AND d.phase=NEW.phase AND d.input_board_id IS NEW.input_board_id) BEGIN SELECT RAISE(ABORT, 'agent run round tuple mismatch'); END;
CREATE TRIGGER agent_runs_round_output_insert BEFORE INSERT ON agent_runs WHEN NEW.round_id IS NOT NULL AND NEW.output_board_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM debate_rounds d WHERE d.id=NEW.round_id AND d.session_id=NEW.session_id AND d.output_board_id IS NEW.output_board_id) BEGIN SELECT RAISE(ABORT, 'agent run round output mismatch'); END;
CREATE TRIGGER agent_runs_round_output_update BEFORE UPDATE OF round_id,session_id,output_board_id ON agent_runs WHEN NEW.round_id IS NOT NULL AND NEW.output_board_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM debate_rounds d WHERE d.id=NEW.round_id AND d.session_id=NEW.session_id AND d.output_board_id IS NEW.output_board_id) BEGIN SELECT RAISE(ABORT, 'agent run round output mismatch'); END;
CREATE TRIGGER debate_rounds_run_tuple_update BEFORE UPDATE OF session_id,phase,input_board_id ON debate_rounds WHEN EXISTS (SELECT 1 FROM agent_runs r WHERE r.round_id=OLD.id AND (r.session_id<>NEW.session_id OR r.phase<>NEW.phase OR r.input_board_id IS NOT NEW.input_board_id)) BEGIN SELECT RAISE(ABORT, 'debate round run tuple mismatch'); END;
CREATE TRIGGER debate_rounds_run_output_update BEFORE UPDATE OF output_board_id ON debate_rounds WHEN NEW.output_board_id IS NOT NULL AND EXISTS (SELECT 1 FROM agent_runs r WHERE r.round_id=OLD.id AND r.output_board_id IS NOT NULL AND r.output_board_id IS NOT NEW.output_board_id) BEGIN SELECT RAISE(ABORT, 'debate round run output mismatch'); END;
`;

const IMMUTABLE_LINK_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS agent_runs_phase_link_insert BEFORE INSERT ON agent_runs WHEN (NEW.phase='ask' AND (NEW.round_id IS NOT NULL OR NEW.input_board_id IS NOT NULL OR NEW.output_board_id IS NOT NULL)) OR (NEW.phase IN ('initial','cross_examination','final') AND NEW.round_id IS NULL) BEGIN SELECT RAISE(ABORT, 'agent run phase linkage mismatch'); END;
CREATE TRIGGER IF NOT EXISTS agent_runs_phase_link_update BEFORE UPDATE OF output_board_id ON agent_runs WHEN NEW.phase='ask' AND NEW.output_board_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'agent run phase linkage mismatch'); END;
CREATE TRIGGER IF NOT EXISTS agent_runs_identity_immutable BEFORE UPDATE OF session_id,agent_id,phase,purpose,round_id,input_board_id ON agent_runs WHEN NEW.session_id IS NOT OLD.session_id OR NEW.agent_id IS NOT OLD.agent_id OR NEW.phase IS NOT OLD.phase OR NEW.purpose IS NOT OLD.purpose OR NEW.round_id IS NOT OLD.round_id OR NEW.input_board_id IS NOT OLD.input_board_id BEGIN SELECT RAISE(ABORT, 'agent run identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS agent_runs_output_write_once BEFORE UPDATE OF output_board_id ON agent_runs WHEN OLD.output_board_id IS NOT NULL AND NEW.output_board_id IS NOT OLD.output_board_id BEGIN SELECT RAISE(ABORT, 'agent run output board is immutable'); END;
CREATE TRIGGER IF NOT EXISTS debate_rounds_output_write_once BEFORE UPDATE OF output_board_id ON debate_rounds WHEN OLD.output_board_id IS NOT NULL AND NEW.output_board_id IS NOT OLD.output_board_id BEGIN SELECT RAISE(ABORT, 'debate round output board is immutable'); END;
`;

const PROVIDER_IDENTITY_TRIGGER = `
DROP TRIGGER IF EXISTS agent_runs_identity_immutable;
CREATE TRIGGER agent_runs_identity_immutable BEFORE UPDATE OF session_id,agent_id,phase,purpose,round_id,input_board_id ON agent_runs WHEN NEW.session_id IS NOT OLD.session_id OR NEW.agent_id IS NOT OLD.agent_id OR NEW.phase IS NOT OLD.phase OR NEW.purpose IS NOT OLD.purpose OR NEW.round_id IS NOT OLD.round_id OR NEW.input_board_id IS NOT OLD.input_board_id BEGIN SELECT RAISE(ABORT, 'agent run identity is immutable'); END;
`;

const BOARD_SCOPED_ORIGINS = `
CREATE TABLE claim_origins_v4 (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, canonical_claim_id TEXT NOT NULL, agent_id TEXT NOT NULL, agent_run_id TEXT NOT NULL REFERENCES agent_runs(id), provider_local_id TEXT NOT NULL, FOREIGN KEY (board_id, canonical_claim_id) REFERENCES claims(board_id, canonical_id) ON DELETE CASCADE, UNIQUE (board_id, agent_run_id, provider_local_id));
INSERT INTO claim_origins_v4 SELECT id, board_id, canonical_claim_id, agent_id, agent_run_id, provider_local_id FROM claim_origins;
DROP TABLE claim_origins;
ALTER TABLE claim_origins_v4 RENAME TO claim_origins;
CREATE TABLE evidence_origins_v4 (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, session_id TEXT NOT NULL, canonical_evidence_id TEXT NOT NULL, agent_id TEXT NOT NULL, agent_run_id TEXT NOT NULL, provider_local_id TEXT NOT NULL, FOREIGN KEY (board_id, canonical_evidence_id, session_id) REFERENCES evidence_references(board_id, canonical_id, session_id) ON DELETE CASCADE, FOREIGN KEY (agent_run_id, session_id) REFERENCES agent_runs(id, session_id), UNIQUE (board_id, agent_run_id, provider_local_id));
INSERT INTO evidence_origins_v4 SELECT id, board_id, session_id, canonical_evidence_id, agent_id, agent_run_id, provider_local_id FROM evidence_origins;
DROP TABLE evidence_origins;
ALTER TABLE evidence_origins_v4 RENAME TO evidence_origins;
`;

export function migrateDatabase(database: SqliteDatabase): void {
  database.transaction(() => {
    database.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    const applied = database
      .prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
      .get(1);
    if (applied === undefined) {
      database.exec(
        INITIAL_SCHEMA.replace(
          "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
          "",
        ),
      );
      database
        .prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        )
        .run(1, new Date().toISOString());
    }
    const immutableLinksApplied = database
      .prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
      .get(2);
    if (immutableLinksApplied === undefined) {
      database.exec(IMMUTABLE_LINK_TRIGGERS);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        )
        .run(2, new Date().toISOString());
    }
    const providerIdentityApplied = database
      .prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
      .get(3);
    if (providerIdentityApplied === undefined) {
      database.exec(PROVIDER_IDENTITY_TRIGGER);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        )
        .run(3, new Date().toISOString());
    }
    const boardScopedOriginsApplied = database
      .prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
      .get(4);
    if (boardScopedOriginsApplied === undefined) {
      database.exec(BOARD_SCOPED_ORIGINS);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        )
        .run(4, new Date().toISOString());
    }
  })();
}

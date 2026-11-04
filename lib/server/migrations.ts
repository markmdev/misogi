// Schema migrations, applied in order at startup. Never edit a shipped migration;
// add a new entry instead.

export const migrations: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE users (
    id               TEXT PRIMARY KEY,
    handle           TEXT NOT NULL UNIQUE,
    display_name     TEXT NOT NULL,
    avatar           TEXT NOT NULL DEFAULT 'sky',
    motivation_style TEXT NOT NULL DEFAULT '',
    timezone         TEXT NOT NULL DEFAULT 'UTC',
    agent_name       TEXT,
    agent_kind       TEXT,
    agent_seen_at    TEXT,
    is_demo          INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL
  );

  CREATE TABLE api_keys (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash     TEXT NOT NULL UNIQUE,
    prefix       TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at   TEXT
  );
  CREATE INDEX api_keys_user ON api_keys(user_id);

  CREATE TABLE sign_in_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at    TEXT
  );

  CREATE TABLE challenges (
    id                 TEXT PRIMARY KEY,
    slug               TEXT NOT NULL UNIQUE,
    creator_id         TEXT REFERENCES users(id),
    title              TEXT NOT NULL,
    tagline            TEXT NOT NULL DEFAULT '',
    description_md     TEXT NOT NULL DEFAULT '',
    emoji              TEXT NOT NULL DEFAULT 'mountain',
    theme              TEXT NOT NULL DEFAULT 'teal',
    category           TEXT NOT NULL DEFAULT 'other',
    metric_name        TEXT NOT NULL,
    metric_unit        TEXT NOT NULL DEFAULT '',
    metric_target      REAL,
    metric_aggregation TEXT NOT NULL CHECK (metric_aggregation IN ('sum','count','days','latest','distinct')),
    metric_direction   TEXT NOT NULL DEFAULT 'up' CHECK (metric_direction IN ('up','down')),
    cover_path         TEXT,
    status             TEXT NOT NULL CHECK (status IN ('draft','active','completed','template')),
    template_year      INTEGER,
    template_label     TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
  );
  CREATE INDEX challenges_status ON challenges(status);

  CREATE TABLE memberships (
    challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK (role IN ('creator','member')),
    status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','left')),
    joined_at    TEXT NOT NULL,
    starts_on    TEXT NOT NULL,
    ends_on      TEXT NOT NULL,
    completed_at TEXT,
    review_md    TEXT,
    helpful      INTEGER,
    helpful_note TEXT,
    PRIMARY KEY (challenge_id, user_id)
  );
  CREATE INDEX memberships_user ON memberships(user_id);

  CREATE TABLE plans (
    id              TEXT PRIMARY KEY,
    challenge_id    TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version         INTEGER NOT NULL,
    summary_md      TEXT NOT NULL,
    cadence         TEXT NOT NULL DEFAULT '',
    milestones_json TEXT NOT NULL DEFAULT '[]',
    reason          TEXT NOT NULL DEFAULT '',
    author          TEXT NOT NULL DEFAULT 'agent',
    created_at      TEXT NOT NULL,
    UNIQUE (challenge_id, user_id, version)
  );

  CREATE TABLE quests (
    id           TEXT PRIMARY KEY,
    challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    detail       TEXT NOT NULL DEFAULT '',
    kind         TEXT NOT NULL DEFAULT 'weekly' CHECK (kind IN ('daily','weekly','boss','one_off')),
    xp           INTEGER NOT NULL DEFAULT 20,
    due_on       TEXT,
    status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','skipped')),
    created_at   TEXT NOT NULL,
    completed_at TEXT,
    log_id       TEXT
  );
  CREATE INDEX quests_member ON quests(challenge_id, user_id, status);

  CREATE TABLE logs (
    id           TEXT PRIMARY KEY,
    challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    logged_for   TEXT NOT NULL,
    value        REAL,
    label        TEXT,
    note         TEXT NOT NULL DEFAULT '',
    evidence_url TEXT,
    quest_id     TEXT,
    xp           INTEGER NOT NULL DEFAULT 0,
    source       TEXT NOT NULL DEFAULT 'api',
    created_at   TEXT NOT NULL,
    deleted_at   TEXT
  );
  CREATE INDEX logs_member ON logs(challenge_id, user_id, logged_for);

  CREATE TABLE cheers (
    log_id     TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (log_id, user_id)
  );

  CREATE TABLE activity (
    id           TEXT PRIMARY KEY,
    challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,
    data_json    TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL
  );
  CREATE INDEX activity_challenge ON activity(challenge_id, created_at);
  CREATE INDEX activity_created ON activity(created_at);

  CREATE TABLE space_versions (
    id            TEXT PRIMARY KEY,
    challenge_id  TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    owner_key     TEXT NOT NULL DEFAULT '',
    version       INTEGER NOT NULL,
    request       TEXT NOT NULL,
    html          TEXT,
    status        TEXT NOT NULL CHECK (status IN ('queued','building','ok','failed')),
    error         TEXT,
    model         TEXT,
    duration_ms   INTEGER,
    author        TEXT NOT NULL DEFAULT 'agent',
    created_at    TEXT NOT NULL,
    finished_at   TEXT,
    UNIQUE (challenge_id, owner_key, version)
  );

  CREATE TABLE spaces (
    challenge_id       TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    owner_key          TEXT NOT NULL DEFAULT '',
    current_version_id TEXT,
    PRIMARY KEY (challenge_id, owner_key)
  );

  CREATE TABLE media (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,
    challenge_id TEXT REFERENCES challenges(id) ON DELETE CASCADE,
    user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
    path         TEXT NOT NULL,
    mime         TEXT NOT NULL DEFAULT 'image/png',
    prompt       TEXT NOT NULL DEFAULT '',
    model        TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL
  );

  CREATE TABLE agent_messages (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    thread       TEXT NOT NULL,
    role         TEXT NOT NULL,
    item_json    TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );
  CREATE INDEX agent_messages_thread ON agent_messages(user_id, thread, created_at);
  `,
  /* 2: Virgil dressed for each challenge */ `
  ALTER TABLE challenges ADD COLUMN virgil_path TEXT;
  `,
  /* 3: agents connect with OAuth: Muse signs in once instead of holding a pasted key */ `
  CREATE TABLE oauth_clients (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL DEFAULT '',
    redirect_uris TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE oauth_grants (
    code_hash      TEXT PRIMARY KEY,
    client_id      TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connect_epoch  INTEGER NOT NULL,
    redirect_uri   TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    expires_at     TEXT NOT NULL,
    used_at        TEXT
  );

  ALTER TABLE users ADD COLUMN connect_epoch INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE api_keys ADD COLUMN client_id TEXT REFERENCES oauth_clients(id) ON DELETE SET NULL;
  `,
  /* 4: what each person ticks, picks or jots on a page Muse Wonder wrote, kept for them alone */ `
  CREATE TABLE space_marks (
    challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    owner_key    TEXT NOT NULL DEFAULT '',
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data         TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (challenge_id, owner_key, user_id)
  );
  `,
  /* 5: photos and videos on logs, kept in S3; media.path is the object key's folder */ `
  ALTER TABLE media ADD COLUMN log_id TEXT REFERENCES logs(id) ON DELETE CASCADE;
  ALTER TABLE media ADD COLUMN width INTEGER;
  ALTER TABLE media ADD COLUMN height INTEGER;
  ALTER TABLE media ADD COLUMN caption TEXT;
  CREATE INDEX media_log ON media(log_id);
  `,
  /* 6: the city a person picked for the world map, a key into lib/server/geo/cities.json; nobody has one unless they pick it */ `
  ALTER TABLE users ADD COLUMN city TEXT;
  `,
];

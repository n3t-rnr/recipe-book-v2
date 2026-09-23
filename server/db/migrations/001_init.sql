-- 001_init: Grundschema (Anforderungskatalog Kap. 4.3). Nicht nachträglich ändern; Änderungen nur als neue Migration.
CREATE TABLE profiles (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  name_key    TEXT NOT NULL UNIQUE,
  avatar      TEXT NOT NULL DEFAULT 'avatar-1',      -- Token-Name, keine Hex-Farbe
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Reihenfolge der Profilkacheln
);

CREATE TABLE recipes (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  title_key     TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  servings      REAL CHECK (servings IS NULL OR (servings >= 0.25 AND servings <= 100)),
  servings_unit TEXT NOT NULL DEFAULT 'Portionen' CHECK (length(servings_unit) <= 20),
  prep_minutes  INTEGER CHECK (prep_minutes IS NULL OR prep_minutes BETWEEN 1 AND 1440),
  cook_minutes  INTEGER CHECK (cook_minutes IS NULL OR cook_minutes BETWEEN 1 AND 1440),
  source        TEXT NOT NULL DEFAULT '' CHECK (length(source) <= 500),
  create_key    TEXT UNIQUE,                          -- vom Client erzeugt; verhindert Doppelanlage
  version       INTEGER NOT NULL DEFAULT 1,           -- nur der Server setzt diesen Wert
  created_by    INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by    INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at    TEXT,                                 -- Papierkorb; NULL = aktiv
  deleted_by    INTEGER REFERENCES profiles(id) ON DELETE SET NULL  -- „gelöscht von“ (Papierkorb, IN_TRASH)
);
CREATE INDEX idx_recipes_title   ON recipes(title_key, title) WHERE deleted_at IS NULL;
CREATE INDEX idx_recipes_created ON recipes(created_at)       WHERE deleted_at IS NULL;
CREATE INDEX idx_recipes_updated ON recipes(updated_at)       WHERE deleted_at IS NULL;
CREATE INDEX idx_recipes_trash   ON recipes(deleted_at)       WHERE deleted_at IS NOT NULL;

CREATE TABLE ingredients (
  id          INTEGER PRIMARY KEY,
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  group_name  TEXT NOT NULL DEFAULT '' CHECK (length(group_name) <= 60),
  amount      REAL CHECK (amount IS NULL OR amount >= 0),
  amount_max  REAL CHECK (amount_max IS NULL OR (amount IS NOT NULL AND amount_max > amount)),
  unit        TEXT NOT NULL DEFAULT '' CHECK (length(unit) <= 20),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  name_key    TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 200)
);
CREATE INDEX idx_ingredients_recipe ON ingredients(recipe_id, position);
CREATE INDEX idx_ingredients_name   ON ingredients(name_key);

CREATE TABLE steps (
  id          INTEGER PRIMARY KEY,
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  text        TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 4000)
);
CREATE INDEX idx_steps_recipe ON steps(recipe_id, position);

CREATE TABLE tags (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  name_key    TEXT NOT NULL UNIQUE
);

CREATE TABLE recipe_tags (
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, tag_id)
) WITHOUT ROWID;
CREATE INDEX idx_recipe_tags_tag ON recipe_tags(tag_id, recipe_id);

CREATE TABLE images (
  id          INTEGER PRIMARY KEY,
  recipe_id   INTEGER REFERENCES recipes(id) ON DELETE CASCADE,  -- NULL = noch nicht zugeordnet
  file_key    TEXT NOT NULL UNIQUE,                              -- 16 Hex, zufällig
  width       INTEGER NOT NULL,                                  -- Variante l; für feste Abmessungen (CLS)
  height      INTEGER NOT NULL,
  bytes_total INTEGER NOT NULL,                                  -- Summe s+m+l; Status-Seite
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Aufräumen nicht zugeordneter Uploads
);
CREATE UNIQUE INDEX idx_images_recipe ON images(recipe_id) WHERE recipe_id IS NOT NULL;
CREATE INDEX idx_images_unassigned ON images(created_at) WHERE recipe_id IS NULL;

CREATE TABLE ratings (
  profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id)  ON DELETE CASCADE,
  stars       INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  PRIMARY KEY (profile_id, recipe_id)
) WITHOUT ROWID;
CREATE INDEX idx_ratings_recipe ON ratings(recipe_id);

CREATE TABLE favorites (
  profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id)  ON DELETE CASCADE,
  PRIMARY KEY (profile_id, recipe_id)
) WITHOUT ROWID;
CREATE INDEX idx_favorites_recipe ON favorites(recipe_id);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
INSERT INTO meta(key, value) VALUES ('data_revision', '0');

-- Volltext: contentless-delete (SQLite >= 3.43; better-sqlite3 13 bündelt 3.53.x)
-- rowid = recipes.id; Spalteninhalte sind bereits normalisiert (Kap. 4.4)
CREATE VIRTUAL TABLE recipes_fts USING fts5(
  title, tags, ingredients, body,
  content = '', contentless_delete = 1,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3 4'
);

// Shared Q&A board, stored in SQLite (built into Node 22+).
import { DatabaseSync } from "node:sqlite";

const EARTH_M = 6371000;

export function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(a));
}

export function openStore(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      place_label TEXT,
      author TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      upvotes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_questions_lat_lon ON questions(lat, lon);
  `);
  // v2: questions can be about a specific landmark.
  const cols = db.prepare("PRAGMA table_info(questions)").all().map((c) => c.name);
  if (!cols.includes("topic")) db.exec("ALTER TABLE questions ADD COLUMN topic TEXT");
  // v3: questions flagged by the moderation check stay private to the asker.
  if (!cols.includes("hidden")) db.exec("ALTER TABLE questions ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
  // v4: the app became a food guide; old travel Q&As stay in the table but aren't shown.
  if (!cols.includes("kind")) db.exec("ALTER TABLE questions ADD COLUMN kind TEXT NOT NULL DEFAULT 'travel'");
  // One like per traveler per question (voter is a salted hash, never a raw IP).
  db.exec(`CREATE TABLE IF NOT EXISTS votes (
    question_id INTEGER NOT NULL, voter TEXT NOT NULL, PRIMARY KEY (question_id, voter)
  )`);

  // Generated story cards, shared by everyone in the same area (or for the same landmark).
  db.exec(`
    CREATE TABLE IF NOT EXISTS stories (
      key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      label TEXT,
      text TEXT NOT NULL,
      model TEXT,
      hits INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const getSetting = db.prepare(`SELECT value FROM settings WHERE key = ?`);
  const putSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);

  const getStory = db.prepare(`SELECT * FROM stories WHERE key = ?`);
  const putStory = db.prepare(
    `INSERT INTO stories (key, kind, label, text, model, hits) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET text = excluded.text, model = excluded.model, label = excluded.label,
       created_at = datetime('now'), hits = excluded.hits`
  );
  const hitStory = db.prepare(`UPDATE stories SET hits = hits + 1 WHERE key = ? RETURNING hits`);

  const insert = db.prepare(
    `INSERT INTO questions (lat, lon, place_label, author, question, answer, topic, hidden, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'food') RETURNING *`
  );
  const inBox = db.prepare(
    `SELECT * FROM questions WHERE hidden = 0 AND kind = 'food' AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
     ORDER BY created_at DESC LIMIT 500`
  );
  const bump = db.prepare(`UPDATE questions SET upvotes = upvotes + 1 WHERE id = ? AND hidden = 0 RETURNING *`);
  const getQ = db.prepare(`SELECT * FROM questions WHERE id = ? AND hidden = 0`);
  const vote = db.prepare(`INSERT OR IGNORE INTO votes (question_id, voter) VALUES (?, ?)`);

  return {
    // A value created once and kept across restarts (e.g. the salt for anonymous traveler ids).
    persistentSecret(key, make) {
      putSetting.run(key, make());
      return getSetting.get(key).value;
    },
    // Returns a cached story unless it's older than maxAgeDays (0 = never expires).
    getStory(key, maxAgeDays = 0) {
      const row = getStory.get(key);
      if (!row) return null;
      if (maxAgeDays > 0) {
        const age = (Date.now() - new Date(row.created_at.replace(" ", "T") + "Z").getTime()) / 86400000;
        if (age > maxAgeDays) return null;
      }
      return { key: row.key, kind: row.kind, label: row.label, text: row.text, hits: row.hits, createdAt: row.created_at };
    },
    putStory({ key, kind, label, text, model, hits = 1 }) {
      putStory.run(key, kind, label, text, model, hits);
    },
    countHit(key) {
      return hitStory.get(key)?.hits ?? 0;
    },
    addQuestion({ lat, lon, placeLabel, author, question, answer, topic = null, hidden = false }) {
      return shape(insert.get(lat, lon, placeLabel, author, question, answer, topic, hidden ? 1 : 0));
    },
    // Bounding-box prefilter in SQL, exact distance in JS.
    nearbyQuestions(lat, lon, radius) {
      const dLat = radius / 111320;
      const dLon = radius / (111320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
      return inBox
        .all(lat - dLat, lat + dLat, lon - dLon, lon + dLon)
        .map((r) => ({ ...shape(r), distance: Math.round(distanceMeters(lat, lon, r.lat, r.lon)) }))
        .filter((r) => r.distance <= radius)
        .sort((a, b) => b.upvotes - a.upvotes || b.createdAt.localeCompare(a.createdAt))
        .slice(0, 50);
    },
    // Returns the question (with its like count) or null if it doesn't exist.
    // A repeat like from the same voter is ignored.
    upvote(id, voter) {
      const q = getQ.get(id);
      if (!q) return null;
      if (vote.run(id, voter).changes === 0) return shape(q);
      return shape(bump.get(id));
    },
  };
}

function shape(r) {
  return {
    id: r.id,
    lat: r.lat,
    lon: r.lon,
    placeLabel: r.place_label,
    author: r.author,
    question: r.question,
    answer: r.answer,
    topic: r.topic ?? null,
    hidden: Boolean(r.hidden),
    upvotes: r.upvotes,
    createdAt: r.created_at,
  };
}

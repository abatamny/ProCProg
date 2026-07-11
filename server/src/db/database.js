import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { seedPlaces } from './seed-places.js';

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));
const schemaSql = fs.readFileSync(schemaPath, 'utf8');

export function createDatabase({ databasePath, forcePlaceId = null }) {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('journal_mode = WAL');
  db.exec(schemaSql);

  seedPlaces(db);

  if (forcePlaceId) {
    const place = db.prepare('SELECT ID FROM PLACES WHERE ID = ?').get(forcePlaceId);
    if (!place) throw new Error(`FORCE_PLACE_ID does not match a seeded place: ${forcePlaceId}`);
  }

  db.prepare(
    `INSERT INTO SETTINGS (ID, FORCE_PLACE_ID, IS_SEED)
     VALUES (1, ?, 0)
     ON CONFLICT(ID) DO UPDATE SET
       FORCE_PLACE_ID = excluded.FORCE_PLACE_ID,
       UPDATED_AT = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).run(forcePlaceId);

  return db;
}

export function getJournalMode(db) {
  return db.pragma('journal_mode', { simple: true });
}

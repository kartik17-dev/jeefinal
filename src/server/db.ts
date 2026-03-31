import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

let sqliteDb: any;

export async function initDB() {
  if (sqliteDb) return;

  const dbPath = path.join(process.cwd(), 'data', 'tracker.db');
  
  // Ensure data directory exists
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  sqliteDb = new Database(dbPath);

  // Create tables
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admitCardReleased BOOLEAN DEFAULT 0,
      responseSheetReleased BOOLEAN DEFAULT 0,
      resultReleased BOOLEAN DEFAULT 0,
      lastChecked DATETIME DEFAULT CURRENT_TIMESTAMP,
      lastHtmlSnapshot TEXT,
      knownLinks TEXT DEFAULT '[]',
      lastNtaUpdate TEXT
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      type TEXT,
      message TEXT,
      details TEXT
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT UNIQUE,
      keys TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Add lastNtaUpdate column if it doesn't exist (for existing databases)
  try {
    sqliteDb.exec(`ALTER TABLE status ADD COLUMN lastNtaUpdate TEXT`);
  } catch (e) {
    // Column likely already exists, ignore
  }

  // Initialize status row if not exists
  const row = sqliteDb.prepare('SELECT * FROM status WHERE id = 1').get();
  if (!row) {
    sqliteDb.prepare(`
      INSERT INTO status (id, admitCardReleased, responseSheetReleased, resultReleased, lastHtmlSnapshot, knownLinks, lastNtaUpdate)
      VALUES (1, 0, 0, 0, '', '[]', '')
    `).run();
  }
}

export async function getStatus() {
  await initDB();
  return sqliteDb.prepare('SELECT * FROM status WHERE id = 1').get();
}

export async function updateStatus(updates: {
  admitCardReleased?: boolean;
  responseSheetReleased?: boolean;
  resultReleased?: boolean;
  lastHtmlSnapshot?: string;
  knownLinks?: string;
  lastNtaUpdate?: string;
}) {
  await initDB();
  const current = await getStatus() as any;
  
  const admitCard = updates.admitCardReleased !== undefined ? updates.admitCardReleased : current.admitCardReleased;
  const responseSheet = updates.responseSheetReleased !== undefined ? updates.responseSheetReleased : current.responseSheetReleased;
  const result = updates.resultReleased !== undefined ? updates.resultReleased : current.resultReleased;
  const snapshot = updates.lastHtmlSnapshot !== undefined ? updates.lastHtmlSnapshot : current.lastHtmlSnapshot;
  const knownLinks = updates.knownLinks !== undefined ? updates.knownLinks : current.knownLinks;
  const lastNtaUpdate = updates.lastNtaUpdate !== undefined ? updates.lastNtaUpdate : current.lastNtaUpdate;

  sqliteDb.prepare(`
    UPDATE status 
    SET admitCardReleased = ?, 
        responseSheetReleased = ?, 
        resultReleased = ?, 
        lastHtmlSnapshot = ?,
        knownLinks = ?,
        lastNtaUpdate = ?,
        lastChecked = ?
    WHERE id = 1
  `).run(admitCard ? 1 : 0, responseSheet ? 1 : 0, result ? 1 : 0, snapshot, knownLinks, lastNtaUpdate, new Date().toISOString());
}

export async function addLog(type: string, message: string, details: string = '') {
  await initDB();
  sqliteDb.prepare('INSERT INTO logs (type, message, details, timestamp) VALUES (?, ?, ?, ?)').run(type, message, details, new Date().toISOString());
}

export async function getLogs() {
  await initDB();
  return sqliteDb.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 50').all();
}

export async function addSubscription(endpoint: string, keys: any) {
  await initDB();
  sqliteDb.prepare(`
    INSERT OR IGNORE INTO subscriptions (endpoint, keys) 
    VALUES (?, ?)
  `).run(endpoint, JSON.stringify(keys));
}

export async function getSubscriptions() {
  await initDB();
  return sqliteDb.prepare('SELECT * FROM subscriptions').all();
}

export async function removeSubscription(id: number | string) {
  await initDB();
  sqliteDb.prepare('DELETE FROM subscriptions WHERE id = ?').run(id);
}

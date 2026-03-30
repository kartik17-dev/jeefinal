import Database from 'better-sqlite3';

const db = new Database('data/tracker.db');

console.log('Resetting database...');

// Drop existing tables
db.exec('DROP TABLE IF EXISTS status;');
db.exec('DROP TABLE IF EXISTS logs;');

console.log('Database reset complete.');

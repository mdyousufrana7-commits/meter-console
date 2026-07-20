// db.js — persistence layer. Uses Node's built-in node:sqlite (Node 22+),
// so there is nothing to `npm install` for the database itself.
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'meters.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS meters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT,
    auth TEXT,
    mapping TEXT,
    interval INTEGER NOT NULL DEFAULT 30,
    demo INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meter_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    active_power REAL,
    voltage_ll REAL,
    current REAL,
    power_factor REAL,
    frequency REAL,
    energy REAL
  );

  CREATE INDEX IF NOT EXISTS idx_readings_meter_ts ON readings(meter_id, ts);
`);

/* ---------------- meters ---------------- */
function listMeters() {
  return db.prepare('SELECT * FROM meters ORDER BY created_at ASC').all();
}

function getMeter(id) {
  return db.prepare('SELECT * FROM meters WHERE id = ?').get(id);
}

function insertMeter(m) {
  db.prepare(`INSERT INTO meters (id,name,url,auth,mapping,interval,demo,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    m.id, m.name, m.url || null, m.auth || null,
    JSON.stringify(m.mapping || {}), m.interval, m.demo ? 1 : 0, Date.now()
  );
}

function deleteMeter(id) {
  db.prepare('DELETE FROM meters WHERE id = ?').run(id);
  db.prepare('DELETE FROM readings WHERE meter_id = ?').run(id);
}

/* ---------------- readings ---------------- */
function insertReading(meterId, r) {
  db.prepare(`INSERT INTO readings (meter_id, ts, active_power, voltage_ll, current, power_factor, frequency, energy)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    meterId, Date.now(),
    numOrNull(r.activePower), numOrNull(r.voltageLL), numOrNull(r.current),
    numOrNull(r.powerFactor), numOrNull(r.frequency), numOrNull(r.energy)
  );
}

function numOrNull(v) {
  return (typeof v === 'number' && !isNaN(v)) ? v : null;
}

function recentReadings(meterId, limit) {
  return db.prepare(`SELECT * FROM readings WHERE meter_id = ? ORDER BY ts DESC LIMIT ?`)
    .all(meterId, limit).reverse();
}

function readingsBetween(meterId, startTs, endTs) {
  return db.prepare(`SELECT * FROM readings WHERE meter_id = ? AND ts >= ? AND ts < ? ORDER BY ts ASC`)
    .all(meterId, startTs, endTs);
}

module.exports = {
  listMeters, getMeter, insertMeter, deleteMeter,
  insertReading, recentReadings, readingsBetween
};

// poller.js — polls every meter's API server-side (so the browser doesn't
// need to be open, and CORS on the meter's API no longer matters since the
// request comes from this Node process, not a browser tab).
const db = require('./db');

const timers = new Map(); // meterId -> interval handle
const liveState = new Map(); // meterId -> { status, latest, errMsg }

function getByPath(obj, path) {
  try {
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined) ? o[k] : undefined, obj);
  } catch (e) { return undefined; }
}

function simulatedReading(meter, prevEnergy) {
  const t = Date.now() / 1000;
  const seed = meter.id.charCodeAt(0);
  const base = 900 + Math.sin(t / 40 + seed) * 350 + Math.random() * 40;
  return {
    activePower: Math.max(50, base),
    voltageLL: 398 + Math.random() * 6,
    current: Math.max(50, base * 1.45 + Math.random() * 10),
    powerFactor: 0.94 + Math.random() * 0.05,
    frequency: 49.9 + Math.random() * 0.2,
    energy: (prevEnergy || 150000) + base / 120
  };
}

async function fetchOne(meter) {
  const mapping = JSON.parse(meter.mapping || '{}');
  if (meter.demo) {
    const last = db.recentReadings(meter.id, 1)[0];
    const r = simulatedReading(meter, last ? last.energy : null);
    db.insertReading(meter.id, r);
    liveState.set(meter.id, { status: 'demo', latest: r, errMsg: null });
    return;
  }
  try {
    const headers = {};
    if (meter.auth) headers['Authorization'] = meter.auth;
    const resp = await fetch(meter.url, { headers });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    const r = {
      activePower: Number(getByPath(json, mapping.activePower)),
      voltageLL: Number(getByPath(json, mapping.voltageLL)),
      current: Number(getByPath(json, mapping.current)),
      powerFactor: Number(getByPath(json, mapping.powerFactor)),
      frequency: Number(getByPath(json, mapping.frequency)),
      energy: Number(getByPath(json, mapping.energy))
    };
    db.insertReading(meter.id, r);
    liveState.set(meter.id, { status: 'live', latest: r, errMsg: null });
  } catch (e) {
    liveState.set(meter.id, { status: 'err', latest: liveState.get(meter.id)?.latest || null, errMsg: e.message || String(e) });
  }
}

function startPolling(meter) {
  stopPolling(meter.id);
  fetchOne(meter); // immediate first read
  const handle = setInterval(() => fetchOne(meter), Math.max(5, meter.interval) * 1000);
  timers.set(meter.id, handle);
}

function stopPolling(meterId) {
  const h = timers.get(meterId);
  if (h) clearInterval(h);
  timers.delete(meterId);
  liveState.delete(meterId);
}

function startAll() {
  db.listMeters().forEach(startPolling);
}

function getLiveState(meterId) {
  return liveState.get(meterId) || { status: 'idle', latest: null, errMsg: null };
}

module.exports = { startPolling, stopPolling, startAll, getLiveState };

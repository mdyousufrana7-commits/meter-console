// server.js — plain Node http server. No Express, no npm install required.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const db = require('./db');
const poller = require('./poller');
const reports = require('./reports');

const PORT = process.env.PORT || 5177;
// index.html lives right next to server.js — no public/ subfolder needed.
const INDEX_FILE = path.join(__dirname, 'index.html');

function send(res, status, body, headers = {}) {
  res.writeHead(status, Object.assign({ 'Access-Control-Allow-Origin': '*' }, headers));
  res.end(body);
}
function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 2_000_000) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function uid() { return Math.random().toString(36).slice(2, 9); }

function meterPublic(m) {
  const live = poller.getLiveState(m.id);
  return {
    id: m.id, name: m.name, url: m.url, interval: m.interval, demo: !!m.demo,
    mapping: JSON.parse(m.mapping || '{}'),
    status: live.status, latest: live.latest, errMsg: live.errMsg
  };
}

function serveIndex(req, res) {
  fs.readFile(INDEX_FILE, (err, data) => {
    if (err) { send(res, 404, 'index.html not found next to server.js'); return; }
    send(res, 200, data, { 'Content-Type': 'text/html; charset=utf-8' });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;

  try {
    // ---------- meters ----------
    if (p === '/api/meters' && req.method === 'GET') {
      return json(res, 200, db.listMeters().map(meterPublic));
    }

    if (p === '/api/meters' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      const name = (body.name || '').trim() || 'Untitled meter';
      const url = (body.url || '').trim() || null;
      const auth = (body.auth || '').trim() || null;
      const interval = Math.max(5, parseInt(body.interval) || 30);
      const demo = !!body.demo || !url;
      let mapping = {};
      if (body.mapping && typeof body.mapping === 'object') mapping = body.mapping;
      const DEFAULT_MAP = { activePower: 'activePower', voltageLL: 'voltage', current: 'current', powerFactor: 'powerFactor', frequency: 'frequency', energy: 'energy' };
      mapping = Object.assign({}, DEFAULT_MAP, mapping);

      if (!url && !demo) return json(res, 400, { error: 'Provide an API URL, or mark as demo.' });

      const m = { id: uid(), name, url, auth, mapping, interval, demo };
      db.insertMeter(m);
      poller.startPolling(db.getMeter(m.id));
      return json(res, 201, meterPublic(db.getMeter(m.id)));
    }

    const meterIdMatch = p.match(/^\/api\/meters\/([a-z0-9]+)$/);
    if (meterIdMatch && req.method === 'DELETE') {
      const id = meterIdMatch[1];
      poller.stopPolling(id);
      db.deleteMeter(id);
      return json(res, 200, { ok: true });
    }

    const readingsMatch = p.match(/^\/api\/meters\/([a-z0-9]+)\/readings$/);
    if (readingsMatch && req.method === 'GET') {
      const limit = Math.min(500, parseInt(u.searchParams.get('limit')) || 60);
      return json(res, 200, db.recentReadings(readingsMatch[1], limit));
    }

    // ---------- reports ----------
    if (p === '/api/reports/daily' && req.method === 'GET') {
      const meterId = u.searchParams.get('meterId');
      const date = u.searchParams.get('date');
      if (!meterId || !date) return json(res, 400, { error: 'meterId and date are required' });
      return json(res, 200, reports.dailyReport(meterId, date));
    }
    if (p === '/api/reports/monthly' && req.method === 'GET') {
      const meterId = u.searchParams.get('meterId');
      const month = u.searchParams.get('month');
      if (!meterId || !month) return json(res, 400, { error: 'meterId and month are required' });
      return json(res, 200, reports.monthlyReport(meterId, month));
    }
    if (p === '/api/reports/daily.csv' && req.method === 'GET') {
      const meterId = u.searchParams.get('meterId');
      const date = u.searchParams.get('date');
      if (!meterId || !date) return json(res, 400, { error: 'meterId and date are required' });
      const rep = reports.dailyReport(meterId, date);
      const csv = reports.toCsvDaily(rep);
      return send(res, 200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="daily-${meterId}-${date}.csv"` });
    }
    if (p === '/api/reports/monthly.csv' && req.method === 'GET') {
      const meterId = u.searchParams.get('meterId');
      const month = u.searchParams.get('month');
      if (!meterId || !month) return json(res, 400, { error: 'meterId and month are required' });
      const rep = reports.monthlyReport(meterId, month);
      const csv = reports.toCsvMonthly(rep);
      return send(res, 200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="monthly-${meterId}-${month}.csv"` });
    }

    // ---------- static (single-page app: everything else serves index.html) ----------
    if (req.method === 'GET' && !p.startsWith('/api/')) return serveIndex(req, res);

    return send(res, 404, 'Not found');
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: e.message || String(e) });
  }
});

poller.startAll();
server.listen(PORT, () => {
  console.log(`Meter console running: http://localhost:${PORT}`);
});

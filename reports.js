// reports.js — builds daily / monthly reports from stored readings.
// Energy (kWh) is estimated by trapezoidal integration of active_power (kW)
// over time, so it works even if the meter's own cumulative "energy" field
// is missing or unreliable. The meter's own energy field (if present) is
// also reported as a cross-check (delta between first & last reading).
const db = require('./db');

function startOfDay(dateStr) { // 'YYYY-MM-DD' -> local midnight ms
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}
function startOfMonth(monthStr) { // 'YYYY-MM' -> local first-of-month ms
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m - 1, 1, 0, 0, 0, 0).getTime();
}
function addDays(ms, n) { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); }
function addMonths(ms, n) { const d = new Date(ms); d.setMonth(d.getMonth() + n); return d.getTime(); }

// Trapezoidal kWh from a list of {ts, active_power} sorted ascending, clipped to [rangeStart, rangeEnd)
function integrateEnergy(rows) {
  let kwh = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.active_power == null || b.active_power == null) continue;
    const hours = (b.ts - a.ts) / 3600000;
    if (hours <= 0 || hours > 2) continue; // skip huge gaps (meter offline)
    kwh += ((a.active_power + b.active_power) / 2) * hours;
  }
  return kwh;
}

function summarize(rows) {
  const powers = rows.map(r => r.active_power).filter(v => v != null);
  if (powers.length === 0) {
    return { samples: 0, avgKw: null, peakKw: null, minKw: null, energyKwh: 0, meterEnergyDeltaKwh: null };
  }
  const avgKw = powers.reduce((a, b) => a + b, 0) / powers.length;
  const peakKw = Math.max(...powers);
  const minKw = Math.min(...powers);
  const energyKwh = integrateEnergy(rows);
  const energies = rows.map(r => r.energy).filter(v => v != null);
  const meterEnergyDeltaKwh = energies.length >= 2 ? (energies[energies.length - 1] - energies[0]) : null;
  return { samples: rows.length, avgKw, peakKw, minKw, energyKwh, meterEnergyDeltaKwh };
}

function dailyReport(meterId, dateStr) {
  const dayStart = startOfDay(dateStr);
  const dayEnd = addDays(dayStart, 1);
  const rows = db.readingsBetween(meterId, dayStart, dayEnd);
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const hStart = dayStart + h * 3600000;
    const hEnd = hStart + 3600000;
    const hRows = rows.filter(r => r.ts >= hStart && r.ts < hEnd);
    hours.push({ hour: h, ...summarize(hRows) });
  }
  return { meterId, date: dateStr, totals: summarize(rows), hours };
}

function monthlyReport(meterId, monthStr) {
  const monthStart = startOfMonth(monthStr);
  const monthEnd = addMonths(monthStart, 1);
  const rows = db.readingsBetween(meterId, monthStart, monthEnd);
  const days = [];
  let cursor = monthStart;
  while (cursor < monthEnd) {
    const dEnd = addDays(cursor, 1);
    const dRows = rows.filter(r => r.ts >= cursor && r.ts < dEnd);
    const d = new Date(cursor);
    const dateStr = d.toISOString().slice(0, 10);
    days.push({ date: dateStr, ...summarize(dRows) });
    cursor = dEnd;
  }
  return { meterId, month: monthStr, totals: summarize(rows), days };
}

function toCsvDaily(report) {
  const lines = ['hour,samples,avg_kw,peak_kw,min_kw,energy_kwh'];
  report.hours.forEach(h => {
    lines.push([h.hour, h.samples, r2(h.avgKw), r2(h.peakKw), r2(h.minKw), r2(h.energyKwh)].join(','));
  });
  lines.push('');
  lines.push(`TOTAL,${report.totals.samples},${r2(report.totals.avgKw)},${r2(report.totals.peakKw)},${r2(report.totals.minKw)},${r2(report.totals.energyKwh)}`);
  return lines.join('\n');
}

function toCsvMonthly(report) {
  const lines = ['date,samples,avg_kw,peak_kw,min_kw,energy_kwh'];
  report.days.forEach(d => {
    lines.push([d.date, d.samples, r2(d.avgKw), r2(d.peakKw), r2(d.minKw), r2(d.energyKwh)].join(','));
  });
  lines.push('');
  lines.push(`TOTAL,${report.totals.samples},${r2(report.totals.avgKw)},${r2(report.totals.peakKw)},${r2(report.totals.minKw)},${r2(report.totals.energyKwh)}`);
  return lines.join('\n');
}

function r2(n) { return (typeof n === 'number' && !isNaN(n)) ? Math.round(n * 100) / 100 : ''; }

module.exports = { dailyReport, monthlyReport, toCsvDaily, toCsvMonthly };

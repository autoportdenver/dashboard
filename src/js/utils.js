'use strict';

// ══════════════════════════════════════════════
//  UTILITIES — src/js/utils.js
//  Pure helper functions — no DOM, no Drive, no state.
// ══════════════════════════════════════════════

// ── HTML snippets ──
function loading(html) {
  return `<div class="loading"><div class="spinner"></div>${html || 'Loading…'}</div>`;
}
function errorBox(msg) {
  return `<div class="error-box">⚠ ${msg}</div>`;
}

// ── Promise helpers ──
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(
      () => rej(new Error((label || 'Request') + ' timed out after ' + (ms / 1000) + 's')),
      ms
    )),
  ]);
}

// ── Text extraction from MCP response shapes ──
function extractText(res, depth) {
  depth = depth || 0;
  if (depth > 8) return '';
  if (!res) return '';
  if (typeof res === 'string') {
    const s = res.trim();
    if ((s.startsWith('{') || s.startsWith('[')) && (s.endsWith('}') || s.endsWith(']'))) {
      try { return extractText(JSON.parse(s), depth + 1); } catch (e) {}
    }
    return res;
  }
  if (Array.isArray(res)) {
    return res.map(x => extractText(x, depth + 1)).filter(Boolean).join('\n');
  }
  if (typeof res === 'object') {
    for (const k of ['fileContent', 'content', 'text', 'data', 'result', 'body', 'output', 'value']) {
      if (res[k] !== undefined && res[k] !== null) {
        const v = extractText(res[k], depth + 1);
        if (v) return v;
      }
    }
    try { return JSON.stringify(res); } catch (e) { return ''; }
  }
  return String(res);
}

// ── CSV parsing ──
function parseCSV(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(l => {
    const vals = parseCSVLine(l);
    const row = {};
    headers.forEach((h, i) => { row[h.trim().toLowerCase()] = (vals[i] || '').trim(); });
    return row;
  }).filter(r => Object.values(r).some(v => v));
}

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      result.push(cur); cur = '';
    } else { cur += c; }
  }
  result.push(cur);
  return result;
}

// Drive MCP returns Google Sheets as a flat string with ZERO newlines.
// This reinserts newlines before date-prefixed rows so parseCSV works correctly.
function preprocessFlatCSV(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/,[ \t]+(?=\d{1,2}\/\d{1,2}\/\d{2,4}[,\s])/g, '\n');
}

// ── Money / number helpers ──
function parseMoney(s) {
  if (s === undefined || s === null || s === '') return NaN;
  let str = String(s).trim().replace(/[$,\s]/g, '');
  if (str.startsWith('(') && str.endsWith(')')) str = '-' + str.slice(1, -1);
  const n = parseFloat(str);
  return isNaN(n) ? NaN : n;
}

function fmt$(n) {
  if (isNaN(n) || n === undefined) return '—';
  return '$' + Math.round(n).toLocaleString();
}

// ── Object helpers ──
// getField(row, 'key1', 'key2', ...) — returns first non-empty match
function getField(row) {
  const keys = Array.from(arguments).slice(1);
  for (const k of keys) {
    const v = row[k.toLowerCase()];
    if (v !== undefined && v !== '') return v;
  }
  return '';
}

// ── Date helpers ──
function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function isSameMonth(d, year, month) {
  return d && d.getFullYear() === year && d.getMonth() === month;
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

// ── String helpers ──
function capitalise(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
}

// ── P&L extractor ──
// Parses the flat Drive accounting package string into monthly metric series.
// Returns { monthLabels: string[], numMonths: number, rows: { [key]: { label, values: number[] } } }
function extractPLMetrics(flatText) {
  if (!flatText || flatText.length < 100) return { monthLabels: [], rows: {} };

  const monthRe = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[- ]\d{2,4}/g;
  const allM = [...flatText.matchAll(monthRe)];

  const runs = [];
  let run = [];
  for (const m of allM) {
    const prev = run[run.length - 1];
    if (!prev || m.index - (prev.index + prev[0].length) <= 40) {
      run.push(m);
    } else {
      if (run.length >= 2) runs.push([...run]);
      run = [m];
    }
  }
  if (run.length >= 2) runs.push(run);

  const bestRun   = runs.reduce((b, r) => r.length > b.length ? r : b, []);
  const monthLabels = bestRun.map(m => m[0]);
  const numMonths   = monthLabels.length;

  function getRow(candidates) {
    for (const lbl of candidates) {
      const idx = flatText.indexOf(lbl);
      if (idx < 0) continue;
      const chunkSize = Math.max(numMonths * 30, 400);
      const chunk = flatText.slice(idx + lbl.length, idx + lbl.length + chunkSize);
      const parts = chunk.split(',');
      const vals = [];
      for (const p of parts) {
        const clean = p.trim();
        if (!clean) continue;
        const v = parseMoney(clean);
        if (!isNaN(v)) {
          vals.push(v);
          if (numMonths > 0 && vals.length >= numMonths) break;
        } else if (vals.length > 0) {
          break;
        }
      }
      if (vals.length > 0) return { label: lbl, values: vals };
    }
    return null;
  }

  const rows = {
    revenue:      getRow(['Net Revenue - Car Sales', 'Total Revenue', 'Net Revenue', 'Total Income']),
    vehicleSales: getRow(['Vehicle Sales Revenue', 'Car Sales Revenue', 'Vehicle Sales']),
    backendRev:   getRow(['Total Backend Revenue', 'Backend Revenue', 'F&I Revenue']),
    cogs:         getRow(['Total Vehicle Sales COGS', 'Total COGS', 'Cost of Goods Sold']),
    grossProfit:  getRow(['Gross Profit']),
    totalOpex:    getRow(['Total Operating Expenses', 'Operating Expenses', 'Total Expenses']),
    payroll:      getRow(['Total Payroll', 'Payroll & Benefits', 'Payroll Expenses', 'Payroll']),
    rent:         getRow(['Rent & Utilities', 'Total Rent', 'Rent']),
    floorInt:     getRow(['Floorplan Interest', 'Floor Plan Interest', 'Floor Interest']),
    advertising:  getRow(['Advertising & Marketing', 'Advertising', 'Marketing']),
    netIncome:    getRow(['Net Income', 'Net Profit / Loss', 'Net Ordinary Income', 'Net Profit']),
  };

  return { monthLabels, numMonths, rows };
}

// ── Sheet text section splitter (used by financial page) ──
function parseSheetText(text) {
  const sections = {};
  const parts = text.split(/(?:^|\n)#{1,3}\s+/m);
  let lastName = '__default__';
  for (const part of parts) {
    const nl = part.indexOf('\n');
    if (nl === -1) { sections[lastName] = (sections[lastName] || '') + part; continue; }
    const name = part.substring(0, nl).trim();
    const body = part.substring(nl + 1);
    if (name) { lastName = name; sections[name] = body; }
    else sections[lastName] = (sections[lastName] || '') + body;
  }
  return sections;
}

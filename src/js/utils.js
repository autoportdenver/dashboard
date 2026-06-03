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
    // ── Car Sales Revenue ──
    grossRevCar:     getRow(['Gross Revenue (Total Sale) - Car Sales', 'Gross Revenue - Car Sales', 'Gross Revenue']),
    fnceFees:        getRow(['Fnce Fees - For Financed Cars', 'Finance Fees - For Financed Cars', 'Finance Fees']),
    netRevCar:       getRow(['Net Revenue - Car Sales', 'Net Revenue', 'Total Revenue', 'Total Income']),
    // ── Car Sales COGS ──
    cogsCar:         getRow(['COGS - Car Sales']),
    dealrCloudChk:   getRow(['Dealr.Cloud - COGS (Checking)', 'Dealr.Cloud COGS (Checking)']),
    flooringProxy:   getRow(['Flooring Payable', 'Floor Plan Payable']),
    dealrCloudCash:  getRow(['Dealr.Cloud - COGS (Cash Inv Costs)', 'Dealr.Cloud COGS (Cash Inv Costs)']),
    packCar:         getRow(['PACK - Car Sales', 'Pack - Car Sales', 'PACK']),
    grossProfitCar:  getRow(['Gross Profit - Car Sales']),
    grossPerCar:     getRow(['Total Gross Profit per Car ($/Car)', 'Total Gross Profit per Car', 'Gross Profit per Car']),
    // ── Service ──
    revService:      getRow(['Total Revenue - Service', 'Revenue - Service Jobs (Charge/Cash)', 'Revenue - Service Jobs']),
    cogsService:     getRow(['Total COGS - Service', 'COGS - Service Jobs (Charge/Cash)', 'COGS - Service Jobs']),
    grossProfitSvc:  getRow(['Gross Profit - Service']),
    // ── Backend / Warranties ──
    revBackend:      getRow(['Total Revenue - Backend Warranties and Vehicle Products', 'Total Revenue - Backend Warranties', 'Revenue - Backend', 'Backend Revenue', 'Total Backend Revenue']),
    cogsBackend:     getRow(['Total COGS - Backend Warranties and Vehicle Products', 'Total COGS - Backend', 'COGS - Backend']),
    grossBackend:    getRow(['Gross Profit - Backend Warranties and Vehicle Products', 'Gross Profit - Backend']),
    // ── Payroll / Contractors ──
    w2Wages:         getRow(['W2 Wages - Sako', 'W2 Wages', 'Salaries and Wages']),
    totalContractors:getRow(['Total Contractors (1099)', 'Total Contractors', 'Contractors (1099)']),
    // ── Marketing ──
    autoMoxie:       getRow(['AutoMoxie']),
    carFax:          getRow(['CarFax', 'Carfax']),
    carGurus:        getRow(['CarGurus', 'Car Gurus']),
    totalMarketing:  getRow(['Total Marketing', 'Marketing Expenses', 'Advertising & Marketing', 'Advertising', 'Marketing']),
    // ── OPEX ──
    rent:            getRow(['Rent & Utilities', 'Total Rent', 'Rent']),
    floorInt:        getRow(['Floorplan Interest', 'Floor Plan Interest', 'Floor Interest']),
    totalOpex:       getRow(['Total OPEX', 'Total Operating Expenses', 'Operating Expenses', 'Total Expenses']),
    operatingIncome: getRow(['OPERATING INCOME', 'Operating Income']),
    // ── Below the line ──
    salesTaxLine:    getRow(['Sales Taxes & Other Expenses', 'Sales Tax Expense']),
    totalTotalOpex:  getRow(['Total Total OPEX']),
    netIncome:       getRow(['NET INCOME', 'Net Income', 'Net Profit / Loss', 'Net Ordinary Income', 'Net Profit']),
    avgTaxPerCar:    getRow(['Avg. $ Tax/Car Sold', 'Avg $ Tax/Car Sold', 'Avg Tax/Car']),
    // ── Fallback ──
    grossProfit:     getRow(['Gross Profit']),
  };

  return { monthLabels, numMonths, rows };
}

// ── Outstanding titles table builder ──
// Normalise a vehicle name for fuzzy matching (strip punctuation, collapse spaces)
function normVehicle(v) {
  return (v || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildTitlesTable(rows) {
  var trulyOut    = rows.filter(function (t) { return !t.dts; });
  var recentNoDts = trulyOut.filter(function (t) { return t.daysOut <= 99; });
  var oldNoDts    = trulyOut.filter(function (t) { return t.daysOut >  99; });
  var dtsProc     = rows.filter(function (t) { return t.dts && t.dts.status === 'processed'; });
  var dtsPend     = rows.filter(function (t) { return t.dts && t.dts.status !== 'processed'; });

  function dtsCell(t) {
    if (!t.dts) return '<span style="color:var(--red);font-size:11px;font-weight:700">&#9888; Not in DTS</span>';
    if (t.dts.status === 'processed')
      return '<span style="color:var(--green);font-size:11px;font-weight:700">&#10003; DTS Processed</span><br>'
           + '<span style="font-size:10px;color:var(--muted)">' + t.dts.transferDate + '</span>';
    return '<span style="color:var(--yellow);font-size:11px;font-weight:700">&#8987; DTS Pending</span><br>'
         + '<span style="font-size:10px;color:var(--muted)">' + t.dts.transferDate + '</span>';
  }

  function makeRow(t, i, dimmed) {
    var badge      = t.daysOut > 60 ? 'badge-red' : t.daysOut > 30 ? 'badge-yellow' : 'badge-blue';
    var closedStr  = t.closing.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    var inHand     = t.received
      ? '<span style="color:var(--green);font-weight:700">&#10003; Yes</span>'
      : '<span style="color:var(--muted)">&#10007; No</span>';
    return '<tr style="border-bottom:1px solid var(--border);background:' + (i % 2 ? 'var(--card2)' : 'transparent') + ';opacity:' + (dimmed ? '.8' : '1') + '">'
      + '<td style="padding:7px 10px">' + t.vehicle + '</td>'
      + '<td style="padding:7px 10px;color:var(--muted)">' + (t.stock || '—') + '</td>'
      + '<td style="padding:7px 10px;color:var(--muted)">' + closedStr + '</td>'
      + '<td style="padding:7px 10px;text-align:right"><span class="badge ' + badge + '">' + t.daysOut + 'd</span></td>'
      + '<td style="padding:7px 10px;text-align:center">' + inHand + '</td>'
      + '<td style="padding:7px 10px;text-align:center">' + dtsCell(t) + '</td>'
      + '</tr>';
  }

  // Always-visible section
  function sectionRows(label, color, arr, dimmed) {
    if (!arr.length) return '';
    return '<tr><td colspan="6" style="padding:5px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:'
      + color + ';background:var(--card2)">' + label + ' (' + arr.length + ')</td></tr>'
      + arr.map(function (t, i) { return makeRow(t, i, dimmed); }).join('');
  }

  // Collapsible section — persists collapse state across renders via window._titlesCollapseState
  var _cs = window._titlesCollapseState = window._titlesCollapseState || {};
  window.toggleTitlesSection = function (key) {
    _cs[key] = !_cs[key];
    var body    = document.getElementById('titles-sec-' + key);
    var chevron = document.getElementById('titles-chv-' + key);
    if (body)    body.style.display   = _cs[key] ? 'none' : '';
    if (chevron) chevron.textContent  = _cs[key] ? '▶' : '▼';
  };
  if (_cs.oldNoDts === undefined) _cs.oldNoDts = true;
  if (_cs.dtsPend  === undefined) _cs.dtsPend  = true;
  if (_cs.dtsProc  === undefined) _cs.dtsProc  = true;

  function collapsibleSection(key, label, color, arr, dimmed) {
    if (!arr.length) return '';
    var collapsed = _cs[key];
    var hdr = '<tr style="cursor:pointer;user-select:none" onclick="toggleTitlesSection(\'' + key + '\')">'
      + '<td colspan="6" style="padding:5px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:'
      + color + ';background:var(--card2)">' + label + ' (' + arr.length + ')'
      + ' &nbsp;<span id="titles-chv-' + key + '" style="font-size:11px">' + (collapsed ? '▶' : '▼') + '</span>'
      + '</td></tr>';
    return hdr + '<tbody id="titles-sec-' + key + '" style="display:' + (collapsed ? 'none' : '') + '">'
      + arr.map(function (t, i) { return makeRow(t, i, dimmed); }).join('')
      + '</tbody>';
  }

  var gap = dtsProc.length
    ? '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">&#8505;&#65039; '
      + dtsProc.length + ' car' + (dtsProc.length !== 1 ? 's' : '')
      + ' sent via DTS but not yet marked sent in the Title Report &mdash; process gap confirmed.</div>'
    : '';

  var thead = '<thead><tr style="background:var(--card2);text-align:left">'
    + '<th style="padding:7px 10px;font-weight:700;border-bottom:2px solid var(--border)">Vehicle</th>'
    + '<th style="padding:7px 10px;font-weight:700;border-bottom:2px solid var(--border)">Stock</th>'
    + '<th style="padding:7px 10px;font-weight:700;border-bottom:2px solid var(--border)">Closed</th>'
    + '<th style="padding:7px 10px;font-weight:700;border-bottom:2px solid var(--border);text-align:right">Days Out</th>'
    + '<th style="padding:7px 10px;font-weight:700;border-bottom:2px solid var(--border);text-align:center">Title In Hand</th>'
    + '<th style="padding:7px 10px;font-weight:700;border-bottom:2px solid var(--border);text-align:center">DTS Status</th>'
    + '</tr></thead>';

  var tbody = '<tbody>'
    + sectionRows('&#9888; Not in DTS — Action Required (&le;99 days)', 'var(--red)', recentNoDts, false)
    + '</tbody>'
    + collapsibleSection('oldNoDts', '&#128197; Not in DTS — Older than 99 Days',       'var(--orange)', oldNoDts, false)
    + collapsibleSection('dtsPend',  '&#8987; DTS Pending',                              'var(--yellow)', dtsPend,  false)
    + collapsibleSection('dtsProc',  '&#10003; Sent via DTS — Update Title Report',      'var(--green)',  dtsProc,  true);

  return gap + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">'
    + thead + tbody + '</table></div>';
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

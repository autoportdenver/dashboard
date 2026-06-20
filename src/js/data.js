'use strict';

// ══════════════════════════════════════════════
//  DATA — src/js/data.js
//  Unified data loading layer — Google Drive only.
//
//  Every named loader writes a one-line console entry:
//    ✅  success  — file name, row/char count, modified date
//    ⚠️  warning  — no file found, or file was empty
//    ❌  error    — Drive API error or parse failure
//
//  All results are cached so each source is fetched once per session.
// ══════════════════════════════════════════════

const cache = {};

// ── Console diagnostics ──
const _T = '[AutoPort Data]';
function _ok(label, detail)  { console.log('%c' + _T + ' ✅ ' + label, 'color:#22c55e;font-weight:600', detail || ''); }
function _warn(label, detail){ console.warn(_T + ' ⚠️  ' + label, detail || ''); }
function _err(label, detail) { console.error(_T + ' ❌ ' + label, detail || ''); }

// Format a modifiedTime ISO string as a short readable date.
function _modStr(t) {
  if (!t) return '';
  const d = new Date(t);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

// ── Generic Drive loaders (used by named loaders below) ──

// Find the most-recently-modified file in folderId, read it, return parsed CSV rows.
// Pass a human-readable `label` to get console output; omit for silent operation.
async function loadCSV(folderId, label) {
  if (!folderId || !isDriveAvailable()) {
    if (label) _warn(label, 'Drive not available (not signed in)');
    return [];
  }
  let file = null;
  try {
    file = await driveSearchLatest(folderId);
    if (!file) {
      if (label) _warn(label, 'no file found in Drive folder ' + folderId);
      return [];
    }
    const txt = await driveRead(file.id);
    if (!txt || txt.length <= 50) {
      if (label) _warn(label, '"' + file.name + '" — file found but content is empty');
      return [];
    }
    const rows = parseCSV(txt);
    if (label) _ok(label, '"' + file.name + '" — ' + rows.length + ' rows | mod ' + _modStr(file.modifiedTime));
    return rows;
  } catch (e) {
    if (label) _err(label, (file ? '"' + file.name + '" — ' : '') + e.message);
    return [];
  }
}

// Read a known file by ID and return raw text.
async function loadText(fileId, label) {
  if (!fileId || !isDriveAvailable()) {
    if (label) _warn(label, 'Drive not available (not signed in)');
    return '';
  }
  try {
    const txt = await driveRead(fileId);
    if (!txt || txt.length <= 50) {
      if (label) _warn(label, 'file ' + fileId + ' — content is empty');
      return '';
    }
    if (label) _ok(label, fileId + ' — ' + txt.length.toLocaleString() + ' chars');
    return txt;
  } catch (e) {
    if (label) _err(label, e.message);
    return '';
  }
}

// Search Drive by name fragment(s), return parsed CSV rows from the first match.
async function loadCSVByName(label, ...nameFragments) {
  if (!isDriveAvailable()) {
    if (label) _warn(label, 'Drive not available (not signed in)');
    return [];
  }
  for (const frag of nameFragments) {
    let f = null;
    try {
      f = await driveSearchByName(frag);
      if (!f) continue;
      const txt = await driveRead(f.id);
      if (!txt || txt.length <= 50) continue;
      const rows = parseCSV(txt);
      if (label) _ok(label, '"' + f.name + '" — ' + rows.length + ' rows | mod ' + _modStr(f.modifiedTime));
      return rows;
    } catch (e) {
      if (label) _err(label, (f ? '"' + f.name + '" — ' : 'search "' + frag + '" — ') + e.message);
    }
  }
  if (label) _warn(label, 'not found — searched: ' + nameFragments.join(', '));
  return [];
}

// ══════════════════════════════════════════════
//  NAMED LOADERS  (each cached after first call)
// ══════════════════════════════════════════════

async function getInventoryRows() {
  if (cache.inventoryRows) return cache.inventoryRows;
  const rows = await loadCSV(FOLDER_IDS.inventory, 'Inventory Report');
  if (!rows.length) throw new Error('No Inventory Report found in Drive.');
  cache.inventoryRows = rows;
  return rows;
}

async function getDealDetailRows() {
  if (cache.dealRows) return cache.dealRows;
  const rows = await loadCSV(FOLDER_IDS.dealDetail, 'Deal Detail');
  if (!rows.length) throw new Error('No Deal Detail CSV found in Drive.');
  cache.dealRows = buildDealRows(rows);
  return cache.dealRows;
}

async function getItemizedCostRows() {
  if (cache.itemizedRows) return cache.itemizedRows;
  const rows = await loadCSV(FOLDER_IDS.itemizedCosts, 'Itemized Costs');
  if (!rows.length) throw new Error('No Itemized Inventory Costs CSV found in Drive.');
  cache.itemizedRows = rows;
  return rows;
}

async function getDealPaymentRows() {
  if (cache.dealPayRows) return cache.dealPayRows;
  const rows = await loadCSV(FOLDER_IDS.dealPayments, 'Deal Payments');
  cache.dealPayRows = rows;
  return rows;
}

async function getLoanPaymentRows() {
  if (cache.loanPayRows) return cache.loanPayRows;
  const rows = await loadCSV(FOLDER_IDS.loanPayments, 'Loan Payments');
  cache.loanPayRows = rows;
  return rows;
}

async function getLeadsRows() {
  if (cache.leadsRows) return cache.leadsRows;

  // Try top-level leads folder first; if empty, recurse into platform sub-folders.
  let rows = await loadCSV(FOLDER_IDS.leads);  // silent — leads live in sub-folders

  if (!rows.length && isDriveAvailable()) {
    try {
      const subRes = await driveApiFetch('/files', {
        q: `'${FOLDER_IDS.leads}' in parents and trashed=false and mimeType = 'application/vnd.google-apps.folder'`,
        fields: 'files(id,name)', pageSize: '20',
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives',
      });
      const subFolders = (await subRes.json()).files || [];
      if (subFolders.length) {
        const subRowArrays = await Promise.all(
          subFolders.map(sf => loadCSV(sf.id, 'Leads / ' + sf.name))
        );
        rows = subRowArrays.flat();
        if (rows.length) {
          _ok('Leads (combined)', rows.length + ' rows across ' + subFolders.length + ' sub-folders');
        } else {
          _warn('Leads', 'no CSV files found in any sub-folder');
        }
      }
    } catch (e) {
      _err('Leads (sub-folders)', e.message);
    }
  }

  cache.leadsRows = rows;
  return rows;
}

async function getSalesLogData() {
  if (cache.salesLogData) return cache.salesLogData;

  // Sales - Live is an .xlsx file.
  // driveReadXLSX() fetches binary via alt=media, converts each sheet to CSV via SheetJS,
  // and returns them concatenated with "### SheetName" headers.
  // parseSalesLog() finds "Joseph-Cars" / "Felix-Cars" / "Kris-Cars" sheets by indexOf().

  let txt = '', loadedFrom = '';

  if (isDriveAvailable()) {
    // 1. Known file ID (fastest path)
    try {
      const raw = await driveReadXLSX(FILE_IDS.salesLog);
      if (raw && raw.length > 100) { txt = raw; loadedFrom = 'drive:id'; }
    } catch (e) {
      _err('Sales Log (xlsx by ID)', e.message);
    }

    // 2. Name search fallback
    if (!txt) {
      const f = await driveSearchByName(FILE_NAME_PATTERNS.salesLive);
      if (f) {
        try {
          const fn  = (f.name || '').toLowerCase();
          const raw = (fn.endsWith('.xlsx') || fn.endsWith('.xls'))
            ? await driveReadXLSX(f.id)
            : await driveRead(f.id);
          if (raw && raw.length > 100) { txt = raw; loadedFrom = 'drive:name:' + f.name; }
        } catch (e) {
          _err('Sales Log (by name "' + f.name + '")', e.message);
        }
      }
    }
  }

  const result = parseSalesLog(txt);
  result._loadedFrom = loadedFrom;

  if (!txt) {
    _warn('Sales Log', 'file not found or could not be read — SP breakdown will be empty');
  } else {
    const sheets = { joseph: result.joseph?.length || 0, felix: result.felix?.length || 0, kris: result.kris?.length || 0 };
    const empty  = Object.entries(sheets).filter(([,n]) => n === 0).map(([k]) => k);
    if (empty.length) {
      _warn('Sales Log', 'loaded via ' + loadedFrom +
        ' | Joseph:' + sheets.joseph + ' Felix:' + sheets.felix + ' Kris:' + sheets.kris +
        ' — empty sheets: ' + empty.join(', '));
    } else {
      _ok('Sales Log', 'via ' + loadedFrom +
        ' | Joseph:' + sheets.joseph + ' Felix:' + sheets.felix + ' Kris:' + sheets.kris + ' deals');
    }
  }

  cache.salesLogData = result;
  return result;
}

async function getWarrantyData() {
  if (cache.warrantyData) return cache.warrantyData;
  const rows    = await loadCSVByName('Warranty Remittance', FILE_NAME_PATTERNS.warranty, 'Remittance', 'Warranty');
  const totalDue = rows.reduce((s, r) => {
    const v = parseMoney(getField(r, 'total contract due', 'total due', 'contract due', 'amount due'));
    return s + (isNaN(v) ? 0 : v);
  }, 0);
  cache.warrantyData = { rows, totalDue };
  return cache.warrantyData;
}

async function getAccountingText() {
  if (cache.accountingText !== undefined) return cache.accountingText;

  // Accounting Package is an .xlsx file — convert via SheetJS so extractPLMetrics()
  // can do its regex/indexOf matching against the CSV-formatted cell values.
  let txt = '';
  if (isDriveAvailable()) {
    try {
      txt = await driveReadXLSX(FILE_IDS.accounting);
      if (txt && txt.length > 50) {
        // Count total non-empty lines across all sheets as a proxy for data density.
        const lines = txt.split('\n').filter(l => l.trim() && !l.startsWith('###')).length;
        _ok('Accounting Package', '"' + FILE_IDS.accounting + '" — ' + lines.toLocaleString() + ' data lines via SheetJS');
      } else {
        _warn('Accounting Package', 'xlsx parsed but result is empty');
        txt = '';
      }
    } catch (e) {
      _err('Accounting Package (xlsx)', e.message);
      // Last-resort: try plain text read (will get binary noise for xlsx but may still pattern-match)
      try { txt = await driveRead(FILE_IDS.accounting); } catch (_) {}
    }
  } else {
    _warn('Accounting Package', 'Drive not available (not signed in)');
  }

  cache.accountingText = txt;
  return txt;
}

async function getChaseText() {
  if (cache.chaseText !== undefined) return cache.chaseText;
  if (!isDriveAvailable()) {
    _warn('Chase 9532', 'Drive not available (not signed in)');
    cache.chaseText = '';
    return '';
  }
  const f = await driveSearchByName(FILE_NAME_PATTERNS.chase9532);
  if (f) {
    try {
      const txt = await driveRead(f.id);
      if (txt && txt.length > 50) {
        _ok('Chase 9532', '"' + f.name + '" — ' + txt.length.toLocaleString() + ' chars | mod ' + _modStr(f.modifiedTime));
        cache.chaseText = txt;
        return txt;
      }
    } catch (e) {
      _err('Chase 9532', '"' + f.name + '" — ' + e.message);
    }
  } else {
    _warn('Chase 9532', 'no file matching "' + FILE_NAME_PATTERNS.chase9532 + '" found in Drive');
  }
  cache.chaseText = '';
  return '';
}

// Westlake Flooring Paid Units — files live in the "Paid Units Report" sub-folder.
async function getWestlakePaidUnitsRows() {
  if (cache.westlakePaid) return cache.westlakePaid;
  if (!isDriveAvailable()) {
    _warn('Westlake Paid Units', 'Drive not available (not signed in)');
    cache.westlakePaid = [];
    return [];
  }
  let file = null;
  try {
    file = await driveSearchLatest(FOLDER_IDS.westlakePaidUnits);
    if (!file) {
      _warn('Westlake Paid Units', 'no file found in Paid Units Report sub-folder');
      cache.westlakePaid = [];
      return [];
    }
    const txt  = await driveRead(file.id);
    const rows = parseCSV(preprocessFlatCSV(txt));
    _ok('Westlake Paid Units', '"' + file.name + '" — ' + rows.length + ' rows | mod ' + _modStr(file.modifiedTime));
    cache.westlakePaid = rows;
    return rows;
  } catch (e) {
    _err('Westlake Paid Units', (file ? '"' + file.name + '" — ' : '') + e.message);
    cache.westlakePaid = [];
    return [];
  }
}

// Sold Inventory - Title Report
async function getTitlesRows() {
  if (cache.titlesRows) return cache.titlesRows;
  if (!isDriveAvailable()) {
    _warn('Titles Report', 'Drive not available (not signed in)');
    cache.titlesRows = [];
    return [];
  }
  let f = null;
  try {
    f = await driveSearchByName(FILE_NAME_PATTERNS.titlesReport)
     || await driveSearchByName('Title Report');
    if (!f) {
      _warn('Titles Report', 'no file matching "' + FILE_NAME_PATTERNS.titlesReport + '" found in Drive');
      cache.titlesRows = [];
      return [];
    }
    const txt  = await driveRead(f.id);
    const rows = parseCSV(preprocessFlatCSV(txt));
    _ok('Titles Report', '"' + f.name + '" — ' + rows.length + ' rows | mod ' + _modStr(f.modifiedTime));
    cache.titlesRows = rows;
    return rows;
  } catch (e) {
    _err('Titles Report', (f ? '"' + f.name + '" — ' : '') + e.message);
    cache.titlesRows = [];
    return [];
  }
}

// DTS Title Transfers — Module Reports - Title Transfers
async function getDTSRows() {
  if (cache.dtsRows) return cache.dtsRows;
  if (!isDriveAvailable()) {
    _warn('DTS Reports', 'Drive not available (not signed in)');
    cache.dtsRows = [];
    return [];
  }
  let file = null;
  try {
    file = await driveSearchLatest(FOLDER_IDS.dtsReports);
    if (!file) {
      _warn('DTS Reports', 'no file found in DTS Reports folder');
      cache.dtsRows = [];
      return [];
    }
    const txt  = await driveRead(file.id);
    const rows = parseCSV(preprocessFlatCSV(txt));
    _ok('DTS Reports', '"' + file.name + '" — ' + rows.length + ' rows | mod ' + _modStr(file.modifiedTime));
    cache.dtsRows = rows;
    return rows;
  } catch (e) {
    _err('DTS Reports', (file ? '"' + file.name + '" — ' : '') + e.message);
    cache.dtsRows = [];
    return [];
  }
}

'use strict';

// ══════════════════════════════════════════════
//  DATA — src/js/data.js
//  Unified data loading layer.
//
//  Priority per source:
//    1. Drive via OAuth  (direct Drive v3 REST — any browser with token)
//    2. Local files      (src/uploads/ — offline / no auth)
//
//  All results are cached in `cache` to avoid redundant fetches.
// ══════════════════════════════════════════════

const cache = {};  // raw data cache shared across pages

// ── Low-level local fetch ──
async function fetchLocal(path) {
  if (!path) return null;
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;  // file not found or server not running
  }
}

// ── Generic: Drive first (Cowork → OAuth), local files as final fallback ──
async function loadCSV(localKey, folderId) {
  // 1. Drive
  if (folderId && isDriveAvailable()) {
    try {
      const file = await driveSearchLatest(folderId);
      if (file?.id) {
        const txt = await driveRead(file.id);
        if (txt && txt.length > 50) return parseCSV(txt);
      }
    } catch (e) {}
  }
  // 2. Local files
  const localPath = LOCAL_FILES[localKey];
  if (localPath) {
    const txt = await fetchLocal(localPath);
    if (txt && txt.length > 50) return parseCSV(txt);
  }
  return [];
}

// ── Generic: Drive first (by file ID), local files as final fallback ──
async function loadText(localKey, fileId) {
  // 1. Drive
  if (fileId && isDriveAvailable()) {
    try { const txt = await driveRead(fileId); if (txt && txt.length > 50) return txt; } catch (e) {}
  }
  // 2. Local files
  const localPath = LOCAL_FILES[localKey];
  if (localPath) {
    const txt = await fetchLocal(localPath);
    if (txt && txt.length > 50) return txt;
  }
  return '';
}

// ── Generic: Drive first (by name search), local files as final fallback ──
async function loadCSVByName(localKey, ...nameFragments) {
  // 1. Drive
  if (isDriveAvailable()) {
    for (const frag of nameFragments) {
      const f = await driveSearchByName(frag);
      if (f?.id) {
        try {
          const txt = await driveRead(f.id);
          if (txt && txt.length > 50) return parseCSV(txt);
        } catch (e) {}
      }
    }
  }
  // 2. Local files
  const localPath = LOCAL_FILES[localKey];
  if (localPath) {
    const txt = await fetchLocal(localPath);
    if (txt && txt.length > 50) return parseCSV(txt);
  }
  return [];
}

// ── Named loaders (cached) ──

async function getInventoryRows() {
  if (cache.inventoryRows) return cache.inventoryRows;
  const rows = await loadCSV('inventory', FOLDER_IDS.inventory);
  if (!rows.length) throw new Error('No inventory report found.');
  cache.inventoryRows = rows;
  return rows;
}

async function getDealDetailRows() {
  if (cache.dealRows) return cache.dealRows;
  const rows = await loadCSV('dealDetail', FOLDER_IDS.dealDetail);
  if (!rows.length) throw new Error('No Deal Detail CSV found.');
  cache.dealRows = buildDealRows(rows);
  return cache.dealRows;
}

async function getItemizedCostRows() {
  if (cache.itemizedRows) return cache.itemizedRows;
  const rows = await loadCSV('itemizedCosts', FOLDER_IDS.itemizedCosts);
  if (!rows.length) throw new Error('No Itemized Inventory Costs CSV found.');
  cache.itemizedRows = rows;
  return rows;
}

async function getDealPaymentRows() {
  if (cache.dealPayRows) return cache.dealPayRows;
  const rows = await loadCSV('dealPayments', FOLDER_IDS.dealPayments);
  cache.dealPayRows = rows;
  return rows;
}

async function getLeadsRows() {
  if (cache.leadsRows) return cache.leadsRows;
  let rows = await loadCSV('leads', FOLDER_IDS.leads);
  // Leads may be organized in platform subfolders (Cars.Com, Autotrader, etc.)
  // If nothing found at the top level, search one level into every subfolder and combine
  if (!rows.length && isDriveAvailable()) {
    try {
      const subRes = await driveApiFetch('/files', {
        q: `'${FOLDER_IDS.leads}' in parents and trashed=false and mimeType = 'application/vnd.google-apps.folder'`,
        fields: 'files(id,name)', pageSize: '20',
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives',
      });
      const subFolders = (await subRes.json()).files || [];
      if (subFolders.length) {
        const subRowArrays = await Promise.all(subFolders.map(sf => loadCSV('leads', sf.id)));
        rows = subRowArrays.flat();
      }
    } catch (e) { /* ignore */ }
  }
  cache.leadsRows = rows;
  return rows;
}

async function getSalesLogData() {
  if (cache.salesLogData) return cache.salesLogData;

  let txt = '', loadedFrom = '';

  // 1. Drive by file ID (Cowork → OAuth)
  if (!txt && isDriveAvailable()) {
    try { txt = await driveRead(FILE_IDS.salesLog); if (txt?.length > 100) loadedFrom = 'drive:id'; } catch (e) {}
  }

  // 2. Drive by name search
  if (!txt && isDriveAvailable()) {
    const f = await driveSearchByName(FILE_NAME_PATTERNS.salesLive);
    if (f?.id) {
      try { txt = await driveRead(f.id); if (txt?.length > 100) loadedFrom = 'drive:name:' + f.name; } catch (e) {}
    }
  }

  // 3. Local file
  if (!txt) {
    const localPath = LOCAL_FILES.salesLog;
    if (localPath) {
      const local = await fetchLocal(localPath);
      if (local && local.length > 100) { txt = local; loadedFrom = 'local'; }
    }
  }

  const result     = parseSalesLog(txt);
  result._loadedFrom = loadedFrom;
  result._debug    = (result._debug || '') + (loadedFrom ? ` via ${loadedFrom}` : '');
  cache.salesLogData = result;
  return result;
}

async function getWarrantyData() {
  if (cache.warrantyData) return cache.warrantyData;
  const rows = await loadCSVByName('warranty', FILE_NAME_PATTERNS.warranty, 'Remittance', 'Warranty');
  const totalDue = rows.reduce((s, r) => {
    const v = parseMoney(getField(r, 'total contract due', 'total due', 'contract due', 'amount due'));
    return s + (isNaN(v) ? 0 : v);
  }, 0);
  cache.warrantyData = { rows, totalDue };
  return cache.warrantyData;
}

async function getAccountingText() {
  if (cache.accountingText !== undefined) return cache.accountingText;
  const txt = await loadText('accounting', FILE_IDS.accounting);
  cache.accountingText = txt;
  return txt;
}

async function getChaseText() {
  if (cache.chaseText !== undefined) return cache.chaseText;
  const txt = await loadCSVByName('chase9532', FILE_NAME_PATTERNS.chase9532, 'Chase9532', 'Chase Checking');
  // loadCSVByName returns rows — for chase we want raw text for custom parsing, so re-fetch as text
  const localPath = LOCAL_FILES.chase9532;
  if (localPath) {
    const local = await fetchLocal(localPath);
    if (local && local.length > 50) { cache.chaseText = local; return local; }
  }
  // fallback: re-stringify parsed rows (not ideal but functional)
  cache.chaseText = '';
  return '';
}

async function getLoanPaymentRows() {
  if (cache.loanPayRows) return cache.loanPayRows;
  const rows = await loadCSV('loanPayments', FOLDER_IDS.loanPayments);
  cache.loanPayRows = rows;
  return rows;
}

// Westlake Flooring Paid Units — cross-checks against Itemized Costs for flooring To-Do flag
async function getWestlakePaidUnitsRows() {
  if (cache.westlakePaid) return cache.westlakePaid;
  try {
    const file = await driveSearchLatest(FOLDER_IDS.westlakeFlooring);
    if (!file) { cache.westlakePaid = []; return []; }
    const txt = await driveRead(file.id);
    cache.westlakePaid = parseCSV(preprocessFlatCSV(txt));
    return cache.westlakePaid;
  } catch (e) { cache.westlakePaid = []; return []; }
}

// Titles Report — "Sold Inventory - Title Report (New) - <timestamp>.csv"
// Lives in: Autoport Shared > 5. AP - Accounting > 1. Accounting > Reports > Titles
// Always picks the most-recently-modified file matching the name pattern.
async function getTitlesRows() {
  if (cache.titlesRows) return cache.titlesRows;
  try {
    const f = await driveSearchByName(FILE_NAME_PATTERNS.titlesReport)
           || await driveSearchByName('Title Report');
    if (!f) { cache.titlesRows = []; return []; }
    const txt = await driveRead(f.id);
    cache.titlesRows = parseCSV(preprocessFlatCSV(txt));
    return cache.titlesRows;
  } catch (e) { cache.titlesRows = []; return []; }
}

// DTS Title Transfers — "Module Reports - Title Transfers - <timestamp>.csv"
// Lives in: FOLDER_IDS.dtsReports — always picks the most-recently-modified file.
async function getDTSRows() {
  if (cache.dtsRows) return cache.dtsRows;
  try {
    const file = await driveSearchLatest(FOLDER_IDS.dtsReports);
    if (!file) { cache.dtsRows = []; return []; }
    const txt = await driveRead(file.id);
    cache.dtsRows = parseCSV(preprocessFlatCSV(txt));
    return cache.dtsRows;
  } catch (e) { cache.dtsRows = []; return []; }
}

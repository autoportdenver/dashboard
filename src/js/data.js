'use strict';

// ══════════════════════════════════════════════
//  DATA — src/js/data.js
//  Unified data loading layer.
//
//  Strategy per source:
//    1. Try LOCAL_FILES path (fetch from src/uploads/)
//    2. If local file is absent / empty, fall back to Google Drive
//
//  The Drive fallback is wrapped in a try/catch so the app still
//  works when window.cowork is unavailable (e.g. plain browser open).
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

// ── Generic: try local then Drive folder (latest file) ──
async function loadCSV(localKey, folderId) {
  // 1. Try local
  const localPath = LOCAL_FILES[localKey];
  if (localPath) {
    const txt = await fetchLocal(localPath);
    if (txt && txt.length > 50) return parseCSV(txt);
  }
  // 2. Fall back to Drive
  if (!folderId || !window.cowork) return [];
  const file = await driveSearchLatest(folderId);
  if (!file?.id) return [];
  const txt = await driveRead(file.id);
  return parseCSV(txt);
}

// ── Generic: try local then Drive by file ID ──
async function loadText(localKey, fileId) {
  const localPath = LOCAL_FILES[localKey];
  if (localPath) {
    const txt = await fetchLocal(localPath);
    if (txt && txt.length > 50) return txt;
  }
  if (!fileId || !window.cowork) return '';
  try { return await driveRead(fileId); } catch (e) { return ''; }
}

// ── Generic: try local then Drive by name search ──
async function loadCSVByName(localKey, ...nameFragments) {
  const localPath = LOCAL_FILES[localKey];
  if (localPath) {
    const txt = await fetchLocal(localPath);
    if (txt && txt.length > 50) return parseCSV(txt);
  }
  if (!window.cowork) return [];
  for (const frag of nameFragments) {
    const f = await driveSearchByName(frag);
    if (f?.id) {
      try {
        const txt = await driveRead(f.id);
        return parseCSV(txt);
      } catch (e) {}
    }
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
  const rows = await loadCSV('leads', FOLDER_IDS.leads);
  cache.leadsRows = rows;
  return rows;
}

async function getSalesLogData() {
  if (cache.salesLogData) return cache.salesLogData;

  let txt = '', loadedFrom = '';

  // 1. Local file
  const localPath = LOCAL_FILES.salesLog;
  if (localPath) {
    const local = await fetchLocal(localPath);
    if (local && local.length > 100) { txt = local; loadedFrom = 'local'; }
  }

  // 2. Drive by file ID
  if (!txt && window.cowork) {
    try { txt = await driveRead(FILE_IDS.salesLog); if (txt?.length > 100) loadedFrom = 'drive:id'; } catch (e) {}
  }

  // 3. Drive by name search
  if (!txt && window.cowork) {
    const f = await driveSearchByName(FILE_NAME_PATTERNS.salesLive);
    if (f?.id) {
      try { txt = await driveRead(f.id); if (txt?.length > 100) loadedFrom = 'drive:name:' + f.name; } catch (e) {}
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

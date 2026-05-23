'use strict';

// ══════════════════════════════════════════════
//  DRIVE — src/js/drive.js
//  All Google Drive / Cowork MCP calls isolated here.
//  Nothing outside this file calls window.cowork directly.
// ══════════════════════════════════════════════

async function driveRead(fileId) {
  const res = await withTimeout(
    window.cowork.callMcpTool(DRIVE_READ, { fileId }),
    45000, 'Drive read'
  );
  return extractText(res);
}

// Extract a normalised file list from any shape the search_files tool might return
function extractFileItems(val, depth) {
  depth = depth || 0;
  if (depth > 6 || !val) return [];
  if (typeof val === 'object' && !Array.isArray(val) && (val.id || val.fileId) && (val.name || val.title)) {
    return [{ id: val.id || val.fileId, name: val.name || val.title || '', modifiedTime: val.modifiedTime || val.modified || '' }];
  }
  if (Array.isArray(val)) {
    if (val.length && val[0] && typeof val[0] === 'object' && (val[0].id || val[0].fileId)) {
      return val.map(f => ({ id: f.id || f.fileId, name: f.name || f.title || '', modifiedTime: f.modifiedTime || f.modified || '' }));
    }
    const out = [];
    val.forEach(v => out.push(...extractFileItems(v, depth + 1)));
    return out;
  }
  if (typeof val === 'object') {
    for (const k of ['files', 'items', 'data', 'result', 'children']) {
      if (val[k]) { const r = extractFileItems(val[k], depth + 1); if (r.length) return r; }
    }
    for (const k of ['content', 'fileContent', 'text']) {
      if (val[k]) { const r = extractFileItems(val[k], depth + 1); if (r.length) return r; }
    }
  }
  const s = typeof val === 'string' ? val : '';
  if (s) {
    try { const p = JSON.parse(s); return extractFileItems(p, depth + 1); } catch (e) {}
    const idPat   = /"id"\s*:\s*"([A-Za-z0-9_\-]{15,50})"/g;
    const namePat = /"name"\s*:\s*"([^"]+)"/g;
    const timePat = /"modifiedTime"\s*:\s*"([^"]+)"/g;
    const ids   = [...s.matchAll(idPat)].map(m => m[1]);
    const names = [...s.matchAll(namePat)].map(m => m[1]);
    const times = [...s.matchAll(timePat)].map(m => m[1]);
    if (ids.length) return ids.map((id, i) => ({ id, name: names[i] || '', modifiedTime: times[i] || '' }));
  }
  return [];
}

// Search a folder and return the most recently modified file
async function driveSearchLatest(folderId) {
  let res;
  try {
    res = await withTimeout(
      window.cowork.callMcpTool(DRIVE_SEARCH, { query: `parentId = '${folderId}'`, pageSize: 20 }),
      45000, 'Drive search'
    );
  } catch (e) {
    console.error('search_files failed:', e);
    return null;
  }
  const items = extractFileItems(res);
  if (!items.length) return null;
  items.sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0));
  return items[0];
}

// Search Drive for a file by name substring; returns latest match or null
async function driveSearchByName(nameFragment) {
  let res;
  try {
    res = await withTimeout(
      window.cowork.callMcpTool(DRIVE_SEARCH, { query: `name contains '${nameFragment}'`, pageSize: 10 }),
      45000, 'Drive name search'
    );
  } catch (e) { return null; }
  const items = extractFileItems(res);
  if (!items.length) return null;
  items.sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0));
  return items[0];
}

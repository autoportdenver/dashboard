'use strict';

// ══════════════════════════════════════════════
//  DRIVE — src/js/drive.js
//
//  Priority order for every Drive call:
//    1. Cowork MCP  (window.cowork — inside Cowork desktop app)
//    2. Google OAuth (direct Drive v3 REST API — any browser)
//    3. Local files  (src/uploads/ — handled in data.js as final fallback)
//
//  Auth:
//    GIS library loaded synchronously in index.html.
//    initDriveAuth()  — call once on page load.
//    requestDriveAccess() — call from a user-gesture button.
//    onDriveReady()   — defined in dashboard.js; called after token granted.
// ══════════════════════════════════════════════

// ── Cowork MCP tool identifiers ──
const DRIVE_READ_MCP   = 'mcp__d97b1518-9016-4011-a420-7ec2458ff224__read_file_content';
const DRIVE_SEARCH_MCP = 'mcp__d97b1518-9016-4011-a420-7ec2458ff224__search_files';

// ── OAuth ──
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_API   = 'https://www.googleapis.com/drive/v3';

let _accessToken = null;
let _tokenClient = null;

function initDriveAuth() {
  if (typeof google === 'undefined' || !google.accounts) {
    setTimeout(initDriveAuth, 200);  // GIS not ready yet — retry
    return;
  }
  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope:     DRIVE_SCOPE,
    callback:  function (resp) {
      if (resp.error) { console.error('Drive auth error:', resp.error); return; }
      _accessToken = resp.access_token;
      onDriveReady();  // defined in dashboard.js
    },
  });
}

function requestDriveAccess() {
  if (!_tokenClient) initDriveAuth();
  _tokenClient.requestAccessToken({ prompt: '' });
}

function isDriveAvailable() {
  return !!(window.cowork || _accessToken);
}

// ── Cowork MCP helpers (parse varied response shapes) ──
function extractFileItems(val, depth) {
  depth = depth || 0;
  if (depth > 6 || !val) return [];
  if (typeof val === 'object' && !Array.isArray(val) && (val.id || val.fileId) && (val.name || val.title)) {
    return [{ id: val.id || val.fileId, name: val.name || val.title || '', modifiedTime: val.modifiedTime || '' }];
  }
  if (Array.isArray(val)) {
    if (val.length && val[0] && typeof val[0] === 'object' && (val[0].id || val[0].fileId)) {
      return val.map(f => ({ id: f.id || f.fileId, name: f.name || f.title || '', modifiedTime: f.modifiedTime || '' }));
    }
    const out = [];
    val.forEach(v => out.push(...extractFileItems(v, depth + 1)));
    return out;
  }
  if (typeof val === 'object') {
    for (const k of ['files', 'items', 'data', 'result', 'children', 'content', 'fileContent', 'text']) {
      if (val[k]) { const r = extractFileItems(val[k], depth + 1); if (r.length) return r; }
    }
  }
  const s = typeof val === 'string' ? val : '';
  if (s) {
    try { return extractFileItems(JSON.parse(s), depth + 1); } catch (e) {}
    const ids   = [...s.matchAll(/"id"\s*:\s*"([A-Za-z0-9_\-]{15,50})"/g)].map(m => m[1]);
    const names = [...s.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
    const times = [...s.matchAll(/"modifiedTime"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
    if (ids.length) return ids.map((id, i) => ({ id, name: names[i] || '', modifiedTime: times[i] || '' }));
  }
  return [];
}

function sortByModified(items) {
  return items.sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0));
}

// ── OAuth raw fetch ──
async function driveApiFetch(path, params) {
  const url = DRIVE_API + path + (params ? '?' + new URLSearchParams(params) : '');
  const res  = await fetch(url, { headers: { Authorization: 'Bearer ' + _accessToken } });
  if (res.status === 401) { _accessToken = null; throw new Error('Drive session expired — please reconnect.'); }
  if (!res.ok) { const b = await res.text().catch(() => ''); throw new Error('Drive ' + res.status + ': ' + b.substring(0, 200)); }
  return res;
}

// ══════════════════════════════════════════════
//  PUBLIC API
// ══════════════════════════════════════════════

async function driveRead(fileId) {
  // 1. Cowork MCP
  if (window.cowork) {
    try {
      const res = await withTimeout(window.cowork.callMcpTool(DRIVE_READ_MCP, { fileId }), 45000, 'Drive read');
      const txt = extractText(res);
      if (txt) return txt;
    } catch (e) { /* fall through */ }
  }
  // 2. OAuth
  if (_accessToken) {
    const res = await driveApiFetch('/files/' + fileId, { alt: 'media' });
    return res.text();
  }
  throw new Error('Drive: not authenticated');
}

async function driveSearchLatest(folderId) {
  // 1. Cowork MCP
  if (window.cowork) {
    try {
      const res   = await withTimeout(
        window.cowork.callMcpTool(DRIVE_SEARCH_MCP, { query: `parentId = '${folderId}'`, pageSize: 20 }),
        45000, 'Drive search'
      );
      const items = extractFileItems(res);
      if (items.length) return sortByModified(items)[0];
    } catch (e) { /* fall through */ }
  }
  // 2. OAuth
  if (_accessToken) {
    try {
      const res  = await driveApiFetch('/files', {
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id,name,modifiedTime)', pageSize: '20',
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives',
      });
      const data  = await res.json();
      return sortByModified(data.files || [])[0] || null;
    } catch (e) { return null; }
  }
  return null;
}

async function driveSearchByName(nameFragment) {
  // 1. Cowork MCP — uses 'title contains' (MCP quirk)
  if (window.cowork) {
    try {
      const res   = await withTimeout(
        window.cowork.callMcpTool(DRIVE_SEARCH_MCP, { query: `title contains '${nameFragment}'`, pageSize: 10 }),
        45000, 'Drive name search'
      );
      const items = extractFileItems(res);
      if (items.length) return sortByModified(items)[0];
    } catch (e) { /* fall through */ }
  }
  // 2. OAuth — uses 'name contains' (Drive v3 standard)
  if (_accessToken) {
    try {
      const safe = nameFragment.replace(/'/g, "\\'");
      const res  = await driveApiFetch('/files', {
        q: `name contains '${safe}' and trashed=false`,
        fields: 'files(id,name,modifiedTime)', pageSize: '10',
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives',
      });
      const data  = await res.json();
      return sortByModified(data.files || [])[0] || null;
    } catch (e) { return null; }
  }
  return null;
}

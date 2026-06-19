'use strict';

// ══════════════════════════════════════════════
//  DRIVE — src/js/drive.js
//
//  Priority order for every Drive call:
//    1. Google OAuth (direct Drive v3 REST API — any browser)
//    2. Local files  (src/uploads/ — handled in data.js as final fallback)
//
//  Auth:
//    GIS library loaded synchronously in index.html.
//    initDriveAuth()  — call once on page load.
//    requestDriveAccess() — call from a user-gesture button.
//    onDriveReady()   — defined in dashboard.js; called after token granted.
// ══════════════════════════════════════════════

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
  return !!_accessToken;
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
  if (!_accessToken) throw new Error('Drive: not authenticated');

  // Try direct download first (works for uploaded CSV/binary files)
  const mediaUrl = DRIVE_API + '/files/' + fileId + '?' + new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' });
  const res = await fetch(mediaUrl, { headers: { Authorization: 'Bearer ' + _accessToken } });

  if (res.status === 401) { _accessToken = null; throw new Error('Drive session expired — please reconnect.'); }
  if (res.ok) return res.text();

  // Google Sheets/Docs can't use alt=media — fall back to CSV export
  const body = await res.json().catch(() => ({}));
  if (res.status === 403 && body?.error?.errors?.[0]?.reason === 'fileNotDownloadable') {
    const exportRes = await driveApiFetch('/files/' + fileId + '/export', { mimeType: 'text/csv', supportsAllDrives: 'true' });
    return exportRes.text();
  }

  const msg = body?.error?.message || '';
  console.error('Drive read error', res.status, fileId, body);
  throw new Error('Drive ' + res.status + ': ' + msg.substring(0, 200));
}

async function driveSearchLatest(folderId) {
  if (_accessToken) {
    try {
      const res  = await driveApiFetch('/files', {
        q: `'${folderId}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'`,
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

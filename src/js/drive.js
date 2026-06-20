'use strict';

// ══════════════════════════════════════════════
//  DRIVE — src/js/drive.js
//
//  Google OAuth only — no Cowork bridge, no local files.
//  Data source: Google Drive v3 REST API.
//
//  Auth flow:
//    1. index.html loads the GIS script synchronously.
//    2. initDriveAuth() sets up the token client (called once on page load).
//    3. User clicks "Sign in with Google" → requestDriveAccess() opens popup.
//    4. OAuth callback stores _accessToken and calls onDriveReady() (dashboard.js).
// ══════════════════════════════════════════════

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_API   = 'https://www.googleapis.com/drive/v3';

let _accessToken = null;
let _tokenClient = null;

// ── Auth ──

function initDriveAuth() {
  if (typeof google === 'undefined' || !google.accounts) {
    setTimeout(initDriveAuth, 200);
    return;
  }
  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope:     DRIVE_SCOPE,
    callback:  function (resp) {
      if (resp.error) { console.error('[AutoPort Drive] Auth error:', resp.error); return; }
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

// ── Low-level OAuth fetch ──

async function driveApiFetch(path, params) {
  const url = DRIVE_API + path + (params ? '?' + new URLSearchParams(params) : '');
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + _accessToken } });
  if (res.status === 401) {
    _accessToken = null;
    throw new Error('Drive session expired — please sign in again.');
  }
  if (!res.ok) {
    const b = await res.text().catch(() => '');
    throw new Error('Drive ' + res.status + ': ' + b.substring(0, 200));
  }
  return res;
}

// ══════════════════════════════════════════════
//  PUBLIC API
// ══════════════════════════════════════════════

// Read a file by ID and return its text content.
// For native Google Sheets/Docs (fileNotDownloadable) falls back to CSV export.
async function driveRead(fileId) {
  if (!_accessToken) throw new Error('Drive: not authenticated — click "Sign in with Google".');

  const mediaUrl = DRIVE_API + '/files/' + fileId + '?' + new URLSearchParams({
    alt: 'media',
    supportsAllDrives: 'true',
  });
  const res = await fetch(mediaUrl, { headers: { Authorization: 'Bearer ' + _accessToken } });

  if (res.status === 401) { _accessToken = null; throw new Error('Drive session expired — please sign in again.'); }
  if (res.ok) return res.text();

  // Native Google Sheets/Docs cannot be downloaded as binary — export as CSV instead.
  const body = await res.json().catch(() => ({}));
  if (res.status === 403 && body?.error?.errors?.[0]?.reason === 'fileNotDownloadable') {
    const exportRes = await driveApiFetch('/files/' + fileId + '/export', {
      mimeType: 'text/csv',
      supportsAllDrives: 'true',
    });
    return exportRes.text();
  }

  throw new Error('Drive ' + res.status + ': ' + (body?.error?.message || '').substring(0, 200));
}

// Read a binary .xlsx/.xls file by ID and return all sheets as concatenated CSV flat text.
//
// Output format:
//   ### SheetName\n
//   col1,col2,...\n
//   val1,val2,...\n
//   \n
//   ### NextSheet\n
//   ...
//
// parseSalesLog()     — searches for "Joseph-Cars" etc. by indexOf → matches ### headers.
// extractPLMetrics()  — uses regex/indexOf on row values → matches CSV cell text.
// Dates are emitted as M/D/YYYY to match parseDate()'s new Date(s) expectation.
async function driveReadXLSX(fileId) {
  if (!_accessToken) throw new Error('Drive: not authenticated — click "Sign in with Google".');
  if (typeof XLSX === 'undefined') throw new Error('SheetJS not loaded — check the <script> tag in index.html.');

  const mediaUrl = DRIVE_API + '/files/' + fileId + '?' + new URLSearchParams({
    alt: 'media',
    supportsAllDrives: 'true',
  });
  const res = await fetch(mediaUrl, { headers: { Authorization: 'Bearer ' + _accessToken } });

  if (res.status === 401) { _accessToken = null; throw new Error('Drive session expired — please sign in again.'); }
  if (!res.ok) {
    const b = await res.text().catch(() => '');
    throw new Error('Drive XLSX ' + res.status + ': ' + b.substring(0, 200));
  }

  const buf = await res.arrayBuffer();
  const wb  = XLSX.read(buf, { type: 'array', cellDates: true });

  console.log('[AutoPort Drive] XLSX sheets in ' + fileId + ': ' + wb.SheetNames.join(', '));
  return wb.SheetNames.map(name => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], {
      dateNF:    'M/D/YYYY',  // e.g. "6/17/2026" — parseDate(new Date(s)) handles this
      blankrows: false,
    });
    return '### ' + name + '\n' + csv;
  }).join('\n');
}

// Return the most-recently-modified non-folder file inside a Drive folder.
async function driveSearchLatest(folderId) {
  if (!_accessToken) return null;
  try {
    const res = await driveApiFetch('/files', {
      q: `'${folderId}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'`,
      fields:    'files(id,name,modifiedTime)',
      pageSize:  '20',
      orderBy:   'modifiedTime desc',
      supportsAllDrives:        'true',
      includeItemsFromAllDrives:'true',
      corpora:   'allDrives',
    });
    const data  = await res.json();
    const files = (data.files || []).sort(
      (a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0)
    );
    return files[0] || null;
  } catch (e) {
    console.warn('[AutoPort Drive] driveSearchLatest error for folder', folderId, e.message);
    return null;
  }
}

// Return the most-recently-modified file whose name contains nameFragment.
async function driveSearchByName(nameFragment) {
  if (!_accessToken) return null;
  try {
    const safe = nameFragment.replace(/'/g, "\\'");
    const res  = await driveApiFetch('/files', {
      q: `name contains '${safe}' and trashed=false`,
      fields:    'files(id,name,modifiedTime)',
      pageSize:  '10',
      orderBy:   'modifiedTime desc',
      supportsAllDrives:        'true',
      includeItemsFromAllDrives:'true',
      corpora:   'allDrives',
    });
    const data  = await res.json();
    const files = (data.files || []).sort(
      (a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0)
    );
    return files[0] || null;
  } catch (e) {
    console.warn('[AutoPort Drive] driveSearchByName error for', nameFragment, e.message);
    return null;
  }
}

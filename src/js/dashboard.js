'use strict';

// ══════════════════════════════════════════════
//  DASHBOARD — src/js/dashboard.js
//  Application state, navigation, global UI
//  handlers, and initialisation.
//
//  Script load order in index.html:
//    config.js → utils.js → drive.js → parsers.js
//    → data.js → pages/home.js → pages/metrics.js
//    → pages/financial.js → pages/cashflow.js
//    → pages/repair.js → pages/meetings.js
//    → dashboard.js   (this file, last)
// ══════════════════════════════════════════════

// ── Application state ──
const loaded = {};   // { pageName: true } — lazy-load guard

// Repair tracker (in-memory — resets on reload)
let repairNotes      = {};  // stock# -> note string
let repairDone       = {};  // stock# -> bool (legacy, unused)
let repairStatus     = {};  // stock# -> 'Not Started'|'Waiting on Parts'|'In Progress'|'Complete'
let repairStars      = {};  // stock# -> bool
let repairDeleted    = {};  // stock# -> bool
let repairExpanded   = {};  // stock# -> bool
let repairDifficulty = {};  // stock# -> 1|2|3 (wrench count)
let repairSortMode   = 'stars';

// Financial
let floorCreditLimit = 0;
let txCategories     = {};  // `${date}|${amount}|${desc}` -> category string

// Meetings (in-memory — resets on reload)
let meetingNotesStore   = {};  // weekKey -> { notes, goals, wins, losses }
let selectedWeek        = null;
let calMonth            = new Date();
let selectedMonthOffset = 0;

// Keep-in-mind note (persists across page switches)
let keepInMind = 'Add notes that should stay top-of-mind for the team…';
function saveKeepInMind() {
  keepInMind = document.getElementById('keep-in-mind').innerText;
  window.sendPrompt && window.sendPrompt('Save keep-in-mind note: ' + keepInMind.substring(0, 200));
}

// ── Navigation ──
const PAGE_LOADERS = {
  home:      loadHome,
  metrics:   loadMetrics,
  repair:    loadRepair,
  meetings:  loadMeetings,
  inventory: loadInventory,
};

function showPage(name) {
  // Hero: visible only on home page
  const hero = document.getElementById('hero');
  if (hero) hero.classList.toggle('hidden', name !== 'home');

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const btns = document.querySelectorAll('.nav-btn');
  const idx  = Object.keys(PAGE_LOADERS).indexOf(name);
  if (btns[idx]) btns[idx].classList.add('active');
  if (!loaded[name]) {
    loaded[name] = true;
    PAGE_LOADERS[name]().catch(err => {
      document.getElementById(name + '-body').innerHTML = errorBox(err.message || String(err));
    });
  }
}

// ── Update Log (live data-freshness dropdown) ──
let _updPanelLoaded = false;
function toggleUpdPanel() {
  const panel = document.getElementById('upd-panel');
  if (!panel) return;
  const isOpen = panel.classList.toggle('open');
  if (isOpen && !_updPanelLoaded) {
    _updPanelLoaded = true;
    loadUpdPanel();
  }
}
document.addEventListener('click', e => {
  const panel = document.getElementById('upd-panel');
  const btn   = document.getElementById('upd-btn');
  if (panel && panel.classList.contains('open') && btn && !panel.contains(e.target) && !btn.contains(e.target)) {
    panel.classList.remove('open');
  }
});
async function loadUpdPanel() {
  const rowsEl = document.getElementById('upd-rows'); if (!rowsEl) return;
  const today  = new Date();
  function ageLabel(modStr) {
    if (!modStr) return ['—', 'warn'];
    const d = new Date(modStr);
    const days = Math.floor((today - d) / 86400000);
    const label = days === 0 ? 'Today' : days === 1 ? '1 day ago' : days + 'd ago';
    const cls   = days <= 3 ? 'ok' : days <= 10 ? 'warn' : 'old';
    return [label, cls];
  }
  function fmtDate(s) {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  }
  const sources = [
    { name: 'Inventory Report',   folderId: FOLDER_IDS.inventory },
    { name: 'Deal Detail',        folderId: FOLDER_IDS.dealDetail },
    { name: 'Itemized Costs',     folderId: FOLDER_IDS.itemizedCosts },
    { name: 'Deal Payments',      folderId: FOLDER_IDS.dealPayments },
    { name: 'Title Report',       searchName: 'Sold Inventory - Title Report' },
    { name: 'DTS Reports',        folderId: FOLDER_IDS.dtsReports },
    { name: 'Sales Log',          fileId: FILE_IDS.salesLog },
    { name: 'Accounting Package', fileId: FILE_IDS.accounting },
  ];
  const results = await Promise.allSettled(sources.map(async src => {
    if (src.fileId) {
      return { name: src.name, modTime: null, note: 'File ID known' };
    } else if (src.searchName) {
      const f = await driveSearchByName(src.searchName);
      return { name: src.name, modTime: f ? f.modifiedTime : null };
    } else {
      const f = await driveSearchLatest(src.folderId);
      return { name: src.name, modTime: f ? f.modifiedTime : null, fileName: f ? (f.name || f.title) : null };
    }
  }));
  rowsEl.innerHTML = results.map(r => {
    const d = r.status === 'fulfilled' ? r.value : { name: '?', modTime: null };
    const [ageStr, ageCls] = ageLabel(d.modTime);
    return '<div class="upd-row">' +
      '<span class="upd-src">' + d.name + (d.fileName ? '<br><span style="font-size:9px;color:rgba(140,170,220,.38)">' + d.fileName + '</span>' : '') + '</span>' +
      '<span class="upd-date">' + fmtDate(d.modTime) + '</span>' +
      '<span class="upd-age ' + ageCls + '">' + ageStr + '</span>' +
      '</div>';
  }).join('');
}

// ── Global UI helpers ──
window.setFloorLimit = function (val) {
  const n = parseFloat(String(val).replace(/[$,\s]/g, ''));
  floorCreditLimit = isNaN(n) ? 0 : n;
  const card = document.getElementById('floor-avail-card');
  if (!card) return;
  const avail = floorCreditLimit > 0 ? floorCreditLimit - (window._currentFloorBalance || 0) : null;
  card.style.background = floorCreditLimit > 0 ? '#f0fdf4' : 'var(--card2)';
  card.style.border = `2px solid ${floorCreditLimit > 0 ? 'var(--green)' : 'var(--border)'}`;
  card.innerHTML = `
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:${floorCreditLimit > 0 ? 'var(--green)' : 'var(--muted)'};margin-bottom:4px">AVAILABLE CAPACITY</div>
    <div style="font-size:28px;font-weight:800;color:${floorCreditLimit > 0 ? 'var(--green)' : 'var(--muted)'}">
      ${floorCreditLimit > 0 ? fmt$(avail) : '—'}
    </div>
    <div style="font-size:11px;color:var(--muted);margin-top:3px">
      ${floorCreditLimit > 0
        ? `Credit line: <b>${fmt$(floorCreditLimit)}</b> · ${Math.round((window._currentFloorBalance || 0) / floorCreditLimit * 100)}% used`
        : 'Enter credit line above'}
    </div>`;
};

// ── Drive auth callback — called by drive.js after OAuth token is granted ──
function onDriveReady() {
  // Hide auth gate and load home if not already loaded
  const gate = document.getElementById('auth-gate');
  if (gate) gate.style.display = 'none';
  if (!loaded.home) {
    loaded.home = true;
    loadHome().catch(err => {
      document.getElementById('home-body').innerHTML = errorBox(err.message || String(err));
    });
  }
}

// ── Init ──
(function init() {
  document.getElementById('hdr-date').textContent =
    new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Set up OAuth token client (GIS library already loaded synchronously)
  initDriveAuth();

  // auth-gate remains visible until user clicks "Sign in with Google"
  // (no silent auth attempt — avoids the brief popup flash on every reload)
})();

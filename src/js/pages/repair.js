'use strict';

// ══════════════════════════════════════════════
//  PAGE: REPAIR — src/js/pages/repair.js
// ══════════════════════════════════════════════

async function loadRepair() {
  const el = document.getElementById('repair-body');
  el.innerHTML = loading('Loading active inventory…');
  const [invR] = await Promise.allSettled([getInventoryRows()]);
  if (invR.status === 'rejected') { el.innerHTML = errorBox(invR.reason?.message || String(invR.reason)); return; }
  renderRepair(el, invR.value);
}

function renderRepair(el, invRows) {
  // ── Restore persisted state from localStorage ──
  // Runs before any render so saved notes/status/stars survive page reloads and
  // new Inventory report drops. Keyed by stock# so new vehicles start fresh.
  (function loadRepairState() {
    try {
      const saved = localStorage.getItem('autoport_repair_state');
      if (!saved) return;
      const d = JSON.parse(saved);
      if (d.notes)      Object.assign(repairNotes,      d.notes);
      if (d.status)     Object.assign(repairStatus,     d.status);
      if (d.stars)      Object.assign(repairStars,      d.stars);
      if (d.deleted)    Object.assign(repairDeleted,    d.deleted);
      if (d.difficulty) Object.assign(repairDifficulty, d.difficulty);
      if (d.sortMode)   repairSortMode = d.sortMode;
    } catch (e) { /* corrupted data — start fresh */ }
  })();

  const active = invRows.filter(r => (r.status||'').toLowerCase() === 'active');
  let statusFilter = 'active'; // default: hide Complete

  function getStock(r) { return String(r['stock number']||r['stock #']||'').trim() || ('inv-'+(r.vehicle||'').substring(0,12)); }

  const STATUS_COLORS = {
    'Not Started':      '#6b7280',
    'Waiting on Parts': '#b45309',
    'In Progress':      '#1a56db',
    'Complete':         '#057a55',
  };

  // ── Wrench difficulty renderer ──
  function wrenchHtml(stock, stopProp=true) {
    const d = repairDifficulty[stock] || 0;
    const sp = stopProp ? 'onclick="event.stopPropagation();cycleRepairDifficulty(\''+stock+'\')"' : 'onclick="cycleRepairDifficulty(\''+stock+'\')"';
    return `<span title="Difficulty: ${d||'unset'} — click to change" ${sp}
      style="cursor:pointer;font-size:13px;letter-spacing:-1px;flex-shrink:0;user-select:none">${'🔧'.repeat(d)}${'<span style="opacity:.2">🔧</span>'.repeat(3-d)}</span>`;
  }

  // ── Compact row (collapsed) ──
  function compactCardHtml(r) {
    const stock    = getStock(r);
    const vehicle  = (r.vehicle||'').trim() || '—';
    const inDate   = r['in date'] || '—';
    const age      = +r.age || 0;
    const status   = repairStatus[stock] || 'Not Started';
    const starred  = repairStars[stock]  || false;
    const noteSnip = (repairNotes[stock]||'').trim().substring(0,80);
    const color    = STATUS_COLORS[status] || 'var(--border)';
    return `
      <div class="rep-card" data-stock="${stock}"
        style="background:var(--card);border:1px solid var(--border);border-left:4px solid ${color};
               border-radius:var(--radius);margin-bottom:6px;cursor:pointer;transition:box-shadow .15s"
        onclick="toggleRepairExpand('${stock}')"
        onmouseenter="this.style.boxShadow='0 2px 10px rgba(0,0,0,.1)'"
        onmouseleave="this.style.boxShadow=''">
        <div style="display:flex;align-items:center;gap:8px;padding:5px 10px">
          <span style="font-size:15px;flex-shrink:0;line-height:1" onclick="event.stopPropagation();toggleRepairStar('${stock}')">${starred?'⭐':'☆'}</span>
          ${wrenchHtml(stock)}
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${vehicle}</div>
            ${noteSnip ? `<div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:420px">${noteSnip}</div>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:7px;flex-shrink:0">
            <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:${color}22;color:${color}">${status}</span>
            <span style="font-size:11px;color:var(--muted)">In: ${inDate}</span>
            <span class="badge ${age>90?'badge-red':age>60?'badge-yellow':'badge-blue'}" style="font-size:10px">${age}d</span>
            <span style="font-size:12px;color:var(--muted)">▼</span>
          </div>
        </div>
      </div>`;
  }

  // ── Expanded card ──
  function expandedCardHtml(r) {
    const stock    = getStock(r);
    const vehicle  = (r.vehicle||'').trim() || '—';
    const inDate   = r['in date'] || '—';
    const age      = +r.age || 0;
    const status   = repairStatus[stock] || 'Not Started';
    const starred  = repairStars[stock]  || false;
    const noteVal  = (repairNotes[stock]||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const color    = STATUS_COLORS[status] || 'var(--border)';
    const diff     = repairDifficulty[stock] || 0;
    return `
      <div class="rep-card" data-stock="${stock}"
        style="background:var(--card);border:1px solid ${color};border-left:4px solid ${color};
               border-radius:var(--radius);margin-bottom:6px;box-shadow:0 2px 10px rgba(0,0,0,.08)">
        <!-- Header row -->
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer" onclick="toggleRepairExpand('${stock}')">
          <span style="font-size:15px;flex-shrink:0" onclick="event.stopPropagation();toggleRepairStar('${stock}')">${starred?'⭐':'☆'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:14px">${vehicle}</div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
              <span style="font-size:11px;color:var(--muted)">In: <b>${inDate}</b> &nbsp;·&nbsp; Age: <span class="badge ${age>90?'badge-red':age>60?'badge-yellow':'badge-blue'}" style="font-size:10px">${age}d</span></span>
              <span style="font-size:11px;color:var(--muted)">Difficulty:</span>
              ${wrenchHtml(stock, false)}
              <span style="font-size:10px;color:var(--muted)">${diff?diff+' wrench'+(diff>1?'es':''):'unset'} — click to change</span>
            </div>
          </div>
          <select onchange="setRepairStatus('${stock}',this.value)" onclick="event.stopPropagation()"
            style="width:185px;font-size:12px;padding:5px 8px;background:var(--card2);border:1.5px solid ${color};border-radius:6px;color:var(--text);font-weight:600">
            ${['Not Started','Waiting on Parts','In Progress','Complete'].map(s=>
              `<option value="${s}"${s===status?' selected':''}>${s}</option>`
            ).join('')}
          </select>
          <button onclick="event.stopPropagation();archiveRepairEntry('${stock}')"
            style="background:none;border:1px solid var(--border);border-radius:5px;cursor:pointer;color:var(--muted);font-size:12px;padding:4px 9px;flex-shrink:0"
            title="Archive (hide from active list)">Archive</button>
          <span style="font-size:12px;color:var(--muted);cursor:pointer">▲</span>
        </div>
        <!-- Notes area -->
        <div style="padding:0 14px 12px 14px">
          <textarea
            placeholder="Mechanic notes, parts needed, work completed…"
            style="width:100%;min-height:88px;background:var(--card2);border:1.5px solid var(--border);border-radius:6px;color:var(--text);padding:9px 11px;font-size:12px;line-height:1.7;resize:vertical;font-family:inherit"
            onclick="event.stopPropagation()"
            oninput="repairNotes['${stock}']=this.value;window.saveRepairState()">${noteVal}</textarea>
        </div>
      </div>`;
  }

  // ── Archived card (with Reopen) ──
  function archivedCardHtml(r) {
    const stock   = getStock(r);
    const vehicle = (r.vehicle||'').trim() || '—';
    const status  = repairStatus[stock] || 'Complete';
    const noteSnip= (repairNotes[stock]||'').trim().substring(0,60);
    const isDeleted = repairDeleted[stock];
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:7px 12px;background:var(--card2);
                  border-radius:8px;margin-bottom:5px;opacity:.8">
        <div style="flex:1;min-width:0">
          <span style="font-weight:600;font-size:12px">${vehicle}</span>
          ${noteSnip?`<span style="font-size:11px;color:var(--muted);margin-left:8px">${noteSnip}</span>`:''}
        </div>
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:${isDeleted?'#fee2e2':'#d1fae5'};color:${isDeleted?'#991b1b':'#065f46'}">${isDeleted?'Archived':status}</span>
        <button onclick="reopenRepair('${stock}')"
          style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px;border:1.5px solid var(--accent);color:var(--accent);background:transparent;cursor:pointer">
          ↩ Reopen
        </button>
      </div>`;
  }

  function getCounts() {
    const vis = active.filter(r => !repairDeleted[getStock(r)] && repairStatus[getStock(r)] !== 'Complete');
    return {
      active:           vis.length,
      'Not Started':    vis.filter(r => (repairStatus[getStock(r)]||'Not Started')==='Not Started').length,
      'Waiting on Parts': vis.filter(r => repairStatus[getStock(r)]==='Waiting on Parts').length,
      'In Progress':    vis.filter(r => repairStatus[getStock(r)]==='In Progress').length,
    };
  }

  function renderList() {
    const container  = document.getElementById('repair-container');
    const archiveDiv = document.getElementById('repair-archive');
    const filterBtns = document.querySelectorAll('.rep-filter-btn');
    const q = (document.getElementById('repair-search')?.value||'').toLowerCase();

    // Active rows: not deleted AND not Complete
    let rows = active.filter(r => {
      const stock = getStock(r);
      if (repairDeleted[stock]) return false;
      if ((repairStatus[stock]||'Not Started') === 'Complete') return false;
      if (statusFilter !== 'active' && (repairStatus[stock]||'Not Started') !== statusFilter) return false;
      if (q) {
        const text = ((r.vehicle||'') + ' ' + (r['in date']||'') + ' ' + (repairNotes[stock]||'')).toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    rows.sort((a,b) => {
      // Starred always float to top unless sorting by something specific
      const sa = repairStars[getStock(a)]?1:0, sb = repairStars[getStock(b)]?1:0;
      if (repairSortMode === 'stars') {
        if (sb!==sa) return sb-sa;
        return (+b.age||0)-(+a.age||0);
      }
      if (repairSortMode === 'diff-asc') {
        const da = repairDifficulty[getStock(a)]||0, db = repairDifficulty[getStock(b)]||0;
        if (da!==db) return da-db;
        return (+b.age||0)-(+a.age||0);
      }
      if (repairSortMode === 'diff-desc') {
        const da = repairDifficulty[getStock(a)]||0, db = repairDifficulty[getStock(b)]||0;
        if (da!==db) return db-da;
        return (+b.age||0)-(+a.age||0);
      }
      if (repairSortMode === 'status') {
        const ORDER = {'Not Started':0,'Waiting on Parts':1,'In Progress':2,'Complete':3};
        const oa = ORDER[repairStatus[getStock(a)]||'Not Started']||0;
        const ob = ORDER[repairStatus[getStock(b)]||'Not Started']||0;
        if (oa!==ob) return oa-ob;
        return (+b.age||0)-(+a.age||0);
      }
      if (repairSortMode === 'age') return (+b.age||0)-(+a.age||0);
      // fallback
      if (sb!==sa) return sb-sa;
      return (+b.age||0)-(+a.age||0);
    });

    if (container) container.innerHTML = rows.length
      ? rows.map(r => repairExpanded[getStock(r)] ? expandedCardHtml(r) : compactCardHtml(r)).join('')
      : `<div style="color:var(--muted);font-size:13px;padding:24px;text-align:center">No vehicles match this filter.</div>`;

    // Archived / Complete section
    const archived = active.filter(r => {
      const stock = getStock(r);
      return repairDeleted[stock] || repairStatus[stock] === 'Complete';
    });
    if (archiveDiv) {
      archiveDiv.innerHTML = archived.length
        ? archived.map(archivedCardHtml).join('')
        : '<div style="color:var(--muted);font-size:12px;padding:10px">No archived vehicles yet.</div>';
      const hdr = document.getElementById('repair-archive-hdr');
      if (hdr) hdr.textContent = `Archived / Complete (${archived.length})`;
    }

    // Update filter buttons
    const counts = getCounts();
    const labels = ['active','Not Started','Waiting on Parts','In Progress'];
    const btnLabels = ['All Active','Not Started','Waiting on Parts','In Progress'];
    filterBtns.forEach((btn,i) => {
      const key = labels[i];
      const ct  = counts[key]||0;
      btn.className = 'tog rep-filter-btn' + (statusFilter===key?' on':'');
      btn.innerHTML = `${btnLabels[i]} <span style="opacity:.7">(${ct})</span>`;
    });
  }

  el.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
    <h2 style="font-size:15px;font-weight:700">🔧 Repair Log — ${active.filter(r=>!repairDeleted[getStock(r)]&&(repairStatus[getStock(r)]||'Not Started')!=='Complete').length} Active</h2>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="text" id="repair-search" placeholder="Search vehicle or notes…" style="width:180px" oninput="window.renderRepairList()">
      <select id="repair-sort-sel" onchange="window.setRepairSort(this.value)"
        style="font-size:12px;padding:5px 8px;background:var(--card2);border:1px solid var(--border);border-radius:6px;color:var(--text)">
        <option value="stars"${repairSortMode==='stars'?' selected':''}>Sort: ⭐ Stars</option>
        <option value="diff-desc"${repairSortMode==='diff-desc'?' selected':''}>Sort: 🔧🔧🔧 Hardest First</option>
        <option value="diff-asc"${repairSortMode==='diff-asc'?' selected':''}>Sort: 🔧 Easiest First</option>
        <option value="status"${repairSortMode==='status'?' selected':''}>Sort: Status</option>
        <option value="age"${repairSortMode==='age'?' selected':''}>Sort: Age (oldest first)</option>
      </select>
      <button class="btn btn-sm" onclick="window.repairExpandAll(true)">Expand All</button>
      <button class="btn btn-sm" onclick="window.repairExpandAll(false)">Collapse All</button>
      <button class="btn btn-sm" onclick="saveRepairNotes()">💾 Save</button>
    </div>
  </div>
  <div class="toggle-row" style="margin-bottom:12px">
    ${['active','Not Started','Waiting on Parts','In Progress'].map(s=>`
      <button class="tog rep-filter-btn${statusFilter===s?' on':''}" onclick="setRepairFilter('${s}')">
        ${s==='active'?'All Active':s}
      </button>
    `).join('')}
  </div>
  <div style="font-size:11px;color:var(--muted);margin-bottom:10px">Click a card to expand · Click ☆ to star · Click 🔧 icons to set difficulty (1–3 wrenches)</div>
  ${active.length===0 ? `<div class="error-box">No active inventory found.</div>` : ''}
  <div id="repair-container"></div>

  <!-- Archived section -->
  <details style="margin-top:16px">
    <summary style="cursor:pointer;font-size:13px;font-weight:700;color:var(--muted);user-select:none;padding:8px 0" id="repair-archive-hdr">
      Archived / Complete (0)
    </summary>
    <div id="repair-archive" style="margin-top:8px"></div>
  </details>
  `;

  renderList();

  window.renderRepairList = renderList;

  window.toggleRepairExpand = function(stock) {
    repairExpanded[stock] = !repairExpanded[stock];
    renderList();
  };
  window.repairExpandAll = function(expand) {
    active.forEach(r => { repairExpanded[getStock(r)] = expand; });
    renderList();
  };
  window.toggleRepairStar = function(stock) {
    repairStars[stock] = !repairStars[stock];
    window.saveRepairState();
    renderList();
  };
  window.setRepairStatus = function(stock, val) {
    repairStatus[stock] = val;
    if (val === 'Complete') repairExpanded[stock] = false;
    window.saveRepairState();
    renderList();
  };
  window.archiveRepairEntry = function(stock) {
    repairDeleted[stock] = true;
    repairExpanded[stock] = false;
    window.saveRepairState();
    renderList();
  };
  window.reopenRepair = function(stock) {
    repairDeleted[stock] = false;
    repairStatus[stock]  = 'Not Started';
    repairExpanded[stock]= true;
    window.saveRepairState();
    renderList();
  };
  window.setRepairFilter = function(f) {
    statusFilter = f;
    renderList();
  };
  window.cycleRepairDifficulty = function(stock) {
    const cur = repairDifficulty[stock] || 0;
    repairDifficulty[stock] = cur >= 3 ? 0 : cur + 1;
    window.saveRepairState();
    renderList();
  };
  window.setRepairSort = function(mode) {
    repairSortMode = mode;
    window.saveRepairState();
    renderList();
  };
  window.saveRepairNotes = function() {
    const notes    = Object.entries(repairNotes).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join('\n');
    const statuses = Object.entries(repairStatus).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join('\n');
    window.sendPrompt && window.sendPrompt('Repair log — Notes:\n' + (notes||'(none)').substring(0,2000) + '\n\nStatuses:\n' + (statuses||'(none)').substring(0,500));
  };

  window.saveRepairState = function() {
    try {
      localStorage.setItem('autoport_repair_state', JSON.stringify({
        notes:      repairNotes,
        status:     repairStatus,
        stars:      repairStars,
        deleted:    repairDeleted,
        difficulty: repairDifficulty,
        sortMode:   repairSortMode,
      }));
    } catch (e) { /* storage full or unavailable */ }
  };

  window.clearRepairState = function() {
    localStorage.removeItem('autoport_repair_state');
    Object.keys(repairNotes).forEach(k => delete repairNotes[k]);
    Object.keys(repairStatus).forEach(k => delete repairStatus[k]);
    Object.keys(repairStars).forEach(k => delete repairStars[k]);
    Object.keys(repairDeleted).forEach(k => delete repairDeleted[k]);
    Object.keys(repairDifficulty).forEach(k => delete repairDifficulty[k]);
    renderList();
  };
}


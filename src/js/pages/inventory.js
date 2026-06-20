'use strict';

// ══════════════════════════════════════════════
//  PAGE: INVENTORY — src/js/pages/inventory.js
//  Full inventory table with live filters.
//  Columns follow the inventory CSV layout:
//    A=Status  B=Stock#  C=Vehicle  D=VIN
//    E=Miles   F=InDate  G=Age      H=Color
//    I=PurchaseCost  J=FlooringPayable  K=ConsignmentPayable
//    L=TotalCost     M=Price            N=Leads
// ══════════════════════════════════════════════

async function loadInventory() {
  const el = document.getElementById('inventory-body');
  el.innerHTML = loading('Loading inventory…');
  let rows;
  try {
    rows = await getInventoryRows();
  } catch (err) {
    el.innerHTML = errorBox('Could not load inventory: ' + (err.message || String(err)));
    return;
  }
  renderInventory(el, rows);
}

function renderInventory(el, rows) {
  if (!rows || !rows.length) {
    el.innerHTML = errorBox('No inventory rows found.');
    return;
  }

  // ── Key column helpers ──
  const c = (r, letter) => col(r, letter) || '';   // col() from utils.js
  const status  = r => (c(r,'A') || r.status || '').trim();
  const stock   = r => (c(r,'B') || r['stock number'] || r['stock #'] || r['stock'] || '').trim();
  const vehicle = r => (c(r,'C') || r.vehicle || r['inventory vehicle name'] || '').trim();
  const vin     = r => (c(r,'D') || r.vin || '').trim();
  const miles   = r => (c(r,'E') || r.miles || r.mileage || '').trim();
  const inDate  = r => (c(r,'F') || r['date in'] || r['in date'] || '').trim();
  const age     = r => parseInt(c(r,'G') || r.age || '0', 10) || 0;
  const color   = r => (c(r,'H') || r.color || '').trim();
  const cost    = r => parseMoney(c(r,'L') || r['total cost'] || '0') || 0;
  const price   = r => parseMoney(c(r,'M') || r.price || '0') || 0;
  const leads   = r => parseInt(c(r,'N') || '0', 10) || 0;

  // ── Partition by status ──
  const active   = rows.filter(r => status(r).toLowerCase() === 'active');
  const inactive = rows.filter(r => status(r).toLowerCase() !== 'active' && status(r));

  // ── Summary stats ──
  const avgAge    = active.length ? Math.round(active.reduce((s,r) => s + age(r), 0) / active.length) : 0;
  const totalCost = active.reduce((s,r) => s + cost(r), 0);
  const totalList = active.reduce((s,r) => s + price(r), 0);
  const age90p    = active.filter(r => age(r) > 90).length;
  const totalLeads = active.reduce((s,r) => s + leads(r), 0);

  // ── Render ──
  el.innerHTML = `
    <div style="margin-bottom:16px">
      <div class="sec-hdr">
        <h2>📦 Inventory</h2>
        <span style="font-size:12px;color:var(--muted)">${rows.length} total rows in report</span>
      </div>

      <!-- Summary chips -->
      <div class="inv-stat-row">
        <div class="inv-stat-chip"><b>${active.length}</b>Active Units</div>
        <div class="inv-stat-chip"><b>${inactive.length}</b>Inactive / Sold</div>
        <div class="inv-stat-chip"><b>${avgAge}d</b>Avg Age (active)</div>
        <div class="inv-stat-chip" style="${age90p > 0 ? 'border-color:rgba(239,68,68,.3);' : ''}">
          <b style="${age90p > 0 ? 'color:var(--red)' : ''}">${age90p}</b>Over 90 Days
        </div>
        <div class="inv-stat-chip"><b>${fmt$(totalCost)}</b>Total Cost (active)</div>
        <div class="inv-stat-chip"><b>${fmt$(totalList)}</b>Total Listed (active)</div>
        <div class="inv-stat-chip"><b>${totalLeads}</b>Total Leads</div>
      </div>

      <!-- Filters -->
      <div class="inv-filters">
        <input type="text" id="inv-search" placeholder="🔍  Search vehicle, stock, VIN…" oninput="filterInventory()" style="max-width:260px;width:auto">
        <button class="tog on" id="inv-tog-active"   onclick="toggleInvFilter('active')"  >Active</button>
        <button class="tog"    id="inv-tog-inactive" onclick="toggleInvFilter('inactive')">Inactive</button>
        <button class="tog"    id="inv-tog-old"      onclick="toggleInvFilter('old')"     >90+ Days</button>
        <button class="tog"    id="inv-tog-consign"  onclick="toggleInvFilter('consign')" >Consignment</button>
        <span style="font-size:12px;color:var(--muted);margin-left:auto" id="inv-row-count"></span>
      </div>

      <!-- Table -->
      <div class="tbl-wrap">
        <table class="tbl" id="inv-table">
          <thead>
            <tr>
              <th>Stock</th>
              <th>Vehicle</th>
              <th>Status</th>
              <th>Age</th>
              <th>Miles</th>
              <th>Color</th>
              <th>In Date</th>
              <th style="text-align:right">Total Cost</th>
              <th style="text-align:right">Listed</th>
              <th style="text-align:right">Leads</th>
            </tr>
          </thead>
          <tbody id="inv-tbody"></tbody>
        </table>
      </div>
    </div>
  `;

  // Store rows on window for filter access
  window._invRows = rows;
  window._invFilters = { search: '', mode: 'active' };

  filterInventory();
}

// ── Filter / render rows ──
window.filterInventory = function () {
  const search = (document.getElementById('inv-search').value || '').toLowerCase();
  window._invFilters.search = search;
  applyInvFilter();
};

window.toggleInvFilter = function (mode) {
  window._invFilters.mode = (window._invFilters.mode === mode) ? 'all' : mode;
  ['active','inactive','old','consign'].forEach(m => {
    const el = document.getElementById('inv-tog-' + m);
    if (el) el.classList.toggle('on', window._invFilters.mode === m);
  });
  applyInvFilter();
};

function applyInvFilter() {
  const rows   = window._invRows || [];
  const search = window._invFilters.search;
  const mode   = window._invFilters.mode;

  const c       = (r, letter) => col(r, letter) || '';
  const status  = r => (c(r,'A') || r.status || '').trim().toLowerCase();
  const stock   = r => (c(r,'B') || r['stock number'] || '').trim();
  const vehicle = r => (c(r,'C') || r.vehicle || '').trim();
  const vin     = r => (c(r,'D') || r.vin || '').trim();
  const miles   = r => (c(r,'E') || '').trim();
  const inDate  = r => (c(r,'F') || '').trim();
  const ageVal  = r => parseInt(c(r,'G') || r.age || '0', 10) || 0;
  const colorV  = r => (c(r,'H') || '').trim();
  const cost    = r => parseMoney(c(r,'L') || '0') || 0;
  const price   = r => parseMoney(c(r,'M') || '0') || 0;
  const leads   = r => parseInt(c(r,'N') || '0', 10) || 0;

  let filtered = rows.filter(r => {
    const st = status(r);
    if (mode === 'active'   && st !== 'active') return false;
    if (mode === 'inactive' && st === 'active') return false;
    if (mode === 'old'      && (st !== 'active' || ageVal(r) <= 90)) return false;
    if (mode === 'consign'  && !stock(r).toUpperCase().startsWith('C')) return false;
    if (search) {
      const hay = [stock(r), vehicle(r), vin(r), colorV(r)].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // Sort: active by age desc, others by stock
  if (mode === 'active' || mode === 'old') {
    filtered.sort((a, b) => ageVal(b) - ageVal(a));
  } else {
    filtered.sort((a, b) => stock(a).localeCompare(stock(b)));
  }

  const ageColor = d => d > 90 ? 'var(--red)' : d > 60 ? 'var(--orange)' : d > 30 ? 'var(--yellow)' : 'var(--green)';
  const fmtAge   = d => d > 0 ? `<span style="color:${ageColor(d)};font-weight:600">${d}d</span>` : '—';
  const fmtMiles = m => { const n = parseInt(m, 10); return isNaN(n) ? '—' : n.toLocaleString(); };
  const fmtPrice = v => v > 0 ? fmt$(v) : '—';
  const fmtLeads = n => n > 0 ? `<span style="color:var(--accent);font-weight:600">${n}</span>` : '—';
  const fmtStock = s => s ? `<span class="tbl td stk" style="font-size:9px;letter-spacing:2px;color:rgba(60,145,255,.65);font-weight:400">${s.toUpperCase()}</span>` : '—';

  const MAX_ROWS = 300;
  const shown = filtered.slice(0, MAX_ROWS);

  const tbody = document.getElementById('inv-tbody');
  const count = document.getElementById('inv-row-count');
  if (!tbody) return;

  tbody.innerHTML = shown.map(r => {
    const st = status(r);
    const stBadge = st === 'active'
      ? `<span class="badge badge-green" style="font-size:9px;padding:2px 7px">Active</span>`
      : `<span class="badge" style="background:rgba(120,155,200,.1);color:var(--muted);font-size:9px;padding:2px 7px">${st || '—'}</span>`;
    return `<tr>
      <td>${fmtStock(stock(r))}</td>
      <td>${vehicle(r) || '—'}</td>
      <td>${stBadge}</td>
      <td>${fmtAge(ageVal(r))}</td>
      <td style="color:var(--text2)">${fmtMiles(miles(r))}</td>
      <td style="color:var(--muted)">${colorV(r) || '—'}</td>
      <td style="color:var(--muted)">${inDate(r) || '—'}</td>
      <td class="r">${fmtPrice(cost(r))}</td>
      <td class="r">${fmtPrice(price(r))}</td>
      <td class="r">${fmtLeads(leads(r))}</td>
    </tr>`;
  }).join('');

  if (count) {
    const extra = filtered.length > MAX_ROWS ? ` (showing first ${MAX_ROWS})` : '';
    count.textContent = `${filtered.length} row${filtered.length !== 1 ? 's' : ''}${extra}`;
  }
}

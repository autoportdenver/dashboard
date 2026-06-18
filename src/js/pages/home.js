'use strict';

// ══════════════════════════════════════════════
//  PAGE: HOME — src/js/pages/home.js
// ══════════════════════════════════════════════

async function loadHome() {
  const el = document.getElementById('home-body');
  el.innerHTML = loading('Loading inventory & sales data…');
  const [invR, dealR, itemR, payR, titR, dtsR] = await Promise.allSettled([
    getInventoryRows(), getDealDetailRows(), getItemizedCostRows(), getDealPaymentRows(),
    getTitlesRows(), getDTSRows()
  ]);
  const invRows  = invR.status  === 'fulfilled' ? invR.value  : null;
  const dealRows = dealR.status === 'fulfilled' ? dealR.value : null;
  const itemRows = itemR.status === 'fulfilled' ? itemR.value : null;
  const payRows  = payR.status  === 'fulfilled' ? payR.value  : [];
  const titlesRows = titR.status === 'fulfilled' ? titR.value : [];
  const dtsRows    = dtsR.status === 'fulfilled' ? dtsR.value : [];
  const errs = [
    invR.status  === 'rejected' ? '⚠ Inventory: '  + (invR.reason?.message  || invR.reason)  : null,
    dealR.status === 'rejected' ? '⚠ Deal Detail: ' + (dealR.reason?.message || dealR.reason) : null,
    itemR.status === 'rejected' ? '⚠ Item Costs: '  + (itemR.reason?.message || itemR.reason) : null,
  ].filter(Boolean);
  const errHtml = errs.length ? '<div class="error-box" style="margin-bottom:12px">' + errs.join('<br>') + '</div>' : '';
  renderHome(el, invRows || [], dealRows || [], itemRows || [], payRows || [], errHtml, titlesRows, dtsRows);
}

function renderHome(el, invRows, dealRows, itemRows, payRows, errHtml, titlesRows, dtsRows) {
  errHtml    = errHtml    || '';
  payRows    = payRows    || [];
  titlesRows = titlesRows || [];
  dtsRows    = dtsRows    || [];

  const now   = new Date();
  const thisY = now.getFullYear(), thisM = now.getMonth();
  const lastM = thisM === 0 ? 11 : thisM - 1;
  const lastY = thisM === 0 ? thisY - 1 : thisY;

  const soldThis = dealRows.filter(r => r._isSold && isSameMonth(r._date, thisY, thisM));
  const soldLast = dealRows.filter(r => r._isSold && isSameMonth(r._date, lastY, lastM));
  const grossThis = soldThis.reduce((s,r) => s + (r._profit||0), 0);
  const grossLast = soldLast.reduce((s,r) => s + (r._profit||0), 0);

  const auctionThis = itemRows.filter(r => { const d=parseDate(r.date); return d && isSameMonth(d,thisY,thisM) && detectAuction(r); });
  const auctionLast = itemRows.filter(r => { const d=parseDate(r.date); return d && isSameMonth(d,lastY,lastM) && detectAuction(r); });

  const brandCt = {};
  soldThis.forEach(r => { const b=r._make||'Unknown'; brandCt[b]=(brandCt[b]||0)+1; });
  const topBrand = Object.entries(brandCt).sort((a,b)=>b[1]-a[1])[0] || ['—',0];

  // Active vs all inventory
  const activeInv   = invRows.filter(r => (r.status||'').toLowerCase() === 'active');
  const inactiveInv = invRows.filter(r => (r.status||'').toLowerCase() !== 'active' && (r.status||'').trim());

  // Aging brackets (active only)
  const age0_30  = activeInv.filter(r => +r.age <= 30);
  const age31_60 = activeInv.filter(r => +r.age > 30 && +r.age <= 60);
  const age61_90 = activeInv.filter(r => +r.age > 60 && +r.age <= 90);
  const age90p   = activeInv.filter(r => +r.age > 90);

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // ══════════════════════════════════════════════
  //  TO-DO FLAGS — DEAL DETAIL (Sold Cars)
  //  Uses column-index access via col(r._raw, letter)
  // ══════════════════════════════════════════════

  // 1. Consignment Payable (Deal Detail): col D starts with C → col O must not be $0 unless col S has value
  const ddConsignment = dealRows.filter(r => {
    if (!r._isSold) return false;
    const stockVal = col(r._raw, 'D');
    if (!stockVal.toUpperCase().startsWith('C')) return false;
    const oVal = parseMoney(col(r._raw, 'O'));
    const sVal = parseMoney(col(r._raw, 'S'));
    const oOk  = !isNaN(oVal) && oVal !== 0;
    const sOk  = !isNaN(sVal) && sVal !== 0;
    return !oOk && !sOk;
  });

  // 2. Flooring Payable (Deal Detail): col E has "Westlake Flooring" → col P > 0 unless col S has value
  const ddFlooringPayable = dealRows.filter(r => {
    if (!r._isSold) return false;
    const flags = col(r._raw, 'E').toLowerCase();
    if (!flags.includes('westlake flooring')) return false;
    const pVal = parseMoney(col(r._raw, 'P'));
    const sVal = parseMoney(col(r._raw, 'S'));
    const pOk  = !isNaN(pVal) && pVal > 0;
    const sOk  = !isNaN(sVal) && sVal !== 0;
    return !pOk && !sOk;
  });

  // 3. Flooring Fees (Deal Detail): col E has "Westlake Flooring" → col Q > 0
  const ddFlooringFees = dealRows.filter(r => {
    if (!r._isSold) return false;
    const flags = col(r._raw, 'E').toLowerCase();
    if (!flags.includes('westlake flooring')) return false;
    const qVal = parseMoney(col(r._raw, 'Q'));
    return isNaN(qVal) || qVal <= 0;
  });

  // 4. Outstanding Deal Payments: sold in 2026+, col V balance > $100
  const ddOutstandingPay = dealRows.filter(r => {
    if (!r._isSold || !r._date) return false;
    if (r._date.getFullYear() < 2026) return false;
    const bal = parseMoney(col(r._raw, 'V'));
    return !isNaN(bal) && bal > 100;
  });

  // 5. Missing VSC Cost: Pricing VSC Amount present but no Pricing VSC Cost
  const ddMissingVSC = dealRows.filter(r => {
    if (!r._isSold) return false;
    const amt  = parseMoney(getField(r._raw, 'pricing vsc amount', 'vsc amount', 'vsc revenue', 'vsc'));
    const cost = parseMoney(getField(r._raw, 'pricing vsc cost', 'vsc cost'));
    return !isNaN(amt) && amt > 0 && (isNaN(cost) || cost <= 0);
  });

  // 6. Missing GAP Cost: Pricing GAP Amount present but no Pricing GAP Cost
  const ddMissingGAP = dealRows.filter(r => {
    if (!r._isSold) return false;
    const amt  = parseMoney(getField(r._raw, 'pricing gap amount', 'gap amount', 'gap revenue', 'gap'));
    const cost = parseMoney(getField(r._raw, 'pricing gap cost', 'gap cost'));
    return !isNaN(amt) && amt > 0 && (isNaN(cost) || cost <= 0);
  });

  // ══════════════════════════════════════════════
  //  TO-DO FLAGS — INVENTORY (Active Cars)
  //  Uses column-index access via col(r, letter)
  // ══════════════════════════════════════════════

  // 7. Missing Stock # (col B blank)
  const invMissingStock = activeInv.filter(r => {
    const b = col(r, 'B').trim();
    return !b || b === '—';
  });

  // 8. Missing Mileage (col E blank), OK only if col C is also blank
  const invMissingMileage = activeInv.filter(r => {
    const e = col(r, 'E').trim();
    if (e) return false;         // has mileage — fine
    const c = col(r, 'C').trim();
    return !!c;                  // blank mileage is only a problem when col C has a value
  });

  // 9. Consignment Payable (Inventory): col B starts with C → col K not $0, unless col L > $300
  const invConsignment = activeInv.filter(r => {
    const stockB = col(r, 'B').trim();
    if (!stockB.toUpperCase().startsWith('C')) return false;
    const kVal = parseMoney(col(r, 'K'));
    const lVal = parseMoney(col(r, 'L'));
    const kOk  = !isNaN(kVal) && kVal !== 0;
    const lOk  = !isNaN(lVal) && lVal > 300;
    return !kOk && !lOk;
  });

  // ══════════════════════════════════════════════
  //  HOTTEST CARS (by lead count, col N of inventory)
  // ══════════════════════════════════════════════
  const hottestCars = activeInv
    .map(r => {
      const leads = parseInt(col(r, 'N'), 10) || 0;
      const stock = col(r, 'B') || r['stock number'] || r['stock #'] || '—';
      const vehicle = r.vehicle || r['inventory vehicle name'] || '—';
      return { stock, vehicle, leads };
    })
    .filter(r => r.leads > 0)
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 10);

  // ══════════════════════════════════════════════
  //  OUTSTANDING TITLES
  //  Only include closing dates on/after Apr 11, 2026
  // ══════════════════════════════════════════════
  const titlesAfterCutoff = new Date('2026-04-11');
  const today = new Date();

  // DTS lookup
  const dtsLookup = {};
  dtsRows.forEach(r => {
    const stock = (getField(r,'stock number','stock #','stock')||'').trim().toLowerCase();
    if (!stock) return;
    const status = (getField(r,'status')||'').trim().toLowerCase();
    const transferDate = getField(r,'transfer initiated','clearing date','date') || '';
    if (!dtsLookup[stock] || status === 'processed') {
      dtsLookup[stock] = { status, transferDate };
    }
  });

  // Deal-Detail bridge: vehicle+date → { stock, isFinanced }
  function normVehicle(v) { return (v||'').toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim(); }
  const dealBridge = {};
  dealRows.forEach(r => {
    if (!r._stock || !r._date) return;
    const key = normVehicle(r._vehicle) + '|' + r._date.toLocaleDateString('en-US');
    if (!dealBridge[key]) {
      const dealType  = (getField(r._raw,'deal type','type','financing type','finance type')||'').toLowerCase();
      const lender    = (getField(r._raw,'lender','lender name','lienholder','finance company')||'').toLowerCase();
      const acqFeeRaw = getField(r._raw,'acquisition fee','acq fee','acquisition','acq. fee');
      const hasAcqFee = !isNaN(parseMoney(acqFeeRaw)) && parseMoney(acqFeeRaw) > 0;
      const isFinanced = /financ|loan|lien/.test(dealType) || lender.length > 0 || hasAcqFee;
      dealBridge[key] = { stock: r._stock.trim().toLowerCase(), isFinanced };
    }
  });

  const outstandingTitles = (() => {
    if (!titlesRows.length) return [];
    return titlesRows.map(r => {
      const closingRaw  = getField(r,'deal closing date','closing date','close date','date closed');
      const receivedRaw = getField(r,'title received date','title received','received date','received');
      const sentRaw     = getField(r,'title sent date','title sent','sent date','sent');
      const closing  = parseDate(closingRaw);
      if (!closing) return null;
      if (closing < titlesAfterCutoff) return null;   // exclude before Apr 11, 2026
      if (parseDate(sentRaw)) return null;             // already sent
      const daysOut  = Math.floor((today - closing) / 86400000);
      const vehicle  = getField(r,'vehicle','inventory vehicle name','car','description','unit') || '—';
      const received = !!parseDate(receivedRaw);
      let stock = (getField(r,'stock','stock number','stock #') || '').trim().toLowerCase();
      const bridgeEntry = dealBridge[normVehicle(vehicle) + '|' + closing.toLocaleDateString('en-US')];
      if (!stock && bridgeEntry) stock = bridgeEntry.stock;
      const isFinanced = bridgeEntry ? bridgeEntry.isFinanced : false;
      if (isFinanced && daysOut > 90) return null;
      const dts = stock ? (dtsLookup[stock] || null) : null;
      if (dts) return null;
      return { vehicle, stock, closing, daysOut, received, isFinanced };
    })
    .filter(Boolean)
    .filter(t => t.daysOut <= 700)
    .sort((a,b) => b.daysOut - a.daysOut);
  })();

  // ── Item renderers ──
  function dealItem(r) {
    const stock = col(r._raw,'D') || r._stock || '—';
    const v = r._vehicle || '—';
    return '<div style="font-size:11px;padding:3px 0;border-bottom:1px solid var(--border)">' +
      '<b>' + stock + '</b> <span style="color:var(--muted)">' + v + '</span></div>';
  }

  function dealPayItem(r) {
    const stock = col(r._raw,'D') || r._stock || '—';
    const bal   = parseMoney(col(r._raw,'V'));
    const v = r._vehicle || '—';
    return '<div style="font-size:11px;padding:3px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between">' +
      '<span><b>' + stock + '</b> ' + v + '</span>' +
      '<span style="color:var(--red);font-weight:700">' + fmt$(bal) + '</span></div>';
  }

  function invItem(r) {
    const stock = col(r,'B') || r['stock number'] || r['stock #'] || '—';
    const v = r.vehicle || r['inventory vehicle name'] || '—';
    return '<div style="font-size:11px;padding:3px 0;border-bottom:1px solid var(--border)">' +
      '<b>' + stock + '</b> <span style="color:var(--muted)">' + v + '</span></div>';
  }

  const MAX_ITEMS = 8;

  // ── To-Do column builder ──
  function buildTodoCol(icon, color, title, items, renderFn, emptyMsg) {
    const badge = items.length
      ? ' <span style="background:' + color + ';color:#fff;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:700">' + items.length + '</span>'
      : '';
    let body;
    if (!items.length) {
      body = '<div style="color:var(--green);font-size:12px;padding:8px 0">' + (emptyMsg||'✅ All clear') + '</div>';
    } else {
      body = items.slice(0,MAX_ITEMS).map(renderFn).join('');
      if (items.length > MAX_ITEMS) body += '<div style="font-size:11px;color:var(--muted);margin-top:4px">+' + (items.length-MAX_ITEMS) + ' more</div>';
    }
    return '<div style="min-width:0;border-right:1px solid var(--border);padding-right:14px;padding-left:2px">' +
      '<div style="font-size:10px;font-weight:700;color:' + color + ';text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">' +
      icon + ' ' + title + badge + '</div>' + body + '</div>';
  }

  const todoHtml = [
    buildTodoCol('🟠','var(--orange)','Consignment Payable (Sold)', ddConsignment,     r => dealItem(r), '✅ All consignments have payable cost'),
    buildTodoCol('🟠','var(--orange)','Flooring Payable (Sold)',    ddFlooringPayable,  r => dealItem(r), '✅ All Westlake deals have flooring payable'),
    buildTodoCol('🟡','#c9960c',      'Flooring Fees (Sold)',       ddFlooringFees,     r => dealItem(r), '✅ All Westlake deals have flooring fees'),
    buildTodoCol('🔴','var(--red)',   'Outstanding Payments (2026+)',ddOutstandingPay,   r => dealPayItem(r), '✅ No open balances'),
    buildTodoCol('🟡','#c9960c',      'Missing VSC Cost',           ddMissingVSC,       r => dealItem(r), '✅ All VSC revenue has cost'),
    buildTodoCol('🟡','#c9960c',      'Missing GAP Cost',           ddMissingGAP,       r => dealItem(r), '✅ All GAP revenue has cost'),
    buildTodoCol('🔴','var(--red)',   'Missing Stock # (Inv)',       invMissingStock,    r => invItem(r), '✅ All inventory has a stock #'),
    buildTodoCol('🟡','#c9960c',      'Missing Mileage (Inv)',       invMissingMileage,  r => invItem(r), '✅ All inventory has mileage'),
    buildTodoCol('🟠','var(--orange)','Consignment Payable (Inv)',   invConsignment,     r => invItem(r), '✅ All consignment stock has payable'),
  ].join('');

  const totalFlags = ddConsignment.length + ddFlooringPayable.length + ddFlooringFees.length +
    ddOutstandingPay.length + ddMissingVSC.length + ddMissingGAP.length +
    invMissingStock.length + invMissingMileage.length + invConsignment.length;

  // ── Titles table ──
  const titlesTable = (() => {
    if (!titlesRows.length) {
      return '<div style="color:var(--muted);font-size:13px">No titles report found — drop a "Sold Inventory - Title Report" CSV into the Titles folder and reload.</div>';
    }
    if (!outstandingTitles.length) {
      return '<div style="color:var(--green);font-size:13px">✅ All titles accounted for (Apr 11, 2026+) — nothing outstanding.</div>';
    }
    const old  = outstandingTitles.filter(t => t.daysOut > 99);
    const recent = outstandingTitles.filter(t => t.daysOut <= 99);
    const rowHtml = items => items.map(t => {
      const stockDisp = t.stock ? t.stock.toUpperCase() : '—';
      const daysColor = t.daysOut > 90 ? 'var(--red)' : t.daysOut > 60 ? 'var(--orange)' : t.daysOut > 30 ? 'var(--yellow)' : 'var(--green)';
      return '<tr>' +
        '<td><b>' + stockDisp + '</b></td>' +
        '<td>' + t.vehicle + '</td>' +
        '<td>' + (t.closing ? t.closing.toLocaleDateString() : '—') + '</td>' +
        '<td>' + (t.received ? '✅ Yes' : '⏳ No') + '</td>' +
        '<td><span class="badge" style="background:' + daysColor + ';color:#fff">' + t.daysOut + 'd</span></td>' +
        '<td>' + (t.isFinanced ? '🏦 Financed' : '💵 Cash') + '</td>' +
        '</tr>';
    }).join('');

    const tableHead = '<table class="data-table" style="width:100%"><thead><tr>' +
      '<th>Stock</th><th>Vehicle</th><th>Closed</th><th>Title Rcvd</th><th>Days Out</th><th>Type</th>' +
      '</tr></thead><tbody>';

    let html = '';
    if (recent.length) {
      html += '<div style="font-size:11px;font-weight:700;color:var(--text);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">≤ 99 Days (' + recent.length + ')</div>';
      html += tableHead + rowHtml(recent) + '</tbody></table>';
    }
    if (old.length) {
      const id = 'titles-old-' + Date.now();
      html += '<details style="margin-top:12px"><summary style="cursor:pointer;font-size:11px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.5px">' +
        '⚠ Over 99 Days (' + old.length + ')</summary>' +
        '<div style="margin-top:8px">' + tableHead + rowHtml(old) + '</tbody></table></div></details>';
    }
    return html;
  })();

  // ── Build HTML ──
  el.innerHTML = errHtml + `
  <div style="font-size:11px;color:var(--muted);margin-bottom:10px">
    📦 Inventory: ${invRows.length} rows &nbsp;|&nbsp;
    🤝 Deals: ${dealRows.length} rows &nbsp;|&nbsp;
    🔧 Item Costs: ${itemRows.length} rows
  </div>

  <!-- Stats Row -->
  <div class="grid-4" style="margin-bottom:16px">
    <div class="stat-card accent">
      <div class="label">Sold This Month (${monthNames[thisM]})</div>
      <div class="val">${soldThis.length}</div>
      <div class="sub">vs ${soldLast.length} last month</div>
    </div>
    <div class="stat-card ${grossThis >= 0 ? 'green' : 'red'}">
      <div class="label">Total Gross Profit (${monthNames[thisM]})</div>
      <div class="val">${fmt$(grossThis)}</div>
      <div class="sub">Front + Back combined | Last mo: ${fmt$(grossLast)}</div>
    </div>
    <div class="stat-card yellow">
      <div class="label">Purchased This Month</div>
      <div class="val">${auctionThis.length}</div>
      <div class="sub">Last month: ${auctionLast.length}</div>
    </div>
    <div class="stat-card">
      <div class="label">Top Brand This Month</div>
      <div class="val" style="font-size:20px">${topBrand[0]}</div>
      <div class="sub">${topBrand[1]} unit${topBrand[1]===1?'':'s'}</div>
    </div>
  </div>

  <!-- Bulletin Board -->
  <div class="card" style="margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <h3 style="margin-bottom:0">📌 Bulletin Board</h3>
      <button class="btn btn-sm" onclick="saveKeepInMind()">💾 Save</button>
    </div>
    <div id="keep-in-mind" class="notes-area" contenteditable="true" spellcheck="false">${keepInMind}</div>
  </div>

  <!-- ══ TO-DO FLAGS (full width, 3-column grid) ══ -->
  <div class="card" style="margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <h3 style="margin-bottom:0">⚡ To-Do / Flags</h3>
      ${totalFlags > 0
        ? '<span style="font-size:12px;background:var(--red);color:#fff;border-radius:12px;padding:2px 10px;font-weight:700">' + totalFlags + ' items need attention</span>'
        : '<span style="font-size:12px;color:var(--green);font-weight:600">✅ All clear</span>'}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
      ${todoHtml}
    </div>
  </div>

  <!-- ══ HOTTEST CARS + ACTIVE/INACTIVE ══ -->
  <div class="grid-2" style="margin-bottom:16px">
    <!-- Hottest Cars -->
    <div class="card">
      <h3>🔥 Hottest Active Inventory (by Leads)</h3>
      ${hottestCars.length === 0
        ? '<div style="color:var(--muted);font-size:13px">No lead data in inventory report (col N).</div>'
        : '<table class="data-table" style="width:100%"><thead><tr><th>#</th><th>Vehicle</th><th>Stock</th><th style="text-align:right">Leads</th></tr></thead><tbody>' +
          hottestCars.map((c,i) => '<tr>' +
            '<td style="color:var(--muted)">' + (i+1) + '</td>' +
            '<td>' + c.vehicle + '</td>' +
            '<td><b>' + c.stock + '</b></td>' +
            '<td style="text-align:right;font-weight:700;color:var(--accent)">' + c.leads + '</td>' +
            '</tr>').join('') +
          '</tbody></table>'}
    </div>

    <!-- Active vs Inactive -->
    <div class="card">
      <h3>📊 Inventory Status</h3>
      <div class="grid-2" style="margin-bottom:14px">
        <div class="stat-card green" style="text-align:center">
          <div class="label">Active</div>
          <div class="val">${activeInv.length}</div>
          <div class="sub">${invRows.length ? Math.round(activeInv.length/invRows.length*100) : 0}% of total</div>
        </div>
        <div class="stat-card" style="text-align:center">
          <div class="label">Inactive / Other</div>
          <div class="val">${inactiveInv.length}</div>
          <div class="sub">${invRows.length} total in report</div>
        </div>
      </div>
      <!-- Aging summary for active -->
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px">Active Inventory Aging</div>
      ${[
        { label:'0–30 days',  items:age0_30,  color:'var(--green)' },
        { label:'31–60 days', items:age31_60, color:'var(--yellow)' },
        { label:'61–90 days', items:age61_90, color:'var(--orange)' },
        { label:'90+ days',   items:age90p,   color:'var(--red)' },
      ].map(({label,items,color}) => {
        const pct = activeInv.length ? Math.min(100,(items.length/activeInv.length)*100) : 0;
        const totalCost = items.reduce((s,r)=>s+(parseMoney(r['total cost']||r[' total cost'])||0),0);
        return '<div class="aging-band">' +
          '<span class="range">' + label + '</span>' +
          '<div class="bar"><div class="fill" style="width:' + pct + '%;background:' + color + '">' +
          (items.length>0?items.length:'') + '</div></div>' +
          '<span style="font-size:12px;color:var(--muted);width:24px;text-align:right">' + items.length + '</span>' +
          (totalCost>0?'<span style="font-size:11px;color:var(--muted);width:72px;text-align:right">'+fmt$(totalCost)+'</span>':'') +
          '</div>';
      }).join('')}
      <div style="font-size:11px;color:var(--muted);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
        Avg age: <b style="color:var(--text)">${activeInv.length?Math.round(activeInv.reduce((s,r)=>s+(+r.age||0),0)/activeInv.length):0}d</b>
        &nbsp;|&nbsp;
        Total cost: <b style="color:var(--text)">${fmt$(activeInv.reduce((s,r)=>s+(parseMoney(r['total cost']||r[' total cost'])||0),0))}</b>
      </div>
    </div>
  </div>

  <!-- ══ OUTSTANDING TITLES ══ -->
  <div class="card" style="margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <h3 style="margin-bottom:0">📋 Outstanding Titles <span style="font-size:11px;font-weight:400;color:var(--muted)">(Apr 11, 2026 and later)</span></h3>
      ${outstandingTitles.length
        ? '<span style="font-size:12px;color:var(--muted)">' + outstandingTitles.length + ' title' + (outstandingTitles.length!==1?'s':'') + ' not yet sent</span>'
        : ''}
    </div>
    ${titlesTable}
  </div>

  <!-- Last Month Summary -->
  <div class="card" style="margin-bottom:16px">
    <h3>Last Month Summary — ${monthNames[lastM]} ${lastY}</h3>
    <div class="grid-4" style="margin-bottom:0">
      <div class="stat-card" style="background:var(--card2)">
        <div class="label">Units Sold</div>
        <div class="val">${soldLast.length}</div>
      </div>
      <div class="stat-card" style="background:var(--card2)">
        <div class="label">Total Gross Profit</div>
        <div class="val" style="font-size:20px">${fmt$(grossLast)}</div>
        <div class="sub">Front + Back combined</div>
      </div>
      <div class="stat-card" style="background:var(--card2)">
        <div class="label">Avg Gross / Unit</div>
        <div class="val" style="font-size:20px">${soldLast.length ? fmt$(grossLast/soldLast.length) : '—'}</div>
      </div>
      <div class="stat-card" style="background:var(--card2)">
        <div class="label">Purchased</div>
        <div class="val">${auctionLast.length}</div>
      </div>
    </div>
  </div>
  `;
}

function saveKeepInMind() {
  keepInMind = document.getElementById('keep-in-mind').innerText;
  window.sendPrompt && window.sendPrompt('Save keep-in-mind note: ' + keepInMind.substring(0,200));
}

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
  const soldLast = dealRows.filter(r => r._isSold && isSameMonth(r._date, lastY, lastM) && r._date.getDate() <= now.getDate());
  const grossThis = soldThis.reduce((s,r) => s + (r._profit||0), 0);
  const grossLast = soldLast.reduce((s,r) => s + (r._profit||0), 0);

  // PURCHASED THIS MONTH — inventory in-date (col F), more reliable than auction detection
  const invPurchasedThis = invRows.filter(r => {
    const d = parseDate(col(r, 'F'));
    return d && isSameMonth(d, thisY, thisM) && (col(r, 'B') || '').trim();
  });
  const invPurchasedLast = invRows.filter(r => {
    const d = parseDate(col(r, 'F'));
    return d && isSameMonth(d, lastY, lastM) && d.getDate() <= now.getDate() && (col(r, 'B') || '').trim();
  });

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

  // 1. Consignment Payable (Deal Detail): stock starts with C → must have Purchase Cost (col N) or Consignment Payable (col O)
  const ddConsignment = dealRows.filter(r => {
    if (!r._isSold) return false;
    const stockVal = (r._stock || '').trim();
    if (!stockVal.toUpperCase().startsWith('C')) return false;
    const nVal = parseMoney(col(r._raw, 'N')); // Purchase Cost
    const oVal = parseMoney(col(r._raw, 'O')); // Consignment Payable Cost
    const hN   = parseMoney(getField(r._raw, 'inventory purchase cost', 'purchase cost'));
    const hO   = parseMoney(getField(r._raw, 'consignment payable cost', 'consignment payable'));
    const hasCost = (!isNaN(nVal) && nVal > 0) || (!isNaN(oVal) && oVal > 0) ||
                    (!isNaN(hN)   && hN   > 0) || (!isNaN(hO)   && hO   > 0);
    return !hasCost;
  });

  // 2. Flooring Payable (Deal Detail): col E has "Westlake Flooring" → must have Purchase Cost (col N) or Flooring Payable (col P)
  const ddFlooringPayable = dealRows.filter(r => {
    if (!r._isSold) return false;
    const flags = col(r._raw, 'E').toLowerCase();
    if (!flags.includes('westlake flooring')) return false;
    const nVal = parseMoney(col(r._raw, 'N')); // Purchase Cost
    const pVal = parseMoney(col(r._raw, 'P')); // Flooring Payable Cost
    const hN   = parseMoney(getField(r._raw, 'inventory purchase cost', 'purchase cost'));
    const hP   = parseMoney(getField(r._raw, 'flooring payable cost', 'flooring payable'));
    const hasCost = (!isNaN(nVal) && nVal > 0) || (!isNaN(pVal) && pVal > 0) ||
                    (!isNaN(hN)   && hN   > 0) || (!isNaN(hP)   && hP   > 0);
    return !hasCost;
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

  // 9. Consignment Payable (Inventory): col B starts with C → must have Purchase Cost (col I) or Consignment Payable (col K)
  // Inventory column layout: A=Status, B=Stock#, C=Vehicle, D=VIN, E=Miles, F=InDate,
  //   G=Age, H=Color, I=PurchaseCost, J=FlooringPayable, K=ConsignmentPayable, L=TotalCost, M=Price, N=Leads
  const invConsignment = activeInv.filter(r => {
    const stockB = col(r, 'B').trim();
    if (!stockB.toUpperCase().startsWith('C')) return false;
    const iVal = parseMoney(col(r, 'I')); // Purchase Cost
    const kVal = parseMoney(col(r, 'K')); // Consignment Payable Cost
    return !((!isNaN(iVal) && iVal > 0) || (!isNaN(kVal) && kVal > 0));
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

  // ── To-Do column builder (collapsible cards) ──
  let _todoIdx = 0;
  function buildTodoCol(icon, color, title, items, renderFn, emptyMsg) {
    const id = 'tfl' + (_todoIdx++);
    const count = items.length;
    const badge = count
      ? '<span style="display:inline-flex;align-items:center;min-width:20px;height:20px;background:' + color + ';color:#fff;border-radius:10px;padding:0 6px;font-size:10px;font-weight:800;margin-left:6px">' + count + '</span>'
      : '<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:rgba(16,185,129,.12);color:rgba(16,185,129,.85);border-radius:10px;font-size:11px;font-weight:700;margin-left:6px">✓</span>';
    let body;
    if (!count) {
      body = '<div style="color:var(--green);font-size:12px;padding:6px 2px">' + (emptyMsg || '✅ All clear') + '</div>';
    } else {
      body = items.slice(0, MAX_ITEMS).map(renderFn).join('');
      if (count > MAX_ITEMS) body += '<div style="font-size:11px;color:var(--muted);margin-top:6px;padding-top:4px;border-top:1px solid var(--border)">+ ' + (count - MAX_ITEMS) + ' more…</div>';
    }
    const open = count > 0;
    return (
      '<div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--card2)">' +
        '<div onclick="toggleTodoFlag(\'' + id + '\')" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer;user-select:none;gap:8px' + (count ? ';background:rgba(0,0,0,.03)' : '') + '">' +
          '<div style="display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden">' +
            '<span style="font-size:13px;flex-shrink:0">' + icon + '</span>' +
            '<span style="font-size:10px;font-weight:700;color:' + (count ? color : 'var(--muted)') + ';text-transform:uppercase;letter-spacing:.6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + title + '</span>' +
            badge +
          '</div>' +
          '<span id="' + id + '_arr" style="font-size:12px;color:var(--muted);flex-shrink:0">' + (open ? '▾' : '▸') + '</span>' +
        '</div>' +
        '<div id="' + id + '" style="display:' + (open ? 'block' : 'none') + ';padding:10px 14px;border-top:1px solid var(--border)">' +
          body +
        '</div>' +
      '</div>'
    );
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

  // ── YTD monthly data ──
  const ytdGross = Array(12).fill(0);
  const ytdUnits = Array(12).fill(0);
  dealRows.forEach(r => {
    if (!r._isSold || !r._date || r._date.getFullYear() !== thisY) return;
    ytdGross[r._date.getMonth()] += r._profit || 0;
    ytdUnits[r._date.getMonth()]++;
  });
  const ytdMax    = Math.max(...ytdGross.map(Math.abs), 1);
  const ytdTotal  = ytdGross.reduce((s, v) => s + v, 0);
  const ytdBars   = monthNames.slice(0, thisM + 1).map((mn, mi) => {
    const g    = ytdGross[mi];
    const u    = ytdUnits[mi];
    const pct  = Math.round(Math.max(0, g) / ytdMax * 100);
    const prev = mi > 0 ? ytdGross[mi - 1] : null;
    const mom  = (prev !== null && prev !== 0) ? Math.round((g - prev) / Math.abs(prev) * 100) : null;
    const isCur = mi === thisM;
    const fill  = g < 0 ? 'rgba(239,68,68,.5)' : isCur ? 'rgba(45,139,255,.75)' : 'rgba(255,255,255,.13)';
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;min-width:0">
      <div style="font-size:9.5px;font-weight:${isCur?'700':'400'};color:${g>=0?(isCur?'var(--text)':'var(--text2)'):'var(--red)'};white-space:nowrap">${g!==0?fmt$(g):'—'}</div>
      <div style="width:100%;height:80px;display:flex;align-items:flex-end">
        <div style="width:100%;height:${Math.max(pct,g!==0?3:0)}%;background:${fill};border-radius:3px 3px 0 0"></div>
      </div>
      <div style="font-size:8.5px;color:${mom!==null?(mom>=0?'rgba(16,185,129,.8)':'rgba(239,68,68,.8)'):'transparent'};font-weight:600">${mom!==null?(mom>=0?'+':'')+mom+'%':'-'}</div>
      <div style="font-size:9px;color:${isCur?'var(--text)':'var(--muted)'};font-weight:${isCur?'700':'400'}">${mn}</div>
    </div>`;
  }).join('');
  const ytdAvgGross  = soldThis.length ? Math.round(grossThis / soldThis.length) : 0;
  const ytdUnitTotal = ytdUnits.reduce((s,v) => s + v, 0);

  // ── Build HTML ──
  el.innerHTML = errHtml + `

  <!-- ── KPI Strip ── -->
  <div class="kpi-strip" style="margin-bottom:18px">
    <div class="kpi-cell">
      <div class="kpi-label">Units Sold · ${monthNames[thisM]}</div>
      <div class="kpi-val">${soldThis.length}</div>
      <div class="kpi-sub">${soldThis.length > soldLast.length ? '↑' : soldThis.length < soldLast.length ? '↓' : '→'} ${soldLast.length} last month</div>
    </div>
    <div class="kpi-cell kpi-cell-accent">
      <div class="kpi-label">Gross Profit · ${monthNames[thisM]}</div>
      <div class="kpi-val" style="color:${grossThis>=0?'var(--text)':'var(--red)'}">${fmt$(grossThis)}</div>
      <div class="kpi-sub">Last mo ${fmt$(grossLast)} · avg ${ytdAvgGross?fmt$(ytdAvgGross):' —'}/unit</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-label">Active Inventory</div>
      <div class="kpi-val">${activeInv.length}</div>
      <div class="kpi-sub">${age90p.length > 0 ? age90p.length + ' over 90d · ' : ''}avg age ${activeInv.length ? Math.round(activeInv.reduce((s,r)=>s+(+r.age||0),0)/activeInv.length) : 0}d</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-label">YTD · ${thisY}</div>
      <div class="kpi-val">${fmt$(ytdTotal)}</div>
      <div class="kpi-sub">${ytdUnitTotal} units · top brand ${topBrand[0]}</div>
    </div>
  </div>

  <!-- ── YTD Gross Profit Chart ── -->
  <div class="sec-rule" style="margin-bottom:12px"><span>Year to Date</span></div>
  <div class="card" style="margin-bottom:18px">
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px">
      <div>
        <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted)">YTD Gross Profit ${thisY}</div>
        <div style="font-size:22px;font-weight:700;color:${ytdTotal>=0?'var(--text)':'var(--red)'};margin-top:3px;letter-spacing:-.5px">${fmt$(ytdTotal)}</div>
      </div>
      <div style="font-size:11px;color:var(--text2);text-align:right">${ytdUnitTotal} units sold<br><span style="color:var(--muted)">${ytdUnitTotal?fmt$(Math.round(ytdTotal/ytdUnitTotal)):' —'} avg/unit</span></div>
    </div>
    <div style="display:flex;gap:4px;align-items:stretch">${ytdBars || '<div style="color:var(--muted);font-size:12px">No deal data yet for ' + thisY + '</div>'}</div>
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:flex;gap:20px;font-size:11px;color:var(--text2)">
      <span><span style="display:inline-block;width:8px;height:8px;background:rgba(45,139,255,.75);border-radius:2px;margin-right:4px"></span>Current month</span>
      <span><span style="display:inline-block;width:8px;height:8px;background:rgba(255,255,255,.13);border-radius:2px;margin-right:4px"></span>Prior months</span>
    </div>
  </div>

  <!-- ── Section rule: Bulletin ── -->
  <div class="sec-rule" style="margin-bottom:10px"><span>Bulletin Board</span></div>
  <div class="card" style="margin-bottom:22px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-size:11px;color:var(--muted)">Team notes — stays pinned across sessions</div>
      <button class="btn btn-sm" onclick="saveKeepInMind()">Save</button>
    </div>
    <div id="keep-in-mind" class="notes-area" contenteditable="true" spellcheck="false">${keepInMind}</div>
  </div>

  <!-- ── Section rule: Flags ── -->
  <div class="sec-rule" style="margin-bottom:10px">
    <span>Action Items</span>
    ${totalFlags > 0
      ? '<span style="font-size:10px;background:rgba(239,68,68,.15);color:rgba(239,68,68,.85);border:1px solid rgba(239,68,68,.2);border-radius:4px;padding:2px 8px;font-weight:700;letter-spacing:.5px">' + totalFlags + ' open</span>'
      : '<span style="font-size:10px;color:rgba(16,185,129,.6);font-weight:600">All clear</span>'}
  </div>
  <div class="card" style="margin-bottom:22px">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
      ${todoHtml}
    </div>
  </div>

  <!-- ── Section rule: Inventory ── -->
  <div class="sec-rule" style="margin-bottom:10px"><span>Inventory</span></div>
  <div class="grid-2" style="margin-bottom:22px">
    <!-- Hottest cars by leads -->
    <div class="card">
      <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-bottom:12px">Hottest Active (by Leads)</div>
      ${hottestCars.length === 0
        ? '<div style="color:var(--muted);font-size:12px">No lead data in inventory report (col N).</div>'
        : '<table class="data-table"><thead><tr><th>#</th><th>Vehicle</th><th>Stock</th><th style="text-align:right">Leads</th></tr></thead><tbody>' +
          hottestCars.map((c,i) => '<tr>' +
            '<td style="color:var(--muted);width:24px">' + (i+1) + '</td>' +
            '<td>' + c.vehicle + '</td>' +
            '<td style="color:var(--text2);font-size:10px;letter-spacing:1px">' + c.stock.toUpperCase() + '</td>' +
            '<td style="text-align:right;font-weight:600;color:var(--text)">' + c.leads + '</td>' +
            '</tr>').join('') +
          '</tbody></table>'}
    </div>

    <!-- Inventory aging -->
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
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px">Active Inventory Aging</div>
      ${[
        { label:'0–30 days',  items:age0_30,  color:'rgba(100,140,200,.35)' },
        { label:'31–60 days', items:age31_60, color:'rgba(100,140,200,.35)' },
        { label:'61–90 days', items:age61_90, color:'rgba(100,140,200,.35)' },
        { label:'90+ days',   items:age90p,   color:'var(--red)' },
      ].map(({label,items,color}) => {
        const pct = activeInv.length ? Math.min(100,(items.length/activeInv.length)*100) : 0;
        const totalCostBucket = items.reduce((s,r)=>s+(parseMoney(r['total cost']||r[' total cost'])||0),0);
        return '<div class="aging-band">' +
          '<span class="range">' + label + '</span>' +
          '<div class="bar"><div class="fill" style="width:' + pct + '%;background:' + color + '">' + (items.length>0?items.length:'') + '</div></div>' +
          '<span style="font-size:12px;color:var(--muted);width:24px;text-align:right">' + items.length + '</span>' +
          (totalCostBucket>0?'<span style="font-size:11px;color:var(--muted);width:72px;text-align:right">'+fmt$(totalCostBucket)+'</span>':'') +
          '</div>';
      }).join('')}
      <div style="font-size:11px;color:var(--muted);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
        Avg age: <b style="color:var(--text)">${activeInv.length?Math.round(activeInv.reduce((s,r)=>s+(+r.age||0),0)/activeInv.length):0}d</b>
        &nbsp;·&nbsp;
        Total cost: <b style="color:var(--text)">${fmt$(activeInv.reduce((s,r)=>s+(parseMoney(r['total cost']||r[' total cost'])||0),0))}</b>
      </div>
    </div>
  </div>

  <!-- ── Section rule: Titles ── -->
  <div class="sec-rule" style="margin-bottom:10px">
    <span>Outstanding Titles</span>
    <span style="font-size:9px;color:var(--muted);font-weight:400">Apr 11, 2026+</span>
    ${outstandingTitles.length ? '<span style="font-size:10px;color:var(--text2)">' + outstandingTitles.length + ' outstanding</span>' : ''}
  </div>
  <div class="card" style="margin-bottom:22px">${titlesTable}</div>

  <!-- ── Section rule: Last Month ── -->
  <div class="sec-rule" style="margin-bottom:10px"><span>${monthNames[lastM]} ${lastY}</span></div>
  <div class="kpi-strip" style="margin-bottom:20px">
    <div class="kpi-cell">
      <div class="kpi-label">Units Sold</div>
      <div class="kpi-val">${soldLast.length}</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-label">Total Gross</div>
      <div class="kpi-val" style="font-size:22px">${fmt$(grossLast)}</div>
      <div class="kpi-sub">Front + Back</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-label">Avg Gross / Unit</div>
      <div class="kpi-val" style="font-size:22px">${soldLast.length ? fmt$(Math.round(grossLast/soldLast.length)) : '—'}</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-label">Purchased</div>
      <div class="kpi-val">${invPurchasedLast.length}</div>
      <div class="kpi-sub">vehicles acquired</div>
    </div>
  </div>

  <div style="font-size:10px;color:var(--muted);margin-bottom:20px;padding-bottom:10px">
    📦 Inventory: ${invRows.length} rows &nbsp;·&nbsp; 🤝 Deals: ${dealRows.length} rows &nbsp;·&nbsp; 🔧 Item Costs: ${itemRows.length} rows
  </div>
  `;
}

function saveKeepInMind() {
  keepInMind = document.getElementById('keep-in-mind').innerText;
  window.sendPrompt && window.sendPrompt('Save keep-in-mind note: ' + keepInMind.substring(0, 200));
}

// ── Collapsible to-do flag cards ──
function toggleTodoFlag(id) {
  const body  = document.getElementById(id);
  const arrow = document.getElementById(id + '_arr');
  if (!body) return;
  const nowOpen = body.style.display !== 'none';
  body.style.display  = nowOpen ? 'none' : 'block';
  if (arrow) arrow.textContent = nowOpen ? '▸' : '▾';
}

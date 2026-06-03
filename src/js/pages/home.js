'use strict';

// ══════════════════════════════════════════════
//  PAGE: HOME — src/js/pages/home.js
// ══════════════════════════════════════════════

async function loadHome() {
  const el = document.getElementById('home-body');
  el.innerHTML = loading('Loading inventory & sales data…');
  const [invR, dealR, itemR, payR, wlR, titR, dtsR] = await Promise.allSettled([
    getInventoryRows(), getDealDetailRows(), getItemizedCostRows(), getDealPaymentRows(),
    getWestlakePaidUnitsRows(), getTitlesRows(), getDTSRows()
  ]);
  const invRows    = invR.status  === 'fulfilled' ? invR.value  : null;
  const dealRows   = dealR.status === 'fulfilled' ? dealR.value : null;
  const itemRows   = itemR.status === 'fulfilled' ? itemR.value : null;
  const payRows    = payR.status  === 'fulfilled' ? payR.value  : [];
  const wlPaidRows = wlR.status   === 'fulfilled' ? wlR.value   : [];
  const titlesRows = titR.status  === 'fulfilled' ? titR.value  : [];
  const dtsRows    = dtsR.status  === 'fulfilled' ? dtsR.value  : [];
  const errs = [
    invR.status  === 'rejected' ? '⚠ Inventory: '  + (invR.reason?.message  || invR.reason)  : null,
    dealR.status === 'rejected' ? '⚠ Deal Detail: ' + (dealR.reason?.message || dealR.reason) : null,
    itemR.status === 'rejected' ? '⚠ Item Costs: '  + (itemR.reason?.message || itemR.reason) : null,
  ].filter(Boolean);
  const errHtml = errs.length ? `<div class="error-box" style="margin-bottom:12px">${errs.join('<br>')}</div>` : '';
  renderHome(el, invRows || [], dealRows || [], itemRows || [], payRows || [], errHtml, wlPaidRows, titlesRows, dtsRows);
}

function renderHome(el, invRows, dealRows, itemRows, payRows, errHtml, wlPaidRows, titlesRows, dtsRows) {
  errHtml    = errHtml    || '';
  payRows    = payRows    || [];
  wlPaidRows = wlPaidRows || [];
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

  // Auction purchases this month
  const auctionThis = itemRows.filter(r => {
    const d = parseDate(r.date);
    return d && isSameMonth(d, thisY, thisM) && detectAuction(r);
  });
  const auctionLast = itemRows.filter(r => {
    const d = parseDate(r.date);
    return d && isSameMonth(d, lastY, lastM) && detectAuction(r);
  });

  // Top brand this month
  const brandCt = {};
  soldThis.forEach(r => { const b = r._make||'Unknown'; brandCt[b] = (brandCt[b]||0)+1; });
  const topBrand = Object.entries(brandCt).sort((a,b)=>b[1]-a[1])[0] || ['—',0];

  // Active inventory — Status column = "Active" exactly
  const activeInv = invRows.filter(r => (r.status||'').toLowerCase() === 'active');

  // Aging brackets
  const age0_30  = activeInv.filter(r => +r.age <= 30);
  const age31_60 = activeInv.filter(r => +r.age > 30 && +r.age <= 60);
  const age61_90 = activeInv.filter(r => +r.age > 60 && +r.age <= 90);
  const age90p   = activeInv.filter(r => +r.age > 90);

  // To-do flags
  const missingStock = activeInv.filter(r => {
    const s = String(r['stock number']||r['stock #']||'').trim();
    return !s || s === '—';
  });
  // Only flag vehicles added in 2024 or later
  const is2024Plus = d => d && d.getFullYear && d.getFullYear() >= 2024;
  const missingCost = activeInv.filter(r => {
    const cost  = parseMoney(r['total cost'] || r[' total cost']);
    const inDt  = parseDate(r['in date'] || '');
    return is2024Plus(inDt) && (isNaN(cost) || cost <= 25);
  });
  // VSC/GAP flags — from deal detail (sold deals with revenue but no matching cost, 2024+ only)
  const missingVSC = dealRows.filter(r => {
    if (!r._isSold) return false;
    if (!is2024Plus(r._inDate || r._date)) return false;
    const vscAmt  = parseMoney(getField(r._raw,'pricing vsc amount','vsc amount','vsc revenue','vsc'));
    const vscCost = parseMoney(getField(r._raw,'pricing vsc cost','vsc cost'));
    return !isNaN(vscAmt) && vscAmt > 0 && (isNaN(vscCost) || vscCost <= 0);
  });
  const missingGAP = dealRows.filter(r => {
    if (!r._isSold) return false;
    if (!is2024Plus(r._inDate || r._date)) return false;
    const gapAmt  = parseMoney(getField(r._raw,'pricing gap amount','gap amount','gap revenue','gap'));
    const gapCost = parseMoney(getField(r._raw,'pricing gap cost','gap cost'));
    return !isNaN(gapAmt) && gapAmt > 0 && (isNaN(gapCost) || gapCost <= 0);
  });

  // "Record Deal Payment" — sold (closing date) but no matching payment recorded
  const missingPayment = dealRows.filter(r => {
    if (!r._isSold || !r._date) return false;
    const vin   = (getField(r._raw,'inventory vehicle vin','vin','vehicle vin')||'').trim().toUpperCase();
    const stock = (r._stock||'').trim().toLowerCase();
    if (!vin && !stock) return false;
    const hasPmt = payRows.some(p => {
      const pVin   = (getField(p,'vin','vehicle vin','inventory vin')||'').trim().toUpperCase();
      const pStock = (getField(p,'stock number','stock #','stock')||'').trim().toLowerCase();
      return (vin && pVin && pVin === vin) || (stock && pStock && pStock === stock);
    });
    return !hasPmt;
  });

  // "Update Flooring Costs" — paid off in Westlake but missing flooring payable in Itemized Costs
  const missingFlooringCosts = (() => {
    if (!wlPaidRows.length) return [];
    // Build set of stock/VINs that have a flooring payable entry in itemized costs
    const flooredInItemized = new Set();
    itemRows.forEach(r => {
      const t = (r['type']||r['transaction type']||'').toLowerCase();
      if (!t.includes('floor')) return;
      const v = (r['vin']||r['vehicle vin']||'').trim().toUpperCase();
      const s = (r['stock']||r['stock number']||r['stock #']||'').trim().toLowerCase();
      if (v) flooredInItemized.add(v);
      if (s) flooredInItemized.add(s);
    });
    return wlPaidRows.filter(r => {
      const vin   = (r['vin']||r['vehicle vin']||r['unit vin']||'').trim().toUpperCase();
      const stock = (r['stock']||r['stock number']||r['stock #']||'').trim().toLowerCase();
      if (!vin && !stock) return false;
      const found = (vin && flooredInItemized.has(vin)) || (stock && flooredInItemized.has(stock));
      return !found;
    });
  })();

  // Vehicles 30+ days (flagged)
  const aged = activeInv.filter(r => +r.age >= 30).sort((a,b) => +b.age - +a.age);

  // Outstanding titles — closed but title not yet sent; cross-reference DTS via Deal Detail bridge
  const today = new Date();

  // Build DTS lookup: stock# → { status, transferDate }
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

  // Bridge: Deal Detail → (normalized vehicle + closing date) → { stock, isFinanced }
  function normVehicle(v) { return (v||'').toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim(); }
  const dealBridge = {};
  dealRows.forEach(r => {
    if (!r._stock || !r._date) return;
    const key = normVehicle(r._vehicle) + '|' + r._date.toLocaleDateString('en-US');
    if (!dealBridge[key]) {
      // Detect financed deals: deal type, lender fields, OR presence of an acquisition fee
      const dealType   = (getField(r._raw,'deal type','type','financing type','finance type')||'').toLowerCase();
      const lender     = (getField(r._raw,'lender','lender name','lienholder','finance company')||'').toLowerCase();
      const acqFeeRaw  = getField(r._raw,'acquisition fee','acq fee','acquisition','acq. fee');
      const hasAcqFee  = !isNaN(parseMoney(acqFeeRaw)) && parseMoney(acqFeeRaw) > 0;
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
      if (parseDate(sentRaw)) return null; // already sent in Title Report
      const daysOut = Math.floor((today - closing) / 86400000);
      const vehicle  = getField(r,'vehicle','inventory vehicle name','car','description','unit') || '—';
      const received = !!parseDate(receivedRaw);
      // Stock: try Title Report directly, then Deal Detail bridge
      let stock = (getField(r,'stock','stock number','stock #') || '').trim().toLowerCase();
      const bridgeEntry = dealBridge[normVehicle(vehicle) + '|' + closing.toLocaleDateString('en-US')];
      if (!stock && bridgeEntry) stock = bridgeEntry.stock;
      const isFinanced = bridgeEntry ? bridgeEntry.isFinanced : false;
      // Drop financed deals older than 90 days — lender has already followed up
      if (isFinanced && daysOut > 90) return null;
      const dts = stock ? (dtsLookup[stock] || null) : null;
      return { vehicle, stock, closing, daysOut, received, dts, isFinanced };
    })
    .filter(Boolean)
    .filter(t => t.daysOut <= 700)
    .sort((a,b) => b.daysOut - a.daysOut);
  })();

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  el.innerHTML = errHtml + `
  <div style="font-size:11px;color:var(--muted);margin-bottom:10px">
    📦 Inventory: ${invRows.length} rows &nbsp;|&nbsp;
    🤝 Deals: ${dealRows.length} rows &nbsp;|&nbsp;
    🔧 Item Costs: ${itemRows.length} rows
  </div>
  <!-- Stats Row -->
  <div class="grid-4">
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

  <!-- Inventory Aging + To-Do -->
  <div class="grid-2" style="margin-bottom:16px">
    <!-- Aging — Active inventory only -->
    <div class="card">
      <h3>Inventory Aging — ${activeInv.length} Active Units Only</h3>
      ${[
        { label:'0–30 days',  items:age0_30,  color:'var(--green)' },
        { label:'31–60 days', items:age31_60, color:'var(--yellow)' },
        { label:'61–90 days', items:age61_90, color:'var(--orange)' },
        { label:'90+ days',   items:age90p,   color:'var(--red)' },
      ].map(({label,items,color}) => {
        const totalCostBand = items.reduce((s,r)=>s+(parseMoney(r['total cost']||r[' total cost'])||0),0);
        return `
        <div class="aging-band">
          <span class="range">${label}</span>
          <div class="bar">
            <div class="fill" style="width:${Math.min(100,(items.length/Math.max(activeInv.length,1))*100)}%;background:${color}">
              ${items.length > 0 ? items.length : ''}
            </div>
          </div>
          <span style="font-size:12px;color:var(--muted);width:24px;text-align:right">${items.length}</span>
          ${totalCostBand>0?`<span style="font-size:11px;color:var(--muted);width:72px;text-align:right">${fmt$(totalCostBand)}</span>`:''}
        </div>`;
      }).join('')}
      <div style="font-size:11px;color:var(--muted);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
        Avg age: <b style="color:var(--text)">${activeInv.length?Math.round(activeInv.reduce((s,r)=>s+(+r.age||0),0)/activeInv.length):0}d</b>
        &nbsp;|&nbsp;
        Total inventory cost: <b style="color:var(--text)">${fmt$(activeInv.reduce((s,r)=>s+(parseMoney(r['total cost']||r[' total cost'])||0),0))}</b>
      </div>
      ${aged.length ? `
        <div style="margin-top:12px">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">⚠ Active Vehicles 30+ Days (${aged.length})</div>
          ${aged.slice(0,15).map(r => {
            const cost = parseMoney(r['total cost']||r[' total cost']);
            return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);font-size:12px">
              <span><b>${r['stock number']||r['stock #']||'—'}</b> ${r.vehicle||''}</span>
              <span style="display:flex;gap:6px;align-items:center">
                ${!isNaN(cost)?`<span style="color:var(--muted)">${fmt$(cost)}</span>`:''}
                <span class="badge ${+r.age>90?'badge-red':+r.age>60?'badge-yellow':'badge-blue'}">${r.age}d</span>
              </span>
            </div>`;
          }).join('')}
          ${aged.length > 15 ? `<div style="font-size:11px;color:var(--muted);margin-top:6px">+${aged.length-15} more</div>` : ''}
        </div>
      ` : '<div style="color:var(--green);font-size:12px;margin-top:8px">✓ No active vehicles over 30 days</div>'}
    </div>

    <!-- To-Do -->
    <div class="card">
      <h3>⚡ To-Do / Flags</h3>

      ${missingStock.length ? `
        <div style="margin-bottom:12px">
          <div style="font-size:12px;font-weight:600;color:var(--red);margin-bottom:5px">🔴 Missing Stock # (${missingStock.length})</div>
          ${missingStock.slice(0,4).map(r=>`
            <div style="font-size:12px;padding:3px 0;border-bottom:1px solid var(--border)">
              ${r.vehicle||'—'} &nbsp;<span style="color:var(--muted)">In: ${r['in date']||'?'}</span>
            </div>`).join('')}
          ${missingStock.length>4?`<div style="font-size:11px;color:var(--muted);margin-top:3px">+${missingStock.length-4} more</div>`:''}
        </div>
      ` : ''}

      ${missingCost.length ? `
        <div style="margin-bottom:12px">
          <div style="font-size:12px;font-weight:600;color:var(--yellow);margin-bottom:5px">🟡 Missing Purchase Cost (${missingCost.length})</div>
          ${missingCost.slice(0,4).map(r=>`
            <div style="font-size:12px;padding:3px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between">
              <span>${r['stock number']||r['stock #']||'—'} — ${r.vehicle||''}</span>
              <span class="badge badge-yellow">$0</span>
            </div>`).join('')}
          ${missingCost.length>4?`<div style="font-size:11px;color:var(--muted);margin-top:3px">+${missingCost.length-4} more</div>`:''}
        </div>
      ` : ''}

      ${missingVSC.length ? `
        <div style="margin-bottom:12px">
          <div style="font-size:12px;font-weight:600;color:var(--orange);margin-bottom:5px">🟠 Missing Warranty Cost / VSC (${missingVSC.length})</div>
          ${missingVSC.slice(0,4).map(r=>`
            <div style="font-size:12px;padding:3px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between">
              <span>${r._stock||'—'} — ${r._vehicle||''}</span>
              <span class="badge badge-yellow">No VSC Cost</span>
            </div>`).join('')}
          ${missingVSC.length>4?`<div style="font-size:11px;color:var(--muted);margin-top:3px">+${missingVSC.length-4} more</div>`:''}
        </div>
      ` : ''}

      ${missingGAP.length ? `
        <div style="margin-bottom:12px">
          <div style="font-size:12px;font-weight:600;color:var(--orange);margin-bottom:5px">🟠 Missing GAP Cost (${missingGAP.length})</div>
          ${missingGAP.slice(0,4).map(r=>`
            <div style="font-size:12px;padding:3px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between">
              <span>${r._stock||'—'} — ${r._vehicle||''}</span>
              <span class="badge badge-yellow">No GAP Cost</span>
            </div>`).join('')}
          ${missingGAP.length>4?`<div style="font-size:11px;color:var(--muted);margin-top:3px">+${missingGAP.length-4} more</div>`:''}
        </div>
      ` : ''}

      ${missingPayment.length ? `
        <div style="margin-bottom:12px">
          <div style="font-size:12px;font-weight:600;color:var(--red);margin-bottom:5px">🔴 Record Deal Payment — Closed, No Payment on File (${missingPayment.length})</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:5px">These vehicles have a closing date in Deal Detail but no matching entry in Deal Payments report.</div>
          ${missingPayment.slice(0,6).map(r=>`
            <div style="font-size:12px;padding:3px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between">
              <span><b>${r._stock||'—'}</b> — ${r._vehicle||''}</span>
              <span style="color:var(--muted)">${r._date?.toLocaleDateString()||'?'}</span>
            </div>`).join('')}
          ${missingPayment.length>6?`<div style="font-size:11px;color:var(--muted);margin-top:3px">+${missingPayment.length-6} more</div>`:''}
        </div>
      ` : ''}

      ${missingFlooringCosts.length ? `
        <div style="margin-bottom:12px">
          <div style="font-size:12px;font-weight:600;color:var(--yellow);margin-bottom:5px">🟡 Update Flooring Costs (${missingFlooringCosts.length})</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:5px">Paid off in Westlake Paid Units but no flooring entry found in Itemized Inventory Costs.</div>
          ${missingFlooringCosts.slice(0,6).map(r=>{
            const vin   = (r['vin']||r['vehicle vin']||r['unit vin']||'—').trim();
            const stock = (r['stock']||r['stock number']||r['stock #']||'').trim();
            const veh   = (r['vehicle']||r['unit']||r['description']||'').trim();
            return `<div style="font-size:12px;padding:3px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between">
              <span><b>${stock||vin}</b>${veh?' — '+veh:''}</span>
              <span class="badge badge-yellow">Missing Floor Cost</span>
            </div>`;
          }).join('')}
          ${missingFlooringCosts.length>6?`<div style="font-size:11px;color:var(--muted);margin-top:3px">+${missingFlooringCosts.length-6} more</div>`:''}
        </div>
      ` : ''}

      ${!missingStock.length && !missingCost.length && !missingVSC.length && !missingGAP.length && !missingPayment.length && !missingFlooringCosts.length
        ? '<div style="color:var(--green);font-size:13px;margin-bottom:12px">✅ No flags — all data looks complete!</div>'
        : ''}

      <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.6px;margin-top:4px">Keep In Mind</div>
      <div id="keep-in-mind" class="notes-area" contenteditable="true" spellcheck="false">${keepInMind}</div>
      <div style="margin-top:8px;display:flex;gap:8px">
        <button class="btn btn-sm" onclick="saveKeepInMind()">💾 Save Note</button>
      </div>
    </div>
  </div>

  <!-- Outstanding Titles -->
  <div class="card" style="margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <h3 style="margin-bottom:0">📋 Outstanding Titles</h3>
      ${outstandingTitles.length
        ? `<span style="font-size:12px;color:var(--muted)">${outstandingTitles.length} title${outstandingTitles.length!==1?'s':''} not yet sent</span>`
        : ''}
    </div>
    ${!titlesRows.length
      ? `<div style="color:var(--muted);font-size:13px">No titles report found — drop a "Sold Inventory - Title Report" CSV into the Titles folder and reload.</div>`
      : outstandingTitles.length === 0
      ? `<div style="color:var(--green);font-size:13px">✅ All titles accounted for — nothing outstanding.</div>`
      : buildTitlesTable(outstandingTitles)}
  </div>

  <!-- Last Month Stats -->
  <div class="card" style="margin-bottom:16px">
    <div class="sec-hdr">
      <h3 style="margin-bottom:0">Last Month Summary — ${monthNames[lastM]} ${lastY}</h3>
    </div>
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
        <div class="label">Avg Gross Profit / Unit</div>
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

// keepInMind state lives in dashboard.js — do not re-declare here
function saveKeepInMind() {
  keepInMind = document.getElementById('keep-in-mind').innerText;
  window.sendPrompt('Save keep-in-mind note: ' + keepInMind.substring(0,200));
}


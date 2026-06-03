'use strict';

// ══════════════════════════════════════════════
//  PAGE: METRICS — src/js/pages/metrics.js
// ══════════════════════════════════════════════

async function loadMetrics() {
  const el = document.getElementById('metrics-body');
  el.innerHTML = loading('Loading sales, leads & SP data…');
  const [dealR, leadsR, itemR, salesLogR] = await Promise.allSettled([
    getDealDetailRows(), getLeadsRows(), getItemizedCostRows(), getSalesLogData()
  ]);
  const dealRows     = dealR.status      === 'fulfilled' ? dealR.value      : [];
  const leadsRows    = leadsR.status     === 'fulfilled' ? leadsR.value     : [];
  const itemRows     = itemR.status      === 'fulfilled' ? itemR.value      : [];
  const salesLogData = salesLogR.status  === 'fulfilled' ? salesLogR.value  : {kris:[],joseph:[],felix:[]};
  const errs = [dealR, leadsR, itemR, salesLogR].map((r, i) =>
    r.status === 'rejected' ? ['Deal Detail','Leads','Item Costs','Sales Log'][i] + ': ' + (r.reason?.message||r.reason) : null
  ).filter(Boolean);
  const errHtml = errs.length ? `<div class="error-box" style="margin-bottom:12px">⚠ ${errs.join('<br>')}</div>` : '';
  renderMetrics(el, dealRows, leadsRows, itemRows, salesLogData, errHtml);
}

function renderMetrics(el, dealRows, leadsRows, itemRows, salesLogData, errHtml) {
  errHtml = errHtml || '';
  salesLogData = salesLogData || {kris:[],joseph:[],felix:[]};
  let periodFilter = 'mtd';

  function getPeriodFn() {
    const now2 = new Date();
    if (periodFilter === 'mtd') return d => d && isSameMonth(d, now2.getFullYear(), now2.getMonth());
    if (periodFilter === 'last30') { const c = new Date(now2 - 30*86400000); return d => d && d >= c; }
    if (periodFilter === 'ytd') return d => d && d.getFullYear() === now2.getFullYear();
    return null;
  }

  // Returns a filter for the "same period" in the prior cycle (for comparison)
  function getPrevPeriodFn() {
    const now2 = new Date();
    if (periodFilter === 'mtd') {
      const todayDay = now2.getDate();
      const thisM = now2.getMonth(), thisY = now2.getFullYear();
      const lM = thisM === 0 ? 11 : thisM - 1;
      const lY = thisM === 0 ? thisY - 1 : thisY;
      const lo = new Date(lY, lM, 1);
      const hi = new Date(lY, lM, todayDay, 23, 59, 59);
      return d => d && d >= lo && d <= hi;
    }
    if (periodFilter === 'last30') { const lo = new Date(now2 - 60*86400000), hi = new Date(now2 - 30*86400000); return d => d && d >= lo && d < hi; }
    if (periodFilter === 'ytd') { const lY = now2.getFullYear()-1; const eom = new Date(lY, now2.getMonth(), now2.getDate(), 23,59,59); return d => d && d.getFullYear()===lY && d<=eom; }
    return null;
  }

  function getPeriodRows(rows) {
    const fn = getPeriodFn();
    if (!fn) return rows;
    return rows.filter(r => fn(r._date));
  }

  function getPrevPeriodRows(rows) {
    const fn = getPrevPeriodFn();
    if (!fn) return [];
    return rows.filter(r => fn(r._date));
  }

  // Avg days-to-sell with 3 outlier variants
  function dtsVariants(rows) {
    const vals = rows.filter(r => r._date && r._inDate).map(r => daysBetween(r._inDate, r._date)).filter(v => v >= 0);
    if (!vals.length) return { raw:null, trimmed:null, iqr:null, n:0, removedT:0, removedI:0 };
    const sorted = [...vals].sort((a,b)=>a-b);
    const avg = arr => arr.length ? Math.round(arr.reduce((s,v)=>s+v,0)/arr.length) : null;
    const raw = avg(sorted);
    // Trimmed: remove top/bottom 10%
    const cut = Math.max(1, Math.floor(sorted.length * 0.1));
    const trimArr = sorted.slice(cut, sorted.length - cut);
    const trimmed = avg(trimArr.length ? trimArr : sorted);
    // IQR: remove outside Q1-1.5*IQR .. Q3+1.5*IQR
    const q1 = sorted[Math.floor(sorted.length*0.25)];
    const q3 = sorted[Math.floor(sorted.length*0.75)];
    const iqr = q3 - q1;
    const iqrArr = sorted.filter(v => v >= q1-1.5*iqr && v <= q3+1.5*iqr);
    const iqrAvg = avg(iqrArr.length ? iqrArr : sorted);
    return { raw, trimmed, iqr: iqrAvg, n: sorted.length, removedT: sorted.length - (trimArr.length||sorted.length), removedI: sorted.length - (iqrArr.length||sorted.length) };
  }

  function render() {
    const fn = getPeriodFn();
    const soldRows     = getPeriodRows(dealRows.filter(r => r._isSold));
    const prevSoldRows = getPrevPeriodRows(dealRows.filter(r => r._isSold));

    // ── Gross Profit breakdown (Front = Sale Price - Cost; Back = F&I)
    let totalFront = 0, totalBack = 0;
    soldRows.forEach(r => {
      const sp    = parseMoney(getField(r._raw,'pricing sale price','sale price'));
      const cost  = parseMoney(getField(r._raw,'inventory total cost','total cost'));
      const back  = parseMoney(getField(r._raw,'pricing backend profit','backend profit'));
      const front = (!isNaN(sp) && !isNaN(cost)) ? sp - cost : NaN;
      if (!isNaN(front)) totalFront += front;
      if (!isNaN(back))  totalBack  += back;
    });
    const totalGrossProfit = totalFront + totalBack;
    const avgGrossProfit   = soldRows.length ? totalGrossProfit / soldRows.length : 0;

    // ── Same-period previous totals for delta
    let prevFront = 0, prevBack = 0;
    prevSoldRows.forEach(r => {
      const sp   = parseMoney(getField(r._raw,'pricing sale price','sale price'));
      const cost = parseMoney(getField(r._raw,'inventory total cost','total cost'));
      const back = parseMoney(getField(r._raw,'pricing backend profit','backend profit'));
      if (!isNaN(sp) && !isNaN(cost)) prevFront += (sp - cost);
      if (!isNaN(back)) prevBack += back;
    });
    const prevGross = prevFront + prevBack;

    // ── Back GP flag: sold rows missing VSC cost or GAP cost (where revenue exists)
    const backGPFlagged = soldRows.filter(r => {
      const vscAmt  = parseMoney(getField(r._raw,'pricing vsc amount','vsc amount','vsc revenue','vsc'));
      const vscCost = parseMoney(getField(r._raw,'pricing vsc cost','vsc cost'));
      const gapAmt  = parseMoney(getField(r._raw,'pricing gap amount','gap amount','gap revenue','gap'));
      const gapCost = parseMoney(getField(r._raw,'pricing gap cost','gap cost'));
      return (!isNaN(vscAmt)&&vscAmt>0&&(isNaN(vscCost)||vscCost<=0)) ||
             (!isNaN(gapAmt)&&gapAmt>0&&(isNaN(gapCost)||gapCost<=0));
    });

    // ── DTS variants
    const dts = dtsVariants(soldRows);

    // ── SP leaderboard — from Sales Log (split-aware), with front/back
    const spTally  = calcSPFromSalesLog(salesLogData, fn);
    const spSorted = Object.entries(spTally).sort((a,b) => b[1].units - a[1].units);
    const maxUnits = spSorted.length ? Math.max(...spSorted.map(([,s])=>s.units)) : 1;

    // Cross-reference: SP log total vs deal detail total
    const slTotal    = Object.values(spTally).reduce((s,v) => s + v.units, 0);
    const ddTotal    = soldRows.length;
    const slRounded  = Math.round(slTotal * 10) / 10;
    const xrefOk     = Math.abs(slRounded - ddTotal) <= 1;
    const xrefMsg    = slTotal > 0 || ddTotal > 0
      ? (xrefOk
          ? `<span style="color:var(--green)">✓ Sales Log (${slRounded} units) matches Deal Detail (${ddTotal} units)</span>`
          : `<span style="color:var(--yellow)">⚠ Discrepancy: Sales Log=${slRounded} units vs Deal Detail=${ddTotal} — check entries</span>`)
      : '';

    // ── Brands
    const brandCt = {};
    soldRows.forEach(r => { const b = r._make||'Unknown'; brandCt[b]=(brandCt[b]||0)+1; });
    const brandSorted = Object.entries(brandCt).sort((a,b)=>b[1]-a[1]).slice(0,10);

    // ── Mileage buckets
    const milBuckets = {'<50k':0,'50–100k':0,'100–150k':0,'150–200k':0,'200–250k':0,'250–300k':0,'300k+':0};
    soldRows.forEach(r => {
      const m = r._mileage;
      if (m < 50000)       milBuckets['<50k']++;
      else if (m < 100000) milBuckets['50–100k']++;
      else if (m < 150000) milBuckets['100–150k']++;
      else if (m < 200000) milBuckets['150–200k']++;
      else if (m < 250000) milBuckets['200–250k']++;
      else if (m < 300000) milBuckets['250–300k']++;
      else                 milBuckets['300k+']++;
    });
    const milMax = Math.max(1, ...Object.values(milBuckets));

    // ── Leads breakdown
    const leadSrc  = {}, leadUser = {}, leadByMonth = {};
    leadsRows.forEach(r => {
      const src  = getField(r,'source name','source','lead source','origin','channel')||'Unknown';
      const user = getField(r,'assigned user','assignee','assigned to','rep')||'Unassigned';
      leadSrc[src]   = (leadSrc[src]  ||0)+1;
      leadUser[user] = (leadUser[user]||0)+1;
      const rawDate = getField(r,'creation time','created at','date','created date');
      const d = parseDate(rawDate);
      if (d) {
        const monthKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        leadByMonth[monthKey] = (leadByMonth[monthKey]||0)+1;
      }
    });
    const totalLeads = leadsRows.length;
    const leadSorted = Object.entries(leadSrc).sort((a,b)=>b[1]-a[1]);
    const userSorted = Object.entries(leadUser).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const monthNames6 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const leadMonthSorted = Object.entries(leadByMonth).sort((a,b)=>a[0]>b[0]?1:-1).slice(-8);
    const maxMonthLeads = leadMonthSorted.length ? Math.max(...leadMonthSorted.map(([,v])=>v)) : 1;

    // ── Auction purchases
    const auctionPurch = {}, auctionInferred = {};
    const flooringNew = [], flooringPayoff = [];
    itemRows.forEach(r => {
      const d = parseDate(r.date); if (!d) return;
      if (fn && !fn(d)) return;
      const type = (r['type']||'').toLowerCase().trim();
      const amt  = parseMoney(r['amount']);
      if (type === 'flooring payable' && !isNaN(amt)) {
        if (amt > 0) flooringNew.push(amt);
        else if (amt < 0) flooringPayoff.push(Math.abs(amt));
      }
      const raw = detectAuction(r);
      if (!raw) return;
      const label = auctionLabel(raw);
      auctionPurch[label]    = (auctionPurch[label]||0) + 1;
      auctionInferred[label] = (auctionInferred[label]||0) + (raw.endsWith(' *') ? 1 : 0);
    });
    const auctionSorted     = Object.entries(auctionPurch).sort((a,b)=>b[1]-a[1]);
    const totalPurchased    = Object.values(auctionPurch).reduce((a,b)=>a+b,0);
    const newFlooringTotal  = flooringNew.reduce((a,b)=>a+b,0);
    const paidFlooringTotal = flooringPayoff.reduce((a,b)=>a+b,0);
    const netFlooringChange = newFlooringTotal - paidFlooringTotal;

    // All-time running floorplan balance (no period filter)
    let allFloorNew = 0, allFloorPaid = 0, allFloorLatestDate = null;
    itemRows.forEach(r => {
      const d = parseDate(r.date); if (!d) return;
      const type = (r['type']||'').toLowerCase().trim();
      const amt  = parseMoney(r['amount']);
      if (type === 'flooring payable' && !isNaN(amt)) {
        if (amt > 0) allFloorNew  += amt;
        else if (amt < 0) allFloorPaid += Math.abs(amt);
        if (!allFloorLatestDate || d > allFloorLatestDate) allFloorLatestDate = d;
      }
    });
    const currentFloorBalance = allFloorNew - allFloorPaid;
    window._currentFloorBalance = currentFloorBalance; // used by setFloorLimit live updater
    const floorBalanceAsOf = allFloorLatestDate ? allFloorLatestDate.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'no data';

    const rankClass = i => i===0?'gold':i===1?'silver':i===2?'bronze':'';

    // ── Delta helper (vs prev period)
    const delta = (curr, prev) => {
      if (!prev && prev !== 0) return '';
      const d = curr - prev;
      const pct = prev !== 0 ? Math.round(Math.abs(d)/Math.abs(prev)*100) : 0;
      const sign = d >= 0 ? '+' : '';
      return `<div style="font-size:11px;color:${d>=0?'var(--green)':'var(--red)'};margin-top:3px">${sign}${pct}% vs prev period</div>`;
    };

    const periodLabel = {mtd:'This Month vs Same Period Last Month',last30:'Last 30 Days vs Prior 30',ytd:'YTD vs Same Period Last Year',all:''}[periodFilter];

    el.innerHTML = errHtml + `
    <div class="toggle-row">
      ${['mtd','last30','ytd','all'].map(p=>`
        <button class="tog ${periodFilter===p?'on':''}" onclick="setMetricsPeriod('${p}')">${
          {mtd:'This Month',last30:'Last 30 Days',ytd:'Year to Date',all:'All Time'}[p]
        }</button>
      `).join('')}
      <span style="color:var(--muted);font-size:12px;margin-left:4px">${soldRows.length} deals in period</span>
      ${xrefMsg ? `<span style="font-size:11px;margin-left:12px">${xrefMsg}</span>` : ''}
    </div>
    ${periodLabel ? `<div style="font-size:11px;color:var(--muted);margin-bottom:10px;font-style:italic">${periodLabel} &nbsp;|&nbsp; ${prevSoldRows.length} deals in comparison period</div>` : ''}

    <!-- ── Summary stat strip ── -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:16px">
      <div class="stat-card accent">
        <div class="label">Units Sold</div>
        <div class="val">${soldRows.length}</div>
        <div class="sub">Deal Detail</div>
        ${delta(soldRows.length, prevSoldRows.length)}
      </div>
      <div class="stat-card green">
        <div class="label">Total Gross Profit</div>
        <div class="val" style="font-size:18px">${fmt$(totalGrossProfit)}</div>
        <div class="sub">Front + Back</div>
        ${delta(totalGrossProfit, prevGross)}
      </div>
      <div class="stat-card">
        <div class="label">Front Gross Profit</div>
        <div class="val" style="font-size:18px">${fmt$(totalFront)}</div>
        <div class="sub">Sale Price − Cost</div>
        ${delta(totalFront, prevFront)}
      </div>
      <div class="stat-card${backGPFlagged.length ? ' yellow' : ''}">
        <div class="label">Back Gross Profit${backGPFlagged.length ? ' ⚠' : ''}</div>
        <div class="val" style="font-size:18px">${fmt$(totalBack)}</div>
        <div class="sub">F&I${backGPFlagged.length ? ` — ${backGPFlagged.length} deal${backGPFlagged.length>1?'s':''} missing VSC/GAP cost` : ''}</div>
        ${delta(totalBack, prevBack)}
      </div>
      <div class="stat-card">
        <div class="label">Avg GP / Unit</div>
        <div class="val" style="font-size:18px">${soldRows.length?fmt$(avgGrossProfit):'—'}</div>
        <div class="sub">Front + Back avg</div>
        ${delta(avgGrossProfit, prevSoldRows.length ? prevGross/prevSoldRows.length : null)}
      </div>
      <div class="stat-card yellow">
        <div class="label">Avg Days to Sell</div>
        <div class="val">${dts.raw !== null ? dts.raw + 'd' : '—'}</div>
        <div class="sub" style="line-height:1.6">
          ${dts.n} deals<br>
          ${dts.trimmed !== null ? `✂ Trimmed (±10%): <b>${dts.trimmed}d</b> <span style="color:var(--muted);font-size:10px">-${dts.removedT}</span><br>` : ''}
          ${dts.iqr    !== null ? `◆ IQR filter: <b>${dts.iqr}d</b> <span style="color:var(--muted);font-size:10px">-${dts.removedI}</span>` : ''}
        </div>
      </div>
      <div class="stat-card">
        <div class="label">Units Purchased</div>
        <div class="val">${totalPurchased}</div>
        <div class="sub">Auction + other</div>
      </div>
    </div>

    <!-- ── SP Performance (full width) ── -->
    <div style="margin-bottom:16px">
      <div class="card">
        <h3>Salesperson Performance — Sales Log</h3>
        ${spSorted.length ? spSorted.map(([name,s],i)=>`
          <div class="sp-row" style="flex-direction:column;align-items:stretch;gap:0">
            <!-- Main row -->
            <div style="display:flex;align-items:center;gap:10px">
              <div class="sp-rank ${rankClass(i)}">${i+1}</div>
              <div style="flex:1">
                <div class="sp-name">${name}</div>
                <div class="pbar" style="width:100px;margin-top:3px">
                  <div class="pbar-fill" style="width:${Math.round(s.units/maxUnits*100)}%"></div>
                </div>
              </div>
              <div class="sp-stats" style="flex-direction:column;gap:2px;align-items:flex-end">
                <span>
                  <b style="color:var(--accent);font-size:18px">${s.units%1===0?s.units:s.units.toFixed(1)}</b>
                  <span style="color:var(--muted)"> units</span>
                </span>
                <span style="font-size:11px">Front GP: <b style="color:var(--green)">${fmt$(s.frontGross)}</b></span>
                <span style="font-size:11px">Back GP: <b style="color:var(--accent2)">${fmt$(s.backGross)}</b></span>
                <span style="font-size:11px;border-top:1px solid var(--border);padding-top:2px;margin-top:2px">Total Check: <b>${fmt$(s.totalCheck)}</b></span>
              </div>
            </div>
            <!-- Warranty row — always shown, even if 0 -->
            <div style="margin:6px 0 2px 36px;display:flex;align-items:center;gap:8px;background:${s.warrantyUnits>0?'#ede9fe':'var(--card2)'};border-radius:6px;padding:6px 10px">
              <span style="font-size:16px">🛡</span>
              <div style="flex:1">
                <span style="font-size:11px;font-weight:700;color:${s.warrantyUnits>0?'var(--accent2)':'var(--muted)'}">${s.warrantyUnits>0?`${s.warrantyUnits%1===0?s.warrantyUnits:s.warrantyUnits.toFixed(1)} Warranty Deal${s.warrantyUnits!==1?'s':''}` : 'No warranties this period'}</span>
              </div>
              ${s.warrantyBackGross>0?`<span style="font-size:12px;font-weight:700;color:var(--accent2)">${fmt$(s.warrantyBackGross)} back GP</span>`:''}
            </div>
          </div>
        `).join('') : `<div style="color:var(--muted);font-size:13px;line-height:1.8">
          No Sales Log data for this period.<br>
          <span style="font-size:11px">File: "Sales - Live" · Tabs: Joseph-Cars, Felix-Cars, Kris-Cars</span><br>
          ${salesLogData._debug ? `<span style="font-size:10px;color:var(--accent);font-family:monospace">Debug: ${salesLogData._debug}</span>` : ''}
        </div>`}
      </div>
    </div>

    <!-- ── Purchases by Auction + Flooring Balance ── -->
    <div class="grid-2" style="margin-bottom:16px">
      <div class="card">
        <h3>Purchases by Auction Source <span style="font-size:10px;font-weight:400;color:var(--muted)">* = inferred from day-of-week</span></h3>
        ${auctionSorted.length ? `
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
            ${auctionSorted.map(([src,ct])=>`
              <div style="background:var(--card2);border-radius:8px;padding:10px 16px;text-align:center;min-width:100px">
                <div style="font-size:22px;font-weight:700;color:var(--accent)">${ct}</div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px">${src}</div>
                ${auctionInferred[src]?`<div style="font-size:10px;color:var(--muted)">${auctionInferred[src]} inferred</div>`:''}
              </div>`).join('')}
          </div>
          <div style="font-size:12px;color:var(--muted)">Total: <b style="color:var(--text)">${totalPurchased}</b> vehicles purchased this period</div>
        ` : '<div style="color:var(--muted);font-size:13px">No purchase data for this period.</div>'}
      </div>
      <div class="card">
        <h3>Floorplan Activity (Flooring Payable)</h3>
        <!-- Credit limit setter -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
          <span style="font-size:12px;color:var(--muted);font-weight:600">Credit Line:</span>
          <input id="floor-limit-input" type="text" placeholder="e.g. 500000"
            value="${floorCreditLimit||''}"
            style="width:110px;font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:6px"
            onchange="setFloorLimit(this.value)">
          <span style="font-size:11px;color:var(--muted)">(enter your Westlake credit line to see available capacity)</span>
        </div>
        <!-- Outstanding / Available split -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <!-- Outstanding (used) -->
          <div style="background:#fff7ed;border:2px solid var(--orange);border-radius:10px;padding:14px 16px">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--orange);margin-bottom:4px">OUTSTANDING (USED)</div>
            <div style="font-size:28px;font-weight:800;color:var(--orange)">${fmt$(currentFloorBalance)}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:3px">
              as of <b>${floorBalanceAsOf}</b><br>
              <span style="font-size:10px">Total drawn: ${fmt$(allFloorNew)} · Total paid: ${fmt$(allFloorPaid)}</span>
            </div>
          </div>
          <!-- Available capacity -->
          <div id="floor-avail-card" style="background:${floorCreditLimit>0?'#f0fdf4':'var(--card2)'};border:2px solid ${floorCreditLimit>0?'var(--green)':'var(--border)'};border-radius:10px;padding:14px 16px">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:${floorCreditLimit>0?'var(--green)':'var(--muted)'};margin-bottom:4px">AVAILABLE CAPACITY</div>
            <div style="font-size:28px;font-weight:800;color:${floorCreditLimit>0?'var(--green)':'var(--muted)'}">
              ${floorCreditLimit>0 ? fmt$(floorCreditLimit - currentFloorBalance) : '—'}
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:3px">
              ${floorCreditLimit>0
                ? `Credit line: <b>${fmt$(floorCreditLimit)}</b> · ${Math.round(currentFloorBalance/floorCreditLimit*100)}% used`
                : 'Enter credit line above'}
            </div>
          </div>
        </div>
        <!-- Period breakdown -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
          <div style="background:var(--card2);border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:10px;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px">NEW FLOORED <span style="font-size:9px">(period)</span></div>
            <div style="font-size:18px;font-weight:700;color:var(--red)">${fmt$(newFlooringTotal)}</div>
            <div style="font-size:11px;color:var(--muted)">${flooringNew.length} vehicles</div>
          </div>
          <div style="background:var(--card2);border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:10px;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px">PAID OFF <span style="font-size:9px">(period)</span></div>
            <div style="font-size:18px;font-weight:700;color:var(--green)">${fmt$(paidFlooringTotal)}</div>
            <div style="font-size:11px;color:var(--muted)">${flooringPayoff.length} payoffs</div>
          </div>
          <div style="background:var(--card2);border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:10px;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px">NET CHANGE <span style="font-size:9px">(period)</span></div>
            <div style="font-size:18px;font-weight:700;color:${netFlooringChange>0?'var(--red)':'var(--green)'}">${netFlooringChange>=0?'+':''}${fmt$(netFlooringChange)}</div>
            <div style="font-size:11px;color:var(--muted)">${netFlooringChange>0?'Balance up':'Balance down'}</div>
          </div>
        </div>
        <div style="font-size:11px;color:var(--muted)">Data from Itemized Costs. "as of" date = most recent flooring entry in the report.</div>
      </div>
    </div>

    <!-- ── Brands + Mileage stacked left; Leads full panel right ── -->
    <div style="display:grid;grid-template-columns:1fr 2.4fr;gap:14px;margin-bottom:16px">

      <!-- Left column: Brand then Mileage -->
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card">
          <h3>Units Sold by Brand</h3>
          ${brandSorted.length ? `<div style="max-height:220px;overflow-y:auto">
            ${brandSorted.map(([brand,ct])=>`
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px">
                <span style="width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${brand}</span>
                <div class="pbar" style="flex:1;margin-top:0"><div class="pbar-fill" style="width:${Math.round(ct/brandSorted[0][1]*100)}%"></div></div>
                <span style="width:22px;text-align:right;color:var(--muted);font-weight:600">${ct}</span>
              </div>`).join('')}
          </div>` : '<div style="color:var(--muted);font-size:13px">No data.</div>'}
        </div>

        <div class="card">
          <h3>Mileage Distribution (Units Sold)</h3>
          ${Object.entries(milBuckets).map(([range,ct])=>`
            <div class="aging-band">
              <span class="range" style="width:90px">${range}</span>
              <div class="bar"><div class="fill" style="width:${Math.round(ct/milMax*100)}%;background:var(--accent2)">${ct||''}</div></div>
              <span style="font-size:12px;color:var(--muted);width:28px;text-align:right">${ct}</span>
            </div>`).join('')}
          <div style="font-size:11px;color:var(--muted);margin-top:8px">${soldRows.filter(r=>r._mileage===0).length} records missing mileage</div>
        </div>
      </div>

      <!-- Right: Leads — full height -->
      <div class="card">
        <h3>Leads by Source — ${totalLeads} Total (All Time)</h3>
        ${leadSorted.length ? `
          <div style="max-height:240px;overflow-y:auto;margin-bottom:14px">
            ${leadSorted.map(([src,ct])=>`
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;font-size:12px">
                <span style="width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0" title="${src}">${src}</span>
                <div class="pbar" style="flex:1;margin-top:0"><div class="pbar-fill" style="width:${Math.round(ct/leadSorted[0][1]*100)}%;background:var(--green)"></div></div>
                <span style="width:34px;text-align:right;color:var(--muted);font-weight:600">${ct}</span>
                <span style="width:36px;text-align:right;color:var(--muted);font-size:11px">${totalLeads?Math.round(ct/totalLeads*100):0}%</span>
              </div>`).join('')}
          </div>

          ${leadMonthSorted.length ? `
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">Monthly Lead Volume (Last 8 Months)</div>
            <div style="display:flex;align-items:flex-end;gap:5px;height:80px;margin-bottom:12px">
              ${leadMonthSorted.map(([mo,ct])=>{
                const [yr,mn] = mo.split('-');
                const label = monthNames6[+mn-1] + "'" + yr.slice(2);
                const h = Math.max(6, Math.round(ct/maxMonthLeads*72));
                return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
                  <div style="font-size:10px;color:var(--text);font-weight:600">${ct}</div>
                  <div style="width:100%;height:${h}px;background:var(--green);border-radius:4px 4px 0 0;opacity:.85"></div>
                  <div style="font-size:9px;color:var(--muted);white-space:nowrap">${label}</div>
                </div>`;
              }).join('')}
            </div>` : ''}

          ${userSorted.length ? `
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">By Assigned Rep</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${userSorted.map(([user,ct])=>`
                <div style="background:var(--card2);border-radius:6px;padding:6px 12px;font-size:12px">
                  <b>${ct}</b> <span style="color:var(--muted)">${user}</span>
                </div>`).join('')}
            </div>` : ''}
        ` : '<div style="color:var(--muted);font-size:13px">No lead data found.</div>'}
      </div>
    </div>
    `;
  }

  window.setMetricsPeriod = function(p) { periodFilter = p; render(); };
  render();
}



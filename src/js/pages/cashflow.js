'use strict';

// ═══════════════════════════════════════════════════════════════════
//  PAGE: CASH FLOW (Weekly SCF-style view) — src/js/pages/cashflow.js
// ═══════════════════════════════════════════════════════════════════

async function loadCashFlow() {
  const el = document.getElementById('cashflow-body');
  el.innerHTML = loading('Loading bank, deals, inventory & warranty data…');
  // Load everything in parallel — fail gracefully on each
  const [chaseR, dealR, payR, itemR, salesLogR, warrantyR, loanR] = await Promise.allSettled([
    (async () => {
      const f = await driveSearchByName(FILE_NAME_PATTERNS.chase9532)
             || await driveSearchByName('Chase9532')
             || await driveSearchByName('Chase Checking');
      return f?.id ? await driveRead(f.id) : '';
    })(),
    getDealDetailRows(),
    getDealPaymentRows(),
    getItemizedCostRows(),
    getSalesLogData(),
    getWarrantyData(),
    (async () => {
      const f = await driveSearchLatest(FOLDER_IDS.loanPayments);
      return f?.id ? await driveRead(f.id) : '';
    })(),
  ]);
  renderCashFlow(el, {
    chaseText:   chaseR.status==='fulfilled' ? chaseR.value : '',
    dealRows:    dealR.status==='fulfilled'  ? dealR.value  : [],
    payRows:     payR.status==='fulfilled'   ? payR.value   : [],
    itemRows:    itemR.status==='fulfilled'  ? itemR.value  : [],
    salesLog:    salesLogR.status==='fulfilled' ? salesLogR.value : {},
    warranty:    warrantyR.status==='fulfilled' ? warrantyR.value : {rows:[],totalDue:0},
    loanText:    loanR.status==='fulfilled'  ? loanR.value  : '',
  });
}

function renderCashFlow(el, data) {
  const { chaseText, dealRows, payRows, itemRows, salesLog, warranty, loanText } = data;
  const now = new Date();

  // ── Parse Chase9532 checking register ──
  const chaseRows = chaseText ? parseCSV(chaseText) : [];
  // Balance column — header "Balance" in 6th column (index 5) per user
  const chaseKeys = chaseRows.length ? Object.keys(chaseRows[0]) : [];
  const balHdr    = chaseKeys[5] || chaseKeys.find(k => /balance/i.test(k)) || null;
  const amtHdr    = chaseKeys.find(k => /amount|debit|credit/i.test(k)) || chaseKeys[2] || null;
  const dateHdr   = chaseKeys.find(k => /date|posted/i.test(k)) || chaseKeys[0] || null;
  const descHdr   = chaseKeys.find(k => /desc|memo|payee/i.test(k)) || chaseKeys[1] || null;

  // Latest balance from Chase9532
  const chaseBalRow = chaseRows.slice().reverse().find(r => balHdr && !isNaN(parseMoney(r[balHdr])));
  const checkingBal = chaseBalRow && balHdr ? parseMoney(chaseBalRow[balHdr]) : NaN;

  // ── Find most recent rent payment to estimate next ──
  const RENT_CURRENT = 5970;
  const rentRow = chaseRows.slice().reverse().find(r => {
    const d = (r[descHdr]||'').toLowerCase();
    return d.includes('rent') || d.includes('lease');
  });

  // ── OPEX pattern: detect recurring expenses from Chase ──
  const opexPatterns = {};
  chaseRows.forEach(r => {
    const desc = (r[descHdr]||'').toLowerCase().trim();
    const amt  = parseMoney(r[amtHdr]);
    const d    = parseDate(r[dateHdr]);
    if (!desc || isNaN(amt) || !d) return;
    // Group by normalized payee (first 20 chars)
    const key = desc.replace(/[0-9#*\-\_\.]/g,'').trim().substring(0,22);
    if (!opexPatterns[key]) opexPatterns[key] = [];
    opexPatterns[key].push({ amt: Math.abs(amt), day: d.getDate(), d });
  });
  // Find patterns with at least 2 occurrences
  const recurringOpex = Object.entries(opexPatterns)
    .filter(([,arr]) => arr.length >= 2)
    .map(([key,arr]) => ({
      desc: key,
      avgAmt: arr.reduce((s,x)=>s+x.amt,0)/arr.length,
      typicalDay: Math.round(arr.reduce((s,x)=>s+x.day,0)/arr.length),
      occurrences: arr.length,
    }))
    .filter(x => x.avgAmt > 50 && !x.desc.includes('rent'))
    .sort((a,b) => b.avgAmt - a.avgAmt)
    .slice(0,12);

  // ── Build week buckets for current month + next 4 weeks ──
  function getWeeks() {
    const weeks = [];
    // Start from 1st of this month, go 8 weeks out
    const cur = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let w = 0; w < 8; w++) {
      const mon = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + w*7);
      const sun = new Date(mon.getTime() + 6*86400000);
      weeks.push({ mon, sun, label: `${mon.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${sun.toLocaleDateString('en-US',{month:'short',day:'numeric'})}` });
    }
    return weeks;
  }
  const weeks = getWeeks();

  // Is a date inside a week?
  const inWeek = (d, wk) => d && d >= wk.mon && d <= new Date(wk.sun.getTime()+86399999);
  // Has a week already passed?
  const isPast   = wk => wk.sun < now;
  const isCurrent= wk => wk.mon <= now && wk.sun >= now;

  // ── Payroll helpers ──
  // Mechanics: $350/weekday per week in range
  function mechanicPayForWeek(wk) {
    let days = 0;
    for (let d = new Date(wk.mon); d <= wk.sun; d.setDate(d.getDate()+1)) {
      if (d.getDay() >= 1 && d.getDay() <= 5) days++;
    }
    return days * 350;
  }
  // Manager: $4200 on 15th and 30th/31st payrolls
  function managerPayForWeek(wk) {
    let pay = 0;
    const m = wk.mon.getMonth(), y = wk.mon.getFullYear();
    const lastDay = new Date(y, m+1, 0).getDate();
    [15, lastDay].forEach(d => {
      const pd = new Date(y, m, d);
      if (inWeek(pd, wk)) pay += 4200;
    });
    return pay;
  }
  // Salespeople: sum Total Check (col R) for deals closing in this week
  function spPayForWeek(wk) {
    let total = 0;
    Object.values(salesLog).forEach(rows => {
      rows.forEach(r => { if (r._date && inWeek(r._date, wk)) total += (r.totalCheck||0); });
    });
    return total;
  }

  // ── Revenue IN: deal payments received in week ──
  function revenueInWeek(wk) {
    return payRows.filter(r => {
      const d = parseDate(getField(r,'payment date','date','posted date'));
      return d && inWeek(d, wk);
    }).reduce((s,r) => {
      const amt = parseMoney(getField(r,'amount','payment amount','total paid'));
      return s + (isNaN(amt)?0:amt);
    }, 0);
  }

  // ── PENDING revenue: sold cars (Deal Detail closing date) with no Deal Payment ──
  const soldNoPmt = dealRows.filter(r => {
    if (!r._isSold || !r._date) return false;
    const vin   = (getField(r._raw,'inventory vehicle vin','vin','vehicle vin')||'').trim().toUpperCase();
    const stock = (r._stock||'').trim().toLowerCase();
    return !payRows.some(p => {
      const pVin   = (getField(p,'vin','vehicle vin','inventory vin')||'').trim().toUpperCase();
      const pStock = (getField(p,'stock number','stock #','stock')||'').trim().toLowerCase();
      return (vin&&pVin&&pVin===vin)||(stock&&pStock&&pStock===stock);
    });
  });
  const pendingRevenue = soldNoPmt.reduce((s,r) => {
    const bal = parseMoney(getField(r._raw,'pricing total sale','deal balance','total sale price','sale price'));
    return s + (isNaN(bal)?0:bal);
  }, 0);

  // ── Floorplan payables: new floors taken this week from itemized costs ──
  function floorInWeek(wk) {
    return itemRows.filter(r => {
      const d = parseDate(r.date);
      const t = (r.type||'').toLowerCase().trim();
      const a = parseMoney(r.amount);
      return d && inWeek(d,wk) && t==='flooring payable' && a>0;
    }).reduce((s,r)=>s+(parseMoney(r.amount)||0),0);
  }

  // Rent: check if any week contains day 1-5 of a month
  function rentForWeek(wk) {
    for (let d = new Date(wk.mon); d <= wk.sun; d.setDate(d.getDate()+1)) {
      if (d.getDate() >= 1 && d.getDate() <= 5) return RENT_CURRENT;
    }
    return 0;
  }

  // Sales tax: estimate week containing 7th-10th; only future months
  function salesTaxWeek(wk) {
    for (let d = new Date(wk.mon); d <= wk.sun; d.setDate(d.getDate()+1)) {
      if (d.getDate() >= 7 && d.getDate() <= 10 && d > now) return '⚠ Sales Tax Due';
    }
    return null;
  }

  // Warranty remittance
  const warrantyDue = warranty.totalDue || 0;

  // BHPH
  const bhphRows2 = loanText ? parseCSV(loanText) : [];
  const bhphPrinc = bhphRows2.reduce((s,r)=>s+(parseMoney(r[' principal paid']||r['principal paid'])||0),0);
  const bhphInt   = bhphRows2.reduce((s,r)=>s+(parseMoney(r[' interest paid']||r['interest paid'])||0),0);

  // ── Render ──
  el.innerHTML = `
  <!-- Balances & pending -->
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin-bottom:16px">
    <div class="stat-card ${!isNaN(checkingBal)?'green':''}">
      <div class="label">Checking Balance</div>
      <div class="val">${!isNaN(checkingBal)?fmt$(checkingBal):'—'}</div>
      <div class="sub">Chase9532 — latest${chaseRows.length?` (${chaseRows.length} txns)`:''}</div>
    </div>
    <div class="stat-card accent">
      <div class="label">Petty Cash</div>
      <div class="val" id="cf-petty-val">—</div>
      <div class="sub"><input type="text" id="cf-petty" placeholder="Enter amount" style="width:100px;font-size:12px" oninput="document.getElementById('cf-petty-val').textContent=this.value||'—'"></div>
    </div>
    <div class="stat-card yellow">
      <div class="label">⏳ Pending Revenue</div>
      <div class="val" style="font-size:18px">${fmt$(pendingRevenue)}</div>
      <div class="sub">${soldNoPmt.length} sold unit${soldNoPmt.length!==1?'s':''} — no payment on file</div>
    </div>
    <div class="stat-card red">
      <div class="label">Warranty Remittance Due</div>
      <div class="val" style="font-size:18px">${warrantyDue>0?fmt$(warrantyDue):'$0'}</div>
      <div class="sub">Total Contract Due${warrantyDue===0?' — load report':''}</div>
    </div>
    <div class="stat-card">
      <div class="label">BHPH Collections</div>
      <div class="val" style="font-size:18px">${fmt$(bhphPrinc+bhphInt)}</div>
      <div class="sub">Principal ${fmt$(bhphPrinc)} + Interest ${fmt$(bhphInt)}</div>
    </div>
    <div class="stat-card yellow">
      <div class="label">Rent (Monthly)</div>
      <div class="val" style="font-size:18px">${fmt$(RENT_CURRENT)}</div>
      <div class="sub">Due 1st–5th; escalates Apr 2027</div>
    </div>
  </div>

  <!-- Pending revenue popup -->
  ${soldNoPmt.length ? `
  <details style="margin-bottom:14px">
    <summary style="cursor:pointer;font-size:13px;font-weight:700;color:var(--yellow);user-select:none">⚠ ${soldNoPmt.length} Sold Vehicles with No Payment Recorded — click to review</summary>
    <div class="tbl-wrap" style="margin-top:8px;max-height:200px;overflow-y:auto">
      <table class="tbl"><thead><tr><th>Stock #</th><th>Vehicle</th><th>Closed</th><th>Expected $</th><th>Issue</th></tr></thead><tbody>
        ${soldNoPmt.map(r=>{
          const bal = parseMoney(getField(r._raw,'pricing total sale','deal balance','total sale price','sale price'));
          return `<tr>
            <td><span class="badge badge-blue">${r._stock||'—'}</span></td>
            <td>${r._vehicle||'—'}</td>
            <td style="color:var(--muted)">${r._date?.toLocaleDateString()||'?'}</td>
            <td style="color:var(--green)">${isNaN(bal)?'—':fmt$(bal)}</td>
            <td><span class="badge badge-yellow">No Deal Payment</span></td>
          </tr>`;
        }).join('')}
      </tbody></table>
    </div>
  </details>` : ''}

  <!-- Weekly SCF Table — weeks as columns -->
  <div class="card" style="margin-bottom:16px">
    <div class="sec-hdr"><h3 style="margin-bottom:0">📆 Weekly Cash Flow — Statement of Cash Flows View</h3>
      <span style="font-size:11px;color:var(--muted)">Past = Actual where data available &nbsp;|&nbsp; Future = Expected/Projected</span>
    </div>
    <div class="tbl-wrap" style="overflow-x:auto">
      <table class="tbl" style="min-width:900px">
        <colgroup>
          <col style="width:160px;min-width:140px">
          ${weeks.map(()=>'<col style="min-width:110px">').join('')}
        </colgroup>
        <thead>
          <tr>
            <th style="background:var(--card3);position:sticky;left:0;z-index:2;border-right:2px solid var(--border2)">Category</th>
            ${weeks.map(wk => {
              const past    = isPast(wk);
              const current = isCurrent(wk);
              const bg      = current ? '#e8f0ff' : past ? 'var(--card2)' : 'var(--card)';
              const cls     = past ? 'badge-green' : current ? 'badge-blue' : 'badge-yellow';
              const label   = past ? 'Actual' : current ? 'Current' : 'Expected';
              return `<th style="text-align:center;background:${bg};font-size:11px;font-weight:700">
                <div>${wk.label}</div>
                <span class="badge ${cls}" style="font-size:9px;margin-top:3px">${label}</span>
              </th>`;
            }).join('')}
          </tr>
        </thead>
        <tbody>
          ${(() => {
            // Pre-compute all week data
            const wd = weeks.map(wk => {
              const past    = isPast(wk);
              const current = isCurrent(wk);
              const revIn   = revenueInWeek(wk);
              const bhphIn  = bhphRows2.filter(r=>{
                const d=parseDate(getField(r,'payment date','date')); return d&&inWeek(d,wk);
              }).reduce((s,r)=>s+(parseMoney(r[' principal paid']||r['principal paid'])||0)+(parseMoney(r[' interest paid']||r['interest paid'])||0),0);
              const floor    = floorInWeek(wk);
              const mechPay  = mechanicPayForWeek(wk);
              const mgrPay   = managerPayForWeek(wk);
              const spPay    = spPayForWeek(wk);
              const totalPay = mechPay + mgrPay + spPay;
              const rent     = rentForWeek(wk);
              const staxNote = salesTaxWeek(wk);
              const opexThisWk = recurringOpex.filter(x => {
                for (let d2=new Date(wk.mon); d2<=wk.sun; d2.setDate(d2.getDate()+1)) {
                  if (Math.abs(d2.getDate()-x.typicalDay) <= 2) return true;
                }
                return false;
              });
              const totalIn  = revIn + bhphIn;
              const totalOut = floor + totalPay + rent;
              return { past, current, revIn, bhphIn, floor, mechPay, mgrPay, spPay, totalPay, rent, staxNote, opexThisWk, totalIn, totalOut, net: totalIn - totalOut };
            });

            const cellBg = (i) => wd[i].current ? 'background:#e8f0ff' : wd[i].past ? '' : 'background:#fbfcff';
            const fmtCell = (val, color) => val ? `<span style="font-weight:700;color:${color}">${fmt$(val)}</span>` : `<span style="color:var(--muted)">—</span>`;
            const rowHtml = (label, vals, style='') => `
              <tr>
                <td style="font-size:12px;font-weight:600;background:var(--card3);position:sticky;left:0;border-right:2px solid var(--border2);${style}">${label}</td>
                ${vals.map((v,i)=>`<td style="text-align:center;${cellBg(i)}">${v}</td>`).join('')}
              </tr>`;
            const dividerRow = (label) => `
              <tr style="background:var(--card2)">
                <td colspan="${weeks.length+1}" style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;padding:5px 12px;background:var(--card3);position:sticky;left:0;border-right:2px solid var(--border2)">${label}</td>
              </tr>`;

            return [
              dividerRow('📥 CASH IN'),
              rowHtml('Deal Payments', wd.map((w,i)=>fmtCell(w.revIn,'var(--green)'))),
              rowHtml('BHPH Collections', wd.map((w,i)=>fmtCell(w.bhphIn,'var(--green)'))),
              rowHtml('Total IN ▲', wd.map((w,i)=>w.totalIn
                ? `<span style="font-weight:800;color:var(--green)">${fmt$(w.totalIn)}</span>`
                : `<span style="color:var(--muted)">—</span>`), 'border-top:2px solid var(--border2)'),

              dividerRow('📤 CASH OUT'),
              rowHtml('Floor Purchases', wd.map((w,i)=>fmtCell(w.floor,'var(--red)'))),
              rowHtml('Payroll — Mech', wd.map((w,i)=>fmtCell(w.mechPay,'var(--red)'))),
              rowHtml('Payroll — Mgmt', wd.map((w,i)=>w.mgrPay
                ? `<span style="font-weight:700;color:var(--red)">${fmt$(w.mgrPay)}</span>${w.mgrPay>=8400?' <span style="font-size:9px;color:var(--muted)">(2×)</span>':''}`
                : `<span style="color:var(--muted)">—</span>`)),
              rowHtml('Payroll — SP', wd.map((w,i)=>fmtCell(w.spPay,'var(--red)'))),
              rowHtml('Rent', wd.map((w,i)=>fmtCell(w.rent,'var(--red)'))),
              rowHtml('Sales Tax ⚠', wd.map((w,i)=>w.staxNote
                ? `<span style="color:var(--yellow);font-weight:700;font-size:11px">${w.staxNote}</span>`
                : `<span style="color:var(--muted)">—</span>`)),
              rowHtml('Recurring OPEX', wd.map((w,i)=>w.opexThisWk.length
                ? w.opexThisWk.slice(0,2).map(x=>`<div style="font-size:10px;color:var(--muted)">~${fmt$(x.avgAmt)}</div>`).join('')
                : `<span style="color:var(--muted)">—</span>`)),
              rowHtml('Total OUT ▼', wd.map((w,i)=>w.totalOut
                ? `<span style="font-weight:800;color:var(--red)">(${fmt$(w.totalOut)})</span>`
                : `<span style="color:var(--muted)">—</span>`), 'border-top:2px solid var(--border2)'),

              dividerRow('💰 NET'),
              `<tr style="border-top:3px solid var(--border2)">
                <td style="font-size:13px;font-weight:800;background:var(--card3);position:sticky;left:0;border-right:2px solid var(--border2)">Net Cash Flow</td>
                ${wd.map((w,i)=>`<td style="text-align:center;font-weight:800;font-size:15px;${cellBg(i)};color:${w.net>=0?'var(--green)':'var(--red)'}">
                  ${(w.totalIn||w.totalOut) ? `${w.net>=0?'+':''}${fmt$(w.net)}` : '<span style="color:var(--muted)">—</span>'}
                </td>`).join('')}
              </tr>`,
            ].join('');
          })()}
        </tbody>
      </table>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-top:10px;line-height:1.8">
      <b>Payroll logic:</b> Mechanic $350/weekday · Managers $4,200 on 15th & last day · SP = Total Check (col R of Sales-Live) ·
      <b>Rent:</b> $${RENT_CURRENT.toLocaleString()}/mo due 1st–5th · Escalates 4% April 2027 ·
      <b>Warranty remittance:</b> ${warrantyDue>0?fmt$(warrantyDue)+' due (from Warranty Remittance report)':'report not loaded — $0 assumed'} ·
      <b>Sales Tax:</b> Flag shows in week containing 7th–10th for future months
    </div>
  </div>

  <!-- Recurring OPEX pattern -->
  ${recurringOpex.length ? `
  <div class="card" style="margin-bottom:16px">
    <h3>🔄 Recurring OPEX Patterns (from Chase9532 — ${chaseRows.length} transactions)</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">
      ${recurringOpex.map(x=>`
        <div style="background:var(--card2);border-radius:8px;padding:10px 14px">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">${x.desc.substring(0,24)}</div>
          <div style="font-size:18px;font-weight:700;color:var(--red)">${fmt$(x.avgAmt)}</div>
          <div style="font-size:11px;color:var(--muted)">~${x.occurrences}x seen · around the ${x.typicalDay}${x.typicalDay===1?'st':x.typicalDay===2?'nd':x.typicalDay===3?'rd':'th'}</div>
        </div>`).join('')}
    </div>
  </div>` : `<div class="error-box" style="margin-bottom:14px">Chase9532 report not found — can't detect recurring OPEX. Search for the file named "Chase9532…" in Drive and ensure it's accessible.</div>`}

  <!-- Manual override -->
  <div class="card">
    <h3>✏️ Manual Cash Position Override</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-top:6px">
      ${[
        {label:'Checking Balance Override',key:'checking',hint:'Override if Chase not loaded'},
        {label:'Petty Cash Balance',key:'petty2',hint:''},
        {label:'Sales Tax Owed',key:'salestax',hint:'From Sales Tax Report'},
        {label:'Credit Card Balance',key:'cc',hint:'Chase credit card'},
      ].map(item => `
        <div style="background:var(--card2);border-radius:8px;padding:10px 12px">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:5px">${item.label}</div>
          <input type="text" id="cf-${item.key}" placeholder="${item.hint||'$0'}" style="font-size:14px;font-weight:600">
        </div>
      `).join('')}
    </div>
    <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
      <button class="btn btn-primary" onclick="saveCashPosition()">💾 Save to Drive</button>
      <span id="cash-net" style="font-size:13px;font-weight:700"></span>
    </div>
  </div>
  `;

  window.saveCashPosition = function() {
    const fields = ['checking','petty2','salestax','cc'];
    const data = {};
    fields.forEach(f => { const el2 = document.getElementById('cf-'+f); if(el2) data[f] = el2.value; });
    window.sendPrompt('Save cash position overrides to Drive: ' + JSON.stringify(data));
  };
}
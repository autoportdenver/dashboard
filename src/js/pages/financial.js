'use strict';

// ══════════════════════════════════════════════
//  PAGE: FINANCIAL — src/js/pages/financial.js
// ══════════════════════════════════════════════

async function loadFinancial() {
  const el = document.getElementById('financial-body');
  el.innerHTML = loading('Loading accounting & transaction data…');
  const [acctR, itemR] = await Promise.allSettled([
    driveRead(FILE_IDS.accounting), getItemizedCostRows()
  ]);
  if (acctR.status === 'rejected') { el.innerHTML = errorBox('Accounting Package: ' + (acctR.reason?.message||acctR.reason)); return; }
  const itemRows = itemR.status === 'fulfilled' ? itemR.value : [];
  renderFinancial(el, acctR.value, itemRows);
}

// In-memory transaction categories
let txCategories = {}; // key: `${date}|${amount}|${desc}` -> category

function renderFinancial(el, acctText, itemRows) {
  // ── Extract P&L metrics with multi-period support ──
  const plData = extractPLMetrics(acctText || '');
  const { monthLabels, numMonths, rows } = plData;

  // Default to most-recent period
  let selIdx = numMonths > 0 ? numMonths - 1 : 0;

  // Get value for a metric at a given period index
  function val(metric, idx) {
    if (!metric || !metric.values || !metric.values.length) return null;
    const i = Math.min(Math.max(0, idx), metric.values.length - 1);
    return metric.values[i];
  }

  // Render the income statement + period picker
  function renderPL() {
    const periodName   = monthLabels[selIdx] || (numMonths > 0 ? `Period ${selIdx+1}` : 'No period data');
    const prevIdx      = selIdx - 1;
    const hasData      = numMonths > 0 && Object.values(rows).some(r => r && r.values && r.values.length);

    const R  = r => val(r, selIdx);
    const dv = (metric, prev) => {
      const cur = val(metric, selIdx), p = val(metric, prev);
      if (cur === null || p === null) return '';
      const d = cur - p;
      const isPos = d >= 0;
      return `<span style="font-size:11px;color:${isPos?'var(--green)':'var(--red)'}">${isPos?'+':''}${fmt$(d)} vs prev</span>`;
    };

    // Income statement row builder
    function isRow(label, metric, opts) {
      opts = opts || {};
      const v = R(metric);
      const noPrev = selIdx <= 0;
      const pv     = noPrev ? null : val(metric, prevIdx);
      const diff   = (v !== null && pv !== null) ? v - pv : null;
      const isSubtotal = opts.subtotal;
      const isGrandTotal = opts.grandTotal;
      const negIsGood  = opts.negIsGood; // expenses: lower is better
      const indent = opts.indent || 0;

      const valColor = v === null ? 'var(--muted)'
        : isGrandTotal ? (v >= 0 ? 'var(--green)' : 'var(--red)')
        : 'var(--text)';

      const diffHtml = diff === null ? '<span style="color:var(--muted)">—</span>'
        : `<span style="color:${(negIsGood ? diff<=0 : diff>=0)?'var(--green)':'var(--red)'}">
             ${diff>=0?'+':''}${fmt$(diff)}
           </span>`;

      return `
        <div style="display:flex;align-items:center;padding:${isGrandTotal?'10px':'6px'} 12px;
          background:${isGrandTotal?'var(--card2)':isSubtotal?'#f8fafc':'transparent'};
          border-top:${isGrandTotal?'2px solid var(--border2)':isSubtotal?'1px solid var(--border)':'none'};
          border-radius:${isGrandTotal?'6px':'0'}">
          <span style="flex:1;font-size:${isGrandTotal?'13px':isSubtotal?'12px':'12px'};
            font-weight:${isGrandTotal?'700':isSubtotal?'600':'400'};
            color:var(--text2);padding-left:${indent*16}px">${label}</span>
          <span style="font-size:${isGrandTotal?'16px':'13px'};font-weight:${isGrandTotal?'700':'500'};
            color:${valColor};min-width:90px;text-align:right">${v===null?'—':fmt$(v)}</span>
          <span style="min-width:90px;text-align:right;padding-left:12px">${diffHtml}</span>
        </div>`;
    }

    const divider = `<div style="height:1px;background:var(--border);margin:2px 0"></div>`;
    const section = lbl => `<div style="font-size:10px;font-weight:700;color:var(--muted);
      text-transform:uppercase;letter-spacing:.8px;padding:10px 12px 4px">${lbl}</div>`;

    const plHtml = !hasData ? `<div class="error-box">
      Could not extract P&L data. File loaded (${(acctText||'').length.toLocaleString()} chars).
      Key row labels were not found — check that FILE_IDS.accounting points to the Copy of LIVE Accounting Package
      and that the P&L tab uses standard QBO row labels like "Gross Profit", "Net Income", etc.
    </div>` : `
    <div style="background:#fff;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      <!-- Header row with column labels -->
      <div style="display:flex;padding:8px 12px;background:var(--card2);border-bottom:2px solid var(--border)">
        <span style="flex:1;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.6px">Account</span>
        <span style="min-width:90px;text-align:right;font-size:11px;font-weight:700;color:var(--muted)">${periodName}</span>
        <span style="min-width:90px;text-align:right;padding-left:12px;font-size:11px;font-weight:700;color:var(--muted)">vs Prior Mo</span>
      </div>
      ${section('Revenue')}
      ${isRow('Vehicle Sales Revenue',   rows.vehicleSales, {indent:1})}
      ${isRow('Backend / F&I Revenue',   rows.backendRev,   {indent:1})}
      ${isRow('Net Revenue',             rows.revenue,      {subtotal:true})}
      ${divider}
      ${section('Cost of Goods Sold')}
      ${isRow('Vehicle COGS',            rows.cogs,         {indent:1, negIsGood:true})}
      ${isRow('Gross Profit',            rows.grossProfit,  {subtotal:true})}
      ${divider}
      ${section('Operating Expenses')}
      ${isRow('Payroll',                 rows.payroll,      {indent:1, negIsGood:true})}
      ${isRow('Rent',                    rows.rent,         {indent:1, negIsGood:true})}
      ${isRow('Floorplan Interest',      rows.floorInt,     {indent:1, negIsGood:true})}
      ${isRow('Advertising',             rows.advertising,  {indent:1, negIsGood:true})}
      ${isRow('Total Operating Expenses',rows.totalOpex,    {subtotal:true, negIsGood:true})}
      ${divider}
      ${isRow('Net Income',              rows.netIncome,    {grandTotal:true})}
    </div>`;

    const pctHtml = (() => {
      const rev = R(rows.revenue), gp = R(rows.grossProfit), ni = R(rows.netIncome);
      if (!rev || rev === 0) return '';
      return `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
        ${gp!==null?`<div style="background:var(--card2);border-radius:8px;padding:8px 14px;font-size:12px">
          <b style="color:var(--green)">${(gp/rev*100).toFixed(1)}%</b>
          <span style="color:var(--muted)"> Gross Margin</span>
        </div>`:''}
        ${ni!==null?`<div style="background:var(--card2);border-radius:8px;padding:8px 14px;font-size:12px">
          <b style="color:${ni>=0?'var(--green)':'var(--red)'}">${(ni/rev*100).toFixed(1)}%</b>
          <span style="color:var(--muted)"> Net Margin</span>
        </div>`:''}
      </div>`;
    })();

    document.getElementById('fin-pl-body').innerHTML = `
      <!-- Period picker -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <button onclick="shiftPeriod(-1)" class="btn btn-sm" ${selIdx<=0?'disabled':''}>← Prev</button>
        <div style="font-size:14px;font-weight:700;color:var(--text);min-width:70px;text-align:center">${periodName}</div>
        <button onclick="shiftPeriod(1)"  class="btn btn-sm" ${selIdx>=numMonths-1?'disabled':''}>Next →</button>
        ${numMonths>1?`<span style="font-size:11px;color:var(--muted)">Period ${selIdx+1} of ${numMonths} · ${monthLabels[0]} – ${monthLabels[numMonths-1]}</span>`:''}
      </div>
      ${plHtml}
      ${pctHtml}
      ${numMonths===0?`<div class="error-box" style="margin-top:10px">No month headers detected — the P&L column headers (Jan-25, Feb-25…) were not found in the flat text. The accounting package may need to be refreshed or the P&L tab may not export month labels.</div>`:''}
    `;
  }

  window.shiftPeriod = function(delta) {
    selIdx = Math.max(0, Math.min(numMonths - 1, selIdx + delta));
    renderPL();
  };

  // ── Floorplan section (from Itemized Costs) ──
  const floorSection = (() => {
    if (!itemRows || !itemRows.length) return '';
    const floorRows = itemRows.filter(r => (r['type']||r['transaction type']||'').toLowerCase().trim() === 'flooring payable');
    if (!floorRows.length) return '';
    let totalNew=0, totalPaid=0, latestDate=null;
    floorRows.forEach(r => {
      const amt = parseMoney(r['amount']||r['debit']||r['credit']||'');
      if (isNaN(amt)) return;
      const d = parseDate(r['date']||r['posted']||'');
      if (d && (!latestDate || d > latestDate)) latestDate = d;
      if (amt > 0) totalNew  += amt;
      else         totalPaid += Math.abs(amt);
    });
    const bal  = totalNew - totalPaid;
    const asOf = latestDate ? latestDate.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'unknown date';
    return `
    <div class="card" style="margin-bottom:16px">
      <h3>Floorplan Balance (Itemized Costs)</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">
        <div class="stat-card ${bal>0?'yellow':'green'}">
          <div class="label">Outstanding Balance</div>
          <div class="val" style="font-size:22px">${fmt$(bal)}</div>
          <div class="sub">as of ${asOf}</div>
        </div>
        <div class="stat-card">
          <div class="label">Total Drawn</div>
          <div class="val" style="font-size:22px">${fmt$(totalNew)}</div>
          <div class="sub">All-time floor draws</div>
        </div>
        <div class="stat-card green">
          <div class="label">Total Paid Off</div>
          <div class="val" style="font-size:22px">${fmt$(totalPaid)}</div>
          <div class="sub">All-time payoffs</div>
        </div>
      </div>
    </div>`;
  })();

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <h3 style="margin-bottom:0">Income Statement — P&amp;L</h3>
        <span style="font-size:11px;color:var(--muted)">Source: Copy of LIVE - Accounting Package - AutoPort</span>
      </div>
      <div id="fin-pl-body"></div>
    </div>
    ${floorSection}
  `;

  renderPL();
}

function parseSheetText(text) {
  const sections = {};
  const parts = text.split(/(?:^|\n)#{1,3}\s+/m);
  let lastName = '__default__';
  for (const part of parts) {
    const nl = part.indexOf('\n');
    if (nl === -1) { sections[lastName] = (sections[lastName]||'') + part; continue; }
    const name = part.substring(0, nl).trim();
    const body = part.substring(nl+1);
    if (name) { lastName = name; sections[name] = body; }
    else sections[lastName] = (sections[lastName]||'') + body;
  }
  return sections;
}
'use strict';

// ══════════════════════════════════════════════
//  PAGE: MEETINGS — src/js/pages/meetings.js
// ══════════════════════════════════════════════

async function loadMeetings() {
  const el = document.getElementById('meetings-body');
  el.innerHTML = loading('Loading sales, accounting & SP data…');
  const [dealR, itemR, salesLogR] = await Promise.allSettled([
    getDealDetailRows(), getItemizedCostRows(), getSalesLogData()
  ]);
  const dealRows     = dealR.status     === 'fulfilled' ? dealR.value     : [];
  const itemRows     = itemR.status     === 'fulfilled' ? itemR.value     : [];
  const salesLogData = salesLogR.status === 'fulfilled' ? salesLogR.value : {kris:[],joseph:[],felix:[]};
  const errs = [[dealR,'Deal Detail'],[itemR,'Itemized Costs'],[salesLogR,'Sales Log']]
    .filter(([r])=>r.status==='rejected')
    .map(([r,n])=>`⚠ ${n}: ${r.reason?.message||r.reason}`);
  renderMeetings(el, dealRows, itemRows, salesLogData, errs.join(' | '));
}

function renderMeetings(el, dealRows, itemRows, salesLogData, errMsg) {
  salesLogData = salesLogData || {kris:[],joseph:[],felix:[]};
  const now = new Date();
  calMonth  = new Date(now.getFullYear(), now.getMonth(), 1);
  const errHtml = errMsg ? `<div class="error-box" style="margin-bottom:12px">⚠ ${errMsg}</div>` : '';

  el.innerHTML = errHtml + `
  <!-- Calendar row: narrow calendar + wider week stats -->
  <div style="display:grid;grid-template-columns:300px 1fr;gap:12px;margin-bottom:16px;align-items:start">
    <!-- Calendar -->
    <div class="card" style="flex-shrink:0">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <button class="btn-sm" onclick="calNav(-1)">◀</button>
        <h3 id="cal-title" style="margin-bottom:0;font-size:13px"></h3>
        <button class="btn-sm" onclick="calNav(1)">▶</button>
      </div>
      <div class="cal-grid" id="cal-head"></div>
      <div class="cal-grid" id="cal-body" style="margin-top:4px"></div>
      <div id="selected-week-label" style="font-size:11px;color:var(--muted);margin-top:8px;text-align:center"></div>
    </div>

    <!-- Week Stats — expanded team review panel -->
    <div id="week-stats-panel" class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h3 style="margin-bottom:0">📊 Weekly Performance Review</h3>
        <span id="week-stats-date" style="font-size:12px;color:var(--muted)"></span>
      </div>
      <div id="week-stats-body" style="color:var(--muted);font-size:13px;padding:30px;text-align:center">
        ← Select a Saturday on the calendar to load this week's stats
      </div>
    </div>
  </div>

  <!-- Auction Purchases — directly under Weekly Performance Review -->
  <div class="card" style="margin-bottom:16px">
    <h3>🚗 Auction Purchases — Selected Week</h3>
    <div id="auction-panel" style="color:var(--muted);font-size:13px">Select a Saturday to see purchases.</div>
  </div>

  <!-- Meeting Notes -->
  <div class="card" style="margin-bottom:16px">
    <h3>📝 Meeting Notes</h3>
    <div class="notes-area" id="notes-main" contenteditable="true" placeholder="Agenda / discussion…"></div>
  </div>

  <div class="grid-3" style="margin-bottom:16px">
    <div class="card">
      <h3>🎯 Goals</h3>
      <div class="notes-area" id="notes-goals" contenteditable="true" placeholder="Units, gross targets…" style="min-height:80px"></div>
    </div>
    <div class="card">
      <h3>🏆 Wins</h3>
      <div class="notes-area" id="notes-wins" contenteditable="true" placeholder="What went well…" style="min-height:80px"></div>
    </div>
    <div class="card">
      <h3>📌 Losses / Improve</h3>
      <div class="notes-area" id="notes-losses" contenteditable="true" placeholder="What to fix…" style="min-height:80px"></div>
    </div>
  </div>

  <div style="display:flex;gap:8px;margin-bottom:16px">
    <button class="btn btn-primary" onclick="saveMeetingNotes()">💾 Save Meeting Notes</button>
    <button class="btn btn-sm" onclick="exportMeetingNotes()">📤 Export to Drive</button>
  </div>
  `;

  renderCalendar(dealRows);
  setupMeetingNoteHandlers(dealRows, itemRows, salesLogData);
}

function renderCalendar(dealRows) {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const now  = new Date();

  document.getElementById('cal-title').textContent = monthNames[calMonth.getMonth()] + ' ' + calMonth.getFullYear();

  const headEl = document.getElementById('cal-head');
  headEl.innerHTML = days.map(d => `<div class="cal-hdr">${d}</div>`).join('');

  const firstDay = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1).getDay();
  const daysInMonth = new Date(calMonth.getFullYear(), calMonth.getMonth()+1, 0).getDate();
  const bodyEl = document.getElementById('cal-body');

  let html = '';
  // Pad start
  for (let i = 0; i < firstDay; i++) {
    const prevDate = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1-firstDay+i);
    html += `<div class="cal-day other-month">${prevDate.getDate()}</div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(calMonth.getFullYear(), calMonth.getMonth(), d);
    const isSat = date.getDay() === 6;
    const isTod = date.toDateString() === now.toDateString();
    const isSel = selectedWeek && date.toDateString() === selectedWeek.toDateString();
    html += `<div class="cal-day${isSat?' sat':''}${isTod?' today':''}${isSel?' selected':''}"
      ${isSat ? `onclick="selectSaturday(${calMonth.getFullYear()},${calMonth.getMonth()},${d})"` : ''}>${d}</div>`;
  }
  // Pad end
  const remaining = (7 - ((firstDay + daysInMonth) % 7)) % 7;
  for (let i = 1; i <= remaining; i++) html += `<div class="cal-day other-month">${i}</div>`;
  bodyEl.innerHTML = html;
}

function setupMeetingNoteHandlers(dealRows, itemRows, salesLogData) {
  salesLogData = salesLogData || {kris:[],joseph:[],felix:[]};
  window.calNav = function(dir) {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + dir, 1);
    renderCalendar(dealRows);
  };

  window.selectSaturday = function(y, m, d) {
    selectedWeek = new Date(y, m, d);
    renderCalendar(dealRows);

    const weekStart = new Date(y, m, d-6); // Mon–Sat range
    const label = document.getElementById('selected-week-label');
    label.textContent = `Week of ${weekStart.toLocaleDateString()} – ${selectedWeek.toLocaleDateString()}`;

    // Load saved notes for this week
    const wk = selectedWeek.toISOString().split('T')[0];
    const saved = meetingNotesStore[wk] || {};
    const get = (id, fallback) => { const el2 = document.getElementById(id); if(el2) el2.innerText = saved[id]||fallback||''; };
    get('notes-main','');
    get('notes-goals','');
    get('notes-wins','');
    get('notes-losses','');

    // Week stats
    const satDate  = selectedWeek;
    // weekStart already declared above — reuse it
    const weekRowsAll = dealRows.filter(r => {
      if (!r._isSold || !r._date) return false;
      const ds = daysBetween(r._date, satDate);
      return ds >= 0 && ds < 7;
    });
    // Previous week for comparison
    const prevSat = new Date(y, m, d-7);
    const prevRows = dealRows.filter(r => {
      if (!r._isSold || !r._date) return false;
      const ds = daysBetween(r._date, prevSat);
      return ds >= 0 && ds < 7;
    });

    const tally     = calcSPFromSalesLog(salesLogData, dt => {
      if (!dt) return false;
      const ds = daysBetween(dt, satDate);
      return ds >= 0 && ds < 7;
    });
    // Gross profit breakdown
    let wFront = 0, wBack = 0;
    weekRowsAll.forEach(r => {
      const sp   = parseMoney(getField(r._raw,'pricing sale price','sale price'));
      const cost = parseMoney(getField(r._raw,'inventory total cost','total cost'));
      const back = parseMoney(getField(r._raw,'pricing backend profit','backend profit'));
      if (!isNaN(sp) && !isNaN(cost)) wFront += (sp - cost);
      if (!isNaN(back)) wBack += back;
    });
    const wGross    = wFront + wBack;
    const prevGross = prevRows.reduce((s,r)=>s+(r._profit||0),0);
    const wAvgDTS   = weekRowsAll.filter(r=>r._date&&r._inDate).length
      ? Math.round(weekRowsAll.filter(r=>r._date&&r._inDate).reduce((s,r)=>s+daysBetween(r._inDate,r._date),0)/weekRowsAll.filter(r=>r._date&&r._inDate).length)
      : null;

    const delta = (curr,prev) => {
      if (!prev) return '';
      const d = curr - prev, pct = Math.round(d/Math.abs(prev)*100);
      return `<span style="font-size:11px;color:${d>=0?'var(--green)':'var(--red)'}">${d>=0?'+':''}${pct}% vs prev wk</span>`;
    };

    const dateEl = document.getElementById('week-stats-date');
    if (dateEl) dateEl.textContent = `${weekStart.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${satDate.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;

    const statsEl = document.getElementById('week-stats-body');
    const spEntries = Object.entries(tally).sort((a,b)=>b[1].units-a[1].units);
    statsEl.innerHTML = `
      <!-- Big stat strip -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:16px">
        <div class="stat-card accent" style="background:var(--card2)">
          <div class="label">Units Sold</div>
          <div class="val">${weekRowsAll.length}</div>
          ${delta(weekRowsAll.length, prevRows.length)}
        </div>
        <div class="stat-card green" style="background:var(--card2)">
          <div class="label">Total Gross Profit</div>
          <div class="val" style="font-size:18px">${fmt$(wGross)}</div>
          ${delta(wGross, prevGross)}
        </div>
        <div class="stat-card" style="background:var(--card2)">
          <div class="label">Front Gross Profit</div>
          <div class="val" style="font-size:18px">${fmt$(wFront)}</div>
          <div class="sub">Sale Price − Cost</div>
        </div>
        <div class="stat-card" style="background:var(--card2)">
          <div class="label">Back Gross Profit</div>
          <div class="val" style="font-size:18px">${fmt$(wBack)}</div>
          <div class="sub">F&I, warranty, GAP</div>
        </div>
        <div class="stat-card" style="background:var(--card2)">
          <div class="label">Avg Gross Profit / Unit</div>
          <div class="val" style="font-size:18px">${weekRowsAll.length?fmt$(wGross/weekRowsAll.length):'—'}</div>
        </div>
        <div class="stat-card yellow" style="background:var(--card2)">
          <div class="label">Avg Days to Sell</div>
          <div class="val">${wAvgDTS !== null ? wAvgDTS+'d' : '—'}</div>
        </div>
      </div>

      <!-- SP breakdown -->
      <div style="margin-bottom:16px">
        <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.7px;margin-bottom:8px">
          Salesperson Performance (Sales Log — split-adjusted)
        </div>
        ${spEntries.length ? `
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-bottom:10px">
            ${spEntries.map(([n,s],i)=>`
              <div style="background:var(--card2);border-radius:8px;padding:12px 14px;border-left:3px solid ${i===0?'var(--yellow)':i===1?'var(--muted)':'var(--border)'}">
                <div style="font-weight:700;font-size:14px;margin-bottom:6px">${['🥇','🥈','🥉'][i]||''} ${n}</div>
                <div style="font-size:13px;margin-bottom:2px"><b style="color:var(--accent)">${s.units%1===0?s.units:s.units.toFixed(1)}</b> <span style="color:var(--muted)">units</span></div>
                <div style="font-size:12px;margin-bottom:1px">Front: <b style="color:var(--green)">${fmt$(s.frontGross||0)}</b></div>
                <div style="font-size:12px;margin-bottom:4px">Back: <b style="color:var(--accent2)">${fmt$(s.backGross||0)}</b></div>
                <div style="font-size:11px;color:var(--muted)">Total: ${fmt$(s.gross||0)} &nbsp;|&nbsp; ${fmt$(s.units?s.gross/s.units:0)}/unit</div>
              </div>`).join('')}
          </div>` : ''}
      </div>

      <!-- Deal list -->
      ${weekRowsAll.length ? `
        <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.7px;margin-bottom:6px">Deals This Week (${weekRowsAll.length})</div>
        <div class="tbl-wrap" style="max-height:220px;overflow-y:auto">
          <table class="tbl">
            <thead><tr><th>Vehicle</th><th>Stock #</th><th>Front GP</th><th>Back GP</th><th>Total GP</th><th>Closed</th></tr></thead>
            <tbody>
              ${weekRowsAll.map(r=>{
                const sp   = parseMoney(getField(r._raw,'pricing sale price','sale price'));
                const cost = parseMoney(getField(r._raw,'inventory total cost','total cost'));
                const back = parseMoney(getField(r._raw,'pricing backend profit','backend profit'));
                const front = (!isNaN(sp)&&!isNaN(cost)) ? sp-cost : NaN;
                const tot   = (!isNaN(front)?front:0) + (!isNaN(back)?back:0);
                return `<tr>
                  <td>${r._vehicle||'—'}</td>
                  <td><span class="badge badge-blue">${r._stock||'—'}</span></td>
                  <td style="color:${!isNaN(front)&&front<0?'var(--red)':'var(--green)'}">${isNaN(front)?'—':fmt$(front)}</td>
                  <td style="color:var(--green)">${isNaN(back)?'—':fmt$(back)}</td>
                  <td style="font-weight:600">${fmt$(tot)}</td>
                  <td style="color:var(--muted);font-size:11px">${r._date?r._date.toLocaleDateString():'—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : '<div style="color:var(--muted);font-size:13px">No sales recorded for this week.</div>'}
    `;

    // Auction purchases for this week
    const weekPurch = itemRows.filter(r => {
      const d = parseDate(r.date); if(!d) return false;
      const daysSince = daysBetween(d, satDate);
      return daysSince >= 0 && daysSince < 7 && detectAuction(r);
    });

    const auctionEl = document.getElementById('auction-panel');
    if (!weekPurch.length) {
      auctionEl.innerHTML = '<div style="color:var(--muted);font-size:13px">No auction purchases found for this week.</div>';
    } else {
      const bySource = {};
      weekPurch.forEach(r => {
        const src = detectAuction(r);
        if (!bySource[src]) bySource[src] = [];
        bySource[src].push(r);
      });
      auctionEl.innerHTML = `
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
          ${Object.entries(bySource).map(([src,items])=>`
            <div style="background:var(--card2);border-radius:8px;padding:10px 16px;text-align:center">
              <div style="font-size:20px;font-weight:700">${items.length}</div>
              <div style="font-size:11px;color:var(--muted)">${src}</div>
            </div>
          `).join('')}
        </div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Date</th><th>Stock #</th><th>Vehicle</th><th>Amount</th><th>Source</th></tr></thead>
            <tbody>
              ${weekPurch.map(r=>`
                <tr>
                  <td>${r.date||''}</td>
                  <td>${r['inventory stock number']||'—'}</td>
                  <td>${r['inventory vehicle year']||''} ${r['inventory vehicle make']||''} ${r['inventory vehicle model']||''}</td>
                  <td>${fmt$(parseMoney(r.amount))}</td>
                  <td><span class="badge badge-blue">${detectAuction(r)}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  };

  window.saveMeetingNotes = function() {
    if (!selectedWeek) { alert('Select a Saturday first.'); return; }
    const wk = selectedWeek.toISOString().split('T')[0];
    meetingNotesStore[wk] = {
      'notes-main':   document.getElementById('notes-main')?.innerText||'',
      'notes-goals':  document.getElementById('notes-goals')?.innerText||'',
      'notes-wins':   document.getElementById('notes-wins')?.innerText||'',
      'notes-losses': document.getElementById('notes-losses')?.innerText||'',
    };
    // Visual feedback
    const btn = document.querySelector('[onclick="saveMeetingNotes()"]');
    if (btn) { btn.textContent = '✓ Saved'; setTimeout(()=>btn.textContent='💾 Save Meeting Notes',2000); }
  };

  window.exportMeetingNotes = function() {
    if (!selectedWeek) { alert('Select a Saturday first.'); return; }
    const wk = selectedWeek.toISOString().split('T')[0];
    const n = meetingNotesStore[wk] || {};
    const txt = `Meeting Notes — Week of ${wk}\n\nNOTES:\n${n['notes-main']||''}\n\nGOALS:\n${n['notes-goals']||''}\n\nWINS:\n${n['notes-wins']||''}\n\nIMPROVE:\n${n['notes-losses']||''}`;
    window.sendPrompt('Save this meeting note to Google Drive: ' + txt.substring(0,3000));
  };
}


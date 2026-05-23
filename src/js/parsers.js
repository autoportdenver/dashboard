'use strict';

// ══════════════════════════════════════════════
//  PARSERS — src/js/parsers.js
//  Domain-specific row parsers. Pure functions —
//  no Drive calls, no DOM reads, no global state writes.
// ══════════════════════════════════════════════

// ── Deal Detail (Dealr.Cloud export) ──
function buildDealRows(rawRows) {
  return rawRows.map(row => {
    const vehicleName = getField(row, 'inventory vehicle name', 'vehicle name', 'vehicle') || '';
    const parts  = vehicleName.trim().split(/\s+/);
    const year   = parts[0] || '';
    const make   = parts[1] || '';
    const model  = parts.slice(2).join(' ');

    const stock   = getField(row, 'inventory stock number', 'stock number', 'stock #', 'stock');
    const closing = parseDate(getField(row, 'closing date', 'close date', 'date'));
    const inDate  = parseDate(getField(row, 'inventory in date', 'date in', 'in date'));
    const miles   = parseMoney(getField(row, 'actual miles', 'mileage', 'miles').replace(/,/g, ''));

    const status  = (getField(row, 'status', 'deal status') || '').toLowerCase();
    const isSold  = status === 'sold retail' ||
                    (!!closing && !status.includes('unwind') && !!status);

    const salePrice  = parseMoney(getField(row, 'pricing sale price', 'sale price'));
    const totalCost  = parseMoney(getField(row, 'inventory total cost', 'total cost'));
    const backEnd    = parseMoney(getField(row, 'pricing backend profit', 'backend profit'));
    const frontGross = (!isNaN(salePrice) && !isNaN(totalCost)) ? salePrice - totalCost : NaN;
    const profit     = !isNaN(frontGross)
      ? frontGross + (isNaN(backEnd) ? 0 : backEnd)
      : isNaN(backEnd) ? 0 : backEnd;

    const sp1 = (getField(row, 'salesperson', 'sales person', 'sp', 'primary sp') || '').toLowerCase().trim();
    const sp2 = (getField(row, 'co salesperson', 'co-sp', 'co sp', 'secondary sp') || '').toLowerCase().trim();
    const pct = sp2 ? 0.5 : 1.0;

    return {
      _stock: stock, _date: closing, _inDate: inDate,
      _sp: sp1, _sp2: sp2, _pct: pct,
      _profit: isNaN(profit) ? 0 : profit,
      _mileage: isNaN(miles) ? 0 : miles,
      _make: make, _year: year, _vehicle: vehicleName || `${year} ${make} ${model}`.trim(),
      _isSold: isSold, _raw: row,
    };
  });
}

// ── Gross-profit tally from Deal Detail rows ──
function calcSalesByPerson(rows) {
  const tally = {};
  for (const r of rows) {
    if (!r._isSold) continue;
    const addFor = (name, frac) => {
      if (!name) return;
      const n = capitalise(name);
      if (!tally[n]) tally[n] = { units: 0, gross: 0 };
      tally[n].units += frac;
      tally[n].gross += (r._profit || 0) * frac;
    };
    if (r._sp2 && r._sp2 !== r._sp) {
      const pct = (r._pct >= 1) ? 0.5 : r._pct;
      addFor(r._sp, pct);
      addFor(r._sp2, 1 - pct);
    } else {
      addFor(r._sp, 1);
    }
  }
  return tally;
}

// ── Auction detection (Itemized Inventory Costs CSV) ──
// AutoPort schedule: Mon=CarMax  Wed=Manheim  Thu=Dealers  Fri=Loveland
function inferAuctionFromDate(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return null;
  const dow = d.getDay();
  if (dow === 1) return 'CarMax';
  if (dow === 3) return 'Manheim';
  if (dow === 4) return 'Dealers Auto Auction';
  if (dow === 5) return 'Loveland';
  return null;
}

function detectAuction(row, inferFromDate) {
  const typeRaw = (row['type'] || '').trim();
  const type    = typeRaw.toLowerCase();
  const desc    = (row['description'] || '').toLowerCase();
  const vendor  = (row['vendor name'] || '').toLowerCase();
  const amt     = parseMoney(row['amount']);

  if (isNaN(amt) || amt === 0) return null;

  const isFlooringDraw = type === 'flooring payable' && amt > 0;
  const isPurchase     = type === 'purchase';
  if (!isFlooringDraw && !isPurchase) return null;

  const combined = desc + ' ' + vendor;
  if (combined.includes('trade-in') || combined.includes('trade in') || combined.includes('car corner')) return null;
  if (combined.includes('facebook') || combined.includes('fb mkt')) return null;

  const searchStr = isFlooringDraw ? desc : (vendor + ' ' + desc);
  if (searchStr.includes('carmax'))                                       return 'CarMax';
  if (searchStr.includes('loveland'))                                     return 'Loveland';
  if (searchStr.includes('manheim') || searchStr.includes('mannheim'))    return 'Manheim';
  if (searchStr.includes('dealers auto') || searchStr.includes('daa'))    return 'Dealers Auto Auction';
  if (searchStr.includes('adesa'))                                        return 'ADESA';
  if (searchStr.includes('iaai') || searchStr.includes('insurance auto')) return 'IAAI';

  if (isFlooringDraw) {
    const inferred = inferAuctionFromDate(inferFromDate || row['date']);
    return inferred ? (inferred + ' *') : 'Auction (Unknown)';
  }
  if (isPurchase) return 'Other';
  return null;
}

function auctionLabel(raw) { return raw ? raw.replace(' *', '') : raw; }

// ── Sales Log parser (Sales - Live Google Sheet) ──
// Returns { joseph: Deal[], felix: Deal[], kris: Deal[], _debug: string }
function parseSalesLog(txt) {
  if (!txt || txt.length < 50) {
    return { joseph: [], felix: [], kris: [], _debug: 'File not found or empty' };
  }

  const NEW_HDR = 'Date,Type,Finance?,Stock,Inventory Vehicle Name';
  const OLD_HDR = 'Date,Car,Type,Description';

  const josephLabelIdx = txt.indexOf('Joseph-Cars');
  const felixLabelIdx  = txt.indexOf('Felix-Cars');
  const krisLabelIdx   = ['Kris-Cars', 'Kris Cars', 'Kris'].reduce((found, pat) => {
    if (found >= 0) return found;
    const idx = txt.indexOf(pat);
    return idx >= 0 ? idx : -1;
  }, -1);

  const josephHdrIdx  = josephLabelIdx >= 0 ? txt.indexOf(NEW_HDR, josephLabelIdx) : -1;
  const felixHdrIdx   = felixLabelIdx  >= 0 ? txt.indexOf(NEW_HDR, felixLabelIdx)  : -1;
  let   krisNewHdrIdx = krisLabelIdx   >= 0 ? txt.indexOf(NEW_HDR, krisLabelIdx)   : -1;

  // Fallback: if 3+ occurrences of NEW_HDR exist, the third is likely Kris
  if (krisNewHdrIdx < 0) {
    let searchFrom = 0, count = 0;
    while (true) {
      const idx = txt.indexOf(NEW_HDR, searchFrom);
      if (idx < 0) break;
      if (++count === 3) { krisNewHdrIdx = idx; break; }
      searchFrom = idx + NEW_HDR.length;
    }
  }

  const krisOldHdrIdx = txt.indexOf(OLD_HDR);

  function sectionEnd(...laterStarts) {
    const valid = laterStarts.filter(x => x > 0).sort((a, b) => a - b);
    return valid.length ? valid[0] : txt.length;
  }

  const josephText  = josephHdrIdx >= 0 ? txt.slice(josephHdrIdx, sectionEnd(felixHdrIdx, krisNewHdrIdx)) : '';
  const felixText   = felixHdrIdx  >= 0 ? txt.slice(felixHdrIdx,  sectionEnd(krisNewHdrIdx, josephHdrIdx > felixHdrIdx ? josephHdrIdx : txt.length)) : '';
  const krisNewText = krisNewHdrIdx >= 0
    ? txt.slice(krisNewHdrIdx, sectionEnd(josephHdrIdx > krisNewHdrIdx ? josephHdrIdx : txt.length, felixHdrIdx > krisNewHdrIdx ? felixHdrIdx : txt.length))
    : '';
  const krisOldText = krisOldHdrIdx >= 0
    ? txt.slice(krisOldHdrIdx, sectionEnd(josephHdrIdx > krisOldHdrIdx ? josephHdrIdx : txt.length, felixHdrIdx > krisOldHdrIdx ? felixHdrIdx : txt.length))
    : '';

  function cleanMoney(v) {
    if (!v) return 0;
    const s = String(v);
    if (s.includes('#VALUE') || s.includes('#ERROR') || s.includes('#REF') || s.trim() === '') return 0;
    return parseMoney(s) || 0;
  }

  function parseNewFormat(sectionText, spName) {
    if (!sectionText) return [];
    const rawRows = parseCSV(preprocessFlatCSV(sectionText));
    const byStock = {};

    for (const row of rawRows) {
      const dateRaw = (row['date'] || '').trim();
      const d = parseDate(dateRaw);
      if (!d || isNaN(d.getTime())) continue;

      const type = (row['type'] || '').trim();
      const isVehicleSale = /vehicle\s*sale/i.test(type);
      const isWarranty    = /warranty/i.test(type);
      if (!isVehicleSale && !isWarranty) continue;

      const stock   = (row['stock'] || '').trim();
      const vehicle = (row['inventory vehicle name'] || row['vehicle name'] || row['vehicle'] || '').trim();
      const notes   = (row['notes'] || row['deal notes'] || row['sp notes'] || '').trim();

      const adjFront = cleanMoney(row['adjusted f-profit'] ?? row['adj f-profit'] ?? row['adjusted front profit'] ?? row['adj front profit'] ?? row['adjf-profit'] ?? row['adjusted f profit'] ?? '');
      const bProfit  = cleanMoney(row['b-profit'] ?? row['b profit'] ?? row['backend profit'] ?? row['back profit'] ?? row['b-gross'] ?? '');
      const splitRaw = (row['split'] ?? row['split%'] ?? row['split %'] ?? row['split pct'] ?? '100').replace('%', '').trim();
      const splitPct = Math.min(1, Math.max(0, (parseFloat(splitRaw) || 100) / 100));
      const totalChk = cleanMoney(row['total check'] ?? row['total'] ?? row['check amount'] ?? row['sp check'] ?? '');

      const stockKey = stock || (dateRaw + '|' + vehicle.toLowerCase().substring(0, 20));

      if (!byStock[stockKey]) {
        byStock[stockKey] = {
          dateRaw, d, stock, vehicle, notes, sp: spName,
          frontGross: 0, backGross: 0, splitPct,
          totalCheck: 0, hasWarranty: false, warrantyBProfit: 0,
          unitType: isVehicleSale ? 'sale' : 'warranty-only',
        };
      }
      const deal = byStock[stockKey];
      if (isVehicleSale) {
        deal.frontGross += adjFront;
        deal.backGross  += bProfit;
        deal.splitPct    = splitPct;
        deal.totalCheck += totalChk;
        deal.unitType    = 'sale';
        if (!deal.d || d < deal.d) { deal.d = d; deal.dateRaw = dateRaw; }
      } else if (isWarranty) {
        deal.hasWarranty     = true;
        deal.warrantyBProfit += bProfit;
        deal.totalCheck      += totalChk;
      }
    }

    return Object.values(byStock)
      .filter(deal => deal.d && !isNaN(deal.d.getTime()))
      .sort((a, b) => a.d - b.d);
  }

  function parseOldFormat(sectionText, spName) {
    if (!sectionText) return [];
    const rawRows = parseCSV(preprocessFlatCSV(sectionText));
    return rawRows.map(row => {
      const keys = Object.keys(row);
      if (keys.length < 3) return null;
      const dateRaw = (row[keys[0]] || '').trim();
      const d = parseDate(dateRaw);
      if (!d || isNaN(d.getTime())) return null;
      const type = (row[keys[2]] || '').toLowerCase().trim();
      if (!/\bsold\b|\bsale\b/i.test(type)) return null;
      const commission = cleanMoney(row[keys[5]]) || cleanMoney(row[keys[4]]) || 0;
      return {
        dateRaw, d, sp: spName, stock: '',
        vehicle: (row[keys[1]] || '').trim(), notes: '',
        frontGross: 0, backGross: 0, splitPct: 1, totalCheck: commission,
        hasWarranty: false, warrantyBProfit: 0, unitType: 'sale',
      };
    }).filter(Boolean).sort((a, b) => a.d - b.d);
  }

  const josephRows = parseNewFormat(josephText, 'joseph');
  const felixRows  = parseNewFormat(felixText,  'felix');
  const krisRows   = krisNewText
    ? parseNewFormat(krisNewText, 'kris')
    : parseOldFormat(krisOldText, 'kris');

  return {
    joseph: josephRows,
    felix:  felixRows,
    kris:   krisRows,
    _debug: `${txt.length} chars | J:${josephRows.length} F:${felixRows.length} K:${krisRows.length} deals | hdr@J:${josephHdrIdx} F:${felixHdrIdx} K-new:${krisNewHdrIdx} K-old:${krisOldHdrIdx}`,
  };
}

// ── SP tally from Sales Log tabs ──
// Returns { SpName: { units, warrantyUnits, frontGross, backGross, warrantyBackGross, gross, totalCheck } }
function calcSPFromSalesLog(salesLogData, periodFn) {
  const tally = {};
  for (const spKey of ['joseph', 'felix', 'kris']) {
    const rows = salesLogData[spKey];
    if (!Array.isArray(rows)) continue;
    const spName = capitalise(spKey);
    for (const row of rows) {
      const d = row.d || parseDate(row.dateRaw || row.date);
      if (!d || isNaN(d.getTime())) continue;
      if (periodFn && !periodFn(d)) continue;
      if (row.unitType === 'warranty-only') continue;
      const pct = typeof row.splitPct === 'number' ? row.splitPct : 1;
      if (!tally[spName]) tally[spName] = { units: 0, warrantyUnits: 0, frontGross: 0, backGross: 0, warrantyBackGross: 0, totalCheck: 0 };
      tally[spName].units             += pct;
      tally[spName].frontGross        += (row.frontGross      || 0) * pct;
      tally[spName].backGross         += (row.backGross       || 0) * pct;
      tally[spName].warrantyBackGross += (row.warrantyBProfit || 0) * pct;
      tally[spName].totalCheck        += (row.totalCheck      || 0);
      if (row.hasWarranty) tally[spName].warrantyUnits += pct;
    }
  }
  for (const v of Object.values(tally)) {
    v.gross = v.frontGross + v.backGross + v.warrantyBackGross;
  }
  return tally;
}

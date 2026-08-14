import json, base64, os, sys, datetime as dt

# ── Paths ─────────────────────────────────────────────────────────
# This script lives in build/. Paths resolve relative to the repo ROOT (its
# parent) so the build runs wherever the repo is checked out. Optional env
# overrides let CI stage inputs/outputs elsewhere without editing code.
HERE    = os.path.dirname(os.path.abspath(__file__))
ROOT    = os.path.dirname(HERE)
DATADIR = os.environ.get("VIEWONLY_DATA", os.path.join(ROOT, "data"))
OUTDIR  = os.environ.get("VIEWONLY_OUT",  ROOT)

def _find_logo():
    for p in [os.environ.get("VIEWONLY_LOGO"),
              os.path.join(ROOT, "assets", "logo.png"),
              os.path.join(ROOT, "assets", "IconTop.BlackBckgrnd.png")]:
        if p and os.path.isfile(p):
            return p
    return None

# ── Page styles ──────────────────────────────────────────────────
# CSS embedded here (formerly sourced from dash_template.html). It is injected
# into the <style> tag below, so the generated index.html carries every style
# inline and the build has NO external template dependency.
CSS = r"""
:root{
  --bg:#e7ebf2; --panel:#ffffff; --panel2:#f1f4f9; --panel3:#e7ecf3;
  --border:#d3dae5; --border2:#c2cbda; --text:#141b27; --muted:#586377; --faint:#8a95a8;
  --nav:#0a0b0e; --nav2:#000000; --navtext:#a3aec2; --navborder:#20242c;
  --blue:#0e93cf; --blue-l:#2aabe4; --blue-soft:#e2f2fb; --blue-glow:rgba(42,171,228,.4);
  --green:#10a568; --green-soft:#dff5eb; --amber:#d5891a; --amber-soft:#faefda;
  --red:#df3f52; --red-soft:#fbe6e9; --purple:#6a5be0; --purple-soft:#e9e7fc;
  --radius:14px; --radius-s:10px;
  --shadow:0 1px 2px rgba(20,35,60,.06),0 12px 28px rgba(20,35,60,.09);
  --shadow-s:0 1px 2px rgba(20,35,60,.06),0 5px 14px rgba(20,35,60,.07);
  --font:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--text);font-family:var(--font);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;top:0;left:0;right:0;height:3px;z-index:100;background:linear-gradient(90deg,#0e93cf,#2aabe4 55%,#7cd4f5)}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:#b9c3d3;border-radius:8px}
::-webkit-scrollbar-track{background:transparent}
.app{display:flex;min-height:100vh}

/* ---------- Sidebar (dark, high contrast) ---------- */
.sidebar{width:238px;flex:0 0 238px;background:linear-gradient(180deg,var(--nav),var(--nav2));
  display:flex;flex-direction:column;position:sticky;top:0;height:100vh;border-right:1px solid var(--navborder)}
.brand{padding:20px 20px 14px;text-align:center}
.brandimg{width:140px;display:block;margin:0 auto}
.brand .sub{margin-top:8px;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#68748c;font-weight:700}
.nav{padding:10px 12px;display:flex;flex-direction:column;gap:3px}
.nav a{display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:var(--radius-s);
  color:var(--navtext);text-decoration:none;font-weight:600;position:relative;transition:.15s;cursor:pointer;font-size:13.5px}
.nav a svg{width:19px;height:19px;stroke:currentColor;fill:none;stroke-width:1.7;flex:0 0 19px}
.nav a:hover{background:rgba(255,255,255,.06);color:#e7edf6}
.nav a.active{background:linear-gradient(90deg,var(--blue),var(--blue-l));color:#fff;box-shadow:0 6px 16px rgba(14,147,207,.4)}
.nav a.soon{opacity:.4;cursor:not-allowed}
.nav .tag{margin-left:auto;font-size:8.5px;letter-spacing:.05em;text-transform:uppercase;color:#5f6f88;border:1px solid var(--navborder);padding:2px 6px;border-radius:20px}
.side-foot{margin-top:auto;padding:15px 20px;border-top:1px solid var(--navborder);font-size:11px;color:#6b7a92;font-weight:600}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;vertical-align:middle}

/* ---------- Main ---------- */
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.topbar{display:flex;align-items:center;gap:16px;padding:22px 34px 14px;position:sticky;top:0;z-index:20;background:linear-gradient(180deg,var(--bg) 70%,rgba(231,235,242,0))}
.topbar h1{margin:0;font-size:22px;font-weight:800;letter-spacing:-.02em}
.topbar .crumb{font-size:12px;color:var(--muted);margin-top:2px}
.spacer{flex:1}
.pill{display:inline-flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--border);padding:7px 13px;border-radius:30px;font-size:12px;color:var(--muted);box-shadow:var(--shadow-s)}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--blue);color:#fff;border:none;padding:9px 15px;border-radius:10px;font-weight:650;font-size:13px;cursor:pointer;transition:.15s;box-shadow:0 4px 12px rgba(14,147,207,.28)}
.btn:hover{background:#0b84bd;box-shadow:0 6px 18px var(--blue-glow)}
.btn svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2}
.content{padding:6px 34px 60px;flex:1}
.page{display:none;animation:fade .28s ease}
.page.active{display:block}
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.banner{display:flex;align-items:center;gap:11px;background:var(--amber-soft);border:1px solid rgba(213,137,26,.3);border-radius:12px;padding:10px 15px;margin-bottom:18px;font-size:12.5px;color:#8a5b0d}
.banner svg{width:16px;height:16px;stroke:var(--amber);fill:none;stroke-width:1.9;flex:0 0 16px}

/* ---------- Section headers (prominent) ---------- */
.sec-head{display:flex;align-items:center;gap:12px;margin:28px 0 14px}
.sec-head .chip{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex:0 0 34px;box-shadow:var(--shadow-s)}
.sec-head .chip svg{width:19px;height:19px;stroke:#fff;fill:none;stroke-width:2}
.sec-head h2{margin:0;font-size:17px;font-weight:800;letter-spacing:-.01em}
.sec-head .count{font-size:11px;color:var(--muted);background:var(--panel);border:1px solid var(--border);padding:2px 10px;border-radius:20px;font-weight:600}
.sec-head .rule{flex:1;height:2px;border-radius:2px;background:linear-gradient(90deg,var(--border2),transparent)}
.sec-head .linkish{color:var(--blue);cursor:pointer;font-size:12px;font-weight:650}
.card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow)}

/* ---------- Reports table ---------- */
.rtable{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden;border-radius:var(--radius);font-size:12.5px}
.rtable th{text-align:left;font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#cbd6e6;font-weight:700;padding:11px 16px;background:#26334a;border-bottom:none;white-space:nowrap}
.rtable td{padding:9px 16px;border-bottom:1px solid var(--border);vertical-align:middle}
.rtable tr:last-child td{border-bottom:none}
.rtable tbody tr:hover{background:var(--panel2)}
.rname{font-weight:650;color:var(--text);white-space:nowrap}
.rpath{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--muted);white-space:normal;word-break:break-word;max-width:250px;line-height:1.35}
.rfile{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--muted);white-space:normal;word-break:break-word;max-width:280px;line-height:1.35}
.ttype{font-size:10px;padding:3px 10px;border-radius:20px;font-weight:700;white-space:nowrap;display:inline-block}
.ttype.all{color:var(--blue);background:var(--blue-soft)}
.ttype.month{color:var(--purple);background:var(--purple-soft)}
.fresh{display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.fresh .dot{margin:0}
.fdate{color:var(--text);font-weight:600} .fago{color:var(--faint);font-size:10.5px;margin-left:3px}

/* ---------- Tasks ---------- */
.board{background:linear-gradient(180deg,var(--panel),var(--panel2));border:2px solid var(--border2);border-radius:18px;padding:6px 16px 18px;box-shadow:var(--shadow);position:relative}
.board-head{display:flex;align-items:center;gap:11px;padding:15px 4px 14px}
.board-head .bic{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#141b27,#2b3purple);display:grid;place-items:center;background:linear-gradient(135deg,#1b2536,#0e1622)}
.board-head .bic svg{width:18px;height:18px;stroke:#2aabe4;fill:none;stroke-width:1.9}
.board-head h2{margin:0;font-size:16px;font-weight:800}
.board-head .bsub{font-size:11.5px;color:var(--muted);margin-left:auto;font-weight:500}
.task-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:1050px){.task-cols{grid-template-columns:1fr}}
.tcol{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:4px 4px 12px;box-shadow:var(--shadow-s)}
.tcol-head{display:flex;align-items:center;gap:10px;padding:14px 15px 11px}
.tcol-head .ic{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;box-shadow:var(--shadow-s)}
.tcol-head .ic svg{width:17px;height:17px;stroke:#fff;fill:none;stroke-width:2}
.tcol-head h3{margin:0;font-size:14.5px;font-weight:800}
.tcol-head .n{font-size:11px;color:var(--muted);font-weight:700;background:var(--panel2);border:1px solid var(--border);border-radius:20px;padding:1px 9px}
.tcol-head .add{margin-left:auto;background:var(--panel2);border:1px solid var(--border);color:var(--muted);width:28px;height:28px;border-radius:8px;cursor:pointer;font-size:17px;line-height:1;transition:.15s}
.tcol-head .add:hover{background:var(--blue);color:#fff;border-color:transparent}
.urgent .ic{background:linear-gradient(135deg,#e2394d,#a51f30)}
.tasks .ic{background:linear-gradient(135deg,#2aabe4,#0e7fb0)}
.tlist{display:flex;flex-direction:column;gap:8px;padding:4px 12px}
.tcard{display:flex;align-items:flex-start;gap:11px;background:var(--panel2);border:1px solid var(--border);border-left-width:4px;border-radius:11px;padding:11px 12px;transition:.14s}
.tcard:hover{box-shadow:var(--shadow-s)}
.tcard.st-ns{border-left-color:var(--red)} .tcard.st-ip{border-left-color:var(--blue)}
.tcard.st-oh{border-left-color:var(--amber)} .tcard.st-cp{border-left-color:var(--green)}
.tcard.done{opacity:.6}
.tcard.done .ttext{text-decoration:line-through;color:var(--muted)}
.prio{flex:0 0 25px;height:25px;border-radius:8px;display:grid;place-items:center;font-weight:800;font-size:12px;margin-top:1px}
.prio.p1{background:var(--red-soft);color:var(--red)} .prio.p2{background:var(--amber-soft);color:var(--amber)} .prio.p3{background:var(--panel3);color:var(--faint)}
.tbody{flex:1;min-width:0}
.ttext{font-weight:650;font-size:13.5px;word-break:break-word}
.tmeta{display:flex;align-items:center;gap:9px;margin-top:7px;flex-wrap:wrap}
.tmeta .date{font-size:11px;color:var(--faint)}
.sel{background:var(--panel);border:1px solid var(--border);border-radius:7px;font-size:11px;padding:3px 7px;cursor:pointer;font-family:var(--font);font-weight:650}
.sel:focus{outline:1px solid var(--blue)}
.owner{background:var(--panel);border:1px solid var(--border);border-radius:7px;font-size:11px;padding:3px 7px;width:74px;font-family:var(--font);color:var(--text);font-weight:600;transition:.14s}
.owner:focus{outline:1px solid var(--blue);width:104px}
.owner::placeholder{color:var(--faint);font-weight:500}
.st-sel-ns{color:var(--red);border-color:var(--red)} .st-sel-ip{color:var(--blue);border-color:var(--blue)}
.st-sel-oh{color:var(--amber);border-color:var(--amber)} .st-sel-cp{color:var(--green);border-color:var(--green)}
.st-sel-out{color:#8257e6;border-color:#8257e6}
.tacts{display:flex;gap:4px;opacity:0;transition:.14s}
.tcard:hover .tacts{opacity:1}
.iconbtn{width:24px;height:24px;border-radius:7px;background:transparent;border:1px solid transparent;color:var(--faint);cursor:pointer;display:grid;place-items:center;transition:.14s}
.iconbtn:hover{background:var(--panel);color:var(--text);border-color:var(--border)}
.iconbtn.del:hover{color:var(--red)}
.iconbtn svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.9}
.empty{text-align:center;color:var(--faint);font-size:12.5px;padding:22px 10px}
.done-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:9px}

/* flagged from reports */
.info{width:17px;height:17px;border-radius:50%;background:var(--blue-soft);border:1px solid rgba(14,147,207,.4);color:var(--blue);font-size:10.5px;font-weight:800;display:inline-grid;place-items:center;cursor:help;font-style:normal;font-family:Georgia,serif}
.info:hover{background:var(--blue);color:#fff}
.fgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:15px}
.fgrid.full{grid-template-columns:1fr}
.fcard{background:var(--panel);border:1px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:var(--shadow-s)}
.fcard-h{display:flex;align-items:center;gap:9px;padding:12px 15px;border-bottom:1px solid var(--border);background:var(--panel2)}
.fcard-h .ft{font-weight:700;font-size:12.5px}
.fcard-h .fn{font-size:10.5px;color:var(--muted);background:var(--panel);border:1px solid var(--border);border-radius:20px;padding:1px 8px;margin-left:auto;font-weight:600}
.frows.multi{columns:3;column-gap:0}
@media(max-width:1100px){.frows.multi{columns:2}}
.frow{display:flex;align-items:flex-start;gap:11px;padding:9px 15px;border-bottom:1px solid var(--border);font-size:12.5px;transition:.12s;break-inside:avoid}
.frow:hover{background:var(--panel2)}
.frow.hidden{display:none}
.chk{flex:0 0 17px;width:17px;height:17px;border-radius:5px;border:1.7px solid var(--faint);cursor:pointer;display:grid;place-items:center;transition:.14s;margin-top:1px}
.chk:hover{border-color:var(--green)}
.chk.on{background:var(--green);border-color:var(--green)} .chk.on svg{opacity:1}
.chk svg{width:11px;height:11px;stroke:#fff;stroke-width:3;fill:none;opacity:0}
.frow .fmain{flex:1;min-width:0}
.frow .fs{font-weight:700} .frow .fs small{font-weight:500;color:var(--muted)}
.ffields{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
.ffield{font-size:11px;color:var(--text);background:#fff;border:1px solid var(--border2);border-radius:6px;padding:1px 7px}
.ffield b{color:var(--text);font-weight:700} .ffield .lbl{color:var(--muted);text-transform:uppercase;letter-spacing:.04em;font-size:9px;margin-right:4px;font-weight:600}

/* ---------- Stats ---------- */
.period{display:inline-flex;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:3px;gap:2px;box-shadow:var(--shadow-s);margin-bottom:6px}
.period button{border:none;background:transparent;color:var(--muted);font-family:var(--font);font-weight:650;font-size:12px;padding:6px 13px;border-radius:8px;cursor:pointer;transition:.14s}
.period button:hover{color:var(--text)}
.period button.on{background:var(--blue);color:#fff}
.periodbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.periodbar .pnote{font-size:11.5px;color:var(--faint)}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:13px;margin-bottom:20px}
@media(max-width:1100px){.kpis{grid-template-columns:repeat(3,1fr)}}
@media(max-width:640px){.kpis{grid-template-columns:repeat(2,1fr)}}
.kpi{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:15px 16px;box-shadow:var(--shadow-s);position:relative;overflow:hidden}
.kpi::after{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--blue)}
.kpi.g::after{background:var(--green)} .kpi.a::after{background:var(--amber)} .kpi.r::after{background:var(--red)} .kpi.p::after{background:var(--purple)}
.kpi .kv{font-size:23px;font-weight:800;letter-spacing:-.02em;color:var(--text)}
.kpi .kl{font-size:11.5px;color:var(--muted);margin-top:3px;font-weight:600}
.kpi .ks{font-size:10.5px;color:var(--faint);margin-top:1px}
.chart-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:8px}
.chart-grid .wide{grid-column:1/-1}
@media(max-width:900px){.chart-grid{grid-template-columns:1fr}}
.chartcard{padding:15px 16px 10px}
.cch{font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px}
.cch.flex{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.chart{width:100%;height:auto;display:block}
.chart .axl{font-size:9px;fill:var(--faint);font-family:var(--font)}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:6px}
.legend span{font-size:11px;color:var(--muted);display:inline-flex;align-items:center;gap:6px;font-weight:600}
.legend i{width:10px;height:10px;border-radius:3px;display:inline-block}
.tbl-wrap{overflow-x:auto}
.stbl{width:100%;border-collapse:separate;border-spacing:0;font-size:12px}
.stbl th{text-align:right;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:#cbd6e6;font-weight:700;padding:8px 10px;background:#26334a;border-bottom:none;white-space:nowrap}
.stbl th:first-child{text-align:left}
.stbl td{padding:6px 10px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap;color:var(--muted)}
.stbl td.ls{text-align:left;color:var(--text);font-weight:650}
.stbl td.tot{color:var(--text);font-weight:800}
.stbl tr.gt td{background:var(--panel2);font-weight:800;color:var(--text);border-top:1.5px solid var(--border2)}
.stbl tbody tr:hover td{background:var(--panel2)}
.stbl.mini td:nth-child(2){text-align:left;white-space:normal}
.lead-two{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
.lead-two .card{padding:14px 16px}
@media(max-width:900px){.lead-two{grid-template-columns:1fr}}
/* ---------- Repair Log ---------- */
.repair-actions{display:flex;gap:10px;margin-bottom:8px;flex-wrap:wrap}
.genbtn{display:inline-flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--border);color:var(--text);font-weight:650;font-size:13px;padding:9px 15px;border-radius:10px;cursor:pointer;box-shadow:var(--shadow-s);transition:.14s}
.genbtn:hover{border-color:var(--blue);color:var(--blue);box-shadow:0 4px 14px var(--blue-glow)}
.genbtn svg{width:16px;height:16px}
.rptable{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px}
.rptable th{text-align:left;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:#cbd6e6;font-weight:700;padding:10px 12px;background:#26334a;white-space:nowrap}
.rptable td{padding:5px 10px;border-bottom:1px solid var(--border);vertical-align:middle;white-space:nowrap}
.rptable tr:last-child td{border-bottom:none}
.rptable tbody tr:hover td{background:var(--panel2)}
.rstk{font-weight:750;color:var(--text)} .rveh{font-weight:600;white-space:normal;min-width:150px}
.inspbtn{background:var(--panel2);border:1px solid var(--border);color:var(--muted);font-weight:650;font-size:11px;padding:5px 11px;border-radius:8px;cursor:pointer;white-space:nowrap;transition:.14s}
.inspbtn:hover{background:var(--blue);color:#fff;border-color:transparent}
.inspbtn.done{background:var(--green-soft);border-color:var(--green);color:var(--green)}
/* repair row status tints */
.rt-ns{--rtc:#d1443b} .rt-ip{--rtc:#1f6feb} .rt-oh{--rtc:#d5891a} .rt-out{--rtc:#8257e6} .rt-rd{--rtc:#14a078} .rt-cp{--rtc:#1e9e5a}
.rptable tbody tr.rt-ns td{background:rgba(209,68,59,.06)} .rptable tbody tr.rt-ip td{background:rgba(31,111,235,.07)}
.rptable tbody tr.rt-oh td{background:rgba(213,137,26,.10)} .rptable tbody tr.rt-rd td{background:rgba(20,160,120,.09)}
.rptable tbody tr.rt-out td{background:rgba(130,87,230,.09)} .rptable tbody tr.rt-cp td{background:rgba(30,158,90,.11)}
.rptable tbody tr.rt-ns:hover td{background:rgba(209,68,59,.13)} .rptable tbody tr.rt-ip:hover td{background:rgba(31,111,235,.14)}
.rptable tbody tr.rt-oh:hover td{background:rgba(213,137,26,.18)} .rptable tbody tr.rt-rd:hover td{background:rgba(20,160,120,.17)}
.rptable tbody tr.rt-out:hover td{background:rgba(130,87,230,.17)} .rptable tbody tr.rt-cp:hover td{background:rgba(30,158,90,.19)}
.rptable tbody tr[class*=rt-] td:first-child{box-shadow:inset 3px 0 0 var(--rtc)}
/* expandable notes */
.rptable td.rnotes{white-space:normal}
.notewrap{display:flex;align-items:flex-start;gap:5px}
.rnote{width:230px;height:26px;resize:none;border:1px solid var(--border);border-radius:7px;padding:4px 7px;font-size:12px;font-family:var(--font);line-height:1.35;background:var(--panel);color:inherit;overflow:hidden;transition:height .12s,width .12s}
.rnote:focus{outline:1px solid var(--blue)}
.rnote.expanded{height:96px;width:340px;overflow:auto}
.noteexp{background:var(--panel2);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:13px;color:var(--muted);padding:3px 7px;line-height:1;flex:none}
.noteexp:hover{background:var(--blue);color:#fff;border-color:transparent}
/* repair filter bar */
.repair-filters{display:flex;gap:16px;align-items:center;margin:0 0 12px;flex-wrap:wrap}
.repair-filters label{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.repair-filters select{border:1px solid var(--border);border-radius:7px;padding:5px 9px;font-size:12px;font-family:var(--font);font-weight:600;background:var(--panel);color:var(--text);cursor:pointer;text-transform:none;letter-spacing:0}
/* ---------- Plates ---------- */
.ptable{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
.ptable th{text-align:left;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:#cbd6e6;font-weight:700;padding:10px 14px;background:#26334a;white-space:nowrap}
.ptable th:last-child{width:44px}
.ptable td{padding:5px 10px;border-bottom:1px solid var(--border);vertical-align:middle}
.ptable tr:last-child td{border-bottom:none}
.ptable tbody tr:hover td{background:var(--panel2)}
.pin{width:100%;background:transparent;border:1px solid transparent;border-radius:7px;padding:6px 8px;font-family:var(--font);font-size:13px;color:var(--text);font-weight:600;transition:.12s}
.pin:hover{border-color:var(--border)} .pin:focus{outline:none;border-color:var(--blue);background:var(--panel)}
.pin::placeholder{color:var(--faint);font-weight:500}
.pchk{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:5px 13px;border-radius:20px;cursor:pointer;border:1px solid var(--border);color:var(--faint);background:var(--panel2);transition:.14s;user-select:none;letter-spacing:.02em}
.pchk:hover{border-color:var(--green);color:var(--green)}
.pchk.on{background:var(--green-soft);border-color:var(--green);color:var(--green)}
.pchk.stale{background:var(--amber-soft);border-color:var(--amber);color:var(--amber)}
.padd{background:var(--panel);border:1px solid var(--border);color:var(--blue);font-weight:650;font-size:12px;padding:6px 13px;border-radius:8px;cursor:pointer;transition:.14s}
.padd:hover{background:var(--blue);color:#fff;border-color:transparent}
.pdelcell{text-align:right}
.placeholder{display:grid;place-items:center;height:60vh;color:var(--faint);text-align:center}
.placeholder .big{width:54px;height:54px;stroke:var(--border2);stroke-width:1.4;fill:none;margin-bottom:16px}
/* ---- Modal (inspection + quote/invoice/receipt) ---- */
.modal-bk{position:fixed;inset:0;background:rgba(10,12,18,.55);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;z-index:200;padding:34px 16px;overflow:auto}
.modal-bk[hidden]{display:none}
.modal-card{background:#f6f7fb;width:min(920px,100%);border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.4);overflow:hidden;border:1px solid #dfe3ec}
.modal-hd{background:#0a0b0e;color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;font-weight:700;font-size:15.5px;letter-spacing:.2px}
.modal-hd button{background:none;border:none;color:#9aa3b2;font-size:24px;line-height:1;cursor:pointer}
.modal-hd button:hover{color:#fff}
.modal-body{padding:18px 20px;max-height:66vh;overflow:auto}
.modal-ft{display:flex;align-items:center;gap:10px;padding:13px 20px;border-top:1px solid #e2e6ee;background:#fff}
.modal-ft #modalMsg{flex:1;font-size:12.5px;color:#5a6472}
.mbtn{background:#1f6feb;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-weight:600;font-size:13px;cursor:pointer}
.mbtn:hover{background:#175bd0}
.mbtn.ghost{background:#eceff4;color:#3a424f}
.mbtn.ghost:hover{background:#e2e6ee}
.mgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px 14px;margin-bottom:6px}
.mfield{display:flex;flex-direction:column;gap:3px}
.mfield.span2{grid-column:span 2}
.mfield label{font-size:10.5px;font-weight:700;letter-spacing:.4px;color:#6a7280;text-transform:uppercase}
.mfield input,.mfield select,.mfield textarea{border:1px solid #cfd5e0;border-radius:7px;padding:7px 9px;font-size:13px;font-family:inherit;background:#fff;color:#1a2230}
.mfield textarea{resize:vertical;min-height:44px}
.insp-sec{margin-top:14px}
.insp-sec h4{margin:0 0 6px;font-size:12px;letter-spacing:.5px;text-transform:uppercase;color:#26334a;font-weight:800;border-bottom:2px solid #26334a;padding-bottom:3px}
.insp-row{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #eceff4}
.insp-row .num{width:20px;color:#9aa3b2;font-size:11px;font-weight:700;text-align:right}
.insp-row .lbl{flex:1;font-size:12.5px;color:#1f2733}
.paf{display:flex;gap:4px}
.paf button{width:26px;height:24px;border:1px solid #cfd5e0;background:#fff;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;color:#8a929e}
.paf button.on[data-v=P]{background:#1e9e5a;border-color:#1e9e5a;color:#fff}
.paf button.on[data-v=A]{background:#d99017;border-color:#d99017;color:#fff}
.paf button.on[data-v=F]{background:#d1443b;border-color:#d1443b;color:#fff}
.paf button.on[data-v=NA]{background:#7a8595;border-color:#7a8595;color:#fff}
.li-table{width:100%;border-collapse:collapse;margin-top:6px}
.li-table th{font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#6a7280;text-align:left;padding:4px 6px;border-bottom:1px solid #d8dde6}
.li-table td{padding:3px 6px;border-bottom:1px solid #eceff4}
.li-table input{width:100%;border:1px solid #cfd5e0;border-radius:6px;padding:6px 7px;font-size:12.5px;font-family:inherit}
.li-table .num-in{text-align:right}
.li-table .li-x{color:#c04b43;cursor:pointer;font-weight:700;border:none;background:none;font-size:15px}
.li-add{margin-top:8px;background:#eef2f8;border:1px dashed #b8c2d4;color:#3a5891;border-radius:7px;padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer}
.li-tot{margin-top:12px;margin-left:auto;width:280px;font-size:13px}
.li-tot .r{display:flex;justify-content:space-between;padding:3px 0}
.li-tot .r.grand{border-top:2px solid #26334a;margin-top:5px;padding-top:6px;font-weight:800;font-size:15px;color:#12305a}
.li-tot input{width:64px;text-align:right;border:1px solid #cfd5e0;border-radius:5px;padding:3px 5px;font-size:12px}
.insp-done{color:#1e9e5a}
"""

reports=json.load(open(os.path.join(DATADIR,"reports.json"),encoding="utf-8"))
flags=json.load(open(os.path.join(DATADIR,"flags.json"),encoding="utf-8"))

_logo=_find_logo()
if _logo:
    logo="data:image/png;base64,"+base64.b64encode(open(_logo,"rb").read()).decode()
else:
    print("WARNING: no logo found; using a transparent placeholder", file=sys.stderr)
    logo="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"

gen=reports.get("generated") or dt.datetime.now().isoformat(timespec="seconds")
try: genlbl=dt.datetime.fromisoformat(gen).strftime("%b %-d, %-I:%M %p")
except Exception: genlbl=gen

HTML = r"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Autoport — Operations (View-Only)</title>
<style>__CSS__</style></head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand"><img src="__LOGO__" alt="Autoport" class="brandimg"/><div class="sub">Operations Dashboard</div></div>
    <nav class="nav" id="nav">
      <a data-page="reports" class="active"><svg viewBox="0 0 24 24"><path d="M4 13a8 8 0 0116 0"/><path d="M12 13l4-3"/><circle cx="12" cy="13" r="1.3"/><path d="M4 18h16"/></svg>Reports Status</a>
      <a data-page="tasks"><svg viewBox="0 0 24 24"><path d="M9 5h11M9 12h11M9 19h7"/><path d="M4 5l1.2 1.2L7 4M4 12l1.2 1.2L7 11"/></svg>Tasks</a>
      <a data-page="titles"><svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>Titles</a>
    </nav>
    <div class="side-foot"><span class="dot" style="background:var(--green)"></span><span>View-only snapshot</span></div>
  </aside>
  <main class="main">
    <header class="topbar">
      <div><h1 id="pageTitle">Reports Status</h1><div class="crumb" id="pageCrumb">The reports this system is running on</div></div>
      <div class="spacer"></div>
      <span class="pill" id="syncPill">Snapshot · __GEN__</span>
    </header>
    <div class="content">
      <section class="page active" id="page-reports"><div class="card"><table class="rtable" id="repTable"></table></div></section>
      <section class="page" id="page-tasks"><div id="flagGroups"></div></section>
      <section class="page" id="page-titles"><div id="titlesGroup"></div></section>
    </div>
  </main>
</div>
<script>
const SEED={reports:__SEED_REPORTS__, flags:__SEED_FLAGS__};
const Store={data:{reports:SEED.reports, flags:SEED.flags}};
const LS=(()=>{try{const s=window.localStorage;s.setItem("_t","1");s.removeItem("_t");return s;}
  catch(e){const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v);},removeItem:k=>{delete m[k];}};}})();
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function ago(iso){ if(!iso) return {txt:"",cls:"var(--faint)",date:"—"};
  const d=new Date(iso),days=Math.floor((Date.now()-d)/864e5);
  return {txt:days<=0?"today":days===1?"yesterday":days+"d ago",cls:days<=7?"var(--green)":days<=30?"var(--amber)":"var(--red)",
    date:d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"2-digit"})};}
/* ---- Reports Status (Type first, folder-sorted) ---- */
function renderReports(){
  const d=Store.data.reports; if(!d)return;
  const iRep=0,iPath=1,iType=2,iDate=3,iFile=4;
  const order=[iType,iRep,iPath,iDate,iFile];
  const head=["Type","Report","Drop Into Folder","Most Recent","Most Recent File"];
  let h="<thead><tr>"+head.map(x=>`<th>${x}</th>`).join("")+"</tr></thead><tbody>";
  const rows=[...d.rows].sort((a,b)=>String(a[iPath]||"").toLowerCase().localeCompare(String(b[iPath]||"").toLowerCase()));
  for(const r of rows){ h+="<tr>";
    order.forEach(i=>{const v=r[i];
      if(i===iType){const t=/month/i.test(v)?"month":"all";h+=`<td><span class="ttype ${t}">${esc(v)}</span></td>`;}
      else if(i===iRep)h+=`<td class="rname">${esc(v)}</td>`;
      else if(i===iPath)h+=`<td><div class="rpath" title="${esc(v)}">${esc(v)}</div></td>`;
      else if(i===iDate){const a=ago(v);h+=`<td><span class="fresh"><span class="dot" style="background:${a.cls}"></span><span class="fdate">${a.date}</span><span class="fago">${a.txt}</span></span></td>`;}
      else h+=`<td><div class="rfile" title="${esc(v)}">${esc(v)}</div></td>`;
    }); h+="</tr>"; }
  $("#repTable").innerHTML=h+"</tbody>";
}
/* ---- Flags (Tasks = Deals/Inventory, Titles = Titles); read-only, local mark-done hide ---- */
let HIDDEN=new Set(JSON.parse(LS.getItem("ap_hidden")||"[]"));
let showHiddenMode=false, titleAgeMin=0;
const GROUPS=[
  {key:"Deals",label:"Updates to Deals",color:"linear-gradient(135deg,#2aabe4,#0e7fb0)",icon:'<path d="M3 11l8-8 9 9-8 8z"/><circle cx="7.5" cy="7.5" r="1.4"/>'},
  {key:"Inventory",label:"Updates to Inventory",color:"linear-gradient(135deg,#6a5be0,#463ac0)",icon:'<path d="M3 13l2-4a2 2 0 012-1h8a2 2 0 012 1l2 4M5 13h14v4H5zM8 17v1M16 17v1"/>'},
  {key:"Titles",label:"Titles",color:"linear-gradient(135deg,#10a568,#0a7d4f)",icon:'<path d="M6 3h9l3 3v15H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>'},
];
function fkey(gk,si,ri){return "f"+gk+"-"+si+"-"+ri;}
function flagRow(s,gk,si,r,ri){
  const key=fkey(gk,si,ri),hid=HIDDEN.has(key),hdr=s.headers||[];
  const main=hdr.length>1&&r.length>1?`<div class="fs">${esc(r[0])} <small>· ${esc(r[1])}</small></div>`:`<div class="fs">${esc(r[0])}</div>`;
  let fld="";for(let ci=2;ci<r.length;ci++){if(r[ci]==="")continue;fld+=`<span class="ffield"><span class="lbl">${esc(hdr[ci]||"")}</span><b>${esc(r[ci])}</b></span>`;}
  return {hid,html:`<div class="frow ${hid&&!showHiddenMode?'hidden':''}" data-k="${key}"><div class="chk ${hid?'on':''}" data-chk="${key}"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg></div><div class="fmain">${main}${fld?`<div class="ffields">${fld}</div>`:""}</div></div>`};
}
function renderFlags(){
  const secs=(Store.data.flags&&Store.data.flags.sections)||[]; let mainHtml="",titlesHtml="",totalHidden=0;
  GROUPS.forEach(G=>{
    const gs=secs.filter(s=>(s.group||"Deals")===G.key); if(!gs.length)return;
    const full=G.key==="Titles"; let open=0;
    const cards=gs.map((s,si)=>{
      const ageIdx=(s.headers||[]).findIndex(h=>/deal age|days since/i.test(h));
      const rows=s.rows.map((r,ri)=>{
        if(G.key==="Titles"&&titleAgeMin>0&&ageIdx>=0){const a=parseInt(r[ageIdx]);if(!isNaN(a)&&a<titleAgeMin)return "";}
        const x=flagRow(s,G.key,si,r,ri); if(x.hid)totalHidden++;else open++; return x.html;}).join("");
      const info=s.desc?`<span class="info" title="${esc(s.desc)}">i</span>`:"";
      return `<div class="fcard"><div class="fcard-h"><span class="ft">${esc(s.title)}</span>${info}<span class="fn">${s.rows.length}</span></div><div class="frows ${full?'multi':''}">${rows}</div></div>`;
    }).join("");
    const ctl=G.key==="Titles"?`<select class="sel" id="titleAge">${[["0","Deal Age: all"],["30","30+ days"],["60","60+ days"],["90","90+ days"]].map(o=>`<option value="${o[0]}" ${+o[0]===titleAgeMin?'selected':''}>${o[1]}</option>`).join("")}</select>`:"";
    const block=`<div class="sec-head"><div class="chip" style="background:${G.color}"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">${G.icon}</svg></div><h2>${G.label}</h2><span class="count">${open} open</span><div class="rule"></div>${ctl}</div><div class="fgrid ${full?'full':''}">${cards}</div>`;
    if(G.key==="Titles")titlesHtml+=block; else mainHtml+=block;
  });
  if(totalHidden)mainHtml+=`<div style="text-align:center;margin-top:16px"><span class="linkish" id="showHidden">${showHiddenMode?'hide':'show'} ${totalHidden} completed</span></div>`;
  $("#flagGroups").innerHTML=mainHtml||'<div class="empty">No flagged items right now.</div>';
  const tg=$("#titlesGroup"); if(tg)tg.innerHTML=titlesHtml||'<div class="empty">No title items right now.</div>';
  const sh=$("#showHidden"); if(sh)sh.onclick=()=>{showHiddenMode=!showHiddenMode;renderFlags();};
  const ta=$("#titleAge"); if(ta)ta.onchange=()=>{titleAgeMin=+ta.value;renderFlags();};
}
/* local mark-done hide (view-only; nothing writes back) */
$(".content").addEventListener("click",e=>{const c=e.target.closest("[data-chk]"); if(!c)return;
  const k=c.dataset.chk; HIDDEN.has(k)?HIDDEN.delete(k):HIDDEN.add(k); LS.setItem("ap_hidden",JSON.stringify([...HIDDEN])); renderFlags();});
/* nav */
$("#nav").addEventListener("click",e=>{const a=e.target.closest("a[data-page]"); if(!a)return;
  $$("#nav a").forEach(x=>x.classList.remove("active")); a.classList.add("active");
  const p=a.dataset.page; $$(".page").forEach(x=>x.classList.remove("active")); document.getElementById("page-"+p).classList.add("active");
  $("#pageTitle").textContent=a.textContent.trim();
  $("#pageCrumb").textContent={reports:"The reports this system is running on",tasks:"Items flagged from your reports",titles:"Titles to send / receive"}[p]||"";});
renderReports(); renderFlags();
</script>
</body></html>"""

HTML=(HTML.replace("__CSS__",CSS).replace("__LOGO__",logo)
          .replace("__GEN__",genlbl)
          .replace("__SEED_REPORTS__",json.dumps(reports))
          .replace("__SEED_FLAGS__",json.dumps(flags)))
os.makedirs(OUTDIR,exist_ok=True)
outpath=os.path.join(OUTDIR,"index.html")
open(outpath,"w",encoding="utf-8").write(HTML)
print("view-only:",outpath,"|",len(HTML)//1024,"KB | report rows",len(reports.get("rows",[])),"| flag sections",len(flags.get("sections",[])))

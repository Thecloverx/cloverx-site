/* CloverX Member App: ระบบสอบในเมนู E-XAM (ตาม Figma: สมัครสอบ 9:319-9:886, ห้องสอบ X-Visor 54:11-96:1376, ห้องสอบ X-Lead 106:2-106:414)
   ใช้ API เดิมของระบบสอบ (/api/xv/*) ทั้งหมด ข้อสอบ คะแนน เวลา และการตรวจ คิดที่เซิร์ฟเวอร์ หน้านี้แสดงผลและส่งคำตอบเท่านั้น */
(function(){
var A=window.CXAPP; if(!A)return;
var $=function(s,r){return (r||document).querySelector(s);}, $$=function(s,r){return [].slice.call((r||document).querySelectorAll(s));};
var esc=A.esc, api=A.api, toast=A.toast, baht=A.baht;
var ACCT_NO='231-1-71119-1', ACCT_NAME='บริษัท โคลเวอร์เอ็กซ์ (ไทยแลนด์) จำกัด';
var COACHES=['โค้ชซิง','โค้ชนุ่น','โค้ชจา','โค้ชต๊ะ'];
var PN={visor:{1:'CloverX Ecosystem',2:'Xircle App & Band',3:'Habix & RoutineX',4:'โภชนาการและการโค้ช',5:'จรรยาบรรณและ PDPA'}};
var PASS=16, QPP=20;

/* ---------- ไอคอน (lucide ชุดเดียวกับ Figma) ---------- */
var I={
  back:'<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>', chevL:'<path d="m15 18-6-6 6-6"/>', chevD:'<path d="m6 9 6 6 6-6"/>',
  file:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  card:'<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
  copy:'<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  checkC:'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  check:'<path d="M20 6 9 17l-5-5"/>', clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  dl:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  lock:'<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  x:'<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>', pause:'<rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/>',
  alert:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'
};
function sv(n,s,col,w){ return '<svg width="'+s+'" height="'+s+'" viewBox="0 0 24 24" fill="none" stroke="'+(col||'currentColor')+'" stroke-width="'+(w||2)+'" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+I[n]+'</svg>'; }

/* ---------- วันที่ ---------- */
var THM=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'], THD=['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
function dp(iso){ var m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m?{y:+m[1],m:+m[2],d:+m[3]}:null; }
function thD(iso){ var p=dp(iso); return p?(p.d+' '+THM[p.m-1]+' '+(p.y+543)):'-'; }
function thWD(iso){ var p=dp(iso); if(!p)return '-'; var w=new Date(Date.UTC(p.y,p.m-1,p.d)).getUTCDay(); return THD[w]+' '+thD(iso); }
function hm(t){ var m=String(t||'').match(/(\d{1,2})[:.](\d{2})/); return m?(('0'+m[1]).slice(-2)+':'+m[2]):''; }
function slot(t){ var m=String(t||'').match(/(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})/); if(m)return ('0'+m[1]).slice(-2)+':'+m[2]+' - '+('0'+m[3]).slice(-2)+':'+m[4]+' น.'; var s=hm(t); return s?s+' น.':''; }
function when(r){ r=r||{}; var s=hm(r.timeslot)||'09:30'; return thWD(r.date)+' ('+s+' น.)'; }
function dtTH(ms){ if(!ms)return ''; var d=new Date(ms); if(isNaN(d))return ''; var t=('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)+' น.', now=new Date();
  if(d.toDateString()===now.toDateString())return 'วันนี้ '+t; return d.getDate()+' '+THM[d.getMonth()]+' '+(d.getFullYear()+543)+' '+t; }
function modeTH(m){ return m==='onsite'?'ณ ศูนย์สอบ (On Site)':'ออนไลน์ (Online)'; }
function isLead(t){ return /lead/i.test(String(t||'')); }
function kind(t){ return isLead(t)?'lead':'visor'; }
function exName(k){ return 'สอบวัดระดับการเป็น '+(k==='lead'?'X-Lead':'X-Visor'); }
function courseName(k){ return (k==='lead'?'X-Lead':'X-Visor')+' Examination'; }
function memCode(){ var m=A.me()||{}; return 'CLX-'+String(m.id||'').slice(-6).toUpperCase(); }
function tier(){ return (A.tier&&A.tier())||'PRE X-VISOR'; }
function pname(k,p){ var n=(PN[k]||{})[p]; return 'พาร์ต '+p+(n?': '+n:''); }

/* ---------- CSS ---------- */
var css=''
+'.xs{--ac:#2563eb;--acg:linear-gradient(90deg,#3b82f6,#1d4ed8);--acg2:linear-gradient(90deg,#2563eb,#1d4ed8);--acd:#1e293b;--acl:#dbeafe;--acl2:#eff6ff;--acb:#bfdbfe;--acs:rgba(37,99,235,.2);--bd:#e2e8f0;--ink:#1e293b;--mut:#64748b;'
+'min-height:100vh;min-height:100dvh;background:#f4f7fc;display:flex;flex-direction:column;color:var(--ink)}'
+'.xs.gold{--ac:#b1961d;--acg:linear-gradient(90deg,#92700c,#d4a017);--acg2:linear-gradient(90deg,#92700c,#d4a017);--acd:#451a03;--acl:#fdf3d0;--acl2:#fefaeb;--acb:#f3e5b5;--acs:rgba(217,119,6,.2);--bd:#e5e7eb}'
+'.xs.rm{background:#f8fafc;--ink:#0f172a;--mut:#475569}.xs.wh{background:#fff}'
+'.xs .top{flex:1}'
+'.xhd{position:sticky;top:0;z-index:10;background:#fff;border-bottom:1px solid var(--bd);height:56px;display:flex;align-items:center;gap:16px;padding:0 24px}'
+'.xhd .bk{width:32px;height:32px;border-radius:16px;background:#f4f7fc;display:grid;place-items:center;color:var(--acd);flex:none}'
+'.xs.gold .xhd .bk{background:#fff}'
+'.xhd h1{flex:1;margin:0;text-align:center;font-size:18px;font-weight:700;color:var(--acd);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
+'.xhd .sp{width:32px;flex:none}'
+'.xhd2{position:sticky;top:0;z-index:10;background:#fff;height:56px;display:flex;align-items:center;gap:12px;padding:0 20px 0 16px}'
+'.xhd2 .bk{width:32px;height:32px;border-radius:16px;display:grid;place-items:center;color:#0f172a;flex:none}'
+'.xhd2 h1{flex:1;margin:0;font-size:18px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
+'.xbot{position:sticky;bottom:0;z-index:9;background:#fff;border-top:1px solid var(--bd);border-radius:24px 24px 0 0;padding:24px 24px calc(20px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:12px}'
+'.xs.gold .xbot{border-top-color:#f3e5b5}.xs.rm .xbot{padding:16px 16px calc(16px + env(safe-area-inset-bottom));border-top:0}'
+'.xcta{height:52px;border-radius:26px;background:var(--acg);color:#fff;font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 6px var(--acs);width:100%;text-align:center;padding:0 16px}'
+'.xs.rm .xcta{height:48px;border-radius:24px;font-size:15px}'
+'.xcta:disabled{opacity:.5;box-shadow:none}'
+'.xcta.ol{background:#fff;color:var(--ac);border:1.5px solid var(--ac);box-shadow:none}'
+'.xrow2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.xrow2 .xcta{height:48px;border-radius:24px;font-size:15px}'
+'.xfoot{display:flex;justify-content:center;gap:6px;font-size:13px;color:var(--mut)}.xfoot a{color:var(--ac);font-weight:700}'
/* landing */
+'.xnav{background:#fff;display:flex;align-items:center;justify-content:space-between;padding:16px 24px}'
+'.xs.gold .xnav{border-bottom:1px solid #e5e7eb}'
+'.xlogo{display:flex;align-items:center;gap:6px;font-size:16px;font-weight:800;color:#1e3a8a}.xs.gold .xlogo{color:#451a03}'
+'.xlogo i{width:28px;height:28px;border-radius:8px;background:var(--acg);display:grid;place-items:center}'
+'.xnav .my{font-size:14px;font-weight:600;color:var(--ac);text-decoration:underline}'
+'.xsegw{background:#fff;padding:16px 24px}.xs.gold .xsegw{border-bottom:1px solid #e5e7eb}'
+'.xseg{background:#f4f7fc;height:44px;border-radius:12px;padding:4px;display:grid;grid-template-columns:1fr 1fr;gap:4px}'
+'.xs.gold .xseg{background:#fff;border:1px solid #e5e7eb;padding:3px}'
+'.xseg button{border-radius:8px;font-size:14px;font-weight:500;color:#64748b}.xs.gold .xseg button:not(.on){background:#f9fafb}'
+'.xseg button.on{background:#fff;color:var(--ac);font-weight:700;box-shadow:0 2px 2px rgba(0,0,0,.04)}.xs.gold .xseg button.on{box-shadow:0 2px 2px rgba(180,83,9,.12)}'
+'.xhero{background:var(--acg);padding:24px;display:flex;flex-direction:column;gap:12px;color:#fff}'
+'.xs.gold .xhero{background:linear-gradient(90deg,#b1961d,#e0cb57)}'
+'.xhero .bd{align-self:flex-start;background:rgba(255,255,255,.2);border-radius:100px;padding:4px 10px;font-size:12px;font-weight:700;letter-spacing:.02em}'
+'.xhero h2{margin:0;font-size:28px;font-weight:800;line-height:1.25;text-wrap:balance}.xs.gold .xhero h2{font-size:20px}'
+'.xhero p{margin:4px 0 0;font-size:16px;color:#e0f2fe;line-height:1.45}.xs.gold .xhero p{font-size:15px;color:#fef3c7}'
+'.xpad{padding:24px;display:flex;flex-direction:column;gap:20px}'
+'.xcard{background:#fff;border:1px solid var(--bd);border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:16px}'
+'.xrules summary{list-style:none;display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700;color:var(--ink);cursor:pointer}'
+'.xrules summary::-webkit-details-marker{display:none}.xrules summary .cv{margin-left:auto;transition:transform .2s;color:#64748b}.xrules[open] summary .cv{transform:rotate(180deg)}'
+'.xrules ul{margin:16px 0 0;padding:0 0 0 18px;display:flex;flex-direction:column;gap:10px;font-size:14px;color:#64748b;line-height:1.5}'
/* forms */
+'.xprog{height:4px;border-radius:2px;background:#e2e8f0;overflow:hidden}.xs.gold .xprog{background:#f3e5b5}.xprog i{display:block;height:100%;border-radius:2px;background:var(--acg)}'
+'.xf{display:flex;flex-direction:column;gap:6px}.xf>label,.xf>.lb{font-size:14px;font-weight:600;color:var(--acd)}.xf>label.op{font-weight:400}'
+'.xin{height:48px;border-radius:12px;border:1px solid var(--bd);background:#fff;padding:0 16px;font-size:14px;color:var(--ink);width:100%;outline:none;font-family:inherit}'
+'.xin::placeholder{color:#94a3b8}.xin:focus{border:1.5px solid var(--ac);padding:0 15.5px}.xin[readonly]{color:#9ca3af;font-weight:600}'
+'.xsel{position:relative}.xsel select{appearance:none;-webkit-appearance:none;padding-right:44px}.xsel select.on{border:1.5px solid var(--ac);font-weight:600}.xs.gold .xsel select.on{border-color:#bea32b}'
+'.xsel .cv{position:absolute;right:16px;top:15px;pointer-events:none;color:var(--ac)}.xsel select:not(.on)+.cv{color:#64748b}'
+'.xrad{display:flex;flex-direction:column;gap:8px}.xrad button{display:flex;align-items:center;gap:12px;padding:14px;border-radius:12px;border:1px solid var(--bd);background:#fff;font-size:14px;color:#64748b;text-align:left}'
+'.xrad button i{width:20px;height:20px;border-radius:10px;border:2px solid #94a3b8;flex:none;display:grid;place-items:center}'
+'.xrad button.on{border:1.5px solid var(--ac);padding:13.5px;font-weight:600;color:var(--ink)}.xrad button.on i{border-color:var(--ac)}.xrad button.on i:after{content:"";width:10px;height:10px;border-radius:5px;background:var(--acg)}'
+'.xrad button:disabled{opacity:.45}'
+'.xck{display:flex;gap:10px;align-items:flex-start;padding:8px 0;font-size:13px;color:#64748b;line-height:1.5;text-align:left}.xs.gold .xck{font-size:12px;color:#78350f}'
+'.xck i{width:20px;height:20px;border-radius:6px;border:2px solid #94a3b8;flex:none;display:grid;place-items:center;margin-top:0}.xck.on i{border:0;background:var(--acg);color:#fff}'
+'.xerr{color:#dc2626;font-size:13px;line-height:1.5}.xerr:empty{display:none}'
+'.xhint{font-size:12px;color:#94a3b8;line-height:1.5}'
/* payment */
+'.xsum{background:#fff;border:1px solid var(--bd);border-radius:16px;padding:16px;display:flex;align-items:center;gap:12px}'
+'.xsum .ic{width:40px;height:40px;border-radius:20px;background:#f4f7fc;display:grid;place-items:center;color:var(--ac);flex:none}'
+'.xsum .m{flex:1;min-width:0}.xsum b{display:block;font-size:14px;font-weight:600}.xsum small{display:block;font-size:12px;color:#64748b;margin-top:2px}'
+'.xsum .amt{font-size:18px;font-weight:800;background:var(--acg2);-webkit-background-clip:text;background-clip:text;color:transparent;white-space:nowrap}'
+'.xbank .hd{display:flex;align-items:center;gap:12px}.xbank .hd img{width:36px;height:36px;border-radius:8px;object-fit:contain}.xbank .hd b{display:block;font-size:15px}.xbank .hd small{display:block;font-size:12px;color:#64748b;margin-top:2px}'
+'.xhr{height:1px;background:var(--bd)}'
+'.xacc{display:flex;align-items:center;justify-content:space-between;gap:12px}.xacc small,.xkvs small{display:block;font-size:12px;color:#64748b}.xacc b{display:block;font-size:18px;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums;letter-spacing:.01em}'
+'.xcopy{display:flex;align-items:center;gap:4px;background:#f4f7fc;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;color:var(--ac)}'
+'.xkvs b{display:block;font-size:14px;font-weight:600;margin-top:2px}'
+'.xup{background:#fff;border:1px dashed var(--ac);border-radius:16px;padding:24px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;width:100%}'
+'.xup .ic{width:48px;height:48px;border-radius:24px;background:#f4f7fc;display:grid;place-items:center;color:var(--ac)}'
+'.xup b{font-size:14px;color:var(--ac)}.xup small{font-size:12px;color:#64748b}.xup img{max-width:100%;max-height:220px;border-radius:12px;border:1px solid var(--bd)}'
/* status / done */
+'.xok{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center}'
+'.xok .c{width:72px;height:72px;border-radius:36px;background:#e6f4ea;display:grid;place-items:center;margin-bottom:18px}.xok .c.big{width:80px;height:80px;border-radius:40px}'
+'.xok h2{margin:0;font-size:22px;font-weight:800}.xok p{margin:0;font-size:14px;color:#64748b;line-height:1.5}'
+'.xrowkv{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px}.xrowkv>span:first-child{color:#64748b;flex:none}.xrowkv>b,.xrowkv>span.v{font-weight:600;text-align:right}'
+'.xchip{background:#f4f7fc;border-radius:8px;padding:4px 10px;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}'
+'.xbdg{display:inline-flex;align-items:center;gap:4px;border-radius:100px;padding:6px 12px;font-size:12px;font-weight:700;white-space:nowrap}'
+'.xbdg i{width:8px;height:8px;border-radius:4px;background:currentColor}'
+'.xbdg.w{background:#fef3c7;color:#f59e0b}.xbdg.g{background:#e6f4ea;color:#10b981}.xbdg.r{background:#fee2e2;color:#dc2626}.xbdg.b{background:var(--acl);color:var(--ac)}.xbdg.m{background:#f1f5f9;color:#64748b}'
+'.xnote{background:#f8fafc;border-radius:12px;padding:14px;display:flex;gap:10px;align-items:center;font-size:13px;color:#64748b;line-height:1.5}'
+'.xinfo{background:var(--acl2);border:1px solid var(--acb);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:10px}'
+'.xinfo b{font-size:13px;color:var(--ac)}.xinfo small{display:block;font-size:11px;color:#64748b;margin-top:2px}'
+'.xinfo .bt{height:40px;border-radius:8px;background:var(--acg);color:#fff;font-size:13px;font-weight:700}.xinfo .bt:disabled{opacity:.5}'
+'.xinfo.row{flex-direction:row;align-items:flex-start;gap:12px;padding:15px}.xinfo.row b{font-size:14px}.xinfo.row p{margin:4px 0 0;font-size:13px;color:#64748b;line-height:1.4}'
+'.xbd2{padding:20px;display:flex;flex-direction:column;gap:20px}'
+'.xbc{background:#fff;border:1px solid var(--bd);border-radius:20px;padding:19px;display:flex;flex-direction:column;gap:12px}'
+'.xbc h3{margin:0;font-size:15px;font-weight:700}.xbc h3.s{font-size:14px}'
+'.xbc .nm{font-size:20px;font-weight:800;line-height:1.3}.xbc .sub{font-size:14px;color:#64748b}'
+'.xsteps{display:grid;grid-template-columns:repeat(6,1fr);gap:0}.xsteps div{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:10px;font-weight:500;text-align:center;line-height:1.25}'
+'.xsteps i{width:24px;height:24px;border-radius:12px;background:#e2e8f0;color:#64748b;font-size:11px;font-weight:700;font-style:normal;display:grid;place-items:center}'
+'.xsteps .d i{background:#10b981;color:#fff}.xsteps .c i{background:var(--acg2);color:#fff}.xsteps .c{color:var(--ac);font-weight:700}'
+'.xtl{display:flex;flex-direction:column;gap:14px}.xtl div{display:flex;gap:12px;align-items:center}'
+'.xtl i{width:32px;height:32px;border-radius:16px;display:grid;place-items:center;flex:none;background:#f4f7fc;color:#64748b}'
+'.xtl i.g{background:#e6f4ea;color:#10b981}.xtl i.w{background:#fef3c7;color:#d97706}.xtl b{display:block;font-size:14px;font-weight:600}.xtl small{display:block;font-size:12px;color:#64748b;margin-top:2px}'
/* ticket */
+'.xtk{background:#fff;border:1px solid var(--bd);border-radius:20px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.05)}'
+'.xtk .bn{background:var(--acg);padding:20px;display:flex;flex-direction:column;gap:12px;color:#fff}'
+'.xtk .bn .r1{display:flex;align-items:center;justify-content:space-between;gap:8px}.xtk .bn .r1 b{font-size:14px;font-weight:800;letter-spacing:.02em}'
+'.xtk .bn .bdg{display:inline-flex;align-items:center;gap:4px;background:#e6f4ea;color:#10b981;border-radius:100px;padding:4px 10px;font-size:11px;font-weight:700;white-space:nowrap}.xtk .bn .bdg i{width:6px;height:6px;border-radius:3px;background:#10b981}'
+'.xtk .bn .nm{font-size:20px;font-weight:800}.xtk .bn .no{font-size:13px;color:#93c5fd;margin-top:4px}.xs.gold .xtk .bn .no{color:#fef3c7}'
+'.xtk .qs{padding:32px;display:flex;flex-direction:column;align-items:center;gap:16px}'
+'.xtk .qb{width:180px;height:180px;border:1px solid var(--bd);border-radius:16px;padding:12px;background:#fff;display:grid;place-items:center}.xtk .qb canvas{width:100%;height:100%;image-rendering:pixelated}'
+'.xtk .qs small{font-size:12px;color:#64748b;text-align:center}'
+'.xtk .dv{border-top:1px dashed var(--bd)}.xtk .ins{background:#fafafa;padding:20px;text-align:center}.xtk .ins b{display:block;font-size:13px}.xtk .ins p{margin:4px 0 0;font-size:12px;color:#64748b;line-height:1.5}'
/* room shared */
+'.xpb{background:#fff;padding:16px;display:flex;align-items:center;gap:12px}'
+'.xav{width:44px;height:44px;border-radius:22px;background:#eff6ff;display:grid;place-items:center;flex:none;overflow:hidden}.xav img{width:100%;height:100%;object-fit:cover}'
+'.xav.big{width:72px;height:72px;border-radius:36px;border:2px solid var(--ac);background:#fff}'
+'.xpb b{display:block;font-size:15px;font-weight:700}.xpb small{display:block;font-size:12px;font-weight:600;margin-top:4px;background:var(--acg2);-webkit-background-clip:text;background-clip:text;color:transparent}'
+'.xlist{padding:16px;display:flex;flex-direction:column;gap:16px}.xlist>h3{margin:0;font-size:14px;font-weight:700;color:#475569}'
+'.xec{background:#fff;border:1.5px solid var(--ac);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:14px;box-shadow:0 2px 4px rgba(0,0,0,.04)}'
+'.xs.gold .xec{border-color:#d4a017}.xec.off{border:1px solid #e2e8f0}'
+'.xec.pass{background:#f2f7f2;border-color:#bddebd}'
+'.xec .r1{display:flex;align-items:center;justify-content:space-between;gap:8px}'
+'.xtag{border-radius:6px;padding:4px 8px;font-size:11px;font-weight:700;white-space:nowrap}.xtag.g{background:#ecfdf5;color:#10b981}.xtag.m{background:#f1f5f9;color:#64748b}.xtag.b{background:var(--acl);color:var(--ac)}.xtag.w{background:#fef3c7;color:#d97706}.xtag.r{background:#fee2e2;color:#dc2626}'
+'.xec .dur{display:flex;align-items:center;gap:4px;font-size:12px;color:#475569}'
+'.xec h4{margin:0;font-size:16px;font-weight:700}.xec .dt{font-size:13px;color:#475569;margin-top:6px}'
+'.xec .r3{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:13px;color:#94a3b8}'
+'.xec .go{background:var(--acg2);color:#fff;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700;white-space:nowrap}.xec .go:disabled{background:#e2e8f0;color:#94a3b8}'
+'.xec .gh{border:1px solid #475569;color:#475569;border-radius:6px;padding:5px 11px;font-size:12px;font-weight:500}'
+'.xempty2{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;text-align:center;font-size:14px;color:#64748b;line-height:1.6}'
+'.xvc{background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:20px;display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center}'
+'.xvc .nm{font-size:18px;font-weight:700}.xvc .id{font-size:13px;color:#475569;margin-top:6px}.xvc .k{font-size:12px;font-weight:700;color:var(--ac)}.xvc .ex{font-size:16px;font-weight:700;margin-top:4px}'
+'.xotp{display:flex;gap:8px;justify-content:center;position:relative}'
+'.xotp span{width:48px;height:52px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;display:grid;place-items:center;font-size:20px;font-weight:700;text-transform:uppercase}'
+'.xotp span.f{border:2px solid var(--ac)}.xotp span.cur{border:2px solid var(--ac);box-shadow:0 0 0 3px var(--acl)}.xotp span:empty:after{content:"";width:8px;height:2px;background:#94a3b8}'
+'.xotp input{position:absolute;inset:0;opacity:0;width:100%;font-size:16px}'
+'.xlbl{font-size:14px;font-weight:700;color:#475569}'
+'.xck2{display:flex;gap:10px;align-items:flex-start;font-size:10px;line-height:18px;color:#475569;text-align:left}.xck2 i{width:20px;height:20px;border-radius:4px;border:2px solid #94a3b8;flex:none;display:grid;place-items:center}.xck2.on i{border:0;background:var(--acg);color:#fff}'
+'.xrb{padding:16px;display:flex;flex-direction:column;gap:16px}'
+'.xrb .sb{background:var(--acl);border-radius:12px;padding:14px}.xrb .sb small{display:block;font-size:11px;font-weight:700;color:var(--ac)}.xrb .sb b{display:block;font-size:16px;margin-top:4px}'
+'.xrb .ic2{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:12px}.xrb .ic2 .l{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700}.xrb .ic2 .d{font-size:16px;font-weight:700}'
+'.xrl{display:flex;flex-direction:column;gap:12px}.xrl>b{font-size:14px;color:#475569}.xrl div{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px;display:flex;gap:12px;align-items:center;font-size:13px;line-height:18px}'
+'.xrl div i{width:24px;height:24px;border-radius:12px;background:var(--acl);color:var(--ac);font-size:12px;font-weight:700;font-style:normal;display:grid;place-items:center;flex:none}'
/* exam room */
+'.xtm{position:sticky;top:0;z-index:11;height:50px;padding:0 16px;background:var(--acg2);color:#fff;display:flex;align-items:center;justify-content:space-between;gap:8px}'
+'.xtm .l{display:flex;align-items:center;gap:8px}.xtm .l i{width:24px;height:24px;border-radius:12px;background:rgba(255,255,255,.12);display:grid;place-items:center}'
+'.xtm .t{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:.02em}.xtm .t.low{color:#fecaca}'
+'.xtm .r{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700}'
+'.xtm .pz{display:flex;align-items:center;gap:4px;background:rgba(255,255,255,.16);border-radius:14px;height:28px;padding:0 10px;font-size:12px;font-weight:700;color:#fff}'
+'.xrm{padding:12px 16px 16px;display:flex;flex-direction:column;gap:12px;flex:1;position:relative}'
+'.xpp{display:flex;align-items:center;gap:8px}.xpp button{width:20px;height:20px;border-radius:10px;background:#e2e8f0;color:#94a3b8;font-size:11px;font-weight:700;display:grid;place-items:center;flex:none}'
+'.xpp button.d,.xpp button.c{background:var(--acg2);color:#fff}.xpp button:disabled{cursor:default}.xpp em{flex:1;height:2px;border-radius:1px;background:#e2e8f0}.xpp em.d{background:var(--ac)}'
+'.xppl{display:grid;grid-template-columns:repeat(5,1fr);font-size:10px;font-weight:700;color:#94a3b8;text-align:center;margin-top:6px}.xppl .d{color:#475569}.xppl .c{color:var(--ac)}'
+'.xppw.rem .xppl{grid-template-columns:repeat(var(--n),1fr)}'
+'.xq{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:12px;box-shadow:0 8px 10px rgba(37,99,235,.08)}'
+'.xq .r1{display:flex;align-items:center;justify-content:space-between;gap:8px}.xq .r1 .l{display:flex;align-items:center;gap:8px}.xq .r1 .l b{font-size:13px;color:var(--ac)}'
+'.xq h3{margin:0;font-size:16px;font-weight:700;line-height:24px;color:#0f172a;user-select:none;-webkit-user-select:none}'
+'.xopts{display:flex;flex-direction:column;gap:8px}'
+'.xopts button{display:flex;align-items:center;gap:12px;padding:14px;border-radius:12px;border:1px solid var(--ac);background:#fff;text-align:left;font-size:14px;line-height:20px;color:#0f172a;user-select:none;-webkit-user-select:none}'
+'.xopts button em{width:24px;height:24px;border-radius:12px;display:grid;place-items:center;font-style:normal;font-size:16px;font-weight:700;color:var(--ac);flex:none}'
+'.xopts button.on{background:var(--acl)}.xopts button.on em{background:var(--acg2);color:#fff;font-size:14px}'
+'.xab{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:10px}'
+'.xab .r1{display:flex;align-items:center;justify-content:space-between}.xab .r1 b{font-size:14px}.xab .r1 .c{display:flex;gap:8px}'
+'.xab .r1 .c i{width:28px;height:28px;border-radius:14px;display:grid;place-items:center;font-size:11px;font-weight:700;font-style:normal;background:var(--acl);color:var(--ac)}.xab .r1 .c i.t{background:#fff;border:1px solid #e2e8f0;color:#94a3b8}'
+'.xab .g{display:grid;grid-template-columns:repeat(10,1fr);gap:6px;justify-items:center}'
+'.xab .g button{width:24px;height:24px;border-radius:12px;background:#edf0f2;border:1px solid #e2e8f0;color:#94a3b8;font-size:10px;font-weight:700;display:grid;place-items:center}'
+'.xab .g button.a{background:var(--acg2);border-color:transparent;color:#fff}.xab .g button.cur{box-shadow:0 0 0 2px #fff,0 0 0 4px var(--ac)}'
+'.xwm{position:absolute;inset:0;pointer-events:none;overflow:hidden;opacity:.05;font-size:14px;font-weight:700;color:#0f172a;display:flex;flex-wrap:wrap;align-content:flex-start;gap:48px 32px;padding:40px 8px;transform:rotate(-18deg);transform-origin:center}'
+'.xcf{background:#fff;border:1px solid #e2e8f0;border-radius:24px;padding:20px;display:flex;flex-direction:column;gap:16px;box-shadow:0 12px 16px rgba(15,23,42,.08)}'
+'.xcf .c{width:72px;height:72px;border-radius:36px;background:var(--acg2);display:grid;place-items:center;align-self:center}'
+'.xcf h2{margin:0;text-align:center;font-size:20px;font-weight:700}.xcf p.s{margin:-10px 0 0;text-align:center;font-size:14px;font-weight:500;color:#475569}'
+'.xcf .ps{display:flex;flex-direction:column;gap:8px}.xcf .ps div{border:1px solid var(--acb);border-radius:12px;padding:12px;display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:700}'
+'.xcf .ps span{display:flex;align-items:center;gap:6px;color:var(--ac)}.xcf .ps span.no{color:#dc2626}'
+'.xcf .ib{background:var(--acl);border-radius:12px;padding:12px;text-align:center;font-size:13px;font-weight:700;color:var(--ac);line-height:18px}'
+'.xchk{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:24px}'
+'.xring{position:relative;width:120px;height:120px}.xring svg{display:block}.xring b{position:absolute;inset:0;display:grid;place-items:center;font-size:24px;font-weight:700;color:var(--ac);font-variant-numeric:tabular-nums}'
+'.xchk h2{margin:0;font-size:22px;font-weight:700;text-align:center}.xchk p{margin:-16px 0 0;font-size:14px;color:#94a3b8}'
+'.xchk .ls{align-self:stretch;display:flex;flex-direction:column;gap:12px}'
+'.xchk .ls div{background:#fafafc;border:1px solid #e8ebf0;border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:12px;font-size:14px;font-weight:600;box-shadow:0 0 1px rgba(0,0,0,.03),0 2px 4px rgba(0,0,0,.06)}'
+'.xchk .ls div span{flex:1}.xchk .ls i{width:32px;height:32px;border-radius:16px;display:grid;place-items:center;flex:none;background:#f1f5f9}.xchk .ls i.d{background:var(--acl);color:var(--ac)}'
+'.xchk .ls i.a:after{content:"";width:16px;height:16px;border-radius:50%;border:3px solid var(--acl);border-top-color:var(--ac);animation:xsp .8s linear infinite}'
+'.xchk .ls i.w:after{content:"";width:8px;height:8px;border-radius:4px;background:#94a3b8}'
+'@keyframes xsp{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.xchk .ls i.a:after{animation:none}}'
+'.xres{padding:16px;display:flex;flex-direction:column;gap:16px}'
+'.xsc{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}'
+'.xsc .rg{position:relative;width:140px;height:140px}.xsc .rg .in{position:absolute;inset:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}'
+'.xsc .rg .in b{font-size:24px;font-weight:800;font-variant-numeric:tabular-nums}.xsc .rg .in i{width:40px;height:1px;background:#e2e8f0;margin:2px 0}.xsc .rg .in small{font-size:12px;color:#475569}'
+'.xsc h3{margin:0;font-size:16px;font-weight:700}.xsc p{margin:4px 0 0;font-size:13px;color:#94a3b8}'
+'.xpr{display:flex;flex-direction:column;gap:12px}.xpr>b{font-size:14px;color:#475569}'
+'.xpr .p{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:10px}'
+'.xpr .p .h{display:flex;justify-content:space-between;gap:8px;font-weight:700;font-size:14px}.xpr .p .h span:last-child{font-size:13px;font-variant-numeric:tabular-nums}'
+'.xpr .bar{height:8px;border-radius:4px;background:#f8fafc;overflow:hidden}.xpr .bar i{display:block;height:100%;border-radius:4px;background:var(--acg2)}'
+'.xpr .p.f .h span:last-child{color:#f04545}.xpr .p.f .bar i{background:#f04545}.xpr .p .ft{font-size:11px;font-weight:700;color:#f04545}.xpr .p .ft.w{color:#d97706}'
+'.xres .nt{font-size:12px;color:#94a3b8;text-align:center;line-height:1.6}'
+'.xpause{position:fixed;inset:0;z-index:60;background:rgba(15,23,42,.72);display:grid;place-items:center;padding:24px}'
+'.xpause .bx{background:#fff;border-radius:24px;padding:24px;width:100%;max-width:340px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center}'
+'.xpause h3{margin:0;font-size:18px}.xpause .tv{font-size:40px;font-weight:800;color:var(--ac);font-variant-numeric:tabular-nums}.xpause p{margin:0;font-size:13px;color:#64748b;line-height:1.6}'
+'.xblur{position:fixed;inset:0;z-index:55;background:rgba(15,23,42,.92);color:#fff;display:none;place-items:center;text-align:center;padding:32px;font-size:15px;line-height:1.7}.xblur.on{display:grid}'
+'@media(max-width:360px){.xotp{gap:6px}.xotp span{width:42px;height:48px}.xab .g{gap:4px}.xab .g button{width:22px;height:22px}.xhero h2{font-size:25px}.xsteps div{font-size:9px}}';
var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

/* ---------- ข้อมูล ---------- */
var EX=null, exAt=0;
function loadEx(force){ if(EX&&!force&&Date.now()-exAt<10000)return Promise.resolve(EX);
  return api('/api/m/exams').then(function(j){ if(j._s===401){ A.logout(); throw new Error('auth'); } if(!j.ok)throw new Error('fail'); EX=j; exAt=Date.now(); return j; }); }
function regOf(no){ return ((EX&&EX.registrations)||[]).filter(function(r){return r.regNo===no;})[0]; }
function phone(){ return (A.me()||{}).phone||''; }
var ROUNDS=null;
function loadRounds(){ return api('/api/xv/reg/rounds').then(function(j){ ROUNDS=(j&&j.rounds)||[]; return ROUNDS; }); }
var RG={};  /* แบบร่างใบสมัคร */
function rgReset(k){ RG={k:k,mode:'',roundId:'',coach:'',coachOther:'',ref:'',email:(A.me()||{}).email||'',consent:false,slip:'',slipName:'',lead:null,leadPhone:phone()}; }
function view(id){ return $('#v-'+id); }
function shell(id,cls,html){ var v=view(id); v.className='view xs '+(cls||'')+(v.classList.contains('hide')?' hide':''); v.innerHTML=html; return v; }
function hd(title,back){ return '<div class="xhd">'+(back?'<a class="bk" href="'+back+'" aria-label="กลับ">'+sv('back',16)+'</a>':'<span class="sp"></span>')+'<h1>'+esc(title)+'</h1><span class="sp"></span></div>'; }
function hd2(title,back){ return '<div class="xhd2"><a class="bk" href="'+back+'" aria-label="กลับ">'+sv('chevL',16,'#0f172a',2.2)+'</a><h1>'+esc(title)+'</h1></div>'; }
function loading(id,cls,title,back){ shell(id,cls,hd(title,back)+'<div class="xpad"><div class="xempty2">กำลังโหลด…</div></div>'); }
function failView(id,cls,title,back,msg){ shell(id,cls,hd(title,back)+'<div class="xpad"><div class="xempty2">'+(msg||'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่')+'</div></div>'); }
function avatar(big){ var m=A.me()||{}; return '<span class="xav'+(big?' big':'')+'">'+(m.avatar?'<img src="'+esc(m.avatar)+'" alt="">':(A.clover?A.clover(big?40:26):''))+'</span>'; }
function copyAcct(){ try{ navigator.clipboard.writeText(ACCT_NO.replace(/-/g,'')); toast('คัดลอกเลขบัญชีแล้ว'); }catch(e){ toast(ACCT_NO); } }

/* ---------- 9:319 / 9:835 หน้าแรกสมัครสอบ ---------- */
function renderLanding(k){ k=k==='lead'?'lead':'visor'; if(!RG.k||RG.k!==k)rgReset(k);
  var gold=k==='lead';
  var h='<div class="top"><div class="xnav"><span class="xlogo"><i>'+(A.clover?A.clover(16,'#fff'):'')+'</i>CloverX E-xam</span><a class="my" href="#exam">การสมัครของฉัน</a></div>'
    +'<div class="xsegw"><div class="xseg" role="tablist"><button type="button" role="tab" class="'+(gold?'':'on')+'" data-k="visor">X-Visor</button><button type="button" role="tab" class="'+(gold?'on':'')+'" data-k="lead">X-Lead</button></div></div>';
  if(!gold){
    h+='<div class="xhero"><span class="bd">OPEN REGISTRATION</span><div><h2>ลงทะเบียนสอบ X-Visor</h2><p><span class="ln">เริ่มต้นการเป็นผู้ขาย</span> <span class="ln">และยกระดับมาตรฐานความรู้ของคุณกับเรา</span></p></div></div>'
      +'<div class="xpad"><details class="xcard xrules" open><summary>'+sv('file',20,'#2563eb')+'กติกาการสอบ X-Visor<span class="cv">'+sv('chevD',16)+'</span></summary><ul><li>ข้อสอบ 5 พาร์ต พาร์ตละ 20 ข้อ</li><li>ต้องได้ 16/20 คะแนนขึ้นไปทุกพาร์ต</li><li>สิทธิ์สอบซ่อมฟรี 2 ครั้งต่อพาร์ต</li><li>ค่าธรรมเนียมสมัครตามรอบที่เลือก</li></ul></details></div></div>'
      +'<div class="xbot"><a class="xcta" href="#xrform/visor">เริ่มลงทะเบียน</a><div class="xfoot">ติดต่อสอบถามเพิ่มเติม <a href="'+A.LINE+'" target="_blank" rel="noopener">LINE @cloverxth</a></div></div>';
  } else {
    var L=RG.lead;
    h+='<div class="xhero"><span class="bd">สำหรับผู้ผ่านระดับ X-Visor เท่านั้น</span><div><h2>ลงทะเบียนสอบเลื่อนระดับ X-Lead</h2><p><span class="ln">ก้าวสำคัญสู่ความเป็นผู้นำ</span> <span class="ln">และเพิ่มศักยภาพสูงสุดให้กับสายงานคุณ</span></p></div></div>'
      +'<div class="xpad"><div class="xf"><label for="xlPh" style="font-weight:700">เบอร์โทรศัพท์ที่เคยสมัคร X-Visor *</label><input class="xin" id="xlPh" inputmode="tel" value="'+esc(RG.leadPhone||'')+'" style="border-width:1.5px"></div>'
      +'<button type="button" class="xcta" id="xlGo" style="height:48px;border-radius:24px;font-size:15px;margin-top:-8px">ตรวจสอบสิทธิ์สมัคร X-Lead</button>'
      +(L?(L.ok?'<div class="xinfo row" style="background:#ecfdf5;border-color:#a7f3d0"><span style="width:36px;height:36px;border-radius:18px;background:#d1fae5;display:grid;place-items:center;flex:none">'+sv('checkC',20,'#059669')+'</span><div><b style="color:#065f46;font-weight:800">'+esc(L.name)+' (ผ่านสิทธิ์แล้ว)</b><p style="color:#047857;font-size:12px;margin-top:2px">คุณสมบัติผ่านเกณฑ์การสมัครสอบเลื่อนระดับ X-Lead</p></div></div>'
        :'<div class="xinfo row" style="background:#fef2f2;border-color:#fecaca"><span style="width:36px;height:36px;border-radius:18px;background:#fee2e2;display:grid;place-items:center;flex:none">'+sv('x',20,'#dc2626')+'</span><div><b style="color:#991b1b;font-weight:800">'+esc(L.msg)+'</b><p style="color:#b91c1c;font-size:12px;margin-top:2px"><span class="ln">หากคิดว่าข้อมูลไม่ถูกต้อง</span> <span class="ln">ติดต่อทีมงานทาง LINE @cloverxth</span></p></div></div>'):'')
      +'</div></div><div class="xbot"><a class="xcta'+(L&&L.ok?'':' dis')+'" id="xlNext" href="#xrform/lead"'+(L&&L.ok?'':' aria-disabled="true" style="opacity:.5;pointer-events:none;box-shadow:none"')+'>ดำเนินการกรอกใบสมัครต่อ</a></div>';
  }
  var v=shell('xr',gold?'gold':'',h);
  $$('[data-k]',v).forEach(function(b){ b.onclick=function(){ location.replace('#xr/'+b.dataset.k); }; });
  var go=$('#xlGo',v); if(go)go.onclick=function(){ var ph=$('#xlPh').value.replace(/\D/g,'').replace(/^66(?=[689]\d{8}$)/,'0'); RG.leadPhone=ph;
    if(!/^0[689]\d{8}$/.test(ph)){ RG.lead={ok:false,msg:'กรุณากรอกเบอร์มือถือ 10 หลัก'}; renderLanding('lead'); return; }
    go.disabled=true; go.textContent='กำลังตรวจสอบ…';
    Promise.all([api('/api/xv/reg/xlead-lookup?phone='+encodeURIComponent(ph)),loadEx(true).catch(function(){return null;})]).then(function(r){ var j=r[0], acc=(EX&&EX.access)||{};
      var mine=ph.slice(-9)===phone().replace(/\D/g,'').slice(-9);
      if(j&&j.ok&&(j.passedXVisor||(mine&&acc.lead))) RG.lead={ok:true,name:((j.firstName||'')+' '+(j.lastName||'')).trim(),emailMasked:j.emailMasked||'',coach:j.coachTeam||'',ref:j.referrer&&j.referrer!=='-'?j.referrer:''};
      else if(j&&j.ok) RG.lead={ok:false,msg:'ยังไม่พบผลสอบผ่าน X-Visor ของเบอร์นี้'};
      else RG.lead={ok:false,msg:'ไม่พบการสมัครสอบ X-Visor ของเบอร์นี้'};
      if(RG.lead.ok){ RG.coach=RG.lead.coach; if(RG.coach&&COACHES.indexOf(RG.coach)<0){ RG.coachOther=RG.coach; RG.coach='อื่นๆ'; } RG.ref=RG.lead.ref; RG.email=''; }
      renderLanding('lead'); }).catch(function(){ go.disabled=false; go.textContent='ตรวจสอบสิทธิ์สมัคร X-Lead'; toast('เชื่อมต่อไม่สำเร็จ'); }); };
}

/* ---------- 9:366 / 9:886 ใบสมัคร ---------- */
function renderForm(k){ k=k==='lead'?'lead':'visor'; if(RG.k!==k)rgReset(k);
  if(k==='lead'&&!(RG.lead&&RG.lead.ok)){ location.replace('#xr/lead'); return; }
  loading('xrform',k==='lead'?'gold':'',k==='lead'?'ใบสมัคร X-Lead':'ลงทะเบียนสอบ X-Visor','#xr/'+k);
  loadRounds().then(function(){ paintForm(k); }).catch(function(){ failView('xrform',k==='lead'?'gold':'','ลงทะเบียนสอบ','#xr/'+k); }); }
function roundsFor(k,mode){ return (ROUNDS||[]).filter(function(r){ return kind(r.examType)===k&&(!mode||(r.mode||'online')===mode); }); }
function roundLabel(r){ return 'รอบที่ '+(r.no||'-')+' : '+when(r)+(r.full?(r.waitlist?' (สำรอง)':' (เต็ม)'):''); }
function paintForm(k){ var gold=k==='lead', all=roundsFor(k), modes={online:0,onsite:0}; all.forEach(function(r){ modes[r.mode||'online']++; });
  if(!RG.mode) RG.mode=modes.online?'online':(modes.onsite?'onsite':'online');
  var list=roundsFor(k,RG.mode); if(RG.roundId&&!list.some(function(r){return r.id===RG.roundId;}))RG.roundId='';
  if(!RG.roundId&&list.length===1&&!list[0].full)RG.roundId=list[0].id;
  var sel=list.filter(function(r){return r.id===RG.roundId;})[0], fee=sel?(sel.fee||500):0, m=A.me()||{};
  var h='<div class="top">'+hd(gold?'ใบสมัคร X-Lead':'ลงทะเบียนสอบ X-Visor','#xr/'+k)+'<div class="xpad" style="background:'+(gold?'#fff':'transparent')+'"><div class="xprog"><i style="width:'+(gold?'56':'34')+'%"></i></div>';
  if(!gold){
    h+='<div class="xf"><label>ชื่อจริง *</label><input class="xin" value="'+esc(m.firstName||'')+'" readonly></div>'
      +'<div class="xf"><label>นามสกุล *</label><input class="xin" value="'+esc(m.lastName||'')+'" readonly></div>'
      +'<div class="xf"><label>เบอร์โทรศัพท์ *</label><input class="xin" value="'+esc(m.phone||'')+'" readonly></div>'
      +'<div class="xf"><label for="xfEm">อีเมลสำหรับจัดส่งใบกำกับภาษี *</label><input class="xin" id="xfEm" type="email" inputmode="email" value="'+esc(RG.email)+'" autocomplete="email"></div>';
  } else {
    h+='<div class="xf"><label>ชื่อ-นามสกุล</label><input class="xin" value="'+esc(RG.lead.name+' (ผ่านสิทธิ์แล้ว)')+'" readonly></div>'
      +'<div class="xf"><label for="xfEm">อีเมลสำหรับจัดส่งใบกำกับภาษี *</label><input class="xin" id="xfEm" type="email" inputmode="email" value="'+esc(RG.email)+'" placeholder="'+esc(RG.lead.emailMasked||'อีเมล')+'"><span class="xhint">เว้นว่างไว้เพื่อใช้อีเมลเดิมที่เคยสมัคร X-Visor</span></div>';
  }
  h+='<div class="xf"><span class="lb">รูปแบบการสอบ *</span><div class="xrad">'
    +'<button type="button" data-md="online" class="'+(RG.mode==='online'?'on':'')+'"'+(modes.online?'':' disabled')+'><i></i>สอบออนไลน์ผ่านระบบเสมือน'+(modes.online?'':' (ยังไม่เปิดรอบ)')+'</button>'
    +'<button type="button" data-md="onsite" class="'+(RG.mode==='onsite'?'on':'')+'"'+(modes.onsite?'':' disabled')+'><i></i>สอบ ณ ศูนย์สอบ (On Site)'+(modes.onsite?'':' (ยังไม่เปิดรอบ)')+'</button></div></div>'
    +'<div class="xf"><label for="xfRd">'+(gold?'เลือกรอบการสอบ X-Lead ที่ต้องการ *':'เลือกรอบการสอบที่ต้องการ *')+'</label><div class="xsel"><select class="xin'+(RG.roundId?' on':'')+'" id="xfRd"><option value="">'+(list.length?'เลือกรอบการสอบ':'ยังไม่เปิดรับสมัครรอบนี้')+'</option>'
    +list.map(function(r){ return '<option value="'+esc(r.id)+'"'+(r.id===RG.roundId?' selected':'')+(r.full&&!r.waitlist?' disabled':'')+'>'+esc(roundLabel(r))+'</option>'; }).join('')+'</select><span class="cv">'+sv('chevD',18)+'</span></div>'
    +(sel&&RG.mode==='onsite'&&sel.venue?'<span class="xhint">สถานที่สอบ: '+esc(sel.venue)+'</span>':'')+'</div>'
    +'<div class="xf"><label for="xfCo" class="op">'+(gold?'ผู้ฝึกสอน / โค้ชทีมผู้แนะนำ':'เลือกโค้ชทีม')+'</label><div class="xsel"><select class="xin" id="xfCo" style="'+(RG.coach?'font-weight:600;color:var(--acd)':'color:#64748b')+'"><option value="">ไม่ระบุโค้ช</option>'+COACHES.map(function(c){ return '<option'+(RG.coach===c?' selected':'')+'>'+c+'</option>'; }).join('')+'<option value="อื่นๆ"'+(RG.coach==='อื่นๆ'?' selected':'')+'>อื่น ๆ</option></select><span class="cv">'+sv('chevD',18)+'</span></div></div>'
    +(RG.coach==='อื่นๆ'?'<div class="xf"><label for="xfCo2">ชื่อโค้ชทีม *</label><input class="xin" id="xfCo2" value="'+esc(RG.coachOther)+'" placeholder="พิมพ์ชื่อโค้ชทีม"></div>':'')
    +'<div class="xf"><label for="xfRf" class="op">'+(gold?'ระบุผู้แนะนำอื่นๆ (ถ้ามี)':'ระบุผู้แนะนำ (ถ้ามี)')+'</label><input class="xin" id="xfRf" value="'+esc(RG.ref)+'" placeholder="ชื่อผู้แนะนำ หรือ รหัสสมาชิก" maxlength="80"></div>'
    +'<button type="button" class="xck'+(RG.consent?' on':'')+'" id="xfCk" role="checkbox" aria-checked="'+(RG.consent?'true':'false')+'"><i>'+(RG.consent?sv('check',12,'#fff',3):'')+'</i><span>'+(gold?'ข้าพเจ้ายอมรับเงื่อนไขและข้อตกลงการสมัครสอบเลื่อนระดับ X-Lead':'ข้าพเจ้ายอมรับเงื่อนไขและข้อตกลงการสมัครสอบ')+'</span></button>'
    +'<div class="xerr" id="xfErr"></div></div></div>'
    +'<div class="xbot"><button type="button" class="xcta" id="xfGo">'+(fee?'ลงทะเบียนและชำระเงิน — '+baht(fee)+' บาท':'ลงทะเบียนและชำระเงิน')+'</button></div>';
  var v=shell('xrform',gold?'gold':'',h);
  var keep=function(){ var e=$('#xfEm',v); if(e)RG.email=e.value.trim(); var r=$('#xfRf',v); if(r)RG.ref=r.value.trim(); var c2=$('#xfCo2',v); if(c2)RG.coachOther=c2.value.trim(); };
  $$('[data-md]',v).forEach(function(b){ b.onclick=function(){ keep(); RG.mode=b.dataset.md; RG.roundId=''; paintForm(k); }; });
  $('#xfRd',v).onchange=function(){ keep(); RG.roundId=this.value; paintForm(k); };
  $('#xfCo',v).onchange=function(){ keep(); RG.coach=this.value; paintForm(k); };
  $('#xfCk',v).onclick=function(){ keep(); RG.consent=!RG.consent; paintForm(k); };
  $('#xfGo',v).onclick=function(){ keep(); var err='';
    if(k==='visor'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(RG.email))err='กรุณากรอกอีเมลให้ถูกต้อง';
    else if(k==='lead'&&RG.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(RG.email))err='อีเมลไม่ถูกต้อง หรือเว้นว่างไว้เพื่อใช้อีเมลเดิม';
    else if(!RG.roundId)err='กรุณาเลือกรอบการสอบ';
    else if(RG.coach==='อื่นๆ'&&!RG.coachOther)err='กรุณาระบุชื่อโค้ชทีม';
    else if(!RG.consent)err='กรุณายอมรับเงื่อนไขการสมัครสอบ';
    if(err){ $('#xfErr',v).textContent=err; return; }
    location.hash='#xrpay'; };
}

/* ---------- 9:432 ชำระเงิน ---------- */
function renderPay(){ var k=RG.k; if(!k||!RG.roundId){ location.replace('#xr/visor'); return; }
  var r=(ROUNDS||[]).filter(function(x){return x.id===RG.roundId;})[0]; if(!r){ location.replace('#xrform/'+k); return; }
  var gold=k==='lead', fee=r.fee||500;
  var h='<div class="top">'+hd('ชำระเงิน','#xrform/'+k)+'<div class="xpad">'
    +'<div class="xsum"><span class="ic">'+sv('card',20)+'</span><span class="m"><b>ยอดชำระทั้งหมด</b><small>รวมค่าธรรมเนียมสอบ'+(r.mode==='onsite'?' On Site':'ออนไลน์ (Online)')+'</small></span><span class="amt">'+baht(fee)+' บาท</span></div>'
    +'<div class="xcard xbank"><div class="hd"><img src="/xr-kbank.png" alt=""><div><b>ธนาคารกสิกรไทย (KBank)</b><small>โอนผ่าน Mobile Banking หรือ ตู้ ATM</small></div></div><div class="xhr"></div>'
    +'<div class="xacc"><div><small>เลขที่บัญชี</small><b>'+ACCT_NO+'</b></div><button type="button" class="xcopy" id="xpCp">'+sv('copy',14)+'คัดลอก</button></div>'
    +'<div class="xkvs"><small>ชื่อบัญชี</small><b>'+ACCT_NAME+'</b></div></div>'
    +'<div class="xf"><span class="lb">แนบสลิปการโอนเงิน</span><button type="button" class="xup" id="xpUp">'+(RG.slip&&/^data:image/.test(RG.slip)?'<img src="'+RG.slip+'" alt="สลิปที่แนบ"><b>เปลี่ยนไฟล์</b>':'<span class="ic">'+sv('upload',24)+'</span><b>'+(RG.slip?esc(RG.slipName||'แนบไฟล์แล้ว')+' (เปลี่ยนไฟล์)':'อัปโหลดไฟล์หลักฐาน')+'</b><small>รองรับไฟล์ PNG, JPG หรือ PDF ไม่เกิน 5MB</small>')+'</button></div>'
    +'<div class="xerr" id="xpErr"></div></div></div>'
    +'<div class="xbot"><button type="button" class="xcta" id="xpGo"'+(RG.slip?'':' disabled')+'>ยืนยันการชำระเงิน</button></div>';
  var v=shell('xrpay',gold?'gold':'',h);
  $('#xpCp',v).onclick=copyAcct;
  $('#xpUp',v).onclick=function(){ var f=document.createElement('input'); f.type='file'; f.accept='image/png,image/jpeg,image/webp,application/pdf';
    f.onchange=function(){ var file=f.files[0]; if(!file)return; if(file.size>5*1024*1024){ $('#xpErr').textContent='ไฟล์ใหญ่เกิน 5MB'; return; }
      var rd=new FileReader(); rd.onload=function(){ var d=rd.result;
        if(/^data:application\/pdf/.test(d)){ RG.slip=d; RG.slipName=file.name; renderPay(); return; }
        var im=new Image(); im.onload=function(){ var s=Math.min(1,1600/Math.max(im.width,im.height)), c=document.createElement('canvas'); c.width=Math.round(im.width*s); c.height=Math.round(im.height*s); c.getContext('2d').drawImage(im,0,0,c.width,c.height); RG.slip=c.toDataURL('image/jpeg',.85); RG.slipName=file.name; renderPay(); };
        im.onerror=function(){ $('#xpErr').textContent='เปิดไฟล์ไม่ได้ กรุณาเลือกไฟล์อื่น'; }; im.src=d; };
      rd.readAsDataURL(file); };
    f.click(); };
  $('#xpGo',v).onclick=function(){ var b=this, m=A.me()||{}; b.disabled=true; b.textContent='กำลังส่งข้อมูล…';
    var body={ phone:m.phone, roundId:RG.roundId, coachTeam:RG.coach==='อื่นๆ'?RG.coachOther:RG.coach, referrer:RG.ref||'-', consentTerms:true, consentPdpa:true, slipImage:RG.slip, from:'app' };
    if(k==='visor'){ body.firstName=m.firstName; body.lastName=m.lastName; body.email=RG.email; body.taxEmail=RG.email; }
    else { body.firstName=''; body.lastName=''; body.email=RG.email||''; body.taxEmail=RG.email||''; body.phone=RG.leadPhone||m.phone; }
    api('/api/xv/register',{method:'POST',body:body}).then(function(j){
      if(j.ok||(j.error==='already_registered'&&j.regNo)){ var no=j.regNo; rgReset(k); EX=null; location.hash='#xrdone/'+no; return; }
      b.disabled=false; b.textContent='ยืนยันการชำระเงิน';
      $('#xpErr').textContent={round_full:'รอบนี้เต็มแล้ว กรุณาเลือกรอบอื่น',round_closed:'รอบนี้ปิดรับสมัครแล้ว',round_not_found:'ไม่พบรอบสอบนี้ กรุณาเลือกใหม่',image_too_big:'ไฟล์สลิปใหญ่เกินไป',bad_slip_format:'ไฟล์สลิปไม่ถูกต้อง ใช้ PNG JPG หรือ PDF',bad_phone:'เบอร์โทรศัพท์ไม่ถูกต้อง',already_registered:'เบอร์นี้สมัครรอบนี้ไว้แล้ว',missing_email:'กรุณากรอกอีเมล'}[j.error]||'ส่งใบสมัครไม่สำเร็จ กรุณาลองใหม่ หรือติดต่อ LINE @cloverxth';
    }).catch(function(){ b.disabled=false; b.textContent='ยืนยันการชำระเงิน'; $('#xpErr').textContent='เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่'; }); };
}

/* ---------- สถานะใบสมัคร ---------- */
var STB={PENDING_PAYMENT:['รอชำระเงิน','w'],PAYMENT_REVIEW:['รอตรวจสลิป','w'],WAITLISTED:['รายชื่อสำรอง','w'],CONFIRMED:['ยืนยันการจองแล้ว','g'],CHECKED_IN:['เช็กอินแล้ว','g'],EXAM_STARTED:['เข้าสอบแล้ว','b'],TRANSFERRED_TO_EXAM:['เข้าสอบแล้ว','b'],COMPLETED:['สอบเสร็จแล้ว','g'],REJECTED:['สลิปไม่ผ่าน','r'],CANCELLED:['ยกเลิกแล้ว','r'],REFUNDED:['คืนเงินแล้ว','m'],PARTIALLY_REFUNDED:['คืนเงินแล้ว','m'],NO_SHOW:['ไม่ได้เข้าสอบ','m'],DRAFT:['ยังไม่ส่งใบสมัคร','m']};
var PAIDS=['CONFIRMED','CHECKED_IN','EXAM_STARTED','COMPLETED','TRANSFERRED_TO_EXAM'];
function badge(s,dot){ var b=STB[s]||[s||'-','m']; return '<span class="xbdg '+b[1]+'">'+(dot?'<i></i>':'')+esc(b[0])+'</span>'; }
function regStatus(no){ return api('/api/xv/reg/status?regNo='+encodeURIComponent(no)+'&phone='+encodeURIComponent(phone())); }
function kvRow(k,v,bold){ return '<div class="xrowkv"><span>'+esc(k)+'</span>'+(bold?'<b style="font-weight:700">':'<b>')+esc(v)+'</b></div>'; }

/* 9:486 ลงทะเบียนสำเร็จ */
function renderDone(no){ var cls=''; loading('xrdone',cls,'สถานะการลงทะเบียน','');
  regStatus(no).then(function(j){ if(!j.ok){ failView('xrdone','','สถานะการลงทะเบียน','#exam','ไม่พบใบสมัครนี้'); return; }
    var k=kind(j.examType), r=j.round||{}, gold=k==='lead';
    var h='<div class="top">'+hd('สถานะการลงทะเบียน','')+'<div class="xpad" style="gap:24px"><div class="xok"><span class="c">'+sv('checkC',36,'#10b981')+'</span><h2>ลงทะเบียนสำเร็จ!</h2><p>'+(j.status==='PAYMENT_REVIEW'?'ระบบได้รับข้อมูลและสลิปการโอนเงินของท่านแล้ว':(j.status==='WAITLISTED'?'<span class="ln">รอบนี้เต็มแล้ว</span> <span class="ln">ท่านอยู่ในรายชื่อสำรอง</span>':'ระบบได้รับข้อมูลของท่านแล้ว'))+'</p></div>'
      +'<div class="xcard"><div class="xrowkv"><span>หมายเลขลงทะเบียน</span><span class="xchip">'+esc(j.regNo)+'</span></div><div class="xhr"></div>'
      +'<div class="xrowkv"><span>สถานะการชำระเงิน</span>'+badge(j.status,true)+'</div><div class="xhr"></div>'
      +'<div style="display:flex;flex-direction:column;gap:12px">'+kvRow('หลักสูตร',courseName(k))+kvRow('รอบการสอบ',when(r))+kvRow('รูปแบบการสอบ',modeTH(j.mode||r.mode))+'</div></div>'
      +(PAIDS.indexOf(j.status)<0?'<div class="xnote">'+sv('clock',18,'#64748b')+'<span><span class="ln">ทีมงานจะตรวจสอบการชำระเงินโดยเร็ว</span> <span class="ln">(ภายใน 24 ชม.)</span></span></div>':'')
      +'</div></div><div class="xbot"><a class="xcta" href="#xrstat/'+esc(j.regNo)+'">ดูสถานะการสมัคร</a></div>';
    shell('xrdone',gold?'gold':'',h);
  }).catch(function(){ failView('xrdone','','สถานะการลงทะเบียน','#exam'); }); }

/* 9:675 สถานะการสมัคร */
function renderStatus(no){ loading('xrstat','','สถานะการสมัคร','#exam');
  Promise.all([regStatus(no),loadEx(true).catch(function(){return null;})]).then(function(r){ var j=r[0]; if(!j.ok){ failView('xrstat','','สถานะการสมัคร','#exam','ไม่พบใบสมัครนี้'); return; }
    var mine=regOf(no)||{}, k=kind(j.examType), gold=k==='lead', rd=j.round||{}, paid=PAIDS.indexOf(j.status)>=0, dead=/CANCELLED|REJECTED|REFUNDED/.test(j.status);
    var ses=mine.session, att=j.attendance, live=mine.round&&mine.round.live;
    var done=[true,j.status!=='PENDING_PAYMENT'&&j.status!=='DRAFT',paid,!!att||j.status==='CHECKED_IN',!!ses,!!(ses&&ses.status!=='in_progress')];
    var cur=done.indexOf(false); var labels=['ลงทะเบียน','ชำระเงิน','ยืนยันแล้ว','เช็กอิน','เข้าสอบ','ผลสอบ'];
    var m=A.me()||{};
    var h='<div class="top">'+hd('สถานะการสมัคร','#exam')+'<div class="xbd2">'
      +'<div class="xbc" style="gap:14px"><div class="xrowkv">'+badge(j.status)+'<b style="font-size:12px;color:#64748b;font-weight:700">'+esc(j.regNo)+'</b></div><div><div class="nm">'+esc(m.name||j.name)+'</div><div class="sub" style="margin-top:4px">หลักสูตร : '+courseName(k)+'</div></div></div>'
      +(dead?'':'<div class="xbc"><h3 class="s">ขั้นตอนการสอบ</h3><div class="xsteps">'+labels.map(function(l,i){ var c=done[i]?'d':(i===cur?'c':''); return '<div class="'+c+'"><i>'+(done[i]?sv('check',10,'#fff',3.5):(i+1))+'</i>'+l+'</div>'; }).join('')+'</div></div>')
      +'<div class="xbc"><h3>รายละเอียดรอบสอบ</h3><div class="xhr"></div><div style="display:flex;flex-direction:column;gap:10px">'+kvRow('รอบสอบ','รอบที่ '+(rd.no||'-'))+kvRow('วันที่',when(rd))+kvRow('รูปแบบ',modeTH(j.mode||rd.mode),true)+((j.mode||rd.mode)==='onsite'&&rd.venue?kvRow('สถานที่',rd.venue):'')+kvRow('โค้ชทีม',j.coachTeam||'ไม่ระบุโค้ช')+'</div></div>'
      +'<div class="xbc"><h3>ประวัติการดำเนินการ</h3><div class="xtl">'+(j.timeline||[]).map(function(t){ var ic=({paid:['checkC','g'],attend:['checkC','g'],review:['clock','w'],wait:['clock','w'],slip:['upload',''],reg:['file',''],bad:['x','w']})[t.k]||['file',''];
        return '<div><i class="'+ic[1]+'">'+sv(ic[0],16)+'</i><span><b>'+esc(t.t)+'</b>'+(t.at?'<small>'+esc(dtTH(t.at))+'</small>':'')+'</span></div>'; }).join('')+'</div></div>'
      +'</div></div>';
    var online=(j.mode||rd.mode)!=='onsite', btns='';
    if(paid&&!(ses&&ses.status!=='in_progress')){
      var right=live?'<a class="xcta" href="#xsel/'+k+'">เข้าห้องสอบ</a>':(online&&!att?'<a class="xcta" href="#xrticket/'+esc(no)+'">สแตมป์เข้าร่วม</a>':'<a class="xcta" href="#xsel/'+k+'">ห้องสอบ</a>');
      btns='<div class="xrow2"><a class="xcta ol" href="#xrticket/'+esc(no)+'">ดู QR Code</a>'+right+'</div>';
    } else if(ses&&ses.status!=='in_progress'){ btns='<a class="xcta" href="#xsel/'+k+'">ดูผลสอบ</a>'; }
    else if(j.status==='REJECTED'){ btns='<a class="xcta" href="'+A.LINE+'" target="_blank" rel="noopener">ติดต่อทีมงานทาง LINE</a>'; }
    else btns='<a class="xcta ol" href="#exam">กลับหน้า E-XAM</a>';
    shell('xrstat',gold?'gold':'',h+'<div class="xbot" style="padding:24px 24px calc(20px + env(safe-area-inset-bottom))">'+btns+'</div>');
  }).catch(function(){ failView('xrstat','','สถานะการสมัคร','#exam'); }); }

/* 9:535 บัตรผู้เข้าสอบ */
var TK=null;
function renderTicket(no){ loading('xrticket','','บัตรผู้เข้าสอบ','#xrstat/'+no);
  api('/api/xv/reg/ticket?regNo='+encodeURIComponent(no)+'&phone='+encodeURIComponent(phone())).then(function(j){
    if(!j.ok){ failView('xrticket','','บัตรผู้เข้าสอบ','#xrstat/'+no,j.error==='not_paid'?'<span class="ln">บัตรผู้เข้าสอบจะแสดง</span> <span class="ln">เมื่อทีมงานยืนยันการชำระเงินแล้ว</span>':'ไม่พบบัตรผู้เข้าสอบนี้'); return; }
    TK=j; var k=kind(j.examType), gold=k==='lead', r=j.round||{}, online=(j.mode||r.mode)!=='onsite', w=j.window||{}, att=j.attendance;
    var h='<div class="top">'+hd('บัตรผู้เข้าสอบ','#xrstat/'+esc(no))+'<div class="xpad">'
      +'<div class="xtk"><div class="bn"><div class="r1"><b>'+(gold?'X-LEAD':'X-VISOR')+' EXAM TICKET</b><span class="bdg"><i></i>ยืนยันการจองแล้ว</span></div><div><div class="nm">'+esc((A.me()||{}).name||j.name)+'</div><div class="no">หมายเลขผู้เข้าสอบ: '+esc(j.regNo)+'</div></div></div>'
      +'<div class="qs"><div class="qb" id="tkQr"></div><small>รอบสอบ : '+esc(thWD(r.date))+' | เวลา '+esc(hm(r.timeslot)||w.startsAt||'09:30')+' น.</small></div>'
      +(online?'':'<div class="dv"></div><div class="ins"><b>รายละเอียดและข้อปฏิบัติ (On-Site)</b><p><span class="ln">แสดง QR CODE นี้ให้ทีมงานสแกนที่จุดลงทะเบียน</span><br><span class="ln">สแกนได้ตั้งแต่ '+esc(w.opensAt||'06:00')+' น. ถึง '+esc(w.startsAt||'09:30')+' น.</span>'+(r.venue?'<br><span class="ln">สถานที่ '+esc(r.venue)+'</span>':'')+'</p></div>')+'</div>';
    if(online) h+='<div class="xinfo"><div><b>กรณีสอบออนไลน์ (Online)</b><small>สแตมป์ยืนยันในเวลาที่กำหนด ('+esc(w.opensAt||'06:00')+' - '+esc(w.startsAt||'09:30')+' น.)</small></div>'
      +(att?'<button type="button" class="bt" disabled>สแตมป์แล้ว '+esc(dtTH(att.at))+'</button>':'<button type="button" class="bt" id="tkSt"'+(w.state==='open'?'':' disabled')+'>'+(w.state==='open'?'สแตมป์ยืนยันการเข้าร่วม':(w.state==='closed'?'หมดเวลาสแตมป์แล้ว':'เปิดให้สแตมป์วันสอบ เวลา '+esc(w.opensAt||'06:00')+' น.'))+'</button>')+'</div>';
    h+='</div></div><div class="xbot"><button type="button" class="xcta ol" id="tkSv">'+sv('dl',18)+'บันทึก QR</button></div>';
    var v=shell('xrticket',gold?'gold':'',h);
    A.qrLib().then(function(){ var el=$('#tkQr'); if(el){ el.innerHTML=''; el.appendChild(A.drawQr(j.payload,312,'M')); } }).catch(function(){});
    var stp=$('#tkSt',v); if(stp)stp.onclick=function(){ stp.disabled=true; stp.textContent='กำลังสแตมป์…';
      api('/api/xv/reg/attend',{method:'POST',body:{regNo:j.regNo,phone:phone()}}).then(function(a){ if(a.ok){ EX=null; location.hash='#xrstamped/'+j.regNo; return; }
        stp.disabled=false; stp.textContent='สแตมป์ยืนยันการเข้าร่วม'; toast({not_open_yet:'ยังไม่ถึงเวลาสแตมป์',closed:'หมดเวลาสแตมป์แล้ว',onsite_use_qr:'สอบ On Site ใช้ QR สแกนที่จุดลงทะเบียน',not_paid:'ยังไม่ได้ยืนยันการชำระเงิน'}[a.error]||'สแตมป์ไม่สำเร็จ'); }).catch(function(){ stp.disabled=false; stp.textContent='สแตมป์ยืนยันการเข้าร่วม'; toast('เชื่อมต่อไม่สำเร็จ'); }); };
    $('#tkSv',v).onclick=function(){ A.qrLib().then(function(){ var c=A.drawQr(j.payload,600,'M'), a=document.createElement('a'); a.download='CloverX-Exam-'+j.regNo+'.png'; a.href=c.toDataURL('image/png'); document.body.appendChild(a); a.click(); a.remove(); toast('บันทึก QR แล้ว'); }); };
  }).catch(function(){ failView('xrticket','','บัตรผู้เข้าสอบ','#xrstat/'+no); }); }

/* 9:786 ยืนยันเข้าร่วมสำเร็จ */
function renderStamped(no){ loading('xrstamped','','ยืนยันเข้าร่วม','#xrstat/'+no);
  regStatus(no).then(function(j){ if(!j.ok){ failView('xrstamped','','ยืนยันเข้าร่วม','#exam','ไม่พบใบสมัครนี้'); return; }
    var k=kind(j.examType), r=j.round||{}, a=j.attendance||{};
    var d=a.at?new Date(a.at):null, when2=d?(('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)+' น. '+d.getDate()+' '+THM[d.getMonth()]+' '+(d.getFullYear()+543)):'';
    var h='<div class="top">'+hd('ยืนยันเข้าร่วม','#xrstat/'+esc(no))+'<div class="xpad" style="gap:24px"><div class="xok" style="padding-top:20px"><span class="c big">'+sv('checkC',40,'#10b981')+'</span><h2>ยืนยันเข้าร่วมสำเร็จ!</h2>'+(when2?'<p>สแตมป์เมื่อ '+esc(when2)+'</p>':'')+'</div>'
      +'<div class="xcard" style="padding:19px">'+kvRow('หลักสูตร',courseName(k),true)+'<div class="xhr"></div>'+kvRow('รอบการสอบ',when(r),true)+'<div class="xhr"></div>'+kvRow('รูปแบบการสอบ',modeTH(j.mode||r.mode),true)+'</div>'
      +'<div class="xinfo row">'+sv('clock',20,k==='lead'?'#b1961d':'#2563eb')+'<div><b>รอผู้จัดสอบเปิดห้องสอบ</b><p><span class="ln">เมื่อถึงเวลาสอบ เข้าห้องสอบได้จากเมนู E-XAM</span> <span class="ln">โดยใช้รหัสเข้าห้องสอบจากทีมงาน</span> <span class="ln">หากไม่ได้รับ ติดต่อได้ที่ LINE @cloverxth</span></p></div></div>'
      +'</div></div><div class="xbot"><a class="xcta" href="#home">กลับสู่หน้าหลัก</a></div>';
    shell('xrstamped',k==='lead'?'gold':'',h);
  }).catch(function(){ failView('xrstamped','','ยืนยันเข้าร่วม','#exam'); }); }

/* =================== ห้องสอบ =================== */
function lsGet(k){ try{ return JSON.parse(localStorage.getItem(k)||'null'); }catch(e){ return null; } }
function lsSet(k,v){ try{ if(v==null)localStorage.removeItem(k); else localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
function lsKey(){ return 'cx_xv_'+((A.me()||{}).id||''); }
var XR=null;   /* รหัสห้องสอบที่ยืนยันแล้ว {code, regNo, round} */
var SS=null;   /* ห้องสอบที่กำลังทำ */
var RES={};    /* ผลสอบล่าสุด แยกตาม sessionId */
function endTime(r){ var s=hm(r.timeslot); if(!s)return ''; var m=String(r.timeslot).match(/[-–]\s*(\d{1,2})[:.](\d{2})/); if(m)return ('0'+m[1]).slice(-2)+':'+m[2];
  var p=s.split(':'), t=(+p[0])*60+(+p[1])+120; return ('0'+Math.floor(t/60)%24).slice(-2)+':'+('0'+t%60).slice(-2); }
function examWhen(r){ var s=hm(r.timeslot); return thD(r.date)+(s?' ('+s+' - '+endTime(r)+' น.)':''); }
function sumScore(res){ return (res||[]).reduce(function(t,r){ return t+(+r.score||0); },0); }

/* 54:11 / 106:2 รายการสอบ */
function renderSelect(k){ k=k==='lead'?'lead':'visor'; var gold=k==='lead', title='การสอบ '+(gold?'X-Lead':'X-Visor');
  shell('xsel','rm'+(gold?' gold':''),hd2(title,'#exam')+'<div class="xlist"><div class="xempty2">กำลังโหลด…</div></div>');
  loadEx(true).then(function(E){ var t=tier(), cards='';
    var res=(E.results||[]).filter(function(x){return kind(x.examType)===k;});
    if(gold)(E.results||[]).filter(function(x){return kind(x.examType)==='visor'&&x.passed;}).slice(0,1).forEach(function(x){ cards+=resultCard(x,'visor'); });
    var lv=E.live; if(lv&&kind(lv.examType)===k) cards+='<div class="xec"><div class="r1"><span class="xtag b">กำลังสอบ</span></div><div><h4>'+exName(k)+'</h4><div class="dt">คำตอบของคุณบันทึกไว้แล้ว กลับเข้าห้องสอบต่อได้</div></div><div class="r3"><span>จำนวนคำถาม : 100 ข้อ (5 พาร์ต)</span><a class="go" href="#xroom">กลับเข้าห้องสอบ</a></div></div>';
    var doneRounds={}; res.forEach(function(x){ doneRounds[x.roundId]=1; });
    (E.registrations||[]).filter(function(r){ return kind(r.examType)===k&&r.paid&&!(r.round&&doneRounds[r.round.id])&&!(lv&&r.round&&lv.roundId===r.round.id); }).forEach(function(r){ var rd=r.round||{}, live=!!rd.live;
      cards+='<div class="xec'+(live?'':' off')+'"><div class="r1"><span class="xtag '+(live?'g':'m')+'">'+(live?'เปิดห้องสอบ':'รอเปิดห้องสอบ')+'</span><span class="dur">'+sv('clock',14,'#94a3b8')+'120 นาที</span></div><div><h4>'+exName(k)+'</h4><div class="dt">วันเวลาสอบ : '+esc(examWhen(rd))+'</div></div>'
        +'<div class="r3"><span>จำนวนคำถาม : 100 ข้อ (5 พาร์ต)</span>'+(live?'<a class="go" href="#xver/'+esc(r.regNo)+'">เข้าสอบ</a>':'<button class="go" type="button" disabled>เข้าสอบ</button>')+'</div></div>'; });
    res.forEach(function(x){ cards+=resultCard(x,k); });
    if(!cards) cards='<div class="xempty2"><span class="ln">ยังไม่มีรายการสอบที่เข้าได้</span><br><span class="ln">สมัครสอบและรอทีมงานยืนยันการชำระเงิน</span><br><a class="xcta" style="margin-top:14px;height:40px;font-size:14px" href="#xr/'+k+'">สมัครสอบ '+(gold?'X-Lead':'X-Visor')+'</a></div>';
    shell('xsel','rm'+(gold?' gold':''),hd2(title,'#exam')+'<div class="xpb">'+avatar()+'<div><b>'+esc((A.me()||{}).name)+'</b><small>สถานะ : '+esc(gold&&t==='X-VISOR'?'PRE X-LEAD':t)+' (#'+memCode()+')</small></div></div>'
      +'<div class="xlist"><h3>รายการสอบที่สามารถเข้าได้</h3>'+cards+'</div>');
  }).catch(function(){ shell('xsel','rm',hd2(title,'#exam')+'<div class="xlist"><div class="xempty2">เชื่อมต่อไม่สำเร็จ</div></div>'); }); }
function resultCard(x,k){ var sc=sumScore(x.results), p=x.passed, st=x.status;
  var tag=p?'<span class="xtag g">✓ ผ่านแล้ว</span>':({awaiting_verify:'<span class="xtag w">รอยืนยันผล</span>',remedial_required:'<span class="xtag w">รอสอบซ่อม</span>',ended_failed:'<span class="xtag r">ไม่ผ่าน</span>',disqualified:'<span class="xtag r">ถูกตัดสิทธิ์</span>'}[st]||'<span class="xtag m">'+esc(st)+'</span>');
  return '<div class="xec'+(p?' pass':' off')+'"><div class="r1">'+tag+(x.results&&x.results.length?'<span style="font-size:12px;font-weight:500;color:'+(p?'#10b981':'#475569')+'">'+sc+'/100 คะแนน</span>':'')+'</div>'
    +'<div><h4 style="font-size:15px;font-weight:600">'+exName(kind(x.examType))+'</h4><div class="dt" style="font-size:12px">สอบเมื่อ : '+esc(x.roundDate?thD(x.roundDate):dtTH(x.at))+(p?' ผลสอบ ผ่าน':'')+'</div></div>'
    +'<div class="r3" style="justify-content:flex-end"><a class="'+(st==='remedial_required'?'go':'gh')+'" href="#xres/'+esc(x.id)+'">'+(st==='remedial_required'?'สอบซ่อม':'ดูผลสอบ')+'</a></div></div>'; }

/* 54:78 ยืนยันตัวตน + รหัสเข้าห้องสอบ */
var OTP='', OTPOK=false;
function renderVerify(no){ loadEx().then(function(){ var r=regOf(no); if(!r||!r.paid){ location.replace('#exam'); return; }
  var k=kind(r.examType), gold=k==='lead', m=A.me()||{};
  var boxes=''; for(var i=0;i<6;i++){ var ch=OTP.charAt(i); boxes+='<span class="'+(ch?'f':(i===OTP.length?'cur':''))+'">'+esc(ch)+'</span>'; }
  var h='<div class="top">'+hd2('ยืนยันตัวตนก่อนเข้าสอบ','#xsel/'+k)+'<div class="xbd2">'
    +'<div class="xvc">'+avatar(true)+'<div><div class="nm">'+esc(m.name)+'</div><div class="id">รหัสสมาชิก : #'+memCode()+'</div></div><div class="xhr" style="align-self:stretch"></div><div><div class="k">วิชาที่ลงทะเบียนสอบ</div><div class="ex">'+exName(k)+'</div></div></div>'
    +'<div style="display:flex;flex-direction:column;gap:10px"><label class="xlbl" for="otpIn">กรอกรหัสผ่านเข้าห้องสอบ (6 หลัก)</label><div class="xotp" id="otpBx">'+boxes+'<input id="otpIn" autocomplete="one-time-code" autocapitalize="characters" maxlength="7" value="'+esc(OTP)+'" aria-label="รหัสเข้าห้องสอบ 6 หลัก"></div>'
    +'<span class="xhint">* ติดต่อเจ้าหน้าที่คุมสอบหากคุณไม่ได้รับรหัสเข้าสอบ</span></div>'
    +'<button type="button" class="xck2'+(OTPOK?' on':'')+'" id="otpCk"><i>'+(OTPOK?sv('check',12,'#fff',3):'')+'</i><span>ข้าพเจ้ายอมรับเงื่อนไขการสอบ และยืนยันว่าข้อมูลข้างต้นเป็นความจริงทุกประการ</span></button>'
    +'<div class="xerr" id="otpErr"></div></div></div><div class="xbot"><button type="button" class="xcta" id="otpGo">ยืนยันและเข้าสอบ</button></div>';
  var v=shell('xver','rm'+(gold?' gold':''),h), inp=$('#otpIn',v);
  inp.oninput=function(){ var c=this.value.toUpperCase().replace(/[^0-9A-Z]/g,''); if(c.length===7&&c.charAt(0)==='R')c=c.slice(1); OTP=c.slice(0,6);
    $$('#otpBx span',v).forEach(function(s,i){ var ch=OTP.charAt(i); s.textContent=ch; s.className=ch?'f':(i===OTP.length?'cur':''); }); this.value=OTP; $('#otpErr',v).textContent=''; };
  $('#otpCk',v).onclick=function(){ OTPOK=!OTPOK; this.classList.toggle('on',OTPOK); this.querySelector('i').innerHTML=OTPOK?sv('check',12,'#fff',3):''; };
  $('#otpGo',v).onclick=function(){ var b=this, e=$('#otpErr',v);
    if(OTP.length!==6){ e.textContent='กรุณากรอกรหัสเข้าห้องสอบให้ครบ 6 หลัก'; inp.focus(); return; }
    if(!OTPOK){ e.textContent='กรุณายอมรับเงื่อนไขการสอบ'; return; }
    b.disabled=true; b.textContent='กำลังตรวจสอบ…';
    api('/api/xv/round/'+encodeURIComponent('R'+OTP)).then(function(j){ b.disabled=false; b.textContent='ยืนยันและเข้าสอบ';
      if(!j.ok){ e.textContent='รหัสเข้าห้องสอบไม่ถูกต้อง กรุณาตรวจสอบกับเจ้าหน้าที่คุมสอบ'; return; }
      if(r.round&&r.round.id&&j.round.id!==r.round.id){ e.textContent='รหัสนี้ไม่ใช่ห้องสอบของรอบที่คุณสมัคร'; return; }
      if(!j.round.open){ e.textContent='ห้องสอบยังไม่เปิด กรุณารอเจ้าหน้าที่เปิดห้องสอบ'; return; }
      XR={code:j.round.code,regNo:no,round:j.round,k:k}; location.hash='#xrules/'+no;
    }).catch(function(){ b.disabled=false; b.textContent='ยืนยันและเข้าสอบ'; e.textContent='เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่'; }); };
  }).catch(function(){ location.replace('#exam'); }); }

/* 54:126 ข้อกำหนดก่อนเริ่มสอบ */
function renderRules(no){ if(!XR||XR.regNo!==no){ location.replace('#xver/'+no); return; }
  var k=XR.k, gold=k==='lead', r=XR.round, onsite=r.mode==='onsite';
  var rules=['ห้ามถ่ายรูปหน้าจอ ห้ามแคปสกรีนหน้าจอ ห้ามสลับหน้าจอ'].concat(onsite?['สามารถกดหยุดเวลาได้ 2 ครั้ง (ครั้งละ 5 นาที)']:[]).concat(['1 พาร์ต สามารถสอบซ่อมได้ 2 ครั้ง','คำตอบบันทึกอัตโนมัติ เน็ตหลุดไม่หาย','ต้องตอบให้ครบทุกข้อในพาร์ต จึงไปพาร์ตถัดไปได้','หากละเมิดกฎ การเตือน จะตัดสิทธิ์สอบทันที']);
  var h='<div class="top">'+hd2('ข้อกำหนดก่อนเริ่มสอบ','#xver/'+esc(no))+'<div class="xrb">'
    +'<div class="sb"><small>รายละเอียดวิชาสอบ</small><b>'+exName(k)+'</b></div>'
    +'<div class="ic2"><div class="l"><span class="xtag b">'+(gold?'X-Lead':'X-Visor')+'</span>ครั้งที่ '+esc(r.no||1)+'</div><div class="d">วันที่ '+esc(thD(r.date))+'</div>'
    +'<div class="l"><span class="xtag g">100 ข้อ</span>5 พาร์ต (พาร์ตละ 20 ข้อ)</div><div class="l"><span class="xtag w">120 นาที</span>เกณฑ์ผ่าน 16/20 ทุกพาร์ต (เฉลี่ย 80/100)</div></div>'
    +'<div class="xrl"><b>ข้อกำหนดก่อนเริ่มสอบ</b>'+rules.map(function(t,i){ return '<div><i>'+(i+1)+'</i><span>'+esc(t)+'</span></div>'; }).join('')+'</div>'
    +'<div class="xerr" id="ruErr"></div></div></div><div class="xbot"><button type="button" class="xcta" id="ruGo">ยืนยันและเริ่มทำข้อสอบ</button></div>';
  var v=shell('xrules','rm'+(gold?' gold':''),h);
  $('#ruGo',v).onclick=function(){ var b=this, m=A.me()||{}; b.disabled=true; b.textContent='กำลังเปิดข้อสอบ…';
    api('/api/xv/start',{method:'POST',body:{firstName:m.firstName,lastName:m.lastName,phone:m.phone,roundCode:XR.code}}).then(function(j){
      if(j.ok){ startSession(j); location.hash='#xroom'; return; }
      if(j.error==='already_taken'&&j.sessionId){ RES[j.sessionId]={id:j.sessionId,token:j.token,status:j.status,results:j.results,remedialQueue:j.remedialQueue,staffVerified:j.staffVerified,examType:j.examType,roundDate:(XR.round||{}).date}; location.hash='#xres/'+j.sessionId; return; }
      b.disabled=false; b.textContent='ยืนยันและเริ่มทำข้อสอบ';
      $('#ruErr').textContent={round_closed:'ห้องสอบปิดแล้ว',not_started:'ห้องสอบยังไม่เปิด กรุณารอเจ้าหน้าที่',exam_time_ended:'หมดเวลาสอบของรอบนี้แล้ว',no_questions:'ยังไม่มีชุดข้อสอบ กรุณาแจ้งเจ้าหน้าที่',no_round:'ไม่พบห้องสอบ'}[j.error]||'เข้าห้องสอบไม่สำเร็จ กรุณาลองใหม่';
    }).catch(function(){ b.disabled=false; b.textContent='ยืนยันและเริ่มทำข้อสอบ'; $('#ruErr').textContent='เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่'; }); };
}

/* ---------- เครื่องยนต์ห้องสอบ ---------- */
function startSession(j,roundCode){ var parts=(j.parts||[1,2,3,4,5]).map(Number);
  SS={id:j.sessionId||j.id,token:j.token,code:j.code,mode:j.mode||'online',phase:j.phase||'first',parts:parts,paper:j.paper||{},answers:{},examType:j.examType||'',
    endAt:Date.now()+(((j.resumed||j.remaining!=null)?j.remaining:j.durationSec)||0)*1000,pi:0,q:0,pauseUsed:j.pauseUsed||0,paused:false,view:'q',q2:{},roundCode:roundCode||(XR&&XR.code)||''};
  var srv=j.answers||{}; Object.keys(srv).forEach(function(k2){ if(srv[k2]!=null)SS.answers[k2]=srv[k2]; });
  var bk=lsGet('cx_xva_'+SS.id); if(bk&&bk.a){ Object.keys(bk.a).forEach(function(k2){ var p=+k2.split('-')[0]; if(parts.indexOf(p)>=0&&bk.a[k2]!=null&&SS.answers[k2]==null){ SS.answers[k2]=bk.a[k2]; SS.q2[k2]=bk.a[k2]; } }); }
  lsSet(lsKey(),{id:SS.id,token:SS.token,code:SS.roundCode});
  /* ไปข้อแรกที่ยังไม่ตอบ */
  for(var i=0;i<parts.length;i++){ var u=firstEmpty(parts[i]); if(u>=0){ SS.pi=i; SS.q=u; break; } if(i===parts.length-1){ SS.pi=i; SS.q=QPP-1; } }
  flushSoon(); }
function firstEmpty(p){ for(var q=0;q<QPP;q++)if(SS.answers[p+'-'+q]==null)return q; return -1; }
function answered(p){ var n=0; for(var q=0;q<QPP;q++)if(SS.answers[p+'-'+q]!=null)n++; return n; }
function unlockedIdx(){ for(var i=0;i<SS.parts.length;i++){ if(answered(SS.parts[i])<QPP)return i; } return SS.parts.length-1; }
function allDone(){ return SS.parts.every(function(p){ return answered(p)===QPP; }); }
function backup(){ lsSet('cx_xva_'+SS.id,{a:SS.answers,at:Date.now()}); }
var FLT=0, FLBUSY=false;
function flushSoon(){ clearTimeout(FLT); FLT=setTimeout(flush,120); }
function flush(){ if(!SS||FLBUSY)return Promise.resolve(); var keys=Object.keys(SS.q2); if(!keys.length)return Promise.resolve(); FLBUSY=true;
  return Promise.all(keys.map(function(k2){ var p=k2.split('-'), ch=SS.q2[k2];
    return api('/api/xv/answer',{method:'POST',body:{sessionId:SS.id,token:SS.token,part:+p[0],q:+p[1],choice:ch}}).then(function(j){
      if(j.ok){ if(SS&&SS.q2[k2]===ch)delete SS.q2[k2]; if(j.remaining!=null)syncRemain(j.remaining); }
      else if(j.expired){ if(SS)delete SS.q2[k2]; timeUp(); }
      else if(j._s===404){ if(SS)delete SS.q2[k2]; checkGone(); } }).catch(function(){}); })).then(function(){ FLBUSY=false; if(SS&&Object.keys(SS.q2).length){ clearTimeout(FLT); FLT=setTimeout(flush,2500); } }); }
function beacon(){ if(!SS||!navigator.sendBeacon)return; Object.keys(SS.q2).forEach(function(k2){ var p=k2.split('-'); try{ navigator.sendBeacon('/api/xv/answer',new Blob([JSON.stringify({sessionId:SS.id,token:SS.token,part:+p[0],q:+p[1],choice:SS.q2[k2]})],{type:'application/json'})); }catch(e){} }); }
window.addEventListener('pagehide',beacon);
function syncRemain(sec){ if(!SS||SS.paused)return; var cur=Math.round((SS.endAt-Date.now())/1000); if(Math.abs(cur-sec)>=2)SS.endAt=Date.now()+sec*1000; }
var TMR=0, POLL=0;
function stopRoom(){ clearInterval(TMR); clearInterval(POLL); TMR=POLL=0; }
function fmt(s){ s=Math.max(0,Math.floor(s)); var h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60; return ('0'+h).slice(-2)+':'+('0'+m).slice(-2)+':'+('0'+x).slice(-2); }
function tick(){ if(!SS)return; if(SS.paused){ SS.endAt=Date.now()+SS.pausedLeft*1000; return; } var left=(SS.endAt-Date.now())/1000, el=$('#xtT');
  if(el){ el.textContent=fmt(left); el.classList.toggle('low',left<300); }
  if(!SS.w5&&left<300&&left>60){ SS.w5=1; toast('เหลือเวลาอีก 5 นาที'); } if(!SS.w1&&left<60&&left>0){ SS.w1=1; toast('เหลือเวลาอีก 1 นาที'); }
  if(left<=0)timeUp(); }
function timeUp(){ if(!SS||SS.submitting)return; toast('หมดเวลาสอบ ระบบกำลังส่งคำตอบ'); doSubmit(true); }
function checkGone(){ if(!SS)return; api('/api/xv/session/'+encodeURIComponent(SS.id)+'?token='+encodeURIComponent(SS.token)+'&lite=1').then(function(j){ if(j.ok&&j.status!=='in_progress'){ var id=SS.id; RES[id]=Object.assign({id:id,token:SS.token},j); endRoom(); location.replace('#xres/'+id); } }).catch(function(){}); }
function endRoom(){ stopRoom(); if(SS)lsSet('cx_xva_'+SS.id,null); lsSet(lsKey(),null); SS=null; EX=null; setGuards(false); }
/* ป้องกันการทุจริต: รายงานให้ทีมงานเห็น ไม่บล็อกการทำข้อสอบ */
var PRT={};
function proctor(type){ if(!SS)return; var now=Date.now(); if(PRT[type]&&now-PRT[type]<800)return; PRT[type]=now; api('/api/xv/proctor',{method:'POST',body:{sessionId:SS.id,token:SS.token,type:type}}).catch(function(){}); }
function onVis(){ if(document.hidden){ proctor('leave'); showBlur(true); } }
function onBlur(){ proctor('blur'); showBlur(true); }
function onFocus(){ showBlur(false); }
function onCopy(e){ if(e&&e.preventDefault)e.preventDefault(); proctor(e.type==='contextmenu'?'contextmenu':e.type); }
function onKey(e){ if(e.key==='PrintScreen')proctor('printscreen'); }
function showBlur(on){ var b=$('#xBlur'); if(!b){ b=document.createElement('div'); b.id='xBlur'; b.className='xblur'; b.innerHTML='<div><b style="font-size:18px">กลับมาที่ห้องสอบ</b><br><span class="ln">ระบบบันทึกการออกจากหน้าสอบไว้แล้ว</span> <span class="ln">แตะที่หน้าจอเพื่อทำข้อสอบต่อ</span></div>'; b.onclick=function(){ showBlur(false); }; document.body.appendChild(b); } b.classList.toggle('on',!!on&&!!SS); }
function setGuards(on){ var f=on?'addEventListener':'removeEventListener'; document[f]('visibilitychange',onVis); window[f]('blur',onBlur); window[f]('focus',onFocus);
  ['copy','cut','paste','contextmenu'].forEach(function(t){ document[f](t,onCopy); }); document[f]('keyup',onKey); if(!on)showBlur(false); }

function resumeRoom(){ var s=lsGet(lsKey());
  return loadEx(true).catch(function(){ return null; }).then(function(){ var lv=(EX&&EX.live)||(s&&s.id?{id:s.id,token:s.token,roundCode:s.code}:null); if(!lv)return null;
    return api('/api/xv/session/'+encodeURIComponent(lv.id)+'?token='+encodeURIComponent(lv.token)).then(function(j){ if(!j.ok)return null;
      if(j.status!=='in_progress'){ RES[lv.id]=Object.assign({id:lv.id,token:lv.token},j); location.replace('#xres/'+lv.id); return 'res'; }
      startSession(Object.assign({sessionId:lv.id,token:lv.token,resumed:true},j),lv.roundCode||j.roundCode); return 'ok'; }); }); }

/* 96:1124 ห้องสอบ */
function renderRoom(){ if(!SS){ shell('xroom','rm wh',hd2('ห้องสอบ','#exam')+'<div class="xlist"><div class="xempty2">กำลังเปิดห้องสอบ…</div></div>');
    resumeRoom().then(function(r){ if(r==='ok')renderRoom(); else if(r!=='res')shell('xroom','rm',hd2('ห้องสอบ','#exam')+'<div class="xlist"><div class="xempty2"><span class="ln">ไม่มีห้องสอบที่กำลังทำอยู่</span><br><a class="xcta" style="margin-top:14px;height:40px;font-size:14px" href="#exam">กลับหน้า E-XAM</a></div></div>'); }).catch(function(){ shell('xroom','rm',hd2('ห้องสอบ','#exam')+'<div class="xlist"><div class="xempty2">เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่</div></div>'); });
    return; }
  setGuards(true);
  if(!TMR){ TMR=setInterval(tick,1000); POLL=setInterval(function(){ if(!SS||SS.submitting)return; api('/api/xv/session/'+encodeURIComponent(SS.id)+'?token='+encodeURIComponent(SS.token)+'&lite=1').then(function(j){ if(!SS)return;
      if(j.ok&&j.status!=='in_progress'&&!SS.submitting){ var id=SS.id; RES[id]=Object.assign({id:id,token:SS.token},j); endRoom(); location.replace('#xres/'+id); return; } if(j.ok&&j.remaining!=null)syncRemain(j.remaining); }).catch(function(){}); },6000); }
  if(SS.view==='confirm')return paintConfirm(); if(SS.view==='checking')return;
  paintRoom(); }
function timerBar(){ var p=SS.parts[SS.pi], idx=SS.parts.length>1?(SS.pi+1)+'/'+SS.parts.length:'1/1', onsite=SS.mode==='onsite';
  return '<div class="xtm"><div class="l"><i>'+sv('clock',14,'#fff')+'</i><span class="t" id="xtT">'+fmt((SS.endAt-Date.now())/1000)+'</span></div><div class="r">'
    +(onsite&&SS.pauseUsed<2&&SS.view!=='confirm'?'<button type="button" class="pz" id="xtPz">'+sv('pause',12,'#fff')+'หยุดเวลา '+(2-SS.pauseUsed)+'</button>':'')+'<span>'+(SS.phase==='remedial'?'ซ่อม ':'')+'พาร์ต '+idx+'</span></div></div>'; }
function paintRoom(){ var k=kind(SS.examType), gold=k==='lead', parts=SS.parts, p=parts[SS.pi], q=SS.q, it=((SS.paper[p]||[])[q])||{q:'',o:[]}, ul=unlockedIdx(), name=(A.me()||{}).name||'';
  var pp='<div class="xppw"><div class="xpp">'+parts.map(function(pt,i){ var done=answered(pt)===QPP&&i!==SS.pi, cur=i===SS.pi; return (i?'<em class="'+(i<=ul?'d':'')+'"></em>':'')+'<button type="button" data-pi="'+i+'" class="'+(cur?'c':(done?'d':''))+'"'+(i>ul?' disabled':'')+' aria-label="พาร์ต '+pt+'">'+(done?sv('check',12,'#fff',3):pt)+'</button>'; }).join('')+'</div>'
    +'<div class="xppl" style="grid-template-columns:repeat('+parts.length+',1fr)">'+parts.map(function(pt,i){ return '<span class="'+(i===SS.pi?'c':(i<ul||answered(pt)===QPP?'d':''))+'">พ.'+pt+'</span>'; }).join('')+'</div></div>';
  var n=answered(p), letters=['ก','ข','ค','ง'], chosen=SS.answers[p+'-'+q];
  var qc='<div class="xq"><div class="r1"><div class="l"><span class="xtag b">พาร์ต '+p+'</span><b>ข้อ '+(q+1)+'/'+QPP+'</b></div><span class="xtag b">'+n+'/'+QPP+'</span></div><h3>'+esc(it.q)+'</h3><div class="xopts" role="radiogroup">'
    +(it.o||[]).map(function(o,i){ return '<button type="button" role="radio" aria-checked="'+(chosen===i?'true':'false')+'" data-o="'+i+'" class="'+(chosen===i?'on':'')+'"><em>'+letters[i]+'</em><span>'+esc(o)+'</span></button>'; }).join('')+'</div></div>';
  var ab='<div class="xab"><div class="r1"><b>กระดานคำตอบ</b><span class="c"><i>'+n+'</i><i class="t">'+QPP+'</i></span></div><div class="g">';
  for(var i=0;i<QPP;i++) ab+='<button type="button" data-q="'+i+'" class="'+(SS.answers[p+'-'+i]!=null?'a':'')+(i===q?' cur':'')+'" aria-label="ข้อ '+(i+1)+'">'+(i+1)+'</button>';
  ab+='</div></div>';
  var last=q===QPP-1, lastPart=SS.pi===parts.length-1, nextLbl=!last?'ข้อถัดไป':(lastPart?'ส่งคำตอบ':'พาร์ตถัดไป');
  var wm=''; for(var w=0;w<24;w++)wm+='<span>'+esc(name)+'</span>';
  var h=timerBar()+'<div class="xrm"><div class="xwm" aria-hidden="true">'+wm+'</div>'+pp+qc+ab+'</div>'
    +'<div class="xbot"><div class="xrow2"><button type="button" class="xcta ol" id="xqPv"'+(SS.pi===0&&q===0?' disabled':'')+'>ข้อก่อนหน้า</button><button type="button" class="xcta" id="xqNx">'+nextLbl+'</button></div></div>';
  var v=shell('xroom','rm wh'+(gold?' gold':''),h);
  $$('[data-o]',v).forEach(function(b){ b.onclick=function(){ var ch=+b.dataset.o, key=p+'-'+q; SS.answers[key]=ch; SS.q2[key]=ch; backup(); flushSoon(); paintRoom(); }; });
  $$('[data-q]',v).forEach(function(b){ b.onclick=function(){ SS.q=+b.dataset.q; paintRoom(); }; });
  $$('[data-pi]',v).forEach(function(b){ b.onclick=function(){ var i=+b.dataset.pi; if(i>unlockedIdx())return; SS.pi=i; var u=firstEmpty(SS.parts[i]); SS.q=u>=0?u:0; paintRoom(); window.scrollTo(0,0); }; });
  $('#xqPv',v).onclick=function(){ if(SS.q>0)SS.q--; else if(SS.pi>0){ SS.pi--; SS.q=QPP-1; } paintRoom(); };
  $('#xqNx',v).onclick=function(){
    if(!last){ SS.q++; paintRoom(); return; }
    if(answered(p)<QPP){ var u=firstEmpty(p); toast('ตอบให้ครบทุกข้อในพาร์ต '+p+' ก่อน'); SS.q=u; paintRoom(); return; }
    if(!lastPart){ SS.pi++; var u2=firstEmpty(SS.parts[SS.pi]); SS.q=u2>=0?u2:0; flushSoon(); paintRoom(); window.scrollTo(0,0); return; }
    if(!allDone()){ for(var i2=0;i2<parts.length;i2++){ var e2=firstEmpty(parts[i2]); if(e2>=0){ SS.pi=i2; SS.q=e2; break; } } toast('ยังตอบไม่ครบทุกข้อ'); paintRoom(); return; }
    SS.view='confirm'; paintConfirm(); window.scrollTo(0,0); };
  var pz=$('#xtPz',v); if(pz)pz.onclick=openPause;
}
function openPause(){ if(!SS||SS.pauseUsed>=2)return; SS.paused=true; SS.pausedLeft=Math.max(0,Math.round((SS.endAt-Date.now())/1000));
  api('/api/xv/answer',{method:'POST',body:{sessionId:SS.id,token:SS.token,paused:true}}).catch(function(){});
  var bg=document.createElement('div'); bg.className='xpause xs rm'+(kind(SS.examType)==='lead'?' gold':''); bg.style.minHeight='0'; bg.style.background='rgba(15,23,42,.72)';
  bg.innerHTML='<div class="bx"><h3>หยุดเวลาชั่วคราว</h3><div class="tv" id="pzT">05:00</div><p><span class="ln">หยุดเวลาได้ 2 ครั้ง ครั้งละ 5 นาที</span> <span class="ln">เวลาสอบจะนับต่อเมื่อครบ 5 นาที หรือกดทำต่อ</span></p><button type="button" class="xcta" id="pzGo" style="height:48px;border-radius:24px;font-size:15px">ทำข้อสอบต่อเลย</button></div>';
  document.body.appendChild(bg); var left=300, iv=setInterval(function(){ left--; var t=$('#pzT'); if(t)t.textContent=('0'+Math.floor(left/60)).slice(-2)+':'+('0'+left%60).slice(-2); if(left<=0)end(); },1000);
  function end(){ clearInterval(iv); if(!bg.parentNode)return; bg.remove(); if(!SS)return; SS.pauseUsed++; SS.paused=false; SS.endAt=Date.now()+SS.pausedLeft*1000;
    api('/api/xv/answer',{method:'POST',body:{sessionId:SS.id,token:SS.token,paused:false,pauseUsed:SS.pauseUsed}}).then(function(j){ if(j&&j.remaining!=null)syncRemain(j.remaining); }).catch(function(){}); paintRoom(); toast('กลับเข้าห้องสอบแล้ว'); }
  $('#pzGo',bg).onclick=end; }

/* 96:1253 ยืนยันการส่งคำตอบ */
function paintConfirm(){ var k=kind(SS.examType), gold=k==='lead';
  var h=timerBar()+'<div class="xrm" style="background:#fff"><div class="xcf"><span class="c">'+sv('check',32,'#fff',2.5)+'</span><h2>ยืนยันการส่งคำตอบ?</h2><p class="s">'+(allDone()?'คุณตอบครบทุกข้อแล้ว':'ยังมีข้อที่ยังไม่ได้ตอบ')+'</p>'
    +'<div class="ps">'+SS.parts.map(function(p){ var n=answered(p); return '<div><span style="color:#0f172a">พาร์ต '+p+'</span><span class="'+(n<QPP?'no':'')+'">'+(n<QPP?'ตอบแล้ว '+n+'/'+QPP:'ตอบครบ '+n+'/'+QPP+sv('checkC',16))+'</span></div>'; }).join('')+'</div>'
    +'<div class="ib"><span class="ln">เมื่อกดยืนยัน ระบบจะส่งคำตอบทันที</span><br><span class="ln">ไม่สามารถกลับมาแก้ไขได้อีก</span></div>'
    +'<div style="display:flex;flex-direction:column;gap:10px"><button type="button" class="xcta" id="cfGo" style="height:48px;border-radius:24px;font-size:15px">ยืนยันส่งข้อสอบ</button><button type="button" class="xcta ol" id="cfBk" style="height:48px;border-radius:24px;font-size:15px">กลับไปตรวจทาน</button></div></div></div>';
  var v=shell('xroom','rm wh'+(gold?' gold':''),h);
  $('#cfBk',v).onclick=function(){ SS.view='q'; paintRoom(); };
  $('#cfGo',v).onclick=function(){ doSubmit(false); };
  var pz=$('#xtPz',v); if(pz)pz.remove(); }

/* 96:1320 กำลังตรวจคำตอบ แล้วส่งจริง */
function doSubmit(forced){ if(!SS||SS.submitting)return; SS.submitting=true; SS.view='checking'; var k=kind(SS.examType), gold=k==='lead', parts=SS.parts.slice(), sid=SS.id, tok=SS.token;
  var paint=function(pct,step){ var r=52, c=2*Math.PI*r;
    shell('xroom','rm wh'+(gold?' gold':''),'<div class="xchk"><div class="xring"><svg width="120" height="120" viewBox="0 0 120 120"><defs><linearGradient id="xrg" x1="0" x2="1"><stop offset="0" stop-color="'+(gold?'#92700c':'#2563eb')+'"/><stop offset="1" stop-color="'+(gold?'#d4a017':'#1d4ed8')+'"/></linearGradient></defs><circle cx="60" cy="60" r="'+r+'" fill="none" stroke="'+(gold?'#f3e5b5':'#dbeafe')+'" stroke-width="14"/><circle cx="60" cy="60" r="'+r+'" fill="none" stroke="url(#xrg)" stroke-width="14" stroke-linecap="round" stroke-dasharray="'+c+'" stroke-dashoffset="'+(c*(1-pct/100))+'" transform="rotate(-90 60 60)"/></svg><b>'+Math.round(pct)+'%</b></div>'
      +'<h2>กำลังตรวจคำตอบ...</h2><p>กรุณารอสักครู่</p><div class="ls">'+parts.map(function(p,i){ var s=i<step?'d':(i===step?'a':'w'); return '<div><i class="'+s+'">'+(s==='d'?sv('check',16):'')+'</i><span>'+esc(pname(k,p))+'</span><span class="xtag '+(s==='w'?'m':'b')+'" style="flex:none">'+(s==='d'?'เสร็จแล้ว':(s==='a'?'กำลังตรวจ':'รอตรวจ'))+'</span></div>'; }).join('')+'</div></div>'); };
  paint(0,0); var step=0, anim=new Promise(function(ok){ var iv=setInterval(function(){ step++; paint(Math.min(100,step/parts.length*100),step); if(step>=parts.length){ clearInterval(iv); setTimeout(ok,350); } },520); });
  var send=function(tries){ return flush().then(function(){ return api('/api/xv/submit',{method:'POST',body:{sessionId:sid,token:tok,answers:SS?SS.answers:{}}}); }).then(function(j){
      if(j.ok||j.status)return j; if(tries<5)return new Promise(function(ok){ setTimeout(ok,2500); }).then(function(){ return send(tries+1); }); throw new Error('submit'); })
    .catch(function(){ if(tries<5)return new Promise(function(ok){ setTimeout(ok,2500); }).then(function(){ return send(tries+1); }); throw new Error('submit'); }); };
  Promise.all([send(0),anim]).then(function(r){ var j=r[0]; RES[sid]=Object.assign({id:sid,token:tok},j); endRoom(); location.replace('#xres/'+sid); })
    .catch(function(){ if(SS){ SS.submitting=false; SS.view='confirm'; paintConfirm(); } toast('ส่งคำตอบไม่สำเร็จ คำตอบยังบันทึกอยู่ กรุณากดส่งอีกครั้ง'); }); }

/* 96:1376 ผลการสอบ */
var RPOLL=0;
function renderResult(id){ clearInterval(RPOLL); var d=RES[id];
  var go=function(r){ RES[id]=r; paintResult(id); if(/awaiting_verify|remedial_required|submitted/.test(r.status)||!r.staffVerified){ RPOLL=setInterval(function(){ if(view('xres').classList.contains('hide')){ clearInterval(RPOLL); return; } fetchRes(id).then(function(n){ if(n&&(n.status!==RES[id].status||n.staffVerified!==RES[id].staffVerified||sumScore(n.results)!==sumScore(RES[id].results))){ RES[id]=n; paintResult(id); } }).catch(function(){}); },20000); } };
  if(d&&d.results&&d.token){ go(d); return; }
  shell('xres','rm',hd2('ผลการสอบ','#exam')+'<div class="xres"><div class="xempty2">กำลังโหลด…</div></div>');
  fetchRes(id).then(function(r){ if(!r){ shell('xres','rm',hd2('ผลการสอบ','#exam')+'<div class="xres"><div class="xempty2">ไม่พบผลสอบนี้</div></div>'); return; } go(r); })
    .catch(function(){ shell('xres','rm',hd2('ผลการสอบ','#exam')+'<div class="xres"><div class="xempty2">เชื่อมต่อไม่สำเร็จ</div></div>'); }); }
function fetchRes(id){ var d=RES[id];
  var tokP=d&&d.token?Promise.resolve(d):loadEx(true).then(function(E){ return (E.results||[]).filter(function(x){return x.id===id;})[0]||null; });
  return tokP.then(function(x){ if(!x)return null; return api('/api/xv/session/'+encodeURIComponent(id)+'?token='+encodeURIComponent(x.token)+'&lite=1').then(function(j){ if(!j.ok)return null; return Object.assign({id:id,token:x.token,roundDate:x.roundDate||(d&&d.roundDate)||''},j); }); }); }
function paintResult(id){ var d=RES[id], k=kind(d.examType), gold=k==='lead', res=(d.results||[]).slice().sort(function(a,b){return a.part-b.part;}), total=sumScore(res), full=res.length*QPP||100, st=d.status;
  var pass=st==='verified'||st==='submitted', r=62, c=2*Math.PI*r, pct=full?total/full:0;
  var dateTxt=d.roundDate?thD(d.roundDate):thD(new Date(Date.now()+7*3600000).toISOString().slice(0,10));
  var head={awaiting_verify:['รอเจ้าหน้าที่ยืนยันผล','w'],remedial_required:['มีพาร์ตที่ต้องสอบซ่อม','w'],ended_failed:['ไม่ผ่านเกณฑ์','r'],disqualified:['ถูกตัดสิทธิ์สอบ','r'],verified:['ผ่านการสอบ','g'],submitted:['ผ่านการสอบ','g']}[st]||[st,'m'];
  var h='<div class="top">'+hd2('ผลการสอบ','#xsel/'+k)+'<div class="xres"><div class="xsc"><div class="rg"><svg width="140" height="140" viewBox="0 0 140 140"><defs><linearGradient id="xrg2" x1="0" x2="1"><stop offset="0" stop-color="'+(gold?'#92700c':'#2563eb')+'"/><stop offset="1" stop-color="'+(gold?'#d4a017':'#1d4ed8')+'"/></linearGradient></defs><circle cx="70" cy="70" r="'+r+'" fill="none" stroke="'+(gold?'#f3e5b5':'#dbeafe')+'" stroke-width="12"/><circle cx="70" cy="70" r="'+r+'" fill="none" stroke="url(#xrg2)" stroke-width="12" stroke-linecap="round" stroke-dasharray="'+c+'" stroke-dashoffset="'+(c*(1-pct))+'" transform="rotate(-90 70 70)"/></svg>'
    +'<div class="in"><b>'+total+'/'+full+'</b><i></i><small>รวม '+res.length+' พาร์ต</small></div></div><div><h3>'+exName(k)+'</h3><p>วันที่ทดสอบ : '+esc(dateTxt)+'</p></div><span class="xbdg '+head[1]+'">'+esc(head[0])+'</span></div>'
    +'<div class="xpr"><b>ผลสอบรายพาร์ต</b>'+res.map(function(x){ var f=x.status!=='passed', w=Math.round((x.score||0)/QPP*100);
      return '<div class="p'+(f?' f':'')+'"><div class="h"><span>'+esc(pname(k,x.part))+'</span><span>'+(x.score||0)+'/'+QPP+'</span></div><div class="bar"><i style="width:'+w+'%"></i></div>'+(f?'<span class="ft">'+((x.attempts||1)>=3?'ไม่ผ่าน (ใช้สิทธิ์สอบครบแล้ว)':'ไม่ผ่าน สอบซ่อมได้อีก '+(3-(x.attempts||1))+' ครั้ง')+'</span>':'')+'</div>'; }).join('')+'</div>'
    +(st==='awaiting_verify'?'<div class="xnote">'+sv('clock',18,'#64748b')+'<span><span class="ln">คะแนนผ่านทุกพาร์ตแล้ว</span> <span class="ln">รอเจ้าหน้าที่ตรวจสอบและยืนยันผลสอบ</span></span></div>':'')
    +(st==='ended_failed'?'<div class="xnote">'+sv('alert',18,'#dc2626')+'<span><span class="ln">ใช้สิทธิ์สอบซ่อมครบแล้ว</span> <span class="ln">ติดต่อทีมงานทาง LINE @cloverxth เพื่อสมัครรอบถัดไป</span></span></div>':'')
    +(d.staffVerified?'':'<p class="nt">ยังดูข้อที่ตอบผิดไม่ได้ในขณะนี้</p>')+'</div></div>';
  var cta=st==='remedial_required'?'<button type="button" class="xcta" id="rsRem">เตรียมสอบซ่อม</button>':(d.staffVerified&&res.some(function(x){return x.score<QPP;})?'<button type="button" class="xcta ol" id="rsRv">ดูข้อที่ตอบผิด</button>':'')
    +(st==='ended_failed'||st==='disqualified'?'<a class="xcta" href="'+A.LINE+'" target="_blank" rel="noopener">ติดต่อทีมงานทาง LINE</a>':'')+(st!=='remedial_required'?'<a class="xcta'+(cta?' ol':'')+'" href="#exam">กลับหน้า E-XAM</a>':'');
  var v=shell('xres','rm'+(gold?' gold':''),h+'<div class="xbot">'+cta+'</div>');
  var rm=$('#rsRem',v); if(rm)rm.onclick=function(){ openRemedial(d); };
  var rv=$('#rsRv',v); if(rv)rv.onclick=function(){ openReview(d); };
}
function openRemedial(d){ var q=(d.remedialQueue&&d.remedialQueue.length?d.remedialQueue:(d.results||[]).filter(function(x){return x.status!=='passed'&&(x.attempts||1)<3;}).map(function(x){return x.part;})).slice(), k=kind(d.examType), sel={}; q.forEach(function(p){ sel[p]=1; });
  var paint=function(){ return '<span class="ln">เลือกพาร์ตที่ต้องการสอบซ่อม</span> <span class="ln">มีเวลา 120 นาที</span><div style="display:flex;flex-direction:column;gap:8px;margin-top:14px;text-align:left">'+q.map(function(p){ return '<button type="button" class="xck'+(sel[p]?' on':'')+'" data-rp="'+p+'" style="border:1px solid #e2e8f0;border-radius:12px;padding:12px;color:#0f172a;font-size:14px"><i>'+(sel[p]?sv('check',12,'#fff',3):'')+'</i><span>'+esc(pname(k,p))+'</span></button>'; }).join('')+'</div>'; };
  A.sheet('สอบซ่อม',paint(),'<button class="btn" type="button" id="rmGo">เริ่มสอบซ่อม</button>');
  var box=document.querySelector('.sheet p'); var bind=function(){ $$('[data-rp]',box).forEach(function(b){ b.onclick=function(){ var p=+b.dataset.rp; if(sel[p])delete sel[p]; else sel[p]=1; box.innerHTML=paint(); bind(); }; }); }; if(box)bind();
  var g=$('#rmGo'); if(g)g.onclick=function(){ var parts=q.filter(function(p){return sel[p];}); if(!parts.length){ toast('เลือกอย่างน้อย 1 พาร์ต'); return; } g.disabled=true; g.textContent='กำลังเปิดข้อสอบ…';
    api('/api/xv/remedial/start',{method:'POST',body:{sessionId:d.id,token:d.token,parts:parts}}).then(function(j){
      if(j.ok){ var bg=document.querySelector('.sheet-bg'); if(bg)bg.remove(); delete RES[d.id]; startSession({sessionId:d.id,token:d.token,parts:j.parts,durationSec:j.durationSec,paper:j.paper,examType:j.examType||d.examType,phase:'remedial',mode:d.mode}); location.hash='#xroom'; return; }
      g.disabled=false; g.textContent='เริ่มสอบซ่อม'; toast('เปิดข้อสอบซ่อมไม่สำเร็จ กรุณาลองใหม่'); }).catch(function(){ g.disabled=false; g.textContent='เริ่มสอบซ่อม'; toast('เชื่อมต่อไม่สำเร็จ'); }); };
}
function openReview(d){ api('/api/xv/review/'+encodeURIComponent(d.id)+'?token='+encodeURIComponent(d.token)).then(function(j){ if(!j.ok){ toast('ยังดูข้อที่ตอบผิดไม่ได้'); return; } var k=kind(d.examType);
    var body=(j.results||[]).filter(function(r){return (r.wrongIds||[]).length;}).map(function(r){ return '<b style="display:block;margin-top:12px;color:#0f172a">'+esc(pname(k,r.part))+'</b>'+(r.wrongIds||[]).map(function(n,i){ return '<span style="display:block;margin-top:6px;text-align:left">ข้อ '+n+'. '+esc((r.questions||[])[i]||'')+'</span>'; }).join(''); }).join('')||'ไม่มีข้อที่ตอบผิด';
    A.sheet('ข้อที่ตอบผิด','<span style="display:block;max-height:55vh;overflow:auto;text-align:left">'+body+'</span>'); }).catch(function(){ toast('เชื่อมต่อไม่สำเร็จ'); }); }

/* ---------- ส่งออกให้ app.html ---------- */
var R={xr:renderLanding,xrform:renderForm,xrpay:renderPay,xrdone:renderDone,xrstat:renderStatus,xrticket:renderTicket,xrstamped:renderStamped,xsel:renderSelect,xver:renderVerify,xrules:renderRules,xroom:renderRoom,xres:renderResult};
window.CXEXAM={ views:Object.keys(R),
  render:function(sec,id){ if(sec!=='xroom'&&SS&&!SS.submitting){ setGuards(false); } if(sec!=='xres')clearInterval(RPOLL); if(sec!=='xver'){ OTP=''; OTPOK=false; } R[sec](id); },
  leaving:function(){ if(SS)setGuards(false); },
  live:function(){ return EX&&EX.live; },
  clear:function(){ endRoom(); RG={}; XR=null; RES={}; EX=null; } };
})();

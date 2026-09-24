/* CloverX Member App: คืนสินค้า / คืนเงิน ในแอป (ตาม Figma screen-order-list 118:11 ถึง screen-tracking 118:315)
   ใช้ระบบคืนสินค้าเดิม (/api/returns*) ยืนยันตัวตนด้วยบัญชีสมาชิกที่ล็อกอินอยู่ ยอดคืนเงินคิดที่เซิร์ฟเวอร์ */
(function(){
var A=window.CXAPP; if(!A)return;
var $=function(s,r){return (r||document).querySelector(s);}, $$=function(s,r){return [].slice.call((r||document).querySelectorAll(s));};
var esc=A.esc, api=A.api, toast=A.toast, baht=A.baht;
/* เบอร์ผู้รับพัสดุส่งคืน (ยืนยันโดยทีม) — คนละเบอร์กับเบอร์บริษัท 065-514-6576 */
var ADDR={name:'บริษัท โคลเวอร์เอ็กซ์ (ไทยแลนด์) จำกัด',line:'762/84 หมู่บ้านเดอะปาล์ม (ภัสสร 37) ซอยพัฒนาการ 38 แขวงสวนหลวง เขตสวนหลวง กรุงเทพมหานคร 10250',tel:'062-593-0641'};
/* ข้อความที่บันทึก (reason) ต้องตรงกับระบบเดิม หลังบ้านจัดกลุ่มจากข้อความนี้ ส่วน label คือข้อความที่แสดงตามแบบ */
var REASONS=[{r:'คืนสินค้าตามเงื่อนไขบริษัทฯ',l:'คืนสินค้าตามเงื่อนไขบริษัทฯ'},{r:'คืนสินค้าชำรุด เสียหาย',l:'คืนสินค้าชำรุด เสียหาย หรือใช้งานไม่ได้'},{r:'ได้รับสินค้าไม่ครบ',l:'ได้รับสินค้าไม่ครบถ้วน หรือไม่ตรงตามคำสั่งซื้อ'},{r:'เปลี่ยนใจ ไม่ต้องการสินค้าแล้ว',l:'เปลี่ยนใจ ไม่ต้องการสินค้าแล้ว'},{r:'อื่น ๆ (โปรดระบุ)',l:'อื่นๆ (ระบุเหตุผลเพิ่มเติมด้านล่าง)',other:1}];
var CARRIERS=[['ไปรษณีย์ไทย (EMS)','ไปรษณีย์ไทย (แนะนำ)'],['Flash Express','Flash Express'],['Kerry Express','Kerry Express']];
var BANKS=['ธนาคารกสิกรไทย (K-Bank)','ธนาคารไทยพาณิชย์ (SCB)','ธนาคารกรุงเทพ (BBL)','ธนาคารกรุงไทย (KTB)','ธนาคารกรุงศรีอยุธยา (BAY)','ธนาคารทหารไทยธนชาต (ttb)','ธนาคารออมสิน (GSB)','ธนาคารเพื่อการเกษตรและสหกรณ์ (ธ.ก.ส.)','ธนาคารยูโอบี (UOB)','ธนาคารซีไอเอ็มบี ไทย (CIMB)','ธนาคารเกียรตินาคินภัทร (KKP)','ธนาคารแลนด์ แอนด์ เฮ้าส์ (LH Bank)','ธนาคารอาคารสงเคราะห์ (ธอส.)','อื่น ๆ'];
var ST={awaiting_shipment:['รอจัดส่งสินค้าคืน','w'],in_transit:['กำลังส่งคืน รอตรวจรับ','b'],refund_review:['รออนุมัติคืนเงิน','b'],refunded:['คืนเงินสำเร็จ','g'],rejected:['ปฏิเสธการรับคืน','r'],cancelled:['ยกเลิกแล้ว','m'],wait:['รอการปรับปรุงระบบ','m']};
var THM=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function bkk(iso){ var d=new Date(iso); if(isNaN(d))return null; return new Date(d.getTime()+7*3600000); }
function dTH(iso){ var b=bkk(iso); return b?(b.getUTCDate()+' '+THM[b.getUTCMonth()]+' '+(b.getUTCFullYear()+543)):''; }
function dtTH(iso){ var b=bkk(iso); return b?(dTH(iso)+' - '+('0'+b.getUTCHours()).slice(-2)+':'+('0'+b.getUTCMinutes()).slice(-2)+' น.'):''; }
function money(n){ return '฿'+baht(Math.round(Number(n)||0)); }

var I={
  chevL:'<path d="m15 18-6-6 6-6"/>', alert:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  file:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  check:'<path d="M20 6 9 17l-5-5"/>', cam:'<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  copy:'<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>', x:'<path d="M18 6 6 18M6 6l12 12"/>',
  clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', chevD:'<path d="m6 9 6 6 6-6"/>', truck:'<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>'
};
function sv(n,s,c,w){ return '<svg width="'+s+'" height="'+s+'" viewBox="0 0 24 24" fill="none" stroke="'+(c||'currentColor')+'" stroke-width="'+(w||2)+'" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+I[n]+'</svg>'; }
function img(nm){ nm=String(nm||''); var blk=/ดำ|black/i.test(nm);
  if(/triple/i.test(nm))return blk?'/cx-triple-black.jpg':'/cx-triple-cream.jpg'; if(/duo|คู่/i.test(nm))return '/cx-duo.jpg';
  if(/routine/i.test(nm))return '/cx-routinex.jpg'; if(/scale/i.test(nm)&&!/band/i.test(nm))return '/cx-scale.jpg';
  if(/family|ครอบครัว/i.test(nm))return '/xr-prod-fam-band.jpg'; if(/band/i.test(nm))return /ครีม|cream|เงิน|silver/i.test(nm)?'/cx-band-cream.jpg':'/cx-band-black.jpg';
  if(/polo|โปโล/i.test(nm))return '/polo.jpg'; return ''; }
function clean(nm){ return String(nm||'').replace(/\s*[—–]\s*[\d,]+\s*(บาท)?\s*$/,'').replace(/\s*[·•]\s*/g,' ').trim(); }

/* ---------- CSS ---------- */
var css=''
+'.rv{min-height:100vh;min-height:100dvh;background:#f8fafc;display:flex;flex-direction:column;color:#0f172a}'
+'.rv .top{flex:1}.rv.tab{padding-bottom:calc(var(--tab) + 28px + env(safe-area-inset-bottom))}'
+'.rhd{position:sticky;top:0;z-index:10;background:#fff;border-bottom:1px solid #e2e8f0;height:48px;display:flex;align-items:center;gap:8px;padding:0 16px}'
+'.rhd a{width:24px;height:24px;display:grid;place-items:center;color:#0f172a;flex:none}.rhd h1{margin:0;font-size:18px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
+'.rbd{padding:16px;display:flex;flex-direction:column;gap:16px}'
+'.ralert{display:flex;align-items:center;gap:8px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:11px 12px;font-size:12px;font-weight:500;color:#d97706;line-height:1.4}'
+'.ralert.off{background:#fef2f2;border-color:#fecaca;color:#dc2626}'
+'.rnote{display:flex;gap:8px;align-items:flex-start;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:11px 12px;font-size:12px;color:#1e40af;line-height:1.5}'
+'.rc{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:15px;display:flex;flex-direction:column;gap:12px}'
+'.rc h3{margin:0;font-size:13px;font-weight:700}.rc h3.b{font-size:14px}.rc .sub{font-size:11px;color:#64748b;margin-top:-8px;line-height:1.5}'
+'.rhr{height:1px;background:#e2e8f0}'
+'.rmeta{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.rmeta b{display:block;font-size:12px}.rmeta small{display:block;font-size:11px;color:#64748b;margin-top:3px}'
+'.rtag{flex:none;border-radius:4px;padding:4px 8px;font-size:10px;font-weight:700;white-space:nowrap}.rtag.g{background:#ecfdf5;color:#059669}.rtag.w{background:#fffbeb;color:#d97706}.rtag.b{background:#eff6ff;color:#2563eb}.rtag.m{background:#f1f5f9;color:#64748b}.rtag.r{background:#fef2f2;color:#dc2626}'
+'.rpill{display:inline-flex;align-items:center;gap:6px;border-radius:10px;padding:3px 10px;font-size:10px;font-weight:600;white-space:nowrap}.rpill i{width:6px;height:6px;border-radius:3px;background:currentColor}'
+'.rpill.w{background:#fff9eb;color:#8c610a}.rpill.b{background:#eff6ff;color:#1d4ed8}.rpill.g{background:#ecfdf5;color:#047857}.rpill.r{background:#fef2f2;color:#b91c1c}.rpill.m{background:#f1f5f9;color:#475569}'
+'.rit{display:flex;gap:12px;align-items:center}.rit .im{width:64px;height:64px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc center/contain no-repeat;flex:none}'
+'.rit .m{flex:1;min-width:0}.rit b{display:block;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rit small{display:block;font-size:11px;color:#64748b;margin-top:4px}'
+'.rit .pr{display:flex;justify-content:space-between;gap:8px;margin-top:4px;font-size:12px;color:#64748b}.rit .pr b{display:inline;font-size:13px;color:#0f172a}.rit .pr .inc{color:#059669;font-weight:700}'
+'.rtot{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:#64748b}.rtot b{font-size:16px;font-weight:800;color:#ef4444;font-variant-numeric:tabular-nums}.rtot b.bl{color:#3b82f6}'
+'.rbtn{height:44px;border-radius:22px;background:linear-gradient(90deg,#1e3a8a,#3b82f6);color:#fff;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;width:100%;text-align:center;padding:0 12px}'
+'.rbtn:disabled{opacity:.45}.rbtn.ol{background:#fff;border:1px solid #e2e8f0;color:#0f172a}.rbtn.sm{height:36px;border-radius:18px;font-size:13px;font-weight:600;width:auto;align-self:flex-start;padding:0 36px}'
+'.rbot{position:sticky;bottom:0;z-index:9;background:#fff;border-top:1px solid #e2e8f0;padding:15px 16px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:10px}'
+'.rref{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:11px;font-size:13px;font-weight:600}'
+'.ropt{display:flex;flex-direction:column}.ropt button{display:flex;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid #f1f5f9;text-align:left;font-size:13px;font-weight:500;color:#0f172a}.ropt button:last-child{border-bottom:0}'
+'.ropt button i{width:18px;height:18px;border-radius:9px;border:1.5px solid #64748b;flex:none;display:grid;place-items:center}.ropt button.on{font-weight:700}.ropt button.on i{border-color:#3b82f6}.ropt button.on i:after{content:"";width:10px;height:10px;border-radius:5px;background:#3b82f6}'
+'.ropt.sm button{padding:10px 0}.ropt.sm button i{width:16px;height:16px;border-radius:8px}.ropt.sm button.on i:after{width:8px;height:8px}'
+'.rta{width:100%;min-height:80px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;padding:10px 11px;font:inherit;font-size:13px;resize:vertical;outline:none}.rta:focus,.rin:focus{border-color:#3b82f6;background:#fff}'
+'.rck{display:flex;align-items:center;gap:12px;text-align:left;width:100%}.rck>i{width:18px;height:18px;border-radius:4px;border:1.5px solid #94a3b8;flex:none;display:grid;place-items:center;color:#fff}.rck.on>i{background:#3b82f6;border-color:#3b82f6}'
+'.rck .t{font-size:13px;font-weight:700}'
+'.rck.dis{opacity:.62}.rck.dis>i{background:#e2e8f0;border-color:#cbd5e1}.rfrom{display:block;margin-top:2px;font-size:12px;color:#64748b;font-weight:500}.rpart{display:block;margin-top:3px;font-size:11.5px;color:#1d4ed8;font-weight:600}.rpart.no{color:#b91c1c;font-weight:500}.rit .pr .inc.no{color:#b91c1c}'
+'.rf{display:flex;flex-direction:column;gap:6px}.rf label{font-size:11px;font-weight:700;color:#64748b}'
+'.rin{height:40px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;padding:0 11px;font:inherit;font-size:13px;color:#0f172a;width:100%;outline:none}'
+'.rsel{position:relative}.rsel select{appearance:none;-webkit-appearance:none;padding-right:34px;background:#fff;border-color:#3b82f6}.rsel span{position:absolute;right:11px;top:12px;pointer-events:none;color:#0f172a}'
+'.rgrid{display:grid;grid-template-columns:repeat(4,70px);gap:10px}@media(max-width:360px){.rgrid{grid-template-columns:repeat(3,70px)}}'
+'.rgrid>*{width:70px;height:70px;border-radius:8px;border:1px dashed #e2e8f0;background:#f8fafc;position:relative;overflow:hidden}'
+'.rgrid .add{border-color:#3b82f6;display:flex;align-items:center;justify-content:center;gap:3px;color:#3b82f6;font-size:10px;font-weight:700}'
+'.rgrid img{width:100%;height:100%;object-fit:cover}.rgrid .del{position:absolute;right:3px;top:3px;width:20px;height:20px;border-radius:10px;background:rgba(15,23,42,.65);color:#fff;display:grid;place-items:center}'
+'.raddr .h{display:flex;justify-content:space-between;align-items:center;gap:8px}.raddr .cp{display:flex;align-items:center;gap:4px;border:1px solid #e2e8f0;background:#f8fafc;border-radius:4px;padding:3px 7px;font-size:10px;font-weight:700;color:#3b82f6}'
+'.raddr b.n{font-size:12px}.raddr p{margin:-6px 0 0;font-size:12px;color:#64748b;line-height:1.4}'
+'.rok{display:flex;flex-direction:column;align-items:center;gap:12px;padding:32px 20px 16px;text-align:center}'
+'.rok .c{width:64px;height:64px;border-radius:32px;border:2px solid #10b981;background:#ecfdf5;display:grid;place-items:center}'
+'.rok h2{margin:0;font-size:20px;font-weight:800}.rok .no{border:1px solid #e2e8f0;background:#f8fafc;border-radius:20px;padding:5px 11px;font-size:12px;font-weight:700;color:#1e3a8a}'
+'.rkv{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#64748b}.rkv b{color:#0f172a;text-align:right}'
+'.rguide{background:#f1f5f9;border-radius:8px;padding:12px;font-size:11px;color:#64748b;line-height:1.5;display:flex;flex-direction:column;gap:4px}.rguide b{color:#475569}'
+'.rbig small{display:block;font-size:11px;color:#64748b}.rbig b{display:block;font-size:22px;font-weight:800;color:#3b82f6;margin-top:2px;font-variant-numeric:tabular-nums}'
+'.rtk{display:flex;gap:8px}.rtk .rin{flex:1;min-width:0}.rtk button{height:40px;border-radius:8px;background:#1e3a8a;color:#fff;font-size:12px;font-weight:700;padding:0 14px;flex:none}.rtk button:disabled{opacity:.5}'
+'.rtl{display:flex;flex-direction:column}.rtl div{position:relative;display:flex;gap:12px;padding-bottom:14px}.rtl div:last-child{padding-bottom:0}'
+'.rtl div:before{content:"";position:absolute;left:7px;top:16px;bottom:0;width:2px;background:#e2e8f0}.rtl div:last-child:before{display:none}'
+'.rtl i{width:16px;height:16px;border-radius:8px;background:#e2e8f0;flex:none;margin-top:1px;position:relative;z-index:1}.rtl div:first-child i{background:#fff;border:4px solid #3b82f6}'
+'.rtl b{display:block;font-size:13px}.rtl div:first-child b{color:#3b82f6}.rtl small{display:block;font-size:11px;color:#64748b;margin-top:3px;line-height:1.4}.rtl em{display:block;font-style:normal;font-size:10px;color:#64748b;margin-top:3px}'
+'.rcancel{align-self:center;font-size:13px;font-weight:700;color:#ef4444;text-decoration:underline;padding:8px}'
+'.rempty{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px 16px;text-align:center;font-size:14px;color:#64748b;line-height:1.6}'
+'.rerr{color:#dc2626;font-size:13px}.rerr:empty{display:none}'
/* แท็บคืนเงินในหน้าคำสั่งซื้อ (121:81) */
+'.rwarn{display:flex;align-items:center;gap:8px;background:#fff9eb;border:1px solid #f2d98c;border-radius:8px;padding:12px 11px;font-size:12px;font-weight:500;color:#8c610a}'
+'.rwarn.off{background:#fef2f2;border-color:#fecaca;color:#b91c1c}'
+'.ract{background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.06);padding:16px;display:flex;flex-direction:column;gap:10px}.ract b{font-size:16px}.ract p{margin:0;font-size:13px;color:#708091;line-height:1.5}'
+'.rsec{margin:4px 0 -4px;font-size:14px;font-weight:600;color:#0f172a}'
+'.rreq{display:block;background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.06);padding:14px 16px;color:inherit}.rreq .h{display:flex;justify-content:space-between;align-items:center;gap:8px}.rreq .h b{font-size:13px;font-weight:600}'
+'.rreq .it{font-size:12px;color:#708091;margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rreq .f{display:flex;justify-content:space-between;align-items:flex-end;margin-top:4px}.rreq .f small{font-size:11px;color:#94a3b8}.rreq .f b{font-size:16px;font-weight:700;color:#2563eb;font-variant-numeric:tabular-nums}';
var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

/* ---------- ข้อมูล ---------- */
var D=null, dAt=0;
function load(force){ if(D&&!force&&Date.now()-dAt<15000)return Promise.resolve(D);
  return api('/api/m/returns').then(function(j){ if(j._s===401){ A.logout(); throw new Error('auth'); } if(!j.ok)throw new Error('fail'); D=j; dAt=Date.now(); return j; }); }
function ord(id){ return ((D&&D.orders)||[]).filter(function(o){return o.id===id;})[0]; }
function ret(rid){ return ((D&&D.myReturns)||[]).filter(function(r){return r.rid===rid;})[0]; }
function activeFor(oid){ return ((D&&D.myReturns)||[]).filter(function(r){ return r.orderId===oid&&r.status!=='cancelled'; })[0]; }
function me(){ return (D&&D.me)||{}; }
function idBody(extra){ var m=me(); return Object.assign({phone:m.phone,email:m.email,name:m.name},extra||{}); }
function deadline(){ return D&&D.returnDeadline?(dTH(D.returnDeadline)+' เวลา '+(function(){ var b=bkk(D.returnDeadline); return b?('0'+b.getUTCHours()).slice(-2)+':'+('0'+b.getUTCMinutes()).slice(-2):'23:59'; })()+' น.'):'28 ก.ย. 2569 เวลา 23:59 น.'; }
function isOpen(){ return !D||D.returnOpen!==false; }
function sets(o){ return (o&&o.sets)||[]; }
function setPrice(s){ return Number(s.refund)||0; }
/* ยอดคืนตามราคาที่ชำระจริงของแต่ละรายการ ไม่เฉลี่ย / RoutineX คืนไม่ได้ทุกกรณี
   เซตที่มี RoutineX คืนได้เฉพาะชิ้นอื่นในเซต (เช่น TRIPLE คืน Band + Scale ได้ ฿4,990) */
function retParts(s){ var cs=s.comps||[], ok=cs.filter(function(c){return c.returnable!==false&&c.key!=='routinex';}), hasR=cs.some(function(c){return c.key==='routinex';});
  return {ok:ok.map(function(c){return clean(c.label||c.key);}), hasR:hasR}; }
function shortSet(nm){ return String(nm||'').replace(/\s*[\(·].*$/,'').toLowerCase().replace(/(^|\s)\S/g,function(m){return m.toUpperCase();}); }
function groups(o){ return sets(o).map(function(s,i){ var nm=clean(s.nm), p=retParts(s), able=s.returnable!==false&&setPrice(s)>0;
  return {si:s.si!=null?s.si:i,name:s.nm,disp:nm,key:'set',price:able?setPrice(s):0,img:img(nm),able:able,
    part:(able&&p.hasR)?p.ok.join(' + '):'', from:(able&&p.hasR)?('จาก '+shortSet(s.nm)):'', why:able?'':'รับคืนเฉพาะ Xircle Band และ Xircle Scale'}; }); }
function ableIdx(gs){ var r=[]; gs.forEach(function(g,i){ if(g.able)r.push(i); }); return r; }
var CUR=null; /* {oid, reason, other, sel:{i:true}, acct:{name,bank,no}, ev:[], carrier} */
function hd(t,back){ return '<div class="rhd"><a href="'+back+'" aria-label="กลับ">'+sv('chevL',22,'#0f172a',2.2)+'</a><h1>'+esc(t)+'</h1></div>'; }
function shell(id,html,tab){ var v=$('#v-'+id); v.className='view rv'+(tab?' tab':'')+(v.classList.contains('hide')?' hide':''); v.innerHTML=html; return v; }
function wait(id,t,back){ shell(id,hd(t,back)+'<div class="rbd"><div class="rempty">กำลังโหลด…</div></div>'); }
function fail(id,t,back,msg){ shell(id,hd(t,back)+'<div class="rbd"><div class="rempty">'+(msg||'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่')+'</div></div>'); }
function pill(s){ var x=ST[s]||[s||'-','m']; return '<span class="rpill '+x[1]+'"><i></i>'+esc(x[0])+'</span>'; }
function itemsText(r){ return (r.items||[]).map(function(it){ var cs=(it.comps||[]).map(clean); return (cs.length&&/routine/i.test(it.name||''))?(cs.join(' + ')+' (จาก '+shortSet(it.name)+')'):clean(it.name); }).join(', ')||'รอการปรับปรุงระบบ'; }
function alertBar(cls){ return isOpen()?'<div class="'+(cls||'ralert')+'">'+sv('alert',16)+'<span>ยื่นคำขอภายในวันที่ '+esc(deadline())+'</span></div>'
  :'<div class="'+(cls||'ralert')+' off">'+sv('alert',16)+'<span>หมดเขตยื่นคำขอคืนสินค้าแล้ว (ภายในวันที่ '+esc(deadline())+')</span></div>'; }
var SHIPNOTE='<div class="rnote">'+sv('truck',16,'#1d4ed8')+'<span><span class="ln">ลูกค้าเป็นผู้ชำระค่าจัดส่งคืนสินค้าเอง</span> <span class="ln">บริษัทฯ ไม่ได้สำรองหรือคืนค่าจัดส่ง</span></span></div>';

/* ---------- แท็บ "คืนเงิน" ในหน้าคำสั่งซื้อ (121:81) ---------- */
function refundTab(){ if(!D)return '<div class="rempty">กำลังโหลด…</div>';
  if(!(D.orders||[]).length&&!(D.myReturns||[]).length)return '<div class="rempty"><span class="ln">ไม่พบคำสั่งซื้อที่คืนสินค้าได้</span><br><span class="ln">หากคิดว่าข้อมูลไม่ถูกต้อง ติดต่อ LINE @cloverxth</span></div>';
  var mine=(D.myReturns||[]).filter(function(r){return r.status!=='cancelled';});
  return '<div style="display:flex;flex-direction:column;gap:12px">'+alertBar('rwarn')
    +'<div class="ract"><b>คืนสินค้า / คืนเงิน</b><p><span class="ln">หากต้องการคืนสินค้าหรือขอคืนเงิน</span><br><span class="ln">กดปุ่มด้านล่างเพื่อเริ่มกระบวนการ</span></p><a class="rbtn sm" href="#rtlist">ดำเนินการคืนสินค้า</a></div>'
    +(mine.length?'<div class="rsec">คำขอคืนสินค้าของคุณ</div>'+mine.map(function(r){ return '<a class="rreq" href="#rttrack/'+esc(r.rid)+'"><div class="h"><b>'+esc(r.rid)+'</b>'+pill(r.status)+'</div><div class="it">'+esc(itemsText(r))+'</div><div class="f"><small>'+esc(dTH(r.at))+'</small>'+(r.choice==='wait'?'':'<b>'+money(r.amount)+'</b>')+'</div></a>'; }).join(''):'')
    +'</div>'; }

/* ---------- 118:11 เลือกคำสั่งซื้อ ---------- */
function renderList(){ wait('rtlist','คืนสินค้า / คืนเงิน','#orders');
  load(true).then(function(){ var os=D.orders||[];
    var h='<div class="top">'+hd('คืนสินค้า / คืนเงิน','#orders')+'<div class="rbd">'+alertBar();
    if(!os.length) h+='<div class="rempty"><span class="ln">ไม่พบคำสั่งซื้อที่คืนสินค้าได้</span><br><span class="ln">หากคิดว่าข้อมูลไม่ถูกต้อง ติดต่อ LINE @cloverxth</span></div>';
    os.forEach(function(o){ var ar=activeFor(o.id), gs=sets(o), shipOk=/deliver|success|done|complete|ส่งแล้ว|สำเร็จ/i.test(o.ship||'');
      h+='<div class="rc"><div class="rmeta"><div><b>หมายเลขคำสั่งซื้อ: '+esc(o.id)+'</b><small>สั่งซื้อเมื่อ: '+esc(dtTH(o.at))+'</small></div><span class="rtag '+(shipOk?'g':'b')+'">'+(shipOk?'จัดส่งสำเร็จ':'ชำระเงินแล้ว')+'</span></div><div class="rhr"></div>'
        +gs.map(function(s){ var nm=clean(s.nm); return '<div class="rit"><span class="im" style="background-image:url(\''+img(nm)+'\')"></span><div class="m"><b>'+esc(nm)+'</b><small>'+(setPrice(s)>0?('ยอดคืนได้ '+money(setPrice(s))):'คืนไม่ได้')+'</small></div></div>'; }).join('')
        +'<div class="rhr"></div><div class="rtot"><span>ยอดรวมทั้งหมด ('+gs.length+' รายการสินค้า)</span><b>'+money(o.total)+'</b></div>'
        +(ar?'<div class="rtot"><span>คำขอ '+esc(ar.rid)+'</span>'+pill(ar.status)+'</div><a class="rbtn" href="#rttrack/'+esc(ar.rid)+'">ติดตามสถานะ</a>'
          :(gs.some(function(s){return setPrice(s)>0;})?'<button type="button" class="rbtn" data-go="'+esc(o.id)+'"'+(isOpen()?'':' disabled')+'>ขอคืนสินค้า / คืนเงิน</button>':'<div class="rpart no" style="text-align:center;font-size:12.5px"><span class="ln">คำสั่งซื้อนี้ไม่มีรายการที่รับคืนได้</span> <span class="ln">(รับคืนเฉพาะ Xircle Band และ Xircle Scale)</span></div>')+'<button type="button" class="rbtn ol" data-wait="'+esc(o.id)+'">รับสินค้าไว้ รอการปรับปรุงระบบ</button>')
        +'</div>'; });
    var v=shell('rtlist',h+'</div></div>');
    $$('[data-go]',v).forEach(function(b){ b.onclick=function(){ CUR={oid:b.dataset.go,reason:'',other:'',sel:null,acct:{name:me().name||'',bank:BANKS[0],no:''},ev:[],carrier:CARRIERS[0][0]}; location.hash='#rtreason'; }; });
    $$('[data-wait]',v).forEach(function(b){ b.onclick=function(){ askWait(b.dataset.wait); }; });
  }).catch(function(){ fail('rtlist','คืนสินค้า / คืนเงิน','#orders'); }); }
function askWait(oid){ A.sheet('รอการปรับปรุงระบบ','<span class="ln">ปรับปรุงระบบถึง 31 ตุลาคม 2569</span> <span class="ln">บริษัทขอเวลาปรับปรุงและพัฒนา Application</span> <span class="ln">เพื่อยกระดับระบบให้ดียิ่งขึ้น</span><br><br><span class="ln">ท่านจะยังได้รับสินค้าตามคำสั่งซื้อเดิม</span> <span class="ln">และเราจะแจ้งความคืบหน้าเมื่อระบบพร้อม</span>','<button class="btn" type="button" id="rwGo">ยืนยันรอการปรับปรุง</button>');
  var g=$('#rwGo'); if(g)g.onclick=function(){ g.disabled=true; g.textContent='กำลังบันทึก…';
    api('/api/returns',{method:'POST',body:idBody({orderId:oid,choice:'wait',source:'app'})}).then(function(j){ var bg=document.querySelector('.sheet-bg'); if(bg)bg.remove();
      if(j.ok){ D=null; toast('บันทึกการรอปรับปรุงแล้ว'); location.hash='#rttrack/'+j.rid; } else toast('บันทึกไม่สำเร็จ กรุณาลองใหม่'); }).catch(function(){ g.disabled=false; g.textContent='ยืนยันรอการปรับปรุง'; toast('เชื่อมต่อไม่สำเร็จ'); }); }; }
function need(){ if(!CUR||!ord(CUR.oid)){ location.replace('#rtlist'); return false; } return true; }

/* ---------- 118:71 เหตุผล ---------- */
function renderReason(){ if(!need())return; var o=ord(CUR.oid);
  var h='<div class="top">'+hd('เหตุผลการคืนสินค้า','#rtlist')+'<div class="rbd"><div class="rref">'+sv('file',20,'#3b82f6')+'อ้างอิงคำสั่งซื้อ: '+esc(o.id)+'</div>'
    +'<div class="rc"><h3 class="b">กรุณาเลือกเหตุผลที่ต้องการยื่นคำขอคืนเงิน</h3><div class="ropt" role="radiogroup">'+REASONS.map(function(x,i){ return '<button type="button" role="radio" aria-checked="'+(CUR.reason===x.r)+'" class="'+(CUR.reason===x.r?'on':'')+'" data-r="'+i+'"><i></i><span>'+esc(x.l)+'</span></button>'; }).join('')+'</div>'
    +(CUR.reason===REASONS[4].r?'<textarea class="rta" id="rsOther" maxlength="200" placeholder="ระบุเหตุผลเพิ่มเติม">'+esc(CUR.other)+'</textarea>':'')+'</div></div></div>'
    +'<div class="rbot"><button type="button" class="rbtn" id="rsGo">ถัดไป</button></div>';
  var v=shell('rtreason',h), ok=function(){ return CUR.reason&&(CUR.reason!==REASONS[4].r||CUR.other.trim()); };
  $('#rsGo',v).disabled=!ok();
  $$('[data-r]',v).forEach(function(b){ b.onclick=function(){ CUR.reason=REASONS[+b.dataset.r].r; renderReason(); var t=$('#rsOther'); if(t)t.focus(); }; });
  var t=$('#rsOther',v); if(t)t.oninput=function(){ CUR.other=t.value; $('#rsGo',v).disabled=!ok(); };
  $('#rsGo',v).onclick=function(){ if(ok())location.hash='#rtitems'; }; }

/* ---------- 118:120 เลือกรายการ ---------- */
function renderItems(){ if(!need())return; if(!CUR.reason){ location.replace('#rtreason'); return; } var gs=groups(ord(CUR.oid));
  var ai=ableIdx(gs);
  if(!CUR.sel){ CUR.sel={}; ai.forEach(function(i){ CUR.sel[i]=true; }); }
  var n=ai.filter(function(i){return CUR.sel[i];}).length, sum=ai.reduce(function(a,i){ return a+(CUR.sel[i]?gs[i].price:0); },0), all=ai.length>0&&n===ai.length;
  var h='<div class="top">'+hd('เลือกรายการสินค้า','#rtreason')+'<div class="rbd"><div style="font-size:13px;color:#64748b">เลือกสินค้าที่ต้องการส่งคืนเพื่อรับยอดเงินคืน</div>'
    +'<div class="rc"><button type="button" class="rck'+(all?' on':'')+'" id="riAll" role="checkbox" aria-checked="'+all+'"><i>'+(all?sv('check',11,'#fff',3.5):'')+'</i><span class="t">เลือกทั้งหมด ('+ai.length+' รายการ)</span></button>'
    +gs.map(function(g,i){ var on=g.able&&!!CUR.sel[i];
      var body='<span class="rit" style="flex:1;min-width:0"><span class="im" style="background-image:url(\''+g.img+'\')"></span><span class="m"><b>'+esc(g.part||g.disp)+'</b>'+(g.from?'<small class="rfrom">'+esc(g.from)+'</small>':'')+'<span class="pr"><span>จำนวน: 1</span>'+(g.able?'<b>'+money(g.price)+'</b>':'<span class="inc no">คืนไม่ได้</span>')+'</span>'+(g.why?'<small class="rpart no">'+esc(g.why)+'</small>':'')+'</span></span>';
      return '<div class="rhr"></div>'+(g.able?'<button type="button" class="rck'+(on?' on':'')+'" data-i="'+i+'" role="checkbox" aria-checked="'+on+'"><i>'+(on?sv('check',11,'#fff',3.5):'')+'</i>'+body+'</button>'
        :'<div class="rck dis" aria-disabled="true"><i></i>'+body+'</div>'); }).join('')
    +'<div class="rhr"></div><div class="rpart no" style="font-size:12px;line-height:1.6"><span class="ln">รับคืนเฉพาะ Xircle Band และ Xircle Scale</span> <span class="ln">RoutineX คืนไม่ได้ทุกกรณี</span> <span class="ln">เซตที่มี RoutineX ให้เก็บ RoutineX ไว้</span></div>'
    +'</div></div></div><div class="rbot"><div class="rtot" style="font-size:13px;font-weight:500"><span>ยอดเงินคืนที่จะได้รับทั้งหมด:</span><b style="font-size:18px">'+money(sum)+'</b></div><button type="button" class="rbtn" id="riGo"'+(n?'':' disabled')+'>ถัดไป</button></div>';
  var v=shell('rtitems',h);
  $('#riAll',v).onclick=function(){ ai.forEach(function(i){ CUR.sel[i]=!all; }); renderItems(); };
  $$('[data-i]',v).forEach(function(b){ b.onclick=function(){ var i=+b.dataset.i; CUR.sel[i]=!CUR.sel[i]; renderItems(); }; });
  $('#riGo',v).onclick=function(){ location.hash='#rtsum'; }; }
function selItems(){ var gs=groups(ord(CUR.oid)); return gs.filter(function(g,i){ return g.able&&CUR.sel&&CUR.sel[i]; }); }

/* ---------- 118:167 สรุปการคืนเงิน ---------- */
function renderSum(){ if(!need())return; var o=ord(CUR.oid), items=selItems(); if(!items.length){ location.replace('#rtitems'); return; }
  var sum=items.reduce(function(a,g){return a+g.price;},0), bank=o.pay==='bank', a=CUR.acct;
  var names=items.map(function(g){ return g.part?(g.part+' ('+g.from+')'):g.disp; }).join(', ');
  var h='<div class="top">'+hd('สรุปการคืนเงิน','#rtitems')+'<div class="rbd"><div class="rc"><h3>รายการสินค้าคืน</h3><div class="rit"><span class="im" style="background-image:url(\''+(items[0].img||'')+'\')"></span><div class="m"><b style="font-size:13px;white-space:normal;overflow:visible;text-overflow:clip;line-height:1.45">'+esc(names)+'</b><small>รวม '+items.length+' รายการสินค้า | ส่งคืนทางขนส่ง</small></div></div><div class="rhr"></div><div class="rtot" style="font-size:13px"><span>ยอดเงินคืนประเมิน</span><b class="bl">'+money(sum)+'</b></div></div>';
  if(bank) h+='<div class="rc"><h3>ข้อมูลช่องทางการรับเงินคืน (โอนผ่านธนาคาร)</h3>'
    +'<div class="rf"><label for="saN">ชื่อบัญชีผู้รับเงิน *</label><input class="rin" id="saN" maxlength="80" value="'+esc(a.name)+'"></div>'
    +'<div class="rf"><label for="saB">ธนาคารผู้รับเงิน *</label><div class="rsel"><select class="rin" id="saB">'+BANKS.map(function(b){ return '<option'+(a.bank===b?' selected':'')+'>'+b+'</option>'; }).join('')+'</select><span>'+sv('chevD',16)+'</span></div></div>'
    +'<div class="rf"><label for="saNo">เลขที่บัญชีธนาคาร *</label><input class="rin" id="saNo" inputmode="numeric" maxlength="20" value="'+esc(a.no)+'" placeholder="เลขที่บัญชี"></div><div class="rerr" id="saErr"></div></div>';
  else h+='<div class="rc"><h3>ช่องทางการรับเงินคืน</h3><div style="font-size:13px;line-height:1.6;color:#475569"><span class="ln">คืนเงินเข้าบัตรเครดิต/เดบิตที่ใช้ชำระ</span> <span class="ln">(ไม่สามารถเปลี่ยนช่องทางได้)</span></div></div>';
  h+='</div></div><div class="rbot"><button type="button" class="rbtn" id="saGo">ถัดไป</button></div>';
  var v=shell('rtsum',h);
  $('#saGo',v).onclick=function(){ if(bank){ a.name=$('#saN',v).value.trim(); a.bank=$('#saB',v).value; a.no=$('#saNo',v).value.replace(/[^\d-]/g,'').trim();
      if(!a.name||a.no.replace(/\D/g,'').length<10){ $('#saErr',v).textContent='กรุณากรอกชื่อบัญชีและเลขที่บัญชีให้ครบ (10 หลักขึ้นไป)'; return; } }
    location.hash='#rtevid'; }; }

/* ---------- 118:211 หลักฐาน + ขนส่ง ---------- */
function renderEvid(){ if(!need())return; if(!selItems().length){ location.replace('#rtitems'); return; }
  var ev=CUR.ev, grid='';
  ev.forEach(function(src,i){ grid+='<span><img src="'+src+'" alt="รูปหลักฐาน '+(i+1)+'"><button type="button" class="del" data-del="'+i+'" aria-label="ลบรูป">'+sv('x',12,'#fff',3)+'</button></span>'; });
  if(ev.length<10) grid+='<button type="button" class="add" id="evAdd">'+sv('cam',18,'#3b82f6')+'อัปโหลดรูป</button>';
  for(var k=ev.length+1;k<3;k++) grid+='<span></span>';
  var h='<div class="top">'+hd('แนบหลักฐานการส่งคืน','#rtsum')+'<div class="rbd">'
    +'<div class="rc"><div><h3>ภาพหลักฐานสินค้า/กล่องพัสดุ</h3><div class="sub" style="margin-top:3px">อัปโหลดรูปสินค้าที่จะส่งคืน หรือจุดที่ชำรุดเสียหาย อย่างน้อย 1 ภาพ (สูงสุด 10 ภาพ)</div></div><div class="rgrid">'+grid+'</div></div>'
    +'<div class="rc"><h3>เลือกช่องทางการขนส่งคืน</h3><div class="ropt sm" role="radiogroup">'+CARRIERS.map(function(c){ return '<button type="button" role="radio" aria-checked="'+(CUR.carrier===c[0])+'" class="'+(CUR.carrier===c[0]?'on':'')+'" data-c="'+esc(c[0])+'"><i></i><span>'+esc(c[1])+'</span></button>'; }).join('')+'</div></div>'
    +'<div class="rc raddr"><div class="h"><h3>ที่อยู่สำหรับการส่งคืนสินค้า</h3><button type="button" class="cp" id="evCp">'+sv('copy',12,'#3b82f6')+'คัดลอก</button></div><b class="n">'+ADDR.name+'</b><p>'+ADDR.line+' (โทร. '+ADDR.tel+')</p></div>'
    +SHIPNOTE+'<div class="rerr" id="evErr"></div></div></div><div class="rbot"><button type="button" class="rbtn" id="evGo"'+(ev.length&&isOpen()?'':' disabled')+'>ยื่นคำขอคืนสินค้า</button></div>';
  var v=shell('rtevid',h);
  var add=$('#evAdd',v); if(add)add.onclick=pickPhotos;
  $$('[data-del]',v).forEach(function(b){ b.onclick=function(){ CUR.ev.splice(+b.dataset.del,1); renderEvid(); }; });
  $$('[data-c]',v).forEach(function(b){ b.onclick=function(){ CUR.carrier=b.dataset.c; renderEvid(); }; });
  $('#evCp',v).onclick=function(){ var t=ADDR.name+'\n'+ADDR.line+'\nโทร '+ADDR.tel; try{ navigator.clipboard.writeText(t); toast('คัดลอกที่อยู่แล้ว'); }catch(e){ toast(ADDR.line); } };
  $('#evGo',v).onclick=submit; }
function pickPhotos(){ var f=document.createElement('input'); f.type='file'; f.accept='image/*'; f.multiple=true;
  f.onchange=function(){ var files=[].slice.call(f.files||[]).slice(0,10-CUR.ev.length); var left=files.length; if(!left)return;
    files.forEach(function(file){ var rd=new FileReader(); rd.onload=function(){ var im=new Image(); im.onload=function(){ var s=Math.min(1,1280/Math.max(im.width,im.height)), c=document.createElement('canvas'); c.width=Math.round(im.width*s); c.height=Math.round(im.height*s); c.getContext('2d').drawImage(im,0,0,c.width,c.height); CUR.ev.push(c.toDataURL('image/jpeg',.82)); if(--left<=0)renderEvid(); };
        im.onerror=function(){ if(--left<=0)renderEvid(); }; im.src=rd.result; }; rd.readAsDataURL(file); }); };
  f.click(); }
function submit(){ var b=$('#evGo'), o=ord(CUR.oid), items=selItems(), bank=o.pay==='bank'; if(!CUR.ev.length){ $('#evErr').textContent='กรุณาแนบรูปอย่างน้อย 1 ภาพ'; return; }
  b.disabled=true; b.textContent='กำลังส่งคำขอ…';
  var body=idBody({orderId:o.id,choice:'return',reason:CUR.reason===REASONS[4].r?('อื่น ๆ — '+CUR.other.trim()):CUR.reason,note:CUR.reason===REASONS[4].r?CUR.other.trim():'',evidence:CUR.ev,returnMethod:'dropoff',carrier:CUR.carrier,source:'app',
    selected:items.map(function(g){ return {si:g.si,name:g.name,key:g.key,price:g.price}; }),channel:bank?'bank':'card',refundAccount:bank?{name:CUR.acct.name,bank:CUR.acct.bank,no:CUR.acct.no}:null});
  api('/api/returns',{method:'POST',body:body}).then(function(j){
    if(j.ok){ var rid=j.rid; LAST={rid:rid,items:items,amount:j.amount,bank:bank,acct:CUR.acct,carrier:CUR.carrier}; CUR=null; D=null; location.hash='#rtdone/'+rid; return; }
    b.disabled=false; b.textContent='ยื่นคำขอคืนสินค้า';
    $('#evErr').textContent=j.error==='return_closed'?'หมดเขตยื่นคำขอคืนสินค้าแล้ว':(j.error==='verify_failed'?'ยืนยันเจ้าของคำสั่งซื้อไม่สำเร็จ กรุณาติดต่อ LINE @cloverxth':'ส่งคำขอไม่สำเร็จ กรุณาลองใหม่');
  }).catch(function(){ b.disabled=false; b.textContent='ยื่นคำขอคืนสินค้า'; $('#evErr').textContent='เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่'; }); }
var LAST=null;

/* ---------- 118:269 สำเร็จ ---------- */
function renderDone(rid){ wait('rtdone','ทำรายการสำเร็จ','#orders');
  load(true).then(function(){ var r=ret(rid); if(!r){ fail('rtdone','ทำรายการสำเร็จ','#orders','ไม่พบคำขอนี้'); return; }
    var names=itemsText(r), acct=r.refundAccount||{}, ch=r.channel==='bank'?('โอนเงินคืน'+(acct.bank?(' ('+acct.bank.replace(/^ธนาคาร/,'').replace(/\s*\(.*$/,'')+')'):'')):'คืนเข้าบัตรที่ใช้ชำระ';
    var h='<div class="top">'+hd('ทำรายการสำเร็จ','#orders')+'<div class="rok"><span class="c">'+sv('check',30,'#10b981',2.6)+'</span><h2>ยื่นคำขอสำเร็จ!</h2><span class="no">เลขที่คำขอ: '+esc(r.rid)+'</span>'+pill(r.status)+'</div>'
      +'<div class="rbd" style="padding-top:0"><div class="rc"><h3>รายละเอียดการคืนพัสดุ</h3><div class="rit"><span class="im" style="background-image:url(\''+img(names)+'\')"></span><div class="m"><b style="font-size:13px;white-space:normal;overflow:visible;text-overflow:clip;line-height:1.45">'+esc(names)+'</b><small>รวมส่งคืนทั้งหมด '+(r.items||[]).length+' รายการสินค้า</small></div></div><div class="rhr"></div>'
      +'<div class="rtot"><span>ยอดประเมินคืนเงินทั้งหมด</span><b class="bl">'+money(r.amount)+'</b></div><div class="rkv"><span>ช่องทางการคืนเงิน</span><b>'+esc(ch)+'</b></div></div>'
      +'<div class="rguide"><b>ข้อแนะนำถัดไปสำหรับการจัดส่ง</b><span>1. แพ็กสินค้าทั้งหมดใส่กล่องพัสดุให้ครบถ้วนก่อนส่ง</span><span>2. ส่งพัสดุที่ '+esc((CARRIERS.filter(function(c){return c[0]===r.returnCarrierPlan;})[0]||CARRIERS[0])[1].replace(' (แนะนำ)',''))+' หรือขนส่งที่สะดวก</span><span>3. เมื่อส่งแล้ว แจ้งเลขพัสดุในหน้า "ติดตามสถานะ" ภายในวันที่ '+esc(deadline())+'</span></div></div></div>'
      +'<div class="rbot"><a class="rbtn" href="#rttrack/'+esc(r.rid)+'">ติดตามสถานะการส่งคืน</a><a class="rbtn ol" href="#home">กลับหน้าหลัก</a></div>';
    shell('rtdone',h);
  }).catch(function(){ fail('rtdone','ทำรายการสำเร็จ','#orders'); }); }

/* ---------- 118:315 ติดตามสถานะ ---------- */
function renderTrack(rid){ wait('rttrack','ติดตามสถานะ','#orders');
  load(true).then(function(){ var r=ret(rid); if(!r){ fail('rttrack','ติดตามสถานะ','#orders','ไม่พบคำขอนี้'); return; }
    var acct=r.refundAccount||{}, needAcct=r.channel==='bank'&&!acct.no, plan=r.returnCarrierPlan||CARRIERS[0][0];
    var h='<div class="top">'+hd('ติดตามสถานะ','#orders')+'<div class="rbd">'
      +'<div class="rc"><div class="rmeta"><b style="color:#64748b">หมายเลขคำขอ: '+esc(r.rid)+'</b>'+pill(r.status)+'</div><div class="rhr"></div>'
      +(r.choice==='wait'?'<div style="font-size:13px;color:#475569;line-height:1.6"><span class="ln">ท่านเลือกรับสินค้าไว้</span> <span class="ln">และรอการปรับปรุงระบบ</span> <span class="ln">(ถึง 31 ตุลาคม 2569)</span></div>'
        :'<div class="rbig"><small>ยอดเงินคืนประเมิน</small><b>'+money(r.amount)+'</b></div>')+'</div>';
    if(r.status==='awaiting_shipment'){
      h+='<div class="rc"><h3>แจ้งรายละเอียดผู้ขนส่งพัสดุ</h3><div class="rsel"><select class="rin" id="tkC">'+CARRIERS.map(function(c){ return '<option value="'+esc(c[0])+'"'+(plan===c[0]?' selected':'')+'>'+esc(c[1].replace(' (แนะนำ)',''))+'</option>'; }).join('')+'<option value="J&T Express">J&T Express</option><option value="อื่น ๆ">อื่น ๆ</option></select><span>'+sv('chevD',16)+'</span></div>'
        +(needAcct?'<div class="rf"><label for="tkAn">ชื่อบัญชีรับเงินคืน *</label><input class="rin" id="tkAn" value="'+esc(me().name||'')+'"></div><div class="rf"><label for="tkAb">ธนาคาร *</label><div class="rsel"><select class="rin" id="tkAb">'+BANKS.map(function(b){return '<option>'+b+'</option>';}).join('')+'</select><span>'+sv('chevD',16)+'</span></div></div><div class="rf"><label for="tkAno">เลขที่บัญชี *</label><input class="rin" id="tkAno" inputmode="numeric"></div>':'')
        +'<div class="rtk"><input class="rin" id="tkNo" placeholder="กรอกเลขติดตามพัสดุ (เช่น EX123456789TH)" autocapitalize="characters" maxlength="40"><button type="button" id="tkGo">แจ้งเลขพัสดุ</button></div><div class="rerr" id="tkErr"></div></div>'
        +'<div class="rc raddr"><div class="h"><h3>ที่อยู่สำหรับการส่งคืนสินค้า</h3><button type="button" class="cp" id="tkCp">'+sv('copy',12,'#3b82f6')+'คัดลอก</button></div><b class="n">'+ADDR.name+'</b><p>'+ADDR.line+' (โทร. '+ADDR.tel+')</p></div>'+SHIPNOTE;
    } else if(r.returnTracking){
      h+='<div class="rc"><h3>ข้อมูลการส่งคืน</h3><div class="rkv"><span>เลขพัสดุ</span><b>'+esc(r.returnTracking)+'</b></div>'+(r.returnCarrier?'<div class="rkv"><span>บริษัทขนส่ง</span><b>'+esc(r.returnCarrier)+'</b></div>':'')+(acct.no?'<div class="rkv"><span>บัญชีรับเงินคืน</span><b>'+esc((acct.bank||'')+' '+acct.no)+'</b></div>':'')+'</div>';
    }
    h+='<div class="rc"><h3>ประวัติการทำคำขอ</h3><div class="rtl">'+(r.history||[]).map(function(x){ var t=String(x.text||''), i=t.indexOf(' — '); var ti=i>0?t.slice(0,i):t, de=i>0?t.slice(i+3):'';
        return '<div><i></i><span><b>'+esc(ti.replace(/\s*[·•]\s*/g,' '))+'</b>'+(de?'<small>'+esc(de)+'</small>':'')+'<em>'+esc(dtTH(x.at))+'</em></span></div>'; }).join('')+'</div></div>';
    if(['refunded','rejected','cancelled','in_transit','refund_review'].indexOf(r.status)<0) h+='<button type="button" class="rcancel" id="tkX">ยกเลิกคำขอนี้</button>';
    var v=shell('rttrack',h+'</div></div>');
    var cp=$('#tkCp',v); if(cp)cp.onclick=function(){ try{ navigator.clipboard.writeText(ADDR.name+'\n'+ADDR.line+'\nโทร '+ADDR.tel); toast('คัดลอกที่อยู่แล้ว'); }catch(e){} };
    var go=$('#tkGo',v); if(go)go.onclick=function(){ var no=$('#tkNo',v).value.trim(), e=$('#tkErr',v), body=idBody({trackingNo:no,carrier:$('#tkC',v).value});
      if(no.length<6){ e.textContent='กรุณากรอกเลขพัสดุให้ถูกต้อง'; return; }
      if(needAcct){ body.acctName=$('#tkAn',v).value.trim(); body.bankName=$('#tkAb',v).value; body.acctNo=$('#tkAno',v).value.replace(/[^\d-]/g,''); if(!body.acctName||body.acctNo.replace(/\D/g,'').length<10){ e.textContent='กรุณากรอกบัญชีรับเงินคืนให้ครบ'; return; } }
      go.disabled=true; go.textContent='กำลังบันทึก…';
      api('/api/returns/'+encodeURIComponent(r.rid)+'/ship',{method:'POST',body:body}).then(function(j){ if(j.ok){ D=null; toast('แจ้งเลขพัสดุแล้ว'); renderTrack(rid); return; } go.disabled=false; go.textContent='แจ้งเลขพัสดุ'; e.textContent='บันทึกไม่สำเร็จ กรุณาลองใหม่'; })
        .catch(function(){ go.disabled=false; go.textContent='แจ้งเลขพัสดุ'; e.textContent='เชื่อมต่อไม่สำเร็จ'; }); };
    var x=$('#tkX',v); if(x)x.onclick=function(){ A.sheet('ยกเลิกคำขอนี้?','<span class="ln">ยกเลิกคำขอ '+esc(r.rid)+'</span> <span class="ln">และกลับไปเริ่มใหม่ได้ภายในกำหนด</span>','<button class="btn" type="button" id="tkXgo" style="background:#ef4444">ยืนยันยกเลิก</button>');
      var g=$('#tkXgo'); if(g)g.onclick=function(){ g.disabled=true; api('/api/returns/'+encodeURIComponent(r.rid)+'/cancel',{method:'POST',body:idBody()}).then(function(j){ var bg=document.querySelector('.sheet-bg'); if(bg)bg.remove(); if(j.ok){ D=null; toast('ยกเลิกคำขอแล้ว'); location.hash='#orders'; } else toast('ยกเลิกไม่สำเร็จ'); }).catch(function(){ toast('เชื่อมต่อไม่สำเร็จ'); }); }; };
  }).catch(function(){ fail('rttrack','ติดตามสถานะ','#orders'); }); }

var R={rtlist:renderList,rtreason:renderReason,rtitems:renderItems,rtsum:renderSum,rtevid:renderEvid,rtdone:renderDone,rttrack:renderTrack};
window.CXRET={ views:Object.keys(R), render:function(sec,id){ R[sec](id); },
  refundTab:refundTab, load:function(){ return load(); }, has:function(){ return !!(D&&((D.orders||[]).length||(D.myReturns||[]).length)); }, clear:function(){ D=null; CUR=null; } };
})();

/* Return & Refund (New) — หลังบ้านสำหรับคำขอคืนสินค้าที่ยื่นจากแอปสมาชิก (source: 'app')
   หน้า: ภาพรวม / รายการคำขอ / จัดการคำขอ / ข้อมูลลูกค้า (ตาม Figma 129:7, 129:190, 129:460, 129:663)
   ใช้ API เดิมของระบบคืนสินค้า: GET /api/returns, POST /api/returns/:rid/inspect|refund|note|track, GET /api/orders */
(function(){
  'use strict';
  var RN={all:[],orders:null,loaded:false,view:'rn-overview',tab:'all',q:'',range:'all',page:1,sel:{},cur:null,cust:null,cq:'',ctab:'orders'};
  var PER=20;
  var RADDR={name:'บริษัท โคลเวอร์เอ็กซ์ (ไทยแลนด์) จำกัด',line:'762/84 หมู่บ้านเดอะปาล์ม (ภัสสร 37) ซอยพัฒนาการ 38 แขวงสวนหลวง เขตสวนหลวง กรุงเทพมหานคร 10250',tel:'062-593-0641'};
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function baht(n){return '฿'+(Math.round(Number(n)||0)).toLocaleString('en-US');}
  var MS=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  /* แสดงเวลาไทย (Asia/Bangkok) เสมอ ไม่ขึ้นกับเครื่องที่เปิด */
  function bk(x){var d=new Date(x);return isNaN(d)?null:new Date(d.getTime()+7*36e5);}
  function dTH(iso,full){var d=bk(iso);if(!d)return '-';return d.getUTCDate()+' '+MS[d.getUTCMonth()]+' '+(full?(d.getUTCFullYear()+543):String(d.getUTCFullYear()+543).slice(-2));}
  function hm(x){var d=bk(x);return d?('0'+d.getUTCHours()).slice(-2)+':'+('0'+d.getUTCMinutes()).slice(-2):'';}
  function dtTH(iso){var d=new Date(iso);if(isNaN(d))return '-';return dTH(iso,true)+' '+hm(d)+' น.';}
  function dayKey(x){var d=bk(x);return d?d.getUTCFullYear()+'-'+d.getUTCMonth()+'-'+d.getUTCDate():'';}
  function relTH(iso){var d=new Date(iso);if(isNaN(d))return '-';var k=dayKey(d),t=dayKey(Date.now()),y=dayKey(Date.now()-864e5);if(k===t)return 'วันนี้ '+hm(d)+' น.';if(k===y)return 'เมื่อวานนี้ '+hm(d)+' น.';return dTH(iso)+' '+hm(d)+' น.';}
  function toast(m,k){ if(window.xvToast)window.xvToast(m,k); }
  function clean(s){return String(s||'').replace(/\s*[·•]\s*/g,' ').replace(/\s+/g,' ').trim();}
  function shortSet(nm){return String(nm||'').replace(/\s*[\(·].*$/,'').toLowerCase().replace(/(^|\s)\S/g,function(m){return m.toUpperCase();});}
  function itemTitle(it){var cs=(it.comps||[]).map(clean);return (cs.length&&/routine/i.test(it.name||''))?cs.join(' + '):clean(it.name);}
  function itemSub(it){var cs=(it.comps||[]);return (cs.length&&/routine/i.test(it.name||''))?('จาก '+shortSet(it.name)):'';}
  function itemsText(r){return (r.items||[]).map(itemTitle).join(', ')||(r.choice==='wait'?'รับสินค้าไว้ รอการปรับปรุงระบบ':'-');}
  function delivered(r){var t=r.trackStatus;return !!(t&&(t.state==='delivered'));}
  /* ขั้นตอนตาม Figma: รอจัดส่งคืน → กำลังส่งคืน → รอตรวจรับ (พัสดุถึงคลัง) → รออนุมัติ → คืนเงินสำเร็จ / ปฏิเสธ */
  function phase(r){ if(r.choice==='wait'||r.status==='wait')return 'wait'; if(r.status==='cancelled')return 'cancelled';
    if(r.status==='awaiting_shipment')return 'ship'; if(r.status==='in_transit')return delivered(r)?'inspect':'transit';
    if(r.status==='refund_review')return 'approve'; if(r.status==='refunded')return 'done'; if(r.status==='rejected')return 'rejected'; return 'ship'; }
  var PH={ship:['รอจัดส่งคืน','y'],transit:['กำลังส่งคืน','b'],inspect:['รอตรวจรับ','c'],approve:['รออนุมัติ','p'],done:['คืนเงินสำเร็จ','g'],rejected:['ปฏิเสธ','r'],wait:['รอการปรับปรุง','m'],cancelled:['ยกเลิกแล้ว','m']};
  var TABS=[['all','ทั้งหมด'],['ship','รอจัดส่งคืน'],['transit','กำลังส่งคืน'],['inspect','รอตรวจรับ'],['approve','รออนุมัติ'],['done','คืนเงินสำเร็จ'],['rejected','ปฏิเสธ'],['wait','รอการปรับปรุง']];
  function pill(r){var p=PH[phase(r)]||['-','m'];return '<span class="rn-pill '+p[1]+'">'+p[0]+'</span>';}
  function daysSince(iso){var d=new Date(iso);return isNaN(d)?0:(Date.now()-d.getTime())/864e5;}
  function slowInspect(r){var p=phase(r);return (p==='inspect'&&daysSince((r.trackStatus&&r.trackStatus.at)||r.shippedAt)>2)||(p==='transit'&&daysSince(r.shippedAt)>5);}
  function warnTag(r){ if(r.overdue)return '<span class="rn-warn">เลยกำหนดส่ง</span>'; if(r.lateShipment)return '<span class="rn-warn">จัดส่งล่าช้า</span>'; if(slowInspect(r))return '<span class="rn-warn o">ตรวจรับล่าช้า</span>'; return '<span class="rn-dash">-</span>'; }
  function ref(r){return r.orderRef||'';}
  function refunded(r){return Number((r.refund&&r.refund.amount)||r.approvedAmount||0)||0;}
  function SVG(p,s){return '<svg width="'+(s||16)+'" height="'+(s||16)+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>';}
  var IC={alert:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',info:'<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',cal:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',dl:'<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',kebab:'<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',chevL:'<path d="m15 18-6-6 6-6"/>',chevR:'<path d="m9 18 6-6-6-6"/>',check:'<path d="M20 6 9 17l-5-5"/>',copy:'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'};

  var CSS='<style id="rn-css">'
  +'.rn{--rb:#2563EB;--rbt:#EAF1FE}.rn .crumb{font-size:.8rem;color:var(--muted);display:flex;gap:6px;align-items:center;margin-bottom:6px}.rn .crumb b{color:var(--ink);font-weight:600}'
  +'.rn h1.rt{font-size:1.45rem;font-weight:800;margin:0 0 18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}.rn h1.rt small{font-size:.8rem;font-weight:500;color:var(--muted)}'
  +'.rn .card{background:var(--panel,#fff);border:1px solid var(--line);border-radius:14px;padding:18px 20px}.rn .card h3{margin:0 0 14px;font-size:.98rem;font-weight:800}'
  +'.rn .alerts{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}.rn .al{display:flex;align-items:center;gap:10px;border-radius:10px;padding:12px 14px;font-size:.86rem;font-weight:600;line-height:1.5}.rn .al.y{background:#FFF7DB;border:1px solid #F6D57A;color:#9A6700}.rn .al.r{background:#FDECEC;border:1px solid #F3A5A8;color:#C0282E}.rn .al.ok{background:var(--soft);border:1px solid var(--line);color:var(--muted)}.rn .al svg{flex:none}'
  +'.rn .pol{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:.84rem;padding:12px 16px;margin-bottom:14px}.rn .pol b{color:var(--rb);font-weight:600}'
  +'.rn .kp{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:14px;margin-bottom:16px}.rn .kp .card{padding:16px}.rn .kp .l{font-size:.8rem;color:var(--muted)}.rn .kp .v{font-size:1.7rem;font-weight:800;margin:6px 0 8px;font-variant-numeric:tabular-nums}.rn .kp .s{font-size:.72rem;color:var(--muted);line-height:1.4}'
  +'.rn .g2{display:grid;grid-template-columns:1.8fr 1fr;gap:16px;margin-bottom:16px}.rn .g2d{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(0,1fr);gap:18px;align-items:start}.rn .col{display:flex;flex-direction:column;gap:16px;min-width:0}'
  +'.rn table.tb{width:100%;border-collapse:collapse;font-size:.84rem}.rn .tb th{text-align:left;font-weight:700;color:var(--ink);background:var(--soft);padding:11px 10px;white-space:nowrap}.rn .tb td{padding:12px 10px;border-top:1px solid var(--line);vertical-align:middle}.rn .tb .lnk{color:var(--rb);font-weight:600;cursor:pointer;white-space:nowrap;background:none;border:0;font:inherit;padding:0}.rn .tb .nw{white-space:nowrap}.rn .tb .num{font-variant-numeric:tabular-nums;font-weight:700}'
  +'.rn .tb .it{max-width:190px;line-height:1.45}.rn .tb .it small{display:block;color:var(--muted);font-size:.74rem}.rn .scroll{overflow-x:auto}'
  +'.rn-pill{display:inline-block;font-size:.74rem;font-weight:700;padding:4px 10px;border-radius:6px;white-space:nowrap}.rn-pill.y{background:#FFF4D6;color:#B7791F}.rn-pill.b{background:#E7EFFF;color:#2563EB}.rn-pill.c{background:#E0F4FB;color:#0E7490}.rn-pill.p{background:#F1E8FF;color:#7C3AED}.rn-pill.g{background:#E3F7EC;color:#15803D}.rn-pill.r{background:#FDECEC;color:#DC2626}.rn-pill.m{background:var(--soft);color:var(--muted)}'
  +'.rn-warn{display:inline-block;font-size:.72rem;font-weight:700;padding:3px 8px;border-radius:6px;background:#FDECEC;color:#DC2626;white-space:nowrap}.rn-warn.o{background:#FFF1E0;color:#C2410C}.rn-dash{color:var(--muted)}'
  +'.rn .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}.rn .tabs button{border:0;background:none;padding:9px 12px;border-radius:8px;font:inherit;font-weight:600;font-size:.88rem;color:var(--ink);cursor:pointer}.rn .tabs button small{color:var(--muted);font-weight:500;margin-left:4px}.rn .tabs button.on{color:var(--rb);background:var(--rbt)}'
  +'.rn .rnbar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}.rn .rnsrch{flex:1;min-width:220px;display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:9px;padding:0 12px;background:#fff;color:var(--muted)}.rn .rnsrch input{height:auto!important;min-height:0!important;width:auto!important;box-shadow:none!important;border-radius:0!important;flex:1;border:0;outline:0;font:inherit;font-size:.86rem;padding:10px 0;background:none;color:var(--ink)}'
  +'.rn select.in,.rn .btn{border:1px solid var(--line);border-radius:9px;background:#fff;font:inherit;font-size:.86rem;padding:9px 12px;color:var(--ink)}.rn .btn{display:inline-flex;align-items:center;gap:7px;cursor:pointer;font-weight:700;justify-content:center}.rn .btn.ol{border-color:var(--rb);color:var(--rb)}.rn .btn.pri{background:var(--rb);border-color:var(--rb);color:#fff}.rn .btn.gr{background:#16A34A;border-color:#16A34A;color:#fff}.rn .btn.rd{border-color:#DC2626;color:#DC2626}.rn .btn:disabled{opacity:.5;cursor:not-allowed}'
  +'.rn .kb{position:relative}.rn .kb>button{width:32px;height:32px;border:1px solid var(--line);border-radius:8px;background:#fff;display:grid;place-items:center;cursor:pointer;color:var(--ink)}.rn .kbm{position:absolute;right:0;top:36px;z-index:30;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 30px rgba(20,30,60,.14);padding:6px;min-width:170px;display:none}.rn .kbm.on{display:block}.rn .kbm button{display:block;width:100%;text-align:left;border:0;background:none;padding:9px 11px;border-radius:7px;font:inherit;font-size:.84rem;font-weight:600;cursor:pointer;color:var(--ink)}.rn .kbm button:hover{background:var(--soft)}'
  +'.rn .foot{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px;font-size:.82rem;color:var(--muted)}.rn .pg{display:flex;gap:6px}.rn .pg button{min-width:32px;height:32px;border:1px solid var(--line);border-radius:7px;background:#fff;font:inherit;font-weight:700;cursor:pointer;color:var(--ink)}.rn .pg button.on{background:var(--rb);border-color:var(--rb);color:#fff}'
  +'.rn .kv{display:grid;grid-template-columns:1fr 1fr;gap:14px 24px}.rn .kv .k{font-size:.74rem;color:var(--muted);margin-bottom:3px}.rn .kv .v{font-size:.9rem;word-break:break-word}.rn .kv .full{grid-column:1/-1}.rn .kv a,.rn .blue{color:var(--rb)}'
  +'.rn .items .row{display:grid;grid-template-columns:minmax(0,1fr) 70px 110px;gap:10px;align-items:center;padding:12px 0;border-top:1px solid var(--line);font-size:.88rem}.rn .items .hd{font-size:.78rem;color:var(--muted);border-top:0;padding-top:0}.rn .items .row .t small{display:block;color:var(--muted);font-size:.76rem;margin-top:2px}.rn .items .r{text-align:right;font-variant-numeric:tabular-nums}.rn .items .c{text-align:center}.rn .items .tot{display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:12px;font-size:.88rem}.rn .items .tot b{color:#DC2626;font-size:1.05rem}'
  +'.rn .ev{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.rn .ev a{display:block;aspect-ratio:1;border-radius:10px;overflow:hidden;background:var(--soft)}.rn .ev img{width:100%;height:100%;object-fit:cover;display:block}'
  +'.rn .steps{display:flex;flex-direction:column}.rn .st{display:flex;gap:12px;position:relative;padding-bottom:18px}.rn .st:last-child{padding-bottom:0}.rn .st i{width:20px;height:20px;border-radius:50%;flex:none;display:grid;place-items:center;background:#E2E8F0;color:#fff;position:relative;z-index:1}.rn .st.done i{background:#16A34A}.rn .st.now i{background:#fff;border:2px solid var(--rb)}.rn .st.now i:after{content:"";width:8px;height:8px;border-radius:50%;background:var(--rb)}.rn .st.bad i{background:#DC2626}'
  +'.rn .st:not(:last-child):before{content:"";position:absolute;left:9px;top:20px;bottom:0;width:2px;background:#E2E8F0}.rn .st.done:not(:last-child):before{background:#16A34A}.rn .st b{font-size:.86rem;display:block}.rn .st.now b{color:var(--rb)}.rn .st small{font-size:.74rem;color:var(--muted)}'
  +'.rn textarea.in{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:9px;background:var(--soft);font:inherit;font-size:.86rem;padding:10px 12px;min-height:74px;resize:vertical;color:var(--ink)}.rn .lbl{font-size:.8rem;color:var(--muted);margin-bottom:6px}.rn .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}'
  +'.rn .note{border-top:1px solid var(--line);padding-top:10px;margin-top:10px;font-size:.84rem;line-height:1.55}.rn .note small{display:block;color:var(--muted);font-size:.72rem;margin-bottom:2px}'
  +'.rn .empty{text-align:center;color:var(--muted);padding:36px 12px;font-size:.88rem;line-height:1.7}'
  +'.rn .prof{display:flex;gap:14px;align-items:center;margin-bottom:18px}.rn .av{width:56px;height:56px;border-radius:50%;background:var(--rbt);color:var(--rb);display:grid;place-items:center;font-weight:800;font-size:1.2rem;flex:none}.rn .prof b{font-size:1.1rem;display:block}.rn .tag{display:inline-block;margin-top:5px;font-size:.7rem;font-weight:700;padding:3px 9px;border-radius:999px;background:var(--rbt);color:var(--rb)}'
  +'.rn .kvs{display:flex;flex-direction:column;gap:13px}.rn .kvs .k{font-size:.74rem;color:var(--muted);margin-bottom:2px}.rn .kvs .v{font-size:.9rem;line-height:1.5}'
  +'.rn .kp4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}.rn .kp4 .card{padding:14px 16px}.rn .kp4 .l{font-size:.76rem;color:var(--muted)}.rn .kp4 .v{font-size:1.45rem;font-weight:800;margin:6px 0 6px;font-variant-numeric:tabular-nums}.rn .kp4 .s{font-size:.7rem;color:var(--muted)}'
  +'.rn .picks{display:flex;flex-direction:column;gap:6px}.rn .picks button{display:flex;justify-content:space-between;gap:10px;align-items:center;text-align:left;border:1px solid var(--line);border-radius:10px;background:#fff;padding:11px 14px;font:inherit;cursor:pointer;color:var(--ink)}.rn .picks button small{color:var(--muted);font-size:.78rem}'
  +'@media(max-width:1180px){.rn .kp{grid-template-columns:repeat(3,minmax(0,1fr))}.rn .g2,.rn .g2d{grid-template-columns:1fr}}@media(max-width:720px){.rn .alerts,.rn .kv,.rn .row2{grid-template-columns:1fr}.rn .kp,.rn .kp4{grid-template-columns:repeat(2,minmax(0,1fr))}}'
  +'</style>';

  function mount(crumb,title,body){ var g=document.getElementById('view-generic'); if(!g)return null; g.classList.remove('xv');
    g.innerHTML=CSS+'<div class="rn"><h1 class="rt">'+title+'</h1>'+body+'</div>'; return g.querySelector('.rn'); }
  function load(force){ if(RN.loaded&&!force)return Promise.resolve();
    return fetch('/api/returns',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(j){
      RN.all=((j&&j.returns)||[]).filter(function(r){return r.source==='app';}).sort(function(a,b){return new Date(b.at)-new Date(a.at);});
      RN.deadline=j&&j.returnDeadline; RN.loaded=true; }); }
  function loadOrders(){ if(RN.orders)return Promise.resolve(RN.orders);
    return fetch('/api/orders',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(j){RN.orders=Array.isArray(j)?j:((j&&j.orders)||[]);return RN.orders;}).catch(function(){RN.orders=[];return RN.orders;}); }
  function deadlineTxt(){ var d=new Date(RN.deadline||'2026-09-28T23:59:59+07:00'); return dTH(d,true)+' เวลา '+hm(d)+' น.'; }
  function fail(el){ if(el)el.innerHTML='<div class="empty">โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่</div>'; }
  function wait(crumb,title){ return mount(crumb,title,'<div class="card"><div class="empty">กำลังโหลด…</div></div>'); }

  /* ---------------- 1) ภาพรวม ---------------- */
  function overview(){ wait('ภาพรวม','ภาพรวมสถานะการคืนเงินและคืนสินค้า');
    load(true).then(function(){ var a=RN.all, c={}; a.forEach(function(r){var p=phase(r);c[p]=(c[p]||0)+1;});
      var od=a.filter(function(r){return r.overdue;}).length, sl=a.filter(slowInspect).length;
      var alerts='<div class="alerts">'
        +(od?'<div class="al y">'+SVG(IC.alert,18)+'<span>เลยกำหนดส่งคืนพัสดุ: มี '+od+' รายการที่ลูกค้ายังไม่ได้ส่งคืนตามกรอบเวลา</span></div>':'<div class="al ok">'+SVG(IC.check,18)+'<span>ไม่มีรายการที่เลยกำหนดส่งคืน</span></div>')
        +(sl?'<div class="al r">'+SVG(IC.info,18)+'<span>ดำเนินการตรวจรับล่าช้า: มี '+sl+' รายการที่พัสดุถึงคลังแล้วแต่ยังไม่ได้กดตรวจรับ</span></div>':'<div class="al ok">'+SVG(IC.check,18)+'<span>ไม่มีรายการตรวจรับล่าช้า</span></div>')+'</div>';
      function k(l,v,s){return '<div class="card"><div class="l">'+l+'</div><div class="v">'+v+'</div><div class="s">'+s+'</div></div>';}
      var kp='<div class="kp">'+k('คำขอทั้งหมด',a.length,'คำขอจากแอปทั้งหมด')+k('รอจัดส่งคืน',c.ship||0,'ลูกค้าได้รับการอนุมัติให้ส่งคืน')+k('รอตรวจรับ',(c.inspect||0)+(c.transit||0),'พัสดุกำลังมาหรือถึงคลังแล้ว')+k('รออนุมัติ',c.approve||0,'ตรวจรับแล้ว รอโอนเงินคืน')+k('คืนเงินสำเร็จ',c.done||0,'โอนเงินเรียบร้อยแล้ว')+k('ปฏิเสธคำขอ',c.rejected||0,'ไม่ผ่านเงื่อนไขการรับคืน')+'</div>';
      /* กราฟ 7 วันล่าสุด */
      var days=[],idx={}; for(var i=6;i>=0;i--){var dt=Date.now()-i*864e5,key=dayKey(dt);idx[key]=days.length;days.push({d:bk(dt),n:0});}
      a.forEach(function(r){var key=dayKey(r.at);if(idx[key]!=null)days[idx[key]].n++;});
      var W=640,H=200,px=36,py=22,mx=Math.max(4,Math.max.apply(null,days.map(function(x){return x.n;}))),st=Math.ceil(mx/4);mx=st*4;
      var X=function(i){return px+(W-px-14)*i/6;},Y=function(v){return H-py-(H-2*py)*v/mx;};
      var grid='';for(var g=0;g<=4;g++){var yv=g*st;grid+='<line x1="'+px+'" x2="'+(W-14)+'" y1="'+Y(yv)+'" y2="'+Y(yv)+'" stroke="var(--line)" stroke-dasharray="3 4"/><text x="'+(px-8)+'" y="'+(Y(yv)+4)+'" text-anchor="end" font-size="10" fill="var(--muted)">'+yv+'</text>';}
      var pts=days.map(function(x,i){return X(i).toFixed(1)+','+Y(x.n).toFixed(1);}).join(' ');
      var area='M'+X(0)+','+Y(0)+' L'+pts.split(' ').join(' L')+' L'+X(6)+','+Y(0)+' Z';
      var dots=days.map(function(x,i){return '<circle cx="'+X(i)+'" cy="'+Y(x.n)+'" r="'+(i===6?4.5:3)+'" fill="'+(i===6?'#fff':'#2563EB')+'" stroke="#2563EB" stroke-width="2"/>';}).join('');
      var labs=days.map(function(x,i){return '<text x="'+X(i)+'" y="'+(H-4)+'" text-anchor="middle" font-size="10" fill="var(--muted)">'+(i===6?'วันนี้':(x.d.getUTCDate()+' '+MS[x.d.getUTCMonth()]))+'</text>';}).join('');
      var chart='<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="display:block;min-width:460px"><defs><linearGradient id="rnG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2563EB" stop-opacity=".18"/><stop offset="1" stop-color="#2563EB" stop-opacity="0"/></linearGradient></defs>'+grid+'<path d="'+area+'" fill="url(#rnG)"/><polyline points="'+pts+'" fill="none" stroke="#2563EB" stroke-width="2.5" stroke-linejoin="round"/>'+dots+labs+'</svg>';
      /* โดนัทสัดส่วนสถานะ */
      var segs=[['คืนเงินสำเร็จ','#16A34A',c.done||0],['กำลังดำเนินการ','#2563EB',(c.ship||0)+(c.transit||0)+(c.inspect||0)+(c.approve||0)],['อื่น ๆ','#F59E0B',(c.rejected||0)+(c.wait||0)+(c.cancelled||0)]];
      var tot=a.length||0,C=2*Math.PI*44,off=0,ring='';
      segs.forEach(function(s){ if(!s[2]||!tot)return; var len=s[2]/tot*C; ring+='<circle cx="60" cy="60" r="44" fill="none" stroke="'+s[1]+'" stroke-width="18" stroke-dasharray="'+len.toFixed(2)+' '+(C-len).toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'" transform="rotate(-90 60 60)"/>'; off+=len; });
      var donut='<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap"><svg width="130" height="130" viewBox="0 0 120 120"><circle cx="60" cy="60" r="44" fill="none" stroke="var(--line)" stroke-width="18"/>'+ring+'<text x="60" y="60" text-anchor="middle" font-size="17" font-weight="800" fill="var(--ink)">'+tot.toLocaleString('en-US')+'</text><text x="60" y="76" text-anchor="middle" font-size="8.5" fill="var(--muted)">คำขอทั้งหมด</text></svg><div style="display:flex;flex-direction:column;gap:9px;font-size:.82rem">'
        +segs.map(function(s){return '<span style="display:flex;align-items:center;gap:8px"><i style="width:9px;height:9px;border-radius:50%;background:'+s[1]+'"></i>'+s[0]+' ('+(tot?Math.round(s[2]/tot*100):0)+'%)</span>';}).join('')+'</div></div>';
      /* กิจกรรมล่าสุด (จากประวัติของทุกคำขอ) */
      var ev=[]; a.forEach(function(r){(r.history||[]).forEach(function(h){ev.push({at:h.at,text:h.text,r:r});});}); ev.sort(function(x,y){return new Date(y.at)-new Date(x.at);}); ev=ev.slice(0,8);
      var act=ev.length?'<div class="scroll"><table class="tb"><thead><tr><th>เวลา</th><th>เลขคำขอ</th><th>ชื่อลูกค้า</th><th>การดำเนินการ</th><th>สถานะ</th></tr></thead><tbody>'
        +ev.map(function(e){return '<tr><td class="nw">'+esc(relTH(e.at))+'</td><td><button class="lnk" data-open="'+esc(e.r.rid)+'">'+esc(e.r.rid)+'</button></td><td class="nw">'+esc(e.r.name||e.r.orderName||'-')+'</td><td style="min-width:240px">'+esc(clean(e.text))+'</td><td>'+pill(e.r)+'</td></tr>';}).join('')+'</tbody></table></div>':'<div class="empty">ยังไม่มีคำขอคืนสินค้าจากแอป</div>';
      var el=mount('ภาพรวม','ภาพรวมสถานะการคืนเงินและคืนสินค้า',alerts
        +'<div class="card pol"><span>ข้อกำหนดนโยบายร้านค้าปัจจุบัน:</span><b>กำหนดคืนสินค้าและคืนเงินเสร็จสิ้นภายใน '+esc(deadlineTxt())+'</b></div>'+kp
        +'<div class="g2"><div class="card"><h3>แนวโน้มคำขอคืนสินค้าและคืนเงินรายวัน (7 วันล่าสุด)</h3><div class="scroll">'+chart+'</div></div><div class="card"><h3>สัดส่วนสถานะคำขอปัจจุบัน</h3>'+donut+'</div></div>'
        +'<div class="card"><h3>กิจกรรมล่าสุดในระบบ</h3>'+act+'</div>');
      bindOpen(el);
    }).catch(function(){ fail(document.querySelector('.rn .card')); }); }

  /* ---------------- 2) รายการคำขอ ---------------- */
  function inRange(at){ if(RN.range==='all')return true; var d=bk(at); if(!d)return false; var n=bk(Date.now()), s=Date.UTC(n.getUTCFullYear(),n.getUTCMonth(),n.getUTCDate()); var back=RN.range==='today'?0:(RN.range==='7d'?6:29); return d.getTime()>=s-back*864e5; }
  function hit(r,q){ if(!q)return true; q=q.toLowerCase().replace(/\s+/g,''); var h=[r.rid,r.orderId,r.name,r.orderName,r.phone,r.orderPhone,r.email].join(' ').toLowerCase().replace(/\s+/g,''); if(h.indexOf(q)>=0)return true; var qd=q.replace(/\D/g,''); return qd.length>=4&&h.replace(/\D/g,'').indexOf(qd)>=0; }
  function filtered(){ return RN.all.filter(function(r){ return (RN.tab==='all'||phase(r)===RN.tab)&&inRange(r.at)&&hit(r,RN.q); }); }
  function list(){ wait('รายการคำขอ','รายการคำขอคืนสินค้าและคืนเงิน'); load(true).then(drawList).catch(function(){fail(document.querySelector('.rn .card'));}); }
  function drawList(){
    var base=RN.all.filter(function(r){return inRange(r.at)&&hit(r,RN.q);}), c={all:base.length}; base.forEach(function(r){var p=phase(r);c[p]=(c[p]||0)+1;});
    var rows=filtered(), pages=Math.max(1,Math.ceil(rows.length/PER)); if(RN.page>pages)RN.page=pages; var pr=rows.slice((RN.page-1)*PER,RN.page*PER);
    var tabs='<div class="tabs" role="tablist">'+TABS.map(function(t){return '<button role="tab" data-tab="'+t[0]+'" class="'+(RN.tab===t[0]?'on':'')+'" aria-selected="'+(RN.tab===t[0])+'">'+t[1]+'<small>('+(c[t[0]]||0)+')</small></button>';}).join('')+'</div>';
    var bar='<div class="rnbar"><div class="rnsrch">'+SVG(IC.search,16)+'<input id="rnQ" placeholder="ค้นหาด้วยเลขคำขอ ชื่อลูกค้า หรือเบอร์โทร…" value="'+esc(RN.q)+'"></div>'
      +'<select class="in" id="rnR" aria-label="เลือกวันที่คำขอ"><option value="all">ทุกวันที่คำขอ</option><option value="today">วันนี้</option><option value="7d">7 วันล่าสุด</option><option value="30d">30 วันล่าสุด</option></select>'
      +'<button class="btn ol" id="rnX">'+SVG(IC.dl,16)+'ส่งออกข้อมูล</button></div>';
    var allOn=pr.length&&pr.every(function(r){return RN.sel[r.rid];});
    var tb=pr.length?'<div class="scroll"><table class="tb"><thead><tr><th><input type="checkbox" id="rnAll" aria-label="เลือกทั้งหน้า"'+(allOn?' checked':'')+'></th><th>เลขคำขอ</th><th>วันที่ยื่น</th><th>ชื่อ-นามสกุล</th><th>เบอร์โทร</th><th>ผู้แนะนำ</th><th>รายการสินค้า</th><th>ยอดคืน</th><th>สถานะ</th><th>แจ้งเตือน</th><th style="text-align:center">ดำเนินการ</th></tr></thead><tbody>'
      +pr.map(function(r){return '<tr><td><input type="checkbox" data-sel="'+esc(r.rid)+'"'+(RN.sel[r.rid]?' checked':'')+' aria-label="เลือก '+esc(r.rid)+'"></td><td><button class="lnk" data-open="'+esc(r.rid)+'">'+esc(r.rid)+'</button></td><td class="nw">'+esc(dTH(r.at))+'</td><td class="nw">'+esc(r.name||r.orderName||'-')+'</td><td class="nw">'+esc(r.phone||r.orderPhone||'-')+'</td><td class="nw">'+esc(ref(r)||'-')+'</td>'
        +'<td class="it">'+(r.items||[]).map(function(it){return esc(itemTitle(it))+(itemSub(it)?'<small>'+esc(itemSub(it))+'</small>':'');}).join('')+(r.choice==='wait'?'<small>รับสินค้าไว้ รอการปรับปรุงระบบ</small>':'')+'</td>'
        +'<td class="num nw">'+(r.choice==='wait'?'-':baht(r.amount))+'</td><td>'+pill(r)+'</td><td>'+warnTag(r)+'</td>'
        +'<td style="text-align:center"><div class="kb"><button type="button" data-kb="'+esc(r.rid)+'" aria-label="เมนูการทำงาน">'+SVG(IC.kebab,18)+'</button><div class="kbm"><button data-open="'+esc(r.rid)+'">ดูข้อมูล / จัดการคำขอ</button><button data-cust="'+esc(r.rid)+'">ดูข้อมูลลูกค้า</button><button data-copy="'+esc(r.rid)+'">คัดลอกเลขคำขอ</button></div></div></td></tr>';}).join('')+'</tbody></table></div>'
      :'<div class="empty">'+(RN.all.length?'ไม่พบคำขอที่ตรงกับตัวกรอง':'ยังไม่มีคำขอคืนสินค้าจากแอป')+'</div>';
    var nSel=Object.keys(RN.sel).length, pg='';
    if(pages>1){ pg='<div class="pg"><button data-pg="'+(RN.page-1)+'"'+(RN.page<=1?' disabled':'')+' aria-label="ก่อนหน้า">'+SVG(IC.chevL,14)+'</button>'; for(var i=1;i<=pages;i++)pg+='<button data-pg="'+i+'" class="'+(i===RN.page?'on':'')+'">'+i+'</button>'; pg+='<button data-pg="'+(RN.page+1)+'"'+(RN.page>=pages?' disabled':'')+' aria-label="ถัดไป">'+SVG(IC.chevR,14)+'</button></div>'; }
    var foot='<div class="foot"><span>'+(nSel?('เลือกไว้ '+nSel+' รายการ (ส่งออกเฉพาะที่เลือก)'):'')+'</span><span style="display:flex;align-items:center;gap:12px">แสดง '+(rows.length?((RN.page-1)*PER+1):0)+'-'+Math.min(RN.page*PER,rows.length)+' จาก '+rows.length+' รายการ'+pg+'</span></div>';
    var el=mount('รายการคำขอ','รายการคำขอคืนสินค้าและคืนเงิน',tabs+'<div class="card">'+bar+tb+foot+'</div>');
    var q=el.querySelector('#rnQ'); q.oninput=function(){ RN.q=q.value; RN.page=1; clearTimeout(q._t); q._t=setTimeout(function(){ var pos=q.selectionStart; drawList(); var nq=document.getElementById('rnQ'); if(nq){nq.focus();try{nq.setSelectionRange(pos,pos);}catch(e){}} },250); };
    var rs=el.querySelector('#rnR'); rs.value=RN.range; rs.onchange=function(){RN.range=rs.value;RN.page=1;drawList();};
    el.querySelector('#rnX').onclick=exportCsv;
    el.querySelectorAll('[data-tab]').forEach(function(b){b.onclick=function(){RN.tab=b.dataset.tab;RN.page=1;drawList();};});
    el.querySelectorAll('[data-pg]').forEach(function(b){b.onclick=function(){var p=+b.dataset.pg;if(p>=1&&p<=pages){RN.page=p;drawList();}};});
    el.querySelectorAll('[data-sel]').forEach(function(b){b.onchange=function(){ if(b.checked)RN.sel[b.dataset.sel]=1; else delete RN.sel[b.dataset.sel]; drawList(); };});
    var all=el.querySelector('#rnAll'); if(all)all.onchange=function(){ pr.forEach(function(r){ if(all.checked)RN.sel[r.rid]=1; else delete RN.sel[r.rid]; }); drawList(); };
    el.querySelectorAll('[data-kb]').forEach(function(b){b.onclick=function(e){e.stopPropagation(); var m=b.nextElementSibling, on=!m.classList.contains('on'); el.querySelectorAll('.kbm.on').forEach(function(x){x.classList.remove('on');}); if(on)m.classList.add('on');};});
    el.querySelectorAll('[data-copy]').forEach(function(b){b.onclick=function(){ try{navigator.clipboard.writeText(b.dataset.copy);toast('คัดลอกเลขคำขอแล้ว','ok');}catch(e){} b.closest('.kbm').classList.remove('on'); };});
    el.querySelectorAll('[data-cust]').forEach(function(b){b.onclick=function(){ var r=find(b.dataset.cust); if(r){RN.cust=custKey(r);RN.cq='';} go('rn-customer'); };});
    bindOpen(el);
  }
  document.addEventListener('click',function(){ document.querySelectorAll('.rn .kbm.on').forEach(function(x){x.classList.remove('on');}); });
  function exportCsv(){ var ids=Object.keys(RN.sel), rows=ids.length?RN.all.filter(function(r){return RN.sel[r.rid];}):filtered(); if(!rows.length){toast('ไม่มีข้อมูลให้ส่งออก','bad');return;}
    function q(v){return '"'+String(v==null?'':v).replace(/"/g,'""')+'"';}
    var L=[['เลขคำขอ','คำสั่งซื้อ','วันที่ยื่น','ชื่อ-นามสกุล','เบอร์โทร','อีเมล','ผู้แนะนำ','รายการสินค้า','ยอดคืน','ช่องทางคืนเงิน','ธนาคาร','เลขที่บัญชี','ขนส่ง','เลขพัสดุ','สถานะ'].map(q).join(',')];
    rows.forEach(function(r){var a=r.refundAccount||{};L.push([r.rid,r.orderId,dtTH(r.at),r.name||r.orderName,r.phone||r.orderPhone,r.email,ref(r),itemsText(r),r.choice==='wait'?'':r.amount,r.channel==='bank'?'โอนเข้าบัญชี':'คืนเข้าบัตร',a.bank,a.no,r.returnCarrier||r.returnCarrierPlan,r.returnTracking,(PH[phase(r)]||[''])[0]].map(q).join(','));});
    var b=new Blob(['﻿'+L.join('\r\n')],{type:'text/csv;charset=utf-8'}),u=URL.createObjectURL(b),a=document.createElement('a'); a.href=u; a.download='cloverx-return-app-'+new Date().toISOString().slice(0,10)+'.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){URL.revokeObjectURL(u);},1500); toast('ส่งออกแล้ว '+rows.length+' รายการ','ok'); }

  /* ---------------- 3) จัดการคำขอ ---------------- */
  function find(rid){ return RN.all.filter(function(r){return r.rid===rid;})[0]; }
  function bindOpen(el){ el.querySelectorAll('[data-open]').forEach(function(b){b.onclick=function(){ RN.cur=b.dataset.open; go('rn-manage'); };}); }
  function manage(){ wait('จัดการคำขอ','จัดการคำขอ'); load(true).then(function(){ var r=RN.cur&&find(RN.cur); if(r)drawDetail(r); else drawQueue(); }).catch(function(){fail(document.querySelector('.rn .card'));}); }
  function drawQueue(){ var q=RN.all.filter(function(r){var p=phase(r);return p==='inspect'||p==='transit'||p==='approve'||p==='ship';});
    var body=q.length?'<div class="card"><h3>คำขอที่รอทีมงานดำเนินการ ('+q.length+')</h3><div class="scroll"><table class="tb"><thead><tr><th>เลขคำขอ</th><th>วันที่ยื่น</th><th>ชื่อลูกค้า</th><th>รายการสินค้า</th><th>ยอดคืน</th><th>สถานะ</th><th>แจ้งเตือน</th></tr></thead><tbody>'
      +q.map(function(r){return '<tr><td><button class="lnk" data-open="'+esc(r.rid)+'">'+esc(r.rid)+'</button></td><td class="nw">'+esc(dTH(r.at))+'</td><td class="nw">'+esc(r.name||'-')+'</td><td class="it">'+esc(itemsText(r))+'</td><td class="num nw">'+baht(r.amount)+'</td><td>'+pill(r)+'</td><td>'+warnTag(r)+'</td></tr>';}).join('')+'</tbody></table></div></div>'
      :'<div class="card"><div class="empty">ไม่มีคำขอที่รอดำเนินการ<br>เลือกคำขอจากหน้ารายการคำขอเพื่อดูรายละเอียด</div></div>';
    var el=mount('จัดการคำขอ','จัดการคำขอ',body); bindOpen(el); }
  function steps(r){ var p=phase(r), h=r.history||[]; function at(re){ for(var i=h.length-1;i>=0;i--){ if(re.test(h[i].text||''))return h[i].at; } return ''; }
    var ins=r.inspection||{}, rf=r.refund||{};
    var S=[{t:'ยื่นคำขอคืนสินค้า',at:r.at,done:true},{t:'แจ้งส่งพัสดุเข้าระบบ',at:r.shippedAt||at(/แจ้งการส่งคืน/),done:!!r.shippedAt||['inspect','approve','done','rejected'].indexOf(p)>=0,sub:'รอลูกค้าส่งพัสดุคืน'},
      {t:p==='rejected'?'ปฏิเสธการรับคืน':'ตรวจรับความเรียบร้อย',at:ins.at,done:!!ins.at,bad:p==='rejected',sub:'รอดำเนินการโดยคลังสินค้า'},
      {t:'อนุมัติสั่งคืนเงิน',at:rf.at,done:!!rf.at,sub:'รอขั้นตอนตรวจรับสินค้าเสร็จสิ้น'},{t:'เสร็จสิ้น',at:rf.at,done:p==='done'}];
    if(p==='rejected')S=S.slice(0,3);
    var nowI=-1; for(var i=0;i<S.length;i++){ if(!S[i].done){nowI=i;break;} }
    return '<div class="steps">'+S.map(function(s,i){var cls=s.bad?'bad':(s.done?'done':(i===nowI?'now':''));return '<div class="st '+cls+'"><i>'+(s.done||s.bad?SVG(s.bad?'<path d="M18 6 6 18M6 6l12 12"/>':IC.check,12):'')+'</i><div><b>'+esc(s.t)+'</b><small>'+(s.at?esc(dtTH(s.at)):(i===nowI?esc(s.sub||''):''))+'</small></div></div>';}).join('')+'</div>'; }
  function drawDetail(r){ var p=phase(r), a=r.refundAccount||{}, ins=r.inspection||{}, rf=r.refund||{}, isWait=r.choice==='wait';
    var cust='<div class="card"><h3>ข้อมูลลูกค้า</h3><div class="kv"><div><div class="k">ชื่อลูกค้า</div><div class="v">'+esc(r.name||r.orderName||'-')+'</div></div><div><div class="k">เบอร์โทร</div><div class="v">'+esc(r.phone||r.orderPhone||'-')+'</div></div>'
      +'<div><div class="k">อีเมล</div><div class="v">'+esc(r.email||r.orderEmail||'-')+'</div></div><div><div class="k">ผู้แนะนำ</div><div class="v blue">'+esc(ref(r)||'-')+'</div></div>'
      +'<div><div class="k">คำสั่งซื้อ</div><div class="v">'+esc(r.orderId)+'</div></div><div><div class="k">ช่องทางที่ยื่น</div><div class="v">แอปสมาชิก</div></div>'
      +'<div class="full"><div class="k">เหตุผลการขอคืนสินค้า</div><div class="v">'+esc(isWait?'รับสินค้าไว้ รอการปรับปรุงระบบ':(r.reason||'-'))+'</div></div></div></div>';
    var items=isWait?'':'<div class="card items"><h3>รายการสินค้าที่ขอคืน</h3><div class="row hd"><span>สินค้า</span><span class="c">จำนวน</span><span class="r">ยอดคืน</span></div>'
      +(r.items||[]).map(function(it){return '<div class="row"><span class="t">'+esc(itemTitle(it))+(itemSub(it)?'<small>'+esc(itemSub(it))+' (RoutineX คืนไม่ได้)</small>':'')+'</span><span class="c">1</span><span class="r">'+baht(it.price)+'</span></div>';}).join('')
      +'<div class="tot"><span>ยอดคืนทั้งหมด:</span><b>'+baht(r.amount)+'</b></div></div>';
    var ev=(r.evidence||[]).length?'<div class="card"><h3>รูปหลักฐานแนบจากลูกค้า</h3><div class="ev">'+r.evidence.map(function(u,i){return '<a href="'+esc(u)+'" target="_blank" rel="noopener"><img src="'+esc(u)+'" alt="หลักฐาน '+(i+1)+'" loading="lazy"></a>';}).join('')+'</div></div>':(isWait?'':'<div class="card"><h3>รูปหลักฐานแนบจากลูกค้า</h3><div class="empty" style="padding:14px">ไม่มีรูปแนบ</div></div>');
    var t=r.trackStatus, tlab=t?(t.label||'-'):(r.returnTracking?'กำลังตรวจสอบ':'ลูกค้ายังไม่แจ้งเลขพัสดุ');
    var ship=isWait?'':'<div class="card"><h3>ข้อมูลการจัดส่งคืน</h3><div class="kvs"><div><div class="k">บริษัทขนส่ง</div><div class="v">'+esc(r.returnCarrier||r.returnCarrierPlan||'-')+'</div></div><div><div class="k">เลขพัสดุสำหรับติดตาม</div><div class="v blue">'+esc(r.returnTracking||'-')+'</div></div><div><div class="k">สถานะล่าสุด</div><div class="v" style="color:'+(delivered(r)?'#16A34A':'var(--ink)')+'">'+esc(tlab)+'</div></div>'
      +(r.returnTracking?'<div><button class="btn" id="rnTk" style="padding:7px 12px;font-size:.8rem">ตรวจสอบสถานะล่าสุด</button></div>':'')+'</div></div>';
    var bank=isWait?'':'<div class="card"><h3>ข้อมูลการโอนเงินคืน</h3><div class="kvs"><div><div class="k">ช่องทางการโอนคืน</div><div class="v">'+(r.channel==='bank'?'โอนเข้าบัญชีธนาคาร':'คืนเข้าบัตรที่ใช้ชำระ')+'</div></div>'
      +(r.channel==='bank'?'<div><div class="k">บัญชีปลายทาง</div><div class="v">'+esc((a.bank||'-')+(a.no?(' '+a.no):''))+'</div></div><div><div class="k">ชื่อบัญชี</div><div class="v">'+esc(a.name||'-')+'</div></div>':'')
      +(rf.at?'<div><div class="k">คืนเงินแล้ว</div><div class="v" style="color:#16A34A;font-weight:700">'+baht(rf.amount)+' เมื่อ '+esc(dtTH(rf.at))+'</div></div>':'')+'</div></div>';
    var act='';
    if(p==='ship'||p==='transit'||p==='inspect') act='<div class="card"><h3>บันทึกผลการตรวจสอบ</h3>'+(p==='ship'?'<div class="lbl" style="color:#B7791F">ลูกค้ายังไม่แจ้งส่งพัสดุ ตรวจรับได้เมื่อได้รับสินค้าจริงแล้ว</div>':'')+'<div class="lbl">เหตุผล/ข้อเท็จจริง (ในกรณีปฏิเสธ)</div><textarea class="in" id="rnRs" placeholder="ระบุเหตุผลเพื่อเป็นบันทึกข้อโต้แย้ง…"></textarea><div class="row2"><button class="btn rd" id="rnRj">ปฏิเสธการรับคืน</button><button class="btn gr" id="rnOk">รับสินค้าเสร็จสมบูรณ์</button></div></div>';
    else if(p==='approve') act='<div class="card"><h3>อนุมัติคืนเงิน</h3><div class="lbl">ยอดคืนเงิน (บาท)</div><input class="in" id="rnAm" type="number" min="1" max="'+esc(r.amount)+'" value="'+esc(r.amount)+'" style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:9px;padding:10px 12px;font:inherit;font-weight:700"><div class="lbl" style="margin-top:12px">หลักฐานการโอนคืน (ไม่บังคับ)</div><input type="file" id="rnSl" accept="image/*" style="font-size:.8rem"><div class="lbl" style="margin-top:8px">ระบบบันทึกผลเท่านั้น ทีมงานโอนเงินคืนเองตามช่องทางด้านซ้าย</div><button class="btn pri" id="rnAp" style="width:100%;margin-top:10px">อนุมัติคืนเงิน</button></div>';
    var notes=(r.staffNotes||[]);
    var noteC='<div class="card"><h3>บันทึกภายใน (Internal Notes)</h3><textarea class="in" id="rnNt" placeholder="พิมพ์บันทึกข้อความภายในที่เห็นเฉพาะแอดมิน…"></textarea><button class="btn pri" id="rnNs" style="width:100%;margin-top:10px">บันทึกข้อความ</button>'
      +notes.map(function(n){return '<div class="note"><small>'+esc(dtTH(n.at))+' โดย '+esc(n.by||'staff')+'</small>'+esc(n.text)+'</div>';}).join('')+'</div>';
    var addr='<div class="card"><h3>ที่อยู่สำหรับจัดส่งคืน (ร้านค้า)</h3><div style="font-size:.86rem;line-height:1.6">'+esc(RADDR.name)+' '+esc(RADDR.line)+'<br>โทร '+esc(RADDR.tel)+'</div></div>';
    var hist='<div class="card"><h3>ประวัติการดำเนินการ</h3>'+((r.history||[]).map(function(h){return '<div class="note" style="margin-top:0;border-top:0;padding-top:0;margin-bottom:10px"><small>'+esc(dtTH(h.at))+'</small>'+esc(clean(h.text))+'</div>';}).join('')||'<div class="empty" style="padding:10px">-</div>')+'</div>';
    var title='คำขอเลขที่ '+esc(r.rid)+' '+pill(r)+'<small>ยื่นเมื่อ: '+esc(dtTH(r.at))+'</small>';
    var el=mount('จัดการคำขอ <span style="opacity:.6">›</span> '+esc(r.rid),title,
      '<div style="display:flex;gap:8px;margin:-8px 0 16px"><button class="btn" id="rnBk">'+SVG(IC.chevL,14)+'กลับไปคิวงาน</button><button class="btn" id="rnBl">ไปหน้ารายการคำขอ</button></div><div class="g2d"><div class="col">'+cust+items+ev+(isWait?'':'<div class="row2" style="margin-top:0;gap:16px">'+ship+bank+'</div>')+'</div><div class="col"><div class="card"><h3>ขั้นตอนการดำเนินการ</h3>'+steps(r)+'</div>'+act+noteC+addr+hist+'</div></div>');
    el.querySelector('#rnBk').onclick=function(){ RN.cur=null; drawQueue(); };
    el.querySelector('#rnBl').onclick=function(){ RN.cur=null; go('rn-list'); };
    function post(path,body,btn,okMsg){ if(btn)btn.disabled=true; return fetch('/api/returns/'+encodeURIComponent(r.rid)+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(x){return x.json();}).then(function(j){ if(j&&j.ok){ toast(okMsg,'ok'); return load(true).then(function(){ var nr=find(r.rid); if(nr)drawDetail(nr); }); } if(btn)btn.disabled=false; toast(j&&j.error==='reason_required'?'กรุณาระบุเหตุผลก่อนปฏิเสธ':'บันทึกไม่สำเร็จ กรุณาลองใหม่','bad'); }).catch(function(){ if(btn)btn.disabled=false; toast('เชื่อมต่อไม่สำเร็จ','bad'); }); }
    function confirmDo(t,m,b,cb,dg){ if(window.xvConfirm)window.xvConfirm(t,m,b,cb,dg); else if(confirm(t+'\n'+m))cb(); }
    var rj=el.querySelector('#rnRj'), ok=el.querySelector('#rnOk');
    if(rj)rj.onclick=function(){ var rs=el.querySelector('#rnRs').value.trim(); if(!rs){toast('กรุณาระบุเหตุผลก่อนปฏิเสธ','bad');el.querySelector('#rnRs').focus();return;} confirmDo('ปฏิเสธการรับคืน','ยืนยันปฏิเสธคำขอ '+r.rid+' ใช่ไหม? ลูกค้าจะเห็นสถานะนี้ในแอป','ปฏิเสธ',function(){ post('/inspect',{result:'reject',reason:rs,actor:'staff'},rj,'บันทึกการปฏิเสธแล้ว'); },true); };
    if(ok)ok.onclick=function(){ var rs=el.querySelector('#rnRs').value.trim(); confirmDo('รับสินค้าเสร็จสมบูรณ์','ยืนยันว่าได้รับสินค้าครบและสภาพสมบูรณ์ แล้วส่งต่อไปขั้นอนุมัติคืนเงิน','ยืนยัน',function(){ post('/inspect',{result:'good',reason:rs,actor:'staff'},ok,'ตรวจรับเรียบร้อย'); }); };
    var ap=el.querySelector('#rnAp'); if(ap)ap.onclick=function(){ var am=Number(el.querySelector('#rnAm').value)||0, full=Math.abs(am-(Number(r.amount)||0))<0.01; if(!(am>0)||am>(Number(r.amount)||0)){toast('ยอดคืนต้องมากกว่า 0 และไม่เกิน '+baht(r.amount),'bad');return;}
      confirmDo('อนุมัติคืนเงิน','บันทึกการคืนเงิน '+baht(am)+' ให้คำขอ '+r.rid+' ใช่ไหม?','อนุมัติ',function(){ var f=el.querySelector('#rnSl').files[0]; function send(slip){ post('/refund',{type:full?'full':'partial',amount:am,slip:slip||undefined,actor:'staff'},ap,'บันทึกการคืนเงินแล้ว'); } if(!f)return send(); var rd=new FileReader(); rd.onload=function(){send(rd.result);}; rd.readAsDataURL(f); }); };
    el.querySelector('#rnNs').onclick=function(){ var b=this, tx=el.querySelector('#rnNt').value.trim(); if(!tx){toast('พิมพ์ข้อความก่อนบันทึก','bad');return;} post('/note',{text:tx},b,'บันทึกข้อความแล้ว'); };
    var tk=el.querySelector('#rnTk'); if(tk)tk.onclick=function(){ tk.disabled=true; tk.textContent='กำลังตรวจสอบ…'; fetch('/api/returns/'+encodeURIComponent(r.rid)+'/track',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({force:true})}).then(function(x){return x.json();}).then(function(j){ if(j&&j.track)r.trackStatus=j.track; drawDetail(r); }).catch(function(){ tk.disabled=false; tk.textContent='ตรวจสอบสถานะล่าสุด'; }); };
  }

  /* ---------------- 4) ข้อมูลลูกค้า ---------------- */
  function custKey(r){ var d=String(r.phone||r.orderPhone||'').replace(/\D/g,''); return d.length>=9?('p:'+d.slice(-9)):('e:'+String(r.email||r.orderEmail||r.name||'').toLowerCase()); }
  function customers(){ var m={}; RN.all.forEach(function(r){ var k=custKey(r); if(!m[k])m[k]={key:k,name:r.name||r.orderName||'-',phone:r.phone||r.orderPhone||'',email:r.email||r.orderEmail||'',ref:ref(r),rets:[]}; m[k].rets.push(r); if(!m[k].ref&&ref(r))m[k].ref=ref(r); }); return Object.keys(m).map(function(k){return m[k];}); }
  function customer(){ wait('ข้อมูลลูกค้า','ประวัติและข้อมูลการคืนเงินของลูกค้า'); Promise.all([load(true),loadOrders()]).then(drawCust).catch(function(){fail(document.querySelector('.rn .card'));}); }
  function drawCust(){ var cs=customers(), cur=RN.cust&&cs.filter(function(c){return c.key===RN.cust;})[0];
    var sb='<div class="card" style="margin-bottom:16px"><div class="rnbar" style="margin:0"><div class="rnsrch">'+SVG(IC.search,16)+'<input id="rnCq" placeholder="ค้นหาด้วยชื่อ เบอร์โทร อีเมล หรือเลขคำขอ" value="'+esc(RN.cq)+'"></div><button class="btn pri" id="rnCs">ค้นหาข้อมูล</button></div></div>';
    var body;
    if(!cur){ var hits=RN.cq?cs.filter(function(c){return c.rets.some(function(r){return hit(r,RN.cq);});}):cs;
      body='<div class="card"><h3>'+(RN.cq?'ผลการค้นหา ('+hits.length+')':'ลูกค้าที่ยื่นคำขอจากแอป ('+cs.length+')')+'</h3>'+(hits.length?'<div class="picks">'+hits.slice(0,60).map(function(c){return '<button data-ck="'+esc(c.key)+'"><span><b style="font-weight:700">'+esc(c.name)+'</b><br><small>'+esc([c.phone,c.email].filter(Boolean).join(' | '))+'</small></span><small>'+c.rets.length+' คำขอ</small></button>';}).join('')+'</div>':'<div class="empty">ไม่พบลูกค้าที่ตรงกับคำค้นหา</div>')+'</div>';
    } else {
      var ids={}; cur.rets.forEach(function(r){ids[r.orderId]=1;}); var em=String(cur.email||'').toLowerCase(), ph=String(cur.phone||'').replace(/\D/g,'');
      var ords=(RN.orders||[]).filter(function(o){ var op=String(o.phone||'').replace(/\D/g,''); return ids[o.id]||(em&&String(o.email||'').toLowerCase()===em)||(ph.length>=9&&op.length>=9&&op.slice(-9)===ph.slice(-9)); }).sort(function(a,b){return new Date(b.at)-new Date(a.at);});
      var buy=ords.filter(function(o){return !/cancel|expired|failed/i.test(o.status||'');}).reduce(function(s,o){return s+(Number(o.total)||0);},0), rfd=cur.rets.reduce(function(s,r){return s+refunded(r);},0);
      var ini=String(cur.name||'?').replace(/^คุณ\s*/,'').trim().charAt(0)||'?';
      var prof='<div class="card"><div class="prof"><div class="av" aria-hidden="true">'+esc(ini)+'</div><div><b>'+esc(cur.name)+'</b><span class="tag">ลูกค้าจากแอปสมาชิก</span></div></div><div class="kvs"><div><div class="k">เบอร์โทรศัพท์</div><div class="v">'+esc(cur.phone||'-')+'</div></div><div><div class="k">อีเมล</div><div class="v">'+esc(cur.email||'-')+'</div></div>'
        +'<div><div class="k">ที่อยู่จัดส่งหลัก</div><div class="v">'+esc((ords[0]&&ords[0].addr)||'-')+'</div></div><div><div class="k">ผู้แนะนำหลัก</div><div class="v blue">'+esc(cur.ref||'-')+'</div></div><div><div class="k">สั่งซื้อครั้งแรก</div><div class="v">'+esc(ords.length?dTH(ords[ords.length-1].at,true):'-')+'</div></div></div>'
        +'<button class="btn" id="rnCb" style="margin-top:16px;width:100%">'+SVG(IC.chevL,14)+'กลับไปรายชื่อลูกค้า</button></div>';
      function k(l,v,s){return '<div class="card"><div class="l">'+l+'</div><div class="v">'+v+'</div><div class="s">'+s+'</div></div>';}
      var kp='<div class="kp4">'+k('คำสั่งซื้อทั้งหมด',ords.length+' ครั้ง','ยอดสั่งซื้อต่อเนื่อง')+k('จำนวนคำขอคืน',cur.rets.length+' รายการ','ประวัติการคืนเงินสินค้า')+k('ยอดซื้อสะสมสุทธิ',baht(buy),'ไม่รวมคำสั่งซื้อที่ยกเลิก')+k('ยอดมูลค่าที่คืนเงินสำเร็จ',baht(rfd),'มูลค่าที่ทางแบรนด์โอนกลับ')+'</div>';
      var ot='<div class="scroll"><table class="tb"><thead><tr><th>เลขคำสั่งซื้อ</th><th>วันที่สั่งซื้อ</th><th>รายการสินค้า</th><th style="text-align:right">ยอดสั่งซื้อ</th><th>สถานะ</th></tr></thead><tbody>'+(ords.map(function(o){return '<tr><td class="nw blue" style="font-weight:600">'+esc(o.id)+'</td><td class="nw">'+esc(dTH(o.at,true))+'</td><td class="it" style="max-width:320px">'+esc((o.items||[]).map(function(i){return clean(i.nm);}).join(', '))+'</td><td class="num nw" style="text-align:right">'+baht(o.total)+'</td><td><span class="rn-pill '+(/paid|success|deliver|ship/i.test(o.status||'')?'g':'m')+'">'+esc(o.status==='paid'?'ชำระแล้ว':(o.status||'-'))+'</span></td></tr>';}).join('')||'<tr><td colspan="5"><div class="empty" style="padding:14px">ไม่พบคำสั่งซื้อ</div></td></tr>')+'</tbody></table></div>';
      var rt='<div class="scroll"><table class="tb"><thead><tr><th>เลขคำขอคืน</th><th>วันที่ยื่นขอ</th><th>รายการสินค้าที่ส่งคืน</th><th style="text-align:right">ยอดรวมคืน</th><th>ผลดำเนินการ</th></tr></thead><tbody>'+cur.rets.map(function(r){return '<tr><td><button class="lnk" data-open="'+esc(r.rid)+'">'+esc(r.rid)+'</button></td><td class="nw">'+esc(dTH(r.at,true))+'</td><td class="it" style="max-width:320px">'+esc(itemsText(r))+'</td><td class="num nw" style="text-align:right">'+(r.choice==='wait'?'-':baht(r.amount))+'</td><td>'+pill(r)+'</td></tr>';}).join('')+'</tbody></table></div>';
      var tabs='<div class="tabs" role="tablist" style="margin-bottom:10px"><button data-ct="orders" class="'+(RN.ctab==='orders'?'on':'')+'">ประวัติการสั่งซื้อ</button><button data-ct="returns" class="'+(RN.ctab==='returns'?'on':'')+'">ประวัติการคืนสินค้า</button></div>';
      body='<div class="g2d" style="grid-template-columns:minmax(0,1fr) minmax(0,2fr)">'+prof+'<div class="col" style="gap:0">'+kp+'<div class="card">'+tabs+(RN.ctab==='orders'?ot:rt)+'</div></div></div>';
    }
    var el=mount('ข้อมูลลูกค้า','ประวัติและข้อมูลการคืนเงินของลูกค้า',sb+body);
    var inp=el.querySelector('#rnCq'); function doS(){ RN.cq=inp.value.trim(); RN.cust=null; var cs2=customers().filter(function(c){return c.rets.some(function(r){return hit(r,RN.cq);});}); if(RN.cq&&cs2.length===1)RN.cust=cs2[0].key; drawCust(); }
    el.querySelector('#rnCs').onclick=doS; inp.onkeydown=function(e){ if(e.key==='Enter')doS(); };
    el.querySelectorAll('[data-ck]').forEach(function(b){b.onclick=function(){RN.cust=b.dataset.ck;RN.ctab='orders';drawCust();};});
    el.querySelectorAll('[data-ct]').forEach(function(b){b.onclick=function(){RN.ctab=b.dataset.ct;drawCust();};});
    var cb=el.querySelector('#rnCb'); if(cb)cb.onclick=function(){RN.cust=null;drawCust();};
    bindOpen(el);
  }

  function go(v){ if(typeof window.go==='function')window.go(v); }
  window.CXRN={ render:function(v){ RN.view=v; if(v==='rn-overview')overview(); else if(v==='rn-list')list(); else if(v==='rn-manage')manage(); else if(v==='rn-customer')customer(); },
    open:function(rid){ RN.cur=rid; go('rn-manage'); } };
})();

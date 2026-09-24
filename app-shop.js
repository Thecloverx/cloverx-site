/* CloverX Member App: ร้านค้า Pre-Order ในแอป (ตาม Figma preorder-shop-v2 81:4, product-detail 87:4, Screen_1-6 92:*)
   ราคา สต๊อก และยอดรวม คิดที่เซิร์ฟเวอร์ (/api/m/shop, /api/m/checkout) หน้าจอนี้ใช้แสดงผลเท่านั้น */
(function(){
var A=window.CXAPP; if(!A)return;
var $=function(s,r){return (r||document).querySelector(s);}, $$=function(s,r){return [].slice.call((r||document).querySelectorAll(s));};
var esc=A.esc, api=A.api, toast=A.toast, baht=A.baht;
var ACCT_NO='231-1-71119-1', ACCT_NAME='บริษัท โคลเวอร์เอ็กซ์ (ไทยแลนด์) จำกัด';

/* ---------- ไอคอน (lucide ชุดเดียวกับ Figma) ---------- */
var I={
  chevL:'<path d="m15 18-6-6 6-6"/>', chevR:'<path d="m9 18 6-6-6-6"/>',
  search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  cart:'<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
  activity:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  heart:'<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  bag:'<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
  card:'<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
  checkC:'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  truck:'<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  cash:'<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  verified:'<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
  msg:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  x:'<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  pin:'<path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  store:'<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  refund:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>'
};
function sv(n,s,col,w){ return '<svg width="'+s+'" height="'+s+'" viewBox="0 0 24 24" fill="none" stroke="'+(col||'currentColor')+'" stroke-width="'+(w||2)+'" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+I[n]+'</svg>'; }
function money(n){ return '฿'+baht(n); }

/* ---------- CSS ---------- */
var css=''
+'.sv{background:#f8fafc;min-height:100vh;min-height:100dvh}'
+'.sv.has-tab{padding-bottom:calc(var(--tab) + 28px + env(safe-area-inset-bottom))}'
+'.sbar{position:sticky;top:0;z-index:12;background:#fff;border-bottom:1px solid #e2e8f0;height:52px;display:flex;align-items:center;gap:12px;padding:0 16px}'
+'.sbar .bk{width:24px;height:24px;display:grid;place-items:center;color:#0f172a;flex:none}'
+'.sbar h1{flex:1;margin:0;font-size:18px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
+'.sbar h1.c{text-align:center}.sbar h1.s{font-size:16px}'
+'.sbar .act{display:flex;gap:16px;align-items:center}'
+'.sbar .act a,.sbar .act button{position:relative;width:24px;height:24px;display:grid;place-items:center;color:#0f172a}'
+'.cbadge{position:absolute;right:-6px;top:-6px;min-width:16px;height:16px;border-radius:8px;background:#fe2c55;color:#fff;font-size:10px;font-weight:700;line-height:16px;text-align:center;padding:0 4px}'
+'.ssearch{background:#fff;border-bottom:1px solid #e2e8f0;padding:8px 16px}'
+'.ssearch input{width:100%;height:38px;border-radius:10px;border:1px solid #e2e8f0;padding:0 12px;font-size:14px;outline:none;background:#f8fafc}'
+'.stabs{position:sticky;top:52px;z-index:11;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;gap:16px;overflow-x:auto;padding:0 16px;scrollbar-width:none}'
+'.stabs::-webkit-scrollbar{display:none}'
+'.stabs button{flex:none;height:49px;font-size:14px;font-weight:500;color:#64748b;position:relative;white-space:nowrap}'
+'.stabs button.on{color:#2563eb;font-weight:700}'
+'.stabs button.on:after{content:"";position:absolute;left:50%;bottom:10px;width:24px;height:3px;margin-left:-12px;border-radius:1.5px;background:#2563eb}'
+'.round{background:linear-gradient(90deg,#1e3a8a,#3b82f6);color:#fff;padding:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:68px}'
+'.round b{display:block;font-size:14px;letter-spacing:.02em}.round small{display:block;font-size:12px;color:#93c5fd;margin-top:4px}'
+'.timer{display:flex;align-items:center;gap:4px;font-weight:700;font-size:12px;font-variant-numeric:tabular-nums}'
+'.timer span{background:#1e293b;border-radius:4px;min-width:27px;height:27px;display:grid;place-items:center;padding:0 5px}'
+'.closed2{margin:12px 16px 0;padding:12px 14px;border-radius:12px;background:#fef3c7;color:#92400e;font-size:13px;line-height:1.6}'
+'.ssec{padding:0 16px}'
+'.ssec h2{display:flex;align-items:center;gap:8px;margin:0;padding:20px 0 12px;font-size:16px;font-weight:700;color:#0f172a}'
+'.ssec h2 svg{color:#2563eb;flex:none}'
+'.sgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}'
+'.pc{background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;display:flex;flex-direction:column}'
+''
+'.pc .im{position:relative;aspect-ratio:1/1;background:#f8fafc center/contain no-repeat;display:grid;place-items:center;color:#64748b;font-weight:700;font-size:14px}'
+'.pc .im.contain{background-size:contain}'
+'.pc .bd{position:absolute;left:8px;top:8px;background:#2563eb;color:#fff;font-size:10px;font-weight:700;line-height:20px;height:20px;padding:0 8px;border-radius:4px}'
+'.pc .bd.dk{background:#0f172a}'
+'.pc .dt{padding:12px;display:flex;flex-direction:column;gap:8px;flex:1}'
+'.pc h3{margin:0;font-size:14px;font-weight:600;color:#0f172a;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}'
+'.chips2{display:flex;gap:4px;flex-wrap:wrap}.chips2 span{background:#f1f5f9;color:#64748b;font-size:10px;line-height:16px;height:16px;padding:0 6px;border-radius:4px}'
+'.pr2{display:flex;flex-direction:column;gap:2px;margin-top:auto}'
+'.pr2 .p{display:flex;align-items:center;gap:6px;font-size:16px;font-weight:700;color:#2563eb;font-variant-numeric:tabular-nums}'
+'.pr2 .p i{font-style:normal;background:#fee2e2;color:#ef4444;font-size:10px;font-weight:700;line-height:16px;padding:0 4px;border-radius:4px}'
+'.pr2 s{font-size:12px;color:#64748b}'
+'.pbtn{height:31px;border-radius:8px;background:#2563eb;color:#fff;font-size:12px;font-weight:700;width:100%}'
+'.pbtn:disabled,.pbtn.soon{background:#f1f5f9;color:#64748b}'
+'.sempty{padding:40px 16px;text-align:center;color:#64748b;font-size:13px}'
/* detail */
+'.pd{background:#f4f5f8;padding-bottom:calc(84px + env(safe-area-inset-bottom))}'
+'.hero2{position:relative;height:292px;background:#f8fafc}'
+'.hero2 .slides{display:flex;height:100%;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}'
+'.hero2 .slides::-webkit-scrollbar{display:none}'
+'.hero2 .slide{flex:0 0 100%;height:100%;scroll-snap-align:start;background:#f8fafc center/contain no-repeat}'
+'.hero2 .idx{position:absolute;right:16px;bottom:16px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;font-weight:500;padding:3px 8px;border-radius:12px}'
+'.hero2 .dots2{position:absolute;left:0;right:0;bottom:22px;display:flex;justify-content:center;gap:6px}'
+'.hero2 .dots2 i{width:6px;height:6px;border-radius:3px;background:#cbd5e1}.hero2 .dots2 i.on{background:#fe2c55;width:14px}'
+'.blk{background:#fff;padding:16px;margin-bottom:8px}'
+'.blk h4{margin:0 0 12px;font-size:13px;font-weight:700;color:#0f172a;display:flex;justify-content:space-between;align-items:center}'
+'.pd .price{display:flex;align-items:center;gap:10px;flex-wrap:wrap}'
+'.pd .price b{font-size:28px;font-weight:800;color:#fe2c55;font-variant-numeric:tabular-nums;line-height:1.2}'
+'.pd .price s{font-size:14px;color:#64748b}.pd .price i{font-style:normal;background:#fff5f5;color:#fe2c55;font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px}'
+'.pd .inst{display:flex;align-items:center;gap:4px;margin-top:8px;font-size:12px;color:#64748b}'
+'.pd .ttl{display:flex;gap:6px;align-items:flex-start;margin-top:14px}'
+'.pd .ttl span{flex:none;background:#eff6ff;color:#2563eb;font-size:10px;font-weight:700;line-height:16px;padding:0 6px;border-radius:4px;margin-top:3px}'
+'.pd .ttl b{font-size:16px;font-weight:700;color:#0f172a;line-height:1.4}'
+'.pd .sub2{font-size:14px;color:#0f172a;margin-top:6px}'
+'.vopts{display:flex;gap:12px;flex-wrap:wrap}'
+'.vopt{display:flex;align-items:center;gap:8px;height:48px;padding:0 12px 0 4px;border-radius:8px;border:1px solid #f1f5f9;background:#fff;font-size:13px;font-weight:500;color:#64748b}'
+'.vopt img{width:36px;height:36px;border-radius:4px;object-fit:contain;background:#f8fafc}'
+'.vopt.on{border:2px solid #2563eb;background:#f4f5f8;color:#0f172a;font-weight:700}'
+'.vopt:disabled{opacity:.45}'
+'.boxl{display:flex;flex-direction:column;gap:8px}.boxl div{display:flex;gap:8px;align-items:flex-start;font-size:13px;color:#0f172a;line-height:1.3}.boxl svg{color:#059669;flex:none}'
+'.shipc{background:#f4f5f8;border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:12px}'
+'.shipc .r{display:flex;gap:10px;align-items:flex-start}.shipc svg{flex:none;color:#0f172a;margin-top:1px}'
+'.shipc b{font-size:13px;color:#0f172a}.shipc small{display:block;font-size:12px;color:#059669;font-weight:600;margin-top:2px}'
+'.storer{display:flex;align-items:center;gap:10px}'
+'.storer .av2{width:44px;height:44px;border-radius:22px;background:#0f172a;color:#fff;font-weight:800;font-size:18px;display:grid;place-items:center;flex:none}'
+'.storer .nm2{flex:1;min-width:0}.storer .nm2 b{display:flex;align-items:center;gap:4px;font-size:14px;color:#0f172a}.storer .nm2 b svg{color:#2563eb}'
+'.storer .nm2 small{font-size:11px;color:#64748b}'
+'.obtn{border:1px solid #2563eb;color:#2563eb;border-radius:6px;font-size:12px;font-weight:700;padding:5px 11px;white-space:nowrap}'
+'.spec{border:1px solid #f1f5f9;border-radius:8px;overflow:hidden}'
+'.spec div{display:grid;grid-template-columns:120px 1fr;border-top:1px solid #f1f5f9;font-size:12px}.spec div:first-child{border-top:0}'
+'.spec span{background:#f4f5f8;color:#64748b;font-weight:600;padding:10px}.spec b{font-weight:400;color:#0f172a;padding:10px}'
+'.sticky2{position:fixed;left:50%;transform:translateX(-50%);bottom:0;width:100%;max-width:480px;background:#fff;border-top:1px solid #f1f5f9;z-index:20;padding:0 16px env(safe-area-inset-bottom);min-height:84px;display:flex;align-items:center;gap:12px}'
+'.sticky2 .ico{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:10px;color:#64748b;width:36px}'
+'.sticky2 .ico.on{color:#fe2c55}'
+'.sticky2 .sp{flex:1}'
+'.b2{height:44px;border-radius:8px;font-size:14px;font-weight:700;padding:0 14px;white-space:nowrap}'
+'.b2.o{border:1px solid #0088ff;color:#0088ff;background:#fff}.b2.g{background:linear-gradient(90deg,#1e3a8a,#3b82f6);color:#fff}'
+'.b2:disabled{opacity:.5}'
/* sheet */
+'.shbg{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:50;display:flex;align-items:flex-end;justify-content:center}'
+'.shp{background:#fff;width:100%;max-width:480px;border-radius:24px 24px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom));max-height:92vh;overflow:auto}'
+'.shp .hd{width:40px;height:4px;border-radius:2px;background:#cbd5e1;margin:0 auto 20px}'
+'.shp .top{display:flex;gap:12px;align-items:flex-end;padding-bottom:20px;border-bottom:1px solid #e2e8f0}'
+'.shp .top img{width:80px;height:80px;border-radius:12px;border:1px solid #e2e8f0;object-fit:contain;background:#f8fafc;flex:none}'
+'.shp .top .t{flex:1;min-width:0}.shp .top b{display:block;font-size:22px;font-weight:800;color:#ef4444}'
+'.shp .top small{display:block;font-size:12px;color:#64748b;margin-top:4px}.shp .top em{display:block;font-style:normal;font-size:13px;color:#0f172a;margin-top:4px}'
+'.shp .top button{color:#475569;align-self:center}'
+'.shp .row{padding:20px 0;border-bottom:1px solid #e2e8f0}.shp .row:last-of-type{border-bottom:0}'
+'.shp .row>b{display:block;font-size:14px;color:#0f172a;margin-bottom:12px}'
+'.pill2{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 12px 0 10px;border-radius:8px;border:1px solid #e2e8f0;background:#fff;font-size:13px;font-weight:500;color:#64748b;margin:0 8px 8px 0}'
+'.pill2 i{width:16px;height:16px;border-radius:8px;border:1px solid #e2e8f0}'
+'.pill2.on{border:2px solid #2563eb;background:#eff6ff;color:#0f172a;font-weight:700}'
+'.qrow{display:flex;align-items:center;justify-content:space-between;gap:12px}'
+'.qrow b{font-size:14px;color:#0f172a}.qrow small{display:block;font-size:11px;color:#64748b}'
+'.qty{display:flex;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;flex:none}'
+'.qty button{width:32px;height:32px;background:#f8fafc;font-weight:700;color:#64748b}.qty button:last-child{background:#f1f5f9;color:#0f172a}'
+'.qty span{width:40px;display:grid;place-items:center;font-weight:700;font-size:14px}'
+'.qty.sm button{width:24px;height:24px;font-size:12px;font-weight:400}.qty.sm span{width:28px;font-size:12px}'
+'.cta2{height:48px;border-radius:24px;width:100%;background:linear-gradient(90deg,#1e3a8a,#3b82f6);color:#fff;font-size:16px;font-weight:700;margin-top:8px}'
+'.cta2:disabled{opacity:.55}'
+'.fin{width:100%;height:44px;border:1px solid #e2e8f0;border-radius:10px;padding:0 12px;font-size:15px;outline:none;margin-top:8px;background:#fff}'
+'.fin:focus{border-color:#2563eb}'
+'.ferr{color:#ef4444;font-size:12px;margin-top:8px}'
/* cart / checkout */
+'.sbody{padding:12px;display:flex;flex-direction:column;gap:12px}'
+'.cardw{background:#fff;border-radius:12px;padding:12px}'
+'.sthd{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:#0f172a}.sthd .vf{color:#059669}'
+'.ck{width:20px;height:20px;display:grid;place-items:center;color:#2563eb;flex:none}.ck.off{color:#cbd5e1}'
+'.citem{display:flex;gap:8px;align-items:flex-start;padding:12px 0;border-top:1px solid #e2e8f0}.citem:first-of-type{border-top:0}'
+'.citem img{width:80px;height:80px;border-radius:8px;object-fit:contain;background:#f8fafc;flex:none}'
+'.citem .m{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}'
+'.citem .n{font-size:13px;font-weight:600;color:#0f172a;line-height:1.35}'
+'.citem .v{font-size:11px;color:#64748b}'
+'.citem .pq{display:flex;align-items:center;justify-content:space-between;margin-top:4px}'
+'.citem .pq b{font-size:15px;color:#ef4444}'
+'.cbottom{position:fixed;left:50%;transform:translateX(-50%);bottom:0;width:100%;max-width:480px;background:#fff;border-top:1px solid #e2e8f0;z-index:20;padding:12px 16px calc(12px + env(safe-area-inset-bottom));display:flex;align-items:center;gap:12px}'
+'.cbottom .all{display:flex;align-items:center;gap:8px;font-size:13px;color:#64748b}'
+'.cbottom .sp{flex:1}.cbottom .tt{text-align:right;font-size:14px;font-weight:700;color:#0f172a}.cbottom .tt b{color:#ef4444;font-weight:800}'
+'.cbottom .tt2{flex:1}.cbottom .tt2 small{display:block;font-size:11px;color:#64748b}.cbottom .tt2 b{font-size:18px;font-weight:800;color:#ef4444}'
+'.rbtn{height:40px;border-radius:20px;background:linear-gradient(90deg,#1e3a8a,#3b82f6);color:#fff;font-size:14px;font-weight:700;padding:0 24px;white-space:nowrap}'
+'.rbtn:disabled{opacity:.5}'
+'.withbar{padding-bottom:calc(80px + env(safe-area-inset-bottom))}'
+'.addr{display:flex;gap:10px;align-items:center;width:100%;text-align:left}'
+'.addr .pin2{color:#2563eb;flex:none}.addr .m{flex:1;min-width:0}'
+'.addr b{font-size:14px;color:#0f172a}.addr .ph{font-size:13px;color:#64748b;margin-left:8px;font-weight:400}'
+'.addr p{margin:4px 0 0;font-size:12px;color:#64748b;line-height:1.35}.addr .go2{color:#94a3b8;flex:none}'
+'.addr.need b{color:#2563eb}'
+'.oitem{display:flex;gap:8px;padding:12px 0 0}.oitem img{width:60px;height:60px;border-radius:6px;object-fit:contain;background:#f8fafc;flex:none}'
+'.oitem .m{flex:1;min-width:0}.oitem .n{font-size:13px;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
+'.oitem .v{font-size:11px;color:#64748b;margin-top:2px}.oitem .p{display:flex;justify-content:space-between;font-size:13px;font-weight:700;color:#0f172a;margin-top:4px}.oitem .p span{font-weight:400;color:#64748b;font-size:12px}'
+'.hr{border-top:1px solid #e2e8f0;margin:12px 0}'
+'.kv2{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;font-size:13px;color:#64748b;padding:4px 0}.kv2 b{color:#0f172a;font-weight:400}'
+'.kv2.t{font-size:14px;font-weight:700;color:#0f172a;padding-top:8px}.kv2.t b{font-size:18px;font-weight:800;color:#ef4444}'
+'.shipr{display:flex;justify-content:space-between;align-items:center;gap:10px}.shipr b{font-size:13px;color:#0f172a;font-weight:600}.shipr small{display:block;font-size:11px;color:#059669;margin-top:2px}.shipr em{font-style:normal;font-size:13px;font-weight:700;color:#0f172a;white-space:nowrap}'
+'.note2{display:flex;gap:8px;align-items:center;margin-top:10px;font-size:12px;color:#64748b}.note2 input{flex:1;min-width:0;border:0;outline:none;font-size:12px;font-style:italic;color:#0f172a;background:none;padding:6px 0}'
+'.payopt{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:6px 0;font-size:13px;color:#64748b}'
+'.payopt .l{flex:1;display:flex;align-items:center;gap:8px}.payopt.on{color:#0f172a;font-weight:600}.payopt.on .l svg{color:#2563eb}'
+'.radio{width:18px;height:18px;border-radius:9px;border:1.5px solid #64748b;flex:none;display:grid;place-items:center}.payopt.on .radio{border-color:#2563eb}.payopt.on .radio:after{content:"";width:9px;height:9px;border-radius:5px;background:#2563eb}'
+'.bankbox{background:#f8fafc;border-radius:8px;padding:8px;display:flex;gap:8px;align-items:center;margin:4px 0 8px}'
+'.bankbox img{width:32px;height:32px;border-radius:6px;flex:none;object-fit:cover}.bankbox b{display:block;font-size:12px;color:#0f172a}.bankbox small{display:block;font-size:11px;color:#64748b}'
+'.refr{display:grid;grid-template-columns:1fr 1fr;gap:8px}.refr select,.refr input{height:40px;border:1px solid #e2e8f0;border-radius:8px;padding:0 10px;font-size:13px;background:#fff;outline:none;min-width:0;width:100%}'
+'.lbl2{font-size:14px;font-weight:700;color:#0f172a;margin-bottom:10px}'
/* success */
+'.okw{padding:40px 20px 24px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:0}'
+'.okw .bdg{width:72px;height:72px;border-radius:36px;background:linear-gradient(90deg,#1e3a8a,#3b82f6);display:grid;place-items:center;color:#fff;box-shadow:0 8px 8px rgba(30,58,138,.2)}'
+'.okw h2{margin:20px 0 0;font-size:22px;font-weight:800;color:#0f172a}.okw .sb{font-size:14px;color:#64748b;margin-top:6px}'
+'.okw .po{margin-top:20px;background:#eff6ff;color:#2563eb;font-size:12px;font-weight:700;padding:6px 12px;border-radius:6px}'
+'.warnb{align-self:stretch;margin-top:20px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;display:flex;gap:10px;align-items:flex-start;text-align:left;font-size:12px;font-weight:600;color:#d97706;line-height:1.5}.warnb svg{flex:none}'
+'.bankc{align-self:stretch;margin-top:20px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:15px;text-align:left}'
+'.bankc .h{font-size:13px;font-weight:700;color:#64748b}'
+'.bankc .br{display:flex;gap:10px;align-items:center;margin-top:12px;padding-bottom:12px;border-bottom:1px solid #e2e8f0}.bankc .br img{width:28px;height:28px;border-radius:4px;flex:none}.bankc .br b{display:block;font-size:14px;color:#0f172a}'
+'.bankc .no{display:flex;justify-content:space-between;align-items:center;margin-top:12px}.bankc .no small{display:block;font-size:12px;color:#64748b}.bankc .no b{font-size:18px;font-weight:800;color:#2563eb;font-variant-numeric:tabular-nums}'
+'.bankc .cp{border:1px solid #e2e8f0;border-radius:6px;font-size:11px;font-weight:600;color:#64748b;padding:3px 9px}'
+'.bankc .kv2{padding:6px 0 0;font-size:12px}.bankc .kv2 b{font-weight:700;text-align:right}.bankc .kv2.amt b{font-size:16px;font-weight:800;color:#ef4444}'
+'.okw .acts{align-self:stretch;display:flex;flex-direction:column;gap:8px;margin-top:20px}'
+'.gbtn{height:44px;border-radius:22px;width:100%;background:linear-gradient(90deg,#1e3a8a,#3b82f6);color:#fff;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px}'
+'.gbtn.ol{background:#fff;border:1.5px solid #2563eb;color:#2563eb}.gbtn:disabled{opacity:.55}'
+'.home2{display:block;margin-top:28px;font-size:13px;font-weight:700;color:#64748b;text-decoration:underline}'
+'.slipok{align-self:stretch;margin-top:12px;background:#ecfdf5;color:#047857;border-radius:8px;padding:10px 12px;font-size:12px;font-weight:600;text-align:left;line-height:1.5}'
/* status */
+'.oid{display:flex;justify-content:space-between;align-items:center}.oid small{display:block;font-size:11px;color:#64748b}.oid b{font-size:14px;color:#0f172a}'
+'.stb{font-size:12px;font-weight:700;padding:4px 10px;border-radius:100px;white-space:nowrap}'
+'.stb.ok{background:#ecfdf5;color:#059669}.stb.wt{background:#fffbeb;color:#d97706}.stb.bl{background:#eff6ff;color:#2563eb}.stb.bad{background:#fef2f2;color:#dc2626}.stb.mut{background:#f1f5f9;color:#64748b}'
+'.tl{padding:4px 4px 0}.tl .h{font-size:13px;font-weight:700;color:#64748b;margin-bottom:14px}'
+'.st{display:flex;gap:12px;min-height:40px;position:relative}'
+'.st .dot{width:16px;flex:none;position:relative;display:flex;justify-content:center}'
+'.st .dot:before{content:"";position:absolute;top:14px;bottom:-2px;width:2px;background:#e2e8f0}.st:last-child .dot:before{display:none}'
+'.st .dot i{width:12px;height:12px;border-radius:6px;background:#e2e8f0;margin-top:2px;position:relative}'
+'.st.done .dot i{background:#059669}.st.done .dot:before{background:#059669}.st.cur .dot i{background:#2563eb;width:10px;height:10px;margin-top:3px}.st.done.nx .dot:before{background:#2563eb}'
+'.st .t b{display:block;font-size:12px;font-weight:700;color:#0f172a}.st .t small{display:block;font-size:10px;color:#64748b;margin-top:2px}'
+'.st.cur .t b{color:#2563eb}.st.todo .t b{font-weight:400;color:#64748b}'
+'.sitem{display:flex;gap:8px;align-items:center;margin-top:10px}.sitem img{width:40px;height:40px;border-radius:6px;object-fit:contain;background:#f8fafc;flex:none}'
+'.sitem b{display:block;font-size:12px;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sitem small{display:block;font-size:12px;color:#64748b}'
+'.twob{display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:1}'
+'.twob button,.twob a{height:40px;border-radius:20px;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;white-space:nowrap}'
+'.twob .l{background:#fff;border:1px solid #cbd5e1;color:#0f172a}.twob .r{background:linear-gradient(90deg,#1e3a8a,#3b82f6);color:#fff}.twob .r:disabled{background:#e2e8f0;color:#64748b}'
/* orders */
+'.otabs{background:#fff;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;padding:0 16px;overflow-x:auto;scrollbar-width:none;gap:14px;position:sticky;top:52px;z-index:11}'
+'.otabs::-webkit-scrollbar{display:none}'
+'.otabs button{height:40px;font-size:13px;color:#64748b;position:relative;white-space:nowrap;flex:none}.otabs button.on{color:#2563eb;font-weight:700}'
+'.otabs button.on:after{content:"";position:absolute;left:0;right:0;bottom:1px;height:3px;border-radius:1.5px;background:#2563eb}'
+'.ocard{background:#fff;border-radius:12px;padding:12px}'
+'.ocard .h{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12px;font-weight:700;color:#0f172a}.ocard .h span{display:flex;align-items:center;gap:4px}'
+'.ocard .h em{font-style:normal}.c-wt{color:#d97706}.c-ok{color:#059669}.c-bl{color:#2563eb}.c-bad{color:#dc2626}.c-mut{color:#64748b}'
+'.ocard .mid{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px;padding-bottom:12px;border-bottom:1px solid #e2e8f0;width:100%;text-align:left}'
+'.ocard .th{display:flex;gap:8px}.ocard .th img{width:48px;height:48px;border-radius:6px;object-fit:contain;background:#f8fafc}'
+'.ocard .sum{text-align:right}.ocard .sum small{display:block;font-size:11px;color:#64748b}.ocard .sum b{font-size:14px;font-weight:800;color:#ef4444}'
+'.ocard .ft{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:12px}.ocard .ft small{font-size:11px;color:#64748b}'
+'.ocard .ft .bs{display:flex;gap:8px}'
+'.sb2{height:28px;border-radius:14px;font-size:11px;font-weight:700;padding:0 14px;white-space:nowrap;display:inline-flex;align-items:center}'
+'.sb2.o{border:1px solid #2563eb;color:#2563eb}.sb2.m{border:1px solid #cbd5e1;color:#0f172a;font-weight:600}.sb2.g{background:linear-gradient(90deg,#1e3a8a,#3b82f6);color:#fff}'
+'.rcard{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:12px;margin-bottom:12px}'
+'.rcard .rh{display:flex;gap:12px;align-items:center}.rcard .ri{width:40px;height:40px;border-radius:20px;background:linear-gradient(90deg,#3b82f6,#1d4ed8);display:grid;place-items:center;flex:none}'
+'.rcard .rh b{display:block;font-size:15px;color:#0f172a}.rcard .rh small{display:block;font-size:12px;color:#64748b;margin-top:2px;line-height:1.5}'
+'.rcard .rl{display:flex;flex-direction:column;gap:6px;border-top:1px solid #f1f5f9;padding-top:10px}.rcard .rl div{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#475569}.rcard .rl em{font-style:normal;font-weight:700}'
+'.rcard .rl .c-w{color:#d97706}.rcard .rl .c-b{color:#2563eb}.rcard .rl .c-g{color:#059669}.rcard .rl .c-r{color:#dc2626}.rcard .rl .c-m{color:#64748b}'
+'.rcard .rb{height:40px;border-radius:10px;background:linear-gradient(90deg,#3b82f6,#1d4ed8);color:#fff;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center}'
+'@media(max-width:360px){.sgrid{gap:10px}.pd .price b{font-size:25px}.b2{padding:0 10px;font-size:13px}}';
var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

/* ---------- ข้อมูล ---------- */
var IMG={'triple:cream':'/cx-triple-cream.jpg','triple:black':'/cx-triple-black.jpg','duo:black':'/cx-duo.jpg','duo:cream':'/cx-duo.jpg','band:black':'/cx-band-black.jpg','band:cream':'/cx-band-cream.jpg',
  'scale:':'/cx-scale.jpg','routinex:':'/cx-routinex.jpg','polo:':'','fam-band:black':'/xr-prod-fam-band.jpg','fam-band:cream':'/xr-prod-fam-band.jpg'};
function imgOf(id,c){ return IMG[id+':'+(c||'')]||IMG[id+':black']||IMG[id+':']||''; }
function imgForName(nm){ nm=String(nm||''); var c=/ดำ|black/i.test(nm)?'black':'cream';
  if(/TRIPLE/i.test(nm))return imgOf('triple',c); if(/DUO/i.test(nm))return imgOf('duo',c); if(/ครอบครัว|family/i.test(nm))return imgOf('fam-band',c);
  if(/RoutineX/i.test(nm))return imgOf('routinex'); if(/Scale/i.test(nm))return imgOf('scale'); if(/Band/i.test(nm))return imgOf('band',c); return ''; }
/* ชื่อที่แสดงตามแบบ Figma (ชื่อที่บันทึกในคำสั่งซื้อยังเป็นชื่อเดิมของระบบ) */
var DISP={triple:{t:'TRIPLE SET',l:'TRIPLE SET ({c}) V2 + Scale + Supplement',s:'Xircle Band + Scale + RoutineX',brand:'Xircle & HabiX'},
  duo:{t:'DUO SET',l:'DUO SET (Xircle Band V2 + Smart Scale)',s:'Xircle Band + Smart Scale',brand:'Xircle'},
  band:{t:'Xircle Band V2',l:'Xircle Band V2 ({c})',s:'สายรัดข้อมืออัจฉริยะ',brand:'Xircle'},
  scale:{t:'Xircle Smart Scale',l:'Xircle Smart Scale เครื่องชั่งน้ำหนักอัจฉริยะ',s:'เครื่องชั่งวิเคราะห์ร่างกาย',brand:'Xircle'},
  routinex:{t:'RoutineX',l:'RoutineX Premium Daily Supplements (28 วัน)',s:'ชุดโภชนาการประจำวัน',brand:'HabiX'},
  polo:{t:'เสื้อโปโล X-Visor Premium Polo',l:'เสื้อโปโล X-Visor Premium Polo',s:'สีกรมท่า',brand:'CloverX'},
  'fam-band':{t:'[FAMILY] Xircle Band',l:'[FAMILY] Xircle Band',s:'สำหรับสมาชิกในครอบครัว',brand:'Xircle'}};
var CLAB={black:'สีดำ',cream:'สีครีม'}, CEN={black:'Black',cream:'Beige'}, CDOT={black:'#1e293b',cream:'#e7ddc8'};
function dispName(id,c){ var d=DISP[id]||{l:id}; return d.l.replace('{c}',CLAB[c]||''); }
var SHOP=null, shopAt=0;
function loadShop(force){ if(SHOP&&!force&&Date.now()-shopAt<60000)return Promise.resolve(SHOP);
  return api('/api/m/shop').then(function(j){ if(j&&j.ok){SHOP=j;shopAt=Date.now();} return SHOP; }); }
function prod(id){ return SHOP&&SHOP.products.filter(function(p){return p.id===id;})[0]; }
function leftOf(p,c){ if(!p)return null; if(p.colors.length){ var x=p.colors.filter(function(k){return k.c===c;})[0]; return x?x.left:null; } return p.left; }

/* ตะกร้า (เก็บในเครื่องนี้ แยกตามสมาชิก) */
var MEM={};
function ckey(){ var m=A.me()||{}; return 'cx_cart_'+(m.id||''); }
function cartGet(){ try{ var v=JSON.parse(localStorage.getItem(ckey())||'null'); if(Array.isArray(v))return v; }catch(e){} return MEM[ckey()]||[]; }
function cartSet(v){ MEM[ckey()]=v; try{ localStorage.setItem(ckey(),JSON.stringify(v)); }catch(e){} paintBadges(); }
function cartCount(){ return cartGet().length; }
function paintBadges(){ var n=cartCount(); $$('.cbadge').forEach(function(b){ b.textContent=n; b.style.display=n?'':'none'; }); }
function addToCart(line){ var c=cartGet().filter(function(x){ return !(x.id===line.id&&x.c===line.c); }); c.push(Object.assign({sel:true},line)); cartSet(c); }
var BUYNOW=null; // สั่งซื้อทันทีโดยไม่ผ่านตะกร้า

function barHtml(title,back,opt){ opt=opt||{};
  return '<div class="sbar"><a class="bk" href="'+back+'" aria-label="กลับ">'+sv('chevL',24,'#0f172a')+'</a><h1 class="'+(opt.center?'c':'')+(opt.small?' s':'')+'">'+esc(title)+'</h1>'
    +(opt.right||'')+'</div>'; }
function cartIcon(){ return '<a href="#cart" aria-label="ตะกร้าสินค้า">'+sv('cart',24,'#0f172a')+'<span class="cbadge" style="display:none">0</span></a>'; }

/* ---------- 81:4 รายการสินค้า ---------- */
var TABS=[['all','ทั้งหมด'],['set','เซตสุดคุ้ม'],['device','อุปกรณ์'],['supp','อาหารเสริม'],['fashion','แฟชั่น'],['family','ครอบครัว']];
var SECS=[['set','gift','เซตสุดคุ้ม (Best Value)'],['device','activity','อุปกรณ์สุขภาพ (Xircle)'],['supp','heart','อาหารเสริม (Supplements)'],['fashion','bag','แฟชั่น (Fashion)'],['family','users','ครอบครัว (Family Package)']];
var STAB='all', SQ='', TIMER=0;
function cardsFor(cat){ // การ์ดตามแบบ: สินค้าที่มีสีแยกการ์ดตามสี
  var out=[]; (SHOP.products||[]).filter(function(p){return p.cat===cat;}).forEach(function(p){
    if(p.colors.length&&p.id!=='duo'&&p.id!=='fam-band') p.colors.forEach(function(c){ out.push({p:p,c:c.c}); }); else out.push({p:p,c:''}); });
  return out; }
function cardHtml(o,wide){ var p=o.p, c=o.c, d=DISP[p.id]||{}, img=imgOf(p.id,c), off=p.was?Math.round((1-p.price/p.was)*100):0;
  var badge=p.soon?'<span class="bd dk">เร็วๆ นี้</span>':(p.fam?'<span class="bd">ต้องสั่งเซตหลักก่อน</span>':(p.cat==='set'&&p.id==='triple'?'<span class="bd">BEST VALUE</span>':(p.id==='routinex'?'<span class="bd">PREMIUM</span>':'')));
  var chips=c?[CLAB[c]]:(p.colors.length?p.colors.map(function(k){return k.label;}):(p.id==='polo'?['SS - 3XL']:(p.id==='scale'?['สีขาว']:[])));
  var left=leftOf(p,c), out=(left===0);
  var btn=p.soon?'<button class="pbtn soon" type="button" disabled>เตรียมพบกันเร็วๆ นี้</button>':(out?'<button class="pbtn" type="button" disabled>สินค้าหมด</button>':'<button class="pbtn" type="button" data-buy="'+p.id+'" data-c="'+c+'">สั่งซื้อเลยตอนนี้</button>');
  return '<div class="pc'+(wide?' w':'')+'"><a class="im'+(img?'':'')+'" href="#product/'+p.id+(c?('-'+c):'')+'" style="'+(img?('background-image:url(\''+img+'\')'):'')+'">'+(img?'':(p.soon?'COMING SOON':'No Image'))+badge+'</a>'
    +'<div class="dt"><h3>'+esc(dispName(p.id,c))+'</h3>'+(chips.length?'<div class="chips2">'+chips.map(function(x){return '<span>'+esc(x)+'</span>';}).join('')+'</div>':'')
    +'<div class="pr2"><div class="p">'+money(p.price)+(off>0?'<i>-'+off+'%</i>':'')+'</div>'+(p.was?'<s>ปกติ '+money(p.was)+'</s>':'')+'</div>'+btn+'</div></div>'; }
function renderShop(){ var v=$('#v-shop');
  v.innerHTML=barHtml('CloverX Pre-Order','#home',{right:'<div class="act"><button type="button" id="shSearch" aria-label="ค้นหา">'+sv('search',24,'#0f172a')+'</button>'+cartIcon()+'</div>'})
    +'<div class="ssearch'+(SQ?'':' hide')+'" id="shQ"><input type="search" placeholder="ค้นหาสินค้า" value="'+esc(SQ)+'"></div>'
    +'<div class="stabs" role="tablist">'+TABS.map(function(t){return '<button type="button" data-st="'+t[0]+'" class="'+(STAB===t[0]?'on':'')+'">'+t[1]+'</button>';}).join('')+'</div><div id="shBody"><div class="sempty">กำลังโหลด…</div></div>';
  paintBadges();
  $('#shSearch').onclick=function(){ var q=$('#shQ'); q.classList.toggle('hide'); if(!q.classList.contains('hide'))$('input',q).focus(); };
  $('#shQ input').oninput=function(){ SQ=this.value.trim(); paintShop(); };
  $$('[data-st]',v).forEach(function(b){ b.onclick=function(){ STAB=b.dataset.st; $$('[data-st]',v).forEach(function(x){x.classList.toggle('on',x===b);}); paintShop(); }; });
  loadShop().then(paintShop).catch(function(){ $('#shBody').innerHTML='<div class="sempty">โหลดสินค้าไม่สำเร็จ กรุณาลองใหม่</div>'; });
}
function paintShop(){ var box=$('#shBody'); if(!box||!SHOP)return; var h='';
  if(SHOP.round){ h+='<div class="round"><div><b>'+esc(SHOP.round)+'</b>'+(SHOP.closeAt?'<small>ปิดรับจอง '+esc(A.thDate(SHOP.closeAt))+'</small>':'')+'</div>'+(SHOP.closeAt?'<div class="timer" id="shTimer"></div>':'')+'</div>'; }
  if(!SHOP.open) h+='<div class="closed2"><b>'+esc(SHOP.closedTitle||'ปิดรับสั่งจองชั่วคราว')+'</b><br>'+esc(SHOP.closedMsg||'ติดตามรอบถัดไปได้ทาง LINE @cloverxth')+'</div>';
  var any=false, q=SQ.toLowerCase();
  SECS.forEach(function(s){ if(STAB!=='all'&&STAB!==s[0])return; var cs=cardsFor(s[0]).filter(function(o){ return !q||dispName(o.p.id,o.c).toLowerCase().indexOf(q)>=0||o.p.nm.toLowerCase().indexOf(q)>=0; });
    if(!cs.length)return; any=true; var pairs=cs.filter(function(o){return o.c&&o.p.id!=='duo'&&o.p.id!=='fam-band';});
    h+='<section class="ssec"><h2>'+sv(s[1],20,'#2563eb')+esc(s[2])+'</h2><div class="sgrid">'+cs.map(function(o){ return cardHtml(o,false); }).join('')+'</div></section>'; });
  if(!any) h+='<div class="sempty">ไม่พบสินค้าที่ค้นหา</div>';
  box.innerHTML=h+'<div style="height:12px"></div>';
  $$('[data-buy]',box).forEach(function(b){ b.onclick=function(){ openSheet(b.dataset.buy,b.dataset.c,'buy'); }; });
  if(!SHOP.open) $$('[data-buy]',box).forEach(function(b){ b.disabled=true; b.textContent='ปิดรับจอง'; });
  tick();
}
function tick(){ clearInterval(TIMER); var el=$('#shTimer'); if(!el||!SHOP||!SHOP.closeAt)return; var end=Date.parse(SHOP.closeAt.length>10?SHOP.closeAt+':00+07:00':SHOP.closeAt+'T23:59:59+07:00');
  var f=function(){ var t=Math.max(0,end-Date.now()), dd=Math.floor(t/86400000), hh=Math.floor(t%86400000/3600000), mm=Math.floor(t%3600000/60000), ss=Math.floor(t%60000/1000), p=function(n){return ('0'+n).slice(-2);};
    if(!$('#shTimer')){ clearInterval(TIMER); return; } $('#shTimer').innerHTML=(dd?'<span>'+dd+' วัน</span>':'')+'<span>'+p(hh)+'</span>:<span>'+p(mm)+'</span>:<span>'+p(ss)+'</span>'; };
  f(); TIMER=setInterval(f,1000); }

/* ---------- 87:4 รายละเอียดสินค้า ---------- */
var PSEL={};
function renderProduct(key){ var v=$('#v-product'); var parts=String(key||'').split('-'), id=parts[0], c=parts.slice(1).join('-');
  if(id==='fam'){ id='fam-band'; c=parts.slice(2).join('-'); }
  v.innerHTML=barHtml('รายละเอียดสินค้า','#shop',{center:true,right:'<div class="act"><button type="button" id="pdShare" aria-label="แชร์">'+sv('share',24,'#0f172a')+'</button>'+cartIcon()+'</div>'})+'<div class="sempty">กำลังโหลด…</div>';
  paintBadges();
  loadShop().then(function(){ var p=prod(id); if(!p){ v.querySelector('.sempty').textContent='ไม่พบสินค้านี้'; return; }
    if(p.colors.length&&!c)c=PSEL[id]||p.colors[0].c; PSEL[id]=c;
    var d=DISP[id]||{}, off=p.was?Math.round((1-p.price/p.was)*100):0;
    var imgs=[]; if(p.colors.length)p.colors.forEach(function(k){ var u=imgOf(id,k.c); if(u&&imgs.indexOf(u)<0)imgs.push(u); }); else if(imgOf(id))imgs.push(imgOf(id));
    var first=imgOf(id,c); if(first){ imgs=imgs.filter(function(u){return u!==first;}); imgs.unshift(first); }
    var left=leftOf(p,c);
    var h='<div class="pd"><div class="hero2"><div class="slides" id="pdSl">'+(imgs.length?imgs.map(function(u){return '<div class="slide" style="background-image:url(\''+u+'\')"></div>';}).join(''):'<div class="slide" style="display:grid;place-items:center;color:#64748b;font-weight:700">No Image</div>')+'</div>'
      +(imgs.length>1?'<div class="dots2">'+imgs.map(function(_,i){return '<i class="'+(i?'':'on')+'"></i>';}).join('')+'</div>':'')+'<span class="idx">รูปภาพ <span id="pdIx">1</span>/'+Math.max(1,imgs.length)+'</span></div>'
      +'<div class="blk" style="margin-bottom:0"><div class="price"><b>'+money(p.price)+'</b>'+(p.was?'<s>'+money(p.was)+'</s><i>-'+off+'%</i>':'')+'</div>'
      +'<div class="inst">'+sv('card',14,'#64748b')+'รองรับบัตรเครดิต/เดบิต และการโอนธนาคาร</div>'
      +'<div class="ttl"><span>ของแท้</span><b>'+esc(d.t||p.nm)+'</b></div><div class="sub2">'+esc(d.s||'')+'</div></div><div style="height:8px"></div>';
    if(p.colors.length) h+='<div class="blk"><h4>เลือกสี ('+(id==='triple'||id==='duo'?'Xircle Band':'สาย')+')</h4><div class="vopts">'+p.colors.map(function(k){ return '<button type="button" class="vopt'+(k.c===c?' on':'')+'" data-v="'+k.c+'"'+(k.left===0?' disabled':'')+'><img src="'+imgOf(id,k.c)+'" alt="">'+esc(k.label)+' ('+CEN[k.c]+')'+(k.left===0?' หมด':'')+'</button>'; }).join('')+'</div></div>';
    if(p.box&&p.box.length) h+='<div class="blk"><h4>อุปกรณ์ในกล่อง (What\'s in the box)</h4><div class="boxl">'+p.box.map(function(x){return '<div>'+sv('checkC',16,'#059669')+esc(x)+'</div>';}).join('')+'</div></div>';
    h+='<div class="blk"><h4>ข้อมูลการจัดส่ง</h4><div class="shipc"><div class="r">'+sv('truck',18)+'<div><b>จัดส่งฟรี</b><small>ได้รับภายในระยะเวลาที่ทางบริษัทฯ กำหนด</small></div></div><div class="r">'+sv('cash',18)+'<b>ยังไม่มีบริการเก็บเงินปลายทาง (NON-COD)</b></div></div></div>';
    h+='<div class="blk"><div class="storer"><span class="av2">CX</span><div class="nm2"><b>Cloverxth Official Store'+sv('verified',14,'#2563eb')+'</b><small>สอบถามทีมงานทาง LINE @cloverxth</small></div><a class="obtn" href="#shop">เข้าร้าน</a></div></div>';
    h+='<div class="blk"><h4>รายละเอียดสินค้า</h4><div class="spec"><div><span>แบรนด์</span><b>'+esc(d.brand||'CloverX')+'</b></div><div><span>รุ่น</span><b>'+esc(d.t||p.nm)+'</b></div>'+(p.box&&p.box.length?'<div><span>สิ่งที่ได้รับ</span><b>'+esc(d.s||'')+'</b></div>':'')+'</div></div></div>';
    var soon=p.soon||!SHOP.open||left===0;
    h+='<div class="sticky2"><a class="ico" href="'+A.LINE+'" target="_blank" rel="noopener">'+sv('msg',20,'#64748b')+'แชทร้าน</a><button type="button" class="ico'+(fav(id)?' on':'')+'" id="pdFav">'+sv('heart',20)+'ถูกใจ</button><span class="sp"></span>'
      +'<button class="b2 o" type="button" id="pdAdd"'+(soon?' disabled':'')+'>หยิบใส่ตะกร้า</button><button class="b2 g" type="button" id="pdBuy"'+(soon?' disabled':'')+'>'+(p.soon?'เร็วๆ นี้':(!SHOP.open?'ปิดรับจอง':(left===0?'สินค้าหมด':'สั่งซื้อเลย')))+'</button></div>';
    v.innerHTML=v.querySelector('.sbar').outerHTML+h; paintBadges();
    var sl=$('#pdSl'); if(sl)sl.onscroll=function(){ var i=Math.round(sl.scrollLeft/sl.clientWidth); $('#pdIx').textContent=i+1; $$('.dots2 i',v).forEach(function(x,k){x.classList.toggle('on',k===i);}); };
    $$('[data-v]',v).forEach(function(b){ b.onclick=function(){ PSEL[id]=b.dataset.v; location.replace('#product/'+id+'-'+b.dataset.v); }; });
    $('#pdAdd').onclick=function(){ openSheet(id,PSEL[id]||'','cart'); }; $('#pdBuy').onclick=function(){ openSheet(id,PSEL[id]||'','buy'); };
    $('#pdFav').onclick=function(){ fav(id,true); this.classList.toggle('on',fav(id)); };
    $('#pdShare').onclick=function(){ var u=location.origin+'/app#product/'+id+(c?'-'+c:''); if(navigator.share){ navigator.share({title:d.t||p.nm,url:u}).catch(function(){}); } else { try{navigator.clipboard.writeText(u); toast('คัดลอกลิงก์แล้ว');}catch(e){} } };
  }).catch(function(){ toast('โหลดสินค้าไม่สำเร็จ'); });
}
function fav(id,toggle){ var k='cx_fav'; var s={}; try{ s=JSON.parse(localStorage.getItem(k)||'{}')||{}; }catch(e){}
  if(toggle){ s[id]=!s[id]; try{ localStorage.setItem(k,JSON.stringify(s)); }catch(e){} toast(s[id]?'เพิ่มในรายการที่ถูกใจแล้ว':'นำออกจากรายการที่ถูกใจแล้ว'); } return !!s[id]; }

/* ---------- 92:10 เลือกสีและจำนวน ---------- */
function openSheet(id,c,mode){ loadShop().then(function(){ var p=prod(id); if(!p)return;
  if(p.fam&&!cartGet().some(function(l){ return l.id!=='fam-band'&&/triple|duo|band/.test(l.id); })){ A.sheet('ต้องสั่งเซตหลักก่อน','<span class="ln">Band ครอบครัว สั่งได้เมื่อมีเซตหลัก</span> <span class="ln">(TRIPLE, DUO หรือ Xircle Band) ในตะกร้าแล้ว</span>','<a class="btn" href="#shop">ไปเลือกเซตหลัก</a>'); return; }
  if(p.colors.length&&!c)c=PSEL[id]||p.colors[0].c;
  var bg=document.createElement('div'); bg.className='shbg';
  var paint=function(){ var left=leftOf(p,c);
    bg.innerHTML='<div class="shp" role="dialog" aria-modal="true" aria-label="เลือกตัวเลือกสินค้า"><div class="hd"></div><div class="top"><img src="'+(imgOf(id,c)||'')+'" alt=""><div class="t"><b>'+money(p.price)+'</b>'+(left!=null?'<small>คลัง: เหลือ '+baht(left)+' ชิ้น</small>':'')+(c?'<em>เลือกแล้ว: '+esc(CLAB[c])+' ('+CEN[c]+')</em>':'<em>'+esc(dispName(id,''))+'</em>')+'</div><button type="button" data-x aria-label="ปิด">'+sv('x',20,'#475569')+'</button></div>'
      +(p.colors.length?'<div class="row"><b>เลือกสี ('+(id==='triple'||id==='duo'?'Xircle Band':'สาย')+')</b>'+p.colors.map(function(k){ return '<button type="button" class="pill2'+(k.c===c?' on':'')+'" data-pc="'+k.c+'"'+(k.left===0?' disabled':'')+'><i style="background:'+CDOT[k.c]+'"></i>'+esc(k.label)+' ('+CEN[k.c]+')'+(k.left===0?' หมด':'')+'</button>'; }).join('')+'</div>':'')
      +(p.fam?'<div class="row"><b>ข้อมูลสมาชิกในครอบครัวที่ใช้ Band นี้</b><input class="fin" id="shFn" placeholder="ชื่อ นามสกุล"><input class="fin" id="shFp" inputmode="tel" placeholder="เบอร์โทรศัพท์"><div class="ferr hide" id="shErr"></div></div>':'')
      +'<div class="row"><div class="qrow"><div><b>จำนวน</b><small>จำกัด 1 ชุดต่อคำสั่งซื้อ</small></div><div class="qty"><button type="button" disabled>-</button><span>1</span><button type="button" disabled>+</button></div></div></div>'
      +'<button class="cta2" type="button" id="shGo"'+(left===0?' disabled':'')+'>'+(left===0?'สินค้าหมด':(mode==='buy'?'สั่งซื้อเลย':'หยิบใส่ตะกร้า'))+'</button></div>';
    $$('[data-pc]',bg).forEach(function(b){ b.onclick=function(){ c=b.dataset.pc; PSEL[id]=c; paint(); }; });
    $('[data-x]',bg).onclick=function(){ bg.remove(); };
    $('#shGo',bg).onclick=function(){ var line={id:id,c:c};
      if(p.fam){ var fn=$('#shFn',bg).value.trim(), fp=$('#shFp',bg).value.replace(/\D/g,'').replace(/^66(?=[689]\d{8}$)/,'0'); if(!fn||!/^0[689]\d{8}$/.test(fp)){ var e=$('#shErr',bg); e.textContent='กรุณากรอกชื่อและเบอร์มือถือ 10 หลักของสมาชิกในครอบครัว'; e.classList.remove('hide'); return; } line.famName=fn; line.famPhone=fp; }
      bg.remove();
      if(mode==='buy'){ BUYNOW=[line]; location.hash='#checkout'; }
      else { addToCart(line); toast('หยิบใส่ตะกร้าแล้ว'); }
    };
  };
  bg.onclick=function(e){ if(e.target===bg)bg.remove(); };
  paint(); document.body.appendChild(bg); }); }

/* ---------- 92:59 ตะกร้า ---------- */
function renderCart(){ var v=$('#v-cart'); var cart=cartGet();
  var paint=function(){ cart=cartGet(); var sel=cart.filter(function(l){return l.sel!==false;}), tot=sel.reduce(function(t,l){ var p=prod(l.id); return t+(p?p.price:0); },0);
    var h=barHtml('ตะกร้าสินค้า ('+cart.length+')','#shop',{small:true})+'<div class="sbody withbar">';
    if(!cart.length) h+='<div class="cardw"><div class="sempty">ยังไม่มีสินค้าในตะกร้า<div style="margin-top:14px"><a class="sb2 o" href="#shop" style="height:34px;font-size:13px">เลือกซื้อสินค้า</a></div></div></div>';
    else h+='<div class="cardw"><div class="sthd"><button class="ck'+(sel.length===cart.length?'':' off')+'" type="button" data-all>'+sv('checkC',20)+'</button>CloverX Official Store<span class="vf">'+sv('verified',14,'#059669')+'</span></div>'
      +cart.map(function(l,i){ var p=prod(l.id); if(!p)return ''; return '<div class="citem"><button class="ck'+(l.sel===false?' off':'')+'" type="button" data-sel="'+i+'">'+sv('checkC',20)+'</button><a href="#product/'+l.id+(l.c?'-'+l.c:'')+'"><img src="'+(imgOf(l.id,l.c)||'')+'" alt=""></a><div class="m"><div class="n">'+esc(dispName(l.id,l.c))+'</div>'
        +(l.c?'<div class="v">สี: '+esc((CLAB[l.c]||'').replace('สี',''))+' ('+CEN[l.c]+')</div>':'')+(l.famName?'<div class="v">ผู้ใช้: '+esc(l.famName)+'</div>':'')
        +'<div class="pq"><b>'+money(p.price)+'</b><div class="qty sm"><button type="button" data-rm="'+i+'" aria-label="นำออก">-</button><span>1</span><button type="button" disabled>+</button></div></div></div></div>'; }).join('')+'</div>';
    h+='</div>';
    if(cart.length) h+='<div class="cbottom"><button class="all" type="button" data-all><span class="ck'+(sel.length===cart.length?'':' off')+'">'+sv('checkC',20)+'</span>เลือกทั้งหมด</button><span class="sp"></span><div class="tt">รวม: <b>'+money(tot)+'</b></div><button class="rbtn" type="button" id="ctGo"'+(sel.length&&SHOP.open?'':' disabled')+'>สั่งซื้อ ('+sel.length+')</button></div>';
    v.innerHTML=h;
    $$('[data-sel]',v).forEach(function(b){ b.onclick=function(){ var c=cartGet(); c[+b.dataset.sel].sel=c[+b.dataset.sel].sel===false; cartSet(c); paint(); }; });
    $$('[data-all]',v).forEach(function(b){ b.onclick=function(){ var c=cartGet(), all=c.every(function(l){return l.sel!==false;}); c.forEach(function(l){l.sel=!all;}); cartSet(c); paint(); }; });
    $$('[data-rm]',v).forEach(function(b){ b.onclick=function(){ var c=cartGet(); var l=c[+b.dataset.rm]; c.splice(+b.dataset.rm,1);
      if(l&&l.id!=='fam-band'&&!c.some(function(x){return x.id!=='fam-band';})) c=c.filter(function(x){return x.id!=='fam-band';});
      cartSet(c); toast('นำสินค้าออกจากตะกร้าแล้ว'); paint(); }; });
    var g=$('#ctGo'); if(g)g.onclick=function(){ BUYNOW=null; location.hash='#checkout'; };
  };
  v.innerHTML=barHtml('ตะกร้าสินค้า','#shop',{small:true})+'<div class="sempty">กำลังโหลด…</div>';
  loadShop().then(paint); }

/* ---------- 92:127 ชำระเงิน ---------- */
var CO={pay:'bank',note:'',addr:null,team:'',ref:''}, GEO=null;
function coLines(){ return BUYNOW||cartGet().filter(function(l){return l.sel!==false;}); }
function renderCheckout(){ var v=$('#v-checkout'); var lines=coLines();
  if(!lines.length){ location.replace('#cart'); return; }
  v.innerHTML=barHtml('ชำระเงิน',BUYNOW?'#shop':'#cart',{small:true})+'<div class="sempty">กำลังโหลด…</div>';
  Promise.all([loadShop(),CO.addr?Promise.resolve(null):api('/api/m/address')]).then(function(r){ var a=r[1];
    if(a&&a.ok){ CO.addr=a.address; CO.team=CO.team||a.team||''; CO.ref=CO.ref||a.ref||''; }
    var m=A.me()||{}; if(!CO.addr)CO.addr={name:m.name||'',phone:m.phone||'',line:'',sub:'',dist:'',prov:'',zip:''};
    paintCo(); }).catch(function(){ toast('เชื่อมต่อไม่สำเร็จ'); }); }
function addrOk(a){ return a&&a.name&&/^0[689]\d{8}$/.test(String(a.phone||'').replace(/\D/g,''))&&a.line&&a.prov&&/^\d{5}$/.test(a.zip||''); }
function paintCo(){ var v=$('#v-checkout'), lines=coLines(), a=CO.addr||{}, ok=addrOk(a);
  var tot=lines.reduce(function(t,l){ var p=prod(l.id); return t+(p?p.price:0); },0);
  var h=barHtml('ชำระเงิน',BUYNOW?'#shop':'#cart',{small:true})+'<div class="sbody withbar">'
    +'<div class="cardw"><button type="button" class="addr'+(ok?'':' need')+'" id="coAddr"><span class="pin2">'+sv('pin',20,'#2563eb')+'</span><span class="m">'+(ok?('<b>'+esc(a.name)+'<span class="ph">'+esc(a.phone)+'</span></b><p>'+esc(a.line+(a.sub?' ต.'+a.sub:'')+(a.dist?' อ.'+a.dist:'')+' จ.'+a.prov+' '+a.zip)+'</p>'):'<b>เพิ่มที่อยู่จัดส่ง</b><p>กรุณาระบุชื่อ เบอร์โทร และที่อยู่สำหรับจัดส่ง</p>')+'</span><span class="go2">'+sv('chevR',16,'#94a3b8')+'</span></button></div>'
    +'<div class="cardw"><div class="sthd" style="font-size:13px">'+sv('store',16,'#0f172a')+'CloverX Official Store</div>'
    +lines.map(function(l){ var p=prod(l.id); if(!p)return ''; return '<div class="oitem"><img src="'+(imgOf(l.id,l.c)||'')+'" alt=""><div class="m"><div class="n">'+esc((DISP[l.id]||{}).t||p.nm)+(l.c?' ('+esc(CLAB[l.c])+')':'')+'</div>'+(l.c?'<div class="v">สี: '+esc((CLAB[l.c]||'').replace('สี',''))+' ('+CEN[l.c]+')</div>':'')+(l.famName?'<div class="v">ผู้ใช้: '+esc(l.famName)+'</div>':'')+'<div class="p">'+money(p.price)+'<span>x1</span></div></div></div>'; }).join('')
    +'<div class="hr"></div><div class="shipr"><div><b>การจัดส่ง : ส่งธรรมดา</b><small>ได้รับภายในระยะเวลาที่บริษัทฯ กำหนด</small></div><em>฿0 (ฟรี)</em></div>'
    +'<div class="note2"><span>หมายเหตุถึงร้าน :</span><input id="coNote" maxlength="200" placeholder="ระบุข้อความถึงผู้ขาย (ไม่บังคับ)..." value="'+esc(CO.note)+'"></div></div>'
    +'<div class="cardw"><div class="lbl2">ทีมโค้ชและผู้แนะนำ</div><div class="refr"><select id="coTeam"><option value="">เลือกทีมโค้ช</option>'+['โค้ชนุ่น','โค้ชซิง','โค้ชจา','โค้ชต๊ะ','CloverX'].map(function(t){return '<option'+(CO.team===t?' selected':'')+'>'+t+'</option>';}).join('')+'</select><input id="coRef" maxlength="60" placeholder="ชื่อผู้แนะนำ" value="'+esc(CO.ref)+'"></div></div>'
    +'<div class="cardw"><div class="lbl2">วิธีการชำระเงิน</div>'
    +'<button type="button" class="payopt'+(CO.pay==='bank'?' on':'')+'" data-pay="bank"><span class="l">'+sv('card',18)+'โอนเงินผ่านบัญชีธนาคาร (แนะนำ)</span><span class="radio"></span></button>'
    +(CO.pay==='bank'?'<div class="bankbox"><img src="/xr-kbank.png" alt="กสิกรไทย"><div><b>ธนาคารกสิกรไทย (K-Bank)</b><small>'+ACCT_NAME+' ('+ACCT_NO+')</small></div></div>':'')
    +'<button type="button" class="payopt'+(CO.pay==='card'?' on':'')+'" data-pay="card"><span class="l">'+sv('card',18)+'บัตรเครดิต/เดบิต</span><span class="radio"></span></button></div>'
    +'<div class="cardw"><div class="kv2"><span>ยอดรวมสินค้า</span><b>'+money(tot)+'</b></div><div class="kv2"><span>ค่าส่ง</span><b>฿0</b></div><div class="hr" style="margin:8px 0"></div><div class="kv2 t"><span>ยอดชำระสุทธิ</span><b>'+money(tot)+'</b></div></div>'
    +'<div class="ferr hide" id="coErr" style="padding:0 4px"></div></div>'
    +'<div class="cbottom"><div class="tt2"><small>ยอดชำระทั้งหมด</small><b>'+money(tot)+'</b></div><button class="rbtn" type="button" id="coGo"'+(SHOP.open?'':' disabled')+'>'+(SHOP.open?'สั่งซื้อ':'ปิดรับจอง')+'</button></div>';
  v.innerHTML=h;
  $('#coAddr').onclick=openAddr;
  $('#coNote').oninput=function(){ CO.note=this.value; }; $('#coTeam').onchange=function(){ CO.team=this.value; }; $('#coRef').oninput=function(){ CO.ref=this.value.trim(); };
  $$('[data-pay]',v).forEach(function(b){ b.onclick=function(){ CO.pay=b.dataset.pay; paintCo(); }; });
  $('#coGo').onclick=submitOrder; }
function coErr(m){ var e=$('#coErr'); e.innerHTML=m; e.classList.toggle('hide',!m); if(m)e.scrollIntoView({block:'center',behavior:'smooth'}); }
function submitOrder(){ var btn=$('#coGo'), lines=coLines();
  if(!addrOk(CO.addr)){ coErr('กรุณาเพิ่มที่อยู่จัดส่งให้ครบ'); openAddr(); return; }
  if(!CO.team||!CO.ref){ coErr('กรุณาเลือกทีมโค้ชและกรอกชื่อผู้แนะนำ'); return; }
  coErr(''); btn.disabled=true; btn.textContent='กำลังสั่งซื้อ…';
  api('/api/m/checkout',{method:'POST',body:{items:lines.map(function(l){return {id:l.id,c:l.c,famName:l.famName,famPhone:l.famPhone};}),addr:CO.addr,team:CO.team,ref:CO.ref,note:CO.note,pay:CO.pay}}).then(function(j){
    if(j.ok&&j.id){ if(!BUYNOW){ cartSet(cartGet().filter(function(l){return l.sel===false;})); } BUYNOW=null; CO.note='';
      if(j.payUrl){ location.href=j.payUrl; return; } location.hash='#done/'+j.id; return; }
    btn.disabled=false; btn.textContent='สั่งซื้อ';
    coErr({out_of_stock:esc(j.message||'สินค้าบางรายการหมดแล้ว'),preorder_closed:'ขณะนี้ปิดรับสั่งจองชั่วคราว',bad_addr:'ที่อยู่จัดส่งไม่ครบ กรุณาตรวจสอบ',need_ref:'กรุณาเลือกทีมโค้ชและกรอกชื่อผู้แนะนำ',fam_needs_main:'Band ครอบครัวต้องสั่งพร้อมเซตหลัก',fam_info:'กรุณากรอกข้อมูลสมาชิกในครอบครัวให้ครบ',login_required:'กรุณาเข้าสู่ระบบใหม่',save_failed:esc(j.message||'บันทึกไม่สำเร็จ กรุณาลองใหม่')}[j.error]||'สั่งซื้อไม่สำเร็จ กรุณาลองใหม่ หรือติดต่อ LINE @cloverxth');
  }).catch(function(){ btn.disabled=false; btn.textContent='สั่งซื้อ'; coErr('เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่'); }); }
function openAddr(){ var a=Object.assign({},CO.addr||{}); var bg=document.createElement('div'); bg.className='shbg';
  bg.innerHTML='<div class="shp" role="dialog" aria-modal="true" aria-label="ที่อยู่จัดส่ง"><div class="hd"></div><div class="lbl2" style="font-size:16px">ที่อยู่จัดส่ง</div>'
    +'<input class="fin" id="adN" placeholder="ชื่อผู้รับ" value="'+esc(a.name||'')+'"><input class="fin" id="adP" inputmode="tel" placeholder="เบอร์โทรศัพท์ผู้รับ" value="'+esc(a.phone||'')+'">'
    +'<input class="fin" id="adL" placeholder="บ้านเลขที่ หมู่บ้าน ถนน" value="'+esc(a.line||'')+'">'
    +'<input class="fin" id="adG" placeholder="ค้นหา ตำบล อำเภอ จังหวัด หรือรหัสไปรษณีย์" value="'+esc(a.prov?((a.sub?a.sub+' ':'')+(a.dist?a.dist+' ':'')+a.prov+' '+a.zip):'')+'" autocomplete="off"><div id="adList" style="max-height:200px;overflow:auto"></div>'
    +'<div class="ferr hide" id="adErr"></div><button class="cta2" type="button" id="adSave" style="margin-top:16px">บันทึกที่อยู่</button></div>';
  document.body.appendChild(bg); bg.onclick=function(e){ if(e.target===bg)bg.remove(); };
  var g=$('#adG',bg), list=$('#adList',bg);
  var loadGeo=function(){ if(GEO)return Promise.resolve(GEO); return fetch('/thai-geo.json').then(function(r){return r.json();}).then(function(d){ GEO=d; return d; }); };
  g.oninput=function(){ var q=g.value.trim(); a.sub=a.dist=a.prov=a.zip=''; if(q.length<2){ list.innerHTML=''; return; }
    loadGeo().then(function(d){ var qs=q.split(/\s+/); var res=[]; for(var i=0;i<d.length&&res.length<40;i++){ var r=d[i], s=r.join(' '); if(qs.every(function(t){return s.indexOf(t)>=0;}))res.push(r); }
      list.innerHTML=res.map(function(r,i){ return '<button type="button" data-g="'+i+'" style="display:block;width:100%;text-align:left;padding:10px 4px;border-bottom:1px solid #f1f5f9;font-size:13px">ต.'+esc(r[0])+' อ.'+esc(r[1])+' จ.'+esc(r[2])+' '+esc(r[3])+'</button>'; }).join('')||'<div class="ferr">ไม่พบพื้นที่ที่ค้นหา</div>';
      $$('[data-g]',list).forEach(function(b){ b.onclick=function(){ var r=res[+b.dataset.g]; a.sub=r[0]; a.dist=r[1]; a.prov=r[2]; a.zip=String(r[3]); g.value='ต.'+r[0]+' อ.'+r[1]+' จ.'+r[2]+' '+r[3]; list.innerHTML=''; }; });
    }).catch(function(){ list.innerHTML='<div class="ferr">โหลดข้อมูลพื้นที่ไม่สำเร็จ</div>'; }); };
  $('#adSave',bg).onclick=function(){ a.name=$('#adN',bg).value.trim(); a.phone=$('#adP',bg).value.replace(/\D/g,'').replace(/^66(?=[689]\d{8}$)/,'0'); a.line=$('#adL',bg).value.trim();
    var e=$('#adErr',bg), msg=!a.name?'กรุณากรอกชื่อผู้รับ':(!/^0[689]\d{8}$/.test(a.phone)?'กรุณากรอกเบอร์มือถือ 10 หลัก':(!a.line?'กรุณากรอกบ้านเลขที่และถนน':(!a.prov||!a.zip?'กรุณาค้นหาแล้วเลือกตำบล อำเภอ จังหวัด':'')));
    if(msg){ e.textContent=msg; e.classList.remove('hide'); return; } CO.addr=a; bg.remove(); paintCo(); };
}

/* ---------- 92:220 สั่งซื้อสำเร็จ ---------- */
var ORD=null, ordAt=0;
function loadOrders(force){ if(ORD&&!force&&Date.now()-ordAt<15000)return Promise.resolve(ORD);
  return api('/api/m/orders').then(function(j){ if(j._s===401){ A.logout(); return []; } ORD=j.orders||[]; ordAt=Date.now(); return ORD; }); }
function findOrd(id){ return (ORD||[]).filter(function(o){return o.id===id;})[0]; }
function renderDone(id){ var v=$('#v-done'); v.innerHTML='<div class="sempty">กำลังโหลด…</div>';
  loadOrders(true).then(function(){ var o=findOrd(id); if(!o){ v.innerHTML=barHtml('คำสั่งซื้อ','#orders',{small:true})+'<div class="sempty">ไม่พบคำสั่งซื้อนี้</div>'; return; }
    var bank=o.pay==='bank', pend=o.status==='pending';
    var h='<div class="okw"><span class="bdg">'+sv('check',36,'#fff',2.5)+'</span><h2>สั่งซื้อสำเร็จ!</h2><div class="sb">ขอบคุณสำหรับการสั่งซื้อ CloverX</div><span class="po">หมายเลขคำสั่งซื้อ '+esc(o.id)+'</span>';
    if(bank&&pend&&!o.hasSlip) h+='<div class="warnb">'+sv('clock',18,'#d97706')+'<span><span class="ln">กรุณาโอนเงินและอัปโหลดสลิป</span> <span class="ln">เพื่อยืนยันคำสั่งซื้อ</span></span></div>';
    if(bank) h+='<div class="bankc"><div class="h">โอนเงินเข้าบัญชี:</div><div class="br"><img src="/xr-kbank.png" alt=""><b>ธนาคารกสิกรไทย (K-Bank)</b></div>'
      +'<div class="no"><div><small>เลขที่บัญชี</small><b>'+ACCT_NO+'</b></div><button class="cp" type="button" id="dnCopy">คัดลอก</button></div>'
      +'<div class="kv2"><span>ชื่อบัญชี</span><b>'+ACCT_NAME+'</b></div><div class="kv2 amt"><span>ยอดเงินที่ต้องโอน</span><b>'+money(o.total)+'</b></div></div>';
    if(o.hasSlip&&pend) h+='<div class="slipok"><span class="ln">ได้รับสลิปแล้ว</span> <span class="ln">ทีมงานกำลังตรวจสอบการชำระเงิน</span></div>';
    h+='<div class="acts">'+(bank&&pend?'<button class="gbtn" type="button" id="dnSlip">'+sv('upload',18,'#fff')+(o.hasSlip?'อัปโหลดสลิปใหม่':'อัปโหลดสลิป')+'</button>':'')+'<a class="gbtn ol" href="#order/'+esc(o.id)+'">ดูคำสั่งซื้อ</a></div><a class="home2" href="#home">กลับหน้าหลัก</a></div>';
    v.innerHTML=h;
    var cp=$('#dnCopy'); if(cp)cp.onclick=function(){ try{ navigator.clipboard.writeText(ACCT_NO.replace(/-/g,'')); toast('คัดลอกเลขบัญชีแล้ว'); }catch(e){ toast(ACCT_NO); } };
    var sl=$('#dnSlip'); if(sl)sl.onclick=function(){ pickSlip(o.id,function(){ renderDone(id); }); };
  }).catch(function(){ v.innerHTML='<div class="sempty">เชื่อมต่อไม่สำเร็จ</div>'; }); }
function pickSlip(id,after){ var f=document.createElement('input'); f.type='file'; f.accept='image/*';
  f.onchange=function(){ var file=f.files[0]; if(!file)return; var rd=new FileReader(); rd.onload=function(){ var im=new Image(); im.onload=function(){
      var s=Math.min(1,1600/Math.max(im.width,im.height)), c=document.createElement('canvas'); c.width=Math.round(im.width*s); c.height=Math.round(im.height*s); c.getContext('2d').drawImage(im,0,0,c.width,c.height);
      toast('กำลังอัปโหลดสลิป…');
      api('/api/m/orders/'+encodeURIComponent(id)+'/slip',{method:'POST',body:{image:c.toDataURL('image/jpeg',.85)}}).then(function(j){
        if(j.ok){ toast('อัปโหลดสลิปแล้ว ทีมงานจะตรวจสอบให้'); ORD=null; after&&after(); }
        else toast({not_pending:'คำสั่งซื้อนี้ไม่ต้องแนบสลิปแล้ว',image_too_big:'รูปใหญ่เกินไป',bad_image:'ไฟล์นี้ไม่ใช่รูปภาพ'}[j.error]||'อัปโหลดไม่สำเร็จ กรุณาลองใหม่'); });
    }; im.onerror=function(){ toast('เปิดรูปนี้ไม่ได้ กรุณาเลือกรูปอื่น'); }; im.src=rd.result; }; rd.readAsDataURL(file); };
  f.click(); }

/* ---------- สถานะคำสั่งซื้อ ---------- */
function ostat(o){ var s=String(o.status||'').toLowerCase(), sh=String(o.ship||'').toLowerCase();
  if(/refund/.test(s))return {k:'refund',t:'คืนเงินแล้ว',c:'mut'};
  if(/cancel|reject|fail/.test(s))return {k:'cancel',t:s==='rejected'?'สลิปไม่ผ่าน':'ยกเลิกแล้ว',c:'bad'};
  if(/deliver|complete|done|success/.test(s+' '+sh))return {k:'done',t:'จัดส่งสำเร็จ',c:'ok'};
  if(/ship/.test(s)||o.tracking)return {k:'ship',t:'จัดส่งแล้ว',c:'bl'};
  if(s==='paid'||s==='confirmed')return {k:'prep',t:'กำลังเตรียมจัดส่ง',c:'wt'};
  if(s==='pending')return o.pay==='bank'&&o.hasSlip?{k:'wait',t:'รอตรวจสอบสลิป',c:'wt'}:{k:'wait',t:'รอชำระเงิน',c:'wt'};
  return {k:'other',t:o.status||'-',c:'mut'}; }
function dt(iso){ var d=new Date(iso); if(isNaN(d))return ''; return A.thDT(d.getTime())+' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2); }
function renderOrder(id){ var v=$('#v-order'); v.innerHTML=barHtml('รายละเอียดคำสั่งซื้อ','#orders',{small:true})+'<div class="sempty">กำลังโหลด…</div>';
  loadOrders(true).then(function(){ var o=findOrd(id); if(!o){ v.querySelector('.sempty').textContent='ไม่พบคำสั่งซื้อนี้'; return; }
    var S=ostat(o), log=o.log||[], at=function(k){ var x=log.filter(function(y){return k.indexOf(y.s)>=0;})[0]; return x?dt(x.at):''; };
    var paidAt=at(['paid','confirmed'])||(o.confirmedAt?dt(o.confirmedAt):'');
    var steps=[['สั่งซื้อสำเร็จ',dt(o.at),true]];
    var paid=['prep','ship','done'].indexOf(S.k)>=0;
    steps.push(['ชำระเงินแล้ว',paid?paidAt:(S.k==='wait'?(o.hasSlip?'รอตรวจสอบสลิป':'รอการชำระเงิน'):''),paid]);
    steps.push(['ยืนยันคำสั่งซื้อ',paid?paidAt:'',paid]);
    steps.push(['กำลังเตรียมจัดส่ง',S.k==='prep'?'ผู้ส่งกำลังเตรียมพัสดุ':'',S.k==='ship'||S.k==='done',S.k==='prep']);
    steps.push(['จัดส่งแล้ว',o.tracking?('เลขพัสดุ '+o.tracking):'',S.k==='done',S.k==='ship']);
    steps.push(['จัดส่งสำเร็จ','',S.k==='done']);
    var dead=S.k==='cancel'||S.k==='refund';
    var h='<div class="sbody withbar"><div class="cardw oid"><div><small>หมายเลขคำสั่งซื้อ</small><b>'+esc(o.id)+'</b></div><span class="stb '+S.c+'">'+esc(S.t)+'</span></div>'
      +'<div class="cardw tl"><div class="h">สถานะพัสดุ'+(o.tracking?' (เลขพัสดุ '+esc(o.tracking)+')':'')+'</div>'
      +(dead?'<div class="st done"><span class="dot"><i></i></span><div class="t"><b>สั่งซื้อสำเร็จ</b><small>'+esc(dt(o.at))+'</small></div></div><div class="st cur"><span class="dot"><i style="background:#dc2626"></i></span><div class="t"><b style="color:#dc2626">'+esc(S.t)+'</b></div></div>'
        :steps.map(function(s,i){ var nx=steps[i+1]; var cls=s[2]?'done'+(nx&&!nx[2]?' nx':''):(s[3]?'cur':'todo'); return '<div class="st '+cls+'"><span class="dot"><i></i></span><div class="t"><b>'+esc(s[0])+'</b>'+(s[1]?'<small>'+esc(s[1])+'</small>':'')+'</div></div>'; }).join(''))+'</div>'
      +'<div class="cardw"><div class="tl"><div class="h" style="margin-bottom:0">รายการสินค้า ('+o.items.length+')</div></div>'+o.items.map(function(it){ return '<div class="sitem"><img src="'+(imgForName(it.nm)||'')+'" alt=""><div style="min-width:0"><b>'+esc(it.nm)+'</b><small>'+money(it.price)+' ×1</small></div></div>'; }).join('')
      +'<div class="hr"></div><div class="kv2"><span>ยอดรวม</span><b style="font-weight:700">'+money(o.total)+'</b></div><div class="kv2"><span>ชำระเงิน</span><b>'+(o.pay==='card'?'บัตรเครดิต/เดบิต':'โอนเงินผ่านธนาคาร')+'</b></div>'+(o.addr?'<div class="kv2"><span>จัดส่งถึง</span><b style="text-align:right;max-width:65%">'+esc(o.name)+' '+esc(o.addr)+'</b></div>':'')+(paid?'<div class="kv2"><span>ใบรับเงินมัดจำ</span><a class="link" href="/invoice/'+encodeURIComponent(o.id)+'" target="_blank" rel="noopener">เปิดดู</a></div>':'')+'</div></div>';
    var right=(o.pay==='bank'&&o.status==='pending')?'<button class="r" type="button" id="odSlip">'+(o.hasSlip?'อัปโหลดสลิปใหม่':'อัปโหลดสลิป')+'</button>':'<button class="r" type="button" disabled>ยืนยันรับสินค้า</button>';
    h+='<div class="cbottom"><div class="twob"><a class="l" href="'+A.LINE+'" target="_blank" rel="noopener">ติดต่อร้านค้า</a>'+right+'</div></div>';
    v.innerHTML=barHtml('รายละเอียดคำสั่งซื้อ','#orders',{small:true})+h;
    var s=$('#odSlip'); if(s)s.onclick=function(){ pickSlip(o.id,function(){ renderOrder(id); }); };
  }).catch(function(){ toast('เชื่อมต่อไม่สำเร็จ'); }); }

/* ---------- คืนสินค้า / คืนเงิน (ผูกกับระบบ Return & Refund เดิม) ---------- */
var RET=null, retAt=0;
var RETST={awaiting_shipment:['รอส่งสินค้าคืน','w'],in_transit:['กำลังส่งคืน รอตรวจรับ','b'],refund_review:['รออนุมัติคืนเงิน','b'],refunded:['คืนเงินสำเร็จ','g'],rejected:['ปฏิเสธการรับคืน','r'],cancelled:['ยกเลิกแล้ว','m'],wait:['รอการปรับปรุง','m']};
function loadRet(){ if(RET&&Date.now()-retAt<20000)return Promise.resolve(RET); return api('/api/m/returns').then(function(j){ if(j&&j.ok){ RET=j; retAt=Date.now(); } return RET; }); }
function retCard(){ if(!RET||!((RET.orders||[]).length||(RET.myReturns||[]).length))return '';
  var mine=(RET.myReturns||[]).filter(function(r){return r.status!=='cancelled';}), open=RET.returnOpen!==false;
  var dl=(function(){ var d=new Date(RET.returnDeadline); if(isNaN(d))return ''; var M=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']; var b=new Date(d.getTime()+7*3600000); return b.getUTCDate()+' '+M[b.getUTCMonth()]+' '+(b.getUTCFullYear()+543); })();
  return '<div class="rcard"><div class="rh"><span class="ri">'+sv('refund',20,'#fff')+'</span><div><b>คืนสินค้า / คืนเงิน</b><small>'+(open?('<span class="ln">ยื่นคำขอและส่งสินค้าคืน</span> <span class="ln">ภายในวันที่ '+esc(dl)+'</span>'):'<span class="ln">หมดเขตยื่นคำขอคืนสินค้าแล้ว</span> <span class="ln">(ภายในวันที่ '+esc(dl)+')</span>')+'</small></div></div>'
    +(mine.length?'<div class="rl">'+mine.map(function(r){ var x=RETST[r.status]||[r.status,'m']; return '<div><span>'+esc(r.rid)+'</span><em class="c-'+x[1]+'">'+esc(x[0])+'</em></div>'; }).join('')+'</div>':'')
    +'<a class="rb" href="#rtlist">'+(mine.length?(open?'ติดตามหรือยื่นคำขอเพิ่ม':'ติดตามคำขอคืน'):(open?'ยื่นคำขอคืนสินค้า':'ดูรายละเอียด'))+'</a></div>'; }

/* ---------- 92:350 คำสั่งซื้อของฉัน ---------- */
var OTAB='all', OT=[['all','ทั้งหมด'],['wait','รอชำระ'],['prep','กำลังจัดส่ง'],['done','สำเร็จ'],['refund','คืนเงิน']];
function renderOrders(){ var v=$('#v-orders');
  var paint=function(){ var l=(ORD||[]).filter(function(o){ var k=ostat(o).k; return OTAB==='all'||(OTAB==='prep'?(k==='prep'||k==='ship'):k===OTAB); });
    v.innerHTML=barHtml('คำสั่งซื้อของฉัน','#home',{small:true})+'<div class="otabs" role="tablist">'+OT.map(function(t){return '<button type="button" data-ot="'+t[0]+'" class="'+(OTAB===t[0]?'on':'')+'">'+t[1]+'</button>';}).join('')+'</div>'
      +'<div class="sbody">'+(OTAB==='refund'&&window.CXRET?'<div id="ordRt">'+window.CXRET.refundTab()+'</div>':'<div id="ordRet">'+retCard()+'</div>'+(l.length?l.map(function(o){ var S=ostat(o), imgs=o.items.map(function(it){return imgForName(it.nm);}).filter(Boolean).slice(0,3);
        var btns=S.k==='wait'&&o.pay==='bank'?'<button class="sb2 g" type="button" data-slip="'+esc(o.id)+'">'+(o.hasSlip?'อัปโหลดสลิปใหม่':'อัปโหลดสลิป')+'</button>'
          :(S.k==='done'?'<button class="sb2 m" type="button" data-again="'+esc(o.id)+'">ซื้ออีกครั้ง</button>':'<a class="sb2 o" href="#order/'+esc(o.id)+'">ติดตามพัสดุ</a>');
        return '<div class="ocard"><div class="h"><span>'+sv('store',14,'#0f172a')+'CloverX Official Store</span><em class="c-'+S.c+'">'+esc(S.t)+'</em></div>'
          +'<a class="mid" href="#order/'+esc(o.id)+'"><span class="th">'+(imgs.map(function(u){return '<img src="'+u+'" alt="">';}).join('')||'<span style="font-size:12px;color:#64748b">'+esc((o.items[0]||{}).nm||'')+'</span>')+'</span><span class="sum"><small>ทั้งหมด '+o.items.length+' ชิ้น</small><b>'+money(o.total)+'</b></span></a>'
          +'<div class="ft"><small>หมายเลข: '+esc(o.id)+'</small><div class="bs">'+btns+'</div></div></div>'; }).join('')
        :'<div class="cardw"><div class="sempty">'+(OTAB==='all'?'ยังไม่มีคำสั่งซื้อ':'ไม่มีคำสั่งซื้อในหมวดนี้')+'<div style="margin-top:14px"><a class="sb2 o" href="#shop" style="height:34px;font-size:13px">เลือกซื้อสินค้า</a></div></div></div>')
      )+'</div>';
    $$('[data-ot]',v).forEach(function(b){ b.onclick=function(){ OTAB=b.dataset.ot; paint(); }; });
    $$('[data-slip]',v).forEach(function(b){ b.onclick=function(){ pickSlip(b.dataset.slip,function(){ loadOrders(true).then(paint); }); }; });
    $$('[data-again]',v).forEach(function(b){ b.onclick=function(){ var o=findOrd(b.dataset.again); if(!o)return; loadShop().then(function(){ var n=0;
      o.items.forEach(function(it){ var nm=it.nm, c=/ดำ|black/i.test(nm)?'black':'cream', id=/TRIPLE/i.test(nm)?'triple':(/DUO/i.test(nm)?'duo':(/ครอบครัว/.test(nm)?'':(/RoutineX/i.test(nm)?'routinex':(/Scale/i.test(nm)?'scale':(/Band/i.test(nm)?'band':'')))));
        var p=id&&prod(id); if(p&&!p.soon){ addToCart({id:id,c:p.colors.length?c:''}); n++; } });
      toast(n?'เพิ่มลงตะกร้าแล้ว':'สินค้านี้สั่งซ้ำในแอปไม่ได้'); if(n)location.hash='#cart'; }); }; });
  };
  v.innerHTML=barHtml('คำสั่งซื้อของฉัน','#home',{small:true})+'<div class="sempty">กำลังโหลด…</div>';
  loadOrders(true).then(paint).catch(function(){ v.innerHTML=barHtml('คำสั่งซื้อของฉัน','#home',{small:true})+'<div class="sempty">เชื่อมต่อไม่สำเร็จ</div>'; });
  loadRet().then(function(){ var b=$('#ordRet'); if(b)b.innerHTML=retCard(); }).catch(function(){});
  if(window.CXRET)window.CXRET.load().then(function(){ var b=$('#ordRt'); if(b)b.innerHTML=window.CXRET.refundTab(); }).catch(function(){}); }

window.CXSHOP={ views:['shop','product','cart','checkout','done','order','orders'], tabbed:{shop:1,orders:1},
  render:function(sec,id){ if(sec!=='shop')clearInterval(TIMER); ({shop:renderShop,product:renderProduct,cart:renderCart,checkout:renderCheckout,done:renderDone,order:renderOrder,orders:renderOrders})[sec](id); },
  clearCart:function(){ MEM={}; } };
})();

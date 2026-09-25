/* CloverX Member App: โลโก้ 3D หน้า Splash (ดัดแปลงจากของ Lean Lab X) (three.js r149, ไม่มีไลบรารีอื่น)
   รูปทรงลอกจากไฟล์โลโก้จริง (potrace) แล้วขึ้นรูปนูนเป็น 3 มิติ
   ใช้: LL3D.start(canvas, {onDone}) คืนค่า false ถ้าเครื่องไม่รองรับ WebGL (หน้าเว็บจะใช้โลโก้ภาพ 2D แทน) */
(function(){
'use strict';
var SHAPES={"text":[[[[-4.46,0.59],[-4.55,0.58],[-4.63,0.55],[-4.71,0.5],[-4.78,0.45],[-4.84,0.39],[-4.9,0.32],[-4.94,0.24],[-4.97,0.15],[-4.98,0.12],[-4.99,0.09],[-4.99,0.05],[-4.99,0.01],[-4.99,-0.04],[-4.99,-0.07],[-4.98,-0.11],[-4.98,-0.14],[-4.95,-0.22],[-4.92,-0.29],[-4.87,-0.36],[-4.82,-0.42],[-4.76,-0.47],[-4.69,-0.52],[-4.62,-0.55],[-4.54,-0.58],[-4.49,-0.59],[-4.44,-0.59],[-4.39,-0.6],[-4.34,-0.6],[-4.28,-0.59],[-4.23,-0.58],[-4.18,-0.57],[-4.14,-0.55],[-4.11,-0.54],[-4.07,-0.52],[-4.04,-0.5],[-4.01,-0.48],[-3.98,-0.46],[-3.95,-0.44],[-3.93,-0.41],[-3.91,-0.39],[-3.88,-0.36],[-3.94,-0.31],[-4.0,-0.25],[-4.03,-0.28],[-4.06,-0.32],[-4.11,-0.35],[-4.15,-0.38],[-4.21,-0.41],[-4.26,-0.42],[-4.32,-0.44],[-4.38,-0.44],[-4.43,-0.44],[-4.47,-0.43],[-4.51,-0.42],[-4.54,-0.41],[-4.58,-0.39],[-4.61,-0.38],[-4.64,-0.36],[-4.67,-0.33],[-4.7,-0.31],[-4.74,-0.26],[-4.78,-0.21],[-4.8,-0.15],[-4.82,-0.1],[-4.83,-0.04],[-4.83,0.01],[-4.82,0.07],[-4.81,0.13],[-4.75,0.24],[-4.68,0.33],[-4.58,0.39],[-4.47,0.43],[-4.36,0.44],[-4.24,0.42],[-4.13,0.37],[-4.04,0.29],[-4.0,0.25],[-3.94,0.31],[-3.88,0.37],[-3.94,0.42],[-3.99,0.47],[-4.05,0.51],[-4.11,0.54],[-4.18,0.56],[-4.24,0.58],[-4.31,0.59],[-4.38,0.6],[-4.46,0.59]]],[[[-2.19,0.59],[-2.31,0.57],[-2.42,0.52],[-2.51,0.45],[-2.59,0.37],[-2.66,0.28],[-2.7,0.17],[-2.73,0.06],[-2.73,-0.06],[-2.71,-0.15],[-2.68,-0.24],[-2.64,-0.32],[-2.58,-0.39],[-2.52,-0.45],[-2.44,-0.5],[-2.36,-0.55],[-2.27,-0.58],[-2.24,-0.59],[-2.2,-0.59],[-2.16,-0.59],[-2.12,-0.6],[-2.08,-0.6],[-2.04,-0.59],[-2.01,-0.59],[-1.98,-0.59],[-1.9,-0.56],[-1.82,-0.53],[-1.74,-0.48],[-1.68,-0.43],[-1.62,-0.37],[-1.58,-0.3],[-1.54,-0.23],[-1.51,-0.15],[-1.5,-0.12],[-1.5,-0.08],[-1.5,-0.04],[-1.5,-0.0],[-1.5,0.04],[-1.5,0.08],[-1.5,0.11],[-1.51,0.14],[-1.54,0.23],[-1.58,0.3],[-1.63,0.37],[-1.68,0.43],[-1.75,0.48],[-1.82,0.53],[-1.9,0.56],[-1.98,0.58],[-2.0,0.59],[-2.03,0.59],[-2.06,0.59],[-2.09,0.59],[-2.12,0.6],[-2.14,0.6],[-2.17,0.59],[-2.19,0.59]],[[-2.0,0.42],[-1.9,0.39],[-1.81,0.33],[-1.74,0.25],[-1.69,0.17],[-1.66,0.07],[-1.66,-0.02],[-1.67,-0.12],[-1.72,-0.22],[-1.74,-0.25],[-1.76,-0.28],[-1.79,-0.31],[-1.82,-0.34],[-1.86,-0.36],[-1.89,-0.38],[-1.93,-0.4],[-1.96,-0.42],[-2.1,-0.44],[-2.23,-0.42],[-2.35,-0.37],[-2.45,-0.3],[-2.52,-0.19],[-2.56,-0.08],[-2.56,0.05],[-2.52,0.18],[-2.48,0.25],[-2.43,0.31],[-2.37,0.36],[-2.3,0.39],[-2.23,0.42],[-2.15,0.44],[-2.08,0.44],[-2.0,0.42]]],[[[0.42,0.59],[0.33,0.58],[0.25,0.55],[0.18,0.51],[0.11,0.47],[0.05,0.41],[-0.0,0.35],[-0.05,0.29],[-0.08,0.22],[-0.1,0.16],[-0.11,0.11],[-0.12,0.05],[-0.12,-0.0],[-0.12,-0.06],[-0.11,-0.11],[-0.1,-0.16],[-0.08,-0.21],[-0.01,-0.34],[0.08,-0.45],[0.2,-0.52],[0.32,-0.58],[0.46,-0.6],[0.6,-0.59],[0.74,-0.55],[0.87,-0.48],[0.88,-0.46],[0.9,-0.45],[0.93,-0.43],[0.95,-0.4],[0.97,-0.38],[0.99,-0.36],[1.0,-0.34],[1.01,-0.33],[1.02,-0.31],[0.95,-0.28],[0.93,-0.26],[0.91,-0.25],[0.89,-0.25],[0.89,-0.25],[0.88,-0.24],[0.87,-0.24],[0.87,-0.25],[0.87,-0.25],[0.86,-0.26],[0.85,-0.28],[0.83,-0.29],[0.81,-0.31],[0.79,-0.33],[0.77,-0.35],[0.75,-0.37],[0.73,-0.38],[0.65,-0.42],[0.56,-0.44],[0.47,-0.44],[0.38,-0.42],[0.29,-0.39],[0.22,-0.35],[0.15,-0.29],[0.1,-0.21],[0.09,-0.2],[0.08,-0.18],[0.07,-0.17],[0.07,-0.15],[0.06,-0.13],[0.06,-0.12],[0.05,-0.11],[0.05,-0.09],[0.05,-0.08],[0.58,-0.08],[1.11,-0.07],[1.11,0.01],[1.11,0.05],[1.1,0.08],[1.1,0.11],[1.1,0.14],[1.09,0.16],[1.08,0.19],[1.07,0.22],[1.05,0.25],[1.0,0.33],[0.94,0.41],[0.87,0.47],[0.79,0.52],[0.7,0.56],[0.61,0.59],[0.51,0.6],[0.42,0.59]],[[0.61,0.42],[0.64,0.41],[0.67,0.4],[0.71,0.39],[0.74,0.37],[0.77,0.35],[0.8,0.32],[0.83,0.3],[0.85,0.27],[0.86,0.25],[0.88,0.23],[0.89,0.21],[0.9,0.19],[0.91,0.16],[0.92,0.14],[0.93,0.12],[0.93,0.1],[0.94,0.08],[0.49,0.08],[0.04,0.08],[0.05,0.09],[0.08,0.18],[0.13,0.26],[0.19,0.32],[0.26,0.37],[0.34,0.41],[0.42,0.43],[0.51,0.44],[0.61,0.42]]],[[[-3.7,0.15],[-3.7,0.06],[-3.7,-0.02],[-3.7,-0.1],[-3.7,-0.16],[-3.7,-0.21],[-3.7,-0.24],[-3.7,-0.27],[-3.69,-0.29],[-3.68,-0.33],[-3.66,-0.38],[-3.64,-0.42],[-3.61,-0.46],[-3.57,-0.49],[-3.53,-0.51],[-3.48,-0.54],[-3.43,-0.55],[-3.42,-0.55],[-3.4,-0.55],[-3.37,-0.55],[-3.34,-0.55],[-3.3,-0.56],[-3.24,-0.56],[-3.17,-0.56],[-3.09,-0.56],[-2.79,-0.55],[-2.79,-0.48],[-2.79,-0.4],[-3.11,-0.39],[-3.22,-0.39],[-3.31,-0.39],[-3.37,-0.39],[-3.41,-0.39],[-3.44,-0.38],[-3.46,-0.37],[-3.48,-0.36],[-3.49,-0.34],[-3.51,-0.33],[-3.52,-0.31],[-3.52,-0.29],[-3.53,-0.25],[-3.53,-0.2],[-3.53,-0.12],[-3.53,-0.01],[-3.53,0.14],[-3.53,0.55],[-3.62,0.55],[-3.7,0.55],[-3.7,0.15]]],[[[-1.38,0.51],[-1.45,0.47],[-1.44,0.45],[-1.43,0.44],[-1.43,0.43],[-1.41,0.41],[-1.4,0.38],[-1.38,0.35],[-1.36,0.32],[-1.34,0.28],[-1.32,0.25],[-1.3,0.21],[-1.28,0.17],[-1.26,0.14],[-1.24,0.1],[-1.22,0.07],[-1.21,0.05],[-1.19,0.02],[-1.18,0.01],[-1.18,-0.01],[-1.16,-0.03],[-1.14,-0.06],[-1.13,-0.09],[-1.1,-0.13],[-1.08,-0.17],[-1.05,-0.22],[-1.03,-0.26],[-0.98,-0.35],[-0.94,-0.42],[-0.91,-0.47],[-0.89,-0.5],[-0.88,-0.52],[-0.87,-0.53],[-0.86,-0.54],[-0.86,-0.54],[-0.84,-0.55],[-0.83,-0.55],[-0.81,-0.55],[-0.8,-0.55],[-0.78,-0.55],[-0.77,-0.54],[-0.75,-0.53],[-0.74,-0.51],[-0.73,-0.49],[-0.69,-0.43],[-0.64,-0.35],[-0.59,-0.25],[-0.52,-0.13],[-0.45,-0.01],[-0.38,0.12],[-0.31,0.24],[-0.28,0.28],[-0.26,0.31],[-0.25,0.34],[-0.23,0.37],[-0.22,0.39],[-0.2,0.41],[-0.19,0.43],[-0.18,0.45],[-0.17,0.47],[-0.24,0.51],[-0.26,0.52],[-0.28,0.53],[-0.29,0.54],[-0.3,0.54],[-0.31,0.54],[-0.31,0.55],[-0.31,0.55],[-0.32,0.54],[-0.32,0.53],[-0.34,0.51],[-0.37,0.46],[-0.4,0.4],[-0.46,0.31],[-0.52,0.19],[-0.6,0.05],[-0.7,-0.12],[-0.72,-0.16],[-0.74,-0.19],[-0.76,-0.22],[-0.78,-0.25],[-0.79,-0.27],[-0.8,-0.29],[-0.81,-0.3],[-0.81,-0.31],[-0.81,-0.3],[-0.82,-0.3],[-0.82,-0.3],[-0.82,-0.29],[-0.83,-0.28],[-0.83,-0.27],[-0.84,-0.26],[-0.85,-0.25],[-0.88,-0.19],[-0.93,-0.1],[-1.0,0.02],[-1.07,0.14],[-1.15,0.27],[-1.21,0.38],[-1.26,0.47],[-1.28,0.51],[-1.29,0.52],[-1.29,0.53],[-1.3,0.53],[-1.3,0.54],[-1.31,0.54],[-1.31,0.55],[-1.31,0.55],[-1.31,0.55],[-1.31,0.55],[-1.32,0.55],[-1.33,0.54],[-1.34,0.54],[-1.35,0.53],[-1.36,0.53],[-1.37,0.52],[-1.38,0.51]]],[[[1.31,-0.0],[1.31,-0.56],[1.39,-0.56],[1.47,-0.56],[1.47,-0.32],[1.47,-0.08],[1.78,-0.08],[2.08,-0.08],[2.11,-0.1],[2.12,-0.1],[2.13,-0.11],[2.15,-0.12],[2.16,-0.13],[2.17,-0.14],[2.17,-0.15],[2.18,-0.16],[2.19,-0.17],[2.19,-0.18],[2.2,-0.19],[2.2,-0.2],[2.2,-0.22],[2.2,-0.24],[2.2,-0.27],[2.2,-0.32],[2.2,-0.38],[2.21,-0.56],[2.29,-0.56],[2.37,-0.56],[2.37,-0.38],[2.37,-0.3],[2.36,-0.24],[2.36,-0.19],[2.35,-0.15],[2.34,-0.11],[2.33,-0.09],[2.31,-0.06],[2.29,-0.03],[2.26,-0.0],[2.29,0.03],[2.33,0.1],[2.36,0.17],[2.37,0.25],[2.35,0.33],[2.32,0.4],[2.27,0.46],[2.21,0.51],[2.12,0.54],[2.11,0.54],[2.09,0.55],[2.06,0.55],[2.02,0.55],[1.97,0.55],[1.9,0.55],[1.81,0.55],[1.7,0.55],[1.31,0.55],[1.31,-0.0]],[[2.11,0.38],[2.15,0.35],[2.18,0.31],[2.2,0.28],[2.2,0.23],[2.2,0.19],[2.18,0.15],[2.15,0.12],[2.11,0.09],[2.07,0.08],[1.77,0.08],[1.47,0.08],[1.47,0.24],[1.47,0.4],[1.78,0.39],[2.08,0.39],[2.11,0.38]]]],"x":[[[[3.03,0.96],[3.01,0.94],[3.0,0.93],[2.99,0.92],[2.98,0.91],[2.97,0.9],[2.96,0.89],[2.96,0.89],[2.96,0.88],[2.96,0.88],[2.96,0.88],[2.96,0.88],[2.96,0.87],[2.97,0.87],[2.97,0.87],[2.97,0.86],[2.98,0.86],[2.99,0.85],[3.0,0.83],[3.02,0.81],[3.04,0.79],[3.06,0.77],[3.07,0.75],[3.08,0.73],[3.08,0.73],[3.09,0.73],[3.09,0.72],[3.09,0.72],[3.09,0.72],[3.09,0.71],[3.1,0.71],[3.1,0.7],[3.11,0.7],[3.11,0.69],[3.12,0.68],[3.12,0.67],[3.13,0.65],[3.14,0.64],[3.15,0.62],[3.16,0.6],[3.18,0.57],[3.2,0.52],[3.23,0.45],[3.25,0.38],[3.28,0.31],[3.29,0.24],[3.31,0.17],[3.32,0.11],[3.32,0.06],[3.32,0.04],[3.32,0.02],[3.32,0.01],[3.33,0.01],[3.34,0.0],[3.35,0.0],[3.37,0.0],[3.4,0.0],[3.48,0.0],[3.48,0.05],[3.48,0.08],[3.48,0.12],[3.47,0.15],[3.47,0.19],[3.46,0.23],[3.45,0.27],[3.45,0.31],[3.44,0.34],[3.43,0.35],[3.43,0.37],[3.42,0.38],[3.42,0.39],[3.42,0.4],[3.42,0.41],[3.42,0.41],[3.42,0.41],[3.43,0.41],[3.44,0.4],[3.45,0.38],[3.48,0.36],[3.5,0.33],[3.53,0.31],[3.56,0.27],[3.6,0.24],[3.63,0.2],[3.67,0.17],[3.7,0.14],[3.72,0.12],[3.75,0.1],[3.76,0.08],[3.77,0.07],[3.78,0.07],[3.79,0.07],[3.8,0.08],[3.82,0.1],[3.84,0.12],[3.86,0.13],[3.87,0.15],[3.88,0.17],[3.89,0.17],[3.85,0.21],[3.76,0.3],[3.63,0.44],[3.48,0.59],[3.33,0.74],[3.2,0.87],[3.11,0.96],[3.07,0.99],[3.07,0.99],[3.07,0.99],[3.06,0.99],[3.06,0.98],[3.05,0.98],[3.04,0.97],[3.04,0.97],[3.03,0.96]]],[[[4.39,0.55],[3.95,0.11],[3.95,0.06],[3.95,0.0],[4.01,0.0],[4.07,0.0],[4.27,0.2],[4.31,0.24],[4.35,0.28],[4.39,0.32],[4.42,0.35],[4.44,0.37],[4.46,0.39],[4.48,0.4],[4.48,0.41],[4.48,0.41],[4.48,0.41],[4.48,0.41],[4.48,0.4],[4.48,0.4],[4.48,0.4],[4.48,0.39],[4.48,0.38],[4.47,0.36],[4.46,0.32],[4.45,0.27],[4.44,0.23],[4.44,0.18],[4.43,0.13],[4.43,0.08],[4.43,0.05],[4.43,0.0],[4.5,0.0],[4.58,0.0],[4.58,0.02],[4.58,0.07],[4.59,0.12],[4.6,0.18],[4.61,0.24],[4.63,0.3],[4.64,0.36],[4.66,0.41],[4.67,0.46],[4.7,0.51],[4.72,0.56],[4.75,0.61],[4.77,0.65],[4.8,0.7],[4.83,0.74],[4.86,0.77],[4.89,0.82],[4.9,0.83],[4.91,0.84],[4.92,0.85],[4.93,0.86],[4.94,0.87],[4.94,0.88],[4.94,0.88],[4.95,0.89],[4.94,0.89],[4.93,0.9],[4.91,0.92],[4.9,0.94],[4.88,0.96],[4.86,0.97],[4.85,0.99],[4.84,0.99],[4.83,0.98],[4.8,0.96],[4.76,0.92],[4.7,0.86],[4.64,0.8],[4.56,0.72],[4.48,0.64],[4.39,0.55]]],[[[3.32,-0.09],[3.31,-0.2],[3.29,-0.31],[3.26,-0.41],[3.22,-0.5],[3.18,-0.59],[3.12,-0.68],[3.06,-0.76],[2.99,-0.84],[2.99,-0.85],[2.98,-0.86],[2.97,-0.86],[2.97,-0.87],[2.97,-0.88],[2.96,-0.88],[2.96,-0.88],[2.96,-0.89],[2.96,-0.89],[2.97,-0.9],[2.99,-0.92],[3.0,-0.94],[3.02,-0.95],[3.04,-0.97],[3.05,-0.98],[3.06,-0.99],[3.06,-0.99],[3.08,-0.98],[3.1,-0.97],[3.13,-0.94],[3.18,-0.88],[3.26,-0.81],[3.37,-0.7],[3.51,-0.56],[3.95,-0.12],[3.95,-0.06],[3.95,0.0],[3.9,0.0],[3.84,0.0],[3.64,-0.2],[3.56,-0.28],[3.51,-0.33],[3.47,-0.36],[3.45,-0.39],[3.44,-0.39],[3.43,-0.39],[3.43,-0.37],[3.44,-0.35],[3.45,-0.32],[3.46,-0.29],[3.46,-0.25],[3.47,-0.22],[3.47,-0.18],[3.48,-0.14],[3.48,-0.1],[3.48,-0.07],[3.48,0.0],[3.4,0.0],[3.33,0.0],[3.32,-0.09]]],[[[4.43,-0.06],[4.43,-0.09],[4.43,-0.13],[4.43,-0.17],[4.44,-0.21],[4.44,-0.25],[4.45,-0.29],[4.46,-0.34],[4.47,-0.38],[4.48,-0.39],[4.48,-0.4],[4.47,-0.4],[4.46,-0.39],[4.44,-0.37],[4.41,-0.34],[4.36,-0.29],[4.3,-0.23],[4.26,-0.2],[4.23,-0.17],[4.2,-0.14],[4.18,-0.11],[4.16,-0.09],[4.14,-0.08],[4.13,-0.07],[4.13,-0.07],[4.12,-0.07],[4.11,-0.08],[4.09,-0.1],[4.07,-0.12],[4.05,-0.14],[4.03,-0.15],[4.02,-0.17],[4.02,-0.17],[4.05,-0.21],[4.14,-0.31],[4.27,-0.44],[4.42,-0.59],[4.57,-0.74],[4.7,-0.87],[4.8,-0.96],[4.84,-0.99],[4.84,-0.99],[4.86,-0.98],[4.88,-0.96],[4.9,-0.94],[4.91,-0.92],[4.93,-0.91],[4.94,-0.89],[4.95,-0.89],[4.95,-0.88],[4.94,-0.88],[4.94,-0.88],[4.94,-0.87],[4.93,-0.86],[4.92,-0.86],[4.92,-0.85],[4.91,-0.84],[4.86,-0.78],[4.81,-0.71],[4.76,-0.64],[4.72,-0.57],[4.69,-0.49],[4.65,-0.42],[4.63,-0.34],[4.61,-0.27],[4.61,-0.26],[4.61,-0.25],[4.61,-0.24],[4.6,-0.24],[4.6,-0.23],[4.6,-0.22],[4.6,-0.22],[4.6,-0.21],[4.6,-0.21],[4.6,-0.2],[4.6,-0.19],[4.59,-0.18],[4.59,-0.17],[4.59,-0.16],[4.59,-0.14],[4.59,-0.13],[4.59,-0.12],[4.59,-0.1],[4.59,-0.09],[4.59,-0.08],[4.59,-0.06],[4.58,-0.05],[4.58,-0.04],[4.58,-0.03],[4.58,0.0],[4.5,0.0],[4.43,0.0],[4.43,-0.06]]]]};
function ease(t){return 1-Math.pow(1-t,3);}                       // easeOutCubic
function easeIO(t){return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;}
function back(t){var c=1.9,c3=c+1;return 1+c3*Math.pow(t-1,3)+c*Math.pow(t-1,2);} // overshoot
function clamp(v){return v<0?0:v>1?1:v;}
function seg(t,a,b){return clamp((t-a)/(b-a));}

function start(canvas,opt){
  opt=opt||{};
  var T=window.THREE; if(!T)return false;
  if(T.ColorManagement)T.ColorManagement.legacyMode=false;          // สีตรงตามโลโก้ (sRGB)
  var renderer;
  try{renderer=new T.WebGLRenderer({canvas:canvas,antialias:true,alpha:true,powerPreference:'high-performance'});}catch(e){return false;}
  if(!renderer.getContext())return false;
  var DPR=Math.min(window.devicePixelRatio||1,2);
  renderer.setPixelRatio(DPR);
  renderer.outputEncoding=T.sRGBEncoding;
  renderer.toneMapping=T.ACESFilmicToneMapping; renderer.toneMappingExposure=1.15;

  var scene=new T.Scene();
  var cam=new T.PerspectiveCamera(32,1,.1,100);

  /* ---- สภาพแวดล้อมสำหรับเงาสะท้อนบนผิวโลหะ: แผงไฟสีเขียวมะนาว ฟ้า และขาว ---- */
  var envScene=new T.Scene();
  function panel(c,w,h,x,y,z,ry,rx){var m=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({color:c,side:T.DoubleSide}));m.position.set(x,y,z);m.rotation.y=ry||0;m.rotation.x=rx||0;envScene.add(m);}
  envScene.background=new T.Color(0x05070c);
  panel(0xffffff,14,3,0,7,2,0,Math.PI/2);          // ไฟเพดาน
  panel(0x87e0ff,4,8,-8,1,0,Math.PI/2);            // ซ้าย ฟ้าอ่อน
  panel(0x19d3ff,4,8,8,1,0,-Math.PI/2);            // ขวา ฟ้า
  panel(0x2440ff,10,2,0,-6,-2,0,-Math.PI/2);       // ล่าง น้ำเงิน
  panel(0xffffff,6,4,0,2,9,Math.PI);               // หน้า
  var pm=new T.PMREMGenerator(renderer); var env=pm.fromScene(envScene,.02).texture; pm.dispose();
  scene.environment=env;

  /* ---- ไฟ ---- */
  scene.add(new T.AmbientLight(0xffffff,.25));
  var key=new T.DirectionalLight(0xffffff,1.4); key.position.set(-3,4,6); scene.add(key);
  var rim=new T.DirectionalLight(0x6fe8ff,1.2); rim.position.set(5,-2,-4); scene.add(rim);
  var sweep=new T.PointLight(0xdff1ff,0,14,1.6); sweep.position.set(-8,1.2,2.2); scene.add(sweep);   // แสงวิ่งผ่านโลโก้

  /* ---- วัสดุ ---- */
  var matText=new T.MeshPhysicalMaterial({color:0xffffff,metalness:.55,roughness:.24,clearcoat:1,clearcoatRoughness:.1,envMapIntensity:1.1});
  var matX=new T.MeshPhysicalMaterial({vertexColors:true,color:0x2a2a2a,metalness:0,roughness:.3,clearcoat:1,clearcoatRoughness:.12,emissive:0x000000,envMapIntensity:.5,toneMapped:false});
  var xGlow={value:.75};                                             // สีไล่ของ X เรืองแสงในตัว ไม่ซีดเวลาโดนไฟ
  matX.onBeforeCompile=function(sh){sh.uniforms.xGlow=xGlow;sh.fragmentShader='uniform float xGlow;\n'+sh.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n totalEmissiveRadiance += vColor.rgb * xGlow;');};

  /* ---- ขึ้นรูปจากเส้นโลโก้ ---- */
  var EX={depth:.34,bevelEnabled:true,bevelThickness:.06,bevelSize:.035,bevelSegments:4,curveSegments:4,steps:1};
  var EXX={depth:.34,bevelEnabled:true,bevelThickness:.02,bevelSize:.008,bevelSegments:2,curveSegments:4,steps:1};   // X ต่อกัน 4 ชิ้น ขอบบางเพื่อไม่ให้เห็นรอยต่อ
  function shapeOf(rings){var s=new T.Shape(rings[0].map(function(p){return new T.Vector2(p[0],p[1]);}));
    for(var i=1;i<rings.length;i++)s.holes.push(new T.Path(rings[i].map(function(p){return new T.Vector2(p[0],p[1]);})));return s;}
  function piece(rings,mat,ex){var g=new T.ExtrudeGeometry(shapeOf(rings),ex||EX);g.computeBoundingBox();var c=new T.Vector3();g.boundingBox.getCenter(c);g.translate(-c.x,-c.y,-c.z);
    var m=new T.Mesh(g,mat);m.userData.home=c.clone();m.position.copy(c);return m;}

  var logo=new T.Group(); scene.add(logo);
  var letters=SHAPES.text.map(function(r){return piece(r,matText);}).sort(function(a,b){return a.userData.home.x-b.userData.home.x;});
  letters.forEach(function(m){logo.add(m);});
  // จุดกึ่งกลางของ X
  var bars=SHAPES.x.map(function(r){return piece(r,matX,EXX);});
  var xc=new T.Vector3(); bars.forEach(function(b){xc.add(b.userData.home);}); xc.multiplyScalar(1/bars.length);
  // ไล่สีตามแบบโลโก้: กลางน้ำเงิน กลางแขนฟ้า ปลายแขนเขียวมะนาว
  var cA=new T.Color(0x2f6ff0),cB=new T.Color(0x3a80f7),cC=new T.Color(0x5b9bff),tmp=new T.Color();
  bars.forEach(function(b){var g=b.geometry,p=g.attributes.position,n=p.count,cols=new Float32Array(n*3),v=new T.Vector3(),maxd=0,ds=[];
    for(var i=0;i<n;i++){v.fromBufferAttribute(p,i).add(b.userData.home);var d=Math.hypot(v.x-xc.x,v.y-xc.y);ds.push(d);if(d>maxd)maxd=d;}
    for(i=0;i<n;i++){var t=ds[i]/maxd; if(t<.55)tmp.copy(cA).lerp(cB,t/.55); else tmp.copy(cB).lerp(cC,(t-.55)/.45); tmp.toArray(cols,i*3);}
    g.setAttribute('color',new T.BufferAttribute(cols,3)); logo.add(b);});

  /* ---- แสงเรืองหลัง X และประกายตอนประกอบเสร็จ ---- */
  function glowTex(stops){var c=document.createElement('canvas');c.width=c.height=128;var x=c.getContext('2d'),g=x.createRadialGradient(64,64,0,64,64,64);stops.forEach(function(s){g.addColorStop(s[0],s[1]);});x.fillStyle=g;x.fillRect(0,0,128,128);var t=new T.CanvasTexture(c);t.encoding=T.sRGBEncoding;return t;}
  var glow=new T.Sprite(new T.SpriteMaterial({map:glowTex([[0,'rgba(60,120,255,.9)'],[.35,'rgba(25,211,255,.35)'],[1,'rgba(0,0,0,0)']]),blending:T.AdditiveBlending,depthWrite:false,transparent:true,opacity:0}));
  glow.position.set(xc.x,xc.y,-.4); glow.scale.set(3.0,3.0,1); logo.add(glow);
  var flare=new T.Sprite(new T.SpriteMaterial({map:glowTex([[0,'rgba(255,255,255,1)'],[.12,'rgba(190,230,255,.8)'],[.4,'rgba(89,191,255,.15)'],[1,'rgba(0,0,0,0)']]),blending:T.AdditiveBlending,depthWrite:false,transparent:true,opacity:0}));
  flare.position.set(xc.x,xc.y,.5); logo.add(flare);

  /* ---- เงาสะท้อนบนพื้น (สำเนากลับหัว จางลง) ---- */
  var refl=new T.Group();                                           // เงาสะท้อนปิดไว้ (คำ REAL PEOPLE อยู่ชิดใต้โลโก้ตาม Figma)
  var reflMatT=matText.clone(); reflMatT.transparent=true; reflMatT.opacity=.1; reflMatT.depthWrite=false;
  var reflMatX=new T.MeshBasicMaterial({vertexColors:true}); reflMatX.transparent=true; reflMatX.opacity=.14; reflMatX.depthWrite=false;
  var fc=document.createElement('canvas');fc.width=4;fc.height=256;var fx2=fc.getContext('2d'),fg=fx2.createLinearGradient(0,0,0,256);
  fg.addColorStop(0,'rgba(3,8,15,0)');fg.addColorStop(.5,'rgba(3,8,15,.75)');fg.addColorStop(1,'rgba(3,8,15,1)');fx2.fillStyle=fg;fx2.fillRect(0,0,4,256);
  var ft=new T.CanvasTexture(fc);ft.encoding=T.sRGBEncoding;
  var fog=new T.Mesh(new T.PlaneGeometry(40,2.6),new T.MeshBasicMaterial({map:ft,transparent:true,depthWrite:false,toneMapped:false}));
  fog.position.set(0,-2.35,.9);fog.renderOrder=5;                      // ทำให้เงาสะท้อนจางลงด้านล่าง
  var mirrors=[];
  logo.children.forEach(function(m){ if(!m.isMesh)return; var r=new T.Mesh(m.geometry,m.material===matText?reflMatT:reflMatX); refl.add(r); mirrors.push([m,r]); });

  /* ---- ประกายฝุ่นแสงลอยช้า ๆ ---- */
  var N=70,pg=new T.BufferGeometry(),pp=new Float32Array(N*3),seed=[];
  for(var i=0;i<N;i++){pp[i*3]=(Math.random()-.5)*14;pp[i*3+1]=(Math.random()-.5)*7;pp[i*3+2]=-1-Math.random()*4;seed.push(Math.random()*6.28);}
  pg.setAttribute('position',new T.BufferAttribute(pp,3));
  var dots=new T.Points(pg,new T.PointsMaterial({size:.06,color:0xbfe0ff,transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending,map:glowTex([[0,'rgba(255,255,255,1)'],[1,'rgba(255,255,255,0)']])}));
  scene.add(dots);

  /* ---- ขนาดจอ: โลโก้กว้าง 10 หน่วย ให้กินราว 78% ของความกว้างจอ ---- */
  var W=0,H=0;
  function fit(){W=canvas.clientWidth;H=canvas.clientHeight;if(!W||!H)return;renderer.setSize(W,H,false);cam.aspect=W/H;
    var visW=Math.max(10/(opt.widthFrac||.78),10*W/520);                                  // มือถือ: โลโก้กว้าง 78% ของจอ  จอใหญ่: ไม่เกินราว 520px
    var dist=(visW/cam.aspect)/2/Math.tan(T.MathUtils.degToRad(cam.fov/2));
    // จัดกลุ่ม โลโก้ + ช่องว่าง + คำ REAL PEOPLE ให้อยู่กลางจอ (ค่อนบนเล็กน้อยตาม Figma)
    var ppu=W/visW, logoPx=2.06*ppu, gap=opt.gap||12, tagH=opt.tagH||17;
    var groupTop=H*(opt.centerY||.48)-(logoPx+gap+tagH)/2, logoMid=groupTop+logoPx/2, dy=(logoMid-H/2)/ppu;
    cam.position.set(0,dy,dist);cam.lookAt(0,dy,0);cam.updateProjectionMatrix();
    if(opt.onLayout)opt.onLayout({tagTop:groupTop+logoPx+gap});}
  fit(); window.addEventListener('resize',fit);

  /* ---- ลากเพื่อหมุน (สปริงกลับเอง) ---- */
  var drag=null,uy=0,ux=0,vy=0,vx=0;
  function pd(e){drag={x:e.clientX,y:e.clientY,uy:uy,ux:ux};}
  function pmv(e){if(!drag)return;uy=drag.uy+(e.clientX-drag.x)/W*3.2;ux=drag.ux+(e.clientY-drag.y)/H*.9;}
  function pu(){drag=null;}
  canvas.addEventListener('pointerdown',pd);window.addEventListener('pointermove',pmv);window.addEventListener('pointerup',pu);

  /* ---- ไทม์ไลน์ ---- */
  var reduced=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  var t0=performance.now(),raf=0,dead=false,doneFired=false,DUR=reduced?0:2.6;
  var barFrom=bars.map(function(b){var d=new T.Vector3().subVectors(b.userData.home,xc).normalize();return {dir:d,spin:(Math.random()<.5?-1:1)*Math.PI*1.5};});
  function frame(now){
    if(dead)return; raf=requestAnimationFrame(frame);
    var t=reduced?9:(performance.now()-t0)/1000;
    // 1) แขน X พุ่งเข้าจากสี่มุมมาประกอบกัน 0.0-0.9s
    bars.forEach(function(b,i){var k=ease(seg(t,.05+i*.06,.85+i*.06)),f=barFrom[i];
      b.position.copy(b.userData.home).addScaledVector(f.dir,(1-k)*7).setZ(b.userData.home.z+(1-k)*3);
      b.rotation.set((1-k)*f.spin*.5,(1-k)*f.spin*.3,(1-k)*f.spin);b.scale.setScalar(.4+.6*k);});
    // 2) ตัวอักษรพลิกขึ้นทีละตัว 0.55-1.5s
    letters.forEach(function(m,i){var k=seg(t,.55+i*.075,1.05+i*.075),e=back(k);
      m.position.set(m.userData.home.x,m.userData.home.y-(1-ease(k))*1.2,m.userData.home.z);
      m.rotation.set((1-e)*-Math.PI/2,0,0);m.scale.setScalar(Math.max(.001,k<1?.6+.4*ease(k):1));m.visible=k>0;});
    // 3) ทั้งโลโก้หมุนเข้าที่ + แสงวิ่งผ่าน 0.9-2.2s
    var turn=seg(t,.2,1.9);
    var ry=(1-back(turn))*-.9, idle=t>2.2?Math.sin((t-2.2)*1.1)*.07:0, idleX=t>2.2?Math.sin((t-2.2)*.8)*.03:0;
    vy+=((drag?uy:0)-vy)*.12; vx+=((drag?ux:0)-vx)*.12; if(!drag){uy*=.9;ux*=.9;}
    logo.rotation.set(-.08+idleX+vx,ry+idle+vy,0);
    logo.position.y=Math.sin(t*1.4)*.05;
    var sw=seg(t,1.25,2.35); sweep.intensity=sw>0&&sw<1?Math.sin(sw*Math.PI)*9:0; sweep.position.x=-8+sw*16;
    // 4) X เรืองแสง และประกายตอนประกอบเสร็จ
    var gk=seg(t,.7,1.3); glow.material.opacity=ease(gk)*(.55+Math.sin(t*2.4)*.12);
    var fk=seg(t,.82,1.35); flare.material.opacity=fk>0&&fk<1?Math.sin(fk*Math.PI):0; var fs=.6+fk*4.2; flare.scale.set(fs,fs,1);
    xGlow.value=.85+Math.max(0,Math.sin(fk*Math.PI))*.9;
    // เงาสะท้อน
    refl.rotation.copy(logo.rotation); refl.rotation.x=-logo.rotation.x; refl.position.y=-2.25-logo.position.y;
    mirrors.forEach(function(p){var s=p[0],r=p[1];r.position.set(s.position.x,-s.position.y,s.position.z);r.rotation.set(-s.rotation.x,s.rotation.y,-s.rotation.z);r.scale.set(s.scale.x,-s.scale.y,s.scale.z);r.visible=s.visible;});
    refl.scale.y=1;
    // ฝุ่นแสง
    dots.material.opacity=ease(seg(t,.4,1.6))*.75; var a=pg.attributes.position.array;
    for(var j=0;j<N;j++){a[j*3+1]+=.004+Math.sin(t+seed[j])*.002; if(a[j*3+1]>3.8)a[j*3+1]=-3.8;} pg.attributes.position.needsUpdate=true;
    renderer.render(scene,cam);
    if(!doneFired&&t>=DUR){doneFired=true;opt.onDone&&opt.onDone();}
  }
  raf=requestAnimationFrame(frame);
  return {stop:function(){dead=true;cancelAnimationFrame(raf);window.removeEventListener('resize',fit);window.removeEventListener('pointermove',pmv);window.removeEventListener('pointerup',pu);
    scene.traverse(function(o){if(o.geometry)o.geometry.dispose();if(o.material){(o.material.map&&o.material.map.dispose());o.material.dispose();}});env.dispose();renderer.dispose();try{renderer.forceContextLoss();}catch(e){}}};
}
window.CX3D={start:start};
})();

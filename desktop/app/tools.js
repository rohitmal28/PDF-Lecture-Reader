'use strict';
/* PDF Lecture Reader — PDF tools: merge PDFs, images to PDF, and a PDF editor.
   The same file runs in the desktop app and in the browser extension.
   pdf.js shows the pages, pdf-lib writes the new PDF. Everything stays on this device. */
(()=>{
if(!window.PDFLib||!window.pdfjsLib)return;
const L=window.PDFLib;
const $=id=>document.getElementById(id);
const NATIVE=window.native&&window.native.desktop?window.native:null;
const h=(tag,attrs={},...kids)=>{
  const e=document.createElement(tag);
  for(const [k,v] of Object.entries(attrs)){
    if(v==null||v===false)continue;
    if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k==='html')e.innerHTML=v;
    else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else e.setAttribute(k,v===true?'':v);
  }
  e.append(...kids.flat().filter(k=>k!=null&&k!==false));return e;
};
const btn=(text,on,attrs={})=>h('button',{type:'button',onclick:on,...attrs},text);
const mb=b=>b<1048576?Math.max(1,Math.round(b/1024))+' KB':(b/1048576).toFixed(1)+' MB';
const plural=(n,w)=>n+' '+w+(n===1?'':'s');
const tick=()=>new Promise(r=>setTimeout(r));
const isPdfFile=f=>/pdf$/i.test(f.type)||/\.pdf$/i.test(f.name);
const isHeic=f=>/hei[cf]/i.test(f.type)||/\.hei[cf]$/i.test(f.name);
const isImageFile=f=>!isHeic(f)&&(/^image\//i.test(f.type)||/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name));
const baseName=n=>String(n||'').replace(/\.[a-z0-9]{1,5}$/i,'');
const cleanName=n=>String(n||'').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim().replace(/\.pdf$/i,'').slice(0,120)||'document';
let uid=1;const nid=()=>uid++;
const copyBytes=b=>new Uint8Array(b instanceof ArrayBuffer?b.slice(0):b.slice());
const toAB=u=>u.buffer.slice(u.byteOffset,u.byteOffset+u.byteLength);
const openPdfjs=bytes=>pdfjsLib.getDocument({data:copyBytes(bytes),isEvalSupported:false}).promise;

/* ================= shared PDF helpers ================= */
const SIZES={a4:[595.28,841.89],letter:[612,792]};
const MARGINS={none:0,small:18,big:36};
const COLORS=['#1d232a','#1f4fd1','#c62828','#1f8a4c','#e07000'];
const HCOLORS=['#ffd84d','#7be38b','#ff8fc8','#7cc4ff'];
const FONTS={
  sans:{css:"Helvetica,Arial,'Liberation Sans',sans-serif",std:['Helvetica','HelveticaBold']},
  serif:{css:"'Times New Roman',Times,'Liberation Serif',serif",std:['TimesRoman','TimesRomanBold']},
  mono:{css:"'Courier New',Courier,'Liberation Mono',monospace",std:['Courier','CourierBold']}
};
const rgbHex=c=>{const n=parseInt(c.slice(1),16);return L.rgb((n>>16&255)/255,(n>>8&255)/255,(n&255)/255)};
const norm=a=>((Math.round(a/90)*90)%360+360)%360;

// where a line's baseline sits, measured in the same font the editor shows, so text lands where it was typed
const baseCache={};
function baselineRatio(font,bold){
  const k=font+bold;if(baseCache[k])return baseCache[k];
  const d=h('div',{style:`position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;font:${bold?700:400} 100px/1.2 ${FONTS[font].css}`});
  const z=h('span',{style:'display:inline-block;width:1px;height:0;vertical-align:baseline'});
  d.append('Hg',z);document.body.appendChild(d);const r=z.offsetTop/100;d.remove();
  return baseCache[k]=r>0.5&&r<1.2?r:0.93;
}

// display point (top-left origin, as the page is shown) -> PDF user space, for a page with this crop box and /Rotate
function mapper(box,R){
  const x0=box.x,y0=box.y,x1=box.x+box.width,y1=box.y+box.height;
  return {0:(dx,dy)=>[x0+dx,y1-dy],90:(dx,dy)=>[x0+dy,y0+dx],180:(dx,dy)=>[x1-dx,y0+dy],270:(dx,dy)=>[x1-dy,y1-dx]}[R];
}
// draw an image so it fills box (display coords) upright; q = clockwise turn the raw image needs
function drawImageBox(page,img,q,b,M,R){
  const at={0:[b.left,b.top+b.h],90:[b.left,b.top],180:[b.left+b.w,b.top],270:[b.left+b.w,b.top+b.h]}[q];
  const [x,y]=M(at[0],at[1]);
  page.drawImage(img,{x,y,width:q%180?b.h:b.w,height:q%180?b.w:b.h,rotate:L.degrees(R-q)});
}
// page size and image box for an image of (dw x dh) pixels as seen, in points
function layoutImage(dw,dh,o){
  const m=MARGINS[o.margin]??18;let pw,ph;
  if(o.size==='fit'){pw=dw*0.75+2*m;ph=dh*0.75+2*m}
  else{[pw,ph]=SIZES[o.size]||SIZES.a4;const land=o.orient==='landscape'||(o.orient==='auto'&&dw>dh);if(land)[pw,ph]=[ph,pw]}
  const s=Math.min((pw-2*m)/dw,(ph-2*m)/dh),w=dw*s,ht=dh*s;
  return {pw,ph,box:{left:(pw-w)/2,top:(ph-ht)/2,w,h:ht}};
}

/* ---- images: JPG and PNG go in as they are; other types are converted to PNG ---- */
function jpegInfo(b){
  let i=2,orient=1,w=0,ht=0;
  while(i+9<b.length){
    if(b[i]!==0xFF){i++;continue}
    const m=b[i+1];if(m===0xD8||m===0x01||(m>=0xD0&&m<=0xD7)){i+=2;continue}
    const len=b[i+2]<<8|b[i+3];
    if(m===0xE1&&b[i+4]===0x45&&b[i+5]===0x78&&b[i+6]===0x69&&b[i+7]===0x66){
      const t=i+10,le=b[t]===0x49;
      const u16=o=>le?b[o]|b[o+1]<<8:b[o]<<8|b[o+1];
      const u32=o=>(le?b[o]|b[o+1]<<8|b[o+2]<<16|b[o+3]<<24:b[o]<<24|b[o+1]<<16|b[o+2]<<8|b[o+3])>>>0;
      const ifd=t+u32(t+4);
      if(ifd+2<b.length)for(let k=0,n=u16(ifd);k<n&&ifd+2+k*12+10<b.length;k++){const e=ifd+2+k*12;if(u16(e)===0x0112){orient=u16(e+8);break}}
    }
    if(m>=0xC0&&m<=0xCF&&m!==0xC4&&m!==0xC8&&m!==0xCC){ht=b[i+5]<<8|b[i+6];w=b[i+7]<<8|b[i+8];break}
    i+=2+len;
  }
  return {w,h:ht,q:{3:180,4:180,5:90,6:90,7:270,8:270}[orient]||0};
}
async function readImage(file){
  let bytes=new Uint8Array(await file.arrayBuffer()),type='',info=null;
  if(bytes[0]===0xFF&&bytes[1]===0xD8&&bytes[2]===0xFF){type='jpg';info=jpegInfo(bytes)}
  else if(bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4E&&bytes[3]===0x47){type='png';const v=new DataView(bytes.buffer);info={w:v.getUint32(16),h:v.getUint32(20),q:0}}
  if(!type||!info.w){
    const bmp=await createImageBitmap(file);
    const c=h('canvas');c.width=bmp.width;c.height=bmp.height;c.getContext('2d').drawImage(bmp,0,0);
    const blob=await new Promise(r=>c.toBlob(r,'image/png'));if(!blob)throw new Error('image');
    bytes=new Uint8Array(await blob.arrayBuffer());type='png';info={w:bmp.width,h:bmp.height,q:0};
  }
  return {id:nid(),name:file.name,size:file.size,bytes,type,w:info.w,h:info.h,q:info.q,
    url:URL.createObjectURL(new Blob([bytes],{type:type==='jpg'?'image/jpeg':'image/png'}))};
}
const seenSize=(im,turn)=>{const t=(im.q+turn)%360;return t%180?[im.h,im.w]:[im.w,im.h]};
const embedImage=(out,im)=>im.type==='jpg'?out.embedJpg(im.bytes):out.embedPng(im.bytes);

// a page from a protected PDF, as a picture (pdf.js can show it; pdf-lib can't copy it)
async function pageAsImage(doc,index){
  const page=await doc.getPage(index+1),vp1=page.getViewport({scale:1}),vp=page.getViewport({scale:2});
  const c=h('canvas');c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);
  await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
  const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.92));
  c.width=c.height=0;
  return {bytes:new Uint8Array(await blob.arrayBuffer()),w:vp1.width,h:vp1.height};
}
async function loadLib(src){
  if(src.lib||src.locked)return src.lib;
  try{src.lib=await L.PDFDocument.load(copyBytes(src.bytes),{updateMetadata:false})}
  catch(e){if(/encrypt/i.test(e&&e.message||''))src.locked=true;else throw e}
  return src.lib;
}
function parseRange(s,n){
  s=String(s||'').trim();
  if(!s||/^all$/i.test(s))return [...Array(n).keys()];
  const out=[];
  for(const part of s.split(/[,;]+/)){
    const p=part.trim();if(!p)continue;
    let a,b,m;
    if((m=/^(\d+)$/.exec(p)))a=b=+m[1];
    else if((m=/^(\d*)\s*[-–]\s*(\d*)$/.exec(p))&&(m[1]||m[2])){a=m[1]?+m[1]:1;b=m[2]?+m[2]:n}
    else throw new Error(`"${p}" is not a page number or a range like 2-5.`);
    for(const x of [a,b])if(x<1||x>n)throw new Error(`There is no page ${x}: this PDF has ${plural(n,'page')}.`);
    if(a<=b)for(let i=a;i<=b;i++)out.push(i-1);else for(let i=a;i>=b;i--)out.push(i-1);
  }
  if(!out.length)throw new Error('Type the pages to use, like 1-3, 5.');
  return out;
}
function stamp(out,title){
  out.setProducer('PDF Lecture Reader');out.setCreator('PDF Lecture Reader');
  if(title)out.setTitle(title);
}
async function renderTo(canvas,doc,index,cssWidth){
  const page=await doc.getPage(index+1),vp1=page.getViewport({scale:1});
  const vp=page.getViewport({scale:cssWidth/vp1.width*(window.devicePixelRatio||1)});
  canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
  const task=page.render({canvasContext:canvas.getContext('2d'),viewport:vp});
  return task;
}

/* ================= the tools view ================= */
const T={tool:'',from:'start',busy:false,done:null};
const view=h('section',{id:'tools',hidden:true,'aria-labelledby':'t-title'});
const bar=h('header',{class:'t-bar'});
const barIn=h('div',{class:'gut'});
const backB=btn('← Back',()=>close(),{id:'t-back',title:'Back to the start screen'});
const titleEl=h('h1',{id:'t-title'});
const statusEl=h('span',{class:'t-status',id:'t-status','aria-live':'polite'});
const nameIn=h('input',{id:'t-name',type:'text',spellcheck:'false',autocomplete:'off','aria-label':'File name for the new PDF'});
const nameBox=h('label',{class:'t-name',for:'t-name'},'Save as ',nameIn,h('span',{text:'.pdf'}));
const saveB=h('button',{type:'button',class:'primary',id:'t-save'},'Save PDF');
barIn.append(backB,titleEl,statusEl,nameBox,saveB);bar.append(barIn);
const msgEl=h('div',{class:'t-msg',role:'alert',hidden:true});
const body=h('div',{class:'t-body'});
const doneEl=h('div',{class:'t-done',hidden:true,role:'status'});
const filePick=h('input',{type:'file',multiple:true,hidden:true});
view.append(bar,msgEl,body,doneEl,filePick);

const startEl=$('start'),appEl=$('app');
appEl.after(view);

function status(t){statusEl.textContent=t||''}
function showMsg(t){msgEl.textContent=t||'';msgEl.hidden=!t}
function busy(on,text){T.busy=on;saveB.disabled=on||!canSave();backB.disabled=on;status(text||'');view.classList.toggle('busy',on)}
const canSave=()=>T.tool==='merge'?M.items.length>0:T.tool==='images'?I.items.length>0:T.tool==='edit'?E.pages.length>0:false;
function refreshSave(){saveB.disabled=T.busy||!canSave()}

let pickCb=null;
function pick(accept,multiple,cb){filePick.accept=accept;filePick.multiple=multiple;pickCb=cb;filePick.value='';filePick.click()}
filePick.onchange=()=>{const fs=[...filePick.files];filePick.value='';if(fs.length&&pickCb)pickCb(fs)};

function open(tool,opts={}){
  if(T.busy)return;
  if(!view.hidden&&T.tool==='edit'&&E.dirty&&tool!=='edit'&&!confirm('Leave the editor? Changes you have not saved will be lost.'))return;
  if(view.hidden){T.from=!appEl.hidden?'app':'start';T.title=document.title}
  if(window.plr&&window.plr.stop)window.plr.stop();
  startEl.hidden=true;appEl.hidden=true;view.hidden=false;
  showMsg('');hideDone();status('');
  if(T.tool==='edit'&&tool!=='edit')edReset();
  T.tool=tool;body.innerHTML='';body.className='t-body t-'+tool;
  ({merge:mergeView,images:imagesView,edit:editView}[tool])(opts);
  document.title=titleEl.textContent+' · PDF Lecture Reader';
  refreshSave();
}
function close(){
  if(T.busy)return;
  if(T.tool==='edit'&&E.dirty&&!confirm('Leave the editor? Changes you have not saved will be lost.'))return;
  view.hidden=true;hideDone();
  if(T.tool==='edit')edReset();
  T.tool='';
  if(T.from==='app'&&window.plr&&window.plr.isOpen&&window.plr.current&&window.plr.current())appEl.hidden=false;else startEl.hidden=false;
  document.title=T.title||'PDF Lecture Reader';
}
const active=()=>!view.hidden;
function leave(){
  if(!active())return true;
  if(T.busy)return false;
  if(T.tool==='edit'&&E.dirty&&!confirm('Open the new PDF? Changes you have not saved in the editor will be lost.'))return false;
  view.hidden=true;hideDone();if(T.tool==='edit')edReset();T.tool='';startEl.hidden=false;document.title=T.title||'PDF Lecture Reader';
  return true;
}

/* ---- saving: a Save dialog in the desktop app, a download in the browser ---- */
async function deliver(bytes,name){
  const file=cleanName(name)+'.pdf';
  if(NATIVE&&NATIVE.savePdf){const r=await NATIVE.savePdf(file,bytes);return r?{name:r.name,path:r.path}:null}
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  const a=h('a',{href:url,download:file,hidden:true});document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),120000);
  return {name:file};
}
function showDone(saved,bytes,note){
  doneEl.innerHTML='';
  const where=saved.path?`Saved ${saved.name}.`:`${saved.name} is in your downloads.`;
  doneEl.append(h('p',{},h('b',{text:where}),note?' '+note:''));
  const row=h('div',{class:'t-donerow'});
  if(window.plr&&window.plr.open)row.append(btn('Read it aloud',()=>{
    const ab=toAB(bytes);if(T.tool==='edit')E.dirty=false;
    view.hidden=true;hideDone();if(T.tool==='edit')edReset();T.tool='';startEl.hidden=false;document.title='PDF Lecture Reader';
    window.plr.open(ab,saved.name);
  },{class:'primary'}));
  if(saved.path&&NATIVE.showInFolder)row.append(btn(NATIVE.platform==='darwin'?'Show in Finder':'Show in folder',()=>NATIVE.showInFolder(saved.path)));
  row.append(btn('Close',hideDone));
  doneEl.append(row);doneEl.hidden=false;
}
function hideDone(){doneEl.hidden=true;doneEl.innerHTML=''}
saveB.onclick=async()=>{
  if(T.busy||!canSave())return;
  showMsg('');hideDone();
  busy(true,'Making the PDF…');
  let bytes,note='';
  try{
    const r=await ({merge:mergeBuild,images:imagesBuild,edit:edBuild}[T.tool])();
    bytes=r.bytes;note=r.note||'';
  }catch(e){console.error(e);busy(false);showMsg(e&&e.userMsg||'The PDF could not be made. '+(e&&e.message?'('+e.message+')':''));return}
  busy(true,'Saving…');
  try{
    const saved=await deliver(bytes,nameIn.value);
    busy(false);
    if(saved){if(T.tool==='edit')E.dirty=false;showDone(saved,bytes,note)}
  }catch(e){console.error(e);busy(false);showMsg('The file could not be saved. Try another folder or file name.')}
};
const userErr=m=>{const e=new Error(m);e.userMsg=m;return e};

/* ---- files dropped anywhere while a tool is open go to that tool, not to the reader ---- */
const hasFiles=e=>[...(e.dataTransfer&&e.dataTransfer.types||[])].includes('Files');
window.addEventListener('dragover',e=>{if(active()&&hasFiles(e)){e.preventDefault();e.stopPropagation();if(e.dataTransfer)e.dataTransfer.dropEffect=T.busy?'none':'copy';view.classList.add('over')}},true);
window.addEventListener('dragleave',e=>{if(active()&&(e.target===document.documentElement||!e.relatedTarget))view.classList.remove('over')},true);
window.addEventListener('drop',e=>{
  if(!active()||!hasFiles(e))return;
  e.preventDefault();e.stopPropagation();view.classList.remove('over');
  if(T.busy)return;
  const fs=[...e.dataTransfer.files];if(!fs.length)return;
  ({merge:mergeAdd,images:imagesAdd,edit:edDrop}[T.tool]||(()=>{}))(fs);
},true);

/* ---- a reorderable list (merge files, images) ---- */
function sortable(list,arr,rerender){
  let dragId=null;
  list.addEventListener('dragstart',e=>{const li=e.target.closest('[data-id]');if(!li)return;dragId=+li.dataset.id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/x-plr-item',String(dragId));li.classList.add('dragging')});
  list.addEventListener('dragend',()=>{dragId=null;list.querySelectorAll('.dragging,.ins-before,.ins-after').forEach(x=>x.classList.remove('dragging','ins-before','ins-after'))});
  list.addEventListener('dragover',e=>{
    if(dragId==null)return;e.preventDefault();
    const li=e.target.closest('[data-id]');list.querySelectorAll('.ins-before,.ins-after').forEach(x=>x.classList.remove('ins-before','ins-after'));
    if(!li||+li.dataset.id===dragId)return;
    const r=li.getBoundingClientRect(),grid=getComputedStyle(list).display==='grid';
    const after=grid?e.clientX>r.left+r.width/2:e.clientY>r.top+r.height/2;
    li.classList.add(after?'ins-after':'ins-before');
  });
  list.addEventListener('drop',e=>{
    if(dragId==null)return;e.preventDefault();
    const li=list.querySelector('.ins-before,.ins-after');if(!li)return;
    const from=arr().findIndex(x=>x.id===dragId),item=arr()[from];
    arr().splice(from,1);
    let to=arr().findIndex(x=>x.id===+li.dataset.id);if(li.classList.contains('ins-after'))to++;
    arr().splice(to,0,item);rerender();
  });
}
const move=(a,i,d)=>{const j=i+d;if(j<0||j>=a.length)return false;[a[i],a[j]]=[a[j],a[i]];return true};
function dropZone(title,sub,label,accept,multiple,onFiles){
  const z=h('div',{class:'drop t-drop',tabindex:'0',role:'button','aria-label':label},
    h('strong',{text:title}),h('span',{text:'or'}),btn(label,e=>{e.stopPropagation();pick(accept,multiple,onFiles)},{class:'primary'}),h('span',{text:sub}));
  z.onclick=()=>pick(accept,multiple,onFiles);
  z.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick(accept,multiple,onFiles)}};
  return z;
}

/* ================= merge PDFs ================= */
const M={items:[]};
const PDF_ACCEPT='application/pdf,.pdf';
const IMG_ACCEPT='image/jpeg,image/png,image/webp,image/gif,image/bmp,.jpg,.jpeg,.png,.webp,.gif,.bmp';
function mergeView(){
  titleEl.textContent='Merge PDFs';saveB.textContent='Merge and save';
  if(!nameIn.value||T.lastTool!=='merge')nameIn.value='merged';T.lastTool='merge';
  const wrap=h('div',{class:'gut t-wrap'});
  wrap.append(
    h('p',{class:'t-intro',text:'Join several PDFs into one, in the order you choose. You can pick which pages to take from each, and add JPG or PNG images as pages too.'}),
    dropZone('Drop PDFs here','Your files stay on this device. Nothing is uploaded.','Add PDFs',PDF_ACCEPT+','+IMG_ACCEPT,true,mergeAdd),
    h('ol',{class:'t-files',id:'m-list','aria-label':'Files to merge, in order'}),
    h('p',{class:'t-hint',id:'m-hint',hidden:true,text:'Drag the files to change the order. Pages: type which pages to keep, like 1-3, 5. Leave it as "all" to keep every page.'})
  );
  body.append(h('div',{class:'t-scroll'},wrap));
  sortable($('m-list'),()=>M.items,mergeList);
  mergeList();
}
async function mergeAdd(files){
  const bad=[],heic=[];
  busy(true,'Adding files…');
  for(const f of files){
    try{
      if(isPdfFile(f)){
        const bytes=new Uint8Array(await f.arrayBuffer());
        const doc=await openPdfjs(bytes);
        M.items.push({id:nid(),kind:'pdf',name:f.name,size:f.size,bytes,doc,pages:doc.numPages,range:'all'});
      }else if(isImageFile(f)){
        const im=await readImage(f);M.items.push({id:im.id,kind:'image',name:f.name,size:f.size,im});
      }else if(isHeic(f))heic.push(f.name);else bad.push(f.name);
    }catch(e){console.error(e);bad.push(f.name)}
    if(T.tool==='merge')mergeList();
  }
  busy(false);
  showMsg([heic.length?`${heic.join(', ')}: HEIC photos can't be read here. On an iPhone, set Camera › Formats to "Most Compatible", or export the photo as JPG.`:'',
    bad.length?`${bad.join(', ')}: not a PDF or an image that can be read${bad.some(n=>/\.pdf$/i.test(n))?' (it may be damaged or password protected)':''}.`:''].filter(Boolean).join(' '));
}
function mergeList(){
  const ul=$('m-list');if(!ul)return;ul.innerHTML='';
  M.items.forEach((it,i)=>{
    const th=h('div',{class:'t-thumb'});
    if(it.kind==='image')th.append(h('img',{src:it.im.url,alt:''}));
    else{const c=h('canvas');th.append(c);renderTo(c,it.doc,0,56).then(t=>t.promise).catch(()=>{})}
    let pagesIn=null;
    if(it.kind==='pdf'){
      pagesIn=h('input',{type:'text',value:it.range,class:'t-range','aria-label':'Pages to use from '+it.name,title:'Which pages to use, like 1-3, 5. "all" uses every page.',spellcheck:'false'});
      pagesIn.oninput=()=>{it.range=pagesIn.value;pagesIn.classList.remove('bad')};
      pagesIn.onchange=()=>{try{parseRange(it.range,it.pages);pagesIn.classList.remove('bad')}catch(e){pagesIn.classList.add('bad');showMsg(it.name+': '+e.message)}};
    }
    const li=h('li',{class:'t-file','data-id':it.id,draggable:'true'},
      h('span',{class:'t-grip','aria-hidden':'true',text:'⋮⋮'}),th,
      h('div',{class:'t-info'},h('b',{text:it.name,title:it.name}),
        h('span',{text:it.kind==='pdf'?`${plural(it.pages,'page')} · ${mb(it.size)}`:`Image · ${it.im.w} × ${it.im.h} · becomes 1 page`}),
        pagesIn?h('label',{class:'t-pages'},'Pages ',pagesIn):null),
      h('div',{class:'t-acts'},
        btn('↑',()=>{if(move(M.items,i,-1))mergeList()},{'aria-label':'Move '+it.name+' up',title:'Move up',disabled:i===0}),
        btn('↓',()=>{if(move(M.items,i,1))mergeList()},{'aria-label':'Move '+it.name+' down',title:'Move down',disabled:i===M.items.length-1}),
        btn('Remove',()=>{M.items.splice(i,1);if(it.doc)it.doc.destroy();if(it.im)URL.revokeObjectURL(it.im.url);mergeList()},{'aria-label':'Remove '+it.name})));
    ul.appendChild(li);
  });
  $('m-hint').hidden=M.items.length<2;
  const total=M.items.reduce((a,it)=>{if(it.kind==='image')return a+1;try{return a+parseRange(it.range,it.pages).length}catch(e){return a}},0);
  if(!T.busy)status(M.items.length?`${plural(M.items.length,'file')} · ${plural(total,'page')}`:'');
  refreshSave();
}
async function mergeBuild(){
  if(M.items.length<2&&M.items[0]&&M.items[0].kind==='pdf'&&/^\s*(all)?\s*$/i.test(M.items[0].range))throw userErr('Add at least two files to merge.');
  const out=await L.PDFDocument.create();let pictures=false;
  for(const [k,it] of M.items.entries()){
    status(`Adding ${it.name} (${k+1} of ${M.items.length})…`);await tick();
    if(it.kind==='image'){
      const [dw,dh]=seenSize(it.im,0),lay=layoutImage(dw,dh,{size:'a4',orient:'auto',margin:'small'});
      const page=out.addPage([lay.pw,lay.ph]);
      drawImageBox(page,await embedImage(out,it.im),it.im.q,lay.box,mapper({x:0,y:0,width:lay.pw,height:lay.ph},0),0);
      continue;
    }
    let idx;try{idx=parseRange(it.range,it.pages)}catch(e){throw userErr(it.name+': '+e.message)}
    const lib=await loadLib(it);
    if(lib){(await out.copyPages(lib,idx)).forEach(p=>out.addPage(p));continue}
    pictures=true;
    for(const i of idx){
      const r=await pageAsImage(it.doc,i),page=out.addPage([r.w,r.h]);
      page.drawImage(await out.embedJpg(r.bytes),{x:0,y:0,width:r.w,height:r.h});await tick();
    }
  }
  stamp(out);
  status('Saving…');
  return {bytes:await out.save(),note:pictures?'Some files were protected, so their pages were added as pictures (the text in them can\'t be selected).':''};
}

/* ================= images to PDF ================= */
const I={items:[],size:'a4',orient:'auto',margin:'small'};
function imagesView(){
  titleEl.textContent='Images to PDF';saveB.textContent='Make PDF';
  if(!nameIn.value||T.lastTool!=='images')nameIn.value='images';T.lastTool='images';
  const sel=(id,label,val,opts,on)=>{const s=h('select',{id},...opts.map(([v,t])=>h('option',{value:v,selected:v===val},t)));s.onchange=()=>{on(s.value);imagesList()};return h('label',{for:id},label+' ',s)};
  const wrap=h('div',{class:'gut t-wrap'});
  wrap.append(
    h('p',{class:'t-intro',text:'Turn one photo or many into a single PDF. Each image becomes a page, in the order shown.'}),
    dropZone('Drop JPG or PNG images here','You can pick many at once. WebP, GIF and BMP work too.','Add images',IMG_ACCEPT,true,imagesAdd),
    h('div',{class:'t-opts'},
      sel('i-size','Page size',I.size,[['a4','A4'],['letter','Letter'],['fit','Same as the image']],v=>I.size=v),
      sel('i-orient','Orientation',I.orient,[['auto','Match each image'],['portrait','Portrait'],['landscape','Landscape']],v=>I.orient=v),
      sel('i-margin','Margin',I.margin,[['none','None'],['small','Small'],['big','Large']],v=>I.margin=v)),
    h('ol',{class:'t-grid',id:'i-list','aria-label':'Images, in page order'}),
    h('p',{class:'t-hint',id:'i-hint',hidden:true,text:'Drag the pages to change the order. ↻ turns an image if it is on its side.'})
  );
  body.append(h('div',{class:'t-scroll'},wrap));
  sortable($('i-list'),()=>I.items,imagesList);
  imagesList();
}
async function imagesAdd(files){
  const bad=[],heic=[],pdfs=[];
  busy(true,'Adding images…');
  for(const f of files){
    if(isPdfFile(f)){pdfs.push(f.name);continue}
    if(isHeic(f)){heic.push(f.name);continue}
    if(!isImageFile(f)){bad.push(f.name);continue}
    try{const im=await readImage(f);I.items.push({id:im.id,im,turn:0});if(T.tool==='images')imagesList()}
    catch(e){console.error(e);bad.push(f.name)}
  }
  busy(false);imagesList();
  showMsg([pdfs.length?`${pdfs.join(', ')}: that's a PDF. To join PDFs, use Merge PDFs.`:'',
    heic.length?`${heic.join(', ')}: HEIC photos can't be read here. On an iPhone, set Camera › Formats to "Most Compatible", or export the photo as JPG.`:'',
    bad.length?`${bad.join(', ')}: not an image that can be read.`:''].filter(Boolean).join(' '));
}
function imagesList(){
  const ul=$('i-list');if(!ul)return;ul.innerHTML='';
  I.items.forEach((it,i)=>{
    const [dw,dh]=seenSize(it.im,it.turn),lay=layoutImage(dw,dh,I);
    const b=lay.box,pct=(v,of)=>(v/of*100)+'%';
    // the <img> already shows the photo upright; turn only by the user's extra rotation
    const sw=it.turn%180?b.h:b.w,sh=it.turn%180?b.w:b.h;
    const img=h('img',{src:it.im.url,alt:'',draggable:'false',style:`width:${pct(sw,b.w)};height:${pct(sh,b.h)};transform:translate(-50%,-50%) rotate(${it.turn}deg)`});
    const page=h('div',{class:'t-page',style:`aspect-ratio:${lay.pw}/${lay.ph}`},
      h('div',{class:'t-ib',style:`left:${pct(b.left,lay.pw)};top:${pct(b.top,lay.ph)};width:${pct(b.w,lay.pw)};height:${pct(b.h,lay.ph)}`},img));
    ul.appendChild(h('li',{class:'t-tile','data-id':it.id,draggable:'true'},
      page,
      h('div',{class:'t-tcap'},h('span',{class:'t-num',text:String(i+1)}),h('span',{class:'t-tname',text:it.im.name,title:it.im.name})),
      h('div',{class:'t-acts'},
        btn('←',()=>{if(move(I.items,i,-1))imagesList()},{'aria-label':'Move earlier',title:'Move earlier',disabled:i===0}),
        btn('↻',()=>{it.turn=(it.turn+90)%360;imagesList()},{'aria-label':'Turn '+it.im.name+' clockwise',title:'Turn clockwise'}),
        btn('→',()=>{if(move(I.items,i,1))imagesList()},{'aria-label':'Move later',title:'Move later',disabled:i===I.items.length-1}),
        btn('✕',()=>{I.items.splice(i,1);URL.revokeObjectURL(it.im.url);imagesList()},{'aria-label':'Remove '+it.im.name,title:'Remove'}))));
  });
  $('i-hint').hidden=I.items.length<2;
  if(!T.busy)status(I.items.length?plural(I.items.length,'page'):'');
  refreshSave();
}
async function imagesBuild(){
  const out=await L.PDFDocument.create();
  for(const [k,it] of I.items.entries()){
    status(`Adding image ${k+1} of ${I.items.length}…`);await tick();
    const [dw,dh]=seenSize(it.im,it.turn),lay=layoutImage(dw,dh,I);
    const page=out.addPage([lay.pw,lay.ph]);
    drawImageBox(page,await embedImage(out,it.im),(it.im.q+it.turn)%360,lay.box,mapper({x:0,y:0,width:lay.pw,height:lay.ph},0),0);
  }
  stamp(out);status('Saving…');
  return {bytes:await out.save()};
}

/* ================= edit a PDF ================= */
/* Pages keep their own size and /Rotate; things you add are stored in points from the page's
   top-left corner as it first appears, and written into the page when you save. */
const E={srcs:[],pages:[],imgs:new Map(),tool:'select',color:COLORS[0],hcolor:HCOLORS[0],font:'sans',size:14,bold:false,pen:2.5,
  zoom:1,S:1,cur:0,sel:null,editing:null,undo:[],dirty:false,name:'',els:new Map(),io:null,tio:null};
const PEN={thin:1.2,medium:2.5,thick:5};
function edReset(){
  E.srcs.forEach(s=>{try{s.doc.destroy()}catch(e){}});E.imgs.forEach(im=>URL.revokeObjectURL(im.url));
  Object.assign(E,{srcs:[],pages:[],imgs:new Map(),sel:null,editing:null,undo:[],dirty:false,cur:0,els:new Map()});
  if(E.io)E.io.disconnect();if(E.tio)E.tio.disconnect();E.io=E.tio=null;
}
function editView(opts){
  titleEl.textContent='Edit a PDF';saveB.textContent='Save PDF';T.lastTool='edit';
  if(opts.buf){edReset();edLoad(copyBytes(opts.buf),opts.name||'document.pdf');return}
  if(E.pages.length){edShell();return}
  nameIn.value='edited';
  const wrap=h('div',{class:'gut t-wrap'});
  wrap.append(
    h('p',{class:'t-intro',text:'Add text, draw, highlight or cover parts of a page, add a picture or signature, and rotate, reorder, add or delete pages.'}),
    dropZone('Drop a PDF to edit','Your file stays on this device. Nothing is uploaded.','Choose a PDF',PDF_ACCEPT,false,fs=>edDrop(fs)));
  body.append(h('div',{class:'t-scroll'},wrap));
}
async function edDrop(fs){
  if(!E.pages.length){
    const f=fs.find(isPdfFile);
    if(!f){showMsg(fs.some(isImageFile)?'Start with a PDF. To turn images into a PDF, use Images to PDF.':'That file is not a PDF.');return}
    try{await edLoad(new Uint8Array(await f.arrayBuffer()),f.name)}catch(e){}
  }else edAddFiles(fs,E.cur+1);
}
async function edLoad(bytes,name){
  busy(true,'Opening '+name+'…');showMsg('');
  try{
    const doc=await openPdfjs(bytes);
    E.srcs=[{name,bytes,doc}];E.pages=[];
    await edAddPdf(E.srcs[0],0);
    E.name=name;nameIn.value=cleanName(baseName(name))+' (edited)';
    E.dirty=false;E.undo=[];E.cur=0;
    edShell();
  }catch(e){
    console.error(e);
    showMsg(/password/i.test(e&&e.name||'')?'This PDF is password protected. Remove the password and try again.':'This file could not be opened as a PDF.');
    throw e;
  }finally{busy(false);refreshSave();edStatus()}
}
async function edAddPdf(src,at){
  const n=src.doc.numPages,list=[];
  for(let i=1;i<=n;i++){
    const pg=await src.doc.getPage(i),vp=pg.getViewport({scale:1});
    list.push({id:nid(),kind:'pdf',src:E.srcs.indexOf(src),index:i-1,w:vp.width,h:vp.height,baseRot:pg.rotate,rot:0,items:[]});
    if(i%25===0){status(`Reading page ${i} of ${n}…`);await tick()}
  }
  E.pages.splice(at,0,...list);
  return list.length;
}
async function edAddFiles(fs,at){
  const bad=[];let added=0;busy(true,'Adding pages…');
  for(const f of fs){
    try{
      if(isPdfFile(f)){
        const bytes=new Uint8Array(await f.arrayBuffer()),src={name:f.name,bytes,doc:await openPdfjs(bytes)};
        if(!added)snap();E.srcs.push(src);const n=await edAddPdf(src,at);at+=n;added+=n;
      }else if(isImageFile(f)){
        const im=await readImage(f);E.imgs.set(im.id,im);
        const [dw,dh]=seenSize(im,0),lay=layoutImage(dw,dh,{size:'a4',orient:'auto',margin:'small'});
        if(!added)snap();E.pages.splice(at++,0,{id:nid(),kind:'image',img:im.id,box:lay.box,w:lay.pw,h:lay.ph,baseRot:0,rot:0,items:[]});added++;
      }else bad.push(f.name);
    }catch(e){console.error(e);bad.push(f.name)}
  }
  busy(false);
  if(added){E.dirty=true;edBuild_dom();edGoto(at-added)}
  showMsg(bad.length?`${bad.join(', ')}: could not be added. Use PDFs, JPG or PNG images.`:'');
}

/* ---- undo ---- */
function snap(){E.undo.push(JSON.stringify({pages:E.pages,cur:E.cur}));if(E.undo.length>60)E.undo.shift();E.dirty=true;edUndoBtn()}
function undo(){
  edCommit();if(!E.undo.length)return;
  const s=JSON.parse(E.undo.pop());E.pages=s.pages;E.cur=Math.min(s.cur,E.pages.length-1);E.sel=null;
  edBuild_dom();edUndoBtn();
}
const edUndoBtn=()=>{const b=$('ed-undo');if(b)b.disabled=!E.undo.length};

/* ---- the editor screen ---- */
function edShell(){
  body.innerHTML='';
  if(E.io)E.io.disconnect();if(E.tio)E.tio.disconnect();E.io=E.tio=null;E.els=new Map();E.sel=null;E.editing=null;
  const tb=h('div',{class:'ed-tb',role:'toolbar','aria-label':'Editing tools'});
  const toolB=(id,label,title)=>h('button',{type:'button',class:'ed-tool','data-tool':id,'aria-pressed':String(E.tool===id),title,onclick:()=>edTool(id)},label);
  const colors=(list,key,label)=>h('div',{class:'grp sw-grp','data-for':key,role:'group','aria-label':label},
    ...list.map(c=>h('button',{type:'button',class:'sw',style:`background:${c}`,'aria-label':label+' '+c,'aria-pressed':String(E[key]===c),onclick:()=>edSetStyle(key,c)})));
  const sel=(id,label,opts,val,on)=>{const s=h('select',{id},...opts.map(([v,t])=>h('option',{value:v,selected:String(v)===String(val)},t)));s.onchange=()=>on(s.value);return h('label',{for:id},label+' ',s)};
  tb.append(
    h('div',{class:'grp'},
      toolB('select','Select','Select things you added to move, resize or delete them'),
      toolB('text','T  Text','Click on the page to type'),
      toolB('pen','✎ Draw','Draw freehand'),
      toolB('hl','Highlight','Drag over text to highlight it'),
      toolB('wo','White-out','Drag to cover part of the page with white'),
      h('button',{type:'button',class:'ed-tool',title:'Add a picture or signature (JPG or PNG)',onclick:()=>pick(IMG_ACCEPT,false,fs=>edAddImage(fs[0]))},'Image')),
    h('div',{class:'grp opt','data-show':'text'},
      sel('ed-font','Font',[['sans','Sans'],['serif','Serif'],['mono','Mono']],E.font,v=>edSetStyle('font',v)),
      sel('ed-size','Size',[8,9,10,11,12,14,16,18,20,24,28,32,40,48,60,72].map(n=>[n,n]),E.size,v=>edSetStyle('size',+v)),
      h('button',{type:'button',id:'ed-bold','aria-pressed':String(E.bold),title:'Bold',onclick:()=>edSetStyle('bold',!E.bold)},h('b',{text:'B'}))),
    h('div',{class:'grp opt','data-show':'pen'},sel('ed-pen','Line',[['thin','Thin'],['medium','Medium'],['thick','Thick']],Object.keys(PEN).find(k=>PEN[k]===E.pen),v=>edSetStyle('pen',PEN[v]))),
    h('div',{class:'opt','data-show':'text pen'},colors(COLORS,'color','Colour')),
    h('div',{class:'opt','data-show':'hl'},colors(HCOLORS,'hcolor','Highlight colour')),
    h('span',{class:'ed-tip opt','data-show':'wo',text:'Covers what is underneath with white. The text under it is hidden, not removed from the file.'}),
    h('span',{class:'ed-tip opt','data-show':'select',text:'Click something you added to move it. Drag the corner dot to resize. Delete removes it.'}),
    h('div',{class:'grp ed-right'},
      btn('Delete',()=>edDeleteSel(),{id:'ed-del',disabled:true,title:'Delete the selected item (Delete key)'}),
      btn('↶ Undo',()=>undo(),{id:'ed-undo',disabled:!E.undo.length,title:'Undo (Ctrl+Z)'}),
      btn('−',()=>edZoom(-1),{'aria-label':'Zoom out',title:'Zoom out'}),
      h('span',{class:'ed-zl',id:'ed-zl',text:'Fit'}),
      btn('+',()=>edZoom(1),{'aria-label':'Zoom in',title:'Zoom in'})));
  const side=h('aside',{class:'ed-side','aria-label':'Pages'},
    h('div',{class:'ed-pageops'},
      h('span',{class:'ed-pn',id:'ed-pn'}),
      btn('↺',()=>edRotate(-90),{'aria-label':'Turn this page left',title:'Turn page left'}),
      btn('↻',()=>edRotate(90),{'aria-label':'Turn this page right',title:'Turn page right'}),
      btn('Delete page',()=>edDeletePage(),{title:'Delete this page'})),
    h('div',{class:'ed-pageops'},
      btn('+ Add pages',()=>pick(PDF_ACCEPT+','+IMG_ACCEPT,true,fs=>edAddFiles(fs,E.cur+1)),{title:'Add pages from another PDF or from images, after this page'}),
      btn('+ Blank',()=>edBlank(),{title:'Add a blank page after this page'})),
    h('ol',{class:'ed-ths',id:'ed-ths'}));
  const vw=h('div',{class:'ed-view',id:'ed-view',tabindex:'-1'},h('div',{class:'ed-pages',id:'ed-pages'}));
  body.append(h('div',{class:'ed','data-tool':E.tool,id:'ed'},tb,h('div',{class:'ed-main'},side,vw)));
  vw.addEventListener('scroll',()=>{if(!E.scrollRaf)E.scrollRaf=requestAnimationFrame(()=>{E.scrollRaf=0;edTrackCur()})});
  sortableThumbs();
  edTool(E.tool);
  E.fit=0;edBuild_dom();edStatus();
}
function edTool(t){
  edCommit();const changed=E.tool!==t;E.tool=t;
  if(changed&&E.sel&&t!=='select')edSelect(null);
  const ed=$('ed');if(!ed)return;ed.dataset.tool=t;
  ed.querySelectorAll('.ed-tool[data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===t)));
  edOpts();
}
// show the options for the selected thing, or else for the tool in use
function edOpts(){
  const ed=$('ed');if(!ed)return;
  const show=E.sel?{text:'text',pen:'pen',hl:'hl'}[E.sel.item.type]||E.tool:E.tool;
  ed.querySelectorAll('.opt').forEach(o=>o.hidden=!o.dataset.show.split(' ').includes(show));
}
function edSetStyle(key,v){
  E[key]=v;
  const ed=$('ed');
  if(ed){
    ed.querySelectorAll(`.sw-grp[data-for="${key}"] .sw`).forEach(b=>b.setAttribute('aria-pressed',String(b.style.background&&rgbToHex(b.style.background)===v)));
    if(key==='bold')$('ed-bold').setAttribute('aria-pressed',String(v));
  }
  const s=E.sel;if(!s)return;
  const it=s.item,map={color:['text','pen'],hcolor:['hl'],font:['text'],size:['text'],bold:['text'],pen:['pen']};
  if(!map[key].includes(it.type))return;
  if(!E.editing)snap();
  if(key==='hcolor'||key==='color')it.color=v;else if(key==='pen')it.w=v;else it[key]=v;
  E.dirty=true;edItems(s.page,true);
}
const rgbToHex=c=>{const m=/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);return m?'#'+[m[1],m[2],m[3]].map(n=>(+n).toString(16).padStart(2,'0')).join(''):c};

/* build / refresh the thumbnails and the page views, reusing what is already drawn */
function edBuild_dom(){
  const pagesEl=$('ed-pages'),ths=$('ed-ths');if(!pagesEl)return;
  if(!E.io)E.io=new IntersectionObserver(es=>es.forEach(e=>{const P=E.pages.find(p=>p.id===+e.target.dataset.id);if(!P)return;const el=E.els.get(P.id);el.vis=e.isIntersecting;if(e.isIntersecting)edPaint(P);else edUnpaint(el)}),{root:$('ed-view'),rootMargin:'900px 0px'});
  if(!E.tio)E.tio=new IntersectionObserver(es=>es.forEach(e=>{const P=E.pages.find(p=>p.id===+e.target.dataset.id);if(P&&e.isIntersecting)edPaintThumb(P)}),{root:ths,rootMargin:'400px 0px'});
  const keep=new Set(E.pages.map(p=>p.id));
  for(const [id,el] of E.els)if(!keep.has(id)){E.io.unobserve(el.pg);E.tio.unobserve(el.th);el.pg.remove();el.th.remove();E.els.delete(id)}
  edFit();
  E.pages.forEach((P,i)=>{
    let el=E.els.get(P.id);
    if(!el)el=edMake(P);
    pagesEl.appendChild(el.pg);ths.appendChild(el.th);
    el.num.textContent=String(i+1);el.tag.textContent=`Page ${i+1} of ${E.pages.length}`;
    edSize(P,el);edItems(P);
  });
  E.cur=Math.max(0,Math.min(E.cur,E.pages.length-1));
  edMarkCur();refreshSave();edStatus();
}
function edFit(){
  const v=$('ed-view');if(!v)return;
  if(!E.fit){const maxW=Math.max(...E.pages.map(P=>P.rot%180?P.h:P.w),1);E.fit=Math.max(0.3,Math.min(1.5,(v.clientWidth-56)/maxW))}
  E.S=E.fit*E.zoom;
  $('ed-zl').textContent=E.zoom===1?'Fit':Math.round(E.zoom*100)+'%';
}
function edMake(P){
  const canvas=h('canvas');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','ed-svg');svg.setAttribute('preserveAspectRatio','none');
  const ov=h('div',{class:'ed-ov'},svg);
  const inn=h('div',{class:'ed-in'},canvas,ov);
  if(P.kind==='image'){const im=E.imgs.get(P.img);inn.insertBefore(imgBox(im,P.box,P.w,P.h,0),ov);canvas.remove()}
  if(P.kind==='blank')canvas.remove();
  const tag=h('span',{class:'ed-tag'});
  const pg=h('div',{class:'ed-pg','data-id':P.id},inn,tag);
  const tc=h('canvas'),thIn=h('div',{class:'ed-thin'},P.kind==='pdf'?tc:P.kind==='image'?imgBox(E.imgs.get(P.img),P.box,P.w,P.h,0):null);
  const num=h('span',{class:'ed-num'});
  const th=h('li',{class:'ed-th','data-id':P.id,draggable:'true',tabindex:'0',role:'button','aria-label':'Go to page'},h('div',{class:'ed-thbox'},thIn),num);
  th.onclick=()=>edGoto(E.pages.findIndex(p=>p.id===P.id));
  th.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();th.click()}};
  ov.addEventListener('pointerdown',e=>edDown(e,E.pages.find(p=>p.id===P.id)));
  const el={pg,inn,ov,svg,canvas:P.kind==='pdf'?canvas:null,tag,th,thIn,tc,num,painted:0,thumbed:false,vis:false};
  E.els.set(P.id,el);E.io.observe(pg);E.tio.observe(th);
  return el;
}
function imgBox(im,b,pw,ph,turn){
  const pct=(v,of)=>(v/of*100)+'%',sw=turn%180?b.h:b.w,sh=turn%180?b.w:b.h;
  return h('div',{class:'t-ib',style:`left:${pct(b.left,pw)};top:${pct(b.top,ph)};width:${pct(b.w,pw)};height:${pct(b.h,ph)}`},
    h('img',{src:im.url,alt:'',draggable:'false',style:`width:${pct(sw,b.w)};height:${pct(sh,b.h)};transform:translate(-50%,-50%) rotate(${turn}deg)`}));
}
function edSize(P,el){
  const S=E.S,w=P.w*S,ht=P.h*S,turned=P.rot%180;
  Object.assign(el.inn.style,{width:w+'px',height:ht+'px','--rot':P.rot+'deg'});el.inn.style.setProperty('--rot',P.rot+'deg');el.inn.style.setProperty('--s',S);
  el.pg.style.width=(turned?ht:w)+'px';el.pg.style.height=(turned?w:ht)+'px';
  el.svg.setAttribute('viewBox',`0 0 ${P.w} ${P.h}`);
  const k=110/(turned?P.h:P.w);
  Object.assign(el.thIn.style,{width:P.w*k+'px',height:P.h*k+'px'});el.thIn.style.setProperty('--rot',P.rot+'deg');
  el.thIn.parentNode.style.height=(turned?P.w:P.h)*k+'px';
  if(el.vis&&el.painted!==S)edPaint(P);
}
async function edPaint(P){
  const el=E.els.get(P.id);if(!el||!el.canvas||el.painted===E.S)return;
  const S=E.S;el.painted=S;
  if(el.task){try{el.task.cancel()}catch(e){}}
  try{
    const page=await E.srcs[P.src].doc.getPage(P.index+1),dpr=window.devicePixelRatio||1;
    const vp=page.getViewport({scale:S*dpr});
    const c=h('canvas');c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);
    el.task=page.render({canvasContext:c.getContext('2d'),viewport:vp});
    await el.task.promise;el.task=null;
    if(el.painted!==S)return;
    el.canvas.replaceWith(c);el.canvas=c;
  }catch(e){if(!(e&&e.name==='RenderingCancelledException'))console.error(e);if(el.painted===S)el.painted=0}
}
function edUnpaint(el){if(el.canvas&&el.painted){if(el.task){try{el.task.cancel()}catch(e){}}el.canvas.width=el.canvas.height=0;el.painted=0}}
async function edPaintThumb(P){
  const el=E.els.get(P.id);if(!el||el.thumbed||P.kind!=='pdf')return;el.thumbed=true;
  try{await (await renderTo(el.tc,E.srcs[P.src].doc,P.index,110)).promise}catch(e){el.thumbed=false}
}
function edZoom(d){
  const steps=[0.5,0.67,0.8,1,1.25,1.5,2,2.5,3];
  const i=steps.indexOf(E.zoom);E.zoom=steps[Math.max(0,Math.min(steps.length-1,(i<0?3:i)+d))];
  const v=$('ed-view'),frac=v.scrollTop/(v.scrollHeight||1);
  edFit();E.pages.forEach(P=>{const el=E.els.get(P.id);if(el){edSize(P,el);edItems(P)}});
  v.scrollTop=frac*v.scrollHeight;
}
window.addEventListener('resize',()=>{if(active()&&T.tool==='edit'&&E.pages.length&&E.zoom===1){clearTimeout(E.rt);E.rt=setTimeout(()=>{E.fit=0;edBuild_dom()},200)}});

function edTrackCur(){
  const v=$('ed-view');if(!v)return;const top=v.getBoundingClientRect().top+v.clientHeight*0.35;
  let best=0;
  E.pages.forEach((P,i)=>{const el=E.els.get(P.id);if(el&&el.pg.getBoundingClientRect().top<=top)best=i});
  if(best!==E.cur){E.cur=best;edMarkCur();edStatus()}
}
function edMarkCur(){
  E.pages.forEach((P,i)=>{const el=E.els.get(P.id);if(el)el.th.classList.toggle('cur',i===E.cur)});
  const P=E.pages[E.cur],el=P&&E.els.get(P.id);
  if(el){const side=el.th.closest('.ed-ths'),r=el.th.getBoundingClientRect(),sr=side.getBoundingClientRect();if(r.top<sr.top+80||r.bottom>sr.bottom)el.th.scrollIntoView({block:'nearest'})}
  const pn=$('ed-pn');if(pn)pn.textContent=E.pages.length?`Page ${E.cur+1}`:'';
}
function edGoto(i){
  if(i<0||i>=E.pages.length)return;E.cur=i;
  const el=E.els.get(E.pages[i].id);if(el)el.pg.scrollIntoView({block:'start'});
  edMarkCur();edStatus();
}
function edStatus(){if(T.tool==='edit'&&!T.busy)status(E.pages.length?plural(E.pages.length,'page'):'')}

/* ---- page operations ---- */
function edRotate(d){const P=E.pages[E.cur];if(!P)return;edCommit();snap();P.rot=((P.rot+d)%360+360)%360;E.fit=0;edBuild_dom()}
function edDeletePage(){
  if(E.pages.length<2){showMsg('A PDF needs at least one page.');return}
  edCommit();snap();E.pages.splice(E.cur,1);E.sel=null;E.cur=Math.min(E.cur,E.pages.length-1);edBuild_dom();edGoto(E.cur);
}
function edBlank(){
  const P=E.pages[E.cur];const turned=P&&P.rot%180;
  const w=P?(turned?P.h:P.w):SIZES.a4[0],ht=P?(turned?P.w:P.h):SIZES.a4[1];
  edCommit();snap();E.pages.splice(E.cur+1,0,{id:nid(),kind:'blank',w,h:ht,baseRot:0,rot:0,items:[]});edBuild_dom();edGoto(E.cur+1);
}
function sortableThumbs(){
  const ths=$('ed-ths');let dragId=null;
  ths.addEventListener('dragstart',e=>{const li=e.target.closest('[data-id]');if(!li)return;dragId=+li.dataset.id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/x-plr-page',String(dragId));li.classList.add('dragging')});
  ths.addEventListener('dragend',()=>{dragId=null;ths.querySelectorAll('.dragging,.ins-before,.ins-after').forEach(x=>x.classList.remove('dragging','ins-before','ins-after'))});
  ths.addEventListener('dragover',e=>{
    if(dragId==null)return;e.preventDefault();
    ths.querySelectorAll('.ins-before,.ins-after').forEach(x=>x.classList.remove('ins-before','ins-after'));
    const li=e.target.closest('[data-id]');if(!li||+li.dataset.id===dragId)return;
    const r=li.getBoundingClientRect();li.classList.add(e.clientY>r.top+r.height/2?'ins-after':'ins-before');
  });
  ths.addEventListener('drop',e=>{
    if(dragId==null)return;e.preventDefault();
    const li=ths.querySelector('.ins-before,.ins-after');if(!li)return;
    edCommit();snap();
    const from=E.pages.findIndex(p=>p.id===dragId),P=E.pages[from];E.pages.splice(from,1);
    let to=E.pages.findIndex(p=>p.id===+li.dataset.id);if(li.classList.contains('ins-after'))to++;
    E.pages.splice(to,0,P);E.cur=to;edBuild_dom();edGoto(to);
  });
}

/* ---- things added to a page ---- */
const findItem=(P,id)=>P.items.find(i=>i.id===id);
function edItems(P,keepEdit){
  const el=E.els.get(P.id);if(!el)return;
  const pct=(v,of)=>(v/of*100)+'%';
  [...el.ov.querySelectorAll('.ed-it')].forEach(n=>{if(!(keepEdit&&E.editing&&n===E.editing.node))n.remove()});
  el.svg.innerHTML='';
  for(const it of P.items){
    const isSel=E.sel&&E.sel.item.id===it.id;
    if(it.type==='pen'){
      const p=document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d',it.pts.map((q,i)=>(i?'L':'M')+q[0].toFixed(2)+' '+q[1].toFixed(2)).join(' '));
      Object.entries({fill:'none',stroke:it.color,'stroke-width':it.w,'stroke-linecap':'round','stroke-linejoin':'round','data-id':it.id,class:'ed-path'+(isSel?' sel':'')}).forEach(([k,v])=>p.setAttribute(k,v));
      const hit=p.cloneNode();hit.setAttribute('class','ed-hit');hit.setAttribute('stroke-width',Math.max(10,it.w+6));hit.setAttribute('stroke','transparent');
      el.svg.append(hit,p);
      if(isSel){const b=penBox(it),r=document.createElementNS('http://www.w3.org/2000/svg','rect');
        Object.entries({x:b.x-3,y:b.y-3,width:b.w+6,height:b.h+6,class:'ed-penbox'}).forEach(([k,v])=>r.setAttribute(k,v));el.svg.appendChild(r)}
      continue;
    }
    if(keepEdit&&E.editing&&E.editing.item.id===it.id){edStyleText(E.editing.node,it,P);continue}
    let n;
    if(it.type==='text'){n=h('div',{class:'ed-it ed-text'});n.textContent=it.text;edStyleText(n,it,P)}
    else if(it.type==='img'){n=h('div',{class:'ed-it ed-imgit'},h('img',{src:E.imgs.get(it.img).url,alt:'',draggable:'false'}))}
    else{n=h('div',{class:'ed-it ed-'+it.type});if(it.type==='hl')n.style.background=it.color}
    n.dataset.id=it.id;
    if(it.type!=='text')Object.assign(n.style,{width:pct(it.w,P.w),height:pct(it.h,P.h)});
    Object.assign(n.style,{left:pct(it.x,P.w),top:pct(it.y,P.h)});
    if(isSel){n.classList.add('sel');if(it.type!=='text')n.appendChild(h('span',{class:'ed-h',title:'Drag to resize'}))}
    el.ov.appendChild(n);
  }
}
function edStyleText(n,it,P){
  Object.assign(n.style,{left:(it.x/P.w*100)+'%',top:(it.y/P.h*100)+'%',color:it.color,fontFamily:FONTS[it.font].css,fontWeight:it.bold?'700':'400',fontSize:`calc(${it.size}px * var(--s))`});
}
const penBox=it=>{const xs=it.pts.map(p=>p[0]),ys=it.pts.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys);return {x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y}};
function edSelect(sel){
  const prev=E.sel;E.sel=sel;
  if(prev&&(!sel||prev.page!==sel.page))edItems(prev.page);
  if(sel)edItems(sel.page);
  const d=$('ed-del');if(d)d.disabled=!sel;
  if(sel){
    const it=sel.item;
    if(it.type==='text'){E.font=it.font;E.size=it.size;E.bold=it.bold;E.color=it.color;const f=$('ed-font'),s=$('ed-size');if(f)f.value=it.font;if(s)s.value=String(it.size);const b=$('ed-bold');if(b)b.setAttribute('aria-pressed',String(it.bold))}
    if(it.type==='pen'){E.color=it.color;E.pen=it.w}
    if(it.type==='hl')E.hcolor=it.color;
    ['color','hcolor'].forEach(k=>document.querySelectorAll(`.sw-grp[data-for="${k}"] .sw`).forEach(b=>b.setAttribute('aria-pressed',String(rgbToHex(b.style.background)===E[k]))));
  }
  edOpts();
}
function edDeleteSel(){
  const s=E.sel;if(!s)return;
  if(E.editing)E.editing=null;
  snap();s.page.items=s.page.items.filter(i=>i!==s.item);E.sel=null;edItems(s.page);
  const d=$('ed-del');if(d)d.disabled=true;edOpts();
}

// pointer position -> page points, undoing the page's turn on screen
function toPt(e,P){
  const el=E.els.get(P.id),r=el.inn.getBoundingClientRect();
  const dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2),a=-P.rot*Math.PI/180;
  return {x:(dx*Math.cos(a)-dy*Math.sin(a))/E.S+P.w/2,y:(dx*Math.sin(a)+dy*Math.cos(a))/E.S+P.h/2};
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let drag=null;
function edDown(e,P){
  if(e.button!==0||!P)return;
  E.cur=E.pages.indexOf(P);edMarkCur();
  const pt=toPt(e,P),target=e.target.closest('[data-id]'),item=target&&findItem(P,+target.dataset.id);
  if(E.editing&&target&&E.editing.node===target)return;
  edCommit();
  const ov=E.els.get(P.id).ov;
  const startDrag=d=>{drag={...d,P,start:pt,moved:false};ov.setPointerCapture(e.pointerId);e.preventDefault()};
  if(item&&e.target.classList.contains('ed-h')){startDrag({kind:'resize',item,orig:{...item}});return}
  if(item&&E.tool!=='pen'){
    if(E.tool==='text'&&item.type==='text'){edSelect({page:P,item});edEdit(P,item);e.preventDefault();return}
    edSelect({page:P,item});
    startDrag({kind:'move',item,orig:JSON.parse(JSON.stringify(item))});return;
  }
  if(E.sel)edSelect(null);
  if(E.tool==='text'){
    snap();
    const it={id:nid(),type:'text',x:pt.x,y:pt.y-E.size*0.6,text:'',size:E.size,color:E.color,font:E.font,bold:E.bold};
    P.items.push(it);edSelect({page:P,item:it});edEdit(P,it,true);e.preventDefault();return;
  }
  if(E.tool==='pen'){snap();const it={id:nid(),type:'pen',pts:[[pt.x,pt.y]],w:E.pen,color:E.color};P.items.push(it);startDrag({kind:'pen',item:it});edItems(P);return}
  if(E.tool==='hl'||E.tool==='wo'){snap();const it={id:nid(),type:E.tool,x:pt.x,y:pt.y,w:0,h:0,color:E.tool==='hl'?E.hcolor:'#ffffff'};P.items.push(it);startDrag({kind:'rect',item:it});edItems(P);return}
}
function edMoveDrag(e){
  if(!drag)return;
  const P=drag.P,pt=toPt(e,P),it=drag.item;
  const dx=pt.x-drag.start.x,dy=pt.y-drag.start.y;
  if(Math.abs(dx)+Math.abs(dy)>0.5)drag.moved=true;
  if(drag.kind==='pen'){const last=it.pts[it.pts.length-1];if(Math.hypot(pt.x-last[0],pt.y-last[1])>0.8)it.pts.push([clamp(pt.x,0,P.w),clamp(pt.y,0,P.h)])}
  else if(drag.kind==='rect'){const x0=drag.start.x,y0=drag.start.y,x1=clamp(pt.x,0,P.w),y1=clamp(pt.y,0,P.h);Object.assign(it,{x:Math.min(x0,x1),y:Math.min(y0,y1),w:Math.abs(x1-x0),h:Math.abs(y1-y0)})}
  else if(drag.kind==='move'){
    if(!drag.snapped&&drag.moved){snap();drag.snapped=true}
    const o=drag.orig;
    if(it.type==='pen')it.pts=o.pts.map(q=>[q[0]+dx,q[1]+dy]);else{it.x=o.x+dx;it.y=o.y+dy}
  }else if(drag.kind==='resize'){
    if(!drag.snapped&&drag.moved){snap();drag.snapped=true}
    const o=drag.orig;let w=Math.max(6,o.w+dx),ht=Math.max(6,o.h+dy);
    if(it.type==='img'){const k=Math.max(w/o.w,ht/o.h);w=o.w*k;ht=o.h*k}
    it.w=w;it.h=ht;
  }
  edItems(P);
}
function edUpDrag(){
  if(!drag)return;const d=drag;drag=null;const P=d.P,it=d.item;
  if(d.kind==='pen'){if(it.pts.length<2)it.pts.push([it.pts[0][0]+0.01,it.pts[0][1]])}
  if(d.kind==='rect'&&(it.w<3||it.h<3)){P.items=P.items.filter(i=>i!==it);E.undo.pop();edUndoBtn()}
  else if(d.kind==='rect'||d.kind==='pen')E.dirty=true;
  if(d.kind==='rect'&&P.items.includes(it))edSelect({page:P,item:it});else edItems(P);
}
document.addEventListener('pointermove',e=>{if(drag)edMoveDrag(e)});
document.addEventListener('pointerup',e=>{if(drag)edUpDrag(e)});
document.addEventListener('pointercancel',e=>{if(drag)edUpDrag(e)});

/* typing text on the page */
function edEdit(P,it,fresh){
  edItems(P);
  const n=E.els.get(P.id).ov.querySelector(`.ed-text[data-id="${it.id}"]`);if(!n)return;
  if(!fresh)snap();
  try{n.contentEditable='plaintext-only'}catch(e){}if(n.contentEditable!=='plaintext-only')n.contentEditable='true';
  n.classList.add('editing');n.spellcheck=true;
  E.editing={P,item:it,node:n,fresh};
  n.addEventListener('paste',e=>{e.preventDefault();const t=(e.clipboardData||window.clipboardData).getData('text/plain');document.execCommand('insertText',false,t)});
  n.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();edCommit()}e.stopPropagation()});
  n.addEventListener('blur',()=>setTimeout(()=>{if(E.editing&&E.editing.node===n)edCommit()},0));
  n.focus();
  const r=document.createRange();r.selectNodeContents(n);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);
}
function edCommit(){
  const ed=E.editing;if(!ed)return;E.editing=null;
  const text=ed.node.innerText.replace(/ /g,' ').replace(/\n$/,'');
  ed.item.text=text;
  if(!text.trim()){
    ed.P.items=ed.P.items.filter(i=>i!==ed.item);if(E.sel&&E.sel.item===ed.item)E.sel=null;const d=$('ed-del');if(d)d.disabled=!E.sel;
    if(ed.fresh){E.undo.pop();edUndoBtn()}
  }
  else E.dirty=true;
  edItems(ed.P);
}
async function edAddImage(f){
  if(!f)return;
  if(!isImageFile(f)){showMsg(isHeic(f)?'HEIC photos can\'t be read here. Export the photo as JPG first.':'Choose a JPG or PNG image.');return}
  try{
    const im=await readImage(f);E.imgs.set(im.id,im);
    const P=E.pages[E.cur];if(!P)return;
    const [dw,dh]=seenSize(im,0),w=Math.min(P.w*0.4,dw*0.75),ht=w*dh/dw;
    snap();
    const it={id:nid(),type:'img',img:im.id,x:(P.w-w)/2,y:Math.max(10,(P.h-ht)/2),w,h:ht};
    P.items.push(it);edTool('select');edSelect({page:P,item:it});
  }catch(e){console.error(e);showMsg('That image could not be read.')}
}
document.addEventListener('keydown',e=>{
  if(!active()||T.tool!=='edit'||!E.pages.length||E.editing)return;
  if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
  const mod=e.ctrlKey||e.metaKey;
  if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();undo();return}
  if((e.key==='Delete'||e.key==='Backspace')&&E.sel){e.preventDefault();edDeleteSel();return}
  if(e.key==='Escape'){if(E.sel)edSelect(null);else edTool('select');return}
  if(E.sel&&/^Arrow/.test(e.key)){
    e.preventDefault();const d=e.shiftKey?10:1,it=E.sel.item,[dx,dy]={ArrowLeft:[-d,0],ArrowRight:[d,0],ArrowUp:[0,-d],ArrowDown:[0,d]}[e.key];
    if(!e.repeat)snap();
    if(it.type==='pen')it.pts=it.pts.map(q=>[q[0]+dx,q[1]+dy]);else{it.x+=dx;it.y+=dy}
    edItems(E.sel.page);
  }
});

/* ---- writing the edited PDF ---- */
async function edBuild(){
  edCommit();
  const out=await L.PDFDocument.create(),fonts={},imgs=new Map();let pictures=false,badChars=0;
  const font=async(f,b)=>{const k=FONTS[f].std[b?1:0];return fonts[k]||(fonts[k]=await out.embedFont(L.StandardFonts[k]))};
  const image=async id=>{if(!imgs.has(id))imgs.set(id,await embedImage(out,E.imgs.get(id)));return imgs.get(id)};
  // copy each source's pages in one go, so shared fonts and images are written once
  const copied=new Map();
  for(const [si,src] of E.srcs.entries()){
    const idx=[...new Set(E.pages.filter(p=>p.kind==='pdf'&&p.src===si).map(p=>p.index))];if(!idx.length)continue;
    status('Reading '+src.name+'…');await tick();
    const lib=await loadLib(src);
    if(lib){const ps=await out.copyPages(lib,idx);idx.forEach((ix,k)=>copied.set(si+':'+ix,ps[k]))}
  }
  // the same page placed twice needs its own copy
  const used=new Set();
  for(const [n,P] of E.pages.entries()){
    status(`Writing page ${n+1} of ${E.pages.length}…`);if(n%10===0)await tick();
    let page,box,R;
    if(P.kind==='pdf'){
      const key=P.src+':'+P.index,src=E.srcs[P.src];
      if(copied.has(key)){
        if(used.has(key)){const [again]=await out.copyPages(src.lib,[P.index]);page=out.addPage(again)}
        else{page=out.addPage(copied.get(key));used.add(key)}
        box=page.getCropBox();R=norm(page.getRotation().angle);
      }else{
        pictures=true;const r=await pageAsImage(src.doc,P.index);page=out.addPage([r.w,r.h]);
        page.drawImage(await out.embedJpg(r.bytes),{x:0,y:0,width:r.w,height:r.h});box={x:0,y:0,width:r.w,height:r.h};R=0;
      }
    }else{
      page=out.addPage([P.w,P.h]);box={x:0,y:0,width:P.w,height:P.h};R=0;
      if(P.kind==='image'){const im=E.imgs.get(P.img);drawImageBox(page,await image(P.img),im.q,P.box,mapper(box,0),0)}
    }
    const Mp=mapper(box,R);
    for(const it of P.items){
      if(it.type==='hl'||it.type==='wo'){
        const [ax,ay]=Mp(it.x,it.y),[bx,by]=Mp(it.x+it.w,it.y+it.h);
        page.drawRectangle({x:Math.min(ax,bx),y:Math.min(ay,by),width:Math.abs(bx-ax),height:Math.abs(by-ay),color:rgbHex(it.color),
          ...(it.type==='hl'?{opacity:0.4,blendMode:L.BlendMode.Multiply}:{})});
      }else if(it.type==='pen'){
        const [ox,oy]=Mp(0,0);
        page.drawSvgPath(it.pts.map((q,i)=>(i?'L':'M')+q[0].toFixed(2)+' '+q[1].toFixed(2)).join(' '),{x:ox,y:oy,rotate:L.degrees(R),borderColor:rgbHex(it.color),borderWidth:it.w,borderLineCap:L.LineCapStyle.Round});
      }else if(it.type==='text'){
        const f=await font(it.font,it.bold),base=baselineRatio(it.font,it.bold)*it.size;
        it.text.split('\n').forEach((line,i)=>{
          const clean=[...line.replace(/\t/g,'    ').replace(/₹\s?/g,'Rs ')].map(ch=>{try{f.encodeText(ch);return ch}catch(e){badChars++;return '?'}}).join('');
          if(!clean.trim())return;
          const [x,y]=Mp(it.x,it.y+base+i*it.size*1.2);
          page.drawText(clean,{x,y,size:it.size,font:f,color:rgbHex(it.color),rotate:L.degrees(R)});
        });
      }else if(it.type==='img'){
        drawImageBox(page,await image(it.img),E.imgs.get(it.img).q,{left:it.x,top:it.y,w:it.w,h:it.h},Mp,R);
      }
    }
    page.setRotation(L.degrees(norm(R+P.rot)));
  }
  const first=E.srcs[0]&&E.srcs[0].lib;
  stamp(out,first&&first.getTitle());
  if(first){try{const a=first.getAuthor();if(a)out.setAuthor(a)}catch(e){}}
  status('Saving…');
  const notes=[];
  if(pictures)notes.push('Pages from a protected PDF were saved as pictures (their text can\'t be selected).');
  if(badChars)notes.push(`${plural(badChars,'character')} in your text (such as letters from other scripts) can't be written with the built-in fonts and became "?".`);
  return {bytes:await out.save(),note:notes.join(' ')};
}

/* ================= entry points ================= */
const entry=h('div',{class:'tools-entry',id:'toolsEntry'},
  h('h2',{text:'PDF tools'}),
  h('div',{class:'tcards'},
    h('button',{type:'button',class:'tcard',onclick:()=>open('merge')},h('b',{text:'Merge PDFs'}),h('span',{text:'Join several PDFs into one, in any order.'})),
    h('button',{type:'button',class:'tcard',onclick:()=>open('images')},h('b',{text:'Images to PDF'}),h('span',{text:'Turn JPG or PNG photos into one PDF.'})),
    h('button',{type:'button',class:'tcard',onclick:()=>open('edit')},h('b',{text:'Edit a PDF'}),h('span',{text:'Add text, draw, highlight, add a signature, rotate or remove pages.'}))));
const loadingEl=$('loading');if(loadingEl)loadingEl.before(entry);else startEl.querySelector('.gut').appendChild(entry);

// "Edit" next to the document name while reading
const editDoc=h('button',{type:'button',id:'editdoc',title:'Edit this PDF: add text, highlight, rotate or remove pages'},'✎ Edit');
editDoc.onclick=()=>{const c=window.plr&&window.plr.current&&window.plr.current();if(c)open('edit',{buf:c.buf,name:c.name})};
const now=$('now');if(now)now.before(editDoc);

if(NATIVE&&NATIVE.onCommand)NATIVE.onCommand(c=>{
  if(typeof c!=='string')return;
  if(c.startsWith('tool:')){
    const t=c.slice(5);
    if(t==='edit'&&!appEl.hidden){editDoc.click();return}
    open(t);
  }else if(c==='home'&&active())close();
});
const hashTool=/^#(merge|images|edit)$/.exec(location.hash);
if(hashTool){history.replaceState(null,'',location.pathname+location.search);open(hashTool[1])}

window.plrTools={open,close,leave,isOpen:active};
})();

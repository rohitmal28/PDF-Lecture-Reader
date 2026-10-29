(()=>{
'use strict';
const $=s=>document.querySelector(s);
const nf=new Intl.NumberFormat('en-IN');
const ddmmyyyy=iso=>{const [y,m,d]=String(iso).split('-');return d&&m&&y?`${d}/${m}/${y}`:iso};
const mb=b=>b?(b/1048576).toFixed(1)+' MB':'';
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---- headline: a reading highlight moves across the words, pausing like the app ---- */
const h=$('#headline');
if(h){
  const words=h.textContent.trim().split(/\s+/);
  h.textContent='';
  const spans=words.map((w,i)=>{const s=document.createElement('span');s.className='w';s.textContent=w;s.setAttribute('aria-hidden','true');h.append(s,i<words.length-1?' ':'');return s});
  if(reduced){spans[spans.length-1].classList.add('on')}
  else{
    let i=0;
    const step=()=>{
      spans.forEach(s=>s.classList.remove('on'));
      spans[i].classList.add('on');
      const w=words[i];
      let wait=300+w.length*28;
      if(/[,;:]$/.test(w))wait+=420;
      if(/[.!?]$/.test(w))wait+=1700;
      i=(i+1)%spans.length;
      setTimeout(step,wait);
    };
    setTimeout(step,500);
  }
}

/* ---- live numbers ---- */
let lastTotal=null;
function fill(stats){
  const r=stats.latest||{};
  document.querySelectorAll('[data-f="version"]').forEach(e=>e.textContent=r.version||'');
  document.querySelectorAll('[data-f="size"]').forEach(e=>e.textContent=mb(r.size)||e.textContent);
  document.querySelectorAll('[data-f="released"]').forEach(e=>e.textContent=ddmmyyyy(r.released));
  const sha=$('#sha');if(sha)sha.textContent=r.sha256||'Not available';
  const notes=$('#notes');if(notes&&r.notes&&r.notes.length){notes.textContent='';r.notes.forEach(n=>{const li=document.createElement('li');li.textContent=n;notes.appendChild(li)})}
  const c=$('#count');
  if(c){
    c.textContent=nf.format(stats.total);
    $('#countlabel').textContent=stats.total===0?'downloads so far. Be the first.':stats.total===1?'download so far':'downloads so far';
    if(lastTotal!==null&&stats.total>lastTotal&&!reduced){c.animate([{color:'var(--mark-word)'},{color:'inherit'}],{duration:1200})}
    lastTotal=stats.total;
  }
  if(r.available===false){document.querySelectorAll('#dlbtn,[data-dl]').forEach(b=>{b.setAttribute('aria-disabled','true');b.lastChild.textContent=' Download unavailable right now'})}
  if(document.body.dataset.page==='stats')drawStats(stats);
}
async function refresh(){
  try{const r=await fetch('/api/stats',{cache:'no-store'});if(r.ok)fill(await r.json())}catch(e){}
}
refresh();
setInterval(()=>{if(!document.hidden)refresh()},20000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});

/* ---- after clicking download: show next steps, refresh the counter ---- */
document.querySelectorAll('#dlbtn,[data-dl]').forEach(a=>a.addEventListener('click',()=>{
  const t=$('#thanks');if(t){t.hidden=false}
  if(a.dataset.dl!==undefined){const d=$('#download');if(d)d.scrollIntoView({behavior:reduced?'auto':'smooth',block:'center'})}
  [3000,8000,20000,45000].forEach(ms=>setTimeout(refresh,ms));
}));

/* ---- copy checksum ---- */
const cp=$('#copysha');
if(cp)cp.addEventListener('click',async()=>{
  const text=$('#sha').textContent;
  try{await navigator.clipboard.writeText(text);cp.textContent='Copied'}
  catch(e){const r=document.createRange();r.selectNodeContents($('#sha'));const s=getSelection();s.removeAllRanges();s.addRange(r);cp.textContent='Press Ctrl+C'}
  setTimeout(()=>cp.textContent='Copy',2000);
});

/* ---- stats page ---- */
function drawStats(s){
  $('#t-total').textContent=nf.format(s.total);
  $('#t-today').textContent=nf.format(s.today);
  const days=s.days||[];
  const last7=days.filter(d=>Date.parse(d.date)>=Date.now()-7*864e5).reduce((a,d)=>a+d.count,0);
  $('#t-week').textContent=nf.format(last7);
  // last 30 calendar days, India time, including days with no downloads
  const map=Object.fromEntries(days.map(d=>[d.date,d.count]));
  const now=new Date(Date.now()+330*60000);
  const series=[];
  for(let i=29;i>=0;i--){const d=new Date(now.getTime()-i*864e5).toISOString().slice(0,10);series.push({date:d,count:map[d]||0})}
  const W=720,H=220,L=36,R=8,T=12,B=28,max=Math.max(4,...series.map(d=>d.count));
  const nice=Math.ceil(max/4)*4,bw=(W-L-R)/series.length;
  const y=v=>T+(H-T-B)*(1-v/nice);
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Downloads per day for the last 30 days">`;
  for(let k=0;k<=4;k++){const v=nice*k/4;svg+=`<line class="grid" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L-6}" y="${y(v)+3}" text-anchor="end">${v}</text>`}
  series.forEach((d,i)=>{
    const x=L+i*bw+bw*0.15,h=(H-T-B)-(y(d.count)-T);
    if(d.count)svg+=`<rect class="bar${i===series.length-1?' today':''}" x="${x.toFixed(1)}" y="${y(d.count).toFixed(1)}" width="${(bw*0.7).toFixed(1)}" height="${Math.max(1,h).toFixed(1)}" rx="2"><title>${ddmmyyyy(d.date)}: ${d.count}</title></rect>`;
    if(i%5===4||i===series.length-1)svg+=`<text x="${(x+bw*0.35).toFixed(1)}" y="${H-10}" text-anchor="middle">${ddmmyyyy(d.date).slice(0,5)}</text>`;
  });
  svg+='</svg>';
  $('#chart').innerHTML=svg;
  const tb=$('#byversion');tb.textContent='';
  const vs=Object.entries(s.byVersion||{}).sort((a,b)=>b[0].localeCompare(a[0],undefined,{numeric:true}));
  if(!vs.length){tb.innerHTML='<tr><td colspan="2" class="empty">No downloads yet.</td></tr>'}
  vs.forEach(([v,n])=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${v.replace(/[^\d.]/g,'')}</td><td>${nf.format(n)}</td>`;tb.appendChild(tr)});
}
})();

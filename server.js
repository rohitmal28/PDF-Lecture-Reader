'use strict';
/*
  PDF Lecture Reader — download website
  Zero dependencies: needs only Node.js 18 or newer.

  Run:   node server.js
  Then:  http://localhost:8080

  Settings (environment variables):
    PORT        port to listen on            default 8080
    HOST        address to listen on         default 127.0.0.1 (this computer only)
                set HOST=0.0.0.0 when you publish it
    DATA_DIR    where the counter is saved   default ./data
*/
const http=require('http');
const fs=require('fs');
const fsp=fs.promises;
const path=require('path');
const crypto=require('crypto');

const ROOT=__dirname;
const PUBLIC=path.join(ROOT,'public');
const DOWNLOADS=path.join(ROOT,'downloads');
const DATA_DIR=path.resolve(process.env.DATA_DIR||path.join(ROOT,'data'));
const COUNTS=path.join(DATA_DIR,'downloads.json');
const RELEASES=path.join(ROOT,'releases.json');
const PORT=+process.env.PORT||8080;
const HOST=process.env.HOST||'127.0.0.1';
const TZ_OFFSET_MIN=+process.env.TZ_OFFSET_MIN||330; // India Standard Time, for the daily counts

/* ---------------- releases ---------------- */
let releases=[];
async function loadReleases(){
  const list=JSON.parse(await fsp.readFile(RELEASES,'utf8'));
  const out=[];
  for(const r of list){
    const candidates=[path.join(DOWNLOADS,r.file),path.join(ROOT,'..',r.file)];
    let found=null;
    for(const c of candidates){try{const st=await fsp.stat(c);if(st.isFile()){found={p:c,size:st.size,mtime:st.mtimeMs};break}}catch(e){}}
    if(!found){console.warn(`  ! Installer not found for ${r.version}: put ${r.file} in the downloads folder.`);out.push({...r,available:false});continue}
    const sha256=await hashFile(found.p);
    out.push({...r,available:true,path:found.p,size:found.size,sha256});
    console.log(`  • ${r.file}  ${(found.size/1048576).toFixed(1)} MB  sha256 ${sha256.slice(0,16)}…`);
  }
  releases=out;
}
function hashFile(p){return new Promise((res,rej)=>{const h=crypto.createHash('sha256');fs.createReadStream(p).on('data',d=>h.update(d)).on('end',()=>res(h.digest('hex'))).on('error',rej)})}
const latest=()=>releases.find(r=>r.available)||releases[0];
const publicRelease=r=>r&&({version:r.version,file:r.file,platform:r.platform,released:r.released,size:r.size||0,sha256:r.sha256||'',available:!!r.available,notes:r.notes||[]});

/* ---------------- download counter ---------------- */
let counts={total:0,byVersion:{},byDay:{}};
let saveTimer=null,saving=Promise.resolve();
function loadCounts(){
  try{const c=JSON.parse(fs.readFileSync(COUNTS,'utf8'));counts={total:+c.total||0,byVersion:c.byVersion||{},byDay:c.byDay||{}}}
  catch(e){if(e.code!=='ENOENT')console.warn('  ! Could not read the counter file, starting from its backup or 0:',e.message);
    try{const c=JSON.parse(fs.readFileSync(COUNTS+'.bak','utf8'));counts={total:+c.total||0,byVersion:c.byVersion||{},byDay:c.byDay||{}}}catch(e2){}}
}
function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{saving=saving.then(writeCounts).catch(e=>console.error('  ! Could not save the counter:',e.message))},300);
}
async function writeCounts(){
  await fsp.mkdir(DATA_DIR,{recursive:true});
  const tmp=COUNTS+'.tmp',body=JSON.stringify(counts,null,2);
  await fsp.writeFile(tmp,body);
  try{await fsp.copyFile(COUNTS,COUNTS+'.bak')}catch(e){}
  await fsp.rename(tmp,COUNTS);
}
function dayKey(d=new Date()){const t=new Date(d.getTime()+TZ_OFFSET_MIN*60000);return t.toISOString().slice(0,10)}
const recent=new Map(); // ip|version -> time, so a double click counts once
function countDownload(ip,version){
  const k=ip+'|'+version,now=Date.now();
  if(recent.has(k)&&now-recent.get(k)<15000)return false;
  recent.set(k,now);
  if(recent.size>5000)for(const [kk,t] of recent)if(now-t>15000)recent.delete(kk);
  counts.total++;
  counts.byVersion[version]=(counts.byVersion[version]||0)+1;
  const d=dayKey();counts.byDay[d]=(counts.byDay[d]||0)+1;
  scheduleSave();
  return true;
}

/* ---------------- http helpers ---------------- */
const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8',
  '.txt':'text/plain; charset=utf-8','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon','.svg':'image/svg+xml','.woff2':'font/woff2','.pdf':'application/pdf'};
const SECURITY={
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
};
function send(res,status,body,headers={}){
  res.writeHead(status,{...SECURITY,...headers});res.end(body);
}
function json(res,obj,status=200){send(res,status,JSON.stringify(obj),{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'})}
function clientIp(req){
  const xf=req.headers['x-forwarded-for'];
  return (process.env.TRUST_PROXY&&xf?String(xf).split(',')[0].trim():req.socket.remoteAddress)||'?';
}
async function serveStatic(req,res,urlPath){
  let rel=decodeURIComponent(urlPath);
  if(rel.endsWith('/'))rel+='index.html';
  if(!path.extname(rel))rel+='.html';
  const file=path.normalize(path.join(PUBLIC,rel));
  if(!file.startsWith(PUBLIC+path.sep))return notFound(req,res);
  let st;try{st=await fsp.stat(file)}catch(e){return notFound(req,res)}
  if(!st.isFile())return notFound(req,res);
  const ext=path.extname(file).toLowerCase();
  const etag=`"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const cache=ext==='.html'?'no-cache':/\.(woff2|png|webp|ico)$/.test(ext)?'public, max-age=604800':'public, max-age=3600';
  if(req.headers['if-none-match']===etag)return send(res,304,null,{ETag:etag,'Cache-Control':cache});
  res.writeHead(200,{...SECURITY,'Content-Type':TYPES[ext]||'application/octet-stream','Content-Length':st.size,ETag:etag,'Cache-Control':cache});
  if(req.method==='HEAD')return res.end();
  fs.createReadStream(file).pipe(res);
}
async function notFound(req,res){
  try{const body=await fsp.readFile(path.join(PUBLIC,'404.html'));send(res,404,req.method==='HEAD'?null:body,{'Content-Type':'text/html; charset=utf-8'})}
  catch(e){send(res,404,'Not found',{'Content-Type':'text/plain; charset=utf-8'})}
}

/* ---------------- the download itself ---------------- */
function serveInstaller(req,res,rel){
  if(!rel||!rel.available)return send(res,503,'This download is not available right now. Please try again later.',{'Content-Type':'text/plain; charset=utf-8','Retry-After':'3600'});
  const size=rel.size;
  const base={...SECURITY,'Content-Type':'application/vnd.microsoft.portable-executable','Content-Disposition':`attachment; filename="${rel.file}"`,
    'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Checksum-SHA256':rel.sha256,ETag:`"${rel.sha256.slice(0,32)}"`};
  const range=req.headers.range;
  if(range){
    // resumed or segmented downloads: serve the part, but do not count it again
    const m=/^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start=m&&m[1]!==''?+m[1]:NaN,end=m&&m[2]!==''?+m[2]:size-1;
    if(m&&m[1]===''&&m[2]!==''){start=size-+m[2];end=size-1}
    if(!m||isNaN(start)||start<0||start>end||start>=size){res.writeHead(416,{...base,'Content-Range':`bytes */${size}`});return res.end()}
    end=Math.min(end,size-1);
    res.writeHead(206,{...base,'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});
    if(req.method==='HEAD')return res.end();
    return fs.createReadStream(rel.path,{start,end}).pipe(res);
  }
  res.writeHead(200,{...base,'Content-Length':size});
  if(req.method==='HEAD')return res.end();
  const ip=clientIp(req);
  // count when the whole file has been handed over, so cancelled downloads are not counted
  res.on('finish',()=>{if(countDownload(ip,rel.version))console.log(`  ↓ ${rel.file}  total ${counts.total}`)});
  fs.createReadStream(rel.path).on('error',()=>res.destroy()).pipe(res);
}

/* ---------------- routes ---------------- */
const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://x');const p=u.pathname;
    if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,'Method not allowed',{Allow:'GET, HEAD','Content-Type':'text/plain'});
    if(p==='/download'||p==='/download/windows'||p==='/download/latest')return serveInstaller(req,res,latest());
    const dv=/^\/download\/v?(\d+\.\d+\.\d+)$/.exec(p);
    if(dv){const rel=releases.find(r=>r.version===dv[1]);return rel?serveInstaller(req,res,rel):notFound(req,res)}
    if(p==='/api/stats'){
      const days=Object.keys(counts.byDay).sort().slice(-60).map(d=>({date:d,count:counts.byDay[d]}));
      return json(res,{total:counts.total,today:counts.byDay[dayKey()]||0,byVersion:counts.byVersion,days,latest:publicRelease(latest())});
    }
    if(p==='/api/releases')return json(res,releases.map(publicRelease));
    if(p==='/healthz')return json(res,{ok:true});
    return serveStatic(req,res,p);
  }catch(e){
    console.error(e);if(!res.headersSent)send(res,500,'Something went wrong on the server.',{'Content-Type':'text/plain'});else res.destroy();
  }
});

(async()=>{
  console.log('\nPDF Lecture Reader website');
  loadCounts();
  await loadReleases();
  server.listen(PORT,HOST,()=>{
    const shown=HOST==='0.0.0.0'||HOST==='::'?'localhost':HOST;
    console.log(`\n  Running at  http://${shown==='127.0.0.1'?'localhost':shown}:${PORT}`);
    console.log(`  Downloads so far: ${counts.total}`);
    console.log('  Press Ctrl+C to stop.\n');
  });
})().catch(e=>{console.error('Could not start the website:',e.message);process.exit(1)});

const shutdown=()=>{clearTimeout(saveTimer);try{fs.mkdirSync(DATA_DIR,{recursive:true});fs.writeFileSync(COUNTS,JSON.stringify(counts,null,2))}catch(e){}process.exit(0)};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);

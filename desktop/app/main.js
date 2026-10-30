'use strict';
/* PDF Lecture Reader — desktop shell (Windows and macOS) */
const {app,BrowserWindow,Menu,dialog,ipcMain,shell,nativeTheme}=require('electron');
const path=require('path');
const fs=require('fs');

const isMac=process.platform==='darwin';
if(!app.requestSingleInstanceLock()){app.quit();process.exit(0)}

let win=null,rendererReady=false,pending=null;
const statePath=()=>path.join(app.getPath('userData'),'window-state.json');
const resourceFile=name=>app.isPackaged?path.join(process.resourcesPath,name):path.join(__dirname,'..','build',name);
// "&" marks Alt-key mnemonics on Windows; macOS menus have none
const L=s=>isMac?s.replace(/&(?!&)/g,''):s;

function pdfFromArgs(argv){
  const args=argv.slice(app.isPackaged?1:2);
  return args.find(a=>/\.pdf$/i.test(a)&&!a.startsWith('--')&&fs.existsSync(a));
}
function readPdf(p){
  const data=fs.readFileSync(p);
  return {name:path.basename(p),path:p,data};
}
function sendFile(p){
  try{
    const msg=readPdf(p);
    if(win&&rendererReady)win.webContents.send('open-file',msg);else pending=msg;
    if(win){if(win.isMinimized())win.restore();win.focus()}
    app.addRecentDocument(p);
  }catch(e){dialog.showErrorBox('Could not open the PDF',`${p}\n\n${e.message}`)}
}
async function pickFile(){
  const r=await dialog.showOpenDialog(win,{title:'Open a PDF',filters:[{name:'PDF documents',extensions:['pdf']}],properties:['openFile']});
  if(r.canceled||!r.filePaths.length)return null;
  try{app.addRecentDocument(r.filePaths[0]);return readPdf(r.filePaths[0])}
  catch(e){dialog.showErrorBox('Could not open the PDF',e.message);return null}
}
const cmd=c=>{if(win)win.webContents.send('command',c)};

function loadState(){try{return JSON.parse(fs.readFileSync(statePath(),'utf8'))}catch(e){return {}}}
function saveState(){
  if(!win)return;
  try{const b=win.getNormalBounds();fs.writeFileSync(statePath(),JSON.stringify({...b,maximized:win.isMaximized()}))}catch(e){}
}

function createWindow(){
  const st=loadState();
  win=new BrowserWindow({
    width:st.width||1400,height:st.height||900,x:st.x,y:st.y,minWidth:760,minHeight:520,
    title:'PDF Lecture Reader',icon:path.join(__dirname,'icon.png'),
    backgroundColor:nativeTheme.shouldUseDarkColors?'#14181d':'#eef0f2',show:false,
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false,autoplayPolicy:'no-user-gesture-required'}
  });
  if(st.maximized)win.maximize();
  win.once('ready-to-show',()=>win.show());
  win.on('close',saveState);
  win.on('closed',()=>{win=null;rendererReady=false});
  // keep the app self-contained: no navigation away, links open in the default browser
  win.webContents.on('will-navigate',(e,url)=>{e.preventDefault();if(/^https?:/i.test(url))shell.openExternal(url)});
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/i.test(url))shell.openExternal(url);return {action:'deny'}});
  win.webContents.on('render-process-gone',()=>{rendererReady=false});
  win.loadFile(path.join(__dirname,'index.html'));
}

function showAbout(){
  dialog.showMessageBox(win,{
    type:'info',title:'About PDF Lecture Reader',message:'PDF Lecture Reader',
    detail:`Version ${app.getVersion()}\n© 2026 Rohit Mal. All rights reserved.\n\nReads any PDF aloud like a teacher, with pauses between ideas, and highlights each word on the page as it is spoken. Everything runs on this computer; no documents are uploaded.\n\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome} · PDF.js 3.11.174`,
    buttons:['OK','License agreement','Third-party notices'],defaultId:0,cancelId:0,noLink:true
  }).then(r=>{if(r.response===1)shell.openPath(resourceFile('LICENSE.txt'));if(r.response===2)shell.openPath(resourceFile('THIRD-PARTY-NOTICES.txt'))});
}
function showShortcuts(){
  const lines=isMac
    ?['⌘O\tOpen a PDF','Space\tPlay or pause','→ / ←\tNext or previous sentence','⌘→ / ⌘←\tNext or previous section','⌘= / ⌘-\tZoom the PDF in or out','⌘0\tPDF at 100%','⌘W\tClose the document','⌃⌘F\tFull screen']
    :['Ctrl+O\tOpen a PDF','Space\tPlay or pause','→ / ←\tNext or previous sentence','Ctrl+→ / Ctrl+←\tNext or previous section','Ctrl+= / Ctrl+-\tZoom the PDF in or out','Ctrl+0\tPDF at 100%','Ctrl+W\tClose the document','F11\tFull screen'];
  dialog.showMessageBox(win,{type:'none',title:'Keyboard shortcuts',message:'Keyboard shortcuts',noLink:true,buttons:['OK'],
    detail:[...lines,'','Click any word on the PDF, or any sentence in the transcript, to read from there.'].join('\n')});
}

function buildMenu(){
  const t=[
    {label:'&File',submenu:[
      {label:'&Open PDF…',accelerator:'CmdOrCtrl+O',click:async()=>{const f=await pickFile();if(!f)return;if(win&&rendererReady)win.webContents.send('open-file',f);else{pending=f;if(!win)createWindow()}}},
      ...(isMac?[{role:'recentDocuments',submenu:[{role:'clearRecentDocuments'}]}]:[]),
      {label:'&Close document',accelerator:'CmdOrCtrl+W',click:()=>{if(win)cmd('home')}},
      ...(isMac?[]:[{type:'separator'},{label:'E&xit',accelerator:'Alt+F4',role:'quit'}])
    ]},
    ...(isMac?[{role:'editMenu'}]:[]),
    {label:'&Playback',submenu:[
      {label:'&Play / Pause',click:()=>cmd('play')},
      {label:'&Next sentence',click:()=>cmd('next')},
      {label:'P&revious sentence',click:()=>cmd('prev')},
      {type:'separator'},
      {label:'Next &section',accelerator:'CmdOrCtrl+Right',click:()=>cmd('nextsec')},
      {label:'Previous s&ection',accelerator:'CmdOrCtrl+Left',click:()=>cmd('prevsec')}
    ]},
    {label:'&View',submenu:[
      {label:'Zoom PDF &in',accelerator:'CmdOrCtrl+=',click:()=>cmd('zin')},
      {label:'Zoom PDF &out',accelerator:'CmdOrCtrl+-',click:()=>cmd('zout')},
      {label:'PDF at &100%',accelerator:'CmdOrCtrl+0',click:()=>cmd('z100')},
      {type:'separator'},
      {label:'Make text &larger',accelerator:'CmdOrCtrl+Shift+=',click:()=>{const w=win&&win.webContents;if(w)w.setZoomFactor(Math.min(2,w.getZoomFactor()+0.1))}},
      {label:'Make text &smaller',accelerator:'CmdOrCtrl+Shift+-',click:()=>{const w=win&&win.webContents;if(w)w.setZoomFactor(Math.max(0.7,w.getZoomFactor()-0.1))}},
      {label:'&Reset text size',click:()=>{if(win)win.webContents.setZoomFactor(1)}},
      {type:'separator'},
      {label:'&Full screen',role:'togglefullscreen'}
    ]},
    ...(isMac?[{role:'windowMenu'}]:[]),
    {label:'&Help',...(isMac?{role:'help'}:{}),submenu:[
      {label:'&Keyboard shortcuts',click:showShortcuts},
      {label:'&License agreement',click:()=>shell.openPath(resourceFile('LICENSE.txt'))},
      {label:'&Third-party notices',click:()=>shell.openPath(resourceFile('THIRD-PARTY-NOTICES.txt'))},
      ...(isMac?[]:[{type:'separator'},{label:'&About PDF Lecture Reader',click:showAbout}])
    ]}
  ];
  if(isMac)t.unshift({label:app.name,submenu:[
    {label:'About PDF Lecture Reader',click:showAbout},
    {type:'separator'},{role:'services'},{type:'separator'},
    {role:'hide'},{role:'hideOthers'},{role:'unhide'},
    {type:'separator'},{role:'quit'}
  ]});
  if(!app.isPackaged)t.push({label:'&Developer',submenu:[{role:'reload'},{role:'toggleDevTools'}]});
  const strip=items=>items.map(i=>({...i,...(i.label?{label:L(i.label)}:{}),...(Array.isArray(i.submenu)?{submenu:strip(i.submenu)}:{})}));
  Menu.setApplicationMenu(Menu.buildFromTemplate(strip(t)));
}

ipcMain.handle('pick-file',()=>pickFile());
ipcMain.on('renderer-ready',()=>{rendererReady=true;if(pending&&win){win.webContents.send('open-file',pending);pending=null}});
ipcMain.on('open-path',(e,p)=>{if(typeof p==='string'&&/\.pdf$/i.test(p))sendFile(p)});

// macOS hands files over with this event (Finder "Open With", dropping on the Dock icon), sometimes before the app is ready
app.on('open-file',(e,p)=>{e.preventDefault();if(app.isReady()&&!win)createWindow();sendFile(p)});
app.on('second-instance',(e,argv)=>{const p=pdfFromArgs(argv);if(p)sendFile(p);else if(win){if(win.isMinimized())win.restore();win.focus()}});
app.whenReady().then(()=>{
  buildMenu();if(!win)createWindow();
  const p=pdfFromArgs(process.argv);if(p)sendFile(p);
});
// macOS apps stay in the Dock after the last window closes; clicking the Dock icon opens a new one
app.on('activate',()=>{if(app.isReady()&&!win)createWindow()});
app.on('window-all-closed',()=>{if(!isMac)app.quit()});

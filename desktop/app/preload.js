'use strict';
const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('native',{
  desktop:true,
  platform:process.platform,
  pickFile:()=>ipcRenderer.invoke('pick-file'),
  onOpenFile:cb=>ipcRenderer.on('open-file',(e,f)=>cb(f)),
  onCommand:cb=>ipcRenderer.on('command',(e,c)=>cb(c)),
  pathForFile:f=>{try{return webUtils.getPathForFile(f)}catch(e){return ''}},
  ready:()=>ipcRenderer.send('renderer-ready')
});

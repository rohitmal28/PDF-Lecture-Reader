'use strict';
/*
  Ad-hoc signs the Mac app after it is packed. Apple Silicon Macs refuse to run
  apps with no signature at all ("is damaged and can't be opened"); an ad-hoc
  signature lets them open it with the usual "Open Anyway" step.
  Replace with a Developer ID identity + notarization once there is an Apple
  Developer account.
*/
const {execFileSync}=require('child_process');
const path=require('path');

exports.default=async function(ctx){
  if(ctx.electronPlatformName!=='darwin')return;
  const app=path.join(ctx.appOutDir,`${ctx.packager.appInfo.productFilename}.app`);
  execFileSync('codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});
  execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
};

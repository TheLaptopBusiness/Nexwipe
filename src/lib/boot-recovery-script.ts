// Inline script that runs before the app's code. If the app's own code files fail to load during
// start-up (typically: the tab still points at files from a previous version), React never mounts and
// no error screen can render — the page would stay blank. This script applies the same rules as
// src/lib/app-recovery.ts (keep RETRY_KEY / window in sync): reload once per 5 minutes per tab, guard
// stored before reloading; if the guard is already used, show a plain fallback with a manual reload.
// It never reloads after the app has mounted (the in-app error screen handles those cases).
export const BOOT_RECOVERY_SCRIPT = `(function(){
var KEY='nd.staleCodeReloadAt',DKEY='nd.lastErrorDiagnostics',WIN=300000;
var RE=/Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload CSS/i;
function red(s){return String(s||'').replace(/eyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}/g,'[redacted-jwt]').replace(/\\b(ndagt|ndenr)_[A-Za-z0-9]{8,}/g,'$1_[redacted]').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g,'[redacted-email]').replace(/([?&](?:access_token|refresh_token|token|code|apikey)=)[^&\\s]+/gi,'$1[redacted]').slice(0,400);}
function done(){return !!window.__ndAppMounted;}
function fallback(msg){
  var id=Math.random().toString(36).slice(2,10).toUpperCase(),now=new Date().toISOString();
  try{sessionStorage.setItem(DKEY,JSON.stringify({id:id,at:now,kind:'outdated_code',name:'BootLoadError',message:red(msg),path:location.pathname}));}catch(e){}
  try{console.error('[NextDrive] outdated_code '+id+': '+red(msg));}catch(e){}
  var show=function(){
    if(done()||document.getElementById('nd-boot-fallback'))return;
    var d=document.createElement('div');d.id='nd-boot-fallback';d.setAttribute('role','alert');
    d.style.cssText='position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--background,#f8fafc);color:var(--foreground,#0f172a);font:14px/1.5 system-ui,sans-serif;text-align:center';
    d.innerHTML='<div style="max-width:30rem"><h1 style="font-size:20px;font-weight:600;margin:0 0 8px">This page didn\\'t load</h1><p style="margin:0 0 16px;opacity:.75">The app was updated while this page was open and the new version could not be loaded automatically. Check your connection, then reload the page.</p><button id="nd-boot-reload" style="padding:8px 16px;border-radius:6px;border:0;background:var(--primary,#0f172a);color:var(--primary-foreground,#fff);font-weight:500;cursor:pointer">Reload page</button> <a href="/" style="margin-left:8px;padding:8px 16px;border:1px solid #cbd5e1;border-radius:6px;color:inherit;text-decoration:none">Go home</a><p style="margin-top:16px;font:12px ui-monospace,monospace;opacity:.6">Reference '+id+' · '+now+'</p></div>';
    (document.body||document.documentElement).appendChild(d);
    document.getElementById('nd-boot-reload').onclick=function(){try{sessionStorage.setItem(KEY,String(Date.now()));}catch(e){}location.reload();};
  };
  if(document.body)show();else document.addEventListener('DOMContentLoaded',show);
}
function handle(msg){
  if(done()||!RE.test(String(msg||'')))return false;
  var last=0;try{last=Number(sessionStorage.getItem(KEY)||0)||0;}catch(e){last=-1;}
  if(last===-1||(last&&Date.now()-last<WIN)){fallback(msg);return true;}
  try{sessionStorage.setItem(KEY,String(Date.now()));}catch(e){fallback(msg);return true;}
  location.reload();return true;
}
window.addEventListener('unhandledrejection',function(e){var r=e&&e.reason;handle(r&&r.message?r.message:r);},true);
window.addEventListener('error',function(e){
  var t=e&&e.target;
  if(t&&t.tagName==='SCRIPT'&&t.type==='module'&&!done()){handle('Importing a module script failed: '+(t.src||'inline'));return;}
  if(e&&e.message)handle(e.message);
},true);
})();`;

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { loadAppSandbox } = require('./app-sandbox.cjs');

const employee = { id:'ryan',naam:'Ryan',rol:'Grader',passwordHash:'server-managed',laptopAccess:'grade',monitorAccess:'grade',mustChangePassword:false };

test('compact toolbar groups preferences in one native disclosure and keeps operational actions outside', () => {
  const app=loadAppSandbox();
  vm.runInContext("STATE.currentUser=USERS[0];STATE.currentScreen='home';",app);
  const html=app.renderTopbar();
  const start=html.indexOf('<details class="topbar-settings"');const end=html.indexOf('</details>',start);
  assert.ok(start>=0 && end>start);const settings=html.slice(start,end);
  for(const action of ['toggle_language','toggle_theme','toggle_contrast','toggle_fullscreen'])assert.ok(settings.includes(`data-action="${action}"`),action);
  for(const action of ['refresh_page','logout'])assert.ok(html.indexOf(`data-action="${action}"`)>end,action);
  assert.equal((html.match(/data-action="toggle_fullscreen"/g)||[]).length,1);
  assert.match(settings,/<summary[^>]*aria-controls="topbar-settings-panel"/);
  assert.doesNotMatch(settings,/role="menu"/,'Form controls use native disclosure and group semantics, not an incomplete ARIA menu');
  vm.runInContext("STATE.language='nl';",app);
  assert.equal(app.translateCopy('Settings'),'Instellingen');assert.equal(app.translateCopy('Language'),'Taal');
});

test('outside click and Escape close only settings, retain work and return keyboard focus', () => {
  const app=loadAppSandbox();const handlers={};let focus=0;
  const inside={};const panel={open:true,contains:target=>target===inside,querySelector:()=>({focus(){focus++;}})};
  app.window.addEventListener=()=>{};app.document.addEventListener=(name,callback)=>{handlers[name]=callback;};
  app.document.getElementById=id=>id==='topbar-settings'?panel:null;
  // The app sandbox does not install listeners when window.addEventListener is
  // absent, so install the actual display handlers now against these DOM nodes.
  vm.runInContext("workspaceDisplayInstalled=false;STATE.currentGrading={keuzes:{bovenkap:'B'}};",app);
  app.installWorkspaceDisplay();
  const before=vm.runInContext('JSON.stringify(STATE.currentGrading)',app);
  handlers.pointerdown({target:inside});assert.equal(panel.open,true);
  handlers.pointerdown({target:{}});assert.equal(panel.open,false);assert.equal(focus,0);
  panel.open=true;let prevented=0,stopped=0;
  handlers.keydown({key:'Escape',preventDefault(){prevented++;},stopPropagation(){stopped++;}});
  assert.equal(panel.open,false);assert.equal(focus,1);assert.equal(prevented,1);assert.equal(stopped,1);
  assert.equal(vm.runInContext('JSON.stringify(STATE.currentGrading)',app),before);
});

test('settings disclosure stays open across preference renders but not across page/account navigation', () => {
  const app=loadAppSandbox();
  vm.runInContext("STATE.currentUser=USERS[0];STATE.currentScreen='home';STATE.homeTab='workflow';",app);
  const context=vm.runInContext("JSON.stringify([STATE.currentUser.id,STATE.currentScreen])",app);
  const previous={open:true,dataset:{context},contains:()=>false};const next={open:false,querySelectorAll:()=>[]};
  let old=true;const element=app.__appElement;
  Object.defineProperty(element,'innerHTML',{set(value){this.html=value;old=false;},get(){return this.html||'';},configurable:true});
  app.document.getElementById=id=>id==='app'?element:id==='topbar-settings'?(old?previous:next):null;
  app.render();assert.equal(next.open,true);
  old=true;next.open=false;vm.runInContext("STATE.currentScreen='explain';",app);app.render();assert.equal(next.open,false);
});

function bootStubs(app) {
  vm.runInContext('loadMonitorPortDatabase=async()=>true;window.__workLoads=0;loadSharedDemoState=async()=>{window.__workLoads++;return true;};', app);
}

test('F5 restores a valid server session even without any cached account or matching saved user ID', async () => {
  for (const saved of [undefined, 'missing-local-id']) {
    const app=loadAppSandbox({sessionStorage:{remarktServerSessionV1:'synthetic-valid-token',...(saved?{remarktSessionUserV1:saved}:{})}});
    bootStubs(app); const calls=[];
    app.fetch=async(url,options)=>{
      calls.push(url);assert.equal(url,'/api/session');assert.equal(options.headers.Authorization,'Bearer synthetic-valid-token');
      assert.equal(options.method,undefined);assert.equal(options.body,undefined);
      return new Response(JSON.stringify({user:employee,workspaceId:'refresh-qa'}));
    };
    await app.initApp();
    assert.equal(vm.runInContext('STATE.currentUser.id',app),'ryan');
    assert.equal(vm.runInContext('STATE.currentScreen',app),'home');
    assert.equal(app.liveSessionToken(),'synthetic-valid-token');
    assert.equal(app.sessionStorage.getItem('remarktSessionUserV1'),'ryan');
    assert.equal(app.localStorage.getItem('remarktServerSessionV1'),null);
    assert.equal(vm.runInContext('window.__workLoads',app),1);assert.deepEqual(calls,['/api/session']);
  }
});

test('F5 never restores expired/revoked credentials and still enforces first-login password change', async () => {
  const invalid=loadAppSandbox({sessionStorage:{remarktServerSessionV1:'revoked',remarktSessionUserV1:'tim',remarktOfflineTabSessionV1:'old'}});
  bootStubs(invalid);
  invalid.fetch=async()=>new Response(JSON.stringify({code:'AUTH_REQUIRED'}),{status:401});
  await invalid.initApp();
  assert.equal(vm.runInContext('STATE.currentUser',invalid),null);
  assert.equal(vm.runInContext('STATE.currentScreen',invalid),'login');
  assert.equal(invalid.liveSessionToken(),'');
  assert.equal(invalid.sessionStorage.getItem('remarktOfflineTabSessionV1'),null);
  assert.equal(vm.runInContext('window.__workLoads',invalid),0);
  const temporary=loadAppSandbox({sessionStorage:{remarktServerSessionV1:'temporary'}});bootStubs(temporary);
  temporary.fetch=async()=>new Response(JSON.stringify({user:{...employee,mustChangePassword:true},workspaceId:'refresh-qa'}));
  await temporary.initApp();
  assert.equal(vm.runInContext('STATE.currentScreen',temporary),'password_change');
  assert.equal(vm.runInContext('window.__workLoads',temporary),0);
});

test('reset-login explicitly removes server and offline tab sessions', () => {
  const app=loadAppSandbox({search:'?resetLogin=1',sessionStorage:{remarktServerSessionV1:'old',remarktOfflineTabSessionV1:'old',remarktSessionUserV1:'tim'}});
  assert.equal(app.liveSessionToken(),'');assert.equal(app.sessionStorage.getItem('remarktOfflineTabSessionV1'),null);
  assert.equal(vm.runInContext('STATE.currentUser',app),null);
});

test('a verified session never exposes example inventory when the work snapshot is corrupt', async () => {
  const app=loadAppSandbox({sessionStorage:{remarktServerSessionV1:'synthetic-valid-token'}});bootStubs(app);
  app.fetch=async()=>new Response(JSON.stringify({user:employee,workspaceId:'refresh-qa'}));
  vm.runInContext("loadSharedDemoState=async()=>{STATE.sharedStorageError='STORAGE_CORRUPT';return false;};",app);
  await app.initApp();
  assert.equal(vm.runInContext('STATE.currentScreen',app),'login');
  assert.equal(vm.runInContext('STATE.loginLoadPending',app),true);
  assert.equal(vm.runInContext('STATE.currentUser.id',app),'ryan');
  assert.equal(app.liveSessionToken(),'synthetic-valid-token');
  assert.doesNotMatch(app.__appElement.innerHTML,/Grade Device from list|Scan &amp; Print/);
});

test('a verified offline login survives F5 only in the same tab and within its original limited lease', async () => {
  const first=loadAppSandbox({gzip:true});first.window.crypto=webcrypto;first.employee=employee;
  vm.runInContext("STATE.sharedWorkspaceId='refresh-qa';STATE.serverAuth=true;STATE.storageFormat=3;STATE.sharedStorageError='STORAGE_UNAVAILABLE';USERS.splice(0,USERS.length,normalizeStoredUser(employee));saveUsers();",first);
  await first.rememberOfflineLogin(vm.runInContext('USERS[0]',first),'SyntheticOfflinePassword123!','refresh-qa');
  assert.equal(await first.tryOfflineLogin('ryan','SyntheticOfflinePassword123!'),true);
  const lease=first.sessionStorage.getItem('remarktOfflineTabSessionV1');
  const localStorage={remarktDemoUsersV2:first.localStorage.getItem('remarktDemoUsersV2'),remarktOfflineLoginV1:first.localStorage.getItem('remarktOfflineLoginV1'),remarktDemoStateBackupV1:first.localStorage.getItem('remarktDemoStateBackupV1')};
  const next=loadAppSandbox({gzip:true,localStorage,sessionStorage:{remarktSessionUserV1:'ryan',remarktOfflineTabSessionV1:lease}});
  vm.runInContext('loadMonitorPortDatabase=async()=>true;',next);
  next.fetch=async()=>new Response(JSON.stringify({code:'STORAGE_UNAVAILABLE'}),{status:503});
  await next.initApp();
  assert.equal(vm.runInContext('STATE.currentUser.id',next),'ryan');assert.equal(next.canWorkLocally(),true);
  assert.equal(next.sessionStorage.getItem('remarktOfflineTabSessionV1'),lease,'F5 does not extend offline authorization');
  const bad=JSON.parse(lease);bad.expiresAt=Date.now()-1;
  next.sessionStorage.setItem('remarktOfflineTabSessionV1',JSON.stringify(bad));
  assert.equal(await next.restoreOfflineTabSession(),false);
  bad.expiresAt=Date.now()+1000;bad.proof='different-credential-revision';
  next.sessionStorage.setItem('remarktOfflineTabSessionV1',JSON.stringify(bad));
  assert.equal(await next.restoreOfflineTabSession(),false);
  next.clearSessionUser();assert.equal(next.sessionStorage.getItem('remarktOfflineTabSessionV1'),null);
  const otherTab=loadAppSandbox({gzip:true,localStorage});
  vm.runInContext("STATE.sharedStorageError='STORAGE_UNAVAILABLE';",otherTab);
  assert.equal(await otherTab.restoreOfflineTabSession(),false);
});

test('refresh button coalesces requests, preserves grading and does not reload or log out', async () => {
  const app=loadAppSandbox();let release;const pending=new Promise(resolve=>{release=resolve;});app.pending=pending;
  vm.runInContext(`STATE.currentUser=USERS[0];STATE.currentScreen='grading_expert';STATE.currentLaptop=getLaptopBySticker('8460024');
    STATE.currentGrading={keuzes:{bovenkap:'B'},modus:'expert'};window.__renders=0;window.__reads=0;
    render=()=>window.__renders++;syncSharedStateIfChanged=async()=>{window.__reads++;await pending;return false;};`,app);
  const before=vm.runInContext('JSON.stringify(STATE.currentGrading)',app);
  assert.match(app.renderTopbar(),/data-action="refresh_page"/);
  const a=app.refreshCurrentPage(),b=app.refreshCurrentPage();
  assert.equal(vm.runInContext('window.__reads',app),1);release();await Promise.all([a,b]);
  assert.equal(vm.runInContext('STATE.currentUser.id',app),'tim');
  assert.equal(vm.runInContext('STATE.currentScreen',app),'grading_expert');
  assert.equal(vm.runInContext('JSON.stringify(STATE.currentGrading)',app),before);
  assert.equal(vm.runInContext('window.__renders',app),1);
  assert.equal(app.uiActionLabel({dataset:{action:'refresh_page'}}),'Refreshing...');
});

test('refresh does not repaint DOM-only forms, race another operation, or discard work on a failed read', async () => {
  const app=loadAppSandbox();
  vm.runInContext(`STATE.currentUser=USERS[0];STATE.currentScreen='monitor_manual';window.__renders=0;
    render=()=>window.__renders++;syncSharedStateIfChanged=async()=>false;`,app);
  await app.handleAction('refresh_page',{});assert.equal(vm.runInContext('window.__renders',app),0);
  vm.runInContext("pendingUiActions.set('print',{});pendingUiActions.set('refresh',{});syncSharedStateIfChanged=async()=>{throw Error('should not run');};",app);
  assert.equal(await app.refreshCurrentPage(),false);
  vm.runInContext("pendingUiActions.clear();STATE.currentScreen='home';syncSharedStateIfChanged=async()=>{throw Error('offline');};",app);
  assert.equal(await app.refreshCurrentPage(),false);
  assert.equal(vm.runInContext('STATE.currentUser.id',app),'tim');assert.match(vm.runInContext('STATE.appMessage.text',app),/unsynchronized work are kept/);
});

test('batch 28692 photo example uses normal larger fonts after print-only CPU/brand compaction', () => {
  const app=loadAppSandbox();
  const laptop={merk:'Dell Inc.',model:'Latitude 7400',processor:'Intel(R) Core(TM) i7-8665U CPU @ 1.90GHz',ram:'16GB',ssd:'512GB',display:'14"',gpu:'',battery:''};
  const before=JSON.stringify(laptop);const rows=app.getSpecsLabelRows(laptop,{eindgrade:'A'});
  assert.equal(rows[0],'Dell Latitude 7400');assert.equal(rows[1],'i7-8665U / 16GB / 512GB');
  const raw=[laptop.merk+' '+laptop.model,laptop.processor+' / 16GB / 512GB','Grade A / Touch Nee',''];
  const oldXml=app.buildDymoLabelXml(raw);const xml=app.buildDymoLabelXml(rows);
  const sizes=source=>Array.from(source.matchAll(/<Font Family="Arial" Size="([\d.]+)"/g),match=>Number(match[1]));
  assert.deepEqual(sizes(oldXml),[9.5,6.8,6.8,6.2]);
  assert.deepEqual(sizes(xml),[13,8.8,8.8,7.5]);
  assert.equal(app.getBrowserLabelMarkup(rows).scaleClass,'');
  assert.match(xml,/<PaperName>11352 Return Address Int<\/PaperName>/);
  assert.equal(JSON.stringify(laptop),before);
});

test('processor model suffixes/counts are preserved and unknown processors are not guessed', () => {
  const app=loadAppSandbox();
  for(const [raw,expected] of [
    ['Intel(R) Core(TM) i7-9850H CPU @ 2.60GHz','i7-9850H'],
    ['Intel Core i7-6820HQ CPU @ 2.70GHz','i7-6820HQ'],
    ['2 x Intel Core i7-8665U CPU @ 1.90GHz','2x i7-8665U'],
    ['AMD Ryzen 5 PRO 4650U with Radeon Graphics','Ryzen 5 PRO 4650U'],
    ['Intel Xeon E3-1505M v6','Intel Xeon E3-1505M v6'],
    ['Apple M3 Pro','Apple M3 Pro'],['',''],
  ]) assert.equal(app.compactProcessorForLabel(raw),expected);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {loadAppSandbox}=require('./app-sandbox.cjs');
const run=(app,code)=>vm.runInContext(code,app);
async function fixture() {
  const app=loadAppSandbox({gzip:true,sessionStorage:{remarktServerSessionV1:'synthetic-verified-session'}});
  app.URLSearchParams=URLSearchParams;
  run(app,`STATE.currentUser=normalizeStoredUser({id:'worker',naam:'Worker',rol:'Grader',passwordHash:'server-managed',laptopAccess:'grade',mustChangePassword:false});
    USERS.splice(0,USERS.length,STATE.currentUser);STATE.serverAuth=true;STATE.storageFormat=3;STATE.sharedWorkspaceId='office-qa';STATE.currentScreen='scan';
    BATCHES.splice(0,BATCHES.length,{id:'old',nummer:'OLD',leverancier:'QA',laptops:[{sticker:'OLD-100',serial:'OLD-SERIAL',merk:'Dell',model:'QA',batchId:'old',batchNummer:'OLD',processor:'i5',ram:'16GB',ssd:'512GB'}]});
    rebuildLaptopIndex();lastSharedStateSnapshot=getSharedDemoSnapshot({includeUsers:true});`);
  await app.saveLocalDemoStateBackup({...run(app,'getSharedDemoSnapshot({includeUsers:true})'),storageRevision:5});
  return app;
}
function remoteWork(app) {
  const snapshot=structuredClone(app.readLocalDemoStateBackup());
  snapshot.storageRevision=6;snapshot.updatedAt='2026-10-29T09:00:00Z';
  snapshot.batches.push({id:'latest',nummer:'LATEST',leverancier:'QA',laptops:[{
    sticker:'LATEST-200',serial:'LATEST-SERIAL',merk:'HP',model:'EliteBook',batchId:'latest',batchNummer:'LATEST',processor:'i7',ram:'16GB',ssd:'512GB'
  }]});
  snapshot._workInventoryComplete=true;return snapshot;
}

test('a trace rate limit does not block a locally secured laptop and following scans do not hit the limit again',async()=>{
  const app=await fixture();let requests=0;
  app.fetch=async()=>{requests++;return new Response(JSON.stringify({code:'RATE_LIMITED',retryAfterSeconds:60}),{status:429,headers:{'Retry-After':'60'}});};
  await app.submitLaptopCode('OLD-100');
  assert.equal(run(app,'STATE.currentScreen'),'laptop_info');assert.equal(run(app,'STATE.currentLaptop.sticker'),'OLD-100');
  assert.equal(app.canWorkLocally(),true);assert.equal(requests,1);
  for(let index=0;index<10;index++)assert.equal(await app.loadRecordTrace('OLD-100'),true);
  assert.equal(requests,1);assert.equal(run(app,'STATE.sharedStorageError'),'STORAGE_RATE_LIMITED');
});

test('provider cooldown opens cached work locally without making another request',async()=>{
  const app=await fixture();let requests=0;app.fetch=async()=>{requests++;throw Error('cooldown must be honored');};
  run(app,'appRetryAfter=Date.now()+60000;');
  await app.submitLaptopCode('OLD-100');
  assert.equal(requests,0);assert.equal(app.canWorkLocally(),true);assert.equal(run(app,'STATE.currentScreen'),'laptop_info');
});

test('a network timeout uses local inventory but conflicts and revoked sessions never become offline permission',async()=>{
  const app=await fixture();app.fetch=async()=>{throw Error('network unavailable');};
  await app.submitLaptopCode('OLD-100');assert.equal(app.canWorkLocally(),true);assert.equal(run(app,'STATE.currentScreen'),'laptop_info');
  const conflict=await fixture();conflict.fetch=async()=>new Response(JSON.stringify({code:'STORAGE_RECORD_CONFLICT'}),{status:409});
  assert.equal(await conflict.loadRecordTrace('OLD-100'),false);assert.equal(conflict.canWorkLocally(),false);
  const revoked=await fixture();revoked.fetch=async()=>new Response(JSON.stringify({code:'AUTH_REQUIRED'}),{status:401});
  await revoked.submitLaptopCode('OLD-100');assert.equal(run(revoked,'STATE.currentScreen'),'login');assert.equal(revoked.canWorkLocally(),false);
});

test('a scan miss repairs stale complete inventory with one work-list read and opens the real latest laptop',async()=>{
  const app=await fixture();const work=remoteWork(app),calls=[];
  app.fetch=async(url,options)=>{
    calls.push(url);assert.equal(options.method,undefined,'Repairing a read does not upload a replacement batch');
    if(url.endsWith('?meta=1'))return new Response(JSON.stringify({workspaceId:'office-qa',storageRevision:6,updatedAt:work.updatedAt}));
    if(url.endsWith('?work=1'))return new Response(JSON.stringify(work));
    if(url.includes('?trace='))return new Response(JSON.stringify({records:[]}));
    throw Error('Unexpected request '+url);
  };
  await app.submitLaptopCode('LATEST-200');
  assert.equal(run(app,'STATE.currentLaptop.sticker'),'LATEST-200');assert.equal(run(app,'STATE.currentScreen'),'laptop_info');
  assert.equal(calls.filter(url=>url.endsWith('?work=1')).length,1);
  assert.equal(calls.filter(url=>url.includes('?since=')).length,0,'A claimed complete cache must also be repairable');
  assert.equal(app.readLocalDemoStateBackup().batches.length,2);assert.equal(run(app,'STATE.scanLookupBusy'),false);
});

test('unmatched repeated scans are throttled, and typing or partial hits never reads the database',async()=>{
  const app=await fixture();const work=remoteWork(app),calls=[];
  app.fetch=async url=>{calls.push(url);return new Response(JSON.stringify(url.endsWith('?meta=1')?
    {workspaceId:'office-qa',storageRevision:6,updatedAt:work.updatedAt}:work));};
  for(let index=0;index<8;index++)await app.submitLaptopCode('UNKNOWN-'+index);
  assert.equal(calls.length,2);assert.equal(run(app,'STATE.currentScreen'),'scan');
  await app.submitLaptopCode('SERIAL');assert.equal(calls.length,2);
  assert.equal(await app.submitLaptopCode(''),false);assert.equal(calls.length,2);
});

test('offline missing batch reports an unavailable list, not a definitive absent barcode or fictitious laptop',async()=>{
  const app=await fixture();run(app,"STATE.sharedStorageError='STORAGE_QUOTA_EXCEEDED';STATE.offlineWork=true;appRetryAfter=Date.now()+60000;");
  let requests=0;app.fetch=async()=>{requests++;throw Error('Provider cooldown');};
  await app.submitLaptopCode('LATEST-200');
  assert.equal(requests,0);assert.match(run(app,'STATE.appMessage.text'),/latest batch could not be checked/);
  assert.equal(run(app,'STATE.currentLaptop'),null);assert.equal(app.getLaptopBySticker('LATEST-200'),null);
  assert.equal(app.getAllLaptops().length,1);assert.equal(app.canWorkLocally(),true);
});

test('a missing code during a stats cooldown also enters local continuity rather than hammering the server',async()=>{
  const app=await fixture();run(app,'appRetryAfter=Date.now()+60000;');
  app.fetch=async()=>{throw Error('No provider retries during cooldown');};
  await app.submitLaptopCode('LATEST-200');assert.equal(app.canWorkLocally(),true);
  assert.match(run(app,'STATE.appMessage.text'),/latest batch could not be checked/);
});

test('late inventory recovery cannot navigate or print after leaving the scanner',async()=>{
  const app=await fixture();let release;
  app.loadRecordState=()=>new Promise(resolve=>{release=resolve;});
  const pending=app.submitLaptopCode('LATEST-200');
  assert.equal(run(app,'STATE.scanLookupBusy'),true);
  assert.equal(await app.submitLaptopCode('ANOTHER'),false);
  run(app,"STATE.currentScreen='home';");release(true);assert.equal(await pending,false);
  assert.equal(run(app,'STATE.currentScreen'),'home');assert.equal(run(app,'STATE.currentLaptop'),null);
});

test('the manager strip shows offline state without a hanging loading message or stats request',async()=>{
  const app=await fixture();const container={html:'Connecting to operations…',state:null,
    setAttribute(key,value){if(key==='data-state')this.state=value;},set innerHTML(value){this.html=value;}};
  const baseGet=app.document.getElementById;app.document.getElementById=id=>id==='manager-live-stats'?container:baseGet(id);
  let requests=0;app.fetch=async()=>{requests++;throw Error('Offline stats request');};
  for(const flags of ["STATE.offlineWork=true;STATE.sharedStorageError='STORAGE_UNAVAILABLE';",'STATE.offlineWork=false;STATE.sharedStorageError=null;appRetryAfter=Date.now()+60000;']) {
    run(app,flags);await app.refreshAnalyticsServerStats();
    assert.equal(container.state,'offline');assert.match(container.html,/Local mode/);assert.doesNotMatch(container.html,/Connecting/);
  }
  assert.equal(requests,0);
});

test('trace requests use a short bounded timeout without leaking fetch-only settings',async()=>{
  const app=await fixture();let delay;
  app.AbortController=AbortController;app.setTimeout=(callback,ms)=>{delay=ms;return 0;};
  app.fetch=async(url,settings)=>{assert.equal(settings.timeoutMs,undefined);return new Response(JSON.stringify({records:[]}));};
  assert.equal(await app.loadRecordTrace('OLD-100'),true);assert.equal(delay,4000);
});

test('manager restores the latest inventory from a recovery copy without importing foreign accounts or queued work',async()=>{
  const app=await fixture();const source=remoteWork(app);
  source.users=[{id:'foreign',rol:'Manager'}];source.history=[{id:'foreign-grade',sticker:'LATEST-200'}];
  source._pendingRecordMutation={mutationId:'foreign-mutation',operations:[{collection:'history',id:'foreign-grade'}]};
  run(app,`STATE.currentUser.rol='Manager';STATE.sharedStorageError='STORAGE_UNAVAILABLE';STATE.offlineWork=true;
    STATE.history.push({id:'own-work',sticker:'OLD-100',grade:'B',user_id:'worker'});
    STATE.pendingRecordMutation=createRecordMutation(getSharedDemoSnapshot(),lastSharedStateSnapshot);STATE.sharedSyncPending=true;`);
  await app.saveLocalDemoStateBackup();
  const id=run(app,'STATE.pendingRecordMutation.mutationId');let requests=0;
  app.fetch=async()=>{requests++;throw Error('Transferring lists is local only');};
  assert.equal(await app.restoreLocalWorkLists(source),true);
  assert.equal(app.getLaptopBySticker('LATEST-200').model,'EliteBook');assert.equal(requests,0);
  assert.equal(run(app,'STATE.history.length'),1);assert.equal(run(app,'STATE.history[0].id'),'own-work');
  assert.equal(run(app,'STATE.pendingRecordMutation.mutationId'),id);assert.equal(app.readLocalDemoStateBackup()._pendingRecordMutation.mutationId,id);
  assert.equal(run(app,'USERS.length'),1);assert.equal(run(app,'USERS[0].id'),'worker');
  assert.equal(run(app,"createRecordMutation(getSharedDemoSnapshot(),lastSharedStateSnapshot).operations.filter(op=>['batches','laptops','users'].includes(op.collection)).length"),0,'The incoming list must not become employee/server writes');
});

test('work-list transfer preserves a dirty device correction and keeps existing deletion markers',async()=>{
  const app=await fixture();const source=remoteWork(app);
  run(app,`STATE.currentUser.rol='Manager';STATE.sharedStorageError='STORAGE_UNAVAILABLE';STATE.offlineWork=true;
    getLaptopBySticker('OLD-100').ram='32GB';STATE.deletedLaptopStickers=['LATEST-200'];`);
  assert.equal(await app.restoreLocalWorkLists(source),true);
  assert.equal(app.getLaptopBySticker('OLD-100').ram,'32GB');assert.equal(app.getLaptopBySticker('LATEST-200'),null);
  assert.ok(run(app,"STATE.deletedLaptopStickers.includes('LATEST-200')"));
});

test('staff, foreign workspaces and accounts-only files cannot restore inventory',async()=>{
  const app=await fixture(),source=remoteWork(app);
  run(app,"STATE.sharedStorageError='STORAGE_UNAVAILABLE';STATE.offlineWork=true;");
  assert.equal(await app.restoreLocalWorkLists(source),false);
  run(app,"STATE.currentUser.rol='Manager';");
  for(const bad of [{...source,workspaceId:'foreign'},{...source,_recoveryScope:'accounts-only'},{...source,batches:[{id:'invalid'}]}])
    await assert.rejects(app.restoreLocalWorkLists(bad));
  assert.equal(app.getAllLaptops().length,1);assert.equal(app.getLaptopBySticker('LATEST-200'),null);
});

test('failed durable work-list import rolls back the inventory and does not erase local work',async()=>{
  const app=await fixture(),source=remoteWork(app);
  run(app,"STATE.currentUser.rol='Manager';STATE.sharedStorageError='STORAGE_UNAVAILABLE';STATE.offlineWork=true;");
  const before=JSON.stringify(app.readLocalDemoStateBackup());app.saveLocalDemoStateBackup=async()=>false;
  await assert.rejects(app.restoreLocalWorkLists(source));
  assert.equal(JSON.stringify(app.readLocalDemoStateBackup()),before);
  assert.equal(app.getLaptopBySticker('LATEST-200'),null);assert.equal(app.getAllLaptops().length,1);
});

async function fixtureWithHeldWork() {
  const app=await fixture();
  run(app,`STATE.history.push({id:'held-foreign',sticker:'OLD-100',grade:'B',user_id:'other-worker'});
    STATE.pendingRecordMutation=createRecordMutation(getSharedDemoSnapshot(),lastSharedStateSnapshot);STATE.sharedSyncPending=true;`);
  await app.saveLocalDemoStateBackup();
  return app;
}
function connectHeldWork(app) {
  const work=remoteWork(app);work.history=[];work._pendingRecordMutation=null;
  const calls=[];
  app.fetch=async(url,options={})=>{
    calls.push({url,method:options.method||'GET'});
    if(options.method==='POST')return new Response(JSON.stringify({ok:false,code:'AUTH_FORBIDDEN'}),{status:403});
    if(url.includes('?meta=1'))return new Response(JSON.stringify({workspaceId:'office-qa',storageRevision:6,updatedAt:work.updatedAt}));
    if(url.includes('?work=1'))return new Response(JSON.stringify(work));
    if(url.includes('?since='))return new Response(JSON.stringify({recordDelta:true,records:[],next:null}));
    if(url.includes('?trace='))return new Response(JSON.stringify({records:[]}));
    throw Error('Unexpected request '+url);
  };
  return {work,calls};
}

test('a rejected queued write cannot discard successfully read new inventory or masquerade as no connection',async()=>{
  const app=await fixtureWithHeldWork();const id=run(app,'STATE.pendingRecordMutation.mutationId');
  const {calls}=connectHeldWork(app);
  assert.equal(await app.loadRecordState({refreshInventory:true}),true);
  assert.equal(app.getLaptopBySticker('LATEST-200').model,'EliteBook');assert.equal(app.hasRecordSyncReview(),true);
  assert.equal(app.canWorkLocally(),true);assert.equal(app.readLocalDemoStateBackup().storageRevision,6);
  assert.equal(run(app,'STATE.pendingRecordMutation.mutationId'),id);assert.equal(run(app,'STATE.history[0].id'),'held-foreign');
  assert.equal(app.readLocalDemoStateBackup()._pendingRecordSyncFailure.code,'AUTH_FORBIDDEN');
  assert.match(app.renderLocalWorkStatus(),/Synchronization needs review|server is reachable/);
  assert.doesNotMatch(run(app,'STATE.appMessage.text'),/Connection unavailable/);
  const beforePosts=calls.filter(row=>row.method==='POST').length;
  await app.submitLaptopCode('LATEST-200');assert.equal(run(app,'STATE.currentScreen'),'laptop_info');
  assert.equal(calls.filter(row=>row.method==='POST').length,beforePosts,'A read must not retry the rejected write');
});

test('subsequent refreshes use the saved read checkpoint and do not resend a forbidden queue',async()=>{
  const app=await fixtureWithHeldWork(),{calls}=connectHeldWork(app);
  await app.loadRecordState({refreshInventory:true});
  await app.loadRecordState();await app.loadRecordState();
  assert.equal(calls.filter(row=>row.url.includes('?work=1')).length,1);
  assert.equal(calls.filter(row=>row.url.includes('?since=6')).length,2);
  assert.equal(calls.filter(row=>row.method==='POST').length,1);
  assert.equal(app.getLaptopBySticker('LATEST-200').model,'EliteBook');
});

test('new employee work stays secured alongside an unchanged held queue, including across a reload',async()=>{
  const app=await fixtureWithHeldWork(),{calls}=connectHeldWork(app);
  await app.loadRecordState({refreshInventory:true});
  const id=run(app,'STATE.pendingRecordMutation.mutationId');
  run(app,"STATE.history.push({id:'new-own-work',sticker:'LATEST-200',grade:'A',user_id:'worker'});");
  assert.equal(await app.saveSharedDemoState(),true);
  const backup=app.readLocalDemoStateBackup();assert.equal(backup.history.length,2);
  assert.equal(backup._pendingRecordMutation.mutationId,id);assert.equal(backup._pendingRecordSyncFailure.code,'AUTH_FORBIDDEN');
  await app.loadRecordState();
  assert.equal(run(app,'STATE.history.length'),2);assert.equal(run(app,'STATE.pendingRecordMutation.mutationId'),id);
  assert.equal(calls.filter(row=>row.method==='POST').length,1);
});

test('explicit retry rechecks held synchronization without automatic permission changes',async()=>{
  const app=await fixtureWithHeldWork(),{calls}=connectHeldWork(app);
  await app.loadRecordState({refreshInventory:true});
  await app.handleAction('retry_storage',{});
  assert.equal(calls.filter(row=>row.method==='POST').length,2);assert.equal(app.hasRecordSyncReview(),true);
  assert.equal(run(app,'STATE.currentUser.rol'),'Grader');
});

test('server-reported password-change requirements are not treated as permission to continue',async()=>{
  const app=await fixtureWithHeldWork();const {work}=connectHeldWork(app);
  const fetch=app.fetch;app.fetch=(url,options)=>options?.method==='POST'
    ? Promise.resolve(new Response(JSON.stringify({code:'AUTH_PASSWORD_CHANGE_REQUIRED'}),{status:403})) : fetch(url,options);
  await app.loadRecordState({refreshInventory:true});assert.equal(app.hasRecordSyncReview(),false);
  assert.equal(app.readLocalDemoStateBackup()._pendingRecordSyncFailure,undefined);
  assert.equal(app.canWorkLocally(),false);assert.equal(run(app,'STATE.currentScreen'),'password_change');
});

test('the first forbidden operational save is secured locally and immediately unblocks subsequent reads',async()=>{
  const app=await fixtureWithHeldWork(),{calls}=connectHeldWork(app);
  const id=run(app,'STATE.pendingRecordMutation.mutationId');
  assert.equal(await app.saveSharedDemoState(),true);assert.equal(app.hasRecordSyncReview(),true);
  assert.equal(app.readLocalDemoStateBackup()._pendingRecordMutation.mutationId,id);
  assert.equal(app.readLocalDemoStateBackup()._pendingRecordSyncFailure.code,'AUTH_FORBIDDEN');
  await app.loadRecordTrace('OLD-100');
  assert.equal(calls.filter(row=>row.method==='POST').length,1);
  assert.ok(calls.some(row=>row.url.includes('?trace=')));
});

test('Manager Live remains readable while an earlier write is held for authorization review',async()=>{
  const app=await fixtureWithHeldWork();connectHeldWork(app);await app.loadRecordState({refreshInventory:true});
  run(app,"STATE.currentUser.rol='Manager';");
  const container={state:null,html:'',classList:{toggle(){}},querySelector(){return null;},
    setAttribute(key,value){if(key==='data-state')this.state=value;},set innerHTML(value){this.html=value;}};
  const baseGet=app.document.getElementById;app.document.getElementById=id=>id==='manager-live-stats'?container:baseGet(id);
  const calls=[];app.fetch=async(url,options={})=>{calls.push(url);assert.equal(options.method,undefined);return new Response(JSON.stringify({live:{today:3}}));};
  await app.refreshAnalyticsServerStats();
  assert.equal(container.state,'ready');assert.doesNotMatch(container.html,/database figures unavailable/);
  assert.deepEqual(calls,['/api/stats']);assert.equal(app.hasRecordSyncReview(),true);
});

test('a stale localStorage copy cannot hide newly secured inventory after IndexedDB saves a larger work list',async()=>{
  const {IDBFactory}=await import('fake-indexeddb');const indexedDB=new IDBFactory();
  const first=loadAppSandbox({indexedDB});
  const old={version:1,storageFormat:3,workspaceId:'cache-size-qa',storageRevision:5,
    users:[],batches:[{id:'old',laptops:[{sticker:'OLD'}]}],monitorBatches:[],history:[],labelPrints:[],monitorLabelPrints:[],auditLogs:[],updatedAt:'2026-10-29T10:10:00Z'};
  await first.saveLocalDemoStateBackup(old);
  const legacy=first.localStorage.getItem('remarktDemoStateBackupV1');
  first.localStorage.setItem=()=>{throw Error('QuotaExceededError');};
  const current={...old,storageRevision:6,batches:[...old.batches,{id:'latest',laptops:[{sticker:'LATEST'}]}],updatedAt:'2026-10-29T10:00:00Z'};
  assert.equal(await first.saveLocalDemoStateBackup(current),true);
  const reopened=loadAppSandbox({indexedDB,localStorage:{remarktDemoStateBackupV1:legacy}});
  await reopened.loadDurableBackup();
  assert.equal(reopened.readLocalDemoStateBackup().storageRevision,6);
  assert.ok(reopened.readLocalDemoStateBackup().batches.some(batch=>batch.id==='latest'));
});

test('legacy recovery copies without a local save clock keep their original upgrade ordering',async()=>{
  const {IDBFactory}=await import('fake-indexeddb');const indexedDB=new IDBFactory();
  const first=loadAppSandbox({indexedDB});await first.saveLocalDemoStateBackup({users:[],history:[],updatedAt:'2026-01-01T10:00:00Z'});
  const db=await first.openRecoveryDatabase();
  await new Promise((resolve,reject)=>{const tx=db.transaction('backups','readwrite');
    tx.objectStore('backups').put({users:[],history:[{id:'older-idb'}],updatedAt:'2026-01-01T10:00:00Z'},'current');
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  const reopened=loadAppSandbox({indexedDB,localStorage:{remarktDemoStateBackupV1:JSON.stringify({users:[],history:[{id:'newer-legacy'}],updatedAt:'2026-01-01T11:00:00Z'})}});
  await reopened.loadDurableBackup();assert.equal(reopened.readLocalDemoStateBackup().history[0].id,'newer-legacy');
});

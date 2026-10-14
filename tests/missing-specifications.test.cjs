const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadAppSandbox } = require('./app-sandbox.cjs');

function fixture(specs = {}, mode = 'expert') {
  const app = loadAppSandbox();
  app.__specs = specs; app.__mode = mode;
  vm.runInContext(`
    STATE.currentUser = {id:'grader-qa',naam:'QA',rol:'Grader',laptopAccess:'grade',mustChangePassword:false};
    STATE.currentScreen = 'result'; STATE.history=[];
    BATCHES.splice(0,BATCHES.length,{id:'spec-qa',nummer:'QA',laptops:[{
      sticker:'SPEC-QA',merk:'Dell',model:'Latitude 7400',serial:'QA-SERIAL',batchId:'spec-qa',batchNummer:'QA',
      processor:'Not reported',ram:'No reported',ssd:'512GB',...__specs
    }]});
    rebuildLaptopIndex(); STATE.currentLaptop=getLaptopBySticker('SPEC-QA');
    STATE.currentGrading={modus:__mode,gestart:Date.now()-1000,keuzes:{},triggers:{},impactOverrides:{},
      result:{eindgrade:'A',score:0,redenen:[],detailRows:[]}};
    window.__printed=[];window.__saved=[];
    printLabelJobsWithDymoFallback=async jobs=>{window.__printed.push(jobs);return {ok:true};};
    saveSharedDemoState=async()=>{window.__saved.push(getSharedDemoSnapshot());return true;};
  `, app);
  return app;
}
const state = (app, code) => vm.runInContext(code, app);
function fields(app, values) {
  const nodes = Object.fromEntries(Object.entries(values).map(([key,value]) => [`checked-${key}`,{value,focus(){}}]));
  app.document.getElementById=id=>id==='app'?app.__appElement:nodes[id]||null;
}

test('recognizes supplier placeholders without treating actual hardware as missing', () => {
  const app = fixture();
  for(const value of ['', '-', 'Not reported','(not reported)','No reported','not_reported','Not selected','Unknown','N/A','0GB','0 MB','niet bekend'])
    assert.equal(app.isMissingHardwareSpec(value),true,value);
  for(const value of ['i7-8665U','AMD Ryzen 5 5500U','8GB','16 GB','Apple M1']) assert.equal(app.isMissingHardwareSpec(value),false,value);
});

test('import ignores unreported columns and uses real specs from supplier description', () => {
  const app=fixture();
  const row={'Sticker Number':'QA-IMPORT','Product Group':'Laptop','BIOS Make':'Dell','BIOS Model':'Latitude 7400',
    'Processor Name':'Not reported',Memory:'No reported','Account Device Name':'Dell/Latitude 7400/1 x Intel(R) Core(TM) i7-8665U CPU @ 1.90GHz/16 GB/512 GB'};
  const laptop=app.importedRowToLaptop(row,'list.xlsx');
  assert.match(laptop.processor,/i7-8665U/);assert.equal(laptop.ram,'16GB');
  const unknown=app.importedRowToLaptop({...row,'Account Device Name':''},'list.xlsx');
  assert.equal(unknown.processor,'');assert.equal(unknown.ram,'');
});

test('automatic confirmation stops before any print or save for all grading modes', async () => {
  for(const mode of ['beginner','expert']) {
    const app=fixture({},mode);
    await app.confirmSaveWithAutomaticLabels();
    assert.equal(state(app,'STATE.currentScreen'),'missing_specs');
    assert.equal(state(app,'window.__printed.length'),0);assert.equal(state(app,'window.__saved.length'),0);
    assert.equal(state(app,'STATE.currentGrading._processingSave'),false);
    const html=app.__appElement.innerHTML;
    assert.match(html,/id="checked-processor"/);assert.match(html,/id="checked-ram"/);
    assert.match(html,/label for="checked-processor"/);assert.match(html,/Save specifications & print/);
    assert.equal(app.getScreenBackAction('missing_specs'),'specifications_back');
  }
});

test('checked values are kept on detached inventory, history and reprint labels, without changing the grade', async () => {
  const app=fixture();await app.confirmSaveWithAutomaticLabels();
  state(app,'STATE.currentLaptop={...STATE.currentLaptop};'); // same situation as live refresh
  fields(app,{processor:'Intel Core i7-8665U',ram:'16 GB'});
  assert.equal(await app.completeMissingSpecifications(),true);
  assert.equal(state(app,'STATE.currentScreen'),'scan');assert.equal(state(app,'STATE.history.length'),1);
  assert.equal(state(app,"getLaptopBySticker('SPEC-QA').processor"),'Intel Core i7-8665U');
  assert.equal(state(app,"getLaptopBySticker('SPEC-QA').ram"),'16GB');
  assert.equal(state(app,'STATE.history[0].processor'),'Intel Core i7-8665U');assert.equal(state(app,'STATE.history[0].ram'),'16GB');
  assert.equal(state(app,'STATE.history[0].grade'),'A');assert.equal(state(app,'STATE.history[0].score'),0);
  const rows=state(app,"getSpecsLabelRows(buildLaptopFromHistoryOrBatch('SPEC-QA',STATE.history[0]),STATE.history[0].result)");
  assert.match(rows[1],/i7-8665U \/ 16GB \/ 512GB/);
  const snapshots=state(app,'window.__saved');
  assert.equal(snapshots[0].batches[0].laptops[0].ram,'16GB');
  assert.equal(snapshots.at(-1).history[0].ram,'16GB');
  assert.equal(state(app,'window.__printed.length'),1);
});

test('known values are never editable or overwritten; a concurrent known value wins', async () => {
  const app=fixture({ram:'32GB'});await app.confirmSaveWithAutomaticLabels();
  assert.doesNotMatch(app.__appElement.innerHTML,/id="checked-ram"/);
  state(app,"STATE.currentLaptop={...STATE.currentLaptop};getLaptopBySticker('SPEC-QA').processor='AMD Ryzen 5 5500U';");
  fields(app,{processor:'i7-8665U',ram:'8'});
  await app.completeMissingSpecifications();
  assert.equal(state(app,'STATE.history[0].ram'),'32GB');assert.equal(state(app,'STATE.history[0].processor'),'AMD Ryzen 5 5500U');
});

test('invalid input stays on the form with an accessible error and no print, skip remains explicit', async () => {
  for(const ram of ['0','-16','16GB blah','999999','<script>']) {
    const app=fixture();await app.confirmSaveWithAutomaticLabels();fields(app,{processor:'i7-8665U',ram});
    assert.equal(await app.completeMissingSpecifications(),false);
    assert.equal(state(app,'window.__printed.length'),0);assert.equal(state(app,'window.__saved.length'),0);
    assert.match(app.__appElement.innerHTML,/aria-invalid="true"/);assert.match(app.__appElement.innerHTML,/role="alert"/);
    assert.match(app.__appElement.innerHTML,/value="i7-8665U"/);
  }
  const app=fixture();await app.confirmSaveWithAutomaticLabels();fields(app,{processor:'',ram:''});
  assert.equal(await app.completeMissingSpecifications(),false);
  await app.completeMissingSpecifications(true);
  assert.equal(state(app,'STATE.history.length'),1);
  assert.equal(state(app,"getSpecsLabelRows(getLaptopBySticker('SPEC-QA'),{eindgrade:'A'})[1]"),'- / - / 512GB');
});

test('can record RAM alone without inventing CPU, and completed devices retain immediate printing', async () => {
  const partial=fixture();await partial.confirmSaveWithAutomaticLabels();fields(partial,{processor:'',ram:'16'});
  await partial.completeMissingSpecifications();assert.equal(state(partial,'STATE.history[0].ram'),'16GB');
  assert.equal(state(partial,'STATE.history[0].processor'),'Not reported');
  const known=fixture({processor:'i7-8665U',ram:'16GB'});await known.confirmSaveWithAutomaticLabels();
  assert.equal(state(known,'STATE.currentScreen'),'scan');assert.equal(state(known,'window.__printed.length'),1);
  const training=fixture();state(training,'STATE.currentGrading.testOnly=true;');
  assert.equal(training.requestMissingSpecifications(),false);
});

test('individual result-label preview print cannot bypass missing specs or silently save grading', async () => {
  const app=fixture();let prints=0;app.printLabelFor=async()=>{prints++;};
  await app.printCurrentLabel('specs');assert.equal(state(app,'STATE.currentScreen'),'missing_specs');assert.equal(prints,0);
  fields(app,{processor:'i7-8665U',ram:'16'});await app.completeMissingSpecifications();
  assert.equal(prints,1);assert.equal(state(app,'STATE.history.length'),0);assert.equal(state(app,'STATE.currentScreen'),'result');
});

test('form drafts survive preference re-renders and soft refresh does not discard input', async () => {
  const app=fixture();await app.confirmSaveWithAutomaticLabels();
  app.handleDelegatedInput({target:{value:'i7-8665U',dataset:{hardwareSpec:'processor'}}});
  app.render();assert.match(app.__appElement.innerHTML,/value="i7-8665U"/);
  assert.equal(app.liveRenderWouldDisruptInput(),true);
  await app.handleAction('specifications_back',{});assert.equal(state(app,'STATE.currentScreen'),'result');
  assert.ok(state(app,'STATE.currentLaptop'));assert.ok(state(app,'STATE.currentGrading.result'));
  await app.confirmSaveWithAutomaticLabels();assert.match(app.__appElement.innerHTML,/value="i7-8665U"/);
  state(app,"STATE.language='nl';");assert.equal(app.translateCopy('Complete missing specifications'),'Ontbrekende specificaties aanvullen');
});

test('DYMO failure retains completed specs without duplicating grading on retry', async () => {
  const app=fixture();await app.confirmSaveWithAutomaticLabels();fields(app,{processor:'i7-8665U',ram:'16'});
  state(app,'printLabelJobsWithDymoFallback=async()=>({ok:false,fallbackReason:"QA printer unavailable"});');
  await app.completeMissingSpecifications();assert.equal(state(app,'STATE.history.length'),0);
  assert.equal(state(app,'STATE.currentScreen'),'result');assert.equal(state(app,'STATE.currentLaptop.ram'),'16GB');
  state(app,'printLabelJobsWithDymoFallback=async jobs=>{window.__printed.push(jobs);return {ok:true};};');
  await app.confirmSaveWithAutomaticLabels();assert.equal(state(app,'STATE.history.length'),1);
  assert.equal(state(app,'window.__printed.length'),1);
});

test('blocked local backup stops printing and can be retried after securing the same specs', async () => {
  const app=fixture();await app.confirmSaveWithAutomaticLabels();fields(app,{processor:'i7-8665U',ram:'16'});
  state(app,'saveSharedDemoState=async()=>{STATE.localBackupError="QA backup blocked";return false;};');
  assert.equal(await app.completeMissingSpecifications(),false);assert.equal(state(app,'window.__printed.length'),0);
  assert.equal(state(app,'STATE.currentGrading.specificationsPendingSave'),true);
  state(app,'saveSharedDemoState=async()=>{STATE.localBackupError=null;return true;};');
  assert.equal(await app.completeMissingSpecifications(),true);assert.equal(state(app,'STATE.history.length'),1);
});

test('employee inventory and own history updates are accepted by existing server authorization', async () => {
  const { authorizeOperations }=await import('../api/_lib/session-auth.mjs');
  const app=fixture();await app.confirmSaveWithAutomaticLabels();fields(app,{processor:'i7-8665U',ram:'16'});
  await app.completeMissingSpecifications();
  const snapshot=state(app,'window.__saved.at(-1)');
  assert.doesNotThrow(()=>authorizeOperations({id:'grader-qa',rol:'Grader',laptopAccess:'grade'}, {operations:[
    {collection:'laptops',id:'SPEC-QA',payload:snapshot.batches[0].laptops[0]},
    {collection:'history',id:snapshot.history[0].id,payload:snapshot.history[0]}
  ]}));
});

test('double clicks cannot duplicate physical labels, and a specification update is a record delta, not a batch replacement', async () => {
  const app=fixture();state(app,'window.__before=getSharedDemoSnapshot();');
  await app.confirmSaveWithAutomaticLabels();fields(app,{processor:'i7-8665U',ram:'16'});
  let release;app.saveSharedDemoState=async()=>{await new Promise(resolve=>{release=resolve;});return true;};
  const pending=app.completeMissingSpecifications();
  assert.equal(await app.completeMissingSpecifications(),false);
  assert.equal(await app.completeMissingSpecifications(true),false);
  const delta=state(app,'createRecordMutation(getSharedDemoSnapshot(),window.__before)');
  assert.equal(delta.operations.filter(op=>op.collection==='laptops').length,1);
  assert.equal(delta.operations.filter(op=>['batches','users','history'].includes(op.collection)).length,0);
  app.saveSharedDemoState=async()=>true;release();await pending;
  assert.equal(state(app,'window.__printed.length'),1);assert.equal(state(app,'STATE.history.length'),1);
});

test('invalid CPU never becomes inventory data; unsafe drafts are escaped in the UI', async () => {
  for(const processor of ['No reported','<script>alert(1)</script>','x'.repeat(121)]) {
    const app=fixture();await app.confirmSaveWithAutomaticLabels();fields(app,{processor,ram:'16'});
    assert.equal(await app.completeMissingSpecifications(),false);
    assert.equal(state(app,"getLaptopBySticker('SPEC-QA').processor"),'Not reported');
    assert.equal(state(app,'window.__printed.length'),0);
    assert.doesNotMatch(app.__appElement.innerHTML,/<script>alert/);
  }
});

test('missing storage alone pauses both modes and saves inventory, history and reprint capacity', async () => {
  for (const mode of ['beginner', 'expert']) {
    const app=fixture({processor:'i7-8665U',ram:'16GB',ssd:'Not reported'},mode);
    await app.confirmSaveWithAutomaticLabels();
    assert.equal(state(app,'STATE.currentScreen'),'missing_specs');
    assert.match(app.__appElement.innerHTML,/id="checked-ssd"/);
    assert.match(app.__appElement.innerHTML,/label for="checked-ssd"/);
    assert.doesNotMatch(app.__appElement.innerHTML,/id="checked-(processor|ram)"/);
    state(app,'STATE.currentLaptop={...STATE.currentLaptop};');fields(app,{ssd:'1 TB'});
    await app.completeMissingSpecifications();
    assert.equal(state(app,"getLaptopBySticker('SPEC-QA').ssd"),'1TB');
    assert.equal(state(app,'STATE.history[0].ssd'),'1TB');
    const rows=state(app,"getSpecsLabelRows(buildLaptopFromHistoryOrBatch('SPEC-QA',STATE.history[0]),STATE.history[0].result)");
    assert.equal(rows[1],'i7-8665U / 16GB / 1TB');
    assert.equal(state(app,'window.__printed.length'),1);
  }
});

test('storage accepts GB, TB, decimal comma and unitless GB without rounding the actual capacity', async () => {
  for (const [input,expected] of [['512','512GB'],['256 GB','256GB'],['1 tb','1TB'],['0,5 TB','0.5TB'],['3.84 TB','3.84TB']]) {
    const app=fixture({processor:'i7-8665U',ram:'16GB',ssd:''});
    await app.confirmSaveWithAutomaticLabels();fields(app,{ssd:input});await app.completeMissingSpecifications();
    assert.equal(state(app,'STATE.history[0].ssd'),expected,input);
  }
});

test('invalid storage gives an inline error and does not print or mutate inventory', async () => {
  for (const ssd of ['0','-512','no reported','1 PB','512 GB blah','Infinity','999999 TB','<script>']) {
    const app=fixture({processor:'i7-8665U',ram:'16GB',ssd:''});
    await app.confirmSaveWithAutomaticLabels();fields(app,{ssd});
    assert.equal(await app.completeMissingSpecifications(),false,ssd);
    assert.match(app.__appElement.innerHTML,/id="checked-ssd-error"/);
    assert.equal(state(app,'window.__printed.length'),0);assert.equal(state(app,'window.__saved.length'),0);
    assert.equal(state(app,"getLaptopBySticker('SPEC-QA').ssd"),'');
  }
});

test('known and concurrently completed storage is preserved, skipping leaves an unknown label marker', async () => {
  const known=fixture();await known.confirmSaveWithAutomaticLabels();assert.doesNotMatch(known.__appElement.innerHTML,/id="checked-ssd"/);
  const app=fixture({processor:'i7-8665U',ram:'16GB',ssd:''});await app.confirmSaveWithAutomaticLabels();
  state(app,"STATE.currentLaptop={...STATE.currentLaptop};getLaptopBySticker('SPEC-QA').ssd='2TB';");
  fields(app,{ssd:'512 GB'});await app.completeMissingSpecifications();assert.equal(state(app,'STATE.history[0].ssd'),'2TB');
  const skipped=fixture({processor:'i7-8665U',ram:'16GB',ssd:'No reported'});await skipped.confirmSaveWithAutomaticLabels();
  await skipped.completeMissingSpecifications(true);
  assert.equal(state(skipped,"getSpecsLabelRows(getLaptopBySticker('SPEC-QA'),{eindgrade:'A'})[1]"),'i7-8665U / 16GB / -');
});

test('all three missing fields share one form and one print, storage draft survives re-render', async () => {
  const app=fixture({ssd:'No reported'});await app.confirmSaveWithAutomaticLabels();
  app.handleDelegatedInput({target:{value:'512 GB',dataset:{hardwareSpec:'ssd'}}});app.render();
  assert.match(app.__appElement.innerHTML,/value="512 GB"/);
  fields(app,{processor:'i7-8665U',ram:'16',ssd:'512 GB'});await app.completeMissingSpecifications();
  assert.equal(state(app,'STATE.history[0].ssd'),'512GB');assert.equal(state(app,'window.__printed.length'),1);
  assert.equal(state(app,'STATE.history[0].grade'),'A');
  state(app,"STATE.language='nl';");assert.equal(app.translateCopy('Storage (SSD / HDD)'),'Opslag (SSD / HDD)');
});

test('supplier storage placeholders use genuine description fallback, not a false hardware value', () => {
  const app=fixture();
  const row={'Sticker Number':'QA-SSD','Product Group':'Laptop','BIOS Make':'Dell','BIOS Model':'Latitude 7400',
    'Hard Disk Size Overall':'Not reported','Hard Drive Count':'No reported',
    'Account Device Name':'Dell/Latitude 7400/1 x Intel Core i7-8665U/16 GB/512 GB'};
  assert.equal(app.importedRowToLaptop(row,'list.xlsx').ssd,'512GB');
  assert.equal(app.importedRowToLaptop({...row,'Account Device Name':''},'list.xlsx').ssd,'');
});

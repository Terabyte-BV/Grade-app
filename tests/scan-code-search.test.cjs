const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {loadAppSandbox}=require('./app-sandbox.cjs');

function fixture(screen='scan') {
  const app=loadAppSandbox();
  app.inventory=[
    {sticker:'SUPPLIER000001ABC123',serial:'SERIAL-ONE-345678',merk:'Dell',model:'Latitude 7400',batchId:'B1',batchNummer:'28692'},
    {sticker:'SUPPLIER000002ABC123',serial:'SERIAL-TWO-345678',merk:'HP',model:'EliteBook',batchId:'B2',batchNummer:'28693'},
    {sticker:'SUPPLIER000003XYZ789',serial:'SERIAL-THREE-112233',merk:'Lenovo',model:'ThinkPad',batchId:'B3',batchNummer:'28694'},
  ];
  app.screen=screen;
  vm.runInContext("STATE.currentUser=USERS[0];STATE.currentScreen=screen;BATCHES.splice(0,BATCHES.length,...inventory.map(l=>({id:l.batchId,nummer:l.batchNummer,leverancier:'Supplier',laptops:[l]})));rebuildLaptopIndex();",app);
  return app;
}

test('last five/six characters and interior fragments match real long barcodes and serials',()=>{
  const app=fixture();
  for(const query of ['ABC123','bc123','ABC12','  abc 123  ','345678']) {
    const result=app.getLaptopCodeMatches(query);
    assert.equal(result.total,2,query);assert.equal(result.exact.length,0,query);
    assert.deepEqual(Array.from(result.items,l=>l.batchNummer),['28692','28693']);
  }
  assert.equal(app.getLaptopCodeMatches('112233').total,1);
  assert.equal(app.getLaptopCodeMatches('').total,0);
  assert.equal(app.getLaptopCodeMatches('x'.repeat(257)).total,0);
});

test('Enter on partial, unknown or scanner-prefixed input never auto-selects even with one match',async()=>{
  const app=fixture();const calls=[];
  app.selectLaptop=async code=>calls.push(code);app.scanAndPrintStickerLabel=async code=>calls.push(code);
  for(const code of ['ABC123','112233','UNKNOWN-CODE','PREFIX-SUPPLIER000003XYZ789']) {
    assert.equal(await app.submitLaptopCode(code),false);assert.equal(calls.length,0);
    assert.equal(vm.runInContext('STATE.scanCodeQuery',app),code);
  }
  const markup=app.renderLaptopCodeMatches('112233');
  assert.match(markup,/data-sticker="SUPPLIER000003XYZ789"/);
  assert.match(markup,/SERIAL-THREE-112233/);assert.match(markup,/28694/);
});

test('unique full barcode/serial keeps the fast route and always passes the canonical supplier barcode',async()=>{
  const app=fixture();const calls=[];app.selectLaptop=async code=>{calls.push(code);return true;};
  assert.equal(await app.submitLaptopCode('supplier000003xyz789'),true);
  assert.equal(await app.submitLaptopCode('serial-three-112233'),true);
  assert.deepEqual(calls,['SUPPLIER000003XYZ789','SUPPLIER000003XYZ789']);
  app.numeric={sticker:'0012345',serial:'NUMERIC-SERIAL',merk:'Dell',model:'QA'};
  vm.runInContext("BATCHES.push({id:'N',laptops:[numeric]});rebuildLaptopIndex();",app);
  await app.submitLaptopCode('00012345');assert.equal(calls.at(-1),'0012345');
});

test('a typed suffix that is also another full barcode must show every match, not auto-select the shorter code',async()=>{
  const app=fixture();let selections=0;app.selectLaptop=async()=>{selections++;};
  vm.runInContext("BATCHES.push({id:'SHORT',laptops:[{sticker:'ABC123',serial:'OTHER',merk:'Dell',model:'Short code',batchNummer:'OTHER'}]});rebuildLaptopIndex();",app);
  const matches=app.getLaptopCodeMatches('ABC123');
  assert.equal(matches.total,3);assert.equal(matches.exact.length,1);
  assert.equal(matches.items[0].sticker,'ABC123','Exact code is listed first, not selected');
  await app.submitLaptopCode('ABC123');assert.equal(selections,0);
  const html=app.renderLaptopCodeMatches('ABC123');assert.equal((html.match(/data-sticker=/g)||[]).length,3);
});

test('duplicate full serials need explicit selection and a barcode wins over another device serial',async()=>{
  const app=fixture();let calls=0;app.selectLaptop=async()=>{calls++;};
  vm.runInContext("inventory[0].serial='SAME-SERIAL';inventory[1].serial='SAME-SERIAL';rebuildLaptopIndex();",app);
  assert.equal(app.getLaptopCodeMatches('same-serial').exact.length,2);
  await app.submitLaptopCode('SAME-SERIAL');assert.equal(calls,0);
  vm.runInContext("inventory[1].serial=inventory[0].sticker;rebuildLaptopIndex();",app);
  const exact=app.getLaptopCodeMatches('SUPPLIER000001ABC123');
  assert.equal(exact.exact.length,1);assert.equal(exact.exact[0].model,'Latitude 7400');
});

test('label-only partial searches do not print until a candidate is explicitly chosen through delegation',async()=>{
  const app=fixture('sticker_scan');const calls=[];
  app.scanAndPrintStickerLabel=async code=>{calls.push(code);return true;};
  await app.submitLaptopCode('ABC123');assert.equal(calls.length,0);
  const html=app.renderLaptopCodeMatches('ABC123');
  assert.match(html,/data-sticker-label="SUPPLIER000002ABC123"/);assert.doesNotMatch(html,/data-sticker=/);
  const button={dataset:{stickerLabel:'SUPPLIER000002ABC123'}};
  await app.performDelegatedClick({target:{closest:selector=>selector==='[data-sticker-label]'?button:null}});
  assert.deepEqual(calls,['SUPPLIER000002ABC123']);
  await app.submitLaptopCode('serial-three-112233');assert.equal(calls.at(-1),'SUPPLIER000003XYZ789');
});

test('selected completed devices retain the existing regrade/reprint warning with no automatic print',async()=>{
  const app=fixture();
  vm.runInContext("STATE.history=[{id:'done',sticker:inventory[0].sticker,grade:'B',result:{eindgrade:'B',problems:[]}}];rebuildHistoryIndexes();",app);
  await app.submitLaptopCode('ABC123');
  assert.equal(vm.runInContext('STATE.laptopReprintPrompt',app),null);
  await app.selectLaptop('SUPPLIER000001ABC123');
  assert.equal(vm.runInContext('STATE.laptopReprintPrompt.sticker',app),'SUPPLIER000001ABC123');
  assert.equal(vm.runInContext('STATE.currentGrading',app),null);assert.equal(vm.runInContext('STATE.labelPrints.length',app),0);
});

test('live typing replaces only the bounded results fragment, preserves scanner input and ignores stale timers',()=>{
  const app=fixture();const tasks=[];let renders=0;
  const results={innerHTML:''},input={value:'ABC123'};
  const baseGet=app.document.getElementById;
  app.document.getElementById=id=>id==='scan-code-results'?results:id==='scanInput'?input:baseGet(id);
  app.setTimeout=fn=>{tasks.push(fn);return tasks.length;};app.clearTimeout=()=>{};
  app.render=()=>renders++;app.fetch=()=>{throw Error('Typing must not read the database');};
  app.scheduleLaptopCodeSearch('ABC12');app.scheduleLaptopCodeSearch('ABC123');
  tasks[0]();assert.equal(results.innerHTML,'');tasks[1]();
  assert.match(results.innerHTML,/SUPPLIER000001ABC123/);assert.equal(input.value,'ABC123');assert.equal(renders,0);
  const previous=results.innerHTML;
  app.scheduleLaptopCodeSearch('112233');input.value='112233';vm.runInContext("STATE.currentScreen='home';",app);tasks[2]();
  assert.equal(results.innerHTML,previous);
});

test('10,000 candidates produce at most ten safe buttons and leave all device data unchanged',()=>{
  const app=fixture();app.large=Array.from({length:10000},(_,index)=>({sticker:'LONG-SUPPLIER-'+index+'-TAIL99',serial:'SN-'+index,merk:'Dell',model:'<img src=x onerror=alert(1)>',batchNummer:'BIG'}));
  vm.runInContext("BATCHES.splice(0,BATCHES.length,{id:'BIG',laptops:large});rebuildLaptopIndex();",app);
  const before=JSON.stringify(app.large);const html=app.renderLaptopCodeMatches('TAIL99');
  assert.equal(app.getLaptopCodeMatches('TAIL99').total,10000);
  assert.equal((html.match(/data-sticker=/g)||[]).length,10);assert.ok(Buffer.byteLength(html)<14000);
  assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.equal(JSON.stringify(app.large),before);
  vm.runInContext("STATE.scanCodeQuery='\"/><script>alert(1)</script>';",app);
  const input=app.renderLaptopScanInput();assert.doesNotMatch(input,/<script>/);assert.match(input,/inputmode="text"/);
  vm.runInContext("STATE.language='nl';",app);assert.equal(app.translateCopy('Found devices'),'Gevonden apparaten');
});

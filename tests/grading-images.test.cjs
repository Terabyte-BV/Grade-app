const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const {loadAppSandbox} = require('./app-sandbox.cjs');
const root = path.join(__dirname, '..');

function decisions(app) {
  return vm.runInContext(`Object.entries(CHOICE_DECISIONS).flatMap(([componentId, grades]) => {
    const visit = decision => [{...decision, componentId}, ...decision.options.flatMap(o => o.nextDecision ? visit(o.nextDecision) : [])];
    return Object.values(grades).flatMap(visit);
  })`, app);
}

test('all 81 current detailed choices resolve a real photo without the image mapper changing grading rules', () => {
  const app = loadAppSandbox();
  const before = vm.runInContext('JSON.stringify(CHOICE_DECISIONS)', app);
  let count = 0;
  for (const decision of decisions(app)) {
    const illustrated = app.withGradingExampleImages(decision);
    illustrated.options.forEach((option, i) => {
      count++;
      assert.ok(option.image, `${decision.componentId}: ${option.label}`);
      assert.ok(fs.existsSync(path.join(root, option.image)), option.image);
      assert.equal(option.impact, decision.options[i].impact);
      assert.equal(option.repairIssue, decision.options[i].repairIssue);
      assert.equal(option.nextDecision, decision.options[i].nextDecision);
      if (decision.options[i].image) {
        const revisions = vm.runInContext('GRADING_REASON_IMAGE_REVISIONS', app);
        assert.equal(option.image, revisions.get(decision.options[i].image) || decision.options[i].image);
      }
    });
  }
  assert.equal(count, 81);
  assert.equal(vm.runInContext('JSON.stringify(CHOICE_DECISIONS)', app), before);
});

test('32 newly generated examples are distinct, lightweight 1200 x 800 JPEGs', () => {
  const app = loadAppSandbox();
  const rows = vm.runInContext('GRADING_REASON_EXAMPLES', app);
  assert.equal(rows.length, 32);
  const hashes = new Set();
  const crypto = require('node:crypto');
  let total = 0;
  for (const [component, label] of rows) {
    const {options:[option]} = app.withGradingExampleImages({componentId:component, options:[{label}]});
    const bytes = fs.readFileSync(path.join(root, option.image));
    total += bytes.length;
    assert.ok(bytes.length < 250000, `${option.image}: ${bytes.length}`);
    assert.equal(bytes.readUInt16BE(0), 0xffd8);
    // JPEG SOF0/1/2: height and width follow precision byte.
    let offset=2, dimensions;
    while (offset < bytes.length) {
      assert.equal(bytes[offset], 0xff);
      const marker=bytes[offset+1];
      if ([0xc0,0xc1,0xc2].includes(marker)) { dimensions=[bytes.readUInt16BE(offset+7),bytes.readUInt16BE(offset+5)]; break; }
      offset+=2+bytes.readUInt16BE(offset+2);
    }
    assert.deepEqual(dimensions, [1200,800], option.image);
    hashes.add(crypto.createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(hashes.size, 32, 'Never reuse another defect photo for a missing example');
  assert.ok(total < 5_000_000, `New photos total ${total} bytes`);
});

test('guided and classic follow-ups render each photo and its correct zoom source', () => {
  const app = loadAppSandbox();
  vm.runInContext('STATE.currentGrading={inspectionObservationPaths:{}}', app);
  for (const decision of decisions(app)) {
    const options = app.withGradingExampleImages(decision).options;
    for (const render of [app.renderGuidedDecision,app.renderDecisionModal]) {
      const html = render(decision);
      for (const option of options) {
        assert.ok(html.includes(`src="${option.image}"`), `${decision.title}: ${option.label}`);
        assert.ok(html.includes(`data-preview-src="${option.image}"`));
      }
      assert.equal((html.match(/data-decision-option=/g)||[]).length, decision.options.length);
    }
  }
});

test('functional examples have an honest test reminder, not a visual diagnosis', () => {
  const app = loadAppSandbox();
  vm.runInContext('STATE.currentGrading={inspectionObservationPaths:{}}', app);
  const options=app.withGradingExampleImages({componentId:'touchpad',options:[{label:'Touchpad werkt niet'}]}).options;
  assert.equal(options[0].exampleFunctionalTest,true);
  assert.match(app.renderGuidedDecision({componentId:'touchpad',options,title:'Test'}), /test the function on the real laptop/);
  vm.runInContext("STATE.language='nl'", app);
  assert.equal(app.translateCopy('Example only: test the function on the real laptop.'), 'Dit is een voorbeeld: test de werking op de echte laptop.');
  const review={type:'grade-review',options:[{label:'Geen beeld'}]};
  assert.equal(app.withGradingExampleImages(review),review);
});

test('the prompt ledger follows the selected image revisions in the app', () => {
  const app = loadAppSandbox();
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs/grading-example-images.json'), 'utf8'));
  assert.equal(ledger.assets.length, 32);
  for (const entry of ledger.assets) {
    const decision = app.withGradingExampleImages({componentId:entry.component,options:[{label:entry.choice}]});
    const revisions = vm.runInContext('GRADING_REASON_IMAGE_REVISIONS', app);
    assert.equal(decision.options[0].image, revisions.get(entry.image) || entry.image, entry.choice);
    assert.ok(entry.prompt && fs.existsSync(path.join(root, entry.reference)));
    if (entry.previousImage) assert.ok(fs.existsSync(path.join(root, entry.previousImage)));
  }
});

test('all follow-up choices have a reviewed image and close-up revisions stay UI-only', () => {
  const app = loadAppSandbox();
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs/grading-detail-image-review.json'), 'utf8'));
  const revisions = vm.runInContext('GRADING_REASON_IMAGE_REVISIONS', app);
  assert.equal(ledger.review.length, 61);
  assert.equal(ledger.assets.length, 20);
  const latest = JSON.parse(fs.readFileSync(path.join(root, 'docs/grading-x-image-revisions.json'), 'utf8'));
  const superseded = new Map(latest.assets.map(entry => [entry.previousImage, entry.image]));
  assert.equal(revisions.size, 28);
  for (const entry of ledger.assets) {
    assert.ok(entry.prompt.includes('close-up') && fs.existsSync(path.join(root, entry.reference)));
    assert.ok(fs.existsSync(path.join(root, entry.image)), entry.image);
    assert.ok(fs.statSync(path.join(root, entry.image)).size < 250000);
    for (const source of entry.previousImages) {
      assert.equal(revisions.get(source), superseded.get(entry.image) || entry.image);
      assert.ok(fs.existsSync(path.join(root, source)), 'Retain original photo: ' + source);
    }
  }
  for (const row of ledger.review) {
    assert.equal(superseded.get(row.selectedImage) || revisions.get(row.selectedImage) || row.selectedImage, revisions.get(row.image) || row.image);
  }
  const unrelated = {componentId:'bezel',options:[{label:'Unrelated',image:'unchanged.jpg',impact:'b-minus'}]};
  assert.equal(app.withGradingExampleImages(unrelated).options[0], unrelated.options[0]);
  const review = {type:'grade-review',options:[{image:ledger.assets[0].previousImages[0]}]};
  assert.equal(app.withGradingExampleImages(review), review);
});

test('historical photo revisions are retained; explicit Oct12 policy overrides are applied', () => {
  const app = loadAppSandbox();
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs/grading-x-image-revisions.json'), 'utf8'));
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'docs/grading-cover-size-policy.json'), 'utf8'));
  assert.equal(ledger.assets.length, 10);
  assert.equal(ledger.assets.filter(entry => entry.expectedImpact === 'x').length, 8);
  for (const entry of ledger.assets) {
    const decision = decisions(app).find(row => row.componentId === entry.component && row.options.some(option => option.label === entry.choice));
    const override = policy.overrides.find(row => row.component === entry.component && row.choice === entry.choice);
    if (override?.retired) {
      assert.ok(!decision, 'Retired duplicate must not remain a visible option');
      const replacement = decisions(app).flatMap(row => row.componentId === entry.component ? row.options : []).find(option => option.label === override.replacement);
      assert.equal(replacement.impact, override.impact);
      assert.ok(fs.existsSync(path.join(root, entry.image)), 'Retain historical image');
      continue;
    }
    assert.ok(decision, entry.choice);
    const original = decision.options.find(option => option.label === entry.choice);
    const selected = app.withGradingExampleImages(decision).options.find(option => option.label === entry.choice);
    assert.equal(selected.image, override?.image || entry.image);
    assert.equal(selected.impact, override?.impact || entry.expectedImpact);
    assert.equal(selected.repairRoute, original.repairRoute);
    assert.equal(selected.afterRepairImpact, original.afterRepairImpact);
    assert.ok(fs.existsSync(path.join(root, entry.previousImage)), 'Retain previous version');
    assert.ok(fs.statSync(path.join(root, entry.image)).size < 250000);
    assert.ok(entry.prompt && fs.existsSync(path.join(root, entry.reference)));
  }
});

test('bottom cover wear and actual fracture use separate regenerated photos without score changes', () => {
  const app = loadAppSandbox();
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs/grading-bottom-image-revisions.json'), 'utf8'));
  const original = vm.runInContext('CHOICE_DECISIONS.onderkant.C', app);
  const selected = app.withGradingExampleImages({...original, componentId:'onderkant'});
  assert.equal(ledger.assets.length, 2);
  assert.notEqual(selected.options[0].image, selected.options[1].image);
  assert.deepEqual(Array.from(selected.options, option => option.impact), ['b', 'c']);
  for (const entry of ledger.assets) {
    const option = selected.options.find(row => row.label === entry.choice);
    assert.equal(option.image, entry.image);
    assert.equal(option.impact, entry.expectedImpact);
    assert.ok(fs.existsSync(path.join(root, entry.previousImage)), 'Keep previous asset for rollback');
    assert.ok(fs.existsSync(path.join(root, entry.reference)) && entry.prompt);
    assert.ok(fs.statSync(path.join(root, entry.image)).size < 250000);
  }
  assert.equal(original.options[0].image, ledger.assets[0].previousImage);
  assert.equal(original.options[1].image, ledger.assets[1].previousImage);
});

test('photo loading stays bounded to the active question with compact markup and cacheable files', () => {
  const app = loadAppSandbox();
  vm.runInContext('STATE.currentGrading={inspectionObservationPaths:{}}', app);
  for (const decision of decisions(app)) {
    for (const render of [app.renderGuidedDecision, app.renderDecisionModal]) {
      const html = render(decision);
      const sources = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map(match => match[1]);
      assert.equal(sources.length, decision.options.length, 'Load only the active question, not nested questions');
      assert.ok(sources.length <= 5, 'Do not render the whole photo collection');
      const bytes = sources.reduce((total, src) => total + fs.statSync(path.join(root, src)).size, 0);
      assert.ok(bytes < 650000, `${decision.title}: ${bytes} bytes in active photos`);
      assert.ok(Buffer.byteLength(html) < 9000, 'Keep each question DOM compact');
      assert.equal((html.match(/decoding="async"/g) || []).length, sources.length);
      assert.ok(!html.includes('data:image/'), 'Never embed large image payloads in screen markup');
    }
  }
  const mapping = fs.readFileSync(path.join(root, 'assets/grading-example-images.js'), 'utf8');
  assert.ok(Buffer.byteLength(mapping) < 8000);
  assert.doesNotMatch(mapping, /new Image\(|fetch\(|setInterval\(/, 'Mapping must not fetch/preload an archive or call the database');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const header = config.headers.find(rule => rule.source.includes('/assets/') && rule.source.includes('jpg'));
  assert.ok(header.headers.some(h => h.key === 'Cache-Control' && /public, max-age=\d+/.test(h.value)));
});

test('warmup fetches only the next main comparison photos once, never all follow-up photos', () => {
  const app = loadAppSandbox();
  const requested = [];
  app.Image = class {
    set src(value) { requested.push(value); }
  };
  vm.runInContext('STATE.currentGrading={huidigeIndex:0,inspectionObservationPaths:{}}', app);
  app.preloadNextVisualAssets();
  assert.ok(requested.length > 0 && requested.length <= 8);
  const followup = JSON.parse(fs.readFileSync(path.join(root, 'docs/grading-detail-image-review.json'), 'utf8')).assets.map(row => row.image);
  assert.ok(requested.every(src => !followup.includes(src)));
  const count = requested.length;
  app.preloadNextVisualAssets();
  assert.equal(requested.length, count, 'Do not fetch warmup photos again after repaint');
});

function sizePolicyFixture(componentId) {
  const app = loadAppSandbox();
  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    startTestGrading('beginner');
    STATE.currentGrading.coverCleaning = 'cleaned';
    STATE.currentGrading.touchChecked = true;
    STATE.currentGrading.inspectionDialog = null;
    getGradingOnderdelen().forEach(component => {
      STATE.currentGrading.keuzes[component.id] = 'A';
      STATE.currentGrading.inspectionChecks[component.id] = true;
    });
    STATE.currentGrading.huidigeIndex = getGradingOnderdelen().findIndex(component => component.id === '${componentId}');
  `, app);
  return app;
}

test('lid and edge size decisions include exactly 3 cm in C and only above 3 cm in X', async () => {
  for (const componentId of ['bovenkap', 'randen']) {
    for (const entry of ['C', 'D']) {
      for (const selectedSize of [0, 1]) {
        const app = sizePolicyFixture(componentId);
        app.applyComponentChoice(componentId, entry, false);
        if (entry === 'C') {
          if (componentId === 'bovenkap') await app.resolvePendingDecision(1);
          const index = vm.runInContext('STATE.pendingDecision.options.findIndex(option => option.nextDecision && option.label.includes("gebroken"))', app);
          await app.resolvePendingDecision(index);
          assert.equal(vm.runInContext('STATE.currentGrading.inspectionChecks.' + componentId, app), false);
        } else {
          // X has no C choices. The measured small opening is reachable only from C.
          if (selectedSize === 0) continue;
          const options = vm.runInContext('STATE.pendingDecision.options', app);
          assert.ok(options.every(option => option.impact === 'x' && option.choiceLetter === 'D'));
          await app.resolvePendingDecision(0);
          app.finishGrading();
          assert.equal(vm.runInContext('STATE.currentGrading.result.eindgrade', app), 'D');
          continue;
        }
        assert.match(app.__appElement.innerHTML, /Up to and including 3 cm/);
        const sizeOptions = vm.runInContext('STATE.pendingDecision.options.slice(0,2)', app);
        assert.equal(sizeOptions[0].label, 'Opening tot en met 3 cm');
        assert.equal(sizeOptions[1].label, 'Opening groter dan 3 cm');
        await app.resolvePendingDecision(selectedSize);
        assert.equal(vm.runInContext('STATE.pendingDecision', app), null);
        assert.equal(vm.runInContext('STATE.currentGrading.keuzes.' + componentId, app), selectedSize ? 'D' : 'C');
        app.finishGrading();
        const result = vm.runInContext('STATE.currentGrading.result', app);
        assert.equal(result.eindgrade, selectedSize ? 'D' : 'C');
        if (selectedSize) {
          assert.equal(result.repairPolicy.remainsX, true);
          assert.ok(!result.gradeAfterRepair, 'Large opening must not silently become C after a theoretical repair');
        } else {
          assert.ok(!result.gradeAfterRepair);
          assert.deepEqual(Object.keys(vm.runInContext('STATE.currentGrading.repairIssues', app)), []);
        }
      }
    }
  }
});

test('sharp edges and permanent side bend are direct C, without inherited X repair routes', async () => {
  for (const [componentId, label] of [['bovenkap', 'Scherpe rand'], ['randen', 'Scherpe rand'], ['randen', 'Niet herstelbaar verbogen']]) {
    const app = sizePolicyFixture(componentId);
    app.applyComponentChoice(componentId, 'C', false);
    if (componentId === 'bovenkap') await app.resolvePendingDecision(1);
    const index = vm.runInContext(`STATE.pendingDecision.options.findIndex(option => option.label === ${JSON.stringify(label)})`, app);
    await app.resolvePendingDecision(index);
    app.finishGrading();
    assert.equal(vm.runInContext('STATE.currentGrading.result.eindgrade', app), 'C');
    assert.ok(!vm.runInContext('STATE.currentGrading.result.gradeAfterRepair', app));
    assert.deepEqual(Object.keys(vm.runInContext('STATE.currentGrading.repairIssues', app)), []);
  }
});

test('photo-local broken-corner shortcuts cannot bypass the size follow-up', async () => {
  for (const [componentId, triggerId] of [['bovenkap', 'barst_boven'], ['bovenkap', 'hoek_boven'], ['randen', 'hoek_randen']]) {
    const app = sizePolicyFixture(componentId);
    await app.selectGuidedPhotoFinding(triggerId, componentId);
    assert.match(vm.runInContext('STATE.pendingDecision.title', app), /hoe groot is de opening/);
    assert.equal(vm.runInContext('STATE.currentGrading.inspectionChecks.' + componentId, app), false);
    app.finishGrading();
    assert.equal(vm.runInContext('STATE.currentGrading.result', app), null);
    await app.resolvePendingDecision(1);
    app.finishGrading();
    assert.equal(vm.runInContext('STATE.currentGrading.result.eindgrade', app), 'D');
  }
  const app = sizePolicyFixture('randen');
  await app.selectGuidedPhotoFinding('scherp_randen', 'randen');
  app.finishGrading();
  assert.equal(vm.runInContext('STATE.currentGrading.result.eindgrade', app), 'C');
});

test('slight lid bending is C; inability to close uses direct repair with no released grade', async () => {
  const closed = sizePolicyFixture('bovenkap');
  closed.applyComponentChoice('bovenkap', 'C', false);
  await closed.resolvePendingDecision(1);
  await closed.resolvePendingDecision(2);
  closed.finishGrading();
  assert.equal(vm.runInContext('STATE.currentGrading.result.eindgrade', closed), 'C');
  assert.ok(!vm.runInContext('STATE.currentGrading.result.gradeAfterRepair', closed));

  const cannotClose = sizePolicyFixture('bovenkap');
  await cannotClose.selectGuidedPhotoFinding('verbuiging_boven', 'bovenkap');
  assert.equal(vm.runInContext('STATE.currentGrading.repairActions.bovenkap.repairRoute', cannotClose), 'direct');
  cannotClose.finishGrading();
  vm.runInContext('render()', cannotClose);
  assert.equal(vm.runInContext('STATE.currentGrading.result.repairLabelType', cannotClose), 'direct');
  assert.match(cannotClose.__appElement.innerHTML, /Determine the grade after repair/);
  assert.match(cannotClose.__appElement.innerHTML, /result-grade-letter">\?/);
});

test('correcting a measured opening removes only that rejection, retaining independent defects', async () => {
  const app = sizePolicyFixture('randen');
  app.applyComponentChoice('randen', 'D', false);
  await app.resolvePendingDecision(0);
  vm.runInContext(`STATE.currentGrading.inspectionRepairs.randen.push({ componentId:'randen', issue:'USB defect', repairRoute:'production', repairSeverity:'light', afterRepairImpact:'a-plus' })`, app);
  app.applyComponentChoice('randen', 'C', false);
  await app.resolvePendingDecision(2);
  await app.resolvePendingDecision(0);
  assert.equal(vm.runInContext('STATE.currentGrading.keuzes.randen', app), 'C');
  assert.deepEqual(Array.from(vm.runInContext('STATE.currentGrading.inspectionRepairs.randen', app), action => action.issue), ['USB defect']);

  const lid = sizePolicyFixture('bovenkap');
  await lid.selectGuidedPhotoFinding('verbuiging_boven', 'bovenkap');
  lid.applyComponentChoice('bovenkap', 'C', false);
  await lid.resolvePendingDecision(1);
  await lid.resolvePendingDecision(2);
  lid.finishGrading();
  assert.equal(vm.runInContext('STATE.currentGrading.result.eindgrade', lid), 'C');
  assert.equal(vm.runInContext('STATE.currentGrading.inspectionRepairs.bovenkap.length', lid), 0);
});

test('opening guidance is translated in guided and classic flows, no automatic supplier grade', async () => {
  const app = sizePolicyFixture('randen');
  app.applyComponentChoice('randen', 'C', false);
  await app.resolvePendingDecision(2);
  assert.match(app.__appElement.innerHTML, /Do not measure the crack length/);
  const decision = vm.runInContext('STATE.pendingDecision', app);
  assert.match(app.renderDecisionModal(decision), /Do not measure the crack length/);
  vm.runInContext("STATE.language='nl'; render()", app);
  assert.match(app.translateCopy(decision.measurementHint), /Tot en met 3 cm is C; groter dan 3 cm is X/);
  assert.equal(app.getGuidedSupplierAdviceLetter('randen', 'Zijkant gebroken'), 'C');
  assert.equal(app.getGuidedSupplierAdviceLetter('bovenkap', 'Scherpe rand'), 'C');
  assert.equal(app.getGuidedSupplierAdviceLetter('lcd', 'Scherm gebroken'), 'D');
});

test('new policy leaves saved historical grades untouched and refuses old unfinished rule drafts', () => {
  const app = sizePolicyFixture('bovenkap');
  vm.runInContext(`
    STATE.history = [{ id:'old-grade', laptop_sticker:'old-laptop', result:{ eindgrade:'D', rulesVersion:'2026-10-03-independent-wear-after-repair-v1' }, repairIssues:{bovenkap:'Bovenkap scherpe rand'} }];
  `, app);
  const original = vm.runInContext('JSON.stringify(STATE.history)', app);
  const key = app.guidedDraftKey();
  app.localStorage.setItem(key, JSON.stringify({ rulesVersion:'2026-10-03-independent-wear-after-repair-v1', savedAt:Date.now(), grading:{ inspectionVersion:'20261003-observations-v2', huidigeIndex:8 }, pendingDecision:{ title:'Old X reason' } }));
  app.restoreGuidedDraft();
  assert.equal(vm.runInContext('STATE.currentGrading.huidigeIndex', app), 0);
  assert.equal(vm.runInContext('STATE.pendingDecision', app), null);
  assert.equal(vm.runInContext('JSON.stringify(STATE.history)', app), original);
  assert.equal(app.findRepairOption('bovenkap','Bovenkap gebroken').afterRepairImpact, 'c');
  assert.equal(app.findRepairOption('randen','Zijkant gebroken').afterRepairImpact, 'c');
});

test('new lid and edge illustrations have saved prompts, independent JPEGs and compact question budgets', () => {
  const app = loadAppSandbox();
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs/grading-lid-size-examples.json'), 'utf8'));
  const edges = JSON.parse(fs.readFileSync(path.join(root, 'docs/grading-edge-size-examples.json'), 'utf8'));
  const hashes = new Set();
  for (const asset of [...ledger.assets, ...edges.assets]) {
    assert.ok(asset.prompt && fs.existsSync(path.join(root, asset.reference)));
    const bytes = fs.readFileSync(path.join(root, asset.image));
    assert.ok(bytes.length < 180000, 'Do not ship multi-MB source PNGs');
    assert.equal(bytes.readUInt16BE(0), 0xffd8);
    hashes.add(require('node:crypto').createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(hashes.size, 5, 'Each damage example is a separate photograph');
  assert.equal(ledger.discardedCandidates.length, 4);
  assert.equal(ledger.assets[0].annotation, '3 cm');
  assert.equal(ledger.assets[1].annotation, '5 cm');
  assert.equal(ledger.comparisonPair.smallAnnotation, '3 cm');
  assert.equal(ledger.comparisonPair.largeAnnotation, '5 cm');
  assert.equal(edges.assets[0].annotation, '3 cm');
  assert.equal(edges.assets[0].image, 'assets/dell-grading-fast/randen-opening-klein-3cm-v1-ai.jpg');
  const active = decisions(app).flatMap(decision => app.withGradingExampleImages(decision).options.map(option => option.image));
  for (const asset of [...ledger.assets, ...edges.assets]) assert.ok(active.includes(asset.image));
  for (const rejected of edges.supersedes) assert.ok(!active.includes(rejected), 'Rejected artificial holes never become visible');
  for (const retired of edges.discardedCandidates) assert.ok(!active.includes(retired.image), 'Old 1–2cm example is no longer active');
});

test('lid C separates wear from structural damage without changing the wear impacts', async () => {
  const app = sizePolicyFixture('bovenkap');
  app.applyComponentChoice('bovenkap', 'C', false);
  const options = vm.runInContext('STATE.pendingDecision.options', app);
  assert.deepEqual(Array.from(options, option => option.label), ['Krassen, lakschade of deuken', 'Breuken/verbuiging']);
  assert.deepEqual(Array.from(options[0].nextDecision.options, option => option.impact), ['b-minus', 'c', 'c']);
  await app.resolvePendingDecision(1);
  assert.deepEqual(Array.from(vm.runInContext('STATE.pendingDecision.options', app), option => option.label), ['Bovenkap gebroken', 'Scherpe rand', 'Licht verbogen, sluit goed']);
  assert.equal(vm.runInContext('STATE.currentGrading.inspectionChecks.bovenkap', app), false);
  const sticker = vm.runInContext('STATE.currentLaptop.sticker', app);
  app.cancelPendingDecision();
  assert.equal(vm.runInContext('STATE.currentLaptop.sticker', app), sticker);
  assert.equal(vm.runInContext('STATE.pendingDecision', app), null);
  app.finishGrading();
  assert.equal(vm.runInContext('STATE.currentGrading.result', app), null);
});

test('X entry questions never offer a C-sized opening or a slight bend', () => {
  for (const componentId of ['bovenkap', 'randen']) {
    const app = sizePolicyFixture(componentId);
    app.applyComponentChoice(componentId, 'D', false);
    const options = vm.runInContext('STATE.pendingDecision.options', app);
    assert.ok(options.every(option => option.impact === 'x' && option.choiceLetter === 'D'));
    assert.ok(options.every(option => !/tot en met|Licht verbogen/.test(option.label)));
  }
});

test('faulty ports belong only to X and require functional testing and direct repair', async () => {
  const cEntry = sizePolicyFixture('randen');
  cEntry.applyComponentChoice('randen', 'C', false);
  assert.ok(vm.runInContext('STATE.pendingDecision.options.every(option => option.label !== "Poorten defect")', cEntry));
  for (const entry of ['D']) {
    const app = sizePolicyFixture('randen');
    app.applyComponentChoice('randen', entry, false);
    const index = vm.runInContext('STATE.pendingDecision.options.findIndex(option => option.label === "Poorten defect")', app);
    assert.ok(index >= 0);
    assert.match(app.__appElement.innerHTML, /test the function on the real laptop/);
    await app.resolvePendingDecision(index);
    assert.equal(vm.runInContext('STATE.currentGrading.keuzes.randen', app), 'D');
    app.finishGrading();
    assert.equal(vm.runInContext('STATE.currentGrading.result.repairLabelType', app), 'direct');
    vm.runInContext('render()', app);
    assert.match(app.__appElement.innerHTML, /Determine the grade after repair/);
    assert.match(app.__appElement.innerHTML, /result-grade-letter">\?/);
    // Re-selecting the same defect must not inflate the repair count.
    vm.runInContext("STATE.currentScreen='grading_beginner'", app);
    app.applyComponentChoice('randen', entry, false);
    await app.resolvePendingDecision(index);
    assert.equal(vm.runInContext('STATE.currentGrading.inspectionRepairs.randen.length', app), 1);
  }
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs/grading-edge-ports-example.json'), 'utf8'));
  assert.ok(ledger.prompt && fs.existsSync(path.join(root, ledger.reference)));
  assert.ok(fs.statSync(path.join(root, ledger.image)).size < 180000);
});

test('bottom-cover fracture requires size confirmation from C and X: exactly 5 cm C, above 5 repair', async () => {
  for (const entry of ['C', 'D']) {
    for (const size of [0, 1]) {
      const app = sizePolicyFixture('onderkant');
      app.applyComponentChoice('onderkant', entry, false);
      const index = vm.runInContext('STATE.pendingDecision.options.findIndex(option => option.nextDecision)', app);
      await app.resolvePendingDecision(index);
      assert.match(vm.runInContext('STATE.pendingDecision.title', app), /Onderkant: hoe groot/);
      assert.equal(vm.runInContext('STATE.currentGrading.inspectionChecks.onderkant', app), false);
      app.finishGrading();
      assert.equal(vm.runInContext('STATE.currentGrading.result', app), null);
      const options = vm.runInContext('STATE.pendingDecision.options', app);
      assert.equal(options[0].label, 'Breuk/opening tot en met 5 cm');
      assert.equal(options[1].label, 'Breuk/opening groter dan 5 cm');
      assert.match(app.__appElement.innerHTML, /Up to and including 5 cm is C/);
      await app.resolvePendingDecision(size);
      assert.equal(vm.runInContext('STATE.currentGrading.keuzes.onderkant', app), size ? 'D' : 'C');
      app.finishGrading();
      const result = vm.runInContext('STATE.currentGrading.result', app);
      assert.equal(result.eindgrade, size ? 'D' : 'C');
      if (size) assert.equal(result.repairLabelType, 'direct');
      else { assert.equal(result.score, 30); assert.ok(!result.gradeAfterRepair); }
    }
  }
});

test('bottom fracture shortcuts require measurement and correcting size cannot clear an independent safety risk', async () => {
  for (const trigger of ['barst_onder', 'hoek_onder']) {
    const app = sizePolicyFixture('onderkant');
    await app.selectGuidedPhotoFinding(trigger, 'onderkant');
    assert.match(vm.runInContext('STATE.pendingDecision.title', app), /Onderkant: hoe groot/);
    await app.resolvePendingDecision(1);
    app.applyComponentChoice('onderkant', 'C', false);
    await app.resolvePendingDecision(1);
    await app.resolvePendingDecision(0);
    assert.equal(vm.runInContext('STATE.currentGrading.inspectionRepairs.onderkant.length', app), 0);
    app.finishGrading();
    assert.equal(vm.runInContext('STATE.currentGrading.result.eindgrade', app), 'C');
  }
  const app = sizePolicyFixture('onderkant');
  app.applyComponentChoice('onderkant', 'D', false);
  await app.resolvePendingDecision(2); // independent unsafe, sharp broken opening
  app.applyComponentChoice('onderkant', 'C', false);
  await app.resolvePendingDecision(1);
  await app.resolvePendingDecision(0);
  app.finishGrading();
  assert.equal(vm.runInContext('STATE.currentGrading.result.eindgrade', app), 'D');
  assert.equal(vm.runInContext('STATE.currentGrading.result.repairLabelType', app), 'reject');
  assert.equal(app.findRepairOption('onderkant', 'Onderkant gebroken').afterRepairImpact, 'x');
});

test('bottom safety photo is a compact new illustration with saved prompt; measurement guidance is translated', async () => {
  const app = sizePolicyFixture('onderkant');
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs/grading-bottom-size-policy.json'), 'utf8'));
  const option = vm.runInContext('CHOICE_DECISIONS.onderkant.D.options[2]', app);
  assert.equal(option.image, ledger.safetyPhoto.image);
  assert.ok(ledger.safetyPhoto.prompt && fs.existsSync(path.join(root, ledger.safetyPhoto.reference)));
  assert.ok(fs.statSync(path.join(root, option.image)).size < 180000);
  assert.notEqual(option.image, 'assets/dell-grading-fast/onderkant-veiligheidsrisico-v2-ai.jpg');
  app.applyComponentChoice('onderkant', 'C', false);
  await app.resolvePendingDecision(1);
  const decision = vm.runInContext('STATE.pendingDecision', app);
  assert.match(app.renderDecisionModal(decision), /Up to and including 5 cm is C/);
  vm.runInContext("STATE.language='nl'", app);
  assert.match(app.translateCopy(decision.measurementHint), /Tot en met 5 cm is C/);
  assert.match(app.translateCopy(decision.measurementHint), /ongeacht de grootte/);
});

test('palmrest C has four distinct observations; cosmetic options each count 30 points', async () => {
  for (const index of [0, 1]) {
    const app = sizePolicyFixture('palmrest');
    app.applyComponentChoice('palmrest', 'C', false);
    const options = vm.runInContext('STATE.pendingDecision.options', app);
    assert.deepEqual(Array.from(options, option => option.label), ['Zware krassen', 'Plakkerige coating / lakschade', 'Palmrest gebroken', 'Hoek ontbreekt']);
    assert.equal(new Set(Array.from(options, option => option.image)).size, 4);
    assert.equal(vm.runInContext('STATE.currentGrading.inspectionChecks.palmrest', app), false);
    await app.resolvePendingDecision(index);
    app.finishGrading();
    assert.equal(vm.runInContext('STATE.currentGrading.result.eindgrade', app), 'C');
    assert.equal(vm.runInContext('STATE.currentGrading.result.score', app), 30);
  }
});

test('palmrest breaks and missing corners require size confirmation: exactly 3 cm C, above 3 X', async () => {
  for (const index of [2, 3]) {
    for (const size of [0, 1]) {
      const app = sizePolicyFixture('palmrest');
      app.applyComponentChoice('palmrest', 'C', false);
      await app.resolvePendingDecision(index);
      assert.match(vm.runInContext('STATE.pendingDecision.title', app), /Palmrest: hoe groot/);
      assert.equal(vm.runInContext('STATE.pendingDecision.options[0].choiceLetter', app), 'C');
      assert.equal(vm.runInContext('STATE.pendingDecision.options[1].choiceLetter', app), 'D');
      app.finishGrading();
      assert.equal(vm.runInContext('STATE.currentGrading.result', app), null);
      await app.resolvePendingDecision(size);
      app.finishGrading();
      const result = vm.runInContext('STATE.currentGrading.result', app);
      assert.equal(result.eindgrade, size ? 'D' : 'C');
      if (size) {
        assert.equal(result.repairLabelType, 'reject');
        assert.ok(!result.gradeAfterRepair);
      } else { assert.equal(result.score, 30); assert.ok(!result.gradeAfterRepair); }
    }
  }
});

test('palmrest X offers only large defects and safety; corrections preserve independent safety findings', async () => {
  for (const index of [0, 1]) {
    const app = sizePolicyFixture('palmrest');
    app.applyComponentChoice('palmrest', 'D', false);
    const options = vm.runInContext('STATE.pendingDecision.options', app);
    assert.ok(options.every(option => option.impact === 'x' && option.choiceLetter === 'D'));
    assert.ok(options.every(option => !/tot en met/.test(option.label)));
    await app.resolvePendingDecision(index);
    app.applyComponentChoice('palmrest', 'C', false);
    await app.resolvePendingDecision(index + 2);
    await app.resolvePendingDecision(0);
    assert.equal(vm.runInContext('STATE.currentGrading.inspectionRepairs.palmrest.length', app), 0);
    app.finishGrading();
    assert.equal(vm.runInContext('STATE.currentGrading.result.eindgrade', app), 'C');
  }
  const app = sizePolicyFixture('palmrest');
  app.applyComponentChoice('palmrest', 'D', false);
  await app.resolvePendingDecision(2);
  app.applyComponentChoice('palmrest', 'C', false);
  await app.resolvePendingDecision(2);
  await app.resolvePendingDecision(0);
  app.finishGrading();
  assert.equal(vm.runInContext('STATE.currentGrading.result.eindgrade', app), 'D');
  assert.equal(vm.runInContext('STATE.currentGrading.result.repairLabelType', app), 'reject');
  assert.equal(app.findRepairOption('palmrest', 'Palmrest gebroken').afterRepairImpact, 'c');
  assert.equal(app.findRepairOption('palmrest', 'Palmrest hoek ontbreekt').afterRepairImpact, 'c');
});

test('palmrest crack shortcut cannot bypass size; sticky coating maps to coating rather than scratches', async () => {
  const app = sizePolicyFixture('palmrest');
  await app.selectGuidedPhotoFinding('barst_palm', 'palmrest');
  assert.match(vm.runInContext('STATE.pendingDecision.title', app), /Palmrest: hoe groot/);
  assert.equal(vm.runInContext('STATE.currentGrading.inspectionChecks.palmrest', app), false);
  vm.runInContext("STATE.language='nl'", app);
  assert.match(app.translateCopy(vm.runInContext('STATE.pendingDecision.measurementHint', app)), /Tot en met 3 cm is C/);
  const sticky = sizePolicyFixture('palmrest');
  await sticky.selectGuidedPhotoFinding('plakkerig_palm', 'palmrest');
  assert.equal(vm.runInContext('STATE.pendingDecision', sticky), null);
  assert.equal(vm.runInContext('STATE.currentGrading.inspectionObservationPaths.palmrest[0]', sticky), 'Plakkerige coating / lakschade');
});

test('palmrest new photos have saved prompts and independently encoded compact JPEGs', () => {
  const app = loadAppSandbox();
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs/grading-palmrest-size-policy.json'), 'utf8'));
  const active = decisions(app).filter(d => d.componentId === 'palmrest').flatMap(d => app.withGradingExampleImages(d).options.map(o => o.image));
  const hashes = new Set();
  assert.equal(ledger.assets.length, 7);
  for (const asset of ledger.assets) {
    assert.ok(asset.prompt && fs.existsSync(path.join(root, asset.reference)));
    assert.ok(active.includes(asset.image));
    const bytes = fs.readFileSync(path.join(root, asset.image));
    assert.equal(bytes.readUInt16BE(0), 0xffd8);
    assert.ok(bytes.length < 200000, 'Compact JPEG only, never multi-MB generated source');
    hashes.add(require('node:crypto').createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(hashes.size, 7);
});

test('broken bezel is C only; loose frame and sharp edge retain their distinct X repair routes', async () => {
  const app = sizePolicyFixture('bezel');
  app.applyComponentChoice('bezel', 'C', false);
  await app.resolvePendingDecision(1);
  app.finishGrading();
  assert.equal(vm.runInContext('STATE.currentGrading.result.eindgrade', app), 'C');
  assert.equal(vm.runInContext('STATE.currentGrading.result.score', app), 30);
  assert.ok(!vm.runInContext('STATE.currentGrading.result.gradeAfterRepair', app));
  for (const index of [0, 1]) {
    const x = sizePolicyFixture('bezel');
    x.applyComponentChoice('bezel', 'D', false);
    assert.deepEqual(Array.from(vm.runInContext('STATE.pendingDecision.options', x), option => option.label), ['Schermrand los', 'Scherpe rand']);
    await x.resolvePendingDecision(index);
    x.finishGrading();
    const result = vm.runInContext('STATE.currentGrading.result', x);
    assert.equal(vm.runInContext('STATE.currentGrading.keuzes.bezel', x), 'D');
    assert.equal(result.repairLabelType, index ? 'reject' : 'direct');
    // Direct repair retains the existing C-after-repair estimate, not a released grade.
    if (index) assert.equal(result.eindgrade, 'D');
    else {
      vm.runInContext('render()', x);
      assert.match(x.__appElement.innerHTML, /Determine the grade after repair/);
      assert.match(x.__appElement.innerHTML, /result-grade-letter">\?/);
    }
  }
  assert.equal(app.findRepairOption('bezel', 'Schermrand gebroken').afterRepairImpact, 'c');
  assert.equal(vm.runInContext("ONDERDELEN.find(p => p.id === 'bezel').keuzes[3].detail", app), 'Loose frame or dangerous sharp edges');
  vm.runInContext("STATE.language='nl'", app);
  assert.equal(app.translateCopy('Loose frame or dangerous sharp edges'), 'Losse schermrand of gevaarlijke scherpe randen');
});

test('supplier broken-bezel and unmeasured palmrest hints advise C; separate safety and loose frame advise X', () => {
  const app = loadAppSandbox();
  assert.equal(app.getGuidedSupplierAdviceLetter('bezel', 'Schermrand zwaar gebroken'), 'C');
  assert.equal(app.getGuidedSupplierAdviceLetter('bezel', 'Schermrand los'), 'D');
  assert.equal(app.getGuidedSupplierAdviceLetter('bezel', 'Schermrand gebroken, scherpe rand'), 'D');
  assert.equal(app.getGuidedSupplierAdviceLetter('palmrest', 'Palmrest gebroken'), 'C');
  assert.equal(app.getGuidedSupplierAdviceLetter('palmrest', 'Palmrest ontbrekende hoek'), 'C');
  assert.equal(app.getGuidedSupplierAdviceLetter('palmrest', 'Palmrest gebroken met veiligheidsrisico'), 'D');
  assert.equal(app.getGuidedSupplierAdviceLetter('lcd', 'Scherm gebroken'), 'D');
});

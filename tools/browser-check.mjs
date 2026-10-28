// Optional dependency-free headless Chrome check. Start `npm run dev` first.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inspect, patch } from '../src/graph.mjs';
import { demo, graph, variableNode, asset, container } from '../src/demo.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = path.join(root, '.artifacts', 'browser');
await fs.mkdir(artifacts, { recursive: true });
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'miliastra-fix-browser-'));
const executable = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome');
const url = process.env.PREVIEW_URL || 'http://127.0.0.1:4178/dist/index.html';
const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let socket, session, sequence = 0;
const pending = new Map(), errors = [], requests = [], checks = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(60); }
  throw new Error(`Timed out: ${message}`);
}
function command(method, params = {}, browserScope = false) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 12000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params, ...(!browserScope && session ? { sessionId: session } : {}) }));
  });
}
async function js(expression) {
  const result = await command('Runtime.evaluate', { expression: `(async()=>{${expression}})()`, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + JSON.stringify(result.exceptionDetails.exception?.description));
  return result.result.value;
}
const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click();`);
async function screenshot(name) {
  const result = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(path.join(artifacts, name + '.png'), Buffer.from(result.data, 'base64'));
}
async function upload(filename, selector = '#file') {
  const { root } = await command('DOM.getDocument');
  const { nodeId } = await command('DOM.querySelector', { nodeId: root.nodeId, selector });
  await command('DOM.setFileInputFiles', { nodeId, files: [filename] });
}
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Headless Chrome did not start. Set CHROME_PATH.')), 15000);
    browser.on('error', error => { clearTimeout(timeout); reject(error); });
    browser.stderr.on('data', data => { output += data.toString(); const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.id && pending.has(event.id)) { const p = pending.get(event.id); pending.delete(event.id); event.error ? p.reject(new Error(event.error.message)) : p.resolve(event.result); }
    if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.text);
    if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') errors.push(event.params.entry.text);
    if (event.method === 'Network.requestWillBeSent') requests.push(event.params.request.url);
  };
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' }, true);
  ({ sessionId: session } = await command('Target.attachToTarget', { targetId, flatten: true }, true));
  await command('Page.enable'); await command('Runtime.enable'); await command('Log.enable'); await command('Network.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifacts, eventsEnabled: true }, true);
  await command('Page.navigate', { url });
  await until(() => js("return !!document.querySelector('#demo') && document.readyState==='complete';"), 'app load');
  assert.equal(await js('return document.documentElement.scrollWidth <= innerWidth;'), true);
  await screenshot('desktop-empty');
  await click('#demo');
  await until(() => js("return document.querySelectorAll('[data-repair]').length===6 && !document.querySelector('#file').disabled;"), 'demo worker');
  checks.push('Static subpath load and worker demo');
  await click('#graphs [data-graph]');
  await click('[data-repair]');
  assert.equal(await js("return document.querySelector('#review-dialog').open;"), true);
  await js("document.querySelector('#review-form').requestSubmit();");
  await click('#tab-variables'); await click('[data-rename]');
  await js("document.querySelector('#rename-input').value='Score'; document.querySelector('#review-form').requestSubmit();");
  assert.match(await js("return document.querySelector('#review-error').textContent;"), /already used/);
  await js("document.querySelector('#rename-input').value='SecondsRemaining'; document.querySelector('#review-form').requestSubmit();");
  assert.equal(await js("return document.querySelector('#plan-count').textContent;"), '2');
  await click('#undo'); assert.equal(await js("return document.querySelector('#plan-count').textContent;"), '1');
  await click('#redo'); assert.equal(await js("return document.querySelector('#plan-count').textContent;"), '2');
  await js("document.querySelector('#tab-variables').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));");
  assert.equal(await js("return document.querySelector('#tab-dependencies').getAttribute('aria-selected');"),'true');
  await js("document.querySelector('#tab-dependencies').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));");
  await js("document.querySelector('#build').click(); document.querySelector('#cancel-work').click();");
  await until(()=>js("return !document.querySelector('#file').disabled;"),'cancel worker');
  assert.equal(await js("return document.querySelector('#plan-count').textContent;"),'2');
  assert.equal(await js("return !!document.querySelector('#download-file');"),false);
  checks.push('Keyboard tab navigation and cancellation retaining reviewed changes');
  await click('#build');
  await until(() => js("return !!document.querySelector('#download-file');"), 'patch worker');
  checks.push('Reviewed declaration and rename, collision rejection, mixed patch');
  await screenshot('desktop-ready');
  // Clear previous test downloads only; all paths are fixed under this project's artifacts.
  for (const name of ['Creator-demo.patched.gia', 'Creator-demo.changes.json']) await fs.rm(path.join(artifacts, name), { force: true });
  await click('#download-file'); await click('#download-report');
  const saved = path.join(artifacts, 'Creator-demo.patched.gia'), reportPath = path.join(artifacts, 'Creator-demo.changes.json');
  await until(async () => { try { await fs.access(saved); await fs.access(reportPath); return true; } catch { return false; } }, 'downloads');
  const patched = await fs.readFile(saved), report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.equal(report.originalSha256, createHash('sha256').update(demo()).digest('hex'));
  assert.equal(report.patchedSha256, createHash('sha256').update(patched).digest('hex'));
  assert.equal(inspect(patched).graphs[0].variables.find(v => v.name === 'SecondsRemaining').references, 2);
  assert.equal(report.syntheticDemo, true);
  checks.push('Real browser file/report downloads and SHA-256 checks');
  await click('#compare-export');
  await until(() => js("return document.querySelector('#detail-dialog').open;"), 'export comparison');
  assert.match(await js("return document.querySelector('#detail-body').textContent;"), /1 changed graph records/);
  await click('#detail-dialog [data-close]');
  const planPath=path.join(artifacts,'Creator-demo.plan.json'); await fs.rm(planPath,{force:true});
  await click('#export-plan'); await until(async()=>{try{await fs.access(planPath);return true;}catch{return false;}},'plan download');
  await until(()=>js("return !document.querySelector('#file').disabled;"),'plan worker settled');
  await click('#clear-plan'); await upload(planPath,'#plan-file');
  await until(()=>js("return document.querySelector('#plan-count').textContent==='2' && !document.querySelector('#file').disabled;"),'import plan');
  checks.push('Undo/redo, export comparison, saved plan download and import');
  await upload(saved);
  await until(() => js("return document.querySelector('#stage-name').textContent==='Creator-demo.patched.gia' && !document.querySelector('#file').disabled;"), 'reopen patched download');
  assert.equal(await js("return document.querySelector('#plan-count').textContent;"), '0');
  await upload(planPath,'#plan-file');
  await until(()=>js("return document.querySelector('#notice').classList.contains('error') && !document.querySelector('#file').disabled;"),'plan source mismatch');
  assert.equal(await js("return document.querySelector('#plan-count').textContent;"),'0');
  await js("document.querySelector('#graph-search').value='Runtime'; document.querySelector('#graph-search').dispatchEvent(new Event('input'));");
  assert.equal(await js("return document.querySelectorAll('#graphs [data-graph]').length;"), 1);
  await click('#graphs [data-graph]'); assert.equal(await js("return document.querySelectorAll('[data-repair]').length;"), 0);
  checks.push('Patched-file reimport, graph search and inspection-only graph');
  await click('#tab-variables'); await click('[data-edit]');
  await js("document.querySelector('#value-input').value='42'; document.querySelector('#review-form').requestSubmit();");
  assert.equal(await js("return document.querySelector('#plan-count').textContent;"),'1');
  await click('#all-findings'); await click('#batch-review');
  assert.equal(await js("return document.querySelectorAll('#batch-body input:checked').length;"),0);
  await js("document.querySelector('#batch-form').requestSubmit();");
  assert.match(await js("return document.querySelector('#batch-error').textContent;"),/Select at least/);
  await js("for(const input of document.querySelectorAll('#batch-body input')) input.checked=true; document.querySelector('#batch-form').requestSubmit();");
  assert.equal(await js("return document.querySelector('#plan-count').textContent;"),'6');
  await click('#build'); await until(()=>js("return !!document.querySelector('#compare-export') && !document.querySelector('#file').disabled;"),'batch build');
  await click('#compare-export'); await until(()=>js("return document.querySelector('#detail-dialog').open;"),'batch comparison');
  assert.match(await js("return document.querySelector('#detail-body').textContent;"),/42/); await click('#detail-dialog [data-close]');
  await js("document.querySelector('#graph-search').value='Medal'; document.querySelector('#graph-search').dispatchEvent(new Event('input'));");
  await click('#graphs [data-graph]'); await click('[data-evidence]');
  assert.match(await js("return document.querySelector('#detail-body').textContent;"),/Call #2/);
  await click('#detail-body [data-graph]');
  assert.equal(await js("return document.querySelector('#tab-dependencies').getAttribute('aria-selected');"),'true');
  assert.match(await js("return document.querySelector('#dependencies-panel').textContent;"),/Medal Equipment/);
  checks.push('Initial value editing, explicit batch review, composite evidence and caller navigation');
  await screenshot('desktop-composites');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await js('window.scrollTo(0,0);'); await pause(150);
  assert.equal(await js('return document.documentElement.scrollWidth <= innerWidth;'), true);
  await screenshot('mobile'); checks.push('390-pixel responsive layout without horizontal overflow');
  const malformed = path.join(artifacts, 'bad.gia'); await fs.writeFile(malformed, 'not an export');
  await upload(malformed);
  await until(() => js("return document.querySelector('#notice').classList.contains('error');"), 'malformed input error');
  assert.equal(await js("return document.querySelector('#stage-name').textContent;"), 'Creator-demo.patched.gia');
  const xss = path.join(artifacts, 'names.gia');
  await fs.writeFile(xss, container(asset(graph({ name: '<img src=x onerror=alert(1)>', nodes: [variableNode(1, '<script>bad()</script>')] }))));
  await upload(xss);
  await until(() => js("return document.querySelector('#stage-name').textContent==='names.gia' && !document.querySelector('#file').disabled;"), 'escaped names');
  assert.equal(await js("return document.querySelectorAll('#graphs img, #findings-panel script, #graph-name img').length;"), 0);
  checks.push('Malformed input preserves workspace; HTML-like names render as text');
  await click('[data-repair]'); await js("document.querySelector('#review-form').requestSubmit();");
  await click('[data-remove]'); assert.equal(await js("return document.querySelector('#plan-count').textContent;"), '0');
  await click('[data-repair]'); await js("document.querySelector('#review-form').requestSubmit();"); await click('#clear-plan');
  assert.equal(await js("return document.querySelector('#plan-count').textContent;"), '0');
  await click('#undo'); assert.equal(await js("return document.querySelector('#plan-count').textContent;"),'1');
  await click('#clear-plan'); checks.push('Individual removal, clearing changes and restoring cleared plan');
  for (const filename of process.argv.slice(2)) {
    const source=await fs.readFile(filename), analysis=inspect(source), name=path.basename(filename);
    await upload(path.resolve(filename));
    await until(()=>js(`return document.querySelector('#stage-name').textContent===${JSON.stringify(name)} && !document.querySelector('#file').disabled;`),'real file '+name,45000);
    assert.equal(await js('return document.documentElement.scrollWidth <= innerWidth;'),true,'real file fits mobile viewport');
    assert.equal(await js("return Number(document.querySelector('.metric.highlight strong').textContent.replaceAll(',',''));"),analysis.stats.repairs);
    if(analysis.stats.repairs) {
      await click('#batch-review');
      assert.equal(await js("return document.querySelectorAll('#batch-body input').length;"),analysis.stats.repairs);
      await js("for(const i of document.querySelectorAll('#batch-body input')) i.checked=true; document.querySelector('#batch-form').requestSubmit();");
      await click('#build'); await until(()=>js("return !!document.querySelector('#download-file') && !document.querySelector('#file').disabled;"),'real patch '+name,45000);
      const savedName=name.replace(/\.(gil|gia)$/i,'')+'.patched.'+analysis.format.toLowerCase(), outputPath=path.join(artifacts,savedName);
      await fs.rm(outputPath,{force:true}); await click('#download-file');
      await until(async()=>{try{await fs.access(outputPath);return true;}catch{return false;}},'real download');
      const downloaded=await fs.readFile(outputPath), ops=analysis.graphs.flatMap(g=>g.findings.filter(f=>f.repairable).map(f=>({kind:'declare',graph:g.key,name:f.name,type:f.type})));
      assert.deepEqual(downloaded,Buffer.from(patch(source,ops).bytes));
    }
    assert.deepEqual(await fs.readFile(filename),source,'source file unchanged');
    checks.push(`Real export: ${name}; ${analysis.stats.repairs} declaration repairs; source unchanged`);
  }
  assert.deepEqual(errors, [], 'browser should have no application errors');
  const foreignRequests = requests.filter(r => /^https?:/.test(r) && new URL(r).origin !== new URL(url).origin);
  assert.deepEqual(foreignRequests, [], 'all network requests must stay on the local static origin');
  const receipt = { date: '2026-10-23', checks, applicationErrors: errors, externalNetworkRequests: foreignRequests, nativeEditorImport: 'Not tested' };
  await fs.writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(checks.map(c => 'PASS ' + c).join('\n')); console.log('PASS no browser errors or external requests. Screenshots: .artifacts/browser/');
} finally {
  if (socket?.readyState === WebSocket.OPEN) { try { await command('Browser.close', {}, true); } catch {} socket.close(); }
  await pause(500); browser.kill();
  // mkdtemp owns only this exact directory; never remove an existing Chrome profile.
  if (path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('miliastra-fix-browser-')) await fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }).catch(() => {});
}

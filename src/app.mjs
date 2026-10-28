import { demo } from './demo.mjs';
import { TYPES, defaultFor, displayValue, validateName, validateValue } from './values.mjs';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tabs = ['findings', 'variables', 'dependencies'];
let state = { bytes: null, filename: '', analysis: null, selected: null, operations: [], result: null, busy: false, demo: false, tab: 'findings', filter: 'all', shown: 80, history: [[]], cursor: 0 };
let review = null, batch = [], requestId = 0, cancelWork = null;
const graph = key => state.analysis?.graphs.find(g => g.key === (key ?? state.selected));
const selectedGraphs = () => state.selected ? [graph()].filter(Boolean) : state.analysis?.graphs || [];
const queued = (key, name) => state.operations.some(op => op.graph === key && op.name === name);
const query = () => $('issue-search').value.trim().toLocaleLowerCase();
const matching = item => !query() || JSON.stringify(item).toLocaleLowerCase().includes(query());
const allFindings = () => state.analysis?.graphs.flatMap(g => g.findings) || [];
const lookupFinding = id => allFindings().find(f => f.id === id);
function notice(message, kind = '') {
  $('notice').textContent = message; $('notice').className = `notice ${kind}`; $('notice').hidden = !message;
}
function worker(action, extra = {}) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' }), id = ++requestId;
    let settled = false;
    const done = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer); w.terminate(); cancelWork = null;
      error ? reject(new Error(error)) : resolve(result);
    };
    const timer = setTimeout(() => done('This operation exceeded 45 seconds. Try a smaller exported asset.'), 45000);
    cancelWork = () => done('Operation cancelled. Your file and change plan are unchanged.');
    w.onmessage = ({ data }) => {
      if (data.id !== id) return;
      if (data.progress) { notice(data.progress, 'busy'); return; }
      done(data.error, data.result);
    };
    w.onerror = () => done('The file worker stopped unexpectedly. Reload the page and try again.');
    w.postMessage({ id, action, bytes: state.bytes, ...extra });
  });
}
function setBusy(busy) {
  state.busy = busy;
  for (const id of ['open', 'drop-open', 'demo', 'file', 'compare-open', 'import-plan', 'batch-review']) $(id).disabled = busy;
  $('cancel-work').hidden = !busy; renderPlan();
}
async function run(action, extra, done) {
  if (state.busy) return;
  setBusy(true);
  try { done(await worker(action, extra)); }
  catch (error) { notice(error.message, 'error'); }
  finally { setBusy(false); }
}
function validateFile(file) {
  if (!/\.(gil|gia)$/i.test(file.name)) throw new Error('Choose a .gil stage or .gia asset file.');
  if (file.size > 32 * 1024 * 1024) throw new Error('This file is larger than the 32 MB limit.');
}
async function load(input, filename, synthetic = false) {
  if (state.busy) return;
  const bytes = new Uint8Array(input);
  setBusy(true); notice('Opening your file…', 'busy');
  try {
    const analysis = await worker('inspect', { bytes });
    state = { ...state, bytes, filename, demo: synthetic, analysis, selected: null, tab: 'findings', filter: 'all', shown: 80, operations: [], result: null, history: [[]], cursor: 0 };
    $('graph-search').value = ''; $('issue-search').value = ''; $('graph-kind').value = 'owners';
    notice(synthetic ? 'Demo mode uses synthetic test data. Explore the full workflow; this sample is not a playable game asset.' : `Opened ${analysis.format}. All edits start from this original file.`);
    render();
  } catch (error) { notice(error.message, 'error'); }
  finally { setBusy(false); }
}
async function loadFile(file) {
  if (!file || state.busy) return;
  try {
    validateFile(file); setBusy(true);
    const bytes = await file.arrayBuffer(); setBusy(false); await load(bytes, file.name);
  } catch (error) { notice(error.message, 'error'); }
  finally { setBusy(false); }
}
function setPlan(operations) {
  state.operations = structuredClone(operations); state.result = null;
  state.history = [...state.history.slice(0, state.cursor + 1), structuredClone(operations)].slice(-101);
  state.cursor = state.history.length - 1; renderPlan(); renderGraph();
}
function history(delta) {
  if (state.busy || state.cursor + delta < 0 || state.cursor + delta >= state.history.length) return;
  state.cursor += delta; state.operations = structuredClone(state.history[state.cursor]); state.result = null;
  renderPlan(); renderGraph(); notice(delta < 0 ? 'Change plan edit undone.' : 'Change plan edit restored.');
}
function render() {
  const a = state.analysis;
  $('welcome').hidden = !!a; $('inspection').hidden = !a; $('graph-section').hidden = !a;
  if (a) {
    $('file-card').innerHTML = `<span class="file-icon" aria-hidden="true">↳</span><span>${esc(state.filename)}<small>${a.format} · ${(a.size / 1024).toFixed(1)} KB · original</small></span>`;
    $('stage-name').textContent = state.filename;
    $('stage-summary').textContent = `${a.stats.ownerGraphs} owner graphs · ${a.stats.composites} composites · ${a.stats.nodes.toLocaleString()} physical nodes`;
    $('demo-badge').hidden = !state.demo; $('format-label').textContent = a.format;
    $('metrics').innerHTML = [[a.stats.repairs, 'Available repairs', 'highlight'], [a.stats.variables, 'Declared variables', ''], [`${a.stats.completeGraphs}/${a.stats.ownerGraphs}`, 'Complete owner scans', '']].map(([n, label, cls]) => `<div class="metric ${cls}"><strong>${n.toLocaleString()}</strong><span>${label}</span></div>`).join('');
    $('file-fingerprint').textContent = `SHA-256 ${a.sha256.slice(0, 12)}…`; $('file-fingerprint').title = a.sha256;
    renderGraphs(); renderGraph();
  }
  renderPlan();
}
function renderGraphs() {
  const search = $('graph-search').value.trim().toLocaleLowerCase(), kind = $('graph-kind').value;
  const graphs = state.analysis.graphs.filter(g => (kind === 'all' || (kind === 'composites') === g.composite) && (!search || [g.name, ...g.variables.map(v => v.name), ...g.references.map(r => r.name)].some(n => n.toLocaleLowerCase().includes(search))));
  $('graph-count').textContent = graphs.length; $('all-count').textContent = state.analysis.stats.findings;
  $('all-findings').classList.toggle('active', !state.selected);
  $('graphs').innerHTML = graphs.length ? graphs.map(g => `<button class="graph-button ${g.key === state.selected ? 'active' : ''}" data-graph="${esc(g.key)}" ${g.key === state.selected ? 'aria-current="true"' : ''}><span class="graph-dot ${g.composite ? 'composite' : ''}" aria-hidden="true"></span><span class="graph-label">${esc(g.name)}</span><small>${g.findings.filter(f => f.repairable).length || (g.composite ? 'C' : '—')}</small></button>`).join('') : '<p class="no-results">No matching graphs.</p>';
}
function findingCard(f) {
  return `<article class="finding"><span class="finding-icon ${f.severity === 'error' ? 'conflict' : f.severity === 'info' ? 'info' : ''}" aria-hidden="true">${f.severity === 'info' ? 'i' : '!'}</span><div class="finding-content">${!state.selected ? `<button class="text-button context-link" data-graph="${esc(f.graphKey)}">${esc(f.graphName)} ↗</button>` : ''}<h3>${esc(f.title)}</h3><p>${esc(f.detail)}</p><div class="finding-meta">${f.evidence?.length ? `<button class="text-button" data-evidence="${esc(f.id)}">Trace ${f.evidence.length} reference${f.evidence.length === 1 ? '' : 's'} ↗</button>` : ''}${!f.repairable ? `<span class="manual-label">${f.severity === 'info' ? 'Information' : 'Manual review'} · no automatic edit</span>` : ''}</div></div>${f.repairable ? `<div class="finding-action">${queued(f.graphKey, f.name) ? '<span class="queued">✓ In plan</span>' : `<button class="secondary" data-repair="${esc(f.id)}">Review fix</button>`}</div>` : ''}</article>`;
}
function renderGraph() {
  if (!state.analysis) return;
  const g = graph(), selected = selectedGraphs();
  $('graph-name').textContent = g?.name ?? 'All findings';
  $('graph-source').textContent = g ? `${g.category} · ${g.nodes} nodes` : `${state.analysis.stats.ownerGraphs} owner graphs`;
  $('blockers').innerHTML = g?.blockers.length ? `<div class="callout"><strong>${g.composite ? 'Shared composite body' : 'Inferred repairs are unavailable'}</strong><details><summary>${g.blockers.length} coverage note${g.blockers.length === 1 ? '' : 's'}</summary><ul>${g.blockers.slice(0, 100).map(b => `<li>${esc(b)}</li>`).join('')}${g.blockers.length > 100 ? '<li>Additional notes appear in the findings.</li>' : ''}</ul></details></div>` : '';
  const findings = selected.flatMap(g => g.findings).filter(f => matching(f) && (state.filter === 'all' || (state.filter === 'repairable' ? f.repairable : state.filter === 'info' ? f.severity === 'info' : !f.repairable && f.severity !== 'info')));
  $('findings-count').textContent = findings.length;
  $('findings-panel').innerHTML = findings.length ? findings.slice(0, state.shown).map(findingCard).join('') + (findings.length > state.shown ? `<button class="secondary show-more" data-more>Show next ${Math.min(80, findings.length - state.shown)} of ${findings.length - state.shown} remaining</button>` : '') : '<div class="empty-view">No matching findings.<br>This scan covers graph variables, not every possible stage issue.</div>';
  const variables = selected.flatMap(g => g.variables.map((v, index) => ({ ...v, graph: g, index }))).filter(v => matching({ name: v.name, type: v.typeName, graph: v.graph.name }));
  $('variables-count').textContent = variables.length;
  $('variables-panel').innerHTML = variables.length ? variables.slice(0, state.shown).map(v => `<div class="variable-row"><div class="variable-info">${!state.selected ? `<button class="text-button context-link" data-graph="${esc(v.graph.key)}">${esc(v.graph.name)} ↗</button>` : ''}<strong>${esc(v.name || '(empty name)')}</strong><small>${v.references} resolved reference${v.references === 1 ? '' : 's'} · ${v.public ? 'Exposed' : 'Private'}</small><code class="initial-value" title="Initial value">${esc(v.initial.label)}</code></div><span class="variable-type">${esc(v.typeName)}</span><div class="variable-actions">${queued(v.graph.key, v.name) ? '<span class="queued">✓ In plan</span>' : `${v.editable && v.type !== 1 ? `<button class="secondary" data-edit="${v.index}" data-owner="${esc(v.graph.key)}">Edit value</button>` : ''}${v.renameable ? `<button class="text-button" data-rename="${v.index}" data-owner="${esc(v.graph.key)}">Rename</button>` : `<button class="text-button muted" data-reasons="${v.index}" data-owner="${esc(v.graph.key)}">Scope notes</button>`}`}</div></div>`).join('') + (variables.length > state.shown ? '<button class="secondary show-more" data-more>Show more variables</button>' : '') : '<div class="empty-view">No matching variable declarations.</div>';
  const dependencies = g ? (g.composite ? g.callers : g.dependencies) : [];
  $('dependencies-panel').innerHTML = g ? `<p class="dependency-intro">${g.composite ? 'These owner graphs call this composite directly or through nested composites. Their declarations own its graph-variable references.' : `Scanned ${g.expandedNodes.toLocaleString()} node visits across ${g.coverage.contexts} call contexts. These shared bodies remain unchanged when a caller declaration is repaired.`}</p>${dependencies.length ? dependencies.map(d => `<button class="dependency-row" data-graph="${esc(d.key)}"><span>${esc(d.name)}</span><small>${d.calls ? `${d.calls} call context${d.calls === 1 ? '' : 's'}` : 'Owner graph'} ↗</small></button>`).join('') : '<div class="empty-view">No resolved composite dependencies.</div>'}` : '<div class="empty-view">Select a graph to explore its composite dependencies.</div>';
  for (const tab of tabs) { const active = state.tab === tab; $(`tab-${tab}`).setAttribute('aria-selected', active); $(`tab-${tab}`).tabIndex = active ? 0 : -1; $(`${tab}-panel`).hidden = !active; }
  $('finding-filters').hidden = state.tab !== 'findings';
  document.querySelectorAll('[data-filter]').forEach(b => { b.classList.toggle('active', b.dataset.filter === state.filter); b.setAttribute('aria-pressed', b.dataset.filter === state.filter); });
}
function renderPlan() {
  const n = state.operations.length;
  $('plan-count').textContent = n; $('pending-total').textContent = n;
  $('build').disabled = !n || state.busy; $('build').textContent = state.busy ? 'Working locally…' : state.result ? 'Rebuild validated export →' : 'Validate & build export →';
  $('clear-plan').disabled = !n || state.busy; $('export-plan').disabled = !n || state.busy;
  $('undo').disabled = state.busy || state.cursor === 0; $('redo').disabled = state.busy || state.cursor >= state.history.length - 1;
  const labels = { declare: 'ADD DECLARATION', rename: 'RENAME VARIABLE', 'set-default': 'EDIT INITIAL VALUE' };
  $('plan-list').innerHTML = n ? state.operations.map((op, i) => `<div class="plan-item"><div class="plan-item-header"><span>${labels[op.kind]}</span><button class="remove-change" data-remove="${i}" aria-label="Remove change for ${esc(op.name)}" ${state.busy ? 'disabled' : ''}>×</button></div><strong>${esc(op.name)}</strong><p>${esc(graph(op.graph)?.name)}</p><div class="change-values">${op.kind === 'rename' ? `${esc(op.name)} → ${esc(op.to)}` : op.kind === 'declare' ? `${esc(TYPES[op.type])} · ${esc(displayValue(op.value ?? defaultFor(op.type)))}` : `${esc(graph(op.graph)?.variables.find(v => v.name === op.name)?.initial.label)} → ${esc(displayValue(op.value))}`}</div></div>`).join('') : '<div class="empty-plan"><span aria-hidden="true">≡</span><h3>A clean slate</h3><p>Reviewed repairs, renames and value edits appear here.</p></div>';
  $('export-result').hidden = !state.result;
  if (state.result) {
    const r = state.result.report;
    $('export-result').innerHTML = `<div class="export-success"><strong>✓ Validated copy ready</strong><p>${r.changes.length} changes in ${r.summary.changedGraphs} graphs<br>${r.validation.untouchedGraphs} other graphs byte-identical<br>${r.summary.repairsBefore} → ${r.summary.repairsAfter} available repairs</p><p>${state.demo ? 'Synthetic demo only.' : 'File checks passed. Test this copy in the editor before using it in your stage.'}</p><button class="primary" id="download-file">Download .${state.analysis.format.toLowerCase()} ↓</button><button class="text-button" id="compare-export">Inspect export differences</button><button class="text-button" id="download-report">Download change report</button></div>`;
  }
}
function valueEditor(type, value) {
  if (type === 1) return '<p class="value-fixed">Initial value: <strong>null entity</strong></p>';
  const control = type === 4 ? `<select id="value-input" class="rename-input"><option value="false" ${value === false ? 'selected' : ''}>false</option><option value="true" ${value === true ? 'selected' : ''}>true</option></select>` : type === 6 ? `<textarea id="value-input" class="rename-input" rows="3" spellcheck="false">${esc(value)}</textarea>` : `<input id="value-input" class="rename-input" type="number" required step="${type === 3 ? '1' : 'any'}" ${type === 3 ? 'min="-2147483648" max="2147483647"' : ''} value="${esc(value)}">`;
  return `<label class="rename-label" for="value-input">Initial value · ${esc(TYPES[type])}${control}</label>${type === 5 ? '<small class="field-help">Stored as a 32-bit float. The exported value may be rounded.</small>' : ''}`;
}
function readValue(type) {
  if (type === 1) return null;
  const raw = $('value-input').value;
  if ([3, 5].includes(type) && !raw.trim()) throw new Error('Enter an initial value.');
  return validateValue(type, type === 4 ? raw === 'true' : type === 6 ? raw : Number(raw));
}
function openReview(kind, item, g) {
  if (state.busy || !item || !g || queued(g.key, item.name)) return;
  if (kind === 'declare' ? !item.repairable : kind === 'rename' ? !item.renameable : !item.editable) return;
  review = { kind, graph: g.key, name: item.name, type: item.type };
  $('review-title').textContent = { declare: 'Declare a missing variable', rename: 'Rename a graph variable', 'set-default': 'Edit an initial value' }[kind];
  $('review-description').textContent = g.name;
  $('review-body').innerHTML = `<dl class="review-grid"><dt>Variable</dt><dd>${esc(item.name)}</dd><dt>Type</dt><dd>${esc(TYPES[item.type])}</dd><dt>Scope</dt><dd>${kind === 'rename' ? 'Declaration and direct name inputs in this graph' : 'This owner graph’s declaration only'}</dd></dl>${kind === 'rename' ? `<label class="rename-label" for="rename-input">New variable name<input class="rename-input" id="rename-input" required autocomplete="off" spellcheck="false" value="${esc(item.name)}"></label><p>External scripts are not analyzed. Rename only when those scripts do not refer to this name.</p>` : `${valueEditor(item.type, kind === 'declare' ? defaultFor(item.type) : item.initial.value)}<p>${kind === 'declare' ? 'A missing declaration can also be a typo. Check that this name, type and initial value match your intended logic. Shared composite bodies stay unchanged.' : `Changes the graph’s initial value. Existing saved values${item.public ? ' and per-entity exposed overrides' : ''} may take precedence when the stage runs.`}</p>`}`;
  $('review-error').textContent = ''; $('review-dialog').showModal();
  if (kind === 'rename') { $('rename-input').focus(); $('rename-input').select(); }
}
function detail(title, body, eyebrow = 'REFERENCE EVIDENCE') {
  $('detail-title').textContent = title; $('detail-body').innerHTML = body; $('detail-eyebrow').textContent = eyebrow;
  if (!$('detail-dialog').open) $('detail-dialog').showModal();
}
function showEvidence(f) {
  if (!f) return;
  detail(f.name || f.title, `<p>Owner: <strong>${esc(f.graphName)}</strong></p>${f.evidence.map(r => `<article class="evidence-card"><h3>${esc(r.action || 'Inspect')} ${r.node === undefined ? '' : `node #${r.node}`} · ${esc(r.graph)}</h3>${r.type ? `<p>${esc(TYPES[r.type] || 'Unknown type')} · ${r.direct ? 'Direct reference' : 'Composite / forwarded reference'} · ${r.occurrences} call context${r.occurrences === 1 ? '' : 's'}</p>` : ''}${r.callPaths.map(path => `<ol class="trace-path"><li>${esc(f.graphName)}</li>${path.map(s => `<li>Call #${s.node} → <button class="text-button" data-graph="${esc(s.bodyKey)}">${esc(s.composite)} ↗</button></li>`).join('')}<li>${esc(r.action || 'Node')} ${r.node === undefined ? '' : `#${r.node}`}${f.name ? ` → “${esc(f.name)}”` : ''}</li></ol>`).join('')}${r.occurrences > r.callPaths.length ? '<p>Showing up to eight example call paths for this reference.</p>' : ''}</article>`).join('')}`);
}
function openBatch() {
  batch = selectedGraphs().flatMap(g => g.findings).filter(f => f.repairable && !queued(f.graphKey, f.name) && matching(f));
  if (!batch.length) { notice('No unqueued repairs match this view. Select All findings or clear the search.'); return; }
  $('batch-body').innerHTML = `<p class="batch-hint">${batch.length} candidate${batch.length === 1 ? '' : 's'} · start unchecked · adjust individual values with Review fix</p>${batch.map((f, i) => `<label class="batch-row"><input type="checkbox" name="repair" value="${i}"><span><strong>${esc(f.name)}</strong><small>${esc(f.graphName)}</small></span><span class="batch-value">${esc(TYPES[f.type])}<code>${esc(displayValue(defaultFor(f.type)))}</code></span></label>`).join('')}`;
  $('batch-error').textContent = ''; $('batch-dialog').showModal();
}
function showComparison(result, filename) {
  notice('Comparison ready. Your change plan is unchanged.');
  detail('File comparison', `<p>Original: <strong>${esc(state.filename)}</strong><br>Compared with: <strong>${esc(filename)}</strong></p><div class="comparison-summary">${result.identical ? 'Files are byte-identical.' : `${result.changes.length} changed graph records · ${result.unchangedGraphs} unchanged graph records`}</div><p>${esc(result.scope)}</p>${!result.identical && !result.changes.length ? '<div class="callout">The file differs outside the compared graph records.</div>' : ''}${result.changes.map(g => `<article class="comparison-card"><h3>${esc(g.name)} <span class="pill">${esc(g.status)}</span></h3><p>Nodes: ${g.beforeNodes} → ${g.afterNodes}</p>${g.variables.length ? `<div class="comparison-table"><table><thead><tr><th>Variable</th><th>Before</th><th>After</th></tr></thead><tbody>${g.variables.map(v => `<tr><th>${esc(v.name)}</th><td>${v.before ? `${esc(v.before.type)} · ${esc(v.before.initial)}` : 'Absent'}</td><td>${v.after ? `${esc(v.after.type)} · ${esc(v.after.initial)}` : 'Absent'}</td></tr>`).join('')}</tbody></table></div>` : '<p>Graph content changed; declarations are unchanged.</p>'}</article>`).join('')}`, 'BEFORE / AFTER');
}
function download(data, filename, type) {
  const href = URL.createObjectURL(new Blob([data], { type })), anchor = document.createElement('a');
  anchor.href = href; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(href), 10000);
}
const basename = () => state.filename.replace(/\.(gil|gia)$/i, '');
function selectGraph(key) {
  state.selected = key; state.shown = 80; state.filter = 'all'; $('issue-search').value = '';
  const target = graph(), search = $('graph-search').value.trim().toLocaleLowerCase();
  if (target && ![target.name, ...target.variables.map(v => v.name), ...target.references.map(r => r.name)].some(name => name.toLocaleLowerCase().includes(search))) $('graph-search').value = '';
  if (graph()?.composite) { state.tab = 'dependencies'; $('graph-kind').value = 'all'; } else state.tab = 'findings';
  $('detail-dialog').close(); renderGraphs(); renderGraph();
}
$('review-form').addEventListener('submit', e => {
  e.preventDefault(); if (!review || state.busy) return;
  try {
    const op = { ...review }, g = graph(op.graph);
    if (op.kind === 'rename') {
      op.to = validateName($('rename-input').value);
      if (op.to === op.name) throw new Error('Enter a different name.');
      if ([...g.variables, ...g.references].some(v => v.name === op.to) || state.operations.some(p => p.graph === g.key && p.to === op.to)) throw new Error('That name is already used in this graph or plan.');
      delete op.type;
    } else {
      op.value = readValue(op.type);
      if (op.kind === 'set-default' && op.value === g.variables.find(v => v.name === op.name).initial.value) throw new Error('Enter a different initial value.');
      if (op.kind === 'set-default') delete op.type;
    }
    setPlan([...state.operations, op]); $('review-dialog').close(); review = null; notice('Reviewed change added to the plan.');
  } catch (error) { $('review-error').textContent = error.message; }
});
$('batch-form').addEventListener('submit', e => {
  e.preventDefault(); if (state.busy) return;
  const selected = [...$('batch-form').querySelectorAll('input:checked')].map(i => batch[Number(i.value)]);
  if (!selected.length) { $('batch-error').textContent = 'Select at least one declaration to add.'; return; }
  setPlan([...state.operations, ...selected.map(f => ({ kind: 'declare', graph: f.graphKey, name: f.name, type: f.type, value: defaultFor(f.type) }))]);
  $('batch-dialog').close(); notice(`${selected.length} reviewed repairs added to the plan.`);
});
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.hasAttribute('data-close')) b.closest('dialog').close();
  if (b.dataset.graph) selectGraph(b.dataset.graph);
  if (b.dataset.repair) { const f = lookupFinding(b.dataset.repair); openReview('declare', f, graph(f?.graphKey)); }
  if (b.dataset.rename !== undefined) { const g = graph(b.dataset.owner); openReview('rename', g?.variables[Number(b.dataset.rename)], g); }
  if (b.dataset.edit !== undefined) { const g = graph(b.dataset.owner); openReview('set-default', g?.variables[Number(b.dataset.edit)], g); }
  if (b.dataset.reasons !== undefined) { const v = graph(b.dataset.owner)?.variables[Number(b.dataset.reasons)]; detail(v.name, `<p>Initial value: ${esc(v.initial.label)}</p><ul>${(v.renameReasons?.length ? v.renameReasons : ['Composite declarations are inspected in their owner graph.']).map(r => `<li>${esc(r)}</li>`).join('')}</ul>`, 'VARIABLE SCOPE'); }
  if (b.dataset.evidence) showEvidence(lookupFinding(b.dataset.evidence));
  if (b.dataset.filter) { state.filter = b.dataset.filter; state.shown = 80; renderGraph(); }
  if (b.hasAttribute('data-more')) { state.shown += 80; renderGraph(); }
  if (b.dataset.remove !== undefined && !state.busy) setPlan(state.operations.filter((_, i) => i !== Number(b.dataset.remove)));
  if (b.id === 'download-file' && state.result) download(state.result.bytes, `${basename()}.patched.${state.analysis.format.toLowerCase()}`, 'application/octet-stream');
  if (b.id === 'download-report' && state.result) download(JSON.stringify(state.result.report, null, 2) + '\n', `${basename()}.changes.json`, 'application/json');
  if (b.id === 'compare-export' && state.result) run('compare', { other: state.result.bytes }, r => showComparison(r, 'Validated patched copy'));
});
for (const id of ['open', 'drop-open']) $(id).addEventListener('click', () => $('file').click());
$('file').addEventListener('change', () => { const f = $('file').files[0]; $('file').value = ''; loadFile(f); });
$('demo').addEventListener('click', () => load(demo(), 'Creator-demo.gia', true));
for (const id of ['about', 'scope-link']) $(id).addEventListener('click', () => $('about-dialog').showModal());
$('cancel-work').addEventListener('click', () => cancelWork?.());
$('graph-search').addEventListener('input', renderGraphs); $('graph-kind').addEventListener('change', renderGraphs);
$('issue-search').addEventListener('input', () => { state.shown = 80; renderGraph(); });
$('all-findings').addEventListener('click', () => selectGraph(null));
$('batch-review').addEventListener('click', openBatch);
for (const tab of tabs) {
  $(`tab-${tab}`).addEventListener('click', () => { state.tab = tab; state.shown = 80; renderGraph(); });
  $(`tab-${tab}`).addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); state.tab = tabs[e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; renderGraph(); $(`tab-${state.tab}`).focus();
  });
}
$('undo').addEventListener('click', () => history(-1)); $('redo').addEventListener('click', () => history(1));
$('clear-plan').addEventListener('click', () => { setPlan([]); notice('Plan cleared. Use Undo to restore it.'); });
$('export-plan').addEventListener('click', () => run('export-plan', { operations: state.operations }, r => { download(JSON.stringify(r, null, 2) + '\n', `${basename()}.plan.json`, 'application/json'); notice('Plan saved. It can be imported only with this exact original file.'); }));
$('import-plan').addEventListener('click', () => $('plan-file').click());
$('plan-file').addEventListener('change', async () => {
  const file = $('plan-file').files[0]; $('plan-file').value = ''; if (!file || state.busy) return;
  try {
    if (file.size > 1024 * 1024) throw new Error('Plan files must be smaller than 1 MB.');
    setBusy(true); const recipe = JSON.parse(await file.text()); setBusy(false);
    await run('import-plan', { recipe }, ops => { setPlan(ops); notice(`Loaded ${ops.length} validated changes. Review the plan before exporting; Undo restores your previous plan.`); });
  } catch (error) { notice(error.message, 'error'); } finally { setBusy(false); }
});
$('compare-open').addEventListener('click', () => $('compare-file').click());
$('compare-file').addEventListener('change', async () => {
  const file = $('compare-file').files[0]; $('compare-file').value = ''; if (!file || state.busy) return;
  try {
    validateFile(file); setBusy(true); const other = new Uint8Array(await file.arrayBuffer()); setBusy(false);
    await run('compare', { other }, r => { showComparison(r, file.name); notice('Comparison complete. Your change plan is unchanged.'); });
  } catch (error) { notice(error.message, 'error'); } finally { setBusy(false); }
});
$('build').addEventListener('click', () => run('patch', { operations: state.operations }, result => { state.result = result; result.report.syntheticDemo = state.demo; notice('Export validated. Download the patched copy or inspect its differences from the change plan.'); }));
document.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]') || e.target.closest('input, textarea, select, [contenteditable]')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); if (!state.busy) $('file').click(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); history(e.shiftKey ? 1 : -1); }
  if (e.key === '/' && state.analysis) { e.preventDefault(); $('issue-search').focus(); }
});
let dragDepth = 0;
document.addEventListener('dragenter', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); } });
document.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
document.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); if (e.dataTransfer.files.length !== 1) notice('Drop one file at a time.', 'error'); else loadFile(e.dataTransfer.files[0]); });
window.addEventListener('beforeunload', e => { if (state.operations.length && !state.result) { e.preventDefault(); e.returnValue = ''; } });

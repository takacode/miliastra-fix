import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRecord as f, concat as join, readRecords, required, withRecord, atPath, openContainer, rewrap, equal } from '../src/protobuf.mjs';
import { inspect, patch } from '../src/graph.mjs';
import { declaration, encodeValue, decodeValue, updateValue, validateValue } from '../src/values.mjs';
import { compareFiles } from '../src/compare.mjs';
import { createRecipe, importRecipe } from '../src/recipe.mjs';
import { graph, asset, container, variableNode, simpleNode, sig, loc, demo, compositeInterface, interfaceAsset, callNode, mapping, stringValue } from '../src/demo.mjs';

const first = bytes => inspect(bytes).graphs[0];
const file = options => container(asset(graph(options)));
const declare = (bytes, name, type = 3, value = 0) => patch(bytes, [{ kind:'declare', graph:first(bytes).key, name, type, value }]);
const bodyId = 1610612737;
function compositeFile({ rootNodes = [callNode(1, bodyId)], rootVariables = [], bodyNodes = [variableNode(8, 'EquipIdx')], extra = [], iface = compositeInterface(bodyId, 'Cache EquipIdx'), kind = 21002 } = {}) {
  return container(join([asset(graph({ name:'Medal Equipment', service:20005, nodes:rootNodes, variables:rootVariables })), asset(graph({id:bodyId,name:'Cache EquipIdx',kind,nodes:bodyNodes,extra}),2), interfaceAsset(iface)]));
}
const rawGraphs = bytes => inspect(bytes).graphs.map(g => atPath(openContainer(bytes).payload,g.path));
test('caller-aware declaration repair leaves shared composite bodies and other callers exact', () => {
  const bytes=demo(), a=inspect(bytes), owner=a.graphs.find(g=>g.name==='Medal Equipment');
  assert.equal(owner.coverage.complete,true); assert.deepEqual(owner.references.map(r=>[r.name,r.type,r.direct]),[['PlayerEntity',1,false],['EquipIdx',3,false]]);
  const out=patch(bytes,owner.findings.filter(f=>f.repairable).map(f=>({kind:'declare',graph:owner.key,name:f.name,type:f.type})));
  assert.equal(out.analysis.graphs.find(g=>g.key===owner.key).findings.length,0);
  rawGraphs(bytes).forEach((g,i)=>{ if(a.graphs[i].key!==owner.key) assert.deepEqual(rawGraphs(out.bytes)[i],g); });
  assert.equal(out.report.summary.compositeBodiesChanged,0);
});
test('nested composites deduplicate a physical reference and preserve each caller context', () => {
  const inner=bodyId+1;
  const bytes=container(join([asset(graph({nodes:[callNode(1,bodyId),callNode(2,bodyId)]})),asset(graph({id:bodyId,kind:21002,nodes:[callNode(3,inner)]}),2),asset(graph({id:inner,kind:21002,nodes:[variableNode(8,'Score')]}),2),interfaceAsset(compositeInterface(bodyId,'Outer')),interfaceAsset(compositeInterface(inner,'Inner'))]));
  const g=first(bytes); assert.equal(g.coverage.complete,true); assert.equal(g.references.length,1); assert.equal(g.references[0].occurrences,2); assert.equal(g.references[0].callPaths[0].length,2);
  assert.equal(declare(bytes,'Score').analysis.stats.repairs,0);
});
test('mapped caller input overrides a stale stored name in the body', () => {
  const pin=join([f(1,2,sig(3)),f(3,2,stringValue('ActualName'))]);
  const bytes=compositeFile({rootNodes:[callNode(1,bodyId,[pin])],extra:[mapping([3,0],8)]});
  assert.equal(first(bytes).references[0].name,'ActualName'); assert.equal(first(bytes).references[0].direct,false);
  assert.equal(declare(bytes,'ActualName').analysis.stats.repairs,0);
});
test('shared composite references prevent rename; unrelated composites permit direct rename', () => {
  const bytes=compositeFile({rootNodes:[callNode(1,bodyId),variableNode(2,'Direct')],rootVariables:[declaration('EquipIdx',3),declaration('Direct',3)]});
  const g=first(bytes); assert.equal(g.variables[0].renameable,false); assert.equal(g.variables[1].renameable,true);
  assert.throws(()=>patch(bytes,[{kind:'rename',graph:g.key,name:'EquipIdx',to:'Slot'}]),/cannot be renamed/);
  const out=patch(bytes,[{kind:'rename',graph:g.key,name:'Direct',to:'NewDirect'}]);
  assert.deepEqual(rawGraphs(out.bytes)[1],rawGraphs(bytes)[1]);
});
test('a mutable variable initial string is not a proven name source', () => {
  const edge=f(5,2,join([f(1,0,2),f(2,2,sig(4))]));
  const bytes=file({nodes:[variableNode(1,'Stale',3,'Get',[edge]),variableNode(2,'NameHolder',6)],variables:[declaration('NameHolder',6,'Score')]});
  assert.equal(first(bytes).coverage.complete,false); assert.equal(inspect(bytes).stats.repairs,0);
  assert.ok(first(bytes).findings.some(f=>f.kind==='dynamic'));
});
test('listeners block rename but not a fully typed declaration repair', () => {
  const bytes=file({nodes:[variableNode(1,'Score'),simpleNode(2,351)],variables:[declaration('Existing',3)]});
  assert.equal(first(bytes).variables[0].renameable,false); assert.equal(declare(bytes,'Score').analysis.stats.repairs,0);
});
test('recursion, missing definitions and body locators that target ordinary graphs fail closed', () => {
  for(const bytes of [compositeFile({bodyNodes:[variableNode(8,'EquipIdx'),callNode(9,bodyId)]}),compositeFile({rootNodes:[callNode(1,bodyId+99)]}),compositeFile({kind:21001})]) {
    assert.equal(first(bytes).coverage.complete,false); assert.equal(first(bytes).findings.some(f=>f.repairable),false);
  }
});
test('cross-family wires and mismatched composite port mapping kinds cannot masquerade as literals', () => {
  const edge=f(5,2,join([f(1,0,2),f(2,2,sig(2))]));
  const crossed=file({nodes:[variableNode(1,'Score',3,'Get',[edge]),simpleNode(2,18)]});
  assert.equal(first(crossed).coverage.complete,false);
  const toComposite=f(5,2,join([f(1,0,2),f(2,2,sig(4))]));
  const bodyPrint=join([simpleNode(8,18),f(4,2,join([f(1,2,sig(3)),f(3,2,stringValue('Score'))]))]);
  const invalid=compositeFile({rootNodes:[variableNode(1,'Stale',3,'Get',[toComposite]),callNode(2,bodyId)],bodyNodes:[bodyPrint],extra:[mapping([4,0],8,[3,0])]});
  assert.equal(first(invalid).coverage.complete,false); assert.equal(inspect(invalid).stats.repairs,0);
});
test('the final composite call at the expanded scan budget cannot silently hide references', () => {
  const roots=[variableNode(1,'Score'),...Array.from({length:499},(_,i)=>callNode(i+2,bodyId)),...Array.from({length:98},(_,i)=>simpleNode(i+501,18)),callNode(599,bodyId)];
  const bytes=compositeFile({rootNodes:roots,rootVariables:[declaration('Score',3)],bodyNodes:Array.from({length:99},(_,i)=>simpleNode(i+1,18))});
  const g=first(bytes); assert.equal(g.expandedNodes,50000); assert.equal(g.coverage.complete,false); assert.equal(g.variables[0].renameable,false); assert.ok(g.blockers.some(s=>/50,000/.test(s)));
});
test('all four server owner categories support missing scalar declarations', () => {
  for(const service of [20000,20003,20004,20005]) assert.equal(declare(file({service,nodes:[variableNode(1,'Score')]}),'Score').analysis.stats.repairs,0);
});
test('nonzero scalar values round-trip; out-of-range values are refused', () => {
  for(const [type,values] of [[3,[-2147483648,-1,0,2147483647]],[4,[true,false]],[5,[1.5,-3.25,1/3,0]],[6,['','Hello 世界','line\nnext']]]) {
    for(const value of values) {
      assert.equal(decodeValue(encodeValue(type,value),type).value,validateValue(type,value));
      const bytes=file({variables:[declaration('Value',type)]}), g=first(bytes);
      if(value!==g.variables[0].initial.value) {
        const out=patch(bytes,[{kind:'set-default',graph:g.key,name:'Value',value}]);
        assert.equal(first(out.bytes).variables[0].initial.value,validateValue(type,value));
      }
    }
  }
  for(const [type,value] of [[3,2147483648],[3,-2147483649],[3,1.5],[5,Infinity],[5,1e40],[4,1],[6,'x\0'],[1,1]]) assert.throws(()=>validateValue(type,value));
});
test('initial-value editing preserves unknown value and storage fields', () => {
  const original=encodeValue(3,17), opaque=f(81,2,Uint8Array.of(9,8,7));
  const withUnknown=join([withRecord(original,102,2,join([required(original,102),opaque])),opaque]);
  const out=updateValue(withUnknown,3,-5);
  assert.deepEqual(readRecords(out).at(-1).raw,opaque); assert.deepEqual(readRecords(required(out,102)).at(-1).raw,opaque); assert.equal(decodeValue(out,3).value,-5);
});
test('explicit default edits remain available with dynamic names; saved/exposed metadata is retained', () => {
  const bytes=file({nodes:[callNode(1,424242)],variables:[join([declaration('Value',3),f(5,0,1)])]});
  const g=first(bytes); assert.equal(g.coverage.complete,false); assert.equal(g.variables[0].editable,true);
  const out=patch(bytes,[{kind:'set-default',graph:g.key,name:'Value',value:22}]);
  assert.equal(first(out.bytes).variables[0].public,true); assert.equal(first(out.bytes).variables[0].initial.value,22);
});
test('saved plans bind to exact source bytes and are fully revalidated on import', async () => {
  const bytes=demo(), ops=[{kind:'declare',graph:first(bytes).key,name:'Score',type:3,value:9}], recipe=await createRecipe(bytes,ops);
  assert.deepEqual(await importRecipe(bytes,recipe),ops);
  await assert.rejects(importRecipe(patch(bytes,ops).bytes,recipe),/different|match|fingerprint/i);
  await assert.rejects(importRecipe(bytes,{...recipe,operations:[{...ops[0],type:4}]}),/no longer matches/);
  await assert.rejects(importRecipe(bytes,{...recipe,operations:[{...ops[0],kind:'delete'}]}),/invalid operation/);
});
test('graph comparison distinguishes value changes, exact copies and changes outside graph records', () => {
  const bytes=demo(), g=first(bytes), out=patch(bytes,[{kind:'set-default',graph:g.key,name:'RoundTime',value:90}]).bytes;
  const result=compareFiles(bytes,out); assert.equal(result.changes.length,1); assert.equal(result.changes[0].variables[0].after.initial,'90'); assert.equal(result.unchangedGraphs,6);
  assert.equal(compareFiles(bytes,bytes).identical,true);
  const c=openContainer(bytes), other=rewrap(c,join([c.payload,f(91,0,1)]));
  assert.equal(compareFiles(bytes,other).identical,false); assert.equal(compareFiles(bytes,other).changes.length,0);
});
test('conflicting server/client type definitions cannot be edited', () => {
  const value=encodeValue(3), bad=withRecord(value,4,2,join([required(value,4),f(101,2,f(2,0,6))]));
  const bytes=file({variables:[withRecord(declaration('Score',3),4,2,bad)]});
  assert.equal(first(bytes).variables[0].editable,false);
  assert.throws(()=>patch(bytes,[{kind:'set-default',graph:first(bytes).key,name:'Score',value:5}]),/cannot be edited/);
});
test('polymorphic actual value metadata must agree with the graph-variable kernel', () => {
  const node=variableNode(1,'Score'), pins=readRecords(node), last=pins.findLastIndex(f=>f.id===4);
  const value=join([f(1,0,10000),f(110,2,join([f(1,0,2),f(2,2,encodeValue(4,true))]))]);
  const modified=join(pins.map((p,i)=>i===last?f(4,2,join([p.data,f(3,2,value)])):p.raw));
  const bytes=file({nodes:[modified]}); assert.equal(first(bytes).coverage.complete,false); assert.equal(inspect(bytes).stats.repairs,0);
});
test('supplied graph-variable pin kernel signatures cannot disagree with shell slots', () => {
  const node=variableNode(1,'Score'), pins=readRecords(node), index=pins.findIndex(f=>f.id===4);
  const modified=join(pins.map((p,i)=>i===index?f(4,2,withRecord(p.data,2,2,sig(3,1))):p.raw));
  assert.equal(first(file({nodes:[modified]})).coverage.complete,false);
});
test('composite kernel and persistent pin identities must match their interface', () => {
  const base=compositeInterface(bodyId,'Cache');
  const iface=withRecord(base,4,2,join([required(base,4),f(2,2,loc(bodyId,{kind:22001}))]));
  const mismatched=join([callNode(1,bodyId),f(3,2,loc(bodyId+1,{kind:22001}))]);
  assert.equal(first(compositeFile({iface,rootNodes:[mismatched]})).coverage.complete,false);
  const withPin=join([iface,f(102,2,join([f(3,2,sig(3)),f(8,0,10)]))]);
  const pin=uid=>join([f(1,2,sig(3)),f(3,2,stringValue('EquipIdx')),f(7,0,uid)]);
  assert.equal(first(compositeFile({iface:withPin,rootNodes:[callNode(1,bodyId,[pin(99)])]})).coverage.complete,false);
  assert.equal(first(compositeFile({iface:withPin,rootNodes:[callNode(1,bodyId,[pin(10)])]})).coverage.complete,true);
});
test('generated signal metadata pins are distinct from composite flow/data ports', () => {
  const base=compositeInterface(bodyId,'Signal'), iface=join([withRecord(base,107,2,f(1,0,1001)),f(106,2,join([f(5,2,sig(6,1)),f(8,0,205)]))]);
  const call=callNode(1,bodyId,[join([f(1,2,sig(5)),f(7,0,205)])]);
  const bytes=compositeFile({iface,rootNodes:[call,variableNode(2,'Score')]});
  assert.equal(first(bytes).coverage.complete,true); assert.equal(declare(bytes,'Score').analysis.stats.repairs,0);
});
const retyped=(node,kernel,type)=>{
  const pins=readRecords(node), last=pins.findLastIndex(p=>p.id===4);
  return withRecord(join(pins.map((p,i)=>i===last?f(4,2,withRecord(p.data,4,0,type)):p.raw)),3,2,loc(kernel));
};
const note=(id,text)=>join([simpleNode(id,999999),f(4,2,join([f(1,2,sig(3)),f(3,2,stringValue(text))]))]);
test('built-in nodes are ordinary nodes; undefined calls still stop repairs', () => {
  const builtIn=file({nodes:[variableNode(1,'Score'),simpleNode(2,999999)]});
  assert.equal(first(builtIn).coverage.complete,true); assert.equal(inspect(builtIn).stats.repairs,1);
  const undefinedCall=file({nodes:[variableNode(1,'Score'),callNode(2,424242)]});
  assert.equal(first(undefinedCall).coverage.complete,false); assert.equal(inspect(undefinedCall).stats.repairs,0);
});
test('value types come from node metadata; one kernel cannot record two types and scalars need a known kernel', () => {
  const list=file({nodes:[retyped(variableNode(1,'Items'),7777,7)]});
  assert.equal(first(list).coverage.complete,true); assert.equal(first(list).findings.find(x=>x.name==='Items').type,7);
  const mixed=file({nodes:[retyped(variableNode(1,'Items'),7777,7),retyped(variableNode(2,'Other'),7777,8)]});
  assert.ok(first(mixed).blockers.some(b=>/different value types/.test(b)));
  const scalar=file({nodes:[retyped(variableNode(1,'Score'),7777,3)]});
  assert.ok(first(scalar).blockers.some(b=>/metadata disagrees/.test(b))); assert.equal(inspect(scalar).stats.repairs,0);
});
test('text stored by another node blocks renaming only the variable it names', () => {
  const bytes=file({nodes:[variableNode(1,'Lives',3,'Set'),variableNode(2,'Coins',3,'Set'),note(5,'Lives')],variables:[declaration('Lives',3),declaration('Coins',3)]});
  const g=first(bytes), lives=g.variables.find(v=>v.name==='Lives'), coins=g.variables.find(v=>v.name==='Coins');
  assert.equal(g.coverage.complete,true); assert.equal(coins.renameable,true);
  assert.equal(lives.renameable,false); assert.match(lives.renameReasons.join(' '),/stores this name as text/);
  assert.throws(()=>patch(bytes,[{kind:'rename',graph:g.key,name:'Lives',to:'Hearts'}]),/cannot be renamed/);
  assert.equal(first(patch(bytes,[{kind:'rename',graph:g.key,name:'Coins',to:'Gold'}]).bytes).variables.some(v=>v.name==='Gold'),true);
});

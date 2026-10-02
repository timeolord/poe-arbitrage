import test from 'node:test';
import assert from 'node:assert/strict';
import {profit_pct, simulate_cycle, rotate_cycle, rank_cycles} from '../web/core.mjs';

const leg = (from, to, input_volume, output_volume) => ({from, to, input_volume, output_volume, historical_low_stock:100, historical_high_stock:200});
const cycle = {path:['a','b','c'], legs:[leg('a','b',1,2), leg('b','c',1,3), leg('c','a',5,1)], profit_pct:20};

test('cycle profit is a compounded percentage', () => {
  assert.ok(Math.abs(profit_pct([2,3,.2]) - 20) < 1e-10);
  assert.equal(profit_pct([2,.5]), 0);
});
test('budget simulation compounds haircut and rounds every leg', () => {
  assert.deepEqual(simulate_cycle(cycle.legs, 100, 0).amounts, [100,200,600,120]);
  assert.equal(simulate_cycle(cycle.legs, 100, 100).end, 116);
  assert.equal(simulate_cycle([leg('a','b',3,1)], 2, 0).end, 0);
  assert.throws(() => simulate_cycle(cycle.legs, 0, 0));
  assert.throws(() => simulate_cycle(cycle.legs, 100, 10000));
});
test('rotations preserve trade direction', () => {
  const rotated = rotate_cycle(cycle, 'b');
  assert.deepEqual(rotated.path, ['b','c','a']);
  assert.equal(rotated.legs[0].from, 'b');
  assert.equal(rotated.legs.at(-1).to, 'b');
  assert.equal(rotate_cycle(cycle, 'd'), null);
});
test('filters reject insufficient volume on either side', () => {
  const options = {start:'a', budget:100, haircut_bps:100, min_volume:1, min_profit:1};
  assert.equal(rank_cycles({cycles:[cycle]}, options).length, 1);
  assert.equal(rank_cycles({cycles:[cycle]}, {...options, min_volume:2}).length, 0);
  assert.equal(rank_cycles({cycles:[cycle]}, {...options, min_profit:17}).length, 0);
});

test('vendor batch rounding precedes reward and ignores haircut', () => {
  const vendor = {...leg('a','b',8,20), kind:'vendor'};
  const result = simulate_cycle([vendor], 25, 500);
  assert.equal(result.end, 60);
  assert.deepEqual(result.leftovers, [1]);
  const mixed = {path:['a','b'], legs:[vendor, {...leg('b','a',20,10),kind:'market'}], profit_pct:25};
  assert.equal(rank_cycles({cycles:[mixed]}, {start:'a',budget:25,haircut_bps:0,min_volume:10,min_profit:1}).length, 1);
  assert.equal(rank_cycles({cycles:[mixed]}, {start:'a',budget:25,haircut_bps:0,min_volume:10,min_profit:1,include_vendors:false}).length, 0);
});

test('recipe basket values every input and output and rejects missing quotes', async () => {
  const {quote_recipe} = await import('../web/core.mjs');
  const chaos = 'Metadata/Items/Currency/CurrencyRerollRare';
  const edges = [{...leg(chaos,'a',3,2),kind:'market'}, {...leg('b',chaos,2,7),kind:'market'}, {...leg('c',chaos,1,3),kind:'market'}];
  const recipe = {kind:'item', inputs:{a:3}, outputs:{b:3,c:1}};
  assert.deepEqual(quote_recipe(recipe,edges,1,2,0), {cost:7,returned:13,profit:6,profit_pct:(13/7-1)*100});
  assert.equal(quote_recipe(recipe,edges,1,2,1000).cost, 7);
  assert.equal(quote_recipe(recipe,edges,1,2,1000).returned, 11);
  assert.throws(() => quote_recipe(recipe,edges.slice(0,2),1,2,0), /Missing direct Chaos/);
  assert.throws(() => quote_recipe({...recipe,kind:'random'},edges,1,2,0), /no deterministic/);
});

test('graph search finds longer cycles and counts the closing trade', async () => {
  const {search_cycles} = await import('../web/core.mjs');
  const edge = (from,to,rate=1,kind='market') => ({...leg(from,to,100,100*rate),rate,low_rate:rate,high_rate:rate,kind});
  const league = {edges:[edge('a','b',2),edge('b','c'),edge('c','d'),edge('d','e'),edge('e','a'),edge('b','a'),edge('b','c',3,'vendor'),edge('c','b')]};
  const options = {start:'a',budget:100,haircut_bps:0,min_volume:1,min_profit:0,max_trades:4};
  assert.deepEqual(search_cycles(league,options).cycles.map(c=>c.path.length), [2]);
  const result = search_cycles(league,{...options,max_trades:5});
  assert.equal(result.complete,true);
  assert.equal(result.cycles.filter(c=>c.path.length===5).length,2);
  assert.equal(result.cycles[0].simulation.profit_pct,500);
  assert.equal(search_cycles(league,{...options,max_trades:5,include_vendors:false}).cycles.filter(c=>c.path.length===5).length,1);
  assert.equal(search_cycles(league,{...options,max_trades:5,vendor_only:true}).cycles.length,1);
  assert.ok(result.cycles.every(c=>new Set(c.path).size===c.path.length && c.legs.at(-1).to==='a'));
  assert.equal(search_cycles(league,{...options,max_checks:1}).complete,false);
  assert.throws(()=>search_cycles(league,{...options,max_trades:9}), /Maximum trades/);
  assert.throws(()=>search_cycles(league,{...options,max_trades:2.5}), /Maximum trades/);
});

test('3.29 catalogue excludes the removed chromatic purchase', async () => {
  const {readFile} = await import('node:fs/promises');
  const catalog = JSON.parse(await readFile(new URL('../web/vendor_recipes.json', import.meta.url)));
  assert.ok(!catalog.recipes.some(r=>r.id==='buy_CurrencyRerollSocketColours'));
  assert.ok(catalog.recipes.every(r=>r.reviewed_patch==='3.29'));
});

test('zero or missing stock excludes market legs but preserves vendors', async () => {
  const {search_cycles, has_historical_stock, quote_recipe} = await import('../web/core.mjs');
  const options = {start:'a',budget:100,haircut_bps:0,min_volume:1,min_profit:0,max_trades:3};
  const edges = cycle.legs.map(e=>({...e,kind:'market',rate:e.output_volume/e.input_volume,low_rate:0.1,high_rate:3}));
  assert.equal(search_cycles({edges},options).cycles.length,1);
  for (const field of ['historical_low_stock','historical_high_stock']) {
    const bad_edges = edges.map((e,i)=>i===1?{...e,[field]:0}:e);
    assert.equal(search_cycles({edges:bad_edges},options).cycles.length,0);
    assert.equal(rank_cycles({cycles:[{...cycle,legs:bad_edges}]},options).length,0);
  }
  assert.equal(has_historical_stock({kind:'market'}),false);
  assert.equal(has_historical_stock({kind:'vendor',historical_low_stock:0,historical_high_stock:0}),true);
  const vendor = {...edges[1],kind:'vendor',historical_low_stock:0,historical_high_stock:0};
  assert.equal(search_cycles({edges:[edges[0],vendor,edges[2]]},options).cycles.length,1);
  const chaos = 'Metadata/Items/Currency/CurrencyRerollRare';
  const recipe = {kind:'fixed',inputs:{a:1},outputs:{[chaos]:1}};
  assert.throws(()=>quote_recipe(recipe,[{...leg(chaos,'a',1,1),kind:'market',historical_low_stock:0}],1,0,0),/positive historical stock/);
});

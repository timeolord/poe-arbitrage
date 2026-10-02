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
  const {gold, ...quote} = quote_recipe(recipe,edges,1,2,0);
  assert.deepEqual(quote, {cost:7,returned:13,profit:6,profit_pct:(13/7-1)*100});
  assert.equal(gold.total, null);
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

test('gold costs follow received quantities, round fractions up, and preserve precision', async () => {
  const {gold_cost, gold_summary} = await import('../web/core.mjs');
  const fees = {a:{fee:[15,1]}, b:{fee:[1,8]}};
  assert.equal(gold_cost('a',10,fees),150);
  assert.equal(gold_cost('b',9,fees),2);
  assert.equal(gold_cost('unknown',1,fees),null);
  assert.equal(gold_cost('unknown',0,fees),0);
  assert.throws(()=>gold_cost('a',-1,fees),/quantity/);
  assert.throws(()=>gold_cost('a',Number.MAX_SAFE_INTEGER,fees),/precision/);
  assert.throws(()=>gold_cost('a',1,{a:{fee:[1,0]}}),/Invalid gold fee/);
  assert.throws(()=>gold_summary([{to:'a',quantity:Number.MAX_SAFE_INTEGER},{to:'a',quantity:1}],1,{a:{fee:[1,1]}}),/Total gold/);
});

test('cycle gold includes the closing trade and excludes vendor fees', () => {
  const fees = {a:{fee:[15,1]}, b:{fee:[20,1]}};
  const legs = [leg('a','b',1,2),leg('b','a',10,6)];
  const result = simulate_cycle(legs,100,0,fees);
  assert.deepEqual(result.gold.leg_costs,[4000,1800]);
  assert.equal(result.gold.total,5800);
  assert.equal(result.gold.gold_per_profit,290);
  assert.equal(result.gold.profit_per_100k,20*100000/5800);
  assert.deepEqual(simulate_cycle(legs,100,100,fees).gold.leg_costs,[3960,1755]);
  const vendor = {...legs[0],kind:'vendor'};
  assert.deepEqual(simulate_cycle([vendor,legs[1]],100,0,fees).gold.leg_costs,[0,1800]);
  assert.equal(simulate_cycle([leg('a','a',1,1)],100,0,fees).gold.gold_per_profit,null);
  assert.equal(simulate_cycle([leg('a','a',2,1)],100,0,fees).gold.profit_per_100k,null);
  const unknown = simulate_cycle(legs,100,0,{a:fees.a});
  assert.equal(unknown.gold.total,null);
  assert.deepEqual(unknown.gold.missing,['b']);
});

test('gold budgets and efficiency sorting apply to graph and saved cycle searches', async () => {
  const {search_cycles} = await import('../web/core.mjs');
  const edge = (from,to,x,y)=>({...leg(from,to,x,y),kind:'market',rate:y/x,low_rate:y/x,high_rate:y/x});
  const first = [edge('a','b',1,2),edge('b','a',10,6)];
  const second = [edge('a','c',1,1),edge('c','a',10,11)];
  const unknown = [edge('a','d',1,3),edge('d','a',1,1)];
  const league = {edges:[...first,...second,...unknown],cycles:[first,second,unknown].map(legs=>({path:legs.map(e=>e.from),legs,profit_pct:profit_pct(legs.map(e=>e.rate))}))};
  const options = {start:'a',budget:100,haircut_bps:0,min_volume:1,min_profit:1,max_trades:2,gold_fees:{a:{fee:[1,1]},b:{fee:[100,1]},c:{fee:[1,1]}}};
  for (const search of [o=>search_cycles(league,o).cycles,o=>rank_cycles(league,o)]) {
    assert.deepEqual(search({...options,sort_by:'gold_efficiency'}).map(c=>c.path[1]),['c','b','d']);
    assert.deepEqual(search({...options,sort_by:'profit'}).map(c=>c.path[1]),['d','b','c']);
    assert.deepEqual(search({...options,gold_budget:210}).map(c=>c.path[1]),['c']);
    assert.equal(search({...options,gold_budget:209}).length,0);
    assert.equal(search({...options,gold_budget:0}).length,0);
    assert.throws(()=>search({...options,gold_budget:-1}),/Gold budget/);
    assert.throws(()=>search({...options,sort_by:'invalid'}),/sort order/);
  }
});

test('recipe gold charges each market purchase and sale but skips direct Chaos', async () => {
  const {quote_recipe} = await import('../web/core.mjs');
  const chaos = 'Metadata/Items/Currency/CurrencyRerollRare';
  const edges = [{...leg(chaos,'a',3,2),kind:'market'}, {...leg('b',chaos,2,7),kind:'market'}];
  const recipe = {kind:'basket',inputs:{a:3,[chaos]:1},outputs:{b:3,[chaos]:2}};
  const result = quote_recipe(recipe,edges,1,0,0,{a:{fee:[20,1]},[chaos]:{fee:[15,1]}});
  assert.equal(result.profit,6);
  assert.deepEqual(result.gold.leg_costs,[60,150]);
  assert.equal(result.gold.total,210);
  assert.equal(result.gold.gold_per_profit,35);
});

test('fee table records current patch sources and the revised Chromatic fee', async () => {
  const {readFile} = await import('node:fs/promises');
  const {gold_cost} = await import('../web/core.mjs');
  const table = JSON.parse(await readFile(new URL('../web/gold_fees.json', import.meta.url)));
  assert.equal(table.patch,'3.29');
  assert.equal(table.source_url,'https://poedb.tw/us/Currency_Exchange');
  assert.equal(gold_cost('Metadata/Items/Currency/CurrencyRerollSocketColours',1,table.items),20);
  assert.equal(gold_cost('Metadata/Items/Currency/CurrencyModValues',1,table.items),250);
  assert.equal(gold_cost('Metadata/Items/Currency/HarvestSeedBlue',9,table.items),2);
  for (const [id,item] of Object.entries(table.items)) assert.ok(Number.isSafeInteger(gold_cost(id,100,item && table.items)));
});


test('stock thresholds include equality and reject a low stock dip on any market leg', async () => {
  const {search_cycles, quote_recipe} = await import('../web/core.mjs');
  const edges = cycle.legs.map(e=>({...e,kind:'market',rate:e.output_volume/e.input_volume,low_rate:0.1,high_rate:3}));
  const options = {start:'a',budget:100,haircut_bps:0,min_volume:1,min_profit:0,max_trades:3,min_stock:100};
  for (const search of [o=>search_cycles({edges},o).cycles,o=>rank_cycles({cycles:[cycle]},o)]) {
    assert.equal(search(options).length,1);
    assert.equal(search({...options,min_stock:101}).length,0);
    for (const min_stock of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>search({...options,min_stock}),/Minimum historical stock/);
  }
  for (let i=0;i<edges.length;i++) {
    const dipped = edges.map((edge,j)=>j===i?{...edge,historical_low_stock:99,historical_high_stock:1000}:edge);
    assert.equal(search_cycles({edges:dipped},options).cycles.length,0);
    assert.equal(rank_cycles({cycles:[{...cycle,legs:dipped}]},options).length,0);
    assert.equal(search_cycles({edges:dipped.map((edge,j)=>j===i?{...edge,kind:'vendor'}:edge)},options).cycles.length,1);
  }
  const chaos = 'Metadata/Items/Currency/CurrencyRerollRare';
  const recipe = {kind:'fixed',inputs:{a:1},outputs:{[chaos]:2}};
  const quotes = [{...leg(chaos,'a',1,1),kind:'market'}];
  assert.equal(quote_recipe(recipe,quotes,1,0,0,null,100).profit,1);
  assert.throws(()=>quote_recipe(recipe,quotes,1,0,0,null,101),/at least 101/);
  assert.throws(()=>quote_recipe(recipe,quotes,1,0,0,null,0),/Minimum historical stock/);
});

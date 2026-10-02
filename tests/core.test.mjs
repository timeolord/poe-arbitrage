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
  const {gold, clicks, ...quote} = quote_recipe(recipe,edges,1,2,0);
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

test('manual quotes recalculate every leg and gold without mutating historical rates', async () => {
  const {manual_cycle} = await import('../web/core.mjs');
  const fees = {a:{fee:[15,1]}, b:{fee:[20,1]}};
  const legs = [leg('a','b',1,2),leg('b','a',10,6)];
  const saved = structuredClone(legs);
  const quotes = [{input:'1',output:'2.5'},{input:'2',output:'1.1'}];
  const result = manual_cycle(legs,quotes,100,0,fees);
  assert.deepEqual(result.simulation.amounts,[100,250,137]);
  assert.equal(result.simulation.profit,37);
  assert.deepEqual(result.simulation.gold.leg_costs,[5000,2055]);
  assert.equal(result.simulation.gold.total,7055);
  assert.equal(result.simulation.gold.gold_per_profit,7055/37);
  assert.deepEqual(legs,saved);
  assert.deepEqual(manual_cycle(legs,legs.map(e=>({input:String(e.input_volume),output:String(e.output_volume)})),100,100,fees).simulation,simulate_cycle(legs,100,100,fees));
  assert.equal(manual_cycle(legs,[quotes[0],{input:'2',output:'0.5'}],100,0,fees).simulation.profit,-38);
  assert.equal(manual_cycle(legs,[quotes[0],{input:'2',output:'0.5'}],100,0,fees).simulation.gold.gold_per_profit,null);
  const vendor = {...leg('a','b',3,4),kind:'vendor',rate:4/3};
  const mixed = manual_cycle([vendor,legs[1]],[{input:'0',output:'999'},{input:'1',output:'1'}],10,0,fees);
  assert.deepEqual(mixed.simulation.amounts,[10,12,12]);
  assert.deepEqual(mixed.simulation.leftovers,[1,0]);
  assert.deepEqual(mixed.simulation.gold.leg_costs,[0,180]);
});

test('manual decimal rates use exact arithmetic and reject invalid quotes', async () => {
  const {manual_cycle} = await import('../web/core.mjs');
  const legs = [leg('a','b',1,1)];
  assert.equal(manual_cycle(legs,[{input:'0.1',output:'0.3'}],10,0).simulation.end,30);
  assert.equal(manual_cycle(legs,[{input:'1',output:'0.999999999999'}],1000,0).simulation.end,999);
  for (const input of ['','0','-1','NaN','Infinity','1e3','0.0000000000001','9007199254740992']) assert.throws(()=>manual_cycle(legs,[{input,output:'1'}],10,0),/Quote/);
  assert.throws(()=>manual_cycle(legs,[],10,0),/each trade/);
  assert.throws(()=>manual_cycle(legs,[{input:'0.000000000001',output:'9007199254740991'}],10,0),/precision/);
});

test('click counts follow vendor input batches and include the closing market trade', async () => {
  const {manual_cycle, click_summary} = await import('../web/core.mjs');
  const legs = [leg('a','b',1,2),{...leg('b','c',3,4),kind:'vendor',rate:4/3},leg('c','a',1,1)];
  const result = simulate_cycle(legs,10,0);
  assert.deepEqual(result.amounts,[10,20,24,24]);
  assert.deepEqual(result.clicks,{leg_counts:[1,6,1],total:8,profit_per_click:14/8});
  assert.equal(result.leftovers[1],2);
  assert.deepEqual(simulate_cycle([leg('a','b',1,2),leg('b','a',1,1)],10,0).clicks,{leg_counts:[1,1],total:2,profit_per_click:5});
  assert.equal(simulate_cycle([{...leg('a','a',20,1),kind:'vendor'}],10,0).clicks.total,0);
  assert.equal(simulate_cycle([{...leg('a','a',20,1),kind:'vendor'}],10,0).clicks.profit_per_click,null);
  assert.equal(simulate_cycle([leg('a','a',2,1)],10,0).clicks.profit_per_click,-5);
  const edited = manual_cycle(legs,[{input:'1',output:'3'},null,{input:'1',output:'1'}],10,0);
  assert.deepEqual(edited.simulation.clicks.leg_counts,[1,10,1]);
  assert.equal(edited.simulation.clicks.profit_per_click,30/12);
  assert.throws(()=>click_summary([Number.MAX_SAFE_INTEGER,1],1),/precision/);
});

test('click efficiency ranks less laborious cycles above higher total profits', async () => {
  const {search_cycles,quote_recipe} = await import('../web/core.mjs');
  const edge = (from,to,x,y,kind='market')=>({...leg(from,to,x,y),kind,rate:y/x,low_rate:y/x,high_rate:y/x});
  const vendor = [edge('a','b',1,2),edge('b','a',1,1,'vendor')];
  const market = [edge('a','c',1,1),edge('c','a',10,11)];
  const league = {edges:[...vendor,...market],cycles:[vendor,market].map(legs=>({path:legs.map(e=>e.from),legs,profit_pct:profit_pct(legs.map(e=>e.rate))}))};
  const options = {start:'a',budget:100,haircut_bps:0,min_volume:1,min_profit:0,max_trades:2};
  for (const search of [o=>search_cycles(league,o).cycles,o=>rank_cycles(league,o)]) {
    assert.deepEqual(search({...options,sort_by:'profit'}).map(c=>c.path[1]),['b','c']);
    assert.deepEqual(search({...options,sort_by:'click_efficiency'}).map(c=>c.path[1]),['c','b']);
  }
  const chaos = 'Metadata/Items/Currency/CurrencyRerollRare';
  const recipe = {kind:'basket',inputs:{a:1,[chaos]:1},outputs:{b:2,[chaos]:1}};
  const quote = quote_recipe(recipe,[edge(chaos,'a',1,1),edge('b',chaos,1,2)],10,0,0);
  assert.equal(quote.clicks.total,12);
  assert.equal(quote.clicks.profit_per_click,quote.profit/12);
  assert.equal(quote_recipe({kind:'fixed',inputs:{[chaos]:1},outputs:{[chaos]:2}},[],10,0,0).clicks.total,10);
});

test('panel quotes discover profitable cycles without changing snapshot liquidity or vendor batches', async () => {
  const {apply_market_quotes,chaos_id,common_currencies,search_cycles,quote_recipe} = await import('../web/core.mjs');
  const currency = common_currencies[3], other = common_currencies[4];
  const edge = (from,to,x,y,kind='market') => ({...leg(from,to,x,y),kind,rate:y/x,low_rate:y/x,high_rate:y/x});
  const league = {edges:[edge(chaos_id,currency,100,100),edge(currency,chaos_id,100,90),edge(currency,other,3,1,'vendor'),edge(other,chaos_id,100,100)]};
  const original = structuredClone(league);
  const options = {start:chaos_id,budget:100,haircut_bps:0,min_volume:50,min_stock:100,min_profit:1,max_trades:2};
  assert.equal(search_cycles(league,options).cycles.length,0);
  const adjusted = apply_market_quotes(league,[{currency,buy:{input:'1',output:'2'},sell:{input:'2',output:'1.2'}}]);
  const found = search_cycles(adjusted,options).cycles;
  assert.equal(found.length,1);
  assert.equal(found[0].simulation.profit,20);
  assert.equal(found[0].simulation.clicks.profit_per_click,10);
  assert.equal(found[0].low_profit_pct, -9.999999999999998);
  assert.deepEqual(league,original);
  assert.deepEqual(adjusted.edges[2],original.edges[2]);
  assert.equal(adjusted.edges[0].historical_input_volume,100);
  assert.equal(search_cycles(adjusted,{...options,min_volume:101}).cycles.length,0);
  assert.equal(search_cycles(adjusted,{...options,min_stock:101}).cycles.length,0);
  assert.equal(quote_recipe({kind:'fixed',inputs:{[currency]:1},outputs:{[chaos_id]:1}},adjusted.edges,100,0,0).profit,50);
});

test('panel directions are independent and blank quotes restore the snapshot', async () => {
  const {apply_market_quotes,chaos_id,common_currencies,search_cycles} = await import('../web/core.mjs');
  const currency = common_currencies[0];
  const edges = [leg(chaos_id,currency,100,100),leg(currency,chaos_id,100,100)].map(e=>({...e,kind:'market',rate:1,low_rate:1,high_rate:1}));
  const league = {edges};
  const adjusted = apply_market_quotes(league,[{currency,buy:{input:'0.1',output:'0.3'},sell:{input:'',output:''}}]);
  assert.equal(adjusted.edges[0].rate,3);
  assert.deepEqual(adjusted.edges[1],edges[1]);
  assert.deepEqual(apply_market_quotes(league,[]),league);
  assert.deepEqual(apply_market_quotes(league,[{currency,buy:{input:' ',output:''}}]),league);
  const options = {start:chaos_id,budget:100,haircut_bps:100,min_volume:50,min_profit:0,max_trades:2};
  assert.equal(search_cycles(adjusted,options).cycles[0].simulation.end,294);
  const loss = apply_market_quotes(league,[{currency,buy:{input:'1',output:'0.1'}}]);
  assert.equal(search_cycles(loss,options).cycles.length,0);
});

test('panel rejects partial, invalid, duplicate and absent quotes atomically', async () => {
  const {apply_market_quotes,chaos_id,common_currencies} = await import('../web/core.mjs');
  const currency = common_currencies[0];
  const league = {edges:[{...leg(chaos_id,currency,100,100),kind:'market'}]};
  const original = structuredClone(league);
  for (const buy of [{input:'',output:'1'},{input:'1',output:''},{input:'0',output:'1'},{input:'NaN',output:'1'}]) assert.throws(()=>apply_market_quotes(league,[{currency,buy}]),/Quote/);
  assert.throws(()=>apply_market_quotes(league,[{currency,sell:{input:'1',output:'1'}}]),/No historical/);
  const quote = {currency,buy:{input:'1',output:'2'}};
  assert.throws(()=>apply_market_quotes(league,[quote,quote]),/Duplicate/);
  assert.throws(()=>apply_market_quotes(league,[{currency:'unknown'}]),/common/);
  assert.deepEqual(league,original);
});

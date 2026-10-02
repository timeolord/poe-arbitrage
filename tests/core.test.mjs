import test from 'node:test';
import assert from 'node:assert/strict';
import {profit_pct, simulate_cycle, rotate_cycle, rank_cycles} from '../web/core.mjs';

const leg = (from, to, input_volume, output_volume) => ({from, to, input_volume, output_volume});
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

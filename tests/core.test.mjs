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

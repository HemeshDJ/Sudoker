'use strict';

const assert = require('node:assert/strict');
const { evaluateHand, createSearchState, applyCycle, undoCycle } = require('../solver-core.js');

const card = (rank, suit) => ({ rank, suit });
const deck = [];
for (const suit of ['clubs', 'diamonds', 'hearts', 'spades']) for (let rank = 2; rank <= 14; rank++) deck.push(card(rank, suit));

assert.equal(evaluateHand([card(14, 'hearts'), card(5, 'clubs'), card(4, 'spades'), card(3, 'diamonds'), card(2, 'hearts')]).name, 'Straight');
assert.equal(evaluateHand([card(14, 'hearts'), card(13, 'hearts'), card(12, 'hearts'), card(11, 'hearts'), card(10, 'hearts')]).name, 'Royal flush');

let random = 0x12345678;
const next = () => { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return (random >>> 0) / 2 ** 32; };
const state = createSearchState(deck.slice(0, 25));
for (let step = 0; step < 2_000; step++) {
  const a = Math.floor(next() * 25);
  let b = Math.floor(next() * 25); if (b === a) b = (b + 1) % 25;
  const undo = applyCycle(state, [a, b]);
  assert.equal(state.total, createSearchState(state.board).total, `cached total diverged at step ${step}`);
  if (next() < 0.5) {
    undoCycle(state, undo);
    assert.equal(state.total, createSearchState(state.board).total, `undo diverged at step ${step}`);
  }
}
console.log('solver-core tests passed');

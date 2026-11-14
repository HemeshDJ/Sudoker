'use strict';

const assert = require('node:assert/strict');
const { evaluateHand, createSearchState, applyCycle, undoCycle, createSwapCounter } = require('../solver-core.js');

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
  let c = Math.floor(next() * 25); while (c === a || c === b) c = Math.floor(next() * 25);
  const undo = applyCycle(state, next() < 0.2 ? [a, b, c] : [a, b]);
  assert.equal(state.total, createSearchState(state.board).total, `cached total diverged at step ${step}`);
  if (next() < 0.5) {
    undoCycle(state, undo);
    assert.equal(state.total, createSearchState(state.board).total, `undo diverged at step ${step}`);
  }
}
function dealCard(id) {
  return { rank: 2 + (id % 13), suit: ['clubs', 'diamonds', 'hearts', 'spades'][Math.floor(id / 13)] };
}
function grid(ids) { return ids.map(dealCard); }
function swapRows(cards, left, right) {
  const next = cards.slice();
  for (let column = 0; column < 5; column++) {
    const a = left * 5 + column;
    const b = right * 5 + column;
    [next[a], next[b]] = [next[b], next[a]];
  }
  return next;
}
function swapColumns(cards, left, right) {
  const next = cards.slice();
  for (let row = 0; row < 5; row++) {
    const a = row * 5 + left;
    const b = row * 5 + right;
    [next[a], next[b]] = [next[b], next[a]];
  }
  return next;
}
function cycleCards(cards, indices) {
  const next = cards.slice();
  const moved = indices.map((index) => cards[index]);
  indices.forEach((index, position) => { next[indices[(position + 1) % indices.length]] = moved[position]; });
  return next;
}

const ordered = grid([...Array(25).keys()]);
const counter = createSwapCounter(ordered);
assert.equal(counter(ordered), 0);
assert.equal(counter(cycleCards(ordered, [0, 1])), 1);
assert.equal(counter(cycleCards(ordered, [0, 1, 2])), 2);
assert.equal(counter(swapRows(ordered, 0, 4)), 0);
assert.equal(counter(swapColumns(ordered, 1, 3)), 0);
assert.equal(counter(swapRows(cycleCards(ordered, [0, 1, 2]), 1, 2)), 2);
assert.equal(counter(swapColumns(swapRows(ordered, 0, 2), 0, 4)), 0);

function referenceSwaps(current, target) {
  const location = new Map(current.map((card, index) => [`${card.rank}:${card.suit}`, index]));
  const next = target.map((card) => location.get(`${card.rank}:${card.suit}`));
  const seen = new Array(25).fill(false);
  let swaps = 0;
  for (let start = 0; start < 25; start++) {
    if (seen[start] || next[start] === start) continue;
    let position = start;
    let length = 0;
    while (!seen[position]) { seen[position] = true; length++; position = next[position]; }
    swaps += length - 1;
  }
  return swaps;
}
function permutations(values) {
  if (values.length <= 1) return [values.slice()];
  const result = [];
  for (let index = 0; index < values.length; index++) {
    const rest = values.slice(0, index).concat(values.slice(index + 1));
    for (const perm of permutations(rest)) result.push([values[index], ...perm]);
  }
  return result;
}
function reorder(cards, rowOrder, columnOrder) {
  const next = new Array(25);
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 5; column++) next[row * 5 + column] = cards[rowOrder[row] * 5 + columnOrder[column]];
  }
  return next;
}
const orders = permutations([0, 1, 2, 3, 4]);
function bruteSwaps(current, target) {
  let best = 25;
  for (const rowOrder of orders) {
    for (const columnOrder of orders) {
      const swaps = referenceSwaps(current, reorder(target, rowOrder, columnOrder));
      if (swaps < best) best = swaps;
    }
  }
  return best;
}

let sample = 0xabcdef;
const sampleRandom = () => { sample ^= sample << 13; sample ^= sample >>> 17; sample ^= sample << 5; return (sample >>> 0) / 4294967296; };
for (let trial = 0; trial < 4; trial++) {
  const ids = [...Array(25).keys()];
  for (let index = ids.length - 1; index > 0; index--) {
    const swap = Math.floor(sampleRandom() * (index + 1));
    [ids[index], ids[swap]] = [ids[swap], ids[index]];
  }
  const shuffled = grid(ids);
  assert.equal(createSwapCounter(ordered)(shuffled), bruteSwaps(ordered, shuffled), `swap distance diverged on trial ${trial}`);
}

console.log('solver-core tests passed');

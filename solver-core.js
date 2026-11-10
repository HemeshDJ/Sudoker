(() => {
  'use strict';

  const handNames = ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush', 'Royal flush'];

  function evaluateHand(cards) {
    const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
    const groups = new Map();
    for (const rank of ranks) groups.set(rank, (groups.get(rank) || 0) + 1);
    const counts = [...groups.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const flush = cards.every((card) => card.suit === cards[0].suit);
    const unique = [...new Set(ranks)];
    let straightHigh = 0;
    if (unique.length === 5) {
      if (unique[0] - unique[4] === 4) straightHigh = unique[0];
      else if (unique.join(',') === '14,5,4,3,2') straightHigh = 5;
    }
    let category = 0;
    if (flush && straightHigh === 14) category = 9;
    else if (flush && straightHigh) category = 8;
    else if (counts[0][1] === 4) category = 7;
    else if (counts[0][1] === 3 && counts[1][1] === 2) category = 6;
    else if (flush) category = 5;
    else if (straightHigh) category = 4;
    else if (counts[0][1] === 3) category = 3;
    else if (counts[0][1] === 2 && counts[1][1] === 2) category = 2;
    else if (counts[0][1] === 2) category = 1;
    let scoredCardValue = ranks.reduce((sum, rank) => sum + rank, 0);
    if (category === 0) scoredCardValue = ranks[0];
    else if (category === 1) scoredCardValue = counts[0][0] * 2;
    else if (category === 2) scoredCardValue = (counts[0][0] + counts[1][0]) * 2;
    else if (category === 3) scoredCardValue = counts[0][0] * 3;
    else if (category === 7) scoredCardValue = counts[0][0] * 4;
    return { category, name: handNames[category], points: (category + 1) * 100 + scoredCardValue };
  }

  function handAt(cards, isRow, index) {
    return isRow ? cards.slice(index * 5, index * 5 + 5) : [cards[index], cards[index + 5], cards[index + 10], cards[index + 15], cards[index + 20]];
  }

  function createSearchState(cards) {
    const board = cards.slice();
    const rows = Array.from({ length: 5 }, (_, index) => evaluateHand(handAt(board, true, index)));
    const columns = Array.from({ length: 5 }, (_, index) => evaluateHand(handAt(board, false, index)));
    return { board, rows, columns, total: rows.concat(columns).reduce((sum, hand) => sum + hand.points, 0) };
  }

  function affectedHands(indices) {
    return {
      rows: [...new Set(indices.map((index) => Math.floor(index / 5)))],
      columns: [...new Set(indices.map((index) => index % 5))]
    };
  }

  // Mutates the selected positions in a cycle and returns an undo record. This
  // scores only the rows and columns touched by that move (at most six hands).
  function applyCycle(state, indices) {
    const affected = affectedHands(indices);
    const oldCards = indices.map((index) => state.board[index]);
    const oldRows = affected.rows.map((index) => [index, state.rows[index]]);
    const oldColumns = affected.columns.map((index) => [index, state.columns[index]]);
    const oldTotal = state.total;
    for (let i = 0; i < indices.length; i++) state.board[indices[(i + 1) % indices.length]] = oldCards[i];
    for (const row of affected.rows) state.rows[row] = evaluateHand(handAt(state.board, true, row));
    for (const column of affected.columns) state.columns[column] = evaluateHand(handAt(state.board, false, column));
    state.total = state.rows.concat(state.columns).reduce((sum, hand) => sum + hand.points, 0);
    return { indices, oldCards, oldRows, oldColumns, oldTotal };
  }

  function undoCycle(state, undo) {
    undo.indices.forEach((index, position) => { state.board[index] = undo.oldCards[position]; });
    undo.oldRows.forEach(([index, hand]) => { state.rows[index] = hand; });
    undo.oldColumns.forEach(([index, hand]) => { state.columns[index] = hand; });
    state.total = undo.oldTotal;
  }

  const api = { evaluateHand, createSearchState, applyCycle, undoCycle };
  if (typeof module !== 'undefined') module.exports = api;
  else window.SudokerSolver = api;
})();

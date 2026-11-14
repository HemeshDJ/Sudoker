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

  // 5! row orders and 5! column orders. Row and column order do not change the
  // score, so the swap distance that matters is the minimum over this group.
  const rowColOrders = new Uint8Array(120 * 5);
  {
    const used = [false, false, false, false, false];
    const current = [0, 0, 0, 0, 0];
    let cursor = 0;
    const walk = (depth) => {
      if (depth === 5) {
        rowColOrders.set(current, cursor);
        cursor += 5;
        return;
      }
      for (let value = 0; value < 5; value++) {
        if (used[value]) continue;
        used[value] = true;
        current[depth] = value;
        walk(depth + 1);
        used[value] = false;
      }
    };
    walk(0);
  }

  const arrangementNext = new Uint8Array(25);

  // `target[i]` is the position, on the reference grid, of the card sitting at
  // i. A k-cycle needs k − 1 swaps, so the swap count is 25 minus the number
  // of cycles, fixed points included.
  function swapsForPlacedCards(target) {
    let bestCycles = 0;
    for (let rowIndex = 0; rowIndex < 120; rowIndex++) {
      const row = rowIndex * 5;
      const row0 = rowColOrders[row] * 5;
      const row1 = rowColOrders[row + 1] * 5;
      const row2 = rowColOrders[row + 2] * 5;
      const row3 = rowColOrders[row + 3] * 5;
      const row4 = rowColOrders[row + 4] * 5;
      for (let columnIndex = 0; columnIndex < 120; columnIndex++) {
        const column = columnIndex * 5;
        const column0 = rowColOrders[column];
        const column1 = rowColOrders[column + 1];
        const column2 = rowColOrders[column + 2];
        const column3 = rowColOrders[column + 3];
        const column4 = rowColOrders[column + 4];
        arrangementNext[0] = target[row0 + column0]; arrangementNext[1] = target[row0 + column1]; arrangementNext[2] = target[row0 + column2]; arrangementNext[3] = target[row0 + column3]; arrangementNext[4] = target[row0 + column4];
        arrangementNext[5] = target[row1 + column0]; arrangementNext[6] = target[row1 + column1]; arrangementNext[7] = target[row1 + column2]; arrangementNext[8] = target[row1 + column3]; arrangementNext[9] = target[row1 + column4];
        arrangementNext[10] = target[row2 + column0]; arrangementNext[11] = target[row2 + column1]; arrangementNext[12] = target[row2 + column2]; arrangementNext[13] = target[row2 + column3]; arrangementNext[14] = target[row2 + column4];
        arrangementNext[15] = target[row3 + column0]; arrangementNext[16] = target[row3 + column1]; arrangementNext[17] = target[row3 + column2]; arrangementNext[18] = target[row3 + column3]; arrangementNext[19] = target[row3 + column4];
        arrangementNext[20] = target[row4 + column0]; arrangementNext[21] = target[row4 + column1]; arrangementNext[22] = target[row4 + column2]; arrangementNext[23] = target[row4 + column3]; arrangementNext[24] = target[row4 + column4];
        let mask = 0;
        let cycles = 0;
        let aborted = false;
        for (let index = 0; index < 25; index++) {
          const bit = 1 << index;
          if (mask & bit) continue;
          let position = index;
          do {
            mask |= 1 << position;
            position = arrangementNext[position];
          } while ((mask & (1 << position)) === 0);
          cycles++;
          // Remaining positions cannot add enough cycles to beat the best layout.
          if (cycles + 24 - index <= bestCycles) { aborted = true; break; }
        }
        if (!aborted && cycles > bestCycles) bestCycles = cycles;
      }
    }
    return 25 - bestCycles;
  }

  function cardIdentity(card) { return `${card.rank}:${card.suit}`; }

  // Counts the fewest swaps from `reference` to any row/column rearrangement of
  // a later grid. The reference grid is fixed for the whole search.
  function createSwapCounter(reference) {
    const identity = new Map(reference.map((card, index) => [cardIdentity(card), index]));
    const placed = new Uint8Array(25);
    return (cards) => {
      for (let index = 0; index < 25; index++) placed[index] = identity.get(cardIdentity(cards[index]));
      return swapsForPlacedCards(placed);
    };
  }

  const api = { evaluateHand, createSearchState, applyCycle, undoCycle, createSwapCounter };
  if (typeof module !== 'undefined') module.exports = api;
  else window.SudokerSolver = api;
})();

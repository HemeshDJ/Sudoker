(() => {
  'use strict';

  const suits = [
    { name: 'clubs', symbol: '♣', color: 'black' },
    { name: 'diamonds', symbol: '♦', color: 'red' },
    { name: 'hearts', symbol: '♥', color: 'red' },
    { name: 'spades', symbol: '♠', color: 'black' }
  ];
  const rankNames = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const handNames = ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush', 'Royal flush'];
  const effortBudgets = { 1: 35_000, 2: 120_000, 3: 300_000 };
  const $ = (id) => document.getElementById(id);
  const gridEl = $('card-grid');
  let board = [];
  let selected = -1;
  let activeDrag = null;
  let suppressClick = false;
  let swaps = 0;
  let seed = 0;
  let customCards = null;
  let solverBest = null;
  let solverScore = 0;
  let busy = false;
  let devSelection = new Set();

  function hashSeed(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0 || 1;
  }

  function randomGenerator(value) {
    let x = value >>> 0;
    return () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) / 4294967296;
    };
  }

  function fullDeck() {
    const deck = [];
    for (const suit of suits) for (let rank = 2; rank <= 14; rank++) deck.push({ rank, suit: suit.name, symbol: suit.symbol, color: suit.color });
    return deck;
  }

  function deal(newSeed) {
    seed = newSeed >>> 0 || 1;
    customCards = null;
    const random = randomGenerator(seed);
    const deck = fullDeck();
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    board = deck.slice(0, 25);
    selected = -1;
    swaps = 0;
    solverBest = null;
    $('seed-label').textContent = `DEAL ${seed.toString(10)}`;
    $('move-label').textContent = '0 swaps';
    $('apply-button').hidden = true;
    $('solver-status').textContent = 'The solver searches for a higher-scoring grid.';
    $('progress-track').hidden = true;
    render();
  }

  function cardKey(card) { return `${card.suit}-${card.rank}`; }

  function dealCustom(cards, newSeed) {
    seed = (newSeed ?? ((Math.random() * 0xffffffff) >>> 0)) >>> 0 || 1;
    customCards = cards.slice();
    board = shuffledCopy(customCards, randomGenerator(seed));
    selected = -1;
    swaps = 0;
    solverBest = null;
    $('seed-label').textContent = `DEV ${seed.toString(10)}`;
    $('move-label').textContent = '0 swaps';
    $('apply-button').hidden = true;
    $('solver-status').textContent = 'The solver searches for a higher-scoring grid.';
    $('progress-track').hidden = true;
    render();
  }

  function renderDevPicker() {
    const pool = $('dev-card-pool');
    pool.replaceChildren();
    const suitOrder = new Map(suits.map((suit, index) => [suit.name, index]));
    const cards = fullDeck().sort((a, b) => suitOrder.get(a.suit) - suitOrder.get(b.suit) || b.rank - a.rank);
    for (const card of cards) {
      const key = cardKey(card);
      const isSelected = devSelection.has(key);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `dev-card-picker ${card.color}${isSelected ? ' chosen' : ''}`;
      button.setAttribute('aria-pressed', String(isSelected));
      button.setAttribute('aria-label', `${rankLabel(card.rank)} of ${card.suit}${isSelected ? ', selected' : ''}`);
      button.innerHTML = `<span>${rankLabel(card.rank)}</span><span>${card.symbol}</span>`;
      button.addEventListener('click', () => {
        if (devSelection.has(key)) devSelection.delete(key);
        else if (devSelection.size < 25) devSelection.add(key);
        renderDevPicker();
      });
      pool.append(button);
    }
    const count = devSelection.size;
    $('dev-selection-count').textContent = `${count} / 25 selected`;
    $('dev-selection-hint').textContent = count === 25 ? 'Ready to shuffle' : `${25 - count} more needed`;
    $('dev-start').disabled = count !== 25;
  }

  function openDevSetup() {
    if (busy) return;
    devSelection = new Set(board.map(cardKey));
    renderDevPicker();
    $('dev-dialog').showModal();
  }

  function openSeedDialog() {
    if (busy) return;
    $('seed-input').value = String(seed);
    $('seed-error').textContent = '';
    $('seed-description').textContent = customCards
      ? 'For a custom deal, the same seed shuffles the same selected 25-card set into the same starting grid.'
      : 'Use the number shown beside YOUR GRID to recreate that standard deal.';
    $('seed-dialog').showModal();
    $('seed-input').focus();
    $('seed-input').select();
  }

  function rankLabel(rank) { return rankNames[rank] || String(rank); }

  function renderBoard() {
    gridEl.replaceChildren();
    board.forEach((card, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `playing-card ${card.color}${selected === index ? ' selected' : ''}`;
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-label', `${rankLabel(card.rank)} of ${card.suit}${selected === index ? ', selected' : ''}`);
      button.dataset.index = String(index);
      button.innerHTML = `<span class="card-corner">${rankLabel(card.rank)}<span>${card.symbol}</span></span><span class="card-center">${card.symbol}</span><span class="card-corner bottom">${rankLabel(card.rank)}<span>${card.symbol}</span></span>`;
      button.addEventListener('click', () => {
        if (suppressClick) return;
        chooseCard(index);
      });
      gridEl.append(button);
    });
  }

  function findCardAtPoint(x, y) {
    const element = document.elementFromPoint(x, y);
    const card = element?.closest?.('.playing-card');
    return card && gridEl.contains(card) ? card : null;
  }

  function clearDragStyles() {
    gridEl.querySelectorAll('.playing-card.dragging, .playing-card.drop-target').forEach((card) => {
      card.classList.remove('dragging', 'drop-target');
    });
    document.body.classList.remove('card-dragging');
  }

  gridEl.addEventListener('pointerdown', (event) => {
    const card = event.target.closest?.('.playing-card');
    if (!card || busy || (event.pointerType === 'mouse' && event.button !== 0)) return;
    activeDrag = {
      index: Number(card.dataset.index),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false
    };
  });

  document.addEventListener('pointermove', (event) => {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    const distance = Math.hypot(event.clientX - activeDrag.startX, event.clientY - activeDrag.startY);
    if (!activeDrag.dragging && distance >= 7) {
      activeDrag.dragging = true;
      gridEl.querySelector(`[data-index="${activeDrag.index}"]`)?.classList.add('dragging');
      document.body.classList.add('card-dragging');
    }
    if (!activeDrag.dragging) return;
    event.preventDefault();
    gridEl.querySelectorAll('.playing-card.drop-target').forEach((card) => card.classList.remove('drop-target'));
    const target = findCardAtPoint(event.clientX, event.clientY);
    if (target && Number(target.dataset.index) !== activeDrag.index) target.classList.add('drop-target');
  }, { passive: false });

  document.addEventListener('pointerup', (event) => {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    const drag = activeDrag;
    activeDrag = null;
    if (!drag.dragging) return;
    const target = findCardAtPoint(event.clientX, event.clientY);
    clearDragStyles();
    suppressClick = true;
    window.setTimeout(() => { suppressClick = false; }, 0);
    if (!target) return;
    const targetIndex = Number(target.dataset.index);
    if (targetIndex !== drag.index) swapCards(drag.index, targetIndex);
  });

  document.addEventListener('pointercancel', (event) => {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    activeDrag = null;
    clearDragStyles();
  });

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
    const points = (category + 1) * 100 + scoredCardValue;
    return { category, name: handNames[category], points };
  }

  function allHands(cards) {
    const rows = [], columns = [];
    for (let r = 0; r < 5; r++) rows.push(evaluateHand(cards.slice(r * 5, r * 5 + 5)));
    for (let c = 0; c < 5; c++) columns.push(evaluateHand([cards[c], cards[c + 5], cards[c + 10], cards[c + 15], cards[c + 20]]));
    const rowTotal = rows.reduce((sum, hand) => sum + hand.points, 0);
    const colTotal = columns.reduce((sum, hand) => sum + hand.points, 0);
    return { rows, columns, rowTotal, colTotal, total: rowTotal + colTotal };
  }

  function scoreHTML(hand) { return `<strong>${hand.points}</strong><small>${hand.name}</small>`; }

  function renderScores() {
    const result = allHands(board);
    $('row-hands').innerHTML = result.rows.map((hand) => `<div class="hand-score">${scoreHTML(hand)}</div>`).join('');
    $('column-hands').innerHTML = result.columns.map((hand) => `<div class="hand-score">${scoreHTML(hand)}</div>`).join('');
    $('total-score').textContent = result.total.toLocaleString();
    $('row-score').textContent = result.rowTotal.toLocaleString();
    $('col-score').textContent = result.colTotal.toLocaleString();
  }

  function render() { renderBoard(); renderScores(); }

  function chooseCard(index) {
    if (busy) return;
    if (selected === -1) {
      selected = index;
    } else if (selected === index) {
      selected = -1;
    } else {
      swapCards(selected, index);
      return;
    }
    render();
  }

  function swapCards(first, second) {
    if (busy || first === second) return;
    [board[first], board[second]] = [board[second], board[first]];
    selected = -1;
    swaps++;
    solverBest = null;
    $('apply-button').hidden = true;
    $('solver-status').textContent = 'Grid changed. Run the solver again to search this deal.';
    $('move-label').textContent = `${swaps} swap${swaps === 1 ? '' : 's'}`;
    render();
  }

  function swapRandom(cards, random, min = 1, max = 1) {
    const count = min + Math.floor(random() * (max - min + 1));
    for (let n = 0; n < count; n++) {
      const a = Math.floor(random() * 25);
      let b = Math.floor(random() * 25);
      if (b === a) b = (b + 1 + Math.floor(random() * 24)) % 25;
      [cards[a], cards[b]] = [cards[b], cards[a]];
    }
  }

  function shuffledCopy(cards, random) {
    const copy = cards.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  async function runSolver() {
    if (busy) return;
    busy = true;
    $('solve-button').disabled = true;
    $('new-deal').disabled = true;
    $('seed-button').disabled = true;
    $('dev-setup-button').disabled = true;
    $('apply-button').hidden = true;
    $('progress-track').hidden = false;
    $('progress-bar').style.width = '0%';
    const original = board.slice();
    const originalScore = allHands(original).total;
    const budget = effortBudgets[Number($('effort').value)];
    const random = randomGenerator((seed ^ Math.imul(swaps + 17, 0x9e3779b1) ^ (Date.now() >>> 0)) >>> 0 || 1);
    let best = original.slice();
    let bestScore = originalScore;
    let current = original.slice();
    let currentScore = originalScore;
    const restarts = 4;
    const perRestart = Math.floor(budget / restarts);
    let done = 0;

    try {
      for (let restart = 0; restart < restarts; restart++) {
        if (restart > 0) {
          current = restart % 2 ? shuffledCopy(best, random) : shuffledCopy(original, random);
          currentScore = allHands(current).total;
          if (currentScore > bestScore) { bestScore = currentScore; best = current.slice(); }
        }
        for (let step = 0; step < perRestart; step++) {
          const progress = step / perRestart;
          const temperature = 105 * Math.pow(0.7, progress * 8) + 0.7;
          const a = Math.floor(random() * 25);
          let b = Math.floor(random() * 24);
          if (b >= a) b++;
          [current[a], current[b]] = [current[b], current[a]];
          const candidateScore = allHands(current).total;
          const delta = candidateScore - currentScore;
          if (delta >= 0 || random() < Math.exp(delta / temperature)) {
            currentScore = candidateScore;
            if (candidateScore > bestScore) { bestScore = candidateScore; best = current.slice(); }
          } else {
            [current[a], current[b]] = [current[b], current[a]];
          }
          done++;
          if (step % 2500 === 0) {
            $('progress-bar').style.width = `${Math.round(done / budget * 100)}%`;
            $('solver-status').textContent = `Searching · best found ${bestScore.toLocaleString()} points`;
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
      }
      solverBest = best;
      solverScore = bestScore;
      const gain = bestScore - originalScore;
      $('progress-bar').style.width = '100%';
      $('solver-status').textContent = gain > 0
        ? `Search complete · found an arrangement ${gain.toLocaleString()} points higher.`
        : 'Search complete · no higher arrangement found in this search.';
      if (gain > 0) {
        $('improvement-label').textContent = `+${gain.toLocaleString()} pts`;
        $('apply-button').hidden = false;
      }
    } finally {
      busy = false;
      $('solve-button').disabled = false;
      $('new-deal').disabled = false;
      $('seed-button').disabled = false;
      $('dev-setup-button').disabled = false;
      $('solve-button').innerHTML = '<span>✦</span> Find best arrangement';
    }
  }

  $('solve-button').addEventListener('click', runSolver);
  $('apply-button').addEventListener('click', () => {
    if (!solverBest || busy) return;
    board = solverBest.slice();
    selected = -1;
    $('move-label').textContent = 'Solver arrangement';
    $('solver-status').textContent = `Applied arrangement · ${solverScore.toLocaleString()} points.`;
    $('apply-button').hidden = true;
    render();
  });
  $('new-deal').addEventListener('click', () => deal((Math.random() * 0xffffffff) >>> 0));
  $('seed-button').addEventListener('click', openSeedDialog);
  $('seed-cancel').addEventListener('click', () => $('seed-dialog').close());
  $('seed-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = Number($('seed-input').value);
    if (!Number.isInteger(value) || value < 1 || value > 0xffffffff) {
      $('seed-error').textContent = 'Enter a whole number from 1 to 4,294,967,295.';
      return;
    }
    $('seed-dialog').close();
    if (customCards) dealCustom(customCards, value);
    else deal(value);
  });
  $('dev-setup-button').addEventListener('click', openDevSetup);
  $('dev-clear').addEventListener('click', () => {
    devSelection.clear();
    renderDevPicker();
  });
  $('dev-start').addEventListener('click', () => {
    if (devSelection.size !== 25) return;
    const selectedCards = fullDeck().filter((card) => devSelection.has(cardKey(card)));
    $('dev-dialog').close();
    dealCustom(selectedCards);
  });
  $('effort').addEventListener('input', () => {
    $('effort-value').textContent = ({ 1: 'Quick', 2: 'Balanced', 3: 'Deep' })[$('effort').value];
  });
  $('help-button').addEventListener('click', () => $('help-dialog').showModal());
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  $('help-dialog').addEventListener('click', (event) => {
    if (event.target === $('help-dialog')) $('help-dialog').close();
  });

  $('today-label').textContent = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date()).toUpperCase();
  const now = new Date();
  const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  deal(hashSeed(dateKey));
})();

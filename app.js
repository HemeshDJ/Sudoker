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
  let solverSession = null;
  let moveGuideVisible = false;
  let applyPreview = false;
  let applyPreviewTarget = null;
  let busy = false;
  let stopRequested = false;
  let devSelection = new Set();
  const SETUPS_KEY = 'sudoker-setups';
  const LEGACY_SETUP_KEY = 'sudoker-setup';
  const HISTORY_LIMIT = 300;
  const SETUPS_LIMIT = 24;
  let undoStack = [];
  let redoStack = [];
  let memorySetups = [];

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

  function resumableRandom(value) {
    let x = value >>> 0 || 1;
    const random = () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) / 4294967296;
    };
    random.state = () => x >>> 0;
    return random;
  }

  function fullDeck() {
    const deck = [];
    for (const suit of suits) for (let rank = 2; rank <= 14; rank++) deck.push({ rank, suit: suit.name, symbol: suit.symbol, color: suit.color });
    return deck;
  }

  function deal(newSeed) {
    pushHistory('deal');
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
    resetSolverSession();
    moveGuideVisible = false;
    applyPreview = false;
    applyPreviewTarget = null;
    document.querySelector('.board-wrap')?.classList.remove('is-previewing');
    $('seed-label').textContent = seedText();
    $('move-label').textContent = formatSwaps(0);
    $('apply-button').hidden = true;
    $('guide-button').hidden = true;
    $('solver-status').textContent = 'The solver searches for a higher-scoring grid.';
    $('progress-track').hidden = true;
    render();
    updateHistoryUI();
  }

  function cardKey(card) { return `${card.suit}-${card.rank}`; }

  function cardSetId(cards) { return cards.map(cardKey).sort().join('|'); }

  function updateSessionUI() {
    const hasSession = Boolean(solverSession);
    $('solver-session').hidden = !hasSession;
    $('continue-button').hidden = !hasSession || busy;
    if (!hasSession) return;
    $('session-score').textContent = solverSession.score.toLocaleString();
    $('session-meta').textContent = `${solverSession.attempts.toLocaleString()} attempts · ${solverSession.runs} run${solverSession.runs === 1 ? '' : 's'}`;
  }

  function resetSolverSession() {
    solverSession = null;
    solverBest = null;
    solverScore = 0;
    updateSessionUI();
  }

  function ensureSolverSession() {
    const id = cardSetId(board);
    if (solverSession?.cardSetId === id) return solverSession;
    const score = allHands(board).total;
    solverSession = { cardSetId: id, incumbent: board.slice(), score, attempts: 0, runs: 0, rngState: hashSeed(`${id}:${seed}`) };
    solverBest = solverSession.incumbent;
    solverScore = score;
    return solverSession;
  }

  function setIncumbent(session, candidate, score) {
    if (score <= session.score) return false;
    session.incumbent = candidate.slice();
    session.score = score;
    solverBest = session.incumbent;
    solverScore = score;
    return true;
  }

  function dealCustom(cards, newSeed) {
    pushHistory('deal');
    seed = (newSeed ?? ((Math.random() * 0xffffffff) >>> 0)) >>> 0 || 1;
    customCards = cards.slice();
    board = shuffledCopy(customCards, randomGenerator(seed));
    selected = -1;
    swaps = 0;
    resetSolverSession();
    moveGuideVisible = false;
    applyPreview = false;
    applyPreviewTarget = null;
    document.querySelector('.board-wrap')?.classList.remove('is-previewing');
    $('seed-label').textContent = seedText();
    $('move-label').textContent = formatSwaps(0);
    $('apply-button').hidden = true;
    $('guide-button').hidden = true;
    $('solver-status').textContent = 'The solver searches for a higher-scoring grid.';
    $('progress-track').hidden = true;
    render();
    updateHistoryUI();
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
      button.className = `dev-card-picker ${card.color} suit-${card.suit}${isSelected ? ' chosen' : ''}`;
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
    $('dev-validation').textContent = count === 25
      ? 'Selection ready — shuffle to start a custom game.'
      : `Pick exactly 25 cards to start a custom game. (${count} selected)`;
  }

  function setDialogOpen(dialog, open) {
    if (open) {
      dialog.removeAttribute('inert');
      dialog.showModal();
    } else {
      dialog.close();
      dialog.setAttribute('inert', '');
    }
  }

  function openDevSetup() {
    if (busy) return;
    devSelection = new Set(board.map(cardKey));
    renderDevPicker();
    setDialogOpen($('dev-dialog'), true);
  }

  function openSeedDialog() {
    if (busy) return;
    $('seed-input').value = String(seed);
    $('seed-error').textContent = '';
    $('seed-description').textContent = customCards
      ? 'For a custom deal, the same seed shuffles the same selected 25-card set into the same starting grid.'
      : 'Use the number shown beside YOUR GRID to recreate that standard deal.';
    setDialogOpen($('seed-dialog'), true);
    $('seed-input').focus();
    $('seed-input').select();
  }

  function rankLabel(rank) { return rankNames[rank] || String(rank); }

  function visibleBoard() {
    return applyPreview && applyPreviewTarget ? applyPreviewTarget.board : board;
  }

  function setApplyPreview(active) {
    if (active) {
      if (!solverBest || busy || $('apply-button').hidden) return;
      applyPreview = true;
      applyPreviewTarget = closestEquivalentArrangement(board, solverBest);
      selected = -1;
      $('move-label').textContent = `Preview · ${applyPreviewTarget.plan.length} swap${applyPreviewTarget.plan.length === 1 ? '' : 's'}`;
    } else if (!applyPreview) {
      return;
    } else {
      applyPreview = false;
      applyPreviewTarget = null;
      $('move-label').textContent = `${swaps} swap${swaps === 1 ? '' : 's'}`;
    }
    document.querySelector('.board-wrap')?.classList.toggle('is-previewing', applyPreview);
    render();
  }

  function renderBoard() {
    const cards = visibleBoard();
    gridEl.replaceChildren();
    for (let row = 0; row < 5; row++) {
      const rowEl = document.createElement('div');
      rowEl.className = 'card-row';
      rowEl.setAttribute('role', 'row');
      for (let col = 0; col < 5; col++) {
        const index = row * 5 + col;
        const card = cards[index];
        const changed = applyPreview && cardKey(card) !== cardKey(board[index]);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `playing-card ${card.color} suit-${card.suit}${selected === index ? ' selected' : ''}${changed ? ' preview-changed' : ''}`;
        button.setAttribute('role', 'gridcell');
        button.setAttribute('aria-selected', String(selected === index));
        button.setAttribute('aria-label', `${rankLabel(card.rank)} of ${card.suit}${selected === index ? ', selected' : ''}${changed ? ', would move here' : ''}`);
        button.dataset.index = String(index);
        if (applyPreview) button.disabled = true;
        button.innerHTML = `<span class="card-corner">${rankLabel(card.rank)}<span>${card.symbol}</span></span><span class="card-center">${card.symbol}</span><span class="card-corner bottom">${rankLabel(card.rank)}<span>${card.symbol}</span></span>`;
        button.addEventListener('click', () => {
          if (suppressClick || applyPreview) return;
          chooseCard(index);
        });
        rowEl.append(button);
      }
      gridEl.append(rowEl);
    }
    if (moveGuideVisible && !applyPreview) renderMoveGuide();
  }

  // A cycle of n cards needs n - 1 swaps. Chaining adjacent positions in each
  // cycle produces an actionable plan with the smallest possible number of moves.
  function minimumSwapPlan(current, target) {
    const locations = new Map(current.map((card, index) => [cardKey(card), index]));
    const next = target.map((card) => locations.get(cardKey(card)));
    const seen = new Array(next.length).fill(false);
    const plan = [];
    for (let start = 0; start < next.length; start++) {
      if (seen[start] || next[start] === start) continue;
      const cycle = [];
      let position = start;
      while (!seen[position]) { seen[position] = true; cycle.push(position); position = next[position]; }
      for (let i = 0; i < cycle.length - 1; i++) plan.push([cycle[i], cycle[i + 1]]);
    }
    return plan;
  }

  function permutations(values) {
    if (values.length <= 1) return [values.slice()];
    const result = [];
    for (let i = 0; i < values.length; i++) {
      const rest = values.slice(0, i).concat(values.slice(i + 1));
      for (const perm of permutations(rest)) result.push([values[i], ...perm]);
    }
    return result;
  }

  // Row and column order do not change total score, so every row/col permutation of
  // a solved board is an equally good target. Cache the 5! orders once.
  const indexOrders = permutations([0, 1, 2, 3, 4]);

  function reorderGrid(cards, rowOrder, colOrder) {
    const next = new Array(25);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) next[row * 5 + col] = cards[rowOrder[row] * 5 + colOrder[col]];
    }
    return next;
  }

  // Among the 5!×5! score-equivalent layouts of `target`, pick the one reachable
  // from `current` with the fewest pairwise swaps.
  function closestEquivalentArrangement(current, target) {
    let bestPlan = null;
    let bestBoard = target;
    for (const rowOrder of indexOrders) {
      for (const colOrder of indexOrders) {
        const candidate = reorderGrid(target, rowOrder, colOrder);
        const plan = minimumSwapPlan(current, candidate);
        if (!bestPlan || plan.length < bestPlan.length) {
          bestPlan = plan;
          bestBoard = candidate;
          if (bestPlan.length === 0) return { board: bestBoard, plan: bestPlan };
        }
      }
    }
    return { board: bestBoard, plan: bestPlan };
  }

  function renderMoveGuide() {
    if (!solverBest) return;
    const plan = closestEquivalentArrangement(board, solverBest).plan;
    const bounds = gridEl.getBoundingClientRect();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('move-guide');
    svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    svg.setAttribute('aria-label', `${plan.length} minimum swaps to the solver arrangement`);
    svg.setAttribute('role', 'img');
    svg.innerHTML = '<defs><marker id="move-arrowhead-start" markerWidth="7" markerHeight="7" refX="2" refY="3.5" orient="auto"><path d="M7,0 L0,3.5 L7,7 Z" /></marker><marker id="move-arrowhead-end" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" /></marker></defs>';
    plan.forEach(([from, to], index) => {
      const source = gridEl.querySelector(`[data-index="${from}"]`).getBoundingClientRect();
      const destination = gridEl.querySelector(`[data-index="${to}"]`).getBoundingClientRect();
      const x1 = source.left - bounds.left + source.width / 2, y1 = source.top - bounds.top + source.height / 2;
      const x2 = destination.left - bounds.left + destination.width / 2, y2 = destination.top - bounds.top + destination.height / 2;
      const line = document.createElementNS(svg.namespaceURI, 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1); line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('class', 'move-guide-line');
      line.setAttribute('marker-start', 'url(#move-arrowhead-start)');
      line.setAttribute('marker-end', 'url(#move-arrowhead-end)');
      svg.append(line);
      const label = document.createElementNS(svg.namespaceURI, 'text');
      label.setAttribute('x', (x1 + x2) / 2); label.setAttribute('y', (y1 + y2) / 2);
      label.setAttribute('class', 'move-guide-label'); label.textContent = String(index + 1); svg.append(label);
    });
    gridEl.append(svg);
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
    if (!card || busy || applyPreview || (event.pointerType === 'mouse' && event.button !== 0)) return;
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

  function legacyEvaluateHand(cards) {
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

  function evaluateHand(cards) { return window.SudokerSolver.evaluateHand(cards); }

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
    const result = allHands(visibleBoard());
    $('row-hands').innerHTML = result.rows.map((hand) => `<div class="hand-score">${scoreHTML(hand)}</div>`).join('');
    $('column-hands').innerHTML = result.columns.map((hand) => `<div class="hand-score">${scoreHTML(hand)}</div>`).join('');
    $('total-score').textContent = result.total.toLocaleString();
    $('row-score').textContent = result.rowTotal.toLocaleString();
    $('col-score').textContent = result.colTotal.toLocaleString();
    const chip = document.querySelector('.score-chip');
    if (chip) {
      chip.classList.toggle('is-preview', applyPreview);
      chip.innerHTML = applyPreview
        ? '<span class="live-dot"></span> PREVIEW'
        : '<span class="live-dot"></span> LIVE';
    }
  }

  function render() { renderBoard(); renderScores(); }

  function formatSwaps(count) {
    return `${count} swap${count === 1 ? '' : 's'}`;
  }

  function seedText() {
    return `${customCards ? 'DEV' : 'DEAL'} ${seed.toString(10)}`;
  }

  function serializeCard(card) {
    return { rank: card.rank, suit: card.suit };
  }

  function cardFromData(data) {
    if (!data || typeof data !== 'object') return null;
    const suit = suits.find((entry) => entry.name === data.suit);
    const rank = data.rank;
    if (!suit || !Number.isInteger(rank) || rank < 2 || rank > 14) return null;
    return { rank, suit: suit.name, symbol: suit.symbol, color: suit.color };
  }

  function uniqueCards(list) {
    if (!Array.isArray(list) || list.length !== 25) return null;
    const cards = [];
    const seen = new Set();
    for (const item of list) {
      const card = cardFromData(item);
      if (!card) return null;
      const key = cardKey(card);
      if (seen.has(key)) return null;
      seen.add(key);
      cards.push(card);
    }
    return cards;
  }

  function moveLabelFor(count, text) {
    return text === 'Solver arrangement' ? text : formatSwaps(count);
  }

  function cloneSession(session) {
    if (!session) return null;
    return {
      cardSetId: session.cardSetId,
      incumbent: session.incumbent.slice(),
      score: session.score,
      attempts: session.attempts,
      runs: session.runs,
      rngState: session.rngState
    };
  }

  function displayedMoveText() {
    const text = $('move-label').textContent;
    if (applyPreview || text.startsWith('Preview')) return formatSwaps(swaps);
    return text;
  }

  function endPreview() {
    applyPreview = false;
    applyPreviewTarget = null;
    document.querySelector('.board-wrap')?.classList.remove('is-previewing');
  }

  function captureState() {
    return {
      board: board.slice(),
      swaps,
      moveText: displayedMoveText(),
      seed,
      customCards: customCards ? customCards.slice() : null,
      solverSession: cloneSession(solverSession),
      solverStatus: $('solver-status').textContent,
      applyHidden: $('apply-button').hidden,
      guideHidden: $('guide-button').hidden,
      guideHTML: $('guide-button').innerHTML,
      improvement: $('improvement-label').textContent,
      moveGuideVisible,
      progressHidden: $('progress-track').hidden,
      progressWidth: $('progress-bar').style.width
    };
  }

  function pushHistory(kind = 'move') {
    if (board.length !== 25) return;
    const snap = captureState();
    snap.kind = kind;
    undoStack.push(snap);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
    updateHistoryUI();
  }

  function applyCaptured(state) {
    const previousId = board.length === 25 ? cardSetId(board) : '';
    activeDrag = null;
    clearDragStyles();
    endPreview();
    board = state.board.slice();
    swaps = state.swaps;
    seed = state.seed;
    customCards = state.customCards ? state.customCards.slice() : null;
    selected = -1;
    $('move-label').textContent = state.moveText;
    $('seed-label').textContent = seedText();
    const id = cardSetId(board);
    // Deal checkpoints restore that deal's solver session. Swaps, applies, and
    // a load of the same cards keep any solver progress made afterward.
    const keepLive = previousId === id && state.kind !== 'deal';
    if (!keepLive) {
      if (state.solverSession && state.solverSession.cardSetId === id) {
        solverSession = cloneSession(state.solverSession);
        solverBest = solverSession.incumbent;
        solverScore = solverSession.score;
      } else {
        solverSession = null;
        solverBest = null;
        solverScore = 0;
      }
      moveGuideVisible = state.moveGuideVisible;
      $('solver-status').textContent = state.solverStatus;
      $('apply-button').hidden = state.applyHidden;
      $('guide-button').hidden = state.guideHidden;
      $('guide-button').innerHTML = state.guideHTML;
      $('improvement-label').textContent = state.improvement;
      $('progress-track').hidden = state.progressHidden;
      $('progress-bar').style.width = state.progressWidth;
    } else {
      if (solverSession && solverSession.cardSetId !== id) {
        solverSession = null;
        solverBest = null;
        solverScore = 0;
      }
      moveGuideVisible = false;
      $('guide-button').hidden = true;
      $('apply-button').hidden = !solverSession || solverSession.cardSetId !== id || solverSession.score <= allHands(board).total;
    }
    updateSessionUI();
    render();
    updateHistoryUI();
    return keepLive;
  }

  function undoMove() {
    if (busy || undoStack.length === 0) return;
    const target = undoStack.pop();
    const current = captureState();
    current.kind = target.kind;
    redoStack.push(current);
    applyCaptured(target);
  }

  function redoMove() {
    if (busy || redoStack.length === 0) return;
    const target = redoStack.pop();
    const current = captureState();
    current.kind = target.kind;
    undoStack.push(current);
    applyCaptured(target);
  }

  function normalizeSetup(data) {
    if (!data || (data.version !== 1 && data.version !== 2)) return null;
    const cards = uniqueCards(data.board);
    if (!cards) return null;
    if (!Number.isInteger(data.seed) || data.seed < 1 || data.seed > 0xffffffff) return null;
    let custom = null;
    if (data.customCards != null) {
      custom = uniqueCards(data.customCards);
      if (!custom || cardSetId(custom) !== cardSetId(cards)) return null;
    }
    if (!Number.isInteger(data.swaps) || data.swaps < 0 || data.swaps > 100000) return null;
    const score = Number.isInteger(data.score) ? data.score : allHands(cards).total;
    const name = typeof data.name === 'string' ? data.name.trim().slice(0, 40) : '';
    const id = typeof data.id === 'string' && data.id ? data.id : `setup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const savedAt = Number.isFinite(data.savedAt) ? data.savedAt : Date.now();
    return {
      id,
      name,
      savedAt,
      score,
      version: 2,
      seed: data.seed,
      customCards: custom,
      board: cards,
      swaps: data.swaps,
      moveText: moveLabelFor(data.swaps, data.moveText)
    };
  }

  function serializeSetup(setup) {
    return {
      id: setup.id,
      name: setup.name,
      savedAt: setup.savedAt,
      score: setup.score,
      version: 2,
      seed: setup.seed,
      customCards: setup.customCards ? setup.customCards.map(serializeCard) : null,
      board: setup.board.map(serializeCard),
      swaps: setup.swaps,
      moveText: setup.moveText
    };
  }

  function writeSetups(list) {
    memorySetups = list.map(serializeSetup).map(normalizeSetup).filter(Boolean);
    try {
      sessionStorage.setItem(SETUPS_KEY, JSON.stringify({ version: 2, items: memorySetups.map(serializeSetup) }));
      sessionStorage.removeItem(LEGACY_SETUP_KEY);
    } catch (error) { /* keep the in-memory list for this page */ }
  }

  function readSetups() {
    try {
      const raw = sessionStorage.getItem(SETUPS_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
        const list = items.map(normalizeSetup).filter(Boolean);
        if (list.length || (Array.isArray(data?.items) && data.items.length === 0)) {
          memorySetups = list;
          return list;
        }
      }
      const legacy = sessionStorage.getItem(LEGACY_SETUP_KEY);
      if (legacy) {
        const migrated = normalizeSetup(JSON.parse(legacy));
        if (migrated) {
          writeSetups([migrated]);
          return memorySetups.slice();
        }
        sessionStorage.removeItem(LEGACY_SETUP_KEY);
      }
    } catch (error) {
      try {
        sessionStorage.removeItem(SETUPS_KEY);
        sessionStorage.removeItem(LEGACY_SETUP_KEY);
      } catch (ignore) { /* storage unavailable */ }
    }
    return memorySetups.slice();
  }

  function sameSetup(setup) {
    if (seed !== setup.seed || swaps !== setup.swaps) return false;
    if (Boolean(customCards) !== Boolean(setup.customCards)) return false;
    if (customCards && cardSetId(customCards) !== cardSetId(setup.customCards)) return false;
    return board.every((card, index) => cardKey(card) === cardKey(setup.board[index]));
  }

  function defaultSetupName(score, swapCount) {
    return `${score.toLocaleString()} · ${formatSwaps(swapCount)}`;
  }

  function setupMeta(setup) {
    const deal = `${setup.customCards ? 'DEV' : 'DEAL'} ${setup.seed}`;
    return `${deal} · ${setup.score.toLocaleString()} pts · ${formatSwaps(setup.swaps)}`;
  }

  function openSetupsDialog() {
    if (busy) return;
    $('setup-name').value = '';
    renderSetupsList();
    setDialogOpen($('setups-dialog'), true);
    $('setup-name').focus();
  }

  function renderSetupsList() {
    const list = readSetups();
    const host = $('setups-list');
    $('setups-count').textContent = String(list.length);
    host.replaceChildren();
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'setups-empty';
      empty.textContent = 'No setups saved in this tab yet.';
      host.append(empty);
      return;
    }
    for (const setup of list) {
      const item = document.createElement('div');
      item.className = `setups-item${sameSetup(setup) ? ' is-current' : ''}`;
      item.setAttribute('role', 'listitem');
      const copy = document.createElement('div');
      copy.className = 'setups-item-copy';
      const title = document.createElement('div');
      title.className = 'setups-item-name';
      title.textContent = setup.name || defaultSetupName(setup.score, setup.swaps);
      const meta = document.createElement('div');
      meta.className = 'setups-item-meta';
      meta.textContent = setupMeta(setup);
      copy.append(title, meta);
      const actions = document.createElement('div');
      actions.className = 'setups-item-actions';
      const load = document.createElement('button');
      load.type = 'button';
      load.className = 'setups-load';
      load.textContent = sameSetup(setup) ? 'Current' : 'Load';
      load.disabled = sameSetup(setup);
      load.addEventListener('click', () => loadSetup(setup.id));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'setups-delete';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => deleteSetup(setup.id));
      actions.append(load, remove);
      item.append(copy, actions);
      host.append(item);
    }
  }

  function saveCurrentSetup(name = '') {
    if (busy || board.length !== 25) return false;
    const score = allHands(board).total;
    const payload = normalizeSetup({
      id: `setup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      savedAt: Date.now(),
      score,
      version: 2,
      seed,
      customCards: customCards ? customCards.map(serializeCard) : null,
      board: board.map(serializeCard),
      swaps,
      moveText: displayedMoveText()
    });
    if (!payload) return false;
    const list = readSetups().filter((entry) => !sameSetup(entry));
    list.unshift(payload);
    writeSetups(list.slice(0, SETUPS_LIMIT));
    updateHistoryUI();
    return true;
  }

  function loadSetup(id) {
    if (busy) return;
    const setup = readSetups().find((entry) => entry.id === id);
    if (!setup) {
      renderSetupsList();
      return;
    }
    if (!sameSetup(setup)) pushHistory('load');
    endPreview();
    seed = setup.seed;
    customCards = setup.customCards ? setup.customCards.slice() : null;
    board = setup.board.slice();
    swaps = setup.swaps;
    selected = -1;
    activeDrag = null;
    clearDragStyles();
    moveGuideVisible = false;
    $('move-label').textContent = setup.moveText;
    $('seed-label').textContent = seedText();
    const idCards = cardSetId(board);
    $('guide-button').hidden = true;
    if (solverSession && solverSession.cardSetId !== idCards) resetSolverSession();
    if (solverSession && solverSession.cardSetId === idCards) {
      $('apply-button').hidden = solverSession.score <= allHands(board).total;
    } else {
      $('apply-button').hidden = true;
      $('progress-track').hidden = true;
      $('solver-status').textContent = 'The solver searches for a higher-scoring grid.';
    }
    updateSessionUI();
    render();
    updateHistoryUI();
    renderSetupsList();
  }

  function deleteSetup(id) {
    writeSetups(readSetups().filter((entry) => entry.id !== id));
    updateHistoryUI();
    renderSetupsList();
  }

  function updateHistoryUI() {
    const count = readSetups().length;
    $('undo-button').disabled = busy || undoStack.length === 0;
    $('redo-button').disabled = busy || redoStack.length === 0;
    $('setups-button').disabled = busy;
    $('setups-button').title = count
      ? `Saved grids for this tab · ${count} setup${count === 1 ? '' : 's'} (Ctrl+S)`
      : 'Saved grids for this tab (Ctrl+S)';
  }

  function isTypingTarget(target) {
    if (!(target instanceof Element)) return false;
    const field = target.closest('input, textarea, select, [contenteditable="true"]');
    if (!field) return false;
    return !(field instanceof HTMLInputElement && field.type === 'range');
  }

  function chooseCard(index) {
    if (busy || applyPreview) return;
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
    if (busy || applyPreview || first === second) return;
    pushHistory('move');
    [board[first], board[second]] = [board[second], board[first]];
    selected = -1;
    swaps++;
    moveGuideVisible = false;
    const session = ensureSolverSession();
    const currentScore = allHands(board).total;
    $('apply-button').hidden = session.score <= currentScore;
    $('guide-button').hidden = true;
    $('solver-status').textContent = `Grid changed. Session best remains ${session.score.toLocaleString()} points.`;
    $('move-label').textContent = formatSwaps(swaps);
    render();
    updateSessionUI();
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

  function randomPosition(random, except = []) {
    let position;
    do position = Math.floor(random() * 25); while (except.includes(position));
    return position;
  }

  function chooseMove(state, random) {
    let a;
    // Spend some moves on cards shared by the weakest current hands, while
    // retaining random moves for exploration.
    if (random() < 0.32) {
      const hands = state.rows.map((hand, index) => ({ hand, row: index }))
        .concat(state.columns.map((hand, index) => ({ hand, column: index })))
        .sort((left, right) => left.hand.points - right.hand.points);
      const weak = hands[Math.floor(random() * Math.min(3, hands.length))];
      a = weak.row === undefined ? weak.column + 5 * Math.floor(random() * 5) : weak.row * 5 + Math.floor(random() * 5);
    } else a = randomPosition(random);
    const b = randomPosition(random, [a]);
    return random() < 0.12 ? [a, b, randomPosition(random, [a, b])] : [a, b];
  }

  function restartBoard(best, original, restart, random) {
    if (restart % 4 === 1) {
      const nearby = best.slice(); swapRandom(nearby, random, 2, 5); return nearby;
    }
    if (restart % 4 === 2) {
      const nearby = best.slice(); swapRandom(nearby, random, 7, 14); return nearby;
    }
    if (restart % 4 === 3) return shuffledCopy(best, random);
    return shuffledCopy(original, random);
  }

  async function runSolver(mode = 'current') {
    if (busy) return;
    busy = true;
    stopRequested = false;
    updateHistoryUI();
    moveGuideVisible = false;
    $('solve-button').disabled = true;
    $('new-deal').disabled = true;
    $('seed-button').disabled = true;
    $('dev-setup-button').disabled = true;
    $('stop-button').hidden = false;
    $('stop-button').disabled = false;
    $('apply-button').hidden = true;
    $('guide-button').hidden = true;
    $('guide-button').innerHTML = 'Show minimum-move guide <span id="transition-label"></span>';
    updateSessionUI();
    $('progress-track').hidden = false;
    $('progress-bar').style.width = '0%';
    const original = board.slice();
    const originalScore = allHands(original).total;
    const session = ensureSolverSession();
    setIncumbent(session, original, originalScore);
    const effort = Number($('effort').value);
    const endless = effort === 4;
    const budget = effortBudgets[effort === 4 ? 3 : effort];
    const random = resumableRandom(session.rngState);
    let best = session.incumbent.slice();
    let bestScore = session.score;
    let currentState = window.SudokerSolver.createSearchState(mode === 'continue' ? best : original);
    const restarts = 4;
    const perRestart = Math.floor(budget / restarts);
    let done = 0;
    let restart = 0;
    let plateau = 0;
    const startedAt = performance.now();

    try {
      while ((endless || restart < restarts) && !stopRequested) {
        if (restart > 0) {
          currentState = window.SudokerSolver.createSearchState(restartBoard(best, original, restart, random));
          plateau = 0;
        }
        for (let step = 0; step < perRestart && !stopRequested; step++) {
          const progress = step / perRestart;
          const reheating = plateau > perRestart / 3 ? 2.2 : 1;
          const temperature = (105 * Math.pow(0.7, progress * 8) + 0.7) * reheating;
          const undo = window.SudokerSolver.applyCycle(currentState, chooseMove(currentState, random));
          const candidateScore = currentState.total;
          const delta = candidateScore - undo.oldTotal;
          if (delta >= 0 || random() < Math.exp(delta / temperature)) {
            if (candidateScore > bestScore) {
              bestScore = candidateScore;
              best = currentState.board.slice();
              plateau = 0;
            } else plateau++;
          } else {
            window.SudokerSolver.undoCycle(currentState, undo);
            plateau++;
          }
          done++;
          if (step % 2500 === 0) {
            const progress = endless ? (step + 1) / perRestart : done / budget;
            const seconds = Math.max((performance.now() - startedAt) / 1000, 0.01);
            $('progress-bar').style.width = `${Math.round(progress * 100)}%`;
            $('solver-status').textContent = endless
              ? `Searching forever · ${done.toLocaleString()} attempts · ${(done / seconds).toFixed(0)}/sec · best ${bestScore.toLocaleString()}`
              : `Searching · ${(done / seconds).toFixed(0)} attempts/sec · best ${bestScore.toLocaleString()} points`;
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
        restart++;
      }
      setIncumbent(session, best, bestScore);
      session.attempts += done;
      session.runs++;
      session.rngState = random.state();
      solverBest = session.incumbent;
      solverScore = session.score;
      const gain = bestScore - originalScore;
      $('progress-bar').style.width = '100%';
      $('solver-status').textContent = stopRequested
        ? `Search stopped after ${done.toLocaleString()} attempts · session best ${session.score.toLocaleString()} points.`
        : gain > 0
          ? `Search complete · found an arrangement ${gain.toLocaleString()} points higher.`
          : 'Search complete · no higher arrangement found in this run.';
      const displayedGain = session.score - originalScore;
      if (displayedGain > 0) {
        $('improvement-label').textContent = `+${displayedGain.toLocaleString()} pts`;
        $('apply-button').hidden = false;
        const transitions = closestEquivalentArrangement(original, session.incumbent).plan.length;
        $('transition-label').textContent = `(${transitions} swap${transitions === 1 ? '' : 's'})`;
        $('guide-button').hidden = false;
      }
    } finally {
      busy = false;
      $('solve-button').disabled = false;
      $('new-deal').disabled = false;
      $('seed-button').disabled = false;
      $('dev-setup-button').disabled = false;
      $('stop-button').hidden = true;
      $('stop-button').disabled = false;
      $('solve-button').innerHTML = '<span>✦</span> Find best arrangement';
      updateSessionUI();
      updateHistoryUI();
    }
  }

  $('solve-button').addEventListener('click', runSolver);
  $('continue-button').addEventListener('click', () => runSolver('continue'));
  $('reset-session').addEventListener('click', () => {
    if (busy) return;
    resetSolverSession();
    $('apply-button').hidden = true;
    $('guide-button').hidden = true;
    $('solver-status').textContent = 'Solver progress reset for this deal.';
  });
  $('stop-button').addEventListener('click', () => {
    if (!busy) return;
    stopRequested = true;
    $('stop-button').disabled = true;
    $('solver-status').textContent = 'Stopping after the current batch…';
  });
  const applyButton = $('apply-button');
  applyButton.title = 'Hover to preview the closest best arrangement';
  applyButton.addEventListener('pointerenter', () => setApplyPreview(true));
  applyButton.addEventListener('pointerleave', () => setApplyPreview(false));
  applyButton.addEventListener('focus', () => setApplyPreview(true));
  applyButton.addEventListener('blur', () => setApplyPreview(false));
  applyButton.addEventListener('click', () => {
    if (!solverBest || busy) return;
    const next = applyPreviewTarget || closestEquivalentArrangement(board, solverBest);
    pushHistory('move');
    endPreview();
    board = next.board;
    selected = -1;
    moveGuideVisible = false;
    $('move-label').textContent = 'Solver arrangement';
    $('solver-status').textContent = `Applied arrangement · ${solverScore.toLocaleString()} points.`;
    applyButton.hidden = true;
    $('guide-button').hidden = true;
    render();
  });
  $('guide-button').addEventListener('click', () => {
    if (!solverBest || busy) return;
    setApplyPreview(false);
    moveGuideVisible = !moveGuideVisible;
    const transitions = closestEquivalentArrangement(board, solverBest).plan.length;
    $('guide-button').innerHTML = moveGuideVisible
      ? 'Hide minimum-move guide'
      : `Show minimum-move guide <span id="transition-label">(${transitions} swap${transitions === 1 ? '' : 's'})</span>`;
    render();
  });
  window.addEventListener('resize', () => {
    if (moveGuideVisible) render();
  });
  $('undo-button').addEventListener('click', undoMove);
  $('redo-button').addEventListener('click', redoMove);
  $('setups-button').addEventListener('click', openSetupsDialog);
  $('setups-close').addEventListener('click', () => setDialogOpen($('setups-dialog'), false));
  $('setups-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!saveCurrentSetup($('setup-name').value)) return;
    $('setup-name').value = '';
    renderSetupsList();
  });
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || busy) return;
    const key = event.key.toLowerCase();
    const command = event.ctrlKey || event.metaKey;
    if (!command || event.altKey) return;
    if (key === 's' && !event.shiftKey) {
      event.preventDefault();
      if ($('setups-dialog').open) {
        if (!saveCurrentSetup($('setup-name').value)) return;
        $('setup-name').value = '';
        renderSetupsList();
      } else if (!document.querySelector('dialog[open]') && !isTypingTarget(event.target)) {
        openSetupsDialog();
      }
      return;
    }
    if (document.querySelector('dialog[open]')) return;
    if (isTypingTarget(event.target)) return;
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undoMove();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      redoMove();
    }
  });
  $('new-deal').addEventListener('click', () => deal((Math.random() * 0xffffffff) >>> 0));
  $('seed-button').addEventListener('click', openSeedDialog);
  $('seed-cancel').addEventListener('click', () => setDialogOpen($('seed-dialog'), false));
  $('seed-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = Number($('seed-input').value);
    if (!Number.isInteger(value) || value < 1 || value > 0xffffffff) {
      $('seed-error').textContent = 'Enter a whole number from 1 to 4,294,967,295.';
      return;
    }
    setDialogOpen($('seed-dialog'), false);
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
    setDialogOpen($('dev-dialog'), false);
    dealCustom(selectedCards);
  });
  $('effort').addEventListener('input', () => {
    $('effort-value').textContent = ({ 1: 'Quick', 2: 'Balanced', 3: 'Deep', 4: 'Forever' })[$('effort').value];
  });
  $('help-button').addEventListener('click', () => setDialogOpen($('help-dialog'), true));
  $('close-help').addEventListener('click', () => setDialogOpen($('help-dialog'), false));
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.setAttribute('inert', '');
    dialog.addEventListener('close', () => dialog.setAttribute('inert', ''));
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) setDialogOpen(dialog, false);
    });
  });

  $('today-label').textContent = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date()).toUpperCase();
  const now = new Date();
  const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  deal(hashSeed(dateKey));
})();

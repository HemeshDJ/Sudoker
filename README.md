# Sudoker

A browser version of Sudoker: arrange 25 cards in a 5×5 grid to make strong poker hands across all five rows and all five columns.

## Run it

Open `index.html` in a modern browser. There is no build step or dependency install.

## GitHub Pages

The `Deploy GitHub Pages` workflow publishes the static app whenever changes are pushed to `main`. It can also be started manually from the repository's Actions tab. In the repository settings, set Pages' build source to **GitHub Actions**. The site is served from the repository's project URL.

## Play

- Click one card, then another, to swap them.
- Each row and column is scored as a five-card poker hand.
- The hand score is `(hand rank × 100) + the values of the cards making that hand`; kickers do not add points. Card values run from 2 through 14. For example, four 8s with a 10 kicker score 832.
- Use **New deal** for a random board. The initial board is seeded by the local date, so it stays the same for the day.
- Open **Dev setup** to choose exactly 25 cards from a standard deck, then shuffle those selected cards into a custom game.
- Choose a search effort and run the solver to look for a higher score.

## Solver

The solver uses simulated annealing with multiple restarts and card swaps as its moves. It returns the best arrangement it found during the configured search budget. This is a heuristic search, not a proof of the globally optimal arrangement.

## Hand ranks

High card, pair, two pair, three of a kind, straight, flush, full house, four of a kind, straight flush, royal flush. Their multipliers are 1 through 10 in that order.

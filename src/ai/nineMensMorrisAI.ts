/* ------------------------------------------------------------------ */
/* Intelligence Artificielle : Nine Men's Morris                      */
/* Niveaux : Débutant, Amateur, Confirmé, Expert, Maître             */
/* ------------------------------------------------------------------ */

import {
  Player,
  Cell,
  PIECES_PER_PLAYER,
  MILLS,
  opponent,
  countPieces,
  millsFormedAt,
  removablePieces,
  isFlying,
  destinationsFor,
  hasAnyMove,
} from '../game/nineMensMorris';

export type AILevel = 1 | 2 | 3 | 4 | 5;

export interface AIState {
  board: Cell[];
  turn: Player;
  placed: Record<Player, number>;
}

export interface AIPlacement {
  type: 'place';
  to: number;
}

export interface AIMove {
  type: 'move';
  from: number;
  to: number;
}

export interface AICapture {
  type: 'capture';
  target: number;
}

export type AIAction = AIPlacement | AIMove | AICapture;

const LEVEL_NAMES: Record<AILevel, string> = {
  1: 'Débutant',
  2: 'Amateur',
  3: 'Confirmé',
  4: 'Expert',
  5: 'Maître',
};

export function aiLevelName(level: AILevel): string {
  return LEVEL_NAMES[level];
}

function copyBoard(b: Cell[]): Cell[] {
  return [...b];
}

function allPlaced(placed: Record<Player, number>): boolean {
  return placed.W >= PIECES_PER_PLAYER && placed.B >= PIECES_PER_PLAYER;
}

/* ------------------------------------------------------------------ */
/* Génération des coups légaux                                        */
/* ------------------------------------------------------------------ */

function legalPlacements(board: Cell[]): number[] {
  return board.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
}

function legalCaptures(board: Cell[], by: Player): number[] {
  return removablePieces(board, opponent(by));
}

function legalMoves(board: Cell[], player: Player, flying: boolean): AIMove[] {
  const moves: AIMove[] = [];
  for (let from = 0; from < 24; from++) {
    if (board[from] !== player) continue;
    for (const to of destinationsFor(board, from, flying)) {
      moves.push({ type: 'move', from, to });
    }
  }
  return moves;
}

function applyAction(state: AIState, action: AIAction): AIState {
  const board = copyBoard(state.board);
  const placed = { ...state.placed };
  if (action.type === 'place') {
    board[action.to] = state.turn;
    placed[state.turn] += 1;
  } else if (action.type === 'move') {
    board[action.from] = null;
    board[action.to] = state.turn;
  } else {
    board[action.target] = null;
  }
  return { board, turn: state.turn, placed };
}

/** Apply a placement/move and immediately resolve any forced capture. */
function applyFullTurn(state: AIState, action: AIPlacement | AIMove): AIState {
  let s = applyAction(state, action);
  const pos = action.type === 'place' ? action.to : action.to;
  const mills = millsFormedAt(s.board, pos, s.turn);
  if (mills.length > 0) {
    const targets = removablePieces(s.board, opponent(s.turn));
    if (targets.length > 0) {
      // pick the capture that maximizes our heuristic
      let bestTarget = targets[0];
      let bestScore = -Infinity;
      for (const t of targets) {
        const afterCapture = applyAction(s, { type: 'capture', target: t });
        const score = evaluate(afterCapture, s.turn);
        if (score > bestScore) {
          bestScore = score;
          bestTarget = t;
        }
      }
      s = applyAction(s, { type: 'capture', target: bestTarget });
    }
  }
  return { ...s, turn: opponent(s.turn) };
}

/* ------------------------------------------------------------------ */
/* Heuristique d'évaluation                                          */
/* ------------------------------------------------------------------ */

const POS_VALUE = [
  1.0, 1.6, 1.0,
  1.3, 1.9, 1.3,
  1.1, 2.0, 1.1,
  1.6, 1.7, 1.1, 1.1, 1.7, 1.6,
  1.1, 2.0, 1.1,
  1.3, 1.9, 1.3,
  1.0, 1.6, 1.0,
];

function countMills(board: Cell[], player: Player): number {
  return MILLS.filter((m) => m.every((p) => board[p] === player)).length;
}

function countTwoInLine(board: Cell[], player: Player): number {
  let n = 0;
  for (const m of MILLS) {
    const vals = m.map((p) => board[p]);
    const mine = vals.filter((v) => v === player).length;
    const empty = vals.filter((v) => v === null).length;
    if (mine === 2 && empty === 1) n++;
  }
  return n;
}

function mobility(board: Cell[], player: Player, placedAll: boolean): number {
  if (!placedAll) return 0;
  let total = 0;
  const fly = isFlying(board, player, placedAll);
  for (let i = 0; i < 24; i++) {
    if (board[i] === player) total += destinationsFor(board, i, fly).length;
  }
  return total;
}

function evaluate(state: AIState, maximizing: Player): number {
  const me = maximizing;
  const opp = opponent(me);
  const b = state.board;
  const placedAll = allPlaced(state.placed);

  const myPieces = countPieces(b, me);
  const oppPieces = countPieces(b, opp);

  if (placedAll && myPieces < 3) return -10000;
  if (placedAll && oppPieces < 3) return 10000;
  if (placedAll && !hasAnyMove(b, opp, isFlying(b, opp, placedAll))) return 10000;
  if (placedAll && !hasAnyMove(b, me, isFlying(b, me, placedAll))) return -10000;

  let score = 0;
  score += (myPieces - oppPieces) * 120;
  score += (countMills(b, me) - countMills(b, opp)) * 55;
  score += (countTwoInLine(b, me) - countTwoInLine(b, opp)) * 18;
  score += (mobility(b, me, placedAll) - mobility(b, opp, placedAll)) * 5;

  for (let i = 0; i < 24; i++) {
    if (b[i] === me) score += POS_VALUE[i] * 4;
    if (b[i] === opp) score -= POS_VALUE[i] * 4;
  }

  return score;
}

/* ------------------------------------------------------------------ */
/* Stratégies par niveau                                             */
/* ------------------------------------------------------------------ */

function randomPick<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Débutant : coup aléatoire uniforme. */
function chooseBeginner(state: AIState): AIAction | null {
  const placedAll = allPlaced(state.placed);
  if (!placedAll) {
    return randomPick(legalPlacements(state.board).map((to) => ({ type: 'place' as const, to })));
  }
  const fly = isFlying(state.board, state.turn, placedAll);
  return randomPick(legalMoves(state.board, state.turn, fly));
}

/** Amateur : prend un moulin s'il existe, évite de donner un moulin. */
function chooseAmateur(state: AIState): AIAction | null {
  const placedAll = allPlaced(state.placed);
  const turn = state.turn;
  const board = state.board;
  if (!placedAll) {
    const placements = legalPlacements(board).map((to) => ({ type: 'place' as const, to }));
    const winning = placements.filter((a) => millsFormedAt(applyAction(state, a).board, a.to, turn).length > 0);
    if (winning.length) return randomPick(winning);
    const safe = placements.filter((a) => {
      const ns = applyAction(state, a);
      return legalCaptures(ns.board, turn).length === 0;
    });
    return randomPick(safe.length ? safe : placements);
  }
  const fly = isFlying(board, turn, placedAll);
  const moves = legalMoves(board, turn, fly);
  const winning = moves.filter((a) =>
    millsFormedAt(applyAction(state, a).board, a.to, turn).length > 0
  );
  if (winning.length) return randomPick(winning);
  const safe = moves.filter((a) => {
    const ns = applyAction(state, a);
    return legalCaptures(ns.board, turn).length === 0;
  });
  return randomPick(safe.length ? safe : moves);
}

/** Confirmé : évalue tous les coups immédiats et choisit le meilleur. */
function chooseIntermediate(state: AIState): AIAction | null {
  const placedAll = allPlaced(state.placed);
  const turn = state.turn;
  const board = state.board;
  let candidates: (AIPlacement | AIMove)[];
  if (!placedAll) {
    candidates = legalPlacements(board).map((to) => ({ type: 'place' as const, to }));
  } else {
    const fly = isFlying(board, turn, placedAll);
    candidates = legalMoves(board, turn, fly);
  }
  if (candidates.length === 0) return null;
  return bestByEvaluation(state, candidates, 1);
}

/* ------------------------------------------------------------------ */
/* Minimax avec alpha-beta pruning                                   */
/* ------------------------------------------------------------------ */

function bestByEvaluation(state: AIState, actions: (AIPlacement | AIMove)[], depth: number): AIAction | null {
  const maximizing = state.turn;
  let best: AIAction | null = null;
  let bestScore = -Infinity;
  for (const action of actions) {
    const after = applyFullTurn(state, action);
    const score = minimax(after, depth - 1, -Infinity, Infinity, false, maximizing);
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

function minimax(
  state: AIState,
  depth: number,
  alpha: number,
  beta: number,
  isMax: boolean,
  maximizing: Player
): number {
  const placedAll = allPlaced(state.placed);
  const turn = state.turn;
  const board = state.board;

  // terminal states
  const myPieces = countPieces(board, maximizing);
  const oppPieces = countPieces(board, opponent(maximizing));
  if (placedAll && (myPieces < 3 || oppPieces < 3)) {
    return evaluate(state, maximizing);
  }
  if (placedAll && !hasAnyMove(board, turn, isFlying(board, turn, placedAll))) {
    return turn === maximizing ? -10000 : 10000;
  }
  if (depth === 0) return evaluate(state, maximizing);

  let actions: (AIPlacement | AIMove)[];
  if (!placedAll) {
    actions = legalPlacements(board).map((to) => ({ type: 'place' as const, to }));
  } else {
    const fly = isFlying(board, turn, placedAll);
    actions = legalMoves(board, turn, fly);
  }
  if (actions.length === 0) return turn === maximizing ? -10000 : 10000;

  if (isMax) {
    let maxEval = -Infinity;
    for (const action of actions) {
      const ns = applyFullTurn(state, action);
      const eval_ = minimax(ns, depth - 1, alpha, beta, false, maximizing);
      maxEval = Math.max(maxEval, eval_);
      alpha = Math.max(alpha, eval_);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const action of actions) {
      const ns = applyFullTurn(state, action);
      const eval_ = minimax(ns, depth - 1, alpha, beta, true, maximizing);
      minEval = Math.min(minEval, eval_);
      beta = Math.min(beta, eval_);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function chooseMinimax(state: AIState, depth: number): AIAction | null {
  const placedAll = allPlaced(state.placed);
  const turn = state.turn;
  const board = state.board;
  let candidates: (AIPlacement | AIMove)[];
  if (!placedAll) {
    candidates = legalPlacements(board).map((to) => ({ type: 'place' as const, to }));
  } else {
    const fly = isFlying(board, turn, placedAll);
    candidates = legalMoves(board, turn, fly);
  }
  if (candidates.length === 0) return null;

  // coup gagnant immédiat prioritaire
  const immediate = candidates.filter((a) => {
    const pos = a.type === 'place' ? a.to : a.to;
    return millsFormedAt(applyAction(state, a).board, pos, turn).length > 0;
  });
  if (immediate.length > 0 && Math.random() > 0.15) {
    return bestByEvaluation(state, immediate, Math.max(0, depth - 1));
  }
  return bestByEvaluation(state, candidates, depth);
}

/* ------------------------------------------------------------------ */
/* Capture intelligente                                              */
/* ------------------------------------------------------------------ */

function chooseCapture(state: AIState): AICapture | null {
  const targets = legalCaptures(state.board, state.turn);
  if (targets.length === 0) return null;

  // 1. enlever une pièce qui complète un moulin adverse imminents
  const me = state.turn;
  const opp = opponent(me);
  let bestScore = -Infinity;
  let best: number = targets[0];

  for (const t of targets) {
    let score = 0;
    // Supprimer une pièce forte
    score += POS_VALUE[t] * 8;
    // Pénalité si c'est une pièce déjà isolée dans un moulin (on perd l'occasion d'enlever une pièce extérieure)
    if (state.board[t] === opp) {
      // Compter combien de moulins adverses imminents incluent cette position
      for (const m of MILLS) {
        if (!m.includes(t)) continue;
        const vals = m.map((p) => state.board[p]);
        const oppCount = vals.filter((v) => v === opp).length;
        const empty = vals.filter((v) => v === null).length;
        if (oppCount === 2 && empty === 1) score += 60;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return { type: 'capture', target: best };
}

/* ------------------------------------------------------------------ */
/* Point d'entrée public                                              */
/* ------------------------------------------------------------------ */

export function chooseAIAction(state: AIState, mustRemove: boolean, level: AILevel): AIAction | null {
  if (mustRemove) return chooseCapture(state);
  switch (level) {
    case 1:
      return chooseBeginner(state);
    case 2:
      return chooseAmateur(state);
    case 3:
      return chooseIntermediate(state);
    case 4:
      return chooseMinimax(state, 3);
    case 5:
      return chooseMinimax(state, 5);
    default:
      return chooseBeginner(state);
  }
}

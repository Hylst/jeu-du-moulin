export type Player = 'W' | 'B';
export type Cell = Player | null;

export const PIECES_PER_PLAYER = 9;

// Board positions indexed 0-23, laid out on a 7x7 grid (x, y)
export const COORDS: [number, number][] = [
  [0, 0], [3, 0], [6, 0],
  [1, 1], [3, 1], [5, 1],
  [2, 2], [3, 2], [4, 2],
  [0, 3], [1, 3], [2, 3],
  [4, 3], [5, 3], [6, 3],
  [2, 4], [3, 4], [4, 4],
  [1, 5], [3, 5], [5, 5],
  [0, 6], [3, 6], [6, 6],
];

// All 16 possible mills (lines of three)
export const MILLS: [number, number, number][] = [
  // horizontal
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [9, 10, 11], [12, 13, 14],
  [15, 16, 17], [18, 19, 20], [21, 22, 23],
  // vertical
  [0, 9, 21], [3, 10, 18], [6, 11, 15],
  [1, 4, 7], [16, 19, 22],
  [8, 12, 17], [5, 13, 20], [2, 14, 23],
];

// Adjacency map for the movement phase
export const ADJACENT: number[][] = [
  [1, 9],            // 0
  [0, 2, 4],         // 1
  [1, 14],           // 2
  [4, 10],           // 3
  [1, 3, 5, 7],      // 4
  [4, 13],           // 5
  [7, 11],           // 6
  [4, 6, 8],         // 7
  [7, 12],           // 8
  [0, 10, 21],       // 9
  [3, 9, 11, 18],    // 10
  [6, 10, 15],       // 11
  [8, 13, 17],       // 12
  [5, 12, 14, 20],   // 13
  [2, 13, 23],       // 14
  [11, 16],          // 15
  [15, 17, 19],      // 16
  [12, 16],          // 17
  [10, 19],          // 18
  [16, 18, 20, 22],  // 19
  [13, 19],          // 20
  [9, 22],           // 21
  [19, 21, 23],      // 22
  [14, 22],          // 23
];

export const MILLS_BY_POS: number[][] = COORDS.map((_, pos) =>
  MILLS.map((_, i) => i).filter((i) => MILLS[i].includes(pos))
);

export const opponent = (p: Player): Player => (p === 'W' ? 'B' : 'W');

export function countPieces(board: Cell[], player: Player): number {
  return board.reduce((n, c) => (c === player ? n + 1 : n), 0);
}

/** True if the piece at `pos` (belonging to `player`) is part of a completed mill. */
export function isInMill(board: Cell[], pos: number, player: Player): boolean {
  return MILLS_BY_POS[pos].some((mi) =>
    MILLS[mi].every((p) => board[p] === player)
  );
}

/** Mill indexes completed by `player` that include `pos`. */
export function millsFormedAt(board: Cell[], pos: number, player: Player): number[] {
  return MILLS_BY_POS[pos].filter((mi) =>
    MILLS[mi].every((p) => board[p] === player)
  );
}

/**
 * Pieces of `target` that may be captured. Pieces inside a mill are protected,
 * unless ALL of the target's pieces are in mills.
 */
export function removablePieces(board: Cell[], target: Player): number[] {
  const all = board
    .map((c, i) => (c === target ? i : -1))
    .filter((i) => i >= 0);
  const outsideMills = all.filter((i) => !isInMill(board, i, target));
  return outsideMills.length > 0 ? outsideMills : all;
}

export function isFlying(board: Cell[], player: Player, placedAll: boolean): boolean {
  return placedAll && countPieces(board, player) === 3;
}

/** Legal destination squares for the piece at `from`. */
export function destinationsFor(
  board: Cell[],
  from: number,
  flying: boolean
): number[] {
  if (flying) {
    return board.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
  }
  return ADJACENT[from].filter((i) => board[i] === null);
}

/** Does `player` have at least one legal move in the movement phase? */
export function hasAnyMove(board: Cell[], player: Player, flying: boolean): boolean {
  for (let i = 0; i < 24; i++) {
    if (board[i] !== player) continue;
    if (destinationsFor(board, i, flying).length > 0) return true;
  }
  return false;
}

export type GamePhase = 'placing' | 'moving' | 'flying';

export function getPhase(
  board: Cell[],
  player: Player,
  placed: Record<Player, number>
): GamePhase {
  const allPlaced = placed.W >= PIECES_PER_PLAYER && placed.B >= PIECES_PER_PLAYER;
  if (!allPlaced) return 'placing';
  if (isFlying(board, player, allPlaced)) return 'flying';
  return 'moving';
}

/** Check if the game has ended by win condition and return winner + reason. */
export function checkWin(
  board: Cell[],
  placed: Record<Player, number>,
  currentTurn: Player,
  opponentBlocked: boolean = false
): { winner: Player | null; reason: string } {
  const allPlaced = placed.W >= PIECES_PER_PLAYER && placed.B >= PIECES_PER_PLAYER;
  const opp = opponent(currentTurn);

  if (allPlaced) {
    if (countPieces(board, opp) < 3) {
      return { winner: currentTurn, reason: `${opp} est réduit à moins de 3 pièces` };
    }
    if (countPieces(board, currentTurn) < 3) {
      return { winner: opp, reason: `${currentTurn} est réduit à moins de 3 pièces` };
    }
  }

  if (opponentBlocked) {
    return { winner: currentTurn, reason: `${opp} n'a plus de coup légal` };
  }

  return { winner: null, reason: '' };
}

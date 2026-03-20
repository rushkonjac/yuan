/**
 * @fileoverview Movement and simultaneous turn execution for 渊 (Yuan).
 * Event times are in seconds; UI may sync to {@link SIMULATION_TIME} from types.
 */

import { BODY_CONFIG, TERRAIN, SIMULATION_TIME, PIECE_TYPE } from './types.js';
import { isPassable, isInBounds } from './board.js';

/** @param {import('./types.js').PieceShape} piece */
function bodyConfigKey(piece) {
  return piece.type === PIECE_TYPE.BOMB ? 1 : /** @type {1|2|3|4} */ (Math.min(4, Math.max(1, piece.bodySize)));
}

/**
 * @param {import('./types.js').PieceShape} piece
 * @param {number} [extraDist]
 * @returns {number}
 */
export function getMaxDistance(piece, extraDist = 0) {
  return BODY_CONFIG[bodyConfigKey(piece)].maxDist + extraDist;
}

/**
 * @param {import('./types.js').PieceShape} piece
 * @param {number} [extraSpeed]
 * @returns {number}
 */
export function getSpeed(piece, extraSpeed = 0) {
  return BODY_CONFIG[bodyConfigKey(piece)].speed + extraSpeed;
}

/**
 * @param {import('./types.js').PieceShape[]} allPieces
 * @param {number} col
 * @param {number} row
 * @param {import('./types.js').PieceShape} self
 * @returns {import('./types.js').PieceShape|null}
 */
function findFriendlyAt(allPieces, col, row, self) {
  const other = findPieceAt(allPieces, col, row, self);
  if (other && other.owner === self.owner) return other;
  return null;
}

/**
 * @param {import('./types.js').PieceShape} piece
 * @param {{ dx: number, dy: number }} direction
 * @param {number} distance
 * @param {import('./board.js').Cell[][]} board
 * @param {import('./types.js').PieceShape[]} allPieces
 * @returns {{
 *   steps: { col: number, row: number }[],
 *   hitCurrent: boolean,
 *   riftTeleport: { col: number, row: number } | null,
 *   stoppedByFriendly: boolean,
 *   firstCurrentStep: number | null,
 * }}
 */
export function computePath(piece, direction, distance, board, allPieces) {
  const primary = piece.tiles[0];
  if (!primary) {
    return {
      steps: [],
      hitCurrent: false,
      riftTeleport: null,
      stoppedByFriendly: false,
      firstCurrentStep: null,
    };
  }

  const { dx, dy } = direction;
  /** @type {{ col: number, row: number }[]} */
  const steps = [];
  let hitCurrent = false;
  /** @type {number | null} */
  let firstCurrentStep = null;
  let stoppedByFriendly = false;
  /** @type {{ col: number, row: number } | null} */
  let riftTeleport = null;

  for (let step = 1; step <= distance; step += 1) {
    const col = primary.col + step * dx;
    const row = primary.row + step * dy;

    if (!isInBounds(col, row) || !isPassable(board, col, row)) {
      break;
    }

    if (findFriendlyAt(allPieces, col, row, piece)) {
      stoppedByFriendly = true;
      break;
    }

    const cell = board[col][row];
    if (cell.terrain === TERRAIN.CURRENT) {
      hitCurrent = true;
      if (firstCurrentStep === null) firstCurrentStep = step;
    }

    steps.push({ col, row });

    if (piece.bodySize === 1 && cell.terrain === TERRAIN.RIFT && cell.riftPair) {
      riftTeleport = { col: cell.riftPair.col, row: cell.riftPair.row };
      break;
    }
  }

  return { steps, hitCurrent, riftTeleport, stoppedByFriendly, firstCurrentStep };
}

/**
 * @param {number} segmentIndex 1-based index of segment (enters steps[segmentIndex - 1])
 * @param {number} baseSpeed
 * @param {number | null} firstCurrentStep 1-based step index where CURRENT was first entered; segments after use boost
 */
function segmentSpeed(segmentIndex, baseSpeed, firstCurrentStep) {
  if (firstCurrentStep == null) return baseSpeed;
  return segmentIndex > firstCurrentStep ? baseSpeed + 0.5 : baseSpeed;
}

/**
 * @param {import('./types.js').PieceShape} piece
 * @param {{
 *   steps: { col: number, row: number }[],
 *   hitCurrent: boolean,
 *   riftTeleport: { col: number, row: number } | null,
 *   firstCurrentStep: number | null,
 * }} path
 * @param {{ dx: number, dy: number }} _direction
 * @param {number} [extraSpeed]
 * @returns {{ time: number, piece: import('./types.js').PieceShape, col: number, row: number, type: 'arrive'|'rift_teleport' }[]}
 */
function eventsForOneMove(piece, path, _direction, extraSpeed = 0) {
  const baseSpeed = getSpeed(piece, extraSpeed);
  const firstCurrentStep = path.hitCurrent ? path.firstCurrentStep : null;
  /** @type {{ time: number, piece: import('./types.js').PieceShape, col: number, row: number, type: 'arrive'|'rift_teleport' }[]} */
  const out = [];
  let time = 0;

  for (let i = 0; i < path.steps.length; i += 1) {
    const seg = i + 1;
    const spd = segmentSpeed(seg, baseSpeed, firstCurrentStep);
    time += 1 / spd;
    const { col, row } = path.steps[i];
    out.push({ time, piece, col, row, type: 'arrive' });
  }

  if (path.riftTeleport) {
    const pair = path.riftTeleport;
    out.push({ time, piece, col: pair.col, row: pair.row, type: 'rift_teleport' });
  }

  return out;
}

/**
 * @param {import('./types.js').PieceShape|null} moveA
 * @param {import('./types.js').PieceShape|null} moveB
 * @returns {{ time: number, piece: import('./types.js').PieceShape, col: number, row: number, type: 'arrive'|'rift_teleport' }[]}
 */
export function generateMoveEvents(moveA, moveB) {
  /** @type {{ time: number, piece: import('./types.js').PieceShape, col: number, row: number, type: 'arrive'|'rift_teleport' }[]} */
  const events = [];

  if (moveA) {
    events.push(
      ...eventsForOneMove(moveA.piece, moveA.path, moveA.direction, moveA.extraSpeed ?? 0),
    );
  }
  if (moveB) {
    events.push(
      ...eventsForOneMove(moveB.piece, moveB.path, moveB.direction, moveB.extraSpeed ?? 0),
    );
  }

  const typeOrder = { arrive: 0, rift_teleport: 1 };
  events.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    const idCmp = String(a.piece.id).localeCompare(String(b.piece.id));
    if (idCmp !== 0) return idCmp;
    return typeOrder[a.type] - typeOrder[b.type];
  });

  return events;
}

/**
 * @param {import('./types.js').PieceShape[]} allPieces
 * @param {number} col
 * @param {number} row
 * @param {import('./types.js').PieceShape|null} [excludePiece]
 * @returns {import('./types.js').PieceShape|null}
 */
export function findPieceAt(allPieces, col, row, excludePiece = null) {
  for (const p of allPieces) {
    if (!p.alive) continue;
    if (excludePiece && p === excludePiece) continue;
    for (const t of p.tiles) {
      if (t.col === col && t.row === row) return p;
    }
  }
  return null;
}

/**
 * @param {import('./types.js').PieceShape} piece
 * @param {number} col
 * @param {number} row
 */
export function movePieceTo(piece, col, row) {
  if (!piece.tiles[0]) piece.tiles[0] = { col, row };
  else {
    piece.tiles[0].col = col;
    piece.tiles[0].row = row;
  }
}

/**
 * Simulated position map: piece id -> primary tile.
 * @param {import('./types.js').PieceShape[]} allPieces
 * @returns {Map<string, { col: number, row: number }>}
 */
function initialSimPositions(allPieces) {
  const m = new Map();
  for (const p of allPieces) {
    if (!p.alive) continue;
    const t = p.tiles[0];
    if (t) m.set(p.id, { col: t.col, row: t.row });
  }
  return m;
}

/**
 * @param {import('./types.js').PieceShape|null} moveA
 * @param {import('./types.js').PieceShape|null} moveB
 * @param {import('./board.js').Cell[][]} board
 * @param {import('./types.js').PieceShape[]} allPieces
 * @returns {{
 *   collisions: { col: number, row: number, pieceA: import('./types.js').PieceShape, pieceB: import('./types.js').PieceShape, time: number }[],
 *   finalPositions: { piece: import('./types.js').PieceShape, col: number, row: number }[],
 *   events: ReturnType<typeof generateMoveEvents>,
 * }}
 */
export function executeTurn(moveA, moveB, _board, allPieces) {
  const events = generateMoveEvents(moveA, moveB);
  const sim = initialSimPositions(allPieces);
  /** @type {Set<string>} */
  const stopped = new Set();
  /** @type {{ col: number, row: number, pieceA: import('./types.js').PieceShape, pieceB: import('./types.js').PieceShape, time: number }[]} */
  const collisions = [];

  for (const ev of events) {
    if (stopped.has(ev.piece.id)) continue;

    let targetCol = ev.col;
    let targetRow = ev.row;

    const enemy = (() => {
      for (const p of allPieces) {
        if (!p.alive) continue;
        if (p === ev.piece || p.owner === ev.piece.owner) continue;
        const pos = sim.get(p.id);
        if (pos && pos.col === targetCol && pos.row === targetRow) return p;
      }
      return null;
    })();

    if (enemy) {
      collisions.push({
        col: targetCol,
        row: targetRow,
        pieceA: ev.piece,
        pieceB: enemy,
        time: ev.time,
      });
      stopped.add(ev.piece.id);
      stopped.add(enemy.id);
      continue;
    }

    sim.set(ev.piece.id, { col: targetCol, row: targetRow });
  }

  /** @type {{ piece: import('./types.js').PieceShape, col: number, row: number }[]} */
  const finalPositions = [];
  for (const p of allPieces) {
    if (!p.alive) continue;
    const pos = sim.get(p.id);
    if (pos) finalPositions.push({ piece: p, col: pos.col, row: pos.row });
  }

  return { collisions, finalPositions, events };
}

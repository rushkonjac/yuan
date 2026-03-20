/**
 * @fileoverview Shared constants and factory helpers for 渊 (Yuan / Abyss).
 */

/** @type {number} */
export const BOARD_COLS = 7;
/** @type {number} */
export const BOARD_ROWS = 9;
/** @type {number} */
export const CELL_SIZE = 64;
/** @type {number} */
export const MAX_TURNS = 15;
/** @type {readonly number[]} */
export const DESTINY_TURNS = Object.freeze([4, 8, 12]);
/** @type {number} */
export const SIMULATION_TIME = 2.0;

/**
 * Body size → movement / visibility configuration.
 * @typedef {{ tiles: number, speed: number, maxDist: number, glow: 'none'|'dim'|'bright'|'intense' }} BodyConfigEntry
 * @type {Readonly<Record<1|2|3|4, BodyConfigEntry>>}
 */
export const BODY_CONFIG = Object.freeze({
  1: { tiles: 1, speed: 2.0, maxDist: 4, glow: 'none' },
  2: { tiles: 2, speed: 1.5, maxDist: 3, glow: 'dim' },
  3: { tiles: 3, speed: 1.0, maxDist: 2, glow: 'bright' },
  4: { tiles: 4, speed: 0.5, maxDist: 1, glow: 'intense' },
});

/**
 * Terrain cell values.
 * @readonly
 * @enum {number}
 */
export const TERRAIN = Object.freeze({
  NONE: 0,
  REEF: 1,
  CURRENT: 2,
  RIFT: 3,
});

/**
 * ASCII symbols for terrain (keyed by TERRAIN value).
 * @type {Readonly<Record<number, string>>}
 */
export const TERRAIN_SYMBOLS = Object.freeze({
  0: '.',
  1: '#',
  2: '~',
  3: '@',
});

/**
 * @readonly
 * @enum {string}
 */
export const PIECE_TYPE = Object.freeze({
  COMBAT: 'combat',
  HEART: 'heart',
  BOMB: 'bomb',
});

/**
 * High-level game flow phases.
 * @readonly
 * @enum {string}
 */
export const PHASE = Object.freeze({
  CARD_SELECT: 'card_select',
  DEPLOY: 'deploy',
  DESTINY: 'destiny',
  COMMAND: 'command',
  EXECUTE: 'execute',
  GAME_OVER: 'game_over',
});

/**
 * @typedef {{ dx: number, dy: number }} Dir
 */

/** @type {Readonly<Dir>} */
export const DIR = Object.freeze({
  UP: { dx: 0, dy: 1 },
  DOWN: { dx: 0, dy: -1 },
  LEFT: { dx: -1, dy: 0 },
  RIGHT: { dx: 1, dy: 0 },
});

/** @type {readonly Dir[]} */
export const DIRECTIONS = Object.freeze([DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT]);

/**
 * @typedef {{ id: string, name: string, type: 'instant'|'trigger', desc: string }} CardDef
 */

/** @type {readonly CardDef[]} */
export const CARD_POOL = Object.freeze([
  { id: 'scout', name: '侦查', type: 'instant', desc: 'Check if enemy piece is Heart' },
  { id: 'reef', name: '造礁', type: 'instant', desc: 'Place reef on empty tile' },
  { id: 'swap', name: '暗流', type: 'instant', desc: 'Swap two friendly pieces' },
  { id: 'shield', name: '渊甲', type: 'trigger', desc: 'Cancel collision if losing' },
  { id: 'blade', name: '渊刃', type: 'trigger', desc: 'No rank loss on win' },
  { id: 'blast', name: '渊爆', type: 'trigger', desc: 'Mutual destruction on collision' },
]);

/**
 * @typedef {{ id: string, name: string, type: 'instant'|'persistent', desc: string }} DestinyDef
 */

/** @type {readonly DestinyDef[]} */
export const DESTINY_POOL = Object.freeze([
  { id: 'reveal_all', name: '荧光爆发', type: 'instant', desc: 'Reveal all enemy ranks this turn' },
  { id: 'surge', name: '涌潮', type: 'instant', desc: '+2 max distance this turn' },
  { id: 'card_restore', name: '渊力回溯', type: 'instant', desc: 'Restore one used card' },
  { id: 'reef_storm', name: '裂隙风暴', type: 'instant', desc: 'Spawn 3 random reefs' },
  { id: 'reef_remove', name: '暗礁操控', type: 'instant', desc: 'Remove 2 reefs' },
  { id: 'deep_instinct', name: '深海本能', type: 'persistent', desc: 'Reveal 1 random enemy rank each turn' },
  { id: 'dark_surge', name: '暗涌', type: 'persistent', desc: '+0.5 speed for all pieces' },
  { id: 'fog', name: '渊雾', type: 'persistent', desc: 'Reduce glow by 1 level' },
  { id: 'resonance', name: '渊之共鸣', type: 'persistent', desc: 'Reveal killer rank when piece dies' },
  { id: 'shell', name: '坚壳', type: 'persistent', desc: '+1 extra body on collision win' },
]);

let _nextPieceId = 1;

/**
 * @returns {string} Monotonic string id for pieces.
 */
function generateId() {
  return String(_nextPieceId++);
}

/**
 * @typedef {0|1|string} PlayerId
 */

/**
 * @typedef {{ col: number, row: number }} TileRef
 */

/**
 * @typedef {{
 *   id: string,
 *   owner: PlayerId,
 *   type: string,
 *   rank: number,
 *   currentRank: number,
 *   bodySize: number,
 *   tiles: TileRef[],
 *   alive: boolean,
 *   triggerCard: CardDef|null,
 *   revealed: boolean
 * }} PieceShape
 */

/**
 * Create a new piece instance. `tiles` is empty until deployment places the piece on the board.
 *
 * @param {PlayerId} owner
 * @param {string} type One of {@link PIECE_TYPE} values.
 * @param {number} rank Initial (and max) rank for this piece.
 * @returns {PieceShape}
 */
export function createPiece(owner, type, rank) {
  return {
    id: generateId(),
    owner,
    type,
    rank,
    currentRank: rank,
    bodySize: 1,
    tiles: [],
    alive: true,
    triggerCard: null,
    revealed: false,
  };
}

/**
 * Default 8-piece pool: six combat (ranks 1–6), one heart (rank 10), one bomb (rank 0).
 *
 * @param {PlayerId} owner
 * @returns {PieceShape[]}
 */
export function createDefaultPiecePool(owner) {
  /** @type {PieceShape[]} */
  const pool = [];
  for (let r = 1; r <= 6; r += 1) {
    pool.push(createPiece(owner, PIECE_TYPE.COMBAT, r));
  }
  pool.push(createPiece(owner, PIECE_TYPE.HEART, 10));
  pool.push(createPiece(owner, PIECE_TYPE.BOMB, 0));
  return pool;
}

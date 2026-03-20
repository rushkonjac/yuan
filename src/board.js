/**
 * @fileoverview 7×9 grid board for 渊 (Yuan): terrain, rift pairs, deploy zones.
 */

import {
  BOARD_COLS,
  BOARD_ROWS,
  TERRAIN,
  TERRAIN_SYMBOLS,
} from './types.js';

/**
 * Hand-designed map. Index 0 = row 8 (top), index 8 = row 0 (bottom).
 * `.` plain, `#` reef, `~` current, `@` rift.
 */
const DEFAULT_MAP_TEMPLATE = `
.......    row 8  P2 deploy back
.......    row 7  P2 deploy front
.#.~.#.    row 6  P2 territory
..#.#..    row 5  P2 territory
@.....@    row 4  center rifts
..#.#..    row 3  P1 territory
.#.~.#.    row 2  P1 territory
.......    row 1  P1 deploy front
.......    row 0  P1 deploy back
`
  .trim()
  .split('\n')
  .map((line) => line.replace(/\s+#.*$/, '').trim());

/** @type {Readonly<Record<string, number>>} */
const CHAR_TO_TERRAIN = Object.freeze({
  '.': TERRAIN.NONE,
  '#': TERRAIN.REEF,
  '~': TERRAIN.CURRENT,
  '@': TERRAIN.RIFT,
});

/**
 * @typedef {{ terrain: number, riftPair: { col: number, row: number } | null }} Cell
 */

/**
 * @returns {Cell[][]} board[col][row]
 */
export function createBoard() {
  /** @type {Cell[][]} */
  const board = [];
  for (let col = 0; col < BOARD_COLS; col += 1) {
    board[col] = [];
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      board[col][row] = { terrain: TERRAIN.NONE, riftPair: null };
    }
  }
  return board;
}

/**
 * Fills `board` with the default terrain layout and links rifts at (0,4) ↔ (6,4).
 *
 * @param {Cell[][]} board
 */
export function loadDefaultMap(board) {
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    const line = DEFAULT_MAP_TEMPLATE[BOARD_ROWS - 1 - row];
    for (let col = 0; col < BOARD_COLS; col += 1) {
      const ch = line[col];
      const terrain = CHAR_TO_TERRAIN[ch] ?? TERRAIN.NONE;
      board[col][row].terrain = terrain;
      board[col][row].riftPair = null;
    }
  }
  board[0][4].riftPair = { col: 6, row: 4 };
  board[6][4].riftPair = { col: 0, row: 4 };
}

/**
 * @param {Cell[][]} board
 * @param {number} col
 * @param {number} row
 * @returns {boolean}
 */
export function isPassable(board, col, row) {
  if (!isInBounds(col, row)) return false;
  return board[col][row].terrain !== TERRAIN.REEF;
}

/**
 * @param {number} col
 * @param {number} row
 * @returns {boolean}
 */
export function isInBounds(col, row) {
  return col >= 0 && col < BOARD_COLS && row >= 0 && row < BOARD_ROWS;
}

/**
 * @param {1|2} player
 * @returns {{ col: number, row: number }[]}
 */
export function getDeployZone(player) {
  /** @type {{ col: number, row: number }[]} */
  const tiles = [];
  if (player === 1) {
    for (let row = 0; row <= 1; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        tiles.push({ col, row });
      }
    }
  } else if (player === 2) {
    for (let row = 7; row <= 8; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        tiles.push({ col, row });
      }
    }
  }
  return tiles;
}

/**
 * Row 8 at top, row 0 at bottom; symbols from {@link TERRAIN_SYMBOLS}.
 *
 * @param {Cell[][]} board
 * @returns {string}
 */
export function boardToString(board) {
  const lines = [];
  for (let row = BOARD_ROWS - 1; row >= 0; row -= 1) {
    const parts = [];
    for (let col = 0; col < BOARD_COLS; col += 1) {
      parts.push(TERRAIN_SYMBOLS[board[col][row].terrain]);
    }
    lines.push(parts.join(' '));
  }
  return lines.join('\n');
}

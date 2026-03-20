/**
 * @fileoverview Input controller for 渊 — maps canvas clicks and keys to game actions.
 */

import { BOARD_COLS, BOARD_ROWS, CELL_SIZE, DIR } from './types.js';

const BOARD_H = BOARD_ROWS * CELL_SIZE;

/**
 * @typedef {{
 *   onCellClick: ((col: number, row: number) => void) | null,
 *   onPieceSelect: ((pieceId: string) => void) | null,
 *   onDirectionSet: ((dir: {dx:number,dy:number}) => void) | null,
 *   onDistanceSet: ((dist: number) => void) | null,
 *   onConfirm: (() => void) | null,
 *   onSkip: (() => void) | null,
 *   onCardSelect: ((cardId: string) => void) | null,
 *   onDestinySelect: ((destinyId: string) => void) | null,
 * }} InputCallbacks
 */

export class InputController {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ pixelToCell: (x: number, y: number) => {col:number,row:number} }} renderer
   */
  constructor(canvas, renderer) {
    this.canvas = canvas;
    this.renderer = renderer;
    /** @type {InputCallbacks} */
    this.callbacks = {
      onCellClick: null,
      onPieceSelect: null,
      onDirectionSet: null,
      onDistanceSet: null,
      onConfirm: null,
      onSkip: null,
      onCardSelect: null,
      onDestinySelect: null,
    };

    this._boundClick = this._onClick.bind(this);
    this._boundKey = this._onKey.bind(this);
    canvas.addEventListener('click', this._boundClick);
    window.addEventListener('keydown', this._boundKey);
  }

  destroy() {
    this.canvas.removeEventListener('click', this._boundClick);
    window.removeEventListener('keydown', this._boundKey);
  }

  /** @param {MouseEvent} e */
  _onClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / rect.width;
    const sy = this.canvas.height / rect.height;
    const px = (e.clientX - rect.left) * sx;
    const py = (e.clientY - rect.top) * sy;

    if (py < BOARD_H) {
      const { col, row } = this.renderer.pixelToCell(px, py);
      if (col >= 0 && col < BOARD_COLS && row >= 0 && row < BOARD_ROWS) {
        this.callbacks.onCellClick?.(col, row);
      }
    }
  }

  /** @param {KeyboardEvent} e */
  _onKey(e) {
    switch (e.key) {
      case 'ArrowUp':
      case 'w':
        e.preventDefault();
        this.callbacks.onDirectionSet?.(DIR.UP);
        break;
      case 'ArrowDown':
      case 's':
        e.preventDefault();
        this.callbacks.onDirectionSet?.(DIR.DOWN);
        break;
      case 'ArrowLeft':
      case 'a':
        e.preventDefault();
        this.callbacks.onDirectionSet?.(DIR.LEFT);
        break;
      case 'ArrowRight':
      case 'd':
        e.preventDefault();
        this.callbacks.onDirectionSet?.(DIR.RIGHT);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.callbacks.onConfirm?.();
        break;
      case 'Escape':
        e.preventDefault();
        this.callbacks.onSkip?.();
        break;
      case '1': case '2': case '3': case '4':
        this.callbacks.onDistanceSet?.(Number(e.key));
        break;
      default:
        break;
    }
  }
}

/**
 * @fileoverview Canvas renderer for 渊 (Yuan) — dark ASCII / terminal aesthetic.
 */

import {
  BOARD_COLS,
  BOARD_ROWS,
  CELL_SIZE,
  TERRAIN,
  TERRAIN_SYMBOLS,
  PIECE_TYPE,
  BODY_CONFIG,
} from './types.js';

/** @type {number} */
const UI_HEIGHT = 160;

/** Theme */
const COLORS = {
  bg: '#0a0e1a',
  grid: '#1a2040',
  text: '#88aacc',
  player1: '#00ccff',
  player2: '#ff6644',
  enemyHidden: '#444466',
  heart: '#ffcc00',
  bomb: '#ff3333',
  reefBg: '#1a1a22',
  reefSymbol: '#556677',
  currentTint: '#0a2830',
  currentSymbol: '#2a8a9a',
  riftTint: '#1a1028',
  riftSymbol: '#9966cc',
};

const BOARD_W = BOARD_COLS * CELL_SIZE;
const BOARD_H = BOARD_ROWS * CELL_SIZE;

/** @param {1|2|import('./types.js').PlayerId} owner */
function playerPieceColor(owner) {
  return owner === 1 || owner === '1' ? COLORS.player1 : COLORS.player2;
}

/**
 * Enemy glow ring from body size (invisible body = no glow).
 * @param {number} bodySize
 * @returns {{ blur: number, alpha: number, lineWidth: number }}
 */
function enemyGlowParams(bodySize) {
  const key = /** @type {1|2|3|4} */ (Math.min(4, Math.max(1, bodySize | 0)));
  const g = BODY_CONFIG[key].glow;
  switch (g) {
    case 'dim':
      return { blur: 6, alpha: 0.35, lineWidth: 2 };
    case 'bright':
      return { blur: 14, alpha: 0.55, lineWidth: 3 };
    case 'intense':
      return { blur: 22, alpha: 0.75, lineWidth: 4 };
    default:
      return { blur: 0, alpha: 0, lineWidth: 0 };
  }
}

/** @param {import('./types.js').PieceShape} piece */
function pieceTilesOrFallback(piece) {
  if (piece.tiles && piece.tiles.length > 0) return piece.tiles;
  return [];
}

/**
 * Bounding box of piece in canvas pixels (top-left, width, height).
 * @param {import('./types.js').PieceShape} piece
 */
function piecePixelBounds(piece) {
  const tiles = pieceTilesOrFallback(piece);
  if (tiles.length === 0) {
    return { x: 0, y: 0, w: CELL_SIZE, h: CELL_SIZE, cx: CELL_SIZE / 2, cy: CELL_SIZE / 2 };
  }
  let minC = Infinity;
  let maxC = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  for (const t of tiles) {
    minC = Math.min(minC, t.col);
    maxC = Math.max(maxC, t.col);
    minR = Math.min(minR, t.row);
    maxR = Math.max(maxR, t.row);
  }
  const topLeft = cellToPixelStatic(minC, maxR);
  const botRight = cellToPixelStatic(maxC, minR);
  const w = (maxC - minC + 1) * CELL_SIZE;
  const h = (maxR - minR + 1) * CELL_SIZE;
  return {
    x: topLeft.x,
    y: topLeft.y,
    w,
    h,
    cx: topLeft.x + w / 2,
    cy: topLeft.y + h / 2,
  };
}

/**
 * @param {number} col
 * @param {number} row
 */
function cellToPixelStatic(col, row) {
  return {
    x: col * CELL_SIZE,
    y: (BOARD_ROWS - 1 - row) * CELL_SIZE,
  };
}

/** Matches PHASE enum string values in types.js for display. */
const PHASE_LABELS = {
  card_select: '选牌',
  deploy: '部署',
  destiny: '命运',
  command: '指令',
  execute: '执行',
  game_over: '结束',
};

/** @param {string} phase */
function phaseLabel(phase) {
  return PHASE_LABELS[phase] ?? phase;
}

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    /** @type {HTMLCanvasElement} */
    this.canvas = canvas;
    /** @type {CanvasRenderingContext2D} */
    this.ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    canvas.width = BOARD_W;
    canvas.height = BOARD_H + UI_HEIGHT;
    this._monoFamily = '"JetBrains Mono", "Fira Code", "Consolas", "Courier New", monospace';
    this._mono = `14px ${this._monoFamily}`;
    this._monoSmall = `11px ${this._monoFamily}`;
  }

  clear() {
    const { ctx, canvas } = this;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * @param {import('./board.js').Cell[][]} board
   */
  drawBoard(board) {
    const { ctx } = this;

    for (let col = 0; col < BOARD_COLS; col += 1) {
      for (let row = 0; row < BOARD_ROWS; row += 1) {
        const cell = board[col][row];
        const { x, y } = this.cellToPixel(col, row);
        const t = cell.terrain;

        if (t === TERRAIN.REEF) {
          ctx.fillStyle = COLORS.reefBg;
          ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
          this._drawTerrainSymbol(x, y, TERRAIN_SYMBOLS[TERRAIN.REEF], COLORS.reefSymbol);
        } else if (t === TERRAIN.CURRENT) {
          ctx.fillStyle = COLORS.currentTint;
          ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
          this._drawTerrainSymbol(x, y, TERRAIN_SYMBOLS[TERRAIN.CURRENT], COLORS.currentSymbol, true);
        } else if (t === TERRAIN.RIFT) {
          ctx.fillStyle = COLORS.riftTint;
          ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
          this._drawTerrainSymbol(x, y, TERRAIN_SYMBOLS[TERRAIN.RIFT], COLORS.riftSymbol, true);
        } else {
          ctx.fillStyle = COLORS.bg;
          ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
        }
      }
    }

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let c = 0; c <= BOARD_COLS; c += 1) {
      ctx.beginPath();
      ctx.moveTo(c * CELL_SIZE, 0);
      ctx.lineTo(c * CELL_SIZE, BOARD_H);
      ctx.stroke();
    }
    for (let r = 0; r <= BOARD_ROWS; r += 1) {
      ctx.beginPath();
      ctx.moveTo(0, r * CELL_SIZE);
      ctx.lineTo(BOARD_W, r * CELL_SIZE);
      ctx.stroke();
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {string} ch
   * @param {string} color
   * @param {boolean} [glow]
   */
  _drawTerrainSymbol(x, y, ch, color, glow = false) {
    const { ctx } = this;
    ctx.save();
    ctx.font = `bold ${Math.floor(CELL_SIZE * 0.45)}px ${this._monoFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
    }
    ctx.fillText(ch, x + CELL_SIZE / 2, y + CELL_SIZE / 2);
    ctx.restore();
  }

  /**
   * @param {import('./types.js').PieceShape[]} pieces
   * @param {import('./types.js').PlayerId} currentPlayer
   */
  drawPieces(pieces, currentPlayer) {
    const alive = pieces.filter((p) => p.alive);
    for (const piece of alive) {
      this._drawOnePiece(piece, currentPlayer);
    }
  }

  /**
   * @param {import('./types.js').PieceShape} piece
   * @param {import('./types.js').PlayerId} currentPlayer
   */
  _drawOnePiece(piece, currentPlayer) {
    const { ctx } = this;
    if (!piece.tiles || piece.tiles.length === 0) return;
    const isMine = piece.owner === currentPlayer;
    const showRank = isMine || piece.revealed;
    const r = CELL_SIZE * 0.38;

    let fill = COLORS.enemyHidden;
    let stroke = '#556688';
    let label = '?';

    if (isMine) {
      if (piece.type === PIECE_TYPE.HEART) { fill = COLORS.heart; stroke = '#cc9900'; label = `♥${piece.currentRank}`; }
      else if (piece.type === PIECE_TYPE.BOMB) { fill = COLORS.bomb; stroke = '#aa2222'; label = '💣'; }
      else { fill = playerPieceColor(piece.owner); stroke = '#006688'; label = String(piece.currentRank); }
    } else if (showRank) {
      if (piece.type === PIECE_TYPE.HEART) { fill = COLORS.heart; stroke = '#cc9900'; label = `♥${piece.currentRank}`; }
      else if (piece.type === PIECE_TYPE.BOMB) { fill = COLORS.bomb; stroke = '#aa2222'; label = '💣'; }
      else { fill = playerPieceColor(piece.owner); stroke = piece.owner === 1 || piece.owner === '1' ? '#006688' : '#884422'; label = String(piece.currentRank); }
    }

    ctx.save();

    if (!isMine) {
      const glow = enemyGlowParams(piece.bodySize);
      if (glow.blur > 0) {
        for (const t of piece.tiles) {
          const { x, y } = this.cellToPixel(t.col, t.row);
          ctx.strokeStyle = `rgba(136, 170, 204, ${glow.alpha})`;
          ctx.lineWidth = glow.lineWidth;
          ctx.shadowColor = '#88aacc';
          ctx.shadowBlur = glow.blur;
          ctx.beginPath();
          ctx.arc(x + CELL_SIZE / 2, y + CELL_SIZE / 2, r + 2, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }
    }

    for (let i = 0; i < piece.tiles.length; i++) {
      const t = piece.tiles[i];
      const { x, y } = this.cellToPixel(t.col, t.row);
      const cx = x + CELL_SIZE / 2;
      const cy = y + CELL_SIZE / 2;

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.globalAlpha = i === 0 ? 0.92 : 0.7;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();

      if (i > 0) {
        const prev = piece.tiles[i - 1];
        const pp = this.cellToPixel(prev.col, prev.row);
        ctx.strokeStyle = fill;
        ctx.lineWidth = r * 0.8;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(pp.x + CELL_SIZE / 2, pp.y + CELL_SIZE / 2);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    const head = piece.tiles[0];
    const hp = this.cellToPixel(head.col, head.row);
    const hcx = hp.x + CELL_SIZE / 2;
    const hcy = hp.y + CELL_SIZE / 2;

    ctx.font = piece.type === PIECE_TYPE.BOMB && (isMine || showRank)
      ? `${Math.floor(r * 1.1)}px serif`
      : `bold ${Math.floor(r * 0.95)}px ${this._monoFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = showRank && piece.type !== PIECE_TYPE.BOMB ? '#0a0e1a' : '#f0f0f0';
    if (showRank) { ctx.shadowColor = fill; ctx.shadowBlur = 4; }
    ctx.fillText(label, hcx, hcy);
    ctx.shadowBlur = 0;

    if (piece.triggerCard) {
      const id = typeof piece.triggerCard === 'string' ? piece.triggerCard : piece.triggerCard.id;
      this._drawTriggerCardIcon(hp.x + CELL_SIZE - 4, hp.y + 4, id);
    }

    ctx.restore();
  }

  /**
   * @param {number} cornerX
   * @param {number} cornerY
   * @param {string} [id]
   */
  _drawTriggerCardIcon(cornerX, cornerY, id) {
    const { ctx } = this;
    const w = 18;
    const h = 22;
    const x = cornerX - w;
    const y = cornerY;
    ctx.save();
    ctx.fillStyle = 'rgba(20, 30, 50, 0.9)';
    ctx.strokeStyle = '#88aacc';
    ctx.lineWidth = 1;
    ctx.shadowColor = '#00ccff';
    ctx.shadowBlur = 4;
    const r = 3;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = COLORS.text;
    ctx.font = this._monoSmall;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ch = id ? id.charAt(0).toUpperCase() : '★';
    ctx.fillText(ch, x + w / 2, y + h / 2);
    ctx.restore();
  }

  /**
   * @param {object} gameState
   * @param {number} [gameState.turn]
   * @param {number} [gameState.maxTurns]
   * @param {string} [gameState.phase]
   * @param {import('./types.js').PlayerId} [gameState.currentPlayer]
   * @param {string[]} [gameState.cardsRemaining]
   * @param {string[]} [gameState.cardsUsed]
   * @param {{ id: string, name?: string }[]|string[]} [gameState.destinyEffects]
   * @param {string} [gameState.instructions]
   */
  drawUI(gameState) {
    const { ctx, canvas } = this;
    const gs = gameState || {};
    const turn = gs.turn ?? 1;
    const maxTurns = gs.maxTurns ?? 15;
    const phase = gs.phase ?? 'command';
    const curP = gs.currentPlayer ?? 1;
    const remaining = gs.cardsRemaining ?? [];
    const used = gs.cardsUsed ?? [];
    const destiny = gs.destinyEffects ?? [];
    const instructions = gs.instructions ?? '';

    const y0 = BOARD_H + 8;
    ctx.save();
    ctx.fillStyle = 'rgba(10, 14, 26, 0.95)';
    ctx.fillRect(0, BOARD_H, canvas.width, UI_HEIGHT);
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(0, BOARD_H);
    ctx.lineTo(canvas.width, BOARD_H);
    ctx.stroke();

    ctx.fillStyle = COLORS.text;
    ctx.font = this._mono;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.shadowColor = COLORS.player1;
    ctx.shadowBlur = 3;
    ctx.fillText(`回合 ${turn}/${maxTurns}`, 12, y0);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#aabbdd';
    ctx.fillText(`阶段: ${phaseLabel(phase)}`, 12, y0 + 22);
    ctx.fillStyle = playerPieceColor(curP);
    ctx.shadowColor = playerPieceColor(curP);
    ctx.shadowBlur = 4;
    ctx.fillText(`当前玩家: P${curP}`, 200, y0);
    ctx.shadowBlur = 0;

    const remStr = remaining.length === 0 ? '—' : remaining.join('、');
    const usedStr = used.length === 0 ? '—' : used.join('、');
    ctx.fillStyle = COLORS.text;
    ctx.font = this._monoSmall;
    ctx.fillText(`手牌: ${remStr}`, 12, y0 + 48);
    ctx.fillText(`已用: ${usedStr}`, 12, y0 + 64);

    const destStr =
      destiny.length === 0
        ? '—'
        : destiny
            .map((d) => (typeof d === 'string' ? d : d.name ?? d.id))
            .join('、');
    ctx.fillStyle = '#99bbdd';
    ctx.fillText(`命运: ${destStr}`, 12, y0 + 82);

    ctx.fillStyle = '#778899';
    const inst = instructions || defaultInstruction(phase);
    this._wrapText(inst, 12, y0 + 100, canvas.width - 24, 14);

    ctx.restore();
  }

  /**
   * @param {string} text
   * @param {number} x
   * @param {number} y
   * @param {number} maxW
   * @param {number} lineH
   */
  _wrapText(text, x, y, maxW, lineH) {
    const { ctx } = this;
    const words = text.split('');
    let line = '';
    let yy = y;
    for (let i = 0; i < words.length; i += 1) {
      const test = line + words[i];
      if (ctx.measureText(test).width > maxW && line.length > 0) {
        ctx.fillText(line, x, yy);
        line = words[i];
        yy += lineH;
        if (yy > this.canvas.height - 4) break;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, yy);
  }

  /**
   * @param {1|2} player
   */
  drawDeployZone(player) {
    const { ctx } = this;
    const tiles = deployZoneTiles(player);
    ctx.save();
    ctx.fillStyle =
      player === 1 ? 'rgba(0, 204, 255, 0.12)' : 'rgba(255, 102, 68, 0.12)';
    ctx.strokeStyle = player === 1 ? 'rgba(0, 204, 255, 0.45)' : 'rgba(255, 102, 68, 0.45)';
    ctx.lineWidth = 2;
    for (const { col, row } of tiles) {
      const { x, y } = this.cellToPixel(col, row);
      ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      ctx.strokeRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
    }
    ctx.restore();
  }

  /**
   * @param {import('./types.js').PieceShape} piece
   * @param {{ col: number, row: number }[]} path
   */
  drawMovePreview(piece, path) {
    if (!path || path.length === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0, 204, 255, 0.75)';
    ctx.shadowColor = '#00ccff';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let i = 0; i < path.length; i += 1) {
      const p = path[i];
      const { x, y } = this.cellToPixel(p.col, p.row);
      const cx = x + CELL_SIZE / 2;
      const cy = y + CELL_SIZE / 2;
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    const dest = path[path.length - 1];
    const { x, y } = this.cellToPixel(dest.col, dest.row);
    ctx.strokeStyle = 'rgba(255, 204, 0, 0.9)';
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.strokeRect(x + 3, y + 3, CELL_SIZE - 6, CELL_SIZE - 6);

    ctx.restore();
  }

  /**
   * @param {number} col
   * @param {number} row
   * @param {boolean} isExplosion
   * @param {number} progress 0..1
   */
  drawCollisionAnimation(col, row, isExplosion, progress) {
    const { ctx } = this;
    const t = Math.max(0, Math.min(1, progress));
    const { x, y } = this.cellToPixel(col, row);
    const cx = x + CELL_SIZE / 2;
    const cy = y + CELL_SIZE / 2;
    const maxR = CELL_SIZE * 0.65 * (0.3 + 0.7 * t);
    ctx.save();

    if (isExplosion) {
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 1.4);
      grd.addColorStop(0, `rgba(255, 255, 220, ${0.9 * (1 - t)})`);
      grd.addColorStop(0.35, `rgba(255, 120, 40, ${0.7 * (1 - t * 0.5)})`);
      grd.addColorStop(1, 'rgba(255, 40, 20, 0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 200, 80, ${1 - t})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const flash = 0.85 * (1 - t);
      ctx.fillStyle = `rgba(255, 255, 255, ${flash})`;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 20 * (1 - t);
      ctx.beginPath();
      ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  /**
   * @param {{ col: number, row: number }[]} cells
   */
  highlightReachableCells(cells) {
    const { ctx } = this;
    ctx.save();
    for (const { col, row } of cells) {
      const { x, y } = this.cellToPixel(col, row);
      ctx.fillStyle = 'rgba(0, 204, 255, 0.15)';
      ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      ctx.strokeStyle = 'rgba(0, 204, 255, 0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x + 3, y + 3, CELL_SIZE - 6, CELL_SIZE - 6);
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  /**
   * @param {number} col
   * @param {number} row
   * @param {string} color
   */
  highlightCell(col, row, color) {
    const { ctx } = this;
    const { x, y } = this.cellToPixel(col, row);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.strokeRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
    ctx.restore();
  }

  /**
   * @param {number} col
   * @param {number} row
   * @returns {{ x: number, y: number }}
   */
  cellToPixel(col, row) {
    return cellToPixelStatic(col, row);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {{ col: number, row: number }}
   */
  pixelToCell(x, y) {
    const col = Math.floor(x / CELL_SIZE);
    const row = BOARD_ROWS - 1 - Math.floor(y / CELL_SIZE);
    return { col, row };
  }
}

/**
 * @param {1|2} player
 * @returns {{ col: number, row: number }[]}
 */
function deployZoneTiles(player) {
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

/** @param {string} phase */
function defaultInstruction(phase) {
  switch (phase) {
    case 'card_select':
      return '选择本局要携带的卡牌。';
    case 'deploy':
      return '在己方部署区内放置棋子。';
    case 'destiny':
      return '选择或结算命运效果。';
    case 'command':
      return '为棋子下达移动等指令。';
    case 'execute':
      return '执行移动与碰撞结算。';
    case 'game_over':
      return '对局结束。';
    default:
      return '';
  }
}

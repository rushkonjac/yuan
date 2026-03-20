/**
 * @fileoverview Main game controller for 渊 — ties together Game, Renderer, and Input.
 */

import { PHASE, CARD_POOL, PIECE_TYPE } from './types.js';
import { findPieceAt, computePath, getMaxDistance } from './movement.js';
import { Game } from './game.js';
import { Renderer } from './renderer.js';
import { InputController } from './input.js';

export class GameController {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.game = new Game();
    this.renderer = new Renderer(canvas);
    this.input = new InputController(canvas, this.renderer);

    /** @type {string|null} currently selected piece id */
    this.selectedPieceId = null;
    /** @type {{dx:number,dy:number}|null} chosen direction */
    this.chosenDir = null;
    /** @type {number} chosen distance */
    this.chosenDist = 0;
    /** @type {{col:number,row:number}[]|null} preview path */
    this.previewPath = null;
    /** @type {string[]} selected card ids during card_select */
    this.cardSelection = [];
    /** @type {string|null} card being targeted */
    this.pendingCard = null;
    /** @type {string|null} first piece for swap */
    this.swapFirst = null;
    /** @type {string} status message */
    this.statusMsg = '';
    /** @type {boolean} */
    this.animating = false;

    this._setupCallbacks();
    this.game.init();
    this.game.aiSelectCards();
    this.render();
  }

  _setupCallbacks() {
    this.input.callbacks.onCellClick = (col, row) => this._handleClick(col, row);
    this.input.callbacks.onDirectionSet = (dir) => this._handleDirection(dir);
    this.input.callbacks.onDistanceSet = (dist) => this._handleDistance(dist);
    this.input.callbacks.onConfirm = () => this._handleConfirm();
    this.input.callbacks.onSkip = () => this._handleSkip();
  }

  // ─── Click handler ────────────────────────────────────────────────

  /** @param {number} col @param {number} row */
  _handleClick(col, row) {
    if (this.animating) return;
    const phase = this.game.phase;

    if (phase === PHASE.CARD_SELECT) {
      return;
    }

    if (phase === PHASE.DEPLOY) {
      this._handleDeployClick(col, row);
      return;
    }

    if (phase === PHASE.COMMAND) {
      if (this.pendingCard === 'scout') {
        this._handleScoutTarget(col, row);
        return;
      }
      if (this.pendingCard === 'reef') {
        this._handleReefTarget(col, row);
        return;
      }
      if (this.pendingCard === 'swap') {
        this._handleSwapTarget(col, row);
        return;
      }
      if (this.pendingCard && ['shield', 'blade', 'blast'].includes(this.pendingCard)) {
        this._handleTriggerTarget(col, row);
        return;
      }
      this._handleCommandClick(col, row);
      return;
    }
  }

  // ─── Card Select Phase ────────────────────────────────────────────

  /** Called from external UI buttons
   * @param {string} cardId */
  toggleCardSelection(cardId) {
    if (this.game.phase !== PHASE.CARD_SELECT) return;
    const idx = this.cardSelection.indexOf(cardId);
    if (idx >= 0) {
      this.cardSelection.splice(idx, 1);
    } else if (this.cardSelection.length < 3) {
      this.cardSelection.push(cardId);
    }
    this.render();
  }

  confirmCardSelection() {
    if (this.game.phase !== PHASE.CARD_SELECT) return;
    if (this.cardSelection.length !== 3) {
      this.statusMsg = '请选择3张卡牌';
      this.render();
      return;
    }
    this.game.selectCards(1, this.cardSelection);
    this.statusMsg = '卡牌已选定，开始部署棋子';
    this.render();
  }

  // ─── Deploy Phase ─────────────────────────────────────────────────

  /** @param {number} col @param {number} row */
  _handleDeployClick(col, row) {
    const myPieces = this.game.getPlayerPieces(1);
    const undeployed = myPieces.filter((p) => p.tiles.length === 0);

    const pieceOnCell = findPieceAt(this.game.pieces, col, row);
    if (pieceOnCell && pieceOnCell.owner === 1) {
      this.selectedPieceId = pieceOnCell.id;
      this.statusMsg = `已选中 ${this._pieceLabel(pieceOnCell)}，点击其他格子重新放置`;
      this.render();
      return;
    }

    if (!this.selectedPieceId && undeployed.length > 0) {
      this.selectedPieceId = undeployed[0].id;
    }

    if (this.selectedPieceId) {
      this.game.deployPiece(1, this.selectedPieceId, col, row);
      const remaining = myPieces.filter((p) => p.tiles.length === 0);
      if (remaining.length > 0) {
        this.selectedPieceId = remaining[0].id;
        this.statusMsg = `部署 ${this._pieceLabel(remaining[0])}`;
      } else {
        this.selectedPieceId = null;
        this.statusMsg = '部署完成';
        if (this.game.phase === PHASE.DEPLOY) {
          this.game.autoDeployAI();
        }
      }
    }
    this.render();
  }

  // ─── Command Phase ────────────────────────────────────────────────

  /** @param {number} col @param {number} row */
  _handleCommandClick(col, row) {
    const piece = findPieceAt(this.game.pieces, col, row);

    if (piece && piece.owner === 1 && piece.alive) {
      this.selectedPieceId = piece.id;
      this.chosenDir = null;
      this.chosenDist = 0;
      this.previewPath = null;
      this.statusMsg = `已选中 ${this._pieceLabel(piece)}，按方向键设定移动方向`;
      this.render();
      return;
    }

    if (this.selectedPieceId && this.chosenDir) {
      const selPiece = this.game.pieces.find((p) => p.id === this.selectedPieceId);
      if (selPiece && selPiece.tiles[0]) {
        const dx = col - selPiece.tiles[0].col;
        const dy = row - selPiece.tiles[0].row;
        if (dx !== 0 || dy !== 0) {
          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist <= getMaxDistance(selPiece, this.game.player1.surgeDistanceBonus)) {
            this.chosenDist = dist;
            this._updatePreview();
          }
        }
      }
    }
    this.render();
  }

  /** @param {{dx:number,dy:number}} dir */
  _handleDirection(dir) {
    if (this.game.phase !== PHASE.COMMAND || this.animating) return;
    if (!this.selectedPieceId) {
      this.statusMsg = '先点击选择一枚己方棋子';
      this.render();
      return;
    }
    this.chosenDir = dir;
    this.chosenDist = 1;
    this._updatePreview();
    const dirName = dir.dy > 0 ? '上' : dir.dy < 0 ? '下' : dir.dx < 0 ? '左' : '右';
    this.statusMsg = `方向: ${dirName}，按1-4设距离，Enter确认，Esc跳过`;
    this.render();
  }

  /** @param {number} dist */
  _handleDistance(dist) {
    if (this.game.phase !== PHASE.COMMAND || this.animating) return;
    if (!this.selectedPieceId || !this.chosenDir) return;
    const piece = this.game.pieces.find((p) => p.id === this.selectedPieceId);
    if (!piece) return;
    const maxD = getMaxDistance(piece, this.game.player1.surgeDistanceBonus);
    this.chosenDist = Math.min(dist, maxD);
    this._updatePreview();
    this.render();
  }

  _updatePreview() {
    if (!this.selectedPieceId || !this.chosenDir) {
      this.previewPath = null;
      return;
    }
    const piece = this.game.pieces.find((p) => p.id === this.selectedPieceId);
    if (!piece || !piece.tiles[0]) { this.previewPath = null; return; }

    const path = computePath(
      piece, this.chosenDir, this.chosenDist, this.game.board, this.game.pieces,
    );
    this.previewPath = [{ col: piece.tiles[0].col, row: piece.tiles[0].row }, ...path.steps];
  }

  _handleConfirm() {
    if (this.animating) return;
    const phase = this.game.phase;

    if (phase === PHASE.COMMAND) {
      if (this.selectedPieceId && this.chosenDir && this.chosenDist > 0) {
        this.game.setMove(1, this.selectedPieceId, this.chosenDir, this.chosenDist);
        this.game.aiChooseMove();
        this._executeAndAnimate();
      } else {
        this.statusMsg = '请选择棋子和方向后确认，或按Esc跳过';
        this.render();
      }
      return;
    }

    if (phase === PHASE.CARD_SELECT) {
      this.confirmCardSelection();
      return;
    }
  }

  _handleSkip() {
    if (this.animating) return;

    if (this.game.phase === PHASE.COMMAND) {
      if (this.pendingCard) {
        this.pendingCard = null;
        this.swapFirst = null;
        this.statusMsg = '取消卡牌使用';
        this.render();
        return;
      }
      this.game.skipMove(1);
      this.game.aiChooseMove();
      this._executeAndAnimate();
      return;
    }
  }

  // ─── Card usage in command phase ──────────────────────────────────

  /** @param {string} cardId */
  useCard(cardId) {
    if (this.game.phase !== PHASE.COMMAND || this.animating) return;
    const st = this.game.player1;
    if (st.cardUsedThisTurn) {
      this.statusMsg = '本回合已使用过卡牌';
      this.render();
      return;
    }
    if (st.usedCards.includes(cardId)) {
      this.statusMsg = '该卡已使用过';
      this.render();
      return;
    }
    const card = CARD_POOL.find((c) => c.id === cardId);
    if (!card) return;

    this.pendingCard = cardId;
    this.swapFirst = null;

    switch (cardId) {
      case 'scout':
        this.statusMsg = '侦查：点击一枚敌方棋子';
        break;
      case 'reef':
        this.statusMsg = '造礁：点击一个空格放置暗礁';
        break;
      case 'swap':
        this.statusMsg = '暗流：点击第一枚己方棋子';
        break;
      case 'shield':
      case 'blade':
      case 'blast':
        this.statusMsg = `${card.name}：点击一枚己方棋子设置触发卡`;
        break;
      default:
        break;
    }
    this.render();
  }

  /** @param {number} col @param {number} row */
  _handleScoutTarget(col, row) {
    const piece = findPieceAt(this.game.pieces, col, row);
    if (!piece || piece.owner === 1) {
      this.statusMsg = '请点击敌方棋子';
      this.render();
      return;
    }
    const result = this.game.useCard(1, 'scout', { targetPieceId: piece.id });
    if (result) {
      this.statusMsg = result.isHeart ? '侦查结果：是渊心！' : '侦查结果：不是渊心';
    }
    this.pendingCard = null;
    this.render();
  }

  /** @param {number} col @param {number} row */
  _handleReefTarget(col, row) {
    const result = this.game.useCard(1, 'reef', { col, row });
    if (result) {
      this.statusMsg = '暗礁已放置';
    } else {
      this.statusMsg = '无法放置暗礁（格子已占用或不可用）';
    }
    this.pendingCard = null;
    this.render();
  }

  /** @param {number} col @param {number} row */
  _handleSwapTarget(col, row) {
    const piece = findPieceAt(this.game.pieces, col, row);
    if (!piece || piece.owner !== 1 || !piece.alive) {
      this.statusMsg = '请点击己方棋子';
      this.render();
      return;
    }
    if (!this.swapFirst) {
      this.swapFirst = piece.id;
      this.statusMsg = `暗流：已选 ${this._pieceLabel(piece)}，再选第二枚`;
      this.render();
      return;
    }
    if (this.swapFirst === piece.id) {
      this.statusMsg = '不能选同一枚棋子';
      this.render();
      return;
    }
    const result = this.game.useCard(1, 'swap', { pieceId1: this.swapFirst, pieceId2: piece.id });
    if (result) {
      this.statusMsg = '暗流：两枚棋子已交换位置';
    }
    this.pendingCard = null;
    this.swapFirst = null;
    this.render();
  }

  /** @param {number} col @param {number} row */
  _handleTriggerTarget(col, row) {
    const piece = findPieceAt(this.game.pieces, col, row);
    if (!piece || piece.owner !== 1 || !piece.alive) {
      this.statusMsg = '请点击己方棋子';
      this.render();
      return;
    }
    const cardId = this.pendingCard;
    const result = this.game.useCard(1, cardId, { pieceId: piece.id });
    if (result) {
      const card = CARD_POOL.find((c) => c.id === cardId);
      this.statusMsg = `${card?.name ?? cardId} 已设置到 ${this._pieceLabel(piece)}`;
    }
    this.pendingCard = null;
    this.render();
  }

  // ─── Destiny Phase ────────────────────────────────────────────────

  /** @param {string} destinyId */
  selectDestiny(destinyId) {
    if (this.game.phase !== PHASE.DESTINY || this.animating) return;
    this.game.selectDestiny(1, destinyId);
    const aiChoices = this.game.getDestinyChoices(2);
    this.game.aiSelectDestiny(aiChoices);
    this.statusMsg = '';
    this.render();
  }

  // ─── Execution & Animation ────────────────────────────────────────

  _executeAndAnimate() {
    this.animating = true;
    const result = this.game.executeMoves();

    if (result.collisions.length > 0) {
      this._animateCollisions(result.collisions, 0);
    } else {
      this._finishTurn();
    }
  }

  /**
   * @param {{col:number,row:number,pieceA:any,pieceB:any,time:number}[]} collisions
   * @param {number} idx
   */
  _animateCollisions(collisions, idx) {
    if (idx >= collisions.length) {
      this._finishTurn();
      return;
    }
    const c = collisions[idx];
    const isExplosion = c.pieceA.type === PIECE_TYPE.BOMB || c.pieceB.type === PIECE_TYPE.BOMB;
    const duration = 600;
    const start = performance.now();

    const tick = () => {
      const elapsed = performance.now() - start;
      const progress = Math.min(1, elapsed / duration);
      this.render();
      this.renderer.drawCollisionAnimation(c.col, c.row, isExplosion, progress);
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        this._animateCollisions(collisions, idx + 1);
      }
    };
    requestAnimationFrame(tick);
  }

  _finishTurn() {
    this.animating = false;
    this.selectedPieceId = null;
    this.chosenDir = null;
    this.chosenDist = 0;
    this.previewPath = null;

    if (this.game.gameResult) {
      const r = this.game.gameResult;
      this.statusMsg = r.winner
        ? `游戏结束！玩家${r.winner}获胜 — ${r.reason}`
        : `游戏结束！平局 — ${r.reason}`;
    } else if (this.game.phase === PHASE.DESTINY) {
      this.statusMsg = '天命阶段：选择一个效果';
    } else {
      this.statusMsg = `第${this.game.turn}回合 — 点击棋子选择，方向键移动`;
    }
    this.render();
  }

  // ─── Rendering ────────────────────────────────────────────────────

  render() {
    this.renderer.clear();
    this.renderer.drawBoard(this.game.board);

    if (this.game.phase === PHASE.DEPLOY) {
      this.renderer.drawDeployZone(1);
    }

    this.renderer.drawPieces(this.game.pieces, 1);

    if (this.selectedPieceId) {
      const p = this.game.pieces.find((pp) => pp.id === this.selectedPieceId);
      if (p && p.tiles[0]) {
        this.renderer.highlightCell(p.tiles[0].col, p.tiles[0].row, '#00ccff');
      }
    }

    if (this.previewPath && this.previewPath.length > 1) {
      const p = this.game.pieces.find((pp) => pp.id === this.selectedPieceId);
      if (p) this.renderer.drawMovePreview(p, this.previewPath);
    }

    const st = this.game.player1;
    const remaining = st.cards
      .filter((c) => !st.usedCards.includes(c.id))
      .map((c) => c.name);
    const used = st.cards
      .filter((c) => st.usedCards.includes(c.id))
      .map((c) => c.name);

    this.renderer.drawUI({
      turn: this.game.turn,
      maxTurns: 15,
      phase: this.game.phase,
      currentPlayer: 1,
      cardsRemaining: remaining,
      cardsUsed: used,
      destinyEffects: st.destinyEffects,
      instructions: this.statusMsg,
    });
  }

  /** @param {import('./types.js').PieceShape} piece */
  _pieceLabel(piece) {
    if (piece.type === PIECE_TYPE.HEART) return `渊心(${piece.currentRank})`;
    if (piece.type === PIECE_TYPE.BOMB) return '渊胆';
    return `战斗棋(${piece.currentRank})`;
  }
}

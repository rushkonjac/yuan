/**
 * @fileoverview Game state machine for 渊 (Yuan / Abyss).
 */

import {
  PHASE,
  MAX_TURNS,
  DESTINY_TURNS,
  CARD_POOL,
  DESTINY_POOL,
  PIECE_TYPE,
  createDefaultPiecePool,
  TERRAIN,
} from './types.js';
import { createBoard, loadDefaultMap, getDeployZone, isPassable, isInBounds } from './board.js';
import { resolveCollision, applyCollisionResult } from './collision.js';
import {
  computePath,
  executeTurn,
  getMaxDistance,
  findPieceAt,
  movePieceTo,
} from './movement.js';

/** @param {readonly unknown[]} arr */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** @param {{ dx: number, dy: number }} d */
function isValidDirection(d) {
  if (!d) return false;
  return Math.abs(d.dx) + Math.abs(d.dy) === 1;
}

function createPlayerState() {
  return {
    cards: [],
    usedCards: [],
    deployedCount: 0,
    selectedPiece: null,
    moveDir: null,
    moveDist: 0,
    destinyEffects: [],
    destinyUsed: [],
    /** @type {{ id: string, name: string, type: string, desc: string }[]|null} */
    destinyChoices: null,
    destinySubmitted: false,
    commandSubmitted: false,
    cardUsedThisTurn: false,
    /** @type {number} Extra max distance for this command phase (涌潮). */
    surgeDistanceBonus: 0,
    /** @type {boolean} Reveal all enemy ranks until end of execute (荧光爆发). */
    revealAllEnemyThisTurn: false,
  };
}

export class Game {
  constructor() {
    this.board = null;
    /** @type {import('./types.js').PieceShape[]} */
    this.pieces = [];
    this.phase = PHASE.CARD_SELECT;
    this.turn = 0;
    this.currentPlayer = 1;

    this.player1 = createPlayerState();
    this.player2 = createPlayerState();

    /** @type {unknown[]} */
    this.turnLog = [];
    /** @type {{ winner: 1|2|null, reason: string }|null} */
    this.gameResult = null;
    /** @type {unknown} */
    this.animationState = null;
  }

  init() {
    this.board = createBoard();
    loadDefaultMap(this.board);
    this.pieces = [
      ...createDefaultPiecePool(1),
      ...createDefaultPiecePool(2),
    ];
    this.phase = PHASE.CARD_SELECT;
    this.turn = 0;
    this.gameResult = null;
    this.animationState = null;
    this.turnLog = [];
    this.player1 = createPlayerState();
    this.player2 = createPlayerState();
  }

  /** @param {1|2} player */
  getPlayerState(player) {
    return player === 1 ? this.player1 : this.player2;
  }

  /** @param {1|2} player */
  getPlayerPieces(player) {
    return this.pieces.filter((p) => p.owner === player && p.alive);
  }

  // --- Card Selection Phase ---

  /** @param {1|2} player @param {string[]} cardIds */
  selectCards(player, cardIds) {
    if (this.gameResult || this.phase !== PHASE.CARD_SELECT) return;
    const st = this.getPlayerState(player);
    if (cardIds.length !== 3) return;
    const poolIds = new Set(CARD_POOL.map((c) => c.id));
    const pick = new Set(cardIds);
    if (pick.size !== 3) return;
    for (const id of pick) {
      if (!poolIds.has(id)) return;
    }
    st.cards = CARD_POOL.filter((c) => pick.has(c.id));
    if (this.player1.cards.length === 3 && this.player2.cards.length === 3) {
      this.phase = PHASE.DEPLOY;
    }
  }

  // --- Deploy Phase ---

  /** @param {1|2} player @param {string} pieceId @param {number} col @param {number} row */
  deployPiece(player, pieceId, col, row) {
    if (this.gameResult || this.phase !== PHASE.DEPLOY) return;
    const piece = this.pieces.find((p) => p.id === pieceId && p.owner === player);
    if (!piece || piece.tiles.length > 0) return;
    const zone = getDeployZone(player);
    if (!zone.some((t) => t.col === col && t.row === row)) return;
    if (!isInBounds(col, row) || !isPassable(this.board, col, row)) return;
    if (findPieceAt(this.pieces, col, row)) return;

    piece.tiles = [{ col, row }];
    this.getPlayerState(player).deployedCount += 1;

    if (this.player1.deployedCount === 8 && this.player2.deployedCount === 8) {
      this.phase = PHASE.COMMAND;
      this.turn = 1;
      this._beginCommandTurn();
    }
  }

  autoDeployAI() {
    if (this.phase !== PHASE.DEPLOY) return;
    const zone = shuffle(getDeployZone(2));
    const pool = this.pieces.filter((p) => p.owner === 2 && p.tiles.length === 0);
    for (const piece of pool) {
      const cell = zone.find((t) => {
        if (!isPassable(this.board, t.col, t.row)) return false;
        return !findPieceAt(this.pieces, t.col, t.row);
      });
      if (cell) {
        piece.tiles = [{ col: cell.col, row: cell.row }];
        this.player2.deployedCount += 1;
      }
    }
    if (this.player1.deployedCount === 8 && this.player2.deployedCount === 8) {
      this.phase = PHASE.COMMAND;
      this.turn = 1;
      this._beginCommandTurn();
    }
  }

  // --- Destiny Phase ---

  isDestinyTurn() {
    return DESTINY_TURNS.includes(this.turn);
  }

  /** @param {1|2} player */
  getDestinyChoices(player) {
    if (this.phase !== PHASE.DESTINY) return [];
    const st = this.getPlayerState(player);
    if (st.destinyChoices && st.destinyChoices.length > 0) return st.destinyChoices;
    const used = new Set(st.destinyUsed);
    const pool = DESTINY_POOL.filter((d) => !used.has(d.id));
    const picked = shuffle(pool).slice(0, 3);
    st.destinyChoices = picked;
    return picked;
  }

  /** @param {1|2} player @param {string} destinyId */
  selectDestiny(player, destinyId) {
    if (this.gameResult || this.phase !== PHASE.DESTINY) return;
    const st = this.getPlayerState(player);
    if (st.destinySubmitted) return;
    const choices = st.destinyChoices ?? this.getDestinyChoices(player);
    const def = choices.find((d) => d.id === destinyId);
    if (!def) return;

    st.destinyUsed.push(def.id);
    st.destinySubmitted = true;

    if (def.type === 'persistent') {
      st.destinyEffects.push(def);
    } else {
      this._applyInstantDestiny(player, def);
    }

    if (this.player1.destinySubmitted && this.player2.destinySubmitted) {
      this.player1.destinyChoices = null;
      this.player2.destinyChoices = null;
      this.phase = PHASE.COMMAND;
      this._beginCommandTurn();
    }
  }

  /** @param {1|2} player @param {{ id: string, name: string, type: string, desc: string }} def */
  _applyInstantDestiny(player, def) {
    const st = this.getPlayerState(player);
    switch (def.id) {
      case 'reveal_all':
        st.revealAllEnemyThisTurn = true;
        break;
      case 'surge':
        st.surgeDistanceBonus = 2;
        break;
      case 'card_restore': {
        if (st.usedCards.length > 0) {
          const i = Math.floor(Math.random() * st.usedCards.length);
          st.usedCards.splice(i, 1);
        }
        break;
      }
      case 'reef_storm':
        this._spawnRandomReefs(3);
        break;
      case 'reef_remove':
        this._removeRandomReefs(2);
        break;
      default:
        break;
    }
  }

  _spawnRandomReefs(n) {
    /** @type {{ col: number, row: number }[]} */
    const candidates = [];
    for (let c = 0; c < this.board.length; c += 1) {
      for (let r = 0; r < this.board[c].length; r += 1) {
        if (this.board[c][r].terrain !== TERRAIN.NONE) continue;
        if (findPieceAt(this.pieces, c, r)) continue;
        candidates.push({ col: c, row: r });
      }
    }
    for (const t of shuffle(candidates).slice(0, n)) {
      this.board[t.col][t.row].terrain = TERRAIN.REEF;
    }
  }

  _removeRandomReefs(n) {
    /** @type {{ col: number, row: number }[]} */
    const reefs = [];
    for (let c = 0; c < this.board.length; c += 1) {
      for (let r = 0; r < this.board[c].length; r += 1) {
        if (this.board[c][r].terrain === TERRAIN.REEF) reefs.push({ col: c, row: r });
      }
    }
    for (const t of shuffle(reefs).slice(0, n)) {
      this.board[t.col][t.row].terrain = TERRAIN.NONE;
    }
  }

  // --- Command Phase ---

  /** @param {1|2} player @param {string} pieceId @param {{ dx: number, dy: number }} direction @param {number} distance */
  setMove(player, pieceId, direction, distance) {
    if (this.gameResult || this.phase !== PHASE.COMMAND) return;
    if (!isValidDirection(direction)) return;
    const st = this.getPlayerState(player);
    const piece = this.pieces.find((p) => p.id === pieceId && p.owner === player);
    if (!piece || !piece.alive || !piece.tiles[0]) return;

    const maxD = getMaxDistance(piece, st.surgeDistanceBonus);
    const dist = Math.floor(distance);
    if (dist < 1 || dist > maxD) return;

    st.selectedPiece = pieceId;
    st.moveDir = { dx: direction.dx, dy: direction.dy };
    st.moveDist = dist;
    st.commandSubmitted = true;
  }

  /** @param {1|2} player */
  skipMove(player) {
    if (this.gameResult || this.phase !== PHASE.COMMAND) return;
    const st = this.getPlayerState(player);
    st.selectedPiece = null;
    st.moveDir = null;
    st.moveDist = 0;
    st.commandSubmitted = true;
  }

  /** @param {1|2} player @param {string} cardId @param {Record<string, unknown>} targetInfo */
  useCard(player, cardId, targetInfo) {
    if (this.gameResult || this.phase !== PHASE.COMMAND) return null;
    const st = this.getPlayerState(player);
    if (st.cardUsedThisTurn) return null;
    const card = st.cards.find((c) => c.id === cardId);
    if (!card || st.usedCards.includes(cardId)) return null;

    if (card.type === 'instant') {
      const out = this._useInstantCard(player, card, targetInfo);
      if (out !== undefined) {
        st.usedCards.push(cardId);
        st.cardUsedThisTurn = true;
      }
      return out;
    }

    if (card.type === 'trigger') {
      const ok = this._setTriggerCard(player, card, targetInfo);
      if (ok) {
        st.usedCards.push(cardId);
        st.cardUsedThisTurn = true;
      }
      return ok ? { ok: true } : null;
    }
    return null;
  }

  /**
   * @param {1|2} player
   * @param {import('./types.js').CardDef} card
   * @param {Record<string, unknown>} targetInfo
   */
  _useInstantCard(player, card, targetInfo) {
    switch (card.id) {
      case 'scout': {
        const id = String(targetInfo?.targetPieceId ?? '');
        const target = this.pieces.find((p) => p.id === id && p.owner !== player && p.alive);
        if (!target) return undefined;
        target.revealed = true;
        const isHeart = target.type === PIECE_TYPE.HEART;
        this.turnLog.push({ type: 'scout', targetPieceId: id, isHeart });
        return { isHeart };
      }
      case 'reef': {
        const col = Number(targetInfo?.col);
        const row = Number(targetInfo?.row);
        if (!Number.isInteger(col) || !Number.isInteger(row)) return undefined;
        if (!isInBounds(col, row) || !isPassable(this.board, col, row)) return undefined;
        if (findPieceAt(this.pieces, col, row)) return undefined;
        this.board[col][row].terrain = TERRAIN.REEF;
        this.turnLog.push({ type: 'reef', col, row });
        return { ok: true };
      }
      case 'swap': {
        const id1 = String(targetInfo?.pieceId1 ?? '');
        const id2 = String(targetInfo?.pieceId2 ?? '');
        const a = this.pieces.find((p) => p.id === id1 && p.owner === player && p.alive);
        const b = this.pieces.find((p) => p.id === id2 && p.owner === player && p.alive);
        if (!a || !b || a === b) return undefined;
        if (!a.tiles.length || !b.tiles.length) return undefined;
        const tmp = a.tiles.map((t) => ({ col: t.col, row: t.row }));
        a.tiles = b.tiles.map((t) => ({ col: t.col, row: t.row }));
        b.tiles = tmp;
        this.turnLog.push({ type: 'swap', pieceId1: id1, pieceId2: id2 });
        return { ok: true };
      }
      default:
        return undefined;
    }
  }

  /**
   * @param {1|2} player
   * @param {import('./types.js').CardDef} card
   * @param {Record<string, unknown>} targetInfo
   */
  _setTriggerCard(player, card, targetInfo) {
    const id = String(targetInfo?.pieceId ?? '');
    const piece = this.pieces.find((p) => p.id === id && p.owner === player && p.alive);
    if (!piece) return false;
    piece.triggerCard = card;
    this.turnLog.push({ type: 'trigger', cardId: card.id, pieceId: id });
    return true;
  }

  /** @param {import('./types.js').PieceShape} piece */
  _extraSpeedForPiece(piece) {
    const st = this.getPlayerState(
      /** @type {1|2} */ (piece.owner),
    );
    return st.destinyEffects.some((d) => d.id === 'dark_surge') ? 0.5 : 0;
  }

  /** @param {1|2} player */
  _hasShell(player) {
    return this.getPlayerState(player).destinyEffects.some((d) => d.id === 'shell');
  }

  /**
   * @param {import('./types.js').PieceShape} victim
   * @param {import('./types.js').PieceShape|null} killer
   */
  _applyResonanceOnDeath(victim, killer) {
    if (!killer || !killer.alive) return;
    const st = this.getPlayerState(/** @type {1|2} */ (victim.owner));
    if (st.destinyEffects.some((d) => d.id === 'resonance')) killer.revealed = true;
  }

  /**
   * Determine growth direction for the winner.
   * - If the winner moved, grow behind the winner (opposite to its move dir).
   * - If the winner was stationary (defender), grow toward where the attacker came from.
   * In both cases _syncTilesToBodySize does `tail - moveDir`, so we return
   * the "forward" direction in both scenarios.
   */
  _getGrowthDir(winner, collisionPieceA, move1, move2) {
    if (move1 && move1.piece === winner) return move1.direction;
    if (move2 && move2.piece === winner) return move2.direction;
    const attacker = collisionPieceA === winner ? null : collisionPieceA;
    if (attacker) {
      if (move1 && move1.piece === attacker) return move1.direction;
      if (move2 && move2.piece === attacker) return move2.direction;
    }
    return { dx: 0, dy: 1 };
  }

  /**
   * Sync piece.tiles to match piece.bodySize after collision.
   * Growth extends behind the head (opposite to growthDir).
   */
  _syncTilesToBodySize(piece, growthDir) {
    const target = piece.bodySize;
    while (piece.tiles.length > target) {
      piece.tiles.pop();
    }
    while (piece.tiles.length < target) {
      const tail = piece.tiles[piece.tiles.length - 1];
      const newCol = tail.col - growthDir.dx;
      const newRow = tail.row - growthDir.dy;
      if (isInBounds(newCol, newRow)) {
        piece.tiles.push({ col: newCol, row: newRow });
      } else {
        const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
        let added = false;
        for (const d of dirs) {
          const fc = tail.col + d.dx;
          const fr = tail.row + d.dy;
          if (isInBounds(fc, fr)) {
            const occupied = piece.tiles.some(t => t.col === fc && t.row === fr);
            if (!occupied) { piece.tiles.push({ col: fc, row: fr }); added = true; break; }
          }
        }
        if (!added) break;
      }
    }
    console.log(`[SyncTiles] piece=${piece.id} bodySize=${piece.bodySize} tiles=${JSON.stringify(piece.tiles)} dir=${JSON.stringify(growthDir)}`);
  }

  // --- Execute Phase ---

  executeMoves() {
    if (this.gameResult || this.phase !== PHASE.COMMAND) {
      return { collisions: [], events: [], finalPositions: [] };
    }
    if (!this.player1.commandSubmitted || !this.player2.commandSubmitted) {
      return { collisions: [], events: [], finalPositions: [] };
    }

    this.phase = PHASE.EXECUTE;
    this.turnLog = [];

    const move1 = this._buildMoveForPlayer(1);
    const move2 = this._buildMoveForPlayer(2);

    const { collisions, finalPositions, events } = executeTurn(
      move1,
      move2,
      this.board,
      this.pieces,
    );

    /** @type {Set<string>} */
    const collidedIds = new Set();
    for (const c of collisions) {
      collidedIds.add(c.pieceA.id);
      collidedIds.add(c.pieceB.id);
    }

    for (const { piece, col, row } of finalPositions) {
      if (!piece.alive) continue;
      if (collidedIds.has(piece.id)) continue;
      movePieceTo(piece, col, row);
    }

    const sorted = [...collisions].sort((a, b) => a.time - b.time);
    for (const c of sorted) {
      if (!c.pieceA.alive || !c.pieceB.alive) continue;

      const result = resolveCollision(c.pieceA, c.pieceB);
      console.log(`[Collision] A=${c.pieceA.id}(rank=${c.pieceA.currentRank},body=${c.pieceA.bodySize}) vs B=${c.pieceB.id}(rank=${c.pieceB.currentRank},body=${c.pieceB.bodySize}) => type=${result.type}`);
      applyCollisionResult(result, c.pieceA, c.pieceB);

      if (result.type === 'win' && result.winner) {
        console.log(`[Collision] winner=${result.winner.id} newBody=${result.winner.bodySize} newRank=${result.winner.currentRank} tilesLen=${result.winner.tiles.length}`);
        const growDir = this._getGrowthDir(result.winner, c.pieceA, move1, move2);
        movePieceTo(result.winner, c.col, c.row);
        if (result.loserA && !result.loserA.alive) {
          this._applyResonanceOnDeath(result.loserA, result.winner);
        }
        if (result.loserB && !result.loserB.alive) {
          this._applyResonanceOnDeath(result.loserB, result.winner);
        }
        if (this._hasShell(/** @type {1|2} */ (result.winner.owner))) {
          result.winner.bodySize = Math.min(4, result.winner.bodySize + 1);
        }
        this._syncTilesToBodySize(result.winner, growDir);
      }

      if (result.type === 'mutual_death') {
        c.pieceA.tiles = [];
        c.pieceB.tiles = [];
      } else if (result.type === 'win') {
        const loser = result.winner === c.pieceA ? c.pieceB : c.pieceA;
        if (!loser.alive) loser.tiles = [];
      }
    }

    this.animationState = { collisions, events, finalPositions, move1, move2 };
    this.checkWinConditions();

    if (!this.gameResult) {
      if (this.turn >= MAX_TURNS) this._tiebreakEnd();
      else this.nextTurn();
    } else {
      this.phase = PHASE.GAME_OVER;
    }

    return { collisions, events, finalPositions };
  }

  /** @param {1|2} player */
  _buildMoveForPlayer(player) {
    const st = this.getPlayerState(player);
    if (!st.selectedPiece || !st.moveDir || st.moveDist < 1) return null;
    const piece = this.pieces.find((p) => p.id === st.selectedPiece && p.owner === player);
    if (!piece || !piece.alive || !piece.tiles[0]) return null;

    const maxD = getMaxDistance(piece, st.surgeDistanceBonus);
    const d = Math.min(st.moveDist, maxD);
    const path = computePath(piece, st.moveDir, d, this.board, this.pieces);
    return {
      piece,
      path,
      direction: st.moveDir,
      extraSpeed: this._extraSpeedForPiece(piece),
    };
  }

  // --- Win Condition Check ---

  checkWinConditions() {
    if (this.gameResult) return;

    const heartAlive = (pl) =>
      this.pieces.some(
        (p) => p.owner === pl && p.alive && p.type === PIECE_TYPE.HEART,
      );
    const aliveCount = (pl) => this.pieces.filter((p) => p.owner === pl && p.alive).length;

    const h1 = heartAlive(1);
    const h2 = heartAlive(2);
    if (!h1 && !h2) {
      this.gameResult = { winner: null, reason: '双方核心均被摧毁' };
      return;
    }
    if (!h1) {
      this.gameResult = { winner: 2, reason: '玩家1核心被摧毁' };
      return;
    }
    if (!h2) {
      this.gameResult = { winner: 1, reason: '玩家2核心被摧毁' };
      return;
    }

    const n1 = aliveCount(1);
    const n2 = aliveCount(2);
    if (n1 === 0 && n2 === 0) {
      this.gameResult = { winner: null, reason: '双方均无存活单位' };
      return;
    }
    if (n1 === 0) {
      this.gameResult = { winner: 2, reason: '玩家1无存活单位' };
      return;
    }
    if (n2 === 0) {
      this.gameResult = { winner: 1, reason: '玩家2无存活单位' };
      return;
    }
  }

  _sumRank(pl) {
    return this.pieces
      .filter((p) => p.owner === pl && p.alive)
      .reduce((s, p) => s + p.currentRank, 0);
  }

  _sumBody(pl) {
    return this.pieces
      .filter((p) => p.owner === pl && p.alive)
      .reduce((s, p) => s + p.bodySize, 0);
  }

  _tiebreakEnd() {
    const r1 = this._sumRank(1);
    const r2 = this._sumRank(2);
    if (r1 > r2) {
      this.gameResult = { winner: 1, reason: `第${MAX_TURNS}回合结束：总阶位 ${r1} > ${r2}` };
    } else if (r2 > r1) {
      this.gameResult = { winner: 2, reason: `第${MAX_TURNS}回合结束：总阶位 ${r2} > ${r1}` };
    } else {
      const b1 = this._sumBody(1);
      const b2 = this._sumBody(2);
      if (b1 > b2) {
        this.gameResult = {
          winner: 1,
          reason: `第${MAX_TURNS}回合结束：阶位相同，总体积 ${b1} > ${b2}`,
        };
      } else if (b2 > b1) {
        this.gameResult = {
          winner: 2,
          reason: `第${MAX_TURNS}回合结束：阶位相同，总体积 ${b2} > ${b1}`,
        };
      } else {
        this.gameResult = { winner: null, reason: `第${MAX_TURNS}回合结束：阶位与体积均相同` };
      }
    }
    this.phase = PHASE.GAME_OVER;
  }

  // --- Turn Advancement ---

  nextTurn() {
    if (this.gameResult) return;
    this.player1.surgeDistanceBonus = 0;
    this.player2.surgeDistanceBonus = 0;
    this.player1.revealAllEnemyThisTurn = false;
    this.player2.revealAllEnemyThisTurn = false;
    this.turn += 1;
    this._applyDeepInstinct();
    this._beginCommandTurn();
    if (DESTINY_TURNS.includes(this.turn)) {
      this.phase = PHASE.DESTINY;
      this.player1.destinySubmitted = false;
      this.player2.destinySubmitted = false;
      this.player1.destinyChoices = null;
      this.player2.destinyChoices = null;
    } else {
      this.phase = PHASE.COMMAND;
    }
  }

  _beginCommandTurn() {
    this.player1.commandSubmitted = false;
    this.player2.commandSubmitted = false;
    this.player1.selectedPiece = null;
    this.player1.moveDir = null;
    this.player1.moveDist = 0;
    this.player2.selectedPiece = null;
    this.player2.moveDir = null;
    this.player2.moveDist = 0;
    this.player1.cardUsedThisTurn = false;
    this.player2.cardUsedThisTurn = false;
    this.turnLog = [];
  }

  _applyDeepInstinct() {
    for (const pl of /** @type {const} */ ([1, 2])) {
      const st = this.getPlayerState(pl);
      if (!st.destinyEffects.some((d) => d.id === 'deep_instinct')) continue;
      const enemy = pl === 1 ? 2 : 1;
      const hidden = shuffle(
        this.pieces.filter((p) => p.owner === enemy && p.alive && !p.revealed),
      );
      if (hidden.length > 0) hidden[0].revealed = true;
    }
  }

  // --- AI ---

  aiSelectCards() {
    const ids = shuffle(CARD_POOL.map((c) => c.id)).slice(0, 3);
    this.selectCards(2, ids);
  }

  aiChooseMove() {
    if (this.gameResult || this.phase !== PHASE.COMMAND) return;
    const alive = this.getPlayerPieces(2).filter((p) => p.tiles[0]);
    if (alive.length === 0) {
      this.skipMove(2);
      return;
    }
    const piece = alive[Math.floor(Math.random() * alive.length)];
    const dirs = shuffle([
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
    ]);
    const st = this.player2;
    const maxD = getMaxDistance(piece, st.surgeDistanceBonus);
    for (const d of dirs) {
      for (let dist = maxD; dist >= 1; dist -= 1) {
        const path = computePath(piece, d, dist, this.board, this.pieces);
        if (path.steps.length > 0) {
          this.setMove(2, piece.id, d, dist);
          return;
        }
      }
    }
    this.skipMove(2);
  }

  /** @param {{ id: string, name: string, type: string, desc: string }[]} choices */
  aiSelectDestiny(choices) {
    if (!choices.length) return;
    const pick = choices[Math.floor(Math.random() * choices.length)];
    this.selectDestiny(2, pick.id);
  }
}

/**
 * @fileoverview Room management for 渊 online — creates/joins rooms, relays game actions.
 */

import { Game } from '../src/game.js';
import { PHASE, CARD_POOL, DESTINY_TURNS, PIECE_TYPE } from '../src/types.js';
import { getDeployZone, isPassable } from '../src/board.js';
import { findPieceAt } from '../src/movement.js';

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function filterPiecesForPlayer(pieces, viewPlayer) {
  return pieces.filter(p => p.alive || true).map(p => {
    const base = {
      id: p.id,
      owner: p.owner,
      bodySize: p.bodySize,
      tiles: p.tiles.map(t => ({ col: t.col, row: t.row })),
      alive: p.alive,
    };
    if (p.owner === viewPlayer) {
      base.type = p.type;
      base.rank = p.rank;
      base.currentRank = p.currentRank;
      base.triggerCard = p.triggerCard ? p.triggerCard.id || p.triggerCard : null;
      base.revealed = p.revealed;
    } else {
      base.hasCard = !!p.triggerCard;
      base.revealed = p.revealed;
      if (p.revealed) {
        base.type = p.type;
        base.currentRank = p.currentRank;
      }
    }
    return base;
  });
}

function serializeBoard(board) {
  const result = [];
  for (let col = 0; col < board.length; col++) {
    result[col] = [];
    for (let row = 0; row < board[col].length; row++) {
      const cell = board[col][row];
      result[col][row] = {
        terrain: cell.terrain,
        riftPair: cell.riftPair ? { col: cell.riftPair.col, row: cell.riftPair.row } : null,
      };
    }
  }
  return result;
}

const PHASE_TIMEOUTS = {
  [PHASE.CARD_SELECT]: 30000,
  [PHASE.DEPLOY]: 60000,
  [PHASE.DESTINY]: 15000,
  [PHASE.COMMAND]: 20000,
};

export class Room {
  constructor(code) {
    this.code = code;
    this.game = new Game();
    this.game.init();
    /** @type {Map<1|2, import('ws').WebSocket>} */
    this.players = new Map();
    this.createdAt = Date.now();
    this.phaseTimer = null;
    this.disconnectTimers = new Map();
  }

  addPlayer(ws) {
    if (this.players.size >= 2) return null;
    const player = this.players.size === 0 ? 1 : 2;
    this.players.set(player, ws);
    ws._player = player;
    ws._room = this;

    if (this.players.size === 2) {
      this.startGame();
    }
    return player;
  }

  startGame() {
    this.sendTo(1, {
      event: 'gameStart',
      player: 1,
      board: serializeBoard(this.game.board),
    });
    this.sendTo(2, {
      event: 'gameStart',
      player: 2,
      board: serializeBoard(this.game.board),
    });
    this.broadcastState();
    this.startPhaseTimer();
  }

  /** @param {1|2} player @param {object} msg */
  handleAction(player, msg) {
    const { action } = msg;
    const game = this.game;

    switch (action) {
      case 'selectCards': {
        if (game.phase !== PHASE.CARD_SELECT) break;
        game.selectCards(player, msg.cards);
        this.broadcastState();
        if (game.phase !== PHASE.CARD_SELECT) this.startPhaseTimer();
        break;
      }
      case 'deploy': {
        if (game.phase !== PHASE.DEPLOY) break;
        game.deployPiece(player, msg.pieceId, msg.col, msg.row);
        this.sendState(player);
        if (game.player1.deployedCount === 8 && game.player2.deployedCount === 8) {
          this.broadcastState();
          this.startPhaseTimer();
        }
        break;
      }
      case 'setMove': {
        if (game.phase !== PHASE.COMMAND) break;
        game.setMove(player, msg.pieceId, msg.dir, msg.dist);
        this.sendTo(player, { event: 'moveAccepted' });
        this.tryExecute();
        break;
      }
      case 'skipMove': {
        if (game.phase !== PHASE.COMMAND) break;
        game.skipMove(player);
        this.sendTo(player, { event: 'moveAccepted' });
        this.tryExecute();
        break;
      }
      case 'useCard': {
        if (game.phase !== PHASE.COMMAND) break;
        const result = game.useCard(player, msg.cardId, msg.target || {});
        this.sendTo(player, { event: 'cardResult', cardId: msg.cardId, result });
        this.broadcastState();
        break;
      }
      case 'selectDestiny': {
        if (game.phase !== PHASE.DESTINY) break;
        game.selectDestiny(player, msg.destinyId);
        this.sendTo(player, { event: 'destinyAccepted' });
        if (game.player1.destinySubmitted && game.player2.destinySubmitted) {
          this.broadcastState();
          this.startPhaseTimer();
        }
        break;
      }
      default:
        this.sendTo(player, { event: 'error', message: `Unknown action: ${action}` });
    }
  }

  tryExecute() {
    const game = this.game;
    if (!game.player1.commandSubmitted || !game.player2.commandSubmitted) return;

    this.clearPhaseTimer();
    const result = game.executeMoves();

    const collisionData = result.collisions.map(c => ({
      col: c.col,
      row: c.row,
      time: c.time,
      isExplosion: c.pieceA.type === PIECE_TYPE.BOMB || c.pieceB.type === PIECE_TYPE.BOMB,
    }));

    this.sendTo(1, { event: 'turnResult', collisions: collisionData });
    this.sendTo(2, { event: 'turnResult', collisions: collisionData });

    setTimeout(() => {
      if (game.gameResult) {
        this.broadcastState();
        this.broadcast({ event: 'gameOver', winner: game.gameResult.winner, reason: game.gameResult.reason });
      } else {
        this.broadcastState();
        this.startPhaseTimer();
      }
    }, collisionData.length > 0 ? 800 : 100);
  }

  startPhaseTimer() {
    this.clearPhaseTimer();
    const phase = this.game.phase;
    const timeout = PHASE_TIMEOUTS[phase];
    if (!timeout) return;

    this.broadcast({ event: 'timerStart', phase, duration: timeout });

    this.phaseTimer = setTimeout(() => {
      this.handleTimeout(phase);
    }, timeout);
  }

  clearPhaseTimer() {
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
  }

  handleTimeout(phase) {
    const game = this.game;

    if (phase === PHASE.CARD_SELECT) {
      for (const pl of /** @type {const} */ ([1, 2])) {
        const st = game.getPlayerState(pl);
        if (st.cards.length < 3) {
          const ids = CARD_POOL.map(c => c.id).slice(0, 3);
          game.selectCards(pl, ids);
        }
      }
      this.broadcastState();
      this.startPhaseTimer();
    } else if (phase === PHASE.DEPLOY) {
      for (const pl of /** @type {const} */ ([1, 2])) {
        this.autoDeployRemaining(pl);
      }
      this.broadcastState();
      this.startPhaseTimer();
    } else if (phase === PHASE.COMMAND) {
      if (!game.player1.commandSubmitted) game.skipMove(1);
      if (!game.player2.commandSubmitted) game.skipMove(2);
      this.tryExecute();
    } else if (phase === PHASE.DESTINY) {
      for (const pl of /** @type {const} */ ([1, 2])) {
        const st = game.getPlayerState(pl);
        if (!st.destinySubmitted) {
          const choices = game.getDestinyChoices(pl);
          if (choices.length > 0) game.selectDestiny(pl, choices[0].id);
        }
      }
      this.broadcastState();
      this.startPhaseTimer();
    }
  }

  /** @param {1|2} player */
  autoDeployRemaining(player) {
    const game = this.game;
    const undeployed = game.pieces.filter(p => p.owner === player && p.tiles.length === 0);
    if (undeployed.length === 0) return;
    const zone = getDeployZone(player);
    const shuffled = zone.sort(() => Math.random() - 0.5);
    for (const piece of undeployed) {
      const cell = shuffled.find(t =>
        isPassable(game.board, t.col, t.row) && !findPieceAt(game.pieces, t.col, t.row)
      );
      if (cell) game.deployPiece(player, piece.id, cell.col, cell.row);
    }
  }

  broadcastState() {
    this.sendState(1);
    this.sendState(2);
  }

  /** @param {1|2} player */
  sendState(player) {
    const game = this.game;
    const st = game.getPlayerState(player);
    const opSt = game.getPlayerState(player === 1 ? 2 : 1);

    const state = {
      event: 'stateUpdate',
      phase: game.phase,
      turn: game.turn,
      pieces: filterPiecesForPlayer(game.pieces, player),
      board: serializeBoard(game.board),
      cards: st.cards.map(c => ({ id: c.id, name: c.name, type: c.type, desc: c.desc })),
      usedCards: st.usedCards,
      cardUsedThisTurn: st.cardUsedThisTurn,
      destinyEffects: st.destinyEffects.map(d => ({ id: d.id, name: d.name })),
      opponentDestinyEffects: opSt.destinyEffects.map(d => ({ id: d.id, name: d.name })),
      deployedCount: st.deployedCount,
      opponentDeployedCount: opSt.deployedCount,
      commandSubmitted: st.commandSubmitted,
      opponentCommandSubmitted: opSt.commandSubmitted,
    };

    if (game.phase === PHASE.DESTINY && !st.destinySubmitted) {
      state.destinyChoices = game.getDestinyChoices(player).map(d => ({
        id: d.id, name: d.name, type: d.type, desc: d.desc,
      }));
    }

    if (game.gameResult) {
      state.gameResult = game.gameResult;
    }

    this.sendTo(player, state);
  }

  /** @param {1|2} player @param {object} data */
  sendTo(player, data) {
    const ws = this.players.get(player);
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  }

  broadcast(data) {
    this.sendTo(1, data);
    this.sendTo(2, data);
  }

  handleDisconnect(player) {
    const other = player === 1 ? 2 : 1;
    this.sendTo(other, { event: 'opponentDisconnected' });

    this.disconnectTimers.set(player, setTimeout(() => {
      this.sendTo(other, { event: 'opponentLeft' });
      this.broadcast({ event: 'gameOver', winner: other, reason: '对手断线超时' });
      this.clearPhaseTimer();
    }, 30000));
  }

  handleReconnect(player, ws) {
    this.players.set(player, ws);
    ws._player = player;
    ws._room = this;

    const timer = this.disconnectTimers.get(player);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(player);
    }

    const other = player === 1 ? 2 : 1;
    this.sendTo(other, { event: 'opponentReconnected' });
    this.sendTo(player, {
      event: 'gameStart',
      player,
      board: serializeBoard(this.game.board),
      reconnect: true,
    });
    this.sendState(player);
  }

  isEmpty() {
    return this.players.size === 0 ||
      [...this.players.values()].every(ws => ws.readyState !== 1);
  }

  destroy() {
    this.clearPhaseTimer();
    for (const t of this.disconnectTimers.values()) clearTimeout(t);
  }
}

export class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
  }

  createRoom() {
    let code;
    do { code = generateCode(); } while (this.rooms.has(code));
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get(code?.toUpperCase()) || null;
  }

  removeRoom(code) {
    const room = this.rooms.get(code);
    if (room) {
      room.destroy();
      this.rooms.delete(code);
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const age = now - room.createdAt;
      if (age > 30 * 60 * 1000 && (room.isEmpty() || room.game.gameResult)) {
        this.removeRoom(code);
      }
    }
  }
}

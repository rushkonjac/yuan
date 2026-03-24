/**
 * @fileoverview Collision resolution for 渊 (Yuan).
 *
 * Priority (conceptual):
 * 1. Any piece vs bomb → mutual death (渊爆/渊甲均不改写此结果).
 * 2. 渊爆 on either side → mutual death（优先于渊甲）.
 * 3. Heart vs Heart → bounce，双方永久揭示.
 * 4. 其余按阶位/体积规则决胜；决胜前可因渊甲取消碰撞.
 *
 * 渊刃仅在「己方获胜」时生效：不扣阶，体积仍按规则增长/重算.
 */

import { PIECE_TYPE } from './types.js';

/** @param {import('./types.js').PieceShape} piece */
function isBomb(piece) {
  return piece.type === PIECE_TYPE.BOMB;
}

/** @param {import('./types.js').PieceShape} piece */
function isHeart(piece) {
  return piece.type === PIECE_TYPE.HEART;
}

/**
 * Normalize trigger storage: spec uses card id string; types.js may use CardDef.
 * @param {import('./types.js').PieceShape} piece
 * @returns {string|null}
 */
function triggerId(piece) {
  const t = piece.triggerCard;
  if (t == null) return null;
  if (typeof t === 'string') return t;
  return t.id ?? null;
}

/**
 * @param {import('./types.js').PieceShape} pieceA
 * @param {import('./types.js').PieceShape} pieceB
 * @returns {{
 *   type: 'win'|'mutual_death'|'bounce'|'cancelled',
 *   winner: import('./types.js').PieceShape|null,
 *   loserA: import('./types.js').PieceShape|null,
 *   loserB: import('./types.js').PieceShape|null,
 *   isExplosion: boolean,
 *   heartsRevealed: boolean,
 *   triggerActivated: { a: string|null, b: string|null },
 *   rankChange: { winner: number },
 *   bodyChange: { winner: number },
 *   heartKilled: null|import('./types.js').PlayerId,
 * }}
 */
export function resolveCollision(pieceA, pieceB) {
  /** @type {{ a: string|null, b: string|null }} */
  const triggerActivated = { a: null, b: null };

  const emptyDelta = () => ({ rankChange: { winner: 0 }, bodyChange: { winner: 0 } });

  // --- 1) 任意一方为炸弹：双方阵亡，无例外（渊甲无效） ---
  if (isBomb(pieceA) || isBomb(pieceB)) {
    return {
      type: 'mutual_death',
      winner: null,
      loserA: pieceA,
      loserB: pieceB,
      isExplosion: true,
      heartsRevealed: false,
      triggerActivated,
      ...emptyDelta(),
      heartKilled: heartOwnerIfDead(pieceA, pieceB, true, true),
    };
  }

  // --- 2) 渊爆：任一方携带则双方同归于尽（优先于渊甲与普通结算） ---
  const blastA = triggerId(pieceA) === 'blast';
  const blastB = triggerId(pieceB) === 'blast';
  if (blastA || blastB) {
    if (blastA) triggerActivated.a = 'blast';
    if (blastB) triggerActivated.b = 'blast';
    return {
      type: 'mutual_death',
      winner: null,
      loserA: pieceA,
      loserB: pieceB,
      isExplosion: false,
      heartsRevealed: false,
      triggerActivated,
      ...emptyDelta(),
      heartKilled: heartOwnerIfDead(pieceA, pieceB, true, true),
    };
  }

  // --- 3) 双心对撞：弹回原格，双方永久揭示 ---
  if (isHeart(pieceA) && isHeart(pieceB)) {
    return {
      type: 'bounce',
      winner: null,
      loserA: null,
      loserB: null,
      isExplosion: false,
      heartsRevealed: true,
      triggerActivated,
      ...emptyDelta(),
      heartKilled: null,
    };
  }

  // --- 4) 普通 combat / 心 的阶位与体积结算 ---
  const ra = pieceA.currentRank;
  const rb = pieceB.currentRank;
  const ba = pieceA.bodySize;
  const bb = pieceB.bodySize;

  /** @type {import('./types.js').PieceShape|null} */
  let winner = null;
  /** @type {import('./types.js').PieceShape|null} */
  let loser = null;
  /** @type {number} */
  let rankDelta = -1;
  /** @type {number} */
  let bodyDelta = 0;

  if (ra !== rb) {
    // 不同阶：高阶胜；胜方体积 +1，阶位 -1（最低 1）
    if (ra > rb) {
      winner = pieceA;
      loser = pieceB;
    } else {
      winner = pieceB;
      loser = pieceA;
    }
    bodyDelta = 1;
  } else {
    // 同阶：比体积；大者胜，胜方新体积 = 体积差；胜方阶位 -1（最低 1）；体积相同则双亡
    if (ba === bb) {
      return {
        type: 'mutual_death',
        winner: null,
        loserA: pieceA,
        loserB: pieceB,
        isExplosion: false,
        heartsRevealed: false,
        triggerActivated,
        ...emptyDelta(),
        heartKilled: heartOwnerIfDead(pieceA, pieceB, true, true),
      };
    }
    if (ba > bb) {
      winner = pieceA;
      loser = pieceB;
      bodyDelta = (ba - bb) - ba; // SET to difference: bodySize + delta = difference
    } else {
      winner = pieceB;
      loser = pieceA;
      bodyDelta = (bb - ba) - bb;
    }
    rankDelta = -1;
  }

  // --- 5) 渊甲：若败方携带，则在应用伤害前取消整次碰撞（双方回位，不扣阶不加体积） ---
  const loserIsA = loser === pieceA;
  const shieldLoser = loserIsA ? triggerId(pieceA) === 'shield' : triggerId(pieceB) === 'shield';
  if (shieldLoser) {
    if (loserIsA) triggerActivated.a = 'shield';
    else triggerActivated.b = 'shield';
    return {
      type: 'cancelled',
      winner: null,
      loserA: null,
      loserB: null,
      isExplosion: false,
      heartsRevealed: false,
      triggerActivated,
      ...emptyDelta(),
      heartKilled: null,
    };
  }

  // --- 6) 渊刃：胜方不扣阶（rankDelta 记为 0），体积变化仍适用 ---
  const winnerIsA = winner === pieceA;
  const bladeWinner = winnerIsA ? triggerId(pieceA) === 'blade' : triggerId(pieceB) === 'blade';
  if (bladeWinner) {
    if (winnerIsA) triggerActivated.a = 'blade';
    else triggerActivated.b = 'blade';
    rankDelta = 0;
  }

  return {
    type: 'win',
    winner,
    loserA: loserIsA ? pieceA : null,
    loserB: loserIsA ? null : pieceB,
    isExplosion: false,
    heartsRevealed: false,
    triggerActivated,
    rankChange: { winner: rankDelta },
    bodyChange: { winner: bodyDelta },
    heartKilled: isHeart(loser) ? loser.owner : null,
  };
}

/**
 * @param {import('./types.js').PieceShape} a
 * @param {import('./types.js').PieceShape} b
 * @param {boolean} aDies
 * @param {boolean} bDies
 * @returns {null|import('./types.js').PlayerId}
 */
function heartOwnerIfDead(a, b, aDies, bDies) {
  if (aDies && isHeart(a)) return a.owner;
  if (bDies && isHeart(b)) return b.owner;
  return null;
}

/**
 * Apply `resolveCollision` outcome by mutating the two piece references.
 *
 * @param {ReturnType<typeof resolveCollision>} result
 * @param {import('./types.js').PieceShape} pieceA
 * @param {import('./types.js').PieceShape} pieceB
 */
export function applyCollisionResult(result, pieceA, pieceB) {
  const { type, triggerActivated } = result;

  if (triggerActivated.a) pieceA.triggerCard = null;
  if (triggerActivated.b) pieceB.triggerCard = null;

  if (type === 'bounce') {
    if (isHeart(pieceA)) pieceA.revealed = true;
    if (isHeart(pieceB)) pieceB.revealed = true;
    return;
  }

  if (type === 'cancelled') {
    return;
  }

  if (type === 'mutual_death') {
    pieceA.alive = false;
    pieceB.alive = false;
    return;
  }

  if (type === 'win' && result.winner) {
    const w = result.winner;
    const dr = result.rankChange.winner;
    const db = result.bodyChange.winner;
    w.currentRank = Math.max(1, w.currentRank + dr);
    w.bodySize = Math.min(3, Math.max(1, w.bodySize + db));

    if (result.loserA) result.loserA.alive = false;
    if (result.loserB) result.loserB.alive = false;
  }
}

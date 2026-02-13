import express from 'express';
import http from 'http';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { JSONFilePreset } from 'lowdb/node';
import { nanoid } from 'nanoid';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const JWT_SECRET = process.env.JWT_SECRET || 'blackjack-battle-dev-secret';
const STARTING_CHIPS = 1000;
const BASE_BET = 5;
const MIN_BET = 5;
const MAX_BET_CAP = 500;
const DAILY_REWARD = 100;
const DISCONNECT_TIMEOUT_MS = 60_000;
const BOT_BET_CONFIRM_MIN_MS = 200;
const BOT_BET_CONFIRM_MAX_MS = 600;

const db = await JSONFilePreset(path.join(__dirname, 'data.json'), {
  users: [],
  lobbies: [],
  friendInvites: []
});

let dbTouched = false;
for (const user of db.data.users) {
  if (user.lastFreeClaimAt === undefined) {
    user.lastFreeClaimAt = null;
    dbTouched = true;
  }
  if (user.selectedBet === undefined) {
    user.selectedBet = BASE_BET;
    dbTouched = true;
  }
}
if (dbTouched) await db.write();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const activeSessions = new Map();
const matches = new Map();
const lobbyToMatch = new Map();
const disconnectTimers = new Map();
const botTurnTimers = new Map();
const botBetConfirmTimers = new Map();

const challengeCatalog = [
  { id: 'win_3_hands', title: 'Win 3 hands', target: 3, reward: 120 },
  { id: 'win_with_split', title: 'Win with a split hand', target: 1, reward: 160 },
  { id: 'play_5_rounds', title: 'Play 5 rounds', target: 5, reward: 90 }
];

const BOT_ACCURACY = {
  easy: 0.5,
  medium: 0.72,
  normal: 0.9
};

const PHASES = {
  LOBBY: 'LOBBY',
  ROUND_INIT: 'ROUND_INIT',
  ACTION_TURN: 'ACTION_TURN',
  PRESSURE_RESPONSE: 'PRESSURE_RESPONSE',
  HAND_ADVANCE: 'HAND_ADVANCE',
  ROUND_RESOLVE: 'ROUND_RESOLVE',
  NEXT_ROUND: 'NEXT_ROUND'
};

const RULES = {
  DEALER_ENABLED: false,
  BLACKJACK_PAYOUT_MULTIPLIER: 1,
  NATURAL_BLACKJACK_BEATS_NON_BLACKJACK_21: true,
  PUSH_ON_EQUAL_TOTAL: true,
  BOTH_BUST_IS_PUSH: true,
  SURRENDER_LOSS_FRACTION: 0.75,
  MAX_SPLITS: 3,
  ALL_IN_ON_INSUFFICIENT_BASE_BET: true
};

function clampBet(amount, balance = MAX_BET_CAP) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return BASE_BET;
  const bounded = Math.max(MIN_BET, Math.min(MAX_BET_CAP, Math.floor(numeric)));
  return Math.min(bounded, Math.max(0, Math.floor(balance)));
}

function isBotPlayer(playerId) {
  return typeof playerId === 'string' && playerId.startsWith('bot:');
}

function buildParticipants(playerIds, botDifficultyById = {}) {
  return playerIds.reduce((acc, playerId) => {
    if (isBotPlayer(playerId)) {
      const difficulty = botDifficultyById[playerId] || 'normal';
      acc[playerId] = {
        id: playerId,
        username: `Bot (${difficulty})`,
        isBot: true,
        difficulty
      };
      return acc;
    }

    const user = getUserById(playerId);
    acc[playerId] = {
      id: playerId,
      username: user?.username || 'Unknown',
      isBot: false
    };
    return acc;
  }, {});
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    bio: user.bio,
    chips: user.chips,
    stats: user.stats,
    selectedBet: user.selectedBet || BASE_BET,
    hasClaimedFree100: Boolean(user.lastFreeClaimAt)
  };
}

function createChallengeState() {
  const state = {};
  for (const c of challengeCatalog) {
    state[c.id] = { progress: 0, claimed: false };
  }
  return state;
}

function getUserById(id) {
  return db.data.users.find((u) => u.id === id);
}

function getUserByUsername(username) {
  return db.data.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
}

function getFriendList(user) {
  return user.friends
    .map((id) => getUserById(id))
    .filter(Boolean)
    .map((friend) => sanitizeUser(friend));
}

function getParticipantChips(match, playerId) {
  if (isBotPlayer(playerId)) {
    return match.bot?.chipsById?.[playerId] ?? STARTING_CHIPS;
  }
  return getUserById(playerId)?.chips ?? STARTING_CHIPS;
}

function setParticipantChips(match, playerId, chips) {
  const safe = Math.max(0, Math.floor(chips));
  if (isBotPlayer(playerId)) {
    if (!match.bot) match.bot = { difficultyById: {}, chipsById: {} };
    if (!match.bot.chipsById) match.bot.chipsById = {};
    match.bot.chipsById[playerId] = safe;
    return;
  }
  const user = getUserById(playerId);
  if (user) user.chips = safe;
}

function canAffordIncrement(match, playerId, amount) {
  return getParticipantChips(match, playerId) >= amount;
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: 'Invalid user' });
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function issueToken(user) {
  return jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function cardValue(card) {
  if (card.rank === 'A') return 11;
  if (['K', 'Q', 'J'].includes(card.rank)) return 10;
  return Number(card.rank);
}

function handTotal(cards) {
  let total = cards.reduce((sum, card) => sum + cardValue(card), 0);
  let aces = cards.filter((c) => c.rank === 'A').length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function handMeta(cards) {
  const raw = cards.reduce((sum, card) => sum + cardValue(card), 0);
  let total = raw;
  let aces = cards.filter((c) => c.rank === 'A').length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return {
    total,
    isSoft: cards.some((c) => c.rank === 'A') && total <= 21 && raw === total,
    isBust: total > 21,
    isNaturalBlackjack: cards.length === 2 && total === 21
  };
}

function buildDeck() {
  const suits = ['H', 'D', 'C', 'S'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ rank, suit, id: nanoid(6) });
    }
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function drawCard(round) {
  return round.deck.pop();
}

function newHand(cards, hidden, bet = BASE_BET, splitDepth = 0) {
  return {
    cards,
    hidden,
    bet,
    splitDepth,
    stood: false,
    locked: false,
    surrendered: false,
    bust: false,
    doubled: false,
    wasSplitHand: splitDepth > 0
  };
}

function currentHand(playerRoundState) {
  return playerRoundState.hands[playerRoundState.activeHandIndex] || null;
}

function advanceToNextPlayableHand(playerRoundState) {
  for (let i = 0; i < playerRoundState.hands.length; i += 1) {
    const hand = playerRoundState.hands[i];
    if (!hand.locked && !hand.surrendered && !hand.bust && !hand.stood) {
      playerRoundState.activeHandIndex = i;
      return true;
    }
  }
  return false;
}

function hasPlayableHand(playerRoundState) {
  return playerRoundState.hands.some((hand) => !hand.locked && !hand.surrendered && !hand.bust && !hand.stood);
}

function nextPlayerId(match, fromPlayerId) {
  const ids = match.playerIds;
  if (!fromPlayerId) return ids[match.startingPlayerIndex % 2];
  const idx = ids.indexOf(fromPlayerId);
  const alt = ids[(idx + 1) % 2];
  return alt;
}

function serializeMatchFor(match, viewerId) {
  const round = match.round;
  const players = {};
  const revealAllTotals = match.phase === PHASES.ROUND_RESOLVE || match.phase === PHASES.NEXT_ROUND;
  for (const pid of match.playerIds) {
    const state = round.players[pid];
    players[pid] = {
      activeHandIndex: state.activeHandIndex,
      bankroll: getParticipantChips(match, pid),
      hands: state.hands.map((hand) => {
        const hasHiddenToViewer = pid !== viewerId && hand.hidden.some(Boolean) && !revealAllTotals;
        const visibleCards = hand.cards.filter((_, idx) => !(pid !== viewerId && hand.hidden[idx]));
        const visibleMeta = visibleCards.length ? handMeta(visibleCards) : { total: null, isSoft: false };
        const fullMeta = handMeta(hand.cards);
        return {
          bet: hand.bet,
          stood: hand.stood,
          locked: hand.locked,
          surrendered: hand.surrendered,
          bust: hand.bust,
          doubled: hand.doubled,
          splitDepth: hand.splitDepth,
          totalKnown: !hasHiddenToViewer,
          visibleTotal: visibleMeta.total,
          total: hasHiddenToViewer ? null : fullMeta.total,
          isSoft: hasHiddenToViewer ? visibleMeta.isSoft : fullMeta.isSoft,
          outcome: hand.outcome || null,
          cards: hand.cards.map((card, idx) => {
            const hiddenToViewer = pid !== viewerId && hand.hidden[idx] && !revealAllTotals;
            if (hiddenToViewer) return { hidden: true };
            return { rank: card.rank, suit: card.suit };
          })
        };
      })
    };
  }
  return {
    id: match.id,
    lobbyId: match.lobbyId,
    participants: match.participants,
    roundNumber: match.roundNumber,
    phase: match.phase,
    playerIds: match.playerIds,
    currentTurn: round.turnPlayerId,
    pendingPressure: round.pendingPressure,
    baseBet: round.baseBet,
    betLocked: Boolean(round.firstActionTaken),
    selectedBet: match.betSettings?.selectedBetById?.[viewerId] || BASE_BET,
    canEditBet:
      match.phase === PHASES.ROUND_INIT &&
      viewerId === match.betControllerId &&
      !round.betConfirmedByPlayer?.[viewerId],
    canConfirmBet: match.phase === PHASES.ROUND_INIT && !round.betConfirmedByPlayer?.[viewerId],
    betConfirmedByPlayer: round.betConfirmedByPlayer,
    minBet: MIN_BET,
    maxBetCap: MAX_BET_CAP,
    betControllerId: match.betControllerId,
    postedBetByPlayer: round.postedBetByPlayer,
    allInPlayers: round.allInPlayers,
    firstActionPlayerId: round.firstActionPlayerId,
    players,
    disconnects: match.playerIds.reduce((acc, pid) => {
      acc[pid] = {
        connected: Boolean(match.connections[pid]?.connected),
        graceEndsAt: match.connections[pid]?.graceEndsAt || null
      };
      return acc;
    }, {})
  };
}

function pushMatchState(match) {
  for (const pid of match.playerIds) {
    const socketId = activeSessions.get(pid);
    if (!socketId) continue;
    io.to(socketId).emit('match:state', serializeMatchFor(match, pid));
  }
}

function addChallengeProgress(user, id, amount) {
  if (!user.challenges[id]) return;
  const target = challengeCatalog.find((c) => c.id === id)?.target || 0;
  user.challenges[id].progress = Math.min(target, user.challenges[id].progress + amount);
}

function startRound(match) {
  const [p1, p2] = match.playerIds;
  const controllerId = match.betControllerId || p1;
  const controllerBalance = getParticipantChips(match, controllerId);
  const desiredBase = match.betSettings?.selectedBetById?.[controllerId] || BASE_BET;
  const proposedBase = clampBet(desiredBase, controllerBalance || MIN_BET);
  const baseBet = Math.max(1, proposedBase || MIN_BET);

  match.round = {
    deck: [],
    baseBet,
    firstActionTaken: false,
    postedBetByPlayer: {
      [p1]: 0,
      [p2]: 0
    },
    allInPlayers: {
      [p1]: false,
      [p2]: false
    },
    betConfirmedByPlayer: {
      [p1]: false,
      [p2]: false
    },
    pendingPressure: null,
    firstActionPlayerId: null,
    turnPlayerId: null,
    players: {
      [p1]: {
        activeHandIndex: 0,
        hands: []
      },
      [p2]: {
        activeHandIndex: 0,
        hands: []
      }
    }
  };
  match.phase = PHASES.ROUND_INIT;
  match.roundNumber += 1;

  const u1 = getUserById(p1);
  const u2 = getUserById(p2);
  if (u1) addChallengeProgress(u1, 'play_5_rounds', 1);
  if (u2) addChallengeProgress(u2, 'play_5_rounds', 1);

  pushMatchState(match);
  scheduleBotBetConfirm(match);
  scheduleBotTurn(match);
}

function beginActionPhase(match) {
  const [p1, p2] = match.playerIds;
  const baseBet = Math.max(1, match.round.baseBet || BASE_BET);
  const postedP1 = Math.min(baseBet, Math.max(0, getParticipantChips(match, p1)));
  const postedP2 = Math.min(baseBet, Math.max(0, getParticipantChips(match, p2)));
  const deck = buildDeck();
  const p1Cards = [drawCard({ deck }), drawCard({ deck })];
  const p2Cards = [drawCard({ deck }), drawCard({ deck })];

  match.round.deck = deck;
  match.round.postedBetByPlayer[p1] = postedP1;
  match.round.postedBetByPlayer[p2] = postedP2;
  match.round.allInPlayers[p1] = postedP1 < baseBet;
  match.round.allInPlayers[p2] = postedP2 < baseBet;
  match.round.firstActionPlayerId = match.playerIds[match.startingPlayerIndex % 2];
  match.round.turnPlayerId = match.playerIds[match.startingPlayerIndex % 2];
  match.round.players[p1] = {
    activeHandIndex: 0,
    hands: [newHand(p1Cards, [false, true], postedP1, 0)]
  };
  match.round.players[p2] = {
    activeHandIndex: 0,
    hands: [newHand(p2Cards, [false, true], postedP2, 0)]
  };
  match.phase = PHASES.ACTION_TURN;
}

function maybeBeginRoundAfterBetConfirm(match) {
  const confirmed = match.playerIds.every((pid) => match.round.betConfirmedByPlayer[pid]);
  if (!confirmed) return;
  beginActionPhase(match);
  pushMatchState(match);
  scheduleBotTurn(match);
}

function resolveRound(match) {
  match.phase = PHASES.ROUND_RESOLVE;
  const [aId, bId] = match.playerIds;
  const a = match.round.players[aId];
  const b = match.round.players[bId];
  const userA = getUserById(aId);
  const userB = getUserById(bId);
  const chipsDelta = {
    [aId]: 0,
    [bId]: 0
  };

  const outcomes = [];

  function compareHands(handA, handB) {
    if (handA.surrendered && handB.surrendered) return 0;
    if (handA.surrendered) return -1;
    if (handB.surrendered) return 1;
    if (handA.bust && handB.bust) return RULES.BOTH_BUST_IS_PUSH ? 0 : -1;
    if (handA.bust) return -1;
    if (handB.bust) return 1;

    const metaA = handMeta(handA.cards);
    const metaB = handMeta(handB.cards);

    if (RULES.NATURAL_BLACKJACK_BEATS_NON_BLACKJACK_21) {
      if (metaA.isNaturalBlackjack && !metaB.isNaturalBlackjack && metaA.total === 21 && metaB.total === 21) return 1;
      if (metaB.isNaturalBlackjack && !metaA.isNaturalBlackjack && metaA.total === 21 && metaB.total === 21) return -1;
    }

    if (metaA.total > metaB.total) return 1;
    if (metaA.total < metaB.total) return -1;
    return RULES.PUSH_ON_EQUAL_TOTAL ? 0 : 1;
  }

  const bBase = b.hands[0];
  for (let idx = 0; idx < a.hands.length; idx += 1) {
    const handA = a.hands[idx];
    const handB = bBase;

    if (handA.surrendered) {
      const amount = Math.floor(handA.bet * RULES.SURRENDER_LOSS_FRACTION);
      chipsDelta[aId] -= amount;
      chipsDelta[bId] += amount;
      handA.outcome = 'loss';
      handB.outcome = handB.outcome || 'win';
      outcomes.push({ winner: bId, loser: aId, amount, handIndex: idx });
    } else if (handB.surrendered) {
      const amount = Math.floor(handB.bet * RULES.SURRENDER_LOSS_FRACTION);
      chipsDelta[aId] += amount;
      chipsDelta[bId] -= amount;
      handA.outcome = 'win';
      handB.outcome = 'loss';
      outcomes.push({ winner: aId, loser: bId, amount, handIndex: idx });
    } else {
      const result = compareHands(handA, handB);
      const pot = Math.min(handA.bet, handB.bet);
      if (result > 0) {
        chipsDelta[aId] += pot;
        chipsDelta[bId] -= pot;
        handA.outcome = 'win';
        handB.outcome = handB.outcome || 'loss';
        outcomes.push({ winner: aId, loser: bId, amount: pot, splitWin: handA.wasSplitHand, handIndex: idx });
      } else if (result < 0) {
        chipsDelta[aId] -= pot;
        chipsDelta[bId] += pot;
        handA.outcome = 'loss';
        handB.outcome = handB.outcome || 'win';
        outcomes.push({ winner: bId, loser: aId, amount: pot, handIndex: idx });
      } else {
        handA.outcome = 'push';
        if (!handB.outcome) handB.outcome = 'push';
        outcomes.push({ winner: null, loser: null, amount: 0, handIndex: idx });
      }
    }
  }

  setParticipantChips(match, aId, getParticipantChips(match, aId) + chipsDelta[aId]);
  setParticipantChips(match, bId, getParticipantChips(match, bId) + chipsDelta[bId]);

  function applyHandOutcomeStats(user, ownId, out) {
    if (!user) return;
    if (out.winner === ownId) {
      user.stats.handsWon += 1;
      addChallengeProgress(user, 'win_3_hands', 1);
      if (out.splitWin) addChallengeProgress(user, 'win_with_split', 1);
    } else if (out.loser === ownId) {
      user.stats.handsLost += 1;
    } else {
      user.stats.handsPush += 1;
    }
  }

  for (const out of outcomes) {
    applyHandOutcomeStats(userA, aId, out);
    applyHandOutcomeStats(userB, bId, out);
  }

  const netA = chipsDelta[aId];

  if (netA > 0) {
    if (userA) userA.stats.roundsWon += 1;
    if (userB) userB.stats.roundsLost += 1;
  } else if (netA < 0) {
    if (userB) userB.stats.roundsWon += 1;
    if (userA) userA.stats.roundsLost += 1;
  }

  if (userA) userA.stats.matchesPlayed += 1;
  if (userB) userB.stats.matchesPlayed += 1;

  db.write();

  match.phase = PHASES.NEXT_ROUND;
  pushMatchState(match);

  setTimeout(() => {
    match.startingPlayerIndex = (match.startingPlayerIndex + 1) % 2;
    startRound(match);
  }, 3500);
}

function maybeEndRound(match) {
  const anyPlayable = match.playerIds.some((pid) => hasPlayableHand(match.round.players[pid]));
  if (!anyPlayable && !match.round.pendingPressure) {
    resolveRound(match);
  }
}

function progressTurn(match, actingPlayerId) {
  match.phase = PHASES.HAND_ADVANCE;
  const other = nextPlayerId(match, actingPlayerId);
  const ownState = match.round.players[actingPlayerId];
  const otherState = match.round.players[other];
  advanceToNextPlayableHand(ownState);

  if (hasPlayableHand(otherState)) {
    advanceToNextPlayableHand(otherState);
    match.round.turnPlayerId = other;
    match.phase = PHASES.ACTION_TURN;
  } else if (hasPlayableHand(ownState)) {
    match.round.turnPlayerId = actingPlayerId;
    match.phase = PHASES.ACTION_TURN;
  }

  maybeEndRound(match);
}

function canSplit(hand) {
  if (!hand) return false;
  if (hand.cards.length !== 2) return false;
  if (hand.splitDepth >= RULES.MAX_SPLITS) return false;
  return hand.cards[0].rank === hand.cards[1].rank;
}

function visibleTotal(cards, hiddenFlags) {
  const visibleCards = cards.filter((_, idx) => !hiddenFlags[idx]);
  return handTotal(visibleCards);
}

function legalActionsForHand(hand) {
  if (!hand || hand.locked || hand.stood || hand.bust || hand.surrendered) return [];
  const actions = ['hit', 'stand', 'surrender'];
  if (!hand.doubled) actions.push('double');
  if (canSplit(hand)) actions.push('split');
  return actions;
}

function getBotDifficulty(match, botId) {
  return match.bot?.difficultyById?.[botId] || 'normal';
}

function chooseBotAction(match, botId) {
  const botState = match.round.players[botId];
  const hand = currentHand(botState);
  if (!hand) return 'stand';

  const legal = legalActionsForHand(hand);
  if (!legal.length) return 'stand';

  const opponentId = nextPlayerId(match, botId);
  const opponentState = match.round.players[opponentId];
  const opponentHand = currentHand(opponentState) || opponentState.hands[0];
  const opponentUpCardTotal = opponentHand ? visibleTotal(opponentHand.cards, opponentHand.hidden) : 10;
  const total = handTotal(hand.cards);

  let ideal = 'stand';
  if (canSplit(hand) && ['A', '8'].includes(hand.cards[0].rank)) {
    ideal = 'split';
  } else if (!hand.doubled && hand.cards.length === 2 && (total === 11 || (total === 10 && opponentUpCardTotal <= 9))) {
    ideal = 'double';
  } else if (total <= 11) {
    ideal = 'hit';
  } else if (total >= 17) {
    ideal = 'stand';
  } else if (total === 16 && opponentUpCardTotal >= 10) {
    ideal = 'surrender';
  } else if (total >= 13 && total <= 16) {
    ideal = opponentUpCardTotal >= 7 ? 'hit' : 'stand';
  } else if (total === 12) {
    ideal = opponentUpCardTotal >= 7 || opponentUpCardTotal <= 3 ? 'hit' : 'stand';
  } else {
    ideal = 'hit';
  }

  if (!legal.includes(ideal)) ideal = legal[0];

  const difficulty = getBotDifficulty(match, botId);
  const accuracy = BOT_ACCURACY[difficulty] || BOT_ACCURACY.normal;
  if (Math.random() <= accuracy) return ideal;

  const alternatives = legal.filter((a) => a !== ideal);
  if (!alternatives.length) return ideal;
  return alternatives[Math.floor(Math.random() * alternatives.length)];
}

function chooseBotPressureDecision(match, botId) {
  const pressure = match.round.pendingPressure;
  if (!pressure) return 'surrender';
  const botState = match.round.players[botId];
  const firstIndex = (pressure.affectedHandIndices && pressure.affectedHandIndices[0]) || 0;
  const hand = botState.hands[firstIndex] || botState.hands[0];
  if (!hand || hand.bust || hand.surrendered) return 'surrender';

  const difficulty = getBotDifficulty(match, botId);
  const base = difficulty === 'easy' ? 0.45 : difficulty === 'medium' ? 0.65 : 0.83;
  const total = handTotal(hand.cards);
  let chance = base;
  if (total >= 17) chance += 0.1;
  if (total <= 12) chance -= 0.15;
  if (pressure.delta >= 10) chance -= 0.05;
  chance = Math.max(0.1, Math.min(0.95, chance));
  const required = pressure.delta * ((pressure.affectedHandIndices && pressure.affectedHandIndices.length) || 1);
  if (!canAffordIncrement(match, botId, required)) return 'surrender';
  return Math.random() < chance ? 'match' : 'surrender';
}

function scheduleBotBetConfirm(match) {
  const botId = match.playerIds.find((id) => isBotPlayer(id));
  if (!botId) return;
  if (match.phase !== PHASES.ROUND_INIT) return;
  if (match.round.betConfirmedByPlayer?.[botId]) return;

  const key = `${match.id}:bet`;
  const existing = botBetConfirmTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    botBetConfirmTimers.delete(key);
  }

  const delay = BOT_BET_CONFIRM_MIN_MS + Math.floor(Math.random() * (BOT_BET_CONFIRM_MAX_MS - BOT_BET_CONFIRM_MIN_MS + 1));
  const timer = setTimeout(() => {
    if (!matches.has(match.id)) return;
    if (match.phase !== PHASES.ROUND_INIT) return;
    const controllerId = match.betControllerId || match.playerIds[0];
    const desired = match.betSettings?.selectedBetById?.[controllerId] || match.round.baseBet || BASE_BET;
    if (!match.betSettings) match.betSettings = { selectedBetById: {} };
    match.betSettings.selectedBetById[botId] = desired;
    match.round.betConfirmedByPlayer[botId] = true;
    pushMatchState(match);
    maybeBeginRoundAfterBetConfirm(match);
    botBetConfirmTimers.delete(key);
  }, delay);

  botBetConfirmTimers.set(key, timer);
}

function scheduleBotTurn(match) {
  const botId = match.playerIds.find((id) => isBotPlayer(id));
  if (!botId) return;

  const existing = botTurnTimers.get(match.id);
  if (existing) {
    clearTimeout(existing);
    botTurnTimers.delete(match.id);
  }

  const timer = setTimeout(() => {
    if (!matches.has(match.id)) return;

    if (
      match.phase === PHASES.PRESSURE_RESPONSE &&
      match.round.pendingPressure &&
      isBotPlayer(match.round.pendingPressure.opponentId)
    ) {
      const decision = chooseBotPressureDecision(match, botId);
      const result = applyPressureDecision(match, botId, decision);
      if (!result.error) {
        pushMatchState(match);
        db.write();
        scheduleBotTurn(match);
      }
      return;
    }

    if (match.phase !== PHASES.ACTION_TURN) return;
    if (match.round.pendingPressure) return;
    if (match.round.turnPlayerId !== botId) return;

    const action = chooseBotAction(match, botId);
    const result = applyAction(match, botId, action);
    if (result.error) {
      const fallback = applyAction(match, botId, 'stand');
      if (fallback.error) return;
    }

    pushMatchState(match);
    db.write();
    scheduleBotTurn(match);
  }, 650);

  botTurnTimers.set(match.id, timer);
}

function applyAction(match, playerId, action) {
  if (match.phase !== PHASES.ACTION_TURN) return { error: 'Round not in action phase' };
  if (match.round.turnPlayerId !== playerId) return { error: 'Not your turn' };
  if (match.round.pendingPressure) return { error: 'Pending pressure decision' };

  const state = match.round.players[playerId];
  const hand = currentHand(state);
  if (!hand) return { error: 'No active hand' };

  const opponentId = nextPlayerId(match, playerId);
  const opponentState = match.round.players[opponentId];

  if (action === 'hit') {
    match.round.firstActionTaken = true;
    hand.cards.push(drawCard(match.round));
    hand.hidden.push(false);
    const total = handTotal(hand.cards);
    if (total > 21) {
      hand.bust = true;
      hand.locked = true;
    }
    progressTurn(match, playerId);
    return { ok: true };
  }

  if (action === 'stand') {
    match.round.firstActionTaken = true;
    hand.stood = true;
    hand.locked = true;
    progressTurn(match, playerId);
    return { ok: true };
  }

  if (action === 'surrender') {
    match.round.firstActionTaken = true;
    hand.surrendered = true;
    hand.locked = true;
    progressTurn(match, playerId);
    return { ok: true };
  }

  if (action === 'double') {
    if (hand.locked || hand.doubled) return { error: 'Hand cannot double down' };
    match.round.firstActionTaken = true;
    const delta = hand.bet;
    if (!canAffordIncrement(match, playerId, delta)) return { error: 'Insufficient chips to double' };
    hand.bet *= 2;
    hand.doubled = true;
    hand.cards.push(drawCard(match.round));
    hand.hidden.push(false);
    if (handTotal(hand.cards) > 21) {
      hand.bust = true;
    }
    hand.locked = true;

    const targetHandIndex = Math.min(opponentState.activeHandIndex, opponentState.hands.length - 1);
    match.round.pendingPressure = {
      initiatorId: playerId,
      opponentId,
      type: 'double',
      delta,
      affectedHandIndices: [targetHandIndex]
    };
    match.phase = PHASES.PRESSURE_RESPONSE;
    return { ok: true };
  }

  if (action === 'split') {
    if (!canSplit(hand)) return { error: 'Split unavailable' };
    if (!canAffordIncrement(match, playerId, hand.bet)) return { error: 'Insufficient chips to split' };
    match.round.firstActionTaken = true;
    const [c1, c2] = hand.cards;
    const nextDepth = hand.splitDepth + 1;
    const newOne = newHand([c1, drawCard(match.round)], [false, true], hand.bet, nextDepth);
    const newTwo = newHand([c2, drawCard(match.round)], [false, true], hand.bet, nextDepth);
    newOne.wasSplitHand = true;
    newTwo.wasSplitHand = true;

    const idx = state.activeHandIndex;
    state.hands.splice(idx, 1, newOne, newTwo);
    state.activeHandIndex = idx;

    const delta = hand.bet;
    const targetHandIndex = Math.min(opponentState.activeHandIndex, opponentState.hands.length - 1);
    match.round.pendingPressure = {
      initiatorId: playerId,
      opponentId,
      type: 'split',
      delta,
      affectedHandIndices: [targetHandIndex]
    };
    match.phase = PHASES.PRESSURE_RESPONSE;
    return { ok: true };
  }

  return { error: 'Unknown action' };
}

function applyPressureDecision(match, playerId, decision) {
  if (match.phase !== PHASES.PRESSURE_RESPONSE) return { error: 'No pressure decision needed' };
  const pressure = match.round.pendingPressure;
  if (!pressure) return { error: 'No pressure state' };
  if (pressure.opponentId !== playerId) return { error: 'Not your decision' };

  const opponentState = match.round.players[playerId];
  const targetIndices = pressure.affectedHandIndices || [opponentState.activeHandIndex || 0];

  if (decision === 'match') {
    const required = pressure.delta * targetIndices.length;
    if (!canAffordIncrement(match, playerId, required)) return { error: 'Insufficient chips to match pressure' };
    for (const idx of targetIndices) {
      const hand = opponentState.hands[idx] || opponentState.hands[0];
      hand.bet += pressure.delta;
    }
  } else if (decision === 'surrender') {
    for (const idx of targetIndices) {
      const hand = opponentState.hands[idx] || opponentState.hands[0];
      hand.surrendered = true;
      hand.locked = true;
    }
  } else {
    return { error: 'Invalid decision' };
  }

  match.round.pendingPressure = null;
  match.phase = PHASES.ACTION_TURN;

  progressTurn(match, pressure.initiatorId);
  return { ok: true };
}

function applyBaseBetSelection(match, playerId, amount) {
  if (!match.playerIds.includes(playerId)) return { error: 'Unauthorized' };
  if (match.phase !== PHASES.ROUND_INIT) return { error: 'Bet can only be changed before cards are dealt' };
  if (playerId !== match.betControllerId) return { error: 'Only the round owner can set base bet' };
  if (match.round.betConfirmedByPlayer?.[playerId]) return { error: 'Bet already confirmed for this round' };
  const chips = getParticipantChips(match, playerId);
  if (chips < MIN_BET) return { error: `Need at least ${MIN_BET} chips to set base bet` };
  if (Number(amount) < MIN_BET) return { error: `Bet must be at least ${MIN_BET}` };
  const selected = clampBet(amount, chips || MIN_BET);
  if (!match.betSettings) match.betSettings = { selectedBetById: {} };
  match.betSettings.selectedBetById[playerId] = selected;

  if (!isBotPlayer(playerId)) {
    const user = getUserById(playerId);
    if (user) user.selectedBet = selected;
  }

  match.round.baseBet = selected;
  scheduleBotBetConfirm(match);

  return { ok: true, selected };
}

function confirmBaseBet(match, playerId) {
  if (!match.playerIds.includes(playerId)) return { error: 'Unauthorized' };
  if (match.phase !== PHASES.ROUND_INIT) return { error: 'Bet confirmation is only available before dealing' };
  if (match.round.betConfirmedByPlayer?.[playerId]) return { ok: true };

  const selected = match.betSettings?.selectedBetById?.[match.betControllerId] || match.round.baseBet || BASE_BET;
  if (selected < MIN_BET) return { error: `Bet must be at least ${MIN_BET}` };
  if (getParticipantChips(match, match.betControllerId) < MIN_BET) return { error: 'Insufficient chips to start round' };

  match.round.baseBet = selected;
  match.round.betConfirmedByPlayer[playerId] = true;
  maybeBeginRoundAfterBetConfirm(match);
  return { ok: true };
}

function createMatch(lobby, options = {}) {
  const playerIds = [lobby.ownerId, lobby.opponentId];
  const selectedBetById = {};
  for (const pid of playerIds) {
    if (isBotPlayer(pid)) {
      selectedBetById[pid] = BASE_BET;
    } else {
      const user = getUserById(pid);
      selectedBetById[pid] = clampBet(user?.selectedBet || BASE_BET, user?.chips || STARTING_CHIPS);
    }
  }
  const match = {
    id: nanoid(10),
    lobbyId: lobby.id,
    participants: buildParticipants(playerIds, options.botDifficultyById || {}),
    playerIds,
    startingPlayerIndex: 0,
    roundNumber: 0,
    phase: PHASES.ROUND_INIT,
    round: null,
    betControllerId: lobby.ownerId,
    betSettings: { selectedBetById },
    bot: options.botDifficultyById
      ? {
          difficultyById: options.botDifficultyById,
          chipsById: Object.keys(options.botDifficultyById).reduce((acc, pid) => {
            acc[pid] = STARTING_CHIPS;
            return acc;
          }, {})
        }
      : null,
    connections: {
      [lobby.ownerId]: { connected: true, graceEndsAt: null },
      [lobby.opponentId]: { connected: true, graceEndsAt: null }
    }
  };
  matches.set(match.id, match);
  if (lobby?.id) lobbyToMatch.set(lobby.id, match.id);
  startRound(match);
  return match;
}

function emitLobbyUpdate(lobby) {
  for (const uid of [lobby.ownerId, lobby.opponentId].filter(Boolean)) {
    const socketId = activeSessions.get(uid);
    if (socketId) io.to(socketId).emit('lobby:update', lobby);
  }
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  if (username.length < 3) return res.status(400).json({ error: 'Username too short' });
  if (getUserByUsername(username)) return res.status(409).json({ error: 'Username already exists' });

  const hash = await bcrypt.hash(password, 10);
  const user = {
    id: nanoid(),
    username,
    passwordHash: hash,
    avatar: `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(username)}`,
    bio: 'Ready for Blackjack Battle.',
    chips: STARTING_CHIPS,
    stats: {
      matchesPlayed: 0,
      roundsWon: 0,
      roundsLost: 0,
      handsWon: 0,
      handsLost: 0,
      handsPush: 0
    },
    friends: [],
    challenges: createChallengeState(),
    lastDailyClaimAt: null,
    lastFreeClaimAt: null,
    selectedBet: BASE_BET
  };
  db.data.users.push(user);
  await db.write();

  return res.json({ token: issueToken(user), user: sanitizeUser(user) });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = getUserByUsername(username || '');
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  return res.json({ token: issueToken(user), user: sanitizeUser(user) });
});

app.get('/api/me', authMiddleware, (req, res) => {
  return res.json({
    user: sanitizeUser(req.user),
    friends: getFriendList(req.user),
    freeClaimed: Boolean(req.user.lastFreeClaimAt),
    challenges: challengeCatalog.map((c) => ({ ...c, ...req.user.challenges[c.id] }))
  });
});

app.put('/api/profile', authMiddleware, async (req, res) => {
  const { avatar, bio } = req.body || {};
  if (typeof avatar === 'string') req.user.avatar = avatar.slice(0, 300);
  if (typeof bio === 'string') req.user.bio = bio.slice(0, 300);
  await db.write();
  return res.json({ user: sanitizeUser(req.user) });
});

app.get('/api/friends', authMiddleware, (req, res) => {
  return res.json({ friends: getFriendList(req.user) });
});

app.post('/api/friends/add', authMiddleware, async (req, res) => {
  const { username } = req.body || {};
  const target = getUserByUsername(username || '');
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot friend yourself' });
  if (!req.user.friends.includes(target.id)) req.user.friends.push(target.id);
  if (!target.friends.includes(req.user.id)) target.friends.push(req.user.id);
  await db.write();
  return res.json({ friends: getFriendList(req.user) });
});

app.post('/api/friends/invite-link', authMiddleware, async (req, res) => {
  const code = nanoid(12);
  db.data.friendInvites.push({
    code,
    fromUserId: req.user.id,
    createdAt: nowIso(),
    usedBy: []
  });
  await db.write();

  return res.json({
    code,
    link: `${req.protocol}://${req.get('host')}/?friendInvite=${code}`
  });
});

app.post('/api/friends/invite-link/accept', authMiddleware, async (req, res) => {
  const { code } = req.body || {};
  const invite = db.data.friendInvites.find((f) => f.code === code);
  if (!invite) return res.status(404).json({ error: 'Invalid invite' });
  const inviter = getUserById(invite.fromUserId);
  if (!inviter) return res.status(404).json({ error: 'Inviter not found' });
  if (inviter.id === req.user.id) return res.status(400).json({ error: 'Cannot add yourself' });

  if (!req.user.friends.includes(inviter.id)) req.user.friends.push(inviter.id);
  if (!inviter.friends.includes(req.user.id)) inviter.friends.push(req.user.id);
  if (!invite.usedBy.includes(req.user.id)) invite.usedBy.push(req.user.id);
  await db.write();

  return res.json({ friends: getFriendList(req.user), inviter: sanitizeUser(inviter) });
});

app.post('/api/lobbies/create', authMiddleware, async (req, res) => {
  const lobby = {
    id: nanoid(8),
    ownerId: req.user.id,
    opponentId: null,
    status: 'waiting',
    createdAt: nowIso()
  };
  db.data.lobbies.push(lobby);
  await db.write();

  return res.json({
    lobby,
    link: `${req.protocol}://${req.get('host')}/?joinLobby=${lobby.id}`
  });
});

app.post('/api/lobbies/join', authMiddleware, async (req, res) => {
  const { lobbyId } = req.body || {};
  const lobby = db.data.lobbies.find((l) => l.id === lobbyId);
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
  if (lobby.ownerId === req.user.id) return res.status(400).json({ error: 'Cannot join your own lobby' });
  if (lobby.opponentId && lobby.opponentId !== req.user.id) return res.status(409).json({ error: 'Lobby full' });

  lobby.opponentId = req.user.id;
  lobby.status = 'full';
  await db.write();

  emitLobbyUpdate(lobby);

  let matchId = lobbyToMatch.get(lobby.id);
  if (!matchId) {
    const match = createMatch(lobby);
    matchId = match.id;
  }

  return res.json({ lobby, matchId });
});

app.get('/api/lobbies/:id', authMiddleware, (req, res) => {
  const lobby = db.data.lobbies.find((l) => l.id === req.params.id);
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
  const matchId = lobbyToMatch.get(lobby.id) || null;
  return res.json({ lobby, matchId });
});

async function createBotPracticeLobby(req, res) {
  const { difficulty } = req.body || {};
  if (!['easy', 'medium', 'normal'].includes(difficulty)) {
    return res.status(400).json({ error: 'Difficulty must be easy, medium, or normal' });
  }

  const botId = `bot:${difficulty}:${nanoid(6)}`;
  const lobby = {
    id: nanoid(8),
    ownerId: req.user.id,
    opponentId: botId,
    status: 'full',
    type: 'bot',
    botDifficulty: difficulty,
    createdAt: nowIso()
  };
  db.data.lobbies.push(lobby);
  await db.write();

  const match = createMatch(lobby, { botDifficultyById: { [botId]: difficulty } });
  return res.json({
    serverKey: lobby.id,
    lobby,
    matchId: match.id,
    match: serializeMatchFor(match, req.user.id)
  });
}

app.post('/api/lobbies/bot', authMiddleware, createBotPracticeLobby);
app.post('/api/matches/bot', authMiddleware, createBotPracticeLobby);

app.post('/api/free-claim', authMiddleware, async (req, res) => {
  if (req.user.lastFreeClaimAt) {
    return res.json({ reward: 0, chips: req.user.chips, claimed: true, claimedAt: req.user.lastFreeClaimAt });
  }
  req.user.lastFreeClaimAt = nowIso();
  req.user.chips += 100;
  await db.write();
  return res.json({ reward: 100, chips: req.user.chips, claimed: true, claimedAt: req.user.lastFreeClaimAt });
});

app.post('/api/daily-claim', authMiddleware, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const last = req.user.lastDailyClaimAt ? req.user.lastDailyClaimAt.slice(0, 10) : null;
  if (last === today) return res.status(409).json({ error: 'Already claimed today' });

  req.user.lastDailyClaimAt = nowIso();
  req.user.chips += DAILY_REWARD;
  await db.write();

  return res.json({ reward: DAILY_REWARD, chips: req.user.chips, claimedAt: req.user.lastDailyClaimAt });
});

app.get('/api/challenges', authMiddleware, (req, res) => {
  return res.json({
    challenges: challengeCatalog.map((c) => ({ ...c, ...req.user.challenges[c.id] }))
  });
});

app.post('/api/challenges/claim', authMiddleware, async (req, res) => {
  const { id } = req.body || {};
  const challenge = challengeCatalog.find((c) => c.id === id);
  if (!challenge) return res.status(404).json({ error: 'Challenge not found' });

  const state = req.user.challenges[id];
  if (!state) return res.status(404).json({ error: 'Challenge state missing' });
  if (state.claimed) return res.status(409).json({ error: 'Already claimed' });
  if (state.progress < challenge.target) return res.status(400).json({ error: 'Not complete' });

  state.claimed = true;
  req.user.chips += challenge.reward;
  await db.write();

  return res.json({ id, reward: challenge.reward, chips: req.user.chips });
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Missing token'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = getUserById(decoded.userId);
    if (!user) return next(new Error('Invalid user'));
    socket.user = user;
    return next();
  } catch {
    return next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  activeSessions.set(userId, socket.id);

  for (const match of matches.values()) {
    if (match.playerIds.includes(userId)) {
      match.connections[userId] = { connected: true, graceEndsAt: null };
      const timer = disconnectTimers.get(`${match.id}:${userId}`);
      if (timer) {
        clearTimeout(timer);
        disconnectTimers.delete(`${match.id}:${userId}`);
      }
      socket.emit('match:state', serializeMatchFor(match, userId));
      scheduleBotBetConfirm(match);
      scheduleBotTurn(match);
    }
  }

  socket.on('lobby:watch', (lobbyId) => {
    const lobby = db.data.lobbies.find((l) => l.id === lobbyId);
    if (!lobby) return;
    socket.emit('lobby:update', lobby);
    const matchId = lobbyToMatch.get(lobby.id);
    if (matchId) {
      const match = matches.get(matchId);
      if (match) socket.emit('match:state', serializeMatchFor(match, userId));
    }
  });

  socket.on('match:action', (payload = {}) => {
    const { matchId, action } = payload;
    const match = matches.get(matchId);
    if (!match) return socket.emit('match:error', { error: 'Match not found' });
    if (!match.playerIds.includes(userId)) return socket.emit('match:error', { error: 'Unauthorized' });

    const result = applyAction(match, userId, action);
    if (result.error) return socket.emit('match:error', result);

    pushMatchState(match);
    db.write();
    scheduleBotTurn(match);
    return null;
  });

  socket.on('match:setBaseBet', (payload = {}) => {
    const { matchId, amount } = payload;
    const match = matches.get(matchId);
    if (!match) return socket.emit('match:error', { error: 'Match not found' });
    const result = applyBaseBetSelection(match, userId, amount);
    if (result.error) return socket.emit('match:error', result);
    pushMatchState(match);
    db.write();
    scheduleBotBetConfirm(match);
    return null;
  });

  socket.on('match:confirmBet', (payload = {}) => {
    const { matchId } = payload;
    const match = matches.get(matchId);
    if (!match) return socket.emit('match:error', { error: 'Match not found' });
    const result = confirmBaseBet(match, userId);
    if (result.error) return socket.emit('match:error', result);
    pushMatchState(match);
    db.write();
    scheduleBotBetConfirm(match);
    return null;
  });

  socket.on('match:pressureDecision', (payload = {}) => {
    const { matchId, decision } = payload;
    const match = matches.get(matchId);
    if (!match) return socket.emit('match:error', { error: 'Match not found' });
    if (!match.playerIds.includes(userId)) return socket.emit('match:error', { error: 'Unauthorized' });

    const result = applyPressureDecision(match, userId, decision);
    if (result.error) return socket.emit('match:error', result);

    pushMatchState(match);
    db.write();
    scheduleBotTurn(match);
    return null;
  });

  socket.on('disconnect', () => {
    if (activeSessions.get(userId) === socket.id) activeSessions.delete(userId);

    for (const match of matches.values()) {
      if (!match.playerIds.includes(userId)) continue;
      if (isBotPlayer(userId)) continue;
      match.connections[userId] = {
        connected: false,
        graceEndsAt: new Date(Date.now() + DISCONNECT_TIMEOUT_MS).toISOString()
      };

      const key = `${match.id}:${userId}`;
      const timer = setTimeout(() => {
        const opponentId = match.playerIds.find((id) => id !== userId);
        const loser = getUserById(userId);
        const winner = getUserById(opponentId);
        if (loser && winner) {
          const penalty = Math.min(100, loser.chips);
          loser.chips -= penalty;
          winner.chips += penalty;
          winner.stats.roundsWon += 1;
          loser.stats.roundsLost += 1;
          db.write();
        }

        io.to(activeSessions.get(opponentId)).emit('match:ended', {
          reason: 'Opponent disconnected for over 60 seconds'
        });
        const botTimer = botTurnTimers.get(match.id);
        if (botTimer) {
          clearTimeout(botTimer);
          botTurnTimers.delete(match.id);
        }
        const botBetTimer = botBetConfirmTimers.get(`${match.id}:bet`);
        if (botBetTimer) {
          clearTimeout(botBetTimer);
          botBetConfirmTimers.delete(`${match.id}:bet`);
        }
        matches.delete(match.id);
        disconnectTimers.delete(key);
      }, DISCONNECT_TIMEOUT_MS);

      disconnectTimers.set(key, timer);
      pushMatchState(match);
    }
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`Blackjack Battle server running on http://${HOST}:${PORT}`);
  });
}

export {
  PHASES,
  RULES,
  buildDeck,
  handTotal,
  handMeta,
  canSplit,
  applyAction,
  applyBaseBetSelection,
  confirmBaseBet,
  applyPressureDecision,
  newHand,
  hasPlayableHand,
  advanceToNextPlayableHand,
  serializeMatchFor
};

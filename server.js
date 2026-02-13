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

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
const JWT_SECRET = process.env.JWT_SECRET || 'blackjack-battle-dev-secret';
const STARTING_CHIPS = 1000;
const BASE_BET = 5;
const MIN_BET = 5;
const MAX_BET_CAP = 500;
const DAILY_REWARD = 100;
const FREE_CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DISCONNECT_TIMEOUT_MS = 60_000;
const BOT_BET_CONFIRM_MIN_MS = 200;
const BOT_BET_CONFIRM_MAX_MS = 600;
const PATCH_NOTES_CACHE_MS = 10 * 60 * 1000;
const PATCH_REPO = 'Elicanig/1v1Blackjack';
const FRIEND_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const EMOTE_COOLDOWN_MS = 2000;

const db = await JSONFilePreset(path.join(__dirname, 'data.json'), {
  users: [],
  lobbies: [],
  friendInvites: [],
  friendRequests: []
});

let dbTouched = false;
for (const user of db.data.users) {
  if (!user.usernameKey) {
    user.usernameKey = normalizeUsername(user.username || '');
    dbTouched = true;
  }
  if (user.lastFreeClaimAt === undefined) {
    user.lastFreeClaimAt = null;
    dbTouched = true;
  }
  if (user.selectedBet === undefined) {
    user.selectedBet = BASE_BET;
    dbTouched = true;
  }
  if (!Array.isArray(user.notifications)) {
    user.notifications = [];
    dbTouched = true;
  }
  if (!user.authToken) {
    user.authToken = nanoid(36);
    dbTouched = true;
  }
  if (!user.avatarStyle) {
    user.avatarStyle = 'adventurer';
    dbTouched = true;
  }
  if (!user.avatarSeed) {
    user.avatarSeed = user.username || nanoid(6);
    dbTouched = true;
  }
  if (!user.avatar) {
    user.avatar = `https://api.dicebear.com/9.x/${encodeURIComponent(user.avatarStyle)}/svg?seed=${encodeURIComponent(user.avatarSeed)}`;
    dbTouched = true;
  }
  if (!user.pin || !user.pinHash) {
    const generatedPin = String(Math.floor(1000 + Math.random() * 9000));
    user.pin = user.pin || generatedPin;
    user.pinHash = user.pinHash || bcrypt.hashSync(user.pin, 10);
    dbTouched = true;
  }
  if (!user.stats) {
    user.stats = {};
    dbTouched = true;
  }
  if (user.stats.pushes === undefined) {
    user.stats.pushes = user.stats.handsPush || 0;
    dbTouched = true;
  }
  if (user.stats.handsPush === undefined) {
    user.stats.handsPush = user.stats.pushes || 0;
    dbTouched = true;
  }
  if (user.stats.handsPlayed === undefined) {
    user.stats.handsPlayed = 0;
    dbTouched = true;
  }
  if (user.stats.blackjacks === undefined) {
    user.stats.blackjacks = 0;
    dbTouched = true;
  }
  if (user.stats.sixSevenDealt === undefined) {
    user.stats.sixSevenDealt = 0;
    dbTouched = true;
  }
  if (!user.challengeSets) {
    user.challengeSets = {};
    dbTouched = true;
  }
}
if (!Array.isArray(db.data.friendRequests)) {
  db.data.friendRequests = [];
  dbTouched = true;
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
const emoteCooldownByUser = new Map();
let patchNotesCache = { at: 0, payload: null };

const LOCAL_PATCH_NOTES = [
  {
    date: '2026-02-13',
    title: 'Gameplay and polish updates',
    bullets: [
      'Instant round-end handling for bust and naturals.',
      'Improved notifications overlay and profile PIN controls.'
    ],
    body: 'Instant round-end handling for bust and naturals.\nImproved notifications overlay and profile PIN controls.'
  },
  {
    date: '2026-02-12',
    title: 'Practice and split flow updates',
    bullets: [
      'Practice bot mode no longer affects real chips/stats.',
      'Split flow now stays on the same player until all split hands are completed.'
    ],
    body: 'Practice bot mode no longer affects real chips/stats.\nSplit flow now stays on the same player until all split hands are completed.'
  },
  {
    date: '2026-02-11',
    title: 'Security and progression improvements',
    bullets: [
      'Per-view hand sanitization prevents hidden-card leakage.',
      'Challenge tiers and rewards are persisted server-side.'
    ],
    body: 'Per-view hand sanitization prevents hidden-card leakage.\nChallenge tiers and rewards are persisted server-side.'
  }
];

const CHALLENGE_COUNTS = { hourly: 3, daily: 7, weekly: 5 };
const CHALLENGE_POOLS = {
  hourly: [
    { key: 'hourly_hands_played_6', title: 'Hot Streak Warmup', description: 'Play 6 hands', goal: 6, rewardChips: 12, event: 'hand_played' },
    { key: 'hourly_hands_won_3', title: 'Quick Closer', description: 'Win 3 hands', goal: 3, rewardChips: 20, event: 'hand_won' },
    { key: 'hourly_pushes_2', title: 'Even Odds', description: 'Get 2 pushes', goal: 2, rewardChips: 16, event: 'push' },
    { key: 'hourly_blackjack_1', title: 'Natural Edge', description: 'Hit 1 natural blackjack', goal: 1, rewardChips: 25, event: 'blackjack' },
    { key: 'hourly_rounds_2', title: 'Table Presence', description: 'Play 2 rounds', goal: 2, rewardChips: 10, event: 'round_played' }
  ],
  daily: [
    { key: 'daily_hands_played_20', title: 'Daily Grinder', description: 'Play 20 hands', goal: 20, rewardChips: 70, event: 'hand_played' },
    { key: 'daily_hands_won_10', title: 'Ten Up', description: 'Win 10 hands', goal: 10, rewardChips: 110, event: 'hand_won' },
    { key: 'daily_pushes_6', title: 'Knife Edge', description: 'Get 6 pushes', goal: 6, rewardChips: 80, event: 'push' },
    { key: 'daily_blackjack_3', title: 'Triple Natural', description: 'Hit 3 natural blackjacks', goal: 3, rewardChips: 130, event: 'blackjack' },
    { key: 'daily_rounds_8', title: 'Session Pro', description: 'Play 8 rounds', goal: 8, rewardChips: 60, event: 'round_played' },
    { key: 'daily_split_win_2', title: 'Split Specialist', description: 'Win 2 split hands', goal: 2, rewardChips: 95, event: 'split_win' },
    { key: 'daily_hands_lost_8', title: 'Learn and Adapt', description: 'Complete 8 losing hands', goal: 8, rewardChips: 55, event: 'hand_lost' },
    { key: 'daily_round_win_3', title: 'Closer', description: 'Win 3 rounds', goal: 3, rewardChips: 120, event: 'round_won' }
  ],
  weekly: [
    { key: 'weekly_hands_played_90', title: 'High Volume', description: 'Play 90 hands', goal: 90, rewardChips: 260, event: 'hand_played' },
    { key: 'weekly_hands_won_40', title: 'Heat Check', description: 'Win 40 hands', goal: 40, rewardChips: 420, event: 'hand_won' },
    { key: 'weekly_pushes_18', title: 'Deadlock', description: 'Get 18 pushes', goal: 18, rewardChips: 320, event: 'push' },
    { key: 'weekly_blackjack_10', title: 'High Roller Naturals', description: 'Hit 10 natural blackjacks', goal: 10, rewardChips: 600, event: 'blackjack' },
    { key: 'weekly_rounds_35', title: 'Table Marathon', description: 'Play 35 rounds', goal: 35, rewardChips: 240, event: 'round_played' },
    { key: 'weekly_split_win_12', title: 'Split Maestro', description: 'Win 12 split hands', goal: 12, rewardChips: 520, event: 'split_win' },
    { key: 'weekly_round_win_14', title: 'Weekly Victor', description: 'Win 14 rounds', goal: 14, rewardChips: 480, event: 'round_won' }
  ]
};

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

function deployCommitId() {
  return (
    process.env.RENDER_GIT_COMMIT ||
    process.env.RENDER_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT ||
    process.env.COMMIT_SHA ||
    ''
  );
}

function parseCommitToNotes(commit) {
  const message = String(commit?.commit?.message || '').trim();
  const lines = message.split('\n').map((line) => line.trim()).filter(Boolean);
  const title = lines[0] || 'Latest update';
  const extra = lines.slice(1, 4);
  let bullets = extra.filter((line) => line.length > 0).slice(0, 3);
  if (!bullets.length) {
    const lower = title.toLowerCase();
    bullets = [
      lower.includes('fix') ? 'Includes reliability and bug fixes.' : 'Includes product polish and quality updates.',
      lower.includes('ui') || lower.includes('style') ? 'Refines interface hierarchy and readability.' : 'Improves game experience consistency.'
    ];
  }
  return {
    date: new Date(commit?.commit?.author?.date || Date.now()).toISOString().slice(0, 10),
    title,
    bullets,
    body: message
  };
}

async function getPatchNotesPayload() {
  const now = Date.now();
  if (patchNotesCache.payload && now - patchNotesCache.at < PATCH_NOTES_CACHE_MS) {
    return patchNotesCache.payload;
  }

  const commit = deployCommitId();
  const deployedAt = nowIso();
  let payload = {
    currentDeploy: { commit, deployedAt },
    notes: LOCAL_PATCH_NOTES
  };

  if (commit) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const response = await fetch(`https://api.github.com/repos/${PATCH_REPO}/commits/${commit}`, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (response.ok) {
        const ghCommit = await response.json();
        payload = {
          currentDeploy: {
            commit,
            deployedAt: ghCommit?.commit?.author?.date || deployedAt
          },
          notes: [parseCommitToNotes(ghCommit), ...LOCAL_PATCH_NOTES].slice(0, 6)
        };
      }
    } catch {
      // Fall back to local notes when GitHub API is unavailable.
    }
  }

  patchNotesCache = { at: now, payload };
  return payload;
}

function freeClaimMeta(user) {
  const lastTs = user?.lastFreeClaimAt ? new Date(user.lastFreeClaimAt).getTime() : 0;
  const nextTs = lastTs ? lastTs + FREE_CLAIM_COOLDOWN_MS : 0;
  const nowTs = Date.now();
  return {
    available: !lastTs || nowTs >= nextTs,
    nextAt: nextTs ? new Date(nextTs).toISOString() : null
  };
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function avatarUrl(style, seed) {
  const safeStyle = String(style || 'adventurer').trim().toLowerCase() || 'adventurer';
  const safeSeed = String(seed || 'player').trim() || 'player';
  return `https://api.dicebear.com/9.x/${encodeURIComponent(safeStyle)}/svg?seed=${encodeURIComponent(safeSeed)}`;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    avatarUrl: user.avatar,
    avatarStyle: user.avatarStyle || 'adventurer',
    avatarSeed: user.avatarSeed || user.username,
    bio: user.bio,
    chips: user.chips,
    stats: user.stats,
    selectedBet: user.selectedBet || BASE_BET,
    hasClaimedFree100: Boolean(user.lastFreeClaimAt)
  };
}

function sanitizeSelfUser(user) {
  return {
    ...sanitizeUser(user),
    pinMasked: '****',
    pin: user.pin || null
  };
}

function getUserById(id) {
  return db.data.users.find((u) => u.id === id);
}

function getUserByUsername(username) {
  const normalized = normalizeUsername(username);
  return db.data.users.find((u) => (u.usernameKey || normalizeUsername(u.username)) === normalized);
}

function getFriendList(user) {
  return user.friends
    .map((id) => getUserById(id))
    .filter(Boolean)
    .map((friend) => sanitizeUser(friend));
}

function normalizeLobbyCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase();
}

function emitToUser(userId, event, payload) {
  const socketId = activeSessions.get(userId);
  if (socketId) io.to(socketId).emit(event, payload);
}

function emitUserUpdate(userId) {
  const user = getUserById(userId);
  if (!user) return;
  emitToUser(userId, 'user:update', { user: sanitizeSelfUser(user) });
}

function pushNotification(userId, notification) {
  const user = getUserById(userId);
  if (!user) return;
  const payload = {
    id: notification.id || nanoid(10),
    type: notification.type || 'info',
    message: notification.message || '',
    createdAt: notification.createdAt || nowIso(),
    action: notification.action || null,
    read: false
  };
  user.notifications.unshift(payload);
  user.notifications = user.notifications.slice(0, 60);
  // Real-time inbox push for connected clients.
  emitToUser(userId, 'notify:new', payload);
}

function buildFriendsPayload(user) {
  const incoming = db.data.friendRequests
    .filter((r) => r.toUserId === user.id && r.status === 'pending')
    .map((r) => {
      const from = getUserById(r.fromUserId);
      return from
        ? {
            id: r.id,
            username: from.username,
            fromUserId: from.id,
            createdAt: r.createdAt
          }
        : null;
    })
    .filter(Boolean);

  const outgoing = db.data.friendRequests
    .filter((r) => r.fromUserId === user.id && r.status === 'pending')
    .map((r) => {
      const to = getUserById(r.toUserId);
      return to
        ? {
            id: r.id,
            username: to.username,
            toUserId: to.id,
            createdAt: r.createdAt
          }
        : null;
    })
    .filter(Boolean);

  const friends = user.friends
    .map((id) => getUserById(id))
    .filter(Boolean)
    .map((friend) => ({
      ...sanitizeUser(friend),
      online: Boolean(activeSessions.get(friend.id))
    }));

  return { friends, incoming, outgoing };
}

function getParticipantChips(match, playerId) {
  if (match?.isPractice && match.practiceBankrollById) {
    return match.practiceBankrollById[playerId] ?? STARTING_CHIPS;
  }
  if (isBotPlayer(playerId)) {
    return match.bot?.chipsById?.[playerId] ?? STARTING_CHIPS;
  }
  return getUserById(playerId)?.chips ?? STARTING_CHIPS;
}

function setParticipantChips(match, playerId, chips) {
  const safe = Math.max(0, Math.floor(chips));
  if (match?.isPractice) {
    if (!match.practiceBankrollById) match.practiceBankrollById = {};
    match.practiceBankrollById[playerId] = safe;
    return;
  }
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
  const directUser = db.data.users.find((u) => u.authToken === token);
  if (directUser) {
    req.user = directUser;
    return next();
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: 'Invalid auth' });
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function issueToken(user) {
  if (!user.authToken) user.authToken = nanoid(36);
  return user.authToken;
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

function isSixSevenStartingHand(cards) {
  if (!Array.isArray(cards) || cards.length < 2) return false;
  const a = cards[0]?.rank;
  const b = cards[1]?.rank;
  return (a === '6' && b === '7') || (a === '7' && b === '6');
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
    wasSplitHand: splitDepth > 0,
    naturalBlackjack: false
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

// Build per-viewer sanitized state to avoid leaking opponent hole/hit cards.
function buildClientState(match, viewerId) {
  const round = match.round;
  const players = {};
  const revealAllTotals = match.phase === PHASES.ROUND_RESOLVE || match.phase === PHASES.NEXT_ROUND;
  for (const pid of match.playerIds) {
    const state = round.players[pid];
    const isViewer = pid === viewerId;
    players[pid] = {
      activeHandIndex: state.activeHandIndex,
      bankroll: getParticipantChips(match, pid),
      hands: state.hands.map((hand) => {
        const hasHiddenToViewer = !isViewer && !revealAllTotals && hand.cards.length > 1;
        const visibleCards = isViewer || revealAllTotals ? hand.cards : hand.cards.slice(0, 1);
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
            const hiddenToViewer = !isViewer && !revealAllTotals && idx > 0;
            if (hiddenToViewer) return { hidden: true };
            return { rank: card.rank, suit: card.suit };
          }),
          naturalBlackjack: Boolean(hand.naturalBlackjack)
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

function serializeMatchFor(match, viewerId) {
  return buildClientState(match, viewerId);
}

function pushMatchState(match) {
  for (const pid of match.playerIds) {
    const socketId = activeSessions.get(pid);
    if (!socketId) continue;
    io.to(socketId).emit('match:state', buildClientState(match, pid));
  }
}

function challengeExpiresAt(tier, from = new Date()) {
  const ts = new Date(from);
  if (tier === 'hourly') {
    ts.setMinutes(0, 0, 0);
    ts.setHours(ts.getHours() + 1);
    return ts.toISOString();
  }
  if (tier === 'daily') {
    ts.setHours(24, 0, 0, 0);
    return ts.toISOString();
  }
  const day = ts.getDay();
  const daysUntilMonday = ((8 - day) % 7) || 7;
  ts.setDate(ts.getDate() + daysUntilMonday);
  ts.setHours(0, 0, 0, 0);
  return ts.toISOString();
}

function pickChallengeItems(tier, count) {
  const pool = [...(CHALLENGE_POOLS[tier] || [])];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

function refreshChallengesForUser(user, force = false) {
  let changed = false;
  if (!user.challengeSets) user.challengeSets = {};
  const now = new Date();
  for (const tier of ['hourly', 'daily', 'weekly']) {
    const current = user.challengeSets[tier];
    const expired = !current?.expiresAt || new Date(current.expiresAt).getTime() <= now.getTime();
    if (force || !current || expired || !Array.isArray(current.items)) {
      const expiresAt = challengeExpiresAt(tier, now);
      const items = pickChallengeItems(tier, CHALLENGE_COUNTS[tier]).map((def) => ({
        id: `${tier}_${nanoid(8)}`,
        key: def.key,
        tier,
        title: def.title,
        description: def.description,
        goal: def.goal,
        progress: 0,
        rewardChips: def.rewardChips,
        event: def.event,
        expiresAt,
        claimed: false
      }));
      user.challengeSets[tier] = { tier, expiresAt, items };
      changed = true;
    }
  }
  return changed;
}

function recordChallengeEvent(user, event, amount = 1) {
  if (!user || !event || amount <= 0) return;
  refreshChallengesForUser(user);
  for (const tier of ['hourly', 'daily', 'weekly']) {
    const list = user.challengeSets?.[tier]?.items || [];
    for (const item of list) {
      if (item.claimed) continue;
      if (item.event !== event) continue;
      item.progress = Math.min(item.goal, item.progress + amount);
    }
  }
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
  if (!match.isPractice) {
    if (u1) recordChallengeEvent(u1, 'round_played', 1);
    if (u2) recordChallengeEvent(u2, 'round_played', 1);
    db.write();
  }

  pushMatchState(match);
  scheduleBotBetConfirm(match);
  scheduleBotTurn(match);
}

function beginActionPhase(match) {
  const [p1, p2] = match.playerIds;
  const baseBet = Math.max(1, match.round.baseBet || BASE_BET);
  const postedP1 = Math.min(baseBet, Math.max(0, getParticipantChips(match, p1)));
  const postedP2 = Math.min(baseBet, Math.max(0, getParticipantChips(match, p2)));
  // Fresh 52-card deck is rebuilt and shuffled every round.
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

  for (const pid of [p1, p2]) {
    const hand = match.round.players[pid].hands[0];
    hand.naturalBlackjack = handMeta(hand.cards).isNaturalBlackjack;
    if (hand.naturalBlackjack) {
      hand.stood = true;
      hand.locked = true;
    }
  }

  if (!match.isPractice) {
    const userP1 = getUserById(p1);
    const userP2 = getUserById(p2);
    if (userP1 && isSixSevenStartingHand(match.round.players[p1].hands[0].cards)) userP1.stats.sixSevenDealt += 1;
    if (userP2 && isSixSevenStartingHand(match.round.players[p2].hands[0].cards)) userP2.stats.sixSevenDealt += 1;
    db.write();
    emitUserUpdate(p1);
    emitUserUpdate(p2);
  }

  // Instant round resolution for initial naturals.
  const p1Natural = match.round.players[p1].hands[0].naturalBlackjack;
  const p2Natural = match.round.players[p2].hands[0].naturalBlackjack;
  if (p1Natural || p2Natural) {
    resolveRound(match);
    return;
  }

  match.phase = PHASES.ACTION_TURN;
  if (!hasPlayableHand(match.round.players[match.round.turnPlayerId])) {
    const other = nextPlayerId(match, match.round.turnPlayerId);
    if (hasPlayableHand(match.round.players[other])) {
      match.round.turnPlayerId = other;
    } else {
      resolveRound(match);
    }
  }
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
  // Aggregate settlement per hand so split outcomes (win/push/loss mix) pay correctly.
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
      const handANatural = Boolean(handA.naturalBlackjack);
      const handBNatural = Boolean(handB.naturalBlackjack);
      if (result > 0) {
        const amount = handANatural && !handBNatural ? Math.floor(pot * 1.5) : pot;
        chipsDelta[aId] += amount;
        chipsDelta[bId] -= amount;
        handA.outcome = 'win';
        handB.outcome = handB.outcome || 'loss';
        outcomes.push({ winner: aId, loser: bId, amount, splitWin: handA.wasSplitHand, handIndex: idx });
      } else if (result < 0) {
        const amount = handBNatural && !handANatural ? Math.floor(pot * 1.5) : pot;
        chipsDelta[aId] -= amount;
        chipsDelta[bId] += amount;
        handA.outcome = 'loss';
        handB.outcome = handB.outcome || 'win';
        outcomes.push({ winner: bId, loser: aId, amount, handIndex: idx });
      } else {
        handA.outcome = 'push';
        if (!handB.outcome) handB.outcome = 'push';
        outcomes.push({ winner: null, loser: null, amount: 0, handIndex: idx });
      }
    }
  }

  if (!match.isPractice) {
    setParticipantChips(match, aId, getParticipantChips(match, aId) + chipsDelta[aId]);
    setParticipantChips(match, bId, getParticipantChips(match, bId) + chipsDelta[bId]);
  }

  function applyHandOutcomeStats(user, ownId, out) {
    if (!user) return;
    user.stats.handsPlayed = (user.stats.handsPlayed || 0) + 1;
    recordChallengeEvent(user, 'hand_played', 1);
    if (out.winner === ownId) {
      user.stats.handsWon += 1;
      recordChallengeEvent(user, 'hand_won', 1);
      if (out.splitWin) recordChallengeEvent(user, 'split_win', 1);
    } else if (out.loser === ownId) {
      user.stats.handsLost += 1;
      recordChallengeEvent(user, 'hand_lost', 1);
    } else {
      user.stats.pushes = (user.stats.pushes || 0) + 1;
      user.stats.handsPush = user.stats.pushes;
      recordChallengeEvent(user, 'push', 1);
    }
  }

  if (!match.isPractice) {
    for (const out of outcomes) {
      applyHandOutcomeStats(userA, aId, out);
      applyHandOutcomeStats(userB, bId, out);
    }
  }

  if (!match.isPractice && userA) {
    const naturals = a.hands.filter((h) => handMeta(h.cards).isNaturalBlackjack).length;
    if (naturals > 0) {
      userA.stats.blackjacks = (userA.stats.blackjacks || 0) + naturals;
      recordChallengeEvent(userA, 'blackjack', naturals);
    }
  }
  if (!match.isPractice && userB) {
    const naturals = b.hands.filter((h) => handMeta(h.cards).isNaturalBlackjack).length;
    if (naturals > 0) {
      userB.stats.blackjacks = (userB.stats.blackjacks || 0) + naturals;
      recordChallengeEvent(userB, 'blackjack', naturals);
    }
  }

  const netA = chipsDelta[aId];

  if (!match.isPractice && netA > 0) {
    if (userA) {
      userA.stats.roundsWon += 1;
      recordChallengeEvent(userA, 'round_won', 1);
    }
    if (userB) userB.stats.roundsLost += 1;
  } else if (!match.isPractice && netA < 0) {
    if (userB) {
      userB.stats.roundsWon += 1;
      recordChallengeEvent(userB, 'round_won', 1);
    }
    if (userA) userA.stats.roundsLost += 1;
  }

  if (!match.isPractice) {
    if (userA) userA.stats.matchesPlayed += 1;
    if (userB) userB.stats.matchesPlayed += 1;
    db.write();
    emitUserUpdate(aId);
    emitUserUpdate(bId);
  }

  const outcomeA = chipsDelta[aId] > 0 ? 'win' : chipsDelta[aId] < 0 ? 'lose' : 'push';
  const outcomeB = chipsDelta[bId] > 0 ? 'win' : chipsDelta[bId] < 0 ? 'lose' : 'push';
  emitToUser(aId, 'round:result', { matchId: match.id, roundNumber: match.roundNumber, outcome: outcomeA, deltaChips: chipsDelta[aId] });
  emitToUser(bId, 'round:result', { matchId: match.id, roundNumber: match.roundNumber, outcome: outcomeB, deltaChips: chipsDelta[bId] });

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

  // Split state machine: active player must finish all of their hands before turn passes.
  if (hasPlayableHand(ownState)) {
    match.round.turnPlayerId = actingPlayerId;
    match.phase = PHASES.ACTION_TURN;
  } else if (hasPlayableHand(otherState)) {
    advanceToNextPlayableHand(otherState);
    match.round.turnPlayerId = other;
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
  const opponentUpCard = opponentHand?.cards?.[0] || null;
  const opponentUpCardTotal = opponentUpCard ? cardValue(opponentUpCard) : 10;
  const total = handTotal(hand.cards);
  const meta = handMeta(hand.cards);
  let ideal = basicStrategyAction(hand, meta, total, opponentUpCardTotal);
  if (!legal.includes(ideal)) ideal = legal[0];

  const difficulty = getBotDifficulty(match, botId);
  const accuracy = difficulty === 'easy' ? 0.45 : difficulty === 'medium' ? 0.75 : 0.94;
  if (Math.random() <= accuracy) return ideal;

  const alternatives = legal.filter((a) => a !== ideal);
  if (!alternatives.length) return ideal;
  return alternatives[Math.floor(Math.random() * alternatives.length)];
}

function basicStrategyAction(hand, meta, total, up) {
  if (canSplit(hand)) {
    const r = hand.cards[0].rank;
    if (r === 'A' || r === '8') return 'split';
    if (r === '9' && ![7, 10, 11].includes(up)) return 'split';
    if (r === '7' && up <= 7) return 'split';
    if (r === '6' && up >= 2 && up <= 6) return 'split';
    if ((r === '2' || r === '3') && up >= 2 && up <= 7) return 'split';
    if (r === '4' && (up === 5 || up === 6)) return 'split';
  }

  if (meta.isSoft) {
    if (total >= 19) return 'stand';
    if (total === 18) return up >= 9 || up === 11 ? 'hit' : 'stand';
    if (total === 17 || total === 16) return up >= 4 && up <= 6 ? 'double' : 'hit';
    if (total === 15 || total === 14) return up >= 4 && up <= 6 ? 'double' : 'hit';
    if (total === 13 || total === 12) return up >= 5 && up <= 6 ? 'double' : 'hit';
  }

  if (total >= 17) return 'stand';
  if (total >= 13 && total <= 16) return up >= 7 ? 'hit' : 'stand';
  if (total === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit';
  if (total === 11) return 'double';
  if (total === 10) return up <= 9 ? 'double' : 'hit';
  if (total === 9) return up >= 3 && up <= 6 ? 'double' : 'hit';
  return 'hit';
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
      // Instant round resolution on bust.
      resolveRound(match);
      return { ok: true };
    }
    if (total === 21) {
      hand.stood = true;
      hand.locked = true;
      progressTurn(match, playerId);
      return { ok: true };
    }
    match.phase = PHASES.ACTION_TURN;
    match.round.turnPlayerId = playerId;
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

    if (!match.isPractice) {
      const user = getUserById(playerId);
      if (user) {
        if (isSixSevenStartingHand(newOne.cards)) user.stats.sixSevenDealt += 1;
        if (isSixSevenStartingHand(newTwo.cards)) user.stats.sixSevenDealt += 1;
        db.write();
        emitUserUpdate(playerId);
      }
    }

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
  const isPractice = (lobby.stakeType || 'FAKE') === 'FAKE';
  const selectedBetById = {};
  for (const pid of playerIds) {
    if (isBotPlayer(pid)) {
      selectedBetById[pid] = BASE_BET;
    } else {
      const user = getUserById(pid);
      selectedBetById[pid] = clampBet(user?.selectedBet || BASE_BET, isPractice ? STARTING_CHIPS : (user?.chips || STARTING_CHIPS));
    }
  }
  const match = {
    id: nanoid(10),
    lobbyId: lobby.id,
    participants: buildParticipants(playerIds, options.botDifficultyById || {}),
    playerIds,
    startingPlayerIndex: 0,
    roundNumber: 0,
    stakeType: lobby.stakeType || (isPractice ? 'FAKE' : 'REAL'),
    isPractice,
    practiceBankrollById: isPractice
      ? playerIds.reduce((acc, pid) => {
          acc[pid] = STARTING_CHIPS;
          return acc;
        }, {})
      : null,
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

function buildNewUser(username) {
  const cleanUsername = String(username || '').trim();
  const usernameKey = normalizeUsername(cleanUsername);
  const pin = String(Math.floor(1000 + Math.random() * 9000));
  const user = {
    id: nanoid(),
    username: cleanUsername,
    usernameKey,
    authToken: nanoid(36),
    pin,
    pinHash: bcrypt.hashSync(pin, 10),
    avatarStyle: 'adventurer',
    avatarSeed: cleanUsername,
    avatar: avatarUrl('adventurer', cleanUsername),
    bio: 'Ready for Blackjack Battle.',
    chips: STARTING_CHIPS,
    stats: {
      matchesPlayed: 0,
      roundsWon: 0,
      roundsLost: 0,
      handsWon: 0,
      handsLost: 0,
      pushes: 0,
      handsPush: 0,
      handsPlayed: 0,
      blackjacks: 0,
      sixSevenDealt: 0
    },
    friends: [],
    challengeSets: {},
    lastDailyClaimAt: null,
    lastFreeClaimAt: null,
    selectedBet: BASE_BET,
    notifications: []
  };
  refreshChallengesForUser(user, true);
  return user;
}

app.post('/api/auth/register', async (req, res) => {
  const { username } = req.body || {};
  const cleanUsername = String(username || '').trim();
  if (!cleanUsername) return res.status(400).json({ ok: false, error: 'Username required' });
  if (cleanUsername.length < 3) return res.status(400).json({ ok: false, error: 'Username too short' });
  if (getUserByUsername(cleanUsername)) return res.status(409).json({ ok: false, error: 'Username already exists' });

  const user = buildNewUser(cleanUsername);
  db.data.users.push(user);
  await db.write();
  return res.json({ ok: true, userId: user.id, authToken: user.authToken, pin: user.pin, user: sanitizeSelfUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, pin } = req.body || {};
  const user = getUserByUsername(username || '');
  if (!user) return res.status(401).json({ ok: false, error: 'Invalid auth' });
  if (!/^\d{4}$/.test(String(pin || ''))) return res.status(401).json({ ok: false, error: 'Invalid auth' });
  const ok = await bcrypt.compare(String(pin || ''), user.pinHash || '');
  if (!ok) {
    return res.status(401).json({ ok: false, error: 'Invalid auth' });
  }
  if (!user.authToken) user.authToken = nanoid(36);
  await db.write();
  return res.json({ ok: true, user: sanitizeSelfUser(user), authToken: user.authToken });
});

app.post('/api/auth/me', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.body?.authToken || '');
  const user = db.data.users.find((u) => u.authToken === token);
  if (!user) return res.status(401).json({ ok: false, error: 'Invalid auth' });
  return res.json({ ok: true, user: sanitizeSelfUser(user), authToken: user.authToken });
});

app.post('/api/register', async (req, res) => {
  const { username } = req.body || {};
  const cleanUsername = String(username || '').trim();
  if (!cleanUsername) return res.status(400).json({ error: 'Missing fields' });
  if (cleanUsername.length < 3) return res.status(400).json({ error: 'Username too short' });
  if (getUserByUsername(cleanUsername)) return res.status(409).json({ error: 'Username already exists' });
  const user = buildNewUser(cleanUsername);
  db.data.users.push(user);
  await db.write();
  return res.json({ token: issueToken(user), user: sanitizeSelfUser(user), authToken: user.authToken, pin: user.pin });
});

app.post('/api/login', async (req, res) => {
  const { username, pin, authToken } = req.body || {};
  const user = getUserByUsername(username || '');
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (authToken && user.authToken === authToken) {
    return res.json({ token: issueToken(user), user: sanitizeSelfUser(user), authToken: user.authToken });
  }
  const ok = await bcrypt.compare(String(pin || ''), user.pinHash || '');
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  return res.json({ token: issueToken(user), user: sanitizeSelfUser(user), authToken: user.authToken });
});

app.get('/api/me', authMiddleware, async (req, res) => {
  const friendsData = buildFriendsPayload(req.user);
  const refreshed = refreshChallengesForUser(req.user);
  if (refreshed) await db.write();
  const freeClaim = freeClaimMeta(req.user);
  return res.json({
    user: sanitizeSelfUser(req.user),
    friends: friendsData.friends,
    friendRequests: {
      incoming: friendsData.incoming,
      outgoing: friendsData.outgoing
    },
    notifications: (req.user.notifications || []).slice(0, 30),
    freeClaimed: !freeClaim.available,
    freeClaimAvailable: freeClaim.available,
    freeClaimNextAt: freeClaim.nextAt,
    challenges: {
      hourly: req.user.challengeSets.hourly?.items || [],
      daily: req.user.challengeSets.daily?.items || [],
      weekly: req.user.challengeSets.weekly?.items || []
    }
  });
});

app.put('/api/profile', authMiddleware, async (req, res) => {
  const { avatar, avatarStyle, avatarSeed, bio } = req.body || {};
  if (typeof avatarStyle === 'string') req.user.avatarStyle = avatarStyle.slice(0, 80);
  if (typeof avatarSeed === 'string') req.user.avatarSeed = avatarSeed.slice(0, 120);
  if (typeof avatar === 'string' && !avatarStyle && !avatarSeed) req.user.avatar = avatar.slice(0, 300);
  req.user.avatar = avatarUrl(req.user.avatarStyle, req.user.avatarSeed || req.user.username);
  if (typeof bio === 'string') req.user.bio = bio.slice(0, 300);
  await db.write();
  return res.json({ user: sanitizeSelfUser(req.user) });
});

app.get('/api/friends', authMiddleware, (req, res) => {
  return res.json(buildFriendsPayload(req.user));
});

app.post('/api/friends/add', authMiddleware, async (req, res) => {
  // Backward-compatible alias to friend request flow.
  const { username } = req.body || {};
  const target = getUserByUsername(username || '');
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot friend yourself' });
  if (req.user.friends.includes(target.id)) return res.status(409).json({ error: 'Already friends' });
  const existing = db.data.friendRequests.find(
    (r) =>
      ((r.fromUserId === req.user.id && r.toUserId === target.id) ||
        (r.fromUserId === target.id && r.toUserId === req.user.id)) &&
      r.status === 'pending'
  );
  if (existing) return res.status(409).json({ error: 'Friend request already pending' });
  db.data.friendRequests.push({
    id: nanoid(10),
    fromUserId: req.user.id,
    toUserId: target.id,
    status: 'pending',
    createdAt: nowIso()
  });
  pushNotification(target.id, {
    type: 'friend_request',
    message: `${req.user.username} sent you a friend request.`
  });
  await db.write();
  return res.json(buildFriendsPayload(req.user));
});

app.get('/api/friends/list', authMiddleware, (req, res) => {
  return res.json(buildFriendsPayload(req.user));
});

app.post('/api/friends/request', authMiddleware, async (req, res) => {
  const { username } = req.body || {};
  const target = getUserByUsername(username || '');
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot friend yourself' });
  if (req.user.friends.includes(target.id)) return res.status(409).json({ error: 'Already friends' });
  const existing = db.data.friendRequests.find(
    (r) =>
      ((r.fromUserId === req.user.id && r.toUserId === target.id) ||
        (r.fromUserId === target.id && r.toUserId === req.user.id)) &&
      r.status === 'pending'
  );
  if (existing) return res.status(409).json({ error: 'Friend request already pending' });
  db.data.friendRequests.push({
    id: nanoid(10),
    fromUserId: req.user.id,
    toUserId: target.id,
    status: 'pending',
    createdAt: nowIso()
  });
  pushNotification(target.id, {
    type: 'friend_request',
    message: `${req.user.username} sent you a friend request.`
  });
  await db.write();
  return res.json(buildFriendsPayload(req.user));
});

app.post('/api/friends/accept', authMiddleware, async (req, res) => {
  const { requestId, username } = req.body || {};
  const reqObj = db.data.friendRequests.find((r) => r.id === requestId && r.toUserId === req.user.id && r.status === 'pending');
  const target = username ? getUserByUsername(username) : null;
  const fallback = target
    ? db.data.friendRequests.find(
        (r) => r.fromUserId === target.id && r.toUserId === req.user.id && r.status === 'pending'
      )
    : null;
  const friendReq = reqObj || fallback;
  if (!friendReq) return res.status(404).json({ error: 'Friend request not found' });
  friendReq.status = 'accepted';
  const from = getUserById(friendReq.fromUserId);
  if (from) {
    if (!req.user.friends.includes(from.id)) req.user.friends.push(from.id);
    if (!from.friends.includes(req.user.id)) from.friends.push(req.user.id);
    pushNotification(from.id, {
      type: 'friend_accept',
      message: `${req.user.username} accepted your friend request.`
    });
  }
  await db.write();
  return res.json(buildFriendsPayload(req.user));
});

app.post('/api/friends/decline', authMiddleware, async (req, res) => {
  const { requestId, username } = req.body || {};
  const reqObj = db.data.friendRequests.find((r) => r.id === requestId && r.toUserId === req.user.id && r.status === 'pending');
  const target = username ? getUserByUsername(username) : null;
  const fallback = target
    ? db.data.friendRequests.find(
        (r) => r.fromUserId === target.id && r.toUserId === req.user.id && r.status === 'pending'
      )
    : null;
  const friendReq = reqObj || fallback;
  if (!friendReq) return res.status(404).json({ error: 'Friend request not found' });
  friendReq.status = 'declined';
  await db.write();
  return res.json(buildFriendsPayload(req.user));
});

app.post('/api/friends/invite-link', authMiddleware, async (req, res) => {
  db.data.friendInvites = (db.data.friendInvites || []).filter((invite) => invite.fromUserId !== req.user.id);
  const code = nanoid(12);
  const expiresAt = new Date(Date.now() + FRIEND_INVITE_TTL_MS).toISOString();
  db.data.friendInvites.push({
    code,
    fromUserId: req.user.id,
    createdAt: nowIso(),
    expiresAt,
    usedBy: []
  });
  await db.write();

  return res.json({
    token: code,
    inviteUrl: `${req.protocol}://${req.get('host')}/?friendInvite=${code}`,
    expiresAt
  });
});

app.post('/api/friends/invite-link/accept', authMiddleware, async (req, res) => {
  const { code } = req.body || {};
  const invite = db.data.friendInvites.find((f) => f.code === code);
  if (!invite) return res.status(404).json({ error: 'Invalid invite' });
  if (invite.expiresAt && Date.now() > new Date(invite.expiresAt).getTime()) {
    return res.status(410).json({ error: 'Invite expired' });
  }
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
  const existing = db.data.lobbies.find(
    (l) => l.ownerId === req.user.id && l.status === 'waiting' && l.type !== 'bot'
  );
  if (existing) {
    return res.json({
      lobby: existing,
      link: `${req.protocol}://${req.get('host')}/lobbies?code=${existing.id}`
    });
  }
  const lobby = {
    id: normalizeLobbyCode(nanoid(8)),
    ownerId: req.user.id,
    opponentId: null,
    status: 'waiting',
    invited: [],
    createdAt: nowIso()
  };
  db.data.lobbies.push(lobby);
  await db.write();

  return res.json({
    lobby,
    link: `${req.protocol}://${req.get('host')}/lobbies?code=${lobby.id}`
  });
});

app.post('/api/lobbies/join', authMiddleware, async (req, res) => {
  const { lobbyId } = req.body || {};
  const normalized = normalizeLobbyCode(lobbyId);
  const lobby = db.data.lobbies.find((l) => normalizeLobbyCode(l.id) === normalized);
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
  if (lobby.ownerId === req.user.id) return res.status(400).json({ error: 'Cannot join your own lobby' });
  if (lobby.opponentId && lobby.opponentId !== req.user.id) return res.status(409).json({ error: 'Lobby full' });
  if (Array.isArray(lobby.invited) && lobby.invited.length > 0 && !lobby.invited.includes(req.user.username)) {
    return res.status(403).json({ error: 'You are not invited to this private lobby' });
  }

  lobby.opponentId = req.user.id;
  lobby.status = 'full';
  await db.write();

  emitLobbyUpdate(lobby);
  pushNotification(lobby.ownerId, {
    type: 'lobby_joined',
    message: `${req.user.username} joined your lobby.`
  });

  let matchId = lobbyToMatch.get(lobby.id);
  if (!matchId) {
    const match = createMatch(lobby);
    matchId = match.id;
  }

  return res.json({ lobby, matchId });
});

app.get('/api/lobbies/:id', authMiddleware, (req, res) => {
  const lobby = db.data.lobbies.find((l) => normalizeLobbyCode(l.id) === normalizeLobbyCode(req.params.id));
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
  const matchId = lobbyToMatch.get(lobby.id) || null;
  return res.json({ lobby, matchId });
});

app.post('/api/lobbies/invite', authMiddleware, async (req, res) => {
  const { username } = req.body || {};
  const friend = getUserByUsername(username || '');
  if (!friend) return res.status(404).json({ error: 'Friend not found' });
  if (!req.user.friends.includes(friend.id)) return res.status(403).json({ error: 'Can only invite friends' });

  let lobby = db.data.lobbies.find((l) => l.ownerId === req.user.id && l.status === 'waiting' && l.type !== 'bot');
  if (!lobby) {
    lobby = {
      id: normalizeLobbyCode(nanoid(8)),
      ownerId: req.user.id,
      opponentId: null,
      status: 'waiting',
      invited: [],
      createdAt: nowIso()
    };
    db.data.lobbies.push(lobby);
  }
  if (!Array.isArray(lobby.invited)) lobby.invited = [];
  if (!lobby.invited.includes(friend.username)) lobby.invited.push(friend.username);

  pushNotification(friend.id, {
    type: 'lobby_invite',
    message: `${req.user.username} invited you to a private lobby.`,
    action: { label: 'Join', kind: 'join_lobby', data: { lobbyCode: lobby.id } }
  });

  await db.write();
  emitLobbyUpdate(lobby);
  return res.json({ lobby, link: `${req.protocol}://${req.get('host')}/lobbies?code=${lobby.id}` });
});

async function createBotPracticeLobby(req, res) {
  const { difficulty, stakeType } = req.body || {};
  if (!['easy', 'medium', 'normal'].includes(difficulty)) {
    return res.status(400).json({ error: 'Difficulty must be easy, medium, or normal' });
  }
  const resolvedStake = stakeType === 'REAL' ? 'REAL' : 'FAKE';

  const botId = `bot:${difficulty}:${nanoid(6)}`;
  const lobby = {
    id: normalizeLobbyCode(nanoid(8)),
    ownerId: req.user.id,
    opponentId: botId,
    status: 'full',
    type: 'bot',
    stakeType: resolvedStake,
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
  const freeClaim = freeClaimMeta(req.user);
  if (!freeClaim.available) {
    return res.status(409).json({
      reward: 0,
      chips: req.user.chips,
      claimed: false,
      claimedAt: req.user.lastFreeClaimAt,
      nextAt: freeClaim.nextAt,
      error: 'Free claim on cooldown'
    });
  }
  req.user.lastFreeClaimAt = nowIso();
  req.user.chips += 100;
  await db.write();
  emitUserUpdate(req.user.id);
  const next = freeClaimMeta(req.user);
  return res.json({ reward: 100, chips: req.user.chips, claimed: true, claimedAt: req.user.lastFreeClaimAt, nextAt: next.nextAt });
});

app.get('/api/notifications', authMiddleware, (req, res) => {
  return res.json({ notifications: (req.user.notifications || []).slice(0, 50) });
});

app.post('/api/notifications/clear', authMiddleware, async (req, res) => {
  req.user.notifications = [];
  await db.write();
  return res.json({ notifications: [] });
});

app.post('/api/notifications/dismiss', authMiddleware, async (req, res) => {
  const { id } = req.body || {};
  req.user.notifications = (req.user.notifications || []).filter((n) => n.id !== id);
  await db.write();
  return res.json({ notifications: req.user.notifications });
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

app.get('/api/challenges', authMiddleware, async (req, res) => {
  const refreshed = refreshChallengesForUser(req.user);
  if (refreshed) await db.write();
  const payload = {
    hourly: req.user.challengeSets.hourly?.items || [],
    daily: req.user.challengeSets.daily?.items || [],
    weekly: req.user.challengeSets.weekly?.items || []
  };
  return res.json({
    challenges: payload
  });
});

app.post('/api/challenges/claim', authMiddleware, async (req, res) => {
  const { id, challengeId } = req.body || {};
  const targetId = id || challengeId;
  refreshChallengesForUser(req.user);
  const tiers = ['hourly', 'daily', 'weekly'];
  let target = null;
  for (const tier of tiers) {
    target = (req.user.challengeSets[tier]?.items || []).find((c) => c.id === targetId);
    if (target) break;
  }
  if (!target) return res.status(404).json({ error: 'Challenge not found' });
  if (target.claimed) return res.status(409).json({ error: 'Already claimed' });
  if (target.progress < target.goal) return res.status(400).json({ error: 'Not complete' });
  target.claimed = true;
  req.user.chips += target.rewardChips;
  await db.write();
  emitUserUpdate(req.user.id);
  return res.json({ id: targetId, reward: target.rewardChips, chips: req.user.chips });
});

app.get('/api/patch-notes', async (_req, res) => {
  const payload = await getPatchNotesPayload();
  return res.json(payload);
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Missing token'));
  const directUser = db.data.users.find((u) => u.authToken === token);
  if (directUser) {
    socket.user = directUser;
    return next();
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = getUserById(decoded.userId);
    if (!user) return next(new Error('Invalid auth'));
    socket.user = user;
    return next();
  } catch {
    return next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  activeSessions.set(userId, socket.id);
  // Initial notification sync on connect.
  socket.emit('notify:list', { notifications: (socket.user.notifications || []).slice(0, 30) });

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

  socket.on('game:emote', (payload = {}) => {
    const { matchId, type, value } = payload;
    const match = matches.get(matchId);
    if (!match) return socket.emit('match:error', { error: 'Match not found' });
    if (!match.playerIds.includes(userId)) return socket.emit('match:error', { error: 'Unauthorized' });
    if (match.playerIds.some((id) => isBotPlayer(id))) return socket.emit('match:error', { error: 'Emotes disabled in bot mode' });

    const now = Date.now();
    const lastAt = emoteCooldownByUser.get(userId) || 0;
    if (now - lastAt < EMOTE_COOLDOWN_MS) return;

    const allowed = {
      emoji: new Set(['😂', '😭', '👍', '😡']),
      quip: new Set(['Bitchmade', 'Fuck you', 'Skill issue', 'L'])
    };
    if (!allowed[type]?.has(value)) return;

    emoteCooldownByUser.set(userId, now);
    const out = {
      fromUsername: socket.user.username,
      fromUserId: userId,
      type,
      value,
      ts: nowIso()
    };
    for (const pid of match.playerIds) emitToUser(pid, 'game:emote', out);
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

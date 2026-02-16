import express from 'express';
import http from 'http';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';
import path from 'path';
import { fileURLToPath } from 'url';
import { createStorage } from './db/storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
const authSecretSource = process.env.SESSION_SECRET ? 'SESSION_SECRET' : process.env.JWT_SECRET ? 'JWT_SECRET' : null;
const configuredSecret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
if (process.env.NODE_ENV === 'production' && !configuredSecret) {
  throw new Error('Missing SESSION_SECRET (or JWT_SECRET) in production. Configure a stable secret for auth tokens.');
}
if (process.env.NODE_ENV !== 'test') {
  // eslint-disable-next-line no-console
  console.log(`Auth secret provided: ${authSecretSource || 'none (dev fallback)'}`);
}
const JWT_SECRET = configuredSecret || 'blackjack-battle-dev-secret';
const STARTING_CHIPS = 1000;
const BASE_BET = 5;
const MIN_BET = 5;
const MAX_BET_CAP = 500;
const BOT_UNLIMITED_BANKROLL = 1_000_000_000;
const BOT_BET_LIMITS = {
  easy: { min: 1, max: 250 },
  medium: { min: 100, max: 500 },
  normal: { min: 500, max: 2000 }
};
const QUICK_PLAY_BUCKETS = [10, 50, 100, 250, 500, 1000, 2000];
const DAILY_REWARD = 100;
const FREE_CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DISCONNECT_TIMEOUT_MS = 60_000;
const BOT_BET_CONFIRM_MIN_MS = 200;
const BOT_BET_CONFIRM_MAX_MS = 600;
const BOT_ACTION_DELAY_MIN_MS = 700;
const BOT_ACTION_DELAY_MAX_MS = 1200;
const BOT_FIRST_ACTION_DELAY_MIN_MS = 2000;
const BOT_FIRST_ACTION_DELAY_MAX_MS = 3000;
const ROUND_REVEAL_MS = 2200;
const PATCH_NOTES_CACHE_MS = 10 * 60 * 1000;
const PATCH_REPO = 'Elicanig/1v1Blackjack';
const FRIEND_INVITE_TTL_MS = 30 * 60 * 1000;
const EMOTE_COOLDOWN_MS = 5000;
const FRIEND_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const TURN_TIMEOUT_MS = 30_000;
const STREAK_REWARDS = [50, 75, 100, 125, 150, 175, 200];
const HOURLY_RESET_MS = 60 * 60 * 1000;
const DAILY_RESET_MS = 24 * 60 * 60 * 1000;
const WEEKLY_RESET_MS = 7 * 24 * 60 * 60 * 1000;
const USER_STATS_DEFAULTS = Object.freeze({
  matchesPlayed: 0,
  roundsWon: 0,
  roundsLost: 0,
  handsWon: 0,
  handsLost: 0,
  pushes: 0,
  handsPush: 0,
  handsPlayed: 0,
  blackjacks: 0,
  sixSevenDealt: 0,
  splitsAttempted: 0,
  splitHandsWon: 0,
  splitHandsLost: 0,
  splitHandsPushed: 0,
  doublesAttempted: 0,
  doubleHandsWon: 0,
  doubleHandsLost: 0,
  doubleHandsPushed: 0,
  surrenders: 0,
  busts: 0,
  highestSafeTotal: 0,
  maxCardsInWinningHand: 0,
  fourCard21s: 0,
  fiveCard21s: 0,
  sixCard21s: 0,
  sevenPlusCard21s: 0,
  longestWinStreak: 0,
  longestLossStreak: 0,
  currentWinStreak: 0,
  currentLossStreak: 0,
  totalChipsWon: 0,
  totalChipsLost: 0,
  biggestHandWin: 0,
  biggestHandLoss: 0,
  realBetSum: 0,
  realBetCount: 0,
  handsPlayedBotPractice: 0,
  handsPlayedBotReal: 0,
  handsPlayedPvpReal: 0,
  handsPlayedPvpFriendly: 0
});

function cloneUserStatsDefaults() {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(USER_STATS_DEFAULTS);
  }
  return JSON.parse(JSON.stringify(USER_STATS_DEFAULTS));
}

const DATA_DIR = process.env.DATA_DIR || './data';
const EMPTY_DB = {
  users: [],
  lobbies: [],
  friendInvites: [],
  friendRequests: [],
  friendChallenges: []
};
const storage = await createStorage({
  emptyDb: EMPTY_DB,
  dataDir: DATA_DIR,
  nodeEnv: process.env.NODE_ENV,
  startingChips: STARTING_CHIPS
});
const db = {
  data: storage.data,
  write: storage.write
};
const storageInfo = storage.getInfo();
const STORAGE_BACKEND = storageInfo.backend;
const ACTIVE_DATA_DIR = storageInfo.dataDir;
const DB_PATH = storageInfo.dbPath;

if (process.env.NODE_ENV !== 'test') {
  if (STORAGE_BACKEND === 'postgres') {
    // eslint-disable-next-line no-console
    console.log('[storage] Using Postgres storage via DATABASE_URL');
    // eslint-disable-next-line no-console
    console.log(`[storage] Loaded ${db.data.users.length} users from Postgres`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[storage] Using DATA_DIR=${ACTIVE_DATA_DIR}`);
    if (storageInfo.hadExistingStorage) {
      // eslint-disable-next-line no-console
      console.log(`[storage] Loaded ${db.data.users.length} users from DB_PATH=${DB_PATH}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[storage] Initialized new DB at DB_PATH=${DB_PATH}`);
    }
  }
}

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
  if (user.lastStreakClaimAt === undefined) {
    user.lastStreakClaimAt = null;
    dbTouched = true;
  }
  if (user.streakCount === undefined) {
    user.streakCount = 0;
    dbTouched = true;
  }
  if (user.selectedBet === undefined) {
    user.selectedBet = BASE_BET;
    dbTouched = true;
  }
  if (!Array.isArray(user.notifications)) {
    user.notifications = [];
    dbTouched = true;
  } else {
    const existingNotifications = user.notifications;
    const normalizedNotifications = existingNotifications
      .filter((n) => n && typeof n === 'object')
      .map((n) => ({
        id: n.id || nanoid(10),
        type: n.type || 'info',
        message: n.message || '',
        createdAt: n.createdAt || nowIso(),
        action: n.action || null,
        requestId: typeof n.requestId === 'string' ? n.requestId : null,
        fromUserId: typeof n.fromUserId === 'string' ? n.fromUserId : null,
        read: Boolean(n.read)
      }))
      .slice(0, 60);
    const changed =
      normalizedNotifications.length !== existingNotifications.length ||
      normalizedNotifications.some((entry, idx) => {
        const prev = existingNotifications[idx];
        if (!prev || typeof prev !== 'object') return true;
        return (
          entry.id !== prev.id ||
          entry.type !== prev.type ||
          entry.message !== prev.message ||
          entry.createdAt !== prev.createdAt ||
          entry.requestId !== (typeof prev.requestId === 'string' ? prev.requestId : null) ||
          entry.fromUserId !== (typeof prev.fromUserId === 'string' ? prev.fromUserId : null) ||
          entry.read !== Boolean(prev.read) ||
          entry.action !== (prev.action || null)
        );
      });
    user.notifications = normalizedNotifications;
    if (changed) dbTouched = true;
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
  // Non-destructive PIN migration: never replace existing hashes.
  if (!user.pinHash) {
    const generatedPin = user.pin ? String(user.pin) : String(Math.floor(1000 + Math.random() * 9000));
    user.pin = generatedPin;
    user.pinHash = bcrypt.hashSync(generatedPin, 10);
    dbTouched = true;
  }
  if (!user.stats) {
    user.stats = cloneUserStatsDefaults();
    dbTouched = true;
  }
  if (user.stats.pushes === undefined && user.stats.handsPush !== undefined) {
    user.stats.pushes = user.stats.handsPush || 0;
    dbTouched = true;
  }
  if (user.stats.handsPush === undefined && user.stats.pushes !== undefined) {
    user.stats.handsPush = user.stats.pushes || 0;
    dbTouched = true;
  }
  for (const [key, defaultValue] of Object.entries(USER_STATS_DEFAULTS)) {
    if (user.stats[key] === undefined) {
      user.stats[key] = defaultValue;
      dbTouched = true;
    }
  }
  if (!user.challengeSets) {
    user.challengeSets = {};
    dbTouched = true;
  }
  if (!Array.isArray(user.betHistory)) {
    user.betHistory = [];
    dbTouched = true;
  }
  if (!Array.isArray(user.skillChallenges)) {
    user.skillChallenges = [];
    dbTouched = true;
  }
}
if (!Array.isArray(db.data.friendRequests)) {
  db.data.friendRequests = [];
  dbTouched = true;
}
if (!Array.isArray(db.data.friendChallenges)) {
  db.data.friendChallenges = [];
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
const roundPhaseTimers = new Map();
const afkTurnTimers = new Map();
const emoteCooldownByUser = new Map();
const quickPlayQueuesByBucket = new Map();
const quickPlayBucketByUser = new Map();
let patchNotesCache = { at: 0, payload: null };

const LOCAL_PATCH_NOTES = [
  {
    date: '2026-02-15',
    title: 'Account persistence hardening',
    bullets: [
      'Fix: accounts now persist across deployments and patches (no forced re-registration).',
      'Storage boot now loads existing persistent data without reseeding users.'
    ],
    body: 'Fix: accounts now persist across deployments and patches (no forced re-registration).\nStorage boot now loads existing persistent data without reseeding users.'
  },
  {
    date: '2026-02-14',
    title: 'Match layout + home polish',
    bullets: [
      'Match screen now uses a cards-first, non-overlapping viewport layout.',
      'Logo shine timing, stats ordering/labels, and rules strip alignment were refined.'
    ],
    body: 'Match screen now uses a cards-first, non-overlapping viewport layout.\nLogo shine timing, stats ordering/labels, and rules strip alignment were refined.'
  },
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
    { key: 'hourly_rounds_2', title: 'Table Presence', description: 'Play 2 rounds', goal: 2, rewardChips: 10, event: 'round_played' },
    { key: 'hourly_hand_losses_2', title: 'Bounce Back', description: 'Complete 2 losing hands', goal: 2, rewardChips: 12, event: 'hand_lost' },
    { key: 'hourly_round_win_1', title: 'Fast Finisher', description: 'Win 1 round', goal: 1, rewardChips: 22, event: 'round_won' },
    { key: 'hourly_hands_played_10', title: 'Table Tempo', description: 'Play 10 hands', goal: 10, rewardChips: 18, event: 'hand_played' }
  ],
  daily: [
    { key: 'daily_hands_played_20', title: 'Daily Grinder', description: 'Play 20 hands', goal: 20, rewardChips: 70, event: 'hand_played' },
    { key: 'daily_hands_won_10', title: 'Ten Up', description: 'Win 10 hands', goal: 10, rewardChips: 110, event: 'hand_won' },
    { key: 'daily_pushes_6', title: 'Knife Edge', description: 'Get 6 pushes', goal: 6, rewardChips: 80, event: 'push' },
    { key: 'daily_blackjack_3', title: 'Triple Natural', description: 'Hit 3 natural blackjacks', goal: 3, rewardChips: 130, event: 'blackjack' },
    { key: 'daily_rounds_8', title: 'Session Pro', description: 'Play 8 rounds', goal: 8, rewardChips: 60, event: 'round_played' },
    { key: 'daily_split_win_2', title: 'Split Specialist', description: 'Win 2 split hands', goal: 2, rewardChips: 95, event: 'split_win' },
    { key: 'daily_hands_lost_8', title: 'Learn and Adapt', description: 'Complete 8 losing hands', goal: 8, rewardChips: 55, event: 'hand_lost' },
    { key: 'daily_round_win_3', title: 'Closer', description: 'Win 3 rounds', goal: 3, rewardChips: 120, event: 'round_won' },
    { key: 'daily_hands_won_6', title: 'Six Shooter', description: 'Win 6 hands', goal: 6, rewardChips: 90, event: 'hand_won' },
    { key: 'daily_rounds_12', title: 'Long Session', description: 'Play 12 rounds', goal: 12, rewardChips: 105, event: 'round_played' },
    { key: 'daily_blackjack_2', title: 'Double Natural', description: 'Hit 2 natural blackjacks', goal: 2, rewardChips: 115, event: 'blackjack' },
    { key: 'daily_round_win_5', title: 'Momentum Builder', description: 'Win 5 rounds', goal: 5, rewardChips: 145, event: 'round_won' }
  ],
  weekly: [
    { key: 'weekly_hands_played_90', title: 'High Volume', description: 'Play 90 hands', goal: 90, rewardChips: 260, event: 'hand_played' },
    { key: 'weekly_hands_won_40', title: 'Heat Check', description: 'Win 40 hands', goal: 40, rewardChips: 420, event: 'hand_won' },
    { key: 'weekly_pushes_18', title: 'Deadlock', description: 'Get 18 pushes', goal: 18, rewardChips: 320, event: 'push' },
    { key: 'weekly_blackjack_10', title: 'High Roller Naturals', description: 'Hit 10 natural blackjacks', goal: 10, rewardChips: 600, event: 'blackjack' },
    { key: 'weekly_rounds_35', title: 'Table Marathon', description: 'Play 35 rounds', goal: 35, rewardChips: 240, event: 'round_played' },
    { key: 'weekly_split_win_12', title: 'Split Maestro', description: 'Win 12 split hands', goal: 12, rewardChips: 520, event: 'split_win' },
    { key: 'weekly_round_win_14', title: 'Weekly Victor', description: 'Win 14 rounds', goal: 14, rewardChips: 480, event: 'round_won' },
    { key: 'weekly_rounds_20', title: 'Steady Presence', description: 'Play 20 rounds', goal: 20, rewardChips: 220, event: 'round_played' },
    { key: 'weekly_hands_lost_25', title: 'Resilient Grinder', description: 'Complete 25 losing hands', goal: 25, rewardChips: 230, event: 'hand_lost' },
    { key: 'weekly_round_win_8', title: 'Seasoned Winner', description: 'Win 8 rounds', goal: 8, rewardChips: 340, event: 'round_won' }
  ]
};

const SKILL_CHALLENGE_DEFS = [
  { key: 'skill_win_no_bust', title: 'Clean Win', description: 'Win 2 hands without busting', goal: 2, rewardChips: 40, event: 'win_no_bust' },
  { key: 'skill_stand_16', title: 'Disciplined Stand', description: 'Stand on 16+ three times', goal: 3, rewardChips: 35, event: 'stand_16_plus' },
  { key: 'skill_blackjack', title: 'Natural Talent', description: 'Get a blackjack', goal: 1, rewardChips: 50, event: 'blackjack' },
  { key: 'skill_practice_hands', title: 'Table Reps', description: 'Play 5 real-bet hands', goal: 5, rewardChips: 30, event: 'hand_played' }
];

const BOT_ACCURACY = {
  easy: 0.5,
  medium: 0.72,
  normal: 0.9
};

const PHASES = {
  LOBBY: 'LOBBY',
  ROUND_INIT: 'ROUND_INIT',
  DEAL: 'DEAL',
  ACTION_TURN: 'ACTION_TURN',
  PRESSURE_RESPONSE: 'PRESSURE_RESPONSE',
  HAND_ADVANCE: 'HAND_ADVANCE',
  ROUND_RESOLVE: 'ROUND_RESOLVE',
  REVEAL: 'REVEAL',
  RESULT: 'RESULT',
  NEXT_ROUND: 'NEXT_ROUND'
};

function resolveStakeType(rawStakeType) {
  return String(rawStakeType || '').toUpperCase() === 'REAL' ? 'REAL' : 'FAKE';
}

function resolveMatchMode(stakeType) {
  return resolveStakeType(stakeType) === 'REAL' ? 'real' : 'practice';
}

function isPracticeMatch(match) {
  if (!match) return false;
  if (match.mode === 'practice') return true;
  if (match.mode === 'real') return false;
  if (typeof match.isPractice === 'boolean') return match.isPractice;
  if (match.stakeType) return resolveMatchMode(match.stakeType) === 'practice';
  return false;
}

function isRealMatch(match) {
  return !isPracticeMatch(match);
}

const RULES = {
  DEALER_ENABLED: false,
  BLACKJACK_PAYOUT_MULTIPLIER: 1,
  NATURAL_BLACKJACK_BEATS_NON_BLACKJACK_21: true,
  PUSH_ON_EQUAL_TOTAL: true,
  BOTH_BUST_IS_PUSH: false,
  SURRENDER_LOSS_FRACTION: 0.75,
  MAX_SPLITS: 3,
  MAX_HANDS_PER_PLAYER: 4,
  MAX_DOUBLES_PER_HAND: 1,
  ALL_IN_ON_INSUFFICIENT_BASE_BET: true
};

function getBetLimitsForDifficulty(difficulty = 'normal') {
  return BOT_BET_LIMITS[difficulty] || BOT_BET_LIMITS.normal;
}

function clampBet(amount, balance = MAX_BET_CAP, limits = { min: MIN_BET, max: MAX_BET_CAP }) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return BASE_BET;
  const min = Math.max(1, Math.floor(Number(limits?.min ?? MIN_BET)));
  const max = Math.max(min, Math.floor(Number(limits?.max ?? MAX_BET_CAP)));
  const bounded = Math.max(min, Math.min(max, Math.floor(numeric)));
  return Math.min(bounded, Math.max(0, Math.floor(balance)));
}

function getMatchBetLimits(match) {
  const quickPlayBucket = normalizeQuickPlayBucket(match?.quickPlayBucket);
  if (quickPlayBucket) return { min: quickPlayBucket, max: quickPlayBucket };
  const botId = match?.playerIds?.find((id) => isBotPlayer(id));
  if (!botId) return { min: MIN_BET, max: MAX_BET_CAP };
  const difficulty = getBotDifficulty(match, botId);
  return getBetLimitsForDifficulty(difficulty);
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

function randomIntInclusive(min, max) {
  const lo = Math.max(0, Math.floor(Number(min) || 0));
  const hi = Math.max(lo, Math.floor(Number(max) || lo));
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function ensureBotPacingState(round) {
  if (!round.botPacing || typeof round.botPacing !== 'object') {
    round.botPacing = { firstActionDoneById: {} };
  }
  if (!round.botPacing.firstActionDoneById || typeof round.botPacing.firstActionDoneById !== 'object') {
    round.botPacing.firstActionDoneById = {};
  }
  return round.botPacing;
}

function markBotActionCompleted(match, botId) {
  if (!match?.round || !botId) return;
  const pacing = ensureBotPacingState(match.round);
  pacing.firstActionDoneById[botId] = true;
}

function botTurnDelayMs(match, botId) {
  if (!match?.round || !botId) return randomIntInclusive(BOT_ACTION_DELAY_MIN_MS, BOT_ACTION_DELAY_MAX_MS);
  const pacing = ensureBotPacingState(match.round);
  const botStartsRound = match.round.firstActionPlayerId === botId;
  const firstDecisionPending = botStartsRound && !match.round.firstActionTaken && !pacing.firstActionDoneById[botId];
  if (
    match.phase === PHASES.ACTION_TURN &&
    match.round.turnPlayerId === botId &&
    firstDecisionPending
  ) {
    return randomIntInclusive(BOT_FIRST_ACTION_DELAY_MIN_MS, BOT_FIRST_ACTION_DELAY_MAX_MS);
  }
  return randomIntInclusive(BOT_ACTION_DELAY_MIN_MS, BOT_ACTION_DELAY_MAX_MS);
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
  const lastClaim = user?.lastStreakClaimAt || user?.lastFreeClaimAt || null;
  const lastTs = lastClaim ? new Date(lastClaim).getTime() : 0;
  const nextTs = lastTs ? lastTs + FREE_CLAIM_COOLDOWN_MS : 0;
  const nowTs = Date.now();
  const streakCount = Math.max(0, Number(user?.streakCount || 0));
  const nextReward = STREAK_REWARDS[streakCount % STREAK_REWARDS.length];
  return {
    available: !lastTs || nowTs >= nextTs,
    nextAt: nextTs ? new Date(nextTs).toISOString() : null,
    streakCount,
    nextReward
  };
}

function sameUtcDay(a, b) {
  if (!a || !b) return false;
  return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
}

function previousUtcDayIso(isoDate) {
  const d = new Date(isoDate);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
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
  const streak = freeClaimMeta(user);
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    avatarUrl: user.avatar,
    avatarStyle: user.avatarStyle || 'adventurer',
    avatarSeed: user.avatarSeed || user.username,
    bio: user.bio,
    chips: user.chips,
    bankroll: user.chips,
    stats: user.stats,
    betHistory: (user.betHistory || []).slice(0, 10),
    selectedBet: user.selectedBet || BASE_BET,
    hasClaimedFree100: Boolean(user.lastStreakClaimAt || user.lastFreeClaimAt),
    streakCount: streak.streakCount,
    nextStreakReward: streak.nextReward
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
  const raw = String(username || '').trim();
  const normalized = normalizeUsername(raw);
  if (!normalized) return null;
  let user =
    db.data.users.find((u) => normalizeUsername(u.usernameKey) === normalized) ||
    db.data.users.find((u) => normalizeUsername(u.username) === normalized) ||
    db.data.users.find((u) => String(u.username || '').trim() === raw) ||
    db.data.users.find((u) => normalizeUsername(u.name) === normalized) ||
    db.data.users.find((u) => normalizeUsername(u.handle) === normalized);

  if (user && !user.usernameKey) {
    user.usernameKey = normalizeUsername(user.username || raw);
  }
  return user;
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
    requestId: typeof notification.requestId === 'string' ? notification.requestId : null,
    fromUserId: typeof notification.fromUserId === 'string' ? notification.fromUserId : null,
    read: false
  };
  user.notifications.unshift(payload);
  user.notifications = user.notifications.slice(0, 60);
  // Real-time inbox push for connected clients.
  emitToUser(userId, 'notify:new', payload);
}

function isUserInActiveMatch(userId) {
  for (const match of matches.values()) {
    if (match.playerIds.includes(userId)) return true;
  }
  return false;
}

function normalizeQuickPlayBucket(rawBucket) {
  const numeric = Math.floor(Number(rawBucket));
  if (!Number.isFinite(numeric)) return null;
  return QUICK_PLAY_BUCKETS.includes(numeric) ? numeric : null;
}

function canJoinQuickPlayBucket(user, bucket) {
  const normalized = normalizeQuickPlayBucket(bucket);
  if (!user || !normalized) return false;
  const chips = Math.max(0, Math.floor(Number(user.chips) || 0));
  return chips >= normalized;
}

function getQuickPlayQueue(bucket) {
  const normalized = normalizeQuickPlayBucket(bucket);
  if (!normalized) return [];
  if (!quickPlayQueuesByBucket.has(normalized)) {
    quickPlayQueuesByBucket.set(normalized, []);
  }
  return quickPlayQueuesByBucket.get(normalized);
}

function quickPlayQueueStatus(userId) {
  const bucket = quickPlayBucketByUser.get(userId) || null;
  if (!bucket) {
    return { bucket: null, queuePosition: null, queuedAt: null };
  }
  const queue = getQuickPlayQueue(bucket);
  const index = queue.findIndex((entry) => entry.userId === userId);
  if (index === -1) {
    quickPlayBucketByUser.delete(userId);
    return { bucket: null, queuePosition: null, queuedAt: null };
  }
  return {
    bucket,
    queuePosition: index + 1,
    queuedAt: queue[index].queuedAt || null
  };
}

function enqueueQuickPlayUser(userId, bucket) {
  const normalized = normalizeQuickPlayBucket(bucket);
  if (!normalized) return { error: 'Invalid quick play bucket' };
  const currentBucket = quickPlayBucketByUser.get(userId);
  if (currentBucket && currentBucket !== normalized) {
    removeFromQuickPlayQueue(userId);
  }
  if (quickPlayBucketByUser.get(userId) === normalized) {
    const queue = getQuickPlayQueue(normalized);
    const existing = queue.find((entry) => entry.userId === userId) || null;
    return {
      ok: true,
      queuedAt: existing?.queuedAt || nowIso(),
      queuePosition: existing ? queue.indexOf(existing) + 1 : null,
      bucket: normalized
    };
  }
  const queue = getQuickPlayQueue(normalized);
  const queuedAt = nowIso();
  queue.push({ userId, bucket: normalized, queuedAt });
  quickPlayBucketByUser.set(userId, normalized);
  return {
    ok: true,
    queuedAt,
    queuePosition: queue.length,
    bucket: normalized
  };
}

function removeFromQuickPlayQueue(userId) {
  const bucket = quickPlayBucketByUser.get(userId);
  if (!bucket) return false;
  quickPlayBucketByUser.delete(userId);
  const queue = getQuickPlayQueue(bucket);
  const idx = queue.findIndex((entry) => entry.userId === userId);
  if (idx !== -1) queue.splice(idx, 1);
  return idx !== -1;
}

function popNextQuickPlayEntry(bucket, excludeUserId = null) {
  const queue = getQuickPlayQueue(bucket);
  while (queue.length > 0) {
    const entry = queue.shift();
    quickPlayBucketByUser.delete(entry.userId);
    if (excludeUserId && entry.userId === excludeUserId) continue;
    if (!getUserById(entry.userId)) continue;
    if (isUserInActiveMatch(entry.userId)) continue;
    return entry;
  }
  return null;
}

function buildQuickPlayFoundPayload(match, userId, bucket) {
  const opponentId = match.playerIds.find((id) => id !== userId);
  const opponent = getUserById(opponentId);
  return {
    status: 'found',
    matchId: match.id,
    bucket,
    fixedBet: bucket,
    opponentId,
    opponentName: opponent?.username || 'Opponent',
    connectedAt: nowIso(),
    match: serializeMatchFor(match, userId)
  };
}

async function processQuickPlayQueue(bucket) {
  const normalizedBucket = normalizeQuickPlayBucket(bucket);
  if (!normalizedBucket) return [];
  const matched = [];
  let touched = false;
  const queue = getQuickPlayQueue(normalizedBucket);
  while (queue.length >= 2) {
    const first = popNextQuickPlayEntry(normalizedBucket);
    if (!first) break;
    const second = popNextQuickPlayEntry(normalizedBucket, first.userId);
    if (!second) {
      if (!quickPlayBucketByUser.has(first.userId) && !isUserInActiveMatch(first.userId)) {
        queue.push(first);
        quickPlayBucketByUser.set(first.userId, normalizedBucket);
      }
      break;
    }
    const userA = getUserById(first.userId);
    const userB = getUserById(second.userId);
    if (!userA || !userB || userA.id === userB.id) continue;
    if (!canJoinQuickPlayBucket(userA, normalizedBucket)) {
      emitToUser(userA.id, 'matchmaking:error', { error: `Need at least ${normalizedBucket} chips for this Quick Play bucket` });
      if (!quickPlayBucketByUser.has(userB.id) && !isUserInActiveMatch(userB.id)) {
        queue.unshift(second);
        quickPlayBucketByUser.set(userB.id, normalizedBucket);
      }
      continue;
    }
    if (!canJoinQuickPlayBucket(userB, normalizedBucket)) {
      emitToUser(userB.id, 'matchmaking:error', { error: `Need at least ${normalizedBucket} chips for this Quick Play bucket` });
      if (!quickPlayBucketByUser.has(userA.id) && !isUserInActiveMatch(userA.id)) {
        queue.unshift(first);
        quickPlayBucketByUser.set(userA.id, normalizedBucket);
      }
      continue;
    }

    const lobby = {
      id: normalizeLobbyCode(nanoid(8)),
      ownerId: userA.id,
      opponentId: userB.id,
      status: 'full',
      type: 'quickplay',
      stakeType: 'REAL',
      quickPlayBucket: normalizedBucket,
      createdAt: nowIso()
    };
    db.data.lobbies.push(lobby);
    const match = createMatch(lobby, { quickPlayBucket: normalizedBucket });
    pushMatchState(match);
    touched = true;

    matched.push({
      userId: userA.id,
      payload: buildQuickPlayFoundPayload(match, userA.id, normalizedBucket)
    });
    matched.push({
      userId: userB.id,
      payload: buildQuickPlayFoundPayload(match, userB.id, normalizedBucket)
    });
  }

  if (touched) await db.write();
  for (const result of matched) {
    emitToUser(result.userId, 'matchmaking:found', result.payload);
  }
  return matched;
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
      online: Boolean(activeSessions.get(friend.id)),
      presence: isUserInActiveMatch(friend.id) ? 'in_match' : activeSessions.get(friend.id) ? 'online' : 'offline'
    }));
  const incomingChallenges = (db.data.friendChallenges || [])
    .filter((c) => c.toUserId === user.id && c.status === 'pending' && new Date(c.expiresAt).getTime() > Date.now())
    .map((c) => ({
      id: c.id,
      fromUserId: c.fromUserId,
      fromUsername: getUserById(c.fromUserId)?.username || 'Unknown',
      bet: c.bet,
      message: c.message || '',
      expiresAt: c.expiresAt
    }));

  const outgoingChallenges = (db.data.friendChallenges || [])
    .filter((c) => c.fromUserId === user.id && c.status === 'pending' && new Date(c.expiresAt).getTime() > Date.now())
    .map((c) => ({
      id: c.id,
      toUserId: c.toUserId,
      toUsername: getUserById(c.toUserId)?.username || 'Unknown',
      bet: c.bet,
      message: c.message || '',
      expiresAt: c.expiresAt
    }));

  return { friends, incoming, outgoing, incomingChallenges, outgoingChallenges };
}

function getParticipantChips(match, playerId) {
  if (isBotPlayer(playerId)) {
    return BOT_UNLIMITED_BANKROLL;
  }
  if (isPracticeMatch(match) && match.practiceBankrollById) {
    return match.practiceBankrollById[playerId] ?? STARTING_CHIPS;
  }
  return getUserById(playerId)?.chips ?? STARTING_CHIPS;
}

function setParticipantChips(match, playerId, chips) {
  if (isBotPlayer(playerId)) {
    return;
  }
  const safe = Math.max(0, Math.floor(chips));
  if (isPracticeMatch(match)) {
    if (!match.practiceBankrollById) match.practiceBankrollById = {};
    match.practiceBankrollById[playerId] = safe;
    return;
  }
  const user = getUserById(playerId);
  if (user) user.chips = safe;
}

function canAffordIncrement(match, playerId, amount) {
  if (isBotPlayer(playerId)) return true;
  return getParticipantChips(match, playerId) >= amount;
}

function appendBetHistory(user, entry) {
  if (!user) return;
  if (!Array.isArray(user.betHistory)) user.betHistory = [];
  user.betHistory.unshift({
    id: nanoid(8),
    time: nowIso(),
    ...entry
  });
  user.betHistory = user.betHistory.slice(0, 10);
}

function matchHistoryModeLabel(match) {
  if (!match) return 'Challenge PvP';
  if (match.matchType === 'bot') {
    return isPracticeMatch(match) ? 'Bot Practice' : 'Bot Real';
  }
  return isPracticeMatch(match) ? 'Friendly PvP' : 'Challenge PvP';
}

function countWinningSplitHandsForPlayer(outcomes, playerId) {
  if (!Array.isArray(outcomes) || !playerId) return 0;
  return outcomes.reduce((count, out) => {
    if (!out || out.winner !== playerId) return count;
    return count + (out.winnerHandWasSplit ? 1 : 0);
  }, 0);
}

function creditUserBankroll(user, rewardChips) {
  if (!user) return 0;
  const delta = Math.max(0, Math.floor(Number(rewardChips) || 0));
  user.chips = Math.max(0, Math.floor(Number(user.chips) || 0) + delta);
  return user.chips;
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
    actionCount: 0,
    bust: false,
    doubled: false,
    doubleCount: 0,
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

function clearRoundPhaseTimer(matchId) {
  const timer = roundPhaseTimers.get(matchId);
  if (timer) {
    clearTimeout(timer);
    roundPhaseTimers.delete(matchId);
  }
}

// Build per-viewer sanitized state to avoid leaking opponent hole/hit cards.
function buildClientState(match, viewerId) {
  const round = match.round;
  const betLimits = getMatchBetLimits(match);
  const players = {};
  const revealAllTotals =
    match.phase === PHASES.ROUND_RESOLVE ||
    match.phase === PHASES.REVEAL ||
    match.phase === PHASES.RESULT ||
    match.phase === PHASES.NEXT_ROUND;
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
          actionCount: hand.actionCount || 0,
          bust: hand.bust,
          doubled: hand.doubled,
          doubleCount: hand.doubleCount || 0,
          splitDepth: hand.splitDepth,
          totalKnown: !hasHiddenToViewer,
          visibleTotal: visibleMeta.total,
          total: hasHiddenToViewer ? null : fullMeta.total,
          isSoft: hasHiddenToViewer ? visibleMeta.isSoft : fullMeta.isSoft,
          outcome: hand.outcome || null,
          cards: hand.cards.map((card, idx) => {
            const hiddenToViewer = !isViewer && !revealAllTotals && idx > 0;
            if (hiddenToViewer) return { id: card.id || null, hidden: true };
            return { id: card.id || null, rank: card.rank, suit: card.suit };
          }),
          naturalBlackjack: Boolean(hand.naturalBlackjack)
        };
      })
    };
  }
  return {
    id: match.id,
    lobbyId: match.lobbyId,
    matchType: match.matchType || null,
    participants: match.participants,
    mode: match.mode || (isPracticeMatch(match) ? 'practice' : 'real'),
    isPractice: isPracticeMatch(match),
    quickPlayBucket: normalizeQuickPlayBucket(match.quickPlayBucket),
    roundNumber: match.roundNumber,
    phase: match.phase,
    playerIds: match.playerIds,
    currentTurn: round.turnPlayerId,
    turnExpiresAt: round.turnExpiresAt || null,
    turnTimeoutMs: TURN_TIMEOUT_MS,
    pendingPressure: round.pendingPressure,
    baseBet: round.baseBet,
    betLocked: Boolean(round.firstActionTaken),
    selectedBet: match.betSettings?.selectedBetById?.[viewerId] || BASE_BET,
    canEditBet:
      match.phase === PHASES.ROUND_INIT &&
      !normalizeQuickPlayBucket(match.quickPlayBucket) &&
      viewerId === match.betControllerId &&
      !round.betConfirmedByPlayer?.[viewerId],
    canConfirmBet: match.phase === PHASES.ROUND_INIT && !round.betConfirmedByPlayer?.[viewerId],
    betConfirmedByPlayer: round.betConfirmedByPlayer,
    minBet: betLimits.min,
    maxDoublesPerHand: RULES.MAX_DOUBLES_PER_HAND,
    maxBetCap: betLimits.max,
    maxHandsPerPlayer: RULES.MAX_HANDS_PER_PLAYER,
    betControllerId: match.betControllerId,
    postedBetByPlayer: round.postedBetByPlayer,
    allInPlayers: round.allInPlayers,
    firstActionPlayerId: round.firstActionPlayerId,
    roundResult: round.resultByPlayer?.[viewerId] || null,
    resultChoiceByPlayer: round.resultChoiceByPlayer || {},
    chat: Array.isArray(match.chat) ? match.chat : [],
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
  syncAfkTurnTimer(match);
  for (const pid of match.playerIds) {
    const socketId = activeSessions.get(pid);
    if (!socketId) continue;
    io.to(socketId).emit('match:state', buildClientState(match, pid));
  }
}

function clearAfkTurnTimer(matchId) {
  const timer = afkTurnTimers.get(matchId);
  if (timer) {
    clearTimeout(timer);
    afkTurnTimers.delete(matchId);
  }
}

function syncAfkTurnTimer(match) {
  clearAfkTurnTimer(match.id);
  if (!match || !match.round) return;
  if (match.phase !== PHASES.ACTION_TURN || match.round?.pendingPressure) {
    match.round.turnExpiresAt = null;
    return;
  }
  const turnPlayerId = match.round.turnPlayerId;
  if (!turnPlayerId) {
    match.round.turnExpiresAt = null;
    return;
  }
  const turnState = match.round.players?.[turnPlayerId];
  const activeIndex = turnState?.activeHandIndex ?? 0;
  const activeHand = turnState?.hands?.[activeIndex];
  if (!activeHand || activeHand.locked || activeHand.bust || activeHand.surrendered || activeHand.stood) {
    match.round.turnExpiresAt = null;
    return;
  }

  match.round.turnExpiresAt = new Date(Date.now() + TURN_TIMEOUT_MS).toISOString();

  const timer = setTimeout(() => {
    if (!matches.has(match.id)) return;
    if (match.phase !== PHASES.ACTION_TURN || match.round?.pendingPressure) return;
    if (match.round.turnPlayerId !== turnPlayerId) return;
    const latestState = match.round.players?.[turnPlayerId];
    const latestHand = latestState?.hands?.[latestState.activeHandIndex];
    if (!latestHand || latestHand.locked || latestHand.bust || latestHand.surrendered || latestHand.stood) return;
    const result = applyAction(match, turnPlayerId, 'stand');
    if (result?.error) return;
    pushMatchState(match);
    db.write();
    scheduleBotTurn(match);
  }, TURN_TIMEOUT_MS);

  afkTurnTimers.set(match.id, timer);
}

function challengeExpiresAt(tier, from = new Date()) {
  const startMs = new Date(from).getTime();
  if (!Number.isFinite(startMs)) return new Date(Date.now() + DAILY_RESET_MS).toISOString();
  if (tier === 'hourly') {
    return new Date(startMs + HOURLY_RESET_MS).toISOString();
  }
  if (tier === 'daily') {
    return new Date(startMs + DAILY_RESET_MS).toISOString();
  }
  return new Date(startMs + WEEKLY_RESET_MS).toISOString();
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
        resetAt: expiresAt,
        completedAt: null,
        claimed: false,
        claimedAt: null
      }));
      user.challengeSets[tier] = { tier, expiresAt, items };
      changed = true;
    } else {
      const resetAt = current.expiresAt || challengeExpiresAt(tier, now);
      if (!current.expiresAt) {
        current.expiresAt = resetAt;
        changed = true;
      }
      for (const item of current.items) {
        const goal = Math.max(1, Math.floor(Number(item.goal) || 1));
        const progress = Math.max(0, Math.min(goal, Math.floor(Number(item.progress) || 0)));
        if (item.goal !== goal) {
          item.goal = goal;
          changed = true;
        }
        if (item.progress !== progress) {
          item.progress = progress;
          changed = true;
        }
        if (!item.expiresAt) {
          item.expiresAt = resetAt;
          changed = true;
        }
        if (!item.resetAt) {
          item.resetAt = item.expiresAt;
          changed = true;
        }
        if (item.claimed === undefined) {
          item.claimed = Boolean(item.claimedAt);
          changed = true;
        }
        if (item.claimed && !item.claimedAt) {
          item.claimedAt = nowIso();
          changed = true;
        }
        if (progress >= goal && !item.completedAt) {
          item.completedAt = nowIso();
          changed = true;
        }
      }
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
      if (item.claimed || item.claimedAt) continue;
      if (item.event !== event) continue;
      item.progress = Math.min(item.goal, Math.max(0, Math.floor(Number(item.progress) || 0)) + amount);
      if (item.progress >= item.goal && !item.completedAt) {
        item.completedAt = nowIso();
      }
    }
  }
}

function recordChallengeEventForMatch(match, user, event, amount = 1) {
  if (!isRealMatch(match)) return false;
  recordChallengeEvent(user, event, amount);
  return true;
}

function ensureSkillChallenges(user) {
  if (!Array.isArray(user.skillChallenges)) {
    user.skillChallenges = [];
  }
  if (user.skillChallenges.length === 0) {
    user.skillChallenges = SKILL_CHALLENGE_DEFS.map((def) => ({
      id: def.key,
      key: def.key,
      title: def.title,
      description: def.description,
      goal: def.goal,
      progress: 0,
      rewardChips: def.rewardChips,
      event: def.event,
      completedAt: null,
      claimed: false,
      claimedAt: null
    }));
    return true;
  }
  let changed = false;
  for (const def of SKILL_CHALLENGE_DEFS) {
    const existing = user.skillChallenges.find((item) => item.key === def.key || item.id === def.key);
    if (!existing) {
      user.skillChallenges.push({
        id: def.key,
        key: def.key,
        title: def.title,
        description: def.description,
        goal: def.goal,
        progress: 0,
        rewardChips: def.rewardChips,
        event: def.event,
        completedAt: null,
        claimed: false,
        claimedAt: null
      });
      changed = true;
      continue;
    }
    if (existing.id !== def.key) {
      existing.id = def.key;
      changed = true;
    }
    if (existing.key !== def.key) {
      existing.key = def.key;
      changed = true;
    }
    if (existing.title !== def.title) {
      existing.title = def.title;
      changed = true;
    }
    if (existing.description !== def.description) {
      existing.description = def.description;
      changed = true;
    }
    if (existing.goal !== def.goal) {
      existing.goal = def.goal;
      changed = true;
    }
    if (existing.rewardChips !== def.rewardChips) {
      existing.rewardChips = def.rewardChips;
      changed = true;
    }
    if (existing.event !== def.event) {
      existing.event = def.event;
      changed = true;
    }
    const normalizedProgress = Math.max(0, Math.min(existing.goal, Math.floor(Number(existing.progress) || 0)));
    if (existing.progress !== normalizedProgress) {
      existing.progress = normalizedProgress;
      changed = true;
    }
    if (existing.claimed === undefined) {
      existing.claimed = Boolean(existing.claimedAt);
      changed = true;
    }
    if (existing.claimed && !existing.claimedAt) {
      existing.claimedAt = nowIso();
      changed = true;
    }
    if (existing.progress >= existing.goal && !existing.completedAt) {
      existing.completedAt = nowIso();
      changed = true;
    }
  }
  return changed;
}

function recordSkillEvent(user, event, amount = 1) {
  if (!user || !event || amount <= 0) return;
  ensureSkillChallenges(user);
  for (const item of user.skillChallenges) {
    if (item.claimed || item.claimedAt) continue;
    if (item.event !== event) continue;
    item.progress = Math.min(item.goal, Math.max(0, Math.floor(Number(item.progress) || 0)) + amount);
    if (item.progress >= item.goal && !item.completedAt) {
      item.completedAt = nowIso();
    }
  }
}

function buildChallengePayload(user) {
  const now = new Date();
  const resets = {
    hourly: user.challengeSets?.hourly?.expiresAt || challengeExpiresAt('hourly', now),
    daily: user.challengeSets?.daily?.expiresAt || challengeExpiresAt('daily', now),
    weekly: user.challengeSets?.weekly?.expiresAt || challengeExpiresAt('weekly', now)
  };
  const challenges = {
    hourly: (user.challengeSets?.hourly?.items || []).map((item) => ({
      ...item,
      expiresAt: item.expiresAt || resets.hourly,
      resetAt: item.resetAt || item.expiresAt || resets.hourly
    })),
    daily: (user.challengeSets?.daily?.items || []).map((item) => ({
      ...item,
      expiresAt: item.expiresAt || resets.daily,
      resetAt: item.resetAt || item.expiresAt || resets.daily
    })),
    weekly: (user.challengeSets?.weekly?.items || []).map((item) => ({
      ...item,
      expiresAt: item.expiresAt || resets.weekly,
      resetAt: item.resetAt || item.expiresAt || resets.weekly
    })),
    skill: (user.skillChallenges || []).map((item) => ({ ...item }))
  };
  const challengeList = [...challenges.hourly, ...challenges.daily, ...challenges.weekly];
  return {
    challenges,
    challengeList,
    challengeResets: resets,
    hourlyResetAt: resets.hourly,
    dailyResetAt: resets.daily,
    weeklyResetAt: resets.weekly,
    nextDailyResetAt: resets.daily,
    nextWeeklyResetAt: resets.weekly
  };
}

function startRound(match) {
  const [p1, p2] = match.playerIds;
  const betLimits = getMatchBetLimits(match);
  const forcedQuickPlayBucket = normalizeQuickPlayBucket(match.quickPlayBucket);
  const controllerId = match.betControllerId || p1;
  if (!match.betSettings) match.betSettings = { selectedBetById: {} };
  if (forcedQuickPlayBucket) {
    match.betSettings.selectedBetById[p1] = forcedQuickPlayBucket;
    match.betSettings.selectedBetById[p2] = forcedQuickPlayBucket;
  }
  const controllerBalance = getParticipantChips(match, controllerId);
  const desiredBase = forcedQuickPlayBucket || match.betSettings?.selectedBetById?.[controllerId] || BASE_BET;
  const proposedBase = clampBet(desiredBase, controllerBalance || betLimits.min, betLimits);
  const baseBet = Math.max(betLimits.min, proposedBase || betLimits.min);

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
    botPacing: { firstActionDoneById: {} },
    resultChoiceByPlayer: {},
    firstActionPlayerId: null,
    turnPlayerId: null,
    resultByPlayer: null,
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
  clearRoundPhaseTimer(match.id);
  match.phase = PHASES.ROUND_INIT;
  match.roundNumber += 1;

  const u1 = getUserById(p1);
  const u2 = getUserById(p2);
  if (isRealMatch(match)) {
    if (u1) recordChallengeEventForMatch(match, u1, 'round_played', 1);
    if (u2) recordChallengeEventForMatch(match, u2, 'round_played', 1);
    db.write();
  }

  pushMatchState(match);
  scheduleBotBetConfirm(match);
  scheduleBotTurn(match);
}

function beginActionPhase(match) {
  const [p1, p2] = match.playerIds;
  match.phase = PHASES.DEAL;
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

  if (isRealMatch(match)) {
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
  clearRoundPhaseTimer(match.id);
  match.phase = PHASES.ROUND_RESOLVE;
  const realMatch = isRealMatch(match);
  const [aId, bId] = match.playerIds;
  const a = match.round.players[aId];
  const b = match.round.players[bId];
  const userA = getUserById(aId);
  const userB = getUserById(bId);
  const bankrollBefore = {
    [aId]: getParticipantChips(match, aId),
    [bId]: getParticipantChips(match, bId)
  };
  const chipsDelta = {
    [aId]: 0,
    [bId]: 0
  };

  const outcomes = [];

  function compareHands(handA, handB) {
    if (handA.surrendered && handB.surrendered) return 0;
    if (handA.surrendered) return -1;
    if (handB.surrendered) return 1;
    if (handA.bust && handB.bust) return -1;
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
      outcomes.push({ winner: bId, loser: aId, amount, handIndex: idx, winnerHandWasSplit: Boolean(handB?.wasSplitHand) });
    } else if (handB.surrendered) {
      const amount = Math.floor(handB.bet * RULES.SURRENDER_LOSS_FRACTION);
      chipsDelta[aId] += amount;
      chipsDelta[bId] -= amount;
      handA.outcome = 'win';
      handB.outcome = 'loss';
      outcomes.push({ winner: aId, loser: bId, amount, handIndex: idx, winnerHandWasSplit: Boolean(handA?.wasSplitHand) });
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
        outcomes.push({ winner: aId, loser: bId, amount, handIndex: idx, winnerHandWasSplit: Boolean(handA?.wasSplitHand) });
      } else if (result < 0) {
        const amount = handBNatural && !handANatural ? Math.floor(pot * 1.5) : pot;
        chipsDelta[aId] -= amount;
        chipsDelta[bId] += amount;
        handA.outcome = 'loss';
        handB.outcome = handB.outcome || 'win';
        outcomes.push({ winner: bId, loser: aId, amount, handIndex: idx, winnerHandWasSplit: Boolean(handB?.wasSplitHand) });
      } else {
        handA.outcome = 'push';
        if (!handB.outcome) handB.outcome = 'push';
        outcomes.push({ winner: null, loser: null, amount: 0, handIndex: idx, winnerHandWasSplit: false });
      }
    }
  }

  if (realMatch) {
    setParticipantChips(match, aId, getParticipantChips(match, aId) + chipsDelta[aId]);
    setParticipantChips(match, bId, getParticipantChips(match, bId) + chipsDelta[bId]);
  }
  const bankrollAfter = {
    [aId]: getParticipantChips(match, aId),
    [bId]: getParticipantChips(match, bId)
  };

  function applyHandOutcomeStats(user, ownId, out, hand) {
    if (!user) return;
    const stats = user.stats || (user.stats = cloneUserStatsDefaults());
    const isBotOpponent = isBotPlayer(nextPlayerId(match, ownId));
    if (isBotOpponent) {
      if (isPracticeMatch(match)) stats.handsPlayedBotPractice = (stats.handsPlayedBotPractice || 0) + 1;
      else stats.handsPlayedBotReal = (stats.handsPlayedBotReal || 0) + 1;
    } else {
      if (isPracticeMatch(match)) stats.handsPlayedPvpFriendly = (stats.handsPlayedPvpFriendly || 0) + 1;
      else stats.handsPlayedPvpReal = (stats.handsPlayedPvpReal || 0) + 1;
    }

    if (!realMatch) return;

    const ownWon = out.winner === ownId;
    const ownLost = out.loser === ownId;
    const ownPush = !ownWon && !ownLost;
    const handCards = Array.isArray(hand?.cards) ? hand.cards : [];
    const handBet = Math.max(0, Math.floor(Number(hand?.bet) || 0));
    const handCardsCount = handCards.length;
    const handSummary = handMeta(handCards);

    stats.handsPlayed = (stats.handsPlayed || 0) + 1;
    stats.realBetSum = (stats.realBetSum || 0) + handBet;
    stats.realBetCount = (stats.realBetCount || 0) + 1;
    recordChallengeEvent(user, 'hand_played', 1);

    if (!handSummary.isBust) {
      stats.highestSafeTotal = Math.max(stats.highestSafeTotal || 0, handSummary.total || 0);
    }
    if (handSummary.total === 21) {
      if (handCardsCount === 4) stats.fourCard21s = (stats.fourCard21s || 0) + 1;
      else if (handCardsCount === 5) stats.fiveCard21s = (stats.fiveCard21s || 0) + 1;
      else if (handCardsCount === 6) stats.sixCard21s = (stats.sixCard21s || 0) + 1;
      else if (handCardsCount >= 7) stats.sevenPlusCard21s = (stats.sevenPlusCard21s || 0) + 1;
    }
    if (hand?.bust) stats.busts = (stats.busts || 0) + 1;
    if (hand?.surrendered) stats.surrenders = (stats.surrenders || 0) + 1;

    if (ownWon) {
      stats.handsWon = (stats.handsWon || 0) + 1;
      stats.currentWinStreak = (stats.currentWinStreak || 0) + 1;
      stats.currentLossStreak = 0;
      stats.longestWinStreak = Math.max(stats.longestWinStreak || 0, stats.currentWinStreak || 0);
      stats.totalChipsWon = (stats.totalChipsWon || 0) + (out.amount || 0);
      stats.biggestHandWin = Math.max(stats.biggestHandWin || 0, out.amount || 0);
      if (!hand?.bust) stats.maxCardsInWinningHand = Math.max(stats.maxCardsInWinningHand || 0, handCardsCount);
      recordChallengeEvent(user, 'hand_won', 1);
    } else if (ownLost) {
      stats.handsLost = (stats.handsLost || 0) + 1;
      stats.currentLossStreak = (stats.currentLossStreak || 0) + 1;
      stats.currentWinStreak = 0;
      stats.longestLossStreak = Math.max(stats.longestLossStreak || 0, stats.currentLossStreak || 0);
      stats.totalChipsLost = (stats.totalChipsLost || 0) + (out.amount || 0);
      stats.biggestHandLoss = Math.max(stats.biggestHandLoss || 0, out.amount || 0);
      recordChallengeEvent(user, 'hand_lost', 1);
    } else if (ownPush) {
      stats.pushes = (stats.pushes || 0) + 1;
      stats.handsPush = stats.pushes;
      stats.currentWinStreak = 0;
      stats.currentLossStreak = 0;
      recordChallengeEvent(user, 'push', 1);
    }

    if (hand?.wasSplitHand) {
      if (ownWon) stats.splitHandsWon = (stats.splitHandsWon || 0) + 1;
      else if (ownLost) stats.splitHandsLost = (stats.splitHandsLost || 0) + 1;
      else if (ownPush) stats.splitHandsPushed = (stats.splitHandsPushed || 0) + 1;
    }
    if (hand?.doubled || (hand?.doubleCount || 0) > 0) {
      if (ownWon) stats.doubleHandsWon = (stats.doubleHandsWon || 0) + 1;
      else if (ownLost) stats.doubleHandsLost = (stats.doubleHandsLost || 0) + 1;
      else if (ownPush) stats.doubleHandsPushed = (stats.doubleHandsPushed || 0) + 1;
    }
  }

  for (const out of outcomes) {
    const handA = a.hands[out.handIndex] || a.hands[0];
    const handB = b.hands[out.handIndex] || b.hands[0];
    applyHandOutcomeStats(userA, aId, out, handA);
    applyHandOutcomeStats(userB, bId, out, handB);
  }

  if (realMatch) {
    const splitWinsA = countWinningSplitHandsForPlayer(outcomes, aId);
    const splitWinsB = countWinningSplitHandsForPlayer(outcomes, bId);
    if (userA && splitWinsA > 0) recordChallengeEvent(userA, 'split_win', splitWinsA);
    if (userB && splitWinsB > 0) recordChallengeEvent(userB, 'split_win', splitWinsB);
  }

  if (realMatch) {
    for (const out of outcomes) {
      const handA = a.hands[out.handIndex] || a.hands[0];
      const handB = b.hands[out.handIndex] || b.hands[0];
      if (userA) {
        if (out.winner === aId && handA && !handA.bust) recordSkillEvent(userA, 'win_no_bust', 1);
        if (handA?.naturalBlackjack) recordSkillEvent(userA, 'blackjack', 1);
      }
      if (userB) {
        if (out.winner === bId && handB && !handB.bust) recordSkillEvent(userB, 'win_no_bust', 1);
        if (handB?.naturalBlackjack) recordSkillEvent(userB, 'blackjack', 1);
      }
    }
  }

  if (realMatch && userA) {
    const naturals = a.hands.filter((h) => handMeta(h.cards).isNaturalBlackjack).length;
    if (naturals > 0) {
      userA.stats.blackjacks = (userA.stats.blackjacks || 0) + naturals;
      recordChallengeEvent(userA, 'blackjack', naturals);
    }
  }
  if (realMatch && userB) {
    const naturals = b.hands.filter((h) => handMeta(h.cards).isNaturalBlackjack).length;
    if (naturals > 0) {
      userB.stats.blackjacks = (userB.stats.blackjacks || 0) + naturals;
      recordChallengeEvent(userB, 'blackjack', naturals);
    }
  }

  const netA = chipsDelta[aId];

  if (realMatch && netA > 0) {
    if (userA) {
      userA.stats.roundsWon += 1;
      recordChallengeEvent(userA, 'round_won', 1);
    }
    if (userB) userB.stats.roundsLost += 1;
  } else if (realMatch && netA < 0) {
    if (userB) {
      userB.stats.roundsWon += 1;
      recordChallengeEvent(userB, 'round_won', 1);
    }
    if (userA) userA.stats.roundsLost += 1;
  }

  if (realMatch) {
    if (userA) userA.stats.matchesPlayed += 1;
    if (userB) userB.stats.matchesPlayed += 1;
  }

  if (realMatch) {
    const modeLabel = matchHistoryModeLabel(match);
    for (let idx = 0; idx < outcomes.length; idx += 1) {
      const out = outcomes[idx];
      const handA = a.hands[out.handIndex] || a.hands[0];
      const handB = b.hands[out.handIndex] || b.hands[0];
      appendBetHistory(userA, {
        mode: modeLabel,
        bet: handA?.bet || match.round.baseBet,
        result: out.winner === aId ? 'Win' : out.loser === aId ? 'Loss' : 'Push',
        net: out.winner === aId ? out.amount : out.loser === aId ? -out.amount : 0,
        notes: handA?.naturalBlackjack ? 'blackjack' : handA?.wasSplitHand ? 'split' : ''
      });
      appendBetHistory(userB, {
        mode: modeLabel,
        bet: handB?.bet || match.round.baseBet,
        result: out.winner === bId ? 'Win' : out.loser === bId ? 'Loss' : 'Push',
        net: out.winner === bId ? out.amount : out.loser === bId ? -out.amount : 0,
        notes: handB?.naturalBlackjack ? 'blackjack' : handB?.wasSplitHand ? 'split' : ''
      });
    }
  }

  if (userA || userB) {
    db.write();
    if (userA) emitUserUpdate(aId);
    if (userB) emitUserUpdate(bId);
  }

  const aHasNatural = a.hands.some((h) => Boolean(h.naturalBlackjack));
  const bHasNatural = b.hands.some((h) => Boolean(h.naturalBlackjack));
  const outcomeA = chipsDelta[aId] > 0 ? 'win' : chipsDelta[aId] < 0 ? 'lose' : 'push';
  const outcomeB = chipsDelta[bId] > 0 ? 'win' : chipsDelta[bId] < 0 ? 'lose' : 'push';
  const titleFor = (viewerId) => {
    const viewerNatural = viewerId === aId ? aHasNatural : bHasNatural;
    const opponentNatural = viewerId === aId ? bHasNatural : aHasNatural;
    const outcome = viewerId === aId ? outcomeA : outcomeB;
    if (viewerNatural && !opponentNatural && outcome === 'win') return 'Blackjack!';
    if (opponentNatural && !viewerNatural && outcome === 'lose') return 'Opponent Blackjack';
    if (outcome === 'win') return 'You Win';
    if (outcome === 'lose') return 'You Lose';
    return 'Push';
  };

  match.round.resultByPlayer = {
    [aId]: {
      matchId: match.id,
      roundNumber: match.roundNumber,
      outcome: outcomeA,
      title: titleFor(aId),
      deltaChips: chipsDelta[aId],
      previousBankroll: bankrollBefore[aId],
      newBankroll: bankrollAfter[aId],
      isPractice: isPracticeMatch(match)
    },
    [bId]: {
      matchId: match.id,
      roundNumber: match.roundNumber,
      outcome: outcomeB,
      title: titleFor(bId),
      deltaChips: chipsDelta[bId],
      previousBankroll: bankrollBefore[bId],
      newBankroll: bankrollAfter[bId],
      isPractice: isPracticeMatch(match)
    }
  };

  match.phase = PHASES.REVEAL;
  pushMatchState(match);

  const revealTimer = setTimeout(() => {
    if (!matches.has(match.id)) return;
    match.phase = PHASES.RESULT;
    match.round.resultChoiceByPlayer = {};
    pushMatchState(match);
    emitToUser(aId, 'round:result', match.round.resultByPlayer[aId]);
    emitToUser(bId, 'round:result', match.round.resultByPlayer[bId]);
    roundPhaseTimers.delete(match.id);
  }, ROUND_REVEAL_MS);
  roundPhaseTimers.set(match.id, revealTimer);
}

function applyRoundResultChoice(match, playerId, choice) {
  if (!match.playerIds.includes(playerId)) return { error: 'Unauthorized' };
  if (match.phase !== PHASES.RESULT) return { error: 'Round result is not ready' };
  if (!['next', 'betting'].includes(choice)) return { error: 'Invalid round choice' };

  if (!match.round.resultChoiceByPlayer) match.round.resultChoiceByPlayer = {};
  match.round.resultChoiceByPlayer[playerId] = choice;

  const botId = match.playerIds.find((id) => isBotPlayer(id));
  if (botId && !match.round.resultChoiceByPlayer[botId]) {
    match.round.resultChoiceByPlayer[botId] = choice;
  }

  const allChosen = match.playerIds.every((pid) => Boolean(match.round.resultChoiceByPlayer?.[pid]));
  if (!allChosen) return { ok: true, waiting: true };

  const everyoneNext = match.playerIds.every((pid) => match.round.resultChoiceByPlayer?.[pid] === 'next');
  match.startingPlayerIndex = (match.startingPlayerIndex + 1) % 2;
  startRound(match);

  if (everyoneNext) {
    for (const pid of match.playerIds) {
      match.round.betConfirmedByPlayer[pid] = true;
    }
    maybeBeginRoundAfterBetConfirm(match);
  }

  return { ok: true, advanced: true, mode: everyoneNext ? 'next' : 'betting' };
}

function appendMatchChatMessage(match, userId, rawMessage) {
  if (!match) return { error: 'Match not found' };
  if (!match.playerIds.includes(userId)) return { error: 'Unauthorized' };
  if (match.phase !== PHASES.ROUND_INIT) return { error: 'Chat is only available during bet confirmation' };
  if (match.playerIds.some((id) => isBotPlayer(id))) return { error: 'Chat unavailable in bot matches' };
  if (normalizeQuickPlayBucket(match.quickPlayBucket)) return { error: 'Chat unavailable in Quick Play bucket matches' };
  const text = String(rawMessage || '').trim();
  if (!text) return { error: 'Message required' };
  const clipped = text.slice(0, 140);
  if (!Array.isArray(match.chat)) match.chat = [];
  const senderName = match.participants?.[userId]?.username || getUserById(userId)?.username || 'Player';
  const message = {
    id: nanoid(10),
    userId,
    username: senderName,
    text: clipped,
    createdAt: nowIso()
  };
  match.chat.push(message);
  match.chat = match.chat.slice(-40);
  return { ok: true, message, chat: match.chat };
}

function maybeEndRound(match) {
  const anyPlayable = match.playerIds.some((pid) => hasPlayableHand(match.round.players[pid]));
  if (!anyPlayable && !match.round.pendingPressure) {
    resolveRound(match);
  }
}

function allHandsTerminalByBustOrSurrender(playerRoundState) {
  if (!playerRoundState || !Array.isArray(playerRoundState.hands) || playerRoundState.hands.length === 0) return false;
  return playerRoundState.hands.every((hand) => Boolean(hand?.bust || hand?.surrendered));
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

  // Bot bust/surrender terminal: resolve immediately so human is not forced to click.
  if (isBotPlayer(actingPlayerId) && !hasPlayableHand(ownState) && !match.round.pendingPressure && allHandsTerminalByBustOrSurrender(ownState)) {
    resolveRound(match);
    return;
  }

  maybeEndRound(match);
}

function canSplit(hand, playerRoundState = null) {
  if (!hand) return false;
  if (playerRoundState?.hands?.length >= RULES.MAX_HANDS_PER_PLAYER) return false;
  if (hand.cards.length !== 2) return false;
  if (hand.splitDepth >= RULES.MAX_SPLITS) return false;
  return hand.cards[0].rank === hand.cards[1].rank;
}

function visibleTotal(cards, hiddenFlags) {
  const visibleCards = cards.filter((_, idx) => !hiddenFlags[idx]);
  return handTotal(visibleCards);
}

function legalActionsForHand(hand, playerRoundState = null) {
  if (!hand || hand.locked || hand.stood || hand.bust || hand.surrendered) return [];
  const actions = ['hit', 'stand'];
  if ((hand.actionCount || 0) === 0) actions.push('surrender');
  if ((hand.actionCount || 0) === 0 && !hand.doubled && (hand.doubleCount || 0) < RULES.MAX_DOUBLES_PER_HAND) actions.push('double');
  if (canSplit(hand, playerRoundState)) actions.push('split');
  return actions;
}

const BOT_OBSERVATION_FORBIDDEN_KEYS = ['deck', 'shoe', 'remainingDeck', 'fullMatchState', 'opponentHiddenCards'];

function deepFreezeObject(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreezeObject(value[key]);
  }
  return value;
}

function assertSafeBotObservation(observation) {
  const stack = [{ path: 'observation', value: observation }];
  while (stack.length) {
    const current = stack.pop();
    if (!current || !current.value || typeof current.value !== 'object') continue;
    for (const key of Object.keys(current.value)) {
      const lowered = key.toLowerCase();
      if (BOT_OBSERVATION_FORBIDDEN_KEYS.some((forbidden) => lowered.includes(forbidden.toLowerCase()))) {
        throw new Error(`Unsafe bot observation key: ${current.path}.${key}`);
      }
      stack.push({ path: `${current.path}.${key}`, value: current.value[key] });
    }
  }
}

function sanitizeCard(card) {
  if (!card || typeof card !== 'object') return null;
  return {
    id: card.id || `${card.rank}${card.suit}`,
    rank: card.rank,
    suit: card.suit
  };
}

function getBotObservation(match, botId) {
  const botState = match?.round?.players?.[botId];
  if (!botState) return null;
  const opponentId = nextPlayerId(match, botId);
  const opponentState = match?.round?.players?.[opponentId];
  const activeHandIndex = Number.isInteger(botState.activeHandIndex) ? botState.activeHandIndex : 0;
  const activeHand = botState.hands?.[activeHandIndex] || null;
  const allowedActions = legalActionsForHand(activeHand, botState);

  const observation = {
    phase: match.phase,
    allowedActions,
    bot: {
      id: botId,
      bankroll: getParticipantChips(match, botId),
      activeHandIndex,
      hands: (botState.hands || []).map((hand, index) => {
        const meta = handMeta(hand.cards || []);
        const splitEligible = canSplit(hand, botState);
        return {
          index,
          cards: (hand.cards || []).map(sanitizeCard).filter(Boolean),
          total: meta.total,
          isSoft: meta.isSoft,
          bet: hand.bet || 0,
          actionCount: hand.actionCount || 0,
          doubleCount: hand.doubleCount || 0,
          doubled: Boolean(hand.doubled),
          splitDepth: hand.splitDepth || 0,
          bust: Boolean(hand.bust),
          stood: Boolean(hand.stood),
          surrendered: Boolean(hand.surrendered),
          locked: Boolean(hand.locked),
          splitEligible,
          pairRank: splitEligible && hand.cards?.length === 2 ? hand.cards[0]?.rank || null : null
        };
      })
    },
    opponent: {
      id: opponentId,
      hands: (opponentState?.hands || []).map((hand, index) => {
        const hiddenFlags = Array.isArray(hand?.hidden) ? hand.hidden : [];
        const visibleCards = (hand?.cards || [])
          .filter((_, cardIndex) => !hiddenFlags[cardIndex])
          .map(sanitizeCard)
          .filter(Boolean);
        return {
          index,
          upcards: visibleCards,
          upTotal: visibleTotal(hand?.cards || [], hiddenFlags),
          bet: hand?.bet || 0
        };
      })
    },
    public: {
      baseBet: match?.round?.baseBet || 0,
      mode: match?.mode || resolveMatchMode(match?.stakeType)
    }
  };

  if (
    match.phase === PHASES.PRESSURE_RESPONSE &&
    match?.round?.pendingPressure &&
    match.round.pendingPressure.opponentId === botId
  ) {
    const pressure = match.round.pendingPressure;
    const affectedHandIndices = Array.isArray(pressure.affectedHandIndices) && pressure.affectedHandIndices.length
      ? pressure.affectedHandIndices
      : [activeHandIndex];
    const required = pressure.delta * affectedHandIndices.length;
    observation.pressure = {
      type: pressure.type,
      delta: pressure.delta,
      affectedHandIndices,
      required,
      canMatch: canAffordIncrement(match, botId, required),
      allowedDecisions: ['match', 'surrender']
    };
  }

  if (process.env.NODE_ENV !== 'production') {
    assertSafeBotObservation(observation);
  }
  return deepFreezeObject(observation);
}

function getBotDifficulty(match, botId) {
  return match.bot?.difficultyById?.[botId] || 'normal';
}

function chooseBotActionFromObservation(observation, difficulty = 'normal') {
  if (!observation || observation.phase !== PHASES.ACTION_TURN) return 'stand';
  if (process.env.NODE_ENV !== 'production') assertSafeBotObservation(observation);
  const legal = Array.isArray(observation.allowedActions) ? observation.allowedActions : [];
  if (!legal.length) return 'stand';

  const activeHandIndex = observation.bot?.activeHandIndex ?? 0;
  const hand = observation.bot?.hands?.[activeHandIndex] || null;
  if (!hand) return legal.includes('stand') ? 'stand' : legal[0];
  const opponentUpCard = observation.opponent?.hands?.[0]?.upcards?.[0] || null;
  const opponentUpCardTotal = opponentUpCard ? cardValue(opponentUpCard) : 10;
  let ideal = basicStrategyActionFromObservation(hand, opponentUpCardTotal);
  if (!legal.includes(ideal)) ideal = legal[0];

  const accuracy = difficulty === 'easy' ? 0.45 : difficulty === 'medium' ? 0.75 : 0.94;
  if (Math.random() <= accuracy) return ideal;

  const alternatives = legal.filter((a) => a !== ideal);
  if (!alternatives.length) return ideal;
  return alternatives[Math.floor(Math.random() * alternatives.length)];
}

function basicStrategyActionFromObservation(hand, up) {
  const total = hand.total || 0;
  if (hand.splitEligible && hand.pairRank) {
    const r = hand.pairRank;
    if (r === 'A' || r === '8') return 'split';
    if (r === '9' && ![7, 10, 11].includes(up)) return 'split';
    if (r === '7' && up <= 7) return 'split';
    if (r === '6' && up >= 2 && up <= 6) return 'split';
    if ((r === '2' || r === '3') && up >= 2 && up <= 7) return 'split';
    if (r === '4' && (up === 5 || up === 6)) return 'split';
  }

  if (hand.isSoft) {
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

function chooseBotPressureDecisionFromObservation(observation, difficulty = 'normal') {
  if (!observation || observation.phase !== PHASES.PRESSURE_RESPONSE) return 'surrender';
  if (process.env.NODE_ENV !== 'production') assertSafeBotObservation(observation);
  const pressure = observation.pressure;
  if (!pressure) return 'surrender';
  const firstIndex = (pressure.affectedHandIndices && pressure.affectedHandIndices[0]) || 0;
  const hand = observation.bot?.hands?.[firstIndex] || observation.bot?.hands?.[0];
  if (!hand || hand.bust || hand.surrendered) return 'surrender';

  const base = difficulty === 'easy' ? 0.45 : difficulty === 'medium' ? 0.65 : 0.83;
  const total = hand.total || 0;
  let chance = base;
  if (total >= 17) chance += 0.1;
  if (total <= 12) chance -= 0.15;
  if (pressure.delta >= 10) chance -= 0.05;
  chance = Math.max(0.1, Math.min(0.95, chance));
  if (!pressure.canMatch) return 'surrender';
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

  const delay = botTurnDelayMs(match, botId);
  const timer = setTimeout(() => {
    if (!matches.has(match.id)) return;

    if (
      match.phase === PHASES.PRESSURE_RESPONSE &&
      match.round.pendingPressure &&
      isBotPlayer(match.round.pendingPressure.opponentId)
    ) {
      const observation = getBotObservation(match, botId);
      const decision = chooseBotPressureDecisionFromObservation(observation, getBotDifficulty(match, botId));
      const result = applyPressureDecision(match, botId, decision);
      if (!result.error) {
        markBotActionCompleted(match, botId);
        pushMatchState(match);
        db.write();
        scheduleBotTurn(match);
      }
      return;
    }

    if (match.phase !== PHASES.ACTION_TURN) return;
    if (match.round.pendingPressure) return;
    if (match.round.turnPlayerId !== botId) return;

    const observation = getBotObservation(match, botId);
    const action = chooseBotActionFromObservation(observation, getBotDifficulty(match, botId));
    const result = applyAction(match, botId, action);
    if (result.error) {
      const fallback = applyAction(match, botId, 'stand');
      if (fallback.error) return;
    }
    markBotActionCompleted(match, botId);

    pushMatchState(match);
    db.write();
    scheduleBotTurn(match);
  }, delay);

  botTurnTimers.set(match.id, timer);
}

function applyAction(match, playerId, action) {
  if (match.phase !== PHASES.ACTION_TURN) return { error: 'Round not in action phase' };
  if (match.round.turnPlayerId !== playerId) return { error: 'Not your turn' };
  if (match.round.pendingPressure) return { error: 'Pending pressure decision' };

  const state = match.round.players[playerId];
  const hand = currentHand(state);
  if (!hand) return { error: 'No active hand' };
  if (hand.locked || hand.stood || hand.bust || hand.surrendered) return { error: 'Hand is already resolved' };

  const opponentId = nextPlayerId(match, playerId);
  const opponentState = match.round.players[opponentId];
  const betLimits = getMatchBetLimits(match);

  if (action === 'hit') {
    match.round.firstActionTaken = true;
    hand.actionCount = (hand.actionCount || 0) + 1;
    hand.cards.push(drawCard(match.round));
    hand.hidden.push(false);
    const total = handTotal(hand.cards);
    if (total > 21) {
      hand.bust = true;
      hand.locked = true;
      if (hasPlayableHand(state)) {
        progressTurn(match, playerId);
      } else {
        resolveRound(match);
      }
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
    hand.actionCount = (hand.actionCount || 0) + 1;
    const total = handTotal(hand.cards);
    if (!isBotPlayer(playerId) && total >= 16 && isRealMatch(match)) {
      const user = getUserById(playerId);
      if (user) recordSkillEvent(user, 'stand_16_plus', 1);
    }
    hand.stood = true;
    hand.locked = true;
    progressTurn(match, playerId);
    return { ok: true };
  }

  if (action === 'surrender') {
    if ((hand.actionCount || 0) > 0) return { error: 'Surrender is only available before you act on this hand' };
    match.round.firstActionTaken = true;
    hand.actionCount = (hand.actionCount || 0) + 1;
    hand.surrendered = true;
    hand.locked = true;
    progressTurn(match, playerId);
    return { ok: true };
  }

  if (action === 'double') {
    if ((hand.actionCount || 0) > 0) return { error: 'Double is only available as your first action on this hand' };
    if (hand.locked || hand.doubled || (hand.doubleCount || 0) >= RULES.MAX_DOUBLES_PER_HAND) return { error: 'Hand cannot double down' };
    match.round.firstActionTaken = true;
    hand.actionCount = (hand.actionCount || 0) + 1;
    const delta = hand.bet;
    if (!canAffordIncrement(match, playerId, delta)) return { error: 'Insufficient chips to double' };
    if (hand.bet * 2 > betLimits.max) return { error: `Bet cannot exceed ${betLimits.max} for this table` };
    hand.bet *= 2;
    hand.doubleCount = (hand.doubleCount || 0) + 1;
    hand.doubled = hand.doubleCount > 0;
    if (isRealMatch(match) && !isBotPlayer(playerId)) {
      const user = getUserById(playerId);
      if (user) user.stats.doublesAttempted = (user.stats.doublesAttempted || 0) + 1;
    }
    hand.cards.push(drawCard(match.round));
    hand.hidden.push(false);
    const total = handTotal(hand.cards);
    if (total > 21) {
      hand.bust = true;
      hand.locked = true;
      if (hasPlayableHand(state)) {
        progressTurn(match, playerId);
      } else {
        resolveRound(match);
      }
      return { ok: true };
    }
    // Standard double-down: exactly one card, then forced stand.
    hand.locked = true;
    hand.stood = true;

    const targetHandIndex = Math.min(opponentState.activeHandIndex, opponentState.hands.length - 1);
    match.round.pendingPressure = {
      initiatorId: playerId,
      initiatorHandIndex: state.activeHandIndex,
      resumeTurnIfPossible: true,
      opponentId,
      type: 'double',
      delta,
      affectedHandIndices: [targetHandIndex]
    };
    match.phase = PHASES.PRESSURE_RESPONSE;
    return { ok: true };
  }

  if (action === 'split') {
    if (!canSplit(hand, state)) return { error: 'Split unavailable' };
    if (!canAffordIncrement(match, playerId, hand.bet)) return { error: 'Insufficient chips to split' };
    match.round.firstActionTaken = true;
    hand.actionCount = (hand.actionCount || 0) + 1;
    const [c1, c2] = hand.cards;
    const nextDepth = hand.splitDepth + 1;
    const newOne = newHand([c1, drawCard(match.round)], [false, true], hand.bet, nextDepth);
    const newTwo = newHand([c2, drawCard(match.round)], [false, true], hand.bet, nextDepth);
    newOne.wasSplitHand = true;
    newTwo.wasSplitHand = true;

    const idx = state.activeHandIndex;
    state.hands.splice(idx, 1, newOne, newTwo);
    state.activeHandIndex = idx;

    if (isRealMatch(match)) {
      const user = getUserById(playerId);
      if (user) {
        user.stats.splitsAttempted = (user.stats.splitsAttempted || 0) + 1;
        recordChallengeEvent(user, 'split', 1);
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
      initiatorHandIndex: state.activeHandIndex,
      resumeTurnIfPossible: true,
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
  const betLimits = getMatchBetLimits(match);

  if (decision === 'match') {
    const required = pressure.delta * targetIndices.length;
    if (!canAffordIncrement(match, playerId, required)) return { error: 'Insufficient chips to match pressure' };
    for (const idx of targetIndices) {
      const hand = opponentState.hands[idx] || opponentState.hands[0];
      if (hand.bet + pressure.delta > betLimits.max) {
        return { error: `Bet cannot exceed ${betLimits.max} for this table` };
      }
      hand.bet += pressure.delta;
      hand.actionCount = (hand.actionCount || 0) + 1;
    }
  } else if (decision === 'surrender') {
    for (const idx of targetIndices) {
      const hand = opponentState.hands[idx] || opponentState.hands[0];
      hand.actionCount = (hand.actionCount || 0) + 1;
      hand.surrendered = true;
      hand.locked = true;
    }
  } else {
    return { error: 'Invalid decision' };
  }

  match.round.pendingPressure = null;
  match.phase = PHASES.ACTION_TURN;
  const initiatorState = match.round.players[pressure.initiatorId];
  const resumeIndex = Number.isInteger(pressure.initiatorHandIndex)
    ? pressure.initiatorHandIndex
    : initiatorState.activeHandIndex;
  const initiatorHand = initiatorState.hands[resumeIndex] || null;
  const canResume =
    Boolean(pressure.resumeTurnIfPossible) &&
    initiatorHand &&
    !initiatorHand.locked &&
    !initiatorHand.stood &&
    !initiatorHand.bust &&
    !initiatorHand.surrendered;
  if (canResume) {
    initiatorState.activeHandIndex = resumeIndex;
    match.round.turnPlayerId = pressure.initiatorId;
  } else {
    progressTurn(match, pressure.initiatorId);
  }
  return { ok: true };
}

function applyBaseBetSelection(match, playerId, amount) {
  if (!match.playerIds.includes(playerId)) return { error: 'Unauthorized' };
  if (match.phase !== PHASES.ROUND_INIT) return { error: 'Bet can only be changed before cards are dealt' };
  if (normalizeQuickPlayBucket(match.quickPlayBucket)) return { error: 'Quick Play bucket bet is fixed for this match' };
  if (playerId !== match.betControllerId) return { error: 'Only the round owner can set base bet' };
  if (match.round.betConfirmedByPlayer?.[playerId]) return { error: 'Bet already confirmed for this round' };
  const betLimits = getMatchBetLimits(match);
  const chips = getParticipantChips(match, playerId);
  if (chips < betLimits.min) return { error: `Need at least ${betLimits.min} chips to set base bet` };
  const selected = clampBet(amount, chips || betLimits.min, betLimits);
  if (selected < betLimits.min) return { error: `Bet must be at least ${betLimits.min}` };
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

  const betLimits = getMatchBetLimits(match);
  const selected = clampBet(
    match.betSettings?.selectedBetById?.[match.betControllerId] || match.round.baseBet || BASE_BET,
    getParticipantChips(match, match.betControllerId) || betLimits.min,
    betLimits
  );
  if (selected < betLimits.min) return { error: `Bet must be at least ${betLimits.min}` };
  if (getParticipantChips(match, match.betControllerId) < betLimits.min) return { error: 'Insufficient chips to start round' };

  match.round.baseBet = selected;
  match.round.betConfirmedByPlayer[playerId] = true;
  maybeBeginRoundAfterBetConfirm(match);
  return { ok: true };
}

function createMatch(lobby, options = {}) {
  const playerIds = [lobby.ownerId, lobby.opponentId];
  for (const pid of playerIds) {
    removeFromQuickPlayQueue(pid);
  }
  const stakeType = resolveStakeType(lobby.stakeType);
  const mode = resolveMatchMode(stakeType);
  const isPractice = mode === 'practice';
  const quickPlayBucket = normalizeQuickPlayBucket(options.quickPlayBucket || lobby.quickPlayBucket);
  const botId = playerIds.find((pid) => isBotPlayer(pid));
  const botDifficulty = botId ? options.botDifficultyById?.[botId] || 'normal' : null;
  const betLimits = quickPlayBucket
    ? { min: quickPlayBucket, max: quickPlayBucket }
    : botDifficulty
      ? getBetLimitsForDifficulty(botDifficulty)
      : { min: MIN_BET, max: MAX_BET_CAP };
  const selectedBetById = {};
  for (const pid of playerIds) {
    if (isBotPlayer(pid)) {
      selectedBetById[pid] = betLimits.min;
    } else {
      const user = getUserById(pid);
      selectedBetById[pid] = quickPlayBucket
        ? quickPlayBucket
        : clampBet(
          user?.selectedBet || BASE_BET,
          isPractice ? STARTING_CHIPS : (user?.chips || STARTING_CHIPS),
          betLimits
        );
    }
  }
  const match = {
    id: nanoid(10),
    lobbyId: lobby.id,
    matchType: lobby.type || 'lobby',
    quickPlayBucket: quickPlayBucket || null,
    participants: buildParticipants(playerIds, options.botDifficultyById || {}),
    playerIds,
    startingPlayerIndex: 0,
    roundNumber: 0,
    stakeType,
    mode,
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
    chat: [],
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

function cleanupMatch(match) {
  clearRoundPhaseTimer(match.id);
  clearAfkTurnTimer(match.id);
  const timer = botTurnTimers.get(match.id);
  if (timer) {
    clearTimeout(timer);
    botTurnTimers.delete(match.id);
  }
  const betTimer = botBetConfirmTimers.get(`${match.id}:bet`);
  if (betTimer) {
    clearTimeout(betTimer);
    botBetConfirmTimers.delete(`${match.id}:bet`);
  }
  for (const pid of match.playerIds) {
    const key = `${match.id}:${pid}`;
    const dcTimer = disconnectTimers.get(key);
    if (dcTimer) {
      clearTimeout(dcTimer);
      disconnectTimers.delete(key);
    }
  }
  matches.delete(match.id);
  if (match.lobbyId) {
    lobbyToMatch.delete(match.lobbyId);
    const lobby = db.data.lobbies.find((l) => l.id === match.lobbyId);
    if (lobby) lobby.status = 'closed';
  }
}

function calculateForfeitLossAmount(availableChips, exposureBet, baseBet = BASE_BET) {
  const chips = Math.max(0, Math.floor(Number(availableChips) || 0));
  const exposure = Math.max(0, Math.floor(Number(exposureBet) || 0));
  const fallbackBet = Math.max(1, Math.floor(Number(baseBet) || BASE_BET));
  const desired = Math.max(fallbackBet, exposure || fallbackBet);
  return Math.min(chips, desired);
}

function leaveMatchByForfeit(match, leaverId) {
  if (!match || !match.playerIds.includes(leaverId)) return;
  const opponentId = match.playerIds.find((id) => id !== leaverId);
  const botMatch = match.playerIds.some((id) => isBotPlayer(id));
  const leaverUser = !isBotPlayer(leaverId) ? getUserById(leaverId) : null;
  const opponentUser = !isBotPlayer(opponentId) ? getUserById(opponentId) : null;
  if (leaverUser && isRealMatch(match)) {
    const modeLabel = matchHistoryModeLabel(match);
    const leaverExposure = (match.round?.players?.[leaverId]?.hands || []).reduce((sum, hand) => sum + (hand.bet || 0), 0);
    const opponentExposure = opponentId
      ? (match.round?.players?.[opponentId]?.hands || []).reduce((sum, hand) => sum + (hand.bet || 0), 0)
      : 0;
    const exposure = opponentUser ? leaverExposure + opponentExposure : leaverExposure;
    const award = calculateForfeitLossAmount(leaverUser.chips, exposure, match.round?.baseBet || BASE_BET);
    leaverUser.chips = Math.max(0, leaverUser.chips - award);
    appendBetHistory(leaverUser, {
      mode: modeLabel,
      bet: award,
      result: 'Forfeit',
      net: -award,
      notes: botMatch ? 'left bot match' : 'left match'
    });
    if (opponentUser) {
      opponentUser.chips += award;
      appendBetHistory(opponentUser, { mode: modeLabel, bet: award, result: 'Win', net: award, notes: 'opponent left' });
      emitUserUpdate(opponentUser.id);
    }
    emitUserUpdate(leaverUser.id);
    db.write();
  }

  emitToUser(leaverId, 'match:ended', { reason: botMatch ? 'You forfeited the match.' : 'You left the match.' });
  if (opponentId) emitToUser(opponentId, 'match:ended', { reason: 'Opponent left — you win by forfeit.' });
  cleanupMatch(match);
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
    stats: cloneUserStatsDefaults(),
    friends: [],
    challengeSets: {},
    lastDailyClaimAt: null,
    lastFreeClaimAt: null,
    selectedBet: BASE_BET,
    notifications: [],
    betHistory: [],
    lastStreakClaimAt: null,
    streakCount: 0,
    skillChallenges: []
  };
  refreshChallengesForUser(user, true);
  ensureSkillChallenges(user);
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
  let touched = false;
  if (!user.usernameKey) {
    user.usernameKey = normalizeUsername(user.username || username || '');
    touched = true;
  }
  if (!/^\d{4}$/.test(String(pin || ''))) return res.status(401).json({ ok: false, error: 'Invalid auth' });
  const ok = await bcrypt.compare(String(pin || ''), user.pinHash || '');
  if (!ok) {
    return res.status(401).json({ ok: false, error: 'Invalid auth' });
  }
  if (!user.authToken) {
    user.authToken = nanoid(36);
    touched = true;
  }
  if (touched) await db.write();
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
  let touched = false;
  if (!user.usernameKey) {
    user.usernameKey = normalizeUsername(user.username || username || '');
    touched = true;
  }
  if (authToken && user.authToken === authToken) {
    if (touched) await db.write();
    return res.json({ token: issueToken(user), user: sanitizeSelfUser(user), authToken: user.authToken });
  }
  const ok = await bcrypt.compare(String(pin || ''), user.pinHash || '');
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  if (touched) await db.write();
  return res.json({ token: issueToken(user), user: sanitizeSelfUser(user), authToken: user.authToken });
});

app.get('/api/me', authMiddleware, async (req, res) => {
  const friendsData = buildFriendsPayload(req.user);
  const refreshed = refreshChallengesForUser(req.user);
  const refreshedSkills = ensureSkillChallenges(req.user);
  if (refreshed || refreshedSkills) await db.write();
  const freeClaim = freeClaimMeta(req.user);
  const challengeData = buildChallengePayload(req.user);
  return res.json({
    user: sanitizeSelfUser(req.user),
    friends: friendsData.friends,
    friendRequests: {
      incoming: friendsData.incoming,
      outgoing: friendsData.outgoing
    },
    friendChallenges: {
      incoming: friendsData.incomingChallenges || [],
      outgoing: friendsData.outgoingChallenges || []
    },
    notifications: (req.user.notifications || []).slice(0, 30),
    freeClaimed: !freeClaim.available,
    freeClaimAvailable: freeClaim.available,
    freeClaimNextAt: freeClaim.nextAt,
    streakCount: freeClaim.streakCount,
    nextStreakReward: freeClaim.nextReward,
    challenges: challengeData.challenges,
    challengeList: challengeData.challengeList,
    challengeResets: challengeData.challengeResets,
    hourlyResetAt: challengeData.hourlyResetAt,
    dailyResetAt: challengeData.dailyResetAt,
    weeklyResetAt: challengeData.weeklyResetAt,
    nextDailyResetAt: challengeData.nextDailyResetAt,
    nextWeeklyResetAt: challengeData.nextWeeklyResetAt
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

function findFriendRequestForRecipient(recipientId, { requestId, username } = {}) {
  if (requestId) {
    const byId = db.data.friendRequests.find((r) => r.id === requestId && r.toUserId === recipientId);
    if (byId) return byId;
  }
  if (!username) return null;
  const target = getUserByUsername(username);
  if (!target) return null;
  return db.data.friendRequests.find((r) => r.fromUserId === target.id && r.toUserId === recipientId) || null;
}

function markFriendRequestNotificationResolved(user, requestId) {
  if (!user || !requestId || !Array.isArray(user.notifications)) return;
  user.notifications = user.notifications.map((notification) => {
    if (!notification || notification.requestId !== requestId) return notification;
    return { ...notification, read: true };
  });
}

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
  const requestId = nanoid(10);
  db.data.friendRequests.push({
    id: requestId,
    fromUserId: req.user.id,
    toUserId: target.id,
    status: 'pending',
    createdAt: nowIso()
  });
  pushNotification(target.id, {
    type: 'friend_request',
    message: `${req.user.username} sent you a friend request.`,
    requestId,
    fromUserId: req.user.id
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
  const requestId = nanoid(10);
  db.data.friendRequests.push({
    id: requestId,
    fromUserId: req.user.id,
    toUserId: target.id,
    status: 'pending',
    createdAt: nowIso()
  });
  pushNotification(target.id, {
    type: 'friend_request',
    message: `${req.user.username} sent you a friend request.`,
    requestId,
    fromUserId: req.user.id
  });
  await db.write();
  return res.json(buildFriendsPayload(req.user));
});

async function handleFriendAccept(req, res, params = {}) {
  const requestId = params.requestId || req.body?.requestId;
  const username = params.username || req.body?.username;
  const friendReq = findFriendRequestForRecipient(req.user.id, { requestId, username });
  if (!friendReq) return res.status(404).json({ error: 'Friend request not found' });
  if (friendReq.status === 'accepted') {
    markFriendRequestNotificationResolved(req.user, friendReq.id);
    await db.write();
    return res.json({ ...buildFriendsPayload(req.user), message: 'Friend request already accepted.' });
  }
  if (friendReq.status === 'declined') {
    return res.status(409).json({ error: 'Friend request already declined.' });
  }
  if (friendReq.status !== 'pending') {
    return res.status(409).json({ error: `Friend request already ${friendReq.status}.` });
  }
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
  markFriendRequestNotificationResolved(req.user, friendReq.id);
  await db.write();
  return res.json(buildFriendsPayload(req.user));
}

app.post('/api/friends/accept', authMiddleware, async (req, res) => {
  return handleFriendAccept(req, res);
});

app.post('/api/friends/requests/:requestId/accept', authMiddleware, async (req, res) => {
  return handleFriendAccept(req, res, { requestId: req.params.requestId });
});

app.post('/api/friends/decline', authMiddleware, async (req, res) => {
  const { requestId, username } = req.body || {};
  const friendReq = findFriendRequestForRecipient(req.user.id, { requestId, username });
  if (!friendReq) return res.status(404).json({ error: 'Friend request not found' });
  if (friendReq.status === 'declined') {
    markFriendRequestNotificationResolved(req.user, friendReq.id);
    await db.write();
    return res.json({ ...buildFriendsPayload(req.user), message: 'Friend request already declined.' });
  }
  if (friendReq.status === 'accepted') {
    return res.status(409).json({ error: 'Friend request already accepted.' });
  }
  if (friendReq.status !== 'pending') {
    return res.status(409).json({ error: `Friend request already ${friendReq.status}.` });
  }
  friendReq.status = 'declined';
  markFriendRequestNotificationResolved(req.user, friendReq.id);
  await db.write();
  return res.json(buildFriendsPayload(req.user));
});

app.post('/api/friends/requests/:requestId/decline', authMiddleware, async (req, res) => {
  const friendReq = findFriendRequestForRecipient(req.user.id, { requestId: req.params.requestId });
  if (!friendReq) return res.status(404).json({ error: 'Friend request not found' });
  if (friendReq.status === 'declined') {
    markFriendRequestNotificationResolved(req.user, friendReq.id);
    await db.write();
    return res.json({ ...buildFriendsPayload(req.user), message: 'Friend request already declined.' });
  }
  if (friendReq.status === 'accepted') {
    return res.status(409).json({ error: 'Friend request already accepted.' });
  }
  if (friendReq.status !== 'pending') {
    return res.status(409).json({ error: `Friend request already ${friendReq.status}.` });
  }
  friendReq.status = 'declined';
  markFriendRequestNotificationResolved(req.user, friendReq.id);
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

app.post('/api/friends/challenge', authMiddleware, async (req, res) => {
  const { toUsername, bet, message } = req.body || {};
  const target = getUserByUsername(toUsername || '');
  if (!target) return res.status(404).json({ error: 'Friend not found' });
  if (!req.user.friends.includes(target.id)) return res.status(403).json({ error: 'Can only challenge friends' });
  const amount = Math.max(MIN_BET, Math.min(MAX_BET_CAP, Number(bet) || BASE_BET));
  const maxAllowed = Math.min(req.user.chips || 0, target.chips || 0);
  if (maxAllowed < MIN_BET) return res.status(400).json({ error: 'Insufficient chips for challenge bet' });
  const finalBet = Math.min(amount, maxAllowed);
  const challenge = {
    id: nanoid(10),
    fromUserId: req.user.id,
    toUserId: target.id,
    bet: finalBet,
    message: String(message || '').slice(0, 120),
    status: 'pending',
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + FRIEND_CHALLENGE_TTL_MS).toISOString()
  };
  db.data.friendChallenges.push(challenge);
  pushNotification(target.id, {
    type: 'friend_challenge',
    message: `${req.user.username} challenged you for ${finalBet} chips.`,
    action: { label: 'Open', kind: 'friend_challenge', data: { challengeId: challenge.id } }
  });
  await db.write();
  return res.json({ challenge });
});

app.post('/api/friends/challenge/respond', authMiddleware, async (req, res) => {
  const { challengeId, decision } = req.body || {};
  const challenge = (db.data.friendChallenges || []).find((c) => c.id === challengeId && c.toUserId === req.user.id && c.status === 'pending');
  if (!challenge) return res.status(404).json({ error: 'Challenge not found' });
  if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
    challenge.status = 'expired';
    await db.write();
    return res.status(410).json({ error: 'Challenge expired' });
  }

  const challenger = getUserById(challenge.fromUserId);
  if (!challenger) return res.status(404).json({ error: 'Challenger unavailable' });

  if (decision === 'decline') {
    challenge.status = 'declined';
    pushNotification(challenger.id, {
      type: 'friend_challenge_declined',
      message: `${req.user.username} declined your challenge.`
    });
    await db.write();
    return res.json({ ok: true, status: 'declined' });
  }

  const finalBet = Math.max(MIN_BET, Math.min(challenge.bet, req.user.chips || 0, challenger.chips || 0, MAX_BET_CAP));
  if (finalBet < MIN_BET) return res.status(400).json({ error: 'Insufficient chips to accept' });
  challenge.status = 'accepted';

  const lobby = {
    id: normalizeLobbyCode(nanoid(8)),
    ownerId: challenger.id,
    opponentId: req.user.id,
    status: 'full',
    type: 'friend_challenge',
    stakeType: 'REAL',
    createdAt: nowIso()
  };
  db.data.lobbies.push(lobby);
  const match = createMatch(lobby);
  match.betSettings.selectedBetById[challenger.id] = finalBet;
  match.round.baseBet = finalBet;
  match.round.betConfirmedByPlayer[challenger.id] = true;
  match.round.betConfirmedByPlayer[req.user.id] = true;
  maybeBeginRoundAfterBetConfirm(match);
  pushMatchState(match);
  pushNotification(challenger.id, {
    type: 'friend_challenge_accept',
    message: `${req.user.username} accepted your challenge.`,
    action: { label: 'Open match', kind: 'open_match', data: { matchId: match.id } }
  });
  await db.write();
  emitToUser(challenger.id, 'friend:challengeStarted', { matchId: match.id });
  emitToUser(req.user.id, 'friend:challengeStarted', { matchId: match.id });
  return res.json({ ok: true, status: 'accepted', matchId: match.id });
});

app.post('/api/lobbies/create', authMiddleware, async (req, res) => {
  const hasStakeTypeInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'stakeType');
  const resolvedStakeType = hasStakeTypeInput ? resolveStakeType(req.body?.stakeType) : 'FAKE';
  const existing = db.data.lobbies.find(
    (l) => l.ownerId === req.user.id && l.status === 'waiting' && l.type !== 'bot'
  );
  if (existing) {
    if (hasStakeTypeInput && existing.stakeType !== resolvedStakeType) {
      existing.stakeType = resolvedStakeType;
      await db.write();
      emitLobbyUpdate(existing);
    }
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
    stakeType: resolvedStakeType,
    createdAt: nowIso()
  };
  db.data.lobbies.push(lobby);
  await db.write();

  return res.json({
    lobby,
    link: `${req.protocol}://${req.get('host')}/lobbies?code=${lobby.id}`
  });
});

app.post('/api/lobbies/cancel', authMiddleware, async (req, res) => {
  const requestedCode = normalizeLobbyCode(req.body?.lobbyId);
  const lobbyIndex = db.data.lobbies.findIndex((lobby) => {
    if (lobby.ownerId !== req.user.id) return false;
    if (lobby.type === 'bot') return false;
    if (lobby.status !== 'waiting') return false;
    if (requestedCode && normalizeLobbyCode(lobby.id) !== requestedCode) return false;
    return true;
  });
  if (lobbyIndex < 0) {
    return res.status(404).json({ error: 'No active lobby to cancel' });
  }
  const [removedLobby] = db.data.lobbies.splice(lobbyIndex, 1);
  lobbyToMatch.delete(removedLobby.id);
  await db.write();
  emitToUser(req.user.id, 'lobby:update', {
    ...removedLobby,
    status: 'cancelled'
  });
  return res.json({ ok: true, cancelledLobbyId: removedLobby.id });
});

app.post('/api/lobbies/join', authMiddleware, async (req, res) => {
  const { lobbyId } = req.body || {};
  const normalized = normalizeLobbyCode(lobbyId);
  const lobby = db.data.lobbies.find((l) => normalizeLobbyCode(l.id) === normalized);
  if (!lobby || lobby.status === 'cancelled' || lobby.status === 'closed') {
    return res.status(410).json({ error: 'Lobby no longer exists' });
  }
  if (lobby.ownerId === req.user.id) return res.status(400).json({ error: 'Cannot join your own lobby' });
  if (lobby.status !== 'waiting') return res.status(409).json({ error: 'Lobby full' });
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
  const hasStakeTypeInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'stakeType');
  const resolvedStakeType = hasStakeTypeInput ? resolveStakeType(req.body?.stakeType) : 'FAKE';
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
      stakeType: resolvedStakeType,
      createdAt: nowIso()
    };
    db.data.lobbies.push(lobby);
  }
  if (!lobby.stakeType) lobby.stakeType = resolvedStakeType;
  if (hasStakeTypeInput && lobby.stakeType !== resolvedStakeType) lobby.stakeType = resolvedStakeType;
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
  const resolvedStake = resolveStakeType(stakeType);

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

async function handleBotForfeit(req, res) {
  const { matchId } = req.params;
  const match = matches.get(matchId);
  if (!match) {
    return res.json({ ok: true, alreadySettled: true });
  }
  if (!match.playerIds.includes(req.user.id)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const isBotMatch = match.playerIds.some((id) => isBotPlayer(id));
  if (!isBotMatch) {
    return res.status(400).json({ error: 'Forfeit endpoint is only available for bot matches.' });
  }
  leaveMatchByForfeit(match, req.user.id);
  await db.write();
  return res.json({ ok: true, forfeited: true });
}

app.post('/api/matches/:matchId/forfeit', authMiddleware, async (req, res) => {
  return handleBotForfeit(req, res);
});

app.post('/api/match/:matchId/forfeit', authMiddleware, async (req, res) => {
  return handleBotForfeit(req, res);
});

app.post('/api/matchmaking/join', authMiddleware, async (req, res) => {
  if (isUserInActiveMatch(req.user.id)) {
    return res.status(409).json({ error: 'Already in an active match' });
  }
  const bucket = normalizeQuickPlayBucket(req.body?.bucket);
  if (!bucket) {
    return res.status(400).json({ error: `Invalid quick play bucket. Choose one of: ${QUICK_PLAY_BUCKETS.join(', ')}` });
  }
  if (!canJoinQuickPlayBucket(req.user, bucket)) {
    return res.status(400).json({ error: `Need at least ${bucket} chips to enter this Quick Play bucket` });
  }
  const queued = enqueueQuickPlayUser(req.user.id, bucket);
  if (queued.error) {
    return res.status(400).json({ error: queued.error });
  }
  const matched = await processQuickPlayQueue(bucket);
  const found = matched.find((entry) => entry.userId === req.user.id);
  if (found) return res.json(found.payload);
  const status = quickPlayQueueStatus(req.user.id);
  return res.json({
    status: 'searching',
    bucket,
    fixedBet: bucket,
    queuePosition: status.queuePosition,
    queuedAt: status.queuedAt || queued.queuedAt || nowIso()
  });
});

app.post('/api/matchmaking/cancel', authMiddleware, async (req, res) => {
  const removed = removeFromQuickPlayQueue(req.user.id);
  return res.json({ status: 'cancelled', removed });
});

app.get('/api/matchmaking/status', authMiddleware, async (req, res) => {
  const status = quickPlayQueueStatus(req.user.id);
  return res.json({
    status: status.bucket ? 'searching' : 'idle',
    bucket: status.bucket,
    fixedBet: status.bucket,
    queuePosition: status.queuePosition,
    queuedAt: status.queuedAt
  });
});

app.post('/api/free-claim', authMiddleware, async (req, res) => {
  const freeClaim = freeClaimMeta(req.user);
  if (!freeClaim.available) {
    return res.status(409).json({
      reward: 0,
      chips: req.user.chips,
      claimed: false,
      claimedAt: req.user.lastStreakClaimAt || req.user.lastFreeClaimAt,
      nextAt: freeClaim.nextAt,
      streakCount: freeClaim.streakCount,
      nextReward: freeClaim.nextReward,
      error: 'Free claim on cooldown'
    });
  }
  const now = nowIso();
  const today = now.slice(0, 10);
  const prevClaim = req.user.lastStreakClaimAt || req.user.lastFreeClaimAt;
  const prevDay = prevClaim ? new Date(prevClaim).toISOString().slice(0, 10) : null;
  const yesterday = previousUtcDayIso(now);
  if (!prevDay) req.user.streakCount = 1;
  else if (prevDay === today) req.user.streakCount = Math.max(1, req.user.streakCount || 1);
  else if (prevDay === yesterday) req.user.streakCount = (req.user.streakCount || 0) + 1;
  else req.user.streakCount = 1;

  const reward = STREAK_REWARDS[(Math.max(1, req.user.streakCount) - 1) % STREAK_REWARDS.length];
  req.user.lastStreakClaimAt = now;
  req.user.lastFreeClaimAt = now;
  req.user.chips += reward;
  await db.write();
  emitUserUpdate(req.user.id);
  const next = freeClaimMeta(req.user);
  return res.json({
    reward,
    chips: req.user.chips,
    claimed: true,
    claimedAt: req.user.lastStreakClaimAt,
    nextAt: next.nextAt,
    streakCount: req.user.streakCount,
    nextReward: next.nextReward
  });
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
  const refreshedSkills = ensureSkillChallenges(req.user);
  if (refreshed || refreshedSkills) await db.write();
  const payload = buildChallengePayload(req.user);
  return res.json({
    challenges: payload.challenges,
    challengeList: payload.challengeList,
    challengeResets: payload.challengeResets,
    hourlyResetAt: payload.hourlyResetAt,
    dailyResetAt: payload.dailyResetAt,
    weeklyResetAt: payload.weeklyResetAt,
    nextDailyResetAt: payload.nextDailyResetAt,
    nextWeeklyResetAt: payload.nextWeeklyResetAt
  });
});

app.post('/api/challenges/claim', authMiddleware, async (req, res) => {
  const { id, challengeId } = req.body || {};
  const targetId = id || challengeId;
  refreshChallengesForUser(req.user);
  ensureSkillChallenges(req.user);
  const tiers = ['hourly', 'daily', 'weekly'];
  let target = null;
  for (const tier of tiers) {
    target = (req.user.challengeSets[tier]?.items || []).find((c) => c.id === targetId);
    if (target) break;
  }
  if (!target) {
    target = (req.user.skillChallenges || []).find((c) => c.id === targetId);
  }
  if (!target) return res.status(404).json({ error: 'Challenge not found' });
  if (target.claimed || target.claimedAt) return res.status(409).json({ error: 'Already claimed' });
  if (target.progress < target.goal) return res.status(400).json({ error: 'Not complete' });
  if (!target.completedAt) target.completedAt = nowIso();
  target.claimed = true;
  target.claimedAt = nowIso();
  const bankroll = creditUserBankroll(req.user, target.rewardChips);
  await db.write();
  emitUserUpdate(req.user.id);
  return res.json({ id: targetId, reward: target.rewardChips, chips: bankroll, bankroll, claimedAt: target.claimedAt });
});

app.get('/api/patch-notes', async (_req, res) => {
  const payload = await getPatchNotesPayload();
  return res.json(payload);
});

app.get('/api/version', (_req, res) => {
  const commit = deployCommitId();
  return res.json({ version: commit ? commit.slice(0, 7) : 'dev' });
});

app.get('/api/debug/persistence', (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  const info = storage.getInfo();
  return res.json({
    backend: info.backend,
    dataDir: info.dataDir,
    dbPath: info.dbPath,
    userCount: db.data.users.length,
    lastWriteTime: info.lastWriteTime
  });
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

  socket.on('matchmaking:join', async (payload = {}) => {
    if (isUserInActiveMatch(userId)) {
      socket.emit('matchmaking:error', { error: 'Already in an active match' });
      return;
    }
    const bucket = normalizeQuickPlayBucket(payload.bucket);
    if (!bucket) {
      socket.emit('matchmaking:error', { error: `Invalid quick play bucket. Choose one of: ${QUICK_PLAY_BUCKETS.join(', ')}` });
      return;
    }
    const user = getUserById(userId);
    if (!canJoinQuickPlayBucket(user, bucket)) {
      socket.emit('matchmaking:error', { error: `Need at least ${bucket} chips to enter this Quick Play bucket` });
      return;
    }
    const queued = enqueueQuickPlayUser(userId, bucket);
    if (queued.error) {
      socket.emit('matchmaking:error', { error: queued.error });
      return;
    }
    const matched = await processQuickPlayQueue(bucket);
    const found = matched.find((entry) => entry.userId === userId);
    if (found) return;
    const status = quickPlayQueueStatus(userId);
    socket.emit('matchmaking:searching', {
      status: 'searching',
      bucket,
      fixedBet: bucket,
      queuePosition: status.queuePosition,
      queuedAt: status.queuedAt || queued.queuedAt || nowIso()
    });
  });

  socket.on('matchmaking:cancel', () => {
    const removed = removeFromQuickPlayQueue(userId);
    socket.emit('matchmaking:cancelled', { status: 'cancelled', removed });
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

  socket.on('match:nextRound', (payload = {}) => {
    const { matchId } = payload;
    const match = matches.get(matchId);
    if (!match) return socket.emit('match:error', { error: 'Match not found' });
    if (!match.playerIds.includes(userId)) return socket.emit('match:error', { error: 'Unauthorized' });
    const result = applyRoundResultChoice(match, userId, 'next');
    if (result.error) return socket.emit('match:error', result);
    pushMatchState(match);
    db.write();
    scheduleBotBetConfirm(match);
    scheduleBotTurn(match);
    return null;
  });

  socket.on('match:changeBet', (payload = {}) => {
    const { matchId } = payload;
    const match = matches.get(matchId);
    if (!match) return socket.emit('match:error', { error: 'Match not found' });
    if (!match.playerIds.includes(userId)) return socket.emit('match:error', { error: 'Unauthorized' });
    const result = applyRoundResultChoice(match, userId, 'betting');
    if (result.error) return socket.emit('match:error', result);
    pushMatchState(match);
    db.write();
    scheduleBotBetConfirm(match);
    scheduleBotTurn(match);
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

  socket.on('match:chat', (payload = {}) => {
    const { matchId, text } = payload;
    const match = matches.get(matchId);
    if (!match) return socket.emit('match:error', { error: 'Match not found' });
    const result = appendMatchChatMessage(match, userId, text);
    if (result.error) return socket.emit('match:error', result);
    for (const pid of match.playerIds) {
      emitToUser(pid, 'match:chat', {
        matchId: match.id,
        message: result.message,
        chat: result.chat
      });
    }
    return null;
  });

  socket.on('match:leave', (payload = {}) => {
    const { matchId } = payload;
    const match = matches.get(matchId);
    if (!match) return socket.emit('match:error', { error: 'Match not found' });
    if (!match.playerIds.includes(userId)) return socket.emit('match:error', { error: 'Unauthorized' });
    leaveMatchByForfeit(match, userId);
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
    removeFromQuickPlayQueue(userId);

    for (const match of matches.values()) {
      if (!match.playerIds.includes(userId)) continue;
      if (isBotPlayer(userId)) continue;
      if (match.playerIds.some((id) => isBotPlayer(id))) {
        leaveMatchByForfeit(match, userId);
        continue;
      }
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
        cleanupMatch(match);
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
  applyRoundResultChoice,
  applyPressureDecision,
  newHand,
  hasPlayableHand,
  advanceToNextPlayableHand,
  serializeMatchFor,
  refreshChallengesForUser,
  recordChallengeEventForMatch,
  buildChallengePayload,
  isRealMatch,
  countWinningSplitHandsForPlayer,
  calculateForfeitLossAmount,
  getBotObservation,
  chooseBotActionFromObservation
};

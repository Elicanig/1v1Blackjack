import express from 'express';
import http from 'http';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';
import { randomInt as cryptoRandomInt } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createStorage } from './db/storage.js';
import { hasDatabaseUrl, getPool } from './db/pool.js';

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
const QUICK_PLAY_BUCKETS = [10, 50, 100, 250, 500, 1000, 2000, 5000];
const RANKED_BASE_ELO = 1000;
const RANKED_ELO_DELTA_CLAMP = 35;
const RANKED_PUSH_DELTA_SCALE = 0.25;
const RANKED_PUSH_DELTA_CAP = 3;
const RANKED_SERIES_WIN_DELTA_MIN = 1;
const RANKED_SERIES_WIN_DELTA_MAX = 34;
const RANKED_SERIES_LOSS_DELTA_MIN = -18;
const RANKED_SERIES_LOSS_DELTA_MAX = -8;
const RANKED_MATCH_MAX_ELO_GAP = 220;
const RANKED_QUEUE_TIMEOUT_MS = 60_000;
const RANKED_SERIES_TARGET_GAMES = 9;
const RANKED_SERIES_STATUS = Object.freeze({
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FORFEITED: 'FORFEITED'
});
const RANKED_TIERS = Object.freeze([
  { key: 'BRONZE', label: 'Bronze', min: 0, max: 1149, bets: { min: 50, max: 50 } },
  { key: 'SILVER', label: 'Silver', min: 1150, max: 1349, bets: { min: 100, max: 100 } },
  { key: 'GOLD', label: 'Gold', min: 1350, max: 1549, bets: { min: 250, max: 250 } },
  { key: 'DIAMOND', label: 'Diamond', min: 1550, max: 1799, bets: { min: 500, max: 500 } },
  { key: 'LEGENDARY', label: 'Legendary', min: 1800, max: Number.POSITIVE_INFINITY, bets: { min: 1000, max: 1000 } }
]);
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
const NOTIFICATION_SEEN_TTL_MS = 60 * 60 * 1000;
const NOTIFICATION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const HOURLY_RESET_MS = 60 * 60 * 1000;
const DAILY_RESET_MS = 24 * 60 * 60 * 1000;
const WEEKLY_RESET_MS = 7 * 24 * 60 * 60 * 1000;
const LEADERBOARD_CACHE_MS = 30_000;
const LEADERBOARD_MAX_LIMIT = 50;
const LEADERBOARD_DEFAULT_LIMIT = 25;
const HIGH_ROLLER_UNLOCK_CHIPS = 10_000;
const HIGH_ROLLER_MIN_BET = 2500;
const MAX_BET_HARD_CAP = 10_000_000;
const SPLIT_TENS_EVENT_ID = 'split_tens_24h';
const SPLIT_TENS_EVENT_DURATION_MS = 24 * 60 * 60 * 1000;
const SPLIT_TENS_EVENT_ENABLED = parseEnvBoolean(
  process.env.SPLIT_TENS_EVENT_ENABLED || (process.env.SPLIT_TENS_EVENT_STARTS_AT ? '1' : '')
);
const SPLIT_TENS_EVENT_FALLBACK_STARTS_AT_MS = Date.now();
const SPLIT_TENS_EVENT_STARTS_AT_MS = parseIsoTimestampMs(process.env.SPLIT_TENS_EVENT_STARTS_AT || '');
const XP_REWARDS = Object.freeze({
  pvpWin: 40,
  pvpLoss: 15,
  botWin: 10,
  botLoss: 5,
  challenge: 75
});
const XP_BET_BASELINE = 100;
const XP_BET_MULTIPLIER_CAP = 3.2;
const PROFILE_BORDER_DEFS = Object.freeze([
  { id: 'NONE', name: 'None', minLevelRequired: 1, tier: 'Default', previewToken: 'none' },
  { id: 'BRONZE_TRIM', name: 'Bronze Trim', minLevelRequired: 10, tier: 'Common', previewToken: 'bronze-trim' },
  { id: 'GILDED_EDGE', name: 'Gilded Edge', minLevelRequired: 20, tier: 'Uncommon', previewToken: 'gilded-edge' },
  { id: 'EMERALD_CIRCUIT', name: 'Emerald Circuit', minLevelRequired: 30, tier: 'Rare', previewToken: 'emerald-circuit' },
  { id: 'NEBULA_FRAME', name: 'Nebula Frame', minLevelRequired: 40, tier: 'Epic', previewToken: 'nebula-frame' },
  { id: 'MYTHIC_CREST', name: 'Mythic Crest', minLevelRequired: 50, tier: 'Mythic', previewToken: 'mythic-crest' },
  { id: 'ROYAL_AURORA', name: 'Royal Aurora', minLevelRequired: 60, tier: 'Mythic', previewToken: 'royal-aurora' },
  { id: 'OBSIDIAN_CROWN', name: 'Obsidian Crown', minLevelRequired: 70, tier: 'Legendary', previewToken: 'obsidian-crown' },
  { id: 'SOLAR_FLARE', name: 'Solar Flare', minLevelRequired: 80, tier: 'Legendary', previewToken: 'solar-flare' },
  { id: 'CELESTIAL_LATTICE', name: 'Celestial Lattice', minLevelRequired: 90, tier: 'Ascendant', previewToken: 'celestial-lattice' },
  { id: 'ETERNAL_SOVEREIGN', name: 'Eternal Sovereign', minLevelRequired: 100, tier: 'Ascendant', previewToken: 'eternal-sovereign' }
]);
const PROFILE_BORDER_DEFS_BY_ID = Object.freeze(
  Object.fromEntries(PROFILE_BORDER_DEFS.map((border) => [border.id, border]))
);
const DECK_SKIN_DEFS = Object.freeze([
  { id: 'CLASSIC', name: 'Classic Felt', description: 'Traditional white cards and emerald backs.', minLevelRequired: 1, unlockHint: 'Available by default.' },
  { id: 'GOLD', name: 'Gold Reserve', description: 'Warm ivory cards with gilded trim.', minLevelRequired: 10, unlockHint: 'Reach level 10.' },
  { id: 'NEON', name: 'Neon Pulse', description: 'Cyber-glow accents with crisp contrast.', minLevelRequired: 20, unlockHint: 'Reach level 20.' },
  { id: 'OBSIDIAN', name: 'Obsidian Luxe', description: 'Dark premium face with metallic highlights.', minLevelRequired: 35, unlockHint: 'Reach level 35.' },
  { id: 'AURORA', name: 'Aurora Royale', description: 'Prismatic finish with subtle shimmer.', minLevelRequired: 50, unlockHint: 'Reach level 50.' },
  {
    id: 'OBSIDIAN_LUXE_II',
    name: 'Obsidian Luxe II',
    description: 'Deep black stone with gold inlays and ember accents.',
    minLevelRequired: 1,
    unlockCondition: { type: 'bestMatchWinStreak', threshold: 20 },
    unlockHint: 'Reach a 20-match win streak.'
  },
  {
    id: 'AURORA_ROYALE_II',
    name: 'Aurora Royale II',
    description: 'Animated aurora gradient with royal trim.',
    minLevelRequired: 1,
    unlockCondition: { type: 'rankedElo', threshold: 1900 },
    unlockHint: 'Reach 1900 ranked Elo.'
  },
  {
    id: 'VOID_PRISM',
    name: 'Void Prism',
    description: 'Dark glass with shifting spectral highlights.',
    minLevelRequired: 1,
    unlockCondition: { type: 'rankedWins', threshold: 120 },
    unlockHint: 'Win 120 ranked series.'
  },
  {
    id: 'CELESTIAL_IVORY',
    name: 'Celestial Ivory',
    description: 'Pearl-white marble with star-gold filigree.',
    minLevelRequired: 1,
    unlockCondition: { type: 'blackjacks', threshold: 300 },
    unlockHint: 'Deal 300 natural blackjacks.'
  }
]);
const DECK_SKIN_DEFS_BY_ID = Object.freeze(
  Object.fromEntries(DECK_SKIN_DEFS.map((skin) => [skin.id, skin]))
);
const TITLE_DEFS_LIST = Object.freeze([
  {
    key: 'HIGH_ROLLER',
    label: 'High Roller',
    category: 'skill',
    unlockCondition: { type: 'highRollerMatches', threshold: 10 },
    requirementText: 'Play 10 high roller matches.',
    description: 'Play 10 high roller matches.'
  },
  {
    key: 'GIANT_KILLER',
    label: 'Giant Killer',
    category: 'skill',
    unlockCondition: { type: 'manual' },
    requirementText: 'Beat a higher-level or richer opponent.',
    description: 'Beat a higher-level or richer opponent.'
  },
  {
    key: 'STREAK_LORD',
    label: 'Streak Lord',
    category: 'skill',
    unlockCondition: { type: 'bestMatchWinStreak', threshold: 10 },
    requirementText: 'Reach a 10-match win streak.',
    description: 'Reach a 10-match win streak.'
  },
  {
    key: 'RISING_STAR',
    label: 'Rising Star',
    category: 'level',
    unlockCondition: { type: 'level', threshold: 10 },
    requirementText: 'Reach level 10.',
    description: 'A strong start at the tables.'
  },
  {
    key: 'TABLE_REGULAR',
    label: 'Table Regular',
    category: 'level',
    unlockCondition: { type: 'level', threshold: 25 },
    requirementText: 'Reach level 25.',
    description: 'A familiar face in every lobby.'
  },
  {
    key: 'VETERAN',
    label: 'Veteran',
    category: 'level',
    unlockCondition: { type: 'level', threshold: 50 },
    requirementText: 'Reach level 50.',
    description: 'Experience and composure under pressure.'
  },
  {
    key: 'ELITE_GRINDER',
    label: 'Elite Grinder',
    category: 'level',
    unlockCondition: { type: 'level', threshold: 75 },
    requirementText: 'Reach level 75.',
    description: 'Relentless sessions and steady gains.'
  },
  {
    key: 'LEGEND',
    label: 'Legend',
    category: 'level',
    unlockCondition: { type: 'level', threshold: 100 },
    requirementText: 'Reach level 100.',
    description: 'A true blackjack legend.'
  },
  {
    key: 'BLACKJACK_MAGNET',
    label: 'Blackjack Magnet',
    category: 'skill',
    unlockCondition: { type: 'blackjacks', threshold: 25 },
    requirementText: 'Deal 25 natural blackjacks.',
    description: 'Naturals seem to find you.'
  },
  {
    key: 'NATURAL_BORN',
    label: 'Natural Born',
    category: 'skill',
    unlockCondition: { type: 'blackjacks', threshold: 75 },
    requirementText: 'Deal 75 natural blackjacks.',
    description: 'Born for blackjack.'
  },
  {
    key: 'SPLIT_SPECIALIST',
    label: 'Split Specialist',
    category: 'skill',
    unlockCondition: { type: 'splitsAttempted', threshold: 25 },
    requirementText: 'Use Split 25 times.',
    description: 'You see value in every pair.'
  },
  {
    key: 'DOUBLE_TROUBLE',
    label: 'Double Trouble',
    category: 'skill',
    unlockCondition: { type: 'doublesAttempted', threshold: 25 },
    requirementText: 'Use Double 25 times.',
    description: 'Aggressive pressure pays off.'
  },
  {
    key: 'PUSH_MASTER',
    label: 'Push Master',
    category: 'skill',
    unlockCondition: { type: 'pushes', threshold: 40 },
    requirementText: 'Record 40 pushes.',
    description: 'Impossible to put away.'
  },
  {
    key: 'ROAD_WARRIOR',
    label: 'Road Warrior',
    category: 'skill',
    unlockCondition: { type: 'matchesPlayed', threshold: 100 },
    requirementText: 'Complete 100 matches.',
    description: 'You have seen every table state.'
  },
  {
    key: 'TABLE_SHARK',
    label: 'Table Shark',
    category: 'skill',
    unlockCondition: { type: 'handsWon', threshold: 150 },
    requirementText: 'Win 150 hands.',
    description: 'Efficient, sharp, and dangerous.'
  },
  {
    key: 'CHIP_COLLECTOR',
    label: 'Chip Collector',
    category: 'skill',
    unlockCondition: { type: 'totalChipsWon', threshold: 5000 },
    requirementText: 'Win 5,000 chips total.',
    description: 'Stacking chips consistently.'
  },
  {
    key: 'CHIP_TITAN',
    label: 'Chip Titan',
    category: 'skill',
    unlockCondition: { type: 'totalChipsWon', threshold: 20000 },
    requirementText: 'Win 20,000 chips total.',
    description: 'A heavyweight of the tables.'
  },
  {
    key: 'RANKED_CONTENDER',
    label: 'Ranked Contender',
    category: 'skill',
    unlockCondition: { type: 'rankedWins', threshold: 10 },
    requirementText: 'Win 10 ranked series.',
    description: 'You belong in the ranked queue.'
  },
  {
    key: 'RANKED_CONQUEROR',
    label: 'Ranked Conqueror',
    category: 'skill',
    unlockCondition: { type: 'rankedWins', threshold: 30 },
    requirementText: 'Win 30 ranked series.',
    description: 'A feared ranked finisher.'
  },
  {
    key: 'PVP_DUELIST',
    label: 'PvP Duelist',
    category: 'skill',
    unlockCondition: { type: 'pvpWins', threshold: 25 },
    requirementText: 'Win 25 PvP matches.',
    description: 'Battle-tested against real opponents.'
  },
  {
    key: 'SEVEN_SENSE',
    label: 'Seven Sense',
    category: 'skill',
    unlockCondition: { type: 'sixSevenDealt', threshold: 20 },
    requirementText: "Get 20 starting 6-7's.",
    description: "You always feel the 6-7 coming."
  },
  {
    key: 'DAILY_GRINDER',
    label: 'Daily Grinder',
    category: 'skill',
    unlockCondition: { type: 'dailyWinStreak', threshold: 7 },
    requirementText: 'Reach a 7-day daily win streak.',
    description: 'Consistent every day.'
  },
  {
    key: 'UNBREAKABLE',
    label: 'Unbreakable',
    category: 'skill',
    unlockCondition: { type: 'bestMatchWinStreak', threshold: 15 },
    requirementText: 'Reach a 15-match win streak.',
    description: 'The streak keeps climbing.'
  },
  {
    key: 'ACE_ENGINEER',
    label: 'Ace Engineer',
    category: 'skill',
    unlockCondition: { type: 'doublesAttempted', threshold: 75 },
    requirementText: 'Use Double 75 times.',
    description: 'You weaponize every doubling spot.'
  },
  {
    key: 'TABLE_ARCHITECT',
    label: 'Table Architect',
    category: 'skill',
    unlockCondition: { type: 'splitsAttempted', threshold: 75 },
    requirementText: 'Use Split 75 times.',
    description: 'You engineer multi-hand pressure.'
  },
  {
    key: 'IRON_BANKROLL',
    label: 'Iron Bankroll',
    category: 'skill',
    unlockCondition: { type: 'totalChipsWon', threshold: 50000 },
    requirementText: 'Win 50,000 chips total.',
    description: 'Your stack keeps climbing.'
  },
  {
    key: 'SERIES_GENERAL',
    label: 'Series General',
    category: 'skill',
    unlockCondition: { type: 'rankedWins', threshold: 60 },
    requirementText: 'Win 60 ranked series.',
    description: 'Series strategy mastery.'
  },
  {
    key: 'HEADHUNTER',
    label: 'Headhunter',
    category: 'skill',
    unlockCondition: { type: 'pvpWins', threshold: 80 },
    requirementText: 'Win 80 PvP matches.',
    description: 'You hunt and finish real opponents.'
  },
  {
    key: 'WINDFALL',
    label: 'Windfall',
    category: 'skill',
    unlockCondition: { type: 'handsWon', threshold: 300 },
    requirementText: 'Win 300 hands.',
    description: 'Relentless hand-by-hand execution.'
  },
  {
    key: 'TABLE_ANCHOR',
    label: 'Table Anchor',
    category: 'skill',
    unlockCondition: { type: 'matchesPlayed', threshold: 250 },
    requirementText: 'Complete 250 matches.',
    description: 'A permanent fixture at the tables.'
  },
  {
    key: 'IMMORTAL_STREAK',
    label: 'Immortal Streak',
    category: 'skill',
    unlockCondition: { type: 'bestMatchWinStreak', threshold: 20 },
    requirementText: 'Reach a 20-match win streak.',
    description: 'Pressure does not break you.'
  }
]);
const TITLE_DEFS = Object.freeze(
  Object.fromEntries(TITLE_DEFS_LIST.map((title) => [title.key, title]))
);
const FAVORITE_STAT_KEYS = Object.freeze([
  'TOTAL_MATCHES',
  'HANDS_WON',
  'HANDS_LOST',
  'PUSHES',
  'BLACKJACKS',
  'SIX_SEVEN_DEALT',
  'SPLITS_ATTEMPTED',
  'DOUBLES_ATTEMPTED',
  'SURRENDERS',
  'BUSTS',
  'LONGEST_WIN_STREAK',
  'LONGEST_LOSS_STREAK',
  'RANKED_ELO',
  'RANKED_WINS',
  'RANKED_LOSSES',
  'PVP_WINS',
  'PVP_LOSSES',
  'NET_CHIPS',
  'TOTAL_CHIPS_WON',
  'TOTAL_CHIPS_LOST',
  'BIGGEST_HAND_WIN',
  'BIGGEST_HAND_LOSS',
  'AVERAGE_BET',
  'BOT_PRACTICE_HANDS',
  'BOT_REAL_HANDS',
  'PVP_REAL_HANDS',
  'PVP_FRIENDLY_HANDS',
  'DAILY_STREAK'
]);
const FAVORITE_STAT_DEFAULT = FAVORITE_STAT_KEYS[0];
const DYNAMIC_BADGES = Object.freeze({
  TOP_1: { key: 'TOP_1', label: 'Top 1', short: '#1' },
  TOP_5: { key: 'TOP_5', label: 'Top 5', short: 'Top 5' },
  TOP_10: { key: 'TOP_10', label: 'Top 10', short: 'Top 10' }
});
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
  friendChallenges: [],
  rankedHistory: [],
  rankedSeries: [],
  botLearning: {
    sampleSize: 0,
    actionCounts: {
      hit: 0,
      stand: 0,
      double: 0,
      split: 0,
      surrender: 0
    },
    aggression: 0.5
  }
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
let leaderboardCache = {
  at: 0,
  rows: [],
  rankByUserId: new Map()
};

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
  if (String(process.env.DEBUG_BLACKJACK_RNG || '') === '1') {
    // Dev-only Monte Carlo sanity check; expected single-hand natural blackjack rate is ~4.8%.
    const rngSample = sampleBlackjackFrequency(10_000);
    // eslint-disable-next-line no-console
    console.log('[rng-sanity]', JSON.stringify(rngSample));
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
      .map((n) => {
        const seenAt = n.seenAt || n.seen_at || null;
        const seenTs = seenAt ? new Date(seenAt).getTime() : NaN;
        const seenIso = Number.isFinite(seenTs) ? new Date(seenTs).toISOString() : null;
        const expiresAt = n.expiresAt || n.expires_at || null;
        const fallbackExpires = seenIso ? new Date(new Date(seenIso).getTime() + NOTIFICATION_SEEN_TTL_MS).toISOString() : null;
        const expiresTs = expiresAt ? new Date(expiresAt).getTime() : NaN;
        return {
          id: n.id || nanoid(10),
          type: n.type || 'info',
          message: n.message || '',
          createdAt: n.createdAt || nowIso(),
          action: n.action || null,
          requestId: typeof n.requestId === 'string' ? n.requestId : null,
          fromUserId: typeof n.fromUserId === 'string' ? n.fromUserId : null,
          read: Boolean(n.read || seenIso),
          seenAt: seenIso,
          seen_at: seenIso,
          expiresAt: Number.isFinite(expiresTs) ? new Date(expiresTs).toISOString() : fallbackExpires,
          expires_at: Number.isFinite(expiresTs) ? new Date(expiresTs).toISOString() : fallbackExpires
        };
      })
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
          entry.seenAt !== (prev.seenAt || prev.seen_at || null) ||
          entry.expiresAt !== (prev.expiresAt || prev.expires_at || null) ||
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
    const generatedPin = user.pin ? String(user.pin) : String(randomIntInclusive(1000, 9999));
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
  if (!user.skillChallengeState || typeof user.skillChallengeState !== 'object' || Array.isArray(user.skillChallengeState)) {
    user.skillChallengeState = { expiresAt: null, history: [] };
    dbTouched = true;
  } else {
    if (!Array.isArray(user.skillChallengeState.history)) {
      user.skillChallengeState.history = [];
      dbTouched = true;
    }
    if (user.skillChallengeState.expiresAt === undefined) {
      user.skillChallengeState.expiresAt = null;
      dbTouched = true;
    }
  }
  if (!user.headToHead || typeof user.headToHead !== 'object' || Array.isArray(user.headToHead)) {
    user.headToHead = {};
    dbTouched = true;
  }
  if (!Array.isArray(user.unlockedTitles)) {
    user.unlockedTitles = [];
    dbTouched = true;
  }
  if (typeof user.selectedTitle !== 'string') {
    user.selectedTitle = '';
    dbTouched = true;
  }
  if (typeof user.selectedBorderId !== 'string') {
    user.selectedBorderId = 'NONE';
    dbTouched = true;
  }
  if (typeof user.selectedDeckSkin !== 'string') {
    user.selectedDeckSkin = 'CLASSIC';
    dbTouched = true;
  }
  if (typeof user.customStatText !== 'string') {
    user.customStatText = '';
    dbTouched = true;
  }
  if (typeof user.favoriteStatKey !== 'string') {
    user.favoriteStatKey = FAVORITE_STAT_DEFAULT;
    dbTouched = true;
  }
  if (user.activeRankedSeriesId !== null && user.activeRankedSeriesId !== undefined && typeof user.activeRankedSeriesId !== 'string') {
    user.activeRankedSeriesId = String(user.activeRankedSeriesId);
    dbTouched = true;
  }
  if (user.activeRankedSeriesId === undefined) {
    user.activeRankedSeriesId = null;
    dbTouched = true;
  }
  if (!Number.isFinite(Number(user.xp))) {
    user.xp = 0;
    dbTouched = true;
  } else {
    const normalizedXp = Math.max(0, Math.floor(Number(user.xp) || 0));
    if (normalizedXp !== user.xp) {
      user.xp = normalizedXp;
      dbTouched = true;
    }
  }
  if (!Number.isFinite(Number(user.pvpWins))) {
    user.pvpWins = 0;
    dbTouched = true;
  }
  if (!Number.isFinite(Number(user.pvpLosses))) {
    user.pvpLosses = 0;
    dbTouched = true;
  }
  if (!Number.isFinite(Number(user.currentMatchWinStreak))) {
    user.currentMatchWinStreak = 0;
    dbTouched = true;
  }
  if (!Number.isFinite(Number(user.bestMatchWinStreak))) {
    user.bestMatchWinStreak = 0;
    dbTouched = true;
  }
  if (!Number.isFinite(Number(user.highRollerMatchCount))) {
    user.highRollerMatchCount = 0;
    dbTouched = true;
  }
  if (!Number.isFinite(Number(user.dailyWinStreakCount))) {
    user.dailyWinStreakCount = 0;
    dbTouched = true;
  }
  if (user.lastDailyWinDate !== null && user.lastDailyWinDate !== undefined && typeof user.lastDailyWinDate !== 'string') {
    user.lastDailyWinDate = null;
    dbTouched = true;
  }
  if (!user.lastDailyWinDate) {
    user.lastDailyWinDate = null;
  }
  if (!Number.isFinite(Number(user.rankedElo))) {
    user.rankedElo = RANKED_BASE_ELO;
    dbTouched = true;
  }
  if (!Number.isFinite(Number(user.rankedWins))) {
    user.rankedWins = 0;
    dbTouched = true;
  }
  if (!Number.isFinite(Number(user.rankedLosses))) {
    user.rankedLosses = 0;
    dbTouched = true;
  }
  if (!Number.isFinite(Number(user.rankedGames))) {
    user.rankedGames = Math.max(0, Math.floor(Number(user.rankedWins) || 0) + Math.floor(Number(user.rankedLosses) || 0));
    dbTouched = true;
  }
  if (!Number.isFinite(Number(user.rankedLossStreak))) {
    user.rankedLossStreak = 0;
    dbTouched = true;
  }
  if (!Number.isFinite(Number(user.lastLevelRewarded))) {
    const currentLevel = levelFromXp(user.xp || 0);
    user.lastLevelRewarded = Math.floor(currentLevel / 5) * 5;
    dbTouched = true;
  }
  if (typeof user.rankTier !== 'string') {
    user.rankTier = rankedTierFromElo(user.rankedElo).key;
    dbTouched = true;
  }
  if (!Number.isFinite(Number(user.peakRankedElo))) {
    user.peakRankedElo = Math.max(RANKED_BASE_ELO, Math.floor(Number(user.rankedElo) || RANKED_BASE_ELO));
    dbTouched = true;
  }
  if (typeof user.peakRankTier !== 'string') {
    user.peakRankTier = rankedTierFromElo(user.peakRankedElo).key;
    dbTouched = true;
  }
  if (ensureRankedState(user)) {
    dbTouched = true;
  }
  if (recomputeTitleUnlocks(user)) {
    dbTouched = true;
  }
  if (ensureProfileBorderState(user)) {
    dbTouched = true;
  }
  const cleanCustomStat = sanitizeCustomStatText(user.customStatText || '');
  if (cleanCustomStat !== user.customStatText) {
    user.customStatText = cleanCustomStat;
    dbTouched = true;
  }
  const cleanFavoriteStat = sanitizeFavoriteStatKey(user.favoriteStatKey);
  if (cleanFavoriteStat !== user.favoriteStatKey) {
    user.favoriteStatKey = cleanFavoriteStat;
    dbTouched = true;
  }
  const cleanDeckSkin = normalizeDeckSkinId(user.selectedDeckSkin);
  if (cleanDeckSkin !== user.selectedDeckSkin) {
    user.selectedDeckSkin = cleanDeckSkin;
    dbTouched = true;
  }
  if (!deckSkinUnlockedForUser(user, user.selectedDeckSkin)) {
    user.selectedDeckSkin = 'CLASSIC';
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
if (!Array.isArray(db.data.rankedHistory)) {
  db.data.rankedHistory = [];
  dbTouched = true;
}
if (!Array.isArray(db.data.rankedSeries)) {
  db.data.rankedSeries = [];
  dbTouched = true;
} else {
  for (const series of db.data.rankedSeries) {
    if (!series || typeof series !== 'object') continue;
    const normalizedStatus = normalizeRankedSeriesStatus(series.status);
    if (series.status !== normalizedStatus) {
      series.status = normalizedStatus;
      dbTouched = true;
    }
    if (!series.endedAt && (normalizedStatus === RANKED_SERIES_STATUS.COMPLETED || normalizedStatus === RANKED_SERIES_STATUS.FORFEITED)) {
      series.endedAt = series.completedAt || nowIso();
      if (!series.completedAt) series.completedAt = series.endedAt;
      dbTouched = true;
    }
    if (normalizedStatus === RANKED_SERIES_STATUS.IN_PROGRESS && !Number.isFinite(Number(series.gameIndex || series.game_index))) {
      series.gameIndex = 1;
      series.game_index = 1;
      dbTouched = true;
    }
  }
}
if (!db.data.botLearning || typeof db.data.botLearning !== 'object' || Array.isArray(db.data.botLearning)) {
  db.data.botLearning = {
    sampleSize: 0,
    actionCounts: { hit: 0, stand: 0, double: 0, split: 0, surrender: 0 },
    aggression: 0.5
  };
  dbTouched = true;
} else {
  if (!db.data.botLearning.actionCounts || typeof db.data.botLearning.actionCounts !== 'object') {
    db.data.botLearning.actionCounts = { hit: 0, stand: 0, double: 0, split: 0, surrender: 0 };
    dbTouched = true;
  }
  for (const actionKey of ['hit', 'stand', 'double', 'split', 'surrender']) {
    if (!Number.isFinite(Number(db.data.botLearning.actionCounts[actionKey]))) {
      db.data.botLearning.actionCounts[actionKey] = 0;
      dbTouched = true;
    }
  }
  if (!Number.isFinite(Number(db.data.botLearning.sampleSize))) {
    db.data.botLearning.sampleSize = 0;
    dbTouched = true;
  }
  if (!Number.isFinite(Number(db.data.botLearning.aggression))) {
    db.data.botLearning.aggression = 0.5;
    dbTouched = true;
  }
}
if (dbTouched) await db.write();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: nowIso() });
});

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
const rankedQueue = [];
const rankedQueueByUser = new Map();
const presenceByUser = new Map();
let patchNotesCache = { at: 0, payload: null };

if (process.env.NODE_ENV !== 'test') {
  const notificationCleanupTimer = setInterval(() => {
    if (cleanupExpiredNotificationsGlobally()) {
      db.write();
    }
  }, NOTIFICATION_CLEANUP_INTERVAL_MS);
  if (typeof notificationCleanupTimer.unref === 'function') {
    notificationCleanupTimer.unref();
  }
}

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

const SKILL_CHALLENGE_ACTIVE_COUNT = 4;
const SKILL_CHALLENGE_NO_REPEAT_DAYS = 3;
const SKILL_CHALLENGE_POOL = [
  { key: 'skill_double_win_once', title: 'Double Clutch', description: 'Win one hand after doubling down.', goal: 1, rewardChips: 70, event: 'double_win', icon: 'DBL' },
  { key: 'skill_double_win_twice', title: 'Double Discipline', description: 'Win two doubled hands.', goal: 2, rewardChips: 92, event: 'double_win', icon: 'DBL' },
  { key: 'skill_split_win_once', title: 'Split Payoff', description: 'Win one split hand.', goal: 1, rewardChips: 76, event: 'split_win', icon: 'SPL' },
  { key: 'skill_split_win_twice', title: 'Split Pressure', description: 'Win two split hands.', goal: 2, rewardChips: 98, event: 'split_win', icon: 'SPL' },
  { key: 'skill_exact_20_win', title: 'Perfect Twenty', description: 'Win with an exact total of 20.', goal: 1, rewardChips: 72, event: 'exact_20_win', icon: '20' },
  { key: 'skill_exact_20_win_twice', title: 'Twenty Twice', description: 'Win twice with exact 20.', goal: 2, rewardChips: 96, event: 'exact_20_win', icon: '20' },
  { key: 'skill_five_card_win', title: 'Five Card Finish', description: 'Win with a 5-card hand.', goal: 1, rewardChips: 80, event: 'five_card_win', icon: '5C' },
  { key: 'skill_low_total_win', title: 'Thin Margin', description: 'Win with 19 or less.', goal: 1, rewardChips: 72, event: 'low_total_win', icon: '19' },
  { key: 'skill_low_total_win_twice', title: 'Low Total Duel', description: 'Win two hands with 19 or less.', goal: 2, rewardChips: 94, event: 'low_total_win', icon: '19' },
  { key: 'skill_blackjack_once', title: 'Natural Edge', description: 'Get one natural blackjack.', goal: 1, rewardChips: 78, event: 'blackjack', icon: 'BJ' },
  { key: 'skill_blackjack_twice', title: 'Natural Pair', description: 'Get two natural blackjacks.', goal: 2, rewardChips: 104, event: 'blackjack', icon: 'BJ' },
  { key: 'skill_stand_16_twice', title: 'Disciplined Stand', description: 'Stand on 16+ twice.', goal: 2, rewardChips: 66, event: 'stand_16_plus', icon: 'STD' },
  { key: 'skill_stand_16_triple', title: 'Calm Nerves', description: 'Stand on 16+ three times.', goal: 3, rewardChips: 82, event: 'stand_16_plus', icon: 'STD' },
  { key: 'skill_controlled_hit_win', title: 'Controlled Risk', description: 'Win while hitting at most once.', goal: 1, rewardChips: 74, event: 'controlled_hit_win', icon: 'CTL' },
  { key: 'skill_controlled_hit_win_twice', title: 'Tight Lines', description: 'Win two hands while hitting at most once.', goal: 2, rewardChips: 98, event: 'controlled_hit_win', icon: 'CTL' },
  { key: 'skill_win_vs_ace_up', title: 'Ace Hunter', description: 'Win when opponent shows an Ace upcard.', goal: 1, rewardChips: 84, event: 'win_vs_ace_up', icon: 'ACE' },
  { key: 'skill_win_vs_ace_up_twice', title: 'Ace Punisher', description: 'Win twice when opponent shows an Ace.', goal: 2, rewardChips: 108, event: 'win_vs_ace_up', icon: 'ACE' },
  { key: 'skill_surrender_once', title: 'Tactical Fold', description: 'Use surrender once to minimize loss.', goal: 1, rewardChips: 58, event: 'surrender_used', icon: 'SUR' },
  { key: 'skill_clean_win_pair', title: 'Clean Sequence', description: 'Win two hands without busting.', goal: 2, rewardChips: 72, event: 'win_no_bust', icon: 'CLN' },
  { key: 'skill_clean_win_triple', title: 'Clean Control', description: 'Win three hands without busting.', goal: 3, rewardChips: 96, event: 'win_no_bust', icon: 'CLN' },
  { key: 'skill_push_once', title: 'Deadlock', description: 'Record one push hand.', goal: 1, rewardChips: 54, event: 'push', icon: 'PSH' },
  { key: 'skill_push_twice', title: 'Table Standoff', description: 'Record two push hands.', goal: 2, rewardChips: 70, event: 'push', icon: 'PSH' },
  { key: 'skill_round_win_once', title: 'Round Closer', description: 'Win one full round by chips.', goal: 1, rewardChips: 68, event: 'round_won', icon: 'RND' },
  { key: 'skill_round_win_twice', title: 'Round Controller', description: 'Win two rounds by chips.', goal: 2, rewardChips: 92, event: 'round_won', icon: 'RND' },
  { key: 'skill_bot_medium_win', title: 'Beat Medium Bot', description: 'Win a round versus a Medium bot.', goal: 1, rewardChips: 88, event: 'bot_medium_round_win', icon: 'BOT' },
  { key: 'skill_bot_normal_win', title: 'Beat Normal Bot', description: 'Win a round versus a Normal bot.', goal: 1, rewardChips: 104, event: 'bot_normal_round_win', icon: 'BOT' },
  { key: 'skill_ranked_round_win', title: 'Ranked Take', description: 'Win one ranked round by net chips.', goal: 1, rewardChips: 96, event: 'ranked_round_win', icon: 'RKG' },
  { key: 'skill_ranked_round_win_twice', title: 'Ranked Pressure', description: 'Win two ranked rounds by net chips.', goal: 2, rewardChips: 118, event: 'ranked_round_win', icon: 'RKG' }
];
const SKILL_CHALLENGE_DEF_MAP = new Map(SKILL_CHALLENGE_POOL.map((def) => [def.key, def]));

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

function resolveEconomyMode(rawEconomyMode, fallbackMatchMode = 'real') {
  const mode = String(rawEconomyMode || '').trim().toLowerCase();
  if (mode === 'no_delta') return 'no_delta';
  if (mode === 'standard') return 'standard';
  return String(fallbackMatchMode || '').trim().toLowerCase() === 'practice' ? 'no_delta' : 'standard';
}

function isPracticeMatch(match) {
  if (!match) return false;
  if (String(match.economyMode || '').trim().toLowerCase() === 'no_delta') return true;
  if (String(match.economyMode || '').trim().toLowerCase() === 'standard') return false;
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
  MAX_DOUBLES_PER_HAND: 3,
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
  const highRoller = String(match?.matchType || '').toUpperCase() === 'HIGH_ROLLER' || Boolean(match?.highRoller);
  if (highRoller) return { min: HIGH_ROLLER_MIN_BET, max: MAX_BET_HARD_CAP };
  const rankedFixed = Math.max(0, Math.floor(Number(match?.rankedBet) || 0));
  // Ranked keeps base bet fixed, but in-round actions (double/split pressure) must remain legal.
  if (rankedFixed > 0) return { min: rankedFixed, max: MAX_BET_HARD_CAP };
  const quickPlayBucket = normalizeQuickPlayBucket(match?.quickPlayBucket);
  if (quickPlayBucket) return { min: quickPlayBucket, max: quickPlayBucket };
  const botId = match?.playerIds?.find((id) => isBotPlayer(id));
  if (!botId) return { min: MIN_BET, max: MAX_BET_CAP };
  const difficulty = getBotDifficulty(match, botId);
  const difficultyLimits = getBetLimitsForDifficulty(difficulty);
  const liveHandPeakBet = Math.max(
    Math.floor(Number(match?.round?.baseBet) || 0),
    ...Object.values(match?.round?.players || {})
      .flatMap((playerState) => Array.isArray(playerState?.hands) ? playerState.hands : [])
      .map((hand) => Math.floor(Number(hand?.bet) || 0))
  );
  // Keep entry bet ranges by difficulty, but avoid bot stalls on legal double/split pressure flow.
  const dynamicMax = Math.max(
    Math.floor(Number(difficultyLimits.max) || 0),
    liveHandPeakBet * RULES.MAX_HANDS_PER_PLAYER
  );
  return {
    min: Math.max(1, Math.floor(Number(difficultyLimits.min) || MIN_BET)),
    max: Math.max(1, Math.min(MAX_BET_HARD_CAP, Math.floor(dynamicMax || difficultyLimits.max || MAX_BET_CAP)))
  };
}

function highRollerUnlockError() {
  return `High Roller unlocks at ${HIGH_ROLLER_UNLOCK_CHIPS.toLocaleString()} chips.`;
}

function logRankedQueueEvent(event, payload = {}) {
  if (process.env.NODE_ENV === 'test') return;
  // eslint-disable-next-line no-console
  console.log(`[ranked-queue] ${event}`, JSON.stringify(payload));
}

function logQuickPlayQueueEvent(event, payload = {}) {
  if (process.env.NODE_ENV === 'test') return;
  // eslint-disable-next-line no-console
  console.log(`[quickplay-queue] ${event}`, JSON.stringify(payload));
}

function logMatchEconomyEvent(event, payload = {}) {
  if (process.env.NODE_ENV === 'test') return;
  // eslint-disable-next-line no-console
  console.log(`[match-economy] ${event}`, JSON.stringify(payload));
}

function hasHighRollerAccess(user) {
  const chips = Math.max(0, Math.floor(Number(user?.chips) || 0));
  return chips >= HIGH_ROLLER_UNLOCK_CHIPS;
}

function isBotPlayer(playerId) {
  return typeof playerId === 'string' && playerId.startsWith('bot:');
}

function isBotMatch(match) {
  return Boolean(match?.playerIds?.some((id) => isBotPlayer(id)));
}

function isDoubleOrNothingEnabledForMatch(match) {
  if (!match) return false;
  if (isBotMatch(match)) return false;
  const matchType = String(match.matchType || '').trim().toUpperCase();
  if (matchType === 'RANKED') return false;
  return matchType === 'QUICKPLAY' || matchType === 'FRIEND_CHALLENGE';
}

function usesRoundStartStakeCommit(match) {
  return Boolean(match && isRealMatch(match) && isBotMatch(match));
}

function isRoundSettledPhase(match) {
  return Boolean(
    match &&
    (match.phase === PHASES.ROUND_RESOLVE ||
      match.phase === PHASES.REVEAL ||
      match.phase === PHASES.RESULT ||
      match.phase === PHASES.NEXT_ROUND)
  );
}

function buildParticipants(playerIds, botDifficultyById = {}) {
  return playerIds.reduce((acc, playerId) => {
    if (isBotPlayer(playerId)) {
      const difficulty = botDifficultyById[playerId] || 'normal';
      acc[playerId] = {
        id: playerId,
        username: `Bot (${difficulty})`,
        isBot: true,
        difficulty,
        level: 1,
        dynamicBadge: null,
        selectedTitle: ''
      };
      return acc;
    }

    const user = getUserById(playerId);
    const badge = dynamicBadgeForUser(playerId);
    const rankedMeta = rankedMetaForUser(user);
    acc[playerId] = {
      id: playerId,
      username: user?.username || 'Unknown',
      isBot: false,
      level: levelFromXp(user?.xp || 0),
      rankTier: rankedMeta.tierLabel,
      rankTierKey: rankedMeta.tierKey,
      rankedElo: rankedMeta.elo,
      dynamicBadge: badge,
      selectedTitle: selectedTitleLabelForUser(user)
    };
    return acc;
  }, {});
}

function secureRandomInt(minInclusive, maxExclusive) {
  const lo = Math.floor(Number(minInclusive) || 0);
  const hi = Math.floor(Number(maxExclusive) || lo);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return lo;
  try {
    return cryptoRandomInt(lo, hi);
  } catch {
    return lo + Math.floor(Math.random() * (hi - lo));
  }
}

function secureRandomFloat() {
  return secureRandomInt(0, 1_000_000_000) / 1_000_000_000;
}

function randomIntInclusive(min, max) {
  const lo = Math.max(0, Math.floor(Number(min) || 0));
  const hi = Math.max(lo, Math.floor(Number(max) || lo));
  return secureRandomInt(lo, hi + 1);
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

function parseIsoTimestampMs(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw).getTime();
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseEnvBoolean(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  if (!value) return false;
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function splitTensEventWindow() {
  if (!SPLIT_TENS_EVENT_ENABLED && !Number.isFinite(SPLIT_TENS_EVENT_STARTS_AT_MS)) return null;
  const nowMs = Date.now();
  const configuredStartMs = Number.isFinite(SPLIT_TENS_EVENT_STARTS_AT_MS)
    ? SPLIT_TENS_EVENT_STARTS_AT_MS
    : SPLIT_TENS_EVENT_FALLBACK_STARTS_AT_MS;
  const startsMs = SPLIT_TENS_EVENT_ENABLED
    ? Math.min(configuredStartMs, nowMs)
    : configuredStartMs;
  const endsMs = startsMs + SPLIT_TENS_EVENT_DURATION_MS;
  return {
    startsMs,
    endsMs,
    startsAt: new Date(startsMs).toISOString(),
    endsAt: new Date(endsMs).toISOString()
  };
}

function splitTensEventPayloadAt(nowMs = Date.now()) {
  const window = splitTensEventWindow();
  if (!window) return null;
  if (nowMs < window.startsMs || nowMs >= window.endsMs) return null;
  return {
    id: SPLIT_TENS_EVENT_ID,
    title: 'Split Tens Event',
    description: 'For the next 24 hours, splitting 10s is allowed.',
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    remainingMs: Math.max(0, window.endsMs - nowMs)
  };
}

function activeEventsAt(nowMs = Date.now()) {
  const splitTens = splitTensEventPayloadAt(nowMs);
  return splitTens ? [splitTens] : [];
}

function splitTensEventActiveAt(nowMs = Date.now()) {
  return activeEventsAt(nowMs).some((event) => event.id === SPLIT_TENS_EVENT_ID);
}

function eventsSnapshotPayload(nowMs = Date.now()) {
  return {
    serverNow: new Date(nowMs).toISOString(),
    activeEvents: activeEventsAt(nowMs)
  };
}

function isSplitTensEventActive(context = null) {
  if (context && typeof context.splitTensEventActiveOverride === 'boolean') {
    return context.splitTensEventActiveOverride;
  }
  const nowMs = Number.isFinite(Number(context?.serverNowMs)) ? Number(context.serverNowMs) : Date.now();
  return splitTensEventActiveAt(nowMs);
}

function isTenTenPair(hand) {
  return Boolean(hand?.cards?.length === 2 && hand.cards[0]?.rank === '10' && hand.cards[1]?.rank === '10');
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

function sanitizeCustomStatText(value) {
  const compact = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[<>]/g, '')
    .trim();
  return compact.slice(0, 60);
}

function sanitizeFavoriteStatKey(value) {
  const key = String(value || '').trim().toUpperCase();
  return FAVORITE_STAT_KEYS.includes(key) ? key : FAVORITE_STAT_DEFAULT;
}

function invalidateLeaderboardCache() {
  leaderboardCache = {
    at: 0,
    rows: [],
    rankByUserId: new Map()
  };
}

function leaderboardBadgeForRank(rank) {
  const numeric = Number(rank);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (numeric === 1) return DYNAMIC_BADGES.TOP_1;
  if (numeric <= 5) return DYNAMIC_BADGES.TOP_5;
  if (numeric <= 10) return DYNAMIC_BADGES.TOP_10;
  return null;
}

function normalizeRankedElo(value) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return RANKED_BASE_ELO;
  return Math.max(0, numeric);
}

function rankedTierFromElo(elo) {
  const rating = normalizeRankedElo(elo);
  return RANKED_TIERS.find((tier) => rating >= tier.min && rating <= tier.max) || RANKED_TIERS[0];
}

function rankedBetRangeForElo(elo) {
  return rankedTierFromElo(elo).bets;
}

function rankedMetaForUser(user) {
  const elo = normalizeRankedElo(user?.rankedElo);
  const tier = rankedTierFromElo(elo);
  return {
    elo,
    tierKey: tier.key,
    tierLabel: tier.label,
    bets: { ...tier.bets },
    wins: Math.max(0, Math.floor(Number(user?.rankedWins) || 0)),
    losses: Math.max(0, Math.floor(Number(user?.rankedLosses) || 0)),
    games: Math.max(0, Math.floor(Number(user?.rankedGames) || 0)),
    lossStreak: Math.max(0, Math.floor(Number(user?.rankedLossStreak) || 0)),
    peakElo: Math.max(0, Math.floor(Number(user?.peakRankedElo) || 0)),
    peakTierKey: String(user?.peakRankTier || '').trim().toUpperCase() || tier.key
  };
}

function ensureRankedState(user) {
  if (!user) return false;
  let changed = false;
  const elo = normalizeRankedElo(user.rankedElo);
  if (elo !== user.rankedElo) {
    user.rankedElo = elo;
    changed = true;
  }
  const tier = rankedTierFromElo(user.rankedElo);
  if (user.rankTier !== tier.key) {
    user.rankTier = tier.key;
    changed = true;
  }
  if (!Number.isFinite(Number(user.rankedWins))) {
    user.rankedWins = 0;
    changed = true;
  }
  if (!Number.isFinite(Number(user.rankedLosses))) {
    user.rankedLosses = 0;
    changed = true;
  }
  if (!Number.isFinite(Number(user.rankedGames))) {
    user.rankedGames = Math.max(0, Math.floor(Number(user.rankedWins) || 0) + Math.floor(Number(user.rankedLosses) || 0));
    changed = true;
  }
  if (!Number.isFinite(Number(user.rankedLossStreak))) {
    user.rankedLossStreak = 0;
    changed = true;
  }
  const peak = Math.max(user.rankedElo, Math.floor(Number(user.peakRankedElo) || 0));
  if (peak !== user.peakRankedElo) {
    user.peakRankedElo = peak;
    changed = true;
  }
  const peakTier = rankedTierFromElo(user.peakRankedElo).key;
  if (user.peakRankTier !== peakTier) {
    user.peakRankTier = peakTier;
    changed = true;
  }
  return changed;
}

function rankedOverviewForUser(user) {
  if (!user) return null;
  ensureRankedState(user);
  const meta = rankedMetaForUser(user);
  const fixedBet = Math.max(1, Math.floor(Number(meta.bets.min) || 50));
  const chips = Math.max(0, Math.floor(Number(user.chips) || 0));
  const canQueue = chips >= fixedBet;
  const reconciled = reconcileRankedSeriesForUser(user.id);
  const activeSeries = rankedSeriesSummaryForUser(reconciled.activeSeries, user.id);
  const recentSeries = (db.data.rankedSeries || [])
    .filter((series) => {
      if (!series || (series.p1 !== user.id && series.p2 !== user.id)) return false;
      const status = normalizeRankedSeriesStatus(series.status);
      return status === RANKED_SERIES_STATUS.COMPLETED || status === RANKED_SERIES_STATUS.FORFEITED;
    })
    .slice(-5)
    .reverse()
    .map((series) => rankedSeriesSummaryForUser(series, user.id))
    .filter(Boolean);
  if (reconciled.changed) {
    db.write();
  }
  if (process.env.NODE_ENV !== 'test') {
    // eslint-disable-next-line no-console
    console.log('[ranked-overview]', JSON.stringify({
      userId: user.id,
      activeSeriesId: activeSeries?.seriesId || null,
      activeSeriesStatus: activeSeries?.status || null,
      activeSeriesGameIndex: activeSeries?.nextGameIndex || null,
      endedAt: activeSeries?.endedAt || null
    }));
  }
  return {
    elo: meta.elo,
    rankTier: meta.tierLabel,
    rankTierKey: meta.tierKey,
    fixedBet,
    rankedWins: meta.wins,
    rankedLosses: meta.losses,
    rankedGames: meta.games,
    canQueue,
    disabledReason: canQueue ? '' : `Need at least ${fixedBet.toLocaleString()} chips for ${meta.tierLabel} ranked.`,
    queueStatus: rankedQueueStatus(user.id),
    activeSeries,
    recentSeries
  };
}

function xpFloorForLevel(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  const completedLevels = safeLevel - 1;
  return (completedLevels * 100) + ((completedLevels * (completedLevels - 1)) / 2) * 25;
}

function levelFromXp(xp) {
  const safeXp = Math.max(0, Math.floor(Number(xp) || 0));
  let level = 1;
  while (safeXp >= xpFloorForLevel(level + 1)) {
    level += 1;
  }
  return level;
}

function levelProgressFromXp(xp) {
  const safeXp = Math.max(0, Math.floor(Number(xp) || 0));
  const level = levelFromXp(safeXp);
  const floorXp = xpFloorForLevel(level);
  const nextFloorXp = xpFloorForLevel(level + 1);
  const span = Math.max(1, nextFloorXp - floorXp);
  return {
    xp: safeXp,
    level,
    currentLevelXp: safeXp - floorXp,
    levelSpanXp: span,
    xpToNextLevel: Math.max(0, nextFloorXp - safeXp),
    progress: Math.max(0, Math.min(1, (safeXp - floorXp) / span))
  };
}

function normalizeProfileBorderId(borderId) {
  const key = String(borderId || '').trim().toUpperCase();
  return PROFILE_BORDER_DEFS_BY_ID[key] ? key : 'NONE';
}

function profileBorderUnlockIdsForLevel(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  return PROFILE_BORDER_DEFS
    .filter((border) => safeLevel >= Math.max(1, Math.floor(Number(border.minLevelRequired) || 1)))
    .map((border) => border.id);
}

function nextProfileBorderUnlockLevel(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  const next = PROFILE_BORDER_DEFS.find((border) => Math.floor(Number(border.minLevelRequired) || 1) > safeLevel);
  return next ? Math.floor(Number(next.minLevelRequired) || 1) : null;
}

function normalizeDeckSkinId(value) {
  const key = String(value || '').trim().toUpperCase();
  return DECK_SKIN_DEFS_BY_ID[key] ? key : 'CLASSIC';
}

function deckSkinMetricValueForUser(user, metricType) {
  switch (String(metricType || '').trim()) {
    case 'rankedElo':
      return normalizeRankedElo(user?.rankedElo);
    default:
      return titleMetricValueForUser(user, metricType);
  }
}

function deckSkinUnlockConditionMet(user, unlockCondition) {
  if (!unlockCondition || typeof unlockCondition !== 'object') return false;
  const conditionType = String(unlockCondition.type || '').trim();
  if (!conditionType || conditionType === 'manual') return false;
  const threshold = Math.max(1, Math.floor(Number(unlockCondition.threshold) || 0));
  return deckSkinMetricValueForUser(user, conditionType) >= threshold;
}

function deckSkinUnlockedForUser(user, deckSkinId) {
  const normalized = normalizeDeckSkinId(deckSkinId);
  const def = DECK_SKIN_DEFS_BY_ID[normalized] || DECK_SKIN_DEFS[0];
  if (def?.unlockCondition && typeof def.unlockCondition === 'object') {
    return deckSkinUnlockConditionMet(user, def.unlockCondition);
  }
  const level = levelFromXp(user?.xp || 0);
  return level >= Math.max(1, Math.floor(Number(def?.minLevelRequired) || 1));
}

function ensureProfileBorderState(user) {
  if (!user) return false;
  let changed = false;
  const unlockedIds = profileBorderUnlockIdsForLevel(levelFromXp(user?.xp || 0));
  const normalizedSelected = normalizeProfileBorderId(user?.selectedBorderId);
  if (normalizedSelected !== user?.selectedBorderId) {
    user.selectedBorderId = normalizedSelected;
    changed = true;
  }
  if (!unlockedIds.includes(user.selectedBorderId)) {
    user.selectedBorderId = 'NONE';
    changed = true;
  }
  return changed;
}

function normalizeTitleKey(titleKey) {
  const key = String(titleKey || '').trim().toUpperCase();
  return TITLE_DEFS[key] ? key : '';
}

function titleMetricValueForUser(user, metricType) {
  const level = levelFromXp(user?.xp || 0);
  switch (String(metricType || '').trim()) {
    case 'level':
      return level;
    case 'blackjacks':
      return Math.max(0, Math.floor(Number(user?.stats?.blackjacks) || 0));
    case 'splitsAttempted':
      return Math.max(0, Math.floor(Number(user?.stats?.splitsAttempted) || 0));
    case 'doublesAttempted':
      return Math.max(0, Math.floor(Number(user?.stats?.doublesAttempted) || 0));
    case 'pushes':
      return Math.max(0, Math.floor(Number(user?.stats?.pushes) || 0));
    case 'matchesPlayed':
      return Math.max(0, Math.floor(Number(user?.stats?.matchesPlayed) || 0));
    case 'handsWon':
      return Math.max(0, Math.floor(Number(user?.stats?.handsWon) || 0));
    case 'totalChipsWon':
      return Math.max(0, Math.floor(Number(user?.stats?.totalChipsWon) || 0));
    case 'rankedWins':
      return Math.max(0, Math.floor(Number(user?.rankedWins) || 0));
    case 'pvpWins':
      return Math.max(0, Math.floor(Number(user?.pvpWins) || 0));
    case 'sixSevenDealt':
      return Math.max(0, Math.floor(Number(user?.stats?.sixSevenDealt) || 0));
    case 'dailyWinStreak':
      return Math.max(0, Math.floor(Number(user?.dailyWinStreakCount) || 0));
    case 'bestMatchWinStreak':
      return Math.max(0, Math.floor(Number(user?.bestMatchWinStreak) || 0));
    case 'highRollerMatches':
      return Math.max(0, Math.floor(Number(user?.highRollerMatchCount) || 0));
    default:
      return 0;
  }
}

function titleUnlockConditionMet(user, unlockCondition) {
  if (!unlockCondition || typeof unlockCondition !== 'object') return false;
  const conditionType = String(unlockCondition.type || '').trim();
  if (!conditionType || conditionType === 'manual') return false;
  const threshold = Math.max(1, Math.floor(Number(unlockCondition.threshold) || 0));
  return titleMetricValueForUser(user, conditionType) >= threshold;
}

function ensureTitleState(user) {
  if (!user) return false;
  let changed = false;
  if (!Array.isArray(user.unlockedTitles)) {
    user.unlockedTitles = [];
    changed = true;
  }
  const normalizedTitles = user.unlockedTitles
    .map((key) => normalizeTitleKey(key))
    .filter(Boolean);
  if (
    normalizedTitles.length !== user.unlockedTitles.length ||
    normalizedTitles.some((key, idx) => key !== user.unlockedTitles[idx])
  ) {
    user.unlockedTitles = normalizedTitles;
    changed = true;
  }
  if (typeof user.selectedTitle !== 'string') {
    user.selectedTitle = '';
    changed = true;
  }
  if (user.selectedTitle && !user.unlockedTitles.includes(user.selectedTitle)) {
    user.selectedTitle = '';
    changed = true;
  }
  return changed;
}

function recomputeTitleUnlocks(user) {
  if (!user) return false;
  let changed = ensureTitleState(user);
  let unlockedAny = false;
  for (const definition of TITLE_DEFS_LIST) {
    if (!definition || !definition.key) continue;
    if (!titleUnlockConditionMet(user, definition.unlockCondition)) continue;
    if (user.unlockedTitles.includes(definition.key)) continue;
    user.unlockedTitles.push(definition.key);
    changed = true;
    unlockedAny = true;
  }
  if (user.selectedTitle && !user.unlockedTitles.includes(user.selectedTitle)) {
    user.selectedTitle = '';
    changed = true;
  }
  if (unlockedAny || changed) invalidateLeaderboardCache();
  return changed;
}

function titleCatalogForUser(user) {
  const unlockedSet = new Set(
    (Array.isArray(user?.unlockedTitles) ? user.unlockedTitles : [])
      .map((titleKey) => normalizeTitleKey(titleKey))
      .filter(Boolean)
  );
  return TITLE_DEFS_LIST.map((definition) => {
    const unlockCondition = definition?.unlockCondition && typeof definition.unlockCondition === 'object'
      ? {
          type: String(definition.unlockCondition.type || ''),
          threshold: Number.isFinite(Number(definition.unlockCondition.threshold))
            ? Math.max(1, Math.floor(Number(definition.unlockCondition.threshold)))
            : null
        }
      : null;
    const progressValue = unlockCondition?.type && unlockCondition.type !== 'manual'
      ? titleMetricValueForUser(user, unlockCondition.type)
      : null;
    return {
      key: definition.key,
      label: definition.label,
      category: definition.category || 'skill',
      description: definition.description || '',
      requirementText: definition.requirementText || definition.description || '',
      unlockCondition,
      unlocked: unlockedSet.has(definition.key),
      progressValue: progressValue === null ? null : Math.max(0, Math.floor(Number(progressValue) || 0))
    };
  });
}

function unlockTitle(user, titleKey, { suppressInvalidate = false } = {}) {
  if (!user) return false;
  ensureTitleState(user);
  const normalized = normalizeTitleKey(titleKey);
  if (!normalized) return false;
  if (user.unlockedTitles.includes(normalized)) return false;
  user.unlockedTitles.push(normalized);
  if (!suppressInvalidate) invalidateLeaderboardCache();
  return true;
}

function leaderboardRowsSnapshot(force = false) {
  const now = Date.now();
  if (!force && leaderboardCache.rows.length > 0 && now - leaderboardCache.at < LEADERBOARD_CACHE_MS) {
    return leaderboardCache;
  }
  const rows = [...db.data.users]
    .sort((a, b) => {
      const chipDelta = (Number(b?.chips) || 0) - (Number(a?.chips) || 0);
      if (chipDelta !== 0) return chipDelta;
      return String(a?.username || '').localeCompare(String(b?.username || ''), undefined, { sensitivity: 'base' });
    })
    .map((user, idx) => {
      const rank = idx + 1;
      const levelMeta = levelProgressFromXp(user?.xp || 0);
      const ranked = rankedMetaForUser(user);
      return {
        userId: user.id,
        username: user.username,
        chips: Math.max(0, Math.floor(Number(user?.chips) || 0)),
        rank,
        level: levelMeta.level,
        xp: levelMeta.xp,
        rankTier: ranked.tierLabel,
        rankTierKey: ranked.tierKey,
        rankedElo: ranked.elo,
        selectedTitle: normalizeTitleKey(user?.selectedTitle),
        dynamicBadge: leaderboardBadgeForRank(rank)
      };
    });
  const rankByUserId = new Map(rows.map((row) => [row.userId, row.rank]));
  leaderboardCache = { at: now, rows, rankByUserId };
  return leaderboardCache;
}

function userRankFromLeaderboard(userId) {
  if (!userId) return null;
  const snapshot = leaderboardRowsSnapshot();
  return snapshot.rankByUserId.get(userId) || null;
}

function leaderboardPayload(currentUserId, limit = LEADERBOARD_DEFAULT_LIMIT, offset = 0) {
  const safeLimit = Math.max(1, Math.min(LEADERBOARD_MAX_LIMIT, Math.floor(Number(limit) || LEADERBOARD_DEFAULT_LIMIT)));
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const snapshot = leaderboardRowsSnapshot();
  const rows = snapshot.rows.slice(safeOffset, safeOffset + safeLimit).map((row) => ({
    userId: row.userId,
    username: row.username,
    chips: row.chips,
    rank: row.rank,
    level: row.level,
    rankTier: row.rankTier || rankedTierFromElo(row.rankedElo).label,
    rankTierKey: row.rankTierKey || rankedTierFromElo(row.rankedElo).key,
    rankedElo: normalizeRankedElo(row.rankedElo),
    selectedTitle: row.selectedTitle ? (TITLE_DEFS[row.selectedTitle]?.label || '') : '',
    dynamicBadge: row.dynamicBadge
  }));
  return {
    rows,
    currentUserRank: currentUserId ? snapshot.rankByUserId.get(currentUserId) || null : null,
    totalUsers: snapshot.rows.length
  };
}

function publicStatsPayloadForUser(user) {
  if (!user) return null;
  const safe = sanitizeUser(user);
  const stats = safe?.stats || {};
  return {
    userId: safe.id,
    username: safe.username,
    avatar: safe.avatar,
    chips: Math.max(0, Math.floor(Number(safe.chips) || 0)),
    level: Math.max(1, Math.floor(Number(safe.level) || 1)),
    rankTier: safe.rankTier,
    rankTierKey: safe.rankTierKey,
    rankedElo: Math.max(0, Math.floor(Number(safe.rankedElo) || 0)),
    overallWl: {
      wins: Math.max(0, Math.floor(Number(safe.pvpWins) || 0)),
      losses: Math.max(0, Math.floor(Number(safe.pvpLosses) || 0))
    },
    rankedWl: {
      wins: Math.max(0, Math.floor(Number(safe.rankedWins) || 0)),
      losses: Math.max(0, Math.floor(Number(safe.rankedLosses) || 0))
    },
    stats: {
      matchesPlayed: Math.max(0, Math.floor(Number(stats.matchesPlayed) || 0)),
      handsWon: Math.max(0, Math.floor(Number(stats.handsWon) || 0)),
      handsLost: Math.max(0, Math.floor(Number(stats.handsLost) || 0)),
      handsPushed: Math.max(0, Math.floor(Number(stats.pushes ?? stats.handsPush) || 0)),
      blackjacks: Math.max(0, Math.floor(Number(stats.blackjacks) || 0)),
      splitsWon: Math.max(0, Math.floor(Number(stats.splitHandsWon) || 0)),
      doublesAttempted: Math.max(0, Math.floor(Number(stats.doublesAttempted) || 0)),
      surrenders: Math.max(0, Math.floor(Number(stats.surrenders) || 0))
    }
  };
}

function dynamicBadgeForUser(userId) {
  const rank = userRankFromLeaderboard(userId);
  return leaderboardBadgeForRank(rank);
}

function ensureHeadToHeadState(user) {
  if (!user) return;
  if (!user.headToHead || typeof user.headToHead !== 'object' || Array.isArray(user.headToHead)) {
    user.headToHead = {};
  }
}

function recordHeadToHead(winnerId, loserId) {
  const winner = getUserById(winnerId);
  const loser = getUserById(loserId);
  if (!winner || !loser) return;
  ensureHeadToHeadState(winner);
  ensureHeadToHeadState(loser);
  const winRow = winner.headToHead[loserId] || { wins: 0, losses: 0 };
  const loseRow = loser.headToHead[winnerId] || { wins: 0, losses: 0 };
  winRow.wins = Math.max(0, Math.floor(Number(winRow.wins) || 0) + 1);
  loseRow.losses = Math.max(0, Math.floor(Number(loseRow.losses) || 0) + 1);
  winner.headToHead[loserId] = winRow;
  loser.headToHead[winnerId] = loseRow;
}

function updateDailyWinStreak(user, eventIso = nowIso()) {
  if (!user) return;
  const today = String(eventIso || nowIso()).slice(0, 10);
  const yesterday = previousUtcDayIso(eventIso || nowIso());
  const last = user.lastDailyWinDate ? String(user.lastDailyWinDate).slice(0, 10) : null;
  if (last === today) return;
  if (last === yesterday) {
    user.dailyWinStreakCount = Math.max(1, Math.floor(Number(user.dailyWinStreakCount) || 0) + 1);
  } else {
    user.dailyWinStreakCount = 1;
  }
  user.lastDailyWinDate = today;
}

function streakCountsAfterOutcome({ winStreak = 0, lossStreak = 0, outcome = 'push' } = {}) {
  const safeWin = Math.max(0, Math.floor(Number(winStreak) || 0));
  const safeLoss = Math.max(0, Math.floor(Number(lossStreak) || 0));
  const normalized = String(outcome || '').trim().toLowerCase();
  if (normalized === 'win') {
    return { winStreak: safeWin + 1, lossStreak: 0 };
  }
  if (normalized === 'loss') {
    return { winStreak: 0, lossStreak: safeLoss + 1 };
  }
  return { winStreak: safeWin, lossStreak: safeLoss };
}

function matchWinStreakAfterOutcome(currentStreak = 0, outcome = 'push') {
  const safeCurrent = Math.max(0, Math.floor(Number(currentStreak) || 0));
  const normalized = String(outcome || '').trim().toLowerCase();
  if (normalized === 'win') return safeCurrent + 1;
  if (normalized === 'loss') return 0;
  return safeCurrent;
}

function xpStreakBonusMultiplier(user) {
  const streak = Math.max(0, Math.floor(Number(user?.currentMatchWinStreak) || 0));
  if (streak >= 10) return 1.15;
  if (streak >= 6) return 1.1;
  if (streak >= 3) return 1.05;
  return 1;
}

function xpBetMultiplierFromAmount(betAmount) {
  const bet = Math.max(1, Math.floor(Number(betAmount) || 0));
  const ratio = bet / XP_BET_BASELINE;
  const scaled = 0.85 + Math.sqrt(Math.max(0, ratio));
  return Math.max(0.85, Math.min(XP_BET_MULTIPLIER_CAP, scaled));
}

function exposureBetForXp(playerRoundState, fallbackBet = BASE_BET) {
  const safeFallback = Math.max(1, Math.floor(Number(fallbackBet) || BASE_BET));
  const hands = Array.isArray(playerRoundState?.hands) ? playerRoundState.hands : [];
  if (!hands.length) return safeFallback;
  const exposure = hands.reduce((sum, hand) => sum + Math.max(0, Math.floor(Number(hand?.bet) || 0)), 0);
  return Math.max(safeFallback, exposure);
}

function levelRewardForLevel(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  if (safeLevel % 5 !== 0) return 0;
  return Math.max(0, Math.floor(200 + ((safeLevel / 5) * 150)));
}

function applyLevelRewards(user, previousLevel, newLevel) {
  if (!user) return 0;
  const prev = Math.max(1, Math.floor(Number(previousLevel) || 1));
  const next = Math.max(prev, Math.floor(Number(newLevel) || prev));
  const alreadyRewarded = Math.max(0, Math.floor(Number(user.lastLevelRewarded) || 0));
  let totalReward = 0;
  for (let level = prev + 1; level <= next; level += 1) {
    if (level % 5 !== 0) continue;
    if (level <= alreadyRewarded) continue;
    const reward = levelRewardForLevel(level);
    if (reward <= 0) continue;
    totalReward += reward;
    user.lastLevelRewarded = level;
    creditUserBankroll(user, reward);
    pushNotification(user.id, {
      type: 'level_reward',
      message: `Level reward: +${reward.toLocaleString()} chips`
    });
  }
  return totalReward;
}

function awardXp(user, amount) {
  if (!user) return 0;
  const gain = Math.max(0, Math.floor(Number(amount) || 0));
  if (gain <= 0) return Math.max(0, Math.floor(Number(user.xp) || 0));
  const beforeLevel = levelFromXp(user.xp || 0);
  user.xp = Math.max(0, Math.floor(Number(user.xp) || 0) + gain);
  const afterLevel = levelFromXp(user.xp || 0);
  if (afterLevel > beforeLevel) {
    applyLevelRewards(user, beforeLevel, afterLevel);
  }
  recomputeTitleUnlocks(user);
  ensureProfileBorderState(user);
  invalidateLeaderboardCache();
  return user.xp;
}

function selectedTitleLabelForUser(user) {
  const key = normalizeTitleKey(user?.selectedTitle);
  if (!key) return '';
  const unlocked = new Set((Array.isArray(user?.unlockedTitles) ? user.unlockedTitles : []).map((value) => normalizeTitleKey(value)).filter(Boolean));
  if (!unlocked.has(key)) return '';
  return TITLE_DEFS[key]?.label || '';
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
  const levelMeta = levelProgressFromXp(user?.xp || 0);
  const rank = userRankFromLeaderboard(user?.id);
  const dynamicBadge = dynamicBadgeForUser(user?.id);
  const rankedMeta = rankedMetaForUser(user);
  const fixedRankedBet = Math.max(1, Math.floor(Number(rankedMeta.bets.min) || 50));
  const unlockedTitles = (Array.isArray(user?.unlockedTitles) ? user.unlockedTitles : [])
    .map((titleKey) => normalizeTitleKey(titleKey))
    .filter(Boolean);
  const unlockedTitleSet = new Set(unlockedTitles);
  const selectedTitleKey = normalizeTitleKey(user?.selectedTitle);
  const selectedTitleKeySafe = unlockedTitleSet.has(selectedTitleKey) ? selectedTitleKey : '';
  const selectedTitle = selectedTitleKeySafe ? TITLE_DEFS[selectedTitleKeySafe]?.label || '' : '';
  const unlockedBorderIds = profileBorderUnlockIdsForLevel(levelMeta.level);
  const selectedBorderCandidate = normalizeProfileBorderId(user?.selectedBorderId);
  const selectedBorderId = unlockedBorderIds.includes(selectedBorderCandidate) ? selectedBorderCandidate : 'NONE';
  const selectedDeckSkinCandidate = normalizeDeckSkinId(user?.selectedDeckSkin);
  const selectedDeckSkin = deckSkinUnlockedForUser(user, selectedDeckSkinCandidate) ? selectedDeckSkinCandidate : 'CLASSIC';
  const customStatText = sanitizeCustomStatText(user?.customStatText || '');
  const favoriteStatKey = sanitizeFavoriteStatKey(user?.favoriteStatKey);
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
    betHistory: (user.betHistory || []).slice(0, 15),
    selectedBet: user.selectedBet || BASE_BET,
    hasClaimedFree100: Boolean(user.lastStreakClaimAt || user.lastFreeClaimAt),
    streakCount: streak.streakCount,
    nextStreakReward: streak.nextReward,
    xp: levelMeta.xp,
    level: levelMeta.level,
    xpToNextLevel: levelMeta.xpToNextLevel,
    levelProgress: levelMeta.progress,
    currentLevelXp: levelMeta.currentLevelXp,
    levelSpanXp: levelMeta.levelSpanXp,
    leaderboardRank: rank,
    dynamicBadge,
    rankedElo: rankedMeta.elo,
    rankTierKey: rankedMeta.tierKey,
    rankTier: rankedMeta.tierLabel,
    rankedWins: rankedMeta.wins,
    rankedLosses: rankedMeta.losses,
    rankedGames: rankedMeta.games,
    rankedBetMin: rankedMeta.bets.min,
    rankedBetMax: rankedMeta.bets.max,
    rankedFixedBet: fixedRankedBet,
    rankedCanQueue: Math.max(0, Math.floor(Number(user?.chips) || 0)) >= fixedRankedBet,
    peakRankedElo: rankedMeta.peakElo,
    peakRankTierKey: rankedMeta.peakTierKey,
    pvpWins: Math.max(0, Math.floor(Number(user?.pvpWins) || 0)),
    pvpLosses: Math.max(0, Math.floor(Number(user?.pvpLosses) || 0)),
    dailyWinStreakCount: Math.max(0, Math.floor(Number(user?.dailyWinStreakCount) || 0)),
    lastDailyWinDate: user?.lastDailyWinDate || null,
    currentMatchWinStreak: Math.max(0, Math.floor(Number(user?.currentMatchWinStreak) || 0)),
    bestMatchWinStreak: Math.max(0, Math.floor(Number(user?.bestMatchWinStreak) || 0)),
    highRollerMatchCount: Math.max(0, Math.floor(Number(user?.highRollerMatchCount) || 0)),
    unlockedTitles,
    selectedTitleKey: selectedTitleKeySafe,
    selectedTitle,
    selectedBorderId,
    selectedDeckSkin,
    customStatText,
    favoriteStatKey
  };
}

function sanitizeSelfUser(user) {
  const levelMeta = levelProgressFromXp(user?.xp || 0);
  const unlockedBorderIds = profileBorderUnlockIdsForLevel(levelMeta.level);
  const nextBorderUnlockLevel = nextProfileBorderUnlockLevel(levelMeta.level);
  const profileBorders = PROFILE_BORDER_DEFS.map((border) => ({
    id: border.id,
    name: border.name,
    minLevelRequired: Math.max(1, Math.floor(Number(border.minLevelRequired) || 1)),
    tier: border.tier,
    previewToken: border.previewToken,
    unlocked: unlockedBorderIds.includes(border.id)
  }));
  const deckSkins = DECK_SKIN_DEFS.map((skin) => ({
    id: skin.id,
    name: skin.name,
    description: String(skin.description || ''),
    minLevelRequired: Math.max(1, Math.floor(Number(skin.minLevelRequired) || 1)),
    unlockHint: String(skin.unlockHint || `Reach level ${Math.max(1, Math.floor(Number(skin.minLevelRequired) || 1))}.`),
    unlocked: deckSkinUnlockedForUser(user, skin.id)
  }));
  return {
    ...sanitizeUser(user),
    titleCatalog: titleCatalogForUser(user),
    unlockedBorderIds,
    nextBorderUnlockLevel,
    profileBorders,
    deckSkins,
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

function setPresence(userId, online) {
  if (!userId) return;
  const current = presenceByUser.get(userId) || { online: false, socketId: null, lastSeenAt: null };
  if (online) {
    presenceByUser.set(userId, {
      online: true,
      socketId: activeSessions.get(userId) || current.socketId || null,
      lastSeenAt: null
    });
    return;
  }
  presenceByUser.set(userId, {
    online: false,
    socketId: null,
    lastSeenAt: nowIso()
  });
}

function friendIdsForUser(userId) {
  const user = getUserById(userId);
  if (!user || !Array.isArray(user.friends)) return [];
  return user.friends;
}

function emitPresenceUpdateFor(userId) {
  const entry = presenceByUser.get(userId) || { online: false, lastSeenAt: nowIso() };
  const payload = {
    userId,
    online: Boolean(entry.online),
    lastSeenAt: entry.lastSeenAt || null
  };
  for (const friendId of friendIdsForUser(userId)) {
    emitToUser(friendId, 'presence:update', payload);
  }
}

function emitPresenceSnapshotToUser(userId) {
  const friendPresence = {};
  for (const friendId of friendIdsForUser(userId)) {
    const p = presenceByUser.get(friendId);
    friendPresence[friendId] = {
      online: Boolean(p?.online && activeSessions.get(friendId)),
      lastSeenAt: p?.lastSeenAt || null
    };
  }
  emitToUser(userId, 'presence:snapshot', { friends: friendPresence });
}

function emitUserUpdate(userId) {
  const user = getUserById(userId);
  if (!user) return;
  emitToUser(userId, 'user:update', { user: sanitizeSelfUser(user) });
}

function notificationExpiryIso(fromIso = nowIso()) {
  const ts = new Date(fromIso).getTime();
  const safeTs = Number.isFinite(ts) ? ts : Date.now();
  return new Date(safeTs + NOTIFICATION_SEEN_TTL_MS).toISOString();
}

function cleanupExpiredNotificationsForUser(user, { remove = true, nowTs = Date.now() } = {}) {
  if (!user || !Array.isArray(user.notifications)) return { changed: false, removedCount: 0 };
  const before = user.notifications.length;
  const filtered = user.notifications.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const expiresRaw = entry.expiresAt || entry.expires_at || null;
    if (!expiresRaw) return true;
    const expiresTs = new Date(expiresRaw).getTime();
    if (!Number.isFinite(expiresTs)) return true;
    return expiresTs > nowTs;
  });
  const changed = filtered.length !== before;
  if (changed && remove) {
    user.notifications = filtered;
  }
  return { changed, removedCount: Math.max(0, before - filtered.length) };
}

function markNotificationsSeenForUser(user, ids = null) {
  if (!user || !Array.isArray(user.notifications)) return { changed: false, markedCount: 0 };
  const idSet = Array.isArray(ids) && ids.length ? new Set(ids.map((id) => String(id))) : null;
  let changed = false;
  let markedCount = 0;
  const now = nowIso();
  user.notifications = user.notifications.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    if (idSet && !idSet.has(String(entry.id))) return entry;
    const existingSeen = entry.seenAt || entry.seen_at || null;
    if (existingSeen) {
      const existingExpires = entry.expiresAt || entry.expires_at || null;
      const resolvedExpires = existingExpires || notificationExpiryIso(existingSeen);
      if (!entry.read || !existingExpires || entry.seenAt !== existingSeen || entry.seen_at !== existingSeen) {
        changed = true;
        return {
          ...entry,
          read: true,
          seenAt: existingSeen,
          seen_at: existingSeen,
          expiresAt: resolvedExpires,
          expires_at: resolvedExpires
        };
      }
      return entry;
    }
    changed = true;
    markedCount += 1;
    const expiresAt = notificationExpiryIso(now);
    return {
      ...entry,
      read: true,
      seenAt: now,
      seen_at: now,
      expiresAt,
      expires_at: expiresAt
    };
  });
  return { changed, markedCount };
}

function notificationsForUser(user, { limit = 50, markSeen = false, ids = null } = {}) {
  if (!user) return { notifications: [], changed: false, markedCount: 0, removedCount: 0 };
  const cleaned = cleanupExpiredNotificationsForUser(user, { remove: true });
  let marked = { changed: false, markedCount: 0 };
  if (markSeen) {
    marked = markNotificationsSeenForUser(user, ids);
  }
  const removedAfterSeen = cleanupExpiredNotificationsForUser(user, { remove: true });
  const notifications = (user.notifications || []).slice(0, Math.max(1, Math.floor(Number(limit) || 50)));
  return {
    notifications,
    changed: Boolean(cleaned.changed || marked.changed || removedAfterSeen.changed),
    markedCount: marked.markedCount || 0,
    removedCount: (cleaned.removedCount || 0) + (removedAfterSeen.removedCount || 0)
  };
}

function cleanupExpiredNotificationsGlobally() {
  let changed = false;
  for (const user of db.data.users || []) {
    const result = cleanupExpiredNotificationsForUser(user, { remove: true });
    if (result.changed) changed = true;
  }
  return changed;
}

function pushNotification(userId, notification) {
  const user = getUserById(userId);
  if (!user) return;
  cleanupExpiredNotificationsForUser(user, { remove: true });
  const payload = {
    id: notification.id || nanoid(10),
    type: notification.type || 'info',
    message: notification.message || '',
    createdAt: notification.createdAt || nowIso(),
    action: notification.action || null,
    requestId: typeof notification.requestId === 'string' ? notification.requestId : null,
    fromUserId: typeof notification.fromUserId === 'string' ? notification.fromUserId : null,
    read: false,
    seenAt: null,
    seen_at: null,
    expiresAt: null,
    expires_at: null
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

function activeMatchForUser(userId) {
  for (const match of matches.values()) {
    if (match.playerIds.includes(userId)) return match;
  }
  return null;
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
      logQuickPlayQueueEvent('QUEUE_REJECTED', {
        userId: userA.id,
        reason: 'insufficient_chips',
        bucket: normalizedBucket
      });
      emitToUser(userA.id, 'matchmaking:error', { error: `Need at least ${normalizedBucket} chips for this Quick Play bucket` });
      if (!quickPlayBucketByUser.has(userB.id) && !isUserInActiveMatch(userB.id)) {
        queue.unshift(second);
        quickPlayBucketByUser.set(userB.id, normalizedBucket);
      }
      continue;
    }
    if (!canJoinQuickPlayBucket(userB, normalizedBucket)) {
      logQuickPlayQueueEvent('QUEUE_REJECTED', {
        userId: userB.id,
        reason: 'insufficient_chips',
        bucket: normalizedBucket
      });
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
    logQuickPlayQueueEvent('MATCH_FOUND', {
      matchId: match.id,
      bucket: normalizedBucket,
      userA: userA.id,
      userB: userB.id
    });

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

function rankedQueueStatus(userId) {
  const entry = rankedQueueByUser.get(userId);
  if (!entry) return { status: 'idle' };
  return {
    status: 'searching',
    queuedAt: entry.queuedAt,
    requestedBet: entry.fixedBet,
    fixedBet: entry.fixedBet,
    rankTier: entry.rankTier,
    elo: entry.elo
  };
}

function rankedQueueRangeForUser(user) {
  const meta = rankedMetaForUser(user);
  return {
    min: meta.bets.min,
    max: meta.bets.max,
    fixed: meta.bets.min
  };
}

function removeFromRankedQueue(userId) {
  const existing = rankedQueueByUser.get(userId);
  rankedQueueByUser.delete(userId);
  if (!existing) return false;
  const idx = rankedQueue.findIndex((entry) => entry.userId === userId);
  if (idx !== -1) rankedQueue.splice(idx, 1);
  logRankedQueueEvent('QUEUE_CANCELLED', {
    userId,
    queuedAt: existing.queuedAt || null,
    rankTier: existing.rankTier || null,
    reason: 'explicit_cancel_or_cleanup'
  });
  return true;
}

function enqueueRankedUser(user, requestedBet) {
  if (!user) return { error: 'User not found' };
  logRankedQueueEvent('QUEUE_REQUEST', {
    userId: user.id,
    requestedBet: Number.isFinite(Number(requestedBet)) ? Math.floor(Number(requestedBet)) : null
  });
  if (isUserInActiveMatch(user.id)) {
    logRankedQueueEvent('QUEUE_REJECTED', { userId: user.id, reason: 'already_in_active_match' });
    return { error: 'Already in an active match' };
  }
  removeFromQuickPlayQueue(user.id);
  const meta = rankedMetaForUser(user);
  const reconciled = reconcileRankedSeriesForUser(user.id);
  if (reconciled.changed) db.write();
  const fixedBet = Math.max(1, Math.floor(Number(meta.bets.min) || 50));
  if (Number.isFinite(Number(requestedBet)) && Math.floor(Number(requestedBet)) !== fixedBet) {
    logRankedQueueEvent('QUEUE_REJECTED', { userId: user.id, reason: 'ranked_bet_mismatch', fixedBet, requestedBet: Math.floor(Number(requestedBet)) });
    return { error: `Ranked bet is fixed at ${fixedBet} for ${meta.tierLabel}` };
  }
  if (Math.max(0, Math.floor(Number(user?.chips) || 0)) < fixedBet) {
    logRankedQueueEvent('QUEUE_REJECTED', { userId: user.id, reason: 'insufficient_chips', fixedBet, chips: Math.floor(Number(user?.chips) || 0) });
    return { error: `Need at least ${fixedBet} chips to queue ranked as ${meta.tierLabel}` };
  }
  const existing = rankedQueueByUser.get(user.id);
  if (existing) {
    existing.fixedBet = fixedBet;
    existing.elo = meta.elo;
    existing.rankTier = meta.tierKey;
    existing.queuedAt = existing.queuedAt || nowIso();
    logRankedQueueEvent('QUEUE_ACCEPTED', {
      userId: user.id,
      fixedBet,
      rankTier: meta.tierKey,
      queuedAt: existing.queuedAt,
      deduped: true
    });
    return { ok: true, entry: existing };
  }
  const entry = {
    userId: user.id,
    fixedBet,
    elo: meta.elo,
    rankTier: meta.tierKey,
    queuedAt: nowIso()
  };
  rankedQueue.push(entry);
  rankedQueueByUser.set(user.id, entry);
  logRankedQueueEvent('QUEUE_ACCEPTED', {
    userId: user.id,
    fixedBet,
    rankTier: meta.tierKey,
    queuedAt: entry.queuedAt,
    deduped: false
  });
  return { ok: true, entry };
}

function compactRankedQueue() {
  const nowTs = Date.now();
  for (let i = rankedQueue.length - 1; i >= 0; i -= 1) {
    const entry = rankedQueue[i];
    if (!entry) {
      rankedQueue.splice(i, 1);
      continue;
    }
    const queuedAtTs = entry.queuedAt ? new Date(entry.queuedAt).getTime() : nowTs;
    if (nowTs - queuedAtTs > RANKED_QUEUE_TIMEOUT_MS) {
      rankedQueue.splice(i, 1);
      rankedQueueByUser.delete(entry.userId);
      logRankedQueueEvent('QUEUE_CANCELLED', {
        userId: entry.userId,
        rankTier: entry.rankTier || null,
        queuedAt: entry.queuedAt || null,
        reason: 'queue_timeout'
      });
      emitToUser(entry.userId, 'ranked:cancelled', { reason: 'queue_timeout' });
      continue;
    }
    const user = getUserById(entry.userId);
    if (!user || isUserInActiveMatch(entry.userId)) {
      rankedQueue.splice(i, 1);
      rankedQueueByUser.delete(entry.userId);
      logRankedQueueEvent('QUEUE_CANCELLED', {
        userId: entry.userId,
        rankTier: entry.rankTier || null,
        queuedAt: entry.queuedAt || null,
        reason: !user ? 'user_missing' : 'entered_match'
      });
    }
  }
}

function buildRankedFoundPayload(match, userId, fixedBet) {
  const opponentId = match.playerIds.find((id) => id !== userId);
  const opponent = getUserById(opponentId);
  return {
    status: 'found',
    matchId: match.id,
    fixedBet,
    opponentId,
    opponentName: opponent?.username || 'Opponent',
    connectedAt: nowIso(),
    match: serializeMatchFor(match, userId)
  };
}

async function processRankedQueue() {
  compactRankedQueue();
  let touched = false;
  const matchedEntries = [];
  for (let i = 0; i < rankedQueue.length; i += 1) {
    const a = rankedQueue[i];
    if (!a) continue;
    const userA = getUserById(a.userId);
    if (!userA) continue;
    let foundIndex = -1;
    for (let j = i + 1; j < rankedQueue.length; j += 1) {
      const b = rankedQueue[j];
      if (!b) continue;
      const userB = getUserById(b.userId);
      if (!userB || userA.id === userB.id) continue;
      if (Math.abs((a.elo || RANKED_BASE_ELO) - (b.elo || RANKED_BASE_ELO)) > RANKED_MATCH_MAX_ELO_GAP) continue;
      if (a.rankTier !== b.rankTier) continue;
      if (Math.floor(Number(a.fixedBet) || 0) !== Math.floor(Number(b.fixedBet) || 0)) continue;
      if (Math.floor(Number(userA.chips) || 0) < Math.floor(Number(a.fixedBet) || 0)) continue;
      if (Math.floor(Number(userB.chips) || 0) < Math.floor(Number(b.fixedBet) || 0)) continue;
      foundIndex = j;
      break;
    }
    if (foundIndex === -1) continue;
    const b = rankedQueue[foundIndex];
    const userB = getUserById(b.userId);
    const fixedBet = Math.max(1, Math.floor(Number(a.fixedBet || b.fixedBet) || 0));
    rankedQueue.splice(foundIndex, 1);
    rankedQueue.splice(i, 1);
    rankedQueueByUser.delete(a.userId);
    rankedQueueByUser.delete(b.userId);
    i -= 1;

    const lobby = {
      id: normalizeLobbyCode(nanoid(8)),
      ownerId: userA.id,
      opponentId: userB.id,
      status: 'full',
      type: 'ranked',
      stakeType: 'REAL',
      matchType: 'RANKED',
      rankedBet: fixedBet,
      createdAt: nowIso()
    };
    db.data.lobbies.push(lobby);
    const match = createMatch(lobby, { matchType: 'RANKED', rankedBet: fixedBet });
    ensureRankedSeriesForMatch(match);
    if (match.round?.betConfirmedByPlayer) {
      for (const pid of match.playerIds) {
        match.round.betConfirmedByPlayer[pid] = true;
      }
      maybeBeginRoundAfterBetConfirm(match);
    }
    pushMatchState(match);
    touched = true;
    logRankedQueueEvent('MATCH_FOUND', {
      seriesId: match.rankedSeriesId || null,
      matchId: match.id,
      userA: userA.id,
      userB: userB.id,
      rankTier: a.rankTier,
      fixedBet
    });
    matchedEntries.push({ userId: userA.id, payload: buildRankedFoundPayload(match, userA.id, fixedBet) });
    matchedEntries.push({ userId: userB.id, payload: buildRankedFoundPayload(match, userB.id, fixedBet) });
  }
  if (touched) await db.write();
  for (const entry of matchedEntries) {
    emitToUser(entry.userId, 'ranked:found', entry.payload);
  }
  return matchedEntries;
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
    .map((friend) => {
      const presence = presenceByUser.get(friend.id);
      const online = Boolean(presence?.online && activeSessions.get(friend.id));
      return {
        ...sanitizeUser(friend),
        headToHead: {
          wins: Math.max(0, Math.floor(Number(user?.headToHead?.[friend.id]?.wins) || 0)),
          losses: Math.max(0, Math.floor(Number(user?.headToHead?.[friend.id]?.losses) || 0))
        },
        online,
        lastSeenAt: online ? null : presence?.lastSeenAt || null,
        presence: isUserInActiveMatch(friend.id) ? 'in_match' : online ? 'online' : 'offline'
      };
    });
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
  if (user) {
    user.chips = safe;
    invalidateLeaderboardCache();
  }
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
  user.betHistory = user.betHistory.slice(0, 15);
}

function matchHistoryModeLabel(match) {
  if (!match) return 'Challenge PvP';
  if (String(match.matchType || '').toUpperCase() === 'RANKED') return 'Ranked PvP';
  if (String(match.matchType || '').toUpperCase() === 'HIGH_ROLLER') {
    return isBotMatch(match) ? 'Bot High Roller' : 'High Roller PvP';
  }
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

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function lerp(start, end, t) {
  return start + ((end - start) * clamp01(t));
}

function rankedVarianceScore(outcomes = [], handStatesByPlayer = {}, p1Id, p2Id) {
  if (!Array.isArray(outcomes) || outcomes.length === 0 || !p1Id || !p2Id) {
    return {
      score: 0,
      naturals: 0,
      bustEvents: 0,
      pushCount: 0,
      closeMargins: 0,
      splitOutcomes: 0,
      handCount: 0
    };
  }
  let naturals = 0;
  let bustEvents = 0;
  let pushCount = 0;
  let closeMargins = 0;
  let splitOutcomes = 0;
  let handCount = 0;

  for (const out of outcomes) {
    if (!out || typeof out !== 'object') continue;
    const handIndex = Math.max(0, Math.floor(Number(out.handIndex) || 0));
    const p1Hand = handStatesByPlayer[p1Id]?.[handIndex] || handStatesByPlayer[p1Id]?.[0] || null;
    const p2Hand = handStatesByPlayer[p2Id]?.[handIndex] || handStatesByPlayer[p2Id]?.[0] || null;
    const p1Meta = handMeta(p1Hand?.cards || []);
    const p2Meta = handMeta(p2Hand?.cards || []);

    if (p1Hand?.naturalBlackjack) naturals += 1;
    if (p2Hand?.naturalBlackjack) naturals += 1;
    if (p1Hand?.bust || p1Meta.isBust) bustEvents += 1;
    if (p2Hand?.bust || p2Meta.isBust) bustEvents += 1;
    if (!out.winner && !out.loser) pushCount += 1;
    if (p1Hand?.wasSplitHand || p2Hand?.wasSplitHand || out.winnerHandWasSplit) splitOutcomes += 1;
    if (!p1Meta.isBust && !p2Meta.isBust) {
      const margin = Math.abs((p1Meta.total || 0) - (p2Meta.total || 0));
      if (margin <= 1) closeMargins += 1;
      else if (margin === 2) closeMargins += 0.75;
      else if (margin <= 4) closeMargins += 0.35;
    }
    handCount += 1;
  }

  const safeHands = Math.max(1, handCount);
  const naturalRate = naturals / (safeHands * 2);
  const bustRate = bustEvents / (safeHands * 2);
  const pushRate = pushCount / safeHands;
  const closeRate = closeMargins / safeHands;
  const splitRate = splitOutcomes / safeHands;
  const score = clamp01(
    (naturalRate * 0.24) +
    (bustRate * 0.18) +
    (pushRate * 0.2) +
    (closeRate * 0.24) +
    (splitRate * 0.14)
  );

  return {
    score,
    naturals,
    bustEvents,
    pushCount,
    closeMargins,
    splitOutcomes,
    handCount: safeHands
  };
}

function rankedExpectedScore(eloA, eloB) {
  const diff = normalizeRankedElo(eloB) - normalizeRankedElo(eloA);
  return 1 / (1 + (10 ** (diff / 400)));
}

function rankedKFactorForElo(elo) {
  const rating = normalizeRankedElo(elo);
  if (rating < 1200) return 32;
  if (rating < 1600) return 24;
  if (rating < 1850) return 16;
  return 12;
}

function rankedClampDelta(delta, clampLimit = RANKED_ELO_DELTA_CLAMP) {
  const safeLimit = Math.max(1, Math.floor(Number(clampLimit) || RANKED_ELO_DELTA_CLAMP));
  const numeric = Math.round(Number(delta) || 0);
  return Math.max(-safeLimit, Math.min(safeLimit, numeric));
}

function rankedMarginMultiplierForGame(match, winnerId, loserId, netByPlayer = {}) {
  if (!winnerId || !loserId) return 1;
  const winnerNet = Math.abs(Math.floor(Number(netByPlayer?.[winnerId]) || 0));
  const baseBet = Math.max(1, Math.floor(Number(match?.round?.baseBet) || 1));
  const t = clamp01((winnerNet / baseBet) / 4);
  return lerp(0.9, 1.1, t);
}

function rankedEloDeltaForGame({
  playerElo,
  opponentElo,
  actualScore,
  varianceMultiplier = 1,
  marginMultiplier = 1
} = {}) {
  const safePlayerElo = normalizeRankedElo(playerElo);
  const safeOpponentElo = normalizeRankedElo(opponentElo);
  const expectedScore = rankedExpectedScore(safePlayerElo, safeOpponentElo);
  const safeActualScore = clamp01(actualScore);
  const isPush = Math.abs(safeActualScore - 0.5) < 1e-9;
  const safeVariance = clamp01(varianceMultiplier);
  const safeMargin = Math.max(0.9, Math.min(1.1, Number(marginMultiplier) || 1));
  const baseK = rankedKFactorForElo(safePlayerElo);
  const effectiveK = Math.max(4, baseK * safeVariance * safeMargin);
  const unclampedRaw = effectiveK * (safeActualScore - expectedScore);
  const scaledRaw = isPush ? (unclampedRaw * RANKED_PUSH_DELTA_SCALE) : unclampedRaw;
  const clampLimit = isPush ? RANKED_PUSH_DELTA_CAP : RANKED_ELO_DELTA_CLAMP;
  let finalDelta = rankedClampDelta(scaledRaw, clampLimit);
  if (!isPush && finalDelta === 0) {
    finalDelta = safeActualScore > expectedScore ? 1 : -1;
  }
  return {
    expectedScore,
    actualScore: safeActualScore,
    baseK,
    effectiveK,
    rawDelta: scaledRaw,
    finalDelta,
    clamped: finalDelta !== Math.round(scaledRaw),
    clampLimit,
    varianceMultiplier: safeVariance,
    marginMultiplier: safeMargin
  };
}

function rankedSeriesKFactorForElo(elo) {
  const rating = normalizeRankedElo(elo);
  if (rating < 1200) return 58;
  if (rating < 1600) return 56;
  if (rating < 1850) return 52;
  return 48;
}

function rankedLossSoftenerForTier(rankTierKey) {
  const tierKey = String(rankTierKey || '').trim().toUpperCase();
  if (tierKey === 'BRONZE') return 0.75;
  if (tierKey === 'SILVER') return 0.85;
  return 1;
}

function rankedClampSeriesDelta(rawDelta) {
  const raw = Number(rawDelta) || 0;
  if (raw >= 0) return Math.max(RANKED_SERIES_WIN_DELTA_MIN, Math.min(RANKED_SERIES_WIN_DELTA_MAX, raw));
  return Math.max(RANKED_SERIES_LOSS_DELTA_MIN, Math.min(RANKED_SERIES_LOSS_DELTA_MAX, raw));
}

function rankedSeriesDeltaForOutcome({
  playerElo,
  opponentElo,
  won = false,
  rankTierKey = ''
} = {}) {
  const startElo = normalizeRankedElo(playerElo);
  const oppElo = normalizeRankedElo(opponentElo);
  const expected = rankedExpectedScore(startElo, oppElo);
  const actual = won ? 1 : 0;
  const k = rankedSeriesKFactorForElo(startElo);
  const rawDelta = k * (actual - expected);
  const clampedDelta = rankedClampSeriesDelta(rawDelta);
  const lossSoftener = clampedDelta < 0 ? rankedLossSoftenerForTier(rankTierKey || rankedTierFromElo(startElo).key) : 1;
  let finalDelta = Math.round(clampedDelta * lossSoftener);
  if (won && finalDelta <= 0) finalDelta = 1;
  if (!won && finalDelta >= 0) finalDelta = -1;
  return {
    startElo,
    oppElo,
    expected,
    actual,
    k,
    rawDelta,
    clampedDelta,
    lossSoftener,
    finalDelta
  };
}

function rankedSeriesResultForUser(series, userId) {
  if (!series || !userId) return null;
  const status = normalizeRankedSeriesStatus(series.status);
  const isP1 = series.p1 === userId;
  if (!isP1 && series.p2 !== userId) return null;
  const seriesElo = series.seriesElo && typeof series.seriesElo === 'object' ? series.seriesElo : null;
  if (!seriesElo) return null;
  const playerStats = isP1 ? seriesElo.p1 : seriesElo.p2;
  if (!playerStats) return null;
  const winnerId = series.winnerId || seriesElo.winnerId || null;
  const loserId = series.loserId || seriesElo.loserId || null;
  const won = winnerId === userId;
  const lost = loserId === userId;
  const outcome = status === RANKED_SERIES_STATUS.FORFEITED && lost
    ? 'forfeit'
    : won
      ? 'win'
      : 'loss';
  const eloBefore = normalizeRankedElo(playerStats.startElo);
  const eloAfter = normalizeRankedElo(playerStats.endElo);
  const rankBeforeMeta = rankedTierFromElo(eloBefore);
  const rankAfterMeta = rankedTierFromElo(eloAfter);
  return {
    seriesId: series.id,
    status,
    outcome,
    eloDelta: Math.floor(Number(playerStats.finalDelta) || 0),
    eloBefore,
    eloAfter,
    rankBefore: rankBeforeMeta.label,
    rankBeforeKey: rankBeforeMeta.key,
    rankAfter: rankAfterMeta.label,
    rankAfterKey: rankAfterMeta.key,
    finalizedAt: seriesElo.finalizedAt || series.eloFinalizedAt || null
  };
}

function rankedTierByKey(rankKey) {
  const safe = String(rankKey || '').trim().toUpperCase();
  return RANKED_TIERS.find((tier) => tier.key === safe) || null;
}

function normalizeRankedSeriesStatus(status) {
  const safe = String(status || '').trim().toUpperCase();
  if (safe === 'ACTIVE' || safe === 'IN_PROGRESS') return RANKED_SERIES_STATUS.IN_PROGRESS;
  if (safe === 'COMPLETE' || safe === 'COMPLETED') return RANKED_SERIES_STATUS.COMPLETED;
  if (safe === 'FORFEIT' || safe === 'FORFEITED') return RANKED_SERIES_STATUS.FORFEITED;
  return RANKED_SERIES_STATUS.IN_PROGRESS;
}

function isRankedSeriesInProgress(series) {
  return normalizeRankedSeriesStatus(series?.status) === RANKED_SERIES_STATUS.IN_PROGRESS;
}

function hasLiveRankedMatchForSeries(seriesId) {
  if (!seriesId) return false;
  for (const match of matches.values()) {
    if (!match) continue;
    if (String(match.matchType || '').toUpperCase() !== 'RANKED') continue;
    if (!matches.has(match.id)) continue;
    if (String(match.rankedSeriesId || '') === String(seriesId)) return true;
  }
  return false;
}

function clearUserActiveRankedSeriesPointer(userId, seriesId = null) {
  const user = getUserById(userId);
  if (!user) return false;
  if (typeof user.activeRankedSeriesId !== 'string') user.activeRankedSeriesId = user.activeRankedSeriesId ? String(user.activeRankedSeriesId) : null;
  if (!user.activeRankedSeriesId) return false;
  if (seriesId && String(user.activeRankedSeriesId) !== String(seriesId)) return false;
  user.activeRankedSeriesId = null;
  return true;
}

function markRankedSeriesFinalized(series, status, {
  winnerId = null,
  loserId = null,
  endedAt = nowIso(),
  reason = ''
} = {}) {
  if (!series) return false;
  const nextStatus = normalizeRankedSeriesStatus(status);
  series.status = nextStatus;
  series.endedAt = endedAt;
  series.completedAt = endedAt;
  if (winnerId) series.winnerId = winnerId;
  if (loserId) series.loserId = loserId;
  const clearedP1 = clearUserActiveRankedSeriesPointer(series.p1, series.id);
  const clearedP2 = clearUserActiveRankedSeriesPointer(series.p2, series.id);
  if (process.env.NODE_ENV !== 'test') {
    // eslint-disable-next-line no-console
    console.log('[ranked-series-finalize]', JSON.stringify({
      seriesId: series.id,
      status: nextStatus,
      winnerId: series.winnerId || null,
      loserId: series.loserId || null,
      endedAt,
      reason,
      clearedPointers: { [series.p1]: clearedP1, [series.p2]: clearedP2 }
    }));
  }
  return true;
}

function reconcileRankedSeriesForUser(userId) {
  if (!userId || !Array.isArray(db.data.rankedSeries)) return { changed: false, activeSeries: null };
  const user = getUserById(userId);
  if (!user) return { changed: false, activeSeries: null };
  let changed = false;
  let activeSeries = null;
  const pointerId = user.activeRankedSeriesId ? String(user.activeRankedSeriesId) : null;
  const candidateSeries = db.data.rankedSeries
    .filter((series) => series && (series.p1 === userId || series.p2 === userId))
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  for (const series of candidateSeries) {
    const normalizedStatus = normalizeRankedSeriesStatus(series.status);
    if (series.status !== normalizedStatus) {
      series.status = normalizedStatus;
      changed = true;
    }
    if (!series.endedAt && (normalizedStatus === RANKED_SERIES_STATUS.COMPLETED || normalizedStatus === RANKED_SERIES_STATUS.FORFEITED)) {
      series.endedAt = series.completedAt || nowIso();
      if (!series.completedAt) series.completedAt = series.endedAt;
      changed = true;
    }
    if (!isRankedSeriesInProgress(series)) continue;
    const liveMatch = hasLiveRankedMatchForSeries(series.id);
    if (!liveMatch) {
      markRankedSeriesFinalized(series, RANKED_SERIES_STATUS.FORFEITED, {
        winnerId: series.winnerId || null,
        loserId: series.loserId || null,
        reason: 'stale_active_series_cleanup'
      });
      changed = true;
      continue;
    }
    if (!activeSeries) activeSeries = series;
  }

  if (activeSeries) {
    if (pointerId !== String(activeSeries.id)) {
      user.activeRankedSeriesId = activeSeries.id;
      changed = true;
    }
  } else if (user.activeRankedSeriesId) {
    user.activeRankedSeriesId = null;
    changed = true;
  }

  return { changed, activeSeries };
}

function createRankedSeries(match) {
  if (!match || !Array.isArray(match.playerIds) || match.playerIds.length !== 2) return null;
  if (!Array.isArray(db.data.rankedSeries)) db.data.rankedSeries = [];
  const [p1, p2] = match.playerIds;
  const p1Meta = rankedMetaForUser(getUserById(p1));
  const p2Meta = rankedMetaForUser(getUserById(p2));
  const seriesId = nanoid(12);
  const betAmount = Math.max(1, Math.floor(Number(match.rankedBet || p1Meta?.bets?.min) || 50));
  const rankAtStart = p1Meta?.tierKey || rankedTierFromElo(RANKED_BASE_ELO).key;
  const series = {
    id: seriesId,
    seriesId,
    series_id: seriesId,
    matchId: match.id,
    p1,
    p2,
    rankAtStart,
    rank_at_start: rankAtStart,
    p1RankAtStart: p1Meta?.tierKey || rankedTierFromElo(RANKED_BASE_ELO).key,
    p2RankAtStart: p2Meta?.tierKey || rankedTierFromElo(RANKED_BASE_ELO).key,
    p1EloStart: normalizeRankedElo(p1Meta?.elo),
    p2EloStart: normalizeRankedElo(p2Meta?.elo),
    betAmount,
    bet_amount: betAmount,
    gameIndex: 1,
    game_index: 1,
    tiebreakerCount: 0,
    p1ChipDelta: 0,
    p2ChipDelta: 0,
    games: [],
    status: RANKED_SERIES_STATUS.IN_PROGRESS,
    winnerId: null,
    loserId: null,
    eloFinalizedAt: null,
    eloFinalizedBy: null,
    seriesElo: null,
    createdAt: nowIso(),
    endedAt: null,
    completedAt: null
  };
  db.data.rankedSeries.push(series);
  db.data.rankedSeries = db.data.rankedSeries.slice(-1500);
  match.rankedSeriesId = seriesId;
  const p1User = getUserById(p1);
  const p2User = getUserById(p2);
  if (p1User) p1User.activeRankedSeriesId = seriesId;
  if (p2User) p2User.activeRankedSeriesId = seriesId;
  return series;
}

function getRankedSeriesById(seriesId) {
  if (!seriesId || !Array.isArray(db.data.rankedSeries)) return null;
  return db.data.rankedSeries.find((series) => series.id === seriesId || series.seriesId === seriesId || series.series_id === seriesId) || null;
}

function activeRankedSeriesForUser(userId) {
  const reconciled = reconcileRankedSeriesForUser(userId);
  return reconciled.activeSeries || null;
}

function ensureRankedSeriesForMatch(match, { createIfMissing = true } = {}) {
  if (!match || String(match.matchType || '').toUpperCase() !== 'RANKED') return null;
  let series = match.rankedSeriesId ? getRankedSeriesById(match.rankedSeriesId) : null;
  if (series && !match.rankedSeriesId) {
    match.rankedSeriesId = series.id;
  }
  if (series && isRankedSeriesInProgress(series)) return series;
  if (series && !createIfMissing) return series;
  if (!createIfMissing) return null;
  series = createRankedSeries(match);
  return series;
}

function rankedSeriesSummaryForUser(series, userId) {
  if (!series || !userId) return null;
  const userIsP1 = series.p1 === userId;
  if (!userIsP1 && series.p2 !== userId) return null;
  const status = normalizeRankedSeriesStatus(series.status);
  const targetGames = RANKED_SERIES_TARGET_GAMES;
  const games = Array.isArray(series.games) ? series.games : [];
  const completedMainGames = Math.min(targetGames, games.length);
  const tiebreakerRoundsPlayed = Math.max(0, games.length - targetGames);
  const inProgress = status === RANKED_SERIES_STATUS.IN_PROGRESS;
  const inTiebreaker = inProgress && completedMainGames >= targetGames && (Number(series.p1ChipDelta) === Number(series.p2ChipDelta));
  const canContinue = inProgress && (completedMainGames < targetGames || inTiebreaker);
  const nextGameIndex = Math.max(1, games.length + 1);
  const yourChipDelta = userIsP1 ? Number(series.p1ChipDelta || 0) : Number(series.p2ChipDelta || 0);
  const oppChipDelta = userIsP1 ? Number(series.p2ChipDelta || 0) : Number(series.p1ChipDelta || 0);
  const markers = games.map((game) => ({
    gameIndex: Math.max(1, Math.floor(Number(game.gameIndex) || 1)),
    result: userIsP1 ? game.resultP1 : game.resultP2,
    tiebreakerRound: Math.max(0, Math.floor(Number(game.tiebreakerRound) || 0)),
    runningChipDelta: userIsP1 ? Number(game.runningP1ChipDelta || 0) : Number(game.runningP2ChipDelta || 0),
    eloDelta: userIsP1
      ? (Number.isFinite(Number(game.eloDeltaP1)) ? Number(game.eloDeltaP1) : null)
      : (Number.isFinite(Number(game.eloDeltaP2)) ? Number(game.eloDeltaP2) : null)
  }));
  const seriesElo = series.seriesElo && typeof series.seriesElo === 'object' ? series.seriesElo : null;
  const eloDelta = seriesElo
    ? (userIsP1 ? Number(seriesElo.deltaP1 || 0) : Number(seriesElo.deltaP2 || 0))
    : null;
  return {
    seriesId: series.id,
    status,
    inProgress,
    canContinue,
    rankTierKey: String(series.rankAtStart || series.rank_at_start || '').toUpperCase(),
    rankTier: rankedTierByKey(series.rankAtStart || series.rank_at_start)?.label || 'Bronze',
    fixedBet: Math.max(1, Math.floor(Number(series.betAmount || series.bet_amount) || 50)),
    targetGames,
    completedMainGames,
    tiebreakerRoundsPlayed,
    inTiebreaker,
    nextTiebreakerRound: inTiebreaker ? (tiebreakerRoundsPlayed + 1) : 0,
    nextGameIndex,
    yourChipDelta,
    opponentChipDelta: oppChipDelta,
    markers,
    winnerId: series.winnerId || null,
    loserId: series.loserId || null,
    complete: status !== RANKED_SERIES_STATUS.IN_PROGRESS,
    eloDelta: Number.isFinite(Number(eloDelta)) ? Math.floor(Number(eloDelta)) : null,
    eloFinalizedAt: series.eloFinalizedAt || null,
    createdAt: series.createdAt,
    endedAt: series.endedAt || series.completedAt || null,
    completedAt: series.completedAt || series.endedAt || null
  };
}

function recordRankedSeriesGame(match, {
  winnerId = null,
  loserId = null,
  netByPlayer = {},
  eloResult = null,
  forfeit = false
} = {}) {
  const series = ensureRankedSeriesForMatch(match);
  if (!series) return null;
  if (!isRankedSeriesInProgress(series)) {
    return {
      series,
      gameEntry: null,
      complete: true,
      winnerId: series.winnerId || null,
      tiebreakerRound: Math.max(0, Math.floor(Number(series.tiebreakerCount) || 0)),
      inTiebreaker: false
    };
  }
  const [p1, p2] = [series.p1, series.p2];
  const deltaP1 = Math.floor(Number(netByPlayer?.[p1]) || 0);
  const deltaP2 = Math.floor(Number(netByPlayer?.[p2]) || 0);
  const gameIndex = (Array.isArray(series.games) ? series.games.length : 0) + 1;
  const tiebreakerRound = gameIndex > RANKED_SERIES_TARGET_GAMES ? (gameIndex - RANKED_SERIES_TARGET_GAMES) : 0;
  if (!Array.isArray(series.games)) series.games = [];
  series.p1ChipDelta = Math.floor(Number(series.p1ChipDelta) || 0) + deltaP1;
  series.p2ChipDelta = Math.floor(Number(series.p2ChipDelta) || 0) + deltaP2;
  series.gameIndex = gameIndex + 1;
  series.game_index = series.gameIndex;
  if (tiebreakerRound > 0) {
    series.tiebreakerCount = Math.max(Math.floor(Number(series.tiebreakerCount) || 0), tiebreakerRound);
  }
  const resultP1 = winnerId === p1 ? 'W' : loserId === p1 ? 'L' : 'P';
  const resultP2 = winnerId === p2 ? 'W' : loserId === p2 ? 'L' : 'P';
  const gameEntry = {
    gameIndex,
    roundNumber: Math.max(1, Math.floor(Number(match.roundNumber) || gameIndex)),
    timestamp: nowIso(),
    tiebreakerRound,
    winnerId,
    loserId,
    resultP1,
    resultP2,
    chipDeltaP1: deltaP1,
    chipDeltaP2: deltaP2,
    runningP1ChipDelta: series.p1ChipDelta,
    runningP2ChipDelta: series.p2ChipDelta,
    eloDeltaP1: Math.floor(Number(eloResult?.deltaByPlayer?.[p1]) || 0),
    eloDeltaP2: Math.floor(Number(eloResult?.deltaByPlayer?.[p2]) || 0),
    varianceScore: Number(Number(eloResult?.varianceScore || 0).toFixed(4)),
    varianceMultiplier: Number(Number(eloResult?.varianceMultiplier || 1).toFixed(4)),
    forfeit: Boolean(forfeit)
  };
  series.games.push(gameEntry);

  let seriesWinner = null;
  if (gameIndex >= RANKED_SERIES_TARGET_GAMES) {
    if (tiebreakerRound > 0) {
      if (deltaP1 !== 0) seriesWinner = deltaP1 > 0 ? p1 : p2;
    } else if (series.p1ChipDelta !== series.p2ChipDelta) {
      seriesWinner = series.p1ChipDelta > series.p2ChipDelta ? p1 : p2;
    }
  }

  if (seriesWinner) {
    markRankedSeriesFinalized(series, RANKED_SERIES_STATUS.COMPLETED, {
      winnerId: seriesWinner,
      loserId: seriesWinner === p1 ? p2 : p1,
      reason: 'series_complete_by_score'
    });
  }

  return {
    series,
    gameEntry,
    complete: !isRankedSeriesInProgress(series),
    winnerId: series.winnerId || null,
    tiebreakerRound,
    inTiebreaker: isRankedSeriesInProgress(series) && gameIndex >= RANKED_SERIES_TARGET_GAMES && Number(series.p1ChipDelta) === Number(series.p2ChipDelta)
  };
}

function finalizeRankedSeriesByForfeit(match, winnerId, loserId) {
  if (!match || String(match.matchType || '').toUpperCase() !== 'RANKED') return null;
  const series = ensureRankedSeriesForMatch(match);
  if (!series || !isRankedSeriesInProgress(series)) return series;
  markRankedSeriesFinalized(series, RANKED_SERIES_STATUS.FORFEITED, {
    winnerId: winnerId || null,
    loserId: loserId || null,
    reason: 'forfeit'
  });
  return series;
}

function finalizeRankedSeriesElo(series, {
  winnerId = null,
  loserId = null,
  reason = 'series_complete'
} = {}) {
  if (!series || !winnerId || !loserId) return null;
  if (series.eloFinalizedAt && series.seriesElo) {
    return series.seriesElo;
  }
  const p1Id = series.p1;
  const p2Id = series.p2;
  const user1 = getUserById(p1Id);
  const user2 = getUserById(p2Id);
  if (!user1 || !user2) return null;
  ensureRankedState(user1);
  ensureRankedState(user2);

  const startElo1 = normalizeRankedElo(series.p1EloStart ?? user1.rankedElo);
  const startElo2 = normalizeRankedElo(series.p2EloStart ?? user2.rankedElo);
  const calc1 = rankedSeriesDeltaForOutcome({
    playerElo: startElo1,
    opponentElo: startElo2,
    won: winnerId === p1Id,
    rankTierKey: series.p1RankAtStart || rankedTierFromElo(startElo1).key
  });
  const calc2 = rankedSeriesDeltaForOutcome({
    playerElo: startElo2,
    opponentElo: startElo1,
    won: winnerId === p2Id,
    rankTierKey: series.p2RankAtStart || rankedTierFromElo(startElo2).key
  });
  const delta1 = calc1.finalDelta;
  const delta2 = calc2.finalDelta;

  user1.rankedElo = Math.max(0, startElo1 + delta1);
  user2.rankedElo = Math.max(0, startElo2 + delta2);
  user1.rankedGames = Math.max(0, Math.floor(Number(user1.rankedGames) || 0) + 1);
  user2.rankedGames = Math.max(0, Math.floor(Number(user2.rankedGames) || 0) + 1);
  const winner = winnerId === p1Id ? user1 : user2;
  const loser = loserId === p1Id ? user1 : user2;
  winner.rankedWins = Math.max(0, Math.floor(Number(winner.rankedWins) || 0) + 1);
  loser.rankedLosses = Math.max(0, Math.floor(Number(loser.rankedLosses) || 0) + 1);
  winner.rankedLossStreak = 0;
  loser.rankedLossStreak = Math.max(0, Math.floor(Number(loser.rankedLossStreak) || 0) + 1);
  ensureRankedState(user1);
  ensureRankedState(user2);
  recomputeTitleUnlocks(user1);
  recomputeTitleUnlocks(user2);

  const now = nowIso();
  const seriesElo = {
    seriesId: series.id,
    winnerId,
    loserId,
    reason,
    finalizedAt: now,
    p1Id,
    p2Id,
    deltaP1: delta1,
    deltaP2: delta2,
    p1: {
      startElo: startElo1,
      oppElo: startElo2,
      expected: Number(calc1.expected.toFixed(4)),
      actual: calc1.actual,
      k: calc1.k,
      rawDelta: Number(calc1.rawDelta.toFixed(4)),
      clampedDelta: Number(calc1.clampedDelta.toFixed(4)),
      lossSoftener: Number(calc1.lossSoftener.toFixed(4)),
      finalDelta: delta1,
      endElo: user1.rankedElo
    },
    p2: {
      startElo: startElo2,
      oppElo: startElo1,
      expected: Number(calc2.expected.toFixed(4)),
      actual: calc2.actual,
      k: calc2.k,
      rawDelta: Number(calc2.rawDelta.toFixed(4)),
      clampedDelta: Number(calc2.clampedDelta.toFixed(4)),
      lossSoftener: Number(calc2.lossSoftener.toFixed(4)),
      finalDelta: delta2,
      endElo: user2.rankedElo
    }
  };

  series.seriesElo = seriesElo;
  series.eloFinalizedAt = now;
  series.eloFinalizedBy = reason;
  if (Array.isArray(series.games) && series.games.length > 0) {
    const finalGame = series.games[series.games.length - 1];
    finalGame.eloDeltaP1 = delta1;
    finalGame.eloDeltaP2 = delta2;
  }

  if (process.env.NODE_ENV !== 'test') {
    // eslint-disable-next-line no-console
    console.log('[ranked-series-elo]', JSON.stringify({
      seriesId: series.id,
      winnerId,
      loserId,
      reason,
      p1: seriesElo.p1,
      p2: seriesElo.p2
    }));
  }

  db.data.rankedHistory.push({
    id: nanoid(10),
    mode: 'ranked_series',
    timestamp: now,
    seriesId: series.id,
    matchId: series.matchId || null,
    winnerId,
    loserId,
    reason,
    p1EloBefore: startElo1,
    p1EloAfter: user1.rankedElo,
    p2EloBefore: startElo2,
    p2EloAfter: user2.rankedElo,
    p1EloDelta: delta1,
    p2EloDelta: delta2,
    eloCalc: {
      [p1Id]: seriesElo.p1,
      [p2Id]: seriesElo.p2
    }
  });
  db.data.rankedHistory = db.data.rankedHistory.slice(-3000);
  return seriesElo;
}

function creditUserBankroll(user, rewardChips) {
  if (!user) return 0;
  const delta = Math.max(0, Math.floor(Number(rewardChips) || 0));
  user.chips = Math.max(0, Math.floor(Number(user.chips) || 0) + delta);
  invalidateLeaderboardCache();
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
  if (!Array.isArray(cards) || cards.length !== 2) return false;
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
  // Unbiased Fisher-Yates shuffle with crypto-backed random ints.
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function drawCard(round) {
  return round.deck.pop();
}

function sampleBlackjackFrequency(samples = 10_000) {
  const count = Math.max(100, Math.floor(Number(samples) || 10_000));
  let naturals = 0;
  for (let i = 0; i < count; i += 1) {
    const deck = buildDeck();
    const hand = [deck.pop(), deck.pop()];
    if (handMeta(hand).isNaturalBlackjack) naturals += 1;
  }
  return {
    samples: count,
    naturals,
    rate: naturals / count
  };
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
    hitCount: 0,
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
  const nowMs = Date.now();
  const eventsSnapshot = eventsSnapshotPayload(nowMs);
  const betLimits = getMatchBetLimits(match);
  const negotiationEnabled = isBetNegotiationEnabled(match);
  const negotiation = negotiationEnabled ? ensureBetNegotiation(match) : null;
  const fixedTableBet = normalizeQuickPlayBucket(match.quickPlayBucket) || Math.max(0, Math.floor(Number(match.rankedBet) || 0));
  const rankedSeries = String(match.matchType || '').toUpperCase() === 'RANKED'
    ? rankedSeriesSummaryForUser(ensureRankedSeriesForMatch(match, { createIfMissing: false }), viewerId)
    : null;
  const rankedSeriesHud = rankedSeries
    ? (() => {
        const baseSeriesGames = RANKED_SERIES_TARGET_GAMES;
        const seriesGameIndex = Math.max(
          1,
          Math.floor(Number(match.roundNumber) || 0) || ((rankedSeries.markers?.length || 0) + 1)
        );
        const isTiebreaker = seriesGameIndex > baseSeriesGames;
        return {
          seriesGameIndex,
          baseSeriesGames,
          isTiebreaker,
          tiebreakerIndex: isTiebreaker ? (seriesGameIndex - baseSeriesGames) : 0
        };
      })()
    : null;
  const opponentId = nextPlayerId(match, viewerId);
  const yourProposal = negotiation ? Number(negotiation.proposalsByPlayerId?.[viewerId]) || null : null;
  const opponentProposal = negotiation ? Number(negotiation.proposalsByPlayerId?.[opponentId]) || null : null;
  const agreedAmount = negotiation ? Number(negotiation.agreedAmount) || null : null;
  const targetBet = negotiation
    ? Number(agreedAmount) || Math.max(Number(yourProposal) || 0, Number(opponentProposal) || 0) || null
    : null;
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
          hitCount: hand.hitCount || 0,
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
    economyMode: match.economyMode || (isPracticeMatch(match) ? 'no_delta' : 'standard'),
    isPractice: isPracticeMatch(match),
    highRoller: String(match?.matchType || '').toUpperCase() === 'HIGH_ROLLER' || Boolean(match?.highRoller),
    serverNow: eventsSnapshot.serverNow,
    activeEvents: eventsSnapshot.activeEvents,
    quickPlayBucket: normalizeQuickPlayBucket(match.quickPlayBucket),
    rankedSeries,
    rankedSeriesHud,
    seriesGameIndex: rankedSeriesHud?.seriesGameIndex || null,
    baseSeriesGames: rankedSeriesHud?.baseSeriesGames || null,
    isTiebreaker: Boolean(rankedSeriesHud?.isTiebreaker),
    tiebreakerIndex: rankedSeriesHud?.tiebreakerIndex || null,
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
      !fixedTableBet &&
      (negotiationEnabled || viewerId === match.betControllerId) &&
      !round.betConfirmedByPlayer?.[viewerId],
    canConfirmBet:
      match.phase === PHASES.ROUND_INIT &&
      !round.betConfirmedByPlayer?.[viewerId] &&
      (!negotiationEnabled || Number.isFinite(opponentProposal) || Number.isFinite(agreedAmount)),
    betConfirmedByPlayer: round.betConfirmedByPlayer,
    betNegotiation: negotiationEnabled
      ? {
          enabled: true,
          status: negotiation?.status || 'negotiating',
          yourProposal,
          opponentProposal,
          agreedAmount,
          yourAccepted: Boolean(negotiation?.acceptedByPlayerId?.[viewerId]),
          opponentAccepted: Boolean(negotiation?.acceptedByPlayerId?.[opponentId]),
          targetBet,
          lastActionBy: negotiation?.lastActionBy || null,
          lastActionType: negotiation?.lastActionType || null,
          lastActionAt: negotiation?.lastActionAt || null
        }
      : { enabled: false, status: 'disabled', yourProposal: null, opponentProposal: null, agreedAmount: null },
    minBet: betLimits.min,
    maxDoublesPerHand: RULES.MAX_DOUBLES_PER_HAND,
    maxBetCap: betLimits.max,
    maxHandsPerPlayer: RULES.MAX_HANDS_PER_PLAYER,
    betControllerId: match.betControllerId,
    postedBetByPlayer: round.postedBetByPlayer,
    stakesCommittedByPlayer: round.stakesCommittedByPlayer || {},
    stakesCommitted: Boolean(round.stakesCommitted),
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
  if (match && Array.isArray(match.playerIds)) {
    match.participants = buildParticipants(match.playerIds, match.bot?.difficultyById || {});
  }
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
    const j = secureRandomInt(0, i + 1);
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
  // Real-chip bot and PvP matches both count; practice/no-delta matches do not.
  if (!isRealMatch(match)) return false;
  recordChallengeEvent(user, event, amount);
  return true;
}

function skillChallengeExpiresAt(from = new Date()) {
  const startMs = new Date(from).getTime();
  if (!Number.isFinite(startMs)) return new Date(Date.now() + DAILY_RESET_MS).toISOString();
  return new Date(startMs + DAILY_RESET_MS).toISOString();
}

function normalizeSkillChallengeHistoryEntries(history = [], nowMs = Date.now()) {
  const horizonMs = nowMs - (14 * DAILY_RESET_MS);
  return (Array.isArray(history) ? history : [])
    .map((entry) => {
      const key = String(entry?.key || '').trim();
      const selectedMs = new Date(entry?.selectedAt || '').getTime();
      if (!key || !SKILL_CHALLENGE_DEF_MAP.has(key)) return null;
      if (!Number.isFinite(selectedMs)) return null;
      if (selectedMs < horizonMs || selectedMs > nowMs + DAILY_RESET_MS) return null;
      return {
        key,
        selectedAt: new Date(selectedMs).toISOString()
      };
    })
    .filter(Boolean)
    .slice(-200);
}

function pickSkillChallengeDefsForUser(user, count, nowMs = Date.now()) {
  const target = Math.max(1, Math.floor(Number(count) || SKILL_CHALLENGE_ACTIVE_COUNT));
  const state = user.skillChallengeState || { history: [] };
  const recentCutoffMs = nowMs - (SKILL_CHALLENGE_NO_REPEAT_DAYS * DAILY_RESET_MS);
  const recentKeys = new Set(
    (Array.isArray(state.history) ? state.history : [])
      .map((entry) => {
        const key = String(entry?.key || '').trim();
        const selectedMs = new Date(entry?.selectedAt || '').getTime();
        if (!key || !SKILL_CHALLENGE_DEF_MAP.has(key)) return null;
        if (!Number.isFinite(selectedMs) || selectedMs < recentCutoffMs) return null;
        return key;
      })
      .filter(Boolean)
  );
  const shuffled = [...SKILL_CHALLENGE_POOL];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(0, i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const selected = [];
  for (const def of shuffled) {
    if (selected.length >= target) break;
    if (recentKeys.has(def.key)) continue;
    selected.push(def);
  }
  if (selected.length < target) {
    for (const def of shuffled) {
      if (selected.length >= target) break;
      if (selected.some((entry) => entry.key === def.key)) continue;
      selected.push(def);
    }
  }
  return selected;
}

function ensureSkillChallenges(user, force = false) {
  let changed = false;
  if (!Array.isArray(user.skillChallenges)) {
    user.skillChallenges = [];
    changed = true;
  }
  if (!user.skillChallengeState || typeof user.skillChallengeState !== 'object' || Array.isArray(user.skillChallengeState)) {
    user.skillChallengeState = { expiresAt: null, history: [] };
    changed = true;
  }
  if (!Array.isArray(user.skillChallengeState.history)) {
    user.skillChallengeState.history = [];
    changed = true;
  }

  const nowMs = Date.now();
  const normalizedHistory = normalizeSkillChallengeHistoryEntries(user.skillChallengeState.history, nowMs);
  if (normalizedHistory.length !== user.skillChallengeState.history.length) {
    user.skillChallengeState.history = normalizedHistory;
    changed = true;
  }

  const expiresMs = new Date(user.skillChallengeState.expiresAt || '').getTime();
  const hasStructuredChallenges = user.skillChallenges.length > 0 && user.skillChallenges.every((item) => {
    const key = String(item?.key || '').trim();
    if (!key || !SKILL_CHALLENGE_DEF_MAP.has(key)) return false;
    const expMs = new Date(item?.expiresAt || '').getTime();
    return Number.isFinite(expMs);
  });
  const shouldRotate = force || !hasStructuredChallenges || !Number.isFinite(expiresMs) || expiresMs <= nowMs;

  if (shouldRotate) {
    const selectedDefs = pickSkillChallengeDefsForUser(user, SKILL_CHALLENGE_ACTIVE_COUNT, nowMs);
    const expiresAt = skillChallengeExpiresAt(new Date(nowMs));
    const selectedAt = new Date(nowMs).toISOString();
    user.skillChallenges = selectedDefs.map((def) => ({
      id: `skill_${nanoid(8)}`,
      key: def.key,
      tier: 'skill',
      title: def.title,
      description: def.description,
      goal: def.goal,
      progress: 0,
      rewardChips: def.rewardChips,
      event: def.event,
      icon: def.icon || 'SKL',
      expiresAt,
      resetAt: expiresAt,
      completedAt: null,
      claimed: false,
      claimedAt: null
    }));
    user.skillChallengeState.expiresAt = expiresAt;
    user.skillChallengeState.lastRotatedAt = selectedAt;
    user.skillChallengeState.poolSize = SKILL_CHALLENGE_POOL.length;
    user.skillChallengeState.activeCount = user.skillChallenges.length;
    user.skillChallengeState.history = normalizeSkillChallengeHistoryEntries(
      [...user.skillChallengeState.history, ...selectedDefs.map((def) => ({ key: def.key, selectedAt }))],
      nowMs
    );
    return true;
  }

  const activeResetAt = Number.isFinite(expiresMs)
    ? new Date(expiresMs).toISOString()
    : skillChallengeExpiresAt(new Date(nowMs));
  if (user.skillChallengeState.expiresAt !== activeResetAt) {
    user.skillChallengeState.expiresAt = activeResetAt;
    changed = true;
  }
  const poolSize = SKILL_CHALLENGE_POOL.length;
  const activeCount = user.skillChallenges.length;
  if (user.skillChallengeState.poolSize !== poolSize) {
    user.skillChallengeState.poolSize = poolSize;
    changed = true;
  }
  if (user.skillChallengeState.activeCount !== activeCount) {
    user.skillChallengeState.activeCount = activeCount;
    changed = true;
  }

  for (const item of user.skillChallenges) {
    const def = SKILL_CHALLENGE_DEF_MAP.get(String(item?.key || '').trim());
    if (!def) continue;
    if (item.title !== def.title) {
      item.title = def.title;
      changed = true;
    }
    if (item.description !== def.description) {
      item.description = def.description;
      changed = true;
    }
    if (item.goal !== def.goal) {
      item.goal = def.goal;
      changed = true;
    }
    if (item.rewardChips !== def.rewardChips) {
      item.rewardChips = def.rewardChips;
      changed = true;
    }
    if (item.event !== def.event) {
      item.event = def.event;
      changed = true;
    }
    if (item.icon !== def.icon) {
      item.icon = def.icon;
      changed = true;
    }
    if (item.tier !== 'skill') {
      item.tier = 'skill';
      changed = true;
    }
    const goal = Math.max(1, Math.floor(Number(item.goal) || 1));
    const normalizedProgress = Math.max(0, Math.min(goal, Math.floor(Number(item.progress) || 0)));
    if (item.goal !== goal) {
      item.goal = goal;
      changed = true;
    }
    if (item.progress !== normalizedProgress) {
      item.progress = normalizedProgress;
      changed = true;
    }
    if (!item.expiresAt) {
      item.expiresAt = activeResetAt;
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
    if (item.progress >= item.goal && !item.completedAt) {
      item.completedAt = nowIso();
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
  const skillResetAt =
    user.skillChallengeState?.expiresAt ||
    (Array.isArray(user.skillChallenges) ? user.skillChallenges.find((item) => item?.expiresAt)?.expiresAt : null) ||
    skillChallengeExpiresAt(now);
  const resets = {
    hourly: user.challengeSets?.hourly?.expiresAt || challengeExpiresAt('hourly', now),
    daily: user.challengeSets?.daily?.expiresAt || challengeExpiresAt('daily', now),
    weekly: user.challengeSets?.weekly?.expiresAt || challengeExpiresAt('weekly', now),
    skill: skillResetAt
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
    skill: (user.skillChallenges || []).map((item) => ({
      ...item,
      expiresAt: item.expiresAt || resets.skill,
      resetAt: item.resetAt || item.expiresAt || resets.skill
    }))
  };
  const challengeList = [...challenges.hourly, ...challenges.daily, ...challenges.weekly, ...challenges.skill];
  return {
    challenges,
    challengeList,
    challengeResets: resets,
    hourlyResetAt: resets.hourly,
    dailyResetAt: resets.daily,
    weeklyResetAt: resets.weekly,
    skillResetAt: resets.skill,
    nextDailyResetAt: resets.daily,
    nextWeeklyResetAt: resets.weekly,
    nextSkillResetAt: resets.skill,
    skillPoolSize: SKILL_CHALLENGE_POOL.length,
    activeSkillCount: challenges.skill.length
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
    stakesCommittedByPlayer: {
      [p1]: 0,
      [p2]: 0
    },
    stakesCommitted: false,
    allInPlayers: {
      [p1]: false,
      [p2]: false
    },
    betConfirmedByPlayer: {
      [p1]: false,
      [p2]: false
    },
    pendingPressure: null,
    betNegotiation: null,
    botPacing: { firstActionDoneById: {} },
    resultChoiceByPlayer: {},
    resultFinalized: false,
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
  match.resultFinalized = false;
  match.phase = PHASES.ROUND_INIT;
  match.roundNumber += 1;

  if (isBetNegotiationEnabled(match)) {
    ensureBetNegotiation(match);
  }

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

function commitBetAtRoundStart(match) {
  if (!match?.round) return { ok: false, error: 'Round missing' };
  if (match.round.stakesCommitted) return { ok: true, alreadyCommitted: true };
  const commitments = {};
  for (const pid of match.playerIds) {
    commitments[pid] = Math.max(0, Math.floor(Number(match.round.postedBetByPlayer?.[pid]) || 0));
  }
  match.round.stakesCommittedByPlayer = commitments;
  match.round.stakesCommitted = true;

  if (!usesRoundStartStakeCommit(match)) {
    return { ok: true, committed: commitments, deducted: false };
  }

  for (const pid of match.playerIds) {
    if (isBotPlayer(pid)) continue;
    const stake = commitments[pid] || 0;
    if (stake <= 0) continue;
    const bankroll = getParticipantChips(match, pid);
    const deduction = Math.min(Math.max(0, Math.floor(Number(bankroll) || 0)), stake);
    setParticipantChips(match, pid, bankroll - deduction);
    commitments[pid] = deduction;
    emitUserUpdate(pid);
  }
  db.write();
  return { ok: true, committed: commitments, deducted: true };
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
  commitBetAtRoundStart(match);
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
  const levelBefore = {
    [aId]: levelFromXp(userA?.xp || 0),
    [bId]: levelFromXp(userB?.xp || 0)
  };
  const bankrollBefore = {
    [aId]: getParticipantChips(match, aId),
    [bId]: getParticipantChips(match, bId)
  };
  const chipsDelta = {
    [aId]: 0,
    [bId]: 0
  };
  const xpDeltaByPlayer = {
    [aId]: 0,
    [bId]: 0
  };
  const xpMetaByPlayer = {
    [aId]: { betAmount: 0, multiplier: 1 },
    [bId]: { betAmount: 0, multiplier: 1 }
  };

  const outcomes = [];

  function mergeHandOutcome(previous, next) {
    if (!previous) return next;
    if (!next || previous === next) return previous;
    if (previous === 'push') return next;
    if (next === 'push') return previous;
    return 'mixed';
  }

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

  const aBase = a.hands[0] || null;
  const bBase = b.hands[0] || null;
  const surrenderBaseByPlayer = {
    [aId]: Math.max(
      1,
      Math.floor(
        Number(match?.round?.postedBetByPlayer?.[aId]) ||
        Number(match?.round?.stakesCommittedByPlayer?.[aId]) ||
        Number(aBase?.bet) ||
        Number(match?.round?.baseBet) ||
        BASE_BET
      )
    ),
    [bId]: Math.max(
      1,
      Math.floor(
        Number(match?.round?.postedBetByPlayer?.[bId]) ||
        Number(match?.round?.stakesCommittedByPlayer?.[bId]) ||
        Number(bBase?.bet) ||
        Number(match?.round?.baseBet) ||
        BASE_BET
      )
    )
  };
  const surrenderSettledByPlayer = {
    [aId]: false,
    [bId]: false
  };
  const handSlots = Math.max(a.hands.length || 0, b.hands.length || 0, 1);
  // Aggregate settlement per hand so split outcomes (win/push/loss mix) pay correctly.
  for (let idx = 0; idx < handSlots; idx += 1) {
    const handA = a.hands[idx] || aBase;
    const handB = b.hands[idx] || bBase;
    if (!handA || !handB) continue;

    if (handA.surrendered && handB.surrendered) {
      if (!surrenderSettledByPlayer[aId] && !surrenderSettledByPlayer[bId]) {
        handA.outcome = mergeHandOutcome(handA.outcome, 'push');
        handB.outcome = mergeHandOutcome(handB.outcome, 'push');
        outcomes.push({ winner: null, loser: null, amount: 0, handIndex: idx, winnerHandWasSplit: false });
      }
      surrenderSettledByPlayer[aId] = true;
      surrenderSettledByPlayer[bId] = true;
      continue;
    }

    if (handA.surrendered) {
      if (surrenderSettledByPlayer[aId]) continue;
      const amount = Math.floor(surrenderBaseByPlayer[aId] * RULES.SURRENDER_LOSS_FRACTION);
      chipsDelta[aId] -= amount;
      chipsDelta[bId] += amount;
      handA.outcome = mergeHandOutcome(handA.outcome, 'loss');
      handB.outcome = mergeHandOutcome(handB.outcome, 'win');
      outcomes.push({ winner: bId, loser: aId, amount, handIndex: idx, winnerHandWasSplit: Boolean(handB?.wasSplitHand) });
      surrenderSettledByPlayer[aId] = true;
    } else if (handB.surrendered) {
      if (surrenderSettledByPlayer[bId]) continue;
      const amount = Math.floor(surrenderBaseByPlayer[bId] * RULES.SURRENDER_LOSS_FRACTION);
      chipsDelta[aId] += amount;
      chipsDelta[bId] -= amount;
      handA.outcome = mergeHandOutcome(handA.outcome, 'win');
      handB.outcome = mergeHandOutcome(handB.outcome, 'loss');
      outcomes.push({ winner: aId, loser: bId, amount, handIndex: idx, winnerHandWasSplit: Boolean(handA?.wasSplitHand) });
      surrenderSettledByPlayer[bId] = true;
    } else {
      const result = compareHands(handA, handB);
      const pot = Math.min(handA.bet, handB.bet);
      const handANatural = Boolean(handA.naturalBlackjack);
      const handBNatural = Boolean(handB.naturalBlackjack);
      if (result > 0) {
        const amount = handANatural && !handBNatural ? Math.floor(pot * 1.5) : pot;
        chipsDelta[aId] += amount;
        chipsDelta[bId] -= amount;
        handA.outcome = mergeHandOutcome(handA.outcome, 'win');
        handB.outcome = mergeHandOutcome(handB.outcome, 'loss');
        outcomes.push({ winner: aId, loser: bId, amount, handIndex: idx, winnerHandWasSplit: Boolean(handA?.wasSplitHand) });
      } else if (result < 0) {
        const amount = handBNatural && !handANatural ? Math.floor(pot * 1.5) : pot;
        chipsDelta[aId] -= amount;
        chipsDelta[bId] += amount;
        handA.outcome = mergeHandOutcome(handA.outcome, 'loss');
        handB.outcome = mergeHandOutcome(handB.outcome, 'win');
        outcomes.push({ winner: bId, loser: aId, amount, handIndex: idx, winnerHandWasSplit: Boolean(handB?.wasSplitHand) });
      } else {
        handA.outcome = mergeHandOutcome(handA.outcome, 'push');
        handB.outcome = mergeHandOutcome(handB.outcome, 'push');
        outcomes.push({ winner: null, loser: null, amount: 0, handIndex: idx, winnerHandWasSplit: false });
      }
    }
  }

  if (realMatch) {
    const committed = match.round?.stakesCommittedByPlayer || {};
    const payoutA = usesRoundStartStakeCommit(match) ? chipsDelta[aId] + (committed[aId] || 0) : chipsDelta[aId];
    const payoutB = usesRoundStartStakeCommit(match) ? chipsDelta[bId] + (committed[bId] || 0) : chipsDelta[bId];
    setParticipantChips(match, aId, getParticipantChips(match, aId) + payoutA);
    setParticipantChips(match, bId, getParticipantChips(match, bId) + payoutB);
  }
  const bankrollAfter = {
    [aId]: getParticipantChips(match, aId),
    [bId]: getParticipantChips(match, bId)
  };
  logMatchEconomyEvent('SETTLEMENT_APPLIED', {
    matchId: match.id,
    matchType: match.matchType || null,
    chipsDelta,
    bankrollBefore,
    bankrollAfter
  });

  function applyHandOutcomeStats(user, ownId, out, hand, opponentHand) {
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
      const nextStreak = streakCountsAfterOutcome({
        winStreak: stats.currentWinStreak,
        lossStreak: stats.currentLossStreak,
        outcome: 'win'
      });
      stats.currentWinStreak = nextStreak.winStreak;
      stats.currentLossStreak = nextStreak.lossStreak;
      stats.longestWinStreak = Math.max(stats.longestWinStreak || 0, stats.currentWinStreak || 0);
      stats.totalChipsWon = (stats.totalChipsWon || 0) + (out.amount || 0);
      stats.biggestHandWin = Math.max(stats.biggestHandWin || 0, out.amount || 0);
      if (!hand?.bust) stats.maxCardsInWinningHand = Math.max(stats.maxCardsInWinningHand || 0, handCardsCount);
      recordChallengeEvent(user, 'hand_won', 1);
      recordSkillEvent(user, 'hand_won', 1);
      if ((hand?.doubleCount || 0) > 0) recordSkillEvent(user, 'double_win', 1);
      if (hand?.wasSplitHand) recordSkillEvent(user, 'split_win', 1);
      if ((handSummary.total || 0) === 20) recordSkillEvent(user, 'exact_20_win', 1);
      if (handCardsCount >= 5 && !handSummary.isBust) recordSkillEvent(user, 'five_card_win', 1);
      if ((handSummary.total || 0) <= 19) recordSkillEvent(user, 'low_total_win', 1);
      const opponentUpCard = Array.isArray(opponentHand?.cards) ? opponentHand.cards[0] : null;
      if (opponentUpCard?.rank === 'A') recordSkillEvent(user, 'win_vs_ace_up', 1);
      if (Math.max(0, Math.floor(Number(hand?.hitCount) || 0)) <= 1) {
        recordSkillEvent(user, 'controlled_hit_win', 1);
      }
    } else if (ownLost) {
      stats.handsLost = (stats.handsLost || 0) + 1;
      const nextStreak = streakCountsAfterOutcome({
        winStreak: stats.currentWinStreak,
        lossStreak: stats.currentLossStreak,
        outcome: 'loss'
      });
      stats.currentWinStreak = nextStreak.winStreak;
      stats.currentLossStreak = nextStreak.lossStreak;
      stats.longestLossStreak = Math.max(stats.longestLossStreak || 0, stats.currentLossStreak || 0);
      stats.totalChipsLost = (stats.totalChipsLost || 0) + (out.amount || 0);
      stats.biggestHandLoss = Math.max(stats.biggestHandLoss || 0, out.amount || 0);
      recordChallengeEvent(user, 'hand_lost', 1);
      recordSkillEvent(user, 'hand_lost', 1);
    } else if (ownPush) {
      stats.pushes = (stats.pushes || 0) + 1;
      stats.handsPush = stats.pushes;
      const nextStreak = streakCountsAfterOutcome({
        winStreak: stats.currentWinStreak,
        lossStreak: stats.currentLossStreak,
        outcome: 'push'
      });
      stats.currentWinStreak = nextStreak.winStreak;
      stats.currentLossStreak = nextStreak.lossStreak;
      recordChallengeEvent(user, 'push', 1);
      recordSkillEvent(user, 'push', 1);
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
    applyHandOutcomeStats(userA, aId, out, handA, handB);
    applyHandOutcomeStats(userB, bId, out, handB, handA);
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
      recordSkillEvent(userA, 'round_won', 1);
    }
    if (userB) userB.stats.roundsLost += 1;
  } else if (realMatch && netA < 0) {
    if (userB) {
      userB.stats.roundsWon += 1;
      recordChallengeEvent(userB, 'round_won', 1);
      recordSkillEvent(userB, 'round_won', 1);
    }
    if (userA) userA.stats.roundsLost += 1;
  }

  const pvpMatch = !isBotMatch(match);
  const winnerId = netA > 0 ? aId : netA < 0 ? bId : null;
  const loserId = netA > 0 ? bId : netA < 0 ? aId : null;
  const winnerUser = winnerId ? getUserById(winnerId) : null;
  const loserUser = loserId ? getUserById(loserId) : null;
  const rankedRound = String(match.matchType || '').toUpperCase() === 'RANKED' && realMatch;
  if (realMatch && rankedRound) {
    if (netA > 0 && userA) recordSkillEvent(userA, 'ranked_round_win', 1);
    if (netA < 0 && userB) recordSkillEvent(userB, 'ranked_round_win', 1);
  }
  if (realMatch && isBotMatch(match)) {
    const botId = match.playerIds.find((id) => isBotPlayer(id));
    const difficulty = botId ? getBotDifficulty(match, botId) : '';
    if (difficulty === 'medium') {
      if (netA > 0 && !isBotPlayer(aId) && userA) recordSkillEvent(userA, 'bot_medium_round_win', 1);
      if (netA < 0 && !isBotPlayer(bId) && userB) recordSkillEvent(userB, 'bot_medium_round_win', 1);
    } else if (difficulty === 'normal') {
      if (netA > 0 && !isBotPlayer(aId) && userA) recordSkillEvent(userA, 'bot_normal_round_win', 1);
      if (netA < 0 && !isBotPlayer(bId) && userB) recordSkillEvent(userB, 'bot_normal_round_win', 1);
    }
  }
  const outcomeForA = netA > 0 ? 'win' : netA < 0 ? 'loss' : 'push';
  const outcomeForB = netA < 0 ? 'win' : netA > 0 ? 'loss' : 'push';
  if (realMatch && userA) {
    userA.currentMatchWinStreak = matchWinStreakAfterOutcome(userA.currentMatchWinStreak, outcomeForA);
    if (outcomeForA === 'win') {
      userA.bestMatchWinStreak = Math.max(
        Math.floor(Number(userA.bestMatchWinStreak) || 0),
        Math.floor(Number(userA.currentMatchWinStreak) || 0)
      );
    }
  }
  if (realMatch && userB) {
    userB.currentMatchWinStreak = matchWinStreakAfterOutcome(userB.currentMatchWinStreak, outcomeForB);
    if (outcomeForB === 'win') {
      userB.bestMatchWinStreak = Math.max(
        Math.floor(Number(userB.bestMatchWinStreak) || 0),
        Math.floor(Number(userB.currentMatchWinStreak) || 0)
      );
    }
  }

  if (pvpMatch && winnerUser && loserUser) {
    winnerUser.pvpWins = Math.max(0, Math.floor(Number(winnerUser.pvpWins) || 0) + 1);
    loserUser.pvpLosses = Math.max(0, Math.floor(Number(loserUser.pvpLosses) || 0) + 1);
    recordHeadToHead(winnerId, loserId);
    if (realMatch) {
      updateDailyWinStreak(winnerUser);
    }
    const winnerLevelBefore = levelBefore[winnerId] || 1;
    const loserLevelBefore = levelBefore[loserId] || 1;
    const winnerBankrollBefore = Math.floor(Number(bankrollBefore[winnerId]) || 0);
    const loserBankrollBefore = Math.floor(Number(bankrollBefore[loserId]) || 0);
    if (winnerLevelBefore < loserLevelBefore || winnerBankrollBefore < loserBankrollBefore) {
      unlockTitle(winnerUser, 'GIANT_KILLER');
    }
  }

  let rankedSeriesUpdate = null;
  let rankedSeriesResultByPlayer = null;
  if (rankedRound) {
    ensureRankedSeriesForMatch(match, { createIfMissing: true });
    rankedSeriesUpdate = recordRankedSeriesGame(match, {
      winnerId,
      loserId,
      netByPlayer: chipsDelta
    });
    if (rankedSeriesUpdate?.complete && rankedSeriesUpdate?.winnerId) {
      finalizeRankedSeriesElo(rankedSeriesUpdate.series, {
        winnerId: rankedSeriesUpdate.winnerId,
        loserId: rankedSeriesUpdate.series?.loserId || loserId,
        reason: 'series_complete'
      });
      rankedSeriesResultByPlayer = {
        [aId]: rankedSeriesResultForUser(rankedSeriesUpdate.series, aId),
        [bId]: rankedSeriesResultForUser(rankedSeriesUpdate.series, bId)
      };
    }
  }

  if (realMatch) {
    const xpWinBase = pvpMatch ? XP_REWARDS.pvpWin : XP_REWARDS.botWin;
    const xpLossBase = pvpMatch ? XP_REWARDS.pvpLoss : XP_REWARDS.botLoss;
    const baseBet = Math.max(1, Math.floor(Number(match.round?.baseBet) || BASE_BET));
    const exposureA = exposureBetForXp(a, baseBet);
    const exposureB = exposureBetForXp(b, baseBet);
    const multiplierA = xpBetMultiplierFromAmount(exposureA);
    const multiplierB = xpBetMultiplierFromAmount(exposureB);
    xpMetaByPlayer[aId] = { betAmount: exposureA, multiplier: multiplierA };
    xpMetaByPlayer[bId] = { betAmount: exposureB, multiplier: multiplierB };
    const awardXpDelta = (user, amount) => {
      if (!user) return 0;
      const before = Math.max(0, Math.floor(Number(user.xp) || 0));
      awardXp(user, amount);
      const after = Math.max(0, Math.floor(Number(user.xp) || 0));
      return Math.max(0, after - before);
    };
    if (netA > 0) {
      if (userA) {
        const gain = Math.max(
          1,
          Math.floor(
            xpWinBase *
            multiplierA *
            xpStreakBonusMultiplier(userA)
          )
        );
        xpDeltaByPlayer[aId] = awardXpDelta(userA, gain);
      }
      if (userB) {
        const gain = Math.max(1, Math.floor(xpLossBase * multiplierB));
        xpDeltaByPlayer[bId] = awardXpDelta(userB, gain);
      }
    } else if (netA < 0) {
      if (userB) {
        const gain = Math.max(
          1,
          Math.floor(
            xpWinBase *
            multiplierB *
            xpStreakBonusMultiplier(userB)
          )
        );
        xpDeltaByPlayer[bId] = awardXpDelta(userB, gain);
      }
      if (userA) {
        const gain = Math.max(1, Math.floor(xpLossBase * multiplierA));
        xpDeltaByPlayer[aId] = awardXpDelta(userA, gain);
      }
    } else {
      // Push still grants a small amount of progression.
      if (userA) {
        const gain = Math.max(1, Math.floor((xpLossBase * 0.5) * multiplierA));
        xpDeltaByPlayer[aId] = awardXpDelta(userA, gain);
      }
      if (userB) {
        const gain = Math.max(1, Math.floor((xpLossBase * 0.5) * multiplierB));
        xpDeltaByPlayer[bId] = awardXpDelta(userB, gain);
      }
    }
  }

  const highRollerRound = Math.max(0, Math.floor(Number(match.round?.baseBet) || 0)) >= HIGH_ROLLER_MIN_BET;
  if (highRollerRound && realMatch) {
    if (userA) userA.highRollerMatchCount = Math.max(0, Math.floor(Number(userA.highRollerMatchCount) || 0) + 1);
    if (userB) userB.highRollerMatchCount = Math.max(0, Math.floor(Number(userB.highRollerMatchCount) || 0) + 1);
  }

  for (const user of [userA, userB]) {
    if (!user) continue;
    if (Math.floor(Number(user.highRollerMatchCount) || 0) >= 10) unlockTitle(user, 'HIGH_ROLLER');
    if (Math.floor(Number(user.currentMatchWinStreak) || 0) >= 10) unlockTitle(user, 'STREAK_LORD');
    recomputeTitleUnlocks(user);
    ensureProfileBorderState(user);
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
      xpDelta: xpDeltaByPlayer[aId] || 0,
      xpBetAmount: xpMetaByPlayer[aId]?.betAmount || 0,
      xpBetMultiplier: xpMetaByPlayer[aId]?.multiplier || 1,
      previousBankroll: bankrollBefore[aId],
      newBankroll: bankrollAfter[aId],
      isPractice: isPracticeMatch(match),
      rankedSeries: rankedSeriesUpdate ? rankedSeriesSummaryForUser(rankedSeriesUpdate.series, aId) : null,
      seriesResult: rankedSeriesResultByPlayer?.[aId] || null
    },
    [bId]: {
      matchId: match.id,
      roundNumber: match.roundNumber,
      outcome: outcomeB,
      title: titleFor(bId),
      deltaChips: chipsDelta[bId],
      xpDelta: xpDeltaByPlayer[bId] || 0,
      xpBetAmount: xpMetaByPlayer[bId]?.betAmount || 0,
      xpBetMultiplier: xpMetaByPlayer[bId]?.multiplier || 1,
      previousBankroll: bankrollBefore[bId],
      newBankroll: bankrollAfter[bId],
      isPractice: isPracticeMatch(match),
      rankedSeries: rankedSeriesUpdate ? rankedSeriesSummaryForUser(rankedSeriesUpdate.series, bId) : null,
      seriesResult: rankedSeriesResultByPlayer?.[bId] || null
    }
  };
  match.round.resultFinalized = true;
  match.resultFinalized = true;

  match.phase = PHASES.REVEAL;
  pushMatchState(match);

  const revealTimer = setTimeout(() => {
    if (!matches.has(match.id)) return;
    match.phase = PHASES.RESULT;
    match.round.resultChoiceByPlayer = {};
    pushMatchState(match);
    emitToUser(aId, 'round:result', match.round.resultByPlayer[aId]);
    emitToUser(bId, 'round:result', match.round.resultByPlayer[bId]);
    if (rankedSeriesUpdate?.complete) {
      const seriesWinnerId = rankedSeriesUpdate.winnerId;
      const seriesWinnerName = match.participants?.[seriesWinnerId]?.username || getUserById(seriesWinnerId)?.username || 'Opponent';
      setTimeout(() => {
        if (!matches.has(match.id)) return;
        emitToUser(aId, 'match:ended', {
          reason: `Ranked series complete. Winner: ${seriesWinnerName}.`,
          seriesResult: rankedSeriesResultByPlayer?.[aId] || null
        });
        emitToUser(bId, 'match:ended', {
          reason: `Ranked series complete. Winner: ${seriesWinnerName}.`,
          seriesResult: rankedSeriesResultByPlayer?.[bId] || null
        });
        cleanupMatch(match);
      }, 900);
    }
    roundPhaseTimers.delete(match.id);
  }, ROUND_REVEAL_MS);
  roundPhaseTimers.set(match.id, revealTimer);
}

function applyRoundResultChoice(match, playerId, choice) {
  if (!match.playerIds.includes(playerId)) return { error: 'Unauthorized' };
  if (match.phase !== PHASES.RESULT) return { error: 'Round result is not ready' };
  if (!['next', 'betting', 'double'].includes(choice)) return { error: 'Invalid round choice' };
  if (choice === 'double' && !isDoubleOrNothingEnabledForMatch(match)) {
    return { error: 'Double or Nothing is only available in Quick Play PvP and friend challenges' };
  }

  if (!match.round.resultChoiceByPlayer) match.round.resultChoiceByPlayer = {};
  match.round.resultChoiceByPlayer[playerId] = choice;

  const botId = match.playerIds.find((id) => isBotPlayer(id));
  if (botId && !match.round.resultChoiceByPlayer[botId]) {
    match.round.resultChoiceByPlayer[botId] = choice;
  }

  const allChosen = match.playerIds.every((pid) => Boolean(match.round.resultChoiceByPlayer?.[pid]));
  if (!allChosen) return { ok: true, waiting: true };

  const everyoneNext = match.playerIds.every((pid) => match.round.resultChoiceByPlayer?.[pid] === 'next');
  const everyoneDouble = match.playerIds.every((pid) => match.round.resultChoiceByPlayer?.[pid] === 'double');
  const shouldAutoStart = everyoneNext || everyoneDouble;

  if (everyoneDouble) {
    if (!isDoubleOrNothingEnabledForMatch(match)) {
      return { error: 'Double or Nothing is only available in Quick Play PvP and friend challenges' };
    }
    const currentBase = Math.max(1, Math.floor(Number(match.round?.baseBet) || BASE_BET));
    const proposed = currentBase * 2;
    const betLimits = getMatchBetLimits(match);
    if (proposed < betLimits.min || proposed > betLimits.max) {
      return { error: `Double or Nothing must stay within ${betLimits.min}-${betLimits.max}` };
    }
    for (const pid of match.playerIds) {
      if (!isPracticeMatch(match) && !isBotPlayer(pid) && getParticipantChips(match, pid) < proposed) {
        return { error: 'Both players must have enough chips for Double or Nothing' };
      }
    }
    if (!match.betSettings) match.betSettings = { selectedBetById: {} };
    for (const pid of match.playerIds) {
      match.betSettings.selectedBetById[pid] = proposed;
    }
    match.round.baseBet = proposed;
  }

  match.startingPlayerIndex = (match.startingPlayerIndex + 1) % 2;
  startRound(match);

  if (shouldAutoStart) {
    for (const pid of match.playerIds) {
      match.round.betConfirmedByPlayer[pid] = true;
    }
    maybeBeginRoundAfterBetConfirm(match);
  }

  return { ok: true, advanced: true, mode: shouldAutoStart ? (everyoneDouble ? 'double' : 'next') : 'betting' };
}

function applyDoubleOrNothingChoice(match, playerId) {
  if (!match || !match.playerIds.includes(playerId)) return { error: 'Unauthorized' };
  if (match.phase !== PHASES.RESULT) return { error: 'Round result is not ready' };
  if (!isDoubleOrNothingEnabledForMatch(match)) {
    return { error: 'Double or Nothing is only available in Quick Play PvP and friend challenges' };
  }
  const currentBase = Math.max(1, Math.floor(Number(match.round?.baseBet) || BASE_BET));
  const proposed = currentBase * 2;
  const betLimits = getMatchBetLimits(match);
  if (proposed < betLimits.min) return { error: `Double amount must be at least ${betLimits.min}` };
  if (proposed > betLimits.max) return { error: `Double amount exceeds table max ${betLimits.max}` };
  for (const pid of match.playerIds) {
    if (!isPracticeMatch(match) && !isBotPlayer(pid) && getParticipantChips(match, pid) < proposed) {
      return { error: `Both players need at least ${proposed} chips to double` };
    }
  }
  return applyRoundResultChoice(match, playerId, 'double');
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

function canSplit(hand, playerRoundState = null, context = null) {
  if (!hand) return false;
  if ((hand.doubleCount || 0) > 0) return false;
  if (playerRoundState?.hands?.length >= RULES.MAX_HANDS_PER_PLAYER) return false;
  if (hand.cards.length !== 2) return false;
  if (hand.splitDepth >= RULES.MAX_SPLITS) return false;
  if (hand.cards[0].rank !== hand.cards[1].rank) return false;
  if (isTenTenPair(hand) && !isSplitTensEventActive(context)) return false;
  return true;
}

function canDoubleActionForHand(hand, maxDoubles = RULES.MAX_DOUBLES_PER_HAND) {
  if (!hand || hand.locked || hand.stood || hand.bust || hand.surrendered) return false;
  if ((hand.doubleCount || 0) >= maxDoubles) return false;
  const hasHit = (hand.hitCount || 0) > 0;
  if (hasHit) return false;
  const hasExistingDouble = (hand.doubleCount || 0) > 0;
  // Double is a first-action move; re-double chaining is allowed after an existing double.
  if (!hasExistingDouble && (hand.actionCount || 0) > 0) return false;
  return true;
}

function visibleTotal(cards, hiddenFlags) {
  const visibleCards = cards.filter((_, idx) => !hiddenFlags[idx]);
  return handTotal(visibleCards);
}

function legalActionsForHand(hand, playerRoundState = null, context = null) {
  if (!hand || hand.locked || hand.stood || hand.bust || hand.surrendered) return [];
  const actions = ['stand'];
  if ((hand.doubleCount || 0) === 0) actions.unshift('hit');
  if ((hand.actionCount || 0) === 0) actions.push('surrender');
  if (canDoubleActionForHand(hand, RULES.MAX_DOUBLES_PER_HAND)) actions.push('double');
  if (canSplit(hand, playerRoundState, context)) actions.push('split');
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
  const allowedActions = legalActionsForHand(activeHand, botState, match);

  const observation = {
    phase: match.phase,
    allowedActions,
    bot: {
      id: botId,
      bankroll: getParticipantChips(match, botId),
      activeHandIndex,
      hands: (botState.hands || []).map((hand, index) => {
        const meta = handMeta(hand.cards || []);
        const splitEligible = canSplit(hand, botState, match);
        return {
          index,
          cards: (hand.cards || []).map(sanitizeCard).filter(Boolean),
          total: meta.total,
          isSoft: meta.isSoft,
          bet: hand.bet || 0,
          actionCount: hand.actionCount || 0,
          hitCount: hand.hitCount || 0,
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
      mode: match?.mode || resolveMatchMode(match?.stakeType),
      matchType: String(match?.matchType || '').toUpperCase(),
      splitTensEventActive: isSplitTensEventActive(match)
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
    const betLimits = getMatchBetLimits(match);
    const canStayWithinTableMax = affectedHandIndices.every((idx) => {
      const hand = botState.hands?.[idx] || botState.hands?.[0];
      return Boolean(hand) && ((Number(hand.bet) || 0) + pressure.delta) <= betLimits.max;
    });
    observation.pressure = {
      type: pressure.type,
      delta: pressure.delta,
      affectedHandIndices,
      required,
      canMatch: canAffordIncrement(match, botId, required) && canStayWithinTableMax,
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

function botLearningModel() {
  if (!db.data.botLearning || typeof db.data.botLearning !== 'object') {
    db.data.botLearning = {
      sampleSize: 0,
      actionCounts: { hit: 0, stand: 0, double: 0, split: 0, surrender: 0 },
      aggression: 0.5
    };
  }
  return db.data.botLearning;
}

function botAggressionBias() {
  const model = botLearningModel();
  const aggression = Number(model.aggression);
  if (!Number.isFinite(aggression)) return 0.5;
  return Math.max(0.2, Math.min(0.8, aggression));
}

function recordHumanActionForBotLearning(match, playerId, action) {
  if (!match || isBotPlayer(playerId)) return;
  if (!isBotMatch(match)) return;
  const normalized = String(action || '').trim().toLowerCase();
  if (!['hit', 'stand', 'double', 'split', 'surrender'].includes(normalized)) return;
  const model = botLearningModel();
  if (!model.actionCounts || typeof model.actionCounts !== 'object') {
    model.actionCounts = { hit: 0, stand: 0, double: 0, split: 0, surrender: 0 };
  }
  model.actionCounts[normalized] = Math.max(0, Math.floor(Number(model.actionCounts[normalized]) || 0) + 1);
  model.sampleSize = Math.max(0, Math.floor(Number(model.sampleSize) || 0) + 1);
  const aggressiveCount = Math.max(0, Math.floor(Number(model.actionCounts.double) || 0))
    + Math.max(0, Math.floor(Number(model.actionCounts.split) || 0));
  const passiveCount = Math.max(0, Math.floor(Number(model.actionCounts.hit) || 0))
    + Math.max(0, Math.floor(Number(model.actionCounts.stand) || 0));
  const denominator = Math.max(1, aggressiveCount + passiveCount);
  model.aggression = Math.max(0.2, Math.min(0.8, aggressiveCount / denominator));
}

function botShouldSurrenderOpeningHand(observation, hand, opponentUpCardTotal, difficultyKey = 'normal') {
  if (!hand) return false;
  if ((hand.actionCount || 0) > 0) return false;
  if ((hand.hitCount || 0) > 0) return false;
  if ((hand.doubleCount || 0) > 0) return false;
  if (hand.isSoft) return false;
  if ((hand.total || 0) >= 17) return false;
  if (hand.splitEligible && ['A', '8'].includes(String(hand.pairRank || ''))) return false;

  const total = hand.total || 0;
  const up = Number(opponentUpCardTotal) || 10;
  const highStakes = Math.max(0, Math.floor(Number(observation?.public?.baseBet) || 0)) >= HIGH_ROLLER_MIN_BET;

  if (total >= 15 && up >= 10) {
    let chance = difficultyKey === 'medium' ? 0.08 : 0.12;
    if (up === 11) chance += 0.03;
    if (highStakes) chance *= 0.45;
    chance = Math.max(0.02, Math.min(0.16, chance));
    return secureRandomFloat() < chance;
  }

  if (total === 14 && up === 11) {
    let chance = difficultyKey === 'medium' ? 0.04 : 0.06;
    if (highStakes) chance *= 0.45;
    chance = Math.max(0.01, Math.min(0.08, chance));
    return secureRandomFloat() < chance;
  }

  return false;
}

function chooseBotActionFromObservation(observation, difficulty = 'normal') {
  if (!observation || observation.phase !== PHASES.ACTION_TURN) return 'stand';
  if (process.env.NODE_ENV !== 'production') assertSafeBotObservation(observation);
  const difficultyKey = String(difficulty || 'normal').trim().toLowerCase();
  let legal = Array.isArray(observation.allowedActions) ? observation.allowedActions : [];
  if (difficultyKey === 'easy') {
    legal = legal.filter((action) => action !== 'double' && action !== 'split');
  }
  if (!legal.length) return 'stand';

  const activeHandIndex = observation.bot?.activeHandIndex ?? 0;
  const hand = observation.bot?.hands?.[activeHandIndex] || null;
  if (!hand) return legal.includes('stand') ? 'stand' : legal[0];
  const splitTensEventActive = Boolean(observation.public?.splitTensEventActive);
  if (splitTensEventActive && hand.splitEligible && hand.pairRank === '10' && legal.includes('split') && difficultyKey !== 'easy') {
    const splitTensChance = difficultyKey === 'medium' ? 0.06 : 0.12;
    if (secureRandomFloat() < splitTensChance) return 'split';
  }
  const opponentUpCard = observation.opponent?.hands?.[0]?.upcards?.[0] || null;
  const opponentUpCardTotal = opponentUpCard ? cardValue(opponentUpCard) : 10;
  if (legal.includes('surrender') && botShouldSurrenderOpeningHand(observation, hand, opponentUpCardTotal, difficultyKey)) {
    return 'surrender';
  }
  let ideal = basicStrategyActionFromObservation(hand, opponentUpCardTotal);
  if (!legal.includes(ideal)) ideal = legal[0];
  const aggression = botAggressionBias();
  if (difficultyKey !== 'easy') {
    if (legal.includes('double') && hand.total >= 9 && hand.total <= 11 && hand.actionCount <= 1) {
      const pressureDoubleChance = difficultyKey === 'medium'
        ? (0.22 + (aggression * 0.2))
        : (0.34 + (aggression * 0.22));
      if (secureRandomFloat() < pressureDoubleChance) return 'double';
    }
    if (legal.includes('split') && hand.splitEligible && hand.pairRank && hand.pairRank !== '10') {
      const pressureSplitChance = difficultyKey === 'medium'
        ? (0.14 + (aggression * 0.16))
        : (0.22 + (aggression * 0.18));
      if (secureRandomFloat() < pressureSplitChance && ['A', '8', '9', '7', '6'].includes(hand.pairRank)) return 'split';
    }
  }
  const accuracyBase = difficultyKey === 'easy' ? 0.45 : difficultyKey === 'medium' ? 0.75 : 0.94;
  const adaptiveAccuracy = difficultyKey === 'easy'
    ? accuracyBase
    : Math.max(0.55, Math.min(0.98, accuracyBase + ((aggression - 0.5) * (difficultyKey === 'normal' ? 0.12 : 0.08))));
  const accuracy = adaptiveAccuracy;
  if (secureRandomFloat() <= accuracy) return ideal;

  const alternatives = legal.filter((a) => a !== ideal && a !== 'surrender');
  if (!alternatives.length) return ideal;
  return alternatives[randomIntInclusive(0, alternatives.length - 1)];
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
  const highStakes = Math.max(0, Math.floor(Number(observation?.public?.baseBet) || 0)) >= HIGH_ROLLER_MIN_BET;
  let chance = base;
  if (total >= 17) chance += 0.1;
  if (total <= 12) chance -= 0.15;
  if (pressure.delta >= 10) chance -= 0.05;
  if (highStakes) {
    chance += 0.08;
    if (total >= 15) chance += 0.05;
  }
  chance = Math.max(0.1, Math.min(0.95, chance));
  if (!pressure.canMatch) return 'surrender';
  return secureRandomFloat() < chance ? 'match' : 'surrender';
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

  const delay = randomIntInclusive(BOT_BET_CONFIRM_MIN_MS, BOT_BET_CONFIRM_MAX_MS);
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
      let appliedDecision = decision;
      let result = applyPressureDecision(match, botId, appliedDecision);
      if (result.error && appliedDecision !== 'surrender') {
        appliedDecision = 'surrender';
        result = applyPressureDecision(match, botId, appliedDecision);
      }
      if (!result.error) {
        if (process.env.NODE_ENV !== 'test') {
          // eslint-disable-next-line no-console
          console.log('[bot-action]', JSON.stringify({
            matchId: match.id,
            phase: match.phase,
            action: `pressure:${appliedDecision}`,
            handTotals: (observation?.bot?.hands || []).map((h) => h.total)
          }));
        }
        markBotActionCompleted(match, botId);
        pushMatchState(match);
        db.write();
        scheduleBotTurn(match);
      } else if (process.env.NODE_ENV !== 'test') {
        // eslint-disable-next-line no-console
        console.log('[bot-action-error]', JSON.stringify({
          matchId: match.id,
          phase: match.phase,
          action: `pressure:${appliedDecision}`,
          error: result.error
        }));
      }
      if (
        match.phase === PHASES.PRESSURE_RESPONSE &&
        match.round.pendingPressure &&
        match.round.pendingPressure.opponentId === botId
      ) {
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
      if (process.env.NODE_ENV !== 'test') {
        // eslint-disable-next-line no-console
        console.log('[bot-action]', JSON.stringify({
          matchId: match.id,
          phase: match.phase,
          action: 'stand',
          fallbackFrom: action,
          handTotals: (observation?.bot?.hands || []).map((h) => h.total)
        }));
      }
    } else if (process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.log('[bot-action]', JSON.stringify({
        matchId: match.id,
        phase: match.phase,
        action,
        handTotals: (observation?.bot?.hands || []).map((h) => h.total)
      }));
    }
    markBotActionCompleted(match, botId);

    pushMatchState(match);
    db.write();
    scheduleBotTurn(match);
  }, delay);

  botTurnTimers.set(match.id, timer);
}

function applyAction(match, playerId, action) {
  const normalizedAction = String(action || '').trim().toLowerCase();
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

  if (normalizedAction === 'hit') {
    if ((hand.doubleCount || 0) >= 1) return { error: 'Hit unavailable after doubling; stand or double again' };
    recordHumanActionForBotLearning(match, playerId, normalizedAction);
    match.round.firstActionTaken = true;
    hand.actionCount = (hand.actionCount || 0) + 1;
    hand.hitCount = (hand.hitCount || 0) + 1;
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

  if (normalizedAction === 'stand') {
    recordHumanActionForBotLearning(match, playerId, normalizedAction);
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

  if (normalizedAction === 'surrender') {
    if ((hand.actionCount || 0) > 0) return { error: 'Surrender is only available before you act on this hand' };
    recordHumanActionForBotLearning(match, playerId, normalizedAction);
    match.round.firstActionTaken = true;
    hand.actionCount = (hand.actionCount || 0) + 1;
    hand.surrendered = true;
    hand.locked = true;
    if (isRealMatch(match) && !isBotPlayer(playerId)) {
      const user = getUserById(playerId);
      if (user) recordSkillEvent(user, 'surrender_used', 1);
    }
    progressTurn(match, playerId);
    return { ok: true };
  }

  if (normalizedAction === 'double') {
    if ((hand.doubleCount || 0) >= RULES.MAX_DOUBLES_PER_HAND) {
      return { error: 'Hand cannot double down' };
    }
    if (!canDoubleActionForHand(hand, RULES.MAX_DOUBLES_PER_HAND)) {
      return { error: 'Double is only available as the first action on a hand (or as a re-double chain)' };
    }
    recordHumanActionForBotLearning(match, playerId, normalizedAction);
    match.round.firstActionTaken = true;
    hand.actionCount = (hand.actionCount || 0) + 1;
    const delta = hand.bet;
    if (!canAffordIncrement(match, playerId, delta)) return { error: 'Insufficient chips to double' };
    if (hand.bet * 2 > betLimits.max) return { error: `Bet cannot exceed ${betLimits.max} for this table` };
    const targetHandIndex = Math.min(opponentState.activeHandIndex, opponentState.hands.length - 1);
    hand.bet *= 2;
    hand.doubleCount = (hand.doubleCount || 0) + 1;
    hand.doubled = hand.doubleCount > 0;
    if (isRealMatch(match) && !isBotPlayer(playerId)) {
      const user = getUserById(playerId);
      if (user) {
        user.stats.doublesAttempted = (user.stats.doublesAttempted || 0) + 1;
        recordChallengeEvent(user, 'double', 1);
        recordSkillEvent(user, 'double', 1);
      }
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
    if (total === 21) {
      hand.locked = true;
      hand.stood = true;
    }

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

  if (normalizedAction === 'split') {
    if (isTenTenPair(hand) && !isSplitTensEventActive(match)) return { error: 'Split tens event inactive' };
    if (!canSplit(hand, state, match)) return { error: 'Split unavailable' };
    if (!canAffordIncrement(match, playerId, hand.bet)) return { error: 'Insufficient chips to split' };
    recordHumanActionForBotLearning(match, playerId, normalizedAction);
    const targetHandIndex = Math.min(opponentState.activeHandIndex, opponentState.hands.length - 1);
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
        recordSkillEvent(user, 'split', 1);
        db.write();
        emitUserUpdate(playerId);
      }
    }

    const delta = hand.bet;
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
      // Matching pressure should not consume the responder's hand action.
      // This keeps split/double eligibility independent from opponent actions.
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

function isBetNegotiationEnabled(match) {
  if (!match) return false;
  if (match.phase !== PHASES.ROUND_INIT) return false;
  if (isBotMatch(match)) return false;
  if (normalizeQuickPlayBucket(match.quickPlayBucket)) return false;
  if (Math.max(0, Math.floor(Number(match.rankedBet) || 0)) > 0) return false;
  if (String(match.matchType || '').toLowerCase() === 'ranked') return false;
  if (String(match.matchType || '').toLowerCase() === 'friend_challenge') return false;
  return true;
}

function ensureBetNegotiation(match) {
  if (!isBetNegotiationEnabled(match)) return null;
  const [p1, p2] = match.playerIds;
  const limits = getMatchBetLimits(match);
  const defaultFor = (pid) => {
    const chips = Math.max(limits.min, getParticipantChips(match, pid));
    const preferred = match.betSettings?.selectedBetById?.[pid] || match.round.baseBet || BASE_BET;
    const selected = clampBet(preferred, chips, limits);
    return Math.max(limits.min, selected);
  };
  if (!match.round.betNegotiation || typeof match.round.betNegotiation !== 'object') {
    const p1Proposal = defaultFor(p1);
    const p2Proposal = defaultFor(p2);
    const agreed = p1Proposal === p2Proposal ? p1Proposal : null;
    match.round.betNegotiation = {
      status: agreed ? 'agreed' : 'negotiating',
      proposalsByPlayerId: {
        [p1]: p1Proposal,
        [p2]: p2Proposal
      },
      acceptedByPlayerId: {
        [p1]: false,
        [p2]: false
      },
      agreedAmount: agreed,
      lastActionBy: null,
      lastActionType: 'init',
      lastActionAt: nowIso()
    };
    match.round.baseBet = agreed || p1Proposal;
  } else {
    const negotiation = match.round.betNegotiation;
    if (!negotiation.proposalsByPlayerId || typeof negotiation.proposalsByPlayerId !== 'object') {
      negotiation.proposalsByPlayerId = {};
    }
    if (!negotiation.acceptedByPlayerId || typeof negotiation.acceptedByPlayerId !== 'object') {
      negotiation.acceptedByPlayerId = {};
    }
    if (!Number.isFinite(Number(negotiation.proposalsByPlayerId[p1]))) {
      negotiation.proposalsByPlayerId[p1] = defaultFor(p1);
    }
    if (!Number.isFinite(Number(negotiation.proposalsByPlayerId[p2]))) {
      negotiation.proposalsByPlayerId[p2] = defaultFor(p2);
    }
    if (typeof negotiation.acceptedByPlayerId[p1] !== 'boolean') negotiation.acceptedByPlayerId[p1] = false;
    if (typeof negotiation.acceptedByPlayerId[p2] !== 'boolean') negotiation.acceptedByPlayerId[p2] = false;
    if (typeof negotiation.lastActionType !== 'string') negotiation.lastActionType = 'sync';
    if (typeof negotiation.lastActionBy !== 'string') negotiation.lastActionBy = null;
    if (!negotiation.lastActionAt) negotiation.lastActionAt = nowIso();
    const p1Proposal = Number(negotiation.proposalsByPlayerId[p1]);
    const p2Proposal = Number(negotiation.proposalsByPlayerId[p2]);
    if (p1Proposal === p2Proposal) {
      negotiation.agreedAmount = p1Proposal;
      if (negotiation.status !== 'locked') negotiation.status = 'agreed';
      match.round.baseBet = p1Proposal;
    } else if (negotiation.status !== 'locked') {
      negotiation.status = 'negotiating';
      negotiation.agreedAmount = null;
    }
  }
  return match.round.betNegotiation;
}

function applyBetNegotiationResponse(match, playerId, action, amount = null) {
  if (!match.playerIds.includes(playerId)) return { error: 'Unauthorized' };
  if (match.phase !== PHASES.ROUND_INIT) return { error: 'Bet negotiation is only available before dealing' };
  if (!isBetNegotiationEnabled(match)) return { error: 'Bet negotiation is unavailable for this match' };
  const negotiation = ensureBetNegotiation(match);
  const opponentId = nextPlayerId(match, playerId);
  if (!negotiation) return { error: 'Bet negotiation is unavailable for this match' };

  if (action === 'agree') {
    return confirmBaseBet(match, playerId);
  }
  if (!['raise', 'lower'].includes(action)) {
    return { error: 'Invalid bet response action' };
  }

  const betLimits = getMatchBetLimits(match);
  const bankroll = getParticipantChips(match, playerId);
  if (bankroll < betLimits.min) return { error: `Need at least ${betLimits.min} chips to negotiate` };

  const baseline =
    Number(negotiation.proposalsByPlayerId?.[opponentId]) ||
    Number(negotiation.agreedAmount) ||
    Number(match.round.baseBet) ||
    betLimits.min;
  const selected = clampBet(amount, bankroll || betLimits.min, betLimits);
  if (selected < betLimits.min) return { error: `Bet must be at least ${betLimits.min}` };
  if (action === 'raise' && selected <= baseline) return { error: `Raise must be above ${baseline}` };
  if (action === 'lower' && selected >= baseline) return { error: `Lower must be below ${baseline}` };
  return applyBaseBetSelection(match, playerId, selected, { responseAction: action });
}

function resetBetNegotiation(match, playerId) {
  if (!match.playerIds.includes(playerId)) return { error: 'Unauthorized' };
  if (match.phase !== PHASES.ROUND_INIT) return { error: 'Bet reset is only available before dealing' };
  if (!isBetNegotiationEnabled(match)) return { error: 'Bet reset unavailable for this match' };
  const negotiation = ensureBetNegotiation(match);
  if (!negotiation) return { error: 'Bet reset unavailable for this match' };
  const [p1, p2] = match.playerIds;
  const limits = getMatchBetLimits(match);
  const resetFor = (pid) => {
    const chips = Math.max(limits.min, getParticipantChips(match, pid));
    const preferred = match.betSettings?.selectedBetById?.[pid] || BASE_BET;
    return Math.max(limits.min, clampBet(preferred, chips, limits));
  };
  const p1Amount = resetFor(p1);
  const p2Amount = resetFor(p2);
  negotiation.proposalsByPlayerId[p1] = p1Amount;
  negotiation.proposalsByPlayerId[p2] = p2Amount;
  negotiation.acceptedByPlayerId[p1] = false;
  negotiation.acceptedByPlayerId[p2] = false;
  negotiation.agreedAmount = p1Amount === p2Amount ? p1Amount : null;
  negotiation.status = negotiation.agreedAmount ? 'agreed' : 'negotiating';
  negotiation.lastActionBy = playerId;
  negotiation.lastActionType = 'reset';
  negotiation.lastActionAt = nowIso();
  match.round.baseBet = negotiation.agreedAmount || p1Amount;
  match.round.betConfirmedByPlayer[p1] = false;
  match.round.betConfirmedByPlayer[p2] = false;
  return { ok: true, negotiation };
}

function applyBaseBetSelection(match, playerId, amount, options = {}) {
  if (!match.playerIds.includes(playerId)) return { error: 'Unauthorized' };
  if (match.phase !== PHASES.ROUND_INIT) return { error: 'Bet can only be changed before cards are dealt' };
  if (normalizeQuickPlayBucket(match.quickPlayBucket)) return { error: 'Quick Play bucket bet is fixed for this match' };
  if (Math.max(0, Math.floor(Number(match.rankedBet) || 0)) > 0) return { error: 'Ranked bet is fixed for this match' };
  const negotiationEnabled = isBetNegotiationEnabled(match);
  if (!negotiationEnabled && playerId !== match.betControllerId) return { error: 'Only the round owner can set base bet' };
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

  if (negotiationEnabled) {
    const negotiation = ensureBetNegotiation(match);
    const opponentId = nextPlayerId(match, playerId);
    negotiation.proposalsByPlayerId[playerId] = selected;
    negotiation.acceptedByPlayerId[playerId] = true;
    negotiation.acceptedByPlayerId[opponentId] = false;
    match.round.betConfirmedByPlayer[playerId] = false;
    match.round.betConfirmedByPlayer[opponentId] = false;
    negotiation.lastActionBy = playerId;
    negotiation.lastActionType = options.responseAction || 'propose';
    negotiation.lastActionAt = nowIso();
    if (Number(negotiation.proposalsByPlayerId[playerId]) === Number(negotiation.proposalsByPlayerId[opponentId])) {
      negotiation.agreedAmount = selected;
      negotiation.status = 'agreed';
    } else {
      negotiation.agreedAmount = null;
      negotiation.status = 'negotiating';
    }
  }
  match.round.baseBet = selected;
  scheduleBotBetConfirm(match);

  return { ok: true, selected };
}

function confirmBaseBet(match, playerId) {
  if (!match.playerIds.includes(playerId)) return { error: 'Unauthorized' };
  if (match.phase !== PHASES.ROUND_INIT) return { error: 'Bet confirmation is only available before dealing' };
  if (match.round.betConfirmedByPlayer?.[playerId]) return { ok: true };
  const negotiationEnabled = isBetNegotiationEnabled(match);

  if (negotiationEnabled) {
    const negotiation = ensureBetNegotiation(match);
    const opponentId = nextPlayerId(match, playerId);
    const opponentProposal = Number(negotiation?.proposalsByPlayerId?.[opponentId]);
    const agreed = Number(negotiation?.agreedAmount);
    const betLimits = getMatchBetLimits(match);
    const targetRaw = Number.isFinite(agreed)
      ? agreed
      : Number.isFinite(opponentProposal)
        ? opponentProposal
        : Number(match.round.baseBet) || betLimits.min;
    const target = clampBet(targetRaw, Math.max(getParticipantChips(match, playerId), betLimits.min), betLimits);
    if (target < betLimits.min) return { error: `Bet must be at least ${betLimits.min}` };
    negotiation.proposalsByPlayerId[playerId] = target;
    negotiation.acceptedByPlayerId[playerId] = true;
    negotiation.lastActionBy = playerId;
    negotiation.lastActionType = 'agree';
    negotiation.lastActionAt = nowIso();
    match.round.betConfirmedByPlayer[playerId] = true;

    const p1 = match.playerIds[0];
    const p2 = match.playerIds[1];
    const p1Proposal = Number(negotiation.proposalsByPlayerId[p1]);
    const p2Proposal = Number(negotiation.proposalsByPlayerId[p2]);
    const otherId = nextPlayerId(match, playerId);
    const bothConfirmed = Boolean(match.round.betConfirmedByPlayer[playerId] && match.round.betConfirmedByPlayer[otherId]);
    if (bothConfirmed && Number.isFinite(p1Proposal) && Number.isFinite(p2Proposal) && p1Proposal === p2Proposal) {
      negotiation.agreedAmount = p1Proposal;
      negotiation.status = 'locked';
      match.round.baseBet = p1Proposal;
      maybeBeginRoundAfterBetConfirm(match);
      return { ok: true, agreed: true, amount: p1Proposal };
    }
    negotiation.status = p1Proposal === p2Proposal ? 'agreed' : 'negotiating';
    return { ok: true, waiting: true };
  }

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
    removeFromRankedQueue(pid);
  }
  const stakeType = resolveStakeType(lobby.stakeType);
  const requestedMode = String(options.matchMode || '').trim().toLowerCase();
  const mode = requestedMode === 'practice' || requestedMode === 'real'
    ? requestedMode
    : resolveMatchMode(stakeType);
  const economyMode = resolveEconomyMode(options.economyMode, mode);
  const isPractice = mode === 'practice' || economyMode === 'no_delta';
  const quickPlayBucket = normalizeQuickPlayBucket(options.quickPlayBucket || lobby.quickPlayBucket);
  const rankedBet = Math.max(0, Math.floor(Number(options.rankedBet || lobby.rankedBet) || 0));
  const highRoller = String(options.matchType || lobby.matchType || '').toUpperCase() === 'HIGH_ROLLER' || lobby.type === 'high_roller';
  const rankedMode = String(options.matchType || lobby.matchType || lobby.type || '').toUpperCase() === 'RANKED' || lobby.type === 'ranked';
  const resolvedMatchType = highRoller ? 'HIGH_ROLLER' : rankedMode ? 'RANKED' : (lobby.type || 'lobby');
  const botId = playerIds.find((pid) => isBotPlayer(pid));
  const botDifficulty = botId ? options.botDifficultyById?.[botId] || 'normal' : null;
  const betLimits = quickPlayBucket
    ? { min: quickPlayBucket, max: quickPlayBucket }
    : rankedBet
      ? { min: rankedBet, max: rankedBet }
    : highRoller
      ? { min: HIGH_ROLLER_MIN_BET, max: MAX_BET_HARD_CAP }
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
    matchType: resolvedMatchType,
    highRoller,
    quickPlayBucket: quickPlayBucket || null,
    rankedBet: rankedBet || null,
    rankedSeriesId: options.rankedSeriesId || lobby.rankedSeriesId || null,
    participants: buildParticipants(playerIds, options.botDifficultyById || {}),
    playerIds,
    startingPlayerIndex: 0,
    roundNumber: 0,
    stakeType,
    mode,
    economyMode,
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

function leaveMatchByForfeit(match, leaverId, { source = 'manual' } = {}) {
  if (!match || !match.playerIds.includes(leaverId)) return { ok: false, error: 'Match not found or unauthorized' };
  const opponentId = match.playerIds.find((id) => id !== leaverId);
  const botMatch = isBotMatch(match);
  const rankedMatch = String(match.matchType || '').toUpperCase() === 'RANKED';
  const postSettlementPhase = match.phase === PHASES.REVEAL || match.phase === PHASES.RESULT || match.phase === PHASES.NEXT_ROUND;
  const settledNoPenaltyExit = !rankedMatch && (postSettlementPhase || Boolean(match.round?.resultFinalized || match.resultFinalized));
  logMatchEconomyEvent('LEAVE_REQUEST', {
    matchId: match.id,
    leaverId,
    source,
    matchType: match.matchType || null,
    phase: match.phase,
    isSettled: settledNoPenaltyExit
  });
  if (settledNoPenaltyExit) {
    const leaverReason = botMatch ? 'Match settled. Returned to lobby.' : 'Match settled. Returned to menu.';
    const opponentReason = 'Opponent left after settlement.';
    emitToUser(leaverId, 'match:ended', { reason: leaverReason, seriesResult: null });
    if (opponentId) emitToUser(opponentId, 'match:ended', { reason: opponentReason, seriesResult: null });
    cleanupMatch(match);
    logMatchEconomyEvent('LEAVE_SETTLED_NO_PENALTY', {
      matchId: match.id,
      leaverId,
      chargedAmount: 0
    });
    return { ok: true, forfeited: false, charged: false, chargedAmount: 0, preRoundExit: false, settledExit: true };
  }
  const leaverUser = !isBotPlayer(leaverId) ? getUserById(leaverId) : null;
  const opponentUser = !isBotPlayer(opponentId) ? getUserById(opponentId) : null;
  const roundStarted = Boolean(match.round?.stakesCommitted);
  const preRoundBotExit = botMatch && (!roundStarted || match.phase === PHASES.ROUND_INIT || isRoundSettledPhase(match));
  let forfeited = false;
  let charged = false;
  let chargedAmount = 0;
  let wrote = false;
  let rankedSeriesResultByPlayer = null;

  if (leaverUser && isRealMatch(match)) {
    const modeLabel = matchHistoryModeLabel(match);
    if (botMatch) {
      if (!preRoundBotExit) {
        forfeited = true;
        const committed = Math.max(0, Math.floor(Number(match.round?.stakesCommittedByPlayer?.[leaverId]) || 0));
        const leaverExposure = Math.max(
          0,
          Math.floor(
            Number((match.round?.players?.[leaverId]?.hands || []).reduce((sum, hand) => sum + (hand.bet || 0), 0)) || 0
          )
        );
        const expectedLoss = Math.max(committed, leaverExposure || committed || Math.floor(Number(match.round?.baseBet) || BASE_BET));
        const additionalLoss = Math.max(0, Math.min(Math.floor(Number(leaverUser.chips) || 0), expectedLoss - committed));
        if (additionalLoss > 0) {
          leaverUser.chips = Math.max(0, leaverUser.chips - additionalLoss);
          invalidateLeaderboardCache();
          charged = true;
          chargedAmount = additionalLoss;
          wrote = true;
        }
        const totalLoss = Math.max(0, committed + additionalLoss);
        appendBetHistory(leaverUser, {
          mode: modeLabel,
          bet: totalLoss,
          result: 'Forfeit',
          net: -totalLoss,
          notes: 'left bot match'
        });
        emitUserUpdate(leaverUser.id);
        wrote = true;
      }
    } else if (opponentUser) {
      forfeited = true;
      const leaverExposure = (match.round?.players?.[leaverId]?.hands || []).reduce((sum, hand) => sum + (hand.bet || 0), 0);
      const opponentExposure = opponentId
        ? (match.round?.players?.[opponentId]?.hands || []).reduce((sum, hand) => sum + (hand.bet || 0), 0)
        : 0;
      const exposure = leaverExposure + opponentExposure;
      const award = calculateForfeitLossAmount(leaverUser.chips, exposure, match.round?.baseBet || BASE_BET);
      charged = award > 0;
      chargedAmount = award;
      leaverUser.chips = Math.max(0, leaverUser.chips - award);
      opponentUser.chips += award;
      invalidateLeaderboardCache();
      appendBetHistory(leaverUser, { mode: modeLabel, bet: award, result: 'Forfeit', net: -award, notes: 'left match' });
      appendBetHistory(opponentUser, { mode: modeLabel, bet: award, result: 'Win', net: award, notes: 'opponent left' });
      emitUserUpdate(leaverUser.id);
      emitUserUpdate(opponentUser.id);
      wrote = true;
    }
  }

  if (!botMatch && opponentId && rankedMatch && leaverUser && opponentUser) {
    ensureRankedSeriesForMatch(match, { createIfMissing: true });
    const netByPlayer = {
      [leaverId]: -Math.max(0, Math.floor(Number(chargedAmount) || 0)),
      [opponentId]: Math.max(0, Math.floor(Number(chargedAmount) || 0))
    };
    const seriesUpdate = recordRankedSeriesGame(match, {
      winnerId: opponentId,
      loserId: leaverId,
      netByPlayer,
      forfeit: true
    });
    const finalizedSeries = finalizeRankedSeriesByForfeit(match, opponentId, leaverId) || seriesUpdate?.series;
    finalizeRankedSeriesElo(finalizedSeries, {
      winnerId: opponentId,
      loserId: leaverId,
      reason: source === 'disconnect_timeout' ? 'disconnect_forfeit' : 'forfeit'
    });
    rankedSeriesResultByPlayer = {
      [leaverId]: rankedSeriesResultForUser(finalizedSeries, leaverId),
      [opponentId]: rankedSeriesResultForUser(finalizedSeries, opponentId)
    };
    emitUserUpdate(leaverUser.id);
    emitUserUpdate(opponentUser.id);
    wrote = true;
  }

  if (wrote) db.write();

  let leaverReason = botMatch
    ? preRoundBotExit
      ? 'You left before the next round started.'
      : 'You forfeited the match.'
    : 'You forfeited the match.';
  let opponentReason = botMatch
    ? preRoundBotExit
      ? 'Opponent left before the next round started.'
      : 'Opponent left — you win by forfeit.'
    : 'Opponent forfeited the match.';
  if (rankedMatch) {
    leaverReason = source === 'disconnect_timeout'
      ? 'Disconnected too long — ranked series forfeited.'
      : 'You forfeited the ranked series.';
    opponentReason = source === 'disconnect_timeout'
      ? 'Opponent disconnected too long and forfeited the ranked series.'
      : 'Opponent forfeited the ranked series.';
  }

  emitToUser(leaverId, 'match:ended', { reason: leaverReason, seriesResult: rankedSeriesResultByPlayer?.[leaverId] || null });
  if (opponentId) emitToUser(opponentId, 'match:ended', { reason: opponentReason, seriesResult: rankedSeriesResultByPlayer?.[opponentId] || null });
  cleanupMatch(match);
  logMatchEconomyEvent('LEAVE_FORFEIT_APPLIED', {
    matchId: match.id,
    leaverId,
    source,
    charged,
    chargedAmount,
    forfeited
  });
  return { ok: true, forfeited, charged, chargedAmount, preRoundExit: preRoundBotExit };
}

function buildNewUser(username) {
  const cleanUsername = String(username || '').trim();
  const usernameKey = normalizeUsername(cleanUsername);
  const pin = String(randomIntInclusive(1000, 9999));
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
    skillChallenges: [],
    skillChallengeState: { expiresAt: null, history: [] },
    xp: 0,
    lastLevelRewarded: 0,
    pvpWins: 0,
    pvpLosses: 0,
    currentMatchWinStreak: 0,
    bestMatchWinStreak: 0,
    dailyWinStreakCount: 0,
    lastDailyWinDate: null,
    highRollerMatchCount: 0,
    rankedElo: RANKED_BASE_ELO,
    rankedWins: 0,
    rankedLosses: 0,
    rankedGames: 0,
    rankedLossStreak: 0,
    activeRankedSeriesId: null,
    rankTier: rankedTierFromElo(RANKED_BASE_ELO).key,
    peakRankedElo: RANKED_BASE_ELO,
    peakRankTier: rankedTierFromElo(RANKED_BASE_ELO).key,
    unlockedTitles: [],
    selectedTitle: '',
    selectedBorderId: 'NONE',
    selectedDeckSkin: 'CLASSIC',
    customStatText: '',
    favoriteStatKey: FAVORITE_STAT_DEFAULT,
    headToHead: {}
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
  invalidateLeaderboardCache();
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
  invalidateLeaderboardCache();
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
  const nowMs = Date.now();
  const eventsSnapshot = eventsSnapshotPayload(nowMs);
  const friendsData = buildFriendsPayload(req.user);
  const refreshed = refreshChallengesForUser(req.user);
  const refreshedSkills = ensureSkillChallenges(req.user);
  const unlockedTitlesChanged = recomputeTitleUnlocks(req.user);
  const borderStateChanged = ensureProfileBorderState(req.user);
  const notificationsState = notificationsForUser(req.user, { limit: 30, markSeen: false });
  if (refreshed || refreshedSkills || notificationsState.changed || unlockedTitlesChanged || borderStateChanged) await db.write();
  const freeClaim = freeClaimMeta(req.user);
  const challengeData = buildChallengePayload(req.user);
  const rankedOverview = rankedOverviewForUser(req.user);
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
    notifications: notificationsState.notifications,
    freeClaimed: !freeClaim.available,
    freeClaimAvailable: freeClaim.available,
    freeClaimNextAt: freeClaim.nextAt,
    streakCount: freeClaim.streakCount,
    nextStreakReward: freeClaim.nextReward,
    overallPvpRecord: {
      wins: Math.max(0, Math.floor(Number(req.user?.pvpWins) || 0)),
      losses: Math.max(0, Math.floor(Number(req.user?.pvpLosses) || 0))
    },
    rankedQueue: rankedQueueStatus(req.user.id),
    rankedOverview,
    serverNow: eventsSnapshot.serverNow,
    activeEvents: eventsSnapshot.activeEvents,
    challenges: challengeData.challenges,
    challengeList: challengeData.challengeList,
    challengeResets: challengeData.challengeResets,
    hourlyResetAt: challengeData.hourlyResetAt,
    dailyResetAt: challengeData.dailyResetAt,
    weeklyResetAt: challengeData.weeklyResetAt,
    skillResetAt: challengeData.skillResetAt,
    nextDailyResetAt: challengeData.nextDailyResetAt,
    nextWeeklyResetAt: challengeData.nextWeeklyResetAt,
    nextSkillResetAt: challengeData.nextSkillResetAt,
    skillPoolSize: challengeData.skillPoolSize,
    activeSkillCount: challengeData.activeSkillCount
  });
});

app.get('/api/leaderboard/chips', authMiddleware, async (req, res) => {
  const limit = Math.max(1, Math.min(LEADERBOARD_MAX_LIMIT, Math.floor(Number(req.query?.limit) || LEADERBOARD_DEFAULT_LIMIT)));
  const offset = Math.max(0, Math.floor(Number(req.query?.offset) || 0));

  if (hasDatabaseUrl()) {
    try {
      const pool = await getPool();
      const listResult = await pool.query(
        `
          SELECT id, username, bankroll AS chips, rank
          FROM (
            SELECT id, username, bankroll,
              RANK() OVER (ORDER BY bankroll DESC, username ASC) AS rank
            FROM users
          ) ranked
          ORDER BY rank ASC
          LIMIT $1 OFFSET $2
        `,
        [limit, offset]
      );
      const meResult = await pool.query(
        `
          SELECT rank
          FROM (
            SELECT id, RANK() OVER (ORDER BY bankroll DESC, username ASC) AS rank
            FROM users
          ) ranked
          WHERE id = $1
          LIMIT 1
        `,
        [req.user.id]
      );
      const rows = listResult.rows.map((row) => {
        const local = getUserById(row.id);
        const levelMeta = levelProgressFromXp(local?.xp || 0);
        const dynamicBadge = leaderboardBadgeForRank(row.rank);
        const ranked = rankedMetaForUser(local);
        return {
          userId: row.id,
          username: row.username,
          chips: Math.max(0, Math.floor(Number(row.chips) || 0)),
          rank: Math.max(1, Math.floor(Number(row.rank) || 1)),
          level: levelMeta.level,
          rankTier: ranked.tierLabel,
          rankTierKey: ranked.tierKey,
          rankedElo: ranked.elo,
          selectedTitle: selectedTitleLabelForUser(local),
          dynamicBadge
        };
      });
      return res.json({
        rows,
        currentUserRank: meResult.rows[0]?.rank ? Math.max(1, Math.floor(Number(meResult.rows[0].rank) || 1)) : null,
        totalUsers: db.data.users.length
      });
    } catch {
      // Fallback to in-memory snapshot if SQL ranking is temporarily unavailable.
    }
  }

  const payload = leaderboardPayload(req.user.id, limit, offset);
  return res.json(payload);
});

app.get('/api/users/:userRef/public-stats', authMiddleware, async (req, res) => {
  const ref = String(req.params?.userRef || '').trim();
  if (!ref) return res.status(400).json({ error: 'User reference required' });
  const user = getUserById(ref) || getUserByUsername(ref);
  if (!user) return res.status(404).json({ error: 'Player not found' });
  const payload = publicStatsPayloadForUser(user);
  if (!payload) return res.status(404).json({ error: 'Player not found' });
  return res.json({ player: payload });
});

app.put('/api/profile', authMiddleware, async (req, res) => {
  const { avatar, avatarStyle, avatarSeed } = req.body || {};
  if (typeof avatarStyle === 'string') req.user.avatarStyle = avatarStyle.slice(0, 80);
  if (typeof avatarSeed === 'string') req.user.avatarSeed = avatarSeed.slice(0, 120);
  if (typeof avatar === 'string' && !avatarStyle && !avatarSeed) req.user.avatar = avatar.slice(0, 300);
  req.user.avatar = avatarUrl(req.user.avatarStyle, req.user.avatarSeed || req.user.username);
  await db.write();
  return res.json({ user: sanitizeSelfUser(req.user) });
});

app.get('/api/profile', authMiddleware, (req, res) => {
  return res.json({ user: sanitizeSelfUser(req.user) });
});

app.patch('/api/profile/custom-stat', authMiddleware, async (req, res) => {
  const customStatText = sanitizeCustomStatText(req.body?.customStatText || req.body?.text || '');
  req.user.customStatText = customStatText;
  invalidateLeaderboardCache();
  await db.write();
  return res.json({ ok: true, customStatText, user: sanitizeSelfUser(req.user) });
});

app.patch('/api/profile/favorite-stat', authMiddleware, async (req, res) => {
  const favoriteStatKey = sanitizeFavoriteStatKey(req.body?.favoriteStatKey || req.body?.key || '');
  req.user.favoriteStatKey = favoriteStatKey;
  invalidateLeaderboardCache();
  await db.write();
  return res.json({ ok: true, favoriteStatKey, user: sanitizeSelfUser(req.user) });
});

app.patch('/api/profile/title', authMiddleware, async (req, res) => {
  recomputeTitleUnlocks(req.user);
  const requested = normalizeTitleKey(req.body?.selectedTitle || req.body?.titleKey || '');
  if (!requested) {
    req.user.selectedTitle = '';
    invalidateLeaderboardCache();
    await db.write();
    return res.json({ ok: true, selectedTitle: '', user: sanitizeSelfUser(req.user) });
  }
  if (!req.user.unlockedTitles.includes(requested)) {
    return res.status(403).json({ error: 'Title is not unlocked yet' });
  }
  req.user.selectedTitle = requested;
  invalidateLeaderboardCache();
  await db.write();
  return res.json({ ok: true, selectedTitle: requested, user: sanitizeSelfUser(req.user) });
});

app.patch('/api/profile/border', authMiddleware, async (req, res) => {
  ensureProfileBorderState(req.user);
  const requestedRaw = String(req.body?.selectedBorderId || req.body?.borderId || '').trim().toUpperCase();
  if (requestedRaw && !PROFILE_BORDER_DEFS_BY_ID[requestedRaw]) {
    return res.status(400).json({ error: 'Unknown profile border' });
  }
  const requested = requestedRaw || 'NONE';
  const borderDef = PROFILE_BORDER_DEFS_BY_ID[requested];
  const userLevel = levelFromXp(req.user?.xp || 0);
  if (borderDef && userLevel < Math.max(1, Math.floor(Number(borderDef.minLevelRequired) || 1))) {
    return res.status(403).json({ error: `Border unlocks at level ${borderDef.minLevelRequired}` });
  }
  req.user.selectedBorderId = requested;
  ensureProfileBorderState(req.user);
  await db.write();
  return res.json({ ok: true, selectedBorderId: req.user.selectedBorderId, user: sanitizeSelfUser(req.user) });
});

app.patch('/api/profile/deck-skin', authMiddleware, async (req, res) => {
  const requestedRaw = String(req.body?.selectedDeckSkin || req.body?.deckSkin || '').trim().toUpperCase();
  if (requestedRaw && !DECK_SKIN_DEFS_BY_ID[requestedRaw]) {
    return res.status(400).json({ error: 'Unknown deck skin' });
  }
  const requested = normalizeDeckSkinId(requestedRaw || 'CLASSIC');
  if (!deckSkinUnlockedForUser(req.user, requested)) {
    const hint = String(DECK_SKIN_DEFS_BY_ID[requested]?.unlockHint || '').trim();
    if (hint) {
      return res.status(403).json({ error: `Deck skin locked. ${hint}` });
    }
    const required = Math.max(1, Math.floor(Number(DECK_SKIN_DEFS_BY_ID[requested]?.minLevelRequired) || 1));
    return res.status(403).json({ error: `Deck skin unlocks at level ${required}` });
  }
  req.user.selectedDeckSkin = requested;
  await db.write();
  return res.json({ ok: true, selectedDeckSkin: req.user.selectedDeckSkin, user: sanitizeSelfUser(req.user) });
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
  const seenAt = nowIso();
  user.notifications = user.notifications.map((notification) => {
    if (!notification || notification.requestId !== requestId) return notification;
    if (notification.seenAt) {
      return { ...notification, read: true };
    }
    return {
      ...notification,
      read: true,
      seenAt,
      seen_at: seenAt,
      expiresAt: notificationExpiryIso(seenAt),
      expires_at: notificationExpiryIso(seenAt)
    };
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

app.get('/api/friends/headtohead', authMiddleware, (req, res) => {
  const payload = {};
  for (const friendId of req.user.friends || []) {
    const row = req.user?.headToHead?.[friendId] || {};
    payload[friendId] = {
      wins: Math.max(0, Math.floor(Number(row.wins) || 0)),
      losses: Math.max(0, Math.floor(Number(row.losses) || 0))
    };
  }
  return res.json({
    headToHead: payload,
    overallPvpRecord: {
      wins: Math.max(0, Math.floor(Number(req.user?.pvpWins) || 0)),
      losses: Math.max(0, Math.floor(Number(req.user?.pvpLosses) || 0))
    }
  });
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
  const challengeMessage = String(challenge.message || '').trim();
  pushNotification(target.id, {
    type: 'friend_challenge',
    message: `${req.user.username} challenged you for ${finalBet} chips.${challengeMessage ? ` "${challengeMessage}"` : ''}`,
    action: { label: 'Open', kind: 'friend_challenge', data: { challengeId: challenge.id, fromUserId: req.user.id, message: challengeMessage } }
  });
  emitToUser(target.id, 'friend:challenge', {
    challengeId: challenge.id,
    fromUserId: req.user.id,
    fromUsername: req.user.username,
    bet: finalBet,
    message: challengeMessage
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
  const requestedMatchType = String(req.body?.matchType || '').toUpperCase();
  const highRoller = requestedMatchType === 'HIGH_ROLLER';
  const hasStakeTypeInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'stakeType');
  const resolvedStakeType = highRoller ? 'REAL' : (hasStakeTypeInput ? resolveStakeType(req.body?.stakeType) : 'FAKE');
  if (highRoller && !hasHighRollerAccess(req.user)) {
    return res.status(400).json({ error: highRollerUnlockError() });
  }
  const existing = db.data.lobbies.find(
    (l) =>
      l.ownerId === req.user.id &&
      l.status === 'waiting' &&
      l.type !== 'bot' &&
      (highRoller ? String(l.matchType || '').toUpperCase() === 'HIGH_ROLLER' : String(l.matchType || '').toUpperCase() !== 'HIGH_ROLLER')
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
    type: highRoller ? 'high_roller' : 'lobby',
    matchType: highRoller ? 'HIGH_ROLLER' : 'lobby',
    highRoller,
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
  if (String(lobby.matchType || '').toUpperCase() === 'HIGH_ROLLER' && !hasHighRollerAccess(req.user)) {
    return res.status(400).json({ error: highRollerUnlockError() });
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
  const requestedMatchType = String(req.body?.matchType || '').toUpperCase();
  const highRoller = requestedMatchType === 'HIGH_ROLLER';
  const hasStakeTypeInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'stakeType');
  const resolvedStakeType = highRoller ? 'REAL' : (hasStakeTypeInput ? resolveStakeType(req.body?.stakeType) : 'FAKE');
  if (highRoller && !hasHighRollerAccess(req.user)) {
    return res.status(400).json({ error: highRollerUnlockError() });
  }
  const friend = getUserByUsername(username || '');
  if (!friend) return res.status(404).json({ error: 'Friend not found' });
  if (!req.user.friends.includes(friend.id)) return res.status(403).json({ error: 'Can only invite friends' });

  let lobby = db.data.lobbies.find(
    (l) =>
      l.ownerId === req.user.id &&
      l.status === 'waiting' &&
      l.type !== 'bot' &&
      (highRoller ? String(l.matchType || '').toUpperCase() === 'HIGH_ROLLER' : String(l.matchType || '').toUpperCase() !== 'HIGH_ROLLER')
  );
  if (!lobby) {
    lobby = {
      id: normalizeLobbyCode(nanoid(8)),
      ownerId: req.user.id,
      opponentId: null,
      status: 'waiting',
      type: highRoller ? 'high_roller' : 'lobby',
      matchType: highRoller ? 'HIGH_ROLLER' : 'lobby',
      highRoller,
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
  const requestedMatchMode = String(req.body?.matchMode || '').trim().toLowerCase();
  const requestedEconomyMode = String(req.body?.economyMode || '').trim().toLowerCase();
  const highRoller = String(req.body?.matchType || '').toUpperCase() === 'HIGH_ROLLER' || Boolean(req.body?.highRoller);
  if (!['easy', 'medium', 'normal'].includes(difficulty)) {
    return res.status(400).json({ error: 'Difficulty must be easy, medium, or normal' });
  }
  const practiceRequested = !highRoller && (requestedMatchMode === 'practice' || requestedEconomyMode === 'no_delta');
  const resolvedStake = highRoller ? 'REAL' : (practiceRequested ? 'FAKE' : resolveStakeType(stakeType));
  const resolvedMatchMode = practiceRequested ? 'practice' : resolveMatchMode(resolvedStake);
  const resolvedEconomyMode = practiceRequested ? 'no_delta' : 'standard';
  if (highRoller && !hasHighRollerAccess(req.user)) {
    return res.status(400).json({ error: highRollerUnlockError() });
  }

  const botId = `bot:${difficulty}:${nanoid(6)}`;
  const lobby = {
    id: normalizeLobbyCode(nanoid(8)),
    ownerId: req.user.id,
    opponentId: botId,
    status: 'full',
    type: 'bot',
    matchType: highRoller ? 'HIGH_ROLLER' : 'bot',
    highRoller,
    stakeType: resolvedStake,
    botDifficulty: difficulty,
    createdAt: nowIso()
  };
  db.data.lobbies.push(lobby);
  await db.write();

  const match = createMatch(lobby, {
    botDifficultyById: { [botId]: difficulty },
    matchMode: resolvedMatchMode,
    economyMode: resolvedEconomyMode
  });
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
  const outcome = leaveMatchByForfeit(match, req.user.id) || {};
  return res.json({
    ok: true,
    forfeited: Boolean(outcome.forfeited),
    charged: Boolean(outcome.charged),
    chargedAmount: Math.max(0, Math.floor(Number(outcome.chargedAmount) || 0)),
    preRoundExit: Boolean(outcome.preRoundExit),
    settledExit: Boolean(outcome.settledExit)
  });
}

app.post('/api/matches/:matchId/forfeit', authMiddleware, async (req, res) => {
  return handleBotForfeit(req, res);
});

app.post('/api/match/:matchId/forfeit', authMiddleware, async (req, res) => {
  return handleBotForfeit(req, res);
});

app.post('/api/matchmaking/join', authMiddleware, async (req, res) => {
  if (isUserInActiveMatch(req.user.id)) {
    logQuickPlayQueueEvent('QUEUE_REJECTED', {
      userId: req.user.id,
      reason: 'already_in_active_match'
    });
    return res.status(409).json({ error: 'Already in an active match' });
  }
  const bucket = normalizeQuickPlayBucket(req.body?.bucket);
  if (!bucket) {
    logQuickPlayQueueEvent('QUEUE_REJECTED', {
      userId: req.user.id,
      reason: 'invalid_bucket',
      bucket: req.body?.bucket
    });
    return res.status(400).json({ error: `Invalid quick play bucket. Choose one of: ${QUICK_PLAY_BUCKETS.join(', ')}` });
  }
  if (!canJoinQuickPlayBucket(req.user, bucket)) {
    logQuickPlayQueueEvent('QUEUE_REJECTED', {
      userId: req.user.id,
      reason: 'insufficient_chips',
      bucket
    });
    return res.status(400).json({ error: `Need at least ${bucket} chips to enter this Quick Play bucket` });
  }
  removeFromRankedQueue(req.user.id);
  const queued = enqueueQuickPlayUser(req.user.id, bucket);
  if (queued.error) {
    logQuickPlayQueueEvent('QUEUE_REJECTED', {
      userId: req.user.id,
      reason: queued.error,
      bucket
    });
    return res.status(400).json({ error: queued.error });
  }
  logQuickPlayQueueEvent('QUEUE_ACCEPTED', {
    userId: req.user.id,
    bucket,
    queuedAt: queued.queuedAt || null
  });
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
  logQuickPlayQueueEvent('QUEUE_CANCELLED', {
    userId: req.user.id,
    removed,
    reason: 'api_cancel'
  });
  return res.json({ status: 'cancelled', removed });
});

app.get('/api/matchmaking/status', authMiddleware, async (req, res) => {
  const activeMatch = activeMatchForUser(req.user.id);
  if (activeMatch) {
    const quickPlayBucket = normalizeQuickPlayBucket(activeMatch.quickPlayBucket);
    if (quickPlayBucket) {
      return res.json(buildQuickPlayFoundPayload(activeMatch, req.user.id, quickPlayBucket));
    }
  }
  const status = quickPlayQueueStatus(req.user.id);
  return res.json({
    status: status.bucket ? 'searching' : 'idle',
    bucket: status.bucket,
    fixedBet: status.bucket,
    queuePosition: status.queuePosition,
    queuedAt: status.queuedAt
  });
});

app.post('/api/ranked/join', authMiddleware, async (req, res) => {
  const wantsContinueSeries = Boolean(req.body?.continueSeries);
  if (wantsContinueSeries) {
    const activeSeriesSummary = rankedSeriesSummaryForUser(activeRankedSeriesForUser(req.user.id), req.user.id);
    if (!activeSeriesSummary || !activeSeriesSummary.inProgress || !activeSeriesSummary.canContinue) {
      logRankedQueueEvent('QUEUE_REJECTED', {
        userId: req.user.id,
        reason: 'continue_requested_without_active_series'
      });
      return res.status(409).json({
        error: 'No active ranked series found to continue. Refreshing ranked state.',
        overview: rankedOverviewForUser(req.user)
      });
    }
  }
  if (isUserInActiveMatch(req.user.id)) {
    logRankedQueueEvent('QUEUE_REJECTED', {
      userId: req.user.id,
      reason: 'already_in_active_match_on_join'
    });
    return res.status(409).json({ error: 'Already in an active match' });
  }
  const enqueued = enqueueRankedUser(req.user, req.body?.bet);
  if (enqueued.error) return res.status(400).json({ error: enqueued.error, overview: rankedOverviewForUser(req.user) });
  const matched = await processRankedQueue();
  const found = matched.find((entry) => entry.userId === req.user.id);
  if (found) return res.json(found.payload);
  const status = rankedQueueStatus(req.user.id);
  return res.json({
    status: 'searching',
    bet: enqueued.entry.fixedBet,
    fixedBet: enqueued.entry.fixedBet,
    elo: enqueued.entry.elo,
    rankTier: rankedTierFromElo(enqueued.entry.elo).label,
    queuedAt: status.queuedAt
  });
});

app.post('/api/ranked/cancel', authMiddleware, async (req, res) => {
  const removed = removeFromRankedQueue(req.user.id);
  logRankedQueueEvent('QUEUE_CANCEL_ENDPOINT', {
    userId: req.user.id,
    removed
  });
  return res.json({ status: 'cancelled', removed });
});

app.get('/api/ranked/status', authMiddleware, async (req, res) => {
  compactRankedQueue();
  const status = rankedQueueStatus(req.user.id);
  if (status.status !== 'searching') {
    return res.json({ status: 'idle' });
  }
  return res.json(status);
});

app.get('/api/ranked/overview', authMiddleware, async (req, res) => {
  compactRankedQueue();
  const overview = rankedOverviewForUser(req.user);
  return res.json({ overview });
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
  invalidateLeaderboardCache();
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

app.get('/api/notifications', authMiddleware, async (req, res) => {
  const payload = notificationsForUser(req.user, { limit: 50, markSeen: false });
  if (payload.changed) await db.write();
  return res.json({ notifications: payload.notifications });
});

app.post('/api/notifications/seen', authMiddleware, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  const payload = notificationsForUser(req.user, { limit: 50, markSeen: true, ids });
  if (payload.changed) await db.write();
  return res.json({
    notifications: payload.notifications,
    marked: payload.markedCount || 0
  });
});

app.post('/api/notifications/clear', authMiddleware, async (req, res) => {
  req.user.notifications = [];
  await db.write();
  return res.json({ notifications: [] });
});

app.post('/api/notifications/dismiss', authMiddleware, async (req, res) => {
  const { id } = req.body || {};
  req.user.notifications = (req.user.notifications || []).filter((n) => n.id !== id);
  cleanupExpiredNotificationsForUser(req.user, { remove: true });
  await db.write();
  return res.json({ notifications: (req.user.notifications || []).slice(0, 50) });
});

app.post('/api/daily-claim', authMiddleware, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const last = req.user.lastDailyClaimAt ? req.user.lastDailyClaimAt.slice(0, 10) : null;
  if (last === today) return res.status(409).json({ error: 'Already claimed today' });

  req.user.lastDailyClaimAt = nowIso();
  req.user.chips += DAILY_REWARD;
  invalidateLeaderboardCache();
  await db.write();

  return res.json({ reward: DAILY_REWARD, chips: req.user.chips, claimedAt: req.user.lastDailyClaimAt });
});

app.get('/api/challenges', authMiddleware, async (req, res) => {
  const nowMs = Date.now();
  const eventsSnapshot = eventsSnapshotPayload(nowMs);
  const refreshed = refreshChallengesForUser(req.user);
  const refreshedSkills = ensureSkillChallenges(req.user);
  if (refreshed || refreshedSkills) await db.write();
  const payload = buildChallengePayload(req.user);
  return res.json({
    serverNow: eventsSnapshot.serverNow,
    activeEvents: eventsSnapshot.activeEvents,
    challenges: payload.challenges,
    challengeList: payload.challengeList,
    challengeResets: payload.challengeResets,
    hourlyResetAt: payload.hourlyResetAt,
    dailyResetAt: payload.dailyResetAt,
    weeklyResetAt: payload.weeklyResetAt,
    skillResetAt: payload.skillResetAt,
    nextDailyResetAt: payload.nextDailyResetAt,
    nextWeeklyResetAt: payload.nextWeeklyResetAt,
    nextSkillResetAt: payload.nextSkillResetAt,
    skillPoolSize: payload.skillPoolSize,
    activeSkillCount: payload.activeSkillCount
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
  awardXp(req.user, XP_REWARDS.challenge);
  recomputeTitleUnlocks(req.user);
  ensureProfileBorderState(req.user);
  await db.write();
  emitUserUpdate(req.user.id);
  return res.json({
    id: targetId,
    reward: target.rewardChips,
    chips: bankroll,
    bankroll,
    claimedAt: target.claimedAt,
    xp: Math.max(0, Math.floor(Number(req.user.xp) || 0)),
    level: levelFromXp(req.user.xp || 0)
  });
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
  setPresence(userId, true);
  emitPresenceSnapshotToUser(userId);
  emitPresenceUpdateFor(userId);
  // Initial notification sync on connect.
  const notificationPayload = notificationsForUser(socket.user, { limit: 30, markSeen: false });
  if (notificationPayload.changed) db.write();
  socket.emit('notify:list', { notifications: notificationPayload.notifications });

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
      logQuickPlayQueueEvent('QUEUE_REJECTED', { userId, reason: 'already_in_active_match_socket' });
      socket.emit('matchmaking:error', { error: 'Already in an active match' });
      return;
    }
    const bucket = normalizeQuickPlayBucket(payload.bucket);
    if (!bucket) {
      logQuickPlayQueueEvent('QUEUE_REJECTED', { userId, reason: 'invalid_bucket_socket', bucket: payload.bucket });
      socket.emit('matchmaking:error', { error: `Invalid quick play bucket. Choose one of: ${QUICK_PLAY_BUCKETS.join(', ')}` });
      return;
    }
    const user = getUserById(userId);
    if (!canJoinQuickPlayBucket(user, bucket)) {
      logQuickPlayQueueEvent('QUEUE_REJECTED', { userId, reason: 'insufficient_chips_socket', bucket });
      socket.emit('matchmaking:error', { error: `Need at least ${bucket} chips to enter this Quick Play bucket` });
      return;
    }
    removeFromRankedQueue(userId);
    const queued = enqueueQuickPlayUser(userId, bucket);
    if (queued.error) {
      logQuickPlayQueueEvent('QUEUE_REJECTED', { userId, reason: queued.error, bucket });
      socket.emit('matchmaking:error', { error: queued.error });
      return;
    }
    logQuickPlayQueueEvent('QUEUE_ACCEPTED', { userId, bucket, queuedAt: queued.queuedAt || null, source: 'socket' });
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
    logQuickPlayQueueEvent('QUEUE_CANCELLED', { userId, removed, reason: 'socket_cancel' });
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

  socket.on('match:respondBet', (payload = {}) => {
    const { matchId, action, amount } = payload;
    const match = matches.get(matchId);
    if (!match) return socket.emit('match:error', { error: 'Match not found' });
    const result = applyBetNegotiationResponse(match, userId, String(action || '').toLowerCase(), amount);
    if (result.error) return socket.emit('match:error', result);
    pushMatchState(match);
    db.write();
    scheduleBotBetConfirm(match);
    return null;
  });

  socket.on('match:resetBetNegotiation', (payload = {}) => {
    const { matchId } = payload;
    const match = matches.get(matchId);
    if (!match) return socket.emit('match:error', { error: 'Match not found' });
    const result = resetBetNegotiation(match, userId);
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

  socket.on('match:doubleOrNothing', (payload = {}) => {
    const { matchId } = payload;
    const match = matches.get(matchId);
    if (!match) return socket.emit('match:error', { error: 'Match not found' });
    if (!match.playerIds.includes(userId)) return socket.emit('match:error', { error: 'Unauthorized' });
    const result = applyDoubleOrNothingChoice(match, userId);
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
    const primarySession = activeSessions.get(userId) === socket.id;
    if (primarySession) {
      activeSessions.delete(userId);
      removeFromQuickPlayQueue(userId);
      removeFromRankedQueue(userId);
      setPresence(userId, false);
      emitPresenceUpdateFor(userId);
    }

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
        leaveMatchByForfeit(match, userId, { source: 'disconnect_timeout' });
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
  isSixSevenStartingHand,
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
  ensureSkillChallenges,
  recordChallengeEventForMatch,
  buildChallengePayload,
  isRealMatch,
  countWinningSplitHandsForPlayer,
  calculateForfeitLossAmount,
  leaveMatchByForfeit,
  rankedTierFromElo,
  rankedBetRangeForElo,
  rankedKFactorForElo,
  rankedEloDeltaForGame,
  rankedSeriesDeltaForOutcome,
  finalizeRankedSeriesElo,
  streakCountsAfterOutcome,
  matchWinStreakAfterOutcome,
  cleanupExpiredNotificationsForUser,
  markNotificationsSeenForUser,
  notificationsForUser,
  levelRewardForLevel,
  profileBorderUnlockIdsForLevel,
  nextProfileBorderUnlockLevel,
  recomputeTitleUnlocks,
  sampleBlackjackFrequency,
  getBotObservation,
  chooseBotActionFromObservation
};

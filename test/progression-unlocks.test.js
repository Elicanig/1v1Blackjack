import test from 'node:test';
import assert from 'node:assert/strict';
import {
  profileBorderUnlockIdsForLevel,
  nextProfileBorderUnlockLevel,
  recomputeTitleUnlocks
} from '../server.js';

function xpForLevel(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  const completedLevels = safeLevel - 1;
  return (completedLevels * 100) + ((completedLevels * (completedLevels - 1)) / 2) * 25;
}

test('profile borders unlock every 10 levels and expose next unlock level', () => {
  assert.deepEqual(profileBorderUnlockIdsForLevel(1), ['NONE']);
  assert.equal(profileBorderUnlockIdsForLevel(10).includes('BRONZE_TRIM'), true);
  assert.equal(profileBorderUnlockIdsForLevel(20).includes('GILDED_EDGE'), true);
  assert.equal(profileBorderUnlockIdsForLevel(30).includes('EMERALD_CIRCUIT'), true);
  assert.equal(nextProfileBorderUnlockLevel(1), 10);
  assert.equal(nextProfileBorderUnlockLevel(10), 20);
  assert.equal(nextProfileBorderUnlockLevel(100), null);
});

test('title recompute unlocks level and gameplay milestones but not manual titles', () => {
  const user = {
    xp: xpForLevel(55),
    stats: {
      blackjacks: 80,
      splitsAttempted: 30,
      doublesAttempted: 30,
      pushes: 45,
      matchesPlayed: 120,
      handsWon: 180,
      totalChipsWon: 25_000,
      sixSevenDealt: 22
    },
    rankedWins: 35,
    pvpWins: 40,
    highRollerMatchCount: 12,
    dailyWinStreakCount: 8,
    bestMatchWinStreak: 16,
    unlockedTitles: [],
    selectedTitle: 'GIANT_KILLER'
  };

  const changed = recomputeTitleUnlocks(user);
  assert.equal(changed, true);
  assert.equal(user.unlockedTitles.includes('RISING_STAR'), true);
  assert.equal(user.unlockedTitles.includes('TABLE_REGULAR'), true);
  assert.equal(user.unlockedTitles.includes('VETERAN'), true);
  assert.equal(user.unlockedTitles.includes('HIGH_ROLLER'), true);
  assert.equal(user.unlockedTitles.includes('STREAK_LORD'), true);
  assert.equal(user.unlockedTitles.includes('RANKED_CONQUEROR'), true);
  assert.equal(user.unlockedTitles.includes('GIANT_KILLER'), false);
  assert.equal(user.selectedTitle, '');
});

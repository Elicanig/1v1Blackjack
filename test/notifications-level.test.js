import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupExpiredNotificationsForUser,
  markNotificationsSeenForUser,
  notificationsForUser,
  levelRewardForLevel
} from '../server.js';

test('notifications stay until first seen', () => {
  const user = {
    notifications: [
      {
        id: 'n-unseen',
        message: 'Unseen',
        read: false,
        createdAt: '2026-02-16T00:00:00.000Z',
        seenAt: null,
        expiresAt: null
      }
    ]
  };
  const cleaned = cleanupExpiredNotificationsForUser(user, { nowTs: Date.parse('2026-02-20T00:00:00.000Z') });
  assert.equal(cleaned.changed, false);
  assert.equal(user.notifications.length, 1);
});

test('mark seen sets seenAt/expiresAt once and does not extend', () => {
  const user = {
    notifications: [
      {
        id: 'n-seen-lock',
        message: 'Seen once',
        read: false,
        seenAt: null,
        expiresAt: null
      }
    ]
  };
  const first = markNotificationsSeenForUser(user, ['n-seen-lock']);
  assert.equal(first.markedCount, 1);
  assert.equal(user.notifications[0].read, true);
  assert.ok(user.notifications[0].seenAt);
  assert.ok(user.notifications[0].expiresAt);
  const seenAt = user.notifications[0].seenAt;
  const expiresAt = user.notifications[0].expiresAt;

  const second = markNotificationsSeenForUser(user, ['n-seen-lock']);
  assert.equal(second.markedCount, 0);
  assert.equal(user.notifications[0].seenAt, seenAt);
  assert.equal(user.notifications[0].expiresAt, expiresAt);
});

test('expired notifications are removed on fetch/cleanup', () => {
  const user = {
    notifications: [
      {
        id: 'n-expired',
        message: 'Expired',
        read: true,
        seenAt: '2026-02-16T00:00:00.000Z',
        expiresAt: '2026-02-16T01:00:00.000Z'
      },
      {
        id: 'n-active',
        message: 'Active',
        read: true,
        seenAt: '2026-02-16T00:00:00.000Z',
        expiresAt: '2026-02-16T03:00:00.000Z'
      }
    ]
  };

  const oldNow = Date.now;
  Date.now = () => Date.parse('2026-02-16T00:30:00.000Z');
  try {
    const beforeExpiry = notificationsForUser(user, { limit: 50, markSeen: false });
    assert.equal(beforeExpiry.notifications.length, 2);

    Date.now = () => Date.parse('2026-02-16T01:30:00.000Z');
    const afterExpiry = notificationsForUser(user, { limit: 50, markSeen: false });
    assert.equal(afterExpiry.notifications.length, 1);
    assert.equal(afterExpiry.notifications[0].id, 'n-active');
    assert.equal(afterExpiry.changed, true);
  } finally {
    Date.now = oldNow;
  }
});

test('level reward scales every 5 levels', () => {
  assert.equal(levelRewardForLevel(1), 0);
  assert.equal(levelRewardForLevel(5), 350);
  assert.equal(levelRewardForLevel(10), 500);
  assert.equal(levelRewardForLevel(20), 800);
});

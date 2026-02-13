import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASES, serializeMatchFor, newHand } from '../server.js';
import { formatHandTotalLine } from '../public/match-view-model.js';

function card(rank, suit = 'H') {
  return { rank, suit, id: `${rank}${suit}` };
}

function buildMatch(phase = PHASES.ACTION_TURN) {
  return {
    id: 'm-visibility',
    lobbyId: null,
    participants: {},
    roundNumber: 1,
    phase,
    playerIds: ['p1', 'p2'],
    connections: {
      p1: { connected: true, graceEndsAt: null },
      p2: { connected: true, graceEndsAt: null }
    },
    round: {
      firstActionPlayerId: 'p1',
      turnPlayerId: 'p1',
      pendingPressure: null,
      deck: [],
      players: {
        p1: {
          activeHandIndex: 0,
          hands: [newHand([card('9'), card('7')], [false, true], 5, 0)]
        },
        p2: {
          activeHandIndex: 0,
          hands: [newHand([card('10'), card('6')], [false, true], 5, 0)]
        }
      }
    }
  };
}

test('payload does not expose opponent true total while hidden', () => {
  const match = buildMatch(PHASES.ACTION_TURN);
  const payload = serializeMatchFor(match, 'p1');
  const oppHand = payload.players.p2.hands[0];

  assert.equal(oppHand.totalKnown, false);
  assert.equal(oppHand.visibleTotal, 10);
  assert.equal(oppHand.total, null);
  assert.equal(oppHand.cards[1].hidden, true);
});

test('payload reveals opponent total at round resolve', () => {
  const match = buildMatch(PHASES.ROUND_RESOLVE);
  const payload = serializeMatchFor(match, 'p1');
  const oppHand = payload.players.p2.hands[0];

  assert.equal(oppHand.totalKnown, true);
  assert.equal(oppHand.total, 16);
  assert.equal(oppHand.cards[1].hidden, undefined);
});

test('UI formatter shows visible total while hidden and true total when known', () => {
  assert.equal(formatHandTotalLine({ totalKnown: false, visibleTotal: 10, total: null }), 'Showing: 10');
  assert.equal(formatHandTotalLine({ totalKnown: true, total: 16, visibleTotal: 10 }), 'Total: 16');
  assert.equal(formatHandTotalLine({ totalKnown: false, visibleTotal: null, total: null }), 'Total: ?');
});

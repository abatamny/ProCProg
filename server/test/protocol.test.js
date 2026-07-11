import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIENT_EVENT_TYPES,
  parseClientEvent,
  serializeEvent,
  SERVER_EVENT_TYPES,
} from '../src/realtime/protocol.js';

test('Section 10 event names and {type, payload} envelope are exact', () => {
  assert.deepEqual(SERVER_EVENT_TYPES, [
    'place_state',
    'presence_update',
    'knock_new',
    'moment_new',
    'moment_presence',
    'memory_engraved',
    'reaction_new',
    'content_removed',
    'relocated',
  ]);
  assert.deepEqual(CLIENT_EVENT_TYPES, [
    'auth',
    'location',
    'away',
    'back',
    'knock_send',
    'moment_presence_confirm',
    'reaction',
  ]);

  assert.equal(
    serializeEvent('presence_update', { placeId: 'technion', count: 2 }),
    '{"type":"presence_update","payload":{"placeId":"technion","count":2}}',
  );
  assert.deepEqual(
    parseClientEvent(Buffer.from('{"type":"away","payload":{}}')),
    { type: 'away', payload: {} },
  );
  assert.equal(parseClientEvent(Buffer.from('{"type":"unknown","payload":{}}')), null);
  assert.equal(parseClientEvent(Buffer.from('{"type":"away"}')), null);
  assert.equal(parseClientEvent(Buffer.from('not-json')), null);
});

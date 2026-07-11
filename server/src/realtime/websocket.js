import WebSocket, { WebSocketServer } from 'ws';
import { KnockError } from '../services/knocks.js';
import { createPresenceManager } from './presence.js';
import { parseClientEvent, serializeEvent, SERVER_EVENT_TYPES } from './protocol.js';

const serverEventSet = new Set(SERVER_EVENT_TYPES);

export function createRealtimeServer({ app, db, config, sessions, places, knocks, moments = null }) {
  const wss = new WebSocketServer({
    noServer: true,
    clientTracking: true,
    perMessageDeflate: false,
    maxPayload: 64 * 1_024,
  });
  const connections = new Map();
  const dirtyPlaces = new Set();
  let closePromise = null;

  function send(socket, type, payload) {
    if (!serverEventSet.has(type)) throw new Error(`Unknown server event: ${type}`);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(serializeEvent(type, payload));
    }
  }

  function broadcastToPlace(placeId, type, payload) {
    for (const [socket, state] of connections) {
      if (state.session && state.subscriptions.has(placeId)) {
        send(socket, type, payload);
      }
    }
  }

  const presence = createPresenceManager({
    db,
    places,
    graceMs: config.presenceGraceMs,
    onPlacesChanged(placeIds) {
      for (const placeId of placeIds) dirtyPlaces.add(placeId);
    },
  });

  function flushPresence() {
    if (dirtyPlaces.size === 0) return;
    const placeIds = [...dirtyPlaces];
    dirtyPlaces.clear();
    for (const placeId of placeIds) {
      broadcastToPlace(placeId, 'presence_update', {
        placeId,
        count: presence.getCount(placeId),
      });
    }
  }

  const presenceInterval = setInterval(flushPresence, config.presenceBroadcastMs);
  presenceInterval.unref?.();

  // Stage 5: "I was here" growth events, batched like presence_update.
  const dirtyMomentPresence = new Map();
  function flushMomentPresence() {
    if (dirtyMomentPresence.size === 0) return;
    const entries = [...dirtyMomentPresence.values()];
    dirtyMomentPresence.clear();
    for (const entry of entries) {
      broadcastToPlace(entry.placeId, 'moment_presence', {
        digId: entry.id,
        presenceCount: entry.presenceCount,
      });
    }
  }
  const momentPresenceInterval = setInterval(flushMomentPresence, config.presenceBroadcastMs);
  momentPresenceInterval.unref?.();

  function placeStatePayload(placeId) {
    return places.buildPlaceState(placeId, (id) => presence.getCount(id));
  }

  function subscribeSocket(socket, placeId) {
    const state = connections.get(socket);
    state.placeId = placeId;
    state.subscriptions = new Set(places.getAncestorIds(placeId));
  }

  function userConnections(phoneNumber) {
    return [...connections.entries()].filter(([, state]) => (
      state.session?.phoneNumber === phoneNumber
    ));
  }

  function subscribeUser(phoneNumber, placeId) {
    for (const [socket] of userConnections(phoneNumber)) subscribeSocket(socket, placeId);
  }

  function sendUserPlaceState(phoneNumber, placeId) {
    for (const [socket] of userConnections(phoneNumber)) {
      send(socket, 'place_state', placeStatePayload(placeId));
    }
  }

  function enterUserPlace(socket, placeId) {
    const state = connections.get(socket);
    presence.enter(socket, state.session.phoneNumber, placeId);
    subscribeUser(state.session.phoneNumber, placeId);
    sendUserPlaceState(state.session.phoneNumber, placeId);
  }

  function sendUnmappedState(socket, reason) {
    const state = connections.get(socket);
    state.placeId = null;
    state.subscriptions.clear();
    send(socket, 'place_state', {
      place: null,
      layerStack: [],
      presenceCount: 0,
      knocks: [],
      liveMoments: [],
      memories: [],
      nextMemoriesCursor: null,
      reason,
    });
  }

  function authenticate(socket, token) {
    const state = connections.get(socket);
    if (state.session) {
      if (state.session.token !== token) socket.close(1008, 'session already authenticated');
      else if (state.placeId) send(socket, 'place_state', placeStatePayload(state.placeId));
      return;
    }

    const session = sessions.validate(token);
    if (!session) {
      socket.close(1008, 'invalid session');
      return;
    }

    state.session = session;
    clearTimeout(state.authTimer);
    state.authTimer = null;
    presence.attach(socket, session.phoneNumber);
    const forcePlaceId = places.getForcePlaceId();
    if (forcePlaceId) {
      enterUserPlace(socket, forcePlaceId);
      return;
    }

    const canonicalPlaceId = presence.getUserState(session.phoneNumber)?.placeId;
    if (canonicalPlaceId) {
      subscribeSocket(socket, canonicalPlaceId);
      send(socket, 'place_state', placeStatePayload(canonicalPlaceId));
    } else {
      sendUnmappedState(socket, 'location_required');
    }
  }

  function handleEvent(socket, event) {
    const state = connections.get(socket);
    if (event.type === 'auth') {
      authenticate(socket, event.payload.token);
      return;
    }

    if (!state.session) {
      socket.close(1008, 'auth must be first');
      return;
    }

    switch (event.type) {
      case 'location': {
        if (places.getForcePlaceId()) return;
        const { lat, lng } = event.payload;
        if (typeof lat !== 'number' || typeof lng !== 'number'
          || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const place = places.resolve(lat, lng);
        if (place) {
          for (const [, userState] of userConnections(state.session.phoneNumber)) {
            userState.lastLocation = { lat, lng };
          }
          enterUserPlace(socket, place.id);
        } else if (!presence.getUserState(state.session.phoneNumber)?.placeId) {
          sendUnmappedState(socket, 'outside');
        }
        break;
      }
      case 'away':
        state.visible = false;
        presence.setVisible(socket, false);
        break;
      case 'back':
        state.visible = true;
        presence.setVisible(socket, true);
        break;
      case 'knock_send': {
        const { targetPlaceId, type, content, mediaId } = event.payload;
        if (typeof targetPlaceId !== 'string' || !state.subscriptions.has(targetPlaceId)) return;
        try {
          const knock = knocks.create({
            placeId: targetPlaceId,
            phoneNumber: state.session.phoneNumber,
            type,
            content,
            mediaId,
          });
          if (knock.type === 'text' || (knock.thumbUrl && knock.mediumUrl)) {
            broadcastToPlace(targetPlaceId, 'knock_new', { knock });
          }
        } catch (error) {
          if (!(error instanceof KnockError)) throw error;
        }
        break;
      }
      case 'moment_presence_confirm': {
        if (!moments) break;
        const { digId } = event.payload;
        if (typeof digId !== 'string') break;
        const target = moments.getMoment(digId);
        // Presence-gated: only users inside the moment's place may confirm.
        if (!target || !state.subscriptions.has(target.placeId)) break;
        try {
          const { moment } = moments.confirmPresence({
            momentId: digId,
            phoneNumber: state.session.phoneNumber,
          });
          dirtyMomentPresence.set(moment.id, {
            id: moment.id,
            placeId: moment.placeId,
            presenceCount: moment.presenceCount,
          });
        } catch (error) {
          if (error.name !== 'MomentError') throw error;
        }
        break;
      }
      // Stones & Words are on the SPEC §12 CUT list; reaction stays a no-op.
      case 'reaction':
        break;
      default:
        break;
    }
  }

  wss.on('connection', (socket) => {
    const authTimer = setTimeout(() => {
      const state = connections.get(socket);
      if (state && !state.session) socket.close(1008, 'auth timeout');
    }, config.wsAuthTimeoutMs);
    authTimer.unref?.();
    connections.set(socket, {
      session: null,
      placeId: null,
      subscriptions: new Set(),
      visible: true,
      awaitingPong: false,
      missedPongs: 0,
      lastLocation: null,
      authTimer,
    });

    socket.on('pong', () => {
      const state = connections.get(socket);
      if (!state) return;
      state.awaitingPong = false;
      state.missedPongs = 0;
    });

    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const event = parseClientEvent(data);
      if (event) handleEvent(socket, event);
    });

    socket.on('close', () => {
      const state = connections.get(socket);
      if (state?.authTimer) clearTimeout(state.authTimer);
      presence.detach(socket);
      connections.delete(socket);
    });

    socket.on('error', () => {
      // The close handler owns presence cleanup and the 60-second grace timer.
    });
  });

  const heartbeatInterval = setInterval(() => {
    for (const socket of wss.clients) {
      const state = connections.get(socket);
      if (!state || socket.readyState !== WebSocket.OPEN) continue;

      if (state.awaitingPong) {
        state.missedPongs += 1;
        if (state.missedPongs >= config.heartbeatMissLimit) {
          socket.terminate();
          continue;
        }
      }

      state.awaitingPong = true;
      socket.ping();
    }
  }, config.heartbeatIntervalMs);
  heartbeatInterval.unref?.();

  function onUpgrade(request, socket, head) {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit('connection', webSocket, request);
    });
  }

  app.server.on('upgrade', onUpgrade);

  return {
    presence,

    broadcastToPlace,

    relocateAll(placeId) {
      if (placeId) {
        const place = places.getPlace(placeId);
        presence.relocateAll(placeId);
        for (const [socket, state] of connections) {
          if (!state.session) continue;
          subscribeSocket(socket, placeId);
          send(socket, 'relocated', { place });
          send(socket, 'place_state', placeStatePayload(placeId));
        }
        return;
      }

      const handledUsers = new Set();
      for (const [socket, state] of connections) {
        if (!state.session || handledUsers.has(state.session.phoneNumber)) continue;
        const phoneNumber = state.session.phoneNumber;
        handledUsers.add(phoneNumber);
        const group = userConnections(phoneNumber);
        const cached = group.map(([, candidate]) => candidate.lastLocation).find(Boolean);
        const resolved = cached ? places.resolve(cached.lat, cached.lng) : null;

        if (resolved) {
          presence.enter(socket, phoneNumber, resolved.id);
          subscribeUser(phoneNumber, resolved.id);
        } else {
          presence.leaveNow(phoneNumber);
          for (const [, userState] of group) {
            userState.placeId = null;
            userState.subscriptions.clear();
          }
        }

        for (const [userSocket] of group) {
          send(userSocket, 'relocated', { place: resolved });
          if (resolved) send(userSocket, 'place_state', placeStatePayload(resolved.id));
        }
      }
    },

    flushPresence,

    // Stage 5: admin deletions must vanish from every open client.
    broadcastToAll(type, payload) {
      for (const [socket, state] of connections) {
        if (state.session) send(socket, type, payload);
      }
    },

    // Stage 5: after seed load/wipe, every client re-syncs from a fresh snapshot.
    refreshAll() {
      for (const [socket, state] of connections) {
        if (state.session && state.placeId) {
          send(socket, 'place_state', placeStatePayload(state.placeId));
        }
      }
    },

    close() {
      if (closePromise) return closePromise;
      clearInterval(presenceInterval);
      clearInterval(momentPresenceInterval);
      clearInterval(heartbeatInterval);
      app.server.off('upgrade', onUpgrade);
      for (const socket of wss.clients) socket.terminate();
      presence.shutdown();
      closePromise = new Promise((resolve, reject) => {
        wss.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      return closePromise;
    },
  };
}

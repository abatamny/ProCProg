import { randomUUID } from 'node:crypto';

export function createPresenceManager({ db, places, graceMs, onPlacesChanged }) {
  const users = new Map();
  const sockets = new Map();

  const insertRank = db.prepare(
    `INSERT INTO USER_PLACE_RANK
       (PLACE_ID, PHONE_NUMBER, RANK, VISIT_COUNT, IS_SEED)
     VALUES (?, ?, 'belong', 1, 0)
     ON CONFLICT(PLACE_ID, PHONE_NUMBER) DO UPDATE SET
       RANK = 'belong',
       VISIT_COUNT = USER_PLACE_RANK.VISIT_COUNT + 1,
       UPDATED_AT = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  );
  const insertVisit = db.prepare(
    `INSERT INTO USER_VISITS
       (ID, PLACE_ID, PHONE_NUMBER, ENTERED_AT, IS_SEED)
     VALUES (?, ?, ?, ?, 0)`,
  );
  const closeVisit = db.prepare(
    `UPDATE USER_VISITS
     SET LEFT_AT = ?
     WHERE ID = ? AND LEFT_AT IS NULL`,
  );
  const findOpenVisit = db.prepare(
    `SELECT ID, PLACE_ID
     FROM USER_VISITS
     WHERE PHONE_NUMBER = ? AND LEFT_AT IS NULL
     LIMIT 1`,
  );
  const ensureBelongRank = db.prepare(
    `INSERT INTO USER_PLACE_RANK
       (PLACE_ID, PHONE_NUMBER, RANK, VISIT_COUNT, IS_SEED)
     VALUES (?, ?, 'belong', 1, 0)
     ON CONFLICT(PLACE_ID, PHONE_NUMBER) DO UPDATE SET RANK = 'belong'`,
  );

  const openVisitTransaction = db.transaction((state) => {
    const existing = findOpenVisit.get(state.phoneNumber);
    if (existing?.PLACE_ID === state.placeId) {
      ensureBelongRank.run(state.placeId, state.phoneNumber);
      return existing.ID;
    }
    if (existing) closeVisit.run(new Date().toISOString(), existing.ID);

    const visitId = randomUUID();
    insertRank.run(state.placeId, state.phoneNumber);
    insertVisit.run(
      visitId,
      state.placeId,
      state.phoneNumber,
      new Date().toISOString(),
    );
    return visitId;
  });

  function changed(placeIds) {
    if (placeIds.length > 0) onPlacesChanged(new Set(placeIds));
  }

  function ensureUser(phoneNumber) {
    let state = users.get(phoneNumber);
    if (!state) {
      state = {
        phoneNumber,
        sockets: new Set(),
        placeId: null,
        ancestorIds: [],
        counted: false,
        graceTimer: null,
        visitId: null,
      };
      users.set(phoneNumber, state);
    }
    return state;
  }

  function hasVisibleSocket(state) {
    for (const socket of state.sockets) {
      if (sockets.get(socket)?.visible) return true;
    }
    return false;
  }

  function clearGrace(state) {
    if (!state.graceTimer) return;
    clearTimeout(state.graceTimer);
    state.graceTimer = null;
  }

  function closeOpenVisit(state) {
    if (!state.visitId) return;
    closeVisit.run(new Date().toISOString(), state.visitId);
    state.visitId = null;
  }

  function beginCount(state) {
    if (state.counted || !state.placeId) return;
    state.ancestorIds = places.getAncestorIds(state.placeId);
    state.visitId = openVisitTransaction(state);
    state.counted = true;
    changed(state.ancestorIds);
  }

  function endCount(state) {
    if (!state.counted) return;
    const oldAncestors = state.ancestorIds;
    closeOpenVisit(state);
    state.counted = false;
    changed(oldAncestors);
  }

  function cleanUnusedState(state) {
    if (state.sockets.size === 0 && !state.counted && !state.graceTimer) {
      users.delete(state.phoneNumber);
    }
  }

  function startGrace(state) {
    if (!state.counted || state.graceTimer || hasVisibleSocket(state)) return;
    state.graceTimer = setTimeout(() => {
      state.graceTimer = null;
      if (!hasVisibleSocket(state)) endCount(state);
      cleanUnusedState(state);
    }, graceMs);
    state.graceTimer.unref?.();
  }

  function setPlace(state, placeId, { preserveGrace = false } = {}) {
    if (state.placeId === placeId) return;

    const wasCounted = state.counted;
    const oldAncestors = state.ancestorIds;
    if (!preserveGrace) clearGrace(state);
    if (wasCounted) closeOpenVisit(state);

    state.placeId = placeId;
    state.ancestorIds = placeId ? places.getAncestorIds(placeId) : [];
    state.counted = false;

    if (placeId && (wasCounted || hasVisibleSocket(state))) {
      state.visitId = openVisitTransaction(state);
      state.counted = true;
    }

    changed([...oldAncestors, ...state.ancestorIds]);
  }

  return {
    attach(socket, phoneNumber) {
      const existing = sockets.get(socket);
      if (existing?.phoneNumber === phoneNumber) return ensureUser(phoneNumber);
      if (existing) this.detach(socket);

      const state = ensureUser(phoneNumber);
      sockets.set(socket, { phoneNumber, visible: true });
      state.sockets.add(socket);
      if (state.graceTimer) clearGrace(state);
      if (state.placeId && !state.counted) beginCount(state);
      return state;
    },

    enter(socket, phoneNumber, placeId) {
      const state = this.attach(socket, phoneNumber);
      const visible = hasVisibleSocket(state);
      setPlace(state, placeId, { preserveGrace: !visible && Boolean(state.graceTimer) });
      if (visible) {
        clearGrace(state);
        beginCount(state);
      } else {
        startGrace(state);
      }
      return state;
    },

    setVisible(socket, visible) {
      const socketState = sockets.get(socket);
      if (!socketState || socketState.visible === visible) return;
      socketState.visible = visible;
      const state = users.get(socketState.phoneNumber);
      if (!state) return;

      if (visible) {
        clearGrace(state);
        beginCount(state);
      } else {
        startGrace(state);
      }
    },

    detach(socket) {
      const socketState = sockets.get(socket);
      if (!socketState) return;
      sockets.delete(socket);
      const state = users.get(socketState.phoneNumber);
      if (!state) return;
      state.sockets.delete(socket);
      startGrace(state);
      cleanUnusedState(state);
    },

    relocateAll(placeId) {
      for (const state of users.values()) {
        if (state.sockets.size === 0) continue;
        const pendingGrace = Boolean(state.graceTimer);
        setPlace(state, placeId, { preserveGrace: pendingGrace });
      }
    },

    leaveNow(phoneNumber) {
      const state = users.get(phoneNumber);
      if (!state) return;
      clearGrace(state);
      setPlace(state, null);
      cleanUnusedState(state);
    },

    getCount(placeId) {
      let count = 0;
      for (const state of users.values()) {
        if (state.counted && state.ancestorIds.includes(placeId)) count += 1;
      }
      return count;
    },

    getUserState(phoneNumber) {
      return users.get(phoneNumber) ?? null;
    },

    shutdown({ closeVisits = false } = {}) {
      for (const state of users.values()) {
        clearGrace(state);
        if (closeVisits && state.counted) closeOpenVisit(state);
      }
      users.clear();
      sockets.clear();
    },
  };
}

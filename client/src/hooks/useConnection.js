import { useCallback, useEffect, useRef, useState } from 'react';
import { RECONNECT_DELAYS_MS } from '../config.js';

function socketUrl() {
  const url = new URL('/ws', window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

function isFrame(value) {
  return value && typeof value === 'object'
    && typeof value.type === 'string'
    && Object.hasOwn(value, 'payload');
}

/**
 * One socket per client (API_CONTRACT §4). Owns the place snapshot and folds
 * every live event into it; `place_state` always REPLACES the snapshot.
 * `onFrame` fires for content events so the shell can light nav dots.
 */
export function useConnection({ token, initialLocation, onFrame, onInvalidSession }) {
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState(token ? 'connecting' : 'idle');
  const [locationGate, setLocationGate] = useState(null);

  const snapshotRef = useRef(null);
  const socketRef = useRef(null);
  const sendRef = useRef(() => false);
  const lastLocationRef = useRef(initialLocation ?? null);
  const onFrameRef = useRef(onFrame);
  const onInvalidSessionRef = useRef(onInvalidSession);
  const convergeTimers = useRef(new Set());

  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);
  useEffect(() => { onInvalidSessionRef.current = onInvalidSession; }, [onInvalidSession]);
  useEffect(() => {
    if (initialLocation) lastLocationRef.current = initialLocation;
  }, [initialLocation]);

  useEffect(() => {
    if (!token) {
      snapshotRef.current = null;
      setSnapshot(null);
      setStatus('idle');
      setLocationGate(null);
      return undefined;
    }

    let disposed = false;
    let generationCounter = 0;
    let reconnectAttempt = 0;
    let reconnectTimer = null;

    function commit(next) {
      snapshotRef.current = next;
      setSnapshot(next);
    }

    function patch(producer) {
      const current = snapshotRef.current;
      if (!current) return;
      commit(producer(current));
    }

    function send(type, payload = {}) {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify({ type, payload }));
      return true;
    }
    sendRef.current = send;

    function applyFrame(frame) {
      reconnectAttempt = 0;
      setStatus('connected');
      const { type, payload } = frame;

      if (type === 'place_state') {
        if (payload?.place) {
          commit(payload);
          setLocationGate(null);
        } else {
          commit(null);
          if (payload?.reason === 'outside') setLocationGate('outside');
          else if (lastLocationRef.current) setLocationGate('locating');
          else setLocationGate('location_required');
        }
        return;
      }

      if (type === 'presence_update' && payload) {
        patch((current) => ({
          ...current,
          layerStack: current.layerStack.map((layer) => (
            layer.id === payload.placeId ? { ...layer, presenceCount: payload.count } : layer
          )),
          presenceCount: current.place.id === payload.placeId
            ? payload.count
            : current.presenceCount,
        }));
        return;
      }

      if (type === 'relocated') {
        if (payload?.place === null) {
          commit(null);
          if (lastLocationRef.current) {
            setLocationGate('locating');
            send('location', lastLocationRef.current);
          } else {
            setLocationGate('location_required');
          }
        } else {
          setLocationGate(null);
        }
        return;
      }

      if (type === 'knock_new' && payload?.knock) {
        patch((current) => {
          const inScope = current.layerStack.some((layer) => layer.id === payload.knock.placeId);
          const duplicate = current.knocks.some((knock) => knock.id === payload.knock.id);
          if (!inScope || duplicate) return current;
          return { ...current, knocks: [...current.knocks, payload.knock] };
        });
      }

      if (type === 'moment_new' && payload?.dig) {
        patch((current) => {
          if (payload.dig.placeId !== current.place.id) return current;
          if (current.liveMoments.some((moment) => moment.id === payload.dig.id)) return current;
          return { ...current, liveMoments: [payload.dig, ...current.liveMoments] };
        });
      }

      if (type === 'moment_presence' && payload?.digId) {
        patch((current) => ({
          ...current,
          liveMoments: current.liveMoments.map((moment) => (
            moment.id === payload.digId
              ? { ...moment, presenceCount: payload.presenceCount, pulse: Date.now() }
              : moment
          )),
        }));
      }

      if (type === 'memory_engraved' && payload?.moment) {
        const removed = new Set(payload.removedDigIds ?? []);
        // Mark the source bubbles as "engraving" so Explore can play the
        // convergence, then drop them after the animation window.
        patch((current) => ({
          ...current,
          liveMoments: current.liveMoments.map((moment) => (
            removed.has(moment.id) ? { ...moment, engraving: true } : moment
          )),
          memories: current.memories.some((memory) => memory.id === payload.moment.id)
            ? current.memories
            : [{ ...payload.moment, justEngraved: true }, ...current.memories],
        }));
        // The Explore flight hides these bubbles itself the moment it starts;
        // this delayed removal only serves inactive tabs (simple fade-out)
        // and keeps the flags alive while the flight captures its rects.
        const timer = window.setTimeout(() => {
          convergeTimers.current.delete(timer);
          patch((current) => ({
            ...current,
            liveMoments: current.liveMoments.filter((moment) => !removed.has(moment.id)),
          }));
        }, 1_500);
        convergeTimers.current.add(timer);
      }

      if (type === 'content_removed' && payload?.id) {
        patch((current) => ({
          ...current,
          knocks: current.knocks.filter((knock) => knock.id !== payload.id),
          liveMoments: current.liveMoments.filter((moment) => moment.id !== payload.id),
          memories: current.memories.filter((memory) => memory.id !== payload.id),
        }));
      }

      onFrameRef.current?.(frame);
    }

    function scheduleReconnect(connect) {
      if (disposed || reconnectTimer) return;
      const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
      reconnectAttempt += 1;
      setStatus('reconnecting');
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    }

    function connect() {
      if (disposed) return;
      const existing = socketRef.current;
      if (existing && existing.readyState <= WebSocket.OPEN) return;

      const generation = ++generationCounter;
      setStatus(snapshotRef.current ? 'reconnecting' : 'connecting');
      const socket = new WebSocket(socketUrl());
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        if (disposed || generation !== generationCounter) return;
        setStatus('syncing');
        send('auth', { token });
        send(document.visibilityState === 'hidden' ? 'away' : 'back', {});
        if (lastLocationRef.current) send('location', lastLocationRef.current);
      });

      socket.addEventListener('message', (event) => {
        if (disposed || generation !== generationCounter) return;
        let frame;
        try {
          frame = JSON.parse(event.data);
        } catch {
          return;
        }
        if (isFrame(frame)) applyFrame(frame);
      });

      socket.addEventListener('close', (event) => {
        if (disposed || generation !== generationCounter) return;
        socketRef.current = null;
        if (event.code === 1008 && event.reason === 'invalid session') {
          setStatus('idle');
          onInvalidSessionRef.current?.();
          return;
        }
        scheduleReconnect(connect);
      });

      socket.addEventListener('error', () => {
        // close owns reconnect scheduling
      });
    }

    function handleVisibility() {
      send(document.visibilityState === 'hidden' ? 'away' : 'back', {});
      if (document.visibilityState === 'visible' && !socketRef.current) {
        if (reconnectTimer) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        connect();
      }
    }

    connect();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      disposed = true;
      generationCounter += 1;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      for (const timer of convergeTimers.current) window.clearTimeout(timer);
      convergeTimers.current.clear();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'client closed');
      sendRef.current = () => false;
    };
  }, [token]);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationGate('denied');
      return;
    }
    setLocationGate('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = { lat: position.coords.latitude, lng: position.coords.longitude };
        lastLocationRef.current = location;
        sendRef.current('location', location);
      },
      () => setLocationGate('denied'),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }, []);

  const sendEvent = useCallback((type, payload = {}) => sendRef.current(type, payload), []);

  return { snapshot, status, locationGate, requestLocation, sendEvent };
}

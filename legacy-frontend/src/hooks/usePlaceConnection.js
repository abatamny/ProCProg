import { useCallback, useEffect, useRef, useState } from 'react';
import { CONTENT_EVENT_TABS, RECONNECT_DELAYS_MS } from '../config.js';

function socketUrl() {
  const url = new URL('/ws', window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

function isProtocolFrame(value) {
  return value
    && typeof value === 'object'
    && typeof value.type === 'string'
    && Object.hasOwn(value, 'payload');
}

export function usePlaceConnection({
  token,
  initialLocation,
  onContentEvent,
  onInvalidSession,
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState(token ? 'connecting' : 'idle');
  const [locationGate, setLocationGate] = useState(null);
  const [locationRequestState, setLocationRequestState] = useState('idle');

  const snapshotRef = useRef(null);
  const socketRef = useRef(null);
  const sendRef = useRef(() => false);
  const lastLocationRef = useRef(initialLocation ?? null);
  const onContentEventRef = useRef(onContentEvent);
  const onInvalidSessionRef = useRef(onInvalidSession);

  useEffect(() => {
    onContentEventRef.current = onContentEvent;
  }, [onContentEvent]);

  useEffect(() => {
    onInvalidSessionRef.current = onInvalidSession;
  }, [onInvalidSession]);

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
    let socketGeneration = 0;
    let reconnectAttempt = 0;
    let reconnectTimer = null;

    function commitSnapshot(nextSnapshot) {
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
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

      if (frame.type === 'place_state') {
        if (frame.payload?.place) {
          commitSnapshot(frame.payload);
          setLocationGate(null);
          setLocationRequestState('idle');
        } else {
          commitSnapshot(null);
          const reason = frame.payload?.reason;
          if (reason === 'outside') {
            setLocationGate('outside');
          } else if (lastLocationRef.current) {
            setLocationGate('locating');
          } else {
            setLocationGate('location_required');
          }
        }
        return;
      }

      if (frame.type === 'presence_update' && frame.payload) {
        const current = snapshotRef.current;
        if (!current) return;
        const layers = current.layerStack.map((layer) => (
          layer.id === frame.payload.placeId
            ? { ...layer, presenceCount: frame.payload.count }
            : layer
        ));
        commitSnapshot({
          ...current,
          layerStack: layers,
          presenceCount: current.place.id === frame.payload.placeId
            ? frame.payload.count
            : current.presenceCount,
        });
        return;
      }

      if (frame.type === 'relocated') {
        if (frame.payload?.place === null) {
          commitSnapshot(null);
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

      if (frame.type === 'knock_new' && frame.payload?.knock) {
        const current = snapshotRef.current;
        if (current && current.layerStack.some((layer) => (
          layer.id === frame.payload.knock.placeId
        )) && !current.knocks.some((knock) => knock.id === frame.payload.knock.id)) {
          commitSnapshot({
            ...current,
            knocks: [...current.knocks, frame.payload.knock],
          });
        }
      }

      const targetTab = CONTENT_EVENT_TABS[frame.type];
      if (targetTab) onContentEventRef.current?.(targetTab, frame);
    }

    function scheduleReconnect(connect) {
      if (disposed || reconnectTimer) return;
      const delay = RECONNECT_DELAYS_MS[
        Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
      ];
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
      if (existing && (
        existing.readyState === WebSocket.OPEN
        || existing.readyState === WebSocket.CONNECTING
      )) return;

      const generation = ++socketGeneration;
      setStatus(snapshotRef.current ? 'reconnecting' : 'connecting');
      const socket = new WebSocket(socketUrl());
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        if (disposed || generation !== socketGeneration) return;
        setStatus('syncing');
        send('auth', { token });
        send(document.visibilityState === 'hidden' ? 'away' : 'back', {});
        if (lastLocationRef.current) send('location', lastLocationRef.current);
      });

      socket.addEventListener('message', (event) => {
        if (disposed || generation !== socketGeneration) return;
        let frame;
        try {
          frame = JSON.parse(event.data);
        } catch {
          return;
        }
        if (isProtocolFrame(frame)) applyFrame(frame);
      });

      socket.addEventListener('close', (event) => {
        if (disposed || generation !== socketGeneration) return;
        socketRef.current = null;
        if (event.code === 1008 && event.reason === 'invalid session') {
          setStatus('idle');
          onInvalidSessionRef.current?.();
          return;
        }
        scheduleReconnect(connect);
      });

      socket.addEventListener('error', () => {
        // close owns reconnect scheduling so each failure creates one timer.
      });
    }

    function handleVisibilityChange() {
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
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      socketGeneration += 1;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState < WebSocket.CLOSING) {
        socket.close(1000, 'client closed');
      }
      sendRef.current = () => false;
    };
  }, [token]);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationRequestState('denied');
      setLocationGate('denied');
      return;
    }

    setLocationRequestState('requesting');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        lastLocationRef.current = location;
        setLocationRequestState('ready');
        setLocationGate('locating');
        sendRef.current('location', location);
      },
      () => {
        setLocationRequestState('denied');
        setLocationGate('denied');
      },
      {
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 0,
      },
    );
  }, []);

  const sendEvent = useCallback((type, payload = {}) => (
    sendRef.current(type, payload)
  ), []);

  return {
    snapshot,
    status,
    locationGate,
    locationRequestState,
    requestLocation,
    sendEvent,
  };
}

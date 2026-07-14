import { useCallback, useEffect, useRef, useState } from 'react';
import { EntryMorph } from './components/EntryMorph.jsx';
import { Onboarding, QuietScreen } from './components/Onboarding.jsx';
import { Shell } from './components/Shell.jsx';
import { APP_TITLE } from './config.js';
import { clearToken, fetchHealth } from './lib/api.js';
import { useConnection } from './hooks/useConnection.js';

export function App() {
  const [boot, setBoot] = useState('checking');
  const [bootAttempt, setBootAttempt] = useState(0);
  const [forceEnabled, setForceEnabled] = useState(false);
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [initialLocation, setInitialLocation] = useState(null);
  const [entered, setEntered] = useState(false);
  const frameListeners = useRef(new Set());

  useEffect(() => {
    document.title = APP_TITLE;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBoot('checking');
      try {
        const health = await fetchHealth();
        if (cancelled) return;
        setForceEnabled(Boolean(health.forcePlaceId));
        // No silent auto-enter: the Landing always shows, and its explicit
        // "Log in" validates any stored session on demand.
        setBoot('ready');
      } catch {
        if (!cancelled) setBoot('error');
      }
    })();
    return () => { cancelled = true; };
  }, [bootAttempt]);

  const handleFrame = useCallback((frame) => {
    for (const listener of frameListeners.current) listener(frame);
  }, []);

  const subscribeFrames = useCallback((listener) => {
    frameListeners.current.add(listener);
    return () => frameListeners.current.delete(listener);
  }, []);

  const handleInvalidSession = useCallback(() => {
    clearToken();
    setToken(null);
    setUser(null);
    setEntered(false);
  }, []);

  const connection = useConnection({
    token,
    initialLocation,
    onFrame: handleFrame,
    onInvalidSession: handleInvalidSession,
  });

  function logout() {
    clearToken();
    setToken(null);
    setUser(null);
    setEntered(false);
    setInitialLocation(null);
  }

  if (boot === 'checking') {
    return <main className="quiet quiet--boot" aria-busy="true"><span className="boot-ring" /></main>;
  }

  if (boot === 'error') {
    return (
      <QuietScreen
        title="The place is quiet."
        body="The server could not be reached. Nothing has been lost."
        onRetry={() => setBootAttempt((value) => value + 1)}
      />
    );
  }

  if (!token) {
    return (
      <Onboarding
        forceEnabled={forceEnabled}
        onEntered={({ token: nextToken, user: nextUser, location }) => {
          setInitialLocation(location);
          setUser(nextUser);
          setToken(nextToken);
        }}
      />
    );
  }

  const gate = connection.locationGate;
  if (!connection.snapshot && (gate === 'outside' || gate === 'denied' || gate === 'location_required')) {
    return (
      <QuietScreen
        title={gate === 'outside'
          ? 'You are not in a mapped place yet.'
          : 'Enable location to enter places'}
        body={gate === 'outside'
          ? 'This paper begins at the edge of a mapped place.'
          : 'Location is checked once, to find the place around you.'}
        onRetry={connection.requestLocation}
        retrying={gate === 'locating'}
      />
    );
  }

  return (
    <>
      {connection.snapshot ? (
        <Shell
          snapshot={connection.snapshot}
          nickname={user?.nickname ?? 'someone'}
          connectionStatus={connection.status}
          preMorph={!entered}
          sendEvent={connection.sendEvent}
          subscribeFrames={subscribeFrames}
          onLogout={logout}
        />
      ) : null}
      {!entered ? (
        <EntryMorph
          placeName={connection.snapshot?.place.name ?? null}
          ready={Boolean(connection.snapshot)}
          onDone={() => setEntered(true)}
        />
      ) : null}
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from './components/AppShell.jsx';
import {
  BootError,
  LoadingScreen,
  LocationGate,
  Onboarding,
} from './components/Onboarding.jsx';
import { APP_TITLE, NICKNAME_PATTERN, SESSION_TOKEN_KEY } from './config.js';
import { usePlaceConnection } from './hooks/usePlaceConnection.js';

function getOneShotLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      }),
      reject,
      {
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 0,
      },
    );
  });
}

export function App() {
  const [bootState, setBootState] = useState('checking');
  const [bootAttempt, setBootAttempt] = useState(0);
  const [forceEnabled, setForceEnabled] = useState(false);
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [onboardingStep, setOnboardingStep] = useState('welcome');
  const [cameraStatus, setCameraStatus] = useState('idle');
  const [locationStatus, setLocationStatus] = useState('idle');
  const [initialLocation, setInitialLocation] = useState(null);
  const [nickname, setNickname] = useState('');
  const [nicknameError, setNicknameError] = useState('');
  const [nicknameSuggestion, setNicknameSuggestion] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('explore');
  const [notificationDots, setNotificationDots] = useState({
    knock: false,
    explore: false,
    profile: false,
  });

  useEffect(() => {
    document.title = APP_TITLE;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      setBootState('checking');
      try {
        const healthResponse = await fetch('/api/health', { cache: 'no-store' });
        if (!healthResponse.ok) throw new Error('Health check failed');
        const health = await healthResponse.json();
        if (cancelled) return;
        setForceEnabled(Boolean(health.forcePlaceId));

        const storedToken = window.localStorage.getItem(SESSION_TOKEN_KEY);
        if (!storedToken) {
          setBootState('ready');
          return;
        }

        const sessionResponse = await fetch('/api/session', {
          headers: { authorization: `Bearer ${storedToken}` },
          cache: 'no-store',
        });
        if (cancelled) return;
        if (!sessionResponse.ok) {
          window.localStorage.removeItem(SESSION_TOKEN_KEY);
          setBootState('ready');
          return;
        }

        const session = await sessionResponse.json();
        setUser(session.user);
        setToken(storedToken);
        setBootState('ready');
      } catch {
        if (!cancelled) setBootState('error');
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [bootAttempt]);

  const handleContentEvent = useCallback((targetTab) => {
    if (targetTab === activeTab) return;
    setNotificationDots((current) => ({ ...current, [targetTab]: true }));
  }, [activeTab]);

  const handleInvalidSession = useCallback(() => {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
    setToken(null);
    setUser(null);
    setOnboardingStep('welcome');
  }, []);

  const connection = usePlaceConnection({
    token,
    initialLocation,
    onContentEvent: handleContentEvent,
    onInvalidSession: handleInvalidSession,
  });

  async function prepareCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('unavailable');
      return;
    }
    setCameraStatus('requesting');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      setCameraStatus('ready');
    } catch {
      setCameraStatus('denied');
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  async function requestOnboardingLocation() {
    setLocationStatus('requesting');
    try {
      const location = await getOneShotLocation();
      setInitialLocation(location);
      setLocationStatus('ready');
    } catch {
      setLocationStatus('denied');
    }
  }

  async function register(event) {
    event.preventDefault();
    const normalized = nickname.trim();
    setNicknameSuggestion(null);
    if (!NICKNAME_PATTERN.test(normalized)) {
      setNicknameError('Use 3–20 letters, numbers, or underscores.');
      return;
    }

    setSubmitting(true);
    setNicknameError('');
    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nickname: normalized }),
      });
      const body = await response.json();
      if (response.status === 409) {
        setNicknameError('That mark is already here.');
        setNicknameSuggestion(body.suggestion ?? null);
        return;
      }
      if (!response.ok) {
        setNicknameError(body.message ?? 'This nickname could not be engraved.');
        return;
      }

      window.localStorage.setItem(SESSION_TOKEN_KEY, body.token);
      setUser(body.user);
      setToken(body.token);
    } catch {
      setNicknameError('The place could not be reached. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function changeTab(nextTab) {
    setActiveTab(nextTab);
    setNotificationDots((current) => ({ ...current, [nextTab]: false }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (bootState === 'checking') return <LoadingScreen />;
  if (bootState === 'error') return <BootError onRetry={() => setBootAttempt((value) => value + 1)} />;

  if (!token) {
    return (
      <Onboarding
        step={onboardingStep}
        forceEnabled={forceEnabled}
        cameraStatus={cameraStatus}
        locationStatus={locationStatus}
        nickname={nickname}
        nicknameError={nicknameError}
        suggestion={nicknameSuggestion}
        submitting={submitting}
        onStart={() => setOnboardingStep('permissions')}
        onPrepareCamera={prepareCamera}
        onRequestLocation={requestOnboardingLocation}
        onContinue={() => setOnboardingStep('nickname')}
        onNicknameChange={(value) => {
          setNickname(value);
          setNicknameError('');
          setNicknameSuggestion(null);
        }}
        onUseSuggestion={() => {
          setNickname(nicknameSuggestion);
          setNicknameSuggestion(null);
          setNicknameError('');
        }}
        onRegister={register}
      />
    );
  }

  if (!connection.snapshot) {
    if (['location_required', 'denied', 'outside'].includes(connection.locationGate)) {
      return (
        <LocationGate
          kind={connection.locationGate}
          requesting={connection.locationRequestState === 'requesting'}
          onRetry={connection.requestLocation}
        />
      );
    }
    return <LoadingScreen reconnecting={connection.status === 'reconnecting'} />;
  }

  return (
    <AppShell
      snapshot={connection.snapshot}
      nickname={user?.nickname ?? 'someone'}
      token={token}
      activeTab={activeTab}
      notificationDots={notificationDots}
      connectionStatus={connection.status}
      onTabChange={changeTab}
      onSendEvent={connection.sendEvent}
    />
  );
}

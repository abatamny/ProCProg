import { useState } from 'react';
import { ArrowLeft, ArrowRight, MapPin, RefreshCw } from 'lucide-react';
import { APP_TAGLINE, APP_TITLE, NICKNAME_PATTERN } from '../config.js';
import {
  clearToken, getToken, register, storeToken, validateSession,
} from '../lib/api.js';
import { Logo } from './Logo.jsx';

function oneShotLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

const BACK = { welcome: 'landing', nickname: 'welcome', location: 'nickname' };

export function Onboarding({ forceEnabled, onEntered }) {
  const [step, setStep] = useState('landing');
  const [session, setSession] = useState(null); // {token, user} after register / log in
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [locating, setLocating] = useState(false);

  function goto(next) {
    setStep(next);
    setError('');
    setSuggestion(null);
    setLoginError('');
  }

  // "Log in" = the returning-user mechanism, now explicit: validate the stored
  // session token and enter directly. No token → invite to register.
  async function logIn() {
    const stored = getToken();
    if (!stored) {
      setLoginError('No session on this device yet — register to join.');
      return;
    }
    setLoggingIn(true);
    try {
      const user = await validateSession(stored);
      if (!user) {
        clearToken();
        setLoginError('That session has expired — register to join.');
        return;
      }
      onEntered({ token: stored, user, location: null });
    } catch {
      setLoginError('The place could not be reached. Try again.');
    } finally {
      setLoggingIn(false);
    }
  }

  async function submitNickname(event) {
    event.preventDefault();
    const value = nickname.trim();
    setSuggestion(null);
    if (!NICKNAME_PATTERN.test(value)) {
      setError('Use 3–20 letters, numbers, or underscores.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const { status, body } = await register(value);
      if (status === 409) {
        setError('That name is already taken here.');
        setSuggestion(body.suggestion ?? null);
        return;
      }
      if (status !== 201) {
        setError(body.message ?? 'This name could not be used.');
        return;
      }
      storeToken(body.token);
      setSession({ token: body.token, user: body.user });
      goto('location');
    } catch {
      setError('The place could not be reached. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // The place is a live result of location, so we resolve it last. With
  // Force-location on, we skip the real prompt entirely — the server already
  // knows where to place the user, keeping Force invisible.
  async function allowLocation() {
    if (!session) return;
    setLocating(true);
    if (forceEnabled) {
      onEntered({ token: session.token, user: session.user, location: null });
      return;
    }
    let location = null;
    try {
      location = await oneShotLocation();
    } catch {
      location = null; // denied → the app's location gate handles it
    }
    onEntered({ token: session.token, user: session.user, location });
  }

  const backButton = BACK[step] ? (
    <button className="ob__back" type="button" aria-label="Back" onClick={() => goto(BACK[step])}>
      <ArrowLeft size={18} aria-hidden="true" />
    </button>
  ) : null;

  if (step === 'landing') {
    return (
      <main className="ob">
        <div className="ob__sheet ob__sheet--landing" key="landing">
          <div className="ob__brand">
            <Logo size={58} className="ob__logo" />
            <h1 className="ob__wordmark">{APP_TITLE}</h1>
            <p className="ob__tagline">{APP_TAGLINE}</p>
          </div>
          <div className="ob__actions">
            <button className="btn-clay" type="button" onClick={() => goto('welcome')}>
              Register
            </button>
            <button className="btn-ghost" type="button" disabled={loggingIn} onClick={logIn}>
              {loggingIn ? 'Checking…' : 'Log in'}
            </button>
            <div className="ob__message ob__message--center" aria-live="polite">{loginError}</div>
          </div>
        </div>
      </main>
    );
  }

  if (step === 'welcome') {
    return (
      <main className="ob">
        <div className="ob__sheet" key="welcome">
          {backButton}
          <p className="ob__eyebrow">Welcome</p>
          <h1 className="ob__hero">The place you&rsquo;re in, made social.</h1>
          <p className="ob__lede">
            Wherever you are — a building, a park, a class — you&rsquo;ll see what&rsquo;s
            happening there right now, and what that place remembers. No profiles,
            no followers. Only here, only now.
          </p>
          <button className="btn-primary" type="button" onClick={() => goto('nickname')}>
            Continue
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      </main>
    );
  }

  if (step === 'nickname') {
    return (
      <main className="ob">
        <form className="ob__sheet" key="nickname" onSubmit={submitNickname} noValidate>
          {backButton}
          <p className="ob__eyebrow">Your mark</p>
          <h1 className="ob__hero">What should we call you?</h1>
          <p className="ob__hint">
            3–20 letters, numbers, or underscores. Just a small name for the
            places you pass through — no public profile, ever.
          </p>
          <label className="ob__field" htmlFor="nickname">
            <span>Nickname</span>
            <input
              id="nickname"
              type="text"
              value={nickname}
              maxLength={20}
              autoComplete="nickname"
              autoCapitalize="none"
              spellCheck="false"
              enterKeyHint="go"
              onChange={(event) => {
                setNickname(event.target.value);
                setError('');
                setSuggestion(null);
              }}
              autoFocus
            />
          </label>
          <div className="ob__message" aria-live="polite">
            {error}
            {suggestion ? (
              <button
                className="btn-text"
                type="button"
                onClick={() => {
                  setNickname(suggestion);
                  setSuggestion(null);
                  setError('');
                }}
              >
                Use {suggestion}
              </button>
            ) : null}
          </div>
          <button className="btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Just a moment…' : 'Continue'}
            {!submitting ? <ArrowRight size={18} aria-hidden="true" /> : null}
          </button>
        </form>
      </main>
    );
  }

  // location
  return (
    <main className="ob">
      <div className="ob__sheet" key="location">
        {backButton}
        <p className="ob__eyebrow">One last thing</p>
        <h1 className="ob__hero">Let&rsquo;s find where you are.</h1>
        <p className="ob__lede">
          {APP_TITLE} uses your location to show you the place you&rsquo;re standing
          in right now. Checked once, when you arrive — never tracked.
        </p>
        <div className="ob__locrow">
          <MapPin size={20} strokeWidth={1.8} aria-hidden="true" />
          <div>
            <h3>Detect your surroundings</h3>
            <p>Used to sense where you are — not to send you anywhere in particular.</p>
          </div>
        </div>
        <button className="btn-primary" type="button" disabled={locating} onClick={allowLocation}>
          {locating ? 'Finding where you are…' : 'Allow location'}
          {!locating ? <ArrowRight size={18} aria-hidden="true" /> : null}
        </button>
        <p className="ob__fineprint">Never stored, never shared.</p>
      </div>
    </main>
  );
}

export function QuietScreen({ title, body, onRetry, retrying = false }) {
  return (
    <main className="quiet">
      <MapPin className="quiet__pin" size={34} strokeWidth={1.5} aria-hidden="true" />
      <h1>{title}</h1>
      <p>{body}</p>
      {onRetry ? (
        <button className="btn-secondary" type="button" onClick={onRetry} disabled={retrying}>
          <RefreshCw size={16} aria-hidden="true" />
          {retrying ? 'Finding…' : 'Retry'}
        </button>
      ) : null}
    </main>
  );
}

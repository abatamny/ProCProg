import { useState } from 'react';
import { ArrowRight, Camera, MapPin, RefreshCw } from 'lucide-react';
import { NICKNAME_PATTERN } from '../config.js';
import { register, storeToken } from '../lib/api.js';

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

export function Onboarding({ forceEnabled, onEntered }) {
  const [step, setStep] = useState('welcome');
  const [locationStatus, setLocationStatus] = useState('idle');
  const [cameraStatus, setCameraStatus] = useState('idle');
  const [location, setLocation] = useState(null);
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function requestLocation() {
    setLocationStatus('requesting');
    try {
      const coords = await oneShotLocation();
      setLocation(coords);
      setLocationStatus('ready');
    } catch {
      setLocationStatus('denied');
    }
  }

  async function prepareCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('later');
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
      setCameraStatus('later');
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  async function submit(event) {
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
        setError('That name is already carved here.');
        setSuggestion(body.suggestion ?? null);
        return;
      }
      if (status !== 201) {
        setError(body.message ?? 'This name could not be engraved.');
        return;
      }
      storeToken(body.token);
      onEntered({ token: body.token, user: body.user, location });
    } catch {
      setError('The place could not be reached. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'welcome') {
    return (
      <main className="ob">
        <div className="ob__sheet ob__sheet--welcome">
          <p className="ob__eyebrow">A place remembers</p>
          <h1 className="ob__hero">Be present where you are.</h1>
          <p className="ob__lede">
            What happens here belongs to this place — not to a profile,
            a feed, or a follower count.
          </p>
          <button className="btn-primary" type="button" onClick={() => setStep('permissions')}>
            Enter this place
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      </main>
    );
  }

  if (step === 'permissions') {
    const locationReady = forceEnabled || locationStatus === 'ready';
    return (
      <main className="ob">
        <div className="ob__sheet">
          <p className="ob__eyebrow">Before you enter</p>
          <h1 className="ob__hero">Let the place find you.</h1>

          <div className="ob__perm">
            <MapPin size={20} strokeWidth={1.8} aria-hidden="true" />
            <div>
              <h3>Place access</h3>
              <p>
                {forceEnabled
                  ? 'This demo already knows the room. No location needed.'
                  : locationStatus === 'ready'
                    ? 'Your location is ready for the place check.'
                    : locationStatus === 'denied'
                      ? 'Enable location to enter places.'
                      : 'Checked once, to find the place around you.'}
              </p>
            </div>
            {!forceEnabled && locationStatus !== 'ready' ? (
              <button
                className="btn-text"
                type="button"
                disabled={locationStatus === 'requesting'}
                onClick={requestLocation}
              >
                {locationStatus === 'requesting' ? 'Finding…' : 'Enable'}
              </button>
            ) : null}
          </div>

          <div className="ob__perm">
            <Camera size={20} strokeWidth={1.8} aria-hidden="true" />
            <div>
              <h3>Camera</h3>
              <p>
                {cameraStatus === 'ready'
                  ? 'Ready for when you capture this place.'
                  : cameraStatus === 'requesting'
                    ? 'Waiting for your browser…'
                    : 'Optional now — your browser can ask when you capture.'}
              </p>
            </div>
            {cameraStatus === 'idle' ? (
              <button className="btn-text" type="button" onClick={prepareCamera}>Prepare</button>
            ) : null}
          </div>

          <button
            className="btn-primary"
            type="button"
            disabled={!locationReady}
            onClick={() => setStep('nickname')}
          >
            Continue
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="ob">
      <form className="ob__sheet" onSubmit={submit} noValidate>
        <p className="ob__eyebrow">Leave a small mark</p>
        <h1 className="ob__hero">What should this place call you?</h1>
        <p className="ob__hint">3–20 letters, numbers, or underscores. No public profile exists.</p>
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
          {submitting ? 'Entering…' : 'Enter the place'}
          {!submitting ? <ArrowRight size={18} aria-hidden="true" /> : null}
        </button>
      </form>
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

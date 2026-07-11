import { ArrowRight, Camera, MapPin, RefreshCw } from 'lucide-react';

function PermissionRow({ icon: Icon, title, children, action }) {
  return (
    <div className="permission-row">
      <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
      <div className="permission-row__copy">
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
      {action}
    </div>
  );
}

export function Onboarding({
  step,
  forceEnabled,
  cameraStatus,
  locationStatus,
  nickname,
  nicknameError,
  suggestion,
  submitting,
  onStart,
  onPrepareCamera,
  onRequestLocation,
  onContinue,
  onNicknameChange,
  onUseSuggestion,
  onRegister,
}) {
  if (step === 'welcome') {
    return (
      <main className="onboarding-screen">
        <div className="onboarding-sheet onboarding-sheet--welcome">
          <p className="eyebrow">A place remembers</p>
          <h1>Be present where you are.</h1>
          <p className="onboarding-lede">
            What happens here belongs to this place—not to a profile, a feed, or a follower count.
          </p>
          <button className="primary-action" type="button" onClick={onStart}>
            Enter this place
            <ArrowRight aria-hidden="true" size={18} />
          </button>
        </div>
      </main>
    );
  }

  if (step === 'permissions') {
    const locationReady = forceEnabled || locationStatus === 'ready';
    return (
      <main className="onboarding-screen">
        <div className="onboarding-sheet">
          <p className="eyebrow">Before you enter</p>
          <h1>Let the place find you.</h1>
          <div className="permission-list">
            <PermissionRow
              icon={MapPin}
              title="Place access"
              action={!forceEnabled && locationStatus !== 'ready' ? (
                <button
                  className="text-action"
                  type="button"
                  onClick={onRequestLocation}
                  disabled={locationStatus === 'requesting'}
                >
                  {locationStatus === 'requesting' ? 'Finding…' : 'Enable'}
                </button>
              ) : null}
            >
              {forceEnabled
                ? 'This demo already knows the room. No location permission is needed.'
                : locationStatus === 'ready'
                  ? 'Your location is ready for the place check.'
                  : locationStatus === 'denied'
                    ? 'Enable location to enter places.'
                    : 'Used once to find the innermost mapped place.'}
            </PermissionRow>

            <PermissionRow
              icon={Camera}
              title="Camera"
              action={cameraStatus === 'idle' ? (
                <button className="text-action" type="button" onClick={onPrepareCamera}>
                  Prepare
                </button>
              ) : null}
            >
              {cameraStatus === 'requesting'
                ? 'Waiting for your browser…'
                : cameraStatus === 'ready'
                  ? 'Camera is ready when you choose to capture.'
                  : cameraStatus === 'denied'
                    ? 'You can allow it later when you capture.'
                    : cameraStatus === 'unavailable'
                      ? 'Your browser will ask when you capture.'
                      : 'Optional now; your browser can ask again when you capture.'}
            </PermissionRow>
          </div>
          <button
            className="primary-action"
            type="button"
            onClick={onContinue}
            disabled={!locationReady}
          >
            Continue
            <ArrowRight aria-hidden="true" size={18} />
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="onboarding-screen">
      <form className="onboarding-sheet" onSubmit={onRegister} noValidate>
        <p className="eyebrow">Leave a small mark</p>
        <h1>What should this place call you?</h1>
        <p className="field-hint">3–20 letters, numbers, or underscores. No public profile is created.</p>
        <label className="nickname-field" htmlFor="nickname">
          <span>Nickname</span>
          <input
            id="nickname"
            name="nickname"
            type="text"
            value={nickname}
            minLength={3}
            maxLength={20}
            pattern="[A-Za-z0-9_]{3,20}"
            autoComplete="nickname"
            autoCapitalize="none"
            spellCheck="false"
            enterKeyHint="go"
            onChange={(event) => onNicknameChange(event.target.value)}
            autoFocus
          />
        </label>
        <div className="form-message" aria-live="polite">
          {nicknameError}
          {suggestion ? (
            <button className="suggestion-action" type="button" onClick={onUseSuggestion}>
              Use {suggestion}
            </button>
          ) : null}
        </div>
        <button className="primary-action" type="submit" disabled={submitting}>
          {submitting ? 'Entering…' : 'Enter the place'}
          {!submitting ? <ArrowRight aria-hidden="true" size={18} /> : null}
        </button>
      </form>
    </main>
  );
}

export function LoadingScreen({ reconnecting = false }) {
  return (
    <main className="quiet-screen" aria-live="polite">
      <span className="ink-spinner" aria-hidden="true" />
      <h1>{reconnecting ? 'Finding the place again…' : 'Finding this place…'}</h1>
      <p>{reconnecting ? 'The page will return when the connection does.' : 'A moment while the paper settles.'}</p>
    </main>
  );
}

export function LocationGate({ kind, requesting, onRetry }) {
  const outside = kind === 'outside';
  return (
    <main className="quiet-screen quiet-screen--location">
      <MapPin className="quiet-pin" aria-hidden="true" size={34} strokeWidth={1.5} />
      <h1>{outside ? 'You are not in a mapped place yet.' : 'Enable location to enter places'}</h1>
      <p>
        {outside
          ? 'This paper begins at the edge of a mapped place.'
          : 'Location is checked once to find the place around you.'}
      </p>
      <button className="secondary-action" type="button" onClick={onRetry} disabled={requesting}>
        <RefreshCw aria-hidden="true" size={17} />
        {requesting ? 'Finding…' : 'Retry'}
      </button>
    </main>
  );
}

export function BootError({ onRetry }) {
  return (
    <main className="quiet-screen">
      <h1>The place is quiet.</h1>
      <p>The server could not be reached. Nothing has been lost.</p>
      <button className="secondary-action" type="button" onClick={onRetry}>
        <RefreshCw aria-hidden="true" size={17} />
        Try again
      </button>
    </main>
  );
}

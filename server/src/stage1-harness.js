// Development-only, non-product test surface for Stage 1. The caller must also
// avoid registering its route in production. This module deliberately contains
// no application UI and no features from the demo CUT list.

const STAGE1_HARNESS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' ws: wss:; img-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>place-app Stage 1 test harness</title>
  <style>
    :root {
      color-scheme: light;
      --paper: #FAFAF7;
      --ink: #141414;
      --meta: #8A8A82;
      --muted: #B4B2A9;
      --line: #E5E3DB;
      --live: #1D9E75;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font: 15px/1.45 Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    header {
      padding: calc(18px + env(safe-area-inset-top)) 18px 18px;
      background: var(--ink);
      color: var(--paper);
    }

    header p { margin: 6px 0 0; color: #D8D7D0; }

    h1, h2 {
      margin: 0;
      font-family: "Space Grotesk", Inter, system-ui, sans-serif;
      letter-spacing: -0.02em;
    }

    h1 { font-size: 24px; }
    h2 { font-size: 18px; }

    main {
      width: min(760px, 100%);
      margin: 0 auto;
      padding: 16px 14px calc(32px + env(safe-area-inset-bottom));
    }

    .notice {
      border: 1px solid var(--ink);
      padding: 10px 12px;
      margin-bottom: 14px;
      font-size: 13px;
    }

    .status-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 14px;
    }

    .status-card, section {
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.42);
    }

    .status-card { padding: 10px; min-width: 0; }
    .status-card span { display: block; color: var(--meta); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
    .status-card strong { display: block; margin-top: 3px; overflow-wrap: anywhere; }
    [data-state="ok"] { color: var(--live); }

    section { padding: 14px; margin-top: 12px; }
    section > p { color: var(--meta); margin: 5px 0 12px; font-size: 13px; }

    label {
      display: block;
      margin-top: 10px;
      color: var(--meta);
      font-size: 12px;
    }

    input {
      width: 100%;
      min-height: 44px;
      margin-top: 4px;
      padding: 9px 10px;
      border: 1px solid var(--muted);
      border-radius: 0;
      background: var(--paper);
      color: var(--ink);
      font: inherit;
    }

    input[type="checkbox"] { width: 20px; min-height: 20px; margin: 0; }

    .check-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 12px 0 4px;
      color: var(--ink);
      font-size: 14px;
    }

    .row {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }

    button {
      min-height: 42px;
      border: 1px solid var(--ink);
      border-radius: 0;
      padding: 8px 12px;
      background: var(--ink);
      color: var(--paper);
      font: 700 13px/1.2 "Space Grotesk", Inter, system-ui, sans-serif;
      cursor: pointer;
    }

    button.secondary { background: transparent; color: var(--ink); }
    button:disabled { opacity: .45; cursor: not-allowed; }

    output {
      display: block;
      min-height: 22px;
      margin-top: 10px;
      color: var(--meta);
      font-size: 12px;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    pre {
      max-height: 48vh;
      overflow: auto;
      margin: 12px 0 0;
      padding: 12px;
      background: var(--ink);
      color: var(--paper);
      font: 11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    @media (max-width: 520px) {
      .status-grid, .row { grid-template-columns: 1fr; }
      button { flex: 1 1 auto; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Stage 1 transport harness</h1>
    <p>Development-only · not a product screen</p>
  </header>

  <main>
    <div class="notice">
      This page tests the Stage 1 server contract only. Never link it from the app or expose it in production.
    </div>

    <div class="status-grid" aria-live="polite">
      <div class="status-card"><span>Secure context</span><strong id="secureStatus">checking…</strong></div>
      <div class="status-card"><span>Origin</span><strong id="originStatus"></strong></div>
      <div class="status-card"><span>WebSocket</span><strong id="socketStatus">closed</strong></div>
      <div class="status-card"><span>Current place</span><strong id="placeStatus">none</strong></div>
      <div class="status-card"><span>Presence</span><strong id="presenceStatus">unknown</strong></div>
      <div class="status-card"><span>Visibility</span><strong id="visibilityStatus"></strong></div>
    </div>

    <section aria-labelledby="sessionHeading">
      <h2 id="sessionHeading">Registration and session</h2>
      <p>Calls POST /api/register and GET /api/session on this origin.</p>

      <label for="nickname">Nickname</label>
      <input id="nickname" type="text" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" autocomplete="nickname" autocapitalize="none" spellcheck="false" placeholder="student_1">

      <label for="token">Session token (stored only in this browser)</label>
      <input id="token" type="password" autocomplete="off" readonly>

      <div class="buttons">
        <button id="registerButton" type="button">Register</button>
        <button id="validateButton" class="secondary" type="button">Validate session</button>
        <button id="clearTokenButton" class="secondary" type="button">Clear local token</button>
      </div>
      <output id="sessionOutput">No request yet.</output>
    </section>

    <section aria-labelledby="socketHeading">
      <h2 id="socketHeading">WebSocket and location</h2>
      <p>Uses one same-origin /ws socket and sends only exact {type, payload} application frames.</p>

      <label class="check-row" for="autoReconnect">
        <input id="autoReconnect" type="checkbox" checked>
        Reconnect with 1s, 2s, 4s… backoff (maximum 15s)
      </label>
      <label class="check-row" for="autoVisibility">
        <input id="autoVisibility" type="checkbox" checked>
        Send away/back on page visibility changes
      </label>

      <div class="buttons">
        <button id="connectButton" type="button">Connect + auth</button>
        <button id="closeButton" class="secondary" type="button">Close socket</button>
        <button id="awayButton" class="secondary" type="button">Send away</button>
        <button id="backButton" class="secondary" type="button">Send back</button>
      </div>

      <div class="buttons">
        <button id="phoneLocationButton" type="button">Use phone location</button>
      </div>

      <div class="row">
        <label for="latitude">Manual latitude
          <input id="latitude" type="number" min="-90" max="90" step="any" inputmode="decimal" placeholder="32.x">
        </label>
        <label for="longitude">Manual longitude
          <input id="longitude" type="number" min="-180" max="180" step="any" inputmode="decimal" placeholder="35.x">
        </label>
      </div>
      <div class="buttons">
        <button id="manualLocationButton" class="secondary" type="button">Send manual location</button>
      </div>
      <output id="socketOutput">Connect after registering.</output>
    </section>

    <section aria-labelledby="forceHeading">
      <h2 id="forceHeading">Force-location setting</h2>
      <p>Calls the password-protected GET/PUT /api/admin/force-location endpoint. The password is held only in this field.</p>

      <label for="adminPassword">Local ADMIN_PASSWORD</label>
      <input id="adminPassword" type="password" autocomplete="off">

      <label class="check-row" for="forceEnabled">
        <input id="forceEnabled" type="checkbox">
        Force all connected users into the selected place
      </label>

      <label for="forcePlaceId">Forced place ID</label>
      <input id="forcePlaceId" type="text" value="faculty-data-decision-sciences" autocomplete="off" autocapitalize="none" spellcheck="false">

      <div class="buttons">
        <button id="readForceButton" class="secondary" type="button">Read Force state</button>
        <button id="applyForceButton" type="button">Apply Force state</button>
      </div>
      <output id="forceOutput">Password is never stored or logged.</output>
    </section>

    <section aria-labelledby="logHeading">
      <h2 id="logHeading">Protocol log</h2>
      <p>Newest entry first. Session tokens and password-like fields are redacted.</p>
      <div class="buttons">
        <button id="clearLogButton" class="secondary" type="button">Clear log</button>
      </div>
      <pre id="eventLog" aria-live="polite">Harness loaded.</pre>
    </section>
  </main>

  <script>
    (function () {
      'use strict';

      var TOKEN_KEY = 'place-app.stage1.session-token';
      var socket = null;
      var reconnectTimer = null;
      var reconnectAttempt = 0;
      var manualClose = false;
      var lastLocation = null;

      var byId = function (id) { return document.getElementById(id); };
      var secureStatus = byId('secureStatus');
      var originStatus = byId('originStatus');
      var socketStatus = byId('socketStatus');
      var placeStatus = byId('placeStatus');
      var presenceStatus = byId('presenceStatus');
      var visibilityStatus = byId('visibilityStatus');
      var nicknameInput = byId('nickname');
      var tokenInput = byId('token');
      var sessionOutput = byId('sessionOutput');
      var socketOutput = byId('socketOutput');
      var latitudeInput = byId('latitude');
      var longitudeInput = byId('longitude');
      var autoReconnect = byId('autoReconnect');
      var autoVisibility = byId('autoVisibility');
      var adminPassword = byId('adminPassword');
      var forceEnabled = byId('forceEnabled');
      var forcePlaceId = byId('forcePlaceId');
      var forceOutput = byId('forceOutput');
      var eventLog = byId('eventLog');

      function setState(element, state) {
        element.setAttribute('data-state', state || '');
      }

      function redactSecrets(value) {
        if (Array.isArray(value)) return value.map(redactSecrets);
        if (!value || typeof value !== 'object') return value;
        var redacted = {};
        Object.keys(value).forEach(function (key) {
          if (/token|password|authorization/i.test(key)) {
            redacted[key] = '[redacted]';
          } else {
            redacted[key] = redactSecrets(value[key]);
          }
        });
        return redacted;
      }

      function format(value) {
        if (value === undefined) return '';
        if (typeof value === 'string') return value;
        try { return JSON.stringify(redactSecrets(value), null, 2); }
        catch (error) { return String(value); }
      }

      function log(label, value) {
        var entry = '[' + new Date().toISOString() + '] ' + label;
        var detail = format(value);
        if (detail) entry += '\n' + detail;
        eventLog.textContent = entry + '\n\n' + eventLog.textContent;
      }

      function readStoredToken() {
        try { return localStorage.getItem(TOKEN_KEY) || ''; }
        catch (error) { log('localStorage read failed', error.message); return ''; }
      }

      function storeToken(token) {
        tokenInput.value = token || '';
        try {
          if (token) localStorage.setItem(TOKEN_KEY, token);
          else localStorage.removeItem(TOKEN_KEY);
        } catch (error) {
          log('localStorage write failed', error.message);
        }
      }

      async function jsonRequest(path, options) {
        var response = await fetch(path, options);
        var text = await response.text();
        var body = null;
        if (text) {
          try { body = JSON.parse(text); }
          catch (error) { body = text; }
        }
        return { response: response, body: body };
      }

      async function register() {
        var nickname = nicknameInput.value.trim();
        if (!/^[A-Za-z0-9_]{3,20}$/.test(nickname)) {
          sessionOutput.textContent = 'Nickname must be 3–20 letters, numbers, or underscores.';
          return;
        }

        try {
          var result = await jsonRequest('/api/register', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ nickname: nickname })
          });
          log('HTTP POST /api/register → ' + result.response.status, result.body);
          if (!result.response.ok) {
            sessionOutput.textContent = 'Registration rejected (' + result.response.status + '): ' + format(result.body);
            return;
          }
          if (!result.body || typeof result.body.token !== 'string') {
            sessionOutput.textContent = 'Registration succeeded but the expected token was absent.';
            return;
          }
          storeToken(result.body.token);
          sessionOutput.textContent = 'Registered. Token stored locally and redacted from the log.';
        } catch (error) {
          sessionOutput.textContent = 'Registration failed: ' + error.message;
          log('Registration network error', error.message);
        }
      }

      async function validateSession() {
        var token = tokenInput.value;
        if (!token) {
          sessionOutput.textContent = 'Register first or reload a browser with a stored token.';
          return;
        }
        try {
          var result = await jsonRequest('/api/session', {
            method: 'GET',
            headers: { authorization: 'Bearer ' + token }
          });
          log('HTTP GET /api/session → ' + result.response.status, result.body);
          sessionOutput.textContent = result.response.ok
            ? 'Session valid: ' + format(result.body)
            : 'Session rejected (' + result.response.status + '): ' + format(result.body);
        } catch (error) {
          sessionOutput.textContent = 'Session validation failed: ' + error.message;
          log('Session network error', error.message);
        }
      }

      function websocketUrl() {
        var url = new URL('/ws', window.location.href);
        url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return url.href;
      }

      function sendFrame(type, payload) {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          socketOutput.textContent = 'Socket is not open; could not send ' + type + '.';
          return false;
        }
        var frame = { type: type, payload: payload };
        socket.send(JSON.stringify(frame));
        log('→ ' + type, payload);
        return true;
      }

      function updateFromServerFrame(frame) {
        if (frame.type === 'place_state' && frame.payload) {
          var snapshot = frame.payload;
          var place = snapshot.place || (snapshot.placeState && snapshot.placeState.place);
          var count = snapshot.presenceCount;
          if (place && place.name) placeStatus.textContent = place.name;
          if (snapshot.place === null) placeStatus.textContent = 'none';
          if (Number.isFinite(count)) presenceStatus.textContent = String(count);
        }
        if (frame.type === 'presence_update' && frame.payload && Number.isFinite(frame.payload.count)) {
          presenceStatus.textContent = String(frame.payload.count);
        }
        if (frame.type === 'relocated' && frame.payload && frame.payload.place) {
          placeStatus.textContent = frame.payload.place.name || frame.payload.place.id || 'relocated';
        }
        if (frame.type === 'relocated' && frame.payload && frame.payload.place === null) {
          placeStatus.textContent = 'none';
          presenceStatus.textContent = 'unknown';
          if (lastLocation) sendFrame('location', lastLocation);
        }
      }

      function scheduleReconnect() {
        if (manualClose || !autoReconnect.checked || !tokenInput.value || reconnectTimer) return;
        var delay = Math.min(15000, 1000 * Math.pow(2, reconnectAttempt));
        reconnectAttempt += 1;
        socketStatus.textContent = 'reconnect in ' + (delay / 1000) + 's';
        setState(socketStatus, '');
        log('WebSocket reconnect scheduled', { delayMs: delay, attempt: reconnectAttempt });
        reconnectTimer = window.setTimeout(function () {
          reconnectTimer = null;
          connectSocket(true);
        }, delay);
      }

      function connectSocket(isReconnect) {
        if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
          socketOutput.textContent = 'Socket is already open or connecting.';
          return;
        }
        var token = tokenInput.value;
        if (!token) {
          socketOutput.textContent = 'Register or validate a stored token first.';
          return;
        }

        if (reconnectTimer) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        manualClose = false;
        var url = websocketUrl();
        socketStatus.textContent = 'connecting';
        setState(socketStatus, '');
        socketOutput.textContent = (isReconnect ? 'Reconnecting to ' : 'Connecting to ') + url;
        log('WebSocket connecting', { url: url, reconnect: Boolean(isReconnect) });

        socket = new WebSocket(url);
        socket.addEventListener('open', function () {
          reconnectAttempt = 0;
          socketStatus.textContent = 'open';
          setState(socketStatus, 'ok');
          socketOutput.textContent = 'Open: ' + url;
          sendFrame('auth', { token: tokenInput.value });
          if (document.visibilityState === 'hidden') sendFrame('away', {});
          if (lastLocation) sendFrame('location', lastLocation);
        });
        socket.addEventListener('message', function (event) {
          var frame;
          try { frame = JSON.parse(event.data); }
          catch (error) {
            log('← invalid non-JSON server message', String(event.data));
            return;
          }
          if (!frame || typeof frame.type !== 'string' || !Object.prototype.hasOwnProperty.call(frame, 'payload')) {
            log('← protocol violation: expected {type, payload}', frame);
            return;
          }
          log('← ' + frame.type, frame.payload);
          updateFromServerFrame(frame);
        });
        socket.addEventListener('error', function () {
          log('WebSocket error');
        });
        socket.addEventListener('close', function (event) {
          socket = null;
          socketStatus.textContent = 'closed (' + event.code + ')';
          setState(socketStatus, '');
          log('WebSocket closed', { code: event.code, reason: event.reason, clean: event.wasClean });
          scheduleReconnect();
        });
      }

      function closeSocket() {
        manualClose = true;
        if (reconnectTimer) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        if (socket) socket.close(1000, 'manual harness close');
        else {
          socketStatus.textContent = 'closed';
          socketOutput.textContent = 'Socket is already closed.';
        }
      }

      function rememberAndSendLocation(lat, lng, source) {
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
          socketOutput.textContent = 'Latitude or longitude is outside its valid range.';
          return;
        }
        lastLocation = { lat: lat, lng: lng };
        latitudeInput.value = String(lat);
        longitudeInput.value = String(lng);
        socketOutput.textContent = source + ' location ready: ' + lat + ', ' + lng;
        if (!sendFrame('location', lastLocation)) {
          socketOutput.textContent += '. It is saved and will be sent after the next connection.';
        }
      }

      function requestPhoneLocation() {
        if (!window.isSecureContext) {
          socketOutput.textContent = 'Geolocation is blocked because this is not a secure context.';
          return;
        }
        if (!navigator.geolocation) {
          socketOutput.textContent = 'This browser does not expose geolocation.';
          return;
        }
        socketOutput.textContent = 'Waiting for phone location permission…';
        navigator.geolocation.getCurrentPosition(function (position) {
          rememberAndSendLocation(position.coords.latitude, position.coords.longitude, 'Phone');
        }, function (error) {
          socketOutput.textContent = 'Phone location failed/denied (' + error.code + '): ' + error.message;
          log('Geolocation unavailable', { code: error.code, message: error.message });
        }, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0
        });
      }

      function sendManualLocation() {
        if (!latitudeInput.value.trim() || !longitudeInput.value.trim()) {
          socketOutput.textContent = 'Enter both latitude and longitude before sending a manual location.';
          return;
        }
        rememberAndSendLocation(Number(latitudeInput.value), Number(longitudeInput.value), 'Manual');
      }

      function adminHeaders(includeJson) {
        var headers = { 'x-admin-password': adminPassword.value };
        if (includeJson) headers['content-type'] = 'application/json';
        return headers;
      }

      async function readForceState() {
        if (!adminPassword.value) {
          forceOutput.textContent = 'Enter the local ADMIN_PASSWORD first.';
          return;
        }
        try {
          var result = await jsonRequest('/api/admin/force-location', {
            method: 'GET',
            headers: adminHeaders(false)
          });
          log('HTTP GET /api/admin/force-location → ' + result.response.status, result.body);
          if (result.response.ok && result.body && Object.prototype.hasOwnProperty.call(result.body, 'forcePlaceId')) {
            forceEnabled.checked = Boolean(result.body.forcePlaceId);
            if (result.body.forcePlaceId) forcePlaceId.value = result.body.forcePlaceId;
          }
          forceOutput.textContent = (result.response.ok ? 'Force state: ' : 'Force read rejected: ') + format(result.body);
        } catch (error) {
          forceOutput.textContent = 'Force read failed: ' + error.message;
          log('Force read network error', error.message);
        }
      }

      async function applyForceState() {
        if (!adminPassword.value) {
          forceOutput.textContent = 'Enter the local ADMIN_PASSWORD first.';
          return;
        }
        var selectedId = forceEnabled.checked ? forcePlaceId.value.trim() : null;
        if (forceEnabled.checked && !selectedId) {
          forceOutput.textContent = 'Enter a place ID before enabling Force location.';
          return;
        }
        try {
          var result = await jsonRequest('/api/admin/force-location', {
            method: 'PUT',
            headers: adminHeaders(true),
            body: JSON.stringify({ forcePlaceId: selectedId })
          });
          log('HTTP PUT /api/admin/force-location → ' + result.response.status, result.body);
          forceOutput.textContent = (result.response.ok ? 'Force state applied: ' : 'Force update rejected: ') + format(result.body);
        } catch (error) {
          forceOutput.textContent = 'Force update failed: ' + error.message;
          log('Force update network error', error.message);
        }
      }

      function updateVisibility() {
        visibilityStatus.textContent = document.visibilityState;
        if (!autoVisibility.checked) return;
        sendFrame(document.visibilityState === 'hidden' ? 'away' : 'back', {});
      }

      var isSecure = window.isSecureContext && window.location.protocol === 'https:';
      secureStatus.textContent = isSecure ? 'YES' : 'NO';
      setState(secureStatus, isSecure ? 'ok' : '');
      originStatus.textContent = window.location.origin;
      visibilityStatus.textContent = document.visibilityState;
      tokenInput.value = readStoredToken();
      if (tokenInput.value) sessionOutput.textContent = 'Stored token found. Tap Validate session.';

      byId('registerButton').addEventListener('click', register);
      byId('validateButton').addEventListener('click', validateSession);
      byId('clearTokenButton').addEventListener('click', function () {
        closeSocket();
        storeToken('');
        sessionOutput.textContent = 'Local token cleared. The server session was not deleted.';
        log('Local session token cleared');
      });
      byId('connectButton').addEventListener('click', function () { connectSocket(false); });
      byId('closeButton').addEventListener('click', closeSocket);
      byId('awayButton').addEventListener('click', function () { sendFrame('away', {}); });
      byId('backButton').addEventListener('click', function () { sendFrame('back', {}); });
      byId('phoneLocationButton').addEventListener('click', requestPhoneLocation);
      byId('manualLocationButton').addEventListener('click', sendManualLocation);
      byId('readForceButton').addEventListener('click', readForceState);
      byId('applyForceButton').addEventListener('click', applyForceState);
      byId('clearLogButton').addEventListener('click', function () { eventLog.textContent = ''; });

      document.addEventListener('visibilitychange', updateVisibility);
      window.addEventListener('offline', function () { log('Browser reports network offline'); });
      window.addEventListener('online', function () {
        log('Browser reports network online');
        if (!socket && autoReconnect.checked && tokenInput.value) scheduleReconnect();
      });
    }());
  </script>
</body>
</html>`;

export function renderStage1Harness(nodeEnv) {
  if (nodeEnv !== 'development') {
    throw new Error('The Stage 1 test harness must never be rendered in production');
  }
  return STAGE1_HARNESS_HTML;
}

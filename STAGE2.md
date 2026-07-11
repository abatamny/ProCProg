# Stage 2: React app shell and mobile HTTPS test

Stage 2 adds the React/Vite mobile shell, nickname onboarding, returning
sessions, Force-aware entry, one-shot geolocation fallback, reconnect handling,
the collapsing place header, and the three-tab Paper & Ink navigation. It does
not add Knock composition, capture, media, bubbles, engraving, admin UI, or the
profile trail.

The phone sees one trusted HTTPS origin. Vite listens on the LAN and proxies
`/api` and `/ws` to Fastify over loopback HTTP:

```text
phone -> https://WINDOWS_LAN_IP:3443 -> Vite
                                      -> /api + /ws -> 127.0.0.1:3000
```

## 1. Install and verify

From the repository root:

```powershell
npm ci
npm test
npm run build:client
npm audit
```

The production client build is written to `client\dist` for nginx to serve in
the later deployment stage.

## 2. Prepare the trusted LAN certificate

Reuse the mkcert root installed during Stage 1. Replace the example IP with the
computer's actual Wi-Fi/Ethernet address:

```powershell
$lanIp = '192.168.1.23'
mkcert -install
New-Item -ItemType Directory -Force '.\.certs' | Out-Null
mkcert -cert-file '.\.certs\place-app.pem' `
  -key-file '.\.certs\place-app-key.pem' `
  localhost 127.0.0.1 '::1' $lanIp
```

From an Administrator PowerShell, allow only the local subnet to reach Vite:

```powershell
$ruleName = 'place-app Vite HTTPS 3443'
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $ruleName `
    -Direction Inbound -Action Allow -Protocol TCP `
    -LocalPort 3443 -RemoteAddress LocalSubnet -Profile Any
}
```

## 3. Start Fastify on loopback

Open terminal 1 in the repository root:

```powershell
$env:NODE_ENV = 'development'
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
$env:ENABLE_STAGE1_HARNESS = '0'
$env:TLS_CERT_PATH = ''
$env:TLS_KEY_PATH = ''
$env:FORCE_PLACE_ID = 'faculty-data-decision-sciences'

$bytes = New-Object byte[] 24
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$env:ADMIN_PASSWORD = [Convert]::ToBase64String($bytes)
$env:ADMIN_PASSWORD

npm run dev:server
```

Keep the printed admin password if you want to turn Force location OFF through
the existing admin API during testing.

## 4. Start the React client over HTTPS

Open terminal 2 in the repository root:

```powershell
$env:DEV_TLS_CERT_PATH = (Resolve-Path '.\.certs\place-app.pem').Path
$env:DEV_TLS_KEY_PATH = (Resolve-Path '.\.certs\place-app-key.pem').Path
$env:DEV_API_TARGET = 'http://127.0.0.1:3000'
npm run dev:client
```

## 5. Verify before opening a phone

Open terminal 3 and set the same LAN IP:

```powershell
$lanIp = '192.168.1.23'
$baseUrl = "https://${lanIp}:3443"
curl.exe --fail --show-error "$baseUrl/" -o NUL
$health = Invoke-RestMethod "$baseUrl/api/health"
if ($health.forcePlaceId -ne 'faculty-data-decision-sciences') {
  throw 'Force location is not ON'
}
Get-NetTCPConnection -State Listen -LocalPort 3000,3443 |
  Select-Object LocalAddress, LocalPort, State
```

Expected listeners:

- `3000` on `127.0.0.1` only.
- `3443` on `0.0.0.0`.

The phone opens only:

```text
https://YOUR_WINDOWS_LAN_IP:3443/
```

Never open port 3000, use `localhost` on the phone, or bypass certificate
validation with `-k`.

## 6. Phone certificate trust

Reuse the public mkcert root from `STAGE1.md`.

- iPhone/iPad: install the profile, then separately enable full trust under
  **Settings > General > About > Certificate Trust Settings**.
- Android: install it as a **CA certificate**, not a Wi-Fi/client certificate.

The browser must show no certificate warning. The app must be a secure context
before camera or geolocation checks are meaningful.

## 7. Stage 2 acceptance on iOS Safari and Android Chrome

### Force-on default

- [ ] Deny location for the browser before opening a fresh/private session.
- [ ] Welcome -> permissions -> nickname -> simple loading -> Explore works.
- [ ] The permissions screen says the demo already knows the room.
- [ ] No geolocation prompt appears.
- [ ] The header reads `Faculty of Data and Decision Sciences` and
      `inside Technion`.
- [ ] The live count is visible and stable.

### Registration and returning session

- [ ] Nicknames reject invalid characters and enforce 3–20 characters.
- [ ] A duplicate nickname shows the suggested variant.
- [ ] Reload and close/reopen return directly without nickname onboarding.
- [ ] Clearing the site token or using an invalid token returns to onboarding.

### Shell and realtime

- [ ] Explore is the default tab and is clay when active.
- [ ] Knock, Explore, and Profile swap panels without replacing header/nav.
- [ ] The header collapses smoothly after scrolling and expands at the top.
- [ ] The bottom nav clears the iPhone home indicator and Android gesture bar.
- [ ] Backgrounding for under 60 seconds never changes the count.
- [ ] Backgrounding for over 60 seconds decrements exactly once.
- [ ] Dropping and restoring Wi-Fi shows `Reconnecting…`, preserves content,
      and self-heals from a fresh `place_state`.

### Force-off fallback

Use the printed admin password from terminal 1:

```powershell
$adminPassword = 'PASTE_THE_PRINTED_VALUE'
Invoke-RestMethod `
  -Method Put `
  -Uri "$baseUrl/api/admin/force-location" `
  -Headers @{ 'x-admin-password' = $adminPassword } `
  -ContentType 'application/json' `
  -Body '{"forcePlaceId":null}'
```

- [ ] Connected clients leave the forced place and request location only when
      no cached real coordinate is available.
- [ ] Denial shows `Enable location to enter places` with Retry and no chrome.
- [ ] Outside shows `You are not in a mapped place yet.` with no chrome.
- [ ] A Faculty coordinate resolves Faculty; a campus-only coordinate resolves
      Technion.

Restarting Fastify reapplies the configured Faculty Force default for the demo.

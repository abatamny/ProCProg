# Stage 3: Knock mobile HTTPS test

Stage 3 adds realtime text knocks, nested audience routing, 24-hour history,
margin-note rendering, deterministic image pebbles, the ink media viewer,
notification dots, and the floating new-knocks pill. It does not add an image
upload endpoint: capture, WebP compression, optimistic uploads, and generated
media sizes belong to Stage 4.

## 1. Install and verify

From the repository root:

```powershell
npm ci
npm test
npm run build:client
```

The Knock integration test covers the exact `knock_send` / `knock_new`
protocol, 24-hour filtering, image metadata, invalid target rejection, and
Technion-to-Faculty delivery.

## 2. Reuse the trusted phone certificate

Use the mkcert certificate from `STAGE2.md`. Its names must include the
computer's current LAN IP. If the IP changed, regenerate the certificate with
the new address before testing.

## 3. Start Fastify

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

## 4. Start Vite over trusted HTTPS

Open terminal 2 in the repository root:

```powershell
$env:DEV_TLS_CERT_PATH = (Resolve-Path '.\.certs\place-app.pem').Path
$env:DEV_TLS_KEY_PATH = (Resolve-Path '.\.certs\place-app-key.pem').Path
$env:DEV_API_TARGET = 'http://127.0.0.1:3000'
npm run dev:client
```

## 5. Verify Force location and open the phones

Open terminal 3, replacing the example IP:

```powershell
$lanIp = '192.168.1.23'
$baseUrl = "https://${lanIp}:3443"
$health = Invoke-RestMethod "$baseUrl/api/health"
if ($health.forcePlaceId -ne 'faculty-data-decision-sciences') {
  throw 'Force location is not ON'
}
curl.exe --fail --show-error "$baseUrl/" -o NUL
```

On iOS Safari and Android Chrome, open:

```text
https://YOUR_WINDOWS_LAN_IP:3443/
```

Use a fresh/private session on each phone and choose different nicknames.

## 6. Stage 3 phone acceptance

### Composer and realtime

- [ ] Open Knock on both phones. The empty state uses a margin note, not a chat
      bubble.
- [ ] The audience chip defaults to Faculty of Data and Decision Sciences and
      shows its live count.
- [ ] Expanding the chip shows Faculty and Technion, with the parent layer
      indented differently and a live count for each.
- [ ] Send from iOS. The note appears once on both devices with
      `nickname · relative time` in small gray type.
- [ ] Send from Android. Both feeds update without a refresh.
- [ ] Choose Technion as the audience and send again. Both forced-Faculty users
      receive it because Faculty is contained by Technion.
- [ ] Switch one phone to Explore, then send from the other. Knock receives one
      green nav dot with no numeric badge; entering Knock clears it.

### Landing-edge behavior

- [ ] Create enough knocks to scroll the feed.
- [ ] Stay at the bottom while the other phone sends: the new note slides in
      and the feed follows it without a pill.
- [ ] Scroll upward, then send from the other phone: an ink pill says
      `1 new knock ↓`.
- [ ] Send two more while still scrolled away: the same pill becomes
      `3 new knocks ↓`.
- [ ] Tap the pill. It smooth-scrolls to the new notes and disappears.
- [ ] Repeat, but scroll to the bottom manually. The pill dismisses itself.

### Recovery and 24-hour rules

- [ ] Reload either phone. The complete current Knock history returns in the
      same oldest-to-newest order.
- [ ] Briefly disable and restore Wi-Fi. Existing notes remain visible under
      the reconnect banner; the fresh `place_state` does not duplicate them.
- [ ] Run `npm test`: the integration test proves a 25-hour-old note is absent
      and an unauthorized inner-layer target is not stored.

### Photo renderer boundary

The deterministic tilted ellipse, alternating river layout, dominant-color
placeholder, fullscreen melt-open viewer, caption/meta layout, swipe-down
close, left/right navigation, and next-image prefetch are implemented. A phone
cannot create a photo knock until Stage 4 supplies a valid `mediaId`; do not add
a temporary upload path just for this stage.

## 7. Force-off regression

Use the password printed in terminal 1:

```powershell
$adminPassword = 'PASTE_THE_PRINTED_VALUE'
Invoke-RestMethod `
  -Method Put `
  -Uri "$baseUrl/api/admin/force-location" `
  -Headers @{ 'x-admin-password' = $adminPassword } `
  -ContentType 'application/json' `
  -Body '{"forcePlaceId":null}'
```

- [ ] Location permission is requested only after Force is OFF.
- [ ] A Faculty coordinate still resolves the Faculty.
- [ ] A campus-only coordinate still resolves Technion.
- [ ] A user in Technion receives Technion knocks but does not receive a
      Faculty-only knock. This containment case is also covered automatically
      by `server/test/knocks.test.js`.

Restart Fastify to reapply the configured Faculty Force default.

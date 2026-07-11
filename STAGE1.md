# Stage 1: local HTTPS phone test

This is the non-product test procedure for the Stage 1 server. It uses a local
mkcert certificate so iOS Safari and Android Chrome treat geolocation and the
WebSocket connection as secure. Do not use this certificate for the live demo;
the deployed app must use nginx and a publicly trusted certificate from
certbot.

The Stage 1 harness is available only in development at:

```text
https://YOUR_WINDOWS_LAN_IP:3443/stage1-test
```

It exercises only Stage 1: secure-context detection, registration, returning
sessions, location, the exact WebSocket envelopes, presence grace, and the
Force-location setting. It is not part of the product UI and contains no CUT
features.

## 1. Install mkcert once

Open PowerShell. Install mkcert with one of its supported Windows package
managers.

Chocolatey, from an Administrator PowerShell:

```powershell
choco install mkcert -y
```

Or Scoop:

```powershell
scoop bucket add extras
scoop install mkcert
```

Then create and trust the local development CA:

```powershell
mkcert -install
```

If Windows reports access denied, repeat `mkcert -install` in an Administrator
PowerShell.

## 2. Find the correct LAN address

Run this in the repository root:

```powershell
Get-NetIPConfiguration |
  Where-Object { $_.NetAdapter.Status -eq 'Up' -and $_.IPv4DefaultGateway } |
  Select-Object InterfaceAlias, @{Name='IPv4';Expression={$_.IPv4Address.IPAddress}}, IPv4DefaultGateway
```

Choose the IPv4 address of the physical Wi-Fi or Ethernet adapter on the same
network as the phone. Do not choose Loopback, WSL, `vEthernet`, Docker, or a VPN
adapter. Set it explicitly; this example address must be replaced:

```powershell
$lanIp = '192.168.1.23'
```

Do not enter `localhost` on a phone: on a phone, `localhost` means the phone.

## 3. Generate the certificate

From the repository root:

```powershell
New-Item -ItemType Directory -Force '.\.certs' | Out-Null
mkcert -cert-file '.\.certs\place-app.pem' -key-file '.\.certs\place-app-key.pem' localhost 127.0.0.1 '::1' $lanIp
```

The exact LAN IP is now a Subject Alternative Name on the certificate. If DHCP
later gives the computer a different IP, set `$lanIp` again and rerun this
command. The phone's root CA does not need to be reinstalled when only the leaf
certificate is regenerated.

Never commit or share `.certs\place-app-key.pem`.

## 4. Allow the local port through Windows Firewall

Run this once in an Administrator PowerShell. It opens only TCP 3443 to the
local subnet:

```powershell
$ruleName = 'place-app dev HTTPS 3443'
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 3443 `
    -RemoteAddress LocalSubnet `
    -Profile Any
}
```

If Windows shows a Node.js firewall prompt instead, allow only private/local
networks.

## 5. Start Stage 1 over HTTPS

In a normal PowerShell, from the repository root:

```powershell
npm ci
$env:HOST = '0.0.0.0'
$env:PORT = '3443'
$env:NODE_ENV = 'development'
$env:ENABLE_STAGE1_HARNESS = '1'
$env:TLS_CERT_PATH = (Resolve-Path '.\.certs\place-app.pem').Path
$env:TLS_KEY_PATH = (Resolve-Path '.\.certs\place-app-key.pem').Path
$bytes = New-Object byte[] 24
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$env:ADMIN_PASSWORD = [Convert]::ToBase64String($bytes)
$env:ADMIN_PASSWORD
$env:FORCE_PLACE_ID = 'faculty-data-decision-sciences'
npm run dev
```

The printed random value is the password to enter in the harness. Generate a
new value for each local test session; do not replace it with a shared example
password.

`FORCE_PLACE_ID` is applied when the server starts, including when the local
database already exists. The harness's Force-location control can turn it OFF
for real-geolocation testing; the configured default is restored on restart.

Keep that terminal open. In a second PowerShell, reuse the same `$lanIp` value
and verify HTTPS without bypassing certificate checks:

```powershell
$lanIp = '192.168.1.23'
$baseUrl = "https://${lanIp}:3443"
curl.exe --fail --show-error "$baseUrl/api/health"
Get-NetTCPConnection -State Listen -LocalPort 3443 |
  Select-Object LocalAddress, LocalPort, State
```

Expected results:

- `/api/health` returns a successful JSON response.
- The listener address is `0.0.0.0` or `::`, not only `127.0.0.1`.
- Do not use `curl -k`; it would hide a certificate problem that the phones
  need fixed.

You can first inspect the harness on Windows:

```powershell
Start-Process "$baseUrl/stage1-test"
```

## 6. Transfer only the public root CA

Copy the public root certificate into the local certificate folder:

```powershell
$caRoot = (& mkcert -CAROOT).Trim()
Copy-Item -LiteralPath (Join-Path $caRoot 'rootCA.pem') -Destination '.\.certs\place-app-rootCA.crt' -Force
```

Transfer only `.certs\place-app-rootCA.crt` to each test phone using a cable,
AirDrop through another trusted device, or a private cloud/file transfer.

Never transfer or expose `rootCA-key.pem`. It can impersonate any HTTPS site to
devices that trust it. Do not serve the mkcert CA directory over HTTP because
that directory also contains this private key.

## 7. Trust it on iPhone or iPad

1. Open `place-app-rootCA.crt` on the device and allow the profile download.
2. Open **Settings > General > VPN & Device Management**. If Settings shows
   **Profile Downloaded**, that shortcut leads to the same place.
3. Select the mkcert profile and tap **Install**.
4. This second step is mandatory: open **Settings > General > About >
   Certificate Trust Settings** and enable full trust for the mkcert root.
5. Fully close and reopen Safari.
6. Open `https://YOUR_WINDOWS_LAN_IP:3443/stage1-test`.

Safari must show no certificate warning, and the harness must show **Secure
context: YES**. If location was denied earlier, use Safari's per-site Website
Settings to change Location back to Ask or Allow, and ensure Location Services
is enabled for Safari Websites.

## 8. Trust it on Android

Menu names vary slightly by manufacturer. On a current Pixel-style settings
screen:

1. Transfer and open `place-app-rootCA.crt`.
2. Open **Settings > Security & privacy > More security settings > Encryption
   & credentials > Install a certificate > CA certificate**. Searching Settings
   for `install certificate` is often quicker.
3. Select the `.crt` file. Choose **CA certificate**, not a Wi-Fi or user/client
   certificate. Android may require a screen lock before it permits this.
4. Fully close and reopen Chrome.
5. Open `https://YOUR_WINDOWS_LAN_IP:3443/stage1-test`.

Chrome must show no certificate warning, and the harness must show **Secure
context: YES**. If location was denied earlier, clear or change this origin's
permission under **Chrome > Settings > Site settings > Location**.

A managed school/work phone may forbid user-installed CAs or configure Chrome
not to honor them. Use an unmanaged test phone or the publicly trusted staging
server in that case.

## 9. Same-LAN failure checklist

Before debugging the app, verify all of these:

- Computer and phone are on the same non-guest SSID/VLAN.
- Guest/client/AP isolation is disabled; many campus and guest networks block
  devices from reaching one another even when the SSID name matches.
- Cellular data is temporarily off on the phone so the test proves Wi-Fi
  routing.
- VPNs are temporarily off on both devices.
- The URL contains the exact IP included when mkcert generated the certificate.
- The server is bound to `0.0.0.0`, and the TCP 3443 firewall rule exists.
- The computer's IP has not changed since certificate generation.
- Date and time are correct on both devices.

If local peer traffic is blocked by the venue network, use a private hotspot
for development testing. This is separate from the demo-day network plan.

## 10. Stage 1 acceptance checks

Use two browsers/devices with different nicknames. Keep one device visible as
the observer while backgrounding the other.

### HTTPS and protocol

- [ ] Both mobile browsers show no certificate warning.
- [ ] The harness reports `Secure context: YES` and an `https:` origin.
- [ ] Connecting reports a same-origin `wss://.../ws` URL.
- [ ] Every application message in the log is exactly `{type, payload}`.
- [ ] Leaving the page open for more than two heartbeat intervals does not
      disconnect it; browser ping/pong handling is automatic.

### Registration and returning session

- [ ] Register a unique 3–20 character alphanumeric/underscore nickname.
- [ ] A token is stored locally, but is redacted from the harness log.
- [ ] **Validate session** returns the same user through `GET /api/session`.
- [ ] Reload the page: the same token remains and validates without registering
      again.
- [ ] Register the same nickname on the second device: the server rejects the
      collision and supplies a variant suggestion.
- [ ] Register a distinct nickname on the second device for the remaining
      checks.

### Forced and real location

- [ ] Enter the local `ADMIN_PASSWORD`, read Force state, and turn Force ON for
      `faculty-data-decision-sciences`.
- [ ] With phone location denied and without sending a `location` frame,
      connect and authenticate. The server still places the user in Faculty of
      Data and Decision Sciences.
- [ ] `place_state` contains the Faculty place and the nested layer stack in
      inner-to-outer order: Faculty, then Technion.
- [ ] Turn Force OFF. At the Technion, use **Use phone location**; elsewhere,
      Force ON remains the reliable phone test. Manual latitude/longitude is
      available for a controlled polygon test.

### Presence and the 60-second grace

- [ ] With two distinct sessions visible, the absolute presence count includes
      both users and is broadcast at most once per second per place.
- [ ] Background one device for about 30 seconds and return. The observer's
      count never decrements.
- [ ] Background it again for at least 62 seconds. After the one-second
      broadcast window, the observer sees exactly one decrement.
- [ ] Bring it back. It is counted once, not once per reconnect/socket.
- [ ] The raw log shows `away` and `back` frames from the backgrounded device.

### Force relocation and reconnect

- [ ] While both sockets are open, change Force location. Both logs receive the
      exact `relocated` event with a place payload, without a page reload.
- [ ] Subscriptions and presence move to the forced place and retain the
      Faculty-to-Technion ancestor stack.
- [ ] Temporarily disable Wi-Fi, then restore it. The harness logs reconnect
      attempts with 1s, 2s, 4s backoff up to 15s.
- [ ] After reconnect it sends `auth` and, if phone/manual location was
      previously obtained, the last known `location`. With Force ON, `auth`
      alone restores the place. It then receives a fresh `place_state` that
      repairs the UI state.

## 11. Remove the development CA when finished

The mkcert root is intentionally powerful. Remove it from phones that no longer
need local development access:

- iOS/iPadOS: **Settings > General > VPN & Device Management**, select the
  mkcert profile, then **Remove Profile**.
- Android: **Settings > Security & privacy > More security settings >
  Encryption & credentials > Trusted credentials > User**, select the mkcert
  root, then remove it.

References: [mkcert mobile-device guidance](https://github.com/FiloSottile/mkcert),
[Apple manual certificate trust](https://support.apple.com/en-ie/102390), and
[Android advanced network settings](https://support.google.com/android/answer/9654714).

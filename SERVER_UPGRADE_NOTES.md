# Jood Orders Pro — Server upgrade notes

The front end now supports a compatibility mode for the existing Google Apps Script API and a stronger server mode when the backend exposes capabilities.

## Existing actions kept compatible
- `login`
- `summary`
- `getDashboardClients`
- `getClientModels`
- `getModelsByPrefix`
- `searchClients`
- `deliver`

## Recommended backend capabilities
Return a `capabilities` object from login, for example:

```json
{
  "ok": true,
  "user": "...",
  "role": "...",
  "token": "...",
  "capabilities": {
    "post": true,
    "secureSession": true,
    "reservations": true
  }
}
```

When enabled, the UI is prepared to call:
- `reserveStock(client, invoice, items, token)`
- `releaseReservation(client, invoice, model, token)`

## Security requirements for the backend
1. Validate the session/token on every read/write action.
2. Enforce authorization server-side; hiding UI buttons is not authorization.
3. Store password hashes, never plaintext passwords.
4. Prefer POST for login, delivery, reservation and other mutations.
5. Avoid placing passwords or sensitive data in URLs/query strings.
6. Add an audit log for delivery, reservation, release, deletion and edits.
7. Make reservation updates atomic to prevent two devices from reserving the same stock.

## Reservation compatibility mode
If the backend does not advertise `capabilities.reservations=true`, reservations are stored locally in the browser on that device. This keeps the current system usable but is not a multi-device stock lock. Central/atomic reservation requires the server changes above.

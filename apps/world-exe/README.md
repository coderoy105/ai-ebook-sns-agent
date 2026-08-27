# WORLD.EXE MVP

A browser-first Reality Runtime prototype.

## Working now
- Natural-language-like World Function compilation
- Place, radius, minimum-participant, weather, time, lifetime conditions
- Browser geolocation attachment
- Local participant check-ins and weather simulation
- Runtime state evaluation: SLEEPING → ALIVE
- Executable temporary action output
- Persistent functions with `localStorage`

## Production boundary
The MVP intentionally uses local check-ins instead of background crowd tracking. A production version should replace this layer with authenticated realtime presence, explicit opt-in geofencing, weather APIs, push notifications, and server-side trigger evaluation.

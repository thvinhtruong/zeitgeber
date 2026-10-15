# macOS menu-bar badge

## Goal

Show the currently running Zeitgeber task and its live elapsed time in the macOS menu bar.

## Approach

- Add a small Swift `NSStatusItem` companion under `macos/`.
- Poll the existing `GET /api/tasks` endpoint on localhost; do not duplicate timer state.
- Update the visible clock locally every second from the server-provided UTC start time.
- Add menu actions for opening the web tracker and quitting the companion.
- Document build/run commands and the localhost requirement.

## Verification

- Compile with `swiftc -framework Cocoa`.
- Start the Zeitgeber API and verify the endpoint response used by the companion.
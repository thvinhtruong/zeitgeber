#!/bin/zsh
set -euo pipefail

AGENT_ID="com.zeitgeber.menubar"
AGENT_PATH="$HOME/Library/LaunchAgents/$AGENT_ID.plist"
SERVER_ID="com.zeitgeber.server"
SERVER_PATH="$HOME/Library/LaunchAgents/$SERVER_ID.plist"

launchctl bootout "gui/$(id -u)" "$AGENT_PATH" 2>/dev/null || true
launchctl bootout "gui/$(id -u)" "$SERVER_PATH" 2>/dev/null || true
rm -f "$AGENT_PATH"
rm -f "$SERVER_PATH"
print "Zeitgeber background services removed."
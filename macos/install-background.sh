#!/bin/zsh
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
INSTALL_DIR="$HOME/Library/Application Support/Zeitgeber"
AGENT_DIR="$HOME/Library/LaunchAgents"
AGENT_ID="com.zeitgeber.menubar"
AGENT_PATH="$AGENT_DIR/$AGENT_ID.plist"

mkdir -p "$INSTALL_DIR" "$AGENT_DIR"
swiftc -framework Cocoa "$ROOT_DIR/macos/ZeitgeberMenuBar.swift" -o "$INSTALL_DIR/zeitgeber-menubar"

cat > "$AGENT_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$AGENT_ID</string>
  <key>ProgramArguments</key>
  <array>
    <string>$INSTALL_DIR/zeitgeber-menubar</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>$INSTALL_DIR/menubar.log</string>
  <key>StandardErrorPath</key>
  <string>$INSTALL_DIR/menubar.error.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$AGENT_PATH" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENT_PATH"
launchctl enable "gui/$(id -u)/$AGENT_ID"
print "Zeitgeber menu bar installed and started. Docker must be running."
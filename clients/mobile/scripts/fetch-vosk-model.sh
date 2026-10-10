#!/usr/bin/env sh
# Downloads the small English speech model used for on-device call transcripts and voice input, and unpacks it where the Android
# build packs it into the app. The model is not committed (about 68 MB unpacked). Run once before building the Android app.
set -eu
DEST="$(dirname "$0")/../android/app/src/main/assets/vosk-model-en"
URL="https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"
TMP="$(mktemp -d)"
curl -L -o "$TMP/model.zip" "$URL"
unzip -q "$TMP/model.zip" -d "$TMP"
mkdir -p "$DEST"
cp -r "$TMP"/vosk-model-small-en-us-0.15/* "$DEST"/
rm -rf "$TMP"
echo "Speech model installed in $DEST"

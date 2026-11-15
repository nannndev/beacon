#!/usr/bin/env bash
set -euo pipefail

REPO="${BEACON_REPO:-nannndev/beacon}"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
MODE="${1:-auto}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' not found." >&2
    exit 1
  fi
}

need_cmd curl

OS="$(uname -s)"
ARCH="$(uname -m)"

echo "==> Fetching latest Beacon release from ${REPO}..."
RELEASE_JSON="$(curl -fsSL "$API_URL")"

extract_url() {
  local pattern="$1"
  echo "$RELEASE_JSON" \
    | grep -oE '"browser_download_url":[[:space:]]*"[^"]+"' \
    | sed -E 's/.*"([^"]+)"/\1/' \
    | grep -E "$pattern" \
    | head -n 1 || true
}

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

case "$OS" in
  Darwin)
    DMG_URL="$(extract_url '\.dmg$')"
    if [ -z "$DMG_URL" ]; then
      echo "Error: could not find a macOS .dmg asset in the latest release." >&2
      exit 1
    fi
    DMG_PATH="${TMP_DIR}/Beacon.dmg"
    echo "==> Downloading ${DMG_URL}..."
    curl -fL --progress-bar "$DMG_URL" -o "$DMG_PATH"

    echo "==> Mounting DMG..."
    MOUNT_POINT="$(hdiutil attach -nobrowse -noautoopen "$DMG_PATH" | awk '/\/Volumes\// {print substr($0, index($0, "/Volumes/"))}' | head -n 1)"
    if [ -z "$MOUNT_POINT" ] || [ ! -d "${MOUNT_POINT}/Beacon.app" ]; then
      echo "Error: Beacon.app not found inside mounted DMG." >&2
      hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true
      exit 1
    fi

    echo "==> Installing Beacon.app to /Applications..."
    if [ -w "/Applications" ]; then
      rm -rf "/Applications/Beacon.app"
      cp -R "${MOUNT_POINT}/Beacon.app" "/Applications/Beacon.app"
    else
      sudo rm -rf "/Applications/Beacon.app"
      sudo cp -R "${MOUNT_POINT}/Beacon.app" "/Applications/Beacon.app"
    fi

    hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true
    xattr -dr com.apple.quarantine "/Applications/Beacon.app" >/dev/null 2>&1 || true

    CLI_BIN="/Applications/Beacon.app/Contents/MacOS/beacon_cli"
    if [ -x "$CLI_BIN" ]; then
      if [ -w "/usr/local/bin" ]; then
        ln -sf "$CLI_BIN" "/usr/local/bin/beacon"
        echo "==> Linked CLI: /usr/local/bin/beacon"
      else
        mkdir -p "${HOME}/.local/bin"
        ln -sf "$CLI_BIN" "${HOME}/.local/bin/beacon"
        echo "==> Linked CLI: ${HOME}/.local/bin/beacon"
      fi
    fi

    echo ""
    echo "Beacon installed to /Applications/Beacon.app"
    echo "Launch with: open -a Beacon"
    ;;

  Linux)
    if [ "$ARCH" != "x86_64" ] && [ "$ARCH" != "amd64" ]; then
      echo "Warning: prebuilt Linux assets target x86_64 (detected: ${ARCH})." >&2
    fi

    if [ "$MODE" = "--deb" ] || { [ "$MODE" = "auto" ] && command -v dpkg >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; }; then
      DEB_URL="$(extract_url '\.deb$')"
      if [ -z "$DEB_URL" ]; then
        echo "Error: could not find a .deb asset in the latest release." >&2
        exit 1
      fi
      DEB_PATH="${TMP_DIR}/beacon.deb"
      echo "==> Downloading ${DEB_URL}..."
      curl -fL --progress-bar "$DEB_URL" -o "$DEB_PATH"
      echo "==> Installing .deb package..."
      if [ "$(id -u)" -eq 0 ]; then
        dpkg -i "$DEB_PATH"
      else
        sudo dpkg -i "$DEB_PATH"
      fi
      echo "Beacon installed! Launch 'beacon' from your application menu."
    else
      APPIMAGE_URL="$(extract_url '\.AppImage$')"
      if [ -z "$APPIMAGE_URL" ]; then
        echo "Error: could not find an .AppImage asset in the latest release." >&2
        exit 1
      fi
      INSTALL_DIR="${HOME}/.local/bin"
      mkdir -p "$INSTALL_DIR"
      TARGET="${INSTALL_DIR}/Beacon.AppImage"
      echo "==> Downloading ${APPIMAGE_URL}..."
      curl -fL --progress-bar "$APPIMAGE_URL" -o "$TARGET"
      chmod +x "$TARGET"
      echo ""
      echo "Beacon AppImage installed to ${TARGET}"
      echo "Make sure ${INSTALL_DIR} is in your PATH, then run: Beacon.AppImage"
      echo "Tip: pass --deb to install the system .deb package instead."
    fi
    ;;

  *)
    echo "Unsupported OS: ${OS}. Use scripts/install.ps1 on Windows." >&2
    exit 1
    ;;
esac


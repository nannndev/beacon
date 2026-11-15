cask "beacon" do
  version "0.11.1"
  sha256 "c88d9ce32619fe04a9206b21cd4bc5aab9cae02a425e3e72a2c4784c2ff5c887"

  url "https://github.com/nannndev/beacon/releases/download/v#{version}/Beacon_#{version}_aarch64.dmg"
  name "Beacon"
  desc "Native Rust API workbench, load tester, AI Gateway, and MCP copilot"
  homepage "https://github.com/nannndev/beacon"

  depends_on arch: :arm64

  app "Beacon.app"
  binary "#{appdir}/Beacon.app/Contents/MacOS/beacon_cli", target: "beacon"

  caveats <<~EOS
    Beacon is currently unsigned on macOS.
    If Gatekeeper blocks first launch, run:
      xattr -dr com.apple.quarantine #{appdir}/Beacon.app
  EOS

  zap trash: [
    "~/Library/Application Support/com.beacon.app",
    "~/Library/Caches/com.beacon.app",
    "~/Library/Preferences/com.beacon.app.plist",
    "~/Library/Saved Application State/com.beacon.app.savedState",
  ]
end


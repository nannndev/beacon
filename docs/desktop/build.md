# Building Desktop from Source

See the main [Desktop](/desktop) page for overview.

## Full Build Steps (Windows example)

```bash
# 1. Install Rust
# https://rustup.rs/

# 2. Install Python dependencies + PyInstaller
cd backend
pip install -r requirements.txt
pip install pyinstaller

# 3. Build backend as sidecar
python build_backend.py

# 4. Copy binary
copy dist\backend.exe ..\frontend\src-tauri\backend.exe

# 5. Build Tauri app
cd ../frontend
npm run desktop:build
```

## Output Location

The final executable will be located at:

```
frontend/src-tauri/target/release/
```

## Development

```bash
cd frontend
npm run tauri dev
```

This opens a native window with hot reload.

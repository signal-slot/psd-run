#!/bin/bash
set -e

# Build PSD Run WASM module using Qt for WebAssembly

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/.target/wasm"
OUTPUT_DIR="${SCRIPT_DIR}/public/wasm"

# Check for Qt WASM installation
if [ -z "$QT_WASM_PATH" ]; then
    # Search common locations
    for base_dir in "$HOME/io/qt/release/6" "$HOME/Qt/6.10.0" "$HOME/Qt/6.9.0" "$HOME/Qt/6.8.3" "$HOME/Qt/6.8.2" "$HOME/Qt/6.8.1" "$HOME/Qt/6.8.0"; do
        for wasm_type in wasm_singlethread wasm_multithread; do
            candidate="$base_dir/$wasm_type"
            if [ -d "$candidate" ]; then
                QT_WASM_PATH="$candidate"
                break 2
            fi
        done
    done
    if [ -z "$QT_WASM_PATH" ]; then
        echo "Error: Qt for WebAssembly not found."
        echo "Set QT_WASM_PATH environment variable or install Qt for WebAssembly."
        exit 1
    fi
fi

echo "Using Qt WASM at: $QT_WASM_PATH"

# Auto-detect and activate emsdk if emcc is not in PATH
if ! command -v emcc &> /dev/null; then
    EMSDK_DIR=""
    # Check common locations
    for candidate in \
        "$HOME/com/github/emscripten-core/emsdk" \
        "$HOME/emsdk" \
        "/opt/emsdk" \
        "$HOME/.local/share/emsdk"; do
        if [ -f "$candidate/emsdk_env.sh" ]; then
            EMSDK_DIR="$candidate"
            break
        fi
    done

    if [ -n "$EMSDK_DIR" ]; then
        echo "Activating emsdk from: $EMSDK_DIR"
        source "$EMSDK_DIR/emsdk_env.sh" 2>/dev/null
    fi

    if ! command -v emcc &> /dev/null; then
        echo "Error: Emscripten not found. Please activate emsdk first:"
        echo "  source ~/com/github/emscripten-core/emsdk/emsdk_env.sh"
        exit 1
    fi
fi

echo "Using Emscripten: $(emcc --version | head -n1)"

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

echo "Configuring..."
"$QT_WASM_PATH/bin/qt-cmake" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_PREFIX_PATH="$QT_WASM_PATH" \
    "$SCRIPT_DIR"

echo "Building..."
cmake --build . --target psdrun_qt --parallel

mkdir -p "$OUTPUT_DIR"

# Main thread Qt module
cp psdrun_qt.js "$OUTPUT_DIR/" 2>/dev/null || true
cp psdrun_qt.wasm "$OUTPUT_DIR/" 2>/dev/null || true

echo "Build complete. Output in: $OUTPUT_DIR"
ls -la "$OUTPUT_DIR"

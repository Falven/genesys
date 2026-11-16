#!/bin/sh
set -eu

# Pass the unpacked llvm-mingw 20261104 UCRT toolchain directory.
toolchain=${1:?Usage: build.sh /absolute/path/to/llvm-mingw-20261104-ucrt-HOST}
native_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

build() {
  "$toolchain/bin/$1-w64-mingw32-clang" \
    -std=c11 -O2 -Wall -Wextra -Werror \
    -D_WIN32_WINNT=0x0A00 -DUNICODE -D_UNICODE \
    -static -s -Wl,--no-insert-timestamp \
    "$native_dir/owned-process-win32.c" \
    -o "$native_dir/owned-process-win32-$2.exe" -lkernel32 -luser32
}

build x86_64 x64
build aarch64 arm64

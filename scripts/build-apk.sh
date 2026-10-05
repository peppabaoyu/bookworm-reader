#!/bin/bash
# 书虫 - 安卓 APK 构建 (无需 Gradle: aapt2 + javac + d8 + apksigner)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/.android-tools"
BUILD="$ROOT/android/build"

echo "=== 1. 准备构建工具 ==="
if [ ! -d "$TOOLS/jdk" ]; then
  if [ -f "$TOOLS/jdk17-tuna.zip" ]; then SRC="$TOOLS/jdk17-tuna.zip"; else SRC="$TOOLS/jdk17.zip"; fi
  echo "解压 JDK..."
  (cd "$TOOLS" && unzip -q "$SRC")
  mv "$TOOLS"/jdk-17* "$TOOLS/jdk"
fi
if [ ! -d "$TOOLS/bt" ]; then
  echo "解压 build-tools..."
  (cd "$TOOLS" && unzip -q build-tools.zip)
  BTDIR=$(find "$TOOLS" -maxdepth 2 -name "aapt2.exe" | head -1 | xargs dirname)
  mv "$BTDIR" "$TOOLS/bt"
fi
if [ ! -d "$TOOLS/plat" ]; then
  echo "解压 platform..."
  (cd "$TOOLS" && unzip -q platform.zip)
  PLATDIR=$(find "$TOOLS" -maxdepth 2 -name "android.jar" | head -1 | xargs dirname)
  mv "$PLATDIR" "$TOOLS/plat"
fi

JDK=$(find "$TOOLS/jdk" -maxdepth 2 -name "javac.exe" | head -1 | xargs dirname)
BT="$TOOLS/bt"
PLAT="$TOOLS/plat"
AJAR="$PLAT/android.jar"
export PATH="$JDK:$PATH"

echo "JDK: $JDK"
java -version 2>&1 | head -1

echo "=== 2. 组装资源 ==="
mkdir -p "$ROOT/android/res/drawable" "$ROOT/android/assets"
cp "$ROOT/assets/icon.png" "$ROOT/android/res/drawable/icon.png"
rm -rf "$ROOT/android/assets/app"
mkdir -p "$ROOT/android/assets/app"
cp -r "$ROOT/app/index.html" "$ROOT/app/version.js" "$ROOT/app/css" "$ROOT/app/js" "$ROOT/android/assets/app/"

rm -rf "$BUILD"
mkdir -p "$BUILD/classes" "$BUILD/dex"

echo "=== 3. aapt2 编译链接 ==="
"$BT/aapt2.exe" compile --dir "$ROOT/android/res" -o "$BUILD/res.zip"
# 注意: 不用 -A 打包 assets — Windows 版 aapt2 会写入反斜杠路径, 安卓无法读取; 改用 jar 补写
"$BT/aapt2.exe" link -o "$BUILD/base.apk" -I "$AJAR" \
  --manifest "$ROOT/android/AndroidManifest.xml" \
  --auto-add-overlay \
  "$BUILD/res.zip"

echo "=== 4. 编译 Java ==="
javac --release 11 -encoding UTF-8 -cp "$AJAR" -d "$BUILD/classes" $(find "$ROOT/android/java" -name "*.java")

echo "=== 5. d8 转 dex ==="
java -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 --release --lib "$AJAR" --output "$BUILD/dex" $(find "$BUILD/classes" -name "*.class")

echo "=== 6. 打包 assets + dex 进 APK (jar 使用正斜杠路径) ==="
mkdir -p "$BUILD/astage/assets"
rm -rf "$BUILD/astage/assets/app"
cp -r "$ROOT/android/assets/app" "$BUILD/astage/assets/app"
(cd "$BUILD/astage" && jar uf "$BUILD/base.apk" assets)
(cd "$BUILD/dex" && jar uf "$BUILD/base.apk" classes.dex)

echo "=== 7. 对齐 + 签名 ==="
"$BT/zipalign.exe" -f 4 "$BUILD/base.apk" "$BUILD/aligned.apk"
if [ ! -f "$TOOLS/debug.keystore" ]; then
  keytool -genkeypair -v -keystore "$TOOLS/debug.keystore" -alias bookworm \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass bookworm123 -keypass bookworm123 \
    -dname "CN=Bookworm,O=Dionysus,C=CN" 2>&1 | tail -1
fi
mkdir -p "$ROOT/dist"
java -jar "$BT/lib/apksigner.jar" sign \
  --ks "$TOOLS/debug.keystore" --ks-pass pass:bookworm123 --key-pass pass:bookworm123 \
  --out "$ROOT/dist/书虫.apk" "$BUILD/aligned.apk"

java -jar "$BT/lib/apksigner.jar" verify --print-certs "$ROOT/dist/书虫.apk" | head -2
echo "=== 完成: dist/书虫.apk ($(du -h "$ROOT/dist/书虫.apk" | cut -f1)) ==="

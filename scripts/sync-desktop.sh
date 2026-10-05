#!/bin/bash
# 书虫 - 桌面同步脚本: 优雅关闭旧版 -> 等待 -> 强杀 -> 替换 exe
set -e
DESK="D:/Desktop"
SRC="$(dirname "$0")/../dist/书虫.exe"

if [ ! -f "$SRC" ]; then echo "错误: 未找到 $SRC, 请先运行 npm run dist"; exit 1; fi

echo "=== 关闭运行中的书虫 (优雅) ==="
taskkill //IM "书虫.exe" 2>/dev/null || echo "(未在运行)"
sleep 3
if tasklist 2>/dev/null | grep -q "书虫.exe"; then
  echo "=== 仍在运行, 强制关闭 ==="
  taskkill //F //IM "书虫.exe" 2>/dev/null || true
  sleep 1
fi

echo "=== 同步最新版到桌面 ==="
rm -f "$DESK/书虫.exe"
cp "$SRC" "$DESK/书虫.exe"
node -e "const fs=require('fs');const a=fs.statSync(process.argv[1]),b=fs.statSync(process.argv[2]);if(a.size!==b.size){console.error('大小不一致!');process.exit(1)}console.log('校验一致:',b.size,'bytes')" "$SRC" "$DESK/书虫.exe"
echo "=== 完成: $DESK/书虫.exe ==="

#!/usr/bin/env bash
# Build a dev VSIX with a distinct name/icon so it can be installed alongside production.
# Usage: ./scripts/package-dev.sh [--install]
set -euo pipefail
cd "$(dirname "$0")/.."

# 1. Generate dev icon (orange DEV banner) if missing
if [ ! -f resources/icon-dev.png ]; then
  python3 -c "
from PIL import Image, ImageDraw, ImageFont
img = Image.open('resources/icon.png').convert('RGBA')
overlay = Image.new('RGBA', img.size, (0,0,0,0))
draw = ImageDraw.Draw(overlay)
w, h = img.size
banner_h = h // 5
draw.rectangle([0, h-banner_h, w, h], fill=(255,140,0,220))
font_size = banner_h - 10
try:
    font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', font_size)
except Exception:
    font = ImageFont.load_default()
bbox = draw.textbbox((0,0), 'DEV', font=font)
tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
draw.text(((w-tw)/2, h-banner_h+(banner_h-th)/2-4), 'DEV', fill=(255,255,255,255), font=font)
Image.alpha_composite(img, overlay).save('resources/icon-dev.png')
print('Generated resources/icon-dev.png')
"
fi

# 2. Patch package.json for dev build
cp package.json package.json.bak
node -e "
const pkg = require('./package.json');
pkg.name = 'hydra-code-dev';
pkg.displayName = 'Hydra (dev)';
pkg.version = '0.0.0-dev';
pkg.icon = 'resources/icon-dev.png';
pkg.contributes.viewsContainers.activitybar[0].title = 'Hydra (dev)';
require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# 3. Package
vsce package --no-git-tag-version --no-update-package-json

# 4. Restore original package.json
mv package.json.bak package.json

echo ""
echo "Built: hydra-code-dev-0.0.0-dev.vsix"

# 5. Optionally install
if [ "${1:-}" = "--install" ]; then
  code --install-extension hydra-code-dev-0.0.0-dev.vsix
  echo "Installed. Disable production Hydra Code and reload VS Code."
fi

#!/bin/sh
# Draws the surface screens the simulator can project, from the reference HTML
# in the docs repository. Each page is laid out at 1920x1080 and drawn at
# two-thirds scale, so the PNG is exactly the projector's 1280x720 panel.
set -e
cd "$(dirname "$0")"
pages=$(cd ../docs/design/reference/2026-10-v2/html && pwd)
mkdir -p public/screens

# the time budget lets the web fonts arrive before the screenshot is taken
render() {
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --headless --hide-scrollbars --window-size=1920,1080 \
    --force-device-scale-factor=0.6666667 --virtual-time-budget=10000 \
    --screenshot="$PWD/public/screens/$2.png" "file://$pages/$1.html"
}

render SurfaceList2 list-dark
render SurfaceList2-Aijiro list-light
render SurfaceRecipe2 recipe-dark
render SurfaceRecipe2-Aijiro recipe-light

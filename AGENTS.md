# Projector sim

A browser simulator for turning the team's 720p projector into a short-throw projector that lights a kitchen countertop, by trying different projector positions and externally placed mirrors. It shows where the picture lands, how keystoned it is, how bright it is, how blurred it is, and what digital keystone correction costs.

The rules in `../AGENTS.md` apply here too. This file only adds what is specific to this project.

## Decisions already made by the owner

Do not reopen these without being asked.

- Bare bones on purpose: it has to work, not look good. Add nothing that was not requested.
- Plain JavaScript with three.js from a CDN, no build step, no `package.json`, no TypeScript. This knowingly departs from the strict-typing rule in `../AGENTS.md`.
- Centimeters and degrees everywhere.
- Scenes live in a Firebase Realtime Database and are edited live by everyone who has the scene open (at most 4 people). There is no save button; every change is written as it happens.
- No login. Anyone with the site URL can read and change scenes.
- Hosted on Firebase Hosting. Not a Claude artifact.
- Mirrors are flat or spherical (convex or concave).
- Digital keystone is horizontal and vertical sliders only, and must show the pixels it costs.
- Brightness is entered as ANSI lumens; results are lumens reaching the picture, lux, and visible dimming.
- The scene has a projector, mirrors, a countertop and an optional back wall. Not included, by choice: the projector body blocking light, other blocker boxes, a custom image upload, ambient light, countertop colour.
- Focus blur is geometric only: light leaves from across a lens opening of a set diameter and meets at the focus distance. Not included, by choice: lens flaws, diffraction, and any limit on how near or far the lens can focus.
- Auto focus is on by default and picks the focus distance with the least overall blur over the picture on the counter. Unticking it uses the typed focus distance.
- Blur must show both in the picture and as numbers, in panel pixels and in mm.
- The projected picture is picked from a built-in list in a dropdown and saved in the scene, so it changes for everyone who has that scene open. The list is the test pattern plus the surface's recipe list (saved) and recipe view (default), each in dark and light. Not included, by choice: the surface's other nine states and the mobile screens.
- The surface screens are PNG files made from the reference HTML in `../docs` by `render-screens.sh`. The 1920 x 1080 design is drawn sharp at two-thirds scale straight onto the 1280 x 720 panel, as if the Pi outputs 720p. It is not rendered at 1080p and shrunk.

## Run and deploy

- Run locally: `python3 -m http.server -d public`, then open `http://localhost:8000`. It needs `databaseUrl` set in `public/config.js`.
- Deploy: `npx firebase-tools deploy` (pushes `public/` to Hosting and `database.rules.json` to the database). One-time: `npx firebase-tools login`, and a `.firebaserc` naming the project.
- Format: `npx prettier@3 --write "public/*.js" public/index.html`.
- Re-render the surface screens: `./render-screens.sh`. It needs Google Chrome at its macOS path, the `docs` repository beside this one, and a network connection for the Google Fonts the pages load. Now and then Google Fonts serves a differently built font file that moves letters by a fraction of a pixel, so a re-render can change the PNG files with nothing visibly different.

### Firebase setup state

Live at `https://projector-simulation.web.app`. The Firebase project is `projector-simulation`, set in `.firebaserc`, and its database URL is in `public/config.js`. The deployed rules allow anyone to read and write under `scenes` and nothing else. Deploying leaves a `.firebase/` cache folder, which is safe to delete. The site has no favicon, so browsers log one harmless 404. A custom domain has not been connected.

## Files

- `public/index.html`: page skeleton, styles, and the import map that pins three.js and the Firebase SDK versions.
- `public/config.js`: the database URL.
- `public/main.js`: Firebase subscription, scene list, the side panel (field definitions, object list, results text). The database is the single source of truth: every edit is written straight to it and the `onValue` callback redraws everything, for local and remote edits alike.
- `public/view.js`: the three.js view: objects, drag handles, click-to-select, camera, the chosen picture, the two render passes, and the shader change that blurs the picture.
- `public/light.js`: traces the grid of rays and produces the lit triangles, beam lines, and the brightness, focus and blur numbers.
- `public/trace.js`: one ray against the mirrors, counter and wall.
- `public/keystone.js`: where digital keystone puts the picture inside the panel.
- `public/pattern.js`: the built-in test picture.
- `public/screens/`: the surface screens the projector can show, as 1280 x 720 PNG files. Made by `render-screens.sh`, not by hand.
- `render-screens.sh`: draws those PNG files from the reference HTML in `../docs`. To add a screen, add a `render` line there and an `<option>` with the same name to the dropdown in `public/index.html`.
- `firebase.json`, `database.rules.json`: Hosting and database rules.

## How the model works

- Axes: X right, Y up, Z toward the person standing at the counter. The countertop's top surface is the plane y = 0, centred on the origin. The back wall is the plane at the counter's back edge (z = -depth / 2).
- Pose: `x y z` plus `yaw pitch roll` in degrees, applied in Euler order YXZ. With all angles 0 the projector looks along -Z and a mirror's reflective side faces +Z. A projector aimed straight down has pitch -90; a mirror facing straight down has pitch 90.
- Projector optics: half-width tangent = 0.5 / throw ratio, 16:9. Lens offset is a percentage of half the picture height: 0 centres the picture on the lens axis, 100 puts its bottom edge on the axis.
- Light: a 160 x 90 grid of rays leaves the lens. Each ray bounces off mirror fronts (losing reflectivity each time), is absorbed by mirror backs, and stops on the counter or wall plane. Grid cells whose four corners took the same route become two lit triangles; cells that straddle a mirror edge are split twice more and otherwise dropped.
- The tracer treats the counter and wall as unbounded planes. The view clips the lit triangles to the real edges with clipping planes, and the numbers only count cells whose centre is on the counter.
- Brightness: every panel pixel carries equal light. A cell's lux is its share of the lumens, times mirror reflectivities, divided by the area it covers. Triangles are shaded by lux / "lux drawn as full white".
- Focus: the lens is sharp on a plane square to its axis, the focus distance in front of it. Light from one pixel leaves from every point of the lens opening (a disc centred on the lens position) aimed at that pixel's point on the focus plane, so on a surface nearer or farther it lands as a spot. With no mirrors the spot is opening x |1 - distance / focus distance| across.
- Blur is worked out to first order around each grid ray. The ray is traced twice more from 0.01 cm beside the lens centre, sideways and upward (the other way if that side crosses a mirror edge). How far those land from it, set against how far neighbouring pixels land, gives the spot as an ellipse in panel uv per cm of opening; focusing at distance D shrinks both axes by 1 / (2 D x half-angle tangent). This follows curved mirrors, including blur that is wider one way than the other. Against brute-force rays it is exact for flat mirrors and within about 10% for a 3 cm opening on a 50 cm radius mirror.
- Auto focus is the focus distance with the least mean square blur, in panel pixels and weighted by panel area, over the same cells the brightness numbers count. It has a closed form. If the best focus would be beyond infinity it stays at infinity; if none of the picture is on the counter the typed focus distance is used.
- Every lit triangle carries its blur ellipse, and the shader draws the average of 32 samples of the panel spread over it. The blur numbers are the ellipse's longest width, in panel pixels and in mm on the counter.
- Blur changes nothing else: brightness numbers ignore it, a pixel whose spot straddles a mirror edge is not dimmed, and light does not spill past the edge of the lit patch.
- Spherical mirrors are a sphere of the given radius with its apex at the mirror's position, cut to the width x height rectangle. Positive radius is convex.
- Digital keystone: the H and V angles describe a screen tilted relative to the lens axis. The picture is the largest 16:9 rectangle inside the panel's footprint on that screen, mapped back into the panel as a quad. V = +20 exactly corrects a projector pitched 20 degrees up from perpendicular to its surface; H = +20 one yawed 20 degrees left.
- Pixel loss is real, not estimated: the chosen picture is first rendered into a 1280 x 720 target through the keystone quad (black outside it), and that target is what gets projected. Flips mirror the picture inside the quad and cost nothing.
- The chosen picture only changes what is drawn. The brightness, focus and blur numbers are the same for every picture and describe a panel showing full white.

## Data

Everything is under `scenes/<id>` in the database, where `<id>` is also the URL hash, so a link opens a specific scene.

```
name
projector: x y z yaw pitch roll throwRatio offset lumens aperture focus autoFocus keystoneV keystoneH flipH flipV picture bodyW bodyH bodyD
room:      counterW counterD wallOn wallH whiteLux
mirrors/<id>: type ("flat" | "spherical") x y z yaw pitch roll width height reflectivity [radius]
```

The database drops empty objects, so a scene with no mirrors has no `mirrors` key.

`picture` is `pattern` for the test pattern, or the name of a PNG file in `public/screens/`: `list-dark`, `list-light`, `recipe-dark` or `recipe-light`.

Scenes saved before focus was modelled have no `aperture`, `focus` or `autoFocus`. `render` in `public/main.js` fills them in from `focusDefaults` when a scene is read and writes nothing. Scenes saved before the picture could be chosen have no `picture`, and `render` fills in `pattern` the same way.

## Projector: Emotn C1 (Dangbei)

Defaults for a new database are in `onScenes` in `public/main.js`.

- Throw ratio 1.36: confirmed by ProjectorCentral and by Dangbei's own distance table (80 in at 7.87 ft).
- Native 1280 x 720, 16:9, single LCD, no lens shift.
- 130 ANSI lumens: from Projector-Database only, unverified. The advertised "8500 lumens" is not an ANSI figure.
- Body 22.5 x 18.6 x 10.9 cm: from one source, and which number is width, depth or height is a guess. The body is only drawn for reference; it does not block light.
- Lens offset: not published anywhere. The default 0 is a placeholder the owner chose, and the field is labelled "NOT MEASURED YET". Once the owner measures it, update the default and remove that wording from the label.
- Lens opening diameter: not published anywhere. The default 3 cm is a guess the owner chose, and the field is labelled "NOT MEASURED YET". Once the owner measures it, update the default and remove that wording from the label.
- Focus is a manual ring. The published projection distance is 135 to 600 cm (user manual) or 150 to 360 cm (Dangbei's store page). Whether the ring focuses nearer than that is not published, and the simulator does not limit it.
- The C1's built-in keystone is manual, vertical only, about ±15 degrees. The H and V sliders here model correction done in software, not that control.
- Other placeholders with no source: counter 150 x 63.5 cm, wall 45 cm, new mirror 20 x 15 cm at 90% reflectivity, spherical radius 50 cm.

## Checking changes

There are no tests in the repo, by the rules in `../AGENTS.md`. To check a change, run scripts from a scratch folder outside the project:

- Maths: copy `trace.js`, `keystone.js` and `light.js` next to an `npm i three@0.170.0` and call `castLight` from Node. Known answers: straight down from 80 cm gives a 58.82 x 33.09 cm picture at 667.9 lux; a projector pitched to -70 with keystone V 20 gives a true rectangle; straight down from 80 cm with a 3 cm opening gives focus 80 cm and no blur on auto focus, and a 6.0 mm, 13.06 pixel spot everywhere with focus typed as 100 cm.
- Page: `npx firebase-tools@13.35.1 emulators:start --only database --project demo-projector-sim` gives a local database at `http://127.0.0.1:9000/?ns=demo-projector-sim-default-rtdb` (version 13 because newer releases need Java 21; the `-default-rtdb` name is the one the rules file is applied to). Drive the page with Playwright, overriding the `config.js` request to return that URL rather than editing the file.

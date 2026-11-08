# Coast

Coast is a procedurally generated Mediterranean island, rendered in the browser with Three.js. The island runs without end to the east and west and is between 0.9 and 3 km wide; where it is wide, a range of bare limestone mountains up to about 700 m high runs along its interior. Its villages are laid out from the rules of medieval hill towns along a coastal belt, and open country, olive groves, harbours and a coastal railway lie between them. Ferries run from the mainland harbours to smaller offshore islands, scattered between 0.3 and 3.5 km out to sea, sailing boats pass along the coast, and the day passes from dawn to night in twelve minutes. The world repeats every 15.84 km from north to south, so that whoever goes far enough out to sea to the north arrives from the open sea at the south shore, and the other way about; the join lies 7.92 km from the middle of the island, beyond the furthest offshore island, the fog and the outermost ring of blocks. From high above only one island is drawn, the copy nearest the camera.

The program is contained in `index.html`, apart from the cat in `cat/`. There is no build step and there are no local dependencies.

Coast may be played at <https://invertedworld.itch.io/coast>. The user guide is in [`docs/user-guide.md`](docs/user-guide.md); this document describes the design of the program.

## Contents of the repository

| Path | Description |
|---|---|
| `index.html` | The complete program: markup, styles and one JavaScript module (about 11,000 lines). |
| `docs/user-guide.md` | The user guide, which describes how the island is explored and how each control behaves. |
| `LICENSE` | The MIT licence under which the program, its documentation and its sounds are published. |
| `CONTRIBUTING.md` | How to run, change and submit changes to the program. |
| `cat/` | The cat from Michi-Neko: The Cat Philosopher's Path by c1t1zen1, under the MIT licence (`cat/LICENSE`). See `cat/README.md`. |
| `photo/` | The camera for taking pictures (K): the lens, depth of field, exposure and the controls on the screen (`camera.js`), the gallery and artist mode (`gallery.js`), the painted styles (`effects.js`) and the path tracer (`pathtrace.js`), with the API for picture effects, `window.__village.photo` (documented at the top of `photo/camera.js`). |
| `sounds.json` | Maps sound identifiers to audio files (see [Sound](#sound)). |
| `sounds/` | The audio files that `sounds.json` names. |
| `publish-site.sh` | Publishes the game to markhammond.me (see [Publishing](#publishing)). |
| `deploy-itch.sh` | Publishes the game to itch.io with butler (see [Publishing](#publishing)). |
| `testbench/seagulls.html` | A stand-alone page for developing the gulls (see [Gulls](#gulls)). |
| `testbench/sailing.html` | A stand-alone page for developing the dinghy and the wind, with a harbour, a beach and a cove (see [Sailing](#sailing)). |
| `testbench/diving.html` | A stand-alone page for developing swimming and diving, with a beach, a rocky point, a short quay, the dinghy and the seabed to 20 m (see [Swimming and diving](#swimming-and-diving)). |
| `testbench/trees.html` | A stand-alone page for developing the trees and plants, in the game's palette, daylight and fog: each species between an olive and a cypress, seen from 3 m or 15 m at any level of detail, and in groups in a garden, a piazza, open country, a wild hillside and on a clifftop (see [Trees and plants](#trees-and-plants)). |

## Running the program

The page must be served over HTTP, because the browser refuses to load the module and the audio files from a `file://` address. Any static server will do, for example:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

The scene is then available at <http://127.0.0.1:8765/>. Three.js r160 is loaded from `cdn.jsdelivr.net` and the fonts (Marcellus and Alegreya Sans) from Google Fonts, so an internet connection is required on first load.

When `index.html` has been edited, the browser may serve a cached copy. A query string such as `?v=51` forces a fresh load.

## Publishing

The game is published at markhammond.me from a copy in `play/coast/` of the site's repository (`~/code/markhammond.me`). `publish-site.sh [commit]` exports `index.html`, `sounds.json`, `sounds/` and `cat/` from a commit (by default `HEAD`), points the page at the site's own copies of three.js (`vendor/three/`) and of the fonts (`fonts/`) so that it loads nothing from other sites, and copies the result into `play/coast/`. If that changes anything, it commits `play/coast/` alone on the branch checked out in the site's repository, and pushes that branch to itself and to `master`, from which the site's GitHub Action deploys to Cloudflare within a minute or two. Any other commits on that branch that are not yet on `master` are published with it.

A `pre-push` hook in `.git/hooks/` runs the script whenever `main` is pushed, so pushing the game publishes it. Git does not copy hooks with a repository; on a new clone the hook is installed again with:

```sh
printf '#!/usr/bin/env bash\nwhile read -r l s r o; do [ "$r" = refs/heads/main ] && [ "$s" != 0000000000000000000000000000000000000000 ] && { "$(git rev-parse --show-toplevel)/publish-site.sh" "$s" || echo "publishing failed" >&2; }; done; exit 0\n' > .git/hooks/pre-push && chmod +x .git/hooks/pre-push
```

A failure to publish is reported but does not stop the push of this repository. The testbenches and the source recordings in `village sounds/` are not published.

The game is published to itch.io (https://invertedworld.itch.io/coast) by `deploy-itch.sh [commit] [version]`, which exports the same files from a commit, points them at the copies of three.js and the fonts kept in the site's repository (`play/coast/vendor` and `fonts`), and pushes the folder with butler to the `html5` channel of `invertedworld/coast`, the version shown on itch being a UTC timestamp unless one is given. It is run by hand; the itch app's own copy of butler is used when butler is not on the path, and `butler login` is needed once on a new machine.

## Controls

The panel opened with **H** lists the controls. They are reproduced here for reference.

| Key | Action |
|---|---|
| W A S D | Walk |
| Shift | Run |
| Space | Jumps. Jumping at a wall, a ledge or the eaves of a roof whose top is within reach climbs onto it. See [Roofs and climbing](#roofs-and-climbing). |
| Z | Crouches, or stands up again. Crouching at street level lowers the eye from 1.62 m to 0.95 m and slows walking and running to 45 per cent. |
| Mouse | Look. A click captures the mouse and Esc releases it. |
| X | Sits down on the nearest free seat within 1.5 m that the player is turned towards, or stands up again. A step with W A S D also stands the player up. See [Sitting](#sitting). |
| Q E | Turn |
| V | Switches between street level and the bird's-eye view. The bird's-eye view always opens at a low height (`dist = 45`), whatever the zoom was before. Moving over lower ground does not bring the view down; it rises only to keep clear of higher ground. While riding a train or a ferry, V steps off. |
| + − | Zoom the bird's-eye view in and out. − at street level changes to the bird's-eye view. A pinch also zooms. |
| Two-finger drag | Pans across the island in the bird's-eye view. |
| Arrow keys | Turn and tilt the bird's-eye view. |
| B | Turns tilt-shift on or off in the bird's-eye and chase views. |
| T | Speeds up time while held, forty times. |
| Shift + T | Runs time backwards at the same rate while held. The clock, the sun, the stars and everything timed by the clock, such as the fishing boats, go back; the church bells do not strike the hours passed backwards. |
| P | Pauses the world: the trains, ferries, boats, dolphins, sea, lighthouse beams, cats, gulls and time of day stand still while the player walks, flies and looks about as usual. P again resumes. |
| R | Rides in the passenger train's cab. R or V again steps off beside the track. |
| C | Follows the train being ridden, or else the nearer of the passenger and goods trains, from behind. The mouse orbits the camera and + − change its distance. C or V again steps off beside the track. While sailing, C changes between the helm and a view from astern of the dinghy, 11 m off at first, which the mouse carries round her and + − bring nearer or further, between 5 and 80 m; R, G, C and F do not take the player to a train or a ferry until they are ashore. |
| G | Rides in the cab of the goods train working the nearest goods line, setting it to work there if none is near. G or V again steps off beside the track. |
| F | Boards the nearest ferry wherever it is. F or V again steps ashore, or at the next landing if the ferry is under way. Aboard, C changes between the deck and a view from astern of the ferry, 70 m off at first, which the mouse carries round her and + − bring nearer or further, between 25 and 400 m. |
| Y | Within 6 m of a dinghy at street level, boards it. Elsewhere, takes the player to the quay beside the dinghy of the nearest harbour, leaving any train or ferry first and coming down from the bird's-eye view. While sailing, Y steps ashore when the boat lies within 3 m of a quay, a mole or a beach. Anywhere in a harbour the player comes ashore on its quay, and the dinghy is moored again at that harbour's berth on its stern line and buoy; if it came from another harbour, the dinghy that lay there goes to the berth it came from, so that every harbour keeps one. Out at sea, away from any harbour, Y returns the dinghy to its own berth and puts the player on the quay beside it, from the helm, the view from astern or the bird's-eye view. |
| A D (sailing) | Steer: A turns the bow to port and D to starboard. The tiller moves the opposite way, as on a real boat. |
| W S (sailing) | Paddle forward or astern at up to 0.6 m/s while the boat is nearly stopped. S also lets the sail fly. |
| Walking into the sea | Wades in from any shore that shelves, and swims once the water reaches the chest. |
| W A S D (in the water) | Swim along the view. At the surface the head rides the waves; under the water the swimmer moves where the view points. |
| Looking down and swimming forward | Dives from the surface. |
| C (in the water) | Dives while held. In the water C does not follow the train. |
| Space (in the water) | Rises while held; near the surface the head comes out of the water. |
| Shift (in the water) | Swims faster, at the cost of more breath. |
| J | Jumps into the sea from the edge of a quay, a mole or a moored boat that is being faced, over the side of the dinghy the view faces, or from the rail of a ferry. A ferry under way sails on. |
| Swimming to a beach or a ladder | Climbs out: the swimmer finds the bottom and wades ashore, or climbs a quay's ladder, or on to any ledge less than about 1 m above the water. |
| Walking into a door | Opens it. A door swings away from the side it is pushed from, as far as it is pushed, and closes again about a second after nobody stands in its sweep. |
| N | Changes to night (22:00), or back to day (10:00) if it is night. The clock runs on from there. |
| I | Opens the island panel, which shows the seed of the present island. Any text of up to 32 characters may be typed as the seed (it is kept in capitals), or **Random** draws one; **Copy** copies it, and **Generate** or Enter generates the island from it. Esc, **Cancel** or I again closes the panel unchanged. While the panel is open the game takes no other keys. |
| M | Mutes or unmutes the sound. |
| Double click | In the bird's-eye view, the camera flies down over 1.5 s to street level at the point clicked, facing the same way. A click on open water does nothing. |
| Tab | Full screen |
| Page Up, Page Down | Increase or reduce the draw distance through eleven fixed levels, from simplified blocks to about 140 m with full detail to about 60 m, up to simplified blocks to about 1,700 m with full detail to about 300 m. A fixed draw distance is kept whatever the frame rate. |
| Home | Returns the draw distance to automatic, in which the simplified blocks reach between about 100 m and 500 m, as far as the frame rate stays near 60 frames per second, and full detail reaches about 100 m. |
| O | Shows or hides an overlay with the frame rate, the frame time and the slowest frame of the last half second, the draw distance, the number of blocks at each level of detail, the draw calls, the triangles, the player's position and the seed. |
| K | Raises the camera to the eye, or lowers it. While it is raised the frame is drawn through its lens and its controls are on the screen; the mouse is not captured, and a drag on the scene turns the view. See [Photographs, the gallery and artist mode](#photographs-the-gallery-and-artist-mode). |
| Esc (camera raised) | Lowers the camera. |
| Enter (camera raised) | Takes a picture, as the shutter button does. |
| + − (camera raised) | Focal length, from 16 to 300 mm. The mouse wheel does the same. |
| [ ] (camera raised) | Aperture, from f/1.4 to f/22. |
| 9 0 (camera raised) | Focus nearer or further, which sets manual focus. Shift and the mouse wheel do the same. |
| U (camera raised) | Autofocus or manual focus. |
| ; ' (camera raised) | Exposure compensation, in thirds of a stop from −3 to +3 EV. |
| L | Shows or hides the gallery. |
| H | Shows or hides the help panel. |

A game controller is supported through the Gamepad API. The left stick moves and the right stick looks. A jumps, B switches the view, X boards the ferry, Y rides in the cab and LB follows the train. Within 6 m of a dinghy, or while sailing, Y stands for the Y key instead, and a press of the right stick always does. At the helm the left stick steers and paddles and the triggers trim the sail, in place of zooming. In the water the left stick swims, A and the right trigger rise and the left trigger dives. RB sets tilt-shift, the triggers zoom, a press of the left stick switches between running and walking, the D-pad turns and tilts, Back mutes and Start shows the panel. At street level, in a coach and aboard a ferry, where the D-pad's down has nothing to tilt, it stands for the X key and sits or stands; in the bird's-eye view it tilts the view as before. Every other button already has a use, and the D-pad's down was the only one free in the places where one sits. The sticks have a wide dead zone, and after any change of view the left stick is ignored until it has returned to the centre.

On a touch screen, a touch on the left part of the screen places a virtual joystick there for walking, and a drag elsewhere looks round.

## Interface conventions

The user interface follows three rules, which apply to every change.

- Labels, place names and values are shown, but explanatory notes and hints are not placed on screen. Explanations belong in this document or, at most, in a tooltip.
- Text is written in plain descriptive sentences. Slogans, taglines and "X, not Y" constructions are not used, in the interface or in commit messages.
- British spelling is used throughout, in the interface, the comments and the documentation.

The help panel is centred on the screen and spans its width, up to 1,320 px. It holds the controls alone, each a key and what it does, with no other text, in groups for each feature (walking, bird's-eye view, passenger train, goods train, ferry, sailing, time, island, draw distance, sound and screen, controller), flowing into as many columns as fit; on a narrow screen it becomes one column. The panel no longer shows the place where the player stands, so `updateHUD` does nothing; the places keep their names, which the travelling panel uses for harbours. Piazzas are named from their feature (Piazza dell'Orologio, Piazza della Fontana and so on), quarters are named after saints and trades, and coves (Cala Azzurra), their caves (Grotta di Nettuno) and their paths (Sentiero della Cala Azzurra) are named from their own lists. The credit for the cats is in `cat/README.md` and `cat/LICENSE`.

## Architecture

### Overview

The program is a single ES module. Its main sections appear in the following order in the file:

1. Random numbers and noise (`hash`, `rng`, `vnoise`, `fbm`). Everything derives from the global `SEED`, a number made from the seed text `SEED_TEXT` by `seedNumber`: a seed of up to nine digits is the number it spells, and any other text is hashed (the 32-bit string hash `h = 31h + c` of Heli's landscape seeds) to a positive number. Without a seed in the address, `randomSeed` draws eight letters and digits at each launch. The seed is read from the address (`?seed=...`), the island panel (**I**) replaces it, and the address is then rewritten with `history.replaceState`, so that a reload or a copied link gives the same island; the seed drawn at launch is not written to the address, so that a reload draws another. The seed is not kept in the browser's storage. The statistics panel (**O**) shows it.
2. The palette (`PAL`) and the surface pattern codes (`SP` plaster, `SR` roof tiles, `SS` stone, `SW` wood, `SB` brick, `SV` bougainvillea).
3. The geometry builder `GB`, which merges transformed template shapes (`T.box`, `T.cyl`, `T.sph` and others) into one buffer per block, with per-vertex colour, a simple ambient occlusion term and a surface pattern attribute. At lower levels of detail it drops small pieces and simplifies round shapes.
4. The terrain: the mainland, the offshore islands, harbours, the railway corridor, stations, villages, squares and alleys. All of these are pure functions of position, cached where they are expensive.
5. Building generators: houses, towers, churches, arches, fountains, cafés, festoon lights, bougainvillea, trees, boats, stations, harbours and viaducts.
6. Block generation, lighting, sky, shadows and the shaders.
7. Streaming: the rings of detail, fading and the far terrain.
8. Moving things: the dolphins, sailing boats, the train and the ferries.
9. Collision and the walkable surface.
10. Sound.
11. Input, the riding modes, the camera, tilt-shift and the frame loop.

### Floating origin

Everything in the world, the camera included, is a child of one group, `world`, shifted by `-ORIGIN`. `ORIGIN` follows the player in steps of `OS = 2560` m, a whole number of blocks, so the coordinates that reach the GPU stay small however far the player travels; positions in the program remain in world metres. Geometry is stored relative to a nearby point, rounded to single precision only after that point has been subtracted: a block's geometry relative to the block's corner, a room's relative to its centre, and the far terrain, the island outline, the clock hands, the lighthouse lanterns and the door instances relative to `ORIGIN`, rebuilt when it moves. The building, ground, sea and surf shaders draw their patterns from the world position less a multiple of `OP = 20480` m (the uniform `uOrig` holds the difference from the shifted frame), so the patterns are as they were within 10 km of the start, and keep their precision beyond it. Code that reads an object's world matrix uses its local matrix, or adds `ORIGIN` to a world position.

### Units and axes

One unit is one metre. The island runs along the x axis. The south shore is on the positive z side (`sd=+1`) and the north shore on the negative z side (`sd=-1`). The sea surface is at y = 0.

### The world in blocks

The world is generated in square blocks of `C = 40` m. Each block is built once and kept as one mesh for buildings (`matB`), one for the ground (`matG`), and optional meshes for water surfaces, fountain water and night glow points.

Blocks are kept in three rings of detail round the player:

| Ring | Extent | Content |
|---|---|---|
| Full detail | `LOD0 = 2` blocks | Every piece of geometry |
| Simplified | out to `VIEW` blocks | Pieces smaller than 0.55 m are left out and spheres are coarsened. |
| Outlines | out to `min(36, 4·VIEW)` blocks | Only pieces larger than 1.4 m are kept. Small lit windows become glow points. |

Each block costs several draw calls, and with thousands of blocks loaded the number of draw calls, not the number of triangles, sets the frame time. Outline blocks that have finished fading in are therefore merged in tiles of `TILE = 4` × 4 blocks and drawn from one mesh per material. A block leaves its tile and is drawn on its own again as soon as it starts to fade out or change detail. Tiles are rebuilt within a budget of 2 ms per frame.

Each block reads the ground's height from a grid of samples a metre apart, at every level of detail, each sample worked out the first time it is needed, so that every choice made from the ground's height (whether a house fits, where a wall runs) comes out the same at every level and a block that changes detail keeps its houses and lamps.

Beyond the rings, a coarse far terrain (`FN = 200` cells of `FS = 22` m) covers the distance, with the lights of distant villages drawn at night. Its heights, colours and lights are cached per grid point, so moving the grid computes only the new edge.

`VIEW` lies between 2 and 12 and adjusts itself to hold 60 frames per second; the overlay shown with **O** reports the current distances. New blocks fade in over 0.8 s in 16 dithered steps. A block that changes detail dissolves into its replacement, the old and new versions drawing complementary fragments so that they never overlap. Nothing fades during the first load or for blocks that appear right round the player.

### Terrain

- **Mainland.** The centre line of the island wanders and its width varies. Hills rise behind each shore, with peaks (`PEAK = 480` m spacing) that are often crowned by a hill town with its church on the summit. Beaches, rocky shores and cliffs alternate along the coast. `heightAt(x,z)` returns the ground height, including levelled squares, the rail bed and terraces.
- **Mountains.** Behind a coastal belt `MT_D0 = 300` m deep, which holds the towns, the farms, the coast road and the railway, a range rises along the island's spine wherever the island is wide enough (`mtnH`). Its crest wanders either side of the middle line and rises to separate summits with saddles between them; it falls to a pass wherever the railway crosses from one shore to the other. Spurs run down from the crest towards each shore about every `MT_SP = 360` m, some higher than others and each with knolls along it, with V-shaped valleys between them; ribs and gullies run down the upper slopes, and here and there broken bands of low limestone cliff stand above ledges. Its summits stand between about 300 and 700 m.
- **High ground.** A block on the range (`highGround`: one where the range adds more than 30 m, or the ground stands above 220 m) is never part of a village and has no streets or lanes; nor do hill towns or ruins stand on the range. Between villages no lane climbs straight up a slope steeper than 14 m in a block. On the mountains (`mount` blocks) Aleppo pines and holm oaks thin out with height into low maquis, scree and bare rock, and nothing grows above about 420 m; the ground turns from patchy maquis above 120 m to pale limestone and darker scree from 170 m, first on the steepest ground. The blocks at the foot of the range are mostly wild hillside.
- **Coves.** Here and there the shore becomes a rocky cove between limestone cliffs, with sea caves and a path down a ravine (see [Coves](#coves)).
- **Offshore islands.** Each shore has a slot every `ISL = 1600` m that may hold an island, and the slots alternate between a near row, whose islands begin 280–650 m off the shore, and a far row, whose islands begin 1.3–2 km out, and further still where needed to clear the near islands either side, so the islands lie scattered over the sea rather than in a line. An island has a mean radius of 160–490 m and is never wider than nine tenths of a slot, so a search of three slots finds every island at a point; the larger ones stand up to 1.7 times higher. Each takes one of five forms: hills, ridge, volcano, mesa or cliffs. Cliffs face the open sea, so the landward shore, where a jetty stands, keeps its beach.
- **Rocks at sea.** In slots of `RK_SP = 5200` m along each coast, about half hold a small rock 200–340 m offshore, beyond the sailing boats and at least 170 m from any ferry crossing. Each rock is bare grey stone ringed with boulders and carries a lighthouse.
- **Ancient ruins.** A ruined temple, or in three cases out of ten a round tholos, stands at some sites on a 650 m grid where the ground is open hillside (rocky ground, olive terraces or wild slopes) more than 18 m up and away from the hill towns, and on about two islands in five. The ruin takes the spot in its block where the ground varies least, with its long side along the contour, and its stepped platform is built up from the lowest ground, so on a slope it becomes a terrace wall. A few columns stand to full height, some carrying a length of architrave; the rest are broken or reduced to stumps. The temple keeps the low walls of its cella, and drums and blocks lie round about. Trees and rocks are kept off it.
- **Villages.** Villages are separate clusters, and the land between them is open country of olives, rocky ground, farmland, coast or wild ground. Streets, blocks, alleys, archways over main streets and stepped streets are decided per block from the seed, so that neighbouring blocks agree.
- **Squares.** Squares are levelled into the hillside and are part of the height function. A square is not placed where levelling it would leave a cliff. Each has a feature: a clock tower, a well, a tiered fountain, a market cross or a great elm. A belvedere replaces the houses where the hill falls away, with a balustrade, benches and a stair down where one fits; a stair that would run down into a harbour's basin or the sea is not built.
- **Stepped streets.** Steps follow steep streets. No step is built where the ground at its middle, at either end or under any corner of its tread is less than 0.2 m above sea level, so that steps never stand over water or across a mole.

### Trees and plants

The island carries twelve kinds of tree and plant. The cypress, the olive and a round broadleaf are built by `addTree`; the other nine are built by `addFlora`, which `addTree` calls for any kind listed in `FLORA`:

| Kind | Form |
|---|---|
| Stone pine (`stonepine`) | A short, slightly curving reddish-brown trunk, 3.8–5.6 m high, forking into four or five limbs that carry a broad, flat-topped umbrella of three clumps each, with sky showing between them. |
| Aleppo pine (`aleppo`) | A slender grey trunk leaning 10 to 30 degrees and bending as it rises, with an uneven crown in its upper part: broad, flat masses of foliage on short crooked branches, overlapping, with the sky showing through at the edges. |
| Holm oak (`holm`) | A short stout trunk dividing into limbs under a dense, rounded, grey-green crown of nine clumps, a little wider than it is tall. |
| Carob (`carob`) | A short thick trunk and spreading limbs under a broad, low dome of eleven clumps of glossy green, hanging nearly to the ground at its edge. |
| Fig (`fig`) | Three or four pale grey stems splaying from the foot and forking under a low, wide, open crown of bright green clumps. |
| Almond (`almond`) | A dark crooked trunk opening into a vase of thin branches that carry a rounded, open crown of small pale grey-green tufts. |
| Prickly pear (`opuntia`) | A clump of up to 18 flat grey-green pads, each growing from the rim of the one below, with a few small dark-red fruit on the outermost. |
| Agave (`agave`) | A rosette of 16–20 thick blue-grey leaves; three in ten carry a flowering stem 4.5–6.5 m tall branching into small yellow flower heads. |
| Maquis (`maquis`) | A low, uneven clump of three or four mounds of lentisk, mid-green and dense, or of rosemary, lower and grey-green. |

A crown is never one shape. It is built from several overlapping clumps with gaps between them. Each clump is a low sphere made lumpy by pushing its vertices in and out by a noise of their position (`foliage`), given a flat normal on every face so that it catches the light in facets, and shaded across the whole crown from darker beneath to lighter and warmer on top, with a little variation from face to face. The leaves are of the brightness of the olive and the round broadleaf. Fruit and flowers are small specks.

Each plant draws its variation of size, lean and tint from a random sequence of its own, seeded from its position, so the block's sequence is undisturbed. It takes the same random numbers whether or not a part is drawn, so it does not change shape when its block changes detail. Trees lean downhill, which on a coast or a clifftop is towards the sea, unless the ground is nearly level. Trees take a collision circle at the trunk and are recorded in `treeSpots`, which the wind in the trees and the cafés' placement use; prickly pears and agaves take a circle round the whole plant, and maquis takes none, as the scrub did before it. Everything is merged into the block's geometry, so no draw calls are added.

At full detail a tree has about 500–1,000 triangles. At the simplified level each clump is a coarser shape of 20 triangles, the fruit, twigs and flowers are left out, and a prickly pear or an agave becomes one mass of its colour and maquis one mound. In the outlines a crown keeps one clump in three, a little larger, and prickly pears, agaves and maquis are left out. Compared with the build in which the new kinds were withdrawn, a block has about 12 per cent more triangles at full detail, which is drawn only within about 100 m, about the same at the simplified level and 2 per cent fewer in the outlines. The settled draw distance is unchanged.

Only the kinds in `FLORA_OK` are placed. A kind that is not in it is replaced by the round broadleaf if it is a tree, and left out if it is a shrub (`FLORA_SHRUBS`). New kinds are developed and shown in `testbench/trees.html`, and added to `FLORA_OK` once approved.

Plants are placed by habitat, from the block's seed:

- **Villages.** The trees between the houses are cypress (34 per cent), fig (12), almond (4) and the round broadleaf; in a shore block, by the water, fig (25), cypress (25) and the round broadleaf. The larger squares have up to two round broadleaves at their edge. A walled orchard holds olives and round fruit trees, with a fig or an almond here and there.
- **Olive groves and farms.** The terraced rows of olives remain, with an occasional cypress, carob or almond. A farm's sparser rows are half olives, with almonds, carobs and figs. A fig stands beside each farmhouse and a prickly pear against its wall.
- **Roadsides.** One in five of the roads lined with trees has a few stone pines, 13 m apart and leaning over the road, in place of the row of cypresses.
- **Open rocky country.** Among the limestone outcrops and the scrub, which is partly maquis, grow carob, holm oak, almond, olive, a few Aleppo pines, cypress, prickly pears and agaves.
- **Wild hillsides.** Aleppo pines and holm oaks, with cypress, olives and a few carobs, and clumps of maquis between the rocks. Stone pines grow there only on a crest, at most three to a block, and in half the blocks none.
- **Stone pines elsewhere.** In three blocks in ten of rocky country and of the islands, and in about one in five of the coast, a lone stone pine or a group of two or three stands on the highest ground of the block, which is a crest, a knoll or a headland.
- **The coast and the coves.** Agaves, prickly pears and Aleppo pines leaning seaward. The occasional pine along the top of a cove's cliffs is an Aleppo pine, or one time in five a stone pine, and some of the clifftop scrub is agave or prickly pear.
- **Offshore islands.** Mostly maquis, with Aleppo pines, agaves, prickly pears, cypress and a few holm oaks.

The far terrain darkens about half of its points on the hills above 80 m towards the holm oak's green, by up to a third and less with height, for the stands of pine and oak on the lower slopes.

### Harbours

Harbours are placed in slots of `HARB = 220` m along each shore. A harbour has a quay wall along the shore inside the basin and two walkable moles, a straight mole and a cross mole, with a parapet on the seaward side and rock armour at the seaward foot. The entrance always opens on to the sea, however the coast curves. A lighthouse stands at the head of the straight mole and a harbour light on the other.

Boats are moored stern-to along the quay and a few swing at anchor in the basin. Moored boats keep the ferry channel clear. A boat's footprint (`boatBox`) is its whole reach, rudder and stem included, and its beam, turned with its heading; no two boats afloat or drawn up come within `BOAT_GAP = 0.6` m of each other. The quay's boats are laid out after the fishing boats' berths and the dinghy's berth and its line to the buoy, and keep clear of them and of the boats placed before them; a boat that does not fit is left out, without drawing other random numbers, so the rest of the harbour stays as it was. The stern of a boat moored stern-to lies 0.9 m off the quay's face at its furthest point out to sea across the boat's beam (`quayFace`), so that the whole stern clears the quay where the shore runs at a slant, and every corner of a hull afloat must lie over water at least 0.2 m deep, from the exact height of the ground. A boat anchored off the shore or pulled up on a beach lies wholly within its own block, so that it cannot meet a boat of the next block. Each harbour also has a berth for a sailing dinghy (`dinghyBerth`), stern-to at one of the quay's bollards with its bow line to a white buoy in the basin, clear of the ferry channel and with water under the whole hull; the harbour's other boats are kept off it (see [Sailing](#sailing)).

An iron ladder runs up the quay wall beside the dinghy's berth, and another up the basin's face of each mole where water lies beneath it, so that a swimmer can climb out. Each is listed in its block's `ladders` as a way out (its foot in the water, its top, the place stepped out to and the heading from the water to the wall). Placing them draws no random numbers, so the harbour is laid out as before, and the moored boats are kept clear of the quay's ladder.

At a ferry port the cross mole has an opening in its parapet where the gangway lands, a ticket kiosk and a timetable board. Where the gangway opening lies within 4 m of the harbour light, the light is moved to the harbour-side edge of the mole tip.

### Lighthouses

Besides the harbour lights, lighthouses stand in three kinds of place, all decided from the seed (`lightsNear(x, z, r)` lists them):

- **Headlands.** In each 4.2 km of mainland coast (`LH_SP`), 45 per cent of stretches have a lighthouse on the point where the shore stands furthest out against the coast 250 m either side. It stands 6–10 m back from the water, seaward of the coastal road and clear of harbours, the railway and stations.
- **Islands.** About a fifth of the islands have one, on the point of the shore that stands furthest out towards the mainland and at least 90 m from the ferry jetty, so that it is seen from the coast.
- **Rocks at sea.** Every rock at sea carries one (see Terrain).

Each is a white tapering tower on a stone plinth, with a gallery, a glazed lantern and a red dome. On land a keeper's cottage stands beside it. The ground within 10.5 m is kept clear of other buildings and trees.

At night each lantern glows and one or two beams turn about it, every 9–17 s. As a beam sweeps across the camera the lantern flashes: its glow swells sharply and brightens while the beam points within a few degrees of the camera, with a softer halo either side, except on a mainland light's screened landward side. The beams are cones 560 m long drawn with additive blending, brightest along their axis and fading with distance; fog dims them less than other things, so they are seen from up to `LH_RANGE = 4000` m. A mainland lantern is screened on its landward side, so its beams sweep only over the sea.

### Coves

In slots of `CV_SP = 1600` m along each coast, four slots in five are tried for a rocky cove, and about three in ten hold one. A cove is placed only where the shore is close to straight, clear of harbours, villages, headland lights, ferry crossings, goods lines and the railway. The site is chosen with the coves left out of the ground (`NO_COVE`), and the goods lines, the ferry crossings and the headland lights are laid out in the same way, so that none of them depends on a cove.

A cove is laid out in a straight frame of its own: u along the general line of the shore through its centre X, and s square to it, inland. It consists of the following parts.

- **Headlands.** Two headlands reach 13–46 m out to sea and enclose a small bay. Each has its own reach, mouth width, tip, outer flank and height, so no cove is symmetrical. Their outlines are broken by several octaves of noise, by notches in the outer flanks and by inlets in the walls of the bay, each tip has its own bluntness and two deep notches near it, and up to four stacks stand off the tips. The bay's axis is bent, so that the mouth lies off to one side of the head. The mouth is at least 27 m wide.
- **Cliffs.** The cliffs are pale limestone, 10–30 m high, lowest at the head of the bay and falling away towards each headland's tip. Each face is a mesh of its own, built in columns along the cliff line. A face leans back by 0.4–1.8 m. It has broad bulges and recesses of varying size, level beds 1.3–2.4 m thick each of which juts out at its base by its own amount, vertical joints, flutes and a notch worn by the sea where it stands in the water. In places the face is a smooth slab that keeps only its broad shape and its joints. Its brow is rounded over into the clifftop, and the top edge rises and falls along its length. The rock is coloured in beds of slightly different tints, with streaks of rust, darker joints and recesses, and a dark wet band at the waterline. Boulders and scree lie at the foot, scrub and the occasional pine grow along the top, and the rock carries a shader pattern of its own (surface code 12).
- **Bay.** The head of the bay holds a sand or shingle beach 3–13 m deep, or, in about one cove in five, a shelf of bare rock just above the water. Below the landing the bed falls gently, from the water's edge to a metre's depth over about five metres, and then into a channel at least 1.2 m deep out to the mouth. Where there is no beach the shelf at the head stands about 0.3 m above the water and serves as the landing. A shelf of rock 2.3–3.4 m wide and 0.55–0.8 m above the sea runs along one wall from the head to the walkable cave.
- **Caves.** Each cove has one to three sea caves. The first opens above the shelf and may be walked into. The others open at the waterline in the walls of the bay or the headlands and are reached only from the sea. A cave is a bore 4–13 m deep with an irregular, asymmetric cross-section: much wider at its floor, with its crown pushed to one side, its top slanted and its surface lumpy. It opens through a ragged hole cut from that cross-section, a good deal smaller than the bore, which meets the face at an angle. The hole is set in a recess of the face, with fallen rocks in front. The bore widens into a chamber and narrows to its back. Its colours darken unevenly towards the back. The floor of the walkable cave is uneven and raised at the walls, in the cove's own sand or shingle mixed with rock, with darker wet patches, scattered pebbles and rocks fallen along the walls; it slopes down into a shallow pool of sea water at the back, and the pool's edge wanders. Each cave is sized to the rock round it, and the ground is left out wherever it would run through a cave (`coveCaveCell`).
- **Cliff path.** A ravine runs inland from the head of the bay to the clifftop valley. A footpath 2.4 m wide zigzags up it in two to four flights, each wandering a little, with turns 3.6 m across set irregularly and kept clear of the ravine's walls. Its surface is an even slope; where the flight above and the flight below meet at a turn, the two are blended so that the ground runs smoothly from one to the other. Stones are set flush in the surface where it is steep, and low walls of loose stones stand just outside the two most exposed turns. None of these is an obstacle. A trodden track runs on from the head of the ravine to the coast road, which moves inland where the ravine reaches towards it. The parapet of the road is open where the track leaves it.

The outline is traced from a land function (`cvLand`) by marching squares on a half-metre grid, then smoothed and resampled every metre. The result is one open line along the coast and a closed line round each stack. A 1 m grid of signed distances to the line (`cvSdf`) gives the ground near the cliffs. Behind each face the ground stays at the foot of the cliff as far back as the face meets the ground, and in the recess round a cave's mouth. It is then kept below the foot of the cliff to `CV_LZ = 5` m behind the line, and rises to the clifftop. It is hidden by the face and by a cap of rock along the top, which tucks under the ground beyond, so the coarser ground of distant blocks never shows through a face. Each block builds the parts of a cove whose middle lies in it. The cove's geometry is worked out once, when it is first needed, in about 20 ms; the far terrain uses a simplified shape that does not need it. Pressing I clears the coves with the other caches.

Streets, trees, houses, field walls and boats are kept out of a cove, within 14 m of its cliff line.

`coveLanding(cove)` gives the point where a boat lands, either the middle of the beach's waterline or the seaward edge of the shelf at the head, and the heading out to sea along the bay.

### Railway

The railway runs the length of the island on a level bed 8 m wide. It keeps to the coastal belt, about `RAIL_IN = 190` m inland of the mean shore, for most of the way, and swings across to the other shore and back over a period of `RAIL_L = 9000` m, crossing the island at the passes in the mountains, so it visits both coasts. Its distance from the middle line follows the island's width averaged over 500 m, so its curves stay gentle where the shore bends sharply. Its level is taken from the ground without the mountains, so it passes under them in tunnel. Its height is a Catmull-Rom curve through knots 10 m apart, so the grade changes smoothly.

The line is classified every 2 m as open, viaduct or tunnel: tunnel where the hill stands well above the line and viaduct where the valley falls well below it. Short tunnels become cuttings, short viaducts become embankments, and short open gaps between two long tunnels or viaducts are joined up. Over a tunnel the ground is kept level with the portal parapets, so the bore is always covered. Tunnels are lined, have portals and contain track, so they can be seen from the cab. Viaducts have arched spans between piers every 14 m.

There is one station in each 900 m of line (`ST_SP`), sited on the first level open stretch in its slot and in a town where there is one. Each station has a platform with ramps no steeper than 1 in 7 at both ends, a canopy on iron posts, benches, lamps and a station building.

### Goods lines

A goods line (`glFit`, `glZone`) is a railway of its own, separate from the main line, joining two harbours 2 to 6 km apart on the same shore; there are about 145 in 600 km of island, averaging 2.5 km long, and each starts at least 3 km beyond the end of the last on its shore. Along each quay it is a siding at the level of the dock (1.6 m), with buffer stops at both ends of the line, a crane on the quay side and crates and barrels stacked on the landward side; between the two harbours it runs along the shore, behind the quays of any harbours it passes. Its course is the shore, sampled every 4 m and smoothed by repeated 84 m running means until no curve is tighter than 60 m, set 8.5 m inland, or further (up to 24 m) where a bay reaches further in. Its height comes from knots every 10 m: dock level along the sidings, elsewhere the ground averaged over 40 m, never below dock level, then lowered where needed to keep the grade under 1 in 40.

A line is laid only where the track stays within 45 m of the water and 40 m of the main line, with the ground within 12 m above and 5 m below its bed. The coast road keeps 8.8 m from the track (`GL_RD`), moving inland where the line requires it. Footbridges cross the line just beyond each siding and about every 320 m between, so that the beach and the quays can be reached from the road: a stone deck 5 m above the rails on two stairways that run down beside the track, one on each side, with iron handrails. `railPerp` measures the distance to the nearest track, main line or goods line, so that streets, squares and houses keep clear of the goods lines; the ground is shaped to each line's bed as it is to the main line's.

A goods train (`goods`) works the line nearest the player: a blue shunter at each end (`buildShunter`, 8 m long on three axles, with a cab at its inner end and a long bonnet) and twelve wagons between them: vans, open wagons loaded with crates, flat wagons loaded with timber and tank wagons, about 150 m in all. It waits at one quay while it is unloaded and loaded, runs along the shore at up to 9 m/s to the other quay, waits there in turn and comes back, reversing at each end.

### The train

The train is push-pull: a square-fronted diesel locomotive at each end (`buildLoco`, 13 m long, with a flat cab front, radiator fans on the roof and the coaches' green and cream livery) and four coaches between them. The locomotive at the rear faces outwards, and its lamps show red while those at the front show white; `train.lead` says which end leads, so that the train can reverse without turning. The train consists of its locomotives and coaches, each car spanning the chord between two points on the track one car length apart, with a coupling gap between cars. The cars therefore stay coupled on curves and grades.

The train brakes at a constant 0.7 m/s² to come to rest with the locomotive near the far end of each platform. Its doors slide open once it is at rest and close before it leaves. Doors that close on someone standing in the doorway put that person back inside.

**Coach dimensions.** `CW = 2.8` m wide, `CL = 15` m long, with a door each side at each end (`CDZ = CL/2−0.9`, door opening `CDW = 0.95` m) and a saloon of five window bays.

**Coach body.** The side walls are built from slabs: the saloon wall with window pillars, a cantrail, a solid vestibule window band, a door pocket (outer skin, inner skin, top cap and back cap), a lintel and an end section. Cream bands run along the outside, broken at the doorways. The roof overhangs the sides. End walls and partitions are set back so that no two surfaces share a plane, which prevents z-fighting.

**Doors.** Each door (`CAR_DOOR`) is a frame of rails and stiles round an open window. It slides along the outside of the body into its pocket. Grab rails are placed inside the doorway, clear of the door. The last coach carries a shut end door (`END_DOOR`) in its rear end wall.

**Gangways.** Hollow bellows connect the coaches. A walker passes from one coach to the next at the middle of the coupling gap, and walking at a narrow opening eases the walker towards its centre.

**Lighting.** The coach lamps are added to the scene only after dusk, because every light adds to the cost of every lit pixel.

### Ferries and islands

Each mainland ferry port serves the island nearest to it. A ferry (`FL = 26` m long, `FB = 6.4` m beam) eases away from its berth, cruises at 9 m/s and brakes to rest alongside the next landing. Its course is made of the shortest turn-straight-turn paths between poses, with the widest turns that keep the whole hull in deep water.

The ferry has an open foredeck and after deck, a saloon with side decks 1.3 m wide, an upper deck reached by a stair from the after deck, a wheelhouse, a funnel and a lifeboat each side. A gangway, a plank without handrails, is run out from the opening in the bulwark to the quay while the ferry lies alongside, and the opening is closed by a gate while it is under way.

Each island with a crossing has a stone jetty with a T-shaped head, a kiosk and a lamp.

`ferryLanding(R, stop)` gives the point where a passenger steps ashore. On the mainland this is the mole beside the gangway opening, clear of the kiosk; at an island it is the middle of the jetty head.

### Sailing boats

Sailing boats keep a set distance offshore. `sailClear(sd, x)` gives the distance needed at x to clear any harbour's moles with 12 m to spare. Each boat looks 20 m and 40 m ahead and eases outward at up to 3 m/s where the next harbour reaches further out. A nearby ferry makes a boat bear away from it and reduce its speed.

### Fishing boats

One to three of the trawlers moored in each harbour are fishing boats (`fishBoats`). Their berths are chosen from the quay's mooring slots by hash, clear of the dinghy's berth, the ferry crossings, the shore, the beaches with sunbeds and one another (by `BOAT_GAP`), and `buildHarbour` leaves those slots for the fleet to draw, so that a berth stands empty while its boat is out.

Each boat works the same day. It leaves its berth between 02:00 and about 05:20, motors out through the harbour mouth (between the head of the cross mole and the other mole) and 450 m straight out to sea, and then makes for its fishing ground, 1.2–2 km from the shore on its own side, among and just past the near offshore islands. The ground is kept 150 m clear of the islands, the lighthouse rocks and the ferry crossings; of the places tried (five along the coast at each of five distances out), it is the one nearest the boat's own distance and bearing whose course leaves time in the day to fish. The course passes the islands and the lighthouse rocks on whichever side is shorter (`fishRoute`). At the ground the boat trawls round a circle of 150–250 m radius at 1 m/s for one to three hours, then turns for home and berths stern-to between about 14:30 and 17:15, making the last 16 m astern.

The boat moves at 1.8 m/s in the harbour and 5 m/s under way, a trawler's real speed. Since a game hour lasts 75 s, 5 m/s is 375 m to the game hour, and a passage of 1.3–2.1 km takes four to six and a quarter game hours each way; the day's timetable is set from the length of the boat's own course, with at least an hour's fishing, departure no earlier than 02:00 and the return by 18:00 at the latest. The speeds are held in `FISH`.

Where a boat is follows from the clock alone: `fishPlan` works out its courses and hours once, and `fishState` gives its position and heading at any hour. A boat is therefore at sea whether or not anyone is near, stands still while the world is paused, hurries with T and jumps with N. The boats of the harbours within 4.5 km of the player are listed; a boat under way or fishing is drawn within 2.6 km and a moored one within 700 m, so that a boat seen on the horizon from a headland is where it should be. Across the north–south join a boat is drawn on the player's side. The fleet is listed afresh when a new island is generated. The engine of the nearest boat under way within 220 m is the ferry's engine sound, quieter and a little faster. For automated checks, `window.__fleet` holds the list of boats, `fishPlan`, `fishState`, `update` and the hour, which may be set.

A boat on its way home has its catch aboard: 4–7 of the nearest gulls within 450 m gather behind and above it, dive at its wake again and again, and come down on its deck and wheelhouse, on the quay beside it or on the water once it has berthed (see [Gulls](#gulls)).

### Sailing

Each harbour within 400 m of the player has a dinghy at its berth, and **Y** sails it. The dinghy is an original design about 4 m long and 1.5 m in the beam, in the manner of a Mediterranean harbour dinghy: clinker-planked and painted in the island's colours, with a varnished gunwale, thwarts and foredeck, a short wooden mast, a boom and a plain cream mainsail, a daggerboard, a rudder and a tiller with an extension. The colours are drawn from the harbour's seed.

The code is in two blocks that are the same in `testbench/sailing.html`, where they may be examined on their own:

- `createWind(opts)` gives one wind over the whole sea. `at(x,z)` returns the air's velocity, its speed and the heading it comes from. The prevailing wind, between 4.2 and 6.4 m/s from between south-south-west and north-west, is drawn from the seed, and its direction wanders by up to 20°. Gusts are patches of a noise field carried downwind at 0.85 times the wind's speed; the sea shader samples the same field, so that the gusts show as darker, rougher ripples (`seaGust`, aligned under the floating origin through `QORIGIN`). `windShelter` cuts the wind by up to 60 per cent inside a harbour and up to 50 per cent in a cove. A sea breeze of up to 2.4 m/s blows onshore from late morning until evening, and a land breeze of up to 1.4 m/s offshore at night. The gulls fly in the same wind, through `gullWind`.
- `createDinghy(parent, opts)` builds a dinghy and sails it. Its speed through the water approaches a target taken from the true wind angle: nothing within about 35° of the wind, 0.40 times the wind's speed at 45°, 0.60 times on a beam reach and 0.40 dead downwind. The boat gains way with a time constant of 2.4 s and loses it with one of 5 s, so a tack carries her through the wind. Rudder authority grows with speed, though she still turns slowly at rest. There is some leeway, more at low speed or with the daggerboard raised in shallow water. She heels with the side force, up to about 20° in a gust, which costs speed, and she never capsizes. The boom swings across slowly on a tack and slams across on a gybe, once the wind is 8° by the lee.

The sail trims itself (the assisted setting). A realistic setting, in which W and S and the triggers sheet the sail in and out and mistrim costs speed, is available through `window.__village.setHandling('realistic')`.

The player can never be stuck:

- In irons the boat always falls off within about four seconds, and holding the tiller over chooses the side and shortens this.
- When she is nearly stopped, W and S paddle at up to 0.6 m/s and A and D still turn her.
- Grounding, where the water under the hull is less than 0.3 m deep, and contact with moles, quays, rocks and other boats push her out along the contact, never pinning her. On a gentle beach the bow slides up until it is clear of the water and she stops without rebounding.
- If the player has been giving input for 4 s and the boat has moved less than 0.5 m, a watchdog eases her out to the nearest water at least 1.5 m deep.

While sailing the view is in the first person from the helm (mode `dinghy`), with the tiller, the boom, the sail and the masthead pennant in sight. The eye moves out to the windward gunwale as the boat heels, and across to the new windward side in about a second on a tack or a gybe. The camera follows the heel and pitch at three quarters of their amount. V rises to the bird's-eye view over the boat and returns to the helm.

No readout of the wind or of the boat's speed is shown on the screen. While sailing, up to 22 faint wind wisps (`updateWisps`) drift past the boat at about the height of the sail, 1.6–5 m above the water: thin white ribbons 2.5–5.5 m long, nearly straight with only a slight ripple, that fade in and out at both ends. They are carried over the ground by the true wind at its own speed, so that the boat's motion reads against them and their direction follows the wind's shifts and the sea and land breezes. They appear 5–30 m from the boat and are seen from the helm, from astern and from the bird's-eye view. Their number and brightness follow the wind where they are: more and brighter in a gust, few and faint in a harbour or a cove, and none below about 1.5 m/s. At street level a few drift along the shore within 30 m of the water. They are one instanced mesh drawn after the sea, positioned relative to `ORIGIN`, stand still while the world is paused and move with the world across the north–south join.

The boat being sailed carries the player across the north–south join (`wrapHooks`), and the other dinghies are rebuilt at their berths afterwards. A dinghy left away from its berth stays where it was left until the player is 1.5 km from it; the next **Y** to that harbour moors it again. The dinghies stand still while the world is paused. A dinghy draws a cap at its gunwale that writes only depth, after the opaque objects and before the sea, so that the transparent sea is not drawn inside the open boat. `window.__village` holds `dinghyKey`, `dinghies`, `sailD`, `wispInfo`, `WIND`, `dinghyBerth`, `dgyHarbourNear` and `setHandling` for automated checks.

### The sea

The sea is a single displaced surface that carries the waves of the local wind and a long swell from the open sea. It is made by `createSea` (the same module drives `testbench/waves.html`), and what it draws is what everything afloat rides.

- **The wind's waves.** Twelve Gerstner components with wavelengths from 3 to 60 m, spread about the wind's direction, make the waves of the local wind. Their height follows the wind speed: the significant height is about 0.026 U² m, and the peak wavelength about 0.35 U² m, between 4 and 40 m. The crests sharpen as the sea builds, and whitecaps appear on the steepest crests in a fresh breeze. When the wind turns, a second set of components takes over from the first over some seconds, so the waves never swing round at once. The wind is the island's own (`WIND`), read 350 m off the player's shore, and its gusts darken the water as they pass. Out on the open sea the wind is stronger: it is as on the coast to 400 m off the main shore, rises through the zone of the offshore islands, and beyond about 2.5 km blows at 1.7 times the coastal wind (`windExposure`), so the waves, the whitecaps, the wisps and the dinghy's speed and heel all grow there.
- **The swell.** Each side has three long-crested trains that run towards its shore, at directions about 12° apart and at 0.9, 1 and 1.1 times a base period of 6.8 to 9 s drawn from the seed. The wavelengths follow from deep-water dispersion, L = gT²/2π, between about 58 and 153 m. Because the trains differ slightly in period and direction, the crests come in sets. The height from trough to crest is drawn afresh for each island and each day of the game, between about 0.3 m on a calm day and 1.25 m on a lively one, and changes smoothly through the day (`swH`).
- **Shelter.** The water is calm near the land and builds only on the open sea. Within about 300 m of the nearest shore, of the mainland or an island, the wind's waves are cut to a tenth of their height and the swell to a quarter; from there they grow, to full height about 600 m out. Inside a harbour's moles the swell is cut to a tenth and the wind's waves to an eighth, and in a cove by up to seven tenths towards its head. As the water shoals the swell grows a little, by Green's law, to 1.35 times in 3 m of water, and in the last 1.5 m it dies away into the surf.
- **The field.** The shelter factors and the depth of the water are held in a texture of 128 by 128 cells 12 m apart round the player (`swF`), which the GPU and the CPU read byte for byte alike. It is rebuilt within 1.2 ms a frame as the player moves on, and at once after a jump of more than 700 m. Beyond its outermost 150 m the swell fades out and the wind's waves keep 55 per cent of their height.
- **One function.** `swellAt(x, z)` gives the height of the sea and its two slopes at the present moment, and `swellH(x, z)` the height alone, from exactly what the sea shader draws: the Gerstner displacement is inverted by a few iterations on the CPU.
- **Depth and clarity.** The water is clear to about 12 m, and somewhat clearer in the harbours and coves. Its colour follows the length of water the light passes through to the seabed: red is absorbed first and blue last, so shallow water over sand is a muted green-blue with the seabed showing but not bright, and deep water is dark blue. Only depths are used, never the colour of the scene, so nothing above the water is seen in it; the reflection is of the sky alone, with the sun's glitter. The depth comes from the field everywhere. On the water a depth pass also renders the depth of what lies beneath (the seabed of the blocks that reach below the sea, the hulls and the dolphins) with a plain material that writes depth only, at no more than about 1.3 million pixels and with a camera that reaches 170 m; it fades out between 75 and 145 m, so the colour follows the depth and never the reach of the pass. A thing well above the seabed, such as a dolphin or a hull below the waterline, is seen as a dark grey-blue shape fading into the water with depth. Less light leaves the surface from beneath towards a grazing angle, so nothing in the pass is seen below about 22° of downward view, and things beneath show best looking straight down. Caustics play on the seabed.
- **Two levels of detail.** The full sea is drawn only on the water: in the dinghy, aboard a ferry, or with the eye less than 9 m above the sea and within 40 m of it. Everywhere else, on land and in the bird's-eye view, a coarse sea of 120 rings by 160 segments is drawn in a single call, without the ripples, the gusts on the water, the caustics or the depth pass, so it costs no more than the old sea did. The dolphins' ghost shapes are drawn with the coarse sea only, since the full sea shows the bodies themselves. The change between the two is eased over about a second: the ripples and caustics fade, and the spacing by which the short waves are faded moves between the two meshes, so the coarse mesh is put in only once nothing depends on the fine one.
- **Foam.** The surf band on the shore keeps its crest, lace and shore terms and rides the sea surface, so the wash rises with each crest that arrives. The swell's crests are flecked with soft foam on the bigger days, and the whitecaps of the wind's waves are drawn in the same style.
- **The mesh.** The full sea is a disc of 250 rings by 224 segments centred on the camera, with the rings close together near the middle and wide apart towards its edge 3 km away. Each component fades out as its wavelength approaches the spacing of the mesh, so distant water does not shimmer. In the bird's-eye view the disc grows with the zoom to reach the fog. A depth-only cap drawn before the sea keeps the sea from being seen through itself.
- **What rides it.** The boats moored and at anchor in the harbours, the sailing boats, the dolphins and the gulls sitting on the sea follow the surface point by point. The dinghy pitches and slams into a head sea. The ferries and the fishing boats are heavy: the sea is averaged over the whole hull (five points along a ferry's 26 m length by three across its beam, three by three for a fishing boat), a plane is fitted to it, and heave, pitch and roll follow that plane through heavily damped springs (`hullRide`). A ferry's natural periods are about 7 s in heave, 5.5 s in pitch and 9 s in roll, and on a lively day on the open sea it pitches by no more than about 0.4° and rolls by no more than about 0.6°. Its motion dies away as it slows into a landing.
- **The views.** From the dinghy's helm the boat lifts and drops and the horizon rises and falls. On a ferry the eye turns with the ship, so that the deck stays level under it while the horizon moves slowly.
- **Time and the join.** The sea follows the world's time, so it stands still while the world is paused. The z-component of each wavenumber is a whole number of periods over `WRAP_Z`, so the sea runs on unbroken across the north–south join.

`window.__village` holds `SEA`, the sea module itself, `swellAt`, `swellInfo()`, which lists the swell trains with their periods, wavelengths and directions, and `setSwell(h)`, which fixes the swell height for tests; `setSwell(null)` returns it to the day's own.

### Dolphins

Pods of bottlenose dolphins swim in the open sea. The module `createDolphins(parent, opts)` returns an object with `update(dt, ctx)`, `setOptions(o)`, `trigger(kind, pod)`, `reset()`, `shift(dz)` and `dispose()`. It is self-contained, and the same block is used in `testbench/dolphins.html`, where it may be examined on its own with a ferry, an island and a control panel.

Two pods of three to seven dolphins are kept within about 380 m of the player. A pod keeps to deep water: it appears and swims only in water deeper than 12 m, never within 150 m of the island's shore or 120 m of an offshore island or rock (`dlKeepOut`), and seldom within 160 m of the shore, and now and then ahead of a ferry under way, so that the ferries crossing to the islands are met from time to time. A pod that falls more than 1,140 m behind is placed afresh. Pods keep out of harbours and of the water off a cove, and turn aside from water shallower than 9 m. Where no such water lies within reach, as far inland, a pod waits until there is.

A pod swims in rows two to four abreast, 1.6 m apart and 3.1 m from row to row, on a shared heading at a shared depth of 1.3 to 1.9 m. Every 9 to 20 s it surfaces to breathe, either all together or in a quick ripple across the rows. Each dolphin rises in a smooth arc, so that its head, back and dorsal fin roll through the surface, with a small blow of mist. A leap begins with a dive to between 3 and 3.8 m, and the dolphin leaves the water at 5 to 6 m/s and 50 to 60 degrees, which clears its body by 0.5 to 1.5 m; about one leap in twelve is faster and higher. It flies under gravity, re-enters nose first, and throws spray on leaving the water and on re-entering it.

A pod within 170 m of a ferry or sailing boat moving faster than 3 m/s may join it and ride its bow wave for 25 to 55 s, spaced out ahead of the stem and along both sides, surfacing every 3 to 8 s. It leaves when the time is up, when the boat slows below 2.5 m/s, or when the bow enters a harbour or shallow water, and then draws back into its rows over about 30 s. Each ferry and sailing boat is offered to the pods through one object, kept for good and updated in place each frame.

Each dolphin is a low-poly body 2.6 m long with a dark grey back, paler flanks and a pale belly, and is drawn with instancing. A vertex shader bends the body with a wave that runs towards the flukes, and curves it along the arc of a surfacing or a leap. A dolphin under water is drawn a second time as a faint dark shape, projected along the line of sight on to the surface and fading with depth, so that hulls and quays above the water still hide it. The shape shows only when the water is looked down into: at a low angle the surface reflects the sky and hides it entirely. It is never drawn where a part of a dolphin above the water stands in front of it. Rings and patches of foam mark the places where the surface is broken, and spray and mist are drawn as points. All of these are drawn after the sea.

A new island (**I**) places every pod afresh in its waters, and the north–south repeat moves the dolphins, foam and spray with the player through `wrapHooks`. The dolphins stand still while the world is paused. The module's `onSound(kind, x, y, z, strength)` hook is called for a breath, a leap and a splash. The splash, as a dolphin falls back into the sea after a leap, plays `sounds/splash.mp3` where it lands, louder the faster it falls; the breath and the leap have no sound yet. `window.__village.findDolphins()` gives the middle of the nearest pod, its distance from the player and what each of its members is doing.

### Swimming and diving

The sea may be entered anywhere it can be reached. The code is in three blocks that are the same in `testbench/diving.html`, where they may be examined on their own, and a section that joins them to the game (`swimming and diving in Coast`).

- `createSwimmer(opts)` carries the player in the water (mode `swim`).
- `createUnderwater(renderer, opts)` draws the water from inside it.
- `createSeabedLife(parent, opts)` makes the seabed's life round the swimmer.

**Getting in.**

- **Walking in.** A walker wading in from a shore that shelves becomes a swimmer once the water is 0.75 m deep. Between 1.5 m and 1.05 m of water the eye passes smoothly between standing height and just above the surface, and the pace between wading and swimming, so walking in and walking out are one movement.
- **Stepping off.** A deliberate step forward off a quay, a mole or a moored boat towards deep water straight ahead drops the player into the sea, as does a jump (Space) out over the edge. Sliding sideways along an edge or turning on the spot does not.
- **J.** J jumps in from the edge of a quay or mole being faced, over the side of the dinghy the view faces (the dinghy is left drifting), or from the rail of a ferry. A ferry under way sails on, and the swimmer keeps half of her speed on entering the water.
- **The entry.** Every entry is a short fall, a splash, a moment under the water with bubbles, and a rise to the surface unless the swimmer swims off.

**At the surface.** The head floats about 5 cm above a smoothed surface, so that the steeper crests wash up across the lower part of the view, but the eye itself never goes under while at the surface.

**Diving.** The swimmer dives by looking down more than about 24 degrees while swimming forward, or by holding C.

- **Going down.** A dive is decisive. The swimmer goes down to 1.35 m below the trough of the waves before the controls return, and stays in the underwater state until surfacing.
- **Surfacing.** The swimmer surfaces by rising to within 0.3 m of the surface (Space, swimming up, or the breath running out). The head then comes out and floats.
- **Movement.** Under the water the swimmer moves along the view against a drag that grows with the square of the speed, with a lag on the thrust, so that letting go coasts gently to rest. A free diver is buoyant near the surface and a little heavy below about 12 m.

**Breath.** A breath lasts 75 s, and less while sprinting. No meter or text is shown. From about 40 per cent the view narrows and darkens at its edges, and a heartbeat grows louder and quicker. At the end of the breath the swimmer is carried gently up to the surface, and never further. At the surface the breath recovers in about 14 s.

**Getting out.** There are three ways out, and the player is never trapped in the water:

- swimming to a shore that shelves, where the swimmer finds the bottom, wades and walks out;
- climbing a harbour's ladder (see [Harbours](#harbours)), by swimming to its foot facing it;
- climbing on to any ledge less than about 0.95 m above the water.

**The view.** The view follows where the camera's near plane, the lens, stands against the waves. Over the few centimetres of the near plane the surface is taken as its tangent plane at the eye, with a capillary wobble of a few millimetres.

- **Above the water.** The frame is drawn as before.
- **Under the water.** The frame is drawn through the underwater passes.
- **Split view.** Where the waterline crosses the lens, both views are drawn and joined along it, with a thin bright meniscus, a little bending of the view just below it and a few droplets above. The second view is drawn only while the waterline crosses the lens.

**Under the water.** The scene is drawn into a half-float target with its depth, with the far plane pulled in to about 86 m so that everything further is culled.

- **The water.** A last pass applies the water: the light reaching each depth with the red absorbed first, the extinction and the light scattered along the line of sight (sampled one mean free path from the eye), a white balance that fades with range, and an exposure that adapts to depth and to the hour. The visibility is about 28 m.
- **Light shafts.** Shafts are marched at half resolution through the sun's shadow map and the sheets of light focused by the ripples, faint and seen mostly looking up or towards the sun.
- **The surface from below.** The surface is drawn from below by its own mesh on the sea's waves. Inside the critical angle of 48.6 degrees it shows the sky (Snell's window), and outside it is a mirror of the water beneath, with the exact Fresnel term at the edge.
- **Going under.** A wash of bubbles rises past the eye and the frame fades in briefly from the colour of the surface. The sea mesh is hidden under the water, the dolphins' faint shapes on the surface are not drawn, and the sea's depth pass is skipped while the lens is wholly under.

**The seabed.** While the view is under the water the ground's shader paints the seabed by habitat (`SEABED_GLSL`):

- **Habitats.** Rock lies where the bed is steep, Posidonia meadows between 3 and 19 m in patches, and sand elsewhere, with noisy borders a few metres wide.
- **Sand.** Rippled sand with grain, mottling and flecks.
- **Meadows.** A dark meadow floor with sand patches and leaf litter.
- **Rock.** Rock with encrusting patches and crevices.
- **Caustics.** Drawn on the ground's own smooth surface, strongest on upward faces, softer and fainter with depth, gone in shadow and thinner under the grass.
- **Matching the life.** The habitat's noise is an integer hash computed alike on the CPU (`seabedHabitat`) and the GPU (`sbHab`), so the meadow's floor lies where its leaves are planted.

**The seabed's life.** The life is made from the seed in cells of 8 m within 40 m of the swimmer, and refilled only when the swimmer enters another cell. Each kind is one instanced mesh:

- boulders and slabs;
- Posidonia, with the rocks' weed sharing its mesh;
- sea urchins, starfish, sponges, gorgonian fans and amphorae.

The fish are generated in groups in cells of 24 m and keep away from the swimmer:

- shoals of small silver fish;
- damselfish (*Chromis chromis*) over the rock;
- two-banded bream along the bottom;
- now and then a dusky grouper by a boulder.

About a third of each coast's 600 m stretches have a small wreck on the sand 16 to 19 m down, clear of harbours and ferry crossings, with an amphora or two near it (`diveProps`).

**Sound.** Under the water the sounds of the air are muffled and lowered, and Reef's underwater ambience (`underwater`) comes up, as far as the lens is under. Every entry plays `splash` at the entry point, louder and deeper the harder the entry.

**Cost.** On land, aboard and in the bird's-eye view none of this is updated or drawn. The ground's seabed shading runs only while the view is under the water. The programs and targets of the water are prepared when the game starts, so that the first dive does not stall.

**Pausing and moving about.**

- **P.** The player swims on while the world is paused.
- **The north–south join.** The swimmer crosses it with the player.
- **A new island (I).** The player leaves the water first.
- **R, F, G and Y.** These bring the player out of the water where they are before going on.

The water's passes draw the scene into half-float targets, for which three.js builds a second program for every material, without tone mapping. At load `UW.prewarm` compiles every material in the scene for such a target as well as for the screen, and while the player is out of the water `UW.warm` compiles, every three seconds and in the background, the materials that have come into the scene since. Without them the first dive stopped the frame for several seconds while the programs were built.

### Walking and collision

The player stands on the highest walkable surface at their position, given by the walkable-surface function (terrain, steps, terraces, moles, platforms and decks). A step up may be at most `STEP = 0.8` m. A walker wading into the sea becomes a swimmer once the water is 0.75 m deep (see [Swimming and diving](#swimming-and-diving)). Deeper water stops a walker, except for a deliberate step forward off an edge towards water that lies straight ahead, or a jump out over it. Buildings and objects are oriented boxes; the collision code pushes the player out along the shortest axis, and treats a position exactly at an obstacle's centre as lying on the positive side, so that the player is never left inside an obstacle.

In a cove the ground for walking is given by `walkGround`. Near a cliff it is the clifftop for a walker above half the cliff's height and the foot for one below, so the line of the cliff is a sudden step. Inside the walkable cave, below 1.9 m above its floor, the floor of the cave is the ground, within a band that keeps the eye clear of the walls and a ceiling at least 2.35 m high. Each step is checked by `coveMoveOk`: it may rise no more than `STEP` and fall no more than 1.4 m, and where the ravine's floor is steeper than 0.6 it may be walked only on the path, within `CV_PW = 1.2` m of its line and `CV_PL = 1.8` m of a turn. A walker who is on that steep slope off the path may still go down it, or back towards the path. In a cove the whole step is tried first; where it is refused, the step is turned towards the edge in stages of 0.3 rad, up to 1.45 rad either way, and shortened by the cosine of the angle, so that the walker slides along the foot of a cliff or the side of the path instead of stopping. The cliffs therefore cannot be climbed or stepped off, and the beach, the shelf and the cave are reached on foot only by the path, or from the sea. `reachable` follows the same rules.

### The start

The player starts on the seaward edge of a square raised at least 8 m above the sea, facing a point on the shore that can be walked to directly (`spawnPlayer`). The squares of the first stretch of the south shore are tried nearest the middle first (`spawnSquares`), and each is walked by `shoreWalk`, an A* search over a 0.5 m grid in eight directions under the walker's rules: steps up of at most `STEP`, drops of at most 1.4 m, the paths of a cove, no deep water and every collider, with 0.35 m clear either side of the body. The walk ends at a beach at the water's edge or at the edge of a harbour's quay (`shoreGoal`), and the square passes if the walk is no longer than `SPAWN_DETOUR = 1.45` times the straight line to that point. Of the squares that pass, the first from which the sea can be seen in the way faced is taken: at least three of eleven sight lines, fanned 25° either side and ending on the sea 100 m beyond the shore (`SPAWN_SEA`), must clear the ground and the roofs between (`shoreInView`). No more than five squares are tried beyond the first that passes, and if none of them has the view, the first that passed is taken. The blocks the searches cross are built at full detail for them and kept. Where no square of the first fourteen passes, the nearest square is taken, facing the sea. `window.__village.spawnInfo` holds the start chosen, its walk, whether the sea is in view and the time taken, which is between about 0.5 and 3 s.

### Buildings that can be entered

In the blocks at full detail every house, barn and cottage with walls at least 2.4 m wide and 2.62 m high can be entered, as can every church and tower, the station building and the lighthouse keeper's cottage. A house drawn without a door is given one from its own random sequence, so that the layout of the town is unchanged. Further away the buildings remain solid boxes with painted doors.

- **Doorways.** The front wall of an enterable building is built round an arched opening 1 m wide and 2.35 m high, with a reveal through the 30 cm wall and a stone surround. A church has a pair of leaves in an opening 1.7 m wide.
- **Doors.** Each leaf is one instance of a shared mesh (`doorMeshes`), hinged at a jamb. Pushing is resolved before collision: a leaf in contact with the player turns away from the side the player stood on in the previous frame, at up to 4 rad/s and no further than 1.55 rad, until it no longer touches them. A leaf is then pushed shut by a damped spring once the player has left its sweep. A door whose room has not yet been built does not move. Near a doorway and indoors the player's radius eases from 0.6 m to 0.3 m.
- **Rooms.** The interior of a building is built only when the player comes within 26 m of it, for at most 15 buildings at once, one per frame, and removed as the player moves away (`roomsUpdate`). It is lit not by the sun but by its own lights (`setRoomLights`): daylight through each window, and through the doorway while the door stands open, falling off with distance and the angle to the opening; its lamps, hearth or candles; and a little ambient light. Each light belongs to one storey. Each room has its own material, sharing one program, whose uniforms hold its lights. The floor of a room replaces the ground beneath it for walking, and the ground and the town's own geometry are not drawn inside a built room (`roomClip`), which keeps a hillside or a neighbouring structure from showing through.
- **Windows.** An enterable building's walls have a real opening behind each window pane, in the same place inside and out. While its room is not built the pane covers the opening from outside, dark or lit at night; once the room is built (within 26 m) the pane is cut away in the building shader (`winClip`), a faint glass takes its place, and the room can be seen through it. From inside a window is an opening with a casement frame and a deep sill. The ferry's saloon and wheelhouse have such glass always.
- **Storeys.** A house of two or more storeys whose room is at least 3.4 m wide and 4.65 m deep has a floor at every storey, reached by straight flights of 13 risers of 20 cm along the side walls. Upper storeys are furnished as bedrooms. Steps, floors and furniture are colliders with a top and a bottom, so that each storey's furniture is passed under from the storey below.
- **Towers.** A stair of cantilevered treads winds round the walls of a tower to the floor of its top room. A campanile's top room is the belfry, with its bell and open arches.
- **Churches.** The nave has pews either side of the aisle, a font and lamps, an open roof on trusses, and an apse behind an arch, with the altar on a step. Only the half of the apse cylinder outside the nave is built at full detail. Each side window carries abstract stained glass drawn by `SG_GLSL` in four of six colours chosen by the church's seed. The coloured light on the church's surfaces is found per fragment by tracing a ray towards the sun to the plane of the glass on the sunlit side and reading the glass where it crosses; it is computed for the most recently built church only.
- **Lighthouses.** A lighthouse on the coast is built at full detail with its doorway cut from the tapering tower (`lhTube`). A stair of stone treads winds round a newel, 20 to the turn, up through the floor of the gallery into the lantern, whose glazed door, turned away from the stairwell, leads out onto the gallery. Lighthouses on rocks at sea cannot be reached and stay closed.
- **The ferry.** The saloon has rows of seats and a bar, and the wheelhouse a console, the wheel and a chart table. Their doors and walls are worked in the ferry's deck plan (`ferryInside`). Both are lit as a house's rooms are, by sixteen lights given in the ship's own frame (`FERRY_LIGHTS`) and placed in the world each time the cabins are drawn: daylight through the saloon's window bands, three lights a side, through its end windows and through the wheelhouse's windows, falling off across the cabin and with the angle to the window; and the ceiling lamps, which glow and light the cabins warmly towards evening. The walls are lined on the inside so that they take this light, and shading is baked into the colours: darker low down, into the corners, under the seats and towards the edges of the ceiling. Each ferry has its own material, sharing the rooms' program, so the cabins cost no more draw calls.

### Roofs and climbing

The roofs of the houses, barns, cottages, towers and station buildings may be walked on, and the player may climb up to them and jump from one to the next.

- **The surface.** Each house's obstacle carries its roof (`ob.roof`: its kind, the height of the top of the walls, its rise and the walls' width and depth), and `roofAt` gives the height of the roof's outer surface at any point, from the same dimensions that `gableRoof` and `hipRoof` build it from: on a gable, the tiles 0.19 m out from the slope and 0.28 m beyond the walls; on a hipped roof or a spire, a pyramid on the top of the walls widened by the same overhang; on a flat roof, a slab 0.15 m above the walls. Once the player's feet are within 0.3 m of the top of a house's walls, the house is its roof: it holds the player off only where the roof stands more than a step (`STEP = 0.8` m) above their feet, and elsewhere its surface is the ground. A roof can therefore be walked up to its ridge and down the far side, and stepped across from one roof to a neighbour at much the same height. Below that height the house is its walls, or its rooms, as before, so that standing on a roof never puts the player inside a house, and nothing inside a house reaches up through its roof.
- **Steep roofs.** A roof steeper than 40° (`ROOF_GRIP = 0.84`, rise over run) cannot be stood on. The player slides down it at 2 m/s and more, faster the steeper it is, and over the eaves. The gable roofs lie between 33° and 44°, so that about half of them can be walked; a hipped roof is often walkable on its long faces and too steep on its short ones, and no spire can be stood on.
- **Chimneys and parapets.** A chimney is an obstacle on its roof, 0.6 m square, from the top of the walls to its own top. The merlons of a crenellated tower stand as obstacles 1 m high round its flat roof, too high to step over.
- **The jump.** A jump lifts the feet about 0.9 m (`JUMP_V = 5.8` m/s, against 0.75 m before), rather more than a person could, so that the game is forgiving. In the air, running is held to 6.2 m/s (`AIR_SP`), so that a running jump clears about 4 m between roofs of the same height and a walking jump about 3 m; a jump that falls a little short may still catch the far eaves and climb up. A jump that falls short drops the player to the street; there is no damage, and the landing sound plays if `sounds.json` names one.
- **Mantling.** Jumping at a wall, a ledge or the eaves of a roof while pressing towards it climbs onto it, if its top lies no more than `MANTLE_REACH = 1.2` m above the eye and there is room to stand there (`mantleTry`, `topAt`). The body is drawn up and over the edge in half a second (`MANTLE_T`). From the street this reaches about 3.6 m: the walls of the orchards, terraces, the counters of the market stalls, the beach kiosks and the eaves of a single storey. The orchard walls, the stalls and the beach kiosks now have tops at their real heights for this, instead of being unclimbable. A building of two storeys is reached from a lower roof, a wall or a stair beside it. Mantling does not happen indoors.

### Sitting

Every seat in the game may be sat on: the chairs of the rooms' tables and the bedrooms' chairs, the benches of the station building, the pews of a church, the chairs of the cafés on the piazzas, the benches round the piazzas, on the belvederes, on the station platforms and on the harbour quays, the stone ring round a great elm, the loungers on the beaches, the seats of the coaches and the seats of the ferry's saloon.

- **Seats.** A seat is recorded where its furniture is built, as the middle of its top, the direction in which a sitter faces, its height above the floor and its kind (`seatOf`, `addSeat`). The seats of a block at full detail are held in `ch.seats`, those of a room in `D.seats` once the room is built, and those of a coach and of the ferry's saloon in `COACH_SEATS` and `FERRY_SEATS`, in the vehicle's own frame. A bench offers two places, a pew one place every 0.6 m and a coach's bench a place by the window and one by the aisle. Nothing is searched while the player walks; the lists are read only when **X** is pressed.
- **Sitting down.** **X** chooses, among the seats within 1.5 m (1.9 m for a lounger, which is reached from either end) on the player's own floor, the nearest one towards which the player is turned, within about 63° of the line of sight. A seat within 0.45 m of a cat is taken. Indoors only the room's own seats are offered, and outdoors no seat is offered through the wall of a building.
- **The seated view.** Over 0.4 s the eye eases from where it was to the sitter's eye, 0.7 m above the seat and slightly behind its middle, which is 1.15 m above the floor on a chair, and turns to the direction in which the seat faces. On a lounger the eye is 0.8 m above the sand towards the head of the lounger, looking out to sea and raised a little, as of someone lying back. The mouse and **Q E** then look about within 120° either way of that direction, and up and down within a comfortable range.
- **Standing up.** **X** again, or a step with **W A S D**, stands the player up beside the seat, and the eye eases back to standing height over 0.4 s. The place is the first of several round the seat (in front, to either side, then behind) at which the collision code leaves the player where they are and the floor lies at the seat's own floor; if none is free, it is the place where the player stood before sitting down. The player is therefore never put inside furniture or a wall.
- **Seats that move.** A seat in a coach or on the ferry is held in the vehicle's frame, so that the sitter is carried with the train or the ship, through the ferry's pitch and roll. Standing up in a coach puts the player in the aisle beside the seat, and on the ferry in the saloon's aisle; when the train stands at a station or the ferry lies at a landing, the player walks off as usual. A change of view, such as **V**, **F** or **R**, or a new island, ends the sitting at once.
- **Sound.** The sounds `sit_down` and `stand_up` are played at the seat. There is not yet a suitable recording, so they are silent until `sounds.json` names one.

### Sunbeds and parasols

Some of the mainland's beaches are let out with rows of loungers and parasols (`beachStretch`, `buildBeachFurniture`). The beaches are taken in stretches of `BCH_SP = 150` m along each shore. A stretch is furnished where the sand runs at least 11.5 m up from the water's edge all along it, clear of the coast road's parapet, where it lies clear of harbours, coves and their paths, ferry crossings, lighthouses, stations and the railway, and where a draw from the seed allows it: seven stretches in ten beside a village and one in four elsewhere. No boat is moored, anchored or pulled up within `SUN_ALONG = 50` m along the shore of either end of a furnished stretch, from its sand out to `SUN_OUT = 60` m into the sea (`nearSunbeds`); this holds for the boats of a harbour and the fishing boats' berths too.

- **Layout.** The furnished part of a stretch is 24 to 46 m long. Its loungers stand in pairs, with a parasol between each pair, in two rows parallel to the shore, or three where the sand is deep enough, every 3.6 m along a row and 3.7 m between rows. The first row stands about 5.6 m from the water's edge, so that a band of open sand is left along the sea. The loungers lie with their feet to the sea and the back raised at the landward end, and the gaps between them are wide enough to walk through. About one parasol in five is furled, and here and there a single lounger stands under a parasol.
- **Appearance.** Each stretch has one scheme: white or wooden frames, cushions in one of seven colours, plain or striped with white, and parasols striped in the same colour and white, or in about three cases in ten of straw. Three stretches in five have a small kiosk at the back of the beach, with an awning in the same colours, where it fits.
- **Cost and detail.** Everything is merged into the geometry of the block that holds it, and so costs no extra draw calls, and the parasols cast shadows with the rest of the block. At full detail the loungers have legs and cushions, striped cushions in four bands; in the simplified blocks each lounger is a frame, a back and one cushion, the poles and the furled parasols are left out and the open canopies remain; the outline blocks carry none of it.
- **Collision.** Each pair of loungers with its parasol is one obstacle 2 m square, and the kiosk another.

### Time of day, lighting and shadows

A full day lasts twelve minutes. The sun rises over the south sea at 06:00 and sets over the north sea at 18:00. One light casts shadows: the sun by day and the moon, opposite the sun, by night. The star field turns about the same axis as the sun and the moon.

The shadow map is a square centred on the player and moved in 2 m steps. Where the GPU allows an 8,192-pixel texture, the map covers 240 m across at about 2.9 cm per texel; otherwise it covers 120 m.

### Shading

The building and ground shaders add procedural surface patterns according to the `surf` attribute: plaster, roof tiles, stone, wood, brick, bougainvillea bracts and natural rock, the last with faint beds, pitting and grain for the cliffs, caves and boulders of the coves. The sea has layers of ripples, each of which fades out as its wavelength approaches the size of a pixel, beneath the waves described under [The sea](#the-sea). The fountains' bowls and basins are hollow, and the water stands in them just below the lip. In a tiered fountain a jet of about a metre rises from the finial and falls back into the upper bowl, and a thin sheet spills over the lip of each bowl and falls almost vertically, within a few centimetres of the stone, into the pool below. A small fountain has four spouts, each pouring a round stream into its basin. The falling water is drawn with fine streaks of smooth noise that run down at the speed of the fall; a sheet divides into separate streams as it falls and breaks into drops near the bottom. Each pool is a gently rippling surface that reflects the sky and the sun, with rings spreading from where the water lands and foam and a small splash of drops at that point. The stone just below each lip is darkened and wet. Fine detail settles to its average where it would be smaller than a pixel. By night the water is darker than the lit stone and catches a little warm lamplight. All the moving water of a block is one mesh with one shared material, and blocks drawn at lower detail have fewer segments and no splashes or wet stone.

### Cameras

- **Street level.** First person, at walking height.
- **Bird's-eye.** Orbiting above the player. The fog, far plane and sea grow with the zoom so that nothing is clipped.
- **Cab.** On the track 1.2 m ahead of the locomotive's nose, at the driver's eye height, with the whole train drawn behind; the mouse looks round, so the locomotive can be seen by looking back.
- **Chase.** Behind and above the train, orbited with the mouse and kept clear of the ground. While the train is underground, the camera follows the hillside above it.
- **Ferry.** Walking about the decks, with the eye following the ferry's motion, its slow heave, pitch and roll on the sea included.
- **Dinghy.** At the helm, sitting out to windward, with the eye following the boat's heel and pitch.

**Tilt-shift.** The scene is rendered off-screen and blurred horizontally and vertically, with a radius that grows away from a horizontal band of sharp focus through the player, so that the view resembles a miniature model.

### Photographs, the gallery and artist mode

**K** raises the camera. The frame is then drawn through a lens model (`photo/camera.js`): a focal length of 16 to 300 mm in the equivalent of a 35 mm frame, depth of field from a thin lens, autofocus on the AF point at the centre or manual focus, and exposure compensation. Its controls are laid out on the screen as a camera's are. A panel at the foot of the frame holds the zoom, the focus, the aperture and the exposure, each with its value, a scale showing where the value lies in its range, and − and + buttons that step it, at once and then repeatedly while held; the focus also carries an AF/MF switch. A rail on the right holds the shutter and, beneath it, the latest photo with the number of photos taken, which opens the gallery. A button at the top right lowers the camera. The mouse is not captured while the camera is raised, so that the controls can be clicked, and clicking the scene takes no picture; a drag turns the view, and the player walks, swims and turns with the usual keys. The camera stays raised until it is lowered with that button, K or Esc. When it is lowered none of this runs and the frame is drawn exactly as before.

The gallery (**L**, or the photo on the rail) lists the photos newest first, one row to a photo: the photo with its number and the time it was taken, then the artworks made from it, each labelled with its style. A click on any item selects it and shows it large with its details. **Download PNG** and **Delete** act on the item selected and are unavailable while nothing is; deleting a photo deletes its artworks. **Artist mode** is available while a photo is selected. The arrow keys move the selection and Esc or L closes the gallery. At most 24 photos are kept, for the length of the session.

Artist mode makes artworks from one photo (`photo/gallery.js`). A style is chosen first, from Watercolour, Oil, Impressionist, Charcoal and 3D render, and its settings are then shown: for the painted styles the time taken to paint and the style's own settings, and for the 3D render the time limit (30 seconds by default), the maximum samples per pixel, the resolution (a multiple of the photo's size, shown in pixels), the bounces of light, the path-traced distance, the draw distance, the visibility in the haze, the noise filter, glass and metal, the reflectivity of glass and metal (`setReflectivity` in `photo/pathtrace.js`, which changes the materials in place without building the scene again), and haze. Every change is kept at once in the browser's local storage, under `coast.pictureSettings`, and restored the next time. **Render** makes the artwork in a large preview, where it is seen being painted or clearing from noise, with its progress beneath the settings; a render may be stopped, and another render, a change of style or leaving artist mode stops one in progress. Render may be pressed as often as wished. **Save** keeps the finished artwork in the gallery under its photo. It is available exactly while there is a finished render that has not been saved: it becomes unavailable when the artwork is saved and while a new render is made, and available again when that render finishes. Leaving artist mode with a finished render that has not been saved asks, on the page, whether to save it, delete it or stay.

The painted styles run in a WebGL context of their own (`photo/effects.js`). The 3D render path-traces the scene again (`photo/pathtrace.js`) from the camera with which the photo was taken: the photo keeps its projection and world matrices and the floating origin at the time, and the camera is rebuilt from them and moved by the difference between that origin and the present one. The world is built round that camera for the render, so that a photo may be rendered after the player has gone elsewhere, as long as the place lies on the present island: only where the camera looks (and close by in every direction), with each block at the detail its distance asks for, taken from the game where it has built that block and otherwise generated for the picture alone, a few at a time between frames, and beyond the blocks the land as a terrain mesh out to the draw distance. The game's own draw distance is not changed; the game draws nothing, and its world stands still, while the picture is made. The scene is kept while artist mode stays open, so that the same photo rendered again with other settings goes straight to the tracing.

The 3D render is a hybrid of path tracing and rasterisation, made to finish within the time limit. Only the near field, out to the path-traced distance (500 m by default), is path-traced, and its triangles alone are put into the BVH, so that the BVH is small and quick to build and the rays are short; the near field ends sooner where the budget of triangles and vertices given to the path tracer runs out first, as it does in the middle of a town. Beyond it the world, with its blocks, the game's objects and the distant terrain, is drawn only by the raster passes that give the surface colours and the guide for the filter, and its light is worked out from a model: the sun's light, as far as two shadow maps drawn from the sun over the far part of the view say the sun is seen, and the light of the sky and of the ground on a surface facing each way. The two parts of the model are fitted, by least squares, to the path-traced light of the surfaces at the edge of the near field, so that the two fields agree in brightness and colour, and the far field is blended in over the outer 30 % of the near field. In the path tracer the distant terrain, left whole under the far blocks, stands in for them in reflections and shadows. The pixels of the far field are not traced at all; those of open sky are traced at one pass in eight, and the far field's sea, glass and metal at one pass in three with two bounces. The samples are then taken until the time limit would be passed, or until the maximum number has been taken, and the noise that remains is filtered, so that a slower computer makes a picture of fewer samples in the same time instead of taking longer. While the BVH is built in its workers, a first picture is shown, lit throughout by the model of the far field; the frames shown while the picture is traced are filtered, so that a recognisable picture appears after the first sample.

The work is spread so that the page and the computer stay responsive. The slow steps on the page (building the geometry, the sky, the colour passes and the BVH's split) give the page a turn every few milliseconds, and the path tracer is given the GPU one tile at a time, with only one tile on the GPU at once. The number of tiles is adjusted so that a tile takes about 30 ms, since many small tiles cost far more than a few large ones, and the tracing pauses whenever it has kept the GPU busy for more than 85 % of the last tenth of a second. On an M2 Pro at 1280 × 800 a render at the default settings takes 30 seconds, with 34 to 95 samples per pixel, the first picture appearing after 4 to 6.5 seconds; the page's longest pause is about 0.5 seconds, while the geometry is first sent to the GPU, and at most about 80 ms while the picture is traced.

### Cats

The cats are drawn by the code of Michi-Neko: The Cat Philosopher's Path (`cat/`, MIT licence). Each cat's coat is one continuous surface, sculpted from signed-distance shapes and meshed by surface nets when the first cat of each build is made, then skinned to a skeleton with a six-bone tail. Its gait, idle actions (sit, groom, stretch, yawn) and sleep are posed in code every frame. `index.html` maps the module specifier `three` to three.js r160 with an import map so that these modules share Coast's copy of three.js.

Coast draws the cats at `CAT_SCALE = 0.62` of Michi-Neko's size, about 0.75 m from nose to tail tip, and without the ink outline: the outline shells are hidden when each cat is made, and the cat casts the scene's shadows in place of its own shadow disc.

About two blocks of town in five (quarters, squares, church blocks and the shore) have a cat, with a home spot chosen once the block is built, in its square where it has one. Every cat within six blocks of the player lives on independently: its position and what it is doing are kept in `cats.states`, so a cat left behind is where it was when the player returns. Up to `CAT_POOL = 12` of the cats nearest the camera are drawn, and the models are handed between cats as the player moves. There are five coats on Michi-Neko's four builds: a brown tabby, a grey, a ginger, a black and a white.

A cat pauses for 2–9 s, then sets off at 1.1 m/s for somewhere 4–18 m away, drawn back towards home once it has strayed 40 m; four times in ten it heads instead for the top of a wall, step, terrace or mole close by. Its route is planned in steps of 0.35 m over the surfaces at each point (the ground and the tops of walls, steps, terraces and moles): rises of up to 0.45 m are walked, so it climbs and descends steps and slopes; a ledge up to 1.9 m higher is a leap, and an edge up to 3 m lower a jump down, each on an arc that clears the higher edge. A route is refused where any part of the body (nose, tail end or flanks) would meet a building, a tree or a wall too high to climb, or where it would reach water. The body tilts with the slope or the steps under it. A cat carries its tail low, and raises it as the player comes within 5 m at street level (through `tailDrop` in `cat/cat.js`). It glances at a player passing within 3 m without breaking off what it is doing. An awake cat mews every 25–70 s, and half the time when the player first comes within 3 m; the sound comes from the cat, pitched a little higher or lower each time, and its mouth opens with it. A mew is heard only from close by: at full level within 6 m of the listener, fading to nothing at 14 m. At night three cats in five curl up asleep where they are, and the rest go on roaming. Cats are hidden in the bird's-eye view above 150 m.

### Gulls

A flock of 16 yellow-legged gulls lives round the player. A gull has a white head and body, a grey mantle and grey wings with a white trailing edge, black wing tips, a yellow bill with a red spot and yellow legs; about one in seven is a grey-brown immature bird. The gulls are drawn at 1.25 times life size, about 0.75 m long with a wingspan of 1.75 m, so that they can be made out at a distance.

The gull code is one block, `createGulls`, which returns an object with `update(dt, ctx)`; the game calls it from `updateGulls` in the frame loop. All the gulls are one `InstancedMesh` in `world`, placed at `ORIGIN` with each bird relative to it, and are drawn in a single draw call. The body is fixed geometry, and the wings are posed in the vertex shader from four numbers per bird (the angle at the shoulder, the angle at the wrist, the sweep of the hand and how far the wing is folded), so that the shadow pass poses them in the same way.

A gull circles on a thermal, banked into the turn at the angle a coordinated turn requires, and flaps in short bursts or when it must climb. It glides from one thermal to another, follows a sailing boat or a ferry, or comes down to stand on a perch or to sit on the sea, where it bobs and drifts. A slow boat is circled from a point astern; a ferry, which moves too fast to be circled, is kept pace with from a place astern and to one side. Gulls that are close together steer apart. A gull that is standing faces into the wind and now and then raises its wings. It takes off when the player comes within 6–12 m of it, or when a boat comes close on the water, and those standing near it take off a moment later. A fishing boat coming home with its catch (`catch` on its record) takes precedence over every other boat: the nearest gulls join it up to its quota (`want`, 4–7), and no more than half the flock at once for all such boats together, keep closer and lower behind it and dive at its wake every few seconds; when it has berthed (`settle`) they come down on its deck and wheelhouse (`perches`), on the quay beside it or on the water. As the light fails the gulls come down to roost on the perches and the sea, and stay there until morning.

Perches are gathered by `gullPerches` within 320 m of the player, again whenever the player has moved 60 m and every 10 s: the coping and bollards of the harbour quays and the parapets of the moles, from `harbourInfo`; the rocks that carry a lighthouse, from `seaRockInfo`; the stacks and landing of each cove once it is built; and the first dry ground above the water along the rest of the shore. Thermals are placed only along the shore, and a flying gull keeps within about 70 m of the shoreline: beyond about 40 m inland (`seaDist`) a pull towards the sea begins and grows smoothly towards that limit, and it starts sooner in an onshore wind. Land perches more than 40 m from the water are not used. The gulls fly in the global wind (`WIND`), which `updateDinghies` passes to them through `gullWind` each frame.

The flock stands still while the world is paused, moves with the world when it repeats from north to south (`wrapHooks`), and is placed afresh round the player when a new island is generated. A gull's call goes to the sound `gulls`, at most one every 2.5 s and only from gulls within 140 m; each call is one of five recordings cut from a single field recording (`sounds/gulls-1.mp3` to `gulls-5.mp3`), three single cries and two longer passages of calling, chosen at random. For automated checks, `window.__gulls` holds the flock (`G`), its context (`ctx`) and a switch (`on`) that removes the gulls entirely.

The gulls were developed in `testbench/seagulls.html`, a page with a beach, a quay, a boat and controls for the number of gulls, the wind, the time of day and the view, served from the repository root like the game. Its `createGulls` block is the same as the game's.

## Sound

### Engine

The sound engine uses the Web Audio API and starts on the first user gesture. Each positioned sound uses HRTF panning with the inverse distance model. Moving sources are given a Doppler shift (playback rate `343/(343+v)`, limited to 0.7–1.4) and a low-pass filter that falls with distance to imitate absorption by the air. A sound far beyond hearing is stopped.

Sounds are routed to four buses: `world`, `train`, `ferry` and `player`. Each bus passes through its own low-pass filter.

- **Inside a coach,** the world is cut at 900 Hz and the train at 1,100 Hz. **In the cab,** the cut-offs are 1,400 Hz and 1,800 Hz.
- **In a tunnel,** a generated convolution reverb is used, consisting of early reflections and a 2.8 s tail that darkens over time. The world outside is attenuated as the listener moves into the bore.
- **In a sea cave,** the same reverb is used, but the world outside is not attenuated.
- **Under the water,** the `world`, `train` and `ferry` buses are cut towards 500 Hz and lowered by up to 70 per cent, as far as the camera's lens is under the water, and the `underwater` ambience is mixed in to the same degree on the `player` bus. The heart, the dive, the surfacing and the gasp at the end of a long breath are made by the engine on the `player` bus and are not muffled.
- **Occlusion.** A train inside a tunnel, heard from outside, is quieter and low-passed.

### What the engine plays

- **Ambience.**
  - Day, night and dawn beds, with cicadas by day and crickets at night.
  - Wind in the open and in the trees.
  - Water lapping at the nearest shore, surf on the nearest beach, and waves on the nearest rocks or mole. They fade out between 40 m and 90 m from the water, because from further off, muffled by the air, they would sound like wind.
  - Gulls, and an owl at night.
- **Places.**
  - The three nearest fountains.
  - The two nearest cafés, which are busy from morning until late evening.
  - At the nearest moored boat, water slapping at the hull, creaks, and rigging on boats that carry a sail.
  - The clock striking the hour, followed shortly afterwards by the church bell.
- **Footsteps.** A loop for the surface underfoot plays while the player walks, faster while running. The surface (pavement, sand, soil or grass) is read from the ground mesh. Grass uses the soil loop, the pebbles of a sea cave the sand loop and the cliffs' bare rock the pavement loop, and the decks of a ferry and the floor of a coach use the pavement loop. A separate sound plays on landing from a jump.
- **Train.** Run and idle loops at the locomotive, and a rumble from the point on the train nearest the listener. A bridge loop plays on viaducts and a rail joint every 18 m under each bogie. Separate sounds play for starting, stopping, brakes, the doors opening and closing, and the horn on departure and before a tunnel.
- **Ferry.** Run and idle loops at the stern, and the wake at the bow. Separate sounds play for the horn, starting, stopping, the gangway, the gates and the fenders. The horn sounds only as the ferry is about to leave, 3 s before it casts off from a landing, and it echoes from the hills (`hornWithEchoes`): twelve bearings from the ship are searched outwards to 2.5 km for the first ground more than 25 m above the sea, and the three nearest slopes send the horn back, fainter and duller, from where they stand, delayed by the extra distance the sound travels out to them and back to the listener.
- **Goods train.** Its engine at the leading shunter, a start, a horn and the clatter of the couplings as it sets off, a stop, and rail joints (`goods_run`, `goods_idle`, `goods_start`, `goods_stop`, `goods_horn`, `goods_buffer`). Until they have recordings of their own they borrow the train's, through `SOUND_ALIAS`.
- **Dinghy.** Sailing is heard as the water along the hull, the bow wave (`bow_wave`) growing louder and higher in pitch as the boat gathers way; as the wind across the boat (`sail_wind`, a recording made to loop seamlessly), silent below 1.5 m/s of apparent wind and full by about 10 m/s, a little higher as it freshens; and as the sail flapping when it luffs (`sail_flap`, a recording made to loop seamlessly), louder the more it shakes. As the sail comes over in a tack or a gybe a short burst of flapping plays (`sail_over`, the strongest 1.4 s of the same recording), louder the harder she comes round. The knock of the hull is silent.
- **Buildings.** `door_open` plays when a door begins to open and `door_close` when it shuts. Indoors, and in the ferry's saloon and wheelhouse, the world outside is muffled, less so while the door stands open. A church adds the tunnel's reverb.

### Recordings

The full list of 48 sound identifiers, with the category, type, channels, placement and conditions under which each plays, is kept in the Google Sheet "Coast – sound list":
<https://docs.google.com/spreadsheets/d/1I5Z2FXeJlASb57JWM6czgj7tl4D_sDudHbNa3s5yHjk/edit>

`sounds.json`, beside `index.html`, maps identifiers to files in `sounds/`. A value may be a single path or a list of paths; when a list is given, one of the files is chosen at random each time the sound plays. Any identifier missing from `sounds.json` stays silent. The recordings supplied so far, which Mark keeps in `village sounds/`, are assigned as follows.

| File in `sounds/` | Identifiers |
|---|---|
| `day.mp3` | `amb_day` |
| `night.mp3` | `amb_night` |
| `shore-waves.mp3` | `water_lap` |
| `fountain.mp3` | `fountain` |
| `church-bell.mp3` | `church_bell` |
| `steps-pavement.mp3` | `step_pavement` |
| `steps-sand.mp3` | `step_sand` |
| `steps-earth.mp3` | `step_soil` |
| `train-run.mp3` | `train_run` |
| `train-start.mp3` | `train_start` |
| `train-door.mp3` | `train_doors_open`, `train_doors_close`. The first 1.15 s of the recording are cut, so that the slide sounds while the doors move. |
| `ferry-engine.mp3` | `ferry_run`, `ferry_idle` |
| `ferry-wake.mp3` | `ferry_wake` |
| `bow-wave.mp3` | `bow_wave` |
| `cat-mew-1.mp3` to `cat-mew-4.mp3` | `cat_mew`, one chosen at random each time |
| `cicadas.mp3` | `amb_cicadas`. Made to loop seamlessly by cross-fading its last second into its first. |
| `gulls-1.mp3` to `gulls-5.mp3` | `gulls`, one chosen at random each time: three single cries and two longer passages, cut from one recording with short fades. |
| `splash.mp3` | `splash`: a dolphin falling back into the sea, and the player entering the water, louder and deeper the harder the entry. |
| `sail-flap.mp3` | `sail_flap`. Made to loop seamlessly by cross-fading its last half-second into its first. |
| `sail-over.mp3` | `sail_over`: the strongest 1.4 s of the flapping recording, with fades, for the sail coming over in a tack or a gybe. |
| `sail-wind.mp3` | `sail_wind`. Made to loop seamlessly by cross-fading its last second into its first. |
| `ferry-horn.mp3` | `ferry_horn` |
| `door-open.mp3` | `door_open`, for the doors of houses and of the ferry. The silence at either end of the recording is cut, so that the creak starts as the door moves. |
| `underwater.mp3` | `underwater`: the sea heard from under the water, the ambience from Reef, looping without a gap. It is mixed in as far as the camera's lens is under the water (see [Swimming and diving](#swimming-and-diving)). |

The remaining identifiers, among them the dawn bed, crickets, wind, the clock bell, cafés, the closing of doors, boats and the train's horn, brakes and rumble, are silent. While there is no dawn bed, the day bed does not dip at dawn.

Each identifier has a level `g` and, for positioned sounds, a reference distance `ref` in metres, both set in `SOUND_DEF`. These levels are provisional and will need to be balanced against the real recordings.

## Development

### Syntax check

The JavaScript can be checked without a browser by extracting the module to a scratch file and passing it to Node:

```sh
python3 - <<'EOF'
import re
s = open('index.html').read()
m = max(re.findall(r'<script type="module">(.*?)</script>', s, re.S), key=len)
open('/tmp/m.mjs', 'w').write(m)
EOF
node --check /tmp/m.mjs
```

### Debug hooks

`window.__village` exposes internal state and functions for testing from the browser console or from automation. The principal members are listed below.

| Member | Purpose |
|---|---|
| `player`, `mode`, `chunks`, `scene` | The player state, the current view mode, the loaded blocks and the scene. |
| `rooms`, `doorMesh`, `keys` | The rooms that are built, the instanced house doors and the keyboard state. |
| `train`, `ferries`, `sailers` | The moving things. |
| `SEA`, `swellAt`, `swellInfo`, `setSwell`, `WIND` | The sea module, the surface height and slopes, the swell trains and the wind. |
| `heightAt(x,z)`, `coastZ`, `railZ`, `railY`, `railState` | Terrain and railway queries. |
| `terrain` | The shape of the land, for tests: `baseH`, `mtnH`, `mtLevel`, `mtSpine`, `mtCrest`, `halfW`, `ridgeZ`, `highGround`, `isVillage`, `chunkKind`, `islandInfo`, `islandRoute`, `islandLight`, `stationInfo` and the constants `ISL`, `WRAP_Z` and `ST_SP`. |
| `findHarbour`, `findBeach`, `findStation`, `findRail`, `harbourAt`, `harbourInfo`, `hbS` | Locating features. |
| `islandRoute`, `ferryLanding`, `ferryPortInfo` | Ferry routes and landing points. |
| `toggleTrain`, `toggleView`, `setHour`, `setYaw`, `setPitch`, `setDist`, `setFpPitch`, `updateChunks` | Driving the scene. |
| `paused` | Whether the world stands still, as **P** toggles; it may be set. The 3D render sets it while a picture is made. |
| `SND`, `SNDV`, `SNDS`, `startAudio`, `audioState`, `shore`, `surfaceAt` | The sound engine and its inputs. |
| `findCove()`, `coveInfo(sd,n)`, `coveLanding(cove)` | The nearest cove, with its beach, landing, cave mouth, a point inside the cave and the top and foot of its path; the cove in slot `n` of a coast; and where a boat lands in a cove. |
| `walkGround(x,z,y)`, `coveMoveOk(...)`, `standableAt(x,z)`, `coveFns` | The walking rules of the coves and the cove's internal functions, for tests. |
| `reachable(x0,z0,y0,goal,lim)` | A breadth-first walkability search that follows the player's own rules for step height, body radius and deep water. It is used to confirm that no landing point is a trap. |
| `tunnelK` | How far the listener is inside a tunnel bore. |
| `sit`, `sitKey`, `sitFind`, `sitStand`, `sitSpotOk`, `COACH_SEATS`, `FERRY_SEATS` | The present sitting, if any; sitting down or standing up as **X** does; the seat that **X** would choose; whether the player may stand at a place; the seats of a coach and of the ferry's saloon. |
| `roofAt`, `roofSlope`, `topAt`, `mantle`, `colRoof` | The surface and slope of a house's roof; the highest surface at a point below a given height; the climb in progress; the roof last stood on. |
| `beachStretch(sd,n,any)` | The loungers of stretch `n` of a shore, or `null`; with `any`, whether the stretch would take them, leaving out the draw. |
| `swimmer`, `UW`, `seabedLife`, `swimDebug` | The swimmer, the water seen from inside, the seabed's life, and the swimmer's state with the lens against the waves. |
| `swimAt(x,z,y,under)`, `jumpKey()`, `swimLeaveHere()`, `diveProps(x,z,r)` | Putting the player in the water at a point, at the surface or under it; J; leaving the water; the wrecks and amphorae placed round a point. |

Setting `window.__freeCam = {p: Vector3, t: Vector3}` places the camera at `p` looking at `t`, overriding the normal camera. Setting it to `null` releases it.

### Testing notes

- Background browser tabs are throttled to about nine frames per second, which slows anything that depends on the frame loop.
- A connected game controller also drives test tabs.
- The walkability check was last run on all 82 ferry ports within about 44 km of the origin on either side. Every mainland landing has a route inland and every island jetty a route onto its island.

## Known issues and open work

- Recordings are to be wired up once the sound list has been filled in, and the levels then balanced.
- Shadows are occasionally lost in a way that depends on the layout; the cause has not been found.
- The debug hooks and `window.__freeCam` remain in the code. They have no effect in normal use.
- The ticket kiosks cannot yet be entered.
- In a narrow tower the stair's first pass along the front wall may run close above the door.
- Through the window of a shut coach door, the view is mostly of the inside of the opposite door across the vestibule.
- Only the first cave of a cove can be walked into. The others are seen from the sea, and a boat cannot yet enter them.
- Where blocks at different levels of detail meet, a cove's cliff face may show a thin crack, because the columns of the face differ between levels.
- The sea in a cove is the same deep blue as the open sea. The shallows over the beach and in the cave's pool are not lighter.
- The far terrain samples a cove every 22 m without its cliff meshes, so beyond the outline blocks a cove appears only as a rough notch in the coast.

## Licence

Coast is published under the MIT licence; see `LICENSE`. The licence covers the program, its documentation and the recordings in `sounds/` and `village sounds/`. The cat in `cat/` is the work of c1t1zen1, from Michi-Neko: The Cat Philosopher's Path, and keeps its own MIT licence (`cat/LICENSE`). Three.js is loaded from a CDN under its own MIT licence, and the fonts Marcellus and Alegreya Sans are loaded from Google Fonts under the SIL Open Font Licence.

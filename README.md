# Coast

Coast is a procedurally generated Mediterranean island, rendered in the browser with Three.js. The island runs without end to the east and west and is between half a kilometre and two kilometres wide. Its villages are laid out from the rules of medieval hill towns, and open country, olive groves, harbours and a coastal railway lie between them. Ferries run from the mainland harbours to smaller offshore islands, sailing boats pass along the coast, and the day passes from dawn to night in twelve minutes.

The program is contained in `index.html`, apart from the cat in `cat/`. There is no build step and there are no local dependencies.

## Contents of the repository

| Path | Description |
|---|---|
| `index.html` | The complete program: markup, styles and one JavaScript module (about 3,560 lines). |
| `cat/` | The cat from Michi-Neko: The Cat Philosopher's Path by c1t1zen1, under the MIT licence (`cat/LICENSE`). See `cat/README.md`. |
| `sounds.json` | Maps sound identifiers to audio files (see [Sound](#sound)). |
| `sounds/` | The audio files that `sounds.json` names. |

## Running the program

The page must be served over HTTP, because the browser refuses to load the module and the audio files from a `file://` address. Any static server will do, for example:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

The scene is then available at <http://127.0.0.1:8765/>. Three.js r160 is loaded from `cdn.jsdelivr.net` and the fonts (Marcellus and Alegreya Sans) from Google Fonts, so an internet connection is required on first load.

When `index.html` has been edited, the browser may serve a cached copy. A query string such as `?v=51` forces a fresh load.

## Controls

The panel opened with **H** lists the controls. They are reproduced here for reference.

| Key | Action |
|---|---|
| W A S D | Walk |
| Shift | Run |
| Space | Jump |
| Mouse | Look. A click captures the mouse and Esc releases it. |
| Q E | Turn |
| V | Switches between street level and the bird's-eye view. The bird's-eye view always opens at a low height (`dist = 45`), whatever the zoom was before. While riding a train or a ferry, V steps off. |
| + − | Zoom the bird's-eye view in and out. − at street level changes to the bird's-eye view. A pinch also zooms. |
| Two-finger drag | Pans across the island in the bird's-eye view. |
| Arrow keys | Turn and tilt the bird's-eye view. |
| B | Turns tilt-shift on or off in the bird's-eye and chase views. |
| T | Speeds up time while held. |
| R | Rides in the train's cab. R or V again steps off beside the track. |
| C | Follows the train from behind. The mouse orbits the camera and + − change its distance. C or V again steps off beside the track. |
| F | Boards the nearest ferry wherever it is. F or V again steps ashore, or at the next landing if the ferry is under way. |
| Walking into a door | Opens it. A door swings away from the side it is pushed from, as far as it is pushed, and closes again about a second after nobody stands in its sweep. |
| N | Changes to night (22:00), or back to day (10:00) if it is night. The clock runs on from there. |
| I | Generates a new island from a random seed. |
| M | Mutes or unmutes the sound. |
| Double click | In the bird's-eye view, the camera flies down over 1.5 s to street level at the point clicked, facing the same way. A click on open water does nothing. |
| Tab | Full screen |
| H | Shows or hides the help panel. |

A game controller is supported through the Gamepad API. The left stick moves and the right stick looks. A jumps, B switches the view, X boards the ferry, Y rides in the cab and LB follows the train. RB sets tilt-shift, the triggers zoom, a press of the left stick switches between running and walking, the D-pad turns and tilts, Back mutes and Start shows the panel. The sticks have a wide dead zone, and after any change of view the left stick is ignored until it has returned to the centre.

On a touch screen, a touch on the left part of the screen places a virtual joystick there for walking, and a drag elsewhere looks round.

## Interface conventions

The user interface follows three rules, which apply to every change.

- Labels, place names and values are shown, but explanatory notes and hints are not placed on screen. Explanations belong in this document or, at most, in a tooltip.
- Text is written in plain descriptive sentences. Slogans, taglines and "X, not Y" constructions are not used, in the interface or in commit messages.
- British spelling is used throughout, in the interface, the comments and the documentation.

The help panel is centred on the screen and spans its width, up to 1,320 px: on the left the place where the player stands, a short account of the island and the credit for the cats; on the right the controls in groups (walking, views, train and ferry, time and island, sound and screen, controller), flowing into as many columns as fit. On a narrow screen it becomes one column. It shows the name and kind of the place where the player stands (for example a quarter, a piazza or open country), a short description and the elevation. Piazzas are named from their feature (Piazza dell'Orologio, Piazza della Fontana and so on), and quarters are named after saints and trades.

## Architecture

### Overview

The program is a single ES module. Its main sections appear in the following order in the file:

1. Random numbers and noise (`hash`, `rng`, `vnoise`, `fbm`). Everything derives from the global `SEED`; **N** replaces it.
2. The palette (`PAL`) and the surface pattern codes (`SP` plaster, `SR` roof tiles, `SS` stone, `SW` wood, `SB` brick, `SV` bougainvillea).
3. The geometry builder `GB`, which merges transformed template shapes (`T.box`, `T.cyl`, `T.sph` and others) into one buffer per block, with per-vertex colour, a simple ambient occlusion term and a surface pattern attribute. At lower levels of detail it drops small pieces and simplifies round shapes.
4. The terrain: the mainland, the offshore islands, harbours, the railway corridor, stations, villages, squares and alleys. All of these are pure functions of position, cached where they are expensive.
5. Building generators: houses, towers, churches, arches, fountains, cafés, festoon lights, bougainvillea, trees, boats, stations, harbours and viaducts.
6. Block generation, lighting, sky, shadows and the shaders.
7. Streaming: the rings of detail, fading and the far terrain.
8. Moving things: sailing boats, the train and the ferries.
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

Each block samples the ground on a grid before it is built: every metre for full detail, every 2 m for simplified blocks and every 4 m for outlines, matching the resolution of each ring's ground mesh.

Beyond the rings, a coarse far terrain (`FN = 200` cells of `FS = 22` m) covers the distance, with the lights of distant villages drawn at night. Its heights, colours and lights are cached per grid point, so moving the grid computes only the new edge.

`VIEW` lies between 2 and 9 and adjusts itself to hold 60 frames per second; the help panel reports the current distances. New blocks fade in over 0.8 s in 16 dithered steps. A block that changes detail dissolves into its replacement, the old and new versions drawing complementary fragments so that they never overlap. Nothing fades during the first load or for blocks that appear right round the player.

### Terrain

- **Mainland.** The centre line of the island wanders and its width varies. A ridge of hills and mountains runs down the middle, with peaks (`PEAK = 480` m spacing) that are often crowned by a hill town with its church on the summit. Beaches, rocky shores and cliffs alternate along the coast. `heightAt(x,z)` returns the ground height, including levelled squares, the rail bed and terraces.
- **Offshore islands.** Islands are placed in slots of `ISL = 1300` m. Each takes one of five forms: hills, ridge, volcano, mesa or cliffs. Cliffs face the open sea, so the landward shore, where a jetty stands, keeps its beach.
- **Rocks at sea.** In slots of `RK_SP = 5200` m along each coast, about half hold a small rock 200–340 m offshore, beyond the sailing boats and at least 170 m from any ferry crossing. Each rock is bare grey stone ringed with boulders and carries a lighthouse.
- **Ancient ruins.** A ruined temple, or in three cases out of ten a round tholos, stands at some sites on a 650 m grid where the ground is open hillside (rocky ground, olive terraces or wild slopes) more than 18 m up and away from the hill towns, and on about two islands in five. The ruin takes the spot in its block where the ground varies least, with its long side along the contour, and its stepped platform is built up from the lowest ground, so on a slope it becomes a terrace wall. A few columns stand to full height, some carrying a length of architrave; the rest are broken or reduced to stumps. The temple keeps the low walls of its cella, and drums and blocks lie round about. Trees and rocks are kept off it.
- **Villages.** Villages are separate clusters, and the land between them is open country of olives, rocky ground, farmland, coast or wild ground. Streets, blocks, alleys, archways over main streets and stepped streets are decided per block from the seed, so that neighbouring blocks agree.
- **Squares.** Squares are levelled into the hillside and are part of the height function. A square is not placed where levelling it would leave a cliff. Each has a feature: a clock tower, a well, a tiered fountain, a market cross or a great elm. A belvedere replaces the houses where the hill falls away, with a balustrade, benches and a stair down where one fits.
- **Stepped streets.** Steps follow steep streets. No step is built where the ground at its middle or at either end is less than 0.2 m above sea level, so that steps never stand over water or across a mole.

### Harbours

Harbours are placed in slots of `HARB = 220` m along each shore. A harbour has a quay wall along the shore inside the basin and two walkable moles, a straight mole and a cross mole, with a parapet on the seaward side and rock armour at the seaward foot. The entrance always opens on to the sea, however the coast curves. A lighthouse stands at the head of the straight mole and a harbour light on the other.

Boats are moored stern-to along the quay and a few swing at anchor in the basin. Moored boats keep the ferry channel clear.

At a ferry port the cross mole has an opening in its parapet where the gangway lands, a ticket kiosk and a timetable board. Where the gangway opening lies within 4 m of the harbour light, the light is moved to the harbour-side edge of the mole tip.

### Lighthouses

Besides the harbour lights, lighthouses stand in three kinds of place, all decided from the seed (`lightsNear(x, z, r)` lists them):

- **Headlands.** In each 4.2 km of mainland coast (`LH_SP`), 45 per cent of stretches have a lighthouse on the point where the shore stands furthest out against the coast 250 m either side. It stands 6–10 m back from the water, seaward of the coastal road and clear of harbours, the railway and stations.
- **Islands.** About a fifth of the islands have one, on the point of the shore that stands furthest out towards the mainland and at least 90 m from the ferry jetty, so that it is seen from the coast.
- **Rocks at sea.** Every rock at sea carries one (see Terrain).

Each is a white tapering tower on a stone plinth, with a gallery, a glazed lantern and a red dome. On land a keeper's cottage stands beside it. The ground within 10.5 m is kept clear of other buildings and trees.

At night each lantern glows steadily and one or two beams turn about it, every 9–17 s. The beams are cones 560 m long drawn with additive blending, brightest along their axis and fading with distance; fog dims them less than other things, so they are seen from up to `LH_RANGE = 4000` m. A mainland lantern is screened on its landward side, so its beams sweep only over the sea.

### Railway

The railway runs the length of the island on a level bed 8 m wide. Its line swings from near one shore to near the other and back over a period of `RAIL_L = 6200` m, so it crosses the ridge and visits both coasts. Its height is a Catmull-Rom curve through knots 10 m apart, so the grade changes smoothly.

The line is classified every 2 m as open, viaduct or tunnel: tunnel where the hill stands well above the line and viaduct where the valley falls well below it. Short tunnels become cuttings, short viaducts become embankments, and short open gaps between two long tunnels or viaducts are joined up. Over a tunnel the ground is kept level with the portal parapets, so the bore is always covered. Tunnels are lined, have portals and contain track, so they can be seen from the cab. Viaducts have arched spans between piers every 14 m.

There is one station in each 900 m of line (`ST_SP`), sited on the first level open stretch in its slot and in a town where there is one. Each station has a platform with ramps no steeper than 1 in 7 at both ends, a canopy on iron posts, benches, lamps and a station building.

### Branch lines

Some harbours have a branch line (`branchInfo`), about one every 12 km of coast. The terminus runs parallel to the coast road, 14.8 m inland of it, 58 m either side of the harbour's middle. The approach leaves the main line at a junction and eases its course and height from the main line's to the terminus's, so that it leaves tangentially; it is long enough that the grade stays under 1 in 33. A branch is laid only where the ground along it lies within 9 m above and 10 m below the bed, so that cuttings and embankments suffice, where the junction is clear of stations, tunnels, viaducts and road bridges, and where it does not cross back over the main line. `railPerp` measures the distance to the nearest track, main line or branch, so that streets, squares and houses keep clear of the branches as they do of the main line; the ground is shaped to each branch's bed as it is to the main line's.

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

### Walking and collision

The player stands on the highest walkable surface at their position, given by the walkable-surface function (terrain, steps, terraces, moles, platforms and decks). A step up may be at most `STEP = 0.8` m. The player cannot walk into water deeper than 1 m. Buildings and objects are oriented boxes; the collision code pushes the player out along the shortest axis, and treats a position exactly at an obstacle's centre as lying on the positive side, so that the player is never left inside an obstacle.

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
- **The ferry.** The saloon has rows of seats and a bar, and the wheelhouse a console, the wheel and a chart table. Their doors and walls are worked in the ferry's deck plan (`ferryInside`).

### Time of day, lighting and shadows

A full day lasts twelve minutes. The sun rises over the south sea at 06:00 and sets over the north sea at 18:00. One light casts shadows: the sun by day and the moon, opposite the sun, by night. The star field turns about the same axis as the sun and the moon.

The shadow map is a square centred on the player and moved in 2 m steps. Where the GPU allows an 8,192-pixel texture, the map covers 240 m across at about 2.9 cm per texel; otherwise it covers 120 m.

### Shading

The building and ground shaders add procedural surface patterns according to the `surf` attribute: plaster, roof tiles, stone, wood, brick and bougainvillea bracts. The sea has layers of ripples, each of which fades out as its wavelength approaches the size of a pixel. Fountains have animated water sheets, jets, arcs and spreading rings.

### Cameras

- **Street level.** First person, at walking height.
- **Bird's-eye.** Orbiting above the player. The fog, far plane and sea grow with the zoom so that nothing is clipped.
- **Cab.** On the track 1.2 m ahead of the locomotive's nose, at the driver's eye height, with the whole train drawn behind; the mouse looks round, so the locomotive can be seen by looking back.
- **Chase.** Behind and above the train, orbited with the mouse and kept clear of the ground. While the train is underground, the camera follows the hillside above it.
- **Ferry.** Walking about the decks, with the eye following the ferry's motion.

**Tilt-shift.** The scene is rendered off-screen and blurred horizontally and vertically, with a radius that grows away from a horizontal band of sharp focus through the player, so that the view resembles a miniature model.

### Cats

The cats are drawn by the code of Michi-Neko: The Cat Philosopher's Path (`cat/`, MIT licence). Each cat's coat is one continuous surface, sculpted from signed-distance shapes and meshed by surface nets when the first cat of each build is made, then skinned to a skeleton with a six-bone tail. Its gait, idle actions (sit, groom, stretch, yawn) and sleep are posed in code every frame. `index.html` maps the module specifier `three` to three.js r160 with an import map so that these modules share Coast's copy of three.js.

Coast draws the cats at `CAT_SCALE = 0.62` of Michi-Neko's size, about 0.75 m from nose to tail tip, and without the ink outline: the outline shells are hidden when each cat is made, and the cat casts the scene's shadows in place of its own shadow disc.

About two blocks of town in five (quarters, squares, church blocks and the shore) have a cat, with a home spot chosen once the block is built, in its square where it has one. Every cat within six blocks of the player lives on independently: its position and what it is doing are kept in `cats.states`, so a cat left behind is where it was when the player returns. Up to `CAT_POOL = 12` of the cats nearest the camera are drawn, and the models are handed between cats as the player moves. There are five coats on Michi-Neko's four builds: a brown tabby, a grey, a ginger, a black and a white.

A cat pauses for 2–9 s, then sets off at 1.1 m/s for somewhere 4–18 m away, drawn back towards home once it has strayed 40 m; four times in ten it heads instead for the top of a wall, step, terrace or mole close by. Its route is planned in steps of 0.35 m over the surfaces at each point (the ground and the tops of walls, steps, terraces and moles): rises of up to 0.45 m are walked, so it climbs and descends steps and slopes; a ledge up to 1.9 m higher is a leap, and an edge up to 3 m lower a jump down, each on an arc that clears the higher edge. A route is refused where any part of the body (nose, tail end or flanks) would meet a building, a tree or a wall too high to climb, or where it would reach water. The body tilts with the slope or the steps under it. A cat carries its tail low, and raises it as the player comes within 5 m at street level (through `tailDrop` in `cat/cat.js`). It glances at a player passing within 3 m without breaking off what it is doing. An awake cat mews every 25–70 s, and half the time when the player first comes within 3 m; the sound comes from the cat, pitched a little higher or lower each time, and its mouth opens with it. A mew is heard only from close by: at full level within 6 m of the listener, fading to nothing at 14 m. At night three cats in five curl up asleep where they are, and the rest go on roaming. Cats are hidden in the bird's-eye view above 150 m.

## Sound

### Engine

The sound engine uses the Web Audio API and starts on the first user gesture. Each positioned sound uses HRTF panning with the inverse distance model. Moving sources are given a Doppler shift (playback rate `343/(343+v)`, limited to 0.7–1.4) and a low-pass filter that falls with distance to imitate absorption by the air. A sound far beyond hearing is stopped.

Sounds are routed to four buses: `world`, `train`, `ferry` and `player`. Each bus passes through its own low-pass filter.

- **Inside a coach,** the world is cut at 900 Hz and the train at 1,100 Hz. **In the cab,** the cut-offs are 1,400 Hz and 1,800 Hz.
- **In a tunnel,** a generated convolution reverb is used, consisting of early reflections and a 2.8 s tail that darkens over time. The world outside is attenuated as the listener moves into the bore.
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
- **Footsteps.** A loop for the surface underfoot plays while the player walks, faster while running. The surface (pavement, sand, soil or grass) is read from the ground mesh. Grass uses the soil loop, and the decks of a ferry and the floor of a coach use the pavement loop. A separate sound plays on landing from a jump.
- **Train.** Run and idle loops at the locomotive, and a rumble from the point on the train nearest the listener. A bridge loop plays on viaducts and a rail joint every 18 m under each bogie. Separate sounds play for starting, stopping, brakes, the doors opening and closing, and the horn on departure and before a tunnel.
- **Ferry.** Run and idle loops at the stern, and the wake at the bow. Separate sounds play for the horn, starting, stopping, the gangway, the gates and the fenders.
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
| `cat-mew-1.mp3` to `cat-mew-4.mp3` | `cat_mew`, one chosen at random each time |

The remaining identifiers, among them the dawn bed, cicadas, crickets, wind, gulls, the clock bell, cafés, boats, the train's horn, brakes and rumble, and the ferry's horn, are silent. While there is no dawn bed, the day bed does not dip at dawn.

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
| `heightAt(x,z)`, `coastZ`, `railZ`, `railY`, `railState` | Terrain and railway queries. |
| `findHarbour`, `findBeach`, `findStation`, `findRail`, `harbourAt`, `harbourInfo`, `hbS` | Locating features. |
| `islandRoute`, `ferryLanding`, `ferryPortInfo` | Ferry routes and landing points. |
| `toggleTrain`, `toggleView`, `setHour`, `setYaw`, `setPitch`, `setDist`, `setFpPitch`, `updateChunks` | Driving the scene. |
| `SND`, `SNDV`, `SNDS`, `startAudio`, `audioState`, `shore`, `surfaceAt` | The sound engine and its inputs. |
| `reachable(x0,z0,y0,goal,lim)` | A breadth-first walkability search that follows the player's own rules for step height, body radius and deep water. It is used to confirm that no landing point is a trap. |
| `tunnelK` | How far the listener is inside a tunnel bore. |

Setting `window.__freeCam = {p: Vector3, t: Vector3}` places the camera at `p` looking at `t`, overriding the normal camera. Setting it to `null` releases it.

### Testing notes

- Background browser tabs are throttled to about nine frames per second, which slows anything that depends on the frame loop.
- A connected game controller also drives test tabs.
- The walkability check was last run on all 82 ferry ports within about 44 km of the origin on either side. Every mainland landing has a route inland and every island jetty a route onto its island.

## Known issues and open work

- Recordings are to be wired up once the sound list has been filled in, and the levels then balanced.
- Moored boats overlap one another in some harbour basins.
- Shadows are occasionally lost in a way that depends on the layout; the cause has not been found.
- The debug hooks and `window.__freeCam` remain in the code. They have no effect in normal use.
- The ticket kiosks cannot yet be entered.
- In a narrow tower the stair's first pass along the front wall may run close above the door.
- Through the window of a shut coach door, the view is mostly of the inside of the opposite door across the vestibule.

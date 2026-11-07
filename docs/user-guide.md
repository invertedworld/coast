# Coast: User Guide

Thank you for playing Coast.

Coast is a procedurally generated Mediterranean island which is explored on foot, by train, by ferry, under sail and in the water. The island extends without end to the east and to the west. Hill towns, olive groves, harbours, coves and a coastal railway are laid out along it, and smaller islands lie offshore. The day passes from dawn to night in twelve minutes of real time. Every island is generated from a seed, so that the same seed always produces the same island and a new seed produces a different one.

This guide describes how the island is explored and how each control behaves. The technical design of the program is described in the `README.md` file of the repository.

## Starting the game

Coast runs in a web browser that supports WebGL 2. The published game may be played at <https://invertedworld.itch.io/coast>. A copy of the repository may also be served from any static web server, as described in `README.md`; it cannot be opened directly from the file system.

The player begins at street level in a village. A click on the scene captures the mouse, so that moving the mouse turns the view; **Esc** releases it. The help panel, which lists every control by feature, is shown and hidden with **H**.

> **Example:** To look about a piazza, click once on the scene, then move the mouse while walking with **W A S D**.

## The views

Two principal views are provided.

**Street level** shows the island from the player's eye, 1.62 m above the ground. It is the view used for walking, sitting, climbing, swimming and riding.

**The bird's-eye view** shows the island from above. **V** changes between the two views. The bird's-eye view always opens at a low height. **+** and **−** set its height, and a pinch on a touch screen does the same; **−** at street level changes to the bird's-eye view. The arrow keys turn and tilt the view, and a two-finger drag pans across the island. The view rises to keep clear of higher ground but does not descend over lower ground.

A double click on land in the bird's-eye view brings the camera down to street level at the point clicked over one and a half seconds, facing the same way. A double click on open water has no effect.

**B** sets tilt-shift on or off in the bird's-eye and chase views. Tilt-shift blurs the top and bottom of the picture so that the island resembles a model.

## Walking

**W A S D** walk, and **Shift** held with them runs. **Q** and **E** turn the view. **Space** jumps; a jump towards a wall, a ledge or the eaves of a roof whose top is within reach climbs onto it, so that roofs may be walked upon. **Z** crouches, lowering the eye to 0.95 m and reducing the speed to 45 per cent, and **Z** again stands up.

Doors open when they are walked into. A door swings away from the side from which it is pushed, as far as it is pushed, and closes about a second after nobody stands in its way. The interiors of houses, churches and towers may be entered. Indoors, the sound of the world outside is muffled.

**X** sits down on the nearest free seat within 1.5 m towards which the player is turned, whether a bench, a chair, a sunbed, a seat in a railway coach or a seat in a ferry's saloon. **X** again, or a step with **W A S D**, stands the player up.

## Travelling by train

A passenger railway runs along the coast, with stations in the villages and tunnels through the headlands. Goods lines branch from it.

**R** rides in the cab of the passenger train. **G** rides in the cab of the goods train working the nearest goods line, and sets one to work there if none is near. **C** follows the train being ridden, or otherwise the nearer train, from behind; the mouse moves the camera round the train and **+** and **−** set its distance. In each case the same key, or **V**, steps off beside the track.

## Travelling by ferry

Ferries run from the harbours of the main island to the offshore islands. **F** boards the nearest ferry wherever it lies. **F** or **V** again steps ashore at once if the ferry is at a landing, or at the next landing if it is under way. The ferry sounds its horn three seconds before it leaves a landing, and the horn echoes from the hills.

## Sailing

Every harbour keeps a sailing dinghy at a berth. **Y** within 6 m of a dinghy boards it. Elsewhere, **Y** takes the player to the quay beside the dinghy of the nearest harbour.

At the helm, **A** turns the bow to port and **D** turns it to starboard; the tiller moves the opposite way, as on a real boat. **W** and **S** paddle forward and astern at up to 0.6 m/s while the boat is nearly stopped, and **S** also lets the sail fly. The sail is trimmed with the triggers of a game controller. The boat is driven by the wind, which varies in strength and direction across the day; the sail luffs and flaps when the boat points too close to the wind, and comes over in a tack or a gybe.

**C** changes between the helm and a view from astern, which the mouse moves round the boat and **+** and **−** bring nearer or further, between 5 m and 80 m.

**Y** steps ashore when the boat lies within 3 m of a quay, a mole or a beach. Within a harbour the dinghy is moored again at that harbour's berth. Out at sea, **Y** returns the dinghy to its own berth and places the player on the quay beside it.

## Swimming and diving

The player wades into the sea from any shore that shelves, and swims once the water reaches the chest. **J** jumps into the sea from the edge of a quay, a mole or a moored boat, over the side of the dinghy, or from the rail of a ferry.

In the water, **W A S D** swim in the direction of the view. At the surface the head rides the waves. Looking down while swimming forward dives; **C** held also dives, and **Space** held rises. **Shift** swims faster at the cost of more breath. Under the water the light dims and colours with depth, and wrecks, amphorae and the life of the sea bed may be found.

The swimmer leaves the water by swimming to a beach and wading ashore, by climbing a quay's ladder, or by climbing onto any ledge less than about 1 m above the water.

## Time

The clock runs continuously. **T** held speeds time forty times; **Shift** and **T** held run it backwards at the same rate. **N** changes to 22:00, or to 10:00 if it is already night, and the clock runs on from there. **P** pauses the world: trains, ferries, boats, dolphins, the sea, the lighthouse beams, cats, gulls and the time of day stand still, while the player may still move and look about. **P** again resumes.

## The island

**I** generates a new island from a random seed. The new island replaces the present one entirely.

## Display and sound

**Tab** sets full screen. **Page Up** and **Page Down** increase and reduce the draw distance through eleven fixed levels. **Home** returns the draw distance to automatic, in which the distance is adjusted to keep the frame rate near 60 frames per second. **O** shows or hides an overlay with the frame rate, the frame time, the draw distance, the number of blocks drawn, the draw calls, the triangles and the player's position.

**M** mutes or restores the sound. The sound is positional: fountains, church bells, the sea, trains, ferries, gulls and cats are heard from where they are, and the ambience changes between day and night.

## Game controllers and touch screens

A game controller is supported. The left stick moves and the right stick looks. **A** jumps, **B** changes the view, **X** boards the ferry, **Y** rides in the cab and **LB** follows the train. **RB** sets tilt-shift, the triggers zoom, a press of the left stick changes between running and walking, the D-pad turns and tilts, **Back** mutes and **Start** shows the help panel. Within 6 m of a dinghy, or while sailing, **Y** acts as the **Y** key. At the helm the left stick steers and paddles and the triggers trim the sail. In the water the left stick swims, **A** and the right trigger rise and the left trigger dives. At street level, in a coach and aboard a ferry, the D-pad's down sits and stands.

On a touch screen, a touch on the left part of the screen places a joystick there for walking, and a drag elsewhere turns the view.

## Principle of operation

The island is not stored; it is calculated. The world is divided into square blocks, and each block is generated from the island's seed when the player comes near it and discarded when the player moves away. The height of the ground at any point is a function of position alone, built from the line of the coast, the ridge of the hills and several layers of noise, so that neighbouring blocks always agree at their edges. Villages are laid out from the rules of medieval hill towns. Their streets, alleys, archways and stepped streets are decided block by block from the seed, and their squares are levelled into the hillside as part of the height of the ground.

Blocks near the player are drawn in full detail, and blocks further away are drawn in simplified form; beyond them, a coarse model of the whole island is drawn for views from high above. The world repeats every 8.8 km from north to south, so that travel far enough out to sea in one direction arrives at the opposite shore. The camera's position is kept near the origin of the coordinate system, and the world is moved beneath it, so that precision is not lost far from the starting point.

The sea is a sum of wave trains whose lengths follow the dispersion of waves in deep water, raised by the wind and by the swell of the day and calmed in the lee of the land. The sun, sky, fog and lighting follow the clock, and the shadows follow the sun.

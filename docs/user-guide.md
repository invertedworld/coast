# Coast: User Guide

Thank you for playing Coast.

Coast is a procedurally generated Mediterranean island which is explored on foot, by train, by ferry, under sail and in the water. The island extends without end to the east and to the west. Hill towns, olive groves, harbours, coves and a coastal railway are laid out along it, and smaller islands lie offshore. The larger offshore islands have coves of the same kind as those of the main island, each with its beach, its path down from the clifftop and a cave that may be walked or swum into. A whole day passes in thirty minutes of real time, beginning just before sunrise. Every island is generated from a seed, so that the same seed always produces the same island and a new seed produces a different one.

This guide describes how the island is explored and how each control behaves. The technical design of the program is described in the `README.md` file of the repository.

## Starting the game

Coast runs in a web browser that supports WebGL 2. The published game may be played at <https://invertedworld.itch.io/coast>. A copy of the repository may also be served from any static web server, as described in `README.md`; it cannot be opened directly from the file system.

The player begins at street level on a square above the sea, facing a point on the shore. A way down to that point by streets, stairs and paths leads to a beach or a quay, without a long detour. A click on the scene captures the mouse, so that moving the mouse turns the view; **Esc** releases it. The help panel, which lists every control by feature, is shown and hidden with **H**; **Esc** also hides it. **Field of view**, at its foot, sets the view's vertical angle at street level, in the water, at the helm and in a coach, from 50° to 100°; the default is 70°, and the setting is remembered.

> **Example:** To look about a piazza, click once on the scene, then move the mouse while walking with **W A S D**.

## The views

Two principal views are provided.

**Street level** shows the island from the player's eye, 1.62 m above the ground. It is the view used for walking, sitting, climbing, swimming and riding.

**The bird's-eye view** shows the island from above. **2** changes between the two views. The bird's-eye view always opens at a low height, looking out ahead. A drag with the mouse moves over the landscape: upwards on the screen travels forward and to the right travels right, whichever way the view faces. A drag with the right button, or with **Shift** held, turns and tilts the view; past its shallowest tilt it raises the view towards the sky. A double click on land goes down to street level there, outside any building. **+** and **−** set its height, and a pinch on a touch screen does the same; **−** at street level changes to the bird's-eye view. The arrow keys turn and tilt the view, and a two-finger drag pans across the island. The view rises to keep clear of higher ground but does not descend over lower ground.

A double click on land in the bird's-eye view brings the camera down to street level at the point clicked over one and a half seconds, facing the same way. A double click on open water has no effect.

**B** sets tilt-shift on or off in the bird's-eye and chase views. Tilt-shift blurs the top and bottom of the picture so that the island resembles a model.

**Shift+B** sets ambient occlusion on or off. Ambient occlusion darkens creases, the foot of walls, doorways, the undersides of eaves and the ground beneath benches and people slightly. It is on when the game starts; the new setting is shown briefly at the top of the screen.

## Walking

**W A S D** walk, the up and down arrow keys also walk forward and back, and **Shift** held with them runs. **Q** and **E** turn the view. **Space** jumps; a jump towards a wall, a ledge or the eaves of a roof whose top is within reach climbs onto it, so that roofs may be walked upon. **Z** crouches, lowering the eye to 0.95 m and reducing the speed to 45 per cent, and **Z** again stands up.

Doors open when they are walked into. A door swings away from the side from which it is pushed, as far as it is pushed, and closes about a second after nobody stands in its way. The interiors of houses, churches and towers may be entered. Indoors, the sound of the world outside is muffled, and a jump stops short of the ceiling.

**X** sits down on the nearest free seat within 1.5 m towards which the player is turned, whether a bench, a chair, a sunbed, a seat in a railway coach or a seat in a ferry's saloon. **X** again, or a step with **W A S D**, stands the player up.

## Camping

**R** pitches a camp: a small ridge tent and a camp fire, with a log to sit on beside the fire. The fire is laid 2.6 m ahead of the player and the tent stands beyond it, its door facing the fire. **R** again strikes the camp, wherever the player then is. Only one camp may stand at a time, and generating a new island strikes it.

A camp may be pitched only on foot, out of doors, in the wild country of the main island (the rocky scrub, the uncultivated hillsides and the mountains) or on one of the offshore islands. It may not be pitched in or near a village, on olive terraces or farmland, beside a road or the railway, near a station, a harbour, a lighthouse or any building, at the water's edge, on a hillside steeper than a gentle slope, or where trees, shrubs, rocks or walls stand in the way. Gently sloping or slightly uneven ground is accepted, and the tent, the fire and the logs follow it. Where a camp may not be pitched, a notice at the top of the screen gives the reason.

**X**, facing the door of the tent from within about 2 m, lies down in the tent, looking out of the door at the fire. **X** facing the log sits on it, and **X** standing close to the fire and facing it sits on the ground there, looking at the flames. **X** again, or a step with **W A S D**, stands the player up. The tent and the fire cannot be walked through.

Small tongues of flame lick up from the logs over a bed of red coals, sparks rise and, by day, a thin smoke; after dusk the fire lights the ground round it and the front of the tent with a warm, flickering light. Its crackle is heard close to it, and fades away as the camp is struck.

> **Example:** To spend a night under canvas, take the ferry to an offshore island, walk up from the landing to open, level ground, press **R**, then press **N** for night and **X** at the door of the tent.

## Travelling by train

A passenger railway runs the length of the island, weaving between its two coasts, with stations in the villages and cuttings and tunnels through the hills. Goods lines are railways of their own, quite separate from the main line: each joins two harbours 2 km to 6 km apart on the same shore, runs along the shore between them, and ends in a siding along each quay. A goods train of twelve wagons, with a shunter at each end, works each line, waiting at each quay while it is unloaded and loaded and reversing there.

**3** rides in the cab of the passenger train, and **4** in the cab of the goods train working the nearest goods line, which sets one to work there if none is near. **0** then steps through the views of the train: the cab; in the passenger train, a window seat in the first coach, looking out; a view from behind the train, which the mouse moves round it and **+** and **−** bring nearer or further; and a view from beside the line, which turns to watch the train pass and moves on to a new place ahead, riding in the cab while the train is in a tunnel. **0** after the last view returns to the cab. **3** or **4** again, or **2**, steps off beside the track. Away from a train, **0** follows the nearer train from behind.

## Travelling by ferry

Ferries run from the harbours of the main island to the offshore islands. **5** boards the nearest ferry wherever it lies. Aboard, **0** steps through the deck, a view from astern and a window seat in the saloon, looking out. **5** again, or **2**, steps ashore at once if the ferry is at a landing, or at the next landing if it is under way. The ferry sounds its horn three seconds before it leaves a landing, and the horn echoes from the hills.

## Sailing

Every harbour keeps a sailing dinghy at a berth. Within 100 m of a dinghy, **6** takes her helm where she lies. While sailing, **2** leaves the dinghy afloat where she is and rises to the bird's-eye view. With the assisted handling, **W** always paddles her forward, at up to 1.6 m/s, even straight into the wind. In the bird's-eye view, a double click on open water brings a dinghy there and puts the player at its helm. **6** within 6 m of a dinghy boards it. Elsewhere, **6** takes the player to the quay beside the dinghy of the nearest harbour, where a notice reads *Press 6 to sail* (on a touch screen, *Tap dinghy to sail*). On a touch screen a short tap on a dinghy within 100 m takes her helm, as **6** does.

At the helm, **A** turns the bow to port and **D** turns it to starboard; the tiller moves the opposite way, as on a real boat. **W** and **S** paddle forward and astern at up to 0.6 m/s while the boat is nearly stopped, and **S** also lets the sail fly. The sail is trimmed with the triggers of a game controller. The boat is driven by the wind, which varies in strength and direction across the day; the sail luffs and flaps when the boat points too close to the wind, and comes over in a tack or a gybe.

**0** changes between the helm and a view from astern, which the mouse moves round the boat and **+** and **−** bring nearer or further, between 5 m and 80 m.

**6** steps ashore when the boat lies within 3 m of a quay, a mole or a beach. Within a harbour the dinghy is moored again at that harbour's berth. Within 60 m of land, **6** leaves the dinghy afloat and sets the player down on the nearest open ground, facing her; further out at sea, it leaves her afloat and rises to the bird's-eye view.

## Swimming and diving

The player wades into the sea from any shore that shelves, and swims once the water reaches the chest. **J** jumps into the sea from the edge of a quay, a mole or a moored boat, over the side of the dinghy, or from the rail of a ferry.

**7** follows the nearest whale and **8** the nearest dolphin. In each case the camera follows the animal under the water while it swims beneath the surface and above it as it surfaces or leaps; the mouse moves the camera round the animal, **+** and **−** set its distance, and the same key, or **2**, returns the player to where they were before. While an animal is followed under the water, the water is clearer than it is for a swimmer, the sounds of the air give way to those of the water, and no fish are shown. **1** returns the player to the place where they first stood on the island.

**9** takes the player under the water, beside the nearest wreck on the seabed offshore, or where no wreck lies within reach, to the nearest open water between 4.5 m and 9 m deep, facing the shore. **9** again returns the player to where they were before.

In the water, **W A S D** swim in the direction of the view. At the surface the head rides the waves. Looking down while swimming forward dives; **C** held also dives, and **Space** held rises. **Shift** swims faster at the cost of more breath. Under the water the light dims and colours with depth, and wrecks, amphorae and the life of the sea bed may be found. Under the water, **F** turns a torch on or off; it lights what lies ahead of the diver.

The swimmer leaves the water by swimming to a beach and wading ashore, by climbing a quay's ladder, or by climbing onto any ledge less than about 1 m above the water.

Close to the shore the sea bed falls steeply to about 20 m. Beyond it lies the shelf, about 90 m deep at 1 km from the shore and 140 m at 1.5 km, and beyond the shelf the sea bed falls steeply to 800 m.

## Whales

Two humpback whales, each 12.5 m to 15 m long, live far out at sea, at least 350 m from any shore and clear of the offshore islands and rocks, and within about 700 m of the player. A whale swims at depth for some minutes, then rises to the surface and blows several times, its back rolling over as it breathes, and dives again with its flukes raised. Now and then, about six times an hour, a whale breaches: it rises steeply from depth, leaves the water for about half its length, turns over and falls on its back, lies a moment at the surface and slowly sinks. The fall is heard, and it sends a ring of waves across the sea, oval at first in the shape of the whale and rounding out as it spreads; boats ride the waves as they pass. Under the water the whales are heard singing.

When **7** follows a whale that is about to breach, the camera comes up above the surface about a second before the whale breaks it and stands off to its side, so that the whole leap is seen.

## Time

The clock runs continuously. **T** held speeds time forty times; **Shift** and **T** held run it backwards at the same rate. **N** changes to 22:00, or to 10:00 if it is already night, and the clock runs on from there. **P** pauses the world: trains, ferries, boats, whales, dolphins, the sea, the lighthouse beams, cats, gulls and the time of day stand still, while the player may still move and look about. **P** again resumes.

## People

**K** raises the population level and **Shift+K** lowers it, from 0, at which there is no one, to 9, at which the streets are crowded; the new level is shown briefly at the top of the screen. The level is 0 when the game starts. At a level above 0, people go about the streets of the villages near the player, and gather in the squares, on the station platforms and at the ferry landings. More are about in the evening, fewer in the early afternoon and few at night. They walk alone, in couples, with friends or with children, stop to talk, sit on the benches and the café chairs, and look about them; children run ahead, hold a parent's hand or play together. They step aside for one another and for the player.

A change of level takes effect at once: people appear or leave wherever they are. Otherwise people arrive and leave out of the player's sight, so that no one appears or vanishes in view. Passengers sit in the coaches of the train and the saloon of the ferry. When the train stands at a station, some passengers walk out through the doors on the platform side and people waiting on the platform walk aboard; when a ferry lies at a landing, passengers come down the gangway and those waiting on the quay go up it. A seat on which a person is sitting cannot be taken with **X**.

> **Example:** To watch passengers boarding, raise the population level with **K**, wait on a station platform and stand clear of the doors when the train comes to rest.

## The island

**I** opens the island panel, which shows the seed of the present island. The seed may be any text of up to 32 characters, letters being kept in capitals; a seed of digits alone stands for the number it spells. **Random** replaces the seed with one drawn at random, and **Copy** copies it to the clipboard. **Generate**, or **Enter**, generates the island from the seed shown; it is unavailable while the seed is that of the present island. **Esc**, **Cancel** or **I** again closes the panel and leaves the island unchanged. While the panel is open, any other key is taken as part of the seed.

The new island replaces the present one entirely, and the player begins it on foot. The same seed always produces the same island. The seed is added to the address of the page, so that the island is kept when the page is reloaded and may be shared as a link. An island may also be opened directly by adding `?seed=` and the seed to the address. A whole scene may be shared with **L** (see Sharing a scene). Without a seed in the address, each launch opens on a new island whose seed is eight letters and digits drawn at random. The seed of the present island is also shown in the statistics panel (**O**).

> **Example:** To return to an island seen earlier, open the panel with **I**, type the seed noted from the statistics panel, and press **Enter**.

## Sharing a scene

**L** shows a QR code of a link to the scene as it is at that moment, with the link written beneath it. The link records the island's seed, the time of day, the player's position, the view, and the activity: walking or sitting, the bird's-eye view, swimming or diving, riding in a train's cab or coach or watching it from behind or from the trackside, standing or sitting aboard a ferry, sailing a dinghy, or following a whale or a dolphin. A train, ferry or dinghy that is being ridden is recorded where it is, with its speed. A raised camera is recorded with its lens settings. If the world is paused, the scene opens paused.

**Copy QR code** copies the code to the clipboard as an image, and **Copy URL** copies the link. **L** again, **Esc** or **Close** hides the panel.

A camp, if one is pitched, is recorded with the link, and so is the player lying in its tent or sitting by its fire. Opening the link, on a telephone or in another browser, generates the same island and places the viewer in the same scene, aboard the same vehicle at the same place. The gulls, the whales, the dolphins, the other boats and the gusts of the wind are not recorded, since each is simulated afresh; a whale or a dolphin that was being followed is replaced by the one nearest to where it was, so that view is approximate.

> **Example:** To show a friend the view from the ferry's saloon, board the ferry with **5**, press **0** twice to sit at a window seat, press **P** to hold the moment, press **L**, and scan the code with the friend's telephone.

## The telescope

**V** raises a telescope to the eye, and **V** again lowers it. It may be raised on foot, aboard the ferry, in a coach, in the cab of a train and at the helm of the dinghy. The view is then seen through a round eyepiece, with the magnification shown beneath it. **+** and **−**, and the mouse wheel, set the magnification, from 8 to 60 times. The telescope is always raised looking straight ahead, level, at its least magnification of 8 times. The mouse turns the view more slowly at a higher magnification, so that the scene moves across the eyepiece at the usual rate. Any key that changes the view, and **C** and **Esc**, lower the telescope first; **C** then raises the camera in its place, and **V** with the camera raised changes back to the telescope.

Whatever lies at the point at which the telescope is aimed is drawn as it would be for a player standing there, out to about 2.2 km. The buildings, trees and plants round that point are generated in full detail, the people in its streets, squares, platforms and landings go about their business, and the shadows are cast there. The passengers of a ferry or a train within that distance are aboard, and may be seen through the windows. The detail takes a moment to arrive after the telescope is turned to a new place. The fog draws back while the telescope is raised, so that the far shore is clear.

> **Example:** To watch a ferry come in, raise the population level with **K**, stand on the mole beside a ferry landing, find the ferry out at sea, raise the telescope with **V** and set the magnification to about 40 times with **+**. Its passengers may be seen at the windows of the saloon.

The camera, when raised with a long focal length, also draws the point at which it is aimed in full detail.

## The camera and the gallery

**Enter**, with the camera lowered, takes a quick picture of the view as it is, which is kept in the gallery; the shutter is heard and seen. **Shift+Enter** takes the picture in the same way, with the camera raised or lowered, and copies it to the clipboard instead of keeping it in the gallery. **C** raises a camera to the eye, and the island is then seen through its lens. The camera remains raised until it is lowered with the button at the top right of the screen, with **C** or with **Esc**. In the water **C** dives instead, and the camera is not raised. While it is raised the mouse is not captured: a drag across the scene turns the view, and the player walks, swims and turns with the usual keys. A click on the scene does not take a picture.

The controls of the lens lie in a panel at the foot of the screen. Each shows its value and a scale, and is adjusted with the **−** and **+** buttons on either side, which repeat while held, or by dragging along its scale.

**Zoom** sets the focal length, from 16 mm to 300 mm in the equivalent of a 35 mm frame; the camera is always raised at its widest, 16 mm. **+** and **−** on the keyboard, and the mouse wheel, do the same.

**Focus** sets the distance at which the picture is sharp. With **AF** lit the camera focuses on whatever lies within the square at the centre of the frame, and the square turns green once it is in focus. The **−** and **+** buttons, or **9** and **0**, move the focus nearer or further and change to manual focus, shown as **MF**; a click on **MF**, or **U**, returns to autofocus.

**Aperture** sets the f-number, from f/1.4 to f/22; the default is f/2.8. A wider aperture gives a shallower depth of field. **[** and **]** do the same.

**Exposure** brightens or darkens the picture in thirds of a stop, between −3 and +3 EV. **;** and **'** do the same.

**Aspect ratio** sets the shape of the frame: **Full**, the default, uses the whole space between the controls, and the fixed shapes are 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 2:3 and 9:16. **T** steps to the next shape and **Shift**+**T** to the previous one.

**Vignette** darkens the corners of the frame, from off to 100 per cent in steps of 10 per cent; the default is off. **,** and **.** do the same.

The four crop marks show the frame of the picture. The part of the screen outside them is darkened and is not included in the picture.

The large round button on the right is the shutter, which sounds as it is pressed; **Enter** also takes a picture. Beneath it the latest picture is shown with the number of pictures taken, and a click on it opens the gallery.

> **Example:** To photograph a bell tower against the sea, raise the camera with **C**, walk until the tower stands against the water, set the zoom to about 85 mm, close the aperture to f/8 so that both are sharp, and press the shutter.

The gallery is opened with **G**, from anywhere and without raising the camera, or from the camera. Each row holds one photograph, with its number and the time it was taken, followed by the artworks made from it, each labelled with its style. A click on an item selects it and shows it enlarged with its details. The enlarged picture, and the picture in artist mode, may be zoomed up to eight times with a pinch or the mouse wheel and moved with a drag while zoomed; a double click shows the whole picture again. The copy button, which appears over a thumbnail when the pointer rests on it, copies that picture to the clipboard at its full size. Every picture records the place and the time at which it was taken, as a shared link does (see **L**); the compass beneath the copy button, shown for such a picture and for the artworks made from it, returns to that place and time, the island, the view and the hour being as they were, and **Go there** beside **Artist mode** does the same for the selected item. Pictures taken before this was recorded have no compass. **Download PNG** saves the selected item as a PNG file, and the bin deletes it; deleting a photograph also deletes its artworks. Neither is available while nothing is selected. A click with **Cmd** (or **Ctrl**) held adds an item to the selection or removes it, and a click with **Shift** held selects every item between it and the last one chosen; several items selected are shown in a loose pile, the last chosen on top. **Download** then saves each of them, and the bin deletes them all once the question that follows is answered **Delete**; the question names what is to be deleted, counting the artworks that go with a photograph. Up to 24 photographs are kept, with their artworks, in the browser's own storage, so that they remain when the browser is closed and opened again. The divider between the pictures and the preview may be dragged to resize them; its place is remembered, and a double click on it restores the default.

### Artist mode

**Artist mode** is available while a photograph is selected, and makes artworks from it. A style is chosen first: **Watercolour**, **Oil**, **Van Gogh**, **Woodcut** or **3D render**; **3D render** is not offered on a phone or a tablet, whose browser cannot hold it in memory. The settings of that style are then shown. Every setting is remembered by the browser and restored on the next visit.

For the first four styles, **Time to paint** sets how long the picture takes to appear, from at once to 30 seconds, and the remaining sliders set the character of the style, such as the size of the brush or the spacing of the cut lines. For the 3D render, which calculates the light of the scene again from the camera with which the photograph was taken, **Time limit** sets how long the render may take, 30 seconds by default, and **Maximum samples per pixel** the most samples that are taken within it; the render finishes when either is reached, so that a slower computer gives a picture with fewer samples in the same time. **Resolution** sets the size of the picture, **Bounces of light** how often light is reflected, **Path-traced distance** how far from the camera the light is calculated in full (beyond it, the light is estimated from the sun, the sky and their shadows, and matched to the calculated light nearer the camera), **Draw distance** how far the world is loaded, **Visibility in the haze** the clarity of the air, **Noise filter** the smoothing of the remaining noise, **Glass and metal** and **Haze** whether those effects are included, and **Reflectivity of glass and metal** how strongly glass, metal and the trains' paint reflect their surroundings, from none to very high. The scene is lit as it was at the hour at which the photograph was taken, whatever the hour in the game when the render is made. A 3D render can be made only on the island on which the photograph was taken. **Reset to default** returns the settings of the chosen style to their original values; it is unavailable while they already have them.

The oil style has a further setting, **Colour mixing**, which sets how the colours of the painting are made. **On the palette**, the default, paints each part of the picture in its own colour, as though it had been mixed on the palette beforehand. **Optical** paints in the manner of the divisionists, such as Signac and Cross: no colour is mixed, and each part of the picture is laid with small, separate strokes of a few pure colours from a limited palette, side by side. Seen close to, the separate colours are clearly visible; seen from a distance, they combine in the eye into the colours of the photograph. Shadows contain strokes of the complementary colour or of blue and violet, and warm colours are set beside cold ones. With optical mixing, **Brush size** sets the size of the individual strokes, and **Stroke length** and **Impasto** have the same effect as with mixing on the palette.

> **Example:** To paint a harbour in the manner of Signac, select **Oil**, set **Colour mixing** to **Optical** and **Brush size** to about 10 px, and press **Create**. The finished painting is best judged from a few paces back from the screen.

The Van Gogh style is painted in long, curving strokes of thick paint that follow the forms of the picture and wind into eddies in the sky. The colours are drawn towards chrome yellow, orange, viridian and ultramarine, with the shadows in Prussian blue, and strong edges are outlined in dark blue. **Stroke size** scales the strokes, from × 0.5 to × 2. **Eddies in the sky** sets how strongly the sky is wound into eddies; at 0 the strokes in the sky follow the picture. **Stars** sets the number and size of the stars painted in a night sky, each as a disc of yellow and white within rings of light; at 0 none is painted. **Colour intensity** sets how far the colours are raised and drawn towards the palette. **Outlines** sets the number and weight of the dark outlines. **Impasto** sets the relief of the paint. **Distortion** bends the forms of the picture into waves before it is painted; it is 0 by default.

The woodcut is printed as from a carved block of wood, in black ink on off-white paper. Tone is given by parallel cut lines that follow the forms of the picture: they run level in the sky and wave across the sea, and they close into solid black in the shadows. **Line spacing** sets the distance between the cut lines, from 5 to 16 pixels in a picture 800 pixels high, 9 by default. **Boldness** sets how much of the block is left uncut, and therefore how heavy the black lines and areas are. **Contrast** sets how strongly the light and dark tones are separated. **Outlines** sets the strength of the lines cut round the shapes; at zero they are omitted. **Wood grain** sets how clearly the grain of the block and the unevenness of the inking show in the black. **Colour blocks** sets the number of flat colours printed beneath the black, each from a block of its own, from **None** to four, in the manner of a Japanese colour woodcut; with colour blocks, the black block carries only the outlines and the darker tones. While a single block is shown being made, it is seen being carved, the lightest places first; with colour blocks, the colours are seen being printed one after another, followed by the black.

**Create** makes the artwork, which is shown being made in the large preview, with its progress beneath the settings. The style and the settings may be changed and the artwork rendered again as often as required; a new render, a change of style or leaving artist mode stops a render in progress, and the square button beside the progress bar stops it directly. **Save** keeps the finished artwork in the gallery beside its photograph. It is available only while a finished artwork has not yet been saved.

The arrow at the top left returns to the gallery, as does **Esc**. If the finished artwork has not been saved, a choice is offered first: **Save** keeps it, **Delete** discards it and **Cancel** remains in artist mode.

> **Note:** Photographs and artworks are kept in the browser's own storage. Clearing the browser's data for the site removes them; any that are to be kept for certain should be downloaded.

## Display and sound

**Tab** sets full screen. **Page Up** and **Page Down** increase and reduce the draw distance through eleven fixed levels. **Home** returns the draw distance to automatic, in which the distance is adjusted to keep the frame rate near 60 frames per second. **O** shows or hides an overlay with the frame rate, the frame time, the draw distance, the number of blocks drawn, the draw calls, the triangles, the player's position and the seed of the island.

**K** and **Shift+K** raise and lower the population level (see People). **M** mutes or restores the sound. The sound is positional: fountains, church bells, the sea, trains, ferries, gulls, cats and breaching whales are heard from where they are, and the ambience changes between day and night. With the camera under the water, the sounds of the air are muffled and all but silenced, and the water and the songs of the whales are heard instead.

## Game controllers and touch screens

A game controller is supported. The left stick walks, swims and steers, and the right stick looks. **A** jumps, and rises in the water; **B** crouches, and dives while held in the water. **X** steps through the views, as **0** does, and **Y** changes to the bird's-eye view, as **2** does; the bumpers bring the view nearer or further. The right trigger takes a quick picture. With the camera raised, the right trigger takes a picture through the lens, **B** lowers the camera, **Y** opens the gallery, the bumpers zoom, the D-pad's up and down set the focus further and nearer, and its left and right set the exposure. At the helm the triggers trim the sail. A press of the left stick changes between running and walking, and **Menu** shows the help panel. On the controller's tab of the help panel, **Invert vertical look** reverses the right stick's up and down, and **Sensitivity** sets how fast it turns the view, from 25 % to 300 %; both are remembered.

On a touch screen, a touch on the left part of the screen places a joystick there for walking, and a drag elsewhere turns the view. The button at the top right opens the menu, which takes the player to each of the places reached by the number keys and into the sea, and pitches or strikes a camp; raises the camera or the telescope, takes a snapshot and opens the gallery, from which artist mode is reached; sets the time of day, pauses the world and changes between day and night; sets tilt-shift, ambient occlusion, full screen, the draw distance, the field of view and the performance overlay; sets the sound and the population level; and opens the island panel, the sharing panel, the help panel and the about panel. Round buttons at the bottom right do what the moment calls for: on foot they jump, crouch, sit and jump into the sea; in the water they rise, dive and set the torch on or off; while following an animal or in a distant view they bring the view nearer or further; and one always raises the camera. With the camera raised on a screen held sideways, its controls lie in a compact panel, which the button beneath the shutter puts away and brings back.

On a touch screen the picture is drawn with a lighter load: its resolution follows the frame rate, between 0.75 and 1.5 pixels to each point of the screen, the shadows are less finely drawn, and the draw distance is shorter.

## Principle of operation

The island is not stored; it is calculated. The world is divided into square blocks, and each block is generated from the island's seed when the player comes near it and discarded when the player moves away. The height of the ground at any point is a function of position alone, built from the line of the coast, the ridge of the hills and several layers of noise, so that neighbouring blocks always agree at their edges. Villages are laid out from the rules of medieval hill towns. Each village has one parish church, and a large town has one church to each of its districts, the churches standing at least 300 m apart; a church stands on the summit where the town climbs a hill, and the smallest hamlets have none. Their streets, alleys, archways and stepped streets are decided block by block from the seed, and their squares are levelled into the hillside as part of the height of the ground.

Blocks near the player are drawn in full detail, and blocks further away are drawn in simplified form; beyond them, a coarse model of the whole island is drawn for views from high above. The world repeats every 15.8 km from north to south, so that travel far enough out to sea in one direction arrives at the opposite shore. The camera's position is kept near the origin of the coordinate system, and the world is moved beneath it, so that precision is not lost far from the starting point.

The sea is a sum of wave trains whose lengths follow the dispersion of waves in deep water, raised by the wind and by the swell of the day and calmed in the lee of the land. The ring of waves from a breaching whale is a packet that spreads outwards at the group speed of its waves, half their own speed, so that each crest rises at its back, runs through it and dies at its front; its height falls as it spreads round a longer ring. The sun, sky, fog and lighting follow the clock, and the shadows follow the sun.

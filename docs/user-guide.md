# Coast: User Guide

Thank you for playing Coast.

Coast is a procedurally generated Mediterranean island which is explored on foot, by train, by ferry, under sail and in the water. The island extends without end to the east and to the west. Hill towns, olive groves, harbours, coves and a coastal railway are laid out along it, and smaller islands lie offshore. The larger offshore islands have coves of the same kind as those of the main island, each with its beach, its path down from the clifftop and a cave that may be walked or swum into. The day passes from dawn to night in twelve minutes of real time. Every island is generated from a seed, so that the same seed always produces the same island and a new seed produces a different one.

This guide describes how the island is explored and how each control behaves. The technical design of the program is described in the `README.md` file of the repository.

## Starting the game

Coast runs in a web browser that supports WebGL 2. The published game may be played at <https://invertedworld.itch.io/coast>. A copy of the repository may also be served from any static web server, as described in `README.md`; it cannot be opened directly from the file system.

The player begins at street level on a square above the sea, facing a point on the shore. A way down to that point by streets, stairs and paths leads to a beach or a quay, without a long detour. A click on the scene captures the mouse, so that moving the mouse turns the view; **Esc** releases it. The help panel, which lists every control by feature, is shown and hidden with **H**; **Esc** also hides it. **Field of view**, at its foot, sets the view's vertical angle at street level, in the water, at the helm and in a coach, from 50° to 100°; the default is 70°, and the setting is remembered.

> **Example:** To look about a piazza, click once on the scene, then move the mouse while walking with **W A S D**.

## The views

Two principal views are provided.

**Street level** shows the island from the player's eye, 1.62 m above the ground. It is the view used for walking, sitting, climbing, swimming and riding.

**The bird's-eye view** shows the island from above. **5** changes between the two views. The bird's-eye view always opens at a low height, looking out ahead; moving the mouse upwards past its shallowest tilt raises the view towards the sky. **+** and **−** set its height, and a pinch on a touch screen does the same; **−** at street level changes to the bird's-eye view. The arrow keys turn and tilt the view, and a two-finger drag pans across the island. The view rises to keep clear of higher ground but does not descend over lower ground.

A double click on land in the bird's-eye view brings the camera down to street level at the point clicked over one and a half seconds, facing the same way. A double click on open water has no effect.

**B** sets tilt-shift on or off in the bird's-eye and chase views. Tilt-shift blurs the top and bottom of the picture so that the island resembles a model.

## Walking

**W A S D** walk, the up and down arrow keys also walk forward and back, and **Shift** held with them runs. **Q** and **E** turn the view. **Space** jumps; a jump towards a wall, a ledge or the eaves of a roof whose top is within reach climbs onto it, so that roofs may be walked upon. **Z** crouches, lowering the eye to 0.95 m and reducing the speed to 45 per cent, and **Z** again stands up.

Doors open when they are walked into. A door swings away from the side from which it is pushed, as far as it is pushed, and closes about a second after nobody stands in its way. The interiors of houses, churches and towers may be entered. Indoors, the sound of the world outside is muffled, and a jump stops short of the ceiling.

**X** sits down on the nearest free seat within 1.5 m towards which the player is turned, whether a bench, a chair, a sunbed, a seat in a railway coach or a seat in a ferry's saloon. **X** again, or a step with **W A S D**, stands the player up.

## Travelling by train

A passenger railway runs along the coast, with stations in the villages and tunnels through the headlands. Goods lines branch from it.

**1** rides in the cab of the passenger train, and **2** in the cab of the goods train working the nearest goods line, which sets one to work there if none is near. **0** then steps through the views of the train: the cab; in the passenger train, a window seat in the first coach, looking out; a view from behind the train, which the mouse moves round it and **+** and **−** bring nearer or further; and a view from beside the line, which turns to watch the train pass and moves on to a new place ahead, riding in the cab while the train is in a tunnel. **0** after the last view returns to the cab. **1** or **2** again, or **5**, steps off beside the track. Away from a train, **0** follows the nearer train from behind.

## Travelling by ferry

Ferries run from the harbours of the main island to the offshore islands. **3** boards the nearest ferry wherever it lies. Aboard, **0** steps through the deck, a view from astern and a window seat in the saloon, looking out. **3** again, or **5**, steps ashore at once if the ferry is at a landing, or at the next landing if it is under way. The ferry sounds its horn three seconds before it leaves a landing, and the horn echoes from the hills.

## Sailing

Every harbour keeps a sailing dinghy at a berth. Within 100 m of a dinghy, **4** takes her helm where she lies. While sailing, **5** leaves the dinghy afloat where she is and rises to the bird's-eye view. With the assisted handling, **W** always paddles her forward, at up to 1.6 m/s, even straight into the wind. In the bird's-eye view, a double click on open water brings a dinghy there and puts the player at its helm. **4** within 6 m of a dinghy boards it. Elsewhere, **4** takes the player to the quay beside the dinghy of the nearest harbour.

At the helm, **A** turns the bow to port and **D** turns it to starboard; the tiller moves the opposite way, as on a real boat. **W** and **S** paddle forward and astern at up to 0.6 m/s while the boat is nearly stopped, and **S** also lets the sail fly. The sail is trimmed with the triggers of a game controller. The boat is driven by the wind, which varies in strength and direction across the day; the sail luffs and flaps when the boat points too close to the wind, and comes over in a tack or a gybe.

**0** changes between the helm and a view from astern, which the mouse moves round the boat and **+** and **−** bring nearer or further, between 5 m and 80 m.

**4** steps ashore when the boat lies within 3 m of a quay, a mole or a beach. Within a harbour the dinghy is moored again at that harbour's berth. Out at sea, **4** returns the dinghy to its own berth and places the player on the quay beside it.

## Swimming and diving

The player wades into the sea from any shore that shelves, and swims once the water reaches the chest. **J** jumps into the sea from the edge of a quay, a mole or a moored boat, over the side of the dinghy, or from the rail of a ferry.

**7** follows the nearest gull in flight, which is then led along the coast, over the shore, the harbours and the edge of the village. **8** follows the nearest dolphin, under the water while it swims beneath the surface and above it as it surfaces or leaps. In each case the mouse moves the camera round the animal, **+** and **−** set its distance, and the same key, or **5**, returns the player to where they were before. **9** returns the player to the place where they first stood on the island.

**6** takes the player under the water, beside the nearest wreck on the seabed offshore, or where no wreck lies within reach, to the nearest open water between 4.5 m and 9 m deep, facing the shore. **6** again returns the player to where they were before.

In the water, **W A S D** swim in the direction of the view. At the surface the head rides the waves. Looking down while swimming forward dives; **C** held also dives, and **Space** held rises. **Shift** swims faster at the cost of more breath. Under the water the light dims and colours with depth, and wrecks, amphorae and the life of the sea bed may be found. Under the water, **F** turns a torch on or off; it lights what lies ahead of the diver.

The swimmer leaves the water by swimming to a beach and wading ashore, by climbing a quay's ladder, or by climbing onto any ledge less than about 1 m above the water.

## Time

The clock runs continuously. **T** held speeds time forty times; **Shift** and **T** held run it backwards at the same rate. **N** changes to 22:00, or to 10:00 if it is already night, and the clock runs on from there. **P** pauses the world: trains, ferries, boats, dolphins, the sea, the lighthouse beams, cats, gulls and the time of day stand still, while the player may still move and look about. **P** again resumes.

## The island

**I** opens the island panel, which shows the seed of the present island. The seed may be any text of up to 32 characters, letters being kept in capitals; a seed of digits alone stands for the number it spells. **Random** replaces the seed with one drawn at random, and **Copy** copies it to the clipboard. **Generate**, or **Enter**, generates the island from the seed shown; it is unavailable while the seed is that of the present island. **Esc**, **Cancel** or **I** again closes the panel and leaves the island unchanged. While the panel is open, any other key is taken as part of the seed.

The new island replaces the present one entirely, and the player begins it on foot. The same seed always produces the same island. The seed is added to the address of the page, so that the island is kept when the page is reloaded and may be shared as a link. An island may also be opened directly by adding `?seed=` and the seed to the address. Without a seed in the address, each launch opens on a new island whose seed is eight letters and digits drawn at random. The seed of the present island is also shown in the statistics panel (**O**).

> **Example:** To return to an island seen earlier, open the panel with **I**, type the seed noted from the statistics panel, and press **Enter**.

## The camera and the gallery

**Enter**, with the camera lowered, takes a quick picture of the view as it is, which is kept in the gallery; the shutter is heard and seen. **C** raises a camera to the eye, and the island is then seen through its lens. The camera remains raised until it is lowered with the button at the top right of the screen, with **C** or with **Esc**. In the water **C** dives instead, and the camera is not raised. While it is raised the mouse is not captured: a drag across the scene turns the view, and the player walks, swims and turns with the usual keys. A click on the scene does not take a picture.

The controls of the lens lie in a panel at the foot of the screen. Each shows its value and a scale, and is adjusted with the **−** and **+** buttons on either side, which repeat while held, or by dragging along its scale.

**Zoom** sets the focal length, from 16 mm to 300 mm in the equivalent of a 35 mm frame; the default is 35 mm. **+** and **−** on the keyboard, and the mouse wheel, do the same.

**Focus** sets the distance at which the picture is sharp. With **AF** lit the camera focuses on whatever lies within the square at the centre of the frame, and the square turns green once it is in focus. The **−** and **+** buttons, or **9** and **0**, move the focus nearer or further and change to manual focus, shown as **MF**; a click on **MF**, or **U**, returns to autofocus.

**Aperture** sets the f-number, from f/1.4 to f/22; the default is f/2.8. A wider aperture gives a shallower depth of field. **[** and **]** do the same.

**Exposure** brightens or darkens the picture in thirds of a stop, between −3 and +3 EV. **;** and **'** do the same.

**Aspect ratio** sets the shape of the frame: **Full**, the default, uses the whole space between the controls, and the fixed shapes are 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 2:3 and 9:16. **T** steps to the next shape and **Shift**+**T** to the previous one.

**Vignette** darkens the corners of the frame, from off to 100 per cent in steps of 10 per cent; the default is off. **,** and **.** do the same.

The four crop marks show the frame of the picture. The part of the screen outside them is darkened and is not included in the picture.

The large round button on the right is the shutter, which sounds as it is pressed; **Enter** also takes a picture. Beneath it the latest picture is shown with the number of pictures taken, and a click on it opens the gallery.

> **Example:** To photograph a bell tower against the sea, raise the camera with **C**, walk until the tower stands against the water, set the zoom to about 85 mm, close the aperture to f/8 so that both are sharp, and press the shutter.

The gallery is opened with **G**, from anywhere and without raising the camera, or from the camera. Each row holds one photograph, with its number and the time it was taken, followed by the artworks made from it, each labelled with its style. A click on an item selects it and shows it enlarged with its details. The enlarged picture, and the picture in artist mode, may be zoomed up to eight times with a pinch or the mouse wheel and moved with a drag while zoomed; a double click shows the whole picture again. **Download PNG** saves the selected item as a PNG file, and the bin deletes it; deleting a photograph also deletes its artworks. Neither is available while nothing is selected. A click with **Cmd** (or **Ctrl**) held adds an item to the selection or removes it, and a click with **Shift** held selects every item between it and the last one chosen; several items selected are shown in a loose pile, the last chosen on top. **Download** then saves each of them, and the bin deletes them all once the question that follows is answered **Delete**; the question names what is to be deleted, counting the artworks that go with a photograph. Up to 24 photographs are kept, with their artworks, in the browser's own storage, so that they remain when the browser is closed and opened again. The divider between the pictures and the preview may be dragged to resize them; its place is remembered, and a double click on it restores the default.

### Artist mode

**Artist mode** is available while a photograph is selected, and makes artworks from it. A style is chosen first: **Watercolour**, **Oil**, **Van Gogh**, **Woodcut** or **3D render**. The settings of that style are then shown. Every setting is remembered by the browser and restored on the next visit.

For the first four styles, **Time to paint** sets how long the picture takes to appear, from at once to 30 seconds, and the remaining sliders set the character of the style, such as the size of the brush or the spacing of the cut lines. For the 3D render, which calculates the light of the scene again from the camera with which the photograph was taken, **Time limit** sets how long the render may take, 30 seconds by default, and **Maximum samples per pixel** the most samples that are taken within it; the render finishes when either is reached, so that a slower computer gives a picture with fewer samples in the same time. **Resolution** sets the size of the picture, **Bounces of light** how often light is reflected, **Path-traced distance** how far from the camera the light is calculated in full (beyond it, the light is estimated from the sun, the sky and their shadows, and matched to the calculated light nearer the camera), **Draw distance** how far the world is loaded, **Visibility in the haze** the clarity of the air, **Noise filter** the smoothing of the remaining noise, **Glass and metal** and **Haze** whether those effects are included, and **Reflectivity of glass and metal** how strongly glass, metal and the trains' paint reflect their surroundings, from none to very high. A 3D render can be made only on the island on which the photograph was taken. **Reset to default** returns the settings of the chosen style to their original values; it is unavailable while they already have them.

The oil style has a further setting, **Colour mixing**, which sets how the colours of the painting are made. **On the palette**, the default, paints each part of the picture in its own colour, as though it had been mixed on the palette beforehand. **Optical** paints in the manner of the divisionists, such as Signac and Cross: no colour is mixed, and each part of the picture is laid with small, separate strokes of a few pure colours from a limited palette, side by side. Seen close to, the separate colours are clearly visible; seen from a distance, they combine in the eye into the colours of the photograph. Shadows contain strokes of the complementary colour or of blue and violet, and warm colours are set beside cold ones. With optical mixing, **Brush size** sets the size of the individual strokes, and **Stroke length** and **Impasto** have the same effect as with mixing on the palette.

> **Example:** To paint a harbour in the manner of Signac, select **Oil**, set **Colour mixing** to **Optical** and **Brush size** to about 10 px, and press **Create**. The finished painting is best judged from a few paces back from the screen.

The Van Gogh style is painted in long, curving strokes of thick paint that follow the forms of the picture and wind into eddies in the sky. The colours are drawn towards chrome yellow, orange, viridian and ultramarine, with the shadows in Prussian blue, and strong edges are outlined in dark blue. **Stroke size** scales the strokes, from × 0.5 to × 2. **Eddies in the sky** sets how strongly the sky is wound into eddies; at 0 the strokes in the sky follow the picture. **Stars** sets the number and size of the stars painted in a night sky, each as a disc of yellow and white within rings of light; at 0 none is painted. **Colour intensity** sets how far the colours are raised and drawn towards the palette. **Outlines** sets the number and weight of the dark outlines. **Impasto** sets the relief of the paint. **Distortion** bends the forms of the picture into waves before it is painted; it is 0 by default.

The woodcut is printed as from a carved block of wood, in black ink on off-white paper. Tone is given by parallel cut lines that follow the forms of the picture: they run level in the sky and wave across the sea, and they close into solid black in the shadows. **Line spacing** sets the distance between the cut lines, from 5 to 16 pixels in a picture 800 pixels high, 9 by default. **Boldness** sets how much of the block is left uncut, and therefore how heavy the black lines and areas are. **Contrast** sets how strongly the light and dark tones are separated. **Outlines** sets the strength of the lines cut round the shapes; at zero they are omitted. **Wood grain** sets how clearly the grain of the block and the unevenness of the inking show in the black. **Colour blocks** sets the number of flat colours printed beneath the black, each from a block of its own, from **None** to four, in the manner of a Japanese colour woodcut; with colour blocks, the black block carries only the outlines and the darker tones. While a single block is shown being made, it is seen being carved, the lightest places first; with colour blocks, the colours are seen being printed one after another, followed by the black.

**Create** makes the artwork, which is shown being made in the large preview, with its progress beneath the settings. The style and the settings may be changed and the artwork rendered again as often as required; a new render, a change of style or leaving artist mode stops a render in progress, and the square button beside the progress bar stops it directly. **Save** keeps the finished artwork in the gallery beside its photograph. It is available only while a finished artwork has not yet been saved.

The arrow at the top left returns to the gallery, as does **Esc**. If the finished artwork has not been saved, a choice is offered first: **Save** keeps it, **Delete** discards it and **Cancel** remains in artist mode.

> **Note:** Photographs and artworks are kept in the browser's own storage. Clearing the browser's data for the site removes them; any that are to be kept for certain should be downloaded.

## Display and sound

**Tab** sets full screen. **Page Up** and **Page Down** increase and reduce the draw distance through eleven fixed levels. **Home** returns the draw distance to automatic, in which the distance is adjusted to keep the frame rate near 60 frames per second. **O** shows or hides an overlay with the frame rate, the frame time, the draw distance, the number of blocks drawn, the draw calls, the triangles, the player's position and the seed of the island.

**M** mutes or restores the sound. The sound is positional: fountains, church bells, the sea, trains, ferries, gulls and cats are heard from where they are, and the ambience changes between day and night.

## Game controllers and touch screens

A game controller is supported. The left stick walks, swims and steers, and the right stick looks. **A** jumps, and rises in the water; **B** crouches, and dives while held in the water. **X** steps through the views, as **0** does, and **Y** changes to the bird's-eye view, as **5** does; the bumpers bring the view nearer or further. The right trigger takes a quick picture. With the camera raised, the right trigger takes a picture through the lens, **B** lowers the camera, **Y** opens the gallery, the bumpers zoom, the D-pad's up and down set the focus further and nearer, and its left and right set the exposure. At the helm the triggers trim the sail. A press of the left stick changes between running and walking, and **Menu** shows the help panel. On the controller's tab of the help panel, **Invert vertical look** reverses the right stick's up and down, and **Sensitivity** sets how fast it turns the view, from 25 % to 300 %; both are remembered.

On a touch screen, a touch on the left part of the screen places a joystick there for walking, and a drag elsewhere turns the view.

## Principle of operation

The island is not stored; it is calculated. The world is divided into square blocks, and each block is generated from the island's seed when the player comes near it and discarded when the player moves away. The height of the ground at any point is a function of position alone, built from the line of the coast, the ridge of the hills and several layers of noise, so that neighbouring blocks always agree at their edges. Villages are laid out from the rules of medieval hill towns. Their streets, alleys, archways and stepped streets are decided block by block from the seed, and their squares are levelled into the hillside as part of the height of the ground.

Blocks near the player are drawn in full detail, and blocks further away are drawn in simplified form; beyond them, a coarse model of the whole island is drawn for views from high above. The world repeats every 8.8 km from north to south, so that travel far enough out to sea in one direction arrives at the opposite shore. The camera's position is kept near the origin of the coordinate system, and the world is moved beneath it, so that precision is not lost far from the starting point.

The sea is a sum of wave trains whose lengths follow the dispersion of waves in deep water, raised by the wind and by the swell of the day and calmed in the lee of the land. The sun, sky, fog and lighting follow the clock, and the shadows follow the sun.

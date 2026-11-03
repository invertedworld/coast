# Cat

These five modules are the cat from Michi-Neko: The Cat Philosopher's Path by c1t1zen1,
<https://github.com/c1t1zen1/Michi-Neko-The-Cat-Philosophers-Path>, used under the MIT licence in `LICENSE`.

| File | Contents |
|---|---|
| `cat.js` | The `Cat` class: skeleton, skinned coat, face, collar and the procedural gait, idle actions and moods. |
| `cat_anatomy.js` | The builds (`michi`, `luna`, `mochi`, `kuro`) and the signed-distance sculpture of the body and head. |
| `cat_sdf.js` | Signed-distance primitives, surface-nets meshing, mesh relaxation and skin-weight baking. |
| `cat_motion.js` | Poses, pose blending and the two-bone leg solver. |
| `cat_shading.js` | The toon ramp, the fur shader, the outline and the canvas textures for the collar, bell and ears. |

The files are unchanged apart from three things: the cache-busting `?v=` suffixes have been removed from their imports, the byte-order mark at the start of `cat.js` has been removed, and `cat.js` has a `tailDrop` property (radians, 0 by default) that lowers the tail from its upright carriage when the cat stands or walks, without affecting the poses of the idle actions. They import `three`, which `index.html` maps to three.js r160 with an import map.

Coast's own code places the cats and moves them about (see "Cats" in the main README). The wandering follows the villager logic in Michi-Neko's `src/npc.js`.

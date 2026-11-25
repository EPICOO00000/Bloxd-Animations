# Bob preview asset provenance

The preview loads the supplied `bob-classic-rig.glb` and uses its embedded image and materials unchanged. The companion `bob-classic-skin.png` is retained as supplied but is not reapplied, because its image is vertically flipped relative to the GLB's embedded atlas. They were copied at the repository owner's direction from the linked site repository:

- Source repository: https://github.com/EPICOO00000/Bloxd-anim-studio
- Source snapshot: `2ff7cd845248bcf0e9c5fff41b09f37cdfa7a4e2`
- Source paths: `assets/bob-classic-rig.glb` and `assets/bob-classic-skin.png`

The source GLB's measured bounds are X −0.5…0.5, Y 0…2, and Z −0.25…0.25 (1 × 2 × 0.5 model units). A pixel-level comparison verified that the standalone PNG is an exact vertical flip of the GLB's embedded atlas, which is why the runtime keeps the embedded material map instead of replacing it. The source repository's `CREDITS.md` describes these exact files as a **reference-based classic-Bob recreation**, not a verified original game model or extracted game skin. This editor uses the supplied model and its embedded atlas rather than generating replacement character geometry or adding extra facial/clothing details. It does not claim that these files are official Bloxd exports. Bloxd-related rights remain with their owners; the repository's root `LICENSE` does not replace or expand rights in these assets.

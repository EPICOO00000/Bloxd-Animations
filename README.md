# Bloxd Motion Studio

A browser-based Bloxd character animation editor. Pose the classic Bob rig, add and retime keyframes, preview the motion in 3D, and export a ready-to-paste `api.animateEntity` JavaScript snippet.

## Run locally

Serve this folder over HTTP (ES modules do not run from a `file://` URL):

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

Then open `http://localhost:8000`.

## Editor controls

- Select a body part from the rig list or click the model. The rig maps to Bloxd's `TorsoNode`, `HeadMesh`, `ArmLeftMesh`, `ArmRightMesh`, `LegLeftMesh`, and `LegRightMesh` nodes.
- Use the Move/Rotate gizmo or the numeric inspector to pose the selected bone.
- Scrub the timeline, press **K** or click **Add keyframe**, and drag diamonds to retime keys. Playback: **Space**. Move/rotate: **W/E**. Previous/next frame: **←/→**.
- With Auto Key enabled, edits create/update a key at the playhead. Turn it off to edit existing keys only.
- **Export code** produces a Bloxd `api.animateEntity(myId, animation)` snippet. Save/Open use `.bloxdanim.json` project files; edits are also autosaved in the current browser.

The 3D preview loads the supplied classic Bob rig and 64×64 skin atlas from `assets/`. The imported model's pivots and geometry are retained; identity wrappers connect its torso, head, shoulders, and hips to the editor's six Bloxd animation/export nodes. The studio does not add procedural face or clothing geometry. See [`assets/README.md`](assets/README.md) for the source and provenance note.

Three.js, GLTFLoader, BufferGeometryUtils, OrbitControls, and TransformControls are bundled locally under `vendor/`; see `vendor/LICENSE-three.txt` for their MIT license.

## License

Repository-owned code is subject to the custom terms in [`LICENSE`](LICENSE). Third-party components retain their own license terms; the bundled Three.js files are MIT-licensed as noted above.

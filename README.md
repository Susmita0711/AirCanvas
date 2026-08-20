# Air Canvas

A framework-free gesture drawing app using the MediaPipe Hand Landmarker, HTML Canvas, and a live mirrored webcam feed.

## Run

Because webcam APIs generally require a secure context, serve these files from `localhost` rather than opening `index.html` directly.

For example, from this folder:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` in a modern browser and allow camera access.

## Files

- `index.html` — HUD-style UI shell, camera stage, palette, controls.
- `style.css` — responsive dark glassmorphism visual system.
- `script.js` — all state, camera/model setup, gesture classification, coordinate projection, drawing, erasing, flower stamping, and resize replay.

## Gestures

- **Pointing**: index extended while middle/ring/pinky are curled → Pen or Flower, depending on the selected tool.
- **Fist**: all four fingers curled → Eraser.
- **Open palm**: all four fingers extended → Idle/pause.
- Ambiguous shapes fall back to idle.

The gesture classifier uses PIP joint angles and debounces changes for four consecutive frames.

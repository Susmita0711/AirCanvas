# 🎨 Air Canvas — Gesture Drawing HUD

An immersive, framework-free gesture drawing experience using **MediaPipe Hand Landmarker**, **HTML5 Canvas**, and real-time computer vision right in your web browser. 🚀

## 🔗Live : https://susmita0711.github.io/AirCanvas/
---

## 🌟 Key Features

*   🤖 **On-Device Machine Learning:** Powered by Google MediaPipe Hand Landmarker for ultra-responsive, lag-free hand tracking.
*   🎥 **Real-time Camera HUD:** Draw directly over your live, mirrored webcam feed with a futuristic, sci-fi glassmorphism overlay.
*   🖌️ **Creative Tool Set:**
    *   ✏️ **Dynamic Pen:** Smooth, custom-stroke drawing with adjustable brush sizes.
    *   🌸 **Flower Stamp:** Stamp colorful, randomized decorative flowers with dynamic scaling and rotation.
    *   🧽 **Intelligent Eraser:** Easily erase drawings by converting your tool to an eraser.
*   🌈 **Curated Swatches:** Premium, high-contrast color palettes (Red, Orange, Yellow, Green, Blue, Purple, Pink, and White) with adaptive light-contrast styling.
*   📱 **Vector-Based Canvas Replay:** Resizing your browser window automatically redraws all strokes perfectly at any device pixel ratio (DPR).
*   ⚙️ **Telemetry Dashboard:** Live status telemetry indicators tracking model loading, hand presence, and gesture states.

---

## ☝️ Gesture Control Guide

Control the canvas entirely with your hand gestures! The app reads your joint angles and debounces motions for smooth state transitions:

| Gesture | Visual | Action / Tool |
| :--- | :---: | :--- |
| **Pointing** | ☝️ | **Draw / Stamp:** Extend only your index finger. Draws lines or stamps flowers depending on your selected tool. |
| **Fist** | ✊ | **Eraser:** Curl all fingers. Instantly switches to the eraser to wipe away strokes. |
| **Open Palm** | ✋ | **Idle / Pause:** Extend all fingers. Hover over the screen without drawing or erasing. |

*Any ambiguous or unrecognized hand shapes will safely default to the **Idle** state.*

---

## 🚀 Quick Start

### 1. Run Locally
Webcam APIs require a secure context (`https` or `localhost`). You can run a lightweight local server from this folder:

**Using Python:**
```bash
python -m http.server 8000
```
**Using Node.js (`http-server`):**
```bash
npx http-server -p 8000
```

Then open **`http://localhost:8000`** in your browser and allow camera access.

### 2. Deploy to GitHub Pages
To share it with others online, simply push to GitHub and enable Pages:
1. Go to **Settings** -> **Pages** in your GitHub repository.
2. Select the `main` branch and `/ (root)` folder.
3. Save, and your app will be live at `https://<username>.github.io/<repo-name>/`.

---

## 📂 Project Structure

*   📄 **[index.html](index.html)** — HUD-style shell layout, camera stage, color swatches, and dashboard telemetry.
*   🎨 **[style.css](style.css)** — Glassmorphism visual design system, custom range sliders, status indicators, and responsive flex grid.
*   ⚙️ **[script.js](script.js)** — MediaPipe initialization, custom gesture classification engine, vector coordinate projection, and canvas drawing pipeline.

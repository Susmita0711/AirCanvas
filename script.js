import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

const video = document.querySelector("#video");
const stage = document.querySelector("#stage");
const drawCanvas = document.querySelector("#drawCanvas");
const cursorCanvas = document.querySelector("#cursorCanvas");
const drawCtx = drawCanvas.getContext("2d");
const cursorCtx = cursorCanvas.getContext("2d");
const loadingOverlay = document.querySelector("#loadingOverlay");
const loadingTitle = document.querySelector("#loadingTitle");
const loadingCopy = document.querySelector("#loadingCopy");
const errorOverlay = document.querySelector("#errorOverlay");
const errorTitle = document.querySelector("#errorTitle");
const errorCopy = document.querySelector("#errorCopy");
const retryCamera = document.querySelector("#retryCamera");
const resolutionLabel = document.querySelector("#resolutionLabel");
const modelStatus = document.querySelector("#modelStatus");
const handStatus = document.querySelector("#handStatus");
const gestureStatus = document.querySelector("#gestureStatus");
const drawingToggle = document.querySelector("#drawingToggle");
const brushSize = document.querySelector("#brushSize");
const sizeValue = document.querySelector("#sizeValue");

const state = {
  handLandmarker: null,
  lastVideoTime: -1,
  running: false,
  cameraReady: false,
  modelReady: false,
  drawingEnabled: true,
  selectedTool: "pen",
  color: "#ef4444",
  brushSize: 12,
  dpr: 1,
  projection: { drawW: 0, drawH: 0, offsetX: 0, offsetY: 0 },
  strokes: [],
  currentStroke: null,
  smoothedPoint: null,
  lastFlowerPoint: null,
  rawGesture: "idle",
  rawGestureFrames: 0,
  committedGesture: "idle",
  handPresent: false,
  lastTimestamp: 0,
};

const THRESHOLD = 150;
const DEBOUNCE_FRAMES = 4;
const SMOOTHING = 0.45;
const COLORS = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#ffffff"];

function setStatus(el, text, mode = "") {
  el.querySelector("span").textContent = text;
  el.classList.remove("ready", "warn", "active");
  if (mode) el.classList.add(mode);
}

function setLoading(title, copy) {
  loadingTitle.textContent = title;
  loadingCopy.textContent = copy;
  loadingOverlay.classList.remove("hidden");
}

function hideLoading() { loadingOverlay.classList.add("hidden"); }

function showCameraError(title, copy) {
  errorTitle.textContent = title;
  errorCopy.textContent = copy;
  errorOverlay.classList.remove("hidden");
  loadingOverlay.classList.add("hidden");
}

function clearCameraError() { errorOverlay.classList.add("hidden"); }

function resizeCanvases() {
  const rect = stage.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);

  // Keep CSS dimensions in logical pixels, but use a DPR-sized backing store for crisp strokes.
  for (const canvas of [drawCanvas, cursorCanvas]) {
    canvas.width = Math.round(width * state.dpr);
    canvas.height = Math.round(height * state.dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  drawCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  cursorCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  computeProjection(width, height);
  replayAllStrokes();
  clearCursor();
}

function computeProjection(stageWidth = stage.clientWidth, stageHeight = stage.clientHeight) {
  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  // This exactly reproduces CSS object-fit: cover: scale until both dimensions cover the stage,
  // then center the resulting video box. Landmarks are first mapped into that raw box.
  const scale = Math.max(stageWidth / vw, stageHeight / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  state.projection = {
    drawW,
    drawH,
    offsetX: (stageWidth - drawW) / 2,
    offsetY: (stageHeight - drawH) / 2,
  };
}

function projectNormalized(nx, ny) {
  const { drawW, drawH, offsetX, offsetY } = state.projection;
  const x = offsetX + nx * drawW;
  const y = offsetY + ny * drawH;
  // MediaPipe coordinates refer to the unmirrored camera frame; CSS mirrors the video.
  return { x: drawCanvas.clientWidth - x, y };
}

function normalizedFromCanvasPoint(x, y) {
  const { drawW, drawH, offsetX, offsetY } = state.projection;
  // Invert the same cover + mirror projection so stored points remain resolution-independent.
  const rawX = drawCanvas.clientWidth - x;
  return {
    x: (rawX - offsetX) / drawW,
    y: (y - offsetY) / drawH,
  };
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function pointInVisibleFrame(p) {
  return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}

function setCanvasTransform(ctx) { ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0); }

function replayAllStrokes() {
  setCanvasTransform(drawCtx);
  drawCtx.clearRect(0, 0, drawCanvas.clientWidth, drawCanvas.clientHeight);
  drawCtx.globalCompositeOperation = "source-over";
  for (const stroke of state.strokes) {
    if (stroke.type === "pen" || stroke.type === "eraser") replayLineStroke(stroke);
    else if (stroke.type === "flower") {
      for (const point of stroke.points) drawFlower(projectNormalized(point.x, point.y), stroke.color, stroke.width, point.rotation, point.scale);
    }
  }
  drawCtx.globalCompositeOperation = "source-over";
}

function replayLineStroke(stroke) {
  if (stroke.points.length < 2) return;
  drawCtx.save();
  drawCtx.globalCompositeOperation = stroke.type === "eraser" ? "destination-out" : "source-over";
  drawCtx.strokeStyle = stroke.color || "#fff";
  drawCtx.lineWidth = stroke.width;
  drawCtx.lineCap = "round";
  drawCtx.lineJoin = "round";
  drawCtx.beginPath();
  const first = projectNormalized(stroke.points[0].x, stroke.points[0].y);
  drawCtx.moveTo(first.x, first.y);
  for (let i = 1; i < stroke.points.length; i++) {
    const p = projectNormalized(stroke.points[i].x, stroke.points[i].y);
    drawCtx.lineTo(p.x, p.y);
  }
  drawCtx.stroke();
  drawCtx.restore();
}

function drawLineSegment(a, b, color, width, erase = false) {
  drawCtx.save();
  drawCtx.globalCompositeOperation = erase ? "destination-out" : "source-over";
  drawCtx.strokeStyle = color;
  drawCtx.lineWidth = width;
  drawCtx.lineCap = "round";
  drawCtx.lineJoin = "round";
  drawCtx.beginPath();
  drawCtx.moveTo(a.x, a.y);
  drawCtx.lineTo(b.x, b.y);
  drawCtx.stroke();
  drawCtx.restore();
}

function luminance(hex) {
  const h = hex.replace("#", "");
  const rgb = [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  return (0.299 * rgb[0]) + (0.587 * rgb[1]) + (0.114 * rgb[2]);
}

function flowerCenterColor(petalColor) {
  return luminance(petalColor) > 150 ? "#4a2111" : "#f7c948";
}

function drawFlower(center, color, baseSize, rotation, scale = 1) {
  const radius = baseSize * 1.8 * scale;
  const petalW = radius * 0.72;
  const petalH = radius * 1.18;
  drawCtx.save();
  drawCtx.translate(center.x, center.y);
  drawCtx.rotate(rotation);
  drawCtx.fillStyle = color;
  for (let i = 0; i < 6; i++) {
    drawCtx.save();
    drawCtx.rotate((Math.PI * 2 * i) / 6);
    drawCtx.beginPath();
    drawCtx.ellipse(0, -radius * .72, petalW / 2, petalH / 2, 0, 0, Math.PI * 2);
    drawCtx.fill();
    drawCtx.restore();
  }
  drawCtx.fillStyle = flowerCenterColor(color);
  drawCtx.beginPath();
  drawCtx.arc(0, 0, radius * .32, 0, Math.PI * 2);
  drawCtx.fill();
  drawCtx.restore();
}

function drawFlowerGhost(center) {
  const radius = state.brushSize * 1.8;
  cursorCtx.save();
  cursorCtx.globalAlpha = 0.32;
  drawFlowerOnContext(cursorCtx, center, state.color, state.brushSize, 0, 1);
  cursorCtx.restore();
}

function drawFlowerOnContext(ctx, center, color, baseSize, rotation, scale) {
  const radius = baseSize * 1.8 * scale;
  const petalW = radius * .72;
  const petalH = radius * 1.18;
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(rotation);
  ctx.fillStyle = color;
  for (let i = 0; i < 6; i++) {
    ctx.save(); ctx.rotate((Math.PI * 2 * i) / 6);
    ctx.beginPath(); ctx.ellipse(0, -radius * .72, petalW / 2, petalH / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  ctx.fillStyle = flowerCenterColor(color);
  ctx.beginPath(); ctx.arc(0,0,radius*.32,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

function clearCursor() {
  setCanvasTransform(cursorCtx);
  cursorCtx.clearRect(0, 0, cursorCanvas.clientWidth, cursorCanvas.clientHeight);
}

function drawCursor(point) {
  clearCursor();
  if (!point || !state.handPresent) return;
  if (state.committedGesture === "eraser") {
    const r = state.brushSize * 2;
    cursorCtx.save();
    cursorCtx.strokeStyle = "rgba(255,255,255,.8)";
    cursorCtx.lineWidth = 1.5;
    cursorCtx.setLineDash([5, 5]);
    cursorCtx.beginPath(); cursorCtx.arc(point.x, point.y, r, 0, Math.PI * 2); cursorCtx.stroke();
    cursorCtx.restore();
    return;
  }
  if (state.committedGesture === "pen" && state.selectedTool === "flower") {
    drawFlowerGhost(point);
    return;
  }
  cursorCtx.save();
  cursorCtx.shadowBlur = 18;
  cursorCtx.shadowColor = state.color;
  cursorCtx.fillStyle = state.color;
  cursorCtx.globalAlpha = .92;
  cursorCtx.beginPath(); cursorCtx.arc(point.x, point.y, Math.max(4, state.brushSize * .38), 0, Math.PI * 2); cursorCtx.fill();
  cursorCtx.strokeStyle = "rgba(255,255,255,.7)";
  cursorCtx.lineWidth = 1;
  cursorCtx.beginPath(); cursorCtx.arc(point.x, point.y, Math.max(8, state.brushSize * .72), 0, Math.PI * 2); cursorCtx.stroke();
  cursorCtx.restore();
}

function endCurrentStroke() {
  state.currentStroke = null;
  state.smoothedPoint = null;
  state.lastFlowerPoint = null;
}

function angleAtPIP(mcp, pip, tip) {
  const a = { x: mcp.x - pip.x, y: mcp.y - pip.y, z: (mcp.z || 0) - (pip.z || 0) };
  const b = { x: tip.x - pip.x, y: tip.y - pip.y, z: (tip.z || 0) - (pip.z || 0) };
  const dot = a.x*b.x + a.y*b.y + a.z*b.z;
  const mag = Math.hypot(a.x,a.y,a.z) * Math.hypot(b.x,b.y,b.z);
  if (!mag) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180 / Math.PI;
}

function classifyGesture(lm) {
  // PIP joint angle is rotation-friendly: a straight finger is ~180°, while a curled one is small.
  const fingers = [
    angleAtPIP(lm[9], lm[10], lm[12]),   // middle
    angleAtPIP(lm[13], lm[14], lm[16]),  // ring
    angleAtPIP(lm[17], lm[18], lm[20]),  // pinky
  ];
  const indexAngle = angleAtPIP(lm[5], lm[6], lm[8]);
  const indexExtended = indexAngle >= THRESHOLD;
  const othersExtended = fingers.map(a => a >= THRESHOLD);
  if (indexExtended && othersExtended.every(v => !v)) return "pen";
  if (othersExtended.every(v => !v) && indexAngle < THRESHOLD) return "eraser";
  if (indexExtended && othersExtended.every(Boolean)) return "idle";
  return "idle"; // Ambiguous is intentionally safe: never accidentally draw/erase.
}

function updateGesture(raw) {
  if (raw === state.rawGesture) state.rawGestureFrames++;
  else { state.rawGesture = raw; state.rawGestureFrames = 1; }
  if (state.rawGestureFrames >= DEBOUNCE_FRAMES && raw !== state.committedGesture) {
    state.committedGesture = raw;
    endCurrentStroke();
  }
}

function updateGestureStatus() {
  const labels = { pen: "pointing", eraser: "fist", idle: "open palm" };
  const tool = state.committedGesture === "pen" ? state.selectedTool : state.committedGesture;
  setStatus(gestureStatus, `${tool} · ${labels[state.committedGesture]}`, "accent");
}

function smoothPoint(target) {
  if (!state.smoothedPoint) { state.smoothedPoint = { ...target }; return state.smoothedPoint; }
  state.smoothedPoint.x += (target.x - state.smoothedPoint.x) * SMOOTHING;
  state.smoothedPoint.y += (target.y - state.smoothedPoint.y) * SMOOTHING;
  return state.smoothedPoint;
}

function beginLineStroke(type, normalizedPoint) {
  const width = type === "eraser" ? state.brushSize * 4 : state.brushSize;
  const stroke = { type, color: state.color, width, points: [normalizedPoint] };
  state.strokes.push(stroke);
  state.currentStroke = stroke;
}

function processPen(point) {
  const n = normalizedFromCanvasPoint(point.x, point.y);
  if (!pointInVisibleFrame(n)) { endCurrentStroke(); return; }
  if (!state.currentStroke || state.currentStroke.type !== "pen") beginLineStroke("pen", { x:clamp01(n.x), y:clamp01(n.y) });
  else {
    const prevN = state.currentStroke.points[state.currentStroke.points.length - 1];
    const prev = projectNormalized(prevN.x, prevN.y);
    state.currentStroke.points.push({ x:clamp01(n.x), y:clamp01(n.y) });
    drawLineSegment(prev, point, state.color, state.brushSize, false);
  }
}

function processEraser(point) {
  const n = normalizedFromCanvasPoint(point.x, point.y);
  if (!pointInVisibleFrame(n)) { endCurrentStroke(); return; }
  if (!state.currentStroke || state.currentStroke.type !== "eraser") beginLineStroke("eraser", { x:clamp01(n.x), y:clamp01(n.y) });
  else {
    const prevN = state.currentStroke.points[state.currentStroke.points.length - 1];
    const prev = projectNormalized(prevN.x, prevN.y);
    state.currentStroke.points.push({ x:clamp01(n.x), y:clamp01(n.y) });
    drawLineSegment(prev, point, "#000", state.brushSize * 4, true);
  }
}

function processFlower(point) {
  const n = normalizedFromCanvasPoint(point.x, point.y);
  if (!pointInVisibleFrame(n)) { endCurrentStroke(); return; }
  const radius = state.brushSize * 1.8;
  // Flowers are stamps, not a line. Wait until the cursor moves roughly 1.3 radii before adding another.
  if (state.lastFlowerPoint) {
    const distance = Math.hypot(point.x - state.lastFlowerPoint.x, point.y - state.lastFlowerPoint.y);
    if (distance < radius * 1.3) return;
  }
  const stamp = {
    x: clamp01(n.x), y: clamp01(n.y),
    rotation: Math.random() * Math.PI * 2,
    scale: 0.85 + Math.random() * 0.30,
  };
  if (!state.currentStroke || state.currentStroke.type !== "flower") {
    state.currentStroke = { type:"flower", color:state.color, width:state.brushSize, points:[] };
    state.strokes.push(state.currentStroke);
  }
  state.currentStroke.points.push(stamp);
  drawFlower(point, state.color, state.brushSize, stamp.rotation, stamp.scale);
  state.lastFlowerPoint = { ...point };
}

function handleHand(lm) {
  state.handPresent = true;
  setStatus(handStatus, "hand · detected", "ready");
  const raw = classifyGesture(lm);
  updateGesture(raw);
  updateGestureStatus();

  let target;
  if (state.committedGesture === "eraser") {
    // In a fist, landmark 8 folds toward the palm. The wrist + MCP average stays much steadier.
    const ids = [0, 5, 9, 13, 17];
    target = ids.reduce((acc, id) => ({ x:acc.x + lm[id].x / ids.length, y:acc.y + lm[id].y / ids.length }), {x:0,y:0});
  } else target = { x:lm[8].x, y:lm[8].y };

  const projected = projectNormalized(target.x, target.y);
  const point = smoothPoint(projected);
  drawCursor(point);

  if (!state.drawingEnabled || state.committedGesture === "idle") { endCurrentStroke(); return; }
  if (state.committedGesture === "eraser") processEraser(point);
  else if (state.selectedTool === "flower") processFlower(point);
  else processPen(point);
}

function handleNoHand() {
  if (state.handPresent) endCurrentStroke();
  state.handPresent = false;
  state.rawGesture = "idle";
  state.rawGestureFrames = 0;
  state.committedGesture = "idle";
  setStatus(handStatus, "hand · searching", "warn");
  updateGestureStatus();
  clearCursor();
}

async function initCamera() {
  clearCameraError();
  setLoading("INITIALIZING CAMERA", "Requesting webcam access…");
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
    const stream = await navigator.mediaDevices.getUserMedia({ video:{ width:{ideal:1280}, height:{ideal:720}, facingMode:"user" }, audio:false });
    video.srcObject = stream;
    await video.play();
    state.cameraReady = true;
    resolutionLabel.textContent = `${video.videoWidth} × ${video.videoHeight}`;
    computeProjection();
    resizeCanvases();
    if (state.modelReady) hideLoading();
  } catch (error) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") showCameraError("CAMERA PERMISSION DENIED", "Allow camera access for this site in your browser settings, then retry.");
    else if (error.name === "NotFoundError") showCameraError("NO CAMERA FOUND", "No webcam was detected. Connect a camera and retry.");
    else if (error.message === "unsupported") showCameraError("BROWSER UNSUPPORTED", "This browser does not expose getUserMedia. Use a current Chrome, Edge, Firefox, or Safari over HTTPS or localhost.");
    else showCameraError("CAMERA ERROR", `The camera could not be started (${error.name || "unknown error"}). Check browser permissions and try again.`);
  }
}

async function initHandLandmarker() {
  try {
    setStatus(modelStatus, "model · loading", "warn");
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    state.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    });
    state.modelReady = true;
    setStatus(modelStatus, "model · ready", "ready");
    if (state.cameraReady) hideLoading();
  } catch (error) {
    setStatus(modelStatus, "model · error", "warn");
    showCameraError("TRACKING MODEL ERROR", "The hand-tracking model could not load. Check your internet connection and reload the page.");
    console.error(error);
  }
}

function frameLoop(timestamp) {
  if (!state.running) return;
  requestAnimationFrame(frameLoop);
  if (!state.handLandmarker || !state.cameraReady || video.readyState < 2) return;
  if (video.currentTime === state.lastVideoTime) return;
  state.lastVideoTime = video.currentTime;
  try {
    const result = state.handLandmarker.detectForVideo(video, timestamp);
    if (result.landmarks?.length) handleHand(result.landmarks[0]);
    else handleNoHand();
  } catch (error) { console.error("Hand detection error:", error); }
}

function setupUI() {
  document.querySelectorAll(".swatch").forEach(btn => btn.addEventListener("click", () => {
    state.color = btn.dataset.color;
    document.querySelectorAll(".swatch").forEach(b => b.classList.toggle("active", b === btn));
  }));

  document.querySelectorAll(".tool-button").forEach(btn => btn.addEventListener("click", () => {
    if (state.selectedTool === btn.dataset.tool) return;
    state.selectedTool = btn.dataset.tool;
    document.querySelectorAll(".tool-button").forEach(b => b.classList.toggle("active", b === btn));
    endCurrentStroke();
    updateGestureStatus();
  }));

  drawingToggle.addEventListener("click", () => {
    state.drawingEnabled = !state.drawingEnabled;
    drawingToggle.classList.toggle("on", state.drawingEnabled);
    drawingToggle.setAttribute("aria-checked", String(state.drawingEnabled));
    drawingToggle.querySelector(".toggle-text").textContent = state.drawingEnabled ? "ON" : "OFF";
    if (!state.drawingEnabled) endCurrentStroke();
  });
  drawingToggle.classList.add("on");

  brushSize.addEventListener("input", () => {
    state.brushSize = Number(brushSize.value);
    sizeValue.textContent = `${state.brushSize} PX`;
    endCurrentStroke();
  });

  document.querySelector("#clearCanvas").addEventListener("click", () => {
    state.strokes.length = 0;
    endCurrentStroke();
    replayAllStrokes();
  });
  retryCamera.addEventListener("click", initCamera);

  const observer = new ResizeObserver(() => resizeCanvases());
  observer.observe(stage);
  window.addEventListener("resize", resizeCanvases, { passive:true });
  video.addEventListener("loadedmetadata", () => { resolutionLabel.textContent = `${video.videoWidth} × ${video.videoHeight}`; resizeCanvases(); });
}

async function boot() {
  setupUI();
  resizeCanvases();
  state.running = true;
  requestAnimationFrame(frameLoop);
  await Promise.allSettled([initCamera(), initHandLandmarker()]);
}

boot();

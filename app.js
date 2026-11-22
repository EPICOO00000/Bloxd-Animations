import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { TransformControls } from './vendor/TransformControls.js';

const STORAGE_KEY = 'bloxd-motion-studio-project-v1';
const ALLOWED_INTERPOLATION = new Set(['catmullrom', 'linear', 'step']);
const $ = (id) => document.getElementById(id);
const NAME_WIDTH = 172;
const TIMELINE_PAD = 10;

const PARTS = [
  { id: 'torso', name: 'Torso', node: 'TorsoNode', color: '#81d2b0', icon: 'torso' },
  { id: 'head', name: 'Head', node: 'HeadMesh', color: '#f2be70', icon: 'head' },
  { id: 'leftArm', name: 'Left arm', node: 'ArmLeftMesh', color: '#86baff', icon: 'arm' },
  { id: 'rightArm', name: 'Right arm', node: 'ArmRightMesh', color: '#69d5ca', icon: 'arm' },
  { id: 'leftLeg', name: 'Left leg', node: 'LegLeftMesh', color: '#bf9bf3', icon: 'leg' },
  { id: 'rightLeg', name: 'Right leg', node: 'LegRightMesh', color: '#f095a4', icon: 'leg' },
];
const PART_BY_ID = Object.fromEntries(PARTS.map((part) => [part.id, part]));

const round = (number, places = 4) => Number(Number(number).toFixed(places));
const zeroVector = () => [0, 0, 0];
const copyVector = (value) => Array.isArray(value) && value.length >= 3
  ? value.slice(0, 3).map((v) => (Number.isFinite(Number(v)) ? round(Number(v)) : 0))
  : zeroVector();
const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const safeProjectName = (value) => String(value || 'Untitled animation').trim().slice(0, 48) || 'Untitled animation';
const formatSeconds = (value) => Number(value || 0).toFixed(2);
const formatInput = (value) => {
  const n = round(value, 3);
  return Object.is(n, -0) ? '0' : String(n);
};

function makeKey(time, pose = null, interpolation = 'catmullrom') {
  return {
    time: round(time),
    position: copyVector(pose?.position),
    rotation: copyVector(pose?.rotation),
    interpolation: ALLOWED_INTERPOLATION.has(interpolation) ? interpolation : 'catmullrom',
  };
}

function makeBlankProject() {
  const parts = {};
  for (const part of PARTS) {
    parts[part.id] = { keys: [makeKey(0)] };
  }
  return {
    name: 'Untitled animation',
    duration: 2,
    fps: 24,
    loop: true,
    autoKey: true,
    parts,
  };
}

function makeWelcomeProject() {
  const project = makeBlankProject();
  project.name = 'Bob says hello';
  project.parts.torso.keys = [
    makeKey(0),
    makeKey(1, { position: [0, 0, 0], rotation: [3, 0, -3] }),
    makeKey(2),
  ];
  project.parts.head.keys = [
    makeKey(0),
    makeKey(0.8, { position: [0, 0, 0], rotation: [4, 9, 0] }),
    makeKey(1.15, { position: [0, 0, 0], rotation: [-2, -9, 0] }),
    makeKey(2),
  ];
  project.parts.rightArm.keys = [
    makeKey(0),
    makeKey(0.25, { position: [0, 0, 0], rotation: [0, 0, 86] }),
    makeKey(0.55, { position: [0, 0, 0], rotation: [0, 0, 64] }),
    makeKey(0.85, { position: [0, 0, 0], rotation: [0, 0, 98] }),
    makeKey(1.15, { position: [0, 0, 0], rotation: [0, 0, 65] }),
    makeKey(1.45, { position: [0, 0, 0], rotation: [0, 0, 98] }),
    makeKey(1.72, { position: [0, 0, 0], rotation: [0, 0, 36] }),
    makeKey(2),
  ];
  for (const part of PARTS) {
    if (!project.parts[part.id].keys.some((key) => Math.abs(key.time - 2) < 0.0001)) {
      project.parts[part.id].keys.push(makeKey(2));
    }
  }
  return project;
}

function normalizeProject(raw) {
  const fallback = makeBlankProject();
  if (!raw || typeof raw !== 'object') return fallback;
  const normalized = {
    name: safeProjectName(raw.name),
    duration: clamp(Number(raw.duration) || 2, 0.25, 60),
    fps: [12, 24, 30, 60].includes(Number(raw.fps)) ? Number(raw.fps) : 24,
    loop: raw.loop !== false,
    autoKey: raw.autoKey !== false,
    parts: {},
  };

  let greatestKey = 0;
  for (const part of PARTS) {
    const inputKeys = raw.parts?.[part.id]?.keys;
    const keys = Array.isArray(inputKeys) ? inputKeys : [];
    const byTime = new Map();
    for (const input of keys) {
      if (!input || !Number.isFinite(Number(input.time))) continue;
      const time = round(clamp(Number(input.time), 0, 60));
      const interpolation = ALLOWED_INTERPOLATION.has(input.interpolation) ? input.interpolation : 'catmullrom';
      byTime.set(time.toFixed(4), makeKey(time, {
        position: copyVector(input.position),
        rotation: copyVector(input.rotation),
      }, interpolation));
    }
    const cleanKeys = [...byTime.values()].sort((a, b) => a.time - b.time);
    if (cleanKeys.length) greatestKey = Math.max(greatestKey, cleanKeys.at(-1).time);
    normalized.parts[part.id] = { keys: cleanKeys };
  }
  normalized.duration = round(clamp(Math.max(normalized.duration, greatestKey), 0.25, 60), 3);
  return normalized;
}

function readInitialProject() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeProject(JSON.parse(saved)) : makeWelcomeProject();
  } catch (error) {
    console.warn('Could not restore the saved Bloxd animation project.', error);
    return makeWelcomeProject();
  }
}

let state = readInitialProject();
let selectedPartId = 'rightArm';
let currentTime = 0;
let selectedKeyTime = null;
let snapEnabled = true;
let timelineZoom = 1;
let timelineNameWidth = NAME_WIDTH;
let timelinePps = 160;
let isPlaying = false;
let lastPlayTimestamp = 0;
let renderRequest = 0;
let toastTimeout = 0;
let isApplyingPose = false;
let selectedMode = 'translate';
let activeNumberEdit = false;
const history = [];
const future = [];

const fields = [...document.querySelectorAll('.vector-field input[data-channel]')];
const partObjects = {};
const partMeshes = Object.fromEntries(PARTS.map((part) => [part.id, []]));
const pickMeshes = [];
let scene;
let camera;
let renderer;
let orbitControls;
let transformControls;
let selectionHelper;
let timelineResizeObserver;

function projectData() {
  return {
    format: 'bloxd-motion-studio',
    version: 1,
    name: state.name,
    duration: state.duration,
    fps: state.fps,
    loop: state.loop,
    autoKey: state.autoKey,
    parts: Object.fromEntries(PARTS.map((part) => [part.id, {
      keys: state.parts[part.id].keys.map((key) => ({
        time: key.time,
        position: [...key.position],
        rotation: [...key.rotation],
        interpolation: key.interpolation,
      })),
    }])),
  };
}

function projectString() {
  return JSON.stringify(projectData());
}

function updateHistoryButtons() {
  $('undo-button').disabled = history.length === 0;
  $('redo-button').disabled = future.length === 0;
}

function pushHistorySnapshot(snapshot) {
  if (history.at(-1) === snapshot) return;
  history.push(snapshot);
  if (history.length > 80) history.shift();
  future.length = 0;
  updateHistoryButtons();
}

function recordHistory() {
  pushHistorySnapshot(projectString());
}

function restoreProject(snapshot) {
  try {
    state = normalizeProject(JSON.parse(snapshot));
    currentTime = 0;
    selectedPartId = PARTS.some((part) => part.id === selectedPartId) ? selectedPartId : 'rightArm';
    selectedKeyTime = null;
    renderAll();
    persistProject();
  } catch (error) {
    console.error('Could not restore animation history.', error);
  }
}

function undo() {
  if (!history.length) return;
  future.push(projectString());
  const snapshot = history.pop();
  restoreProject(snapshot);
  updateHistoryButtons();
  showToast('Undo');
}

function redo() {
  if (!future.length) return;
  history.push(projectString());
  const snapshot = future.pop();
  restoreProject(snapshot);
  updateHistoryButtons();
  showToast('Redo');
}

function persistProject() {
  try {
    localStorage.setItem(STORAGE_KEY, projectString());
    const status = $('save-status');
    status.classList.remove('is-saving');
    status.querySelector('span').textContent = 'Saved locally';
  } catch (error) {
    console.warn('Unable to save this animation in browser storage.', error);
    $('save-status').querySelector('span').textContent = 'Save unavailable';
  }
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove('show'), 1850);
}

function getPart(partId = selectedPartId) {
  return state.parts[partId];
}

function sortedKeys(partId = selectedPartId) {
  return [...(getPart(partId)?.keys || [])].sort((a, b) => a.time - b.time);
}

function keyAtTime(time, partId = selectedPartId, tolerance = 0.0002) {
  return getPart(partId)?.keys.find((key) => Math.abs(key.time - time) <= tolerance) || null;
}

function interpolationAt(time, partId) {
  const keys = sortedKeys(partId);
  if (!keys.length) return 'catmullrom';
  let previous = keys[0];
  for (const key of keys) {
    if (key.time > time) break;
    previous = key;
  }
  return previous.interpolation || 'catmullrom';
}

function catmullValue(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function interpolateVector(a, b, t, mode, prev = null, next = null) {
  if (mode === 'step') return [...a];
  return a.map((value, axis) => {
    if (mode === 'catmullrom') {
      const p0 = prev?.[axis] ?? value;
      const p3 = next?.[axis] ?? b[axis];
      return round(catmullValue(p0, value, b[axis], p3, t));
    }
    return round(value + (b[axis] - value) * t);
  });
}

function samplePart(partId, time) {
  const keys = sortedKeys(partId);
  if (!keys.length) return { position: zeroVector(), rotation: zeroVector() };
  if (time <= keys[0].time) return { position: [...keys[0].position], rotation: [...keys[0].rotation] };
  if (time >= keys.at(-1).time) return { position: [...keys.at(-1).position], rotation: [...keys.at(-1).rotation] };
  let rightIndex = keys.findIndex((key) => key.time >= time);
  if (rightIndex <= 0) rightIndex = 1;
  const left = keys[rightIndex - 1];
  const right = keys[rightIndex];
  if (Math.abs(right.time - time) < 0.000001) return { position: [...right.position], rotation: [...right.rotation] };
  const fraction = (time - left.time) / Math.max(0.000001, right.time - left.time);
  const previous = keys[Math.max(0, rightIndex - 2)];
  const next = keys[Math.min(keys.length - 1, rightIndex + 1)];
  const mode = left.interpolation || 'catmullrom';
  return {
    position: interpolateVector(left.position, right.position, fraction, mode, previous.position, next.position),
    rotation: interpolateVector(left.rotation, right.rotation, fraction, mode, previous.rotation, next.rotation),
  };
}

function snapTime(time) {
  const bounded = clamp(Number(time) || 0, 0, state.duration);
  return round(snapEnabled ? Math.round(bounded * state.fps) / state.fps : bounded, 4);
}

function createKeyAt(partId, time) {
  const part = getPart(partId);
  const keyTime = snapTime(time);
  const found = keyAtTime(keyTime, partId);
  if (found) return found;
  const pose = samplePart(partId, keyTime);
  const key = makeKey(keyTime, pose, interpolationAt(keyTime, partId));
  part.keys.push(key);
  part.keys.sort((a, b) => a.time - b.time);
  return key;
}

function editableKey(partId = selectedPartId) {
  const exact = keyAtTime(currentTime, partId);
  if (exact) return exact;
  if (!state.autoKey) return null;
  const key = createKeyAt(partId, currentTime);
  currentTime = key.time;
  selectedKeyTime = key.time;
  return key;
}

function applyPose(time = currentTime) {
  if (!partObjects.torso) return;
  isApplyingPose = true;
  for (const part of PARTS) {
    const object = partObjects[part.id];
    if (!object) continue;
    const pose = samplePart(part.id, time);
    object.position.set(pose.position[0], pose.position[1], pose.position[2]);
    object.rotation.order = 'XYZ';
    object.rotation.set(
      THREE.MathUtils.degToRad(pose.rotation[0]),
      THREE.MathUtils.degToRad(pose.rotation[1]),
      THREE.MathUtils.degToRad(pose.rotation[2]),
      'XYZ',
    );
  }
  isApplyingPose = false;
  updateSelectionHelper();
}

function chooseExactKey() {
  return keyAtTime(currentTime, selectedPartId);
}

function updateControlAvailability() {
  const exact = Boolean(chooseExactKey());
  const canEdit = state.autoKey || exact;
  for (const input of fields) input.disabled = !canEdit;
  $('interpolation-select').disabled = !exact;
  $('delete-key').disabled = !exact;
  $('edit-hint').textContent = state.autoKey
    ? 'Edits add or update a key at playhead'
    : exact ? 'Auto key off · editing this key' : 'Add a keyframe to edit here';
  if (transformControls) transformControls.enabled = canEdit;
}

function updateKeyStatus() {
  const exact = chooseExactKey();
  selectedKeyTime = exact ? exact.time : null;
  $('key-status').textContent = exact
    ? `KEY AT ${formatSeconds(exact.time)}s`
    : `NO KEY AT ${formatSeconds(currentTime)}s`;
  $('add-key').disabled = Boolean(exact);
  $('add-key').title = exact ? 'There is already a keyframe at this time' : 'Add a keyframe for the selected part (K)';
  if (exact) $('interpolation-select').value = exact.interpolation;
  else $('interpolation-select').value = interpolationAt(currentTime, selectedPartId);
  updateControlAvailability();
  updateTimelineKeyHighlights();
}

function syncInspectorValues() {
  const part = PART_BY_ID[selectedPartId];
  if (!part) return;
  $('selected-part-name').textContent = part.name;
  $('selected-node-name').textContent = part.node;
  const pose = samplePart(selectedPartId, currentTime);
  for (const input of fields) {
    const channel = input.dataset.channel;
    const axis = Number(input.dataset.axis);
    if (document.activeElement !== input) input.value = formatInput(pose[channel][axis]);
  }
  $('auto-key-toggle').classList.toggle('is-on', state.autoKey);
  $('auto-key-toggle').setAttribute('aria-pressed', String(state.autoKey));
  $('auto-key-toggle').querySelector('.toggle-state').textContent = state.autoKey ? 'ON' : 'OFF';
  updateKeyStatus();
}

const PART_ICON = {
  torso: '<path d="M6.2 3.4 8 2.5h4l1.8.9 2.1 2.1-.8 3-1.8-.7V17H6.7V7.8l-1.8.7-.8-3z"/><path d="M8 2.8c.2 1.5.9 2.2 2 2.2s1.8-.7 2-2.2"/>',
  head: '<path d="M4.2 7.3A5.8 5.8 0 0 1 10 2.5a5.8 5.8 0 0 1 5.8 4.8V13H4.2z"/><path d="M7.2 9h.1m5.4 0h.1M8 11.5h4M5 6.8h10"/>',
  arm: '<path d="m6.5 3.3 2.4-1 2.4 1 1.9 2.1-.7 2.7-1.3-.4v7.1a2.2 2.2 0 0 1-4.4 0V7.7l-1.3.4-.7-2.7z"/><path d="M7.2 7.4h3.6"/>',
  leg: '<path d="M6.2 2.7h7.6v5.1l-.8 2.8.2 5.4a1.8 1.8 0 0 1-3.6 0l-.2-4.2-.2 4.2a1.8 1.8 0 0 1-3.6 0l.2-5.4-.8-2.8z"/><path d="M6.3 7.8h7.4"/>',
};

function renderParts() {
  const list = $('parts-list');
  list.replaceChildren();
  for (const part of PARTS) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `part-row${part.id === selectedPartId ? ' selected' : ''}`;
    row.dataset.part = part.id;
    row.setAttribute('aria-pressed', String(part.id === selectedPartId));
    row.innerHTML = `<span class="part-icon"><svg viewBox="0 0 20 20" aria-hidden="true">${PART_ICON[part.icon]}</svg></span><span class="part-label"><strong>${part.name}</strong><code>${part.node}</code></span><span class="part-key-count">${state.parts[part.id].keys.length}</span>`;
    row.addEventListener('click', () => selectPart(part.id));
    list.append(row);
  }
}

function selectPart(partId, { renderTimeline = true } = {}) {
  if (!PART_BY_ID[partId]) return;
  selectedPartId = partId;
  if (transformControls && partObjects[partId]) transformControls.attach(partObjects[partId]);
  applyPose(currentTime);
  renderParts();
  syncInspectorValues();
  if (renderTimeline) renderTimeline();
}

function updatePlayhead() {
  const line = $('playhead-line');
  if (line) line.style.left = `${timelineNameWidth + TIMELINE_PAD + currentTime * timelinePps}px`;
  const timeInput = $('current-time');
  if (timeInput && document.activeElement !== timeInput) timeInput.value = formatSeconds(currentTime);
  updateTimelineKeyHighlights();
}

function updateTimelineKeyHighlights() {
  const allKeys = document.querySelectorAll('.timeline-key');
  for (const marker of allKeys) {
    const samePart = marker.dataset.part === selectedPartId;
    const sameTime = Math.abs(Number(marker.dataset.time) - currentTime) <= 0.0005;
    marker.classList.toggle('is-current', samePart && sameTime);
  }
}

function updateTimeReadouts() {
  $('current-time').value = formatSeconds(currentTime);
  $('duration-input').value = formatSeconds(state.duration);
  $('duration-chip').textContent = `${formatSeconds(state.duration)}s`;
  $('timeline-foot-status').textContent = `${PARTS.length} Bloxd rig nodes · ${state.fps} fps`;
}

function setCurrentTime(time, { snap = true, updateFields = true } = {}) {
  let nextTime = clamp(Number(time) || 0, 0, state.duration);
  if (snap) nextTime = snapTime(nextTime);
  currentTime = round(nextTime, 4);
  applyPose(currentTime);
  updatePlayhead();
  if (updateFields && !isPlaying) syncInspectorValues();
  else updateKeyStatus();
  updateTimeReadouts();
}

function renderTimeline() {
  const scroll = $('timeline-scroll');
  const canvas = $('timeline-canvas');
  const ruler = $('timeline-ruler');
  const tracks = $('timeline-tracks');
  if (!scroll || !canvas || !ruler || !tracks) return;

  const scrollLeft = scroll.scrollLeft;
  const scrollTop = scroll.scrollTop;
  const nameWidth = window.innerWidth <= 700 ? 125 : NAME_WIDTH;
  timelineNameWidth = nameWidth;
  const available = Math.max(300, scroll.clientWidth - nameWidth - 18);
  const fitScale = Math.max(60, (available - 32 - TIMELINE_PAD) / Math.max(0.25, state.duration));
  timelinePps = clamp(fitScale * timelineZoom, 60, 1000);
  const timeWidth = Math.max(available, Math.ceil(state.duration * timelinePps + TIMELINE_PAD + 38));
  const fullWidth = nameWidth + timeWidth;
  canvas.style.setProperty('--name-width', `${nameWidth}px`);
  canvas.style.width = `${fullWidth}px`;
  ruler.style.width = `${timeWidth}px`;
  ruler.style.setProperty('--minor-step', `${Math.max(12, timelinePps / 4)}px`);
  ruler.style.backgroundPositionX = `${TIMELINE_PAD}px`;
  $('timeline-tracks').style.setProperty('--minor-step', `${Math.max(12, timelinePps / 4)}px`);

  const tickSteps = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10];
  const tickStep = tickSteps.find((step) => step * timelinePps >= 72) || 10;
  ruler.replaceChildren();
  for (let t = 0; t <= state.duration + 0.0001; t += tickStep) {
    const tick = document.createElement('div');
    tick.className = 'ruler-tick';
    tick.style.left = `${round(TIMELINE_PAD + t * timelinePps, 2)}px`;
    const label = document.createElement('span');
    label.textContent = formatSeconds(t);
    tick.append(label);
    ruler.append(tick);
  }
  if (Math.abs(Math.round(state.duration / tickStep) * tickStep - state.duration) > 0.01) {
    const endTick = document.createElement('div');
    endTick.className = 'ruler-tick';
    endTick.style.left = `${round(TIMELINE_PAD + state.duration * timelinePps, 2)}px`;
    const endLabel = document.createElement('span');
    endLabel.textContent = formatSeconds(state.duration);
    endTick.append(endLabel);
    ruler.append(endTick);
  }

  tracks.replaceChildren();
  for (const part of PARTS) {
    const row = document.createElement('div');
    row.className = `timeline-row${part.id === selectedPartId ? ' selected' : ''}`;
    row.dataset.part = part.id;
    const name = document.createElement('div');
    name.className = 'track-name';
    name.title = `${part.name} · ${part.node}`;
    name.innerHTML = `<span class="track-label"><i class="track-color" style="--track-color:${part.color}"></i><strong>${part.name}</strong><code>${state.parts[part.id].keys.length}</code></span>`;
    name.addEventListener('click', () => selectPart(part.id));
    const lane = document.createElement('div');
    lane.className = 'track-lane';
    lane.style.width = `${timeWidth}px`;
    lane.style.backgroundPositionX = `${TIMELINE_PAD}px`;
    lane.dataset.part = part.id;
    lane.addEventListener('pointerdown', (event) => beginScrub(event, lane, part.id));
    for (const key of sortedKeys(part.id)) {
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'timeline-key';
      marker.dataset.part = part.id;
      marker.dataset.time = String(key.time);
      marker.style.left = `${TIMELINE_PAD + key.time * timelinePps}px`;
      marker.title = `${part.name} · ${formatSeconds(key.time)}s · drag to retime`;
      marker.setAttribute('aria-label', `${part.name} keyframe at ${formatSeconds(key.time)} seconds`);
      marker.addEventListener('pointerdown', (event) => beginKeyDrag(event, part, key, marker));
      lane.append(marker);
    }
    row.append(name, lane);
    tracks.append(row);
  }
  $('zoom-label').textContent = `${Math.round(timelineZoom * 100)}%`;
  updatePlayhead();
  scroll.scrollLeft = scrollLeft;
  scroll.scrollTop = scrollTop;
}

function clientXToTime(clientX, element) {
  const bounds = element.getBoundingClientRect();
  return (clientX - bounds.left - TIMELINE_PAD) / timelinePps;
}

function beginScrub(event, element, partId = null) {
  if (event.button !== 0 || event.target.closest('.timeline-key')) return;
  event.preventDefault();
  setPlaying(false);
  if (partId) selectPart(partId, { renderTimeline: false });
  try { element.setPointerCapture(event.pointerId); } catch { /* capture is optional in older browsers */ }
  const move = (pointerEvent) => {
    setCurrentTime(clientXToTime(pointerEvent.clientX, element));
  };
  const finish = (pointerEvent) => {
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', finish);
    element.removeEventListener('pointercancel', finish);
    move(pointerEvent);
  };
  move(event);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);
}

function beginKeyDrag(event, part, key, marker) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  setPlaying(false);
  selectPart(part.id, { renderTimeline: false });
  const before = projectString();
  const originalX = event.clientX;
  const originalTime = key.time;
  let moved = false;
  try { marker.setPointerCapture(event.pointerId); } catch { /* pointer capture can be unavailable in embedded browsers */ }

  const move = (pointerEvent) => {
    const delta = pointerEvent.clientX - originalX;
    if (!moved && Math.abs(delta) < 3) return;
    moved = true;
    const lane = marker.parentElement;
    if (!lane) return;
    const raw = originalTime + delta / timelinePps;
    let next = snapTime(raw);
    const collision = part.keys.some((other) => other !== key && Math.abs(other.time - next) < 0.0002);
    if (collision) return;
    key.time = next;
    part.keys.sort((a, b) => a.time - b.time);
    selectedKeyTime = key.time;
    currentTime = key.time;
    marker.dataset.time = String(key.time);
    marker.style.left = `${TIMELINE_PAD + key.time * timelinePps}px`;
    marker.title = `${part.name} · ${formatSeconds(key.time)}s · drag to retime`;
    applyPose(currentTime);
    updatePlayhead();
    updateTimeReadouts();
    syncInspectorValues();
    renderParts();
  };
  const finish = (pointerEvent) => {
    marker.removeEventListener('pointermove', move);
    marker.removeEventListener('pointerup', finish);
    marker.removeEventListener('pointercancel', finish);
    if (!moved) {
      currentTime = key.time;
      selectedKeyTime = key.time;
      applyPose(currentTime);
      updatePlayhead();
      updateTimeReadouts();
      syncInspectorValues();
    } else {
      pushHistorySnapshot(before);
      persistProject();
    }
    renderParts();
    renderTimeline();
  };
  marker.addEventListener('pointermove', move);
  marker.addEventListener('pointerup', finish);
  marker.addEventListener('pointercancel', finish);
}

function addKeyframe(partId = selectedPartId, time = currentTime) {
  setPlaying(false);
  const keyTime = snapTime(time);
  const existing = keyAtTime(keyTime, partId);
  if (existing) {
    selectedPartId = partId;
    selectedKeyTime = existing.time;
    currentTime = existing.time;
    applyPose(currentTime);
    syncInspectorValues();
    updatePlayhead();
    showToast('A keyframe already exists here');
    return;
  }
  recordHistory();
  const key = createKeyAt(partId, keyTime);
  selectedPartId = partId;
  selectedKeyTime = key.time;
  currentTime = key.time;
  if (transformControls && partObjects[partId]) transformControls.attach(partObjects[partId]);
  applyPose(currentTime);
  renderParts();
  syncInspectorValues();
  renderTimeline();
  updateTimeReadouts();
  persistProject();
  showToast(`Keyframe added · ${formatSeconds(key.time)}s`);
}

function removeCurrentKey() {
  setPlaying(false);
  const key = chooseExactKey();
  if (!key) return;
  recordHistory();
  const keys = getPart().keys;
  const index = keys.indexOf(key);
  if (index >= 0) keys.splice(index, 1);
  selectedKeyTime = null;
  renderParts();
  syncInspectorValues();
  renderTimeline();
  persistProject();
  showToast('Keyframe removed');
}

function editTransformField(input) {
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  const channel = input.dataset.channel;
  const axis = Number(input.dataset.axis);
  const key = editableKey();
  if (!key) {
    applyPose(currentTime);
    syncInspectorValues();
    showToast('Add a keyframe first while Auto Key is off');
    return;
  }
  key[channel][axis] = round(value, 3);
  getPart().keys.sort((a, b) => a.time - b.time);
  selectedKeyTime = key.time;
  currentTime = key.time;
  applyPose(currentTime);
  updatePlayhead();
  updateTimeReadouts();
  updateKeyStatus();
  renderParts();
  renderTimeline();
  persistProject();
}

function setInterpolation(value) {
  const key = chooseExactKey();
  if (!key || !ALLOWED_INTERPOLATION.has(value)) return;
  recordHistory();
  key.interpolation = value;
  renderTimeline();
  persistProject();
  showToast(`${value === 'catmullrom' ? 'Catmull-Rom' : value[0].toUpperCase() + value.slice(1)} interpolation`);
}

function resetSelectedPart() {
  setPlaying(false);
  const part = getPart();
  const exact = keyAtTime(currentTime, selectedPartId);
  if (!exact && !state.autoKey) {
    showToast('Add a keyframe first while Auto Key is off');
    return;
  }
  recordHistory();
  const key = exact || createKeyAt(selectedPartId, currentTime);
  key.position = zeroVector();
  key.rotation = zeroVector();
  currentTime = key.time;
  selectedKeyTime = key.time;
  part.keys.sort((a, b) => a.time - b.time);
  applyPose(currentTime);
  renderParts();
  syncInspectorValues();
  renderTimeline();
  persistProject();
  showToast(`${PART_BY_ID[selectedPartId].name} reset at this frame`);
}

function toggleAutoKey() {
  recordHistory();
  state.autoKey = !state.autoKey;
  updateControlAvailability();
  syncInspectorValues();
  persistProject();
}

function setPlaying(next) {
  isPlaying = Boolean(next);
  $('play-button').classList.toggle('is-playing', isPlaying);
  $('play-button').setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  $('play-button').title = isPlaying ? 'Pause (Space)' : 'Play (Space)';
  if (isPlaying) {
    if (currentTime >= state.duration - 0.0001) setCurrentTime(0, { snap: false });
    lastPlayTimestamp = 0;
  } else {
    syncInspectorValues();
  }
}

function togglePlaying() {
  setPlaying(!isPlaying);
}

function setDuration(value) {
  if (!Number.isFinite(value)) {
    updateTimeReadouts();
    return;
  }
  const maxKeyTime = Math.max(0, ...PARTS.flatMap((part) => state.parts[part.id].keys.map((key) => key.time)));
  const duration = round(clamp(Math.max(value, maxKeyTime, 0.25), 0.25, 60), 3);
  if (Math.abs(duration - state.duration) < 0.0001) {
    updateTimeReadouts();
    return;
  }
  recordHistory();
  state.duration = duration;
  currentTime = clamp(currentTime, 0, state.duration);
  $('duration-input').value = formatSeconds(state.duration);
  updateTimeReadouts();
  applyPose(currentTime);
  renderTimeline();
  syncInspectorValues();
  persistProject();
}

function setLoop(value) {
  recordHistory();
  state.loop = value;
  const button = $('loop-toggle');
  button.classList.toggle('is-on', state.loop);
  button.setAttribute('aria-pressed', String(state.loop));
  persistProject();
}

function changeMode(mode) {
  if (!['translate', 'rotate'].includes(mode)) return;
  selectedMode = mode;
  transformControls?.setMode(mode);
  document.querySelectorAll('.mode-button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
}

function setCameraView(view) {
  if (!camera || !orbitControls) return;
  orbitControls.target.set(0, 1.23, 0);
  if (view === 'front') camera.position.set(0, 2.25, 6.6);
  else if (view === 'side') camera.position.set(6.6, 2.25, 0);
  else camera.position.set(4.4, 3.0, 5.5);
  camera.lookAt(orbitControls.target);
  orbitControls.update();
}

function numberForExport(value) {
  const n = round(Number(value) || 0, 4);
  return Object.is(n, -0) ? 0 : n;
}

function buildAnimationSchema() {
  const bones = {};
  for (const part of PARTS) {
    const keys = sortedKeys(part.id);
    if (!keys.length) continue;
    const bone = { position: {}, rotation: {} };
    for (const key of keys) {
      const time = String(numberForExport(key.time));
      const metadata = { lerp_mode: key.interpolation || 'catmullrom' };
      bone.position[time] = { post: key.position.map(numberForExport), ...metadata };
      bone.rotation[time] = { post: key.rotation.map(numberForExport), ...metadata };
    }
    bones[part.node] = bone;
  }
  return {
    animation_length: numberForExport(state.duration),
    loop: Boolean(state.loop),
    bones,
  };
}

function buildBloxdCode() {
  const animation = buildAnimationSchema();
  const name = state.name.replace(/[\r\n]+/g, ' ').replace(/\*\//g, '* /');
  return `// ${name} · generated animation\n// Replace myId with the entity ID you want to animate.\nconst animation = ${JSON.stringify(animation, null, 2)};\napi.animateEntity(myId, animation);`;
}

function openExport() {
  const code = buildBloxdCode();
  $('export-code').value = code;
  const boneCount = Object.keys(buildAnimationSchema().bones).length;
  $('export-summary').textContent = `${boneCount} bones · ${formatSeconds(state.duration)} seconds · ${state.loop ? 'looping' : 'one-shot'}`;
  $('export-modal').hidden = false;
  $('copy-code').focus();
}

function closeExport() {
  $('export-modal').hidden = true;
  $('export-button').focus();
}

function downloadFile(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function filenameBase() {
  return (state.name || 'bloxd-animation').trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'bloxd-animation';
}

function saveProjectFile() {
  downloadFile(`${filenameBase()}.bloxdanim.json`, 'application/json', JSON.stringify(projectData(), null, 2));
  showToast('Project file downloaded');
}

function setNewProject() {
  if (!window.confirm('Start a new animation? Your current project stays in browser autosave until you save or open another file.')) return;
  recordHistory();
  state = makeBlankProject();
  selectedPartId = 'rightArm';
  currentTime = 0;
  selectedKeyTime = null;
  setPlaying(false);
  renderAll();
  persistProject();
  showToast('New animation ready');
}

async function loadProjectFile(file) {
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    recordHistory();
    state = normalizeProject(raw);
    selectedPartId = 'rightArm';
    currentTime = 0;
    selectedKeyTime = null;
    setPlaying(false);
    renderAll();
    persistProject();
    showToast('Project loaded');
  } catch (error) {
    console.error(error);
    showToast('That project file could not be opened');
  }
  $('project-file-input').value = '';
}

function renderAll() {
  $('project-name').value = state.name;
  document.title = `${state.name} · Bloxd Motion Studio`;
  $('duration-input').value = formatSeconds(state.duration);
  $('fps-select').value = String(state.fps);
  $('loop-toggle').classList.toggle('is-on', state.loop);
  $('loop-toggle').setAttribute('aria-pressed', String(state.loop));
  $('auto-key-toggle').classList.toggle('is-on', state.autoKey);
  $('auto-key-toggle').setAttribute('aria-pressed', String(state.autoKey));
  $('auto-key-toggle').querySelector('.toggle-state').textContent = state.autoKey ? 'ON' : 'OFF';
  $('snap-toggle').classList.toggle('is-on', snapEnabled);
  $('snap-toggle').setAttribute('aria-pressed', String(snapEnabled));
  renderParts();
  if (transformControls && partObjects[selectedPartId]) transformControls.attach(partObjects[selectedPartId]);
  renderTimeline();
  applyPose(currentTime);
  syncInspectorValues();
  updateTimeReadouts();
  updateHistoryButtons();
}

// --- Three.js character preview ------------------------------------------------
function material(color, roughness = 0.82, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function makeMesh(partId, parent, size, position, mat, name) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = name || `${partId}-mesh`;
  mesh.userData.partId = partId;
  parent.add(mesh);
  partMeshes[partId].push(mesh);
  pickMeshes.push(mesh);
  return mesh;
}

function buildCharacter() {
  const avatarRoot = new THREE.Group();
  avatarRoot.name = 'Bob · default Bloxd rig';
  scene.add(avatarRoot);

  const torsoAnchor = new THREE.Group();
  torsoAnchor.position.set(0, 1.38, 0);
  torsoAnchor.name = 'TorsoNode anchor';
  avatarRoot.add(torsoAnchor);
  const torso = new THREE.Group();
  torso.name = 'TorsoNode motion';
  torsoAnchor.add(torso);
  partObjects.torso = torso;

  const headAnchor = new THREE.Group();
  headAnchor.position.set(0, 0.49, 0);
  torso.add(headAnchor);
  const head = new THREE.Group();
  head.name = 'HeadMesh motion';
  headAnchor.add(head);
  partObjects.head = head;

  const leftArmAnchor = new THREE.Group();
  leftArmAnchor.position.set(-0.49, 0.25, 0);
  torso.add(leftArmAnchor);
  const leftArm = new THREE.Group();
  leftArm.name = 'ArmLeftMesh motion';
  leftArmAnchor.add(leftArm);
  partObjects.leftArm = leftArm;

  const rightArmAnchor = new THREE.Group();
  rightArmAnchor.position.set(0.49, 0.25, 0);
  torso.add(rightArmAnchor);
  const rightArm = new THREE.Group();
  rightArm.name = 'ArmRightMesh motion';
  rightArmAnchor.add(rightArm);
  partObjects.rightArm = rightArm;

  const leftLegAnchor = new THREE.Group();
  leftLegAnchor.position.set(-0.19, -0.55, 0);
  torso.add(leftLegAnchor);
  const leftLeg = new THREE.Group();
  leftLeg.name = 'LegLeftMesh motion';
  leftLegAnchor.add(leftLeg);
  partObjects.leftLeg = leftLeg;

  const rightLegAnchor = new THREE.Group();
  rightLegAnchor.position.set(0.19, -0.55, 0);
  torso.add(rightLegAnchor);
  const rightLeg = new THREE.Group();
  rightLeg.name = 'LegRightMesh motion';
  rightLegAnchor.add(rightLeg);
  partObjects.rightLeg = rightLeg;

  const skin = material(0xdba274, 0.93);
  const skinLight = material(0xeab486, 0.93);
  const hair = material(0x4c2c20, 0.9);
  const hairLight = material(0x65402b, 0.9);
  const hairDark = material(0x382118, 0.93);
  const hoodie = material(0xb53f3a, 0.9);
  const hoodieLight = material(0xc34e47, 0.9);
  const hoodieDark = material(0x87332f, 0.94);
  const hoodieCord = material(0xe5d3b6, 0.94);
  const denim = material(0x3f6190, 0.95);
  const denimLight = material(0x5276a2, 0.94);
  const denimDark = material(0x2c466c, 0.96);
  const shoe = material(0x303642, 0.92);
  const shoeTop = material(0x464d59, 0.9);
  const eyeWhite = material(0xf7f4e9, 0.55);
  const iris = material(0x58a7db, 0.48, 0.03);
  const pupil = material(0x1c2c39, 0.42);
  const mouth = material(0x5d332b, 0.95);

  // TorsoNode: the hoodie, waist and the shared skeleton pivot.
  makeMesh('torso', torso, [0.73, 0.82, 0.4], [0, 0.015, 0], hoodie, 'Red hoodie');
  makeMesh('torso', torso, [0.53, 0.27, 0.25], [0, 0.355, -0.035], hoodieDark, 'Hood');
  makeMesh('torso', torso, [0.38, 0.16, 0.055], [0, -0.19, 0.222], hoodieDark, 'Hoodie pocket');
  makeMesh('torso', torso, [0.04, 0.07, 0.03], [-0.12, -0.19, 0.255], hoodieLight, 'Pocket seam left');
  makeMesh('torso', torso, [0.04, 0.07, 0.03], [0.12, -0.19, 0.255], hoodieLight, 'Pocket seam right');
  makeMesh('torso', torso, [0.022, 0.19, 0.025], [-0.065, 0.12, 0.212], hoodieCord, 'Drawstring left');
  makeMesh('torso', torso, [0.022, 0.16, 0.025], [0.065, 0.135, 0.212], hoodieCord, 'Drawstring right');
  makeMesh('torso', torso, [0.67, 0.16, 0.38], [0, -0.445, 0], denimDark, 'Jeans waist');
  makeMesh('torso', torso, [0.12, 0.07, 0.025], [0, -0.445, 0.205], material(0x9d8060, 0.9), 'Belt buckle');
  makeMesh('torso', torso, [0.18, 0.22, 0.2], [0, 0.47, 0], skin, 'Neck');

  // HeadMesh: square brown hair, warm skin, blue eyes and small details.
  makeMesh('head', head, [0.58, 0.56, 0.5], [0, 0.27, 0], skin, 'Bob head');
  makeMesh('head', head, [0.61, 0.15, 0.54], [0, 0.59, -0.005], hair, 'Hair cap');
  makeMesh('head', head, [0.61, 0.14, 0.18], [0, 0.52, 0.19], hairLight, 'Front fringe');
  makeMesh('head', head, [0.12, 0.29, 0.47], [-0.255, 0.35, -0.005], hair, 'Left side hair');
  makeMesh('head', head, [0.12, 0.29, 0.47], [0.255, 0.35, -0.005], hairDark, 'Right side hair');
  makeMesh('head', head, [0.16, 0.05, 0.15], [-0.14, 0.515, 0.21], hairLight, 'Side swept lock');
  for (const x of [-0.135, 0.135]) {
    makeMesh('head', head, [0.115, 0.095, 0.025], [x, 0.315, 0.255], eyeWhite, 'Eye white');
    makeMesh('head', head, [0.062, 0.075, 0.017], [x, 0.315, 0.272], iris, 'Blue eye');
    makeMesh('head', head, [0.031, 0.05, 0.012], [x + 0.006, 0.315, 0.283], pupil, 'Pupil');
    makeMesh('head', head, [0.14, 0.027, 0.025], [x, 0.405, 0.26], hairDark, 'Eyebrow');
  }
  makeMesh('head', head, [0.075, 0.095, 0.065], [0, 0.23, 0.27], skinLight, 'Nose');
  makeMesh('head', head, [0.13, 0.022, 0.02], [0, 0.135, 0.257], mouth, 'Smile');

  // Arms are single Bloxd mesh nodes, with the hand included in the same joint.
  for (const [id, group] of [['leftArm', leftArm], ['rightArm', rightArm]]) {
    const sleeve = id === 'leftArm' ? hoodie : hoodieLight;
    makeMesh(id, group, [0.29, 0.56, 0.34], [0, -0.285, 0], sleeve, `${id} sleeve`);
    makeMesh(id, group, [0.30, 0.1, 0.35], [0, -0.54, 0], hoodieDark, `${id} cuff`);
    makeMesh(id, group, [0.235, 0.19, 0.27], [0, -0.675, 0.005], skin, `${id} hand`);
    makeMesh(id, group, [0.18, 0.035, 0.22], [0, -0.62, 0.01], skinLight, `${id} wrist`);
  }

  // LegLeftMesh and LegRightMesh include trousers and shoes.
  for (const [id, group] of [['leftLeg', leftLeg], ['rightLeg', rightLeg]]) {
    makeMesh(id, group, [0.31, 0.66, 0.35], [0, -0.32, 0], id === 'leftLeg' ? denim : denimLight, `${id} jeans`);
    makeMesh(id, group, [0.31, 0.075, 0.36], [0, -0.605, 0], denimDark, `${id} hem`);
    makeMesh(id, group, [0.35, 0.18, 0.43], [0, -0.715, 0.035], shoe, `${id} shoe`);
    makeMesh(id, group, [0.31, 0.045, 0.39], [0, -0.785, 0.05], shoeTop, `${id} sole`);
    makeMesh(id, group, [0.16, 0.026, 0.012], [0, -0.695, 0.254], denimDark, `${id} seam`);
  }

  return avatarRoot;
}

function updateSelectionHelper() {
  if (!selectionHelper || !partMeshes[selectedPartId]) return;
  const bounds = new THREE.Box3();
  bounds.makeEmpty();
  for (const mesh of partMeshes[selectedPartId]) {
    if (!mesh.visible) continue;
    mesh.updateWorldMatrix(true, false);
    bounds.expandByObject(mesh);
  }
  if (bounds.isEmpty()) {
    selectionHelper.visible = false;
    return;
  }
  bounds.expandByScalar(0.018);
  selectionHelper.box.copy(bounds);
  selectionHelper.visible = true;
  selectionHelper.updateMatrixWorld(true);
}

function writeObjectTransform() {
  if (isApplyingPose) return false;
  const object = partObjects[selectedPartId];
  if (!object) return false;
  const key = editableKey(selectedPartId);
  if (!key) return false;
  key.position = object.position.toArray().slice(0, 3).map((value) => round(value, 3));
  key.rotation = [object.rotation.x, object.rotation.y, object.rotation.z].map((value) => round(THREE.MathUtils.radToDeg(value), 2));
  selectedKeyTime = key.time;
  currentTime = key.time;
  updatePlayhead();
  updateTimeReadouts();
  updateKeyStatus();
  syncInspectorValues();
  return true;
}

function finishObjectTransform() {
  const part = getPart();
  part.keys.sort((a, b) => a.time - b.time);
  renderParts();
  syncInspectorValues();
  renderTimeline();
  persistProject();
}

function initScene() {
  const canvas = $('viewport');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x131b24);
  scene.fog = new THREE.Fog(0x131b24, 8.5, 18);

  camera = new THREE.PerspectiveCamera(33, 1, 0.1, 70);
  camera.position.set(4.4, 3, 5.5);
  camera.lookAt(0, 1.23, 0);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene.add(new THREE.HemisphereLight(0xc9ddf0, 0x27272c, 1.6));
  const keyLight = new THREE.DirectionalLight(0xffe3c3, 3.2);
  keyLight.position.set(-3.5, 6.5, 4.5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -4;
  keyLight.shadow.camera.right = 4;
  keyLight.shadow.camera.top = 5;
  keyLight.shadow.camera.bottom = -2;
  keyLight.shadow.bias = -0.00045;
  scene.add(keyLight);
  const fill = new THREE.DirectionalLight(0x82b9e9, 1.25);
  fill.position.set(4, 3, -3.5);
  scene.add(fill);
  const faceFill = new THREE.PointLight(0xbbe8dc, 0.5, 8);
  faceFill.position.set(0, 2.2, 3.5);
  scene.add(faceFill);

  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x1a2027, roughness: 0.96, metalness: 0.02 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.015;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(14, 28, 0x64756f, 0x46545a);
  grid.position.y = 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.28;
  grid.material.depthWrite = false;
  scene.add(grid);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.08, 1.105, 64),
    new THREE.MeshBasicMaterial({ color: 0x72bfa7, transparent: true, opacity: 0.21, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.004;
  scene.add(ring);

  buildCharacter();
  selectionHelper = new THREE.Box3Helper(new THREE.Box3(), 0xb9f36b);
  selectionHelper.material.transparent = true;
  selectionHelper.material.opacity = 0.92;
  scene.add(selectionHelper);

  orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.075;
  orbitControls.target.set(0, 1.23, 0);
  orbitControls.minDistance = 3.1;
  orbitControls.maxDistance = 9.5;
  orbitControls.maxPolarAngle = Math.PI * 0.49;
  orbitControls.update();

  transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.setMode(selectedMode);
  transformControls.setSpace('local');
  transformControls.setSize(0.72);
  transformControls.setTranslationSnap(snapEnabled ? 0.05 : null);
  transformControls.setRotationSnap(snapEnabled ? THREE.MathUtils.degToRad(5) : null);
  transformControls.addEventListener('dragging-changed', (event) => {
    orbitControls.enabled = !event.value;
    if (event.value) {
      setPlaying(false);
      recordHistory();
    } else {
      finishObjectTransform();
    }
  });
  transformControls.addEventListener('objectChange', () => {
    if (isApplyingPose) return;
    if (!writeObjectTransform()) {
      applyPose(currentTime);
      showToast('Turn on Auto Key or add a keyframe to pose here');
    }
  });
  scene.add(transformControls.getHelper());
  transformControls.attach(partObjects[selectedPartId]);

  let downPoint = null;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    downPoint = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!downPoint || transformControls.dragging) return;
    const distance = Math.hypot(event.clientX - downPoint.x, event.clientY - downPoint.y);
    downPoint = null;
    if (distance > 5) return;
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickMeshes, false).find((item) => item.object.userData.partId);
    if (hit) selectPart(hit.object.userData.partId);
  });
  canvas.addEventListener('pointercancel', () => { downPoint = null; });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  const stage = $('stage');
  const resize = () => {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
  } else {
    window.addEventListener('resize', resize);
  }
  resize();

  const tick = (timestamp) => {
    renderRequest = window.requestAnimationFrame(tick);
    if (isPlaying) {
      if (!lastPlayTimestamp) lastPlayTimestamp = timestamp;
      const delta = clamp((timestamp - lastPlayTimestamp) / 1000, 0, 0.1);
      lastPlayTimestamp = timestamp;
      let nextTime = currentTime + delta;
      let stopAtEnd = false;
      if (nextTime >= state.duration) {
        if (state.loop) nextTime %= state.duration;
        else {
          nextTime = state.duration;
          stopAtEnd = true;
        }
      }
      currentTime = nextTime;
      applyPose(currentTime);
      updatePlayhead();
      updateTimeReadouts();
      if (stopAtEnd) setPlaying(false);
    }
    orbitControls.update();
    updateSelectionHelper();
    renderer.render(scene, camera);
  };
  renderRequest = window.requestAnimationFrame(tick);
}

function setupEvents() {
  $('project-name').addEventListener('focus', recordHistory);
  $('project-name').addEventListener('input', (event) => {
    state.name = String(event.target.value).slice(0, 48);
    document.title = `${safeProjectName(state.name)} · Bloxd Motion Studio`;
    persistProject();
  });
  $('project-name').addEventListener('blur', (event) => {
    state.name = safeProjectName(event.target.value);
    event.target.value = state.name;
    persistProject();
  });
  $('undo-button').addEventListener('click', undo);
  $('redo-button').addEventListener('click', redo);
  $('new-project').addEventListener('click', setNewProject);
  $('open-project').addEventListener('click', () => $('project-file-input').click());
  $('project-file-input').addEventListener('change', (event) => loadProjectFile(event.target.files?.[0]));
  $('save-project').addEventListener('click', saveProjectFile);
  $('export-button').addEventListener('click', openExport);
  $('close-export').addEventListener('click', closeExport);
  $('export-modal').addEventListener('pointerdown', (event) => { if (event.target === $('export-modal')) closeExport(); });
  $('copy-code').addEventListener('click', async () => {
    const button = $('copy-code');
    try {
      await navigator.clipboard.writeText($('export-code').value);
    } catch {
      $('export-code').focus();
      $('export-code').select();
      document.execCommand('copy');
    }
    button.querySelector('span').textContent = 'Copied';
    showToast('Bloxd code copied to clipboard');
    window.setTimeout(() => { button.querySelector('span').textContent = 'Copy code'; }, 1500);
  });
  $('download-code').addEventListener('click', () => downloadFile(`${filenameBase()}.js`, 'text/javascript', buildBloxdCode()));

  fields.forEach((input) => {
    input.addEventListener('focus', () => {
      activeNumberEdit = true;
      setPlaying(false);
      recordHistory();
    });
    input.addEventListener('input', () => editTransformField(input));
    input.addEventListener('blur', () => { activeNumberEdit = false; syncInspectorValues(); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const step = Number(input.step) || 1;
        input.value = String(Number(input.value || 0) + (event.key === 'ArrowUp' ? step : -step));
        editTransformField(input);
      }
    });
  });

  $('add-key').addEventListener('click', () => addKeyframe());
  $('delete-key').addEventListener('click', removeCurrentKey);
  $('reset-part').addEventListener('click', resetSelectedPart);
  $('auto-key-toggle').addEventListener('click', toggleAutoKey);
  $('interpolation-select').addEventListener('focus', recordHistory);
  $('interpolation-select').addEventListener('change', (event) => setInterpolation(event.target.value));
  document.querySelectorAll('.mode-button').forEach((button) => button.addEventListener('click', () => changeMode(button.dataset.mode)));
  $('front-view').addEventListener('click', () => setCameraView('front'));
  $('side-view').addEventListener('click', () => setCameraView('side'));
  $('reset-view').addEventListener('click', () => setCameraView('reset'));

  $('to-start').addEventListener('click', () => { setPlaying(false); setCurrentTime(0, { snap: false }); });
  $('step-back').addEventListener('click', () => { setPlaying(false); setCurrentTime(currentTime - 1 / state.fps); });
  $('play-button').addEventListener('click', togglePlaying);
  $('step-forward').addEventListener('click', () => { setPlaying(false); setCurrentTime(currentTime + 1 / state.fps); });
  $('to-end').addEventListener('click', () => { setPlaying(false); setCurrentTime(state.duration, { snap: false }); });
  $('current-time').addEventListener('focus', () => setPlaying(false));
  $('current-time').addEventListener('change', (event) => {
    const next = Number(event.target.value);
    if (Number.isFinite(next)) setCurrentTime(next);
    updateTimeReadouts();
  });
  $('current-time').addEventListener('keydown', (event) => { if (event.key === 'Enter') event.target.blur(); });
  $('duration-input').addEventListener('focus', () => { setPlaying(false); recordHistory(); });
  $('duration-input').addEventListener('change', (event) => {
    setDuration(Number(event.target.value));
    event.target.blur();
  });
  $('fps-select').addEventListener('focus', recordHistory);
  $('fps-select').addEventListener('change', (event) => {
    state.fps = Number(event.target.value);
    $('current-time').step = String(1 / state.fps);
    renderTimeline();
    updateTimeReadouts();
    persistProject();
  });
  $('loop-toggle').addEventListener('click', () => setLoop(!state.loop));
  $('snap-toggle').addEventListener('click', () => {
    snapEnabled = !snapEnabled;
    $('snap-toggle').classList.toggle('is-on', snapEnabled);
    $('snap-toggle').setAttribute('aria-pressed', String(snapEnabled));
    transformControls?.setTranslationSnap(snapEnabled ? 0.05 : null);
    transformControls?.setRotationSnap(snapEnabled ? THREE.MathUtils.degToRad(5) : null);
  });
  $('zoom-out').addEventListener('click', () => {
    timelineZoom = clamp(timelineZoom / 1.25, 0.55, 3);
    renderTimeline();
  });
  $('zoom-in').addEventListener('click', () => {
    timelineZoom = clamp(timelineZoom * 1.25, 0.55, 3);
    renderTimeline();
  });
  $('timeline-ruler').addEventListener('pointerdown', (event) => beginScrub(event, $('timeline-ruler')));
  $('playhead-grip').addEventListener('pointerdown', (event) => beginScrub(event, $('timeline-ruler')));

  window.addEventListener('keydown', (event) => {
    const modalOpen = !$('export-modal').hidden;
    if (modalOpen && event.key === 'Escape') { closeExport(); return; }
    const target = event.target;
    const typing = target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !typing) {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (typing || modalOpen || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === 'Space') { event.preventDefault(); togglePlaying(); }
    else if (event.key.toLowerCase() === 'k') { event.preventDefault(); addKeyframe(); }
    else if (event.key.toLowerCase() === 'w') changeMode('translate');
    else if (event.key.toLowerCase() === 'e') changeMode('rotate');
    else if (event.key === 'ArrowLeft') { event.preventDefault(); setPlaying(false); setCurrentTime(currentTime - 1 / state.fps); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); setPlaying(false); setCurrentTime(currentTime + 1 / state.fps); }
    else if (event.key === 'Delete' || event.key === 'Backspace') removeCurrentKey();
  });

  if ('ResizeObserver' in window) {
    timelineResizeObserver = new ResizeObserver(() => renderTimeline());
    timelineResizeObserver.observe($('timeline-scroll'));
  } else {
    window.addEventListener('resize', renderTimeline);
  }
}

function init() {
  setupEvents();
  try {
    initScene();
  } catch (error) {
    console.error('3D preview could not be initialized.', error);
    const stage = $('stage');
    const message = document.createElement('div');
    message.className = 'webgl-error';
    message.innerHTML = '<strong>3D preview unavailable</strong><span>Try a browser with WebGL enabled. The animation editor and export still work.</span>';
    stage.append(message);
  }
  $('current-time').step = String(1 / state.fps);
  renderAll();
  persistProject();
}

init();

import { createFirebaseBridge } from "./firebase-client.js";

const canvas = document.querySelector("#gameCanvas");
const ctx = canvas.getContext("2d");

const els = {
  startOverlay: document.querySelector("#startOverlay"),
  nicknameInput: document.querySelector("#nicknameInput"),
  startError: document.querySelector("#startError"),
  startSoloButton: document.querySelector("#startSoloButton"),
  startCreateRoomButton: document.querySelector("#startCreateRoomButton"),
  startJoinRoomButton: document.querySelector("#startJoinRoomButton"),
  startRoomCodeInput: document.querySelector("#startRoomCodeInput"),
  startOnlineStatus: document.querySelector("#startOnlineStatus"),
  modeLabel: document.querySelector("#modeLabel"),
  modeDescription: document.querySelector("#modeDescription"),
  myNameLabel: document.querySelector("#myNameLabel"),
  opponentNameLabel: document.querySelector("#opponentNameLabel"),
  currentPlayerBadge: document.querySelector("#currentPlayerBadge"),
  currentPlayerName: document.querySelector("#currentPlayerName"),
  timerText: document.querySelector("#timerText"),
  timerBar: document.querySelector("#timerBar"),
  statusText: document.querySelector("#statusText"),
  playerOneName: document.querySelector("#playerOneName"),
  playerTwoName: document.querySelector("#playerTwoName"),
  playerOneCount: document.querySelector("#playerOneCount"),
  playerTwoCount: document.querySelector("#playerTwoCount"),
  stoneCount: document.querySelector("#stoneCount"),
  newGameButton: document.querySelector("#newGameButton"),
  passButton: document.querySelector("#passButton"),
  winnerOverlay: document.querySelector("#winnerOverlay"),
  winnerTitle: document.querySelector("#winnerTitle"),
  winnerMessage: document.querySelector("#winnerMessage"),
  playAgainButton: document.querySelector("#playAgainButton"),
  onlineStatus: document.querySelector("#onlineStatus"),
  roomCodeInput: document.querySelector("#roomCodeInput"),
  createRoomButton: document.querySelector("#createRoomButton"),
  joinRoomButton: document.querySelector("#joinRoomButton"),
};

const BOARD_LINES = 19;
const MAX_TURN_MS = 20_000;
const STONE_RADIUS = 0.38;
const MAX_PULL = 2.9;
const SHOT_POWER = 10.8;
const STOP_SPEED = 0.045;
const FRICTION = 2.05;
const OUT_PADDING = 0.62;
const SOLO_OPPONENT = "연습 상대";
const WAITING_OPPONENT = "상대 대기 중";
const NICKNAME_KEY = "alkkagi.nickname";
const STAR_POINTS = [
  [3, 3],
  [9, 3],
  [15, 3],
  [3, 9],
  [9, 9],
  [15, 9],
  [3, 15],
  [9, 15],
  [15, 15],
];

let view = {
  size: 0,
  dpr: 1,
  margin: 0,
  cell: 1,
};

let appMode = "setup";
let localName = "";
let state = createInitialState(5, ["나", SOLO_OPPONENT]);
let drag = null;
let lastFrame = performance.now();
let motionSettledAt = null;
let firebaseBridge = null;
let audioContext = null;
let soundSerial = 0;
let lastPlayedSoundEventId = "";
const lastSoundAt = {
  shoot: 0,
  collision: 0,
  death: 0,
};

function createInitialState(count, players = [localName || "나", SOLO_OPPONENT], message) {
  return {
    players: normalizePlayers(players),
    currentPlayer: 0,
    turnStartedAt: gameNow(),
    shotActive: false,
    shotOwner: null,
    soundEvent: null,
    gameOver: false,
    winner: null,
    message: message || "자신의 돌을 뒤로 당겼다가 놓으세요.",
    stones: makeStones(count),
  };
}

function makeStones(count) {
  const rows = [2.7, 4.0, 5.3];
  const patterns = {
    3: [
      [8, rows[0]],
      [10, rows[0]],
      [9, rows[1]],
    ],
    5: [
      [7, rows[0]],
      [9, rows[0]],
      [11, rows[0]],
      [8, rows[1]],
      [10, rows[1]],
    ],
    7: [
      [6, rows[0]],
      [8, rows[0]],
      [10, rows[0]],
      [12, rows[0]],
      [7, rows[1]],
      [9, rows[1]],
      [11, rows[1]],
    ],
    9: [
      [5, rows[0]],
      [7, rows[0]],
      [9, rows[0]],
      [11, rows[0]],
      [13, rows[0]],
      [6, rows[1]],
      [8, rows[1]],
      [10, rows[1]],
      [12, rows[1]],
    ],
  };
  const top = patterns[count] || patterns[5];
  const stones = [];

  top.forEach(([x, y], index) => {
    stones.push(makeStone(`black-${index}`, 0, x, y));
    stones.push(makeStone(`white-${index}`, 1, x, 18 - y));
  });

  return stones;
}

function makeStone(id, owner, x, y) {
  return {
    id,
    owner,
    x,
    y,
    vx: 0,
    vy: 0,
    alive: true,
  };
}

function normalizePlayers(players) {
  return [
    players?.[0] || players?.["0"] || "흑",
    players?.[1] || players?.["1"] || SOLO_OPPONENT,
  ];
}

function normalizeStones(stones) {
  if (Array.isArray(stones)) {
    return stones;
  }

  return Object.keys(stones || {})
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => stones[key]);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const size = Math.max(320, Math.min(rect.width, rect.height));
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  view = {
    size,
    dpr,
    margin: size * 0.085,
    cell: (size - size * 0.17) / (BOARD_LINES - 1),
  };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function boardToCanvas(point) {
  return {
    x: view.margin + point.x * view.cell,
    y: view.margin + point.y * view.cell,
  };
}

function canvasToBoard(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left - view.margin) / view.cell,
    y: (clientY - rect.top - view.margin) / view.cell,
  };
}

function playerName(index) {
  return state.players[index] || (index === 0 ? "흑" : "백");
}

function localSlot() {
  return appMode === "online" ? firebaseBridge?.playerSlot ?? null : 0;
}

function opponentName() {
  if (appMode === "online") {
    const slot = localSlot();
    if (slot === 0) {
      return playerName(1);
    }
    if (slot === 1) {
      return playerName(0);
    }
  }

  return playerName(1);
}

function aliveStones(owner) {
  return state.stones.filter((stone) => stone.alive && stone.owner === owner);
}

function isMoving() {
  return state.stones.some((stone) => stone.alive && Math.hypot(stone.vx, stone.vy) > STOP_SPEED);
}

function onlineReady() {
  return appMode === "online" && state.players[0] && state.players[1] && state.players[1] !== WAITING_OPPONENT;
}

function gameActive() {
  return appMode === "solo" || onlineReady();
}

function canControlCurrentTurn() {
  if (state.gameOver || !gameActive()) {
    return false;
  }

  return appMode !== "online" || firebaseBridge?.isLocalTurn(state.currentPlayer);
}

function gameNow() {
  return appMode === "online" && firebaseBridge?.now ? firebaseBridge.now() : Date.now();
}

function activeShotOwner() {
  return typeof state.shotOwner === "number" ? state.shotOwner : state.currentPlayer;
}

function ownsActiveShot() {
  if (!state.shotActive) {
    return false;
  }
  if (appMode !== "online") {
    return true;
  }
  return firebaseBridge?.isLocalTurn(activeShotOwner());
}

function canStartNewGame() {
  return appMode === "solo" || (appMode === "online" && firebaseBridge?.playerSlot === 0);
}

function syncState(force = false) {
  if (appMode === "online") {
    firebaseBridge?.publish(force);
  }
}

function serializeState() {
  return JSON.parse(JSON.stringify(state));
}

function applyRemoteState(remoteState) {
  const previousSoundEventId = state.soundEvent?.id || "";
  const cleaned = JSON.parse(JSON.stringify(remoteState));
  delete cleaned.updatedBy;
  delete cleaned.updatedAt;
  cleaned.players = normalizePlayers(cleaned.players);
  cleaned.stones = normalizeStones(cleaned.stones);
  cleaned.winner = cleaned.winner ?? null;
  cleaned.shotActive = cleaned.shotActive === true;
  cleaned.shotOwner = typeof cleaned.shotOwner === "number" ? cleaned.shotOwner : null;
  cleaned.soundEvent = cleaned.soundEvent || null;
  cleaned.gameOver = cleaned.gameOver === true;
  state = cleaned;
  drag = null;
  if (state.soundEvent?.id && state.soundEvent.id !== previousSoundEventId) {
    playSoundEvent(state.soundEvent);
  }
  updateHud();
  showWinnerIfNeeded();
}

function ensureAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextClass();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  return audioContext;
}

function playTone({ frequency, endFrequency, duration, type = "sine", gain = 0.18 }) {
  const audio = ensureAudio();
  if (!audio) {
    return;
  }

  const now = audio.currentTime;
  const oscillator = audio.createOscillator();
  const volume = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  if (endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
  }
  volume.gain.setValueAtTime(0.0001, now);
  volume.gain.exponentialRampToValueAtTime(gain, now + 0.012);
  volume.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(volume);
  volume.connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

function playNoise({ duration, gain = 0.12, filterFrequency = 1200 }) {
  const audio = ensureAudio();
  if (!audio) {
    return;
  }

  const sampleRate = audio.sampleRate;
  const buffer = audio.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }

  const now = audio.currentTime;
  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const volume = audio.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(filterFrequency, now);
  volume.gain.setValueAtTime(gain, now);
  volume.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter);
  filter.connect(volume);
  volume.connect(audio.destination);
  source.start(now);
  source.stop(now + duration);
}

function playSound(type, strength = 1) {
  const clamped = Math.max(0.2, Math.min(2.2, strength));
  if (type === "shoot") {
    playNoise({ duration: 0.16, gain: 0.08 * clamped, filterFrequency: 780 });
    playTone({ frequency: 180, endFrequency: 90, duration: 0.14, type: "triangle", gain: 0.12 * clamped });
  } else if (type === "collision") {
    playTone({ frequency: 560, endFrequency: 240, duration: 0.075, type: "square", gain: 0.08 * clamped });
    playNoise({ duration: 0.055, gain: 0.055 * clamped, filterFrequency: 2400 });
  } else if (type === "death") {
    playTone({ frequency: 220, endFrequency: 58, duration: 0.24, type: "sawtooth", gain: 0.12 * clamped });
    playNoise({ duration: 0.2, gain: 0.09 * clamped, filterFrequency: 520 });
  }
}

function playSoundEvent(event) {
  if (!event?.id || event.id === lastPlayedSoundEventId) {
    return;
  }
  lastPlayedSoundEventId = event.id;
  playSound(event.type, event.strength);
}

function emitSound(type, strength = 1, { sync = true, throttleMs = 0 } = {}) {
  const now = performance.now();
  if (throttleMs && now - lastSoundAt[type] < throttleMs) {
    return;
  }
  lastSoundAt[type] = now;

  const event = {
    id: `${Date.now()}-${soundSerial++}`,
    type,
    strength: Number(Math.max(0.2, Math.min(2.2, strength)).toFixed(2)),
  };

  state.soundEvent = event;
  playSoundEvent(event);
  if (sync) {
    syncState(true);
  }
}

function sanitizeNickname(value) {
  return value.trim().replace(/\s+/g, " ").slice(0, 12);
}

function requireNickname() {
  const name = sanitizeNickname(els.nicknameInput.value);
  if (!name) {
    setStartError("닉네임을 먼저 입력하세요.");
    els.nicknameInput.focus();
    return "";
  }

  localName = name;
  localStorage.setItem(NICKNAME_KEY, name);
  ensureAudio();
  setStartError("");
  return name;
}

function setStartError(message) {
  els.startError.textContent = message;
}

function cleanRoomCode(value) {
  return value.replace(/\D/g, "").slice(0, 6);
}

function syncRoomInputs(source) {
  const value = cleanRoomCode(source.value);
  source.value = value;
  if (source !== els.roomCodeInput) {
    els.roomCodeInput.value = value;
  }
  if (source !== els.startRoomCodeInput) {
    els.startRoomCodeInput.value = value;
  }
  return value;
}

function hideStartOverlay() {
  els.startOverlay.classList.add("hidden");
}

function startSolo() {
  const name = requireNickname();
  if (!name) {
    return;
  }

  firebaseBridge?.leaveRoom();
  appMode = "solo";
  state = createInitialState(Number(els.stoneCount.value), [name, SOLO_OPPONENT], "혼자 하기 모드입니다. 양쪽 돌을 모두 직접 조작할 수 있습니다.");
  drag = null;
  motionSettledAt = null;
  els.winnerOverlay.classList.add("hidden");
  hideStartOverlay();
  updateHud();
}

async function createOnlineRoom() {
  const name = requireNickname();
  if (!name || !firebaseBridge?.ready) {
    setStartError("Firebase 연결을 확인한 뒤 다시 시도하세요.");
    return;
  }

  const previousMode = appMode;
  const previousState = JSON.parse(JSON.stringify(state));
  state = createInitialState(
    Number(els.stoneCount.value),
    [name, WAITING_OPPONENT],
    "방을 만들었습니다. 친구가 입장하면 흑 차례로 시작합니다.",
  );

  try {
    const room = await firebaseBridge.createRoom();
    appMode = "online";
    els.roomCodeInput.value = room.roomCode;
    els.startRoomCodeInput.value = room.roomCode;
    hideStartOverlay();
    updateOnlineStatus(`방 ${room.roomCode} 생성됨 · 친구에게 숫자 6자리를 알려주세요.`);
    updateHud();
  } catch (error) {
    appMode = previousMode;
    state = previousState;
    setStartError(error.message);
    updateOnlineStatus(error.message);
    updateHud();
  }
}

async function joinOnlineRoom(input) {
  const name = requireNickname();
  const code = cleanRoomCode(input.value);
  input.value = code;
  els.roomCodeInput.value = code;
  els.startRoomCodeInput.value = code;

  if (!name) {
    return;
  }
  if (!firebaseBridge?.ready) {
    setStartError("Firebase 연결을 확인한 뒤 다시 시도하세요.");
    return;
  }
  if (code.length !== 6) {
    setStartError("방 코드는 숫자 6자리입니다.");
    return;
  }

  try {
    await firebaseBridge.joinRoom(code, { playerName: name });
    appMode = "online";
    hideStartOverlay();
    updateOnlineStatus(`방 ${code} 입장됨 · 백으로 참가 중입니다.`);
    updateHud();
  } catch (error) {
    setStartError(error.message);
    updateOnlineStatus(error.message);
  }
}

function newGame(sync = true) {
  if (!canStartNewGame()) {
    return;
  }

  const players =
    appMode === "online" ? [playerName(0), onlineReady() ? playerName(1) : WAITING_OPPONENT] : [localName, SOLO_OPPONENT];
  state = createInitialState(Number(els.stoneCount.value), players);
  drag = null;
  motionSettledAt = null;
  els.winnerOverlay.classList.add("hidden");
  updateHud();
  if (sync) {
    syncState(true);
  }
}

function passTurn(reason = "턴이 넘어왔습니다.") {
  if (state.gameOver || isMoving() || !canControlCurrentTurn()) {
    return;
  }
  state.currentPlayer = 1 - state.currentPlayer;
  state.turnStartedAt = gameNow();
  state.shotActive = false;
  state.shotOwner = null;
  state.message = reason;
  drag = null;
  updateHud();
  syncState(true);
}

function endTurnAfterMotion() {
  if (state.gameOver) {
    return;
  }
  state.currentPlayer = 1 - state.currentPlayer;
  state.turnStartedAt = gameNow();
  state.shotActive = false;
  state.shotOwner = null;
  state.message = "자신의 돌을 뒤로 당겼다가 놓으세요.";
  updateHud();
  syncState(true);
}

function updateOnlineStatus(message) {
  els.onlineStatus.textContent = message;
  els.startOnlineStatus.textContent = message;
}

function updateHud() {
  const current = state.currentPlayer;
  const playerSlot = localSlot();
  const roomCode = firebaseBridge?.roomCode || "";
  const waitingOnline = appMode === "online" && !onlineReady();

  els.currentPlayerName.textContent = playerName(current);
  els.currentPlayerBadge.textContent = current === 0 ? "흑" : "백";
  els.currentPlayerBadge.classList.toggle("player-one", current === 0);
  els.currentPlayerBadge.classList.toggle("player-two", current === 1);
  els.playerOneName.textContent = playerName(0);
  els.playerTwoName.textContent = playerName(1);
  els.playerOneCount.textContent = aliveStones(0).length;
  els.playerTwoCount.textContent = aliveStones(1).length;
  els.myNameLabel.textContent = localName || "-";
  els.opponentNameLabel.textContent = opponentName() || "-";

  if (appMode === "setup") {
    els.modeLabel.textContent = "입장 대기";
    els.modeDescription.textContent = "닉네임을 입력한 뒤 혼자 하기 또는 온라인 대전을 선택하세요.";
    els.statusText.textContent = "닉네임을 입력하고 게임을 시작하세요.";
  } else if (appMode === "solo") {
    els.modeLabel.textContent = "혼자 하기";
    els.modeDescription.textContent = "같은 기기에서 양쪽 돌을 번갈아 조작합니다.";
    els.statusText.textContent = state.message;
  } else {
    const color = playerSlot === 0 ? "흑" : "백";
    els.modeLabel.textContent = "온라인 대전";
    els.modeDescription.textContent = waitingOnline
      ? `방 ${roomCode} · 친구 입장 대기 중`
      : `방 ${roomCode} · 나는 ${color}, 상대는 ${color === "흑" ? "백" : "흑"}`;
    if (waitingOnline) {
      els.statusText.textContent = `친구가 ${roomCode} 방에 입장하면 시작합니다.`;
    } else if (canControlCurrentTurn()) {
      els.statusText.textContent = `내 차례입니다. ${state.message}`;
    } else {
      els.statusText.textContent = `상대 차례입니다. ${playerName(current)}님의 샷을 기다리는 중입니다.`;
    }
  }

  els.newGameButton.disabled = !canStartNewGame();
  els.playAgainButton.disabled = !canStartNewGame();
  els.passButton.disabled = !canControlCurrentTurn() || isMoving();
  els.stoneCount.disabled = appMode === "online" && firebaseBridge?.playerSlot === 1;
}

function updateTimer() {
  if (!gameActive() || state.gameOver) {
    els.timerText.textContent = "20.0";
    els.timerBar.style.width = "100%";
    els.timerBar.style.backgroundColor = "var(--accent)";
    return;
  }

  const elapsed = gameNow() - state.turnStartedAt;
  const remaining = Math.max(0, MAX_TURN_MS - elapsed);
  const ratio = remaining / MAX_TURN_MS;
  els.timerText.textContent = (remaining / 1000).toFixed(1);
  els.timerBar.style.width = `${ratio * 100}%`;
  els.timerBar.style.backgroundColor = ratio < 0.25 ? "var(--danger)" : "var(--accent)";

  if (!state.shotActive && !isMoving() && remaining <= 0 && canControlCurrentTurn()) {
    passTurn("20초가 지나 턴이 넘어왔습니다.");
  }
}

function drawBoard() {
  ctx.clearRect(0, 0, view.size, view.size);

  const gradient = ctx.createLinearGradient(0, 0, view.size, view.size);
  gradient.addColorStop(0, "#e0b86f");
  gradient.addColorStop(0.5, "#d2a058");
  gradient.addColorStop(1, "#bc8640");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, view.size, view.size);

  ctx.save();
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 24; i += 1) {
    const y = (i / 23) * view.size;
    ctx.beginPath();
    ctx.moveTo(0, y + Math.sin(i * 1.9) * 6);
    ctx.bezierCurveTo(view.size * 0.3, y - 12, view.size * 0.65, y + 14, view.size, y - 3);
    ctx.strokeStyle = i % 2 ? "#6f441d" : "#fff5d8";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();

  const start = view.margin;
  const end = view.margin + (BOARD_LINES - 1) * view.cell;
  ctx.strokeStyle = "rgba(54, 35, 18, 0.72)";
  ctx.lineWidth = Math.max(1, view.size * 0.0016);

  for (let i = 0; i < BOARD_LINES; i += 1) {
    const p = view.margin + i * view.cell;
    ctx.beginPath();
    ctx.moveTo(start, p);
    ctx.lineTo(end, p);
    ctx.moveTo(p, start);
    ctx.lineTo(p, end);
    ctx.stroke();
  }

  ctx.lineWidth = 2;
  ctx.strokeRect(start, start, end - start, end - start);

  STAR_POINTS.forEach(([x, y]) => {
    const p = boardToCanvas({ x, y });
    ctx.beginPath();
    ctx.arc(p.x, p.y, view.cell * 0.11, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(48, 30, 14, 0.75)";
    ctx.fill();
  });

  drawDeathLine();
}

function drawDeathLine() {
  const topLeft = boardToCanvas({ x: -OUT_PADDING, y: -OUT_PADDING });
  const bottomRight = boardToCanvas({ x: 18 + OUT_PADDING, y: 18 + OUT_PADDING });
  const width = bottomRight.x - topLeft.x;
  const height = bottomRight.y - topLeft.y;

  ctx.save();
  ctx.strokeStyle = "rgba(185, 69, 69, 0.95)";
  ctx.lineWidth = Math.max(2, view.cell * 0.075);
  ctx.setLineDash([view.cell * 0.32, view.cell * 0.18]);
  ctx.strokeRect(topLeft.x, topLeft.y, width, height);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(185, 69, 69, 0.94)";
  ctx.font = `700 ${Math.max(11, view.cell * 0.28)}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText("탈락선", topLeft.x + view.cell * 0.2, topLeft.y - view.cell * 0.28);
  ctx.restore();
}

function drawAim() {
  if (!drag) {
    return;
  }

  const stonePoint = boardToCanvas(drag.stone);
  const currentPoint = boardToCanvas(drag.current);
  const dx = drag.stone.x - drag.current.x;
  const dy = drag.stone.y - drag.current.y;
  const target = boardToCanvas({
    x: drag.stone.x + dx * 1.35,
    y: drag.stone.y + dy * 1.35,
  });

  ctx.save();
  ctx.strokeStyle = "rgba(185, 69, 69, 0.78)";
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(stonePoint.x, stonePoint.y);
  ctx.lineTo(currentPoint.x, currentPoint.y);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(31, 122, 109, 0.9)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(stonePoint.x, stonePoint.y);
  ctx.lineTo(target.x, target.y);
  ctx.stroke();

  const angle = Math.atan2(target.y - stonePoint.y, target.x - stonePoint.x);
  ctx.beginPath();
  ctx.moveTo(target.x, target.y);
  ctx.lineTo(target.x - Math.cos(angle - 0.55) * 16, target.y - Math.sin(angle - 0.55) * 16);
  ctx.lineTo(target.x - Math.cos(angle + 0.55) * 16, target.y - Math.sin(angle + 0.55) * 16);
  ctx.closePath();
  ctx.fillStyle = "rgba(31, 122, 109, 0.9)";
  ctx.fill();
  ctx.restore();
}

function drawStone(stone) {
  if (!stone.alive) {
    return;
  }

  const p = boardToCanvas(stone);
  const radius = STONE_RADIUS * view.cell;
  const gradient = ctx.createRadialGradient(
    p.x - radius * 0.35,
    p.y - radius * 0.38,
    radius * 0.15,
    p.x,
    p.y,
    radius,
  );

  if (stone.owner === 0) {
    gradient.addColorStop(0, "#6b6c70");
    gradient.addColorStop(0.5, "#232326");
    gradient.addColorStop(1, "#050506");
  } else {
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.58, "#eee9dd");
    gradient.addColorStop(1, "#aba394");
  }

  ctx.save();
  ctx.shadowBlur = radius * 0.35;
  ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
  ctx.shadowOffsetY = radius * 0.18;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = stone.owner === 0 ? 1 : 1.5;
  ctx.strokeStyle = stone.owner === 0 ? "rgba(255,255,255,0.08)" : "rgba(81,70,56,0.32)";
  ctx.stroke();
  ctx.restore();
}

function draw() {
  drawBoard();
  drawAim();
  state.stones.forEach(drawStone);
}

function stepPhysics(dt) {
  if (state.gameOver || !gameActive()) {
    return;
  }
  if (appMode === "online" && state.shotActive && !ownsActiveShot()) {
    return;
  }

  let changed = false;
  const alive = state.stones.filter((stone) => stone.alive);

  alive.forEach((stone) => {
    stone.x += stone.vx * dt;
    stone.y += stone.vy * dt;
    const decay = Math.exp(-FRICTION * dt);
    stone.vx *= decay;
    stone.vy *= decay;

    if (Math.hypot(stone.vx, stone.vy) < STOP_SPEED) {
      stone.vx = 0;
      stone.vy = 0;
    }

    if (
      stone.x < -OUT_PADDING ||
      stone.x > 18 + OUT_PADDING ||
      stone.y < -OUT_PADDING ||
      stone.y > 18 + OUT_PADDING
    ) {
      stone.alive = false;
      stone.vx = 0;
      stone.vy = 0;
      state.message = `${stone.owner === 0 ? "흑" : "백"} 돌이 밖으로 나갔습니다.`;
      emitSound("death", 1.35, { sync: false, throttleMs: 140 });
      changed = true;
    }
  });

  for (let i = 0; i < alive.length; i += 1) {
    for (let j = i + 1; j < alive.length; j += 1) {
      const impact = resolveCollision(alive[i], alive[j]);
      if (impact > 0) {
        changed = true;
        emitSound("collision", impact / 7, { sync: false, throttleMs: 70 });
      }
    }
  }

  if (changed || isMoving()) {
    syncState(false);
  }
}

function resolveCollision(a, b) {
  if (!a.alive || !b.alive) {
    return 0;
  }

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  const minDistance = STONE_RADIUS * 2;

  if (distance <= 0 || distance >= minDistance) {
    return 0;
  }

  const nx = dx / distance;
  const ny = dy / distance;
  const relativeSpeed = Math.abs((a.vx - b.vx) * nx + (a.vy - b.vy) * ny);
  const overlap = (minDistance - distance) / 2;
  a.x -= nx * overlap;
  a.y -= ny * overlap;
  b.x += nx * overlap;
  b.y += ny * overlap;

  const tx = -ny;
  const ty = nx;
  const aNormal = a.vx * nx + a.vy * ny;
  const bNormal = b.vx * nx + b.vy * ny;
  const aTangent = a.vx * tx + a.vy * ty;
  const bTangent = b.vx * tx + b.vy * ty;
  const restitution = 0.94;

  a.vx = tx * aTangent + nx * bNormal * restitution;
  a.vy = ty * aTangent + ny * bNormal * restitution;
  b.vx = tx * bTangent + nx * aNormal * restitution;
  b.vy = ty * bTangent + ny * aNormal * restitution;
  return relativeSpeed;
}

function checkWinner() {
  if (state.gameOver || !gameActive()) {
    return;
  }
  if (appMode === "online" && state.shotActive && !ownsActiveShot()) {
    return;
  }

  const blackLeft = aliveStones(0).length;
  const whiteLeft = aliveStones(1).length;

  if (blackLeft === 0 || whiteLeft === 0) {
    state.gameOver = true;
    state.winner = blackLeft === 0 && whiteLeft === 0 ? state.currentPlayer : blackLeft > 0 ? 0 : 1;
    state.message = `${playerName(state.winner)} 승리!`;
    showWinnerIfNeeded();
    syncState(true);
  }
}

function showWinnerIfNeeded() {
  if (!state.gameOver || state.winner === null) {
    els.winnerOverlay.classList.add("hidden");
    return;
  }

  const name = playerName(state.winner);
  els.winnerTitle.textContent = `${name} 승리!`;
  els.winnerMessage.textContent = `${name}님, 축하합니다. 상대의 돌을 모두 밀어냈습니다.`;
  els.winnerOverlay.classList.remove("hidden");
}

function frame(now) {
  const dt = Math.min(0.032, (now - lastFrame) / 1000);
  lastFrame = now;
  stepPhysics(dt);
  checkWinner();

  const moving = isMoving();
  if (moving) {
    motionSettledAt = null;
  } else if (motionSettledAt === null) {
    motionSettledAt = now;
  } else if (!state.gameOver && state.shotActive && ownsActiveShot() && now - motionSettledAt > 430) {
    motionSettledAt = null;
    endTurnAfterMotion();
  }

  updateTimer();
  updateHud();
  draw();
  requestAnimationFrame(frame);
}

function findStoneAt(point) {
  const stones = aliveStones(state.currentPlayer);
  return stones
    .slice()
    .reverse()
    .find((stone) => Math.hypot(stone.x - point.x, stone.y - point.y) <= STONE_RADIUS * 1.35);
}

function pointerDown(event) {
  if (!gameActive()) {
    state.message = appMode === "online" ? "친구가 입장하면 시작합니다." : "닉네임을 입력하고 게임을 시작하세요.";
    updateHud();
    return;
  }

  if (state.gameOver || isMoving() || !canControlCurrentTurn()) {
    return;
  }

  const point = canvasToBoard(event.clientX, event.clientY);
  const stone = findStoneAt(point);
  if (!stone) {
    state.message = "현재 차례의 돌을 선택하세요.";
    updateHud();
    return;
  }

  canvas.setPointerCapture(event.pointerId);
  drag = {
    pointerId: event.pointerId,
    stone,
    current: point,
  };
  state.message = "뒤로 당긴 만큼 더 강하게 날아갑니다.";
  updateHud();
}

function pointerMove(event) {
  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }

  const point = canvasToBoard(event.clientX, event.clientY);
  const dx = point.x - drag.stone.x;
  const dy = point.y - drag.stone.y;
  const distance = Math.hypot(dx, dy);
  const scale = distance > MAX_PULL ? MAX_PULL / distance : 1;
  drag.current = {
    x: drag.stone.x + dx * scale,
    y: drag.stone.y + dy * scale,
  };
}

function pointerUp(event) {
  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }

  const dx = drag.stone.x - drag.current.x;
  const dy = drag.stone.y - drag.current.y;
  const strength = Math.hypot(dx, dy);
  canvas.releasePointerCapture(event.pointerId);

  if (strength < 0.18) {
    drag = null;
    state.message = "조금 더 길게 당겨서 놓아보세요.";
    updateHud();
    return;
  }

  drag.stone.vx = dx * SHOT_POWER;
  drag.stone.vy = dy * SHOT_POWER;
  drag = null;
  state.shotActive = true;
  state.shotOwner = state.currentPlayer;
  state.message = "샷 진행 중입니다.";
  emitSound("shoot", (strength / MAX_PULL) * 1.7, { sync: false });
  updateHud();
  syncState(true);
}

async function setupFirebase() {
  try {
    firebaseBridge = await createFirebaseBridge({
      onRemoteState: applyRemoteState,
      getState: serializeState,
      setStatus: updateOnlineStatus,
    });
  } catch (error) {
    console.error(error);
    firebaseBridge = null;
    els.createRoomButton.disabled = true;
    els.joinRoomButton.disabled = true;
    els.startCreateRoomButton.disabled = true;
    els.startJoinRoomButton.disabled = true;
    updateOnlineStatus("Firebase 연결에 실패했습니다. 설정값과 Realtime Database 규칙을 확인하세요.");
    return;
  }

  if (!firebaseBridge.ready) {
    els.createRoomButton.disabled = true;
    els.joinRoomButton.disabled = true;
    els.startCreateRoomButton.disabled = true;
    els.startJoinRoomButton.disabled = true;
    updateOnlineStatus("Firebase 설정을 넣으면 온라인 대전을 사용할 수 있습니다.");
    return;
  }

  updateOnlineStatus("Firebase 연결 가능 · 숫자 6자리 방을 만들거나 입장하세요.");
}

function bindEvents() {
  window.addEventListener("resize", () => {
    resizeCanvas();
    draw();
  });

  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", () => {
    drag = null;
  });

  els.nicknameInput.addEventListener("input", () => {
    localName = sanitizeNickname(els.nicknameInput.value);
    updateHud();
  });
  els.startSoloButton.addEventListener("click", startSolo);
  els.startCreateRoomButton.addEventListener("click", createOnlineRoom);
  els.startJoinRoomButton.addEventListener("click", () => joinOnlineRoom(els.startRoomCodeInput));
  els.startRoomCodeInput.addEventListener("input", () => syncRoomInputs(els.startRoomCodeInput));

  els.newGameButton.addEventListener("click", () => newGame(true));
  els.playAgainButton.addEventListener("click", () => newGame(true));
  els.passButton.addEventListener("click", () => {
    passTurn("상대가 턴을 넘겼습니다. 자신의 돌을 뒤로 당겼다가 놓으세요.");
  });
  els.stoneCount.addEventListener("change", () => {
    if (appMode === "solo") {
      newGame(false);
    }
  });

  els.roomCodeInput.addEventListener("input", () => syncRoomInputs(els.roomCodeInput));
  els.createRoomButton.addEventListener("click", createOnlineRoom);
  els.joinRoomButton.addEventListener("click", () => joinOnlineRoom(els.roomCodeInput));
}

async function boot() {
  const savedName = localStorage.getItem(NICKNAME_KEY) || "";
  els.nicknameInput.value = savedName;
  localName = sanitizeNickname(savedName);
  resizeCanvas();
  bindEvents();
  await setupFirebase();
  updateHud();
  requestAnimationFrame(frame);
}

boot();

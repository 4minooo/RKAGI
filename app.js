import { createFirebaseBridge } from "./firebase-client.js";

const canvas = document.querySelector("#gameCanvas");
const ctx = canvas.getContext("2d");

const els = {
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
const MAX_PULL = 2.6;
const SHOT_POWER = 4.25;
const STOP_SPEED = 0.035;
const FRICTION = 1.85;
const OUT_PADDING = 0.62;
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

let state = createInitialState(5);
let drag = null;
let lastFrame = performance.now();
let motionSettledAt = null;
let firebaseBridge = null;

function createInitialState(count) {
  const players = [els?.playerOneName?.value || "플레이어 1", els?.playerTwoName?.value || "플레이어 2"];
  return {
    players,
    currentPlayer: 0,
    turnStartedAt: Date.now(),
    shotActive: false,
    gameOver: false,
    winner: null,
    message: "자신의 돌을 뒤로 당겼다가 놓으세요.",
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
  return state.players[index] || `플레이어 ${index + 1}`;
}

function aliveStones(owner) {
  return state.stones.filter((stone) => stone.alive && stone.owner === owner);
}

function isMoving() {
  return state.stones.some((stone) => stone.alive && Math.hypot(stone.vx, stone.vy) > STOP_SPEED);
}

function canControlCurrentTurn() {
  return !firebaseBridge || firebaseBridge.isLocalTurn(state.currentPlayer);
}

function syncState(force = false) {
  firebaseBridge?.publish(force);
}

function serializeState() {
  return JSON.parse(JSON.stringify(state));
}

function applyRemoteState(remoteState) {
  const cleaned = JSON.parse(JSON.stringify(remoteState));
  delete cleaned.updatedBy;
  delete cleaned.updatedAt;
  state = cleaned;
  drag = null;
  updateHud();
  showWinnerIfNeeded();
}

function newGame(sync = true) {
  state = createInitialState(Number(els.stoneCount.value));
  drag = null;
  motionSettledAt = null;
  els.winnerOverlay.classList.add("hidden");
  updateHud();
  if (sync) {
    syncState(true);
  }
}

function passTurn(reason = "턴을 넘겼습니다.") {
  if (state.gameOver || isMoving()) {
    return;
  }
  state.currentPlayer = 1 - state.currentPlayer;
  state.turnStartedAt = Date.now();
  state.shotActive = false;
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
  state.turnStartedAt = Date.now();
  state.shotActive = false;
  state.message = "자신의 돌을 뒤로 당겼다가 놓으세요.";
  updateHud();
  syncState(true);
}

function updateHud() {
  const current = state.currentPlayer;
  els.currentPlayerName.textContent = playerName(current);
  els.currentPlayerBadge.textContent = current === 0 ? "흑" : "백";
  els.currentPlayerBadge.classList.toggle("player-one", current === 0);
  els.currentPlayerBadge.classList.toggle("player-two", current === 1);
  els.playerOneCount.textContent = aliveStones(0).length;
  els.playerTwoCount.textContent = aliveStones(1).length;
  els.statusText.textContent = canControlCurrentTurn()
    ? state.message
    : "상대가 조작하는 차례입니다.";
}

function updateTimer() {
  const elapsed = Date.now() - state.turnStartedAt;
  const remaining = Math.max(0, MAX_TURN_MS - elapsed);
  const ratio = remaining / MAX_TURN_MS;
  els.timerText.textContent = (remaining / 1000).toFixed(1);
  els.timerBar.style.width = `${ratio * 100}%`;
  els.timerBar.style.backgroundColor = ratio < 0.25 ? "var(--danger)" : "var(--accent)";

  if (!state.gameOver && !state.shotActive && !isMoving() && remaining <= 0 && canControlCurrentTurn()) {
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
  if (state.gameOver) {
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
      changed = true;
    }
  });

  for (let i = 0; i < alive.length; i += 1) {
    for (let j = i + 1; j < alive.length; j += 1) {
      changed = resolveCollision(alive[i], alive[j]) || changed;
    }
  }

  if (changed || isMoving()) {
    syncState(false);
  }
}

function resolveCollision(a, b) {
  if (!a.alive || !b.alive) {
    return false;
  }

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  const minDistance = STONE_RADIUS * 2;

  if (distance <= 0 || distance >= minDistance) {
    return false;
  }

  const nx = dx / distance;
  const ny = dy / distance;
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
  return true;
}

function checkWinner() {
  if (state.gameOver) {
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
  } else if (!state.gameOver && state.shotActive && now - motionSettledAt > 520) {
    motionSettledAt = null;
    endTurnAfterMotion();
  }

  updateTimer();
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
  state.message = "샷 진행 중입니다.";
  updateHud();
  syncState(true);
}

function updateNames() {
  state.players = [els.playerOneName.value.trim() || "플레이어 1", els.playerTwoName.value.trim() || "플레이어 2"];
  updateHud();
  showWinnerIfNeeded();
  syncState(true);
}

async function setupFirebase() {
  firebaseBridge = await createFirebaseBridge({
    onRemoteState: applyRemoteState,
    getState: serializeState,
    setStatus: (message) => {
      els.onlineStatus.textContent = message;
    },
  });

  if (!firebaseBridge.ready) {
    els.createRoomButton.disabled = true;
    els.joinRoomButton.disabled = true;
    return;
  }

  els.onlineStatus.textContent = "Firebase 연결 가능 · 방을 만들거나 코드로 입장하세요.";
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

  els.newGameButton.addEventListener("click", () => newGame(true));
  els.playAgainButton.addEventListener("click", () => newGame(true));
  els.passButton.addEventListener("click", () => {
    if (canControlCurrentTurn()) {
      passTurn("상대가 턴을 넘겼습니다. 자신의 돌을 뒤로 당겼다가 놓으세요.");
    }
  });
  els.stoneCount.addEventListener("change", () => newGame(true));
  els.playerOneName.addEventListener("input", updateNames);
  els.playerTwoName.addEventListener("input", updateNames);

  els.createRoomButton.addEventListener("click", async () => {
    try {
      const room = await firebaseBridge.createRoom();
      els.roomCodeInput.value = room.roomCode;
    } catch (error) {
      els.onlineStatus.textContent = error.message;
    }
  });

  els.joinRoomButton.addEventListener("click", async () => {
    try {
      await firebaseBridge.joinRoom(els.roomCodeInput.value);
    } catch (error) {
      els.onlineStatus.textContent = error.message;
    }
  });
}

async function boot() {
  resizeCanvas();
  bindEvents();
  await setupFirebase();
  updateHud();
  requestAnimationFrame(frame);
}

boot();

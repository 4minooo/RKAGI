const ROOM_PATH = "alkkagiRooms";
const CLIENT_ID =
  globalThis.crypto?.randomUUID?.() || `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const makeRoomCode = () => String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");

function normalizeRoomCode(code) {
  return code.replace(/\D/g, "").slice(0, 6);
}

function normalizePlayers(players) {
  return [
    players?.[0] || players?.["0"] || "흑",
    players?.[1] || players?.["1"] || "상대 대기 중",
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

export async function createFirebaseBridge({ onRemoteState, getState, setStatus }) {
  const config = window.ALKKAGI_FIREBASE_CONFIG;

  if (!config) {
    return {
      ready: false,
      playerSlot: null,
      roomCode: "",
      createRoom: async () => {
        throw new Error("Firebase 설정이 없습니다.");
      },
      joinRoom: async () => {
        throw new Error("Firebase 설정이 없습니다.");
      },
      leaveRoom: () => {},
      publish: () => {},
      isLocalTurn: () => true,
    };
  }

  const appModule = await import("https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js");
  const dbModule = await import("https://www.gstatic.com/firebasejs/12.13.0/firebase-database.js");

  const app = appModule.initializeApp(config);
  const db = dbModule.getDatabase(app);
  let roomCode = "";
  let playerSlot = null;
  let unsubscribe = null;
  let lastPublish = 0;

  const roomRef = (code) => dbModule.ref(db, `${ROOM_PATH}/${code}`);
  const stateRef = (code) => dbModule.ref(db, `${ROOM_PATH}/${code}/state`);

  function listen(code) {
    if (unsubscribe) {
      unsubscribe();
    }

    unsubscribe = dbModule.onValue(stateRef(code), (snapshot) => {
      const payload = snapshot.val();
      if (!payload || payload.updatedBy === CLIENT_ID) {
        return;
      }
      onRemoteState(payload);
    });
  }

  function leaveRoom() {
    if (unsubscribe) {
      unsubscribe();
    }
    unsubscribe = null;
    roomCode = "";
    playerSlot = null;
    lastPublish = 0;
  }

  async function createRoom() {
    let nextRoomCode = makeRoomCode();
    let guard = 0;
    while ((await dbModule.get(roomRef(nextRoomCode))).exists() && guard < 8) {
      nextRoomCode = makeRoomCode();
      guard += 1;
    }

    if (guard >= 8) {
      throw new Error("방 코드 생성에 실패했습니다. 다시 시도하세요.");
    }

    roomCode = nextRoomCode;
    playerSlot = 0;
    const state = { ...getState(), updatedBy: CLIENT_ID, updatedAt: Date.now() };
    await dbModule.set(roomRef(roomCode), {
      createdAt: dbModule.serverTimestamp(),
      players: { black: CLIENT_ID },
      state,
    });
    listen(roomCode);
    setStatus(`방 ${roomCode} 생성됨 · 흑으로 참가 중`);
    return { roomCode, playerSlot };
  }

  async function joinRoom(code, { playerName } = {}) {
    const normalized = normalizeRoomCode(code);
    if (normalized.length !== 6) {
      throw new Error("방 코드는 숫자 6자리입니다.");
    }

    const snapshot = await dbModule.get(roomRef(normalized));
    if (!snapshot.exists()) {
      throw new Error("방을 찾을 수 없습니다.");
    }

    const room = snapshot.val();
    const blackClientId = room.players?.black;
    if (blackClientId === CLIENT_ID) {
      throw new Error("이미 내가 만든 방입니다.");
    }
    if (room.players?.white && room.players.white !== CLIENT_ID) {
      throw new Error("이미 두 명이 입장한 방입니다.");
    }

    roomCode = normalized;
    playerSlot = 1;

    const remoteState = room.state || getState();
    const players = normalizePlayers(remoteState.players);
    players[1] = playerName || "백";
    const joinedState = {
      ...remoteState,
      players,
      stones: normalizeStones(remoteState.stones),
      currentPlayer: 0,
      turnStartedAt: Date.now(),
      shotActive: false,
      shotOwner: null,
      gameOver: false,
      winner: null,
      message: "온라인 대전 시작! 흑 차례입니다.",
      updatedBy: CLIENT_ID,
      updatedAt: Date.now(),
    };

    await dbModule.update(dbModule.ref(db, `${ROOM_PATH}/${roomCode}/players`), {
      white: CLIENT_ID,
    });
    await dbModule.set(stateRef(roomCode), joinedState);
    onRemoteState(joinedState);
    listen(roomCode);
    setStatus(`방 ${roomCode} 입장됨 · 백으로 참가 중`);
    return { roomCode, playerSlot };
  }

  function publish(force = false) {
    if (!roomCode) {
      return;
    }

    const now = Date.now();
    if (!force && now - lastPublish < 90) {
      return;
    }

    lastPublish = now;
    dbModule
      .set(stateRef(roomCode), { ...getState(), updatedBy: CLIENT_ID, updatedAt: now })
      .catch((error) => {
        setStatus(`Firebase 저장 실패 · 규칙 게시를 확인하세요. (${error.message})`);
      });
  }

  return {
    ready: true,
    get playerSlot() {
      return playerSlot;
    },
    get roomCode() {
      return roomCode;
    },
    createRoom,
    joinRoom,
    leaveRoom,
    publish,
    isLocalTurn: (currentPlayer) => playerSlot === null || playerSlot === currentPlayer,
  };
}

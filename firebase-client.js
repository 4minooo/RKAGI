const ROOM_PATH = "alkkagiRooms";
const CLIENT_ID =
  globalThis.crypto?.randomUUID?.() || `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const makeRoomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

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

  async function createRoom() {
    roomCode = makeRoomCode();
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

  async function joinRoom(code) {
    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      throw new Error("방 코드를 입력하세요.");
    }

    const snapshot = await dbModule.get(roomRef(normalized));
    if (!snapshot.exists()) {
      throw new Error("방을 찾을 수 없습니다.");
    }

    roomCode = normalized;
    playerSlot = 1;
    await dbModule.update(dbModule.ref(db, `${ROOM_PATH}/${roomCode}/players`), {
      white: CLIENT_ID,
    });
    const remoteState = snapshot.val().state;
    if (remoteState) {
      onRemoteState(remoteState);
    }
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
    dbModule.set(stateRef(roomCode), { ...getState(), updatedBy: CLIENT_ID, updatedAt: now });
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
    publish,
    isLocalTurn: (currentPlayer) => playerSlot === null || playerSlot === currentPlayer,
  };
}

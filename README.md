# 알까기 대전

바둑판 위에서 두 명이 번갈아 돌을 날리는 알까기 게임입니다. 마우스나 터치로 자신의 돌을 뒤로 당긴 뒤 놓으면 돌이 날아가고, 상대 돌을 모두 밖으로 밀어내면 승리합니다.

## 기능

- 19줄 바둑판 기반 알까기
- 시작 시 닉네임 입력
- 혼자 하기와 온라인 대전 모드 분리
- 온라인 대전 숫자 6자리 방 코드
- 온라인 입장 후 내 이름과 상대 이름 표시
- 온라인 샷 처리 소유자 고정으로 턴 전환 안정화
- 실제 탈락 기준선 표시
- 각자 동일한 수의 바둑알 선택: 3, 5, 7, 9개
- 드래그 앤 릴리즈 방식의 샷
- 턴당 20초 제한 시간
- 상대 돌을 모두 제거하면 승자 이름과 축하 메시지 표시
- Firebase Realtime Database를 통한 온라인 방 동기화

## 로컬 실행

별도 빌드 없이 정적 파일로 실행할 수 있습니다.

```bash
npx serve .
```

또는 정적 서버로 `index.html`을 제공하면 됩니다. 브라우저 보안 정책 때문에 ES module은 `file://`보다 `localhost`에서 확인하는 편이 좋습니다.

## Firebase 설정

`firebase-config.js`에 Firebase 웹 앱 설정이 들어 있어야 온라인 대전이 켜집니다.

```js
window.ALKKAGI_FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
```

Realtime Database 규칙은 `database.rules.json`에 들어 있습니다. Firebase Console의 Realtime Database > 규칙 탭에 전체 내용을 붙여넣고 게시하세요.

이번 버전부터 방 코드는 숫자 6자리만 허용합니다.

```json
".read": "$room.matches(/^[0-9]{6}$/)",
".write": "newData.exists() && $room.matches(/^[0-9]{6}$/)"
```

온라인 턴 전환 안정화를 위해 `state.shotOwner` 필드도 허용해야 합니다. 최신 `database.rules.json`에는 이미 포함되어 있습니다.

현재 앱은 Firebase Authentication 없이 방 코드를 공유하는 구조입니다. 친구와 가볍게 플레이하기에는 충분하지만, 공개 서비스로 키울 때는 익명 로그인이나 계정 로그인을 붙여 플레이어별 쓰기 권한까지 좁히는 것을 권장합니다.

## Vercel 배포

1. 이 폴더를 GitHub 저장소에 올립니다.
2. Vercel에서 저장소를 Import 합니다.
3. Framework Preset은 `Other`로 두고, Build Command와 Output Directory는 비워둡니다.
4. 배포 후 `index.html`이 첫 화면으로 제공됩니다.

# 알까기 대전

바둑판 위에서 두 명이 번갈아 돌을 날리는 알까기 게임입니다. 마우스나 터치로 자신의 돌을 뒤로 당긴 뒤 놓으면 돌이 날아가고, 상대 돌을 모두 밖으로 밀어내면 승리합니다.

## 기능

- 19줄 바둑판 기반 알까기
- 2인 플레이
- 각자 동일한 수의 바둑알 선택: 3, 5, 7, 9개
- 드래그 앤 릴리즈 방식의 샷
- 턴당 20초 제한 시간
- 상대 돌을 모두 제거하면 승자 이름과 축하 메시지 표시
- Firebase Realtime Database 설정 시 온라인 방 생성/입장

## 로컬 실행

별도 빌드 없이 정적 파일로 실행할 수 있습니다.

```bash
npx serve .
```

또는 `index.html`을 브라우저로 열어도 로컬 2인 플레이는 동작합니다.

## Firebase 설정

온라인 방 기능을 쓰려면 `firebase-config.example.js`를 참고해 `firebase-config.js`의 값을 채우세요.

```js
window.ALKKAGI_FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
```

Realtime Database 규칙은 `database.rules.json`에 들어 있습니다. Firebase Console의 Realtime Database > 규칙 탭에 그대로 붙여넣으면 됩니다.

현재 앱은 Firebase Authentication 없이 방 코드를 공유하는 구조입니다. 그래서 규칙은 루트 경로를 닫고 `alkkagiRooms/{방코드}`만 열어두되, 방 코드와 게임 상태 데이터 모양을 검증합니다. 공개 서비스로 키울 때는 익명 로그인이나 계정 로그인을 붙여 플레이어별 쓰기 권한까지 좁히는 것을 권장합니다.

## Vercel 배포

1. 이 폴더를 GitHub 저장소에 올립니다.
2. Vercel에서 저장소를 Import 합니다.
3. Framework Preset은 `Other`로 두고, Build Command와 Output Directory는 비워둡니다.
4. 배포 후 `index.html`이 첫 화면으로 제공됩니다.

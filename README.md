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

개발 중 빠르게 테스트할 수 있는 Realtime Database 규칙 예시는 아래와 같습니다. 실제 공개 서비스에서는 인증과 방별 권한을 더 좁혀 주세요.

```json
{
  "rules": {
    "alkkagiRooms": {
      "$room": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

## Vercel 배포

1. 이 폴더를 GitHub 저장소에 올립니다.
2. Vercel에서 저장소를 Import 합니다.
3. Framework Preset은 `Other`로 두고, Build Command와 Output Directory는 비워둡니다.
4. 배포 후 `index.html`이 첫 화면으로 제공됩니다.

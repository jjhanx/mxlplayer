# mxlplayer

MusicXML을 **OSMD(OpenSheetMusicDisplay)** 로 렌더링하고, **osmd-audio-player** 로 재생하는 웹 앱(MVP)입니다.

저장소: [github.com/jjhanx/mxlplayer](https://github.com/jjhanx/mxlplayer)

## 테스트용 악보

`MusicXML Files/` 에 샘플·로컬 테스트용 `.mxl` / `.musicxml`(및 `xmlsamples/` 참고용 PDF·이미지 등)이 포함되어 있습니다. 앱에서 열거나 Drag & Drop 으로 시험하면 됩니다.

## 기능 (MVP)

- **파일**: `.xml` / `.musicxml` / `.mxl` — 파일 선택 또는 **전체 창 Drag & Drop**
- **악보**: OpenSheetMusicDisplay, 흰색 악보 패널
- **재생**: `osmd-audio-player`, BPM 슬라이더로 템포 조절(재생 중 비활성)
- **시작 위치**: 악보 클릭 시 해당 음표·쉼표 시점부터 재생
- **파트별 믹싱**: **악기(파트) 인덱스** 기준 Volume / Solo / Mute (동일 MIDI GM 번호를 쓰는 파트도 UI·소리 분리)
- **Follow-along**: 재생 중 **실제로 들리는 파트의 음표만** 빨간색 표시(OSMD 커서 막대는 숨김)

## 기술 참고

- **재생 스케줄러·엔진 패치** (`main.tsx`에서 App 이전에 `patchPlaybackScheduler` → `patchPlaybackEngine` 순으로 import):
  - **템포 누적 가속(1)**: `PlaybackScheduler.reset()`이 잘못된 인자로 `clearInterval`을 호출해 핸들이 남는 문제 → `schedulerIntervalHandle`로 정리.
  - **템포 누적 가속(2)**: `PlaybackEngine.loadScore()`가 교체되는 **기존** `PlaybackScheduler`에 `reset()`을 호출하지 않아, 예전 인스턴스의 `setInterval`이 계속 실행될 수 있음 → `patchPlaybackEngine.ts`에서 `loadScore` 앞단에 이전 스케줄러 `reset()` 추가.
  - **`start()` 이중 타이머 방지**: `PlaybackScheduler.start()`가 기존 인터벌을 항상 지운 뒤 하나만 등록하도록 교체 (`patchPlaybackScheduler.ts`).
  - **재생 멈춤·음표 도약·순간 버스트**: 백그라운드 탭 등으로 `setInterval`이 지연될 때 `calculatedTick` 점프로 `timeToTick`이 한꺼번에 0으로 몰림 → 매 주기 `currentTick` 증가량을 상한하고, `reset` 시 `WeakMap` 샘플도 초기화.

- **파트별 게인**: `src/audio/playbackNoteCallbackPatch.ts`에서 OSMD `Note` 기준 악기 인덱스로 Solo/Mute/볼륨을 적용합니다.
- **악기 인덱스**: `src/audio/instrumentIndexFromNote.ts` — `Instruments` 배열 참조 실패 시 `Instrument.Id` / `IdString`으로 매칭합니다.

## 실행 (웹)

```bash
npm install
npm run dev
```

## 프로덕션 빌드

```bash
npm run build
```

`dist/` 를 정적 호스팅(Nginx 등)에 올리면 됩니다.

### Ubuntu + Nginx 예시

- `dist/*` 를 예: `/var/www/mxlplayer/` 에 복사
- `server_name` 에 도메인 지정, `root` 가 위 경로인지 확인
- SPA 라우팅이 없어도 되면 `try_files $uri $uri/ /index.html` 은 선택
- UFW·클라우드 보안 그룹에서 **TCP 80 / 443** 허용
- `systemctl enable nginx` 로 부팅 시 자동 기동

## 하이브리드 앱 (Capacitor)

```bash
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

## Windows에서 `npm install`이 실패할 때

이 워크스페이스 경로가 동기화 드라이브이거나(OneDrive/Google Drive) 경로가 길면, `node_modules` 생성 중 Windows 경로 제한으로 설치가 실패할 수 있습니다.

- **권장**: 프로젝트를 `C:\dev\mxlplayer` 처럼 짧은 로컬 경로로 복사한 뒤 `npm install` 실행
- Windows “긴 경로 사용”을 켤 수 있다면(그룹 정책/레지스트리) 그것도 도움이 됩니다.

### 빠른 해결(자동 스크립트)

PowerShell에서 아래를 실행하면, 이 프로젝트를 `C:\dev\mxlplayer` 로 복사한 뒤 `npm install`까지 진행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\win-local-setup.ps1
```

## 문서 유지

기능 변경·버그 수정 시 **이 README의 기술 참고·실행 방법 등 관련 섹션과 구현 파일**을 함께 갱신한 뒤 `main`에 커밋·푸시합니다.

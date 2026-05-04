# mxlplayer

MusicXML을 **OSMD(OpenSheetMusicDisplay)** 로 렌더링하고, **osmd-audio-player** 로 재생하는 웹 앱(MVP)입니다.

저장소: [github.com/jjhanx/mxlplayer](https://github.com/jjhanx/mxlplayer)

## 테스트용 악보

`MusicXML Files/` 에 샘플·로컬 테스트용 `.mxl` / `.musicxml`(및 `xmlsamples/` 참고용 PDF·이미지 등)이 포함되어 있습니다. 앱에서 열거나 Drag & Drop 으로 시험하면 됩니다.

## 기능 (MVP)

- **파일**: `.xml` / `.musicxml` / `.mxl` — 파일 선택 또는 **전체 창 Drag & Drop** (`window`에 **capture 단계** `dragenter/dragover/drop`; `Files` 타입 미노출·`DataTransfer.items` 폴백 포함해 첫 드롭이 무시되지 않게 함)
- **악보**: OpenSheetMusicDisplay, 흰색 악보 패널
- **재생**: `osmd-audio-player`, BPM 슬라이더로 템포 조절(재생 중 비활성)
- **시작 위치**: 악보 클릭 시 해당 음표·쉼표 시점부터 재생
- **파트별 믹싱**: **악기(파트) 인덱스** 기준 Volume / Solo / Mute (동일 MIDI GM 번호를 쓰는 파트도 UI·소리 분리)
- **Follow-along**: 재생 중 **실제로 들리는 파트의 음표만** 빨간색 표시(OSMD 커서 막대는 숨김). 같은 시각 성부·피아노 등 **강조 블록 전체가 패널 안에 들어오도록** 스크롤합니다. 기본은 **상하** 스크롤이며, **가로 한 줄 악보** 모드일 때는 **`playbackScroll.ts`에서 가로(`scrollLeft`)** 위주로 따라갑니다. 블록이 뷰 안에 들어갈 때만 잘리지 않게 맞추고, 재생 중에는 **짧은 간격(약 90ms)**으로 가시성을 다시 검사해 수동 스크롤 후에도 곧바로 보정합니다.
- **가로 한 줄 악보**(선택): OSMD **`renderSingleHorizontalStaffline`** — 한 줄 가로 레일 형태로 좌우 스크롤이 자연스럽습니다. **피아노처럼 세로로 겹치는 여러 스태프**도 잘리지 않도록 세로 확보 후 **`overflow-y: auto`** 로 부족할 때 세로 바를 제공합니다(`App.css`). 재생 팔로우는 같은 모드에서 **가로·세로 모두** 강조 영역을 뷰에 맞춥니다(`playbackScroll.ts`). 옵션은 **처음 로드하기 전**에만 적용되므로, 토글 시 OSMD를 다시 붙이고 **같은 파일을 재로드**합니다.
- **인쇄**: 같은 문서 **`.score-print-host`** 에 OSMD를 다시 렌더합니다.(호스트 노드는 `ion-app` 밖 **`document.body`로 `react-dom` 포탈**되어, OSMD가 `render()` 에서 참조하는 `container.offsetWidth`가 0 또는 과소로 잡히지 않고 **용지 폭(px)대로 페이지 높이(`PageHeight`)를 계산**해 여러 장의 `MusicSheetBuilder` 페이지로 나눌 수 있습니다.) **`@page` 여백(`PRINT_PAGE_MARGIN_MM`)** 과 같은 값으로 **실제 인쇄 가능 영역(mm)** 을 `setCustomPageFormat` 으로 넘겨, 레이아웃과 브라우저 인쇄 영역 불일치(오른쪽 마디선 잘림)를 줄였습니다. **화면 가로 한 줄 모드와 관계없이** 인쇄에서는 `renderSingleHorizontalStaffline: false` 로 **표준 다페이지**로 나가며 줄마다 음자리·조표·박자표는 OSMD 기본입니다. 브라우저 **인쇄 배율은 100%** 권장, 밀도는 **`PRINT_OSMD_ZOOM`** 과 간격 규칙으로 조정합니다. `@media print` 에서 OSMD가 넣는 **`div#osmdCanvasPage{n}` 직계마다** `break-after: page` 를 둠(내부 `svg` 는 직계가 아님). 추가로 긴 곡이 한 장으로만 나오는 경우를 줄이려면 인쇄 시 **호스트를 `position:absolute` 가 아니라 일반 배치(`static`)** 로 둠(`App.css` — Chrome 페이지 단편), 그리고 **`sizePrintHostToContentBoxMm` 를 `load()` 이전에** 호출함(`App.tsx`).

## 기술 참고

- **재생 스케줄러·엔진 패치** (`main.tsx`에서 App 이전에 `patchPlaybackScheduler` → `patchPlaybackEngine` 순으로 import):
  - **템포 누적 가속(1)**: `PlaybackScheduler.reset()`이 잘못된 인자로 `clearInterval`을 호출해 핸들이 남는 문제 → `schedulerIntervalHandle`로 정리.
  - **템포 누적 가속(2)**: `PlaybackEngine.loadScore()`가 교체되는 **기존** `PlaybackScheduler`에 `reset()`을 호출하지 않아, 예전 인스턴스의 `setInterval`이 계속 실행될 수 있음 → `patchPlaybackEngine.ts`에서 `loadScore` 앞단에 이전 스케줄러 `reset()` 추가.
  - **`start()` 이중 타이머 방지**: `PlaybackScheduler.start()`가 기존 인터벌을 항상 지운 뒤 하나만 등록하도록 교체 (`patchPlaybackScheduler.ts`).
  - **`loadNotes` 타임라인**: 원래 `getFirstEmptyTick()` 플레이스홀더에 의존하면 다성부·백업이 있는 악보에서 스텝 간격이 압축돼 **같은 BPM인데도 특정 구간만 빨라진 것처럼** 들릴 수 있음 → OSMD `VoiceEntry.ParentSourceStaffEntry.AbsoluteTimestamp`로 재생 틱을 직접 잡고(`patchPlaybackScheduler.ts`), 타임스탬프가 없으면 구현에 폴백.

- **파트별 게인**: `src/audio/playbackNoteCallbackPatch.ts`에서 OSMD `Note` 기준 악기 인덱스로 Solo/Mute/볼륨을 적용합니다.
- **재생 따라가기·스크롤**: `src/audio/playbackScroll.ts` — `scrollHighlightedNotesIntoView(..., layout)` 네 번째 인자로 `'default'(세로)` / `'horizontal-strip'(가로+필요 시 세로 보정)'` 를 둡니다. 가로 줄 모드에서는 **시간 따라가기는 좌우**가 주이되, 피아노 등 **위·아래 스태프가 뷰 밖이면 세로 보정도** 합니다. `App.tsx`의 재생 폴링과 `PlaybackEvent.ITERATION` 핸들러는 **최신 레이아웃(ref)** 과 일치하게 호출합니다.
- **가로 줄·인쇄 전환**: `src/App.tsx` — 화면용 OSMD는 `renderSingleHorizontalStaffline` 과 기본 페이지(엔들리스) 중 하나입니다. 인쇄용 `.score-print-host` 는 **`createPortal(..., document.body)`** 로 루트에 붙이고, **인쇄 호스트 크기(px)를 설정**한 뒤(`sizePrintHostToContentBoxMm`) `load()`, 그 다음 `applyStandardPrintEngravingMode` 등(`src/print/configurePrintOsmd.ts`)과 `render()`, `window.print()` 합니다. 인쇄 전용 레이아웃·페이지 분리는 **`App.css`** 의 `@media print` (`.printing-score`).
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

기능 변경·버그 수정 시 **README의 기능·기술 참고 등 관련 섹션과 구현 파일**을 함께 갱신한 뒤 `main`(또는 작업 브랜치)에 커밋·`origin`에 푸시합니다. (인쇄·재생처럼 동작 원리가 바뀌면 해당 README 불릿과 `configurePrintOsmd.ts` 등 **교차 참고**를 업데이트합니다.)

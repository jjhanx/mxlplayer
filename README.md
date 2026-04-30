# mxlplayer

MusicXML을 **OSMD(OpenSheetMusicDisplay)** 로 렌더링하고, **osmd-audio-player** 로 재생(커서 follow-along 하이라이트 포함)하는 웹/하이브리드 앱(MVP)입니다.

## 기능 (MVP)

- **파일 업로드**: `.xml` / `.musicxml` / `.mxl`
- **악보 렌더링**: OpenSheetMusicDisplay (OSMD)
- **재생 엔진**: `osmd-audio-player`
- **템포 조절**: BPM 슬라이더
- **파트별 제어**: Instrument(MIDI) 기준 **Volume + Solo + Mute**
- **실시간 강조(Follow-along)**: OSMD 커서가 연주 위치를 따라감

## 실행 (웹)

```bash
npm install
npm run dev
```

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


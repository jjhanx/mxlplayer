import {
  IonApp,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonRange,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/react'
import { pause, play, print as printIcon, stop } from 'ionicons/icons'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { GraphicalNote, Note } from 'opensheetmusicdisplay'
import { OpenSheetMusicDisplay, PointF2D } from 'opensheetmusicdisplay'
import PlaybackEngine from 'osmd-audio-player'
import { PlaybackEvent, PlaybackState as EnginePlaybackState } from 'osmd-audio-player/dist/PlaybackEngine'
import { getInstrumentIndexFromNote } from './audio/instrumentIndexFromNote'
import { PlaybackMixer } from './audio/playbackMixer'
import { installInstrumentAwareNotePlayback } from './audio/playbackNoteCallbackPatch'
import {
  scrollHighlightedNotesIntoView,
  PLAYBACK_SCROLL_KEEP_VISIBLE_MS,
  type PlaybackScrollLayoutMode,
} from './audio/playbackScroll'
import { normalizeMxlBlob } from './utils/normalizeMxlBlob'
import {
  getPrintableContentBoxMm,
  PRINT_PAGE_MARGIN_MM,
  sizePrintHostToContentBoxMm,
  type OsmdPagedFormatId,
} from './print/configurePrintOsmd'
import { printScorePageStackInIframe } from './print/printScoreInIframe'
import './App.css'

/** OSMD GraphicalNote.setColor — SVG 백엔드에서 리렌더 없이 적용 */
const DEFAULT_NOTE_COLOR = '#1a1a1a'
const PLAYING_NOTE_COLOR = '#d32f2f'
const NOTE_COLOR_OPTS = {
  applyToNoteheads: true,
  applyToStem: true,
  applyToBeams: true,
  applyToFlag: true,
  applyToLedgerLines: true,
} as const

function isAllowedScoreFile(file: File): boolean {
  const n = file.name.toLowerCase()
  return n.endsWith('.xml') || n.endsWith('.musicxml') || n.endsWith('.mxl')
}

type LastScorePayload = { kind: 'mxl'; blob: Blob } | { kind: 'xml'; text: string }

const PRINT_CSS_PAGE_SIZE: Record<OsmdPagedFormatId, string> = {
  A4_P: 'A4 portrait',
  A4_L: 'A4 landscape',
  Letter_P: 'letter portrait',
  Letter_L: 'letter landscape',
}

function readDataTransferTypeStrings(dt: DataTransfer): string[] {
  const { types } = dt
  if (!types || typeof types.length !== 'number') return []

  const itemFn = (
    /** DOMStringList / 유사 타입 호환 — lib.dom 과 실제 브라우저가 다를 수 있음 */
    types as unknown as { item?: (i: number) => string | null; length?: number }
  ).item

  if (typeof itemFn === 'function') {
    const n = typeof types.length === 'number' ? types.length : 0
    const out: string[] = []
    for (let i = 0; i < n; i++) {
      const token = itemFn.call(types, i)
      if (token) out.push(String(token))
    }
    return out
  }

  try {
    return [...(types as readonly string[])]
  } catch {
    return []
  }
}

/** 드롭 시 types 에 Files 가 없거나 dragover 에서 pd 가 빠져 첫 드롭이 무시되는 경우 방지 */
function dataTransferLooksLikeExternalFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false

  const typeTokens = readDataTransferTypeStrings(dt)
  const lower = typeTokens.map((t) => t.toLowerCase())
  if (lower.includes('files') || lower.some((t) => t.includes('moz-file'))) return true

  try {
    if (dt.items && [...dt.items].some((it) => it.kind === 'file')) return true
  } catch {
    /* noop */
  }

  return false
}

function pickAllowedDroppedFile(dt: DataTransfer | null): File | undefined {
  if (!dt) return undefined
  if (dt.files?.length) return [...dt.files].find(isAllowedScoreFile)

  /** 일부 브라우저/컨텍스트에서 items 만 채워지는 경우 */
  try {
    if (!dt.items?.length) return undefined
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i]
      if (item.kind !== 'file') continue
      const f = item.getAsFile()
      if (f && isAllowedScoreFile(f)) return f
    }
  } catch {
    /* noop */
  }

  return undefined
}

function resetPlaybackHighlights(highlightedRef: { current: GraphicalNote[] }) {
  for (const gn of highlightedRef.current) {
    try {
      gn.setColor(DEFAULT_NOTE_COLOR, NOTE_COLOR_OPTS)
    } catch {
      /* 이전 악보의 그래픽 참조 등 */
    }
  }
  highlightedRef.current = []
}

function highlightPlaybackNotes(
  osmd: OpenSheetMusicDisplay,
  notes: Note[],
  highlightedRef: { current: GraphicalNote[] },
  mixer: PlaybackMixer | null,
) {
  resetPlaybackHighlights(highlightedRef)
  const rules = osmd.EngravingRules
  for (const note of notes) {
    if (!note || note.isRest()) continue
    if (mixer) {
      const idx = getInstrumentIndexFromNote(note)
      if (mixer.shouldSilenceInstrument(idx)) continue
      if (mixer.effectiveInstrumentGain(idx) <= 0) continue
    }
    const gn = rules.GNote(note)
    if (gn) {
      gn.setColor(PLAYING_NOTE_COLOR, NOTE_COLOR_OPTS)
      highlightedRef.current.push(gn)
    }
  }
}

/** PlaybackEngine.countAndSetIterationSteps 와 동일한 커서 순회로 스텝 인덱스 계산 */
function findPlaybackStepForNote(osmd: OpenSheetMusicDisplay, targetNote: Note): number | null {
  const cursor = osmd.cursor
  cursor.reset()
  let step = 0
  while (!cursor.Iterator.EndReached) {
    const ves = cursor.Iterator.CurrentVoiceEntries
    if (ves?.length) {
      for (const ve of ves) {
        if (ve.Notes?.some((n) => n === targetNote)) {
          return step
        }
      }
    }
    cursor.next()
    step++
  }
  return null
}

function seekPreviewAtCursor(
  osmd: OpenSheetMusicDisplay,
  highlightedRef: { current: GraphicalNote[] },
  mixer: PlaybackMixer | null,
) {
  const notes = osmd.cursor.NotesUnderCursor()
  const pitched = notes.filter((n) => !n.isRest())
  if (pitched.length > 0) {
    highlightPlaybackNotes(osmd, pitched, highlightedRef, mixer)
  } else {
    resetPlaybackHighlights(highlightedRef)
  }
}

type PlaybackState = 'INIT' | 'PLAYING' | 'STOPPED' | 'PAUSED'

type PartControl = {
  instrumentIndex: number
  instrumentName: string
  midiId: number
  volume: number
  muted: boolean
  soloed: boolean
}

export default function App() {
  const scoreDivRef = useRef<HTMLDivElement | null>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  const engineRef = useRef<PlaybackEngine | null>(null)
  const mixerRef = useRef<PlaybackMixer | null>(null)
  const playbackHighlightedRef = useRef<GraphicalNote[]>([])
  const lastPayloadRef = useRef<LastScorePayload | null>(null)
  const printHostRef = useRef<HTMLDivElement | null>(null)
  const printIframeCleanupRef = useRef<(() => void) | null>(null)

  const [fileName, setFileName] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [errorText, setErrorText] = useState<string | null>(null)

  const [playbackState, setPlaybackState] = useState<PlaybackState>('INIT')
  const [bpm, setBpm] = useState<number>(100)
  const [parts, setParts] = useState<PartControl[]>([])
  const [horizontalStafflineLayout, setHorizontalStafflineLayout] = useState(false)
  const [printPageFormat, setPrintPageFormat] = useState<OsmdPagedFormatId>('A4_P')
  const [printBusy, setPrintBusy] = useState(false)

  const playbackScrollLayout: PlaybackScrollLayoutMode = horizontalStafflineLayout
    ? 'horizontal-strip'
    : 'default'
  const playbackScrollLayoutRef = useRef<PlaybackScrollLayoutMode>(playbackScrollLayout)
  playbackScrollLayoutRef.current = playbackScrollLayout

  const canPlay = status === 'ready' && (playbackState === 'STOPPED' || playbackState === 'PAUSED')
  const canPause = status === 'ready' && playbackState === 'PLAYING'
  const canStop = status === 'ready' && playbackState !== 'STOPPED' && playbackState !== 'INIT'

  const loadFromFileRef = useRef<(file: File) => Promise<void>>(async () => {})
  const fileDragHighlightRef = useRef(false)
  const [fileDragActive, setFileDragActive] = useState(false)

  const tempoLabel = useMemo(() => `${Math.round(bpm)} BPM`, [bpm])

  useEffect(() => {
    return () => {
      void engineRef.current?.stop()
    }
  }, [])

  /** 재생 중 수동 스크롤 후에도 강조 구간이 패널 밖으로 나가면 즉시 다시 스크롤 */
  useEffect(() => {
    if (playbackState !== 'PLAYING' || status !== 'ready') return undefined
    const timer = window.setInterval(() => {
      const osmd = osmdRef.current
      if (!osmd) return
      const gn = playbackHighlightedRef.current
      if (gn.length === 0) return
      scrollHighlightedNotesIntoView(
        scoreDivRef.current,
        gn,
        osmd.Zoom ?? 1,
        playbackScrollLayout,
      )
    }, PLAYBACK_SCROLL_KEEP_VISIBLE_MS)
    return () => clearInterval(timer)
  }, [playbackState, playbackScrollLayout, status])

  useEffect(() => {
    const clearDragUi = () => {
      fileDragHighlightRef.current = false
      setFileDragActive(false)
    }

    /** capture: Ionic / 하위 레이아웃보다 먼저 처리해 dragover 가 막히지 않게 함 */
    const onDragEnter = (e: DragEvent) => {
      if (!dataTransferLooksLikeExternalFiles(e.dataTransfer)) return
      e.preventDefault()
    }

    const onDragOver = (e: DragEvent) => {
      if (!dataTransferLooksLikeExternalFiles(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
      if (!fileDragHighlightRef.current) {
        fileDragHighlightRef.current = true
        setFileDragActive(true)
      }
    }

    const onDrop = (e: DragEvent) => {
      const file = pickAllowedDroppedFile(e.dataTransfer)
      if (!file) {
        clearDragUi()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      clearDragUi()
      void loadFromFileRef.current(file)
    }

    const onDragEnd = () => clearDragUi()

    const opts: AddEventListenerOptions = { capture: true }
    window.addEventListener('dragenter', onDragEnter, opts)
    window.addEventListener('dragover', onDragOver, opts)
    window.addEventListener('drop', onDrop, opts)
    window.addEventListener('dragend', onDragEnd, opts)

    return () => {
      window.removeEventListener('dragenter', onDragEnter, opts)
      window.removeEventListener('dragover', onDragOver, opts)
      window.removeEventListener('drop', onDrop, opts)
      window.removeEventListener('dragend', onDragEnd, opts)
    }
  }, [])

  function recreateOsmd(horizontalStrip: boolean) {
    const container = scoreDivRef.current
    if (!container) throw new Error('Score container missing')
    osmdRef.current?.clear()
    osmdRef.current = null
    container.innerHTML = ''
    /** `renderSingleHorizontalStaffline` 는 load 직전 — 옵션 바꿀 때마다 인스턴스를 새로 붙임 */
    osmdRef.current = new OpenSheetMusicDisplay(container, {
      followCursor: false,
      autoResize: true,
      darkMode: false,
      defaultColorMusic: DEFAULT_NOTE_COLOR,
      renderSingleHorizontalStaffline: horizontalStrip,
    })
  }

  async function ensurePlaybackEngine() {
    if (!scoreDivRef.current) throw new Error('Score container missing')

    if (!engineRef.current) {
      engineRef.current = new PlaybackEngine()
      mixerRef.current = new PlaybackMixer()

      const instrumentPlayer = (engineRef.current as any).instrumentPlayer as unknown
      if (instrumentPlayer && typeof (instrumentPlayer as any).schedule === 'function') {
        mixerRef.current.patchInstrumentPlayer(instrumentPlayer as any)
      }

      installInstrumentAwareNotePlayback(engineRef.current, () => mixerRef.current)

      const engine = engineRef.current
      engine.on(PlaybackEvent.ITERATION, (notes: Note[]) => {
        const osmd = osmdRef.current
        if (!osmd) return
        if (!notes?.length) {
          resetPlaybackHighlights(playbackHighlightedRef)
          return
        }
        highlightPlaybackNotes(osmd, notes, playbackHighlightedRef, mixerRef.current)
        /** 색·SVG 반영 다음 프레임에 스크롤 (한 번 더 지연하면 레이아웃 후 좌표가 안정적) */
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            scrollHighlightedNotesIntoView(
              scoreDivRef.current,
              playbackHighlightedRef.current,
              osmd.Zoom ?? 1,
              playbackScrollLayoutRef.current,
            )
          })
        })
      })
      engine.on(PlaybackEvent.STATE_CHANGE, (state: EnginePlaybackState) => {
        if (state === EnginePlaybackState.STOPPED) {
          resetPlaybackHighlights(playbackHighlightedRef)
        }
      })

      setPlaybackState(engine.state as PlaybackState)
    }
  }

  async function loadScoreIntoOsmdAndEngine(payload: LastScorePayload, horizontalStrip: boolean) {
    await ensurePlaybackEngine()
    recreateOsmd(horizontalStrip)

    const osmd = osmdRef.current!
    const engine = engineRef.current!

    if ((engine.state as PlaybackState) === 'PLAYING') await engine.stop()
    resetPlaybackHighlights(playbackHighlightedRef)

    if (payload.kind === 'mxl') {
      let blob = payload.blob
      try {
        blob = await normalizeMxlBlob(blob)
      } catch (err) {
        console.warn('[mxlplayer] MXL 정규화 실패 — 원본으로 로드합니다.', err)
      }
      await osmd.load(blob)
    } else {
      await osmd.load(payload.text)
    }

    osmd.render()

    await engine.loadScore(osmd)
    setPlaybackState(engine.state as PlaybackState)

    setBpm(engine.playbackSettings.bpm)
    setParts(buildPartControls(osmd))
  }

  async function loadFromFile(file: File) {
    try {
      setStatus('loading')
      setErrorText(null)
      setFileName(file.name)

      let payload: LastScorePayload
      const extension = file.name.toLowerCase().split('.').pop()
      if (extension === 'mxl') {
        const buf = await file.arrayBuffer()
        payload = { kind: 'mxl', blob: new Blob([buf]) }
      } else {
        const text = await file.text()
        payload = { kind: 'xml', text }
      }
      lastPayloadRef.current = payload

      await loadScoreIntoOsmdAndEngine(payload, horizontalStafflineLayout)
      setStatus('ready')
    } catch (e) {
      setStatus('error')
      setErrorText(e instanceof Error ? e.message : String(e))
      lastPayloadRef.current = null
    }
  }

  loadFromFileRef.current = loadFromFile

  async function onHorizontalStafflineToggle(enabled: boolean) {
    const payload = lastPayloadRef.current
    if (!payload || status !== 'ready') {
      setHorizontalStafflineLayout(enabled)
      return
    }
    if (enabled === horizontalStafflineLayout) return

    try {
      setStatus('loading')
      setErrorText(null)
      await loadScoreIntoOsmdAndEngine(payload, enabled)
      setHorizontalStafflineLayout(enabled)
      setStatus('ready')
    } catch (e) {
      setStatus('ready')
      setErrorText(e instanceof Error ? e.message : String(e))
    }
  }

  async function prepareAndPrintPagedScore() {
    const payload = lastPayloadRef.current
    if (!payload || status !== 'ready') return

    /**
     * OSMD는 포탈 `.score-print-host` 안에서 렌더한 뒤, **별도 iframe 문서를 `print`** 함.
     * 메인 Ionic 문서에서 `window.print()` 하면 미리보기가 빈 장으로 나오는 환경이 있음.
     */
    const host = printHostRef.current
    if (!host) return

    setPrintBusy(true)
    let printOsmd: OpenSheetMusicDisplay | null = null
    let cleaned = false

    const teardown = () => {
      if (cleaned) return
      cleaned = true
      printIframeCleanupRef.current?.()
      printIframeCleanupRef.current = null
      try {
        printOsmd?.clear()
      } catch {
        /* 이미 노드 없음 등 */
      }
      printOsmd = null
      host.innerHTML = ''
      setPrintBusy(false)
    }

    try {
      printIframeCleanupRef.current?.()
      printIframeCleanupRef.current = null
      host.innerHTML = ''

      const eng = engineRef.current
      if (eng && (eng.state as PlaybackState) === 'PLAYING') {
        await eng.pause()
        setPlaybackState(eng.state as PlaybackState)
      }

      const innerBox = getPrintableContentBoxMm(printPageFormat, PRINT_PAGE_MARGIN_MM)

      const pageStack = document.createElement('div')
      pageStack.className = 'score-print-page-stack'
      const printMount = document.createElement('div')
      printMount.className = 'score-print-mount'
      host.appendChild(pageStack)
      host.appendChild(printMount)

      printOsmd = new OpenSheetMusicDisplay(printMount, {
        followCursor: false,
        autoResize: false,
        darkMode: false,
        defaultColorMusic: DEFAULT_NOTE_COLOR,
        /** pageFormat 대신 인쇄 영역(mm)에 맞춘 커스텀 폭 — @page margin 과 합치 */
        renderSingleHorizontalStaffline: false,
      })

      printOsmd.setCustomPageFormat(innerBox.widthMm, innerBox.heightMm)

      /** OSMD render() 가 `container.offsetWidth` 로 페이지 폭을 잡음 — load 전에 맞춤(OSMD 붙는 노드는 mount) */
      sizePrintHostToContentBoxMm(printMount, innerBox.widthMm, innerBox.heightMm)

      let loadSource: Blob | string =
        payload.kind === 'mxl' ? payload.blob : payload.text
      if (payload.kind === 'mxl') {
        try {
          loadSource = await normalizeMxlBlob(payload.blob)
        } catch (err) {
          console.warn('[mxlplayer] MXL 정규화 실패(인쇄) — 원본으로 로드합니다.', err)
        }
      }
      await printOsmd.load(loadSource)
      
      const rules = printOsmd.EngravingRules
      rules.RenderSingleHorizontalStaffline = false
      rules.RenderClefsAtBeginningOfStaffline = true
      rules.RenderKeySignatures = true
      rules.RenderTimeSignatures = true
      
      // 악보 크기를 줄여 한 줄에 최소 4마디 이상 들어가도록 유도
      printOsmd.Zoom = 0.55 
      
      printOsmd.render()

      // OSMD가 내부적으로 자동 생성한 다중 페이지(SVG/Canvas)들을 pageStack으로 이동
      const pages = Array.from(printMount.children)
      for (const page of pages) {
        const wrap = document.createElement('div')
        wrap.className = 'print-score-sheet'
        wrap.appendChild(page)
        pageStack.appendChild(wrap)
      }

      /** SVG/Vex 레이아웃 확정까지 — 메인 문서라 iframe 0영역 백지와 달리 OSMD가 실제 박스로 그림 */
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())),
      )

      if (pageStack.childElementCount === 0) {
        setErrorText('인쇄용 페이지를 만들 수 없습니다. 악보를 다시 불러온 뒤 시도해 보세요.')
        teardown()
        return
      }

      const safetyFallback = window.setTimeout(teardown, 120_000)

      const endSession = () => {
        window.clearTimeout(safetyFallback)
        teardown()
      }

      printIframeCleanupRef.current = printScorePageStackInIframe(
        pageStack,
        PRINT_CSS_PAGE_SIZE[printPageFormat],
        PRINT_PAGE_MARGIN_MM,
        endSession,
      )
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : String(e))
      teardown()
    }
  }

  async function onPlay() {
    const engine = engineRef.current
    if (!engine) return
    await engine.play()
    setPlaybackState(engine.state as PlaybackState)
  }

  function onPause() {
    const engine = engineRef.current
    if (!engine) return
    engine.pause()
    setPlaybackState(engine.state as PlaybackState)
  }

  async function onStop() {
    const engine = engineRef.current
    if (!engine) return
    await engine.stop()
    setPlaybackState(engine.state as PlaybackState)
  }

  function onBpmChange(next: number) {
    setBpm(next)
    const engine = engineRef.current
    if (!engine) return
    engine.setBpm(Math.round(next))
  }

  function updatePart(instrumentIndex: number, patch: Partial<Pick<PartControl, 'volume' | 'muted' | 'soloed'>>) {
    const mixer = mixerRef.current
    if (!mixer) return

    setParts((prev) =>
      prev.map((p) => {
        if (p.instrumentIndex !== instrumentIndex) return p
        const next = { ...p, ...patch }
        mixer.setVolume(instrumentIndex, next.volume)
        mixer.setMuted(instrumentIndex, next.muted)
        mixer.setSoloed(instrumentIndex, next.soloed)
        return next
      }),
    )
  }

  function handleScoreSeek(event: MouseEvent<HTMLDivElement>) {
    if (status !== 'ready') return

    const osmd = osmdRef.current
    const engine = engineRef.current
    const gfx = osmd?.GraphicSheet
    if (!osmd || !engine?.ready || !gfx) return

    event.preventDefault()
    event.stopPropagation()

    const domPt = new PointF2D(event.clientX, event.clientY)
    let svgPt: PointF2D
    try {
      svgPt = gfx.domToSvg(domPt)
    } catch {
      return
    }
    const osmdPt = gfx.svgToOsmd(svgPt)
    const gNote = gfx.GetNearestNote(osmdPt, new PointF2D(8, 8))
    if (!gNote) return

    const targetNote = gNote.sourceNote

    const step = findPlaybackStepForNote(osmd, targetNote)
    if (step === null) return

    engine.jumpToStep(step)
    setPlaybackState(engine.state as PlaybackState)
    seekPreviewAtCursor(osmd, playbackHighlightedRef, mixerRef.current)
  }

  return (
    <>
      <IonApp>
      <div className={fileDragActive ? 'app-shell app-shell--file-drag' : 'app-shell'}>
        <div className="sidebar">
          <IonHeader>
            <IonToolbar>
              <IonTitle>MXL Player</IonTitle>
              <IonButtons slot="end">
                <IonBadge color={status === 'ready' ? 'success' : status === 'loading' ? 'warning' : 'medium'}>
                  {status.toUpperCase()}
                </IonBadge>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent>
            <IonList inset>
              <IonItem lines="full">
                <IonLabel>
                  <div className="label-title">MusicXML / MXL 업로드</div>
                  <div className="label-subtitle">
                    {fileName ?? '파일을 선택하거나 앱으로 드래그 (.xml / .musicxml / .mxl)'}
                  </div>
                </IonLabel>
                <input
                  className="file-input"
                  type="file"
                  accept=".xml,.musicxml,.mxl"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void loadFromFile(f)
                  }}
                />
              </IonItem>

              {errorText ? (
                <IonItem color="danger">
                  <IonLabel className="error-text">{errorText}</IonLabel>
                </IonItem>
              ) : null}
            </IonList>

            <IonList inset>
              <IonItem>
                <IonLabel>재생</IonLabel>
                <IonButtons slot="end">
                  <IonButton disabled={!canPlay} onClick={() => void onPlay()}>
                    <IonIcon slot="start" icon={play} />
                    Play
                  </IonButton>
                  <IonButton disabled={!canPause} onClick={onPause}>
                    <IonIcon slot="start" icon={pause} />
                    Pause
                  </IonButton>
                  <IonButton disabled={!canStop} onClick={() => void onStop()}>
                    <IonIcon slot="start" icon={stop} />
                    Stop
                  </IonButton>
                </IonButtons>
              </IonItem>
              <IonItem>
                <IonLabel>
                  템포 <span className="mono">{tempoLabel}</span>
                </IonLabel>
              </IonItem>
              <IonItem lines="none">
                <IonRange
                  min={30}
                  max={240}
                  step={1}
                  value={bpm}
                  disabled={status !== 'ready' || playbackState === 'PLAYING'}
                  onIonChange={(e) => onBpmChange(Number(e.detail.value))}
                />
              </IonItem>
            </IonList>

            <IonList inset>
              <IonItem>
                <IonLabel>
                  <div className="label-title">가로 한 줄 악보</div>
                  <div className="label-subtitle">
                    OSMD 한 줄 가로 보표 — 재생 시 가로 스크롤로 따라갑니다. 켤 때 악보를 다시 배치합니다.
                  </div>
                </IonLabel>
                <IonToggle
                  slot="end"
                  checked={horizontalStafflineLayout}
                  disabled={status === 'loading'}
                  onIonChange={(e) => void onHorizontalStafflineToggle(Boolean(e.detail.checked))}
                />
              </IonItem>
              <IonItem>
                <IonSelect
                  label="인쇄 용지 (OSMD)"
                  labelPlacement="stacked"
                  value={printPageFormat}
                  interface="popover"
                  disabled={status === 'loading' || printBusy}
                  onIonChange={(e) => setPrintPageFormat(String(e.detail.value) as OsmdPagedFormatId)}
                >
                  <IonSelectOption value="A4_P">A4 세로</IonSelectOption>
                  <IonSelectOption value="A4_L">A4 가로</IonSelectOption>
                  <IonSelectOption value="Letter_P">Letter 세로</IonSelectOption>
                  <IonSelectOption value="Letter_L">Letter 가로</IonSelectOption>
                </IonSelect>
              </IonItem>
              <IonItem lines="none">
                <IonLabel className="muted print-hint">
                  인쇄는 화면의「가로 한 줄」레이아웃과 달리, OSMD 표준 페이지로 여러 장에 나눕니다(각 줄머리에 음자리·조표·박자표 등이 붙음). 브라우저 인쇄 배율은 100%
                  권장 — 악보는 앱 안에서 줄입니다.
                </IonLabel>
              </IonItem>
              <IonItem lines="none">
                <IonButton
                  expand="block"
                  disabled={status !== 'ready' || printBusy}
                  onClick={() => void prepareAndPrintPagedScore()}
                >
                  <IonIcon slot="start" icon={printIcon} />
                  선택한 용지로 인쇄
                </IonButton>
              </IonItem>
            </IonList>

            <IonList inset>
              <IonItem>
                <IonLabel>파트별 Solo / Mute / 볼륨</IonLabel>
              </IonItem>
              {parts.length === 0 ? (
                <IonItem lines="none">
                  <IonLabel className="muted">악보를 불러오면 파트 목록이 표시됩니다.</IonLabel>
                </IonItem>
              ) : (
                parts.map((p) => (
                  <IonItem key={p.instrumentIndex} className="part-item">
                    <IonLabel>
                      <div className="label-title">{p.instrumentName}</div>
                      <div className="label-subtitle">MIDI #{p.midiId}</div>
                    </IonLabel>
                    <div className="part-controls">
                      <div className="part-row">
                        <IonLabel className="mini">VOL</IonLabel>
                        <IonRange
                          className="part-range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={p.volume}
                          onIonChange={(e) => updatePart(p.instrumentIndex, { volume: Number(e.detail.value) })}
                        />
                      </div>
                      <div className="part-row toggles">
                        <IonToggle
                          checked={p.soloed}
                          onIonChange={(e) => updatePart(p.instrumentIndex, { soloed: e.detail.checked })}
                        >
                          Solo
                        </IonToggle>
                        <IonToggle
                          checked={p.muted}
                          onIonChange={(e) => updatePart(p.instrumentIndex, { muted: e.detail.checked })}
                        >
                          Mute
                        </IonToggle>
                      </div>
                    </div>
                  </IonItem>
                ))
              )}
            </IonList>

            <div className="footer-note">
              <div className="muted">
                재생 중인 음표만 빨간색으로 강조됩니다. (커서 막대는 표시하지 않습니다.) 악보를 클릭하면 클릭한 음표·쉼표 위치부터 재생이 시작됩니다.
              </div>
            </div>
          </IonContent>
        </div>

        <div className="main score-panel">
          <IonHeader>
            <IonToolbar>
              <IonTitle>Score</IonTitle>
              <IonButtons slot="end">
                <IonBadge color="medium">{playbackState}</IonBadge>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent>
            <div className="score-surface">
              <div
                ref={scoreDivRef}
                className={[
                  'score-div',
                  status === 'ready' ? 'score-div--seekable' : '',
                  horizontalStafflineLayout ? 'score-div--horizontal-strip' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={handleScoreSeek}
                title={status === 'ready' ? '클릭하여 재생 시작 위치 설정' : undefined}
              />
            </div>
          </IonContent>
        </div>
      </div>
      </IonApp>
      {typeof document !== 'undefined'
        ? createPortal(
            <div ref={printHostRef} className="score-print-host" aria-hidden="true" />,
            document.body,
          )
        : null}
    </>
  )
}

function buildPartControls(osmd: OpenSheetMusicDisplay): PartControl[] {
  const instruments = osmd.Sheet?.Instruments ?? []
  return instruments.map((inst, idx) => ({
    instrumentIndex: idx,
    instrumentName: inst.Name ?? `Instrument ${idx + 1}`,
    midiId: inst.MidiInstrumentId ?? 0,
    volume: 1,
    muted: false,
    soloed: false,
  }))
}

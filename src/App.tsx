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
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/react'
import { pause, play, stop } from 'ionicons/icons'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { GraphicalNote, Note } from 'opensheetmusicdisplay'
import { OpenSheetMusicDisplay, PointF2D } from 'opensheetmusicdisplay'
import PlaybackEngine from 'osmd-audio-player'
import { PlaybackEvent, PlaybackState as EnginePlaybackState } from 'osmd-audio-player/dist/PlaybackEngine'
import { getInstrumentIndexFromNote } from './audio/instrumentIndexFromNote'
import { PlaybackMixer } from './audio/playbackMixer'
import { installInstrumentAwareNotePlayback } from './audio/playbackNoteCallbackPatch'
import { scrollHighlightedNotesIntoView, PLAYBACK_SCROLL_KEEP_VISIBLE_MS } from './audio/playbackScroll'
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

  const [fileName, setFileName] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [errorText, setErrorText] = useState<string | null>(null)

  const [playbackState, setPlaybackState] = useState<PlaybackState>('INIT')
  const [bpm, setBpm] = useState<number>(100)
  const [parts, setParts] = useState<PartControl[]>([])

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
      scrollHighlightedNotesIntoView(scoreDivRef.current, gn, osmd.Zoom ?? 1)
    }, PLAYBACK_SCROLL_KEEP_VISIBLE_MS)
    return () => clearInterval(timer)
  }, [playbackState, status])

  useEffect(() => {
    const hasFiles = (dt: DataTransfer | null) => dt?.types?.includes('Files') ?? false

    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
      if (!fileDragHighlightRef.current) {
        fileDragHighlightRef.current = true
        setFileDragActive(true)
      }
    }

    const clearDragUi = () => {
      fileDragHighlightRef.current = false
      setFileDragActive(false)
    }

    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return
      e.preventDefault()
      clearDragUi()
      const file = Array.from(e.dataTransfer?.files ?? []).find(isAllowedScoreFile)
      if (file) void loadFromFileRef.current(file)
    }

    const onDragEnd = () => clearDragUi()

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', onDragEnd)

    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [])

  async function ensureEngines() {
    if (!scoreDivRef.current) throw new Error('Score container missing')

    if (!osmdRef.current) {
      osmdRef.current = new OpenSheetMusicDisplay(scoreDivRef.current, {
        /** 커서 next() 한 줄 기준 스크롤은 다성부+피아노 묶음에서 한 스태프만 보일 수 있음 → 재생 시 직접 스크롤 */
        followCursor: false,
        autoResize: true,
        darkMode: false,
        defaultColorMusic: DEFAULT_NOTE_COLOR,
      })
    }

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

  async function loadFromFile(file: File) {
    try {
      setStatus('loading')
      setErrorText(null)
      setFileName(file.name)

      await ensureEngines()
      const osmd = osmdRef.current!
      const engine = engineRef.current!

      if ((engine.state as PlaybackState) === 'PLAYING') await engine.stop()
      resetPlaybackHighlights(playbackHighlightedRef)

      const extension = file.name.toLowerCase().split('.').pop()
      if (extension === 'mxl') {
        const buf = await file.arrayBuffer()
        await osmd.load(new Blob([buf]))
      } else {
        const text = await file.text()
        await osmd.load(text)
      }

      await osmd.render()

      await engine.loadScore(osmd)
      setPlaybackState(engine.state as PlaybackState)

      setBpm(engine.playbackSettings.bpm)
      setParts(buildPartControls(osmd))
      setStatus('ready')
    } catch (e) {
      setStatus('error')
      setErrorText(e instanceof Error ? e.message : String(e))
    }
  }

  loadFromFileRef.current = loadFromFile

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
                className={status === 'ready' ? 'score-div score-div--seekable' : 'score-div'}
                onClick={handleScoreSeek}
                title={status === 'ready' ? '클릭하여 재생 시작 위치 설정' : undefined}
              />
            </div>
          </IonContent>
        </div>
      </div>
    </IonApp>
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

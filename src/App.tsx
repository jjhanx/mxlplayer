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
import { useEffect, useMemo, useRef, useState } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import PlaybackEngine from 'osmd-audio-player'
import { PlaybackMixer } from './audio/playbackMixer'
import './App.css'

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

  const [fileName, setFileName] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [errorText, setErrorText] = useState<string | null>(null)

  const [playbackState, setPlaybackState] = useState<PlaybackState>('INIT')
  const [bpm, setBpm] = useState<number>(100)
  const [parts, setParts] = useState<PartControl[]>([])

  const canPlay = status === 'ready' && (playbackState === 'STOPPED' || playbackState === 'PAUSED')
  const canPause = status === 'ready' && playbackState === 'PLAYING'
  const canStop = status === 'ready' && playbackState !== 'STOPPED' && playbackState !== 'INIT'

  const tempoLabel = useMemo(() => `${Math.round(bpm)} BPM`, [bpm])

  useEffect(() => {
    return () => {
      void engineRef.current?.stop()
    }
  }, [])

  async function ensureEngines() {
    if (!scoreDivRef.current) throw new Error('Score container missing')

    if (!osmdRef.current) {
      osmdRef.current = new OpenSheetMusicDisplay(scoreDivRef.current, {
        followCursor: true,
        autoResize: true,
      })
    }

    if (!engineRef.current) {
      engineRef.current = new PlaybackEngine()
      mixerRef.current = new PlaybackMixer()

      const instrumentPlayer = (engineRef.current as any).instrumentPlayer as unknown
      if (instrumentPlayer && typeof (instrumentPlayer as any).schedule === 'function') {
        mixerRef.current.patchInstrumentPlayer(instrumentPlayer as any)
      }

      setPlaybackState(engineRef.current.state as PlaybackState)
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

  function updatePart(midiId: number, patch: Partial<Pick<PartControl, 'volume' | 'muted' | 'soloed'>>) {
    const mixer = mixerRef.current
    if (!mixer) return

    setParts((prev) =>
      prev.map((p) => {
        if (p.midiId !== midiId) return p
        const next = { ...p, ...patch }
        mixer.setVolume(midiId, next.volume)
        mixer.setMuted(midiId, next.muted)
        mixer.setSoloed(midiId, next.soloed)
        return next
      }),
    )
  }

  return (
    <IonApp>
      <div className="app-shell">
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
                  <div className="label-subtitle">{fileName ?? '파일을 선택하세요 (.xml / .musicxml / .mxl)'}</div>
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
                  <IonItem key={`${p.instrumentIndex}-${p.midiId}`} className="part-item">
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
                          onIonChange={(e) => updatePart(p.midiId, { volume: Number(e.detail.value) })}
                        />
                      </div>
                      <div className="part-row toggles">
                        <IonToggle
                          checked={p.soloed}
                          onIonChange={(e) => updatePart(p.midiId, { soloed: e.detail.checked })}
                        >
                          Solo
                        </IonToggle>
                        <IonToggle
                          checked={p.muted}
                          onIonChange={(e) => updatePart(p.midiId, { muted: e.detail.checked })}
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
                Follow-along 하이라이트는 OSMD 커서 기능을 사용합니다. (재생 시 현재 음표 위치가 따라갑니다.)
              </div>
            </div>
          </IonContent>
        </div>

        <div className="main">
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
              <div ref={scoreDivRef} className="score-div" />
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

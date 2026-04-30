declare module 'osmd-audio-player' {
  import type { OpenSheetMusicDisplay, Instrument } from 'opensheetmusicdisplay'

  export enum PlaybackState {
    INIT = 'INIT',
    PLAYING = 'PLAYING',
    STOPPED = 'STOPPED',
    PAUSED = 'PAUSED',
  }

  export enum PlaybackEvent {
    STATE_CHANGE = 'state-change',
    ITERATION = 'iteration',
  }

  export type PlaybackInstrument = {
    midiId: number
    name: string
    loaded: boolean
  }

  export default class PlaybackEngine {
    playbackSettings: { bpm: number; masterVolume: number }
    state: PlaybackState
    availableInstruments: PlaybackInstrument[]
    scoreInstruments: Instrument[]
    ready: boolean

    loadScore: (osmd: OpenSheetMusicDisplay) => Promise<void>
    play: () => Promise<void>
    pause: () => void
    stop: () => Promise<void>
    jumpToStep: (step: number) => void
    setBpm: (bpm: number) => void
    on: (event: PlaybackEvent, cb: (...args: any[]) => void) => void
  }
}


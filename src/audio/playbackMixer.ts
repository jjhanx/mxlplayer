export type NotePlaybackInstruction = {
  note: number
  duration: number
  gain: number
  articulation?: unknown
}

type InstrumentPlayerLike = {
  schedule: (midiId: number, time: number, notes: NotePlaybackInstruction[]) => void
  stop: (midiId: number) => void
}

/**
 * 파트별 제어는 OSMD Sheet.Instruments 순번(instrumentIndex)으로 한다.
 * (동일 MIDI GM 번호를 쓰는 파트도 UI·믹싱에서 분리된다.)
 * 실제 스케줄링 시점의 게인은 `playbackNoteCallbackPatch`에서 적용한다.
 */
export class PlaybackMixer {
  private readonly volumes = new Map<number, number>()
  private readonly muted = new Set<number>()
  private readonly soloed = new Set<number>()
  private master = 1

  setMasterVolume(v: number) {
    this.master = clamp01(v)
  }

  setVolume(instrumentIndex: number, v: number) {
    this.volumes.set(instrumentIndex, clamp01(v))
  }

  setMuted(instrumentIndex: number, isMuted: boolean) {
    if (isMuted) this.muted.add(instrumentIndex)
    else this.muted.delete(instrumentIndex)
  }

  setSoloed(instrumentIndex: number, isSoloed: boolean) {
    if (isSoloed) this.soloed.add(instrumentIndex)
    else this.soloed.delete(instrumentIndex)
  }

  /** Solo/Mute로 이 파트를 완전히 끌지 (스케줄에서 제외) */
  shouldSilenceInstrument(instrumentIndex: number): boolean {
    if (this.soloed.size > 0 && !this.soloed.has(instrumentIndex)) return true
    if (this.muted.has(instrumentIndex)) return true
    return false
  }

  /** 마스터 × 파트 볼륨 (0–1) */
  effectiveInstrumentGain(instrumentIndex: number): number {
    return this.master * (this.volumes.get(instrumentIndex) ?? 1)
  }

  /** osmd-audio-player InstrumentPlayer — 게인은 콜백 패치에서 처리하므로 래핑 없음 */
  patchInstrumentPlayer(_player: InstrumentPlayerLike) {
    /* 게인·뮤트는 installInstrumentAwareNotePlayback 에서 처리 */
  }
}

function clamp01(v: number) {
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(1, v))
}

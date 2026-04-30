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

export class PlaybackMixer {
  private readonly volumes = new Map<number, number>()
  private readonly muted = new Set<number>()
  private readonly soloed = new Set<number>()
  private master = 1

  setMasterVolume(v: number) {
    this.master = clamp01(v)
  }

  setVolume(midiId: number, v: number) {
    this.volumes.set(midiId, clamp01(v))
  }

  setMuted(midiId: number, isMuted: boolean) {
    if (isMuted) this.muted.add(midiId)
    else this.muted.delete(midiId)
  }

  setSoloed(midiId: number, isSoloed: boolean) {
    if (isSoloed) this.soloed.add(midiId)
    else this.soloed.delete(midiId)
  }

  isMuted(midiId: number) {
    return this.muted.has(midiId)
  }

  isSoloed(midiId: number) {
    return this.soloed.has(midiId)
  }

  getVolume(midiId: number) {
    return this.volumes.get(midiId) ?? 1
  }

  patchInstrumentPlayer(player: InstrumentPlayerLike) {
    const originalSchedule = player.schedule.bind(player)
    const originalStop = player.stop.bind(player)

    player.schedule = (midiId, time, notes) => {
      if (this.shouldSkip(midiId)) return
      const gainMultiplier = this.master * this.getVolume(midiId)
      if (gainMultiplier === 1) return originalSchedule(midiId, time, notes)

      originalSchedule(
        midiId,
        time,
        notes.map((n) => ({ ...n, gain: n.gain * gainMultiplier })),
      )
    }

    player.stop = (midiId) => {
      originalStop(midiId)
    }
  }

  private shouldSkip(midiId: number) {
    if (this.soloed.size > 0 && !this.soloed.has(midiId)) return true
    if (this.muted.has(midiId)) return true
    return false
  }
}

function clamp01(v: number) {
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(1, v))
}


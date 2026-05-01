/**
 * osmd-audio-player PlaybackEngine.notePlaybackCallback 과 동일하되,
 * Solo/Mute/볼륨을 MIDI 번호가 아니라 악기(파트) 인덱스별로 적용한다.
 */
import type { Note } from 'opensheetmusicdisplay'
import type PlaybackEngine from 'osmd-audio-player'
import { PlaybackEvent } from 'osmd-audio-player/dist/PlaybackEngine'
import type { NotePlaybackInstruction } from './playbackMixer'
import type { PlaybackMixer } from './playbackMixer'
import { getInstrumentIndexFromNote } from './instrumentIndexFromNote'

enum ArticulationStyle {
  None,
  Staccato,
  Legato,
}

function getArticulationStyle(note: Note): ArticulationStyle {
  return note.ParentVoiceEntry.isStaccato() ? ArticulationStyle.Staccato : ArticulationStyle.None
}

function getNoteDuration(note: Note, wholeNoteLength: number): number {
  let duration = note.Length.RealValue * wholeNoteLength
  if (note.NoteTie) {
    if (Object.is(note.NoteTie.StartNote, note) && note.NoteTie.Notes[1]) {
      duration += note.NoteTie.Notes[1].Length.RealValue * wholeNoteLength
    } else {
      duration = 0
    }
  }
  return duration
}

export function installInstrumentAwareNotePlayback(
  engine: PlaybackEngine,
  getMixer: () => PlaybackMixer | null,
): void {
  const eng = engine as unknown as {
    state: string
    wholeNoteLength: number
    instrumentPlayer: {
      schedule: (midiId: number, time: number, notes: NotePlaybackInstruction[]) => void
    }
    ac: { currentTime: number }
    timeoutHandles: number[]
    events: { emit: (ev: PlaybackEvent, notes: Note[]) => void }
    iterationCallback: () => void
    notePlaybackCallback: (audioDelay: number, notes: Note[]) => void
  }

  eng.notePlaybackCallback = function instrumentAwareNotePlayback(audioDelay: number, notes: Note[]) {
    if (this.state !== 'PLAYING') return

    const mixer = getMixer()
    const scheduledByMidi = new Map<number, NotePlaybackInstruction[]>()

    for (const note of notes) {
      if (note.isRest()) continue

      const instrIdx = getInstrumentIndexFromNote(note)
      if (mixer?.shouldSilenceInstrument(instrIdx)) continue

      const duration = getNoteDuration(note, this.wholeNoteLength)
      if (duration === 0) continue

      const noteVolume = note.ParentVoiceEntry.ParentVoice.Volume
      const articulation = getArticulationStyle(note)
      const midiPlaybackInstrument = (
        note as unknown as {
          ParentVoiceEntry: { ParentVoice: { midiInstrumentId: number } }
        }
      ).ParentVoiceEntry.ParentVoice.midiInstrumentId
      const fixedKey = note.ParentVoiceEntry.ParentVoice.Parent.SubInstruments?.[0]?.fixedKey ?? 0

      const gain = noteVolume * (mixer?.effectiveInstrumentGain(instrIdx) ?? 1)

      if (!scheduledByMidi.has(midiPlaybackInstrument)) {
        scheduledByMidi.set(midiPlaybackInstrument, [])
      }
      scheduledByMidi.get(midiPlaybackInstrument)!.push({
        note: note.halfTone - fixedKey * 12,
        duration: duration / 1000,
        gain,
        articulation,
      })
    }

    for (const [midiId, batch] of scheduledByMidi) {
      this.instrumentPlayer.schedule(midiId, this.ac.currentTime + audioDelay, batch)
    }

    this.timeoutHandles.push(
      window.setTimeout(
        () => this.iterationCallback(),
        Math.max(0, audioDelay * 1000 - 35),
      ),
      window.setTimeout(() => this.events.emit(PlaybackEvent.ITERATION, notes), audioDelay * 1000),
    )
  }
}

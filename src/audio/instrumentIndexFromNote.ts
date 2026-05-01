import type { Instrument, Note } from 'opensheetmusicdisplay'

/**
 * OSMD `Sheet.Instruments` 배열 번호와 동일한 파트 인덱스.
 * 렌더 백엔드 등으로 인해 `Instruments[i]`와 참조가 달라지면 `indexOf`가 실패하므로
 * `Id` / `IdString`으로도 매칭한다.
 */
export function getInstrumentIndexFromNote(note: Note): number {
  const inst = note.ParentVoiceEntry.ParentVoice.Parent as Instrument
  const instruments = inst.GetMusicSheet?.Instruments
  if (!instruments?.length) return 0

  let idx = instruments.indexOf(inst)
  if (idx >= 0) return idx

  idx = instruments.findIndex((i) => i.Id === inst.Id)
  if (idx >= 0) return idx

  idx = instruments.findIndex((i) => i.IdString === inst.IdString)
  return idx >= 0 ? idx : 0
}

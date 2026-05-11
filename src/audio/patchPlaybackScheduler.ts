/**
 * osmd-audio-player 0.7.0 보완
 *
 * 1) reset()이 clearInterval(this.scheduleInterval) 로 잘못 호출됨 → 타이머가 안 지워져
 *    setInterval 이 누적 → 템포가 점점 빨라짐. schedulerIntervalHandle 로 정리.
 *
 * 2) 브라우저가 탭을 백그라운드로 두거나 setInterval 이 크게 밀리면(수백 ms 이상) currentTick 이
 *    한 번에 점프해 timeToTick 이 0으로 몰리는 버스트가 난다.
 *    → 그런 **비정상 지연**일 때만 틱 증가량을 상한한다. 통상 ~200ms 간격 재생에서는 `calculatedTick`을
 *    그대로 써서 오디오 시계와 음표 타이밍이 어긋나 **느껴지는 가속**이 나지 않게 한다.
 *    reset 시 WeakMap 샘플도 초기화.
 *
 * 3) start() 에서 기존 interval 을 항상 지운 뒤 하나만 등록 → 같은 인스턴스 이중 인터벌 방지.
 *
 * (loadScore 시 이전 Scheduler 정리는 patchPlaybackEngine.ts)
 *
 * 4) loadNotes() 가 getFirstEmptyTick() 으로 다음 단계 시작 틱을 잡는데, 플레이스홀더·다성부·백업 처리에
 *    따라 “빈 슬롯”이 앞쪽으로 당겨져 음표 간격이 점점 압축(체감 가속)될 수 있음.
 *    OSMD VoiceEntry 의 절대 시각(ParentSourceStaffEntry.AbsoluteTimestamp)으로 틱을 직접 계산함.
 */
import PlaybackScheduler from 'osmd-audio-player/dist/PlaybackScheduler.js'

/** OSMD VoiceEntry — PlaybackScheduler 에 넘어오는 구조만 추출 */
type OsmdVoiceEntry = {
  IsGrace?: boolean
  Notes?: { Length?: { RealValue: number } }[]
  ParentSourceStaffEntry?: {
    AbsoluteTimestamp?: { RealValue: number }
  }
}

type StepQueueOps = {
  steps: { tick: number; notes: unknown[] }[]
  sort: () => void
  addNote: (tick: number, note: unknown) => void
  createStep: (tick: number) => unknown
  getFirstEmptyTick: () => number
}

type SchedulerLike = {
  playing: boolean
  currentTick: number
  currentTickTimestamp: number
  stepQueueIndex: number
  audioContextStartTime: number
  schedulerIntervalHandle: number | ReturnType<typeof window.setInterval> | null
  schedulePeriod: number
  scheduleInterval: number
  wholeNoteLength: number
  tickDenominator: number
  audioContextTime: number
  calculatedTick: number
  audioContext: { currentTime: number } | null
  stepQueue: { steps: { tick: number; notes: unknown[] }[]; sort: () => void }
  scheduledTicks: Set<number>
  noteSchedulingCallback: (delaySeconds: number, notes: unknown[]) => void
  nextTickAvailableAndWithinSchedulePeriod: (nextTick: number | undefined) => boolean
  scheduleIterationStep: () => void
}

type SchedulerTimeline = SchedulerLike & {
  /** 첫 재생 포인트의 AbsoluteTimestamp.RealValue → 이후 틱은 (현재−원점)×denominator + lastTickOffset */
  timelineOriginWhole?: number
  lastTickOffset: number
  tickDenominator: number
  stepQueue: StepQueueOps
}

const lastScheduleAudioSampleMs = new WeakMap<object, number>()

function appendVoiceEntriesAtTick(this: SchedulerTimeline, ves: OsmdVoiceEntry[], thisTick: number): void {
  for (const entry of ves) {
    if (entry.IsGrace) continue
    for (const note of entry.Notes ?? []) {
      const len = note.Length?.RealValue
      if (len === undefined || Number.isNaN(len)) continue
      this.stepQueue.addNote(thisTick, note)
      this.stepQueue.createStep(thisTick + len * this.tickDenominator)
    }
  }
}

const proto = PlaybackScheduler.prototype as unknown as {
  start: (this: SchedulerLike) => void
  scheduleIterationStep: (this: SchedulerLike) => void
  reset: (this: SchedulerTimeline) => void
  loadNotes: (this: SchedulerTimeline, entries: OsmdVoiceEntry[]) => void
}

proto.loadNotes = function loadNotesAbsoluteTime(this: SchedulerTimeline, ves: OsmdVoiceEntry[]): void {
  if (!ves?.length) return

  /** 동시 진행 레이어는 동일 절대시각을 쓰지만, 배열 순서가 달라질 수 있어 최소값 사용 */
  let stamp: number | undefined
  for (const entry of ves) {
    const t = entry.ParentSourceStaffEntry?.AbsoluteTimestamp?.RealValue
    if (t === undefined || Number.isNaN(t)) continue
    stamp = stamp === undefined ? t : Math.min(stamp, t)
  }

  let thisTick: number
  if (stamp === undefined) {
    /** 라이브러리 기본 loadNotes 는 Length 없으면 throw — 동일 로직에 안전 가드 */
    thisTick = this.lastTickOffset
    if (this.stepQueue.steps.length > 0) {
      thisTick = this.stepQueue.getFirstEmptyTick()
    }
  } else {
    if (this.timelineOriginWhole === undefined) {
      this.timelineOriginWhole = stamp
    }
    thisTick =
      Math.round((stamp - this.timelineOriginWhole) * this.tickDenominator) + this.lastTickOffset
  }

  appendVoiceEntriesAtTick.call(this, ves, thisTick)
}

proto.start = function startPatched(this: SchedulerLike): void {
  this.playing = true
  this.stepQueue.sort()
  if (this.schedulerIntervalHandle != null) {
    window.clearInterval(this.schedulerIntervalHandle)
    this.schedulerIntervalHandle = null
  }
  this.audioContextStartTime = this.audioContext!.currentTime
  this.currentTickTimestamp = this.audioContextTime
  this.schedulerIntervalHandle = window.setInterval(
    () => this.scheduleIterationStep(),
    this.scheduleInterval,
  )
}

proto.scheduleIterationStep = function scheduleIterationStepPatched(
  this: SchedulerLike,
): void {
  if (!this.playing) return

  const audioNow = this.audioContextTime
  let prev = lastScheduleAudioSampleMs.get(this as object)
  if (prev === undefined || prev > audioNow) prev = audioNow
  const elapsedMs = Math.max(0, audioNow - prev)
  lastScheduleAudioSampleMs.set(this as object, audioNow)

  const tickDuration = this.wholeNoteLength / this.tickDenominator
  const rawTick = this.calculatedTick
  /** 정상 주기(200ms)보다 유의미하게 밀렸을 때만 점프 상한 (백그라운드 탭 등) */
  const lagGuardMs = this.scheduleInterval * 3
  let newTick = rawTick
  if (elapsedMs > lagGuardMs) {
    const elapsedTicks = Math.ceil((elapsedMs + this.scheduleInterval) / tickDuration)
    const perFrameCeilingTicks = Math.ceil(
      (this.schedulePeriod * 2 + this.scheduleInterval * 2) / tickDuration,
    )
    const maxTickAdvance = Math.max(1, Math.min(elapsedTicks, perFrameCeilingTicks))
    newTick = Math.min(rawTick, this.currentTick + maxTickAdvance)
  }
  this.currentTick = newTick
  this.currentTickTimestamp = this.audioContextTime

  let nextTick = this.stepQueue.steps[this.stepQueueIndex]?.tick
  while (this.nextTickAvailableAndWithinSchedulePeriod(nextTick)) {
    const step = this.stepQueue.steps[this.stepQueueIndex]
    let timeToTick = (step.tick - this.currentTick) * tickDuration
    if (timeToTick < 0) timeToTick = 0
    this.scheduledTicks.add(step.tick)
    this.noteSchedulingCallback(timeToTick / 1000, step.notes)
    this.stepQueueIndex++
    nextTick = this.stepQueue.steps[this.stepQueueIndex]?.tick
  }
  for (const tick of this.scheduledTicks) {
    if (tick <= this.currentTick) this.scheduledTicks.delete(tick)
  }
}

proto.reset = function resetPatched(this: SchedulerTimeline): void {
  lastScheduleAudioSampleMs.delete(this as object)
  this.timelineOriginWhole = undefined
  this.playing = false
  this.currentTick = 0
  this.currentTickTimestamp = 0
  this.stepQueueIndex = 0
  if (this.schedulerIntervalHandle != null) {
    window.clearInterval(this.schedulerIntervalHandle)
  }
  this.schedulerIntervalHandle = null
}

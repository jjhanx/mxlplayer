/**
 * osmd-audio-player 0.7.0 보완
 *
 * 1) reset()이 clearInterval(this.scheduleInterval) 로 잘못 호출됨 → 타이머가 안 지워져
 *    setInterval 이 누적 → 템포가 점점 빨라짐. schedulerIntervalHandle 로 정리.
 *
 * 2) 브라우저가 탭을 백그라운드로 두거나 setInterval 이 밀리면 currentTick 이 크게 점프해
 *    timeToTick 이 0으로 몰리는 문제 → 틱 증가량 상한 + reset 시 WeakMap 초기화.
 *
 * 3) start() 에서 기존 interval 을 항상 지운 뒤 하나만 등록 → 같은 인스턴스 이중 인터벌 방지.
 *
 * (loadScore 시 이전 Scheduler 정리는 patchPlaybackEngine.ts)
 */
import PlaybackScheduler from 'osmd-audio-player/dist/PlaybackScheduler.js'

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

const lastScheduleAudioSampleMs = new WeakMap<object, number>()

const proto = PlaybackScheduler.prototype as unknown as {
  start: (this: SchedulerLike) => void
  scheduleIterationStep: (this: SchedulerLike) => void
  reset: (this: SchedulerLike) => void
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
  const elapsedTicks = Math.ceil((elapsedMs + this.scheduleInterval) / tickDuration)
  const perFrameCeilingTicks = Math.ceil(
    (this.schedulePeriod * 2 + this.scheduleInterval * 2) / tickDuration,
  )
  const maxTickAdvance = Math.max(1, Math.min(elapsedTicks, perFrameCeilingTicks))
  const rawTick = this.calculatedTick
  this.currentTick = Math.min(rawTick, this.currentTick + maxTickAdvance)
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
};

proto.reset = function resetPatched(this: SchedulerLike): void {
  lastScheduleAudioSampleMs.delete(this as object)
  this.playing = false
  this.currentTick = 0
  this.currentTickTimestamp = 0
  this.stepQueueIndex = 0
  if (this.schedulerIntervalHandle != null) {
    window.clearInterval(this.schedulerIntervalHandle)
  }
  this.schedulerIntervalHandle = null
}

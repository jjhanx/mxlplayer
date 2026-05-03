/**
 * osmd-audio-player 0.7.0 보완
 *
 * 1) reset()이 clearInterval(this.scheduleInterval) 로 잘못 호출됨 → 타이머가 안 지워져
 *    setInterval 이 누적 → 템포가 점점 빨라짐. schedulerIntervalHandle 로 정리.
 *
 * 2) 브라우저가 탭을 백그라운드로 두거나 setInterval 이 밀리면, 한 번에 currentTick 이 크게 앞당겨져
 *    과거 스텝의 timeToTick 이 전부 0이 되어 음표가 한꺼번에 터지고 커서/스텝이 도약함.
 *    각 주기당 재생 시간 경과에 비례해 틱 점프를 상한 처리한다.
 */
import PlaybackScheduler from 'osmd-audio-player/dist/PlaybackScheduler.js'

type SchedulerLike = {
  playing: boolean
  currentTick: number
  currentTickTimestamp: number
  stepQueueIndex: number
  schedulerIntervalHandle: ReturnType<typeof setInterval> | null
  schedulePeriod: number
  scheduleInterval: number
  wholeNoteLength: number
  tickDenominator: number
  audioContextTime: number
  calculatedTick: number
  stepQueue: { steps: { tick: number; notes: unknown[] }[] }
  scheduledTicks: Set<number>
  noteSchedulingCallback: (delaySeconds: number, notes: unknown[]) => void
  nextTickAvailableAndWithinSchedulePeriod: (nextTick: number | undefined) => boolean
}

const lastScheduleAudioSampleMs = new WeakMap<object, number>()

const proto = PlaybackScheduler.prototype as unknown as {
  scheduleIterationStep: (this: SchedulerLike) => void
  reset: (this: SchedulerLike) => void
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

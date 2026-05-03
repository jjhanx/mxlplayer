/**
 * osmd-audio-player 0.7.0 버그: PlaybackScheduler.reset()이
 * clearInterval(this.scheduleInterval) 로 잘못 호출함 (scheduleInterval은 200ms 숫자, 타이머 ID 아님).
 * 그래서 스케줄러 타이머가 stop 후에도 남고, 재생 시마다 setInterval 이 중복 → 템포가 점점 빨라짐.
 * 정확한 핸들(this.schedulerIntervalHandle)으로 정리한다.
 */
import PlaybackScheduler from 'osmd-audio-player/dist/PlaybackScheduler.js'

type SchedulerLike = {
  playing: boolean
  currentTick: number
  currentTickTimestamp: number
  stepQueueIndex: number
  schedulerIntervalHandle: ReturnType<typeof setInterval> | null
}

PlaybackScheduler.prototype.reset = function resetPatched(this: SchedulerLike): void {
  this.playing = false
  this.currentTick = 0
  this.currentTickTimestamp = 0
  this.stepQueueIndex = 0
  if (this.schedulerIntervalHandle != null) {
    window.clearInterval(this.schedulerIntervalHandle)
  }
  this.schedulerIntervalHandle = null
}

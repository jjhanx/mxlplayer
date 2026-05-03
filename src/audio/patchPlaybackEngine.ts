/**
 * osmd-audio-player 0.7.0: loadScore()가 새 PlaybackScheduler 를 만들 때
 * 이전 인스턴스에 대해 reset()을 호출하지 않음 → 이전 setInterval 이 계속 돌면서
 * 재로딩·다른 악보 로드 후 재생 시 스케줄이 중첩되고 템포가 점점 빨라짐.
 */
import PlaybackEngine from 'osmd-audio-player'

const originalLoadScore = PlaybackEngine.prototype.loadScore

PlaybackEngine.prototype.loadScore = function loadScoreWithSchedulerTeardown(osmd: unknown) {
  const self = this as typeof this & { scheduler?: { reset: () => void } | null }
  self.scheduler?.reset()
  return originalLoadScore.call(this, osmd as never)
}

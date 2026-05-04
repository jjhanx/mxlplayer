/**
 * 인쇄 미리보기가 닫힌 뒤 정리. `target` 은 인쇄를 호출한 `Window`(iframe.contentWindow 등).
 * 메인 `window` 의 `afterprint`/미디어는 iframe 인쇄와 동기화되지 않을 수 있음.
 */
export function attachPrintSessionEndOnce(onEnd: () => void, target: Window = window): void {
  const mq = target.matchMedia('print')
  const mqCompat = mq as MediaQueryList & {
    addListener?: (cb: () => void) => void
    removeListener?: (cb: () => void) => void
  }

  let done = false
  const finish = () => {
    if (done) return
    done = true
    if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onMqChange)
    else mqCompat.removeListener?.(onMqLegacy)
    target.setTimeout(onEnd, 400)
  }

  const onMqChange = (ev: MediaQueryListEvent) => {
    if (!ev.matches) finish()
  }
  const onMqLegacy = () => {
    if (!mq.matches) finish()
  }

  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onMqChange)
  else mqCompat.addListener?.(onMqLegacy)

  target.addEventListener(
    'afterprint',
    () => {
      target.setTimeout(() => {
        if (!target.matchMedia('print').matches) finish()
      }, 650)
    },
    { once: true },
  )
}

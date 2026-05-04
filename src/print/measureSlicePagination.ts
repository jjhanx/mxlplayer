import type { MusicSheet, OpenSheetMusicDisplay } from 'opensheetmusicdisplay'

/**
 * 소스 마디 색인(0…) 블록 단위 분할 — 작을수록 인쇄 장 수가 늘어나기 쉬움(한 블록이 한 장을 넘기면 브라우저가 한 장에 스케일하는 문제 완화).
 */
export const PRINT_MEASURES_PER_SLICE = 2

/**
 * ImplicitMeasure 처리 분기(MinMeasureToDrawNumber 등)가 색인을 덮어쓸 수 있어,
 * 색인으로만 크롭할 때는 번호를 0으로 두고 분기만 끈다(MusicSheetCalculator 루프는 색인 사용).
 */
export function resetDrawMeasureIndexWindow(osmd: OpenSheetMusicDisplay): void {
  const r = osmd.EngravingRules
  r.MinMeasureToDrawIndex = 0
  r.MaxMeasureToDrawIndex = Number.MAX_VALUE
  r.MinMeasureToDrawNumber = 0
  r.MaxMeasureToDrawNumber = Number.MAX_VALUE
}

export function setDrawMeasureIndexWindow(
  osmd: OpenSheetMusicDisplay,
  sheet: MusicSheet,
  startIdxInclusive: number,
  endIdxInclusive: number,
): void {
  const sm = sheet.SourceMeasures
  if (!sm?.length || startIdxInclusive > endIdxInclusive) return
  const ei = Math.min(endIdxInclusive, sm.length - 1)
  const si = Math.max(0, startIdxInclusive)

  const r = osmd.EngravingRules
  r.MinMeasureToDrawIndex = si
  r.MaxMeasureToDrawIndex = ei
  r.MinMeasureToDrawNumber = 0
  r.MaxMeasureToDrawNumber = 0
}

function collectOsmdPageNodes(mount: HTMLElement): HTMLElement[] {
  const byPage = [...mount.querySelectorAll<HTMLElement>('[id^="osmdCanvasPage"]')]
  if (byPage.length > 0) return byPage

  const svg = mount.querySelector<HTMLElement>('[id^="osmdSvgPage"]')
  if (svg?.parentElement) return [svg.parentElement]

  const direct = [...mount.children].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && /^osmdCanvasPage\d*$/.test(el.id),
  )
  return direct
}

function sortOsmdPagesByNumber(pages: HTMLElement[]): HTMLElement[] {
  return [...pages].sort((a, b) => {
    const na = parseInt(a.id.replace(/\D/g, ''), 10) || 0
    const nb = parseInt(b.id.replace(/\D/g, ''), 10) || 0
    return na - nb
  })
}

/**
 * OSMD 는 마디 슬라이스마다 다시 `osmdCanvasPage1` 을 그리는 경우가 많아 **스택에 동일 id 가 중복**될 수 있음.
 * 인쇄용 래퍼로 감싸 페이지 나눔이 안정적으로 동작하게 함.
 */
function moveRenderedOsmdPages(
  mount: HTMLElement,
  stack: HTMLElement,
  sheetSeq: { value: number },
): void {
  const pages = sortOsmdPagesByNumber(collectOsmdPageNodes(mount))
  for (const node of pages) {
    const wrap = document.createElement('div')
    wrap.className = 'print-score-sheet'
    wrap.dataset.printSheet = String(sheetSeq.value++)
    wrap.appendChild(node)
    stack.appendChild(wrap)
  }
  mount.replaceChildren()
}

function resolvePageStackSibling(mount: HTMLElement): HTMLElement | null {
  const prev = mount.previousElementSibling
  if (prev instanceof HTMLElement && prev.classList.contains('score-print-page-stack')) return prev
  return mount.parentElement?.querySelector<HTMLElement>(':scope > .score-print-page-stack') ?? null
}

/**
 * 형제 순서: `score-print-host` 안에 **`score-print-page-stack` 다음 `score-print-mount`(OSMD 에 넘긴 렌더 루트)**.
 * OSMD 가 한 Graphical 페이지에 세로로 모두 쌓으면 DOM 은 `osmdCanvasPage1` 하나뿐일 수 있음.
 * **항상** 소스 마디 블록으로 나누어 렌더할 때마다 스택에 쌓되, 한 슬라이스마다 id 가 `...Page1` 으로 겹치므로 **`.print-score-sheet` 로 감쌈**.
 */
export function paginatePrintedScoreSlices(
  osmd: OpenSheetMusicDisplay,
  printMount: HTMLElement,
  measureChunkSize: number = PRINT_MEASURES_PER_SLICE,
): void {
  const sheet = osmd?.Sheet as MusicSheet | undefined
  const sm = sheet?.SourceMeasures
  if (!sheet || !sm?.length) return

  const mount = printMount
  const stack = resolvePageStackSibling(mount)
  if (!stack) return

  const sheetSeq = { value: 0 }

  stack.replaceChildren()
  mount.replaceChildren()

  const chunk = Math.max(1, measureChunkSize)
  for (let start = 0; start < sm.length; start += chunk) {
    const end = Math.min(sm.length - 1, start + chunk - 1)
    void mount.offsetWidth
    resetDrawMeasureIndexWindow(osmd)
    setDrawMeasureIndexWindow(osmd, sheet, start, end)
    osmd.updateGraphic()
    osmd.render()
    moveRenderedOsmdPages(mount, stack, sheetSeq)
  }

  if (stack.childElementCount === 0) {
    resetDrawMeasureIndexWindow(osmd)
    mount.replaceChildren()
    void mount.offsetWidth
    osmd.updateGraphic()
    osmd.render()
    moveRenderedOsmdPages(mount, stack, sheetSeq)
  }

  resetDrawMeasureIndexWindow(osmd)
}

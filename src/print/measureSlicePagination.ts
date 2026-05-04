import type { MusicSheet, OpenSheetMusicDisplay } from 'opensheetmusicdisplay'

/**
 * 소스 마디 색인(0…) 블록 단위 분할 크기 — OSMD가 모든 시스템을 한 Graphical 페이지에 세로로 쌓는 경우가 많아,
 * 브라우저 인쇄 한 장 분량을 넘지 않도록 **작게** 둠(블록 많을수록 `window.print` 다장으로 이어지기 유리).
 */
export const PRINT_MEASURES_PER_SLICE = 4

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

export function moveRenderedOsmdPages(mount: HTMLElement, stack: HTMLElement): void {
  const pages = mount.querySelectorAll<HTMLElement>(":scope > div[id^='osmdCanvasPage']")
  for (const node of [...pages]) {
    stack.appendChild(node)
  }
  mount.replaceChildren()
}

export function graphicalMusicPagesCount(osmd: OpenSheetMusicDisplay): number {
  try {
    return osmd.GraphicSheet?.MusicPages?.length ?? 0
  } catch {
    return 0
  }
}

function resolvePageStackSibling(mount: HTMLElement): HTMLElement | null {
  const prev = mount.previousElementSibling
  if (prev instanceof HTMLElement && prev.classList.contains('score-print-page-stack')) return prev
  return mount.parentElement?.querySelector<HTMLElement>(':scope > .score-print-page-stack') ?? null
}

/**
 * 형제 순서: `score-print-host` 안에 **`score-print-page-stack` 다음 `score-print-mount`(OSMD 에 넘긴 렌더 루트)**.
 * 먼저 전체 마디로 렌더 — OSMD가 여러 Graphical 페이지면 그 div 만 스택으로 옮김.
 * OSMD가 통째 레이아웃 시 한 Graphical 페이지 안에 길게 쌓는 경우 마디 블록별로 재렌더해 `#osmdCanvasPage` 를 여러 개 만들고 순서대로 스택에 둠.
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

  stack.replaceChildren()
  mount.replaceChildren()

  void mount.offsetWidth
  resetDrawMeasureIndexWindow(osmd)
  osmd.updateGraphic()
  osmd.render()

  const pageCount = graphicalMusicPagesCount(osmd)

  /** OSMD가 이미 여러 Graphical 페이지를 만들었으면 그대로 한 번 옮김 — 마디 블록 슬라이스 불필요 */
  if (pageCount >= 2) {
    moveRenderedOsmdPages(mount, stack)
    return
  }

  /**
   * Graphical 페이지가 1장뿐이면 소스 마디 수와 무관하게 **블록별로 재렌더**해야 인쇄 시 여러 `div#osmdCanvasPage`(→ 용지)로 이어지는 경우가 많음.
   * (예: 마디 수 ≤ 블록 크기였다고 통째만 그리면 한 장짜리 긴 SVG가 될 수 있음.)
   */
  mount.replaceChildren()

  const chunk = Math.max(1, measureChunkSize)
  for (let start = 0; start < sm.length; start += chunk) {
    const end = Math.min(sm.length - 1, start + chunk - 1)
    void mount.offsetWidth
    resetDrawMeasureIndexWindow(osmd)
    setDrawMeasureIndexWindow(osmd, sheet, start, end)
    osmd.updateGraphic()
    osmd.render()
    moveRenderedOsmdPages(mount, stack)
  }

  resetDrawMeasureIndexWindow(osmd)
}

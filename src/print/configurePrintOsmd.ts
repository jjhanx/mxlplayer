import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'

/** 브라우저 CSS 픽셀 ≒ 96 DPI 기준 mm 환산 */
export const PRINT_CSS_MM_TO_PX = 96 / 25.4

export function pxFromPrintMm(mm: number, floorPx = 400): number {
  return Math.max(floorPx, Math.round(mm * PRINT_CSS_MM_TO_PX))
}

export type OsmdPagedFormatId = 'A4_P' | 'A4_L' | 'Letter_P' | 'Letter_L'

/**
 * 페이지 포맷에 맞춰 출력용 컨테이너 크기를 잡음.
 * 페이지보다 좁게 두면 마지막 마디 줄·종단 세로 마디선이 도려 나가 보일 수 있다.
 */
export function sizeDomHostLikeOsmdPrintPage(formatId: OsmdPagedFormatId, host: HTMLElement): void {
  const standards = OpenSheetMusicDisplay.PageFormatStandards as
    | Record<string, { width: number; height: number } | undefined>
    | undefined

  const pf =
    standards?.[formatId] ??
    (OpenSheetMusicDisplay as unknown as { StringToPageFormat: (id: string) => { width: number; height: number } })
      .StringToPageFormat(formatId)

  const wMm = pf?.width ?? 210
  const hMm = pf?.height ?? 297

  const wPx = pxFromPrintMm(wMm)
  const hPx = pxFromPrintMm(hMm)

  host.style.boxSizing = 'border-box'
  host.style.overflow = 'visible'
  /** OSMD autoResize: false 에서 페이지 가로 근처를 제공 → 시스템 폭 계산 일치 · 오른쪽 잘림 완화 */
  host.style.width = `${wPx}px`
  host.style.minWidth = `${wPx}px`
  host.style.minHeight = `${hPx}px`
}

/**
 * 가능한 한 한 시스템에 마디가 더 들어오도록 간격 소폭 압축(단순 점진 — 복잡 악보는 여전히 4미만일 수 있음).
 * 종단 줄만 가로질러 과도하게 늘리면 경계 처리가 깨지기 쉬워 StretchLast 은 끔.
 */
export function compactPrintSpacingForMeasuresPerSystemTarget(osmd: OpenSheetMusicDisplay): void {
  const rules = osmd.EngravingRules

  rules.SheetMaximumWidth = Math.max(rules.SheetMaximumWidth ?? 6000, 65000)

  if (rules.PageLeftMargin > 0.5) rules.PageLeftMargin *= 0.9
  if (rules.PageRightMargin > 0.5) rules.PageRightMargin *= 0.9
  if (rules.SystemRightMargin > 0.5) rules.SystemRightMargin *= 0.88
  if (rules.SystemLabelsRightMargin > 0.5) rules.SystemLabelsRightMargin *= 0.88

  rules.StretchLastSystemLine = false

  if (rules.VoiceSpacingMultiplierVexflow > 0) rules.VoiceSpacingMultiplierVexflow *= 0.82
  if (rules.MinNoteDistance > 0.3) rules.MinNoteDistance *= 0.88

  /** Vex formatter 분배 완급 — 기본 15 근처에서 소폭 높여 정적 단순 악보 한 줄 마디 수에 여지 */
  if (rules.SoftmaxFactorVexFlow > 5) rules.SoftmaxFactorVexFlow *= 1.08
  if (rules.MeasureRightMargin > 0.1) rules.MeasureRightMargin *= 0.9

  rules.CompactMode = true

  /** OSMD 명시 줄당 마디 분할 기능은 「한 줄당 정확히 x마디」 쪽이라, 여기서는 간격 조정 위주를 씀 */
  rules.RenderXMeasuresPerLineAkaSystem = 0
}

import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'

/** 브라우저 CSS 픽셀 ≒ 96 DPI 기준 mm 환산 */
export const PRINT_CSS_MM_TO_PX = 96 / 25.4

/** `@page` 및 OSMD `setCustomPageFormat` 에 동일하게 사용 — 용지 여백과 레이아웝 폭 불일치 시 오른쪽 세로줄이 잘림 */
export const PRINT_PAGE_MARGIN_MM = 12

/** 브라우저 인쇄 배율 조정 대신 OSMD 전역 배율로 밀도 확보(미리보기 깨짐 완화 목표) */
export const PRINT_OSMD_ZOOM = 0.93

export type OsmdPagedFormatId = 'A4_P' | 'A4_L' | 'Letter_P' | 'Letter_L'

export function pxFromPrintMm(mm: number, floorPx = 320): number {
  return Math.max(floorPx, Math.round(mm * PRINT_CSS_MM_TO_PX))
}

function pageFormatForId(formatId: OsmdPagedFormatId): { width: number; height: number } {
  const standards = OpenSheetMusicDisplay.PageFormatStandards as
    | Record<string, { width: number; height: number } | undefined>
    | undefined

  return (
    standards?.[formatId] ??
    (OpenSheetMusicDisplay as unknown as { StringToPageFormat: (id: string) => { width: number; height: number } })
      .StringToPageFormat(formatId)
  )
}

/** 용지 전체(mm) */
export function getPaperSizeMm(formatId: OsmdPagedFormatId): { widthMm: number; heightMm: number } {
  const pf = pageFormatForId(formatId)
  return { widthMm: pf.width, heightMm: pf.height }
}

/**
 * @page margin 과 동일한 값을 빼서 **실제 인쇄 영역** 크기.
 * OSMD에 이 크기를 주면 브라우저가 다시 축소·클리핑할 여지가 줄어듦.
 */
export function getPrintableContentBoxMm(
  formatId: OsmdPagedFormatId,
  marginMm: number = PRINT_PAGE_MARGIN_MM,
): { widthMm: number; heightMm: number } {
  const { widthMm, heightMm } = getPaperSizeMm(formatId)
  // 브라우저 렌더링 오차로 인해 인쇄 영역을 1px이라도 벗어나면 짝수(빈) 페이지가 추가로 출력되므로,
  // 여유 버퍼를 주어 높이와 폭을 약간 더 줄입니다.
  const innerW = Math.max(40, widthMm - 2 * marginMm - 2)
  const innerH = Math.max(60, heightMm - 2 * marginMm - 4)
  return { widthMm: innerW, heightMm: innerH }
}

/**
 * OSMD가 계산하는 페이지와 DOM 폭을 **인쇄 영역**에 맞춤.
 */
export function sizePrintHostToContentBoxMm(host: HTMLElement, widthMm: number, heightMm: number): void {
  const wPx = pxFromPrintMm(widthMm)
  const hPx = pxFromPrintMm(heightMm)
  host.style.boxSizing = 'border-box'
  host.style.overflow = 'visible'
  host.style.width = `${wPx}px`
  host.style.minWidth = `${wPx}px`
  host.style.maxWidth = `${wPx}px`
  /** 다페이지 세로 스택 — 한 페이지 높이로 제한하지 않음 */
  host.style.minHeight = `${hPx}px`
  host.style.height = 'auto'
}

/**
 * 화면의 가로 한 줄 모드와 무관하게, 인쇄는 **일반 다페이지 악보**(시스템마다 음자리·조표·박자표 반복은 OSMD 기본 동작).
 */
export function applyStandardPrintEngravingMode(osmd: OpenSheetMusicDisplay): void {
  const rules = osmd.EngravingRules
  rules.RenderSingleHorizontalStaffline = false
  rules.RenderClefsAtBeginningOfStaffline = true
  rules.RenderKeySignatures = true
  rules.RenderTimeSignatures = true
}

/**
 * 한 줄에 마디가 더 들어가도록 간격만 소폭 압축 (@page/OSMD 폭은 별도로 맞춤).
 */
export function compactPrintSpacingForMeasuresPerSystemTarget(osmd: OpenSheetMusicDisplay): void {
  const rules = osmd.EngravingRules

  rules.SheetMaximumWidth = Math.max(rules.SheetMaximumWidth ?? 6000, 65000)
  rules.StretchLastSystemLine = false
  rules.CompactMode = true
  rules.RenderXMeasuresPerLineAkaSystem = 0

  if (rules.VoiceSpacingMultiplierVexflow > 0) rules.VoiceSpacingMultiplierVexflow *= 0.86
  if (rules.MinNoteDistance > 0.3) rules.MinNoteDistance *= 0.9
  if (rules.SoftmaxFactorVexFlow > 5) rules.SoftmaxFactorVexFlow *= 1.06
  if (rules.MeasureLeftMargin > 0.1) rules.MeasureLeftMargin *= 0.94
  if (rules.MeasureRightMargin > 0.1) rules.MeasureRightMargin *= 0.94
}

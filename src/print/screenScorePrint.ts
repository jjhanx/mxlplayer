import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'

/** 화면(엔들리스 등)에서 쓰던 페이지·배율 — 인쇄 후 복구 */
export type SavedOsmdPrintLayout = {
  pageEndless: boolean
  pageWidthMm: number
  pageHeightMm: number
  zoom: number
}

export function saveOsmdPrintLayout(osmd: OpenSheetMusicDisplay): SavedOsmdPrintLayout {
  const pf = osmd.EngravingRules.PageFormat
  return {
    pageEndless: pf?.IsUndefined ?? true,
    pageWidthMm: pf?.width ?? 0,
    pageHeightMm: pf?.height ?? 0,
    zoom: osmd.Zoom ?? 1,
  }
}

export function restoreOsmdPrintLayout(osmd: OpenSheetMusicDisplay, s: SavedOsmdPrintLayout): void {
  if (s.pageEndless) {
    osmd.setPageFormat('Endless')
  } else {
    osmd.setCustomPageFormat(s.pageWidthMm, s.pageHeightMm)
  }
  osmd.Zoom = s.zoom
}

export function saveInlineStyle(el: HTMLElement): string {
  return el.getAttribute('style') ?? ''
}

export function restoreInlineStyle(el: HTMLElement, saved: string): void {
  if (saved === '') el.removeAttribute('style')
  else el.setAttribute('style', saved)
}

import type { GraphicalNote } from 'opensheetmusicdisplay'

/**
 * 재생 유지 폴링 — 수동 스크롤 후에도 다음 틱에서 재생 구간 가시성을 다시 맞춤.
 * (순차 이벤트만으로는 그 사이에 화면이 벗어날 수 있음)
 */
export const PLAYBACK_SCROLL_KEEP_VISIBLE_MS = 90

/** OSMD `renderSingleHorizontalStaffline` 모드에서는 가로 팔로잉 위주가 자연스럽다 */
export type PlaybackScrollLayoutMode = 'default' | 'horizontal-strip'

/** OSMD VexFlow 노트 런타임 헬퍼 (#1561) */
type GraphicalNoteWithSvg = GraphicalNote & {
  getSVGGElement?: () => SVGGraphicsElement
}

function viewportYToScrollContentY(scrollParent: HTMLElement, viewportTop: number): number {
  return viewportTop - scrollParent.getBoundingClientRect().top + scrollParent.scrollTop
}

function viewportXToScrollContentX(scrollParent: HTMLElement, viewportLeft: number): number {
  return viewportLeft - scrollParent.getBoundingClientRect().left + scrollParent.scrollLeft
}

/** 재생 하이라이트 세로 블록이 패널 안에 들어왔는지 (여유 margin) */
function isBlockFullyVisible(
  viewportTop: number,
  viewportBottom: number,
  minY: number,
  maxY: number,
  marginTop: number,
  marginBottom: number,
  eps = 2,
): boolean {
  return (
    viewportTop <= minY - marginTop + eps && viewportBottom >= maxY + marginBottom - eps
  )
}

function isHorizontalBlockFullyVisible(
  viewportLeft: number,
  viewportRight: number,
  minX: number,
  maxX: number,
  marginLeft: number,
  marginRight: number,
  eps = 2,
): boolean {
  return (
    viewportLeft <= minX - marginLeft + eps && viewportRight >= maxX + marginRight - eps
  )
}

/**
 * 같은 시점의 모든 강조 음표(성부 블록)가 스크롤 영역 안에 들어오도록 한다.
 * - 블록이 뷰보다 짧으면: 상단 우선 정렬 후, 아래까지 안 들어오면 아래쪽으로 보정해 전부 덮음.
 * - 블록이 뷰보다 길면: 위쪽부터 보이도록 (보컬·상단 스태프 우선).
 * - 이미 전부 보이면 스크롤 생략(미세 진동 줄임).
 */
export function scrollHighlightedNotesIntoView(
  scrollParent: HTMLElement | null,
  graphicalNotes: GraphicalNote[],
  zoom: number,
  layout: PlaybackScrollLayoutMode = 'default',
): void {
  if (!scrollParent || graphicalNotes.length === 0) return

  if (layout === 'horizontal-strip') {
    scrollHighlightedNotesIntoViewHorizontal(scrollParent, graphicalNotes, zoom)
    return
  }

  scrollHighlightedNotesIntoViewVertical(scrollParent, graphicalNotes, zoom)
}

function scrollHighlightedNotesIntoViewVertical(
  scrollParent: HTMLElement,
  graphicalNotes: GraphicalNote[],
  zoom: number,
): void {
  const z = zoom > 0 ? zoom : 1
  /** 상·하로 동일 비율 벌리면 극단 줄 잘림을 줄임 */
  const pad = Math.min(scrollParent.clientHeight * 0.1, 64)
  const marginTop = pad
  const marginBottom = pad

  const bySvg: { top: number; bottom: number }[] = []
  for (const gn of graphicalNotes) {
    const svgGrp = (gn as GraphicalNoteWithSvg).getSVGGElement?.()
    if (!svgGrp) continue
    try {
      const box = svgGrp.getBoundingClientRect()
      bySvg.push({
        top: viewportYToScrollContentY(scrollParent, box.top),
        bottom: viewportYToScrollContentY(scrollParent, box.bottom),
      })
    } catch {
      /* 레이아웃 미준비 */
    }
  }

  let minContentY: number
  let maxContentY: number

  if (bySvg.length > 0) {
    minContentY = Math.min(...bySvg.map((b) => b.top))
    maxContentY = Math.max(...bySvg.map((b) => b.bottom))
  } else {
    minContentY = Infinity
    maxContentY = -Infinity
    for (const gn of graphicalNotes) {
      const gve = gn.parentVoiceEntry?.PositionAndShape?.BoundingRectangle
      if (!gve) continue
      const topPx = gve.y * 10 * z
      const botPx = (gve.y + gve.height) * 10 * z
      minContentY = Math.min(minContentY, topPx)
      maxContentY = Math.max(maxContentY, botPx)
    }
    if (!Number.isFinite(minContentY)) return
  }

  const clientH = scrollParent.clientHeight
  const viewportTop = scrollParent.scrollTop
  const viewportBottom = viewportTop + clientH

  if (isBlockFullyVisible(viewportTop, viewportBottom, minContentY, maxContentY, marginTop, marginBottom)) {
    return
  }

  const maxScroll = Math.max(0, scrollParent.scrollHeight - clientH)

  /** 상단 우선 타깃: 가장 높은 스태프 기준 margin 아래 두기 */
  let nextTop = minContentY - marginTop
  nextTop = Math.max(0, Math.min(nextTop, maxScroll))

  /** 블록이 뷰에 들어오면 — 아래 끝이 잘리면 필요한 만큼 아래로 */
  const blockBottomNeeds = maxContentY + marginBottom
  if (nextTop + clientH < blockBottomNeeds) {
    nextTop = blockBottomNeeds - clientH
    nextTop = Math.max(0, Math.min(nextTop, maxScroll))
  }

  /** 그래도 맞출 수 없을 때는 (블록이 뷰보다 큼) 위쪽부터 */
  scrollParent.scrollTo({ top: nextTop, behavior: 'auto' })
}

function scrollHighlightedNotesIntoViewHorizontal(
  scrollParent: HTMLElement,
  graphicalNotes: GraphicalNote[],
  zoom: number,
): void {
  const z = zoom > 0 ? zoom : 1
  const pad = Math.min(scrollParent.clientWidth * 0.08, 64)
  const marginLeft = pad
  const marginRight = pad

  const bySvg: { left: number; right: number }[] = []
  for (const gn of graphicalNotes) {
    const svgGrp = (gn as GraphicalNoteWithSvg).getSVGGElement?.()
    if (!svgGrp) continue
    try {
      const box = svgGrp.getBoundingClientRect()
      bySvg.push({
        left: viewportXToScrollContentX(scrollParent, box.left),
        right: viewportXToScrollContentX(scrollParent, box.right),
      })
    } catch {
      /* 레이아웃 미준비 */
    }
  }

  let minContentX: number
  let maxContentX: number

  if (bySvg.length > 0) {
    minContentX = Math.min(...bySvg.map((b) => b.left))
    maxContentX = Math.max(...bySvg.map((b) => b.right))
  } else {
    minContentX = Infinity
    maxContentX = -Infinity
    for (const gn of graphicalNotes) {
      const gve = gn.parentVoiceEntry?.PositionAndShape?.BoundingRectangle
      if (!gve) continue
      const leftPx = gve.x * 10 * z
      const rightPx = (gve.x + gve.width) * 10 * z
      minContentX = Math.min(minContentX, leftPx)
      maxContentX = Math.max(maxContentX, rightPx)
    }
    if (!Number.isFinite(minContentX)) return
  }

  const clientW = scrollParent.clientWidth
  const viewportLeft = scrollParent.scrollLeft
  const viewportRight = viewportLeft + clientW

  if (isHorizontalBlockFullyVisible(viewportLeft, viewportRight, minContentX, maxContentX, marginLeft, marginRight)) {
    return
  }

  const maxScroll = Math.max(0, scrollParent.scrollWidth - clientW)

  let nextLeft = minContentX - marginLeft
  nextLeft = Math.max(0, Math.min(nextLeft, maxScroll))

  const blockRightNeeds = maxContentX + marginRight
  if (nextLeft + clientW < blockRightNeeds) {
    nextLeft = blockRightNeeds - clientW
    nextLeft = Math.max(0, Math.min(nextLeft, maxScroll))
  }

  scrollParent.scrollTo({ left: nextLeft, behavior: 'auto' })
}

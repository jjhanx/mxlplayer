import type { GraphicalNote } from 'opensheetmusicdisplay'

/**
 * OSMD VexFlow 쪽 노트는 타입선언에 없을 수 있는 런타임 헬퍼.
 * 이슈 #1561 등: 재생 따라가기에는 SVG getBoundingClientRect 가 안정적이다.
 */
type GraphicalNoteWithSvg = GraphicalNote & {
  getSVGGElement?: () => SVGGraphicsElement
}

function viewportYToScrollContentY(scrollParent: HTMLElement, viewportTop: number): number {
  return viewportTop - scrollParent.getBoundingClientRect().top + scrollParent.scrollTop
}

/** 하이라이트된 스태프들이 한 덩어리로 보이도록 스크롤 (커서만 피아노 줄에 두면 보컬이 밖으로 나가던 문제 완화) */
export function scrollHighlightedNotesIntoView(
  scrollParent: HTMLElement | null,
  graphicalNotes: GraphicalNote[],
  zoom: number,
): void {
  if (!scrollParent || graphicalNotes.length === 0) return

  const z = zoom > 0 ? zoom : 1
  const pad = Math.min(scrollParent.clientHeight * 0.12, 72)

  /** 1순위: 각 음표의 SVG 그룹 (픽셀 좌표) */
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
    /** 2순위: 같은 시각 그래픽 VoiceEntry 블록 (OSMD 단위 → 픽셀 근사: ×10×줌, #857 등 참고) */
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

  const viewportTop = scrollParent.scrollTop
  const viewportBottom = viewportTop + scrollParent.clientHeight
  let nextTop = viewportTop

  if (minContentY < viewportTop + pad) {
    nextTop = minContentY - pad
  } else if (maxContentY > viewportBottom - pad) {
    nextTop = maxContentY - scrollParent.clientHeight + pad
  }

  const maxScroll = Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight)
  nextTop = Math.max(0, Math.min(nextTop, maxScroll))

  if (Math.abs(nextTop - viewportTop) > 2) {
    scrollParent.scrollTo({ top: nextTop, behavior: 'auto' })
  }
}

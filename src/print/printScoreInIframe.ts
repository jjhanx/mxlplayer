import { attachPrintSessionEndOnce } from './printSession'
import { uniquifyPrintSheetDomIds } from './uniquifyPrintDomIds'

function buildMinimalPrintDocumentCss(pageSizeCss: string, marginMm: number): string {
  return `
    @page { size: ${pageSizeCss}; margin: ${marginMm}mm; }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #000000;
      width: 100%;
      max-width: 100%;
    }
    .print-score-sheet {
      display: block;
      box-sizing: border-box;
      width: 100%;
      max-width: 100%;
      break-after: page;
      page-break-after: always;
      break-inside: auto;
      page-break-inside: auto;
    }
    .print-score-sheet:last-child {
      break-after: auto;
      page-break-after: auto;
    }
    svg {
      display: block;
      max-width: 100% !important;
      width: 100%;
      height: auto !important;
      overflow: visible !important;
    }
  `
}

/**
 * 메인 앱(Ion·Shadow·flex)과 분리된 문서에서만 인쇄 — 빈 미리보기 방지.
 */
export function printScorePageStackInIframe(
  pageStack: HTMLElement,
  pageSizeCss: string,
  marginMm: number,
  onDone: () => void,
): () => void {
  const noop = () => {}
  const iframe = document.createElement('iframe')
  iframe.setAttribute('title', 'mxlplayer-score-print')
  /** visibility:0·0×0 는 일부 엔진에서 스풀 시 빈 장 — 최소한의 레이아웃 박스 유지 */
  iframe.setAttribute(
    'style',
    [
      'position:fixed',
      'left:0',
      'top:0',
      'width:210mm',
      'min-height:297mm',
      'border:0',
      'opacity:0.02',
      'pointer-events:none',
      'z-index:2147483647',
    ].join(';'),
  )
  document.body.appendChild(iframe)

  const w = iframe.contentWindow
  const d = iframe.contentDocument
  if (!w || !d) {
    iframe.remove()
    onDone()
    return noop
  }

  const css = buildMinimalPrintDocumentCss(pageSizeCss, marginMm)
  d.open()
  d.write(
    `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
      `<style>${css}</style></head><body></body></html>`,
  )
  d.close()

  const ibody = d.body
  const sheets = [...pageStack.children]
  for (let i = 0; i < sheets.length; i++) {
    const cloned = sheets[i].cloneNode(true) as HTMLElement
    uniquifyPrintSheetDomIds(cloned, i)
    ibody.appendChild(d.importNode(cloned, true))
  }

  if (ibody.childElementCount === 0) {
    iframe.remove()
    onDone()
    return noop
  }

  const removeFrame = () => {
    if (iframe.isConnected) iframe.remove()
  }

  const finish = () => {
    removeFrame()
    onDone()
  }

  attachPrintSessionEndOnce(finish, w)

  const runPrint = () => {
    void ibody.offsetHeight
    w.focus()
    w.print()
  }

  requestAnimationFrame(() => requestAnimationFrame(() => w.setTimeout(runPrint, 40)))

  return removeFrame
}

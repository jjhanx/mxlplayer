/**
 * OSMD 슬라이스마다 같은 `id`·`url(#…)` 를 재사용함. iframe 인쇄 문서에 시트를 여러 개 붙이면
 * 중복 id 로 SVG 가 전부 무효화되어 **여러 장의 백지**만 나올 수 있음.
 */
export function uniquifyPrintSheetDomIds(root: HTMLElement, sheetIndex: number): void {
  const suffix = `_mxlp${sheetIndex}`
  const idMap = new Map<string, string>()

  root.querySelectorAll<HTMLElement>('[id]').forEach((el) => {
    const oldId = el.id
    if (!oldId) return
    const newId = `${oldId}${suffix}`
    idMap.set(oldId, newId)
    el.id = newId
  })

  if (idMap.size === 0) return

  const stripUrl = (_m: string, id: string) => {
    const nw = idMap.get(id.trim())
    return nw ? `url(#${nw})` : `url(#${id.trim()})`
  }

  const patchAttr = (val: string): string => {
    if (!val.includes('#')) return val
    const trimmed = val.trim()
    /** 프래그만 있는 href / xlink:href */
    if (/^#[\w.\-:]+$/.test(trimmed)) {
      const id = trimmed.slice(1)
      const nw = idMap.get(id)
      if (nw) return `#${nw}`
    }
    return val.replace(/url\(\s*#([^)\s]+)\s*\)/gi, stripUrl)
  }

  root.querySelectorAll('*').forEach((el) => {
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes[i]
      if (a.value.includes('#')) {
        const next = patchAttr(a.value)
        if (next !== a.value) el.setAttribute(a.name, next)
      }
    }
  })

  root.querySelectorAll('style').forEach((styleEl) => {
    const t = styleEl.textContent
    if (t?.includes('url(#')) {
      styleEl.textContent = t.replace(/url\(\s*#([^)\s]+)\s*\)/gi, stripUrl)
    }
  })
}

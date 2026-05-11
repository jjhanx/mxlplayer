import JSZip from 'jszip'

const CONTAINER_XML_PATH = 'META-INF/container.xml'

function scorePathFromContainer(containerXml: string): string {
  const m = containerXml.match(/<rootfile[^>]*full-path\s*=\s*"([^"]+)"/i)
  if (!m) throw new Error('MXL container.xml에 rootfile full-path가 없습니다.')
  return m[1].trim()
}

function stableContainerXml(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<container>\n' +
    '  <rootfiles>\n' +
    '    <rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/>\n' +
    '  </rootfiles>\n' +
    '</container>\n'
  )
}

/**
 * MXL ZIP 안의 악보 파일명을 ASCII `score.xml`로 고정한다.
 * Audiveris 등이 한글 파일명으로 넣은 경우, 일부 JS ZIP/OSMD 조합에서 경로 인식이 실패할 수 있다.
 */
export async function normalizeMxlBlob(blob: Blob): Promise<Blob> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())

  const containerFile = zip.file(CONTAINER_XML_PATH)
  if (!containerFile) throw new Error(`MXL에 ${CONTAINER_XML_PATH}가 없습니다.`)

  const containerXml = await containerFile.async('string')
  const innerPath = scorePathFromContainer(containerXml)
  const scoreFile = zip.file(innerPath)
  if (!scoreFile) {
    throw new Error(`MXL 안에서 악보 파일을 찾을 수 없습니다: ${innerPath}`)
  }

  const scoreXml = await scoreFile.async('string')

  const out = new JSZip()
  out.file('score.xml', scoreXml)
  out.file(CONTAINER_XML_PATH, stableContainerXml())

  return out.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
  })
}

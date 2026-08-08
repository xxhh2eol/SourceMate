/// <reference types="vite/client" />

/** Local Font Access API（Chromium 内置，Win/mac/Linux 通用）——TS lib.dom 未收录，此处补充声明 */
interface FontMetadata {
  family: string
  fullName: string
  postscriptName: string
  style: string
}

interface Window {
  queryLocalFonts(): Promise<FontMetadata[]>
}

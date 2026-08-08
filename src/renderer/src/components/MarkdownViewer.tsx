import { useMemo, useState } from 'react'
import { Modal, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'
import { useSettingsStore } from '../stores/settingsStore'

interface Props {
  content: string
  owner: string
  repo: string
}

/** 链接处理：外链交给主进程转系统浏览器，不导航当前窗口 */
function handleLinkClick(e: React.MouseEvent<HTMLAnchorElement>, href?: string): void {
  e.preventDefault()
  if (href) window.open(href, '_blank')
}

/** README 相对图片路径 → raw.githubusercontent.com 绝对地址 */
function resolveImageSrc(src: string | undefined, owner: string, repo: string): string | undefined {
  if (!src) return undefined
  if (/^https?:\/\//.test(src)) return src
  return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${src.replace(/^\.\//, '')}`
}

/**
 * Markdown 渲染器（设计文档 §3 / 页面图 §3.2）
 * - react-markdown + GFM + rehype-raw，渲染前 DOMPurify 消毒防 XSS
 * - 代码块 highlight.js 高亮
 * - 相对图片转 raw 地址，外链系统浏览器打开
 * - 图片默认限制高度为缩略图（防长图占满窗口），点击 Modal 放大查看
 */
export default function MarkdownViewer({ content, owner, repo }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null)
  const sanitized = useMemo(() => DOMPurify.sanitize(content), [content])
  const markdownFontFamily = useSettingsStore((s) => s.markdownFontFamily)

  // Markdown 字体经 CSS 变量下发：--md-font 正文字体，--md-mono 代码块（永远保持等宽栈）
  const mdStyle = useMemo(() => {
    if (!markdownFontFamily) return undefined
    return {
      '--md-font': `"${markdownFontFamily}", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`,
      '--md-mono': `"${markdownFontFamily}", ui-monospace, Consolas, Menlo, monospace`
    } as React.CSSProperties
  }, [markdownFontFamily])

  return (
    <>
      <div className="markdown-body" style={mdStyle}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={{
            a: ({ href, children }) => (
              <a href={href} onClick={(e) => handleLinkClick(e, href)}>
                {children}
              </a>
            ),
            img: ({ src, alt }) => {
              const resolved = resolveImageSrc(src, owner, repo)
              return (
                <img
                  src={resolved}
                  alt={alt ?? ''}
                  loading="lazy"
                  // 默认缩略图：限高防止长图/宽图占满窗口，点击放大
                  style={{
                    maxWidth: '100%',
                    maxHeight: 300,
                    objectFit: 'contain',
                    margin: '4px auto',
                    display: 'block',
                    cursor: 'zoom-in',
                    background: 'rgba(0, 0, 0, 0.02)'
                  }}
                  onClick={() => resolved && setPreview({ src: resolved, alt: alt ?? '' })}
                />
              )
            },
            code: ({ className, children }) => {
              const lang = /language-(\w+)/.exec(className ?? '')?.[1]
              const code = String(children).replace(/\n$/, '')
              if (lang && hljs.getLanguage(lang)) {
                const html = hljs.highlight(code, { language: lang }).value
                return (
                  <pre style={{ position: 'relative' }}>
                    <code
                      className={className}
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  </pre>
                )
              }
              return <code className={className}>{children}</code>
            }
          }}
        >
          {sanitized}
        </ReactMarkdown>
      </div>

      {/* 图片放大预览：原图可滚动查看 + 新窗口打开 */}
      <Modal
        open={preview !== null}
        onCancel={() => setPreview(null)}
        footer={null}
        width="80%"
        title={preview?.alt}
        styles={{ body: { overflow: 'auto', maxHeight: '70vh', textAlign: 'center' } }}
      >
        {preview && (
          <>
            <img
              src={preview.src}
              alt={preview.alt}
              style={{ maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain' }}
            />
            <div style={{ marginTop: 8 }}>
              <Typography.Link href={preview.src} target="_blank" rel="noreferrer">
                {t('common.openInNewWindow')}
              </Typography.Link>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}

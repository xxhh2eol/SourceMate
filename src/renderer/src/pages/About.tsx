import { useEffect, useState } from 'react'
import React from 'react'
import { Button, Card, Descriptions, message } from 'antd'
import { version as antdVersion } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { AppInfo } from '../../../preload'

/** About 页：应用信息 + 应用自身更新检查（对比 GitHub Releases 最新版本） */
export default function About(): React.JSX.Element {
  const { t } = useTranslation()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    window.api.getAppInfo().then(setInfo).catch(() => setInfo(null))
  }, [])

  const checkUpdate = async (): Promise<void> => {
    if (checking) return
    setChecking(true)
    try {
      const r = await window.api.checkAppUpdate()
      if (!r.ok) {
        message.warning(r.error ?? t('about.checkFailed'))
      } else if (r.hasUpdate) {
        message.info(
          <span>
            {t('about.foundUpdate', { latest: r.latest })}&nbsp;
            <a
              href={`https://github.com/xxhh2eol/SourceMate/releases/tag/${r.latest}`}
              target="_blank"
              rel="noreferrer"
            >
              {t('about.goDownload')}
            </a>
          </span>
        )
      } else {
        message.success(t('about.upToDate', { current: r.current }))
      }
    } catch {
      message.warning(t('about.checkFailed'))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="page-container">
      <Card
        style={{ maxWidth: 560 }}
        title={t('app.name')}
        extra={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={checking}
            onClick={() => void checkUpdate()}
          >
            {t('about.checkUpdate')}
          </Button>
        }
      >
        <Descriptions column={1} size="small">
          <Descriptions.Item label={t('about.version')}>{info?.version ?? '-'}</Descriptions.Item>
          <Descriptions.Item label={t('about.platform')}>
            {info ? `${info.platform} (${info.arch})` : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Electron">{info?.electron ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="Chromium">{info?.chrome ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="Node.js">{info?.node ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="Ant Design">{antdVersion}</Descriptions.Item>
          <Descriptions.Item label="React">{React.version}</Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  )
}

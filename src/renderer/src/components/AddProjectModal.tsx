import { useMemo, useState } from 'react'
import { Alert, Button, Input, Modal, Space, Tag, Typography } from 'antd'
import { StarOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { extractGitHubUrls } from '@shared/githubUrl'

interface Props {
  open: boolean
  onClose: () => void
  /** 返回本次成功添加的 owner/repo 小写 key 列表（供预览标记「已添加」） */
  onAdd: (urls: string[]) => Promise<{ added: string[] }>
  /** 已存在项目（owner/repo 小写集合，预览标记「已存在」用） */
  existingKeys: Set<string>
}

/** 项目添加入口（设计文档 §4）：粘贴即实时整理——自动提取混排文本中的 GitHub 链接并预览，确认后添加 */
export default function AddProjectModal({
  open,
  onClose,
  onAdd,
  existingKeys
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  // 本次弹窗会话中已添加成功的项目（预览标记「已添加」，与库中原本就存在的「已存在」区分）
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set())

  // 输入即整理：从整段文本提取所有 GitHub 链接（换行/空格/标点/说明文字均可），去重
  const parsed = useMemo(() => extractGitHubUrls(value), [value])
  const newItems = parsed.filter(
    (u) =>
      !addedKeys.has(`${u.owner.toLowerCase()}/${u.repo.toLowerCase()}`) &&
      !existingKeys.has(`${u.owner.toLowerCase()}/${u.repo.toLowerCase()}`)
  )

  /** 关闭弹窗时清空输入与本次会话状态，避免下次打开残留上次粘贴的地址 */
  const handleClose = (): void => {
    setValue('')
    setAddedKeys(new Set())
    onClose()
  }

  const submit = async (): Promise<void> => {
    if (newItems.length === 0 || busy) return
    setBusy(true)
    try {
      // 添加后保留输入与预览：本次添加的显示「已添加」，可继续粘贴或手动关闭
      const r = await onAdd(newItems.map((u) => `https://github.com/${u.owner}/${u.repo}`))
      setAddedKeys((prev) => {
        const next = new Set(prev)
        for (const k of r.added) next.add(k)
        return next
      })
    } finally {
      setBusy(false)
    }
  }

  /** 跳转设置页 GitHub 凭据，勾选账号批量拉取 Star 项目 */
  const goImportStarred = (): void => {
    handleClose()
    navigate('/settings/credentials')
  }

  return (
    <Modal
      title={t('dashboard.addProject')}
      open={open}
      onCancel={handleClose}
      footer={[
        <div
          key="footer"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Button type="link" icon={<StarOutlined />} onClick={goImportStarred}>
            {t('dashboard.addStarredBtn')}
          </Button>
          <Space>
            <Button onClick={handleClose}>{t('common.cancel')}</Button>
            <Button
              type="primary"
              loading={busy}
              disabled={newItems.length === 0}
              onClick={() => void submit()}
            >
              {t('common.add')}（{newItems.length}）
            </Button>
          </Space>
        </div>
      ]}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Input.TextArea
          rows={5}
          placeholder={'https://github.com/owner/repo\n' + t('dashboard.addPlaceholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {/* 实时整理预览：解析出的链接列表（新添加 / 已存在） */}
        {parsed.length > 0 ? (
          <div
            style={{
              maxHeight: 160,
              overflow: 'auto',
              border: '1px solid rgba(0,0,0,0.08)',
              borderRadius: 6,
              padding: '4px 8px'
            }}
          >
            {parsed.map((u) => {
              const key = `${u.owner.toLowerCase()}/${u.repo.toLowerCase()}`
              const added = addedKeys.has(key)
              const exists = !added && existingKeys.has(key)
              return (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '3px 0',
                    color: exists ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.85)'
                  }}
                >
                  <Typography.Text style={{ fontSize: 12 }} ellipsis>
                    github.com/{u.owner}/{u.repo}
                  </Typography.Text>
                  {added ? (
                    <Tag color="blue" style={{ fontSize: 10, lineHeight: '16px', marginRight: 0 }}>
                      {t('dashboard.addedNow')}
                    </Tag>
                  ) : exists ? (
                    <Tag color="default" style={{ fontSize: 10, lineHeight: '16px', marginRight: 0 }}>
                      {t('dashboard.alreadyExists')}
                    </Tag>
                  ) : (
                    <Tag color="green" style={{ fontSize: 10, lineHeight: '16px', marginRight: 0 }}>
                      {t('dashboard.toAdd')}
                    </Tag>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          value.trim() !== '' && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('dashboard.noUrlFound')}
            </Typography.Text>
          )
        )}
        <Alert type="info" showIcon message={t('dashboard.addTip')} />
      </Space>
    </Modal>
  )
}

import { useMemo, useState } from 'react'
import { AutoComplete, Button, Divider, Modal, Space, Tag, Tooltip } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { TAG_DIMENSION_COLOR, TAG_EDITOR_DIMENSIONS } from '@shared/types'
import type { ProjectTagInfo, TagDimension, TagWithCount } from '@shared/types'

interface Props {
  open: boolean
  projectName: string
  /** 项目当前标签（带来源；仅 user 来源可在此删除） */
  projectTags: ProjectTagInfo[]
  allTags: TagWithCount[]
  onClose: () => void
  onAdd: (name: string, dimension: TagDimension) => Promise<void>
  onRemove: (tagId: number) => Promise<void>
}

/**
 * 多维标签编辑器（设计文档 §3 多维标签体系）
 * 三个维度分区（type/domain/purpose，与 AI 打标三维对齐）：
 * 已打标签仅 user 来源可删除（AI/同步来源不可删），新增标签走候选补全
 */
export default function TagEditor({
  open,
  projectName,
  projectTags,
  allTags,
  onClose,
  onAdd,
  onRemove
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Modal
      title={`${t('common.editTags')} · ${projectName}`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={480}
    >
      {TAG_EDITOR_DIMENSIONS.map((dim) => (
        <DimensionEditor
          key={dim}
          dimension={dim}
          projectTags={projectTags}
          allTags={allTags}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      ))}
    </Modal>
  )
}

function DimensionEditor({
  dimension,
  projectTags,
  allTags,
  onAdd,
  onRemove
}: {
  dimension: TagDimension
  projectTags: ProjectTagInfo[]
  allTags: TagWithCount[]
  onAdd: (name: string, dimension: TagDimension) => Promise<void>
  onRemove: (tagId: number) => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const color = TAG_DIMENSION_COLOR[dimension]
  const dimLabel = t(`filter.${dimension}`)

  const assigned = projectTags.filter((t) => t.dimension === dimension)
  const assignedNames = new Set(assigned.map((t) => t.name))

  const candidates = useMemo(
    () =>
      allTags
        .filter((t) => t.dimension === dimension && !assignedNames.has(t.name))
        .map((t) => ({ value: t.name, label: t.nameCn ?? t.name })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allTags, projectTags]
  )

  const submit = async (): Promise<void> => {
    const name = value.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      await onAdd(name, dimension)
      setValue('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ color, fontWeight: 600, fontSize: 13 }}>{dimLabel}</span>
        <AutoComplete
          style={{ flex: 1, maxWidth: 260 }}
          size="small"
          value={value}
          options={candidates}
          placeholder={`${t('common.add')} ${dimLabel}`}
          onChange={setValue}
          onSelect={setValue}
          filterOption={(input, option) =>
            (option?.label as string | undefined)?.toLowerCase().includes(input.toLowerCase()) ??
            (option?.value as string).toLowerCase().includes(input.toLowerCase())
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
        <Button
          size="small"
          type="primary"
          icon={<PlusOutlined />}
          loading={busy}
          onClick={() => void submit()}
        >
          {t('common.add')}
        </Button>
      </div>
      <Space size={4} wrap>
        {assigned.map((tag) => (
          <Tooltip
            key={tag.id}
            title={tag.source === 'user' ? undefined : t('common.tagSourceLocked')}
          >
            <Tag color={color} closable={tag.source === 'user'} onClose={() => void onRemove(tag.id)}>
              {tag.nameCn ?? tag.name}
            </Tag>
          </Tooltip>
        ))}
        {assigned.length === 0 && (
          <span style={{ fontSize: 12, color: '#999' }}>{t('common.none')}</span>
        )}
      </Space>
      <Divider style={{ margin: '12px 0 0' }} />
    </div>
  )
}

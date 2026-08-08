import { useState } from 'react'
import { BorderBeam, Card, Dropdown, Tag, Tooltip, Typography, message } from 'antd'
import {
  StarOutlined,
  TagsOutlined,
  DeleteOutlined,
  ReloadOutlined,
  MoreOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ProjectWithTags, TagDimension, TagWithCount } from '@shared/types'
import { formatCount, formatRelativeTime } from '../utils/format'
import { projectBgColor, projectBorderColor, tagColor } from '../utils/color'
import { useSettingsStore } from '../stores/settingsStore'
import TagEditor from './TagEditor'

interface Props {
  project: ProjectWithTags
  allTags: TagWithCount[]
  /** 正在检查更新时点亮边框流光（BorderBeam） */
  checking?: boolean
  onDelete: (id: number) => Promise<void>
  onRefreshMeta: (id: number) => Promise<string | null>
  onCheckUpdate: (id: number) => Promise<{ latest: string | null; hasUpdate: boolean } | null>
  onAssignTag: (projectId: number, name: string, dimension: TagDimension) => Promise<void>
  onRemoveTag: (projectId: number, tagId: number) => Promise<void>
}

/** 项目卡片（页面图 §2.2）：名称 / 一句话描述 / Star / 标签 / 更新时间 / 操作 */
export default function ProjectCard({
  project,
  allTags,
  checking = false,
  onDelete,
  onRefreshMeta,
  onCheckUpdate,
  onAssignTag,
  onRemoveTag
}: Props): React.JSX.Element {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [tagEditorOpen, setTagEditorOpen] = useState(false)
  // 卡片/表格行配色模式（彩色 = 按项目名淡色相；黑白 = 默认白底）
  const colorMode = useSettingsStore((s) => s.projectColorMode)

  // AI 一句话描述（cn_summary）；为空则不显示描述区（不回退 GitHub 描述）
  const intro = project.cnSummary
  const star = formatCount(project.starCount)

  const actions = [
    <Tooltip key="tags" title={t('common.editTags')}>
      <span onClick={(e) => e.stopPropagation()}>
        <TagsOutlined onClick={() => setTagEditorOpen(true)} />
      </span>
    </Tooltip>,
    <Dropdown
      key="more"
      menu={{
        items: [
          { key: 'refresh', label: t('card.refreshMeta'), icon: <ReloadOutlined /> },
          { key: 'update', label: t('card.checkUpdate'), icon: <ReloadOutlined /> },
          { key: 'delete', label: t('card.deleteProject'), icon: <DeleteOutlined />, danger: true }
        ],
        onClick: async ({ key, domEvent }) => {
          domEvent.stopPropagation()
          if (key === 'refresh') {
            const err = await onRefreshMeta(project.id)
            if (err) message.warning(err)
            else message.success(t('dashboard.metaRefreshed'))
          } else if (key === 'update') {
            const result = await onCheckUpdate(project.id)
            if (result === null) message.warning(t('dashboard.updateFailed'))
            else if (result.hasUpdate)
              message.info(t('dashboard.foundNewVersion', { version: result.latest }))
            else message.success(t('dashboard.upToDate'))
          } else if (key === 'delete') {
            await onDelete(project.id)
            message.success(t('dashboard.deleted'))
          }
        }
      }}
    >
      <span onClick={(e) => e.stopPropagation()}>
        <MoreOutlined />
      </span>
    </Dropdown>
  ]

  const card = (
    <Card
      hoverable
      actions={actions}
      onClick={() => navigate(`/repository/${project.id}/summary`)}
      style={{
        cursor: 'pointer',
        // 彩色模式：背景/边框按项目名取淡色相；黑白模式：默认白底
        ...(colorMode === 'color'
          ? {
              background: projectBgColor(project.name),
              borderColor: projectBorderColor(project.name)
            }
          : {})
      }}
      title={<span>{project.name}</span>}
    >
      {/* AI 一句话描述：无则不显示；完整展示不截断（瀑布流效果） */}
      {intro && (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 10 }}>
          {intro}
        </Typography.Paragraph>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
        {/* topic 标签仅入库暂不展示（后续统一处理翻译/合并），三维 + 语言标签正常显示；
            颜色 = 黄金角稳定色（同词同色，与筛选气泡一致） */}
        {project.tags
          .filter((t) => t.dimension !== 'topic')
          .map((t) => {
            const color = tagColor(t.nameCn ?? t.name)
            return (
              <Tag
                key={t.id}
                style={{
                  color,
                  borderColor: color,
                  background: 'transparent'
                }}
              >
                {t.nameCn ?? t.name}
              </Tag>
            )
          })}
      </div>

      {/* 底部行：左 = 最近更新（pushed_at，悬停查看本地检查时间），右 = Star */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Tooltip
          title={
            project.lastCheckedAt
              ? t('projects.checkedTip', { time: formatRelativeTime(project.lastCheckedAt) })
              : undefined
          }
        >
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('card.recentUpdate', {
              time: formatRelativeTime(project.pushedAt ?? project.updatedAt)
            })}
          </Typography.Text>
        </Tooltip>
        <span>
          <StarOutlined style={{ color: '#faad14', marginRight: 4 }} />
          {star}
        </span>
      </div>
    </Card>
  )

  return (
    <>
      {/* 检查更新中：边框流光动效（antd BorderBeam） */}
      {checking ? (
        <BorderBeam duration={1.8} lineWidth={2} size={120}>
          {card}
        </BorderBeam>
      ) : (
        card
      )}

      <TagEditor
        open={tagEditorOpen}
        projectName={project.name}
        projectTags={project.tags}
        allTags={allTags}
        onClose={() => setTagEditorOpen(false)}
        onAdd={(name, dimension) => onAssignTag(project.id, name, dimension)}
        onRemove={(tagId) => onRemoveTag(project.id, tagId)}
      />
    </>
  )
}

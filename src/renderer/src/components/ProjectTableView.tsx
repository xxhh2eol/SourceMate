import { useMemo } from 'react'
import { Button, Popconfirm, Typography, Tag } from 'antd'
import { DeleteOutlined, StarOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useTranslation } from 'react-i18next'
import type { ProjectWithTags } from '@shared/types'
import ResizableTable from './ResizableTable'
import { formatCount, formatRelativeTime } from '../utils/format'
import { projectBgColor } from '../utils/color'
import { useSettingsStore } from '../stores/settingsStore'

/** 列表页行类型：可选携带最新 AI 摘要 */
export type ProjectRow = ProjectWithTags & {
  summary?: { intro: string | null; usage: string | null } | null
}

/**
 * 项目表格视图（高密度浏览，点击行进入详情）
 * - 默认模式（Dashboard）：名称/仓库/描述/Star/Fork/语言/上次更新
 * - showAi 模式（项目列表页）：名称/Star/AI 一句话描述/AI 简介/上次更新
 */
export default function ProjectTableView({
  projects,
  onOpen,
  onDelete,
  showAi = false
}: {
  projects: ProjectRow[]
  onOpen: (id: number) => void
  /** 提供时表格追加「删除」操作列（Popconfirm 确认）；不提供则不显示 */
  onDelete?: (id: number) => Promise<void>
  showAi?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  // 卡片/表格行配色模式（彩色 = 按项目名淡色相；黑白 = 默认白底）
  const colorMode = useSettingsStore((s) => s.projectColorMode)

  // 每页条数选项：10 / 20 / 50 / 100；总数据超过 100 时追加「总条数」选项，便于一页看全
  const pageSizeOptions = useMemo(() => {
    const base = [10, 20, 50, 100]
    if (projects.length > 100 && !base.includes(projects.length)) {
      return [...base, projects.length]
    }
    return base
  }, [projects.length])

  const columns = useMemo<ColumnsType<ProjectRow>>(() => {
    const cols: ColumnsType<ProjectRow> = showAi
      ? [
          {
            title: t('repository.colName'),
            key: 'name',
            width: 200,
            render: (_, p) => (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <Typography.Text strong>{p.name}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {p.owner}/{p.repo}
                </Typography.Text>
              </div>
            )
          },
          {
            title: t('repository.colStar'),
            key: 'star',
            width: 90,
            render: (_, p) => (
              <span>
                <StarOutlined style={{ color: '#faad14', marginRight: 4 }} />
                {formatCount(p.starCount)}
              </span>
            )
          },
          {
            title: t('projects.colIntro'),
            key: 'intro',
            width: 320,
            ellipsis: true,
            render: (_, p) => (
              <span>
                {p.cnSummary && (
                  <Tag color="purple" style={{ fontSize: 10, lineHeight: '16px', marginRight: 4 }}>
                    AI
                  </Tag>
                )}
                {/* 一句话描述；无则不回退 GitHub 描述 */}
                <Typography.Text type="secondary">
                  {p.cnSummary ?? '-'}
                </Typography.Text>
              </span>
            )
          }
        ]
      : [
          {
            title: t('repository.colName'),
            dataIndex: 'name',
            key: 'name',
            width: 200,
            render: (name: string) => <Typography.Text strong>{name}</Typography.Text>
          },
          {
            title: t('repository.colRepo'),
            key: 'repo',
            width: 220,
            render: (_, p) => (
              <Typography.Text type="secondary">
                {p.owner}/{p.repo}
              </Typography.Text>
            )
          },
          {
            title: t('repository.colDesc'),
            dataIndex: 'description',
            key: 'description',
            width: 260,
            ellipsis: true,
            render: (d: string | null) => d ?? '-'
          },
          {
            title: t('repository.colStar'),
            key: 'star',
            width: 90,
            render: (_, p) => (
              <span>
                <StarOutlined style={{ color: '#faad14', marginRight: 4 }} />
                {formatCount(p.starCount)}
              </span>
            )
          },
          {
            title: t('repository.colUpdated'),
            key: 'updatedAt',
            width: 120,
            // 与卡片一致：优先 GitHub 真实更新时间 pushed_at，本地 updated_at 兜底
            render: (_, p) => (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {formatRelativeTime(p.pushedAt ?? p.updatedAt)}
              </Typography.Text>
            )
          }
        ]
    // 提供 onDelete 时追加「删除」操作列（与卡片视图的删除功能对齐）
    if (onDelete) {
      cols.push({
        title: t('common.delete'),
        key: 'actions',
        width: 90,
        render: (_, p) => (
          <Popconfirm title={t('projects.deleteConfirm')} onConfirm={() => void onDelete(p.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>
              {t('common.delete')}
            </Button>
          </Popconfirm>
        )
      })
    }
    return cols
  }, [t, showAi, onDelete])

  return (
    <ResizableTable
      rowKey="id"
      columns={columns}
      dataSource={projects}
      pagination={{
        // 非受控分页必须用 defaultPageSize：写死 pageSize 会被当作受控值，
        // 每次渲染都覆盖用户选择的 limit，导致选择条数后表格不变
        defaultPageSize: 20,
        pageSizeOptions,
        showSizeChanger: true,
        // 不隐藏分页器：否则选到「总条数」选项只剩一页时分页器消失，limit 无法再调整
        size: 'small'
      }}
      size="small"
      onRow={(p) => ({
        style: {
          cursor: 'pointer',
          // 彩色模式：行背景按项目名取淡色相；黑白模式：默认白底
          ...(colorMode === 'color' ? { background: projectBgColor(p.name) } : {})
        },
        onClick: () => onOpen(p.id)
      })}
    />
  )
}

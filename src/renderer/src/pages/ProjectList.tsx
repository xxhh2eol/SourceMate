import { useCallback, useEffect, useMemo, useState } from 'react'
import { Empty, Input, Select, Space, Spin, Tag, Typography } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ProjectWithTags, TagDimension, TagWithCount } from '@shared/types'
import ProjectTableView from '../components/ProjectTableView'

type SortKey = 'updatedAt' | 'starCount' | 'name'

interface ProjectRow extends ProjectWithTags {
  summary: { intro: string | null; usage: string | null } | null
}

/**
 * 项目列表页（侧栏「我的分类」目标页）：卡片行布局
 * 每行：头像 / 名称 / 版本徽标 / Star / 上次更新 / AI 一句话描述 / AI 简介（待分析标记）
 * /projects = 全部；/projects/dim/:dim = 维度组；/projects/tag/:tagId = 具体标签（旧 :index 数字路由视为全部）
 */
export default function ProjectList(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const params = useParams()
  // 维度组过滤（仅侧栏四组合法；旧数字 index 视为全部）
  const rawDim = params.dim as TagDimension | undefined
  const dim = rawDim && ['language', 'type', 'domain', 'purpose'].includes(rawDim) ? rawDim : null
  const rawTagId = Number(params.tagId)
  const tagFilterId = params.tagId && Number.isInteger(rawTagId) && rawTagId > 0 ? rawTagId : null

  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [allTags, setAllTags] = useState<TagWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt')

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [rows, tags] = await Promise.all([
        window.api.listProjectsWithSummaries(),
        window.api.listTags()
      ])
      setProjects(rows)
      setAllTags(tags)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // AI 分析完成时刷新（intro/usage 即时出现）
    const unsubscribe = window.api.onTaskProgress(() => void load())
    return unsubscribe
  }, [load])

  // 切换分类时重置本地搜索与排序
  useEffect(() => {
    setKeyword('')
    setSortKey('updatedAt')
  }, [dim, tagFilterId])

  // 当前筛选标签（标题 chip 显示中文名）
  const filterTag = useMemo(
    () => (tagFilterId ? allTags.find((t) => t.id === tagFilterId) ?? null : null),
    [allTags, tagFilterId]
  )

  const visibleProjects = useMemo(() => {
    let list = projects
    if (dim) {
      list = list.filter((p) => p.tags.some((tag) => tag.dimension === dim))
    }
    if (tagFilterId) {
      list = list.filter((p) => p.tags.some((tag) => tag.id === tagFilterId))
    }
    if (keyword.trim()) {
      const k = keyword.trim().toLowerCase()
      list = list.filter(
        (p) =>
          (p.name ?? '').toLowerCase().includes(k) ||
          (p.repo ?? '').toLowerCase().includes(k) ||
          (p.description ?? '').toLowerCase().includes(k) ||
          (p.cnSummary ?? '').toLowerCase().includes(k) ||
          (p.summary?.intro ?? '').toLowerCase().includes(k) ||
          (p.summary?.usage ?? '').toLowerCase().includes(k)
      )
    }
    const sorted = [...list]
    if (sortKey === 'starCount') sorted.sort((a, b) => b.starCount - a.starCount)
    else if (sortKey === 'name') sorted.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    // 项目真实更新时间（pushed_at）优先
    else
      sorted.sort((a, b) =>
        (b.pushedAt ?? b.updatedAt ?? '').localeCompare(a.pushedAt ?? a.updatedAt ?? '')
      )
    return sorted
  }, [projects, dim, tagFilterId, keyword, sortKey])

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <Typography.Title level={4} className="page-title">
            {t('projects.title')}
            {/* 当前筛选 Chip：维度组显示维度中文名，标签显示中文名，可关闭返回全部 */}
            {dim && (
              <Tag
                color="#1677ff"
                closable
                style={{ marginLeft: 8, fontSize: 13 }}
                onClose={() => navigate('/projects')}
              >
                {t(`filter.${dim}`)}
              </Tag>
            )}
            {filterTag && (
              <Tag
                color="#1677ff"
                closable
                style={{ marginLeft: 8, fontSize: 13 }}
                onClose={() => navigate('/projects')}
              >
                {filterTag.nameCn ?? filterTag.name}
              </Tag>
            )}
          </Typography.Title>
          <Typography.Paragraph className="page-desc">
            {t('dashboard.projectCount', { count: visibleProjects.length })}
          </Typography.Paragraph>
        </div>
        <Space>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t('dashboard.searchPlaceholder')}
            style={{ width: 260 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select<SortKey>
            value={sortKey}
            onChange={setSortKey}
            style={{ width: 140 }}
            options={[
              { value: 'updatedAt', label: t('dashboard.sortUpdated') },
              { value: 'starCount', label: t('dashboard.sortStar') },
              { value: 'name', label: t('dashboard.sortName') }
            ]}
          />
        </Space>
      </div>

      {loading ? (
        <Spin style={{ display: 'block', margin: '80px auto' }} />
      ) : visibleProjects.length === 0 ? (
        <Empty
          description={
            projects.length === 0 ? t('dashboard.emptyFirst') : t('dashboard.emptyNoMatch')
          }
          style={{ marginTop: 60 }}
        />
      ) : (
        <ProjectTableView
          projects={visibleProjects}
          showAi
          onOpen={(id) => navigate(`/repository/${id}/summary`)}
        />
      )}
    </div>
  )
}

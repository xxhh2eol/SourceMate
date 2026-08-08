import { useEffect, useMemo, useState } from 'react'
import { Layout, Menu, Tooltip, Button, Dropdown, Typography } from 'antd'
import type { MenuProps } from 'antd'
import {
  DashboardOutlined,
  RobotOutlined,
  SettingOutlined,
  InfoCircleOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  CloseOutlined,
  CheckOutlined
} from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TagDimension, TagWithCount } from '@shared/types'
import { useSettingsStore, type PinnedCategory } from '../stores/settingsStore'
import appLogo from '../../../../build/icon.png'

/** 主导航（设计文档 §8）：Dashboard / AI 分析 / Settings / About */
export default function Sidebar(): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)

  // Repository 详情页 / 项目列表页入口在首页列表，高亮归到「仪表盘」；Settings 各子页高亮归到「设置」
  const selectedKey =
    location.pathname.startsWith('/repository') || location.pathname.startsWith('/projects')
      ? '/dashboard'
      : location.pathname.startsWith('/settings')
        ? '/settings'
        : location.pathname

  return (
    <Layout.Sider
      theme="light"
      width={200}
      collapsedWidth={64}
      collapsible
      collapsed={collapsed}
      trigger={null}
      style={{ borderRight: '1px solid rgba(0, 0, 0, 0.06)' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontWeight: 600,
            fontSize: 15,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            flexShrink: 0
          }}
        >
          <img
            src={appLogo}
            alt="SourceMate"
            style={{ width: 26, height: 26, borderRadius: 6, flexShrink: 0, objectFit: 'contain' }}
          />
          {!collapsed && (
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>SourceMate</span>
          )}
        </div>

        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          onClick={({ key }) => navigate(key)}
          style={{ flexShrink: 0, borderInlineEnd: 'none' }}
          items={[
            { key: '/dashboard', icon: <DashboardOutlined />, label: t('nav.dashboard') },
            { key: '/ai-center', icon: <RobotOutlined />, label: t('nav.aiCenter') },
            { key: '/settings', icon: <SettingOutlined />, label: t('nav.settings') },
            { key: '/about', icon: <InfoCircleOutlined />, label: t('nav.about') }
          ]}
        />

        {!collapsed && <CategorySection />}

        {/* 折叠控制：底部按钮，展开时带文字，折叠时仅图标；marginTop auto 保证收起（无分类区块占位）时仍吸附底部 */}
        <div
          style={{
            flexShrink: 0,
            marginTop: 'auto',
            padding: 8,
            borderTop: '1px solid rgba(0, 0, 0, 0.06)'
          }}
        >
          <Tooltip title={collapsed ? t('nav.expand') : t('nav.collapse')} placement="right">
            <Button
              type="text"
              block
              onClick={() => setCollapsed((c) => !c)}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                borderRadius: 8,
                color: 'rgba(0, 0, 0, 0.55)'
              }}
            >
              {!collapsed && (
                <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{t('nav.collapse')}</span>
              )}
            </Button>
          </Tooltip>
        </div>
      </div>
    </Layout.Sider>
  )
}

/** 侧栏一级分组：语言 + AI 三维（类型/领域/用途），内容随标签库动态丰富 */
const SIDEBAR_GROUPS: TagDimension[] = ['language', 'type', 'domain', 'purpose']

/**
 * 「我的分类」区块：+ 弹出两级菜单（一级 = 维度组，二级 = 组内标签，动态读取标签库），
 * 可钉住整个维度组（一级）或具体标签（二级）；点击跳转项目列表页
 * （/projects、/projects/dim/:dim、/projects/tag/:tagId）；菜单项可自由删除，持久化于 settingsStore
 */
function CategorySection(): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const pinned = useSettingsStore((s) => s.pinnedCategories)
  const togglePin = useSettingsStore((s) => s.togglePinCategory)
  const [tags, setTags] = useState<TagWithCount[]>([])

  // 动态读取标签库（随 AI 分析不断丰富；AI 任务完成时刷新）
  useEffect(() => {
    const load = (): void => {
      void window.api.listTags().then(setTags)
    }
    load()
    const unsubscribe = window.api.onTaskProgress(load)
    return unsubscribe
  }, [])

  const officialTags = useMemo(() => tags.filter((t) => t.status === 'official'), [tags])
  const tagsByDim = useMemo(() => {
    const map = new Map<TagDimension, TagWithCount[]>()
    for (const dim of SIDEBAR_GROUPS) {
      map.set(dim, officialTags.filter((t) => t.dimension === dim))
    }
    return map
  }, [officialTags])
  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags])

  // 当前列表页路由解析：/projects = 全部；/projects/dim/:dim = 维度组；/projects/tag/:tagId = 标签
  const path = location.pathname
  const dimMatch = path.match(/^\/projects\/dim\/(\w+)$/)
  const tagMatch = path.match(/^\/projects\/tag\/(\d+)$/)
  const activeDim = (dimMatch?.[1] as TagDimension) ?? null
  const activeTagId = tagMatch ? Number(tagMatch[1]) : null

  const pinDim = (dim: TagDimension): void => {
    const pin: PinnedCategory = { kind: 'dim', dimension: dim }
    const willPin = !pinned.some((p) => p.kind === 'dim' && p.dimension === dim)
    togglePin(pin)
    if (willPin) navigate(`/projects/dim/${dim}`)
    else if (activeDim === dim) navigate('/projects')
  }

  const pinTag = (tagId: number): void => {
    const pin: PinnedCategory = { kind: 'tag', tagId }
    const willPin = !pinned.some((p) => p.kind === 'tag' && p.tagId === tagId)
    togglePin(pin)
    if (willPin) navigate(`/projects/tag/${tagId}`)
    else if (activeTagId === tagId) navigate('/projects')
  }

  const removePin = (pin: PinnedCategory): void => {
    togglePin(pin)
    if (pin.kind === 'dim' && activeDim === pin.dimension) navigate('/projects')
    if (pin.kind === 'tag' && activeTagId === pin.tagId) navigate('/projects')
  }

  // 两级菜单：一级 = 维度组（展开二级）；每组首项 = 钉住整个组，其后为组内标签
  const menuItems: MenuProps['items'] = [
    { key: 'all', label: t('sidebar.all') },
    { type: 'divider' },
    ...SIDEBAR_GROUPS.map((dim) => {
      const dimPinned = pinned.some((p) => p.kind === 'dim' && p.dimension === dim)
      const children: MenuProps['items'] = [
        {
          key: `pindim:${dim}`,
          label: t('sidebar.pinDim', { name: t(`filter.${dim}`) }),
          icon: dimPinned ? <CheckOutlined /> : undefined
        }
      ]
      const dimTags = tagsByDim.get(dim) ?? []
      if (dimTags.length > 0) {
        children.push({ type: 'divider' })
        for (const tag of dimTags) {
          children.push({
            key: `tag:${tag.id}`,
            label: tag.nameCn ?? tag.name,
            icon: pinned.some((p) => p.kind === 'tag' && p.tagId === tag.id) ? (
              <CheckOutlined />
            ) : undefined
          })
        }
      }
      return { key: `dim:${dim}`, label: t(`filter.${dim}`), children }
    })
  ]

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '8px 8px 4px',
        borderTop: '1px solid rgba(0, 0, 0, 0.06)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography.Text style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)' }}>
          {t('sidebar.myCategories')}
        </Typography.Text>
        <Dropdown
          trigger={['click']}
          placement="bottomLeft"
          menu={{
            items: menuItems,
            onClick: ({ key }) => {
              if (key === 'all') navigate('/projects')
              else if (key.startsWith('pindim:')) pinDim(key.slice(7) as TagDimension)
              else if (key.startsWith('tag:')) pinTag(Number(key.slice(4)))
            }
          }}
        >
          <Tooltip title={t('sidebar.addTip')} placement="right">
            <Button size="small" type="text" icon={<PlusOutlined />} />
          </Tooltip>
        </Dropdown>
      </div>

      <div style={{ flex: 1, overflow: 'auto', marginTop: 4 }}>
        {/* 固定的「全部」入口：全部项目列表页 */}
        <CategoryItem
          label={t('sidebar.all')}
          active={activeDim === null && activeTagId === null}
          onClick={() => navigate('/projects')}
        />
        {pinned.length === 0 && (
          <div style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.35)', padding: '2px 8px' }}>
            {t('sidebar.emptyTip')}
          </div>
        )}
        {pinned.map((pin) => {
          if (pin.kind === 'dim') {
            const dim = pin.dimension ?? 'type'
            return (
              <CategoryItem
                key={`dim:${dim}`}
                label={t(`filter.${dim}`)}
                active={activeDim === dim}
                onClick={() => navigate(`/projects/dim/${dim}`)}
                onRemove={() => removePin(pin)}
              />
            )
          }
          const tag = pin.tagId !== undefined ? tagById.get(pin.tagId) : undefined
          return (
            <CategoryItem
              key={`tag:${pin.tagId}`}
              label={tag ? (tag.nameCn ?? tag.name) : `#${pin.tagId}`}
              active={activeTagId === pin.tagId}
              onClick={() => pin.tagId !== undefined && navigate(`/projects/tag/${pin.tagId}`)}
              onRemove={() => removePin(pin)}
            />
          )
        })}
      </div>
    </div>
  )
}

/** 分类菜单项：悬停显示删除按钮；选中态高亮 */
function CategoryItem({
  label,
  active,
  onClick,
  onRemove
}: {
  label: string
  active: boolean
  onClick: () => void
  onRemove?: () => void
}): React.JSX.Element {
  return (
    <div
      className="category-item"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 8px',
        borderRadius: 6,
        cursor: 'pointer',
        background: active ? 'rgba(22, 119, 255, 0.1)' : 'transparent',
        color: active ? '#1677ff' : 'rgba(0, 0, 0, 0.75)'
      }}
    >
      <span
        style={{
          fontSize: 13,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {label}
      </span>
      {onRemove && (
        <Button
          size="small"
          type="text"
          className="category-remove"
          icon={<CloseOutlined style={{ fontSize: 10 }} />}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        />
      )}
    </div>
  )
}

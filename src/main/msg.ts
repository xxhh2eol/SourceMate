import { getSetting } from './db/dao'

/**
 * 按应用语言输出错误/提示文案（渲染层已在设置切换时同步 app.language 到主进程）
 * 用法：msg('未配置 AI 模型', 'AI model not configured')
 */
export function msg(zh: string, en: string): string {
  return getSetting<string>('app.language', 'zh-CN') === 'en-US' ? en : zh
}

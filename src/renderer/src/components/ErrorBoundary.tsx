import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Button, Result } from 'antd'
import i18n from '../i18n'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** 全局错误边界：渲染异常时显示错误信息而非白屏 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <Result
          status="error"
          title={i18n.t('error.title')}
          subTitle={this.state.error.message}
          extra={
            <Button type="primary" onClick={() => this.setState({ error: null })}>
              {i18n.t('error.retry')}
            </Button>
          }
        />
      )
    }
    return this.props.children
  }
}

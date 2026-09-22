// 职责：全局错误边界 —— 捕获任何渲染期未捕获异常，
// 避免单个组件抛错就把整个 webview 打成白屏（项目规则：未捕获异常视为不合格）。
// 出错时显示可读的错误信息 + 完整堆栈 + 出错组件栈 + 重新加载按钮：
// 既兜底又不丢上下文，同时把异常打到控制台，release 构建无 overlay 时这是唯一线索，便于反查根因。
//
// 注意：错误边界只能捕获「渲染期抛出的异常」，抓不住「无限重渲染死循环」
// （表现成界面卡死、必须手动杀进程重启）。若复现时是「卡住」而非「红字屏」，
// 说明是死循环而非 throw —— 此时请打开 DevTools Console 看是否有
// "Maximum update depth exceeded" 等堆栈，连同本屏红字一起反馈。

import { Component, type ErrorInfo, type ReactNode } from "react";
import styles from "./ErrorBoundary.module.css";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // release 无错误 overlay，这是唯一能拿到堆栈的出口，务必保留
    console.error("未捕获的渲染异常：", error, info.componentStack);
    this.setState({ info });
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleCopy = (): void => {
    const text = [
      this.state.error?.message ?? "",
      this.state.error?.stack ?? "",
      this.state.info?.componentStack ?? "",
    ].join("\n");
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  render(): ReactNode {
    const { error, info } = this.state;
    if (error === null) return this.props.children;

    return (
      <div className={styles.screen} role="alert">
        <div className={styles.card}>
          <div className={styles.title}>哎呀，出错了</div>
          <div className={styles.hint}>
            界面遇到了一个意外错误，但你的数据没有丢失。点击下方按钮可重新加载应用；
            若反复出现，请把下方错误信息（或点「复制错误」）反馈给开发者以便修复。
          </div>
          <pre className={styles.detail}>{error.message}</pre>
          {error.stack !== undefined && (
            <pre className={styles.stack}>{error.stack}</pre>
          )}
          {info?.componentStack !== undefined && (
            <pre className={styles.stack}>{info.componentStack}</pre>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.reload} onClick={this.handleReload}>
              重新加载
            </button>
            <button type="button" className={styles.copy} onClick={this.handleCopy}>
              复制错误
            </button>
          </div>
        </div>
      </div>
    );
  }
}

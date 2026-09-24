// 职责：CodeMirror 6 的 React 封装，经验编辑器的 Markdown 行内即时渲染输入框。
// value 单向注入：仅当外部值与编辑器内容不一致时回写（上传 md / 图片修复回写）；
// 用户输入经 onChange 抛出纯 Markdown 字符串 —— 文档始终是源码，无中间模型，
// 因此存储、图片路径修复、附件链路全部不受影响。
// 编辑器样式（含渲染态装饰样式）集中在本文件的 EditorView.theme 里，颜色一律引用 --dt-* 变量。

import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { liveMarkdown, type ImageResolver } from "./cmLiveMarkdown";

interface ExperienceMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** 图片地址解析：把 md 里的图片地址转成 WebView 可加载的 URL */
  resolveImage: ImageResolver;
  /** 宿主容器的样式类（限高 / 描边由调用方决定） */
  className?: string;
  placeholder?: string;
}

/** 等宽字体栈：与预览区 / 卡片区的 code 样式保持同一来源 */
const MONO_FONT = "var(--font-family-monospace, ui-monospace, SFMono-Regular, Menlo, monospace)";

/** CodeMirror 主题：基础编辑区 + 全部渲染态装饰样式 */
const editorTheme: Extension = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--dt-text)",
    fontSize: "13px",
  },
  "&.cm-editor.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.6",
  },
  ".cm-content": {
    padding: "8px 10px",
    caretColor: "var(--dt-accent)",
  },
  ".cm-line": {
    padding: "0",
  },
  ".cm-placeholder": {
    color: "var(--dt-text-muted)",
  },
  ".cm-selectionBackground": {
    backgroundColor: "var(--dt-accent-soft) !important",
  },

  // 标题：按层级放大加粗，光标所在行保留「#」源码
  ".cm-md-heading": {
    fontWeight: "600",
    color: "var(--dt-text)",
  },
  ".cm-md-h1": {
    fontSize: "1.5em",
    paddingTop: "4px",
  },
  ".cm-md-h2": {
    fontSize: "1.3em",
    paddingTop: "3px",
  },
  ".cm-md-h3": {
    fontSize: "1.15em",
  },
  ".cm-md-h4, .cm-md-h5, .cm-md-h6": {
    fontSize: "1em",
  },

  // 行内代码
  ".cm-md-inline-code": {
    backgroundColor: "var(--dt-panel-2)",
    borderRadius: "4px",
    padding: "1px 4px",
    fontFamily: MONO_FONT,
    fontSize: "0.92em",
  },
  // 围栏代码块：各行底色；围栏与语言标注淡化
  ".cm-md-code-line": {
    backgroundColor: "var(--dt-panel-2)",
  },
  ".cm-md-fence": {
    opacity: "0.4",
  },
  ".cm-md-code-info": {
    color: "var(--dt-text-muted)",
    fontFamily: MONO_FONT,
    fontSize: "0.9em",
  },

  // 强调与链接
  ".cm-md-strong": {
    fontWeight: "700",
  },
  ".cm-md-em": {
    fontStyle: "italic",
  },
  ".cm-md-link": {
    color: "var(--dt-accent)",
    textDecoration: "underline",
  },

  // 引用块：左色条 + 淡化
  ".cm-md-quote-line": {
    borderLeft: "3px solid var(--dt-border-strong)",
    paddingLeft: "7px",
    color: "var(--dt-text-muted)",
  },

  // 列表圆点
  ".cm-md-bullet": {
    color: "var(--dt-text-muted)",
  },

  // 行内图片 widget
  ".cm-md-image": {
    maxWidth: "100%",
    height: "auto",
    borderRadius: "6px",
    display: "block",
    margin: "4px 0",
  },
});

export function ExperienceMarkdownEditor({
  value,
  onChange,
  resolveImage,
  className,
  placeholder,
}: ExperienceMarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // 用 ref 持有最新回调：编辑器实例只创建一次，回调变化不触发重建
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const resolverRef = useRef(resolveImage);
  resolverRef.current = resolveImage;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const stableResolver: ImageResolver = (raw) => resolverRef.current(raw);
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          keymap.of([...defaultKeymap, ...historyKeymap]),
          history(),
          cmPlaceholder(placeholder ?? ""),
          liveMarkdown(stableResolver),
          markdown(),
          EditorView.lineWrapping,
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
      parent: host,
    });
    // 打开即把光标放到文末：接着上一次写，不打断已有内容
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 仅在挂载时创建一次；value 后续变化经下方 effect 同步进编辑器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部值变化（上传 md / 图片修复回写）同步进编辑器；用户输入不经过此路径
  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div ref={hostRef} className={className} />;
}

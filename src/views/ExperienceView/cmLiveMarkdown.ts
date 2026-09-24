// 职责：CodeMirror 6 的 Markdown「行内实时渲染」装饰引擎（Obsidian 实时预览同思路）。
// 文档始终是纯 Markdown 字符串，无中间 AST；本文件把语法树节点装饰成渲染样式：
// 光标 / 选区所在处退回源码（语法标记重新可见），离开后自动恢复渲染态。
// 覆盖：标题（放大 + 藏 #）、行内代码 / 加粗 / 斜体（样式 + 藏标记）、链接、
// 图片（整段替换为真实图片 widget）、围栏代码块（底色 + 淡化围栏）、引用块、列表符号。

import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

/** 图片地址解析器：把 md 里的图片地址转成 WebView 可加载的 URL */
export type ImageResolver = (rawSrc: string) => string;

/** 行内图片 widget：光标不在图上时把 ![]() 整段替换为真实图片 */
class MarkdownImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }

  override eq(other: MarkdownImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM(): HTMLElement {
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.className = "cm-md-image";
    return img;
  }
}

/** 列表圆点 widget：把「-」「*」「+」替换成统一的圆点符号 */
class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-bullet";
    span.textContent = "•";
    return span;
  }
}

/** 从 Image 节点文本里抠出图片地址（含可选标题时取首段） */
function parseImageUrl(text: string): { url: string; alt: string } | null {
  const match = /^!\[([^\]]*)\]\((.+)\)$/.exec(text);
  if (match === null) return null;
  const url = match[2].trim().split(/\s+/)[0] ?? "";
  if (url === "") return null;
  return { url, alt: match[1] ?? "" };
}

/** 光标 / 选区是否与 [from, to] 相交：相交则该节点保持源码态 */
function isActive(selection: { from: number; to: number }, from: number, to: number): boolean {
  return selection.from <= to && selection.to >= from;
}

/** 遍历语法树，收集全部装饰（排序后一次性建集） */
function buildDecorations(state: EditorState, resolveImage: ImageResolver): DecorationSet {
  const doc = state.doc;
  const selection = state.selection.main;
  const ranges: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      const name = node.name;
      const parent = node.node?.parent ?? null;

      // 标题：整行放大加粗；光标不在该行时藏掉「#」标记（含其后空格）
      if (/^ATXHeading[1-6]$/.test(name)) {
        const line = doc.lineAt(node.from);
        ranges.push(Decoration.line({ class: `cm-md-heading cm-md-h${name.slice(-1)}` }).range(line.from));
        return;
      }
      if (name === "HeaderMark" && parent !== null && /^ATXHeading[1-6]$/.test(parent.name)) {
        const line = doc.lineAt(node.from);
        if (!isActive(selection, line.from, line.to)) {
          let end = node.to;
          while (end < line.to && doc.sliceString(end, end + 1) === " ") end += 1;
          ranges.push(Decoration.replace({}).range(node.from, end));
        }
        return;
      }

      // 行内代码：整段样式；光标不在其中时藏掉反引号
      if (name === "InlineCode") {
        ranges.push(Decoration.mark({ class: "cm-md-inline-code" }).range(node.from, node.to));
        return;
      }
      if (name === "CodeMark" && parent !== null && parent.name === "InlineCode") {
        if (!isActive(selection, parent.from, parent.to)) {
          ranges.push(Decoration.replace({}).range(node.from, node.to));
        }
        return;
      }
      // 围栏代码块：各行加底色；光标不在块内时淡化围栏行与语言标注
      if (name === "CodeMark" && parent !== null && parent.name === "FencedCode") {
        if (!isActive(selection, parent.from, parent.to)) {
          ranges.push(Decoration.mark({ class: "cm-md-fence" }).range(node.from, node.to));
        }
        return;
      }
      if (name === "FencedCode") {
        const fromLine = doc.lineAt(node.from).number;
        const toLine = doc.lineAt(node.to).number;
        for (let i = fromLine; i <= toLine; i += 1) {
          ranges.push(Decoration.line({ class: "cm-md-code-line" }).range(doc.line(i).from));
        }
        return;
      }
      if (name === "CodeInfo") {
        ranges.push(Decoration.mark({ class: "cm-md-code-info" }).range(node.from, node.to));
        return;
      }

      // 加粗 / 斜体：整段样式；光标不在其中时藏掉 ** / * 标记
      if (name === "StrongEmphasis" || name === "Emphasis") {
        ranges.push(
          Decoration.mark({ class: name === "StrongEmphasis" ? "cm-md-strong" : "cm-md-em" }).range(
            node.from,
            node.to,
          ),
        );
        return;
      }
      if (name === "EmphasisMark" && parent !== null) {
        if (parent.name === "StrongEmphasis" || parent.name === "Emphasis") {
          if (!isActive(selection, parent.from, parent.to)) {
            ranges.push(Decoration.replace({}).range(node.from, node.to));
          }
        }
        return;
      }

      // 链接：整体强调色
      if (name === "Link") {
        ranges.push(Decoration.mark({ class: "cm-md-link" }).range(node.from, node.to));
        return;
      }

      // 图片：光标不在图上时整段替换为真实图片；否则按链接样式显示源码
      if (name === "Image") {
        if (!isActive(selection, node.from, node.to)) {
          const parsed = parseImageUrl(doc.sliceString(node.from, node.to));
          if (parsed !== null) {
            ranges.push(
              Decoration.replace({
                widget: new MarkdownImageWidget(resolveImage(parsed.url), parsed.alt),
              }).range(node.from, node.to),
            );
            return;
          }
        }
        ranges.push(Decoration.mark({ class: "cm-md-link" }).range(node.from, node.to));
        return;
      }

      // 引用块：各行左侧色条 + 淡化；光标不在该行时藏掉「>」
      if (name === "Blockquote") {
        const fromLine = doc.lineAt(node.from).number;
        const toLine = doc.lineAt(node.to).number;
        for (let i = fromLine; i <= toLine; i += 1) {
          ranges.push(Decoration.line({ class: "cm-md-quote-line" }).range(doc.line(i).from));
        }
        return;
      }
      if (name === "QuoteMark") {
        const line = doc.lineAt(node.from);
        if (!isActive(selection, line.from, line.to)) {
          ranges.push(Decoration.replace({}).range(node.from, node.to));
        }
        return;
      }

      // 列表符号：「-」等替换为圆点，有序号列表保持原样；光标在该行时显示源码
      if (name === "ListMark") {
        const line = doc.lineAt(node.from);
        const mark = doc.sliceString(node.from, node.to);
        if (isActive(selection, line.from, line.to)) return;
        if (/^[-*+]$/.test(mark)) {
          ranges.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
        } else {
          ranges.push(Decoration.mark({ class: "cm-md-fence" }).range(node.from, node.to));
        }
        return;
      }

      // 分隔线：淡化「---」本体
      if (name === "HorizontalRule") {
        ranges.push(Decoration.mark({ class: "cm-md-fence" }).range(node.from, node.to));
        return;
      }
    },
  });

  ranges.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  return Decoration.set(ranges, true);
}

/**
 * 行内实时渲染扩展。每次文档或选区变化都全量重建装饰 —— 本应用文档量级很小（几 KB），
 * 全量重建的开销可忽略，换来的是实现简单、无增量映射 bug。
 * 注意：装饰会改变行高（标题放大、图片撑高），必须用 StateField 而非 ViewPlugin 提供。
 */
export function liveMarkdown(resolveImage: ImageResolver): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, resolveImage),
    update: (value, tr) =>
      tr.docChanged || tr.selection ? buildDecorations(tr.state, resolveImage) : value,
    provide: (field) => EditorView.decorations.from(field),
  });
}

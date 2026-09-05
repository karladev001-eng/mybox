import { createElement as h, useId, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MessageMarkdown({ text, onOpenLink }) {
  const prefix = `message-${useId().replace(/[^a-z0-9]/gi, "")}-`;
  const [error, setError] = useState("");
  return h("div", { className: "message-markdown" },
    h(Markdown, {
      remarkPlugins: [remarkGfm], skipHtml: true,
      remarkRehypeOptions: { clobberPrefix: prefix },
      components: {
        a: ({ href, children }) => {
          if (href?.startsWith("#")) return h("a", { href }, children);
          if (!/^https?:\/\//i.test(href ?? "")) return h("span", null, children);
          return h("a", { href, onClick: async (event) => {
            event.preventDefault();
            try { await onOpenLink?.(href); setError(""); }
            catch { setError("リンクを開けませんでした。"); }
          } }, children);
        },
        img: ({ alt }) => h("span", { className: "markdown-image-label" }, alt || "画像"),
        table: ({ children }) => h("div", { className: "markdown-table-scroll", tabIndex: 0, role: "region", "aria-label": "表（横にスクロールできます）" }, h("table", null, children)),
        th: ({ children, style }) => h("th", { scope: "col", style }, children),
        pre: ({ children }) => h("pre", { tabIndex: 0, "aria-label": "コード" }, children),
      },
    }, text ?? ""),
    error ? h("p", { role: "alert" }, error) : null,
  );
}

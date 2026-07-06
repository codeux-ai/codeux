import { marked } from "marked";
import { getSafeUrl } from "../v2/lib/safe-url.js";

export interface RenderMarkdownOptions {
  transformHref?: (href: string, kind: "link" | "image") => string;
}

const escapeHtml = (html: string): string => {
  return html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

function createRenderer(options?: RenderMarkdownOptions) {
  const renderer = new marked.Renderer();
  renderer.html = () => "";

  renderer.link = function (token) {
    const { href, title, tokens } = token;
    const parsedText = this.parser.parseInline(tokens);
    const safeHref = getSafeUrl(href);

    if (!safeHref) {
      return parsedText;
    }

    const transformedHref = options?.transformHref?.(safeHref, "link") ?? safeHref;
    const safeTransformedHref = getSafeUrl(transformedHref);
    if (!safeTransformedHref) {
      return parsedText;
    }

    let out = `<a href="${escapeHtml(safeTransformedHref)}"`;
    if (title) {
      out += ` title="${escapeHtml(title)}"`;
    }

    if (/^https?:\/\//i.test(safeTransformedHref)) {
      out += ` rel="noopener noreferrer"`;
    }

    out += `>${parsedText}</a>`;
    return out;
  };

  renderer.image = function (token) {
    const { href, title, text } = token;
    const safeHref = getSafeUrl(href, { kind: "image" });
    if (!safeHref) {
      return escapeHtml(text);
    }

    const transformedHref = options?.transformHref?.(safeHref, "image") ?? safeHref;
    const safeTransformedHref = getSafeUrl(transformedHref, { kind: "image" });
    if (!safeTransformedHref) {
      return escapeHtml(text);
    }

    let out = `<img src="${escapeHtml(safeTransformedHref)}" alt="${escapeHtml(text)}"`;
    if (title) {
      out += ` title="${escapeHtml(title)}"`;
    }
    out += ">";
    return out;
  };

  return renderer;
}

export const renderMarkdown = (text?: string, options?: RenderMarkdownOptions): string => {
  if (!text) return "";
  return marked.parse(text, { renderer: createRenderer(options) }) as string;
};

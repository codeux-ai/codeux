import { marked } from "marked";

export interface RenderMarkdownOptions {
  transformHref?: (href: string, kind: "link" | "image") => string;
}

const isUrlSafe = (url: string, isImage: boolean = false): boolean => {
  try {
    // Decode HTML entities to handle obfuscated protocols like javascript&#00058;alert(1)
    const decodedUrl = url.replace(/&#[xX]?[0-9a-fA-F]+;?/g, (match) => {
      let code;
      if (match.startsWith("&#x") || match.startsWith("&#X")) {
        code = parseInt(match.replace(/&#[xX]/, "").replace(";", ""), 16);
      } else {
        code = parseInt(match.replace("&#", "").replace(";", ""), 10);
      }
      return String.fromCharCode(code);
    });

    const cleanUrl = decodedUrl.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();

    if (cleanUrl.startsWith("//") || cleanUrl.startsWith("\\\\")) {
      return false;
    }

    if (cleanUrl.startsWith("/") || cleanUrl.startsWith("#") || cleanUrl.startsWith("?")) {
      return true;
    }

    let parsedAbsolute: URL | null = null;
    try {
      parsedAbsolute = new URL(cleanUrl);
    } catch {
      // Not a valid absolute URL, fall through to relative check
    }

    if (parsedAbsolute) {
      if (isImage) {
        return ["http:", "https:"].includes(parsedAbsolute.protocol);
      }
      return ["http:", "https:", "mailto:"].includes(parsedAbsolute.protocol);
    }

    const colonIndex = cleanUrl.indexOf(":");
    if (colonIndex !== -1) {
      const slashIndex = cleanUrl.indexOf("/");
      const hashIndex = cleanUrl.indexOf("#");
      const queryIndex = cleanUrl.indexOf("?");

      let firstPathChar = -1;
      if (slashIndex !== -1) firstPathChar = slashIndex;
      if (hashIndex !== -1 && (firstPathChar === -1 || hashIndex < firstPathChar)) firstPathChar = hashIndex;
      if (queryIndex !== -1 && (firstPathChar === -1 || queryIndex < firstPathChar)) firstPathChar = queryIndex;

      if (firstPathChar === -1 || colonIndex < firstPathChar) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
};

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

    if (!isUrlSafe(href)) {
      return parsedText;
    }
    const transformedHref = options?.transformHref?.(href.trim(), "link") ?? href.trim();
    if (!isUrlSafe(transformedHref)) {
      return parsedText;
    }

    let out = `<a href="${escapeHtml(transformedHref)}"`;
    if (title) {
      out += ` title="${escapeHtml(title)}"`;
    }

    if (/^https?:\/\//i.test(transformedHref) || transformedHref.startsWith("//")) {
      out += ` rel="noopener noreferrer"`;
    }

    out += `>${parsedText}</a>`;
    return out as any;
  };

  renderer.image = function (token) {
    const { href, title, text } = token;
    if (!isUrlSafe(href, true)) {
      return escapeHtml(text);
    }
    const transformedHref = options?.transformHref?.(href.trim(), "image") ?? href.trim();
    if (!isUrlSafe(transformedHref, true)) {
      return escapeHtml(text);
    }

    let out = `<img src="${escapeHtml(transformedHref)}" alt="${escapeHtml(text)}"`;
    if (title) {
      out += ` title="${escapeHtml(title)}"`;
    }
    out += ">";
    return out as any;
  };

  return renderer;
}

export const renderMarkdown = (text?: string, options?: RenderMarkdownOptions): string => {
  if (!text) return "";
  return marked.parse(text, { renderer: createRenderer(options) }) as string;
};

import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true,
});

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "br",
    "hr",
    "blockquote",
    "pre",
    "code",
    "ul",
    "ol",
    "li",
    "strong",
    "em",
    "a",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    code: ["class"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      target: "_blank",
      rel: "noopener noreferrer nofollow",
    }),
  },
};

function normalizeHeadingTitle(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+#+\s*$/, "")
    .toLowerCase();
}

export function stripLeadingTitleHeading(markdownSource: string, title: string): string {
  const match = markdownSource.match(/^(\s*#\s+(.+?)\s*)\n+/);
  if (!match) {
    return markdownSource;
  }

  const headingText = match[2] ?? "";
  if (normalizeHeadingTitle(headingText) !== normalizeHeadingTitle(title)) {
    return markdownSource;
  }

  return markdownSource.slice(match[0].length);
}

export function renderMarkdownToSafeHtml(markdownSource: string): string {
  const rendered = markdown.render(markdownSource);
  return sanitizeHtml(rendered, SANITIZE_OPTIONS);
}

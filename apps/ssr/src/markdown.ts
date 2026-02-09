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

export function renderMarkdownToSafeHtml(markdownSource: string): string {
  const rendered = markdown.render(markdownSource);
  return sanitizeHtml(rendered, SANITIZE_OPTIONS);
}

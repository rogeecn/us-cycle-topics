import { StoredContent } from "../../common/src/types.js";

function escapeDoubleQuotes(input: string): string {
  return input.replace(/"/g, '\\"');
}

export function toMarkdown(article: StoredContent): string {
  const tags = `[${article.tags.map((tag) => `"${escapeDoubleQuotes(tag)}"`).join(", ")}]`;
  const categories = `["Local Guides"]`;
  const createdDate = article.createdAt.toISOString();
  const lastmod = article.lastmod.toISOString();
  const thumbnail = "img/placeholder.png";

  return `---
title: "${escapeDoubleQuotes(article.title)}"
date: ${createdDate}
lastmod: ${lastmod}
description: "${escapeDoubleQuotes(article.description)}"
slug: "${escapeDoubleQuotes(article.slug)}"
tags: ${tags}
categories: ${categories}
thumbnail: "${thumbnail}"
lead: "${escapeDoubleQuotes(article.description)}"
authorbox: true
pager: true
toc: true
comments: false
draft: ${article.status === "draft"}
params:
  source_key: "${escapeDoubleQuotes(article.sourceKey)}"
  prompt_version: "${escapeDoubleQuotes(article.promptVersion)}"
  model_version: "${escapeDoubleQuotes(article.modelVersion)}"
---

${article.content.trim()}
`;
}

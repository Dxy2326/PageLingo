/* global self */

/**
 * Site translation profiles are intentionally declarative.
 * To add a new site later, append a profile here and keep web-translator.js
 * focused on scheduling, filtering, and rendering.
 */
self.XH_SITE_TRANSLATION_PROFILES = [
  {
    id: "github",
    label: "GitHub",
    hostPattern: "(^|\\.)github\\.com$",
    promptProfile: "github",
    minLength: 18,
    maxLength: 1200,
    selectors: [
      ".markdown-body p",
      ".markdown-body li",
      ".markdown-body h1",
      ".markdown-body h2",
      ".markdown-body h3",
      ".markdown-body h4",
      ".markdown-body h5",
      ".markdown-body h6",
      ".comment-body p",
      ".comment-body li",
      ".js-comment-body p",
      ".js-comment-body li",
      ".discussion-timeline-item .comment-body p",
      ".release .markdown-body p",
      "[data-testid='issue-body'] p",
      "[data-testid='issue-body'] li",
      "[data-testid='markdown-body'] p",
      "[data-testid='markdown-body'] li"
    ]
  },
  {
    id: "web",
    label: "Common Web",
    hostPattern: ".*",
    promptProfile: "web",
    minLength: 28,
    maxLength: 1000,
    selectors: [
      "main article p",
      "main article li",
      "main article h1",
      "main article h2",
      "main article h3",
      "article p",
      "article li",
      "article h1",
      "article h2",
      "article h3",
      "main p",
      "main li",
      "main h1",
      "main h2",
      "main h3",
      "[role='main'] p",
      "[role='main'] li",
      "[role='main'] h1",
      "[role='main'] h2",
      "[role='main'] h3",
      ".post p",
      ".post li",
      ".entry-content p",
      ".entry-content li",
      ".article-content p",
      ".article-content li",
      ".content p",
      ".content li"
    ]
  }
];

# Alexsib Blog — Design direction

A personal programming and AI blog that explains ideas through approachable writing, examples and interactive illustrations. Articles help the author learn by explaining and help readers understand without assuming prior expertise.

## Selected direction

**Terminal notebook:** dark surfaces, a signature green accent and a centered, book-inspired reading layout. The book metaphor is visual only: posts may be short, stand alone and be read in any order.

Use monospace typography for identity, navigation, labels and technical controls; system sans-serif for explanations; system serif for article titles. Avoid a dashboard-like public experience, visual clutter and decorative animation that distracts from learning.

## Visual tokens

These values describe the selected prototype, not a production implementation.

| Token | Value | Purpose |
| --- | --- | --- |
| Background | `#0b100d` | Main canvas |
| Surface | `#111a15` | Terminal panels and contained controls |
| Border | `#304537` | Quiet separators |
| Strong control border | `#5b7663` | Form and interactive boundaries |
| Text | `#edf4ef` | Primary content |
| Muted text | `#a6b9ac` | Supporting copy and metadata |
| Accent | `#a1efb5` | Identity, interactive cues and focus |

Keep the public shell near 1120px wide, the article listing near 740px and reading content around 660px. Center the content column; left-align explanatory paragraphs. Give individual posts generous separation rather than packing them into cards. Stack layouts on narrow screens.

## Screen map

| Screen | Main purpose |
| --- | --- |
| Home | Brief author introduction, terminal-inspired presentation and centered article list |
| Article | Comfortable reading with examples, optional interactive figures and a return path |
| About | Explain learning in public without inventing credentials or biography |
| Admin login | Single-administrator username/password access; no public registration |
| Article dashboard | Find posts, distinguish drafts from published content and start writing |
| Editor | Proposed Markdown editing, excerpt, slug, tags, optional images and publishing controls |
| Draft preview | Preview actual content through the public renderer, with a clear unpublished indicator |
| Not found | Friendly explanation and links back to articles |

Prototype preview pages are illustrative and do not implement authentication, storage or real publishing. The production preview must be access-controlled and reflect editor content.

## Writing and interactive figures

Explain one idea at a time. Introduce technical terms, prefer concrete examples and do not impose a minimum article length or mandatory chapter numbering. Spanish is the current editorial language.

Interactive figures should clarify a concept, not merely decorate it. Start with a context-window illustration: advance messages, observe what remains available and reset the example. Explain that message cards are a teaching simplification; real context limits count tokens, and dropping old messages is not a universal strategy.

Proposed authoring approach: insert a named figure through a Markdown directive backed by an explicit registry of prebuilt components. Use the same sanitized content pipeline for preview and public reading. Do not evaluate arbitrary JSX, scripts or raw HTML from articles. Unknown figure names should produce actionable feedback.

## Accessibility and behavior

- Preserve readable contrast, visible keyboard focus and semantic landmarks.
- Support keyboard-operated diagrams, text explanations and meaningful control labels.
- Never communicate status through green alone.
- Respect reduced-motion preferences if animation is introduced.
- Distinguish saving, saved, failed and unpublished states truthfully.
- Do not imply that client-side hiding makes a draft private; enforce authorization on the server.

## Implementation boundary

Planned stack: Next.js, TypeScript, Tailwind, Turso/SQLite, Drizzle, Vercel Blob and Vercel hosting. Authentication follows a single-admin credential flow with jose JWTs in protected cookies and server-side authorization. Secrets never belong in Git.

Newsletter, public accounts, comments, multi-tenant support, a general diagram builder and video-script generation are outside the initial MVP. Local HTML design explorations and internal task notes are intentionally excluded from this repository's published files.

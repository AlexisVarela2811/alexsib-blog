'use client';

import { createElement as h } from 'react';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { ArticleMetadata } from './article-metadata.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { DraftEditor } from './draft-editor.ts';

/** Tags remain text while editing so commas and whitespace can be entered naturally. */
export interface ArticleEditorValues {
  title: string;
  slug: string;
  excerpt: string;
  tags: string;
  markdown: string;
}

export interface ArticleEditorProps {
  values: ArticleEditorValues;
  onChange: (values: ArticleEditorValues) => void;
}

/** Trim entries, discard empty entries, and preserve order and duplicates. */
export function parseTags(text: string): string[] {
  return text.split(',').map((tag) => tag.trim()).filter(Boolean);
}

export function formatTags(tags: string[]): string {
  return tags.map((tag) => tag.trim()).filter(Boolean).join(', ');
}

/** Presentation only: conversion and persistence remain the parent's responsibility. */
export function ArticleEditor({ values, onChange }: ArticleEditorProps) {
  return h('div', { className: 'grid gap-8' },
    h(ArticleMetadata, {
      title: values.title, slug: values.slug, excerpt: values.excerpt, tags: values.tags,
      onChange: (field, value) => onChange({ ...values, [field]: value }),
    }),
    h(DraftEditor, { markdown: values.markdown, onChange: (markdown) => onChange({ ...values, markdown }) }),
  );
}

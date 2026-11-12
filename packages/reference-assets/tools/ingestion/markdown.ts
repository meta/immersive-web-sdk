/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Splits a markdown guide into one chunk per `#`–`###` section.
 */

import { TypeScriptChunk } from './types.js';

const MAX_SECTION_LINES = 200;

interface Section {
  title: string;
  trail: string[];
  startLine: number;
  lines: string[];
}

function frontmatterTitle(lines: string[]): string | null {
  if (lines[0]?.trim() !== '---') {
    return null;
  }
  for (let i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
    const match = lines[i].match(/^title:\s*['"]?(.+?)['"]?\s*$/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

export function chunkMarkdown(
  markdown: string,
  filePath: string,
): TypeScriptChunk[] {
  const lines = markdown.split('\n');
  const documentTitle =
    frontmatterTitle(lines) ??
    lines.find((line) => /^#\s/.test(line))?.replace(/^#\s+/, '') ??
    filePath;

  const sections: Section[] = [];
  const headings: string[] = [];
  let current: Section = {
    title: documentTitle,
    trail: [documentTitle],
    startLine: 1,
    lines: [],
  };
  let inFence = false;

  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
    }
    const heading = inFence ? null : line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      if (current.lines.some((text) => text.trim().length > 0)) {
        sections.push(current);
      }
      const depth = heading[1].length;
      headings.length = depth - 1;
      headings[depth - 1] = heading[2];
      current = {
        title: heading[2],
        trail: [documentTitle, ...headings.filter(Boolean)].filter(
          (title, i, all) => all.indexOf(title) === i,
        ),
        startLine: index + 1,
        lines: [],
      };
    }
    current.lines.push(line);
  });
  if (current.lines.some((text) => text.trim().length > 0)) {
    sections.push(current);
  }

  return sections.flatMap((section) => {
    const parts: TypeScriptChunk[] = [];
    for (
      let offset = 0;
      offset < section.lines.length;
      offset += MAX_SECTION_LINES
    ) {
      const body = section.lines.slice(offset, offset + MAX_SECTION_LINES);
      const startLine = section.startLine + offset;
      parts.push({
        content: body.join('\n').trim(),
        chunk_type: 'doc',
        name: section.trail.join(' > '),
        start_line: startLine,
        end_line: startLine + body.length - 1,
        file_path: filePath,
        language: 'markdown',
        imports: [],
        exports: [],
        type_parameters: [],
        decorators: [],
        calls: [],
        extends: [],
        implements: [],
        uses_types: [],
        ecs_component: false,
        ecs_system: false,
        webxr_api_usage: [],
        three_js_usage: [],
        semantic_labels: ['guide'],
      });
    }
    return parts;
  });
}

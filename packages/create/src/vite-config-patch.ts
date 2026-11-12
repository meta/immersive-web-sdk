/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Adds iwsdkDev() to an existing Vite config, but only in shapes where the
// edit is certain to land in the config's own top-level `plugins` array.
// Anything else is left to the developer as a manual step.

export type VitePatchStatus = 'patched' | 'already-configured' | 'manual';

const IWSDK_IMPORT = "import { iwsdkDev } from '@iwsdk/vite-plugin-dev'";

/**
 * The source with comments, strings and template literals replaced by spaces,
 * so offsets still line up but only code is left to match against.
 */
export function blankNonCode(source: string): string {
  const out = source.split('');
  let index = 0;
  const blank = (from: number, to: number) => {
    for (let position = from; position < to; position++) {
      if (out[position] !== '\n') {
        out[position] = ' ';
      }
    }
  };
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      blank(index, stop);
      index = stop;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(index, stop);
      index = stop;
    } else if (char === '/' && isRegexStart(source, index)) {
      let position = index + 1;
      let inClass = false;
      while (position < source.length && source[position] !== '\n') {
        const current = source[position];
        if (current === '\\') {
          position += 2;
          continue;
        }
        if (current === '[') {
          inClass = true;
        } else if (current === ']') {
          inClass = false;
        } else if (current === '/' && !inClass) {
          break;
        }
        position += 1;
      }
      blank(index + 1, position);
      index = position + 1;
    } else if (char === '"' || char === "'" || char === '`') {
      let position = index + 1;
      while (position < source.length && source[position] !== char) {
        position += source[position] === '\\' ? 2 : 1;
      }
      // Keep the quotes so `"plugins"` still reads as a quoted key.
      blank(index + 1, position);
      index = position + 1;
    } else {
      index += 1;
    }
  }
  return out.join('');
}

/** A `/` starts a regex literal where an expression can begin. */
function isRegexStart(source: string, index: number): boolean {
  let previous = index - 1;
  while (previous >= 0 && /\s/u.test(source[previous])) {
    previous -= 1;
  }
  if (previous < 0 || /[(,=:[!&|?{};+\-*%<>~^]/u.test(source[previous])) {
    return true;
  }
  // After a keyword such as `return`, a `/` starts an expression too.
  return /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|delete|throw|yield|await|new)$/u.test(
    source.slice(Math.max(0, previous - 9), previous + 1),
  );
}

/** Offset just inside the config object's `{`, or -1. */
function configObjectStart(code: string): number {
  const starts = [
    ...code.matchAll(/defineConfig\(\s*\{|export\s+default\s*\{/gu),
  ];
  if (starts.length !== 1) {
    return -1;
  }
  return starts[0].index! + starts[0][0].length;
}

/** Brace depth of `offset` relative to the object that opens at `start`. */
function depthAt(code: string, start: number, offset: number): number {
  let depth = 1;
  for (let position = start; position < offset; position++) {
    const char = code[position];
    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
    } else if (char === '}' || char === ']' || char === ')') {
      depth -= 1;
      if (depth === 0) {
        return 0;
      }
    }
  }
  return depth;
}

export function patchViteConfig(source: string): {
  text: string;
  status: VitePatchStatus;
} {
  const code = blankNonCode(source);
  if (/@iwsdk\/vite-plugin-dev/u.test(source) && /\biwsdkDev\b/u.test(code)) {
    return { text: source, status: 'already-configured' };
  }
  if (
    /\brequire\(|module\.exports/u.test(code) ||
    // A quoted key is blanked with the strings, so look for it in the source.
    /["']plugins["']\s*:/u.test(source)
  ) {
    return { text: source, status: 'manual' };
  }
  // Plugins changed after the config is built would drop or override ours.
  if (/\.\s*plugins\s*(?:=[^=]|\.\s*(?:push|unshift|splice)\b)/u.test(code)) {
    return { text: source, status: 'manual' };
  }
  const objectStart = configObjectStart(code);
  if (objectStart === -1) {
    return { text: source, status: 'manual' };
  }
  // Every `plugins` key or shorthand at the config's top level.
  const topLevelPlugins = [
    ...code.matchAll(/(?:^|[{,\s])(["']?)plugins\1(?=\s*[:,}])/gmu),
  ].filter(
    (match) =>
      match.index! >= objectStart &&
      depthAt(code, objectStart, match.index! + match[0].length) === 1,
  );
  // A spread at the top level may carry its own plugins and override ours.
  const hasTopLevelSpread = [...code.matchAll(/\.\.\./gu)].some(
    (match) =>
      match.index! >= objectStart &&
      depthAt(code, objectStart, match.index!) === 1,
  );
  if (hasTopLevelSpread) {
    return { text: source, status: 'manual' };
  }
  let text: string;
  if (topLevelPlugins.length === 0) {
    text = `${source.slice(0, objectStart)}\n  plugins: [iwsdkDev()],${source.slice(objectStart)}`;
  } else if (topLevelPlugins.length === 1) {
    const match = topLevelPlugins[0];
    const after = match.index! + match[0].length;
    const arrayMatch = code.slice(after).match(/^\s*:\s*\[/u);
    if (match[1] !== '' || !arrayMatch) {
      // Quoted key, shorthand, or an expression: rewriting it is a guess.
      return { text: source, status: 'manual' };
    }
    const insertAt = after + arrayMatch[0].length;
    const isEmpty = /^\s*\]/u.test(code.slice(insertAt));
    text = `${source.slice(0, insertAt)}${isEmpty ? 'iwsdkDev()' : 'iwsdkDev(), '}${source.slice(insertAt)}`;
  } else {
    return { text: source, status: 'manual' };
  }
  return { text: addImport(text), status: 'patched' };
}

function addImport(source: string): string {
  const code = blankNonCode(source);
  const usesSemicolons = /;[ \t]*$/mu.test(code);
  const line = `${IWSDK_IMPORT}${usesSemicolons ? ';' : ''}\n`;
  const imports = [
    ...code.matchAll(/^import\s[\s\S]*?from\s+(['"]).*?\1;?[^\S\n]*\n/gmu),
  ];
  const last = imports.at(-1);
  const insertAt = last ? last.index! + last[0].length : 0;
  return `${source.slice(0, insertAt)}${line}${source.slice(insertAt)}`;
}

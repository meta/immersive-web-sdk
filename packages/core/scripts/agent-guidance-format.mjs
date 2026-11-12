/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Stamp and hash format shared by the guidance renderer and the legacy-hash
// generator. `@iwsdk/cli` (src/agent-guidance.ts) reimplements the same
// functions; its tests render this package's guidance and assert that both
// sides agree, so change them together.

import { createHash } from 'node:crypto';

export const GUIDANCE_FORMAT = 1;

const STAMP_LINE =
  /^<!-- iwsdk-agent-guidance version=\S+ sha256=[0-9a-f]{64}(?: name=\S+)? [^\n]*-->\r?\n?/mu;

/** Files that operating systems and editors drop into folders; never hashed. */
export const JUNK_FILE = /^(?:\.DS_Store|Thumbs\.db|desktop\.ini)$|\.swp$|~$/u;

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Normalize line endings so a checkout with CRLF still matches. */
export function normalizeText(text) {
  return text.replace(/\r\n/gu, '\n');
}

/** Text with a trailing newline guaranteed, as stamped files store it. */
export function withTrailingNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

export function stripStamp(text) {
  return normalizeText(text).replace(STAMP_LINE, '');
}

/**
 * `name` is the unit's own file or folder name, so a copy saved under another
 * name is never taken for the IWSDK unit.
 */
export function stampLine(version, hash, name) {
  return `<!-- iwsdk-agent-guidance version=${version} sha256=${hash} name=${name} (installed by IWSDK; \`npx @iwsdk/cli@latest agents sync\` refreshes it and leaves it alone once edited) -->`;
}

/** The body exactly as a stamped file stores it, before the stamp line. */
export function stampedBody(body) {
  return withTrailingNewline(normalizeText(body));
}

/** Append the stamp to a markdown file's body. */
export function stampText(body, version, hash, name) {
  return `${stampedBody(body)}${stampLine(version, hash, name)}\n`;
}

export function fileUnitHash(text) {
  return sha256(stripStamp(text));
}

/**
 * Hash a skill directory: every file, sorted by POSIX relative path, with the
 * stamp removed from any markdown file.
 */
export function directoryUnitHash(files) {
  const hash = createHash('sha256');
  for (const [relativePath, contents] of [...files].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const digest =
      typeof contents === 'string'
        ? fileUnitHash(contents)
        : createHash('sha256').update(contents).digest('hex');
    hash.update(`${relativePath}\0${digest}\n`);
  }
  return hash.digest('hex');
}

export const BLOCK_NAME = 'iwsdk-agent-guidance';

export function renderBlock(body, version) {
  const normalized = withTrailingNewline(normalizeText(body));
  return `<!-- BEGIN ${BLOCK_NAME} version=${version} sha256=${sha256(normalized)} -->\n${normalized}<!-- END ${BLOCK_NAME} -->\n`;
}

export function blockUnitHash(body) {
  return sha256(withTrailingNewline(normalizeText(body)));
}

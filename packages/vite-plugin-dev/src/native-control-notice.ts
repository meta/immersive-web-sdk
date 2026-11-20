/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/** Element id of the notice, so a second call never adds another. */
export const NATIVE_CONTROL_NOTICE_ID = 'iwsdk-native-control-notice';

export const NATIVE_CONTROL_NOTICE_TITLE = 'Agent-controlled page';

export const NATIVE_CONTROL_NOTICE_TEXT =
  'This dev server was started with --native-xr-control, so the IWSDK CLI ' +
  'drives the headset and controllers on this page and your own movement is ' +
  'ignored. Removing the token from the URL does not change that. To try the ' +
  'app yourself, restart the dev server without --native-xr-control (for ' +
  'example, npm run dev) and open the URL it prints.';

const BAR_STYLE = [
  'position:fixed',
  'top:0',
  'left:0',
  'right:0',
  'z-index:2147483647',
  // Never take a click meant for the page, such as its Enter XR button.
  'pointer-events:none',
  'box-sizing:border-box',
  'padding:10px 16px',
  'background:rgba(120,53,15,0.92)',
  'color:#fff',
  'font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif',
  'text-align:center',
].join(';');

/**
 * Shows a fixed banner on a page whose WebXR input is overridden by a
 * `--native-xr-control` dev session. The flat page is the only place a person
 * can see it before entering XR. Without it, the page looks like a normal app
 * whose headset and controllers have stopped responding.
 */
export function showNativeControlNotice(doc: Document): void {
  const add = () => {
    if (doc.body == null || doc.getElementById(NATIVE_CONTROL_NOTICE_ID)) {
      return;
    }
    const bar = doc.createElement('div');
    bar.id = NATIVE_CONTROL_NOTICE_ID;
    bar.setAttribute('role', 'status');
    bar.style.cssText = BAR_STYLE;
    const title = doc.createElement('strong');
    title.textContent = `${NATIVE_CONTROL_NOTICE_TITLE}. `;
    const text = doc.createElement('span');
    text.textContent = NATIVE_CONTROL_NOTICE_TEXT;
    bar.append(title, text);
    doc.body.append(bar);
  };
  if (doc.readyState === 'loading' || doc.body == null) {
    doc.addEventListener('DOMContentLoaded', add, { once: true });
  } else {
    add();
  }
}

#!/usr/bin/env node
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Client for the @iwer/native debug endpoint (debug builds, or
// `pack --release --inspector`). Forward the port first:
//   adb -s <serial> forward tcp:9229 localabstract:<packageId>_devtools_9229
//
//   node iwn-host.mjs eval '<expression>'   value of the expression (promises awaited)
//   node iwn-host.mjs shot <out.png> [left|right|both] [scale]   eye-buffer PNG
//   node iwn-host.mjs stats                  frame, GC, heap and boot timings
//   node iwn-host.mjs info                   device, runtime and app identity
//
// PORT selects another forwarded port (default 9229). Exit code 1 on an error
// reply, 2 when the endpoint does not answer.
import { writeFileSync } from 'node:fs';

const [method, ...args] = process.argv.slice(2);
const port = process.env.PORT || '9229';
let params;
let out;
switch (method) {
  case 'eval':
    params = { expression: args[0] ?? 'undefined', awaitPromise: true };
    break;
  case 'shot':
    out = args[0] ?? 'iwn-shot.png';
    params = { eye: args[1] ?? 'left', scale: Number(args[2] ?? 0.5) };
    break;
  case 'stats':
  case 'info':
    params = {};
    break;
  default:
    console.error('usage: iwn-host.mjs eval <expr> | shot <out.png> [eye] [scale] | stats | info');
    process.exit(2);
}

const timer = setTimeout(() => {
  console.error(`no reply from ws://127.0.0.1:${port}/host: is the app running a debug build, and is the port forwarded?`);
  process.exit(2);
}, 40_000);
const ws = new WebSocket(`ws://127.0.0.1:${port}/host`);
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
ws.onerror = () => {
  console.error(`cannot connect to ws://127.0.0.1:${port}/host: forward the port with adb first`);
  process.exit(2);
};
ws.onmessage = (message) => {
  clearTimeout(timer);
  const reply = JSON.parse(String(message.data));
  if (reply.error) {
    console.error(reply.error);
    process.exit(1);
  }
  if (method === 'shot') {
    writeFileSync(out, Buffer.from(reply.png, 'base64'));
    console.log(JSON.stringify({ file: out, width: reply.width, height: reply.height, frame: reply.frame }));
  } else if (method === 'eval') {
    console.log(typeof reply.result === 'string' ? reply.result : JSON.stringify(reply.result ?? null, null, 1));
  } else {
    delete reply.id;
    console.log(JSON.stringify(reply, null, 1));
  }
  ws.close();
  process.exit(0);
};

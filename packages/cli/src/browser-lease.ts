/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import type { RuntimeSession } from './runtime-contract.js';
import { getRuntimeCommandToken } from './runtime-state.js';

/** Keep a command connection open for the complete secondary-CDP operation. */
export async function acquireBrowserLease(
  session: RuntimeSession,
  timeoutMs: number,
): Promise<{
  release(): void;
  abandon(): void;
  lost: Promise<never>;
}> {
  const id = randomUUID();
  const commandToken = getRuntimeCommandToken(session);
  const protocol = session.localUrl.startsWith('https:') ? 'wss' : 'ws';
  const ws = new WebSocket(
    `${protocol}://127.0.0.1:${session.port}/__iwer_mcp`,
    { rejectUnauthorized: false },
  );
  let granted = false;
  let released = false;
  let closed = false;
  let rejectLost!: (error: Error) => void;
  const lost = new Promise<never>((_resolve, reject) => {
    rejectLost = reject;
  });
  // A connection can die between granting and the caller's Promise.race.
  void lost.catch(() => {});
  const release = () => {
    if (closed) {
      return;
    }
    closed = true;
    released = true;
    if (granted && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          id,
          method: '__iwsdk_browser_lease_release',
          commandToken,
        }),
      );
    }
    ws.close();
  };
  // Closing without a release is deliberate: the runtime treats the lost
  // lease as an uncertain command outcome and retires the owned browser before
  // admitting another command. This prevents a rejected or timed-out runner
  // from continuing CDP work concurrently with a later command.
  const abandon = () => {
    if (closed) {
      return;
    }
    closed = true;
    ws.close();
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out acquiring the managed browser lease.'));
        ws.close();
      }, 20000);
      const failed = (error: Error) => {
        clearTimeout(timer);
        if (granted && !released) {
          rejectLost(error);
        } else if (!granted) {
          reject(error);
        }
      };
      ws.on('error', failed);
      ws.on('close', () =>
        failed(
          new Error(
            'Managed browser lease was lost. The script outcome is unknown.',
          ),
        ),
      );
      ws.on('open', () =>
        ws.send(
          JSON.stringify({
            id,
            method: '__iwsdk_browser_lease',
            expectedSessionId: session.sessionId,
            params: {
              browserEpoch: session.browser?.lifecycle?.browserEpoch,
              targetId: session.browserAutomation?.targetId,
              timeoutMs,
            },
            commandToken,
          }),
        ),
      );
      ws.on('message', (raw) => {
        try {
          const response = JSON.parse(raw.toString());
          if (response.id !== id) {
            return;
          }
          clearTimeout(timer);
          if (response.error) {
            failed(new Error(response.error.message));
            return;
          }
          granted = true;
          resolve();
        } catch (error) {
          failed(error as Error);
        }
      });
    });
    return { abandon, release, lost };
  } catch (error) {
    release();
    throw error;
  }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type {
  LegacyProjectEmulatorEnvironment,
  ProjectEmulatorEnvironment,
  ProjectEmulatorRoom,
} from './types.js';

/** The emulator's environments: IWER SEM's built-in GLTS rooms. */
export const PROJECT_EMULATOR_ROOMS = [
  'sunlit_living_room',
  'home_office',
  'conference_room',
  'open_office',
  'kitchen',
  'bedroom',
  'music_studio',
  'open_studio',
] as const satisfies readonly ProjectEmulatorRoom[];

/**
 * The room that replaces each legacy capture room. IWSDK no longer offers the
 * captures; configurations that still name one load its replacement.
 */
export const LEGACY_EMULATOR_ENVIRONMENT_ROOMS: Readonly<
  Record<LegacyProjectEmulatorEnvironment, ProjectEmulatorRoom>
> = {
  living_room: 'sunlit_living_room',
  meeting_room: 'conference_room',
  music_room: 'music_studio',
  office_large: 'open_office',
  office_small: 'home_office',
};

/** The built-in room to load for a configured environment id. */
export function resolveProjectEmulatorRoom(
  environment: ProjectEmulatorEnvironment,
): ProjectEmulatorRoom {
  return (
    LEGACY_EMULATOR_ENVIRONMENT_ROOMS[
      environment as LegacyProjectEmulatorEnvironment
    ] ?? (environment as ProjectEmulatorRoom)
  );
}

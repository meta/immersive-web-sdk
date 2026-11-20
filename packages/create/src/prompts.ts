/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import prompts from 'prompts';
import {
  EXPERIENCE_TARGETS,
  FEATURE_CATALOG,
  FeatureKey,
  getRecommendedConfiguration,
} from './catalog.js';
import { isValidProjectTarget } from './project-target.js';
import {
  ExperienceTarget,
  FeatureFlags,
  Language,
  PromptResult,
} from './types.js';

const ADVANCED_FEATURE_KEYS = [
  'locomotionEnabled',
  'grabbingEnabled',
  'physicsEnabled',
  'sceneUnderstandingEnabled',
  'environmentRaycastEnabled',
] as const satisfies readonly FeatureKey[];

export type PromptDefaults = {
  target?: ExperienceTarget;
  /** Whether the named directory is an existing project Create adds IWSDK to. */
  isExistingProject?: (name: string) => boolean;
};

function validateProjectName(value: string): true | string {
  const name = value.trim();
  if (isValidProjectTarget(name)) {
    return true;
  }
  return 'Use "." for the current directory, or a name containing only letters, numbers, hyphens, underscores, dots, and @';
}

export async function promptFlow(
  nameArg?: string,
  defaults: PromptDefaults = {},
): Promise<PromptResult> {
  let cancelled = false;
  const onCancel = () => {
    cancelled = true;
    return false;
  };
  const assertNotCancelled = () => {
    if (cancelled) {
      throw new Error('Input cancelled');
    }
  };

  const name =
    nameArg ||
    (
      await prompts(
        {
          type: 'text',
          name: 'name',
          message: 'Project name',
          initial: 'iwsdk-app',
          validate: validateProjectName,
        },
        { onCancel },
      )
    ).name;
  assertNotCancelled();

  const target =
    defaults.target ??
    ((
      await prompts(
        {
          type: 'select',
          name: 'target',
          message: 'What should this project start as?',
          choices: Object.entries(EXPERIENCE_TARGETS).map(
            ([value, definition]) => ({
              title: `${definition.label} - ${definition.description}`,
              value,
            }),
          ),
          initial: 0,
        },
        { onCancel },
      )
    ).target as ExperienceTarget);
  assertNotCancelled();

  const { setup = 'recommended' } = await prompts(
    {
      type: 'select',
      name: 'setup',
      message: 'Setup',
      choices: [
        {
          title: 'Create with recommended settings',
          value: 'recommended',
        },
        { title: 'Customize setup...', value: 'advanced' },
      ],
      initial: 0,
    },
    { onCancel },
  );
  assertNotCancelled();

  let language: Language = 'ts';
  let gitInit = true;
  let installNow = true;
  let configuration = getRecommendedConfiguration(target);
  const overrides: Partial<FeatureFlags> = {};

  if (setup === 'advanced') {
    const languageAnswer = await prompts(
      {
        type: 'select',
        name: 'language',
        message: 'Language',
        choices: [
          { title: 'TypeScript (recommended)', value: 'ts' },
          { title: 'JavaScript', value: 'js' },
        ],
        initial: 0,
      },
      { onCancel },
    );
    assertNotCancelled();
    language = (languageAnswer.language as Language) || 'ts';

    // An existing project gets an empty scene with nothing to stand on, so
    // locomotion starts off there.
    const adopting = defaults.isExistingProject?.(name) ?? false;
    for (const key of ADVANCED_FEATURE_KEYS) {
      const definition = FEATURE_CATALOG[key];
      if (
        !(definition.targets as readonly ExperienceTarget[]).includes(target)
      ) {
        continue;
      }
      const needsFloor = adopting && key === 'locomotionEnabled';
      const answer = await prompts(
        {
          type: 'toggle',
          name: 'enabled',
          message: `${definition.label}: ${definition.description}${
            needsFloor
              ? ' Needs a floor with LocomotionEnvironment, which the new scene does not have yet.'
              : ''
          }`,
          initial: needsFloor ? false : !!configuration.featureFlags[key],
          active: 'Yes',
          inactive: 'No',
        },
        { onCancel },
      );
      assertNotCancelled();
      overrides[key] = !!answer.enabled;
    }
    configuration = getRecommendedConfiguration(target, overrides);

    const operationalAnswers = await prompts(
      [
        {
          type: 'toggle',
          name: 'gitInit',
          message: 'Set up a Git repository?',
          initial: true,
          active: 'Yes',
          inactive: 'No',
        },
        {
          type: 'toggle',
          name: 'installNow',
          message: 'Install dependencies now?',
          initial: true,
          active: 'Yes',
          inactive: 'No',
        },
      ],
      { onCancel },
    );
    assertNotCancelled();
    gitInit = !!operationalAnswers.gitInit;
    installNow = !!operationalAnswers.installNow;
  }

  return {
    name,
    installNow,
    target,
    xrEnabled: configuration.xrEnabled,
    mode: configuration.mode,
    language,
    featureFlags: configuration.featureFlags,
    featureOverrides: overrides,
    gitInit,
    xrFeatureStates: configuration.xrFeatureStates,
    actionItems: [],
    prerequisites: [],
  };
}

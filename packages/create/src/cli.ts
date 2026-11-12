#!/usr/bin/env node
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import semver from 'semver';
import {
  adoptExistingProject,
  printAdoptReport,
  type AdoptOutcome,
} from './adopt.js';
import {
  EXPERIENCE_TARGETS,
  FEATURE_CATALOG,
  ScaffoldConfiguration,
  getRecommendedConfiguration,
} from './catalog.js';
import {
  hasCliOption,
  validateFeatureOptionsForTarget,
} from './cli-options.js';
import {
  configureDependenciesFromBundle,
  installDependencies,
  installDependenciesFromBundle,
  printNextSteps,
  printPrerequisites,
} from './installer.js';
import {
  buildStarterProjectFiles,
  resolvePackagedGuidanceRoot,
} from './project-files.js';
import { createProjectManifest } from './project-manifest.js';
import {
  isValidProjectTarget,
  resolveProjectTarget,
  targetHasContent,
} from './project-target.js';
import { promptFlow } from './prompts.js';
import { scaffoldProject } from './scaffold.js';
import { resolveSource, SDK_PACKAGES_DIR } from './source.js';
import {
  ExperienceTarget,
  FeatureFlags,
  Language,
  PromptResult,
  XRMode,
} from './types.js';
import { VERSION, NODE_ENGINE } from './version.js';

type CliOptions = {
  yes?: boolean;
  canary?: string | boolean;
  force?: boolean;
  target?: ExperienceTarget;
  mode?: XRMode;
  language?: Language;
  xr?: boolean;
  install?: boolean;
  git?: boolean;
  locomotion?: boolean;
  grabbing?: boolean;
  physics?: boolean;
  sceneUnderstanding?: boolean;
  environmentRaycast?: boolean;
  skipReferenceWarmup?: boolean;
};

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function resolveBooleanFlag(
  args: string[],
  enabledFlag: string,
  disabledFlag: string,
): boolean | undefined {
  const enabled = hasFlag(args, enabledFlag);
  const disabled = hasFlag(args, disabledFlag);
  if (enabled && disabled) {
    throw new Error(`Use either ${enabledFlag} or ${disabledFlag}, not both.`);
  }
  if (disabled) {
    return false;
  }
  if (enabled) {
    return true;
  }
  return undefined;
}

function resolveExplicitTarget(
  options: CliOptions,
  args: string[],
): ExperienceTarget | undefined {
  const target = options.target;
  const mode = options.mode;
  const xrFlag = hasFlag(args, '--xr');
  const noXrFlag = hasFlag(args, '--no-xr');

  if (target && target !== 'vr' && target !== 'ar' && target !== 'browser') {
    throw new Error(
      `Invalid --target "${target}". Must be "vr", "ar", or "browser".`,
    );
  }
  if (mode && mode !== 'vr' && mode !== 'ar') {
    throw new Error(`Invalid --mode "${mode}". Must be "vr" or "ar".`);
  }
  if (xrFlag && noXrFlag) {
    throw new Error('Use either --xr or --no-xr, not both.');
  }
  if (target === 'browser' && (mode || xrFlag)) {
    throw new Error('--target browser cannot be combined with --mode or --xr.');
  }
  if (target && target !== 'browser' && noXrFlag) {
    throw new Error(`--target ${target} cannot be combined with --no-xr.`);
  }
  if (target && mode && target !== mode) {
    throw new Error(`--target ${target} conflicts with --mode ${mode}.`);
  }
  if (mode && noXrFlag) {
    throw new Error('--mode cannot be combined with --no-xr.');
  }

  if (target) {
    return target;
  }
  if (noXrFlag) {
    return 'browser';
  }
  if (mode) {
    return mode;
  }
  if (xrFlag) {
    return 'vr';
  }
  return undefined;
}

function isInsideGitWorkTree(directory: string): boolean {
  try {
    return (
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: directory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() === 'true'
    );
  } catch {
    return false;
  }
}

function printConfigurationSummary(
  result: PromptResult,
  adopting: boolean,
): void {
  const config: ScaffoldConfiguration = {
    target: result.target,
    xrEnabled: result.xrEnabled,
    mode: result.mode,
    featureFlags: result.featureFlags,
    xrFeatureStates: result.xrFeatureStates,
  };
  const enabledFeatures = Object.entries(result.featureFlags)
    .filter(([key, enabled]) => key !== 'locomotionUseWorker' && enabled)
    .map(([key]) => FEATURE_CATALOG[key as keyof FeatureFlags].label);

  console.log(chalk.bold('\nProject configuration'));
  console.log(`  Starting point: ${EXPERIENCE_TARGETS[result.target].label}`);
  console.log(
    `  Language: ${result.language === 'ts' ? 'TypeScript' : 'JavaScript'}`,
  );
  console.log(
    `  SDK features: ${enabledFeatures.length > 0 ? enabledFeatures.join(', ') : 'none'}`,
  );
  const manifest = createProjectManifest(config);
  console.log(
    `  Runtime: ${manifest.world.xr === false ? 'Desktop 3D' : manifest.world.xr.mode.toUpperCase()}`,
  );
  console.log(
    chalk.dim(
      `  Change declarative settings later in iwsdk.config.json; keep systems in ${adopting ? 'src/iwsdk/index' : 'src/index'}.${result.language}.\n`,
    ),
  );
}

async function main() {
  // Enforce Node engines range from generated version.ts
  const nodeVer = process.versions.node;
  const requiredRange = NODE_ENGINE;
  if (!semver.satisfies(nodeVer, requiredRange, { includePrerelease: true })) {
    console.error(
      chalk.red(
        `Unsupported Node.js version: ${nodeVer}.\nRequires Node ${requiredRange}. Please upgrade (e.g., via nvm or Volta) and try again.`,
      ),
    );
    process.exit(1);
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const pkgPath = join(__dirname, '../package.json');
  let version = '0.0.0';
  try {
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    version = JSON.parse(raw).version ?? version;
  } catch {}

  // Print banner
  const banner = `                                                 
▄▄▄▄▄▄  ▄▄      ▄▄   ▄▄▄▄    ▄▄▄▄▄     ▄▄   ▄▄▄ 
▀▀██▀▀  ██      ██ ▄█▀▀▀▀█   ██▀▀▀██   ██  ██▀  
  ██    ▀█▄ ██ ▄█▀ ██▄       ██    ██  ██▄██    
  ██     ██ ██ ██   ▀████▄   ██    ██  █████    
  ██     ███▀▀███       ▀██  ██    ██  ██  ██▄  
▄▄██▄▄   ███  ███  █▄▄▄▄▄█▀  ██▄▄▄██   ██   ██▄ 
▀▀▀▀▀▀   ▀▀▀  ▀▀▀   ▀▀▀▀▀    ▀▀▀▀▀     ▀▀    ▀▀
===============================================
IWSDK Create CLI v${VERSION}\nNode ${process.version}`;
  console.log(banner);

  const program = new Command();
  let nameArg: string | undefined;
  let cliOpts: CliOptions = {};

  program
    .name('Create IWSDK')
    .description('Official CLI for creating Immersive Web SDK projects')
    .version(version)
    .argument('[name]', 'Project directory (use "." for the current directory)')
    .option(
      '--canary [url]',
      'Use canary SDK bundle (optionally from a custom URL)',
    )
    .option('-y, --yes', 'Use defaults and skip prompts')
    .option(
      '--force',
      'Overwrite conflicting generated files in a non-empty target without a package.json (an existing project is adopted and never overwritten)',
    )
    .option('--target <target>', 'Starting point: vr, ar, or browser')
    .option('--mode <mode>', 'XR mode alias: vr or ar')
    .option('--language <lang>', 'Language: ts or js')
    .option('--xr', 'Use an XR starting point (VR unless --mode is provided)')
    .option('--no-xr', 'Use the desktop 3D starting point')
    .option('--install', 'Install dependencies after scaffolding')
    .option('--no-install', 'Skip dependency installation')
    .option('--git', 'Initialize git repository')
    .option('--no-git', 'Skip git initialization')
    .option('--locomotion', 'Enable locomotion feature')
    .option('--no-locomotion', 'Disable locomotion feature')
    .option('--grabbing', 'Enable grabbing feature')
    .option('--no-grabbing', 'Disable grabbing feature')
    .option('--physics', 'Enable physics feature')
    .option('--no-physics', 'Disable physics feature')
    .option('--scene-understanding', 'Enable scene understanding (AR mode)')
    .option('--no-scene-understanding', 'Disable scene understanding')
    .option('--environment-raycast', 'Enable environment raycast (AR mode)')
    .option('--no-environment-raycast', 'Disable environment raycast')
    .option(
      '--skip-reference-warmup',
      'No effect; kept for older scripts (@iwsdk/reference bundles its corpus)',
    )
    .action((n: string | undefined, opts: CliOptions) => {
      nameArg = n;
      cliOpts = opts;
    });
  program.parse(process.argv);

  try {
    // Collapse the target selector and legacy XR flags into one starting point.
    const explicitTarget = resolveExplicitTarget(
      cliOpts,
      process.argv.slice(2),
    );
    if (
      cliOpts.language !== undefined &&
      cliOpts.language !== 'ts' &&
      cliOpts.language !== 'js'
    ) {
      console.error(
        chalk.red(
          `Invalid --language "${cliOpts.language}". Must be "ts" or "js".`,
        ),
      );
      process.exit(1);
    }
    if (typeof cliOpts.canary === 'string') {
      const isUrl =
        cliOpts.canary.startsWith('http://') ||
        cliOpts.canary.startsWith('https://');
      if (!isUrl) {
        console.error(
          chalk.red(
            `--canary URL must be an HTTP or HTTPS URL. Got: "${cliOpts.canary}".`,
          ),
        );
        process.exit(1);
      }
    }

    // Warn if flags are provided without --yes (they only take effect in non-interactive mode)
    const explicitFlags = [
      '--language',
      '--install',
      '--no-install',
      '--git',
      '--no-git',
      '--locomotion',
      '--no-locomotion',
      '--grabbing',
      '--no-grabbing',
      '--physics',
      '--no-physics',
      '--scene-understanding',
      '--no-scene-understanding',
      '--environment-raycast',
      '--no-environment-raycast',
    ];
    const hasExplicitFlags = explicitFlags.some((flag) =>
      hasCliOption(process.argv, flag),
    );
    if (hasExplicitFlags && !cliOpts.yes) {
      console.warn(
        chalk.yellow(
          'Warning: advanced CLI flags (--language, --physics, etc.) only take effect with -y/--yes.\n' +
            'Add -y to use non-interactive mode, or remove flags for interactive prompts.',
        ),
      );
    }

    // Build PromptResult from CLI flags or interactive prompts
    let res: PromptResult;
    if (cliOpts.yes) {
      const target = explicitTarget ?? 'vr';
      validateFeatureOptionsForTarget(target, process.argv);
      const language = cliOpts.language ?? 'ts';
      const overrides: Partial<FeatureFlags> = {};
      const locomotion = resolveBooleanFlag(
        process.argv,
        '--locomotion',
        '--no-locomotion',
      );
      const grabbing = resolveBooleanFlag(
        process.argv,
        '--grabbing',
        '--no-grabbing',
      );
      const physics = resolveBooleanFlag(
        process.argv,
        '--physics',
        '--no-physics',
      );
      const sceneUnderstanding = resolveBooleanFlag(
        process.argv,
        '--scene-understanding',
        '--no-scene-understanding',
      );
      const environmentRaycast = resolveBooleanFlag(
        process.argv,
        '--environment-raycast',
        '--no-environment-raycast',
      );
      if (locomotion !== undefined) {
        overrides.locomotionEnabled = locomotion;
      }
      if (grabbing !== undefined) {
        overrides.grabbingEnabled = grabbing;
      }
      if (physics !== undefined) {
        overrides.physicsEnabled = physics;
      }
      if (sceneUnderstanding !== undefined) {
        overrides.sceneUnderstandingEnabled = sceneUnderstanding;
      }
      if (environmentRaycast !== undefined) {
        overrides.environmentRaycastEnabled = environmentRaycast;
      }
      const configuration = getRecommendedConfiguration(target, overrides);

      res = {
        name: nameArg || 'iwsdk-app',
        installNow:
          resolveBooleanFlag(process.argv, '--install', '--no-install') ?? true,
        target,
        xrEnabled: configuration.xrEnabled,
        mode: configuration.mode,
        language,
        featureFlags: configuration.featureFlags,
        gitInit: resolveBooleanFlag(process.argv, '--git', '--no-git') ?? true,
        xrFeatureStates: configuration.xrFeatureStates,
      };
    } else {
      res = await promptFlow(nameArg, { target: explicitTarget });
    }

    // Validate the requested directory (both interactive and non-interactive paths).
    if (!isValidProjectTarget(res.name)) {
      throw new Error(
        `Invalid project name "${res.name}". ` +
          'Use "." for the current directory, or use only letters, numbers, hyphens, underscores, dots, and @.',
      );
    }

    const projectTarget = resolveProjectTarget(res.name, process.cwd());
    const hasTargetContent = targetHasContent(projectTarget);
    // An existing package.json means an existing project: adopt IWSDK into it
    // without overwriting anything, even when --force is passed.
    const adopting =
      hasTargetContent &&
      fs.existsSync(join(projectTarget.outDir, 'package.json'));
    if (adopting && cliOpts.canary) {
      throw new Error(
        '--canary installs an SDK bundle into new projects only. Drop --canary to add IWSDK to this existing project.',
      );
    }
    if (adopting) {
      console.warn(
        chalk.yellow(
          `${projectTarget.displayPath === '.' ? 'The current directory' : `"${projectTarget.displayPath}"`} already has a package.json: adding IWSDK to this project without overwriting your files${cliOpts.force ? ' (--force is ignored for existing projects)' : ''}.`,
        ),
      );
    } else if (hasTargetContent && !cliOpts.force) {
      throw new Error(
        `${projectTarget.inPlace ? 'Current directory' : `Directory "${projectTarget.displayPath}"`} is not empty. ` +
          'Re-run with --force to overwrite conflicting generated files; unrelated files will be preserved.',
      );
    }
    if (hasTargetContent && !adopting) {
      console.warn(
        chalk.yellow(
          `Warning: --force will overwrite conflicting generated files in ${projectTarget.displayPath}; unrelated files will be preserved.`,
        ),
      );
    }
    res.name = projectTarget.appName;
    if (adopting && cliOpts.yes && cliOpts.language == null) {
      // Match the project: no tsconfig and no TypeScript dependency means a
      // JavaScript project.
      res.language =
        fs.existsSync(join(projectTarget.outDir, 'tsconfig.json')) ||
        /"typescript"\s*:/u.test(
          fs.readFileSync(join(projectTarget.outDir, 'package.json'), 'utf8'),
        )
          ? 'ts'
          : 'js';
    }

    printConfigurationSummary(res, adopting);

    const source = resolveSource(cliOpts.canary);

    // Prepare source (downloads tgz files for remote bundles)
    if (source.isBundleMode) {
      const prepSpinner = ora({
        text: 'Preparing SDK bundle ...',
        stream: process.stderr,
        discardStdin: false,
        hideCursor: false,
        isEnabled: process.stderr.isTTY,
      }).start();
      try {
        await source.prepare();
        prepSpinner.stopAndPersist({
          symbol: chalk.green('✔'),
          text: 'SDK bundle ready',
        });
      } catch (e) {
        prepSpinner.stopAndPersist({
          symbol: chalk.red('✖'),
          text: 'Bundle preparation failed',
        });
        throw e;
      }
    }

    try {
      const configuration: ScaffoldConfiguration = {
        target: res.target,
        xrEnabled: res.xrEnabled,
        mode: res.mode,
        featureFlags: res.featureFlags,
        xrFeatureStates: res.xrFeatureStates,
      };
      const outDir = projectTarget.outDir;
      const projectFiles = await buildStarterProjectFiles({
        appName: res.name,
        configuration,
        language: res.language,
        packageSource: source,
      });
      if (adopting) {
        await adoptProject(outDir, projectFiles, res.language, {
          install: res.installNow,
        });
        return;
      }
      await scaffoldProject(projectFiles, outDir, { force: cliOpts.force });

      // Git init
      if (
        res.gitInit &&
        !(projectTarget.inPlace && isInsideGitWorkTree(outDir))
      ) {
        try {
          const gitInit = spawn('git', ['init'], {
            cwd: outDir,
            stdio: 'ignore',
          });
          await new Promise<void>((resolve) => {
            gitInit.once('error', () => resolve());
            gitInit.once('exit', () => resolve());
          });
        } catch {}
      }

      // Download SDK packages into .sdk-packages/ (must happen before install)
      if (source.isBundleMode) {
        const dlSpinner = ora({
          text: 'Downloading SDK packages ...',
          stream: process.stderr,
          discardStdin: false,
          hideCursor: false,
          isEnabled: process.stderr.isTTY,
        }).start();
        try {
          await source.downloadPackages(join(outDir, SDK_PACKAGES_DIR));
          if (!res.installNow) {
            configureDependenciesFromBundle(outDir, source);
          }

          dlSpinner.stopAndPersist({
            symbol: chalk.green('✔'),
            text: 'SDK packages downloaded',
          });
        } catch (e) {
          dlSpinner.stopAndPersist({
            symbol: chalk.red('✖'),
            text: 'SDK package download failed',
          });
          throw e;
        }
      }

      // Install dependencies
      if (res.installNow) {
        if (source.isBundleMode) {
          await installDependenciesFromBundle(outDir, source);
        } else {
          await installDependencies(outDir);
        }
      }

      // Write MCP adapter configs for every supported coding harness.
      if (res.installNow) {
        syncAdapters(outDir);
      }

      const prereqs = [...(res.prerequisites || [])];
      // Print prerequisites first, then next steps
      printPrerequisites(prereqs);
      printNextSteps(
        projectTarget.displayPath,
        res.installNow,
        res.actionItems || [],
        projectTarget.inPlace,
        res.xrEnabled,
      );
    } finally {
      await source.cleanup();
    }
  } catch (err: any) {
    console.error(chalk.red(err?.message || String(err)));
    process.exit(1);
  }
}

/** Write MCP adapter configs for every supported coding harness. */
function syncAdapters(outDir: string, adopting = false): boolean {
  try {
    execFileSync(
      process.execPath,
      [join(outDir, 'node_modules/@iwsdk/cli/dist/cli.js'), 'adapter', 'sync'],
      { cwd: outDir, stdio: 'ignore', timeout: 15000 },
    );
    return true;
  } catch (error) {
    console.warn(
      chalk.yellow(
        `${adopting ? 'IWSDK was added' : 'Project created'}, but coding-tool adapter sync failed: ${error instanceof Error ? error.message : String(error)}. ` +
          'Run "npx @iwsdk/cli adapter sync" from the project directory.',
      ),
    );
    return false;
  }
}

/**
 * Add IWSDK to an existing project. The report is printed whatever the
 * install does, so the developer always sees what changed and what is left.
 */
async function adoptProject(
  outDir: string,
  files: Awaited<ReturnType<typeof buildStarterProjectFiles>>,
  language: Language,
  options: { install: boolean },
): Promise<void> {
  const report = await adoptExistingProject({
    outDir,
    files,
    guidanceRoot: resolvePackagedGuidanceRoot(),
    language,
  });
  const outcome: AdoptOutcome = { installed: false, adaptersSynced: false };
  if (options.install) {
    try {
      await installDependencies(outDir, report.packageManager);
      outcome.installed = true;
    } catch (error) {
      outcome.installError =
        error instanceof Error ? error.message : String(error);
    }
  }
  if (outcome.installed) {
    outcome.adaptersSynced = syncAdapters(outDir, true);
  }
  printAdoptReport(report, outcome);
  if (outcome.installError) {
    process.exitCode = 1;
  }
}

void main();

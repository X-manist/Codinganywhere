import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';
import {
  addUniqueProviderSkillSource,
  findTopmostGitRoot,
} from '@/shared/utils.js';

const ZCODE_PROJECT_SKILL_DIRS = [
  ['.zcode', 'skills'],
  ['.claude', 'skills'],
];

const ZCODE_USER_SKILL_DIRS = [
  ['.zcode', 'skills'],
  ['.claude', 'skills'],
];

export class ZcodeSkillsProvider extends SkillsProvider {
  constructor() {
    super('zcode');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();
    const repoRoot = await findTopmostGitRoot(workspacePath);

    for (const skillDir of ZCODE_PROJECT_SKILL_DIRS) {
      addUniqueProviderSkillSource(sources, seenRootDirs, {
        scope: 'project',
        rootDir: path.join(workspacePath, ...skillDir),
        commandPrefix: '/',
      });
    }
    if (repoRoot && repoRoot !== workspacePath) {
      for (const skillDir of ZCODE_PROJECT_SKILL_DIRS) {
        addUniqueProviderSkillSource(sources, seenRootDirs, {
          scope: 'project',
          rootDir: path.join(repoRoot, ...skillDir),
          commandPrefix: '/',
        });
      }
    }
    for (const skillDir of ZCODE_USER_SKILL_DIRS) {
      addUniqueProviderSkillSource(sources, seenRootDirs, {
        scope: 'user',
        rootDir: path.join(os.homedir(), ...skillDir),
        commandPrefix: '/',
      });
    }

    return sources;
  }
}

import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { isZcodeInstalled } from '@/modules/providers/list/zcode/zcode-runtime.provider.js';

type ZcodeCliConfig = {
  model?: {
    main?: unknown;
    lite?: unknown;
  };
  provider?: Record<string, unknown>;
};

function readCliConfig(): ZcodeCliConfig | null {
  const configPath = path.join(os.homedir(), '.zcode', 'cli', 'config.json');
  try {
    return JSON.parse(fsSync.readFileSync(configPath, 'utf8')) as ZcodeCliConfig;
  } catch {
    return null;
  }
}

export class ZcodeProviderAuth implements IProviderAuth {
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = isZcodeInstalled();
    const config = readCliConfig();
    const hasMainModel = Boolean(config?.model?.main);
    const hasProviderSection = Boolean(
      config?.provider && Object.keys(config.provider).length > 0,
    );

    return {
      installed,
      provider: 'zcode',
      authenticated: installed && (hasMainModel || hasProviderSection),
      email: null,
      method: hasMainModel ? 'cli-config' : null,
      error: installed
        ? (hasMainModel || hasProviderSection
          ? undefined
          : 'zcode CLI has no model provider configured. Run `zcode login` or add model.main to ~/.zcode/cli/config.json.')
        : 'zcode CLI was not found. Install the ZCode desktop app or set ZCODE_CLI_PATH.',
    };
  }
}

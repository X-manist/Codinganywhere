import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { IProviderMcp } from '@/shared/interfaces.js';
import type {
  McpScope,
  ProviderMcpServer,
  UpsertProviderMcpServerInput,
} from '@/shared/types.js';

type RawMcpServer = {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

type RawCliConfig = {
  mcp?: {
    servers?: Record<string, RawMcpServer>;
  };
  provider?: unknown;
  model?: unknown;
};

const readCliConfig = (): RawCliConfig | null => {
  const configPath = path.join(os.homedir(), '.zcode', 'cli', 'config.json');
  try {
    return JSON.parse(fsSync.readFileSync(configPath, 'utf8')) as RawCliConfig;
  } catch {
    return null;
  }
};

const writeCliConfig = (config: RawCliConfig): void => {
  const configPath = path.join(os.homedir(), '.zcode', 'cli', 'config.json');
  fsSync.mkdirSync(path.dirname(configPath), { recursive: true });
  fsSync.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
};

const toProviderMcpServer = (name: string, raw: RawMcpServer): ProviderMcpServer => ({
  provider: 'zcode',
  name,
  scope: 'user',
  transport: raw.url ? 'http' : 'stdio',
  command: raw.command,
  args: raw.args,
  env: raw.env,
  url: raw.url,
  headers: raw.headers,
});

/**
 * zcode reads MCP servers from the `mcp.servers` map in its CLI config.
 * CloudCLI surfaces them read/manage through the same user scope as the
 * zcode TUI's /mcp command.
 */
export class ZcodeMcpProvider implements IProviderMcp {
  async listServers(_options?: { workspacePath?: string }): Promise<Record<McpScope, ProviderMcpServer[]>> {
    const servers = readCliConfig()?.mcp?.servers ?? {};
    return {
      user: Object.entries(servers).map(([name, raw]) => toProviderMcpServer(name, raw ?? {})),
      project: [],
      local: [],
    };
  }

  async listServersForScope(scope: McpScope, options?: { workspacePath?: string }): Promise<ProviderMcpServer[]> {
    const all = await this.listServers(options);
    return all[scope] ?? [];
  }

  async upsertServer(input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    const config = readCliConfig() ?? {};
    const servers = config.mcp?.servers ?? {};
    servers[input.name] = {
      type: input.url ? 'http' : 'stdio',
      ...(input.command ? { command: input.command } : {}),
      ...(input.args ? { args: input.args } : {}),
      ...(input.env ? { env: input.env } : {}),
      ...(input.url ? { url: input.url } : {}),
      ...(input.headers ? { headers: input.headers } : {}),
    };
    writeCliConfig({ ...config, mcp: { ...(config.mcp ?? {}), servers } });
    return toProviderMcpServer(input.name, servers[input.name]);
  }

  async removeServer(input: { name: string; scope?: McpScope }): Promise<{ removed: boolean; provider: 'zcode'; name: string; scope: McpScope }> {
    const config = readCliConfig();
    const servers = config?.mcp?.servers;
    if (!servers || !(input.name in servers)) {
      return { removed: false, provider: 'zcode', name: input.name, scope: input.scope ?? 'user' };
    }
    delete servers[input.name];
    writeCliConfig(config as RawCliConfig);
    return { removed: true, provider: 'zcode', name: input.name, scope: input.scope ?? 'user' };
  }
}

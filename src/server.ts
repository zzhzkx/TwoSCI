#!/usr/bin/env node
/**
 * TwoSCI MCP Server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { registerMcpHandlers } from './mcp/registerHandlers.js';
import { isMCPMode, logDebug } from './utils/Logger.js';

function loadEnvironment(): void {
  // 1. 尝试用户全局配置目录 ~/.twosci/.env (全系统共享，任何终端或应用通用，插件重装或升级不丢失)
  try {
    const homeEnv = path.resolve(os.homedir(), '.twosci', '.env');
    if (fs.existsSync(homeEnv)) {
      dotenv.config({ path: homeEnv });
    }
  } catch {
    // ignore home resolution error
  }

  // 2. 尝试当前工作空间目录下的 .env (方便在特定工程根目录放 .env)
  const cwdEnv = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(cwdEnv)) {
    dotenv.config({ path: cwdEnv });
  }

  // 3. 尝试插件自身安装目录下的 .env
  try {
    const currentDir = typeof __dirname !== 'undefined'
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url));
    const pluginEnv = path.resolve(currentDir, '..', '.env');
    if (fs.existsSync(pluginEnv)) {
      dotenv.config({ path: pluginEnv });
    }
  } catch {
    // ignore resolution error
  }

  // 4. 自动继承 Claude Desktop 客户端配置文件中的已有密钥 (免去重复配置)
  loadClaudeDesktopConfig();

  // 5. 兜底默认加载
  dotenv.config();
}

function loadClaudeDesktopConfig(): void {
  try {
    const platform = process.platform;
    let configPath = '';
    if (platform === 'win32') {
      configPath = path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
    } else if (platform === 'darwin') {
      configPath = path.join(process.env.HOME || '', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    } else {
      configPath = path.join(process.env.HOME || '', '.config', 'Claude', 'claude_desktop_config.json');
    }

    if (configPath && fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw);
      const mcpServers = parsed?.mcpServers || {};
      // 优先读取 twosci 的 env，或兼容继承 paper-search 的原有 env
      const envSource = mcpServers.twosci?.env || mcpServers['paper-search']?.env;
      if (envSource && typeof envSource === 'object') {
        for (const [key, value] of Object.entries(envSource)) {
          if (!process.env[key] && typeof value === 'string' && value.trim()) {
            process.env[key] = value.trim();
          }
        }
      }
    }
  } catch {
    // 静默安全处理，绝不中断服务启动
  }
}

loadEnvironment();

const server = new Server(
  {
    name: 'twosci',
    version: '0.2.2'
  },
  {
    capabilities: {
      tools: {
        listChanged: true
      }
    }
  }
);

registerMcpHandlers(server);

/**
 * 启动服务器
 */
async function main() {
  try {
    logDebug('Starting TwoSCI MCP Server...');
    logDebug(`Working directory: ${process.cwd()}`);
    logDebug(`Node.js version: ${process.version}`);
    logDebug('Process arguments:', process.argv);
    
    // 连接到标准输入输出传输
    const transport = new StdioServerTransport();
    
    logDebug('Connecting to stdio transport...');
    await server.connect(transport);
    
    logDebug('TwoSCI MCP Server is running');
  } catch (error) {
    logDebug('Failed to start server:', error);
    process.exit(1);
  }
}

// 处理未捕获的错误 - MCP模式下更温和
process.on('uncaughtException', (error) => {
  if (!isMCPMode()) {
    logDebug('Uncaught Exception:', error);
    process.exit(1);
  }
  // MCP模式下不立即退出，避免干扰协议通信
});

process.on('unhandledRejection', (reason, promise) => {
  if (!isMCPMode()) {
    logDebug('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  }
});

// 启动服务器 - 直接调用main()确保服务器总是启动
main().catch((error) => {
  logDebug('Failed to start MCP server:', error);
  process.exit(1);
});

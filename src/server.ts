#!/usr/bin/env node
/**
 * TwoSCI MCP Server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerMcpHandlers } from './mcp/registerHandlers.js';
import { isMCPMode, logDebug } from './utils/Logger.js';

function loadEnvironment(): void {
  // 1. 尝试当前工作空间目录下的 .env (方便用户在自己的工程根目录统一配置，插件重装或升级不丢失)
  const cwdEnv = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(cwdEnv)) {
    dotenv.config({ path: cwdEnv });
  }

  // 2. 尝试插件自身安装目录下的 .env
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

  // 3. 兜底默认加载
  dotenv.config();
}

loadEnvironment();

const server = new Server(
  {
    name: 'twosci',
    version: '0.1.0'
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

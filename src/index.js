#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { openMapSearch } from "./maps.js";

const instructions = [
  "这个服务只有 search_map 一个工具。",
  "用户要求在地图中搜索、查找或打开某个地点时，调用 search_map。",
  "工具只会打开 macOS 系统地图并发起搜索。",
  "它不返回地点坐标，也不表示地图已经显示结果。",
].join("");

/**
 * 创建 MCP 服务。openSearch 可以在测试里换成不真正打开地图的函数。
 * @param {{ openSearch?: typeof openMapSearch }} [options]
 */
export function createServer({ openSearch = openMapSearch } = {}) {
  const server = new McpServer(
    { name: "local-maps-mcp", version: "1.0.0" },
    { instructions },
  );

  server.registerTool(
    "search_map",
    {
      title: "在系统地图中搜索",
      description:
        "在这台 Mac 的系统地图（Apple 地图）中搜索地点或地址。当用户要求在地图里搜索、查找或打开某个地点时使用。此工具只打开系统地图并发起搜索，不会读取搜索结果，也不能确认地点是否存在或地图是否已经显示完成。",
      inputSchema: z.object({
        query: z
          .string()
          .describe("要搜索的地点名称或地址，例如“杭州西湖”。去掉首尾空格后不能为空。"),
      }),
    },
    async ({ query }) => {
      try {
        const result = await openSearch(query);
        // 日志只能写 stderr。stdout 是 MCP 协议通道。
        console.error(`[local-maps-mcp] 已发送搜索请求：${result.query}`);
        return {
          content: [
            {
              type: "text",
              text: `已向系统地图发送搜索请求：${result.query}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[local-maps-mcp] 搜索失败：${message}`);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    },
  );

  return server;
}

/** 只有直接运行 src/index.js 时才连接 stdio，被测试导入时不启动。 */
function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

async function start() {
  console.error("[local-maps-mcp] 已启动，等待 Cursor 通过 stdio 连接");
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isDirectRun()) {
  start().catch((error) => {
    console.error("[local-maps-mcp] 启动失败：", error);
    process.exitCode = 1;
  });
}

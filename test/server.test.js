import assert from "node:assert/strict";
import { once } from "node:events";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { openMapSearch } from "../src/maps.js";
import { createServer } from "../src/index.js";

/**
 * @param {(query: string) => Promise<{ query: string, url: string }>} [openSearch]
 */
async function connectInMemory(openSearch) {
  const server = createServer(openSearch ? { openSearch } : {});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "local-maps-mcp-test", version: "1.0.0" });

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

function textOf(result) {
  const block = result.content?.find((item) => item.type === "text");
  assert.ok(block && "text" in block);
  return block.text;
}

describe("MCP 客户端", () => {
  it("初始化后能列出 search_map，并用模拟命令完成调用", async () => {
    /** @type {{ file: string, args: string[] }[]} */
    const calls = [];
    const { client, server } = await connectInMemory((query) =>
      openMapSearch(query, {
        platform: "darwin",
        execFile: async (file, args) => {
          calls.push({ file, args });
        },
      }),
    );

    try {
      const listed = await client.listTools();
      const tool = listed.tools.find((item) => item.name === "search_map");
      assert.ok(tool);
      assert.match(tool.description ?? "", /系统地图/);
      assert.equal(tool.inputSchema.type, "object");
      assert.equal(tool.inputSchema.properties.query.type, "string");
      assert.match(tool.inputSchema.properties.query.description, /杭州西湖/);
      assert.ok(tool.inputSchema.required.includes("query"));

      const success = await client.callTool({
        name: "search_map",
        arguments: { query: "  杭州西湖  " },
      });
      assert.equal(success.isError, undefined);
      assert.equal(textOf(success), "已向系统地图发送搜索请求：杭州西湖");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].file, "/usr/bin/open");
      assert.equal(
        calls[0].args[2],
        "https://maps.apple.com/?q=%E6%9D%AD%E5%B7%9E%E8%A5%BF%E6%B9%96",
      );

      const failed = await client.callTool({
        name: "search_map",
        arguments: { query: "   " },
      });
      assert.equal(failed.isError, true);
      assert.match(textOf(failed), /query 不能为空/);
      assert.equal(calls.length, 1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("模拟的系统命令失败时返回工具错误", async () => {
    const { client, server } = await connectInMemory((query) =>
      openMapSearch(query, {
        platform: "darwin",
        execFile: async () => {
          throw new Error("simulated open failure");
        },
      }),
    );

    try {
      const result = await client.callTool({
        name: "search_map",
        arguments: { query: "杭州西湖" },
      });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /无法打开系统地图：simulated open failure/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("缺少 query 时返回工具错误，不会打开地图", async () => {
    let called = false;
    const { client, server } = await connectInMemory(async () => {
      called = true;
      return { query: "", url: "" };
    });

    try {
      const result = await client.callTool({
        name: "search_map",
        arguments: {},
      });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /query/);
      assert.equal(called, false);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("stdio 服务进程", () => {
  it("能完成初始化、列出工具，并且空查询不会打开地图", { timeout: 15_000 }, async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../src/index.js", import.meta.url))],
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stderr: "pipe",
    });

    let stderrText = "";
    transport.stderr?.on("data", (chunk) => {
      stderrText += chunk.toString();
    });

    const client = new Client({ name: "local-maps-mcp-stdio-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.ok(listed.tools.some((tool) => tool.name === "search_map"));

      const result = await client.callTool({
        name: "search_map",
        arguments: { query: "  " },
      });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /query 不能为空/);

      if (!stderrText.includes("[local-maps-mcp]")) {
        await once(transport.stderr, "data");
      }
      assert.match(stderrText, /\[local-maps-mcp\]/);
      assert.doesNotMatch(stderrText, /"jsonrpc"/);
    } finally {
      await client.close();
    }
  });
});

# local-maps-mcp

一个跑在 macOS 上的本地 MCP 服务。在 AI 工具里配置后说「在地图里搜索西湖景区」，它会打开系统自带的「地图」并搜索这个地点。

## MCP 是什么

MCP（Model Context Protocol，模型上下文协议）让 AI 工具调用外部能力。模型负责理解你的话并决定调用哪个工具；MCP 服务把能力登记成工具，执行后把结果交还模型；真正的工作由后面的系统完成，例如打开地图或读取文件。

本地服务由 AI 工具启动，双方用标准输入和标准输出通信，这叫 stdio。日志写到标准错误，标准输出只放协议消息。模型依据工具的名称、说明和参数决定何时调用。

## 本项目做什么

本项目只提供一个工具 `search_map`。参数 `query` 是地点或地址。服务检查参数后，调用 macOS 打开系统地图并发起搜索，然后返回「已向系统地图发送搜索请求：……」。搜索结果以地图窗口为准。不需要地图 API Key。

环境：macOS，Node.js 20 或更高。

## 文件怎么分工

协议入口和地图动作分开：前者向 AI 暴露工具，后者只负责打开地图。

```text
src/index.js           注册 search_map，用 stdio 等待 AI 工具连接
src/maps.js            检查参数、生成地图链接、调用 open
test/maps.test.js      检查链接编码和命令参数
test/server.test.js    用 MCP 客户端检查工具是否能被调用
.cursor/mcp.json       一种客户端的配置示例（例如Cursor）
package.json           依赖、npm start 与 npm test
```

`src/index.js` 使用官方 SDK `@modelcontextprotocol/server` 创建服务，并用 Zod 描述参数。`src/maps.js` 不处理 MCP 消息。测试用模拟命令代替真正的 `open`，所以 `npm test` 不会反复打开地图。

```bash
npm install
npm test
```

平时由 AI 工具启动。单独执行 `npm start` 时，进程会停住等待连接，用 Ctrl+C 结束。

## 功能怎么实现

1. AI 工具启动 `src/index.js`，`StdioServerTransport` 开始等待调用。
2. `createServer()` 用 `registerTool()` 登记 `search_map`。`query` 是必填字符串，说明里写了「在地图里搜索地点时使用」。
3. 调用到达后，处理函数把 `query` 交给 `openMapSearch()`。成功返回搜索已发送；失败返回 `isError: true`，例如空查询、非 macOS，或系统命令失败。
4. `normalizeQuery()` 去掉首尾空格，空内容会被拒绝。
5. `buildMapSearchUrl()` 按 Apple [Map Links](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html) 的 `q` 参数生成链接。`q` 就是搜索框里的文字，并用 `encodeURIComponent()` 编码中文、空格和 `&`、`#`：

```text
https://maps.apple.com/?q=%E8%A5%BF%E6%B9%96%E6%99%AF%E5%8C%BA
```

`q` 是系统地图长期支持的搜索参数。macOS 15.4 及更高版本还可以使用 [Adopting unified Maps URLs](https://developer.apple.com/documentation/mapkit/unified-map-urls) 里的 `/search?query=`，本项目选择 `q`，使更早的系统也能打开搜索。

6. `openMapSearch()` 用 `execFile()` 执行下面的命令。参数是数组，搜索词只出现在编码后的链接里，最长等待 10 秒：

```text
/usr/bin/open -b com.apple.Maps <地图链接>
```

`-b com.apple.Maps` 指定打开系统「地图」。`open` 返回表示系统已经收下请求。

## 在 AI 工具里配置

AI 工具需要一份配置，写明服务名、用来启动的 Node.js，以及入口文件 `src/index.js`。各工具的配置文件位置不同，本地服务通常都使用 `command` 和 `args`。下面以 Cursor 为例。

Cursor 会合并项目级和用户级配置；同名时以项目级为准。市场里的现成 MCP 可以在 **Customize → MCPs** 里点 **Add to Cursor**。本项目是本地服务，使用下面的配置文件。

| 位置 | 文件 | 生效范围 |
| --- | --- | --- |
| 项目级 | `.cursor/mcp.json` | 打开本项目时 |
| 用户级 | `~/.cursor/mcp.json` | 这台电脑上的所有项目 |

本仓库已经写好项目级配置。添加到用户级配置时，保留文件里原有的其他服务。

```json
{
  "mcpServers": {
    "local-maps-mcp": {
      "command": "node",
      "args": ["${workspaceFolder}/src/index.js"]
    }
  }
}
```

`${workspaceFolder}` 是当前项目目录。如果 Cursor 从图形界面启动时找不到 `node`，把 `command` 改成终端里 `nvm which current` 打印出的绝对路径。切换 Node 版本后同步修改，再刷新 MCP。

安装发布后的 npm 包时，入口不再是项目里的源文件：

```json
{
  "mcpServers": {
    "local-maps-mcp": {
      "command": "npx",
      "args": ["-y", "local-maps-mcp"]
    }
  }
}
```

用 Cursor 打开本项目，进入 **Customize → MCPs**。`local-maps-mcp` 已连接时，工具列表里有 `search_map`。改完配置或代码后，在这里刷新该服务。

## 示例：在地图里搜索西湖景区

例如在 Cursor 的 Agent 对话里输入：

```text
在地图里搜索西湖景区
```

模型会调用 `search_map`，参数为 `{ "query": "西湖景区" }`。系统地图来到前台并接收这次搜索，对话里出现：

```text
已向系统地图发送搜索请求：西湖景区
```

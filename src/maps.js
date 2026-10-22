import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

// promisify 之后可以用 await。execFile 使用参数数组，不会经过 shell。
const defaultExecFile = promisify(execFileCallback);

/** 系统地图的 bundle id，来自 Maps.app 的 Info.plist。 */
export const MAPS_BUNDLE_ID = "com.apple.Maps";

/** open 返回前最多等待的时间。open 只负责把请求交给地图，通常很快结束。 */
export const COMMAND_TIMEOUT_MS = 10_000;

const OPEN_PATH = "/usr/bin/open";

export class MapSearchError extends Error {
  constructor(message) {
    super(message);
    this.name = "MapSearchError";
  }
}

/**
 * 去掉首尾空格，并拒绝空查询。
 * @param {unknown} query
 * @returns {string}
 */
export function normalizeQuery(query) {
  if (typeof query !== "string") {
    throw new MapSearchError("query 必须是字符串");
  }

  const trimmed = query.trim();
  if (!trimmed) {
    throw new MapSearchError("query 不能为空");
  }

  return trimmed;
}

/**
 * 构造系统地图搜索链接。
 *
 * Apple《Adopting unified Maps URLs》中的
 * https://maps.apple.com/search?query= 从 macOS 15.4 开始提供。
 * 这里使用更早的系统也能识别的 Map Links 格式：
 * https://maps.apple.com/?q=搜索词
 * 文档规定 q 是 URL 编码后的搜索文字，地图会把它当作搜索框中的输入。
 * 官方示例使用 http，这里使用同一主机和同一参数的 https。
 *
 * @param {string} query
 * @returns {string}
 */
export function buildMapSearchUrl(query) {
  const trimmed = normalizeQuery(query);
  return `https://maps.apple.com/?q=${encodeURIComponent(trimmed)}`;
}

/**
 * 校验参数和平台，然后让 macOS 打开系统地图。
 * options.execFile 供测试替换系统命令，正式运行时不要传入。
 *
 * @param {string} query
 * @param {{
 *   platform?: NodeJS.Platform,
 *   execFile?: (file: string, args: string[], options: { timeout: number }) => Promise<unknown>,
 *   timeoutMs?: number,
 * }} [options]
 * @returns {Promise<{ query: string, url: string }>}
 */
export async function openMapSearch(query, options = {}) {
  const trimmed = normalizeQuery(query);
  const platform = options.platform ?? process.platform;

  if (platform !== "darwin") {
    throw new MapSearchError("当前系统不是 macOS，无法打开系统地图");
  }

  const url = buildMapSearchUrl(trimmed);
  const execFile = options.execFile ?? defaultExecFile;
  const timeout = options.timeoutMs ?? COMMAND_TIMEOUT_MS;

  try {
    // man open：-b 用 bundle id 指定由哪个应用打开 URL，从而打开原生地图。
    await execFile(OPEN_PATH, ["-b", MAPS_BUNDLE_ID, url], { timeout });
  } catch (error) {
    if (error && /** @type {{ killed?: boolean }} */ (error).killed) {
      throw new MapSearchError(`打开系统地图超时（超过 ${timeout} 毫秒）`);
    }

    const detail = error instanceof Error ? error.message : String(error);
    throw new MapSearchError(`无法打开系统地图：${detail}`);
  }

  return { query: trimmed, url };
}

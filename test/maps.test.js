import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMAND_TIMEOUT_MS,
  MAPS_BUNDLE_ID,
  buildMapSearchUrl,
  normalizeQuery,
  openMapSearch,
} from "../src/maps.js";

describe("地图链接", () => {
  it("编码中文、空格、& 和 #", () => {
    assert.equal(
      buildMapSearchUrl("杭州西湖"),
      "https://maps.apple.com/?q=%E6%9D%AD%E5%B7%9E%E8%A5%BF%E6%B9%96",
    );
    assert.equal(
      buildMapSearchUrl("杭州 西湖"),
      "https://maps.apple.com/?q=%E6%9D%AD%E5%B7%9E%20%E8%A5%BF%E6%B9%96",
    );
    assert.equal(
      buildMapSearchUrl("杭州西湖 & #"),
      "https://maps.apple.com/?q=%E6%9D%AD%E5%B7%9E%E8%A5%BF%E6%B9%96%20%26%20%23",
    );
  });

  it("去掉首尾空格后再编码", () => {
    assert.equal(normalizeQuery("  杭州西湖 \n"), "杭州西湖");
    assert.equal(
      buildMapSearchUrl("  杭州西湖 \n"),
      buildMapSearchUrl("杭州西湖"),
    );
  });

  it("拒绝空查询和非字符串", () => {
    assert.throws(() => normalizeQuery(""), /query 不能为空/);
    assert.throws(() => normalizeQuery(" \t\n "), /query 不能为空/);
    assert.throws(() => normalizeQuery(undefined), /query 必须是字符串/);
    assert.throws(() => normalizeQuery(123), /query 必须是字符串/);
  });
});

describe("打开系统地图", () => {
  it("用参数数组调用 open，不把查询拼进 shell", async () => {
    /** @type {{ file: string, args: string[], options: { timeout: number } }[]} */
    const calls = [];

    const result = await openMapSearch("  杭州西湖 & #  ", {
      platform: "darwin",
      execFile: async (file, args, options) => {
        calls.push({ file, args, options });
      },
    });

    assert.deepEqual(calls, [
      {
        file: "/usr/bin/open",
        args: [
          "-b",
          MAPS_BUNDLE_ID,
          "https://maps.apple.com/?q=%E6%9D%AD%E5%B7%9E%E8%A5%BF%E6%B9%96%20%26%20%23",
        ],
        options: { timeout: COMMAND_TIMEOUT_MS },
      },
    ]);
    assert.equal(result.query, "杭州西湖 & #");
    assert.equal(calls[0].args[2].includes("&"), false);
    assert.equal(calls[0].args[2].includes("#"), false);
  });

  it("非 macOS 时不执行系统命令", async () => {
    let called = false;

    await assert.rejects(
      () =>
        openMapSearch("杭州西湖", {
          platform: "linux",
          execFile: async () => {
            called = true;
          },
        }),
      /当前系统不是 macOS/,
    );
    assert.equal(called, false);
  });

  it("命令失败时返回错误", async () => {
    await assert.rejects(
      () =>
        openMapSearch("杭州西湖", {
          platform: "darwin",
          execFile: async () => {
            throw new Error("simulated open failure");
          },
        }),
      /无法打开系统地图：simulated open failure/,
    );
  });

  it("命令超时时返回超时错误", async () => {
    await assert.rejects(
      () =>
        openMapSearch("杭州西湖", {
          platform: "darwin",
          timeoutMs: 50,
          execFile: async () => {
            const error = new Error("killed");
            error.killed = true;
            throw error;
          },
        }),
      /打开系统地图超时（超过 50 毫秒）/,
    );
  });
});

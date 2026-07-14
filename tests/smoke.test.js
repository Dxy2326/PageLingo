const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

global.self = global;
require("../shared-utils.js");

test("language and site guards avoid unnecessary translation calls", () => {
  assert.equal(detectLanguage("你好"), "zh");
  assert.equal(detectLanguage("テスト"), "ja");
  assert.equal(isHostAllowed("docs.github.com", ["github.com"]), true);
  assert.equal(isHostAllowed("example.com", ["github.com"]), false);
  assert.equal(isLikelyTargetLanguage("This is already English", "en"), true);
  assert.equal(isLikelyTargetLanguage("这个功能已经发布", "zh-TW"), false);
  assert.equal(isLikelyTargetLanguage("這個功能已經發佈", "zh-CN"), false);
});

test("provider URLs reject plaintext remote credentials", () => {
  assert.equal(normalizeProviderBaseUrl("https://api.example.com/v1/"), "https://api.example.com/v1");
  assert.equal(normalizeProviderBaseUrl("http://localhost:11434/v1"), "http://localhost:11434/v1");
  assert.throws(() => normalizeProviderBaseUrl("http://api.example.com/v1"), /HTTPS/);
  assert.throws(() => normalizeProviderBaseUrl("https://user:pass@example.com/v1"), /账号或密码/);
  assert.throws(() => normalizeProviderBaseUrl("https://api.example.com/v1?key=value"), /查询参数/);
});

test("X URLs use the fixed shortened length", () => {
  const url = "https://example.com/a/very/long/path/that/is/not-counted-literally";
  assert.equal(twitterWeightedLength(url), 23);
  const shortened = truncateByTwitterWeight(`${url} tail`, 25);
  assert.ok(twitterWeightedLength(shortened) <= 25);
  assert.ok(shortened.startsWith(url));
});

test("manifest references existing extension files", () => {
  const root = path.resolve(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const refs = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((entry) => entry.js)
  ];
  for (const ref of refs) assert.equal(fs.existsSync(path.join(root, ref)), true, ref);
  assert.equal("optional_host_permissions" in manifest, false);
});

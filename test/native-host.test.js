import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const host = resolve("native-host/AuditHost.exe");
function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  const run = spawnSync(host, { input: Buffer.concat([header, body]) });
  assert.equal(run.status, 0, run.stderr.toString());
  const size = run.stdout.readUInt32LE(0);
  return JSON.parse(run.stdout.subarray(4, size + 4).toString("utf8"));
}
test("native host saves persistent feedback, changes folder and exports snapshot", { skip: process.platform !== "win32" || !existsSync(host) }, () => {
  const root = mkdtempSync(join(tmpdir(), "x-follow-audit-"));
  try {
    const firstPath = join(root, "first");
    const secondPath = join(root, "second");
    const one = send({ action: "save", path: firstPath, data: { samples: [{ postUrl: "https://x.com/a/status/1", shouldMatch: true }] } });
    assert.equal(one.ok, true);
    assert.equal(readFileSync(one.file, "utf8").includes("shouldMatch"), true);
    const restored = send({ action: "read", path: firstPath });
    assert.equal(restored.ok, true);
    assert.equal(restored.data.samples[0].shouldMatch, true);
    const two = send({ action: "save", path: secondPath, data: { samples: [{ postUrl: "https://x.com/b/status/2", shouldMatch: false }] } });
    assert.equal(two.ok, true);
    assert.notEqual(two.path, one.path);
    assert.equal(existsSync(one.file), true);
    const exported = send({ action: "export", path: secondPath, data: { summary: { labels: 1 }, samples: [] } });
    assert.equal(exported.ok, true);
    assert.equal(JSON.parse(readFileSync(exported.file, "utf8")).summary.labels, 1);
    assert.equal(send({ action: "save", path: "relative", data: {} }).ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

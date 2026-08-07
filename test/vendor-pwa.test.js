const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("vendor portal is installable and has an offline fallback", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vendor-app.webmanifest"), "utf8"));
  const html = fs.readFileSync(path.join(__dirname, "..", "vendor-portal.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "..", "vendor-portal.js"), "utf8");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/vendor-portal");
  assert.equal(manifest.icons.length, 2);
  assert.match(html, /rel="manifest"/);
  assert.match(script, /serviceWorker\.register/);
  assert.match(script, /beforeinstallprompt/);
  assert.match(script, /Add to Home Screen/);
});

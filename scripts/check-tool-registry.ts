// npm run check:registry — pure. The registry is metadata only and the components live in
// components/tools/tool-components.tsx (2026-10-07), so a tool missing from that map is no
// longer a type error — it would throw on its tool page. This puts the check back before deploy.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { TOOLS } from "@/lib/tools/registry";

// The one SERVER tool, rendered directly by the tool page rather than through the map.
const SERVER_TOOLS = new Set(["tender-watch"]);

const map = readFileSync("components/tools/tool-components.tsx", "utf8");
const entries = [
  ...map.matchAll(/"([a-z0-9-]+)":\s*dynamic\(\(\)\s*=>\s*import\("@\/components\/tools\/([a-z0-9-]+)"\)\.then\(\(m\)\s*=>\s*m\.(\w+)\)/g),
].map(([, slug, dir, name]) => ({ slug, dir, name }));

const mapped = entries.map((e) => e.slug).sort();
const expected = TOOLS.map((t) => t.slug).filter((s) => !SERVER_TOOLS.has(s)).sort();
assert.deepEqual(mapped, expected, "tool-components.tsx keys must match the registry's client tools");

for (const { slug, dir, name } of entries) {
  const file = ["index.tsx", "index.ts"].map((f) => `components/tools/${dir}/${f}`).find(existsSync);
  assert.ok(file, `${slug}: components/tools/${dir} has no index`);
  assert.match(readFileSync(file, "utf8"), new RegExp(`export (async )?function ${name}\\b`), `${slug}: ${file} exports no ${name}`);
}
for (const slug of SERVER_TOOLS) assert.ok(TOOLS.some((t) => t.slug === slug), `${slug} is not in the registry`);

console.log(`✓ registry: ${entries.length} client tools mapped, ${SERVER_TOOLS.size} server tool rendered directly`);

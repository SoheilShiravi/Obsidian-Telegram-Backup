// Bundles the TypeScript tests with esbuild and runs them with the Node.js test runner.
// The "obsidian" module only exists inside the app, so tests get a small stub instead.
import { build } from "esbuild";
import { readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const testDir = path.join(root, "test");
const outdir = path.join(root, ".test-build");

rmSync(outdir, { recursive: true, force: true });

const entryPoints = readdirSync(testDir)
	.filter((name) => name.endsWith(".test.ts"))
	.map((name) => path.join(testDir, name));

await build({
	entryPoints,
	outdir,
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node20",
	sourcemap: "inline",
	logLevel: "warning",
	outExtension: { ".js": ".mjs" },
	alias: { obsidian: path.join(testDir, "obsidian-stub.ts") },
	// Plugin code uses window.setTimeout, as Obsidian recommends.
	banner: { js: "globalThis.window ??= globalThis;" },
});

const files = readdirSync(outdir)
	.filter((name) => name.endsWith(".mjs"))
	.map((name) => path.join(outdir, name));

const result = spawnSync(process.execPath, ["--test", "--enable-source-maps", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);

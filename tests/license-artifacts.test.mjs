import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const expectedPackageVersions = new Map([
  ["react", "19.2.8"],
  ["react-dom", "19.2.8"],
  ["react-server-dom-webpack", "19.2.8"],
  ["scheduler", "0.27.0"],
  ["vexflow", "5.0.0"],
  ["lucide-react", "1.33.0"],
  ["fast-xml-parser", "5.11.0"],
  ["@nodable/entities", "3.0.0"],
  ["is-unsafe", "2.0.2"],
  ["path-expression-matcher", "1.6.2"],
  ["strnum", "2.4.2"],
  ["anynum", "1.0.1"],
  ["xml-naming", "0.3.0"],
  ["rolldown", "1.2.6"],
  ["vinext", "1.0.0-beta.8"],
  ["tailwindcss", "4.2.1"],
]);

const regressionProneSources = new Map([
  ["vexflow", "https://github.com/vexflow/vexflow/tree/5.0.0"],
  ["@nodable/entities", "https://github.com/nodable/val-parsers/tree/d2070d76a8ba07e6c7fa142caeb51ffd756e47eb/Entity"],
  ["anynum", "https://github.com/NaturalIntelligence/anynum/tree/996c4711809427963104d717c1bd77383c8f0124"],
  ["xml-naming", "https://github.com/NaturalIntelligence/xml-naming/tree/f732ff38aa3e343ef64d190f0c96f370cb357969"],
  ["rolldown", "https://github.com/rolldown/rolldown/tree/v1.2.6"],
  ["vinext", "https://github.com/cloudflare/vinext/tree/vinext@1.0.0-beta.8"],
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}

async function listFiles(relativePath) {
  try {
    return await readdir(new URL(relativePath, import.meta.url), { recursive: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function installedPackageDirectory(packageName) {
  const candidates = [
    new URL(`../node_modules/${packageName}/`, import.meta.url),
    new URL(`../../../node_modules/${packageName}/`, import.meta.url),
  ];

  for (const candidate of candidates) {
    try {
      await access(new URL("package.json", candidate));
      return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  throw new Error(`Unable to locate installed package ${packageName}`);
}

function assertPinnedGithubSource(sourceText, componentName) {
  const source = new URL(sourceText);
  assert.equal(source.protocol, "https:", `${componentName} source must use HTTPS`);
  assert.equal(source.hostname, "github.com", `${componentName} source must identify its reviewed GitHub tree`);
  assert.equal(source.username, "");
  assert.equal(source.password, "");
  assert.equal(source.search, "");
  assert.equal(source.hash, "");

  const segments = source.pathname.split("/").filter(Boolean);
  assert.equal(segments[2], "tree", `${componentName} source must target an immutable tree`);
  const revision = decodeURIComponent(segments[3] ?? "");
  assert.match(
    revision,
    /^(?:[0-9a-f]{40}|(?:[^/@]+@)?v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/,
    `${componentName} source must use an exact tag or 40-character commit`,
  );
}

function embeddedWoff2Hashes(code) {
  return [...code.matchAll(/data:font\/woff2[^,]*;base64,([A-Za-z0-9+/=]+)/g)]
    .map((match) => sha256(Buffer.from(match[1], "base64")))
    .sort();
}

function licenseResourceUrl(root, resourcePath) {
  assert.match(resourcePath, /^\.\/[a-z0-9][a-z0-9._-]+$/i);
  return new URL(`${root}/${resourcePath.slice(2)}`, import.meta.url);
}

test("license manifest is version-pinned and every local resource is copied into the release", async () => {
  const [manifest, packageLock] = await Promise.all([
    readJson("../public/licenses/manifest.json"),
    readJson("../package-lock.json"),
  ]);

  assert.equal(manifest.verifiedAt, "2026-08-30");
  assert.equal(manifest.entries.length, expectedPackageVersions.size + 3);

  const packageEntries = manifest.entries.filter((entry) => !entry.provenancePath);
  assert.deepEqual(
    new Map(packageEntries.map((entry) => [entry.name, entry.version])),
    expectedPackageVersions,
    "the manifest must name every confirmed package whose code survives into this build",
  );
  for (const [name, expectedSource] of regressionProneSources) {
    assert.equal(
      packageEntries.find((entry) => entry.name === name)?.source,
      expectedSource,
      `${name} must retain its reviewed immutable source instead of a mutable or dead link`,
    );
  }

  const checkedResources = new Set();
  for (const entry of manifest.entries) {
    assertPinnedGithubSource(entry.source, entry.name);
    if (expectedPackageVersions.has(entry.name)) {
      assert.equal(
        packageLock.packages[`node_modules/${entry.name}`]?.version,
        entry.version,
        `${entry.name} notice version must match package-lock.json`,
      );
    }

    for (const property of ["noticePath", "additionalNoticePath", "provenancePath"]) {
      const resourcePath = entry[property];
      if (!resourcePath || checkedResources.has(resourcePath)) continue;
      checkedResources.add(resourcePath);
      const [sourceBytes, releaseBytes] = await Promise.all([
        readFile(licenseResourceUrl("../public/licenses", resourcePath)),
        readFile(licenseResourceUrl("../dist/client/licenses", resourcePath)),
      ]);
      assert.ok(sourceBytes.byteLength > 500, `${resourcePath} must contain a substantive notice or provenance record`);
      assert.deepEqual(releaseBytes, sourceBytes, `${resourcePath} must be copied byte-for-byte into dist/client`);
    }
  }
});

test("package license copies match installed artifacts and pinned upstream exceptions", async () => {
  const manifest = await readJson("../public/licenses/manifest.json");
  const packageEntries = manifest.entries.filter((entry) => expectedPackageVersions.has(entry.name));

  for (const entry of packageEntries) {
    if (entry.name === "@nodable/entities") continue;
    const packageDirectory = await installedPackageDirectory(entry.name);
    const [localText, installedText] = await Promise.all([
      readFile(licenseResourceUrl("../public/licenses", entry.noticePath), "utf8"),
      readFile(new URL("LICENSE", packageDirectory), "utf8"),
    ]);
    assert.equal(
      localText.trimEnd(),
      installedText.trimEnd(),
      `${entry.name} local license must reproduce the installed package license`,
    );
  }

  const entities = await readFile(new URL("../public/licenses/entities-3.0.0-LICENSE.txt", import.meta.url));
  assert.equal(sha256(entities), "750cb3fb6362804957ef52caaf9b5c824015be44d494637330d7cd8834d31d40");

  const rolldownDerived = await readFile(
    new URL("../public/licenses/rolldown-1.2.6-THIRD-PARTY-LICENSE.txt", import.meta.url),
    "utf8",
  );
  assert.equal(
    sha256(rolldownDerived.trimEnd()),
    "a877291d800ed43692f3f9ae09d8e01cc6f7293ad39d43896059c188ffbb8b7c",
    "Rolldown derived-code notices must match the v1.2.6 installed artifact",
  );
  assert.match(rolldownDerived, /Copyright \(c\) 2017 \[these people\]/);
  assert.match(rolldownDerived, /Copyright \(c\) 2020 Evan Wallace/);
});

test("confirmed Scheduler and MusicXML transitive code is present while XMLBuilder stays tree-shaken", async () => {
  const clientChunks = "../dist/client/_next/static/chunks/";
  const chunkNames = await listFiles(clientChunks);
  const frameworkChunks = chunkNames.filter((file) => /^framework-.*\.js$/.test(file));
  const importerChunks = chunkNames.filter((file) => /^importers-.*\.js$/.test(file));
  assert.equal(frameworkChunks.length, 1);
  assert.equal(importerChunks.length, 1);

  const [framework, importer] = await Promise.all([
    readFile(new URL(`${clientChunks}${frameworkChunks[0]}`, import.meta.url), "utf8"),
    readFile(new URL(`${clientChunks}${importerChunks[0]}`, import.meta.url), "utf8"),
  ]);
  assert.match(framework, /unstable_scheduleCallback/, "React DOM's Scheduler implementation must remain inventoried");

  for (const marker of [
    "[EntityReplacer] Invalid character",
    "is-unsafe: context must not be an empty array",
    "Invalid namespace in pattern:",
    "ExpressionSet is sealed.",
    "parseInt, Number.parseInt, window.parseInt are not supported",
    "1632,1776,2406,2534",
    "𐀀-󯿿",
  ]) {
    assert.ok(importer.includes(marker), `MusicXML artifact must retain reviewed transitive marker: ${marker}`);
  }
  assert.doesNotMatch(importer, /oneListGroup|suppressUnpairedNode/, "unused fast-xml-builder code must remain outside the artifact");
});

test("final VexFlow client and SSR chunks contain exactly the three licensed WOFF2 payloads", async () => {
  const manifest = await readJson("../public/licenses/manifest.json");
  const expectedHashes = manifest.entries
    .filter((entry) => entry.provenancePath)
    .map((entry) => entry.sha256)
    .sort();
  assert.equal(expectedHashes.length, 3);

  const locations = [
    "../dist/client/_next/static/chunks/",
    "../dist/server/ssr/_next/static/",
  ];
  for (const location of locations) {
    const chunks = (await listFiles(location)).filter((file) => /^vexflow-bravura-.*\.js$/.test(file));
    assert.equal(chunks.length, 1, `${location} must contain exactly one audited VexFlow Bravura chunk`);
    const code = await readFile(new URL(`${location}${chunks[0]}`, import.meta.url), "utf8");
    assert.deepEqual(
      embeddedWoff2Hashes(code),
      expectedHashes,
      `${chunks[0]} must contain only Academico Regular/Bold and Bravura`,
    );
  }
});

test("clean release has no stale external webfont artifacts", async () => {
  const staticFiles = await listFiles("../dist/client/_next/static/");
  const externalFonts = staticFiles.filter(
    (file) => file.includes("_vinext_fonts") && /\.woff2$/i.test(file),
  );
  assert.deepEqual(
    externalFonts,
    [],
    "Geist and removed Noto Music payloads must not survive from an earlier .vinext cache",
  );
});

test("generated Tailwind CSS retains its attribution banner", async () => {
  const cssDirectory = "../dist/client/_next/static/css/";
  const cssFiles = (await listFiles(cssDirectory)).filter((file) => file.endsWith(".css"));
  assert.ok(cssFiles.length > 0);
  const css = await readFile(new URL(`${cssDirectory}${cssFiles[0]}`, import.meta.url), "utf8");
  assert.match(css, /^\/\*! tailwindcss v4\.2\.1 \| MIT License \| https:\/\/tailwindcss\.com \*\//);
});

test("Rolldown generated client/server helpers retain both required notice files", async () => {
  const locations = [
    "../dist/client/_next/static/chunks/",
    "../dist/server/_next/static/",
  ];
  for (const location of locations) {
    const chunks = (await listFiles(location)).filter((file) => /^rolldown-runtime-.*\.js$/.test(file));
    assert.equal(chunks.length, 1, `${location} must expose exactly one generated Rolldown runtime chunk`);
    const runtime = await readFile(new URL(`${location}${chunks[0]}`, import.meta.url), "utf8");
    for (const signature of ["Object.create", "Object.defineProperty", "Object.prototype.hasOwnProperty"]) {
      assert.ok(runtime.includes(signature), `${chunks[0]} must retain Rolldown runtime helper ${signature}`);
    }
  }

  await Promise.all([
    access(new URL("../dist/client/licenses/rolldown-1.2.6-LICENSE.txt", import.meta.url)),
    access(new URL("../dist/client/licenses/rolldown-1.2.6-THIRD-PARTY-LICENSE.txt", import.meta.url)),
  ]);
});

test("engineering notice records the corrected font provenance and closed packaging gate", async () => {
  const notices = await readFile(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");
  assert.match(notices, /Last locally verified: 2026-08-30 \(Asia\/Seoul\)/);
  assert.match(notices, /301087ca0b0d30b65d81bc3e718ff64b613e2a9a/);
  assert.doesNotMatch(notices, /632e925353aab2ac0a81c97a4662d315a82b56f4/);
  assert.doesNotMatch(notices, /VexFlow font notice packaging remains open/);
  for (const component of expectedPackageVersions.keys()) {
    assert.ok(notices.includes(`\`${component}@`), `${component} must be represented in the engineering inventory`);
  }
});

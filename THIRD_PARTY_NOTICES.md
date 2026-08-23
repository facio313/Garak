# Garak Studio third-party notices

Last locally verified: 2026-08-24 (Asia/Seoul)

This file is the engineering license inventory for Garak Studio's direct runtime dependencies and the core build/runtime adapters that may contribute code or assets to a release. Exact versions below were cross-checked between `package-lock.json` and the installed package's `node_modules/<package>/package.json`. Upstream links come from that installed package metadata.

This is not a copy of the licenses and is not legal advice. A distributed web, desktop, or mobile release must make the applicable **complete upstream license texts and copyright notices** available with the release—for example, in an accessible Licenses screen and in the packaged notices directory. An SPDX label or this summary alone is not a substitute for a required license text.

## Compliance legend

- **MIT:** when package code or another substantial portion is distributed, retain the upstream copyright and permission notice.
- **ISC:** retain the upstream copyright and permission notice in distributed copies.
- **Apache-2.0:** provide the Apache 2.0 license, preserve applicable attribution and `NOTICE` material, and mark modified files when the license requires it.
- **MIT OR Apache-2.0:** record which offered license is used for a redistributed copy, then satisfy that license's notice conditions.
- **SIL Open Font License 1.1 (`OFL-1.1`):** embedding and bundling with software are permitted, but every redistributed copy must carry the font copyright notice and the complete OFL text. Do not sell the font by itself. A modified font must remain under OFL, and it may not use a Reserved Font Name without permission; documents rendered with the font do not inherit OFL.
- **Build-only qualification:** use of a tool only on the build machine does not establish that the tool itself is in the shipped artifact. If its runtime, generated source, source map, binary, or other substantial portion is shipped, include its applicable notice.

## Direct runtime dependencies

| Package and installed version | License evidence | Official upstream | Release compliance note |
| --- | --- | --- | --- |
| `react@19.2.6` | `MIT`; installed `node_modules/react/package.json` and `node_modules/react/LICENSE` | [React repository — `packages/react`](https://github.com/facebook/react/tree/main/packages/react) | Browser/server copies: ship the complete React MIT notice. |
| `react-dom@19.2.6` | `MIT`; installed `node_modules/react-dom/package.json` and `node_modules/react-dom/LICENSE` | [React repository — `packages/react-dom`](https://github.com/facebook/react/tree/main/packages/react-dom) | Browser/server copies: ship the complete React DOM MIT notice. |
| `vexflow@5.0.0` | VexFlow code: `MIT`, from installed `node_modules/vexflow/package.json` and `node_modules/vexflow/LICENSE`; Garak selects the `vexflow/bravura` entry, which embeds separately licensed fonts audited below | [VexFlow 5.0.0 source](https://github.com/vexflow/vexflow/tree/5.0.0) | Ship the complete VexFlow MIT notice **and** the complete Academico/Bravura font notices identified in the embedded-font audit. The npm package's root MIT file does not contain those font notices. |
| `lucide-react@1.33.0` | Package metadata: `ISC`; installed `node_modules/lucide-react/LICENSE` also contains a separate MIT notice for listed Feather-derived icons | [Lucide repository — `packages/lucide-react`](https://github.com/lucide-icons/lucide/tree/main/packages/lucide-react) | Ship the **entire installed Lucide LICENSE**, not only its ISC opening, so the Feather-derived icon notice is retained too. |
| `fast-xml-parser@5.11.0` | `MIT`; installed `node_modules/fast-xml-parser/package.json` and `node_modules/fast-xml-parser/LICENSE` | [fast-xml-parser repository](https://github.com/NaturalIntelligence/fast-xml-parser) | Client/server copies used for MusicXML: ship the complete MIT notice. |
| `drizzle-orm@0.45.2` | `Apache-2.0` in installed package metadata and `package-lock.json`; the installed npm artifact has **no root LICENSE/NOTICE file** | [Drizzle ORM repository](https://github.com/drizzle-team/drizzle-orm) | Before redistribution, obtain the canonical Apache-2.0 text and any applicable upstream notice material from the official source, preserve required attribution, and record local modifications. Do not treat the metadata label alone as a complete notice. |

## Core build, server-runtime, and deployment chain

These are direct development dependencies used by `vite.config.ts`, `postcss.config.mjs`, the Vinext scripts, or the Cloudflare deployment/runtime path. They are inventoried conservatively; the build-only qualification in the legend determines whether a particular release must ship each notice.

| Package and installed version | Role in this repository | License evidence | Official upstream | Release compliance note |
| --- | --- | --- | --- | --- |
| `react-server-dom-webpack@19.2.6` | Vinext/React server runtime peer | `MIT`; installed `package.json` and `LICENSE` | [React repository — `packages/react-server-dom-webpack`](https://github.com/facebook/react/tree/main/packages/react-server-dom-webpack) | If included in the worker/server artifact, ship its complete MIT notice. |
| `vinext@1.0.0-beta.2` | App framework CLI, build, and server runtime | `MIT`; installed `package.json` and `LICENSE` | [Cloudflare Vinext repository](https://github.com/cloudflare/vinext) | Server/runtime or redistributed tooling: ship the complete Vinext MIT notice. |
| `vite@8.0.13` | Bundler used by `vite.config.ts` | `MIT`; installed `package.json` and `LICENSE.md` | [Vite repository — `packages/vite`](https://github.com/vitejs/vite/tree/main/packages/vite) | If Vite code/tooling is redistributed, preserve the **entire `LICENSE.md`**: it includes Vite's MIT notice and notices for code bundled into Vite under Apache-2.0, BSD-2-Clause, CC0-1.0, ISC, and MIT. |
| `@openai/sites-vite-plugin@0.1.0` | OpenAI Sites Vite plugin imported by `vite.config.ts` | `MIT`; installed `package.json` and `LICENSE` | [OpenAI Sites repository — `packages/sites-vite-plugin`](https://github.com/openai/sites/tree/main/packages/sites-vite-plugin) | If plugin/runtime code is included in a distributed artifact, ship its complete MIT notice. |
| `@cloudflare/vite-plugin@1.37.1` | Cloudflare Worker adapter dynamically imported by `vite.config.ts` | `MIT` in installed package metadata and `package-lock.json`; no root LICENSE file in the installed npm artifact | [Cloudflare Workers SDK — `packages/vite-plugin-cloudflare`](https://github.com/cloudflare/workers-sdk/tree/main/packages/vite-plugin-cloudflare) | If redistributed, obtain and retain the canonical upstream MIT notice; the local SPDX field alone is incomplete notice material. |
| `@vitejs/plugin-react@6.0.2` | Vinext/Vite React transform peer | `MIT`; installed `package.json` and `LICENSE` | [Vite React plugin repository — `packages/plugin-react`](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react) | Redistributed tool/plugin copies: ship the complete MIT notice. |
| `@vitejs/plugin-rsc@0.5.26` | Vinext/Vite React Server Components peer | `MIT` in installed package metadata and `package-lock.json`; no root LICENSE file in the installed npm artifact | [Vite React plugin repository — `packages/plugin-rsc`](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-rsc) | If plugin or emitted runtime code is redistributed, obtain and retain the canonical upstream MIT notice. |
| `tailwindcss@4.2.1` | CSS framework imported by `app/globals.css` | `MIT`; installed `package.json` and `LICENSE` | [Tailwind CSS repository — `packages/tailwindcss`](https://github.com/tailwindlabs/tailwindcss/tree/main/packages/tailwindcss) | Preserve the generated CSS attribution banner and ship the complete Tailwind MIT notice with distributed CSS. |
| `@tailwindcss/postcss@4.2.1` | PostCSS build plugin configured by `postcss.config.mjs` | `MIT`; installed `package.json` and `LICENSE` | [Tailwind CSS repository — `packages/@tailwindcss-postcss`](https://github.com/tailwindlabs/tailwindcss/tree/main/packages/%40tailwindcss-postcss) | Build-only unless the plugin or its source is redistributed; then ship the complete MIT notice. |
| `wrangler@4.92.0` | Cloudflare development/deployment CLI and plugin peer | `MIT OR Apache-2.0` in installed package metadata and `package-lock.json`; no root LICENSE/NOTICE file in the installed npm artifact | [Cloudflare Workers SDK — `packages/wrangler`](https://github.com/cloudflare/workers-sdk/tree/main/packages/wrangler) | Normally build/deploy-only. If redistributed, select and record one offered license and obtain its complete upstream notice set first. |
| `@cloudflare/workers-types@4.20260702.1` | Compile-time Worker type declarations | `MIT OR Apache-2.0` in installed package metadata and `package-lock.json`; no root LICENSE/NOTICE file in the installed npm artifact | [Cloudflare workerd repository](https://github.com/cloudflare/workerd) | Type-only in the current app. If declarations or source maps containing them are distributed, select an offered license and include its complete notice set. |

## VexFlow 5.0.0 embedded-font audit

### What the release source selects

- Garak's `ScoreRenderer` dynamically imports the package export `vexflow/bravura`. It does not import the six-font root entry and it does not use the font-free `vexflow/core` entry.
- The official [VexFlow 5.0.0 Bravura entry](https://github.com/vexflow/vexflow/blob/5.0.0/entry/vexflow-bravura.ts) loads exactly Academico Regular, Academico Bold, and Bravura, then selects Bravura/Academico as the notation/text font pair. The root entry additionally loads Gonville, Petaluma, and Petaluma Script, but that entry is no longer in Garak's runtime import graph.
- VexFlow's [font build documentation](https://github.com/vexflow/vexflow/blob/5.0.0/tools/fonts/README.md) records that the generated font modules embed base64 WOFF2 payloads. The shipped-font inventory must therefore be checked against the final generated client chunk, not inferred only from `package.json`.
- The final local production build emits `vexflow-bravura-D82V_BuN.js` at 719,732 raw / 387,740 `gzip -9` bytes. The preceding production chunk was 1,119,932 raw / 690,704 gzip bytes, so the selected entry removes 400,200 raw / 302,964 gzip bytes (about 43.9% gzip). This is generated-artifact evidence, not a package-entry estimate; the deployed asset inventory must still be matched to the same build before release.
- The final chunk contains exactly three long embedded WOFF2 payloads. Decoding them reproduces the Academico Regular, Academico Bold, and Bravura SHA-256 values listed below. Strings such as `Gonville`, `Petaluma`, and `Leland` still occur in VexFlow's generic font-name/API tables; a name occurrence is not a font binary. None of their WOFF2 payload hashes is present.

| Font payload selected for the release client | Confirmed provenance and license | Decoded WOFF2 SHA-256 | Required release action |
| --- | --- | --- | --- |
| Academico Regular 0.902 and Academico Bold 0.902 (`@vexflow-fonts/academico@1.0.1`) | The official [Academico package and provenance note](https://github.com/vexflow/vexflow-fonts/tree/b2bc3a6070225e4d395966b36de76c36a9429b1c/academico) says it was installed by Dorico from Steinberg. Its [license](https://github.com/vexflow/vexflow-fonts/blob/b2bc3a6070225e4d395966b36de76c36a9429b1c/academico/LICENSE.txt) is `OFL-1.1`, copyright 2022 Steinberg Media Technologies GmbH, Reserved Font Name **Academico**. | Regular: `363caf009818b9cebc7a2644d96b5dc10a20d3b5e557afdb4fb1a9a53d57e329`; Bold: `575c2e30fcf7dd9363e49890644b2ed23b6b518c9866aadb5370d470473297b6` | Include the Academico copyright notice and complete OFL 1.1 text with the web release. Do not modify and continue using the Reserved Font Name without a separate naming review. |
| Bravura 1.392 (`@vexflow-fonts/bravura@1.0.2`) | The official [VexFlow font package](https://github.com/vexflow/vexflow-fonts/tree/b2bc3a6070225e4d395966b36de76c36a9429b1c/bravura) records the Steinberg source. Steinberg's [canonical license](https://github.com/steinbergmedia/bravura/blob/632e925353aab2ac0a81c97a4662d315a82b56f4/LICENSE.txt) is `OFL-1.1`, copyright 2019 Steinberg Media Technologies GmbH, Reserved Font Name **Bravura**. | `5c25278c208ca455dc7c3c0c95d833e134aca6d740a023767af50d0dfa06ef82` | Include the Bravura copyright notice and complete OFL 1.1 text. Preserve the exact font/name or perform a Reserved Font Name review before modification. Keep Steinberg's [upstream `FONTLOG.txt`](https://github.com/steinbergmedia/bravura/blob/632e925353aab2ac0a81c97a4662d315a82b56f4/redist/FONTLOG.txt) with release provenance when packaging font files separately. |

### Fonts reviewed but not currently shipped

- **Gonville:** the earlier provenance audit traced `@vexflow-fonts/gonville@1.0.0` to Simon Tatham through the official [VexFlow font package](https://github.com/vexflow/vexflow-fonts/tree/b2bc3a6070225e4d395966b36de76c36a9429b1c/gonville) and its custom [`LICENCE.txt`](https://github.com/vexflow/vexflow-fonts/blob/b2bc3a6070225e4d395966b36de76c36a9429b1c/gonville/LICENCE.txt). Garak's selected `vexflow/bravura` entry does not embed it. Re-open artifact and license review before adding it.
- **Petaluma and Petaluma Script:** the official [Petaluma](https://github.com/vexflow/vexflow-fonts/tree/b2bc3a6070225e4d395966b36de76c36a9429b1c/petaluma) and [Petaluma Script](https://github.com/vexflow/vexflow-fonts/tree/b2bc3a6070225e4d395966b36de76c36a9429b1c/petalumascript) packages identify OFL-1.1/Steinberg provenance. Garak's selected entry does not embed either payload. Future adoption requires a fresh shipped-byte, OFL, Reserved Font Name, and notice review.
- **Leland:** not embedded and not installed as a Garak dependency. Future adoption of the official [Leland package](https://github.com/vexflow/vexflow-fonts/tree/b2bc3a6070225e4d395966b36de76c36a9429b1c/leland) requires a fresh artifact/license review.

### Confirmed facts and acceptance boundary

- **Confirmed from source/package exports:** VexFlow 5.0.0 code is MIT; the selected `vexflow/bravura` entry exposes the same VexFlow API Garak uses and embeds only Academico Regular/Bold and Bravura. Gonville, Petaluma, Petaluma Script, and Leland are outside the selected runtime entry.
- **Confirmed in the final local production build:** the emitted `vexflow-bravura` dynamic chunk contains exactly the three decoded WOFF2 payload hashes listed for Academico Regular/Bold and Bravura. Generic API/name strings for other VexFlow fonts remain, but their binary payload hashes do not. The deployed asset must still be matched to this build.
- **Confirmed:** the installed `vexflow@5.0.0` npm artifact contains only VexFlow's MIT `LICENSE` and omits the Academico/Bravura OFL files, so relying on `node_modules/vexflow/LICENSE` alone would produce an incomplete commercial notice set.

## Release gates and unresolved evidence

1. **VexFlow font notice packaging remains open:** the release source selects Academico Regular/Bold and Bravura, but this repository still does not contain or serve their complete OFL texts and copyright notices. Commercial release remains gated until the complete notices for the fonts actually shipped are delivered in a user-accessible Licenses surface. This summary intentionally does not copy the third-party license texts.
2. **Deployed artifact scope:** the final local build's chunk size and three-font payload inventory are recorded above. Before release, verify that the deployed asset is this build and archive its complete chunk hash/SBOM with the release record.
3. **Packages whose npm artifact omits full license text:** `drizzle-orm`, `@cloudflare/vite-plugin`, `@vitejs/plugin-rsc`, `wrangler`, and `@cloudflare/workers-types` have an SPDX license expression in both installed metadata and the lockfile but no root license file in the installed package. Acquire the canonical texts from the linked upstream repositories before redistributing them.
4. **Transitive dependency closure:** this file covers direct runtime packages and the named core build/runtime chain, not every transitive package under `node_modules`. Before each public web, desktop, or mobile release, generate a fresh production artifact/SBOM, scan the packages and assets that actually survive into it, resolve unknown/custom licenses, and archive that report with the release.
5. **Source maps and mobile/desktop wrappers:** publicly shipped source maps can contain otherwise build-only code. A future native wrapper also creates a new dependency and asset universe. Re-run the inventory for each release format rather than carrying this list forward unchanged.

## Reviewed but not adopted

Verovio and MuseScore are not declared in `package.json`, have no entry in the current `package-lock.json`, and are not present as installed application dependencies. No license is assigned to them in this notice. They remain a separate copyleft-review boundary: do not add their source, binaries, WebAssembly, fonts, or other assets until the exact artifact/version license and the intended server/client distribution model have been reviewed and approved.

## Release checklist

- Reconcile `package.json`, `package-lock.json`, the production artifact, and this inventory after every dependency update.
- Preserve complete upstream license files; do not replace them with the short summaries above.
- Make notices available to recipients of browser, server, desktop, and mobile distributions as applicable.
- Record modified third-party files and any selected dual-license option in release records.
- Treat an absent bundled license file as an unresolved release gate, not as permission to omit the notice.

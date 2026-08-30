import type { Metadata } from "next";
import Link from "next/link";
import manifest from "../../public/licenses/manifest.json";

export const metadata: Metadata = {
  title: "Open-source licenses — Garak Studio",
  description: "Third-party license texts and embedded notation-font notices distributed with Garak Studio.",
};

function localLicenseHref(path: string) {
  return `/licenses/${path.replace(/^\.\//, "")}`;
}

export default function LicensesPage() {
  return (
    <main className="licenses-page">
      <div className="licenses-shell">
        <header className="licenses-header">
          <Link className="licenses-back" href="/">← Back to Garak Studio</Link>
          <span className="eyebrow">GARAK STUDIO</span>
          <h1>Open-source licenses</h1>
          <p>Notices bundled with this release. These local files remain available without a third-party service.</p>
        </header>

        <section className="licenses-summary" aria-label="License bundle information">
          <strong>{manifest.entries.length} shipped components and font payloads</strong>
          <span>Bundle verified {manifest.verifiedAt}</span>
          <Link href="/licenses/README.txt" prefetch={false}>Read the bundle notes</Link>
          <Link href="/licenses/manifest.json" prefetch={false}>Open the machine-readable manifest</Link>
        </section>

        <ol className="license-list">
          {manifest.entries.map((entry, index) => (
            <li key={`${entry.name}-${entry.version}-${index}`}>
              <div>
                <span className="license-index">{String(index + 1).padStart(2, "0")}</span>
                <h2>{entry.name}</h2>
                <p>{entry.version} · {entry.license} · {entry.scope}</p>
              </div>
              <nav aria-label={`${entry.name} license resources`}>
                <Link href={localLicenseHref(entry.noticePath)} prefetch={false}>Complete license text</Link>
                {entry.additionalNoticePath ? <Link href={localLicenseHref(entry.additionalNoticePath)} prefetch={false}>{entry.additionalNoticeLabel}</Link> : null}
                {entry.provenancePath ? <Link href={localLicenseHref(entry.provenancePath)} prefetch={false}>Font provenance</Link> : null}
                <a href={entry.source} target="_blank" rel="noopener noreferrer">Pinned upstream source <span className="visually-hidden">(opens in a new tab)</span></a>
              </nav>
            </li>
          ))}
        </ol>

        <footer className="licenses-footer">
          Garak Studio retains these notices for the software and embedded fonts it distributes. The listed licenses govern their respective components.
        </footer>
      </div>
    </main>
  );
}

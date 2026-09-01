# iOS content-rights record

Evidence for the App Store Connect content-rights declaration. Recheck the
exact candidate commit and screenshot set before submission.

## Bundled assets

| Asset | Source / license | Candidate check |
| --- | --- | --- |
| `apps/app/assets/icon-logo.svg` | Versioned Zenguy source artwork; contains only geometric paths and the app palette | Confirm NIESAYO GROUP, S.L. owns the Zenguy name and artwork |
| `apps/app/assets/icon.png` | Raster App Store icon shipped by the same target | 1024 × 1024 PNG, RGB, no alpha |
| `apps/app/assets/splash-icon.png` | Zenguy launch artwork | 512 × 512 PNG; transparency is permitted for this non-App-Store asset |
| `apps/app/assets/fonts/Geist-*.ttf` and `GeistMono-*.ttf` | Geist Project Authors, SIL Open Font License 1.1 | Full license retained at `apps/app/assets/fonts/OFL.txt` |
| `@expo/vector-icons` glyphs | Joel Arvidsson / 650 Industries, MIT | Package version `15.1.1`; license is included with the dependency |

Current SHA-256 checksums:

```text
a11abb69d918d80806faff66d84b9bc25116937c9c391e8129e355d60922e2ac  icon.png
d08dc445009f0dd6a05ad707266edae149fd66b9575ea5ce521e62d66e7ca383  splash-icon.png
7f2f7e746b730e1c3899a81a98cb470ba15631f4b31e0f1a668a18117f9adcf6  icon-logo.svg
c683bfbcc7e087f5d37a54ef628f10387c451a83ddc459b151403a164ac46c90  fonts/OFL.txt
```

Regenerate the checksums if any asset changes; do not copy these hashes into a
release record for a different file.

## Customer and review content

The app can display website content captured by browser tests configured by a
customer. That content remains inside the customer's private workspace and is
not Zenguy marketing material. For App Review and store screenshots:

- use only the dedicated fictitious workspace and controlled `.example.com`
  fixtures;
- do not show customer domains, personal data, third-party trademarks or
  copyrighted page imagery;
- keep the neutral demo names defined in `apps/api/scripts/seed.mjs`;
- document separate permission before using any third-party logo or page in a
  screenshot or preview.

## Sign-off

- [ ] Product owner confirms ownership of the Zenguy name, icon and splash
  artwork.
- [ ] Candidate asset checksums match this record or the record is updated.
- [ ] Screenshot reviewer confirms the final images contain only cleared demo
  content.
- [ ] App Store Connect **Content Rights** is answered from these checks.

# Runtime licence inventory: images, Ubuntu packages and the browser

Written 13 November 2026 by Claude Code, for the owner's question 11 (`docs/STATUS.md`) and known gap 61. It answers the outside review the owner passed on: "Don't approve the new licence bundle as currently worded ... Ask for the exact inventory, applicable notices and proposed handling first. A green npm licence check does not cover browser binaries or container contents."

**What this is.** For each item question 11 names: what is inside it, what licence names and notices it carries, and options for handling it. **What it is not.** It is not a legal reading. It quotes what the notices say and does not say what any of them requires of the owner; that reading is for the owner with an engineer or a lawyer. Nothing here is approved. The last column of the table holds options, not decisions. How it was read, with two mistakes to declare, is just below the table.

**Words used here.**
- *Image*: a packaged copy of a small Linux system that a container runs. *Digest*: the fingerprint of one exact image; any change gives a new one.
- *Package*: one installable piece of a Linux system, with its own version and licence.
- *Notice*: the copyright and licence text a package carries.
- *Copyleft*: here, a licence of the GPL, LGPL, MPL, GFDL or CC-BY-SA families, as named in a notice. It describes the licence family only, not any duty.
- *Source offer*: what the GPL texts describe: the program's source code given with a copy, or a written offer to give it.

## The inventory at a glance

| Item | Where used | Licences found | Copyleft parts named | Notices read? | Proposed handling (options in section 4) |
| --- | --- | --- | --- | --- | --- |
| `node:22-alpine`, digest `sha256:0e1754758c2d…` | Every sandbox; also the base of every app the builder makes | 19 Alpine packages under 8 licence names; Node.js 22.23.4 (MIT-style notice, plus notices of 43 bundled parts); npm 10.9.9 (Artistic 2.0) with 195 bundled packages; yarn 1.22.22 (BSD 2-Clause); corepack 0.36.0 (MIT-style) | 13 of 19 packages: GPL-2.0-only (8, busybox and apk-tools among them); GPL-2.0-or-later with LGPL-2.1-or-later (libgcc, libstdc++, libatomic); GPL-2.0-or-later in musl-utils; MPL-2.0 in ca-certificates-bundle | The four licence files in the image, yes. For the 19 packages, only their licence names (the image holds no notice texts for them) | Builder use: pin the digest, keep this record. Customer copy: decided at 3.2 |
| `postgres:16-alpine`, digest `sha256:aa6cb33cf4c1…` | Every sandbox; possibly named by an export's start file (asked at 3.2) | 44 Alpine packages (plus 1 grouping entry) under 18 licence names; PostgreSQL 16.15 (its own permission notice); gosu 1.19 (Apache 2.0) | 21 of 44: the 12 of the row above that it shares, plus GPL-3.0-or-later (bash, readline, gdbm), GPL with LGPL (keyutils-libs, libcom_err, xz-libs), GPL with BSD (lz4-libs), "BSD-3-Clause OR GPL-2.0-or-later" (zstd, zstd-libs) | For the 44 packages, only their licence names (no notice texts in the image); PostgreSQL's and gosu's notices read from their published source, as the image holds no licence file | As the row above |
| `ubuntu:24.04`, digest `sha256:2198e4c65076…` | Base of package 3.1's runner image (builder only) | Not listed: its package list was not kept on 13 Nov and the image was not pulled again | Measured on 13 Nov, list not kept: bash, coreutils, tar, grep, sed (GPL-3+) | No | Builder only: read its package list and notices first, then put it to the owner (4.1); pin the digest |
| 109 Ubuntu packages added by `playwright install-deps` | 3.1's runner image (builder only) | Each package's own list in `raw/`; across the 54 machine-readable copyright files of the 119: 188 licence field values as written, 131 single names (the counting rule is in section 2) | 49 of 109 name one somewhere in their copyright file; for 28 the main entry is copyleft (fonts, sound, accessibility, Avahi, cairo, GLib, Pango, NSS, NSPR and others) | Yes: each copyright file, from its package at the build log's version | Builder only: pin the version list, keep the notices, show any change |
| 16 download-stage packages (`curl`, `unzip`, 14 libraries) | While the runner image is built; the 10 not among the 109 are not left in it, the other 6 are (as part of the 109) | Main entries: curl's own licence (curl, libcurl4t64), Info-ZIP (unzip), MIT (libbrotli1, libpsl5t64), Expat (libnghttp2-14), OpenLDAP-2.8 (libldap2), BSD-style (Kerberos, SASL), LGPL (libssh-4, librtmp1), GPL-2+ (libkeyutils1); full lists in `raw/` | 13 of 16 name one somewhere; for 3 the main entry is copyleft (libssh-4, librtmp1, libkeyutils1) | Yes, the same way | Builder only, as the row above |
| `node:22-bookworm-slim`, digest `sha256:e9f565d32859…` | Node and npm copied from it into the runner | Node: MIT-style notice (read from node:22-alpine's copy); npm 10.9.9: Artistic 2.0 | As node:22-alpine's Node and npm | Not from this image: it is not on the machine and was not pulled again | Builder only: read its Node notice first, then put it to the owner (4.1); pin the digest |
| Chrome for Testing 153.0.8010.12 headless shell, zip `a9da0288…` | 3.1's runner (builder only) | 295 notice sections; 20 kinds of licence wording; `ABOUT` says "All rights reserved" and points to Google's Terms of Service | 15 sections: ffmpeg, gtk, WebKit, plasma-wayland-protocols, Speech Dispatcher (LGPL), 8 symphonia sections (MPL-2.0), hyphenation data (5 of 52 files), ICU build files (GPL) | `ABOUT` and `LICENSE.headless_shell` yes; Google's terms no (the session proxy refused) | Builder only: pin the fingerprint; terms read by a lawyer first |
| Same browser, the copy on the development machine (`/opt/pw-browsers`), program `ea2a2458…` | W1 and the host screenshots | Same notices: its `ABOUT`, `LICENSE.headless_shell` and all 286 other files are identical to the zip's; only the program file differs | Same as the zip | Yes (identical to the zip's) | As the zip; an engineer to say why the program file differs |
| Full Chromium 1243 and Playwright's ffmpeg build on the development machine (found in passing) | Not used by the builder's code, as read | Not inventoried; Widevine's notice says "The Software is not open source software" | ffmpeg build: its folder holds `COPYING.LGPLv2.1` | Only the two files named | Not part of question 11; an engineer to say whether they stay in the environment |

## How it was read, and what was not done

The two sandbox images were already on this machine and in use; they were not pulled again. Each was started with no network only to read its files (`docker run --rm --network none --entrypoint cat`). This is inspection of images already in use, not a new use. The Ubuntu packages were downloaded as files with a separate package index in the session's scratch folder (the machine's own index was not changed), opened as archives and never installed or run. No Ubuntu image was pulled or run. The browser zip was downloaded again from its pinned address, its SHA-256 matched the recorded `a9da0288…`, and it was unpacked, not run. **Two mistakes to declare:** while listing the development machine's browser folder, two programs there were started once each with a version request whose output was thrown away: Playwright's `ffmpeg-1011/ffmpeg-linux -version` and the full Chromium's `chrome --version` (not the headless shell the builder uses). Neither opened a page. It goes against the hold "no demonstration that starts the browser" (`docs/STATUS.md`, question 11) and was not repeated.

## 1. The two sandbox images

Read 13 Nov 2026 from the copies on this machine. `docker image inspect` gave (full text in `raw/*-image-inspect.txt`):
- `node:22-alpine`: `sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202`, created 5 Nov 2026, linux/amd64, Alpine 3.24.4, `NODE_VERSION=22.23.4`, `YARN_VERSION=1.22.22`. The same digest as recorded in question 11 for the live tests.
- `postgres:16-alpine`: `sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139`, created 5 Nov 2026, linux/amd64, Alpine 3.24.4, `PG_VERSION=16.15`, `GOSU_VERSION=1.19`. The same digest as recorded in question 11.

**Package lists** (read from each image's `/lib/apk/db/installed`, its `P:`, `V:` and `L:` lines; full lists in `raw/node-22-alpine-packages.tsv` and `raw/postgres-16-alpine-packages.tsv`, the files as read beside them, less the package maintainers' lines: section 5). The licence names are as the package list writes them.

`node:22-alpine`, 19 packages:
- GPL-2.0-only: alpine-baselayout, alpine-baselayout-data, apk-tools, busybox, busybox-binsh, libapk, scanelf, ssl_client.
- GPL-2.0-or-later AND LGPL-2.1-or-later: libatomic, libgcc, libstdc++.
- MIT AND BSD-2-Clause AND GPL-2.0-or-later: musl-utils.
- MPL-2.0 AND MIT: ca-certificates-bundle.
- Apache-2.0: libcrypto3, libssl3. MIT: alpine-keys, alpine-release, musl. Zlib: zlib.

`postgres:16-alpine`, 45 entries: 44 packages and `.postgresql-rundeps`, a grouping entry with no licence (a name the image's build uses to pull in the others). Beyond the 18 packages it shares with the list above (all but libatomic), its other 26:
- GPL-3.0-or-later: bash, gdbm, readline.
- GPL-2.0-or-later AND LGPL-2.0-or-later: keyutils-libs. With BSD-3-Clause AND MIT as well: libcom_err.
- GPL-2.0-or-later AND 0BSD AND Public-Domain AND LGPL-2.1-or-later: xz-libs. BSD-2-Clause AND GPL-2.0-or-later: lz4-libs.
- BSD-3-Clause OR GPL-2.0-or-later: zstd, zstd-libs.
- Others: icu-data-full, icu-libs (ICU); krb5-conf, krb5-libs, libffi, libverto, libxml2 (MIT); libedit, libuuid, nss_wrapper (BSD-3-Clause); libldap (OLDAP-2.8); libncursesw, ncurses-terminfo-base, libxslt (X11); libsasl (BSD-3-Clause-Attribution AND BSD-4-Clause); llvm21-libs (Apache-2.0); tzdata (Public-Domain).

**What the package lists do not show** (read inside the images):
- In `node:22-alpine`: Node.js 22.23.4 (`/usr/local/bin/node`), npm 10.9.9, corepack 0.36.0 and yarn 1.22.22, installed by the image's own build. Their licence files: `/usr/local/LICENSE` (Node), `/usr/local/lib/node_modules/npm/LICENSE`, `/usr/local/lib/node_modules/corepack/LICENSE.md`, `/opt/yarn-v1.22.22/LICENSE` (copies in `raw/`).
  - Node's file begins "Node.js is licensed for use as follows:" with a notice that begins "Permission is hereby granted, free of charge" (line 6), then names 43 bundled parts with their own notices (`- <name>, located at <path>, is licensed as follows:`). Among them: npm, "Licensed on the terms of The Artistic License 2.0" (the entry at line 1906); ICU, whose notice includes two build files under the GPL with an Autoconf exception: "File: aclocal.m4 (only for ICU4C)" (GPL version 2 or later) and "File: config.guess (only for ICU4C)" (GPL version 3 or later).
  - npm's own file: "The npm application ... Licensed on the terms of The Artistic License 2.0", and "Node package dependencies of the npm application ... Licensed on their respective license terms". Its 195 bundled packages declare (`raw/npm-10.9.9-bundled-packages.tsv`): ISC 90, MIT 77, Apache-2.0 11 (one written "Apache 2.0"), BlueOak-1.0.0 8, BSD-2-Clause 6, BSD-3-Clause 1, CC0-1.0 1, CC-BY-3.0 1 (spdx-exceptions). None names a copyleft licence. Artistic 2.0 and CC-BY-3.0 are not on the project's permitted list (`builder/licence-rule.json`); that file names CC-BY-3.0 only in two approved exceptions, for the builder's own development copies of `spdx-exceptions` (CC-BY-3.0) and `spdx-ranges` ("(MIT AND CC-BY-3.0)").
  - corepack: "Permission is hereby granted, free of charge ..." yarn: "BSD 2-Clause License".
- In `postgres:16-alpine`: PostgreSQL 16.15 under `/usr/local` (built by the image, not in the package list) and gosu 1.19 at `/usr/local/bin/gosu` (`su-exec` is a link to it), a small program the image's start script uses to switch user. **The image holds no licence file at all** (a search of the whole image for files named LICENSE, COPYING, COPYRIGHT or NOTICE found none). So the two notices were read from their published source instead: PostgreSQL's `COPYRIGHT` at tag `REL_16_15` ("Permission to use, copy, modify, and distribute this software and its documentation for any purpose, without fee, and without a written agreement is hereby granted, provided that the above copyright notice and this paragraph and the following two paragraphs appear in all copies.", lines 8-11) and gosu's `LICENSE` at tag `1.19` (the Apache License, Version 2.0). Copies in `raw/`.
- **Licence texts inside the images:** `node:22-alpine` holds only the four files above (searched the whole image except npm's bundled packages); `postgres:16-alpine` holds none. The GPL, LGPL and MPL texts that the package lists name are not in either image; the images carry only the names. So for the 45 Alpine packages (the 19, and the database image's 26 others) what was read is each package's licence name or names, not a notice text, and this inventory quotes no licence text for them. Besides the GPL, LGPL and MPL names, the names among them not on the project's permitted list (`builder/licence-rule.json`) are seven: ICU (icu-data-full, icu-libs), OLDAP-2.8 (libldap), BSD-4-Clause and BSD-3-Clause-Attribution (libsasl), X11 (libncursesw, ncurses-terminfo-base, libxslt), Zlib (zlib, in both images) and Public-Domain (tzdata, and part of xz-libs).

## 2. The runner image's Ubuntu packages

**What was read.** The build log of 13 Nov (`13-rb-build.log` in that session's scratch folder) lists 109 packages that `playwright install-deps` added and 16 that the download stage added; 6 are in both, so 119 distinct packages. Each was downloaded with `apt-get download <package>=<version>` at **exactly the version in the build log: all 119 were available at that version, none substituted** (checked: the downloaded files' own package names and versions match the log's list). Each package's `/usr/share/doc/<package>/copyright` was read from the downloaded file with `dpkg-deb --fsys-tarfile | tar -xO`; all 119 hold one. Results per package (version, which list, source package, licence names, main entry, copyleft names, the copyright file's fingerprint and where it is stored): `raw/ubuntu-runner-packages.tsv`. The 84 distinct copyright texts: `raw/ubuntu-copyright/`. Fingerprints of the 119 downloaded files: `raw/ubuntu-debs-sha256.txt`.

**How the licence names were taken.** 53 copyright files are in Debian's machine-readable format: every value of their `License:` fields was taken as written. One more (`fonts-wqy-zenhei`) is in that format but its first line is damaged ("t: http://www.debian.org/..."); its fields were read by hand. The other 65 (42 distinct texts) are free text and were read by hand: most are permission notices with no licence name (the kind the X Window System libraries use, beginning "Permission is hereby granted" or "Permission to use, copy"); the rest are recorded in the table's own words (for example `libcairo2`: "either the GNU Lesser General Public License (LGPL) version 2.1 or the Mozilla Public License (MPL) version 1.1").

**One limit to keep in mind.** A Debian copyright file covers the whole source the package was built from. A licence it names may cover only files that are not in the installed package, such as build scripts, translations or programs shipped in other packages. Which installed file each name covers was not worked out. Example: `libelf1t64`'s main entry (`Files: *`) is GPL-3+, while the paragraph for `lib*` and other folders in the same file has the `License:` field "LGPL-3+ or GPL-2+" (line 44 of `raw/ubuntu-copyright/libelf1t64.copyright`). So the table gives two figures: packages that name a copyleft licence anywhere in the file, and packages whose main entry (or, for the hand-read files, the licence stated for the library) is copyleft or offers one as a choice.

**Counts.**
- All 119: 57 name a copyleft licence somewhere; for 30 the main entry is copyleft or offers one as a choice. In the 54 machine-readable files, 188 distinct `License:` values as written. 131 single names, by this rule: each value is split at "and" and "or" (in any letter case) and at commas, brackets are removed, and letter case is ignored (the splitting alone gives 142). The 65 hand-read files add the statements recorded in the table.
- The 109 of `install-deps`: 49 and 28. The 28: at-spi2-common, fonts-freefont-ttf, fonts-tlwg-loma-otf, fonts-unifont, fonts-wqy-zenhei, libasound2-data, libasound2t64 (written "LPGL-2.1+"; the text under it is the GNU Lesser General Public License, version 2.1 or later), libatk-bridge2.0-0t64, libatk1.0-0t64, libatspi2.0-0t64, libavahi-client3, libavahi-common-data, libavahi-common3, libcairo2, libdatrie1, libdbus-1-3 ("GPL-2+ or AFL-2.1", a choice), libelf1t64, libfribidi0, libglib2.0-0t64, libgraphite2-3 ("LGPL-2.1+ or MPL-1.1 or GPL-2+", a choice), libkeyutils1, libnspr4 (MPL-2.0), libnss3 (MPL-2.0), libpango-1.0-0, libsensors-config, libsensors5, libthai-data, libthai0.
- The 16 of the download stage: 13 and 3 (libkeyutils1, librtmp1, libssh-4). Read now for all 16; question 11 had only `libssh-4` ("LGPL-2.1+~OpenSSL") and `librtmp1` (library under the LGPL 2.1 or later), and both readings are confirmed from the downloaded files. `libssh-4`'s file also has two entries under the LGPL 2.1 with no "or later" (`include/libssh/curve25519.h` with `src/curve25519.c`, and `include/libssh/knownhosts.h`; lines 131-134 and 149-151 of `raw/ubuntu-copyright/libssh-4.copyright`).
- The seven `fonts-*` packages, main entries: fonts-freefont-ttf GPL-3+ (with "GPL-3+ with Special Font Exception"); fonts-ipafont-gothic IPA-1 for the fonts (`Files: *.ttf`), GPL-3+ for the packaging; fonts-liberation SIL-OFL-1.1 (and GPL-2+ named); fonts-noto-color-emoji Apache-2.0 (and SIL-1.1); fonts-tlwg-loma-otf GPL-2+ (and "GPL-2+ with Font exception", LPPL); fonts-unifont GPL-2+ (and GFDL-NIV); fonts-wqy-zenhei "GPL-2 with Font embedding exception and M+ FONTS License". Question 11's guess "GPL with a font exception, IPA and OFL" is borne out, with Apache-2.0, LPPL, GFDL and the M+ licence as well.
- Other copyleft-family names that appear: CC-BY-SA-3.0 (in `libglib2.0-0t64`), GFDL-NIV and GFDL-NIV-1.3 (fonts-unifont, libelf1t64), MPL-1.1 and MPL-2.0. Names not of those families but also not on the project's permitted list appear too (for example IPA-1, SIL-OFL-1.1, FTL, LPPL, Artistic); all are in the table.

**The base image `ubuntu:24.04`.** Its own package list is **not listed**: the 13 Nov measurement kept no list (`docs/SOURCES.md`, 13 Nov: "84 of 92 ... copyright files mention the GPL"; bash, coreutils, tar, grep and sed "say GPL-3+"), and this task did not pull or run the image again.

**`node:22-bookworm-slim`.** The runner's build file (`rb/Dockerfile` in that session's scratch folder, lines 19-20) copies two things from it: the Node program (`/usr/local/bin/node`) and **npm's whole folder** (`/usr/local/lib/node_modules/npm`), not the Node program only. npm there was 10.9.9 (build log line 56: "New major version of npm available! 10.9.9 -> 12.2.2"). Node's version there was not recorded. Node's notice was read from `node:22-alpine`'s copy (22.23.4); that it is the same file in the Debian-based image is *inferred*, true only if the version is the same. The runner also installs three npm packages (`playwright`, `@playwright/test` and `playwright-core`, 1.63.0); those are npm packages, for the project's npm licence check when 3.1 is built, and are not listed here.

## 3. The browser

**The zip.** Downloaded 13 Nov 2026 from `https://storage.googleapis.com/chrome-for-testing-public/153.0.8010.12/linux64/chrome-headless-shell-linux64.zip` (119,809,080 bytes); `sha256sum -c` against `a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d`: OK. Unpacked; its program `chrome-headless-shell` has SHA-256 `ded93a9c…`, as recorded on 13 Nov.

**`ABOUT`, verbatim** (248 bytes, SHA-256 `34d078ce3003087a8374e7c6156fda374769b8047d6ddaf419d66414aa48edfb`; also `raw/chrome-153.0.8010.12-ABOUT.txt`):

```
Google Chrome

Copyright 2026 Google LLC. All rights reserved.

Chrome is made possible by the Chromium open source project
(https://www.chromium.org/) and other open source software
(chrome://credits).

See the Terms of Service at chrome://terms.
```

**`LICENSE.headless_shell`** (42,329 lines, 2,257,005 bytes, SHA-256 `b92247f7a44c14627ef5cbbe0aa6dcca4e4422b7c05e6f2c660054061a5e3da7`; not copied into the repository because of its size; it can be taken again from the pinned zip). It is 295 sections, each a component's name between two lines of dashes followed by its notice (286 distinct names; a few appear twice). **No section carries a licence name as a field**, so the kinds of licence were found by matching each section's text against standard licence wording (the rules are in section 5), and the 9 sections that matched none were read by hand. A section can hold several licences. Index of all 295: `raw/chrome-licence-sections.tsv`.

**Kinds of licence wording, with the number of sections each appears in.** Matched (these are the matching rule's counts; the rule missed two kinds in the hyphenation-patterns section, found by hand and named in its row below: the CC BY 3.0 text of `hyph-nl.hyb`, which reads "Creative Commons, Attribution 3.0", with a comma (`LICENSE.headless_shell` line 13891), and the Unicode terms of `hyph-en-gb.hyb` and `hyph-hr.hyb` (their blocks begin at lines 12790 and 13058); with them, Creative Commons Attribution is in 3 sections and the Unicode licence in 28, and the total of 20 kinds and the copyleft figures do not change): Apache 2.0 135; MIT-style ("Permission is hereby granted, free of charge") 84; BSD-style ("Redistribution and use in source and binary forms") 66; Unicode licence 27; a public-domain statement 11; MPL 9; LGPL 6; GPL 3; Independent JPEG Group 3; zlib-style 2; Creative Commons Attribution 2 (CC BY 3.0 for one test image in Snappy, CC BY 4.0 in SPIRV-Headers); ISC-style 1; FreeType 1; CC0 1; Boost 1. Read by hand: ISC wording (d3; hmac-sha256, titled "ISC License"), "Old MIT" (harfbuzz, line 11752), "New BSD" (intl-messageformat, line 17113), the FFTPACK licence (PFFFT), SQLite's "The author disclaims copyright to this source code" (sqlite, line 31279), Sun's fdlibm notice (V8 fork of fdlibm), and Takuya Ooura's notice (two FFT sections). **That is 20 kinds**: the 15 matched (the 15 kinds in the index's families column besides "unmatched") and 5 found only by hand (Old MIT, FFTPACK, SQLite's disclaimer, Sun's fdlibm notice, Ooura's notice); the ISC wording and "New BSD" read by hand are kinds already matched. Versions are not counted separately in these figures; the copyleft table below gives the copyleft ones by version.

**Copyleft parts named, and which components carry them** (15 sections; each read by hand; line numbers are in `LICENSE.headless_shell`):

| Component (section line) | What its notice says | Copyleft licence named |
| --- | --- | --- |
| ffmpeg (8790) | "Most files in FFmpeg are under the GNU Lesser General Public License version 2.1 or later (LGPL v2.1+)" (8794-8795); optional GPL parts, quoted below; the LGPL 2.1 text follows (9285) | LGPL-2.1+; GPL-2+ for optional parts (one filter "GPL version 3 or later") |
| gtk (11265) | The full "GNU LIBRARY GENERAL PUBLIC LICENSE Version 2, June 1991" (11267) | LGPL-2.0 |
| hyphenation-patterns (12455) | One block per data file, 52 files, the same 52 as the zip's `hyphen-data` folder; 5 name copyleft licences (below); the others MIT, BSD, Unicode terms, public domain, CC BY 3.0 or a short free-use statement (`raw/chrome-hyphenation-files.tsv`) | MPL-1.1, MPL-2.0, LGPL-2.1, GPL-2+ (in 5 files) |
| icu (15341) | "File: aclocal.m4 (only for ICU4C)" (15806), GPL version 2 or later, and "File: config.guess (only for ICU4C)" (15841), GPL version 3 or later, each with an Autoconf exception | GPL-2+, GPL-3+ (two build files) |
| plasma-wayland-protocols (24166) | The full LGPL version 2.1 text (24169) | LGPL-2.1 |
| Speech Dispatcher (29616) | The full LGPL version 2.1 text (29618) | LGPL-2.1 |
| symphonia, symphonia-bundle-flac, symphonia-bundle-mp3, symphonia-codec-pcm, symphonia-codec-vorbis, symphonia-common, symphonia-core, symphonia-metadata (31999 to 34631, 8 sections) | The full "Mozilla Public License Version 2.0" text in each (32001, 32377, ...) | MPL-2.0 |
| WebKit (39736) | "(WebKit doesn't distribute an explicit license. This LICENSE is derived from license text in the source.)" (39738); BSD-style notices, then the full LGPL version 2 ("Library") text (39809) and version 2.1 text (40247) | LGPL-2.0, LGPL-2.1 |

The five hyphenation files: `hyph-hu.hyb` ("% Version: MPL 1.1/GPL 2.0/LGPL 2.1", 13102); `hyph-hy.hyb` (the LGPL 2.1 text); `hyph-lv.hyb` ("This file is available under any of the following licences, at your option:" LGPL 2.1, or GPL 2 "or_later", 13768); `hyph-ru.hyb` ("License:  GNU LGPL license.", 14311, with the LGPL 2.1 text); `hyph-sv.hyb` (the Mozilla Public License Version 2.0 text, 14897).

Not counted as copyleft, though the GPL is mentioned: two Steve Underwood sections (for example "Despite my general liking of the GPL, I place this code in the public domain", line 16655); jsoncpp ("The MIT license is compatible with both the GPL and commercial software"); and compiler-rt (4138), dragonbox (7399) and llvm-libc (20384), whose Apache 2.0 text carries the LLVM exception: "In addition, if you combine or link compiled forms of this Software with software that is licensed under the GPLv2 ("Combined Software")" (lines 4354-4355, 7611-7612, 20600-20601). That exception names the GPLv2 only as the licence of other software combined with these parts; it puts no part of them under the GPL. The AGPL is named only inside the MPL 2.0 text's own definition of "Secondary License".

**The FFmpeg GPL sentence, verbatim** (`LICENSE.headless_shell`, lines 8799-8802, the same in both copies):

```
8799  Some optional parts of FFmpeg are licensed under the GNU General Public License
8800  version 2 or later (GPL v2+). See the file `COPYING.GPLv2` for details. None of
8801  these parts are used by default, you have to explicitly pass `--enable-gpl` to
8802  configure to activate them. In this case, FFmpeg's license changes to GPL v2+.
```

Whether this build includes any of those parts was **not established**. A partial look, *inferred* and not a check: FFmpeg code is in the program (text such as "FFmpegDemuxer" appears in it), but none of the names of the GPL-only filters that the notice lists (boxblur, hqdn3d, removegrain, delogo, cropdetect, blackframe, mpdecimate, kerndeint) appears among the program's text, and "libavfilter" does not appear. The GPL x86 optimisation files the notice also lists would leave no such name. An engineer could settle it from Chromium's FFmpeg build settings for this version.

**The terms.** `ABOUT` says "See the Terms of Service at chrome://terms." `chrome://terms` is a page built into the browser, not a web address: `curl` answered `Protocol "chrome" not supported`, and showing the page would mean starting the browser, which is held while question 11 is open. The words "Terms of Service" do not appear in the program file or its three resource files (searched without running them). Google's web pages for Chrome's terms and Google's general terms, and Chrome for Testing's own pages, were each refused by the session's network proxy with `curl: (56) CONNECT tunnel failed, response 403`; **not read**. Chrome for Testing's repository README (read through `raw.githubusercontent.com`) does not contain the words "license", "terms" or "legal"; the repository's `LICENSE` file is the Apache License 2.0, and nothing read says whether it covers the browser builds the repository points to (not assumed). Exact attempts and answers: `raw/terms-fetch-attempts.txt`.

**The second copy, on the development machine** (`/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/`, files dated 27 Oct 2026). Its program `chrome-headless-shell.real` has SHA-256 `ea2a24583bb006c2cacc192750c9bd1e053c4fb291ae2186190eb459b115d94c` (the same size as the zip's, 197,422,408 bytes, a different fingerprint, as recorded on 13 Nov); it is started through a 198-byte wrapper script. **Its notices are identical to the zip's**: `ABOUT`, `LICENSE.headless_shell`, `deb.deps` and `rpm.deps` compare byte for byte, and so do all 286 files other than the program (fingerprint lists of both copies compared: no difference; `raw/chrome-two-copies-fingerprints.txt`). Why the program file differs is not known.

**Found in passing on the development machine, not named by question 11.** `/opt/pw-browsers` also holds a full Chromium build (`chromium-1243/chrome-linux64/chrome`, with no licence file at its top level) and Playwright's ffmpeg build (`ffmpeg-1011`, whose folder holds `COPYING.LGPLv2.1`). The full Chromium folder holds `WidevineCdm/LICENSE`, which says: "You may not use, modify, sell, or otherwise distribute the Software without a separate license agreement with Google. The Software is not open source software." As read, the builder's code does not use the full Chromium: its three scripts call `chromium.launch()` with no options, and Playwright 1.63.0 then picks `chromium-headless-shell` (`playwright-core/lib/coreBundle.js`, line 43375: `return options.headless ? "chromium-headless-shell" : "chromium";`, headless being Playwright's default). Not inventoried further.

## 4. Proposed handling: options for the owner, not decisions

### 4.1 Builder-only use (runs on the builder's machine, not shipped)

Covers: both sandbox images inside sandboxes; `ubuntu:24.04`, `node:22-bookworm-slim`, the 109 and the 16 Ubuntu packages, and the browser zip, in 3.1's runner; the development machine's browser copy for W1 and the host screenshots. In every option below, the runner's two base images, `ubuntu:24.04` and `node:22-bookworm-slim`, wait until they are read (`ubuntu:24.04`'s own package list and notices; `node:22-bookworm-slim`'s Node notice) and are then put to the owner again.

- (a) Approve for builder-only use everything else inventoried here, the two browser copies included. Each stays pinned: images by digest, the zip and the host copy by fingerprint, the Ubuntu packages by the version list in `raw/ubuntu-runner-packages.tsv`. This inventory is made again whenever a pin changes, and the change is shown to the owner first. The notices stay in `docs/licences/raw/`.
- (b) As (a) for the two sandbox images and the Ubuntu packages now; the two browser copies only after a lawyer has read Google's Terms of Service (4.3). 3.1 and W1 would then wait for that reading (3.1 also waits for question 12); W2 would not. This is question 11's option (a) in `docs/STATUS.md`.
- (c) Approve nothing yet: 3.1, W1 and W2 stay parked (question 11's option (c)).

Claude Code's suggestion, for the owner to accept or not: (b). Reason: of what (b) approves, what was read is: for the 119 Ubuntu packages, each copyright file; for Node, npm, yarn and corepack, their licence files; for PostgreSQL and gosu, their notices from published source; and for the 45 Alpine packages, only their licence names, since the images hold no notice texts for them (section 1). Not read, and so not approved by it: Google's Terms of Service, `ubuntu:24.04`'s own package list and notices, and `node:22-bookworm-slim`'s Node notice; no terms of Chrome for Testing's own were found. The outside review asked for the applicable notices before approval.

### 4.2 Delivered with apps (decided at package 3.2)

Covers: `node:22-alpine` as the base of every app; any database image an export's start file names (today the sandbox uses `postgres:16-alpine`); whether a copy may include a browser.

**What a customer's copy would carry** (read): with `node:22-alpine` as the base, the 19 packages above, Node.js with its 43 bundled parts, npm and its 195 bundled packages, yarn and corepack, plus the app. If an export names `postgres:16-alpine`, also its 44 packages, PostgreSQL and gosu. The images carry the licence names but not the GPL, LGPL or MPL texts themselves (section 1).

**What the notices say about passing copies on.** Quoted, not interpreted; which passage applies to which file, and what it means in practice, is for an engineer and a lawyer. The GPL, LGPL, MPL and Apache texts are quoted from the copies in `/usr/share/common-licenses/` on the development machine, because the images do not hold them.
- GPL version 2 (busybox, apk-tools and the other GPL-2.0 packages), section 1 (`GPL-2`, line 79): "keep intact all the notices that refer to this License and to the absence of any warranty; and give any other recipients of the Program a copy of this License along with the Program." Section 3 (line 134): "You may copy and distribute the Program (or a work based on it, under Section 2) in object code or executable form under the terms of Sections 1 and 2 above provided that you also do one of the following: a) Accompany it with the complete corresponding machine-readable source code ...; or, b) Accompany it with a written offer, valid for at least three years, to give any third party ... a complete machine-readable copy of the corresponding source code".
- GPL version 3 (bash, readline, gdbm in the database image), section 6 (`GPL-3`, line 245): "You may convey a covered work in object code form under the terms of sections 4 and 5, provided that you also convey the machine-readable Corresponding Source under the terms of this License, in one of these ways:".
- LGPL version 2.1 (libgcc, libstdc++ and others), section 6 (`LGPL-2.1`, line 278): "You must give prominent notice with each copy of the work that the Library is used in it and that the Library and its use are covered by this License. You must supply a copy of this License."
- MPL version 2.0 (ca-certificates-bundle), section 3.2 (`MPL-2.0`, line 172): "If You distribute Covered Software in Executable Form then: (a) such Covered Software must also be made available in Source Code Form, as described in Section 3.1, and You must inform recipients of the Executable Form how they can obtain a copy of such Source Code Form".
- Apache 2.0 (libssl3, libcrypto3, llvm21-libs, gosu), section 4 (`Apache-2.0`, line 95): "(a) You must give any other recipients of the Work or Derivative Works a copy of this License".
- Node.js (`raw/node-22.23.4-LICENSE.txt`, line 13): "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software."
- npm: "Licensed on the terms of The Artistic License 2.0" (its full text: `raw/npm-10.9.9-LICENSE.txt`).
- PostgreSQL (`raw/postgresql-16.15-COPYRIGHT.txt`, lines 8-11): "provided that the above copyright notice and this paragraph and the following two paragraphs appear in all copies."
- The browser, if a copy ever included it: Chromium's notice, lines 12-15 of `LICENSE.headless_shell`: "Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution"; and the copyleft sections above.

**Options, to be put at 3.2** (none decided here):
- (a) Keep `node:22-alpine` as the base, and deliver with each app a notices file and whatever source offer an engineer and a lawyer say the quoted texts call for.
- (b) Choose a different, smaller base for delivered apps, inventoried the same way before it is used.
- (c) Deliver no image: the app's source and its build file only; the customer's own build would then fetch the base image itself. Whether that changes anything about notices is for a lawyer.
- For the browser: (i) a delivered copy never includes a browser; (ii) decide only after the terms are read.

### 4.3 What was not read, and who should read it before approval

- **Google's Terms of Service** that `ABOUT` points to (`chrome://terms`): not read (section 3). A lawyer, before the browser is approved. The proxy refused the web pages; reading them needs another route, or the owner opening them himself.
- **Chrome for Testing's own terms**: none found; its project pages were refused. A lawyer to confirm whether any apply.
- **Whether this browser build includes FFmpeg's GPL parts**: not established. An engineer.
- **Why the development machine's browser program differs from the zip's**: not known. An engineer.
- **`ubuntu:24.04`'s own package list and notices**: not listed or read. Claude Code, before the image is put to the owner (4.1).
- **`node:22-bookworm-slim`'s Node notice**: not read from that image; that it matches `node:22-alpine`'s copy is inferred (section 2). Claude Code, before the image is put to the owner (4.1).
- **The 45 Alpine packages' own notices**: the two sandbox images hold none, and only the packages' licence names were read (section 1). An engineer or a lawyer, if the names alone are not enough for approval; at the latest at package 3.2, for what a customer would receive.
- **Whether the full Chromium and Playwright's ffmpeg build on the development machine stay in the cloud environment** (found in passing, section 3; not part of question 11; Widevine's notice there says "The Software is not open source software"). An engineer.
- **Which installed files each Debian licence name covers**: not worked out (section 2). An engineer, only if the runner image were ever delivered (not planned).
- **The official Playwright image** `mcr.microsoft.com/playwright:v1.63.0-noble` (Ubuntu 24.04, Node 24, and Playwright's own Chromium, Firefox and WebKit builds), pulled and run on 13 Nov to compare routes for 3.1's design (`docs/SOURCES.md`, 13 Nov): not inventoried, and not proposed for use. Whether Playwright's Firefox and WebKit carry parts like the Chromium build's was not read (known gap 61). If it were ever proposed, it would be inventoried the same way first.
- Docker's own licence (the design note's open item) is not part of this inventory and stays open.

## 5. The raw files (`docs/licences/raw/`)

| File | What it holds |
| --- | --- |
| `node-22-alpine-image-inspect.txt`, `postgres-16-alpine-image-inspect.txt` | Each image's digest, creation date, platform and settings, from `docker image inspect` |
| `node-22-alpine-apk-installed.txt`, `postgres-16-alpine-apk-installed.txt` | Each image's package list, as read from `/lib/apk/db/installed`, with apk's `m:` lines removed (19 and 44: each package maintainer's name and email address, which are not part of any licence notice); no other line was changed. SHA-256 of each file as read from the image, before that removal: `ee15cef2304459e59c4a475c8202804fe2ad54171fcf75a99f3aa3267684641f` (node) and `af1be6395c8850e28ddc34c3de8839c47de7aee1611380fa75c380cb9f75a72f` (postgres) |
| `node-22-alpine-packages.tsv`, `postgres-16-alpine-packages.tsv` | The same, one line per package: name, version, licence as written, origin |
| `node-22.23.4-LICENSE.txt`, `npm-10.9.9-LICENSE.txt`, `corepack-0.36.0-LICENSE.txt`, `yarn-1.22.22-LICENSE.txt` | The four licence files in `node:22-alpine` |
| `npm-10.9.9-bundled-packages.tsv` | npm's 195 bundled packages with the licence each declares |
| `postgresql-16.15-COPYRIGHT.txt`, `gosu-1.19-LICENSE.txt` | The two notices read from published source, since the database image holds none |
| `ubuntu-runner-packages.tsv` | The 119 Ubuntu packages: version, list, source, licence names, main entry, copyleft names, fingerprint of the copyright file, stored file |
| `ubuntu-copyright/` | The 84 distinct copyright texts, each stored whole, as shipped, so that its SHA-256 matches the table's; each under the package whose downloaded file name (`ubuntu-debs-sha256.txt`) comes first in byte order among those that carry it (for fontconfig's text, shared by `fontconfig`, `fontconfig-config` and `libfontconfig1`, that is `fontconfig-config.copyright`). Being whole, they keep their authors' names and email addresses, which are part of the copyright notices, and also some `Upstream-Contact` or `Maintainer` lines and "debianized by" or "packaged by" lines with addresses, which are packaging metadata, kept only because the files are stored whole |
| `ubuntu-debs-sha256.txt` | Fingerprints of the 119 downloaded package files |
| `chrome-153.0.8010.12-ABOUT.txt` | The browser's `ABOUT`, as in the zip |
| `chrome-licence-sections.tsv` | The 295 sections of `LICENSE.headless_shell`: name, line, length, wording matched |
| `chrome-copyleft-wording.tsv` | The copyleft wording matched, per section |
| `chrome-hyphenation-files.tsv` | The 52 hyphenation data files and the licence statements in each block |
| `chrome-two-copies-fingerprints.txt` | Both copies' program fingerprints and every other file's fingerprint (identical in both) |
| `terms-fetch-attempts.txt` | Each attempt to read the terms, with the exact answer |

**Method for the browser's sections** (the matching rules; text matching, not a legal reading): a section counts for a kind when its text, with spaces, comment marks and the MPL 2.0 text's own "Secondary License" definition removed, contains: Apache "apache license" and "version 2.0"; MIT-style "permission is hereby granted, free of charge, to any person obtaining a copy"; BSD-style "redistribution and use in source and binary forms"; LGPL the full text headings ("gnu lesser general public license version 2.1, february 1999", "gnu library general public license version 2, june 1991") or "lgpl", "gnu lesser general public", "gnu library general public"; GPL "terms of", "licensed under" or "available under" followed by "the gnu general public license", or "(gpl v2+)", or "name: gpl"; MPL "mozilla public license version 1.1" or "version 2.0"; and similar fixed phrases for the others. The 9 sections that matched nothing, and every copyleft section, were then read by hand.

## 6. Read or measured, and inferred

**Read or measured on 13 Nov 2026:** both images' digests and package lists (for each package, its licence name or names); the four licence files in `node:22-alpine` and the absence of any licence file in `postgres:16-alpine`; npm's bundled packages' declared licences; PostgreSQL's and gosu's notices from their published source; the 119 Ubuntu packages at their build-log versions and their copyright files; the zip's fingerprint, `ABOUT` and `LICENSE.headless_shell`, and its 295 sections; that both browser copies' notices and every other file are identical; the proxy's refusals; the Widevine notice; Playwright's choice of the headless shell in its code.

**Inferred, not checked:** that `node:22-bookworm-slim`'s Node notice is the same as `node:22-alpine`'s; the hint about FFmpeg's GPL parts; that the full Chromium on the machine is unused (read from the code, not watched in a run).

**Not worked out:** which installed files each licence name in a Debian copyright file covers.

**Not read:** Google's Terms of Service; any Chrome for Testing terms; `ubuntu:24.04`'s package list and notices; Node's notice in `node:22-bookworm-slim`; the 45 Alpine packages' own notices (the images hold none).

**Not inventoried:** the official Playwright image `mcr.microsoft.com/playwright:v1.63.0-noble`, with Playwright's Firefox and WebKit builds, pulled and run on 13 Nov to compare routes for 3.1's design; not proposed for use (section 4.3).

## 7. How to repeat it

From the machine, with the images on it and no new pull:
- `docker image inspect <image>`; `docker run --rm --network none --entrypoint cat <image> /lib/apk/db/installed`, keeping the `P:`, `V:` and `L:` lines (to compare the whole file with the stored copy, use the SHA-256 in section 5, or drop the `m:` lines first).
- For each Ubuntu package: `apt-get download <package>=<version>` (with a separate package index), then `dpkg-deb --fsys-tarfile <file>.deb | tar -xO ./usr/share/doc/<package>/copyright`.
- The zip: `curl -o hs.zip <address>`, `sha256sum -c` against `a9da0288…`, `unzip`, then compare with `cmp` and `sha256sum` against `/opt/pw-browsers/...`.

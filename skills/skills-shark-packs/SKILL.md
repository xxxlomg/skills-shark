---

name: skills-shark-packs
description: "Skill Packs workflow in SkillsShark: bundle selected skills into a shareable .skillpack, export it, import one from a local zip or Git URL, and install packs into the scanned library。当a user asks about packing, sharing, importing, or installing skills时使用。"
metadata:
  skills_shark:
    emoji: "📦"
---


# Skill Packs: Package, Share, Install

A **Skill Pack** (`.skillpack`) bundles related skills into one shareable file. It is the distribution unit of the SkillsShark platform: pack skills once, send the file, and any SkillsShark user can import and install it.

## Pack Anatomy1

A `.skillpack` is a zip with an ecosystem-native layout:

```
my-pack.skillpack
├─ pack.json      # machine-readable manifest — the single source of truth
├─ README.md      # generated pack overview (rendered in the Pack detail page)
└─ skills/<name>/ # original skill folders, unchanged (SKILL.md + resources)
```

Because `skills/` keeps the native layout, anyone can unpack and use the folders with any AI tool — the pack layer is additive.

## Create a Pack

1. In the library, enter **multi-select mode** and check the skills to bundle.
2. Click **Pack** to open the dialog: fill **name** (required), **version**, **author**, then confirm the selection (searchable list, select-all available).
3. SkillsShark builds the pack: manifest with per-file SHA-256 checksums, plus an auto-generated `README.md` catalog.
4. The pack registers in the **Packs** tab; the canonical copy lives in `%AppData%\Skills Shark\packs\<id>\`.

## Export

Packs tab → **Export** → choose a save location (defaults to the packs folder). The exported `.skillpack` is self-contained — send it however you like. Exported copies are independent of the library copy.

## Import

Two entry points, both with a safe **preview before commit**:

- **Local file**: Import → choose a `.zip` / `.skillpack`.
- **Git URL**: paste a repository URL; the archive is fetched and inspected.

Routing rules:

- Archive **contains `pack.json`** → imported as a **Pack**: checksums are verified, unsupported future format versions are rejected with a clear *please upgrade* error. It appears in the **Packs** tab only — not yet in your scanned library.
- **No `pack.json`** → treated as loose skills: nested folders are flattened, name collisions are auto-renamed, then skills land directly in the **Imported** library.

Oversized archives (too many entries, total size, or nesting depth) are rejected during preview.

## Install a Pack

Packs tab → select a pack → **Install**: its `skills/*` folders are copied into the **Imported** library (collisions auto-renamed) and immediately become part of your scanned, searchable, translatable collection. Packs stay the distribution unit; the Imported library is where skills actually run.

## Delete

Packs tab → **Delete** removes the pack from the library (with confirmation). Installed skills in the Imported library are not affected.

## Roadmap (not yet in this version)

- **i18n sidecar**: shipping translations inside the pack so receivers get bilingual content out of the box.
- **AI-generated pack summaries**: LLM-written overview instead of the static catalog.

# brand/ — 产品品牌素材位

产品名:**SkillsShark(技能鲨)**。
mark 语汇:实心剪影鲨 —— navy(≈`#0A1A33`)单色实心、浅冷底(`#F7F8FA`)。
概念:鲨 = 敏锐、精准、快。2026-08-03 先定稿 #18 线稿鲨(已归档
`cleanup-2026-08-03/line-brand/`),同日换为用户提供的 512×512 实心剪影定稿
(原件 `shark-src-512.png`,来源 `D:\download\ChatGPT Image 2026年8月3日 17_50_25.png`)。

## 文件(生成管线,按序执行)

- `shark-src-512.png` — 用户定稿源图(512×512,浅底实心鲨)
- `make_brand2.py` — 键出透明底 `shark-alpha.png`、统一底色 `shark-tile.png`(512)、`shark-src-1024.png`
- `make_svg2.py` — 用 tile 内嵌 base64 重建 `public/favicon.svg` 与 `src-tauri/icons/icon.svg`

```bash
# frontend/ 下:
python src/assets/brand/make_brand2.py
npx tauri icon src/assets/brand/shark-src-1024.png
python src/assets/brand/make_svg2.py
```

## 落地触点清单(替换时逐一核对)

| 触点 | 位置 | 状态 |
|---|---|---|
| 窗口/产品名 | `src-tauri/tauri.conf.json` → `productName`、`app.windows[0].title` | ✅ SkillsShark |
| 页面标题 | `index.html` → `<title>`、splash `.sp-title` | ✅ SkillsShark · 技能鲨 |
| favicon | `public/favicon.svg`(内嵌 tile) | ✅ 实心鲨 |
| 顶栏 logo 块 | `src/components/layout/Topbar.tsx`(浅底鲨 tile + SkillsShark) | ✅ |
| splash logo | `index.html` → `.sp-logo-wrap img`(引用 `shark-tile.png`) | ✅ |
| 页脚 | `src/components/layout/Footer.tsx` | ✅ |
| 应用图标全尺寸 | `src-tauri/icons/**`(由 `shark-src-1024.png` 生成) | ✅ |
| UI accent | `src/index.css` 四色预设(设置页可换) | 与品牌解耦,用户自选 |

**注意:数据目录与 identifier 解耦** —— `config.rs` 固定使用 `Roaming\Skills Shark`（`DATA_DIR_NAME`），不随 identifier 变化；identifier 已于 v0.1.0 首发前更正为 `com.skills-shark.desktop`（不以 `.app` 结尾，避免 macOS 约定冲突）。

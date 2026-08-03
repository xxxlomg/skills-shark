# -*- coding: utf-8 -*-
"""SkillsShark 品牌资产生成（实心鲨版）。

源：shark-src-512.png（用户定稿 512×512，浅底 navy 实心剪影）。
产出：
  - shark-tile.png   统一浅冷底 tile（顶栏 / splash / favicon 嵌入源）
  - shark-alpha.png  透明底鲨（备用）
  - shark-src-1024.png  tauri icon 源
"""
from PIL import Image

SRC = "shark-src-512.png"
BG = (247, 248, 250, 255)  # 与旧品牌一致的浅冷底

src = Image.open(SRC).convert("RGBA")
w, h = src.size
corners = [src.getpixel((0, 0)), src.getpixel((w - 1, 0)),
           src.getpixel((0, h - 1)), src.getpixel((w - 1, h - 1))]
print("corners:", corners)
bg = corners[0][:3]

# 背景键出为透明（与背景色距离小的像素视为底）
alpha = src.copy()
px = alpha.load()
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) < 24:
            px[x, y] = (0, 0, 0, 0)
alpha.save("shark-alpha.png")

# 统一底色 tile
tile = Image.new("RGBA", (w, h), BG)
tile.paste(alpha, (0, 0), alpha)
tile.save("shark-tile.png")

# tauri icon 源 1024
tile.resize((1024, 1024), Image.LANCZOS).save("shark-src-1024.png")
print("done")

# -*- coding: utf-8 -*-
"""用 shark-tile.png 内嵌 base64 重建 favicon.svg 与 tauri icon.svg。"""
import base64
from pathlib import Path

here = Path(__file__).resolve().parent
png = (here / "shark-tile.png").read_bytes()
b64 = base64.b64encode(png).decode()
svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" '
       'viewBox="0 0 512 512"><image width="512" height="512" '
       f'href="data:image/png;base64,{b64}"/></svg>\n')

# brand → assets → src → frontend
frontend = here.parent.parent.parent
targets = [
    frontend / "public" / "favicon.svg",
    frontend / "src-tauri" / "icons" / "icon.svg",
]
for t in targets:
    t.resolve().write_text(svg, encoding="utf-8")
    print("wrote", t.resolve())
print("done")

"""Generate standalone static tool detail pages under tools/."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "catalog.js"
OUTPUT_DIR = ROOT / "tools"

TOOL_PATTERN = re.compile(r'\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)"', re.MULTILINE)


def load_tools() -> list[tuple[str, str]]:
    raw = DATA_FILE.read_text(encoding="utf-8")
    return TOOL_PATTERN.findall(raw)


def render_page(tool_id: str, tool_name: str) -> str:
    title = f"{tool_name} | Northstar AI"
    description = f"Static decision page for {tool_name} in the Northstar AI Directory."
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <meta name="description" content="{description}">
  <meta name="theme-color" content="#f3f4f6">
  <link rel="icon" type="image/svg+xml" href="../favicon.svg">
  <link rel="stylesheet" href="../styles.css">
</head>
<body data-tool-id="{tool_id}" data-detail-mode="static" data-home-href="../index.html" data-directory-href="../index.html#directory" data-asset-prefix="../">
  <div class="page-glow glow-a"></div>
  <div class="page-glow glow-b"></div>

  <header class="topbar detail-topbar">
    <div class="brand">
      <div class="brand-badge">N</div>
      <div class="brand-copy">
        <strong>Northstar AI</strong>
        <span>WESTERN AI NAVIGATOR</span>
      </div>
    </div>

    <nav class="topnav" aria-label="Primary">
      <a href="../index.html">Home</a>
      <a href="../index.html#search-hub">Search Hub</a>
      <a href="../index.html#hot-tools">Live Tools</a>
      <a href="../index.html#today-hot">Today's Hot</a>
      <a href="../index.html#prompt-zone">Prompt Library</a>
      <a href="../index.html#directory">Directory</a>
    </nav>

    <a class="icon-button detail-home-button" href="../index.html" aria-label="Back to home">&#8962;</a>
  </header>

  <main class="detail-page">
    <section class="detail-hero glass" id="detail-hero"></section>

    <section class="detail-layout">
      <div class="detail-main">
        <section class="section-card detail-section" id="detail-overview"></section>
        <section class="section-card detail-section" id="detail-strengths"></section>
        <section class="section-card detail-section" id="detail-pricing"></section>
        <section class="section-card detail-section" id="detail-compare"></section>
      </div>

      <aside class="detail-side">
        <section class="section-card detail-section" id="detail-fit"></section>
        <section class="section-card detail-section" id="detail-decision"></section>
        <section class="section-card detail-section" id="detail-sources"></section>
      </aside>
    </section>

    <section class="section-card detail-section" id="detail-similar"></section>
  </main>

  <footer class="footer">
    <p>Northstar AI Directory</p>
    <p>Decision-ready tool profiles for Western users choosing among mainstream AI products.</p>
  </footer>

  <script src="../catalog.js"></script>
  <script src="../detail.js"></script>
</body>
</html>
"""


def main() -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)
    tools = load_tools()
    for tool_id, tool_name in tools:
        output_path = OUTPUT_DIR / f"{tool_id}.html"
        output_path.write_text(render_page(tool_id, tool_name), encoding="utf-8")
    print(f"Generated {len(tools)} static tool pages in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()

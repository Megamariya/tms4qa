// Minimal self-contained Markdown → HTML renderer (no external dependency).
// Supports: headers, bold/italic, inline code, code blocks, blockquotes,
// unordered/ordered lists, tables (GFM pipe syntax), links, horizontal rules,
// paragraphs.
// Input is HTML-escaped before any markup is applied, so the result is safe
// to use with dangerouslySetInnerHTML.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Takes RAW (unescaped) markdown text, escapes it, then applies inline markup.
function inlineFmt(raw: string): string {
  return escapeHtml(raw)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/(^|[^\w])_([^_]+)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
      const safeUrl = /^(https?:|mailto:)/i.test(url) ? url : "#";
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });
}

// Splits a `| a | b |` row into raw (unescaped) cell strings.
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function isSeparatorRow(line: string): boolean {
  if (!line.includes("-") || !line.includes("|")) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}

function cellAlign(sep: string | undefined): "left" | "center" | "right" | null {
  if (!sep) return null;
  const left = sep.startsWith(":");
  const right = sep.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

export function renderMarkdown(src: string): string {
  if (!src) return "";
  // Structural markers (#, >, -, etc.) are matched on the RAW line — escaping
  // happens per-fragment in inlineFmt/escapeHtml, otherwise ">" would already
  // be "&gt;" by the time the blockquote check runs.
  const lines = src.split(/\r?\n/);

  let html = "";
  let inList: "ul" | "ol" | null = null;
  let inCode = false;
  let codeBuf: string[] = [];
  let paraBuf: string[] = [];

  const closeList = () => {
    if (inList) { html += `</${inList}>`; inList = null; }
  };
  const flushPara = () => {
    if (paraBuf.length) {
      html += `<p>${inlineFmt(paraBuf.join(" "))}</p>`;
      paraBuf = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      if (inCode) {
        html += `<pre><code>${codeBuf.join("\n")}</code></pre>`;
        codeBuf = [];
        inCode = false;
      } else {
        flushPara();
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(escapeHtml(line)); continue; }

    if (!line.trim()) { flushPara(); closeList(); continue; }

    // GFM table: a row containing "|" immediately followed by a separator row.
    if (line.includes("|") && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      flushPara();
      closeList();
      const headerCells = splitTableRow(line);
      const aligns = splitTableRow(lines[i + 1]).map(cellAlign);
      const bodyRows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim() && lines[j].includes("|")) {
        bodyRows.push(splitTableRow(lines[j]));
        j++;
      }

      html += "<div class=\"md-table-wrap\"><table><thead><tr>";
      headerCells.forEach((c, idx) => {
        const align = aligns[idx];
        html += `<th${align ? ` style="text-align:${align}"` : ""}>${inlineFmt(c)}</th>`;
      });
      html += "</tr></thead><tbody>";
      for (const row of bodyRows) {
        html += "<tr>";
        headerCells.forEach((_c, idx) => {
          const align = aligns[idx];
          html += `<td${align ? ` style="text-align:${align}"` : ""}>${inlineFmt(row[idx] ?? "")}</td>`;
        });
        html += "</tr>";
      }
      html += "</tbody></table></div>";

      i = j - 1;
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      const level = h[1].length;
      html += `<h${level}>${inlineFmt(h[2])}</h${level}>`;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line.trim())) {
      flushPara();
      closeList();
      html += "<hr/>";
      continue;
    }

    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      flushPara();
      closeList();
      html += `<blockquote>${inlineFmt(bq[1])}</blockquote>`;
      continue;
    }

    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (inList !== "ul") { closeList(); html += "<ul>"; inList = "ul"; }
      html += `<li>${inlineFmt(ul[1])}</li>`;
      continue;
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      flushPara();
      if (inList !== "ol") { closeList(); html += "<ol>"; inList = "ol"; }
      html += `<li>${inlineFmt(ol[1])}</li>`;
      continue;
    }

    closeList();
    paraBuf.push(line.trim());
  }

  flushPara();
  closeList();
  if (inCode && codeBuf.length) html += `<pre><code>${codeBuf.join("\n")}</code></pre>`;

  return html;
}

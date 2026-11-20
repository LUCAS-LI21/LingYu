"""把 docs/初赛/src/*.md 构建成符合《初赛提交资料要求》的 Word 文档。

格式要点（来自要求文档）：
- 首页：项目名称（宋体加粗三号居中）、文档名称（宋体加粗四号居中）、队伍人员/报名序号（宋体四号居中）
- 第二页：目录（引用方式生成，小四，1–2 级，1.5 倍行距）
- 第三页起正文，页码从 1 开始
- 一级标题宋体小四加粗，二级标题宋体五号加粗，三级标题与正文宋体五号，1.5 倍行距
- 表格：标题在表上方居中；图：标题在图下方居中

用法：
    python scripts/build_initial_docs.py            # 构建三份 + 估算页数
"""
import math
import os
import re
import sys

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "初赛", "src")
OUT = os.path.join(ROOT, "docs", "初赛")

SONG = "宋体"
MONO = "Consolas"
BODY_PT = 10.5  # 五号
H1_PT = 12.0  # 小四
COVER_LARGE = 16.0  # 三号
COVER_MID = 14.0  # 四号

BODY_W_CM = 15.5
PAGE_H_CM = 24.6  # A4 减上下页边距
LINE_CM = BODY_PT * 1.5 / 28.35  # 1.5 倍行距下每行高度


# ---------------------------------------------------------------- 基础工具
def set_font(run, name=SONG, size=BODY_PT, bold=False, color=None):
    run.font.name = name
    run.font.size = Pt(size)
    run.bold = bold
    if color:
        run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        rfonts.set(qn(attr), name)
    for attr in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
        if rfonts.get(qn(attr)) is not None:
            del rfonts.attrib[qn(attr)]


def first_line_indent_chars(paragraph, chars=2, size=BODY_PT):
    """中文首行缩进按字符数设置（w:firstLineChars），字号变化时仍然对齐。"""
    ppr = paragraph._p.get_or_add_pPr()
    ind = ppr.find(qn("w:ind"))
    if ind is None:
        ind = OxmlElement("w:ind")
        ppr.append(ind)
    ind.set(qn("w:firstLineChars"), str(chars * 100))
    ind.set(qn("w:firstLine"), str(int(chars * size * 20)))


def add_field(paragraph, instr):
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr_el = OxmlElement("w:instrText")
    instr_el.set(qn("xml:space"), "preserve")
    instr_el.text = instr
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_begin)
    run._r.append(instr_el)
    run._r.append(fld_sep)
    run._r.append(fld_end)
    return run


def shade(cell, fill):
    tcpr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tcpr.append(shd)


def cell_margins(table, left=0.10, right=0.10, top=0.03, bottom=0.03):
    tblpr = table._tbl.tblPr
    mar = OxmlElement("w:tblCellMar")
    for tag, val in (("w:top", top), ("w:left", left), ("w:bottom", bottom), ("w:right", right)):
        node = OxmlElement(tag)
        node.set(qn("w:w"), str(int(val * 567)))
        node.set(qn("w:type"), "dxa")
        mar.append(node)
    tblpr.append(mar)


# ---------------------------------------------------------------- Markdown 解析
def parse_markdown(text):
    lines = text.replace("\r\n", "\n").split("\n")
    meta = {}
    i = 0
    if lines and lines[0].strip() == "---":
        i = 1
        while i < len(lines) and lines[i].strip() != "---":
            if ":" in lines[i]:
                k, v = lines[i].split(":", 1)
                meta[k.strip()] = v.strip()
            i += 1
        i += 1

    blocks = []
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped.startswith("```"):
            buf = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            blocks.append(("code", "\n".join(buf)))
            continue
        m = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if m:
            level = len(m.group(1))
            blocks.append((f"h{level}", m.group(2).strip()))
            i += 1
            continue
        if stripped.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                raw = lines[i].strip()
                if not re.match(r"^\|[\s:\-|]+\|$", raw):
                    cells = [c.strip() for c in raw.strip("|").split("|")]
                    rows.append(cells)
                i += 1
            blocks.append(("table", rows))
            continue
        if stripped.startswith("!["):
            m = re.match(r"^!\[(.*?)\]\((.*?)\)$", stripped)
            if m:
                blocks.append(("img", (m.group(1), m.group(2))))
                i += 1
                continue
        if re.match(r"^[-*]\s+", stripped):
            items = []
            while i < len(lines) and re.match(r"^[-*]\s+", lines[i].strip()):
                items.append(re.sub(r"^[-*]\s+", "", lines[i].strip()))
                i += 1
            blocks.append(("ul", items))
            continue
        if re.match(r"^\d+\.\s+", stripped):
            items = []
            while i < len(lines) and re.match(r"^\d+\.\s+", lines[i].strip()):
                items.append(re.sub(r"^\d+\.\s+", "", lines[i].strip()))
                i += 1
            blocks.append(("ol", items))
            continue
        # 普通段落
        buf = [stripped]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(
            r"^(#{1,4}\s|\||!\[|[-*]\s|\d+\.\s|```)", lines[i].strip()
        ):
            buf.append(lines[i].strip())
            i += 1
        blocks.append(("p", "".join(buf)))
    return meta, blocks


INLINE = re.compile(r"(\*\*.+?\*\*|`.+?`)")


def add_inline(paragraph, text, size=BODY_PT, bold_default=False):
    pos = 0
    for m in INLINE.finditer(text):
        if m.start() > pos:
            run = paragraph.add_run(text[pos : m.start()])
            set_font(run, SONG, size, bold_default)
        token = m.group(0)
        if token.startswith("**"):
            run = paragraph.add_run(token[2:-2])
            set_font(run, SONG, size, True)
        else:
            run = paragraph.add_run(token[1:-1])
            set_font(run, MONO, size - 0.5, False)
        pos = m.end()
    if pos < len(text):
        run = paragraph.add_run(text[pos:])
        set_font(run, SONG, size, bold_default)


# ---------------------------------------------------------------- 文档骨架
def setup_styles(doc):
    normal = doc.styles["Normal"]
    normal.font.name = SONG
    normal.font.size = Pt(BODY_PT)
    rpr = normal.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        rfonts.set(qn(attr), SONG)
    for attr in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
        if rfonts.get(qn(attr)) is not None:
            del rfonts.attrib[qn(attr)]
    normal.paragraph_format.line_spacing = 1.5
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(0)

    specs = {1: (H1_PT, True, 7, 3), 2: (BODY_PT, True, 5, 2), 3: (BODY_PT, False, 4, 2), 4: (BODY_PT, False, 3, 1)}
    for level, (size, bold, before, after) in specs.items():
        st = doc.styles[f"Heading {level}"]
        st.font.name = SONG
        st.font.size = Pt(size)
        st.font.bold = bold
        st.font.color.rgb = RGBColor(0, 0, 0)
        srpr = st.element.get_or_add_rPr()
        srf = srpr.find(qn("w:rFonts"))
        if srf is None:
            srf = OxmlElement("w:rFonts")
            srpr.append(srf)
        for attr in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
            srf.set(qn(attr), SONG)
        for attr in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
            if srf.get(qn(attr)) is not None:
                del srf.attrib[qn(attr)]
        pf = st.paragraph_format
        pf.space_before = Pt(before)
        pf.space_after = Pt(after)
        pf.line_spacing = 1.5
        pf.keep_with_next = True


def setup_page(doc):
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.top_margin = Cm(2.54)
    sec.bottom_margin = Cm(2.54)
    sec.left_margin = Cm(2.75)
    sec.right_margin = Cm(2.75)


def add_cover(doc, meta):
    for _ in range(6):
        p = doc.add_paragraph()
        p.paragraph_format.line_spacing = 1.5
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(title.add_run(meta.get("title", "")), SONG, COVER_LARGE, True)

    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(18)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(p.add_run(meta.get("doc", "")), SONG, COVER_MID, True)

    for key in ("team", "regno"):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(30)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        label = "队伍人员：" if key == "team" else "报名序号："
        set_font(p.add_run(label + meta.get(key, "待填写")), SONG, COVER_MID, False)

    # 分页
    from docx.enum.text import WD_BREAK

    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def add_toc(doc, entries=None):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(p.add_run("目　　录"), SONG, H1_PT, True)

    # 域开始 + 域代码 + separate 放在第一段，随后是可被 Word 重新生成的条目
    holder = doc.add_paragraph()
    holder.paragraph_format.line_spacing = 1.5
    run = holder.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = 'TOC \\o "1-2" \\h \\z \\u'
    sep = OxmlElement("w:fldChar")
    sep.set(qn("w:fldCharType"), "separate")
    run._r.append(begin)
    run._r.append(instr)
    run._r.append(sep)

    toc_pt = 11.0 if len(entries or []) > 30 else H1_PT

    if entries:
        for level, text, page in entries:
            item = doc.add_paragraph()
            pf = item.paragraph_format
            pf.line_spacing = 1.5
            pf.left_indent = Cm(0 if level == 1 else 0.62)
            pf.space_before = Pt(0)
            pf.space_after = Pt(0)
            pf.tab_stops.add_tab_stop(Cm(BODY_W_CM), 2, 1)
            r1 = item.add_run(text)
            set_font(r1, SONG, toc_pt, level == 1)
            r2 = item.add_run("\t" + str(page))
            set_font(r2, SONG, toc_pt, False)
        end_p = doc.paragraphs[-1]
    else:
        note = doc.add_paragraph()
        note.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_font(note.add_run("（目录域，打开文档时自动更新）"), SONG, BODY_PT, False)
        end_p = note

    end_run = end_p.add_run()
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    end_run._r.append(end)


def start_body_section(doc):
    sec = doc.add_section(WD_SECTION.NEW_PAGE)
    # 页码从 1 开始
    sectpr = sec._sectPr
    pg = sectpr.find(qn("w:pgNumType"))
    if pg is None:
        pg = OxmlElement("w:pgNumType")
        sectpr.append(pg)
    pg.set(qn("w:start"), "1")

    footer = sec.footer
    footer.is_linked_to_previous = False
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = add_field(p, "PAGE")
    set_font(run, SONG, 9)


def enable_update_fields(doc):
    settings = doc.settings.element
    update = OxmlElement("w:updateFields")
    update.set(qn("w:val"), "true")
    settings.append(update)


# ---------------------------------------------------------------- 内容渲染
CAPTION_RE = re.compile(r"^(表|图)\s*\d+")


def add_caption(doc, text, space_before=3, space_after=2, keep_next=False):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    pf = p.paragraph_format
    pf.space_before = Pt(space_before)
    pf.space_after = Pt(space_after)
    pf.line_spacing = 1.5
    pf.keep_with_next = keep_next
    set_font(p.add_run(text), SONG, BODY_PT, True)
    return p


def add_table(doc, rows):
    cols = max(len(r) for r in rows)
    rows = [r + [""] * (cols - len(r)) for r in rows]
    size = 9.5

    table = doc.add_table(rows=len(rows), cols=cols)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    cell_margins(table)

    def disp(s):
        # 中文按 2 个宽度计，避免中文列被算窄
        return sum(2 if ord(ch) > 127 else 1 for ch in s)

    weights = []
    for c in range(cols):
        longest = max(disp(re.sub(r"[`*]", "", r[c])) for r in rows)
        weights.append(min(max(longest, 6), 46))
    total = sum(weights)
    widths = [BODY_W_CM * w / total for w in weights]
    widths = [max(w, 1.25) for w in widths]
    scale = BODY_W_CM / sum(widths)
    widths = [w * scale for w in widths]

    for ri, row in enumerate(rows):
        tr = table.rows[ri]
        for ci, text in enumerate(row):
            cell = tr.cells[ci]
            cell.width = Cm(widths[ci])
            p = cell.paragraphs[0]
            p.paragraph_format.line_spacing = 1.0
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.space_after = Pt(1)
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER if (ri == 0 or ci == 0 or len(text) <= 6) else WD_ALIGN_PARAGRAPH.LEFT
            add_inline(p, text, size=size, bold_default=(ri == 0))
            if ri == 0:
                shade(cell, "EDF1F7")
        if ri == 0:
            trpr = tr._tr.get_or_add_trPr()
            header = OxmlElement("w:tblHeader")
            trpr.append(header)

    for c in range(cols):
        table.columns[c].width = Cm(widths[c])

    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_after = Pt(0)
    spacer.paragraph_format.line_spacing = 1.0
    set_font(spacer.add_run(""), SONG, 4)


def add_code(doc, text):
    for line in text.split("\n"):
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.line_spacing = 1.0
        pf.space_before = Pt(2)
        pf.space_after = Pt(2)
        pf.left_indent = Cm(0.3)
        ppr = p._p.get_or_add_pPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), "F4F6F8")
        ppr.append(shd)
        set_font(p.add_run(line if line else " "), MONO, 9)


def add_body(doc, blocks):
    first_h1 = True
    for kind, payload in blocks:
        if kind == "h1":
            if not first_h1:
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(0)
                p.paragraph_format.space_after = Pt(0)
            first_h1 = False
            doc.add_heading(payload, level=1)
        elif kind == "h2":
            doc.add_heading(payload, level=2)
        elif kind == "h3":
            doc.add_heading(payload, level=3)
        elif kind == "h4":
            doc.add_heading(payload, level=4)
        elif kind == "p":
            if CAPTION_RE.match(payload):
                if payload.startswith("表"):
                    add_caption(doc, payload, keep_next=True)
                else:
                    add_caption(doc, payload, space_before=3)
                continue
            p = doc.add_paragraph()
            p.paragraph_format.line_spacing = 1.5
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            first_line_indent_chars(p, 2)
            add_inline(p, payload)
        elif kind == "ul":
            for item in payload:
                p = doc.add_paragraph()
                p.paragraph_format.line_spacing = 1.5
                p.paragraph_format.left_indent = Cm(0.74)
                p.paragraph_format.first_line_indent = Cm(-0.37)
                add_inline(p, "· " + item)
        elif kind == "ol":
            for idx, item in enumerate(payload, 1):
                p = doc.add_paragraph()
                p.paragraph_format.line_spacing = 1.5
                p.paragraph_format.left_indent = Cm(0.74)
                p.paragraph_format.first_line_indent = Cm(-0.37)
                add_inline(p, f"{idx}. " + item)
        elif kind == "table":
            add_table(doc, payload)
        elif kind == "img":
            alt, path = payload
            full = os.path.join(ROOT, "docs", "初赛", path) if not os.path.isabs(path) else path
            if not os.path.exists(full):
                print(f"  ! 缺图 {full}")
                continue
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(6)
            p.paragraph_format.space_after = Pt(2)
            p.add_run().add_picture(full, width=Cm(12.0))
            add_caption(doc, alt, space_before=2, space_after=6)
        elif kind == "code":
            add_code(doc, payload)


# ---------------------------------------------------------------- 页数估算
def estimate_pages(blocks):
    cm = 0.0
    chars_per_line = 41
    for kind, payload in blocks:
        if kind in ("h1", "h2", "h3", "h4"):
            cm += LINE_CM * 1.2 + 0.5
        elif kind == "p":
            cm += max(1, math.ceil(len(payload) / chars_per_line)) * LINE_CM
        elif kind in ("ul", "ol"):
            for item in payload:
                cm += max(1, math.ceil((len(item) + 2) / (chars_per_line - 2))) * LINE_CM
        elif kind == "table":
            for ri, row in enumerate(payload):
                text = "".join(row)
                per_row = max(1, math.ceil(len(text) / 34))
                cm += per_row * 0.42 + 0.28
        elif kind == "img":
            from PIL import Image

            full = os.path.join(ROOT, "docs", "初赛", payload[1])
            with Image.open(full) as im:
                w, h = im.size
            cm += 12.0 * h / w + 1.2
        elif kind == "code":
            cm += payload.count("\n") * 0.36 + 0.4
    return cm / PAGE_H_CM


# ---------------------------------------------------------------- 主流程
DOCS = [
    ("01-需求分析.md", "01_需求分析.docx", "01"),
    ("02-原型设计.md", "02_原型设计.docx", "02"),
    ("03-数据库设计.md", "03_数据库设计.docx", "03"),
    ("04-接口设计.md", "04_接口设计.docx", "04"),
    ("05-初步验证.md", "05_初步验证.docx", "05"),
    ("设计文档（精简版）.md", "设计文档（精简版）.docx", "design"),
    ("可行性分析.md", "可行性分析.docx", "feasibility"),
]


def toc_entries_from(meta_pages, blocks):
    """把「标题 → 页码」映射整理成目录条目（仅 1–2 级标题）。"""
    entries = []
    for kind, payload in blocks:
        if kind in ("h1", "h2"):
            level = int(kind[1])
            page = meta_pages.get(payload)
            if page:
                entries.append((level, payload, page))
    return entries


def build(md_name, out_name, toc_entries=None, quiet=False):
    src = os.path.join(SRC, md_name)
    with open(src, encoding="utf-8") as f:
        meta, blocks = parse_markdown(f.read())

    doc = Document()
    setup_page(doc)
    setup_styles(doc)
    add_cover(doc, meta)
    add_toc(doc, toc_entries)
    start_body_section(doc)
    add_body(doc, blocks)
    enable_update_fields(doc)

    out = os.path.join(OUT, out_name)
    doc.save(out)
    if not quiet:
        pages = estimate_pages(blocks)
        print(f"  -> {out_name}  估算正文 {pages:.1f} 页（含封面/目录约 {pages + 2:.1f} 页）")
    return blocks


def detect_body_start(pdf_path, blocks):
    """正文第一页在 PDF 里的页码（1-based）：目录页里的条目带点线，不会与标题行完全相等。"""
    import pdfplumber

    norm = lambda s: re.sub(r"\s+", "", s)
    first_h1 = next((p for k, p in blocks if k == "h1"), None)
    if not first_h1:
        return 3
    target = norm(first_h1)
    with pdfplumber.open(pdf_path) as pdf:
        for idx, page in enumerate(pdf.pages, 1):
            lines = [norm(l) for l in (page.extract_text() or "").split("\n")]
            if target in lines:
                return idx
    return 3


def extract_heading_pages(pdf_path, blocks, offset):
    """从 PDF 里找出每个一二级标题落在正文第几页；offset = 正文首页之前的前置页数。"""
    import pdfplumber

    norm = lambda s: re.sub(r"\s+", "", s)
    wanted = {norm(p): (k, p) for k, p in blocks if k in ("h1", "h2")}
    found = {}
    with pdfplumber.open(pdf_path) as pdf:
        for idx, page in enumerate(pdf.pages, 1):
            text = page.extract_text() or ""
            for line in text.split("\n"):
                key = norm(line)
                hit = key if key in wanted else None
                if hit is None:
                    # 标题可能与后文粘在同一行，做前缀容错
                    for cand in wanted:
                        if key.startswith(cand) and len(key) <= len(cand) + 8:
                            hit = cand
                            break
                if hit and hit not in found:
                    page_no = idx - offset + 1
                    if page_no >= 1:
                        found[hit] = page_no
    return {wanted[k][1]: v for k, v in found.items()}


def cmd_extract():
    import json

    mapping = {}
    for md, _, key in DOCS:
        pdf = os.path.join(OUT, "build", f"{key}.pdf")
        with open(os.path.join(SRC, md), encoding="utf-8") as f:
            _, blocks = parse_markdown(f.read())
        if not os.path.exists(pdf):
            print(f"  ! 缺少 {pdf}")
            continue
        offset = detect_body_start(pdf, blocks)
        mapping[key] = extract_heading_pages(pdf, blocks, offset)
        print(f"  {key}: 正文起始 PDF 第 {offset} 页，识别 {len(mapping[key])} 个标题页码")
    os.makedirs(os.path.join(OUT, "build"), exist_ok=True)
    with open(os.path.join(OUT, "build", "toc-pages.json"), "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)


def cmd_build(with_toc=False):
    import json

    pages = {}
    if with_toc:
        path = os.path.join(OUT, "build", "toc-pages.json")
        with open(path, encoding="utf-8") as f:
            pages = json.load(f)
    print("构建初赛文档：" + ("（写入目录页码）" if with_toc else ""))
    for md, out, key in DOCS:
        entries = None
        if with_toc:
            with open(os.path.join(SRC, md), encoding="utf-8") as f:
                _, blocks = parse_markdown(f.read())
            entries = toc_entries_from(pages.get(key, {}), blocks)
        build(md, out, entries)


if __name__ == "__main__":
    sys.path.insert(0, ROOT)
    if "--extract" in sys.argv:
        cmd_extract()
    else:
        cmd_build(with_toc="--with-toc" in sys.argv)

"""生成初赛提交清单（Excel），按《初赛提交资料要求》的表格规范。

列：序号 / 提交文档名 / 内容简介；表头居中、序号与文档名居中、内容简介左对齐并自动换行、全表加边框。
"""
import os

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, Side
from openpyxl.utils import get_column_letter

OUT = os.path.join("docs", "初赛", "00_提交清单.xlsx")

ROWS = [
    ("00_提交清单", "本文件。列出全部提交物、格式与内容概要，便于评审核对。"),
    (
        "01_设计文档（精简版）",
        "不超过 10 页。含系统总体架构图、业务闭环流程图、核心接口定义（20 个接口清单 + 4 个关键接口的请求/响应）、关键表结构（17 张表清单与 poi_bank、poi_community、feedback、poi_version 等字段）。",
    ),
    (
        "02_可行性分析",
        "从技术、数据、时间三个维度论证可行性：技术栈成熟度与已跑通的关键路径、数据源授权与字段覆盖率、距 12 月 20 日的分阶段排期；另附主要难点与应对预案。",
    ),
    (
        "03_初步验证",
        "关键路径的可复现证据：20 个接口快照（20/20）、32 项接口验收（32/32）、数据库落库与字段覆盖率、三条闭环的真实链路记录、AI 抽取样例、Docker 独立部署与离线降级截图。",
    ),
    (
        "证据快照（附带）",
        "assets/evidence-snapshot.json 与 .md：脚本逐接口取证原始结果；assets/ 下另有架构图、闭环图、ER 图与三张界面截图。",
    ),
    (
        "可复现脚本（附带）",
        "scripts/evidence-snapshot.mjs（接口取证）、scripts/full-acceptance.mjs（32 项验收）、scripts/build_initial_docs.py（文档构建）。",
    ),
]

HEADERS = ("序号", "提交文档名", "内容简介")


def main():
    wb = Workbook()
    ws = wb.active
    ws.title = "提交清单"

    thin = Side(style="thin", color="000000")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    ws.merge_cells("A1:C1")
    title = ws["A1"]
    title.value = "邻域 POI 情报系统 · 初赛提交清单"
    title.font = Font(name="宋体", size=14, bold=True)
    title.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 30

    for col, text in enumerate(HEADERS, 1):
        cell = ws.cell(row=2, column=col, value=text)
        cell.font = Font(name="宋体", size=11, bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border
    ws.row_dimensions[2].height = 22

    for idx, (name, desc) in enumerate(ROWS, 1):
        r = idx + 2
        c1 = ws.cell(row=r, column=1, value=idx)
        c1.alignment = Alignment(horizontal="center", vertical="center")
        c2 = ws.cell(row=r, column=2, value=name)
        c2.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c3 = ws.cell(row=r, column=3, value=desc)
        c3.alignment = Alignment(horizontal="justify", vertical="center", wrap_text=True)
        for c in (c1, c2, c3):
            c.font = Font(name="宋体", size=10.5)
            c.border = border
        ws.row_dimensions[r].height = 58

    ws.column_dimensions["A"].width = 8
    ws.column_dimensions[get_column_letter(2)].width = 26
    ws.column_dimensions[get_column_letter(3)].width = 88

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    wb.save(OUT)
    print(f"written {OUT}")


if __name__ == "__main__":
    main()

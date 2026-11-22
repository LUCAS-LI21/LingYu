"""生成初赛提交清单（Excel），按《初赛提交资料要求》的表格规范。

列：序号 / 提交文档名 / 内容简介；表头居中、序号与文档名居中、内容简介左对齐并自动换行、全表加边框。
"""
import os

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, Side
from openpyxl.utils import get_column_letter

OUT = os.path.join("docs", "preliminary", "00-submission-checklist.xlsx")

ROWS = [
    ("00-submission-checklist", "本文件。列出全部提交物、格式与内容概要，便于评审核对。"),
    (
        "01-requirements-analysis",
        "需求理解（约 600 字）、题目要求对应的 18 项功能清单、8 项新增功能、2 张核心流程图（业务闭环、采集入库）。",
    ),
    (
        "02-prototype-design",
        "14 个界面的清单与内容说明，附地图、待定位网点、离线降级三张部署环境截图。",
    ),
    (
        "03-database-design",
        "17 张表/视图的清单与关系、逐表字段说明（字段名/类型/中文名/解释）、建表 SQL 与迁移机制。",
    ),
    (
        "04-api-design",
        "44 个接口清单，21 节接口详情（路由、方法、参数、涉及表、返回示例），公共约定与错误码。",
    ),
    (
        "05-initial-validation",
        "13 项验证清单与结果：接口快照 20/20、接口验收 32/32、落库与覆盖率、三条闭环实测、AI 抽取样例、部署与降级截图。",
    ),
    (
        "design-document-condensed",
        "赛题要求的精简版设计文档，不超过 10 页：系统架构图、业务闭环流程图、核心接口定义、关键表结构。",
    ),
    (
        "feasibility-analysis",
        "技术 / 数据 / 时间三维度论证，附主要难点与应对预案。",
    ),
    (
        "06-other（仓库与演示）",
        "仓库已含 Codespaces 配置、CI 与 MIT LICENSE；README 顶部 OWNER/REPO 占位需替换为实际仓库地址。演示视频待录制。",
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

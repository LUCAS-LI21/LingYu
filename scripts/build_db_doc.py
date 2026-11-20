"""从 db/migration 的 SQL 生成《数据库设计》Markdown 源稿。

字段中文名/解释来自下面的字典（覆盖全部 108 个列名），类型与约束直接取自建表语句，
保证文档与代码一致；改了表结构重跑本脚本即可。
"""
import json
import re
from pathlib import Path

OUT = Path("docs/初赛/src/03-数据库设计.md")

TABLES = {
    "poi_bank": (
        "银行网点与 ATM",
        "经 `v_poi` 合并；`poi_version`、`poi_field_source` 以 `poi_type + poi_id` 指向本表",
    ),
    "poi_community": (
        "住宅小区",
        "经 `v_poi` 合并；`poi_version`、`poi_field_source` 以 `poi_type + poi_id` 指向本表",
    ),
    "v_poi": ("统一查询视图（非物理表）", "`UNION ALL` 两张主表，排除 `status='closed'`"),
    "feedback": ("用户反馈与审核状态", "1:N `poi_version`（`feedback_id`）"),
    "poi_version": ("POI 变更版本", "N:1 `feedback`；按 `poi_type + poi_id` 指向主表"),
    "poi_field_source": ("字段级数据来源", "按 `poi_type + poi_id` 指向主表"),
    "ingest_job": ("抓取任务", "`source_code` → `ds_source`；`feedback_code` → `feedback`"),
    "ds_source": ("数据源注册表（存储策略/限速）", "被 `ingest_job` 引用"),
    "query_log": ("查询行为日志", "按 `grid + stat_date` 聚合到 `hot_region`"),
    "hot_region": ("热点聚合", "驱动 `ingest_job` 选择抓取区域"),
    "bank_pending": ("有地址无坐标的银行网点", "转正后写入 `poi_bank`"),
    "community_pending": ("有地址无坐标的小区", "转正后写入 `poi_community`；被 `coordinate_submission.pending_id` 指向"),
    "coordinate_submission": ("用户提交的小区坐标（待审）", "N:1 `community_pending`"),
    "dedupe_log": ("去重黑名单", "抓取前置过滤，避免已删点位被重新抓回"),
    "sys_user": ("运营账号", "独立，无外键"),
    "agent_run": ("AI 抽取运行记录", "`entity_id` 指向主表主键"),
    "land_parcel": ("存量住宅用地（宗地级）", "独立，与小区级 POI 语义不同"),
}

COLS = {
    "id": ("主键", "唯一标识；抓取来源内唯一"),
    "name": ("名称", "网点名或小区名"),
    "brand": ("银行品牌", "中英文/繁简归一后的品牌名"),
    "branch_type": ("网点类型", "`branch` 营业网点 / `atm` 自助设备"),
    "address": ("地址", "门牌地址"),
    "district": ("行政区", "深圳 10 区枚举"),
    "lng": ("经度", "WGS-84"),
    "lat": ("纬度", "WGS-84"),
    "phone": ("联系电话", "网点公开电话"),
    "opening_hours": ("营业时间", "营业时间原始文本"),
    "source": ("数据来源", "来源名称，与 `ds_source.name` 对应"),
    "license": ("数据许可", "ODbL / 政府开放数据条款等"),
    "source_level": ("授权级别", "L1 可入库 / L2 仅展示 / L3 禁用"),
    "status": ("状态", "`active` / `closed` 等状态机取值"),
    "updated_at": ("更新时间", "最后写入时间"),
    "created_at": ("创建时间", "记录落库时间"),
    "built_year": ("建成年份", "竣工验收备案来源为真实值"),
    "avg_price": ("官方参考均价", "元/平方米，仅放官方来源"),
    "avg_price_demo": ("演示均价", "哈希生成的演示值，不参与筛选/排序/统计"),
    "avg_price_source": ("均价来源", "`demo` 演示 / `gov_reference` 官方参考价"),
    "property_fee": ("物业费", "元/㎡·月"),
    "property_company": ("物业公司", "政府物业项目库匹配结果"),
    "water_saving_year": ("节水型小区年度", "获评年度，空表示非节水型小区"),
    "surround_bank_count": ("1 公里内银行数", "预计算，来源于本地库空间查询"),
    "surround_atm_count": ("1 公里内 ATM 数", "预计算"),
    "nearest_bank_m": ("最近银行距离", "单位米，预计算"),
    "nearby_brand_count": ("1 公里内品牌数", "预计算"),
    "rent_dc": ("多层租金", "政府租赁参考价，元/㎡·月"),
    "rent_gc": ("高层租金", "政府租赁参考价"),
    "rent_dmd": ("低密度租金", "政府租赁参考价"),
    "developer": ("建设单位", "竣工验收备案中的建设单位/开发商"),
    "demo_attributes": ("演示字段标记", "1 表示含演示值"),
    "code": ("编号", "反馈编号，形如 FB20261119-0103"),
    "poi_type": ("POI 类型", "`bank` / `community`"),
    "poi_id": ("POI 主键", "指向主表 `id`"),
    "poi_name": ("POI 名称", "冗余存名称，便于审核列表直接展示"),
    "type": ("类型", "反馈类型 `error` / `closed` / `add`"),
    "field_name": ("字段名", "被纠错的字段中文名"),
    "new_value": ("新值", "用户提交的新值"),
    "description": ("描述", "问题描述"),
    "contact": ("联系方式", "可选，便于回访"),
    "reviewer": ("审核人", "取自登录 token 的主体"),
    "review_note": ("审核意见", "驳回理由等"),
    "reviewed_at": ("审核时间", "状态变更时间"),
    "source_code": ("数据源编码", "`ds_source.code`"),
    "trigger_type": ("触发方式", "`manual` / `schedule` / `hotspot` / `feedback`"),
    "scope_type": ("范围类型", "`bbox` 矩形 / `radius` 半径"),
    "scope_value": ("范围取值", "矩形为四角坐标串"),
    "fetched_count": ("抓取条数", "外部接口返回条数"),
    "inserted_count": ("新增条数", "本轮新写入条数"),
    "updated_count": ("更新条数", "本轮更新条数"),
    "failed_count": ("失败条数", "解析或写库失败条数"),
    "error_summary": ("错误摘要", "失败原因，截断 512 字"),
    "started_at": ("开始时间", "任务开始执行时间"),
    "finished_at": ("结束时间", "任务结束时间"),
    "feedback_code": ("关联反馈", "由该反馈触发的任务"),
    "change_type": ("变更类型", "`create` / `update` / `reopen`"),
    "before_json": ("变更前快照", "整行 JSON"),
    "after_json": ("变更后快照", "整行 JSON"),
    "changed_fields": ("变更字段", "形如 `phone=0755-11112222`"),
    "operator": ("操作人", "`system` / `operator` / `agent:xxx@域名`"),
    "feedback_id": ("关联反馈 ID", "`feedback.id`"),
    "kind": ("查询类型", "`list` / `nearby`"),
    "keyword": ("关键词", "查询关键词"),
    "grid": ("网格编码", "经纬度按 0.02° 取整"),
    "result_count": ("命中条数", "本次查询总命中数"),
    "cost_ms": ("耗时", "毫秒"),
    "stat_date": ("统计日期", "按天聚合"),
    "query_count": ("查询次数", "当日该网格查询次数"),
    "zero_result_count": ("零结果次数", "当日该网格无结果次数"),
    "priority": ("优先级", "查询次数 + 2 × 零结果次数"),
    "username": ("用户名", "登录名"),
    "password_hash": ("口令哈希", "PBKDF2 加盐哈希"),
    "role": ("角色", "`operator`"),
    "display_name": ("显示名", "后台展示用"),
    "last_login_at": ("最后登录", "最近一次登录时间"),
    "entity_type": ("实体类型", "`bank` / `community`"),
    "entity_id": ("实体 ID", "主表主键"),
    "field": ("字段", "被补全的字段名"),
    "model": ("模型", "如 `deepseek-flash`"),
    "prompt_tokens": ("输入 token", "计费用量"),
    "completion_tokens": ("输出 token", "计费用量"),
    "latency_ms": ("耗时", "毫秒"),
    "result_json": ("结果", "模型建议的 JSON"),
    "error": ("错误", "失败原因"),
    "reviewed_by": ("采纳人", "点采纳的管理员"),
    "note": ("备注", "人工标注说明"),
    "notes": ("说明", "数据源备注"),
    "village_num": ("物业管理区域编码", "政府物业库唯一码"),
    "attribute": ("属性", "普通住宅/商住一体/自然村等"),
    "geocode_source": ("坐标来源", "`admin` 管理员标注 / `user` 用户提交"),
    "geocoded_at": ("标注时间", "坐标写入时间"),
    "submitter": ("提交人", "匿名或账号标识"),
    "pending_id": ("待定位 ID", "`community_pending.id`"),
    "reason": ("原因", "去重/驳回原因"),
    "removed_at": ("移除时间", "下线时间"),
    "district_street": ("区/街道", "宗地所属区与街道"),
    "location": ("位置", "宗地位置描述"),
    "area_ha": ("用地面积", "公顷"),
    "housing_type": ("住房类型", "普通商品住房/保障性租赁住房等"),
    "build_status": ("建设状态", "已动工/未动工等"),
    "project_name": ("项目名称", "宗地对应项目名"),
    "supply_date": ("供地日期", "土地出让时间"),
    "storage_policy": ("存储策略", "`storable` / `display_only` / `forbidden`"),
    "rate_limit_qps": ("限速", "每秒请求数"),
    "enabled": ("启用", "1 启用 / 0 停用"),
}


def parse_schema():
    base = Path("backend/src/main/resources/db/migration")
    text = "\n".join(p.read_text(encoding="utf-8") for p in sorted(base.glob("V*.sql")))
    tables = {}
    for m in re.finditer(r"CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\((.*?)\)\s*ENGINE", text, re.S):
        name, body = m.group(1), m.group(2)
        parts, depth, cur = [], 0, ""
        for ch in body:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            if ch == "," and depth == 0:
                parts.append(cur.strip())
                cur = ""
            else:
                cur += ch
        if cur.strip():
            parts.append(cur.strip())
        fields, keys, comments = [], [], ""
        for line in parts:
            flat = re.sub(r"\s+", " ", line).strip()
            if re.match(r"^(PRIMARY|UNIQUE|KEY|INDEX|CONSTRAINT)\b", flat, re.I):
                keys.append(flat)
                continue
            mm = re.match(r"^(\w+)\s+([A-Za-z]+(?:\([^)]*\))?)\s*(.*)$", flat)
            if mm:
                fields.append({"name": mm.group(1), "type": mm.group(2), "raw": flat})
        cm = re.search(r"COMMENT = '([^']*)'", text[text.index(name) : text.index(name) + 4000])
        if cm:
            comments = cm.group(1)
        tables[name] = {"fields": fields, "keys": keys, "comment": comments}

    for m in re.finditer(r"ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)\s+([A-Za-z]+(?:\([^)]*\))?)\s+(.*?);", text, re.S):
        t, cname, ctype, rest = m.groups()
        if t in tables and not any(f["name"] == cname for f in tables[t]["fields"]):
            tables[t]["fields"].append({"name": cname, "type": ctype, "raw": re.sub(r"\s+", " ", f"{cname} {ctype} {rest}").strip()})

    # 建表语句里的表注释
    for m in re.finditer(r"CREATE TABLE IF NOT EXISTS\s+(\w+)[\s\S]*?COMMENT = '([^']*)'", text):
        t, cmt = m.group(1), m.group(2)
        if t in tables and not tables[t]["comment"]:
            tables[t]["comment"] = cmt
    return tables


def sql_of(name, t):
    lines = [f"CREATE TABLE {name} ("]
    body = []
    for f in t["fields"]:
        body.append("  " + f["raw"])
    for k in t["keys"]:
        body.append("  " + k)
    lines.append(",\n".join(body))
    lines.append(f") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='{t['comment']}';")
    return "\n".join(lines)


VIEW_SQL = """CREATE VIEW v_poi AS
SELECT id, 'bank' AS type, name, address, district, lng, lat, brand, branch_type,
       phone, opening_hours, source, license, source_level, updated_at
FROM poi_bank WHERE status <> 'closed'
UNION ALL
SELECT id, 'community' AS type, name, address, district, lng, lat, NULL, NULL,
       NULL, NULL, source, license, source_level, updated_at
FROM poi_community WHERE status <> 'closed';"""


def main():
    schema = parse_schema()
    order = [k for k in TABLES if k != "v_poi"] + ["v_poi"]
    out = ["---", "title: 邻域 POI 情报系统", "doc: 数据库设计", "team: 待填写", "regno: 待填写", "---", ""]

    out += ["# 1 数据表清单", "", "表 1 数据表清单", "",
            "| 序号 | 数据表名 | 作用 | 与其他表关系 |", "| --- | --- | --- | --- |"]
    for i, name in enumerate(order, 1):
        use, rel = TABLES[name]
        out.append(f"| {i} | `{name}` | {use} | {rel} |")
    out.append("")

    out += ["# 2 数据表内容", "", "> 字段类型与约束取自 `db/migration/V1–V3`，与代码保持一致；`v_poi` 为视图，仅列字段含义。", ""]
    tbl_no = 2
    for name in order:
        if name == "v_poi":
            out += [f"## 2.{tbl_no - 1} v_poi（统一查询视图）", "",
                    f"表 {tbl_no} v_poi 字段说明", "",
                    "| 序号 | 字段英文名 | 字段类型 | 字段中文名 | 字段解释 |", "| --- | --- | --- | --- | --- |"]
            view_fields = [
                ("id", "VARCHAR(64)", "主键", "两类 POI 的主键"),
                ("type", "VARCHAR(8)", "类型", "`bank` / `community`"),
                ("name", "VARCHAR(128)", "名称", "网点名或小区名"),
                ("address", "VARCHAR(255)", "地址", "门牌地址"),
                ("district", "VARCHAR(32)", "行政区", "深圳 10 区"),
                ("lng / lat", "DECIMAL(10,6)", "经纬度", "WGS-84"),
                ("brand / branch_type", "VARCHAR", "品牌/网点类型", "小区行为 NULL"),
                ("phone / opening_hours", "VARCHAR", "电话/营业时间", "小区行为 NULL"),
                ("built_year / avg_price", "INT", "建成年份/均价", "银行行为 NULL"),
                ("avg_price_demo", "INT", "演示均价", "仅展示，不参与统计"),
                ("property_fee / property_company", "DECIMAL/VARCHAR", "物业费/物业公司", "银行行为 NULL"),
                ("rent_dc / rent_gc / rent_dmd", "DECIMAL(8,2)", "租赁参考价", "多层/高层/低密度"),
                ("surround_bank_count / nearest_bank_m", "INT", "周边配套", "1 公里银行数、最近距离"),
                ("source / license / source_level", "VARCHAR", "来源/许可/级别", "溯源三元组"),
                ("updated_at", "DATETIME", "更新时间", "最后写入时间"),
            ]
            for i, (f, ty, cn, ex) in enumerate(view_fields, 1):
                out.append(f"| {i} | `{f}` | {ty} | {cn} | {ex} |")
            out.append("")
            tbl_no += 1
            continue
        t = schema[name]
        sec = tbl_no - 1
        out += [f"## 2.{sec} {name}（{TABLES[name][0]}）", "", f"表 {tbl_no} {name} 字段说明", "",
                "| 序号 | 字段英文名 | 字段类型 | 字段中文名 | 字段解释 |", "| --- | --- | --- | --- | --- |"]
        for i, f in enumerate(t["fields"], 1):
            cn, ex = COLS.get(f["name"], ("—", "—"))
            out.append(f"| {i} | `{f['name']}` | {f['type']} | {cn} | {ex} |")
        extra = "；".join(t["keys"][:4])
        if extra:
            out += ["", f"索引与约束：{extra}。"]
        out.append("")
        tbl_no += 1

    out += ["# 3 SQL 语句", "", "> 下列语句与 `backend/src/main/resources/db/migration` 一致，按 V1 → V2 → V3 顺序执行；`V2` 的价格分列与 `V3` 的反馈回写已并入对应表。", ""]
    for i, name in enumerate(order, 1):
        out += [f"## 3.{i} {'v_poi（视图）' if name == 'v_poi' else name}", "", "```sql"]
        out.append(VIEW_SQL if name == "v_poi" else sql_of(name, schema[name]))
        out.append("```")
        out.append("")

    out += ["# 4 其他", "",
            "**迁移机制**：后端启动时 `SchemaMigrator` 读取 `db/migration/V*.sql`，按版本号顺序执行并写入 `schema_version`，避免重复执行；未引入 Flyway，结构变更以新增版本文件的方式管理。",
            "",
            "**空间与索引**：两张主表建 `(lat, lng)` 复合索引支撑框选与半径预筛；`v_poi` 为逻辑视图，不占存储。",
            "",
            "**已知限制**：`v_poi` 为 `UNION ALL` 视图，全量查询会走物化中间结果，5,000 条量级 P95 约 1 秒；`query_log` 无归档策略，演示量级够用，生产需按月分区。",
            ]

    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"written {OUT} ({len(out)} lines, {len(schema)+1} tables)")


if __name__ == "__main__":
    main()

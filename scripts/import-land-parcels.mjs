/**
 * 导入「存量住宅用地」（政府开放数据 29200/00303565，608 条）。
 *
 * 说明：这是**宗地级**数据（宗地号/土地面积/供地时间/建设单位），不是小区级，
 * 因此单独存 land_parcel 表，不混进 poi_community，也不在 POI 地图上展示。
 * 价值：答辩时能说明"我们还接入了土地供应侧数据"，也可用于后续按宗地号关联小区。
 *
 * 用法：SZ_KEY=... node scripts/import-land-parcels.mjs  → 生成 data/land-parcel.sql
 *       然后 mysql --default-character-set=utf8mb4 poi_intel < data/land-parcel.sql
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { curlJson } from './lib/http.mjs'

const KEY = process.env.SZ_KEY
if (!KEY) throw new Error('缺少 SZ_KEY')

const esc = (v) =>
  String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .trim()

/** "Fri Oct 29 00:00:00 CST 2021" → "2021-10-29" */
function toDate(value) {
  const text = String(value || '')
  const m = text.match(/([A-Z][a-z]{2}) (\d{2}) \d{2}:\d{2}:\d{2} CST (\d{4})/)
  if (!m) return null
  const months = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
  }
  return `${m[3]}-${months[m[1]] ?? '01'}-${m[2]}`
}

console.log('拉取存量住宅用地…')
const rows = []
for (let page = 1; page <= 3; page++) {
  const body = curlJson(
    `https://opendata.sz.gov.cn/api/29200_00303565/1/service.xhtml?page=${page}&rows=300&appKey=${KEY}`,
  )
  const list = body.data || []
  rows.push(...list)
  if (list.length < 300) break
  await new Promise((r) => setTimeout(r, 700))
}
console.log(`拿到 ${rows.length} 条`)

const values = rows
  .filter((r) => r.ZDH && String(r.ZDH).trim())
  .map((r) => {
    const area = Number(r.TDMJ)
    return `('${esc(r.ZDH)}', '${esc(r.SZQHJD)}', '${esc(r.JTWZ)}', ${Number.isFinite(area) ? area : 'NULL'}, '${esc(r.ZFLX)}', '${esc(r.JSZT)}', '${esc(r.KFQY)}', '${esc(r.XMMC === '-' ? '' : r.XMMC)}', ${toDate(r.GDSJ) ? `'${toDate(r.GDSJ)}'` : 'NULL'})`
  })

const sql = `-- 存量住宅用地（宗地级），来源：深圳市政府数据开放平台 29200/00303565
INSERT INTO land_parcel (id, district_street, location, area_ha, housing_type, build_status, developer, project_name, supply_date)
VALUES
${values.join(',\n')}
ON DUPLICATE KEY UPDATE
  district_street = VALUES(district_street), location = VALUES(location), area_ha = VALUES(area_ha),
  housing_type = VALUES(housing_type), build_status = VALUES(build_status), developer = VALUES(developer),
  project_name = VALUES(project_name), supply_date = VALUES(supply_date);
`
mkdirSync('data', { recursive: true })
writeFileSync('data/land-parcel.sql', sql, 'utf8')
console.log(`已生成 data/land-parcel.sql，共 ${values.length} 条宗地`)

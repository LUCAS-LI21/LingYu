const { number } = require('./format')

function str(value) {
  return value === null || value === undefined ? '' : String(value)
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** 后端 snake/驼峰混合字段统一成小程序内部结构 */
function normalizePoi(row) {
  if (!row) return null
  const base = {
    id: str(row.id),
    type: row.type === 'community' ? 'community' : 'bank',
    name: str(row.name) || '未命名点位',
    address: str(row.address),
    district: str(row.district),
    lng: number(row.lng),
    lat: number(row.lat),
    gcjLng: nullableNumber(row.gcjLng),
    gcjLat: nullableNumber(row.gcjLat),
    source: str(row.source) || 'OpenStreetMap',
    license: str(row.license),
    sourceLevel: str(row.sourceLevel) || 'L1',
    demoAttributes: Boolean(row.demoAttributes),
  }

  if (base.type === 'community') {
    return Object.assign(base, {
      builtYear: nullableNumber(row.builtYear),
      avgPrice: nullableNumber(row.avgPrice),
      propertyFee: nullableNumber(row.propertyFee),
      propertyCompany: str(row.propertyCompany),
      waterSavingYear: nullableNumber(row.waterSavingYear),
      surroundBankCount: number(row.surroundBankCount),
      surroundAtmCount: number(row.surroundAtmCount),
      nearbyBrandCount: number(row.nearbyBrandCount),
      nearestBankM: number(row.nearestBankM),
    })
  }

  return Object.assign(base, {
    brand: str(row.brand),
    branchType: row.branchType === 'atm' ? 'atm' : 'branch',
    phone: str(row.phone),
    openingHours: str(row.openingHours),
  })
}

function normalizePoiList(rows) {
  return (rows || []).map(normalizePoi).filter(Boolean)
}

function normalizePending(row) {
  return {
    id: str(row.id),
    name: str(row.name) || '未命名小区',
    address: str(row.address),
    district: str(row.district),
    street: str(row.street),
    attribute: str(row.attribute),
  }
}

function normalizeLand(row) {
  return {
    id: str(row.id),
    districtStreet: str(row.district_street || row.districtStreet),
    location: str(row.location),
    areaHa: nullableNumber(row.area_ha !== undefined ? row.area_ha : row.areaHa),
    housingType: str(row.housing_type || row.housingType),
    buildStatus: str(row.build_status || row.buildStatus),
    developer: str(row.developer),
    projectName: str(row.project_name || row.projectName),
    supplyDate: str(row.supply_date || row.supplyDate),
  }
}

function normalizeSource(row) {
  return {
    field: str(row.field),
    source: str(row.source),
    sourceUrl: str(row.source_url || row.sourceUrl),
    updatedAt: str(row.updated_at || row.updatedAt),
  }
}

module.exports = {
  normalizePoi,
  normalizePoiList,
  normalizePending,
  normalizeLand,
  normalizeSource,
}

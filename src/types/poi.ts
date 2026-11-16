export type PoiType = 'bank' | 'community'
export type BranchType = 'branch' | 'atm'
export type SourceLevel = 'L1' | 'S' | 'U'

export interface BasePoi {
  id: string
  type: PoiType
  name: string
  address: string
  lng: number
  lat: number
  /** GCJ-02 坐标（高德/腾讯导航用）；后端算好，前端不要自己转 */
  gcjLng?: number | null
  gcjLat?: number | null
  district: string
  source: string
  license?: string
  sourceLevel: SourceLevel
}

export interface BankPoi extends BasePoi {
  type: 'bank'
  brand: string
  branchType: BranchType
  phone: string
  openingHours: string
}

export interface CommunityPoi extends BasePoi {
  type: 'community'
  builtYear: number | null
  avgPrice: number | null
  /** demo=哈希演示值 / gov_reference=政府成交参考价（2021 官方表） */
  avgPriceSource?: string
  propertyFee: number | null
  /** 物业公司（政府物业项目库匹配所得，可能为空） */
  propertyCompany?: string
  /** 节水型小区获评年度（政府数据集），null 表示未获评或未匹配 */
  waterSavingYear?: number | null
  /** 政府租赁参考价（元/㎡·月）：多层 / 高层 / 低密度 */
  rentDc?: number | null
  rentGc?: number | null
  rentDmd?: number | null
  /** 建设单位/开发商（竣工验收备案） */
  developer?: string
  /** 周边配套：1km 内银行网点数 / ATM 数 / 品牌数、最近银行距离（米） */
  surroundBankCount?: number
  surroundAtmCount?: number
  nearbyBrandCount?: number
  nearestBankM?: number
  /** 均价等字段是否为演示数据 */
  demoAttributes?: boolean
}

export type Poi = BankPoi | CommunityPoi

export interface PoiDataset {
  generatedAt: string
  source: string
  license: string
  attribution: string
  count: { bank: number; community: number }
  pois: Array<Record<string, unknown>>
}

export interface Filters {
  layers: PoiType[]
  district: string
  branchType: 'all' | BranchType
  priceRange: [number, number] | null
  yearRange: [number, number] | null
  keyword: string
}

export const DEFAULT_FILTERS: Filters = {
  // 默认只显示银行：小区数量是银行的四倍，混显会让首屏糊成一团
  layers: ['bank'],
  district: '全部区域',
  branchType: 'all',
  priceRange: null,
  yearRange: null,
  keyword: '',
}

export const SHENZHEN_DISTRICTS = [
  '福田区',
  '罗湖区',
  '南山区',
  '盐田区',
  '宝安区',
  '龙岗区',
  '龙华区',
  '坪山区',
  '光明区',
  '大鹏新区',
] as const

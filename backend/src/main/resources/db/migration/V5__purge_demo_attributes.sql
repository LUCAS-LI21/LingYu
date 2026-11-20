-- 清掉小区「建成年份 / 物业费」的演示值，只保留有真实字段来源的记录
-- 背景：早期为了页面好看，给全部小区生成了哈希演示值（demo_attributes=1），
-- 但字段级来源表里只有 173 条年份（竣工验收备案）与 113 条物业费（阳光物业/南山协会）是真数据。
-- 前端已不再展示演示值，这里把库里的假值一并清掉，避免 API 输出被误当真实数据。

-- 1) 建成年份：无真实来源的清空
UPDATE poi_community c
SET c.built_year = NULL
WHERE c.status <> 'closed'
  AND c.built_year IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM poi_field_source s
    WHERE s.poi_type = 'community' AND s.poi_id = c.id AND s.field = 'built_year'
  );

-- 2) 物业费：无真实来源的清空
UPDATE poi_community c
SET c.property_fee = NULL
WHERE c.status <> 'closed'
  AND c.property_fee IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM poi_field_source s
    WHERE s.poi_type = 'community' AND s.poi_id = c.id AND s.field = 'property_fee'
  );

-- 3) 演示均价列全部清空，demo 标记归零
UPDATE poi_community
SET avg_price_demo = NULL
WHERE avg_price_demo IS NOT NULL;

UPDATE poi_community
SET avg_price_source = ''
WHERE avg_price_source = 'demo';

UPDATE poi_community
SET demo_attributes = 0
WHERE demo_attributes <> 0;

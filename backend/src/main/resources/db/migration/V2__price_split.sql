-- 价格真假分离 + 去重黑名单补齐
-- 背景：avg_price 一列同时装"官方参考价"和"哈希演示值"，导致排序/筛选/统计被假数据污染。
-- 处理：演示值移到 avg_price_demo（只展示、不参与计算），avg_price 只保留官方参考价。

-- 1) 演示价单列
ALTER TABLE poi_community
  ADD COLUMN avg_price_demo INT NULL COMMENT '演示均价(哈希生成，不参与筛选/排序/统计)';

-- 2) 把标记为 demo 的旧值搬到新列，并清空 avg_price
UPDATE poi_community
SET avg_price_demo = avg_price
WHERE avg_price_source = 'demo' AND avg_price IS NOT NULL;

UPDATE poi_community
SET avg_price = NULL
WHERE avg_price_source = 'demo';

-- 3) 待定位小区挂官方参考价（转正时带入）
ALTER TABLE community_pending
  ADD COLUMN avg_price INT NULL COMMENT '官方成交参考价(元/㎡)，转正时带入 poi_community';

ALTER TABLE community_pending
  ADD COLUMN avg_price_source VARCHAR(32) NOT NULL DEFAULT '' COMMENT 'gov_reference=官方参考价表匹配到的';

-- 4) 重建视图，带上 avg_price_demo（演示价与真实价彻底分列）
DROP VIEW IF EXISTS v_poi;
CREATE VIEW v_poi AS
SELECT id, 'bank' AS type, name, address, district, lng, lat, brand, branch_type, phone, opening_hours,
       CAST(NULL AS SIGNED) AS built_year, CAST(NULL AS SIGNED) AS avg_price,
       CAST(NULL AS CHAR(32)) AS avg_price_source,
       CAST(NULL AS SIGNED) AS avg_price_demo,
       CAST(NULL AS DECIMAL(6,1)) AS property_fee,
       CAST(NULL AS CHAR(64)) AS property_company,
       CAST(NULL AS SIGNED) AS water_saving_year,
       CAST(NULL AS SIGNED) AS surround_bank_count, CAST(NULL AS SIGNED) AS surround_atm_count,
       CAST(NULL AS SIGNED) AS nearest_bank_m, CAST(NULL AS SIGNED) AS nearby_brand_count,
       CAST(NULL AS DECIMAL(8,2)) AS rent_dc, CAST(NULL AS DECIMAL(8,2)) AS rent_gc,
       CAST(NULL AS DECIMAL(8,2)) AS rent_dmd,
       CAST(NULL AS CHAR(64)) AS developer,
       0 AS demo_attributes, source, license, source_level, updated_at
FROM poi_bank WHERE status <> 'closed'
UNION ALL
SELECT id, 'community' AS type, name, address, district, lng, lat,
       CAST(NULL AS CHAR(64)) AS brand, CAST(NULL AS CHAR(16)) AS branch_type,
       CAST(NULL AS CHAR(64)) AS phone, CAST(NULL AS CHAR(128)) AS opening_hours,
       built_year, avg_price, avg_price_source, avg_price_demo, property_fee, property_company, water_saving_year, surround_bank_count, surround_atm_count,
       nearest_bank_m, nearby_brand_count,
       rent_dc, rent_gc, rent_dmd, developer,
       demo_attributes, source, license, source_level, updated_at
FROM poi_community WHERE status <> 'closed';

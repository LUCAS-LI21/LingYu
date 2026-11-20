-- 银行服务类型：对公 / 对私 / 自助
-- 只从已有真实文本里提取（营业时间里的「对公」「对私」），不臆造：
--   ATM → 自助
--   营业时间含「对公」→ 加对公；含「对私」→ 加对私
-- 没有证据的留空，前端显示「未提供」

ALTER TABLE poi_bank
  ADD COLUMN service_types VARCHAR(64) NOT NULL DEFAULT '' COMMENT '服务类型，逗号分隔：对公/对私/自助';

UPDATE poi_bank
SET service_types = '自助'
WHERE branch_type = 'atm';

UPDATE poi_bank
SET service_types = TRIM(BOTH ',' FROM CONCAT(
      IF(opening_hours LIKE '%对公%', '对公,', ''),
      IF(opening_hours LIKE '%对私%', '对私,', '')
    ))
WHERE branch_type = 'branch'
  AND (opening_hours LIKE '%对公%' OR opening_hours LIKE '%对私%');

-- 电话里带「对公/对私」标注的也一并识别（少数官网会这么给）
UPDATE poi_bank
SET service_types = TRIM(BOTH ',' FROM CONCAT(
      IF(phone LIKE '%对公%', '对公,', ''),
      IF(phone LIKE '%对私%', '对私,', '')
    ))
WHERE branch_type = 'branch'
  AND service_types = ''
  AND (phone LIKE '%对公%' OR phone LIKE '%对私%');

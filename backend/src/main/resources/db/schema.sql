-- 邻域 POI 情报系统 · 初始结构（幂等，可重复执行）

CREATE TABLE IF NOT EXISTS poi_bank (
  id            VARCHAR(64)  NOT NULL PRIMARY KEY,
  name          VARCHAR(128) NOT NULL,
  brand         VARCHAR(64)  NOT NULL DEFAULT '',
  branch_type   VARCHAR(16)  NOT NULL DEFAULT 'branch',
  address       VARCHAR(255) NOT NULL DEFAULT '',
  district      VARCHAR(32)  NOT NULL DEFAULT '',
  lng           DECIMAL(10, 6) NOT NULL,
  lat           DECIMAL(10, 6) NOT NULL,
  phone         VARCHAR(64)  NOT NULL DEFAULT '',
  opening_hours VARCHAR(128) NOT NULL DEFAULT '',
  source        VARCHAR(64)  NOT NULL DEFAULT 'OpenStreetMap',
  license       VARCHAR(32)  NOT NULL DEFAULT 'ODbL',
  source_level  VARCHAR(8)   NOT NULL DEFAULT 'L1',
  status        VARCHAR(16)  NOT NULL DEFAULT 'active',
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_bank_geo (lat, lng),
  KEY idx_bank_district (district),
  KEY idx_bank_brand (brand)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT '银行网点';

CREATE TABLE IF NOT EXISTS poi_community (
  id               VARCHAR(64)  NOT NULL PRIMARY KEY,
  name             VARCHAR(128) NOT NULL,
  address          VARCHAR(255) NOT NULL DEFAULT '',
  district         VARCHAR(32)  NOT NULL DEFAULT '',
  lng              DECIMAL(10, 6) NOT NULL,
  lat              DECIMAL(10, 6) NOT NULL,
  built_year       SMALLINT     NULL,
  avg_price        INT          NULL,
  property_fee     DECIMAL(6, 1) NULL,
  demo_attributes  TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '字段是否为演示数据',
  source           VARCHAR(64)  NOT NULL DEFAULT 'OpenStreetMap',
  license          VARCHAR(32)  NOT NULL DEFAULT 'ODbL',
  source_level     VARCHAR(8)   NOT NULL DEFAULT 'L1',
  status           VARCHAR(16)  NOT NULL DEFAULT 'active',
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comm_geo (lat, lng),
  KEY idx_comm_district (district),
  KEY idx_comm_price (avg_price)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT '住宅小区';

CREATE TABLE IF NOT EXISTS feedback (
  id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(32)  NOT NULL,
  poi_type    VARCHAR(16)  NOT NULL,
  poi_id      VARCHAR(64)  NOT NULL,
  poi_name    VARCHAR(128) NOT NULL DEFAULT '',
  type        VARCHAR(16)  NOT NULL,
  field_name  VARCHAR(64)  NOT NULL DEFAULT '',
  new_value   VARCHAR(255) NOT NULL DEFAULT '',
  description VARCHAR(1024) NOT NULL DEFAULT '',
  contact     VARCHAR(128) NOT NULL DEFAULT '',
  status      VARCHAR(24)  NOT NULL DEFAULT 'pending',
  reviewer    VARCHAR(64)  NOT NULL DEFAULT '',
  review_note VARCHAR(255) NOT NULL DEFAULT '',
  reviewed_at DATETIME     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_feedback_code (code),
  KEY idx_feedback_created (created_at),
  KEY idx_feedback_status (status)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT '用户反馈';

-- 统一视图：让查询层不必区分两张业务表
CREATE OR REPLACE VIEW v_poi AS
SELECT id,
       'bank'            AS type,
       name,
       address,
       district,
       lng,
       lat,
       brand,
       branch_type,
       phone,
       opening_hours,
       CAST(NULL AS SIGNED)        AS built_year,
       CAST(NULL AS SIGNED)        AS avg_price,
       CAST(NULL AS DECIMAL(6, 1)) AS property_fee,
       0                           AS demo_attributes,
       source,
       license,
       source_level,
       updated_at
FROM poi_bank
WHERE status <> 'closed'
UNION ALL
SELECT id,
       'community'       AS type,
       name,
       address,
       district,
       lng,
       lat,
       CAST(NULL AS CHAR(64)) AS brand,
       CAST(NULL AS CHAR(16)) AS branch_type,
       CAST(NULL AS CHAR(64)) AS phone,
       CAST(NULL AS CHAR(128)) AS opening_hours,
       built_year,
       avg_price,
       property_fee,
       demo_attributes,
       source,
       license,
       source_level,
       updated_at
FROM poi_community
WHERE status <> 'closed';

-- ---------------- 运营闭环相关（M2） ----------------

CREATE TABLE IF NOT EXISTS ds_source (
  id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code           VARCHAR(32)  NOT NULL,
  name           VARCHAR(64)  NOT NULL,
  type           VARCHAR(16)  NOT NULL DEFAULT 'official_api',
  storage_policy VARCHAR(16)  NOT NULL DEFAULT 'storable' COMMENT 'L1 storable / L2 display_only / L3 forbidden',
  rate_limit_qps DECIMAL(5, 2) NOT NULL DEFAULT 1.00,
  enabled        TINYINT(1)   NOT NULL DEFAULT 1,
  notes          VARCHAR(255) NOT NULL DEFAULT '',
  UNIQUE KEY uk_source_code (code)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT '数据源';

CREATE TABLE IF NOT EXISTS ingest_job (
  id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  source_code    VARCHAR(32)  NOT NULL DEFAULT 'osm_overpass',
  trigger_type   VARCHAR(16)  NOT NULL DEFAULT 'manual',
  scope_type     VARCHAR(16)  NOT NULL DEFAULT 'bbox',
  scope_value    VARCHAR(255) NOT NULL DEFAULT '',
  status         VARCHAR(16)  NOT NULL DEFAULT 'pending',
  fetched_count  INT          NOT NULL DEFAULT 0,
  inserted_count INT          NOT NULL DEFAULT 0,
  updated_count  INT          NOT NULL DEFAULT 0,
  failed_count   INT          NOT NULL DEFAULT 0,
  error_summary  VARCHAR(512) NOT NULL DEFAULT '',
  started_at     DATETIME     NULL,
  finished_at    DATETIME     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_job_created (created_at),
  KEY idx_job_status (status)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT '抓取任务';

CREATE TABLE IF NOT EXISTS poi_version (
  id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  poi_type       VARCHAR(16)  NOT NULL,
  poi_id         VARCHAR(64)  NOT NULL,
  change_type    VARCHAR(16)  NOT NULL,
  before_json    TEXT         NULL,
  after_json     TEXT         NULL,
  changed_fields VARCHAR(255) NOT NULL DEFAULT '',
  operator       VARCHAR(64)  NOT NULL DEFAULT 'system',
  feedback_id    BIGINT       NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_version_poi (poi_type, poi_id, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT 'POI 变更版本';

CREATE TABLE IF NOT EXISTS query_log (
  id           BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind         VARCHAR(16)  NOT NULL DEFAULT 'list',
  keyword      VARCHAR(128) NOT NULL DEFAULT '',
  district     VARCHAR(32)  NOT NULL DEFAULT '',
  grid         VARCHAR(32)  NOT NULL DEFAULT '',
  result_count INT          NOT NULL DEFAULT 0,
  cost_ms      INT          NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_query_created (created_at),
  KEY idx_query_grid (grid)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT '查询日志（热点来源）';

CREATE TABLE IF NOT EXISTS hot_region (
  id                BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  grid              VARCHAR(32)  NOT NULL,
  stat_date         DATE         NOT NULL,
  query_count       INT          NOT NULL DEFAULT 0,
  zero_result_count INT          NOT NULL DEFAULT 0,
  priority          DECIMAL(6, 2) NOT NULL DEFAULT 0,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_hot (grid, stat_date)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT '热点聚合';

INSERT INTO ds_source (code, name, type, storage_policy, rate_limit_qps, enabled, notes)
VALUES ('osm_overpass', 'OpenStreetMap Overpass API', 'open_data', 'storable', 0.5, 1,
        'ODbL 许可，可入库；需署名，公共实例限速')
ON DUPLICATE KEY UPDATE name = VALUES(name), notes = VALUES(notes);


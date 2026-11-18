-- 抓取任务与反馈的关联：任务结束后回写反馈状态，补上闭环最后一跳
ALTER TABLE ingest_job
  ADD COLUMN feedback_code VARCHAR(32) NOT NULL DEFAULT '' COMMENT '发起该任务的反馈编号';

-- 待定位小区支持驳回（此前 rejected 状态无法到达）
-- 仅补索引便于按状态筛选
CREATE INDEX idx_cp_status_district ON community_pending (status, district);

-- 清理 OSM 建筑级名称（29栋 / 30栋 / 36小区 …）
-- 背景：OSM 里有些住宅面是「单栋楼」，名字就是楼栋编号，入库后列表第一屏像脏数据。
-- 代码侧已加同样规则的闸门（NameQuality），这里补一次存量清理，可重复执行。

DELETE FROM poi_field_source
WHERE poi_type = 'community'
  AND poi_id IN (
    SELECT id FROM (
      SELECT id FROM poi_community
      WHERE name REGEXP '^[0-9]{1,4}[[:space:]]*(栋|号楼|单元|座|号|小区)$'
    ) t
  );

DELETE FROM poi_version
WHERE poi_type = 'community'
  AND poi_id IN (
    SELECT id FROM (
      SELECT id FROM poi_community
      WHERE name REGEXP '^[0-9]{1,4}[[:space:]]*(栋|号楼|单元|座|号|小区)$'
    ) t
  );

DELETE FROM poi_community
WHERE name REGEXP '^[0-9]{1,4}[[:space:]]*(栋|号楼|单元|座|号|小区)$';

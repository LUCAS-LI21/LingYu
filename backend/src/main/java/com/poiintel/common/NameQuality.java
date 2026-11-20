package com.poiintel.common;

import java.util.regex.Pattern;

/**
 * 小区/点位名称质量闸门。
 *
 * 背景：OSM 里存在把「单栋楼」当住宅面提交的条目（29栋、30栋、36小区…），
 * 直接入库会让列表第一屏全是「几栋」，看起来像没审核过的脏数据。
 * 这里做保守拦截：只拦"纯编号 + 栋/号楼/单元/座/号/小区"这种明显不是完整小区名的形式，
 * 含实际名称的（如「万科城 3 栋」「上沙村48栋」）不拦。
 */
public final class NameQuality {

    private static final Pattern BUILDING_LIKE =
            Pattern.compile("^\\d{1,4}\\s*(栋|号楼|单元|座|号|小区)$");

    private NameQuality() {
    }

    /** true = 该名称像"楼栋编号"，不应作为小区主记录入库/展示 */
    public static boolean isBuildingLike(String name) {
        if (name == null) {
            return false;
        }
        return BUILDING_LIKE.matcher(name.trim()).matches();
    }
}

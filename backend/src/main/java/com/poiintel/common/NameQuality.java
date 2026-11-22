package com.poiintel.common;

import java.util.regex.Pattern;

/**
 * 名称质量闸门：仅拦截「纯编号 + 栋/号楼/单元/座/号/小区」形式，含实际名称的不拦截。
 */
public final class NameQuality {

    private static final Pattern BUILDING_LIKE =
            Pattern.compile("^\\d{1,4}\\s*(栋|号楼|单元|座|号|小区)$");

    private NameQuality() {
    }

    /** true 表示名称像楼栋编号，不应作为小区主记录入库或展示。 */
    public static boolean isBuildingLike(String name) {
        if (name == null) {
            return false;
        }
        return BUILDING_LIKE.matcher(name.trim()).matches();
    }
}

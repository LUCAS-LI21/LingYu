package com.poiintel.poi;

/**
 * 深圳 10 区近似中心：用于把坐标归到行政区（MVP 用最近质心，后续可换成点面判定）。
 */
public final class Districts {

    private static final String[] NAMES = {
            "福田区", "罗湖区", "南山区", "盐田区", "宝安区",
            "龙岗区", "龙华区", "坪山区", "光明区", "大鹏新区"
    };

    private static final double[][] CENTERS = {
            {114.055, 22.541}, {114.131, 22.548}, {113.930, 22.533}, {114.236, 22.557},
            {113.883, 22.555}, {114.246, 22.720}, {114.036, 22.697}, {114.350, 22.690},
            {113.936, 22.748}, {114.479, 22.596}
    };

    private Districts() {
    }

    public static String nearest(double lng, double lat) {
        int best = 0;
        double bestDistance = Double.MAX_VALUE;
        for (int i = 0; i < CENTERS.length; i++) {
            double dLng = CENTERS[i][0] - lng;
            double dLat = CENTERS[i][1] - lat;
            double d = dLng * dLng + dLat * dLat;
            if (d < bestDistance) {
                bestDistance = d;
                best = i;
            }
        }
        return NAMES[best];
    }
}

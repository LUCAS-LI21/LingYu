package com.poiintel.common;

/**
 * WGS-84 ⇄ GCJ-02 坐标转换：OSM/GPS/浏览器为 WGS-84，高德按 GCJ-02，直接传会偏移数百米。
 * 纯本地算法，不消耗高德配额；入库统一 WGS-84，出站按目标平台转换。
 */
public final class GeoCoord {

    private static final double PI = Math.PI;
    private static final double A = 6378245.0;
    /** 克拉索夫斯基椭球偏心率平方 */
    private static final double EE = 0.00669342162296594323;

    private GeoCoord() {}

    /**
     * WGS-84 → GCJ-02。
     * @return {@code [lng, lat]}；境外坐标原样返回（GCJ-02 仅中国大陆加偏）
     */
    public static double[] wgs84ToGcj02(double lng, double lat) {
        if (outOfChina(lng, lat)) {
            return new double[] {lng, lat};
        }
        double dLat = transformLat(lng - 105.0, lat - 35.0);
        double dLng = transformLng(lng - 105.0, lat - 35.0);
        double radLat = lat / 180.0 * PI;
        double magic = Math.sin(radLat);
        magic = 1 - EE * magic * magic;
        double sqrtMagic = Math.sqrt(magic);
        dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
        dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
        return new double[] {lng + dLng, lat + dLat};
    }

    /** GCJ-02 → WGS-84：一次反向近似，误差 &lt; 2 m，出口统一为 WGS-84。 */
    public static double[] gcj02ToWgs84(double lng, double lat) {
        if (outOfChina(lng, lat)) {
            return new double[] {lng, lat};
        }
        double[] gcj = wgs84ToGcj02(lng, lat);
        return new double[] {lng - (gcj[0] - lng), lat - (gcj[1] - lat)};
    }

    static boolean outOfChina(double lng, double lat) {
        return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
    }

    private static double transformLat(double x, double y) {
        double ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
        ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
        ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
        return ret;
    }

    private static double transformLng(double x, double y) {
        double ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
        ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
        ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
        return ret;
    }
}

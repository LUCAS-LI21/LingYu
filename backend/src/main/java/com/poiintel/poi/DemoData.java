package com.poiintel.poi;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** 演示属性生成器：与前端一致的稳定哈希，保证两端数值一致。 */
public final class DemoData {

    private DemoData() {
    }

    public static int hash(String input) {
        int h = 0x811c9dc5;
        for (int i = 0; i < input.length(); i++) {
            h ^= input.charAt(i);
            h *= 0x01000193;
        }
        return h & 0x7fffffff;
    }

    public static int seeded(int seed, int salt, int min, int max) {
        double x = Math.sin(seed * 0.0001 + salt * 12.9898) * 43758.5453;
        double frac = x - Math.floor(x);
        return (int) Math.round(min + frac * (max - min));
    }

    public static int builtYear(int seed) {
        return seeded(seed, 1, 1996, 2022);
    }

    public static int avgPrice(int seed) {
        return seeded(seed, 2, 42000, 138000);
    }

    public static BigDecimal propertyFee(int seed) {
        return BigDecimal.valueOf(seeded(seed, 3, 25, 98)).divide(BigDecimal.TEN, 1, RoundingMode.HALF_UP);
    }
}

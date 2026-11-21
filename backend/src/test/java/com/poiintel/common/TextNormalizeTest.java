package com.poiintel.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class TextNormalizeTest {

    @Test
    void phoneNormalization() {
        assertEquals("0755-12345678", TextNormalize.phone("+86 0755-1234 5678"));
        assertEquals("07551234-5678", TextNormalize.phone("（0755）1234－5678"));
        assertEquals("755-1234-5678", TextNormalize.phone("0086-755-1234-5678"));
        assertEquals("", TextNormalize.phone(null));
    }

    @Test
    void addressNormalization() {
        assertEquals("广东省深圳市福田区深南大道1号",
                TextNormalize.address("  广东深圳福田区深南大道1号  "));
        assertEquals("深圳市福田区深南大道1号",
                TextNormalize.address("深圳市深圳市福田区深南大道1号"));
        assertEquals("", TextNormalize.address(null));
    }

    @Test
    void nameAndHoursNormalization() {
        assertEquals("招商银行(深圳分行)", TextNormalize.name(" 招商银行（深圳分行） "));
        assertEquals("周一至周五 09:00-17:00; 周末休业",
                TextNormalize.openingHours("周一至周五 09:00-17:00；；周末休业"));
    }
}

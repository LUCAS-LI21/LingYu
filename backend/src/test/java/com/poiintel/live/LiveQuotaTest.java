package com.poiintel.live;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 配额闸门的回归用例（ADR-0002 §7）。
 *
 * <p>这三个用例对应三种真实事故：① 一天被脚本刷爆；② 周边搜索把 5,000/月 的池子单独打穿；
 * ③ 前端连点/循环触发时没有任何节流。
 */
class LiveQuotaTest {

    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    private static final Instant START = Instant.parse("2026-11-12T02:00:00Z");

    @Test
    @DisplayName("每日总预算用完后一律拒绝，且给出可读原因")
    void dailyLimitBlocksAfterBudget() {
        LiveQuota quota = new LiveQuota(2, 10, 0, clockAt(START));

        assertTrue(quota.acquire(false).allowed());
        assertTrue(quota.acquire(false).allowed());

        LiveQuota.Decision denied = quota.acquire(false);
        assertFalse(denied.allowed());
        assertTrue(denied.reason().contains("额度已用完"), denied.reason());
    }

    @Test
    @DisplayName("周边搜索有独立更低的预算，但不影响查地址")
    void aroundHasLowerSeparateBudget() {
        LiveQuota quota = new LiveQuota(10, 1, 0, clockAt(START));

        assertTrue(quota.acquire(true).allowed());
        assertFalse(quota.acquire(true).allowed(), "第二次周边应被拦住");

        assertTrue(quota.acquire(false).allowed(), "查地址不受周边预算影响");
    }

    @Test
    @DisplayName("跨天后预算自动重置")
    void resetsNextDay() {
        MutableClock clock = clockAt(START);
        LiveQuota quota = new LiveQuota(1, 1, 0, clock);

        assertTrue(quota.acquire(false).allowed());
        assertFalse(quota.acquire(false).allowed());

        clock.plusMillis(24 * 60 * 60 * 1000L);
        assertTrue(quota.acquire(false).allowed(), "次日应重新放行");
    }

    @Test
    @DisplayName("最小间隔能挡住连点/循环触发")
    void minIntervalBlocksRapidCalls() {
        MutableClock clock = clockAt(START);
        LiveQuota quota = new LiveQuota(100, 100, 300, clock);

        assertTrue(quota.acquire(false).allowed());
        assertFalse(quota.acquire(false).allowed(), "紧接着的第二次调用应被节流");

        clock.plusMillis(400);
        assertTrue(quota.acquire(false).allowed());
    }

    private static MutableClock clockAt(Instant instant) {
        return new MutableClock(instant, ZONE);
    }

    /** 可推进的时钟：让"跨天重置"与"最小间隔"可测，而不是靠 sleep。 */
    private static final class MutableClock extends Clock {

        private Instant instant;
        private final ZoneId zone;

        private MutableClock(Instant instant, ZoneId zone) {
            this.instant = instant;
            this.zone = zone;
        }

        void plusMillis(long millis) {
            instant = instant.plusMillis(millis);
        }

        @Override
        public ZoneId getZone() {
            return zone;
        }

        @Override
        public Clock withZone(ZoneId newZone) {
            return new MutableClock(instant, newZone);
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}

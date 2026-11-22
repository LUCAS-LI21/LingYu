package com.poiintel.live;

import java.time.Clock;
import java.time.LocalDate;

/**
 * L2 调用闸门：每日预算 + 全局最小间隔，防止误用打爆高德配额。
 * 纯内存计数，重启归零；只记次数，不记返回内容。
 */
public final class LiveQuota {

    /** 一次调用的放行结论；{@code reason} 只在拒绝时非空。 */
    public record Decision(boolean allowed, String reason) {
        public static Decision allow() {
            return new Decision(true, "");
        }

        public static Decision deny(String reason) {
            return new Decision(false, reason);
        }
    }

    private final int dailyLimit;
    private final int aroundLimit;
    private final long minIntervalMs;
    private final Clock clock;

    private LocalDate day;
    private int used;
    private int usedAround;
    private long lastCallAt;

    public LiveQuota(int dailyLimit, int aroundLimit, long minIntervalMs) {
        this(dailyLimit, aroundLimit, minIntervalMs, Clock.systemDefaultZone());
    }

    public LiveQuota(int dailyLimit, int aroundLimit, long minIntervalMs, Clock clock) {
        this.dailyLimit = Math.max(1, dailyLimit);
        this.aroundLimit = Math.max(1, aroundLimit);
        this.minIntervalMs = Math.max(0, minIntervalMs);
        this.clock = clock;
        this.day = LocalDate.now(clock);
        this.lastCallAt = clock.millis() - this.minIntervalMs;
    }

    /**
     * 尝试占用一次调用额度。
     * @param around 是否为周边搜索（配额独立计数）
     */
    public synchronized Decision acquire(boolean around) {
        LocalDate today = LocalDate.now(clock);
        if (!today.equals(day)) {
            day = today;
            used = 0;
            usedAround = 0;
        }
        long now = clock.millis();
        if (minIntervalMs > 0 && now - lastCallAt < minIntervalMs) {
            long waitMs = minIntervalMs - (now - lastCallAt);
            return Decision.deny("实时查询太频繁，请 " + Math.max(1, waitMs / 1000) + " 秒后再试");
        }
        if (used >= dailyLimit) {
            return Decision.deny(
                    "今日实时查询额度已用完（上限 " + dailyLimit + " 次/日），本地库数据仍可正常查询");
        }
        if (around && usedAround >= aroundLimit) {
            return Decision.deny(
                    "今日实时周边额度已用完（上限 " + aroundLimit + " 次/日），可改用本地库的「周边银行」统计");
        }
        used++;
        if (around) {
            usedAround++;
        }
        lastCallAt = now;
        return Decision.allow();
    }

    /** 今日已用次数（合计），仅用于日志排查。 */
    public synchronized int usedToday() {
        return used;
    }

    /** 今日周边搜索已用次数。 */
    public synchronized int usedAroundToday() {
        return usedAround;
    }
}

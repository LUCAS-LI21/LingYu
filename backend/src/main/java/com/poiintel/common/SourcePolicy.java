package com.poiintel.common;

import java.net.URI;
import java.util.List;
import java.util.Locale;

/**
 * 来源域名白名单：Agent 只能引用"允许入库"的站点，防止把任意网页内容写进主库。
 *
 * <p>背景（审计 D2）：原来只校验 https，等于任何站点都能成为 L1 入库来源；
 * 这里按 L1 域名白名单收口：银行官网 + 政府开放数据 + OSM。
 * 不在名单里的来源直接拒绝，不写入 agent_run。
 */
public final class SourcePolicy {

    /** 允许作为 L1 入库依据的域名后缀 */
    private static final List<String> ALLOWED_SUFFIXES = List.of(
            // 银行官网
            "ccb.com", "abchina.com", "boc.cn", "bankcomm.com", "cmbchina.com",
            "spdb.com.cn", "cib.com.cn", "ecitic.com", "cebbank.com", "pingan.com",
            "hxb.com.cn", "psbc.com", "szrcb.com", "cgbchina.com.cn", "bosc.cn",
            "citicbank.com", "cmbc.com.cn", "bankofchina.com",
            // 政府 / 开放数据
            "gov.cn", "sz.gov.cn", "zjj.sz.gov.cn", "szggzy.com",
            // 开放数据源
            "openstreetmap.org", "openstreetmap.com");

    private SourcePolicy() {
    }

    /** 域名是否允许入库（同时要求 https） */
    public static boolean allowed(String url) {
        if (url == null || !url.trim().toLowerCase(Locale.ROOT).startsWith("https://")) {
            return false;
        }
        String host = hostOf(url);
        if (host.isEmpty()) {
            return false;
        }
        String lower = host.toLowerCase(Locale.ROOT);
        return ALLOWED_SUFFIXES.stream().anyMatch(suffix ->
                lower.equals(suffix) || lower.endsWith("." + suffix));
    }

    /** 只用于错误提示，不参与判断 */
    public static String hostOf(String url) {
        if (url == null || url.isBlank()) {
            return "";
        }
        try {
            URI uri = URI.create(url.trim());
            String host = uri.getHost();
            return host == null ? "" : host;
        } catch (IllegalArgumentException ex) {
            return "";
        }
    }

    public static String rejectReason(String url) {
        String host = hostOf(url);
        if (host.isEmpty()) {
            return "来源地址无效，无法通过域名白名单";
        }
        return "来源域名不在 L1 白名单：" + host + "（仅允许银行官网 / 政府开放数据 / OSM）";
    }
}

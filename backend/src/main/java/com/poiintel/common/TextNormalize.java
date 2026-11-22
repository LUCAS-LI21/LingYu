package com.poiintel.common;

import java.util.regex.Pattern;

/** 字段清洗归一（无损）：统一空白、全角字符、电话与地址前缀，不猜测内容。 */
public final class TextNormalize {

    private static final Pattern MULTI_SPACE = Pattern.compile("[\\s\\u00A0]+");
    private static final Pattern PHONE_SEPARATORS = Pattern.compile("[\\s\\u00A0\\u3000()（）]");

    private TextNormalize() {
    }

    /** 去除首尾空白、全角空格，压缩连续空白 */
    public static String text(String value) {
        if (value == null) {
            return "";
        }
        String normalized = value.replace('\u3000', ' ').replace('\u00A0', ' ');
        return MULTI_SPACE.matcher(normalized).replaceAll(" ").trim();
    }

    /** 名称：去空白 + 全角括号统一为半角 */
    public static String name(String value) {
        return text(value)
                .replace('（', '(')
                .replace('）', ')');
    }

    /** 地址：去空白并统一「深圳市」写法，不改动门牌等实质内容。 */
    public static String address(String value) {
        String normalized = text(value)
                .replace("深圳巿", "深圳市")
                .replace("广东深圳", "广东省深圳市");
        if (normalized.startsWith("深圳市深圳市")) {
            normalized = normalized.substring(3);
        }
        return normalized;
    }

    /** 电话：全角转半角、去空格/括号，统一 +86 与 86- 前缀 */
    public static String phone(String value) {
        if (value == null) {
            return "";
        }
        String normalized = text(value);
        StringBuilder sb = new StringBuilder(normalized.length());
        for (char ch : normalized.toCharArray()) {
            if (ch >= '０' && ch <= '９') {
                sb.append((char) (ch - '０' + '0'));
            } else if (ch == '＋') {
                sb.append('+');
            } else if (ch == '－' || ch == '—' || ch == '–') {
                sb.append('-');
            } else {
                sb.append(ch);
            }
        }
        String compact = PHONE_SEPARATORS.matcher(sb.toString()).replaceAll("");
        if (compact.startsWith("+86")) {
            compact = compact.substring(3);
        } else if (compact.startsWith("86-")) {
            compact = compact.substring(3);
        } else if (compact.startsWith("0086")) {
            compact = compact.substring(4);
        }
        compact = compact.replaceAll("-{2,}", "-");
        // 去掉归一过程中可能留下的首尾分隔符
        return compact.replaceAll("^[-]+|[-]+$", "").trim();
    }

    /** 营业时间：去空白，统一中文分号，压缩连续标点 */
    public static String openingHours(String value) {
        return text(value)
                .replace('；', ';')
                .replaceAll(";{2,}", ";")
                .replaceAll("\\s*;\\s*", "; ");
    }
}

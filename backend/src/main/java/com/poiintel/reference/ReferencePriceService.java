package com.poiintel.reference;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;

/**
 * 二手房成交参考价（深圳市政府数据开放平台，市住建局发布）。
 *
 * 为什么不入库、不绑定 POI：
 * 实测 463 条与库内 OSM 小区精确同名仅 1 条——官方表是"商品房项目"，OSM 记的是
 * "住宅区/村/花园"，两套命名体系且都没有共同主键（无地址、无坐标）。
 * 强行映射会制造错误关联，所以这里只做「按区/街道的行情参考」，独立展示。
 *
 * 数据来源：深圳市政府数据开放平台 · 深圳市住宅小区二手住房成交参考价格表
 * 许可：政府公开信息，使用须注明来源，不得转让/再分发。
 */
@Service
public class ReferencePriceService {

    private static final Logger log = LoggerFactory.getLogger(ReferencePriceService.class);
    private static final String CSV = "seed/reference-price.csv";
    private static final String SOURCE = "深圳市政府数据开放平台 · 市住房和建设局";

    private final List<Item> items = new ArrayList<>();

    public record Item(String name, int price, String district, String street) {
    }

    @PostConstruct
    void load() {
        ClassPathResource resource = new ClassPathResource(CSV);
        if (!resource.exists()) {
            log.warn("[reference] 未找到 {}，参考价功能不可用", CSV);
            return;
        }
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                resource.getInputStream(),
                // 官方导出的 CSV 偶有非法字节，默认解码器会直接抛异常导致只读到一半
                StandardCharsets.UTF_8.newDecoder()
                        .onMalformedInput(java.nio.charset.CodingErrorAction.REPLACE)
                        .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPLACE)))) {
            String line = reader.readLine(); // 表头
            while ((line = reader.readLine()) != null) {
                String[] cells = line.split(",", -1);
                if (cells.length < 4) continue;
                String name = cells[0].trim();
                String priceText = cells[1].trim();
                if (name.isEmpty() || priceText.isEmpty()) continue;
                try {
                    items.add(new Item(name, Integer.parseInt(priceText), cells[3].trim(),
                            cells.length > 4 ? cells[4].trim() : ""));
                } catch (NumberFormatException ignored) {
                    // 个别行价格为空，跳过
                }
            }
            log.info("[reference] 载入 {} 条二手房参考价", items.size());
        } catch (Exception ex) {
            log.warn("[reference] 载入失败：{}", ex.getMessage());
        }
    }

    public Map<String, Object> overview() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("total", items.size());
        result.put("source", SOURCE);
        result.put("license", "政府公开信息（署名，不得转让）");
        result.put("note", "按商品房项目发布，与 OSM 住宅区命名体系不同，仅作区域行情参考，不绑定具体 POI");

        Map<String, List<Integer>> byDistrict = new LinkedHashMap<>();
        for (Item item : items) {
            String key = normalizeDistrict(item.district());
            byDistrict.computeIfAbsent(key, k -> new ArrayList<>()).add(item.price());
        }

        List<Map<String, Object>> districts = new ArrayList<>();
        for (Map.Entry<String, List<Integer>> entry : byDistrict.entrySet()) {
            List<Integer> prices = new ArrayList<>(entry.getValue());
            prices.sort(Comparator.naturalOrder());
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("district", entry.getKey());
            row.put("count", prices.size());
            row.put("median", median(prices));
            row.put("min", prices.get(0));
            row.put("max", prices.get(prices.size() - 1));
            districts.add(row);
        }
        districts.sort((a, b) -> Integer.compare((int) b.get("count"), (int) a.get("count")));
        result.put("districts", districts);
        return result;
    }

    public Map<String, Object> page(String district, int page, int size) {
        List<Item> filtered = items;
        if (district != null && !district.isBlank()) {
            String key = normalizeDistrict(district);
            filtered = items.stream().filter(i -> normalizeDistrict(i.district()).equals(key)).toList();
        }
        int from = (int) Math.min((long) (Math.max(page, 1) - 1) * size, filtered.size());
        int to = Math.min(from + size, filtered.size());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("total", filtered.size());
        result.put("page", page);
        result.put("size", size);
        result.put("source", SOURCE);
        result.put("items", filtered.subList(from, to).stream().map(i -> Map.of(
                "name", i.name(), "price", i.price(),
                "district", normalizeDistrict(i.district()), "street", i.street())).toList());
        return result;
    }

    /** 官方数据写「罗湖」，库里写「罗湖区」，统一成带「区」的形式 */
    private String normalizeDistrict(String raw) {
        if (raw == null || raw.isBlank()) return "未知";
        String value = raw.trim();
        return value.endsWith("区") ? value : value + "区";
    }

    private int median(List<Integer> sorted) {
        int n = sorted.size();
        if (n == 0) return 0;
        return n % 2 == 1 ? sorted.get(n / 2) : (sorted.get(n / 2 - 1) + sorted.get(n / 2)) / 2;
    }
}

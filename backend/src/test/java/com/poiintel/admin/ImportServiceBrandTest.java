package com.poiintel.admin;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * 品牌推导与「非银行」拦截。
 *
 * <p>背景：OSM 的 bank 图层里既有「招商银行深圳XX支行」这种规范名，也有
 * 「ICBC」「中國郵政儲蓄銀行」「建設銀行」这类英文/繁体名，还有证券营业部和 ATM 节点混进来。
 * 这些用例守护导入时的品牌补全与过滤逻辑，防止脏数据再次进主表。
 */
class ImportServiceBrandTest {

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource({
            "中国建设银行深圳分行, 中国建设银行",
            "建设银行深圳上步支行, 中国建设银行",
            "ICBC深圳华强支行, 中国工商银行",
            "中国工商银行深圳分行, 中国工商银行",
            "中國郵政儲蓄銀行深圳福田支行, 中国邮政储蓄银行",
            "中国邮政储蓄银行深圳分行, 中国邮政储蓄银行",
            "招商银行深圳科技园支行, 招商银行",
            "China Merchants Bank Shenzhen, 招商银行",
            "交通银行深圳分行, 交通银行",
            "Bank of Communication Shenzhen, 交通银行",
            "中国银行深圳分行, 中国银行",
            "平安银行深圳分行, 平安银行",
            "深圳农村商业银行XX支行, 深圳农商银行",
            "深圳宝安桂银村镇银行, 深圳宝安桂银村镇银行",
    })
    @DisplayName("名称推品牌：中英文、繁简、村镇银行都能识别")
    void derivesBrandFromName(String name, String expected) {
        assertEquals(expected, ImportService.deriveBrand(name));
    }

    @Test
    @DisplayName("认不出来的名称返回空串，不瞎猜")
    void unknownNameReturnsEmpty() {
        assertEquals("", ImportService.deriveBrand("某某金融服务有限公司"));
        assertEquals("", ImportService.deriveBrand(null));
    }

    @ParameterizedTest
    @ValueSource(strings = {"光大证券深圳金田路营业部", "中国平安保险深圳分公司", "某某基金管理有限公司"})
    @DisplayName("证券/保险/基金不属于银行网点")
    void nonBankNamesAreRejected(String name) {
        ImportService service = new ImportService(null, null);
        ImportService.Row row = new ImportService.Row(
                null, name, "深圳市福田区", "福田区", 114.06, 22.54,
                null, null, null, null, null, null, null, null, null);
        assertEquals("非银行机构", service.validate(row));
    }

    @Test
    @DisplayName("垃圾名称与越界坐标都拦下")
    void junkNameAndOutOfBoundCoords() {
        ImportService service = new ImportService(null, null);

        ImportService.Row atm = new ImportService.Row(
                null, "ATM", "深圳市", "福田区", 114.06, 22.54,
                null, null, null, null, null, null, null, null, null);
        assertEquals("无效名称", service.validate(atm));

        ImportService.Row beijing = new ImportService.Row(
                null, "中国银行北京分行", "北京市", "东城区", 116.40, 39.90,
                null, null, null, null, null, null, null, null, null);
        assertEquals("坐标超出深圳范围", service.validate(beijing));
    }
}

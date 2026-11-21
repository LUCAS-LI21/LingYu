package com.poiintel.common;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class SourcePolicyTest {

    @Test
    void allowsBankAndGovernmentDomains() {
        assertTrue(SourcePolicy.allowed("https://www.ccb.com/cn/home/indexv3.html"));
        assertTrue(SourcePolicy.allowed("https://www.hxb.com.cn/branch/1.shtml"));
        assertTrue(SourcePolicy.allowed("https://zjj.sz.gov.cn/attachment/1.pdf"));
        assertTrue(SourcePolicy.allowed("https://www.openstreetmap.org/node/1"));
    }

    @Test
    void rejectsUnknownAndLookalikeDomains() {
        assertFalse(SourcePolicy.allowed("https://ditu.city8.com/poi/1"));
        assertFalse(SourcePolicy.allowed("https://ccb.com.evil.example/1"));
        assertFalse(SourcePolicy.allowed("https://example.com/ccb.com"));
        assertFalse(SourcePolicy.allowed("http://www.ccb.com/1"));
        assertFalse(SourcePolicy.allowed(""));
        assertFalse(SourcePolicy.allowed(null));
    }

    @Test
    void rejectReasonMentionsHost() {
        String reason = SourcePolicy.rejectReason("https://ditu.city8.com/poi/1");
        assertTrue(reason.contains("ditu.city8.com"));
    }
}

package com.poiintel.common;

/** 触发限流，统一映射 429。 */
public class RateLimitException extends RuntimeException {

    public RateLimitException(String message) {
        super(message);
    }
}

package com.poiintel.common;

/** 未认证/凭据错误，统一映射 401（区别于参数错误 400）。 */
public class UnauthorizedException extends RuntimeException {

    public UnauthorizedException(String message) {
        super(message);
    }
}

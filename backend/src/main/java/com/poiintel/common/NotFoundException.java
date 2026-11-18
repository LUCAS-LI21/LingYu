package com.poiintel.common;

/** 资源不存在，统一映射 404（区别于参数错误 400）。 */
public class NotFoundException extends RuntimeException {

    public NotFoundException(String message) {
        super(message);
    }
}

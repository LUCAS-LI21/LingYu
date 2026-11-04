package com.poiintel;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

@EnableAsync
@SpringBootApplication
public class PoiIntelApplication {

    public static void main(String[] args) {
        SpringApplication.run(PoiIntelApplication.class, args);
    }
}

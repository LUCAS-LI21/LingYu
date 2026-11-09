package com.poiintel.agent;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import lombok.RequiredArgsConstructor;

/**
 * DeepSeek 客户端：只做三件事——结构化抽取（JSON 模式，关闭思考）、网页搜索、记账。
 *
 * 思考模式默认开启，抽取类任务不需要，显式 disabled 可省一半输出 token。
 */
@Component
@RequiredArgsConstructor
public class DeepSeekClient {

    private static final Logger log = LoggerFactory.getLogger(DeepSeekClient.class);

    private final ObjectMapper objectMapper;

    @Value("${app.agent.api-key:}")
    private String apiKey;

    @Value("${app.agent.base-url:https://api.deepseek.com}")
    private String baseUrl;

    @Value("${app.agent.model:deepseek-flash}")
    private String model;

    public boolean enabled() {
        return apiKey != null && !apiKey.isBlank();
    }

    public record ChatResult(String content, int promptTokens, int completionTokens, long latencyMs) {
    }

    public record SearchHit(String title, String url, String summary, String content, double authority) {
    }

    /** JSON 模式抽取：调用方负责给出 schema 描述 */
    public ChatResult chatJson(String system, String user, int maxTokens) {
        ObjectNode body = objectMapper.createObjectNode();
        body.put("model", model);
        body.put("max_tokens", maxTokens);
        body.put("response_format", objectMapper.createObjectNode().put("type", "json_object"));
        // 关键：关闭思考模式（默认开启），抽取任务不需要
        body.set("thinking", objectMapper.createObjectNode().put("type", "disabled"));
        var messages = objectMapper.createArrayNode();
        messages.addObject().put("role", "system").put("content", system);
        messages.addObject().put("role", "user").put("content", user);
        body.set("messages", messages);

        long start = System.currentTimeMillis();
        JsonNode root = post("/chat/completions", body, Duration.ofSeconds(90));
        long latency = System.currentTimeMillis() - start;

        String content = root.path("choices").path(0).path("message").path("content").asText("");
        int prompt = root.path("usage").path("prompt_tokens").asInt(0);
        int completion = root.path("usage").path("completion_tokens").asInt(0);
        log.info("[agent] LLM 完成 {} tokens（入 {} / 出 {}）{}ms", prompt + completion, prompt, completion, latency);
        return new ChatResult(content, prompt, completion, latency);
    }

    /** 平台自带搜索：5 元/1000 次 */
    public List<SearchHit> search(String query, int count) {
        ObjectNode body = objectMapper.createObjectNode();
        body.put("query", query);
        body.put("count", count);
        body.put("need_content", true);

        JsonNode root = post("/v1/tools/search", body, Duration.ofSeconds(45));
        List<SearchHit> hits = new ArrayList<>();
        for (JsonNode item : root.path("results")) {
            hits.add(new SearchHit(
                    item.path("title").asText(""),
                    item.path("url").asText(""),
                    item.path("summary").asText(""),
                    item.path("content").asText(""),
                    item.path("authority").asDouble(0)));
        }
        log.info("[agent] 搜索「{}」返回 {} 条", query, hits.size());
        return hits;
    }

    private JsonNode post(String path, ObjectNode body, Duration timeout) {
        if (!enabled()) {
            throw new IllegalStateException("未配置 DEEPSEEK_API_KEY");
        }
        try {
            HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
            HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + path))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + apiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                    .timeout(timeout)
                    .build();
            HttpResponse<String> response = client
                    .sendAsync(request, HttpResponse.BodyHandlers.ofString())
                    .orTimeout(timeout.toSeconds() + 10, TimeUnit.SECONDS)
                    .join();
            if (response.statusCode() != 200) {
                throw new IllegalStateException("DeepSeek " + path + " HTTP " + response.statusCode()
                        + "：" + response.body().substring(0, Math.min(160, response.body().length())));
            }
            return objectMapper.readTree(response.body());
        } catch (Exception ex) {
            throw new IllegalStateException("调用 DeepSeek 失败：" + ex.getMessage(), ex);
        }
    }

    public Map<String, Object> status() {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("enabled", enabled());
        map.put("model", model);
        map.put("baseUrl", baseUrl);
        return map;
    }
}

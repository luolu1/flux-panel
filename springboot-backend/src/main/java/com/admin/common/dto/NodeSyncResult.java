package com.admin.common.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class NodeSyncResult {

    public static final String ADDED = "ADDED";
    public static final String ENSURED = "ENSURED";
    public static final String REPAIRED = "REPAIRED";
    public static final String SKIPPED = "SKIPPED";
    public static final String FAILED = "FAILED";

    private Long nodeId;
    private String nodeName;
    private boolean ok = true;
    private String message = "OK";
    private int added;
    private int ensured;
    private int repaired;
    private int skipped;
    private int failed;
    private List<Item> items = new ArrayList<>();

    public NodeSyncResult() {
    }

    public NodeSyncResult(Long nodeId, String nodeName) {
        this.nodeId = nodeId;
        this.nodeName = nodeName;
    }

    public static NodeSyncResult aborted(Long nodeId, String nodeName, String message) {
        NodeSyncResult result = new NodeSyncResult(nodeId, nodeName);
        result.ok = false;
        result.message = message;
        return result;
    }

    public void record(String type, String name, String action, String msg) {
        items.add(new Item(type, name, action, msg));
        switch (action) {
            case ADDED -> added++;
            case ENSURED -> ensured++;
            case REPAIRED -> repaired++;
            case SKIPPED -> skipped++;
            case FAILED -> {
                failed++;
                ok = false;
            }
            default -> throw new IllegalArgumentException("未知的同步动作: " + action);
        }
    }

    public String summary() {
        return "新增 " + added + "，修复 " + repaired + "，已存在 " + ensured + "，跳过 " + skipped + "，失败 " + failed;
    }

    @Data
    public static class Item {
        private final String type;
        private final String name;
        private final String action;
        private final String msg;
    }
}

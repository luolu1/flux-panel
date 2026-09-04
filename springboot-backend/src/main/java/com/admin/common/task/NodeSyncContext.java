package com.admin.common.task;

import com.admin.common.dto.ConfigItem;
import com.admin.common.dto.GostConfigDto;
import com.admin.common.dto.NodeSyncResult;

import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 一次同步的对账依据：节点当前已有哪些配置项。
 * <p>
 * 没有新鲜的节点上报时无从判断节点已有什么，而 gost 对重复创建返回 exists（被 GostUtil 规整成 OK），
 * 无法区分「新增」与「本来就有」，因此这种情况统一记为 ENSURED，避免结果里出现虚假的新增数。
 */
public record NodeSyncContext(Set<String> services, Set<String> chains, Set<String> limiters, boolean trustReport) {

    /** 上报的配置超过该时长即视为不可信，只做补齐、不做删除重建 */
    private static final long REPORT_FRESHNESS_MS = 60_000L;

    public static NodeSyncContext unknown() {
        return new NodeSyncContext(Collections.emptySet(), Collections.emptySet(), Collections.emptySet(), false);
    }

    public static NodeSyncContext of(GostConfigDto config, long receivedAt) {
        if (config == null || System.currentTimeMillis() - receivedAt >= REPORT_FRESHNESS_MS) {
            return unknown();
        }
        return new NodeSyncContext(
                toNames(config.getServices()),
                toNames(config.getChains()),
                toNames(config.getLimiters()),
                true);
    }

    public boolean hasService(String name) {
        return services.contains(name);
    }

    public String successAction() {
        return trustReport ? NodeSyncResult.ADDED : NodeSyncResult.ENSURED;
    }

    public String successMsg() {
        return trustReport ? "已下发" : "已确保存在";
    }

    private static Set<String> toNames(List<ConfigItem> items) {
        if (items == null) return Collections.emptySet();
        Set<String> names = new HashSet<>();
        for (ConfigItem item : items) {
            if (item != null && item.getName() != null) {
                names.add(item.getName());
            }
        }
        return names;
    }
}

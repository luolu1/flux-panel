package com.admin.common.task;

import com.admin.entity.ChainTunnel;
import com.admin.entity.Node;

import java.util.List;
import java.util.Map;

/**
 * 一条转发链的下发目标：本节点的下一跳节点列表，以及解析地址所需的节点信息。
 */
public record ChainTarget(Long tunnelId, List<ChainTunnel> hop, Map<Long, Node> nodes) {
}

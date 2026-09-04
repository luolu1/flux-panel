package com.admin.common.task;

import com.admin.common.dto.GostConfigDto;
import com.admin.common.dto.NodeSyncResult;
import com.admin.config.NodeSyncExecutorConfig;
import com.admin.entity.ChainTunnel;
import com.admin.entity.Node;
import com.admin.entity.Tunnel;
import com.admin.service.ChainTunnelService;
import com.admin.service.NodeService;
import com.admin.service.TunnelService;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * 节点配置反向同步：把面板数据库中的配置补齐到节点上。
 * <p>
 * 场景：节点所在机器损坏后，用同一条安装命令（同一 secret）在新机器上安装 agent。
 * 新机器的 gost.json 是空的，面板里该节点的限速器 / 转发链 / 转发规则不会自动生效。
 * <p>
 * 语义是「补齐缺失」而非「覆盖」：节点上已存在的配置不会被重建，因为 gost 的 UpdateService
 * 会关闭并重启服务、断开所有存活连接。唯一例外是 tcp/udp 只存在一半的转发，见 NodeConfigPusher。
 */
@Slf4j
@Service
public class NodeConfigSyncAsync {

    /** agent 先建立 WebSocket 再加载 gost.json，需要等它加载完再下发，否则下发的服务会被随后的加载覆盖 */
    private static final long ONLINE_SYNC_DELAY_MS = 20_000L;

    /** 自动同步的最小间隔，避免上线事件与配置上报事件重复下发；手动推送不受此限制 */
    private static final long SYNC_COOLDOWN_MS = 60_000L;

    private static final Set<Long> SYNCING_NODES = ConcurrentHashMap.newKeySet();

    private static final Map<Long, Long> LAST_SYNC_AT = new ConcurrentHashMap<>();

    @Resource
    private NodeService nodeService;

    @Resource
    @Lazy
    private TunnelService tunnelService;

    @Resource
    private ChainTunnelService chainTunnelService;

    @Resource
    private NodeConfigPusher pusher;

    @Resource
    @Qualifier(NodeSyncExecutorConfig.NODE_SYNC_SCHEDULER)
    private TaskScheduler nodeSyncScheduler;

    /**
     * 节点上线后同步。此时节点真实配置未知，只做补齐，不做任何删除。
     * 正常情况下 agent 启动约 10 秒后会上报配置并触发 syncReportedConfig，本方法是它的兜底。
     */
    public void syncNodeOnline(Long nodeId) {
        if (nodeId == null) return;
        nodeSyncScheduler.schedule(
                () -> syncNode(nodeId, NodeSyncContext.unknown(), false, "节点上线"),
                Instant.now().plusMillis(ONLINE_SYNC_DELAY_MS));
    }

    /**
     * 节点上报配置时同步，可精确得知节点上缺少哪些配置项。
     */
    @Async(NodeSyncExecutorConfig.NODE_SYNC_EXECUTOR)
    public void syncReportedConfig(Long nodeId, GostConfigDto gostConfig) {
        syncNode(nodeId, NodeSyncContext.of(gostConfig, System.currentTimeMillis()), false, "配置上报");
    }

    /**
     * 管理员手动推送：忽略冷却时间，同步返回每一项的处理结果。
     */
    public NodeSyncResult pushNodeConfig(Long nodeId) {
        return syncNode(nodeId, NodeSyncContext.unknown(), true, "手动推送");
    }

    private NodeSyncResult syncNode(Long nodeId, NodeSyncContext ctx, boolean force, String reason) {
        Node node = nodeService.getById(nodeId);
        String nodeName = node == null ? String.valueOf(nodeId) : node.getName();

        if (!force) {
            Long lastSyncAt = LAST_SYNC_AT.get(nodeId);
            if (lastSyncAt != null && System.currentTimeMillis() - lastSyncAt < SYNC_COOLDOWN_MS) {
                log.info("节点 {} 刚刚同步过，跳过本次({})", nodeId, reason);
                return NodeSyncResult.aborted(nodeId, nodeName, "节点刚刚同步过，请稍后重试");
            }
        }

        if (!SYNCING_NODES.add(nodeId)) {
            log.info("节点 {} 已有同步任务在执行，跳过本次({})", nodeId, reason);
            return NodeSyncResult.aborted(nodeId, nodeName, "该节点正在同步中，请稍后重试");
        }

        boolean attempted = false;
        try {
            if (node == null) {
                return NodeSyncResult.aborted(nodeId, nodeName, "节点不存在");
            }
            if (node.getStatus() == null || node.getStatus() != 1) {
                return NodeSyncResult.aborted(nodeId, nodeName, "节点不在线");
            }

            List<ChainTunnel> myChainTunnels = chainTunnelService.list(
                    new QueryWrapper<ChainTunnel>().eq("node_id", nodeId));
            if (myChainTunnels.isEmpty()) {
                return NodeSyncResult.aborted(nodeId, nodeName, "该节点未被任何隧道使用，无需同步");
            }

            attempted = true;
            NodeSyncResult result = new NodeSyncResult(nodeId, nodeName);
            doSync(node, ctx, myChainTunnels, result);
            log.info("节点 {} 配置同步完成({})：{}", nodeId, reason, result.summary());
            return result;
        } catch (Exception e) {
            log.error("节点 {} 配置同步失败({}): {}", nodeId, reason, e.getMessage(), e);
            return NodeSyncResult.aborted(nodeId, nodeName, "同步异常: " + e.getMessage());
        } finally {
            // 只在真正下发过配置后记录时间，否则「节点不在线」会白白压制之后 60 秒内的正常同步
            if (attempted && !force) {
                LAST_SYNC_AT.put(nodeId, System.currentTimeMillis());
            }
            SYNCING_NODES.remove(nodeId);
        }
    }

    private void doSync(Node node, NodeSyncContext ctx, List<ChainTunnel> myChainTunnels, NodeSyncResult result) {
        pusher.pushProtocolBlocks(node, result);

        Map<Long, List<ChainTunnel>> myRolesByTunnel = myChainTunnels.stream()
                .filter(ct -> ct.getTunnelId() != null)
                .collect(Collectors.groupingBy(ChainTunnel::getTunnelId));

        // 限速器必须先于引用它的服务下发，否则服务会引用到不存在的 limiter
        for (Long tunnelId : myRolesByTunnel.keySet()) {
            pusher.pushLimiters(node, tunnelId, ctx, result);
        }

        for (Map.Entry<Long, List<ChainTunnel>> entry : myRolesByTunnel.entrySet()) {
            syncTunnel(node, entry.getKey(), entry.getValue(), ctx, result);
        }
    }

    private void syncTunnel(Node node, Long tunnelId, List<ChainTunnel> myRoles,
                            NodeSyncContext ctx, NodeSyncResult result) {
        Tunnel tunnel = tunnelService.getById(tunnelId);
        if (tunnel == null) return; // 孤立数据交由 CheckGostConfigAsync 清理

        List<ChainTunnel> allChainTunnels = chainTunnelService.list(
                new QueryWrapper<ChainTunnel>().eq("tunnel_id", tunnelId));
        Map<Long, Node> nodes = loadNodes(allChainTunnels);
        if (nodes == null) {
            result.record("tunnel", "tunnel_" + tunnelId, NodeSyncResult.FAILED, "隧道存在缺失的节点");
            return;
        }

        List<ChainTunnel> outNodes = filterByType(allChainTunnels, 3);
        List<List<ChainTunnel>> chainNodesList = groupChainNodes(allChainTunnels);

        boolean chainReady = true;
        boolean isEntry = false;
        for (ChainTunnel myRole : myRoles) {
            Integer chainType = myRole.getChainType();
            if (chainType == null) continue;

            if (chainType == 1) {
                isEntry = true;
                if (tunnel.getType() != null && tunnel.getType() == 2) {
                    chainReady &= pusher.pushChain(node,
                            new ChainTarget(tunnelId, nextHop(chainNodesList, -1, outNodes), nodes), ctx, result);
                }
            } else if (chainType == 2) {
                int inx = myRole.getInx() == null ? 1 : myRole.getInx();
                pusher.pushChain(node,
                        new ChainTarget(tunnelId, nextHop(chainNodesList, inx - 1, outNodes), nodes), ctx, result);
                pusher.pushChainService(node, myRole, nodes, ctx, result);
            } else if (chainType == 3) {
                pusher.pushChainService(node, myRole, nodes, ctx, result);
            }
        }

        if (!isEntry) return;

        // 转发服务引用 chains_<tunnelId>，转发链缺失时下发的服务会解析到空链并静默丢包
        if (chainReady) {
            pusher.pushForwards(node, tunnel, ctx, result);
        } else {
            result.record("forward", "tunnel_" + tunnelId, NodeSyncResult.FAILED,
                    "转发链下发失败，已跳过该隧道的转发服务");
        }
    }

    /**
     * 取下一跳节点列表：hopIndex 为当前跳在 chainNodesList 中的下标（入口传 -1），
     * 没有下一跳时返回出口节点。
     */
    private List<ChainTunnel> nextHop(List<List<ChainTunnel>> chainNodesList, int hopIndex, List<ChainTunnel> outNodes) {
        int next = hopIndex + 1;
        if (next >= 0 && next < chainNodesList.size()) {
            return chainNodesList.get(next);
        }
        return outNodes;
    }

    private Map<Long, Node> loadNodes(List<ChainTunnel> chainTunnels) {
        Map<Long, Node> nodes = new HashMap<>();
        for (ChainTunnel chainTunnel : chainTunnels) {
            if (chainTunnel.getNodeId() == null) return null;
            if (nodes.containsKey(chainTunnel.getNodeId())) continue;
            Node node = nodeService.getById(chainTunnel.getNodeId());
            if (node == null) return null;
            nodes.put(node.getId(), node);
        }
        return nodes;
    }

    private List<ChainTunnel> filterByType(List<ChainTunnel> chainTunnels, int chainType) {
        return chainTunnels.stream()
                .filter(ct -> ct.getChainType() != null && ct.getChainType() == chainType)
                .collect(Collectors.toList());
    }

    private List<List<ChainTunnel>> groupChainNodes(List<ChainTunnel> chainTunnels) {
        return chainTunnels.stream()
                .filter(ct -> ct.getChainType() != null && ct.getChainType() == 2)
                .collect(Collectors.groupingBy(ct -> ct.getInx() != null ? ct.getInx() : 0))
                .entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(Map.Entry::getValue)
                .collect(Collectors.toList());
    }
}

package com.admin.common.task;

import com.admin.common.dto.GostDto;
import com.admin.common.dto.NodeSyncResult;
import com.admin.common.utils.GostUtil;
import com.admin.common.utils.WebSocketServer;
import com.admin.entity.*;
import com.admin.service.*;
import com.admin.service.impl.SpeedLimitServiceImpl;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;

import javax.annotation.Resource;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 把面板中的单个配置项下发到节点，并把结果记入 NodeSyncResult。
 * 只负责「下发一项」，遍历与顺序由 NodeConfigSyncAsync 决定。
 */
@Slf4j
@Component
public class NodeConfigPusher {

    @Resource
    @Lazy
    private ForwardService forwardService;

    @Resource
    @Lazy
    private SpeedLimitService speedLimitService;

    @Resource
    @Lazy
    private UserService userService;

    @Resource
    private ForwardPortService forwardPortService;

    @Resource
    private UserTunnelService userTunnelService;

    /**
     * 恢复面板中记录的协议屏蔽开关。新机器的 config.json 没有这几项，agent 会上报 0/0/0。
     */
    public void pushProtocolBlocks(Node node, NodeSyncResult result) {
        Integer http = node.getHttp();
        Integer tls = node.getTls();
        Integer socks = node.getSocks();
        if (isUnset(http) && isUnset(tls) && isUnset(socks)) {
            result.record("protocol", "protocol", NodeSyncResult.SKIPPED, "未设置协议屏蔽");
            return;
        }

        JSONObject req = new JSONObject();
        req.put("http", http == null ? 0 : http);
        req.put("tls", tls == null ? 0 : tls);
        req.put("socks", socks == null ? 0 : socks);

        GostDto gostDto = WebSocketServer.send_msg(node.getId(), req, "SetProtocol");
        if (Objects.equals(gostDto.getMsg(), "OK")) {
            result.record("protocol", "protocol", NodeSyncResult.ENSURED, "协议屏蔽已恢复");
        } else {
            result.record("protocol", "protocol", NodeSyncResult.FAILED, gostDto.getMsg());
        }
    }

    public void pushLimiters(Node node, Long tunnelId, NodeSyncContext ctx, NodeSyncResult result) {
        List<SpeedLimit> speedLimits = speedLimitService.list(
                new QueryWrapper<SpeedLimit>().eq("tunnel_id", tunnelId));
        for (SpeedLimit speedLimit : speedLimits) {
            if (speedLimit.getId() == null) continue;
            String name = speedLimit.getId().toString();
            if (ctx.limiters().contains(name)) {
                result.record("limiter", name, NodeSyncResult.SKIPPED, "已存在");
                continue;
            }

            GostDto gostDto = GostUtil.AddLimiters(node.getId(), speedLimit.getId(),
                    SpeedLimitServiceImpl.convertBitsToMBps(speedLimit.getSpeed()));
            if (Objects.equals(gostDto.getMsg(), "OK")) {
                result.record("limiter", name, ctx.successAction(), ctx.successMsg());
            } else {
                result.record("limiter", name, NodeSyncResult.FAILED, gostDto.getMsg());
            }
        }
    }

    public boolean pushChain(Node node, ChainTarget target, NodeSyncContext ctx, NodeSyncResult result) {
        String chainName = "chains_" + target.tunnelId();
        if (ctx.chains().contains(chainName)) {
            result.record("chain", chainName, NodeSyncResult.SKIPPED, "已存在");
            return true;
        }
        if (target.hop() == null || target.hop().isEmpty()) {
            result.record("chain", chainName, NodeSyncResult.FAILED, "隧道缺少下一跳节点");
            return false;
        }

        GostDto gostDto = GostUtil.AddChains(node.getId(), target.hop(), target.nodes());
        if (Objects.equals(gostDto.getMsg(), "OK")) {
            result.record("chain", chainName, ctx.successAction(), ctx.successMsg());
            return true;
        }
        result.record("chain", chainName, NodeSyncResult.FAILED, gostDto.getMsg());
        return false;
    }

    public void pushChainService(Node node, ChainTunnel myRole, Map<Long, Node> nodes,
                                 NodeSyncContext ctx, NodeSyncResult result) {
        String serviceName = myRole.getTunnelId() + "_tls";
        if (ctx.hasService(serviceName)) {
            result.record("service", serviceName, NodeSyncResult.SKIPPED, "已存在");
            return;
        }

        GostDto gostDto = GostUtil.AddChainService(node.getId(), myRole, nodes);
        if (Objects.equals(gostDto.getMsg(), "OK")) {
            result.record("service", serviceName, ctx.successAction(), ctx.successMsg());
        } else {
            result.record("service", serviceName, NodeSyncResult.FAILED, gostDto.getMsg());
        }
    }

    public void pushForwards(Node node, Tunnel tunnel, NodeSyncContext ctx, NodeSyncResult result) {
        List<Forward> forwards = forwardService.list(
                new QueryWrapper<Forward>().eq("tunnel_id", tunnel.getId()));
        for (Forward forward : forwards) {
            pushForward(node, tunnel, forward, ctx, result);
        }
    }

    private void pushForward(Node node, Tunnel tunnel, Forward forward, NodeSyncContext ctx, NodeSyncResult result) {
        ForwardPort forwardPort = forwardPortService.getOne(new QueryWrapper<ForwardPort>()
                .eq("forward_id", forward.getId())
                .eq("node_id", node.getId()));
        if (forwardPort == null || forwardPort.getPort() == null) {
            result.record("forward", String.valueOf(forward.getId()), NodeSyncResult.FAILED,
                    "该转发在本节点没有端口记录");
            return;
        }

        UserTunnel userTunnel = userTunnelService.getOne(new QueryWrapper<UserTunnel>()
                .eq("user_id", forward.getUserId())
                .eq("tunnel_id", tunnel.getId()));

        // 服务名末段为 0 时流量统计会跳过配额检查，普通用户缺少 user_tunnel 记录时必须放弃下发
        if (userTunnel == null && !isAdmin(forward.getUserId())) {
            result.record("forward", String.valueOf(forward.getId()), NodeSyncResult.FAILED,
                    "缺少隧道权限记录，跳过以避免流量不计费");
            return;
        }

        String serviceName = forward.getId() + "_" + forward.getUserId() + "_"
                + (userTunnel != null ? userTunnel.getId() : 0);
        boolean paused = forward.getStatus() == null || forward.getStatus() != 1;
        boolean hasTcp = ctx.hasService(serviceName + "_tcp");
        boolean hasUdp = ctx.hasService(serviceName + "_udp");

        if (hasTcp && hasUdp) {
            // agent 重启后 gost.json 里的 paused 标记不生效，服务会自动恢复运行，必须重新暂停
            if (paused) {
                applyPause(node, serviceName, result, "已存在，已重新暂停");
            } else {
                result.record("service", serviceName, NodeSyncResult.SKIPPED, "已存在");
            }
            return;
        }

        boolean repairing = false;
        if (hasTcp || hasUdp) {
            if (!ctx.trustReport()) {
                result.record("service", serviceName, NodeSyncResult.SKIPPED, "节点配置未知，跳过重建");
                return;
            }
            if (!deleteStaleHalf(node, serviceName, hasTcp, hasUdp, result)) {
                return;
            }
            repairing = true;
        }

        Integer limiter = userTunnel != null ? userTunnel.getSpeedId() : null;
        GostDto gostDto = GostUtil.AddAndUpdateService(serviceName, limiter, node, forward, forwardPort, tunnel, "AddService");
        if (!Objects.equals(gostDto.getMsg(), "OK")) {
            result.record("service", serviceName, NodeSyncResult.FAILED, gostDto.getMsg());
            return;
        }
        result.record("service", serviceName,
                repairing ? NodeSyncResult.REPAIRED : ctx.successAction(),
                repairing ? "已重建" : ctx.successMsg());

        // AddService 之后服务即开始监听，到 PauseService 之间存在一次往返的暴露窗口，agent 无法在创建时直接暂停
        if (paused) {
            applyPause(node, serviceName, result, "已暂停");
        }
    }

    /**
     * AddService 是整批校验的：tcp/udp 只剩一半时整批会失败，且错误被 GostUtil 规整成 OK，
     * 于是缺失的那一半永远补不回来。必须先删掉残留再整对重建。
     */
    private boolean deleteStaleHalf(Node node, String serviceName, boolean hasTcp, boolean hasUdp,
                                    NodeSyncResult result) {
        JSONArray stale = new JSONArray();
        if (hasTcp) stale.add(serviceName + "_tcp");
        if (hasUdp) stale.add(serviceName + "_udp");
        GostDto delDto = GostUtil.DeleteService(node.getId(), stale);
        if (Objects.equals(delDto.getMsg(), "OK")) {
            return true;
        }
        result.record("service", serviceName, NodeSyncResult.FAILED, "清理残留服务失败: " + delDto.getMsg());
        return false;
    }

    private void applyPause(Node node, String serviceName, NodeSyncResult result, String okMsg) {
        GostDto gostDto = GostUtil.PauseAndResumeService(node.getId(), serviceName, "PauseService");
        if (Objects.equals(gostDto.getMsg(), "OK")) {
            result.record("service", serviceName, NodeSyncResult.ENSURED, okMsg);
        } else {
            result.record("service", serviceName, NodeSyncResult.FAILED,
                    "暂停失败，端口可能处于开放状态: " + gostDto.getMsg());
        }
    }

    private boolean isAdmin(Integer userId) {
        if (userId == null) return false;
        User user = userService.getById(userId);
        return user != null && user.getRoleId() != null && user.getRoleId() == 0;
    }

    private boolean isUnset(Integer flag) {
        return flag == null || flag == 0;
    }
}

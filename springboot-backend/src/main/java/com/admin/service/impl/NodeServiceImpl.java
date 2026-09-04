package com.admin.service.impl;

import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.StrUtil;
import com.admin.common.dto.GostDto;
import com.admin.common.dto.NodeDto;
import com.admin.common.dto.NodeSyncResult;
import com.admin.common.dto.NodeUpdateDto;
import com.admin.common.lang.R;
import com.admin.common.task.NodeConfigSyncAsync;
import com.admin.common.utils.GostUtil;
import com.admin.common.utils.WebSocketServer;
import com.admin.config.NodeSyncExecutorConfig;
import com.admin.entity.*;
import com.admin.mapper.NodeMapper;
import com.admin.mapper.TunnelMapper;
import com.admin.service.*;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.Executor;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Value;

@Slf4j
@Service
public class NodeServiceImpl extends ServiceImpl<NodeMapper, Node> implements NodeService {


    @Resource
    @Lazy
    private TunnelService tunnelService;

    @Resource
    ViteConfigService viteConfigService;

    @Resource
    ChainTunnelService chainTunnelService;

    @Resource
    @Lazy
    NodeConfigSyncAsync nodeConfigSyncAsync;

    @Resource
    @Qualifier(NodeSyncExecutorConfig.NODE_SYNC_EXECUTOR)
    Executor nodeSyncExecutor;


    @Override
    public R createNode(NodeDto nodeDto) {
        validatePortRange(nodeDto.getPort());
        Node node = new Node();
        node.setSecret(IdUtil.simpleUUID());
        node.setStatus(0);
        node.setPort(nodeDto.getPort());
        node.setName(nodeDto.getName());
        node.setServerIp(nodeDto.getServerIp());
        long currentTime = System.currentTimeMillis();
        node.setCreatedTime(currentTime);
        node.setUpdatedTime(currentTime);
        node.setInterfaceName(nodeDto.getInterfaceName());
        this.save(node);
        return R.ok();
    }

    @Override
    public R getAllNodes() {
        List<Node> nodeList = this.list(new QueryWrapper<Node>().orderByDesc("status"));
        nodeList.forEach(node -> node.setSecret(null));
        return R.ok(nodeList);
    }

    @Override
    public R updateNode(NodeUpdateDto nodeUpdateDto) {
        Node node = this.getById(nodeUpdateDto.getId());
        if (node == null) {
            return R.err("节点不存在");
        }

        boolean online = node.getStatus() != null && node.getStatus() == 1;
        Integer newHttp = nodeUpdateDto.getHttp();
        Integer newTls = nodeUpdateDto.getTls();
        Integer newSocks = nodeUpdateDto.getSocks();

        boolean httpChanged = newHttp != null && !newHttp.equals(node.getHttp());
        boolean tlsChanged = newTls != null && !newTls.equals(node.getTls());
        boolean socksChanged = newSocks != null && !newSocks.equals(node.getSocks());

        if (online && (httpChanged || tlsChanged || socksChanged)) {
            JSONObject req = new JSONObject();
            req.put("http", newHttp);
            req.put("tls", newTls);
            req.put("socks", newSocks);

            GostDto gostResult = WebSocketServer.send_msg(node.getId(), req, "SetProtocol");
            if (!Objects.equals(gostResult.getMsg(), "OK")){
                return R.err(gostResult.getMsg());
            }
        }



        Node updateNode = buildUpdateNode(nodeUpdateDto);
        this.updateById(updateNode);
        return R.ok();
    }

    @Override
    public R deleteNode(Long id) {
        Node node = this.getById(id);
        if (node == null) {
            return R.err("节点不存在");
        }

        List<ChainTunnel> list = chainTunnelService.list(new QueryWrapper<ChainTunnel>().eq("node_id", id).groupBy("tunnel_id"));
        for (ChainTunnel tunnel : list) {
            tunnelService.deleteTunnel(tunnel.getTunnelId());
        }
        this.removeById(id);
        return R.ok();
    }


    @Override
    public R getInstallCommand(Long id) {
        Node node = this.getById(id);
        if (node == null) {
            return R.err("节点不存在");
        }
        ViteConfig viteConfig = viteConfigService.getOne(new QueryWrapper<ViteConfig>().eq("name", "ip"));
        if (viteConfig == null) return R.err("请先前往网站配置中设置ip");
        StringBuilder command = new StringBuilder();
        command.append("curl -L https://github.com/bqlpfy/flux-panel/releases/download/2.0.7-beta/install.sh")
                .append(" -o ./install.sh && chmod +x ./install.sh && ");
        String processedServerAddr = GostUtil.processServerAddress(viteConfig.getValue());
        command.append("./install.sh")
                .append(" -a ").append(processedServerAddr)  // 服务器地址
                .append(" -s ").append(node.getSecret());    // 节点密钥
        return R.ok(command);

    }


    @Override
    public R pushNodeConfig(Long id) {
        Node node = this.getById(id);
        if (node == null) {
            return R.err("节点不存在");
        }
        NodeSyncResult result = nodeConfigSyncAsync.pushNodeConfig(id);
        if (!result.isOk() && result.getItems().isEmpty()) {
            return R.err(result.getMessage());
        }
        return R.ok(result);
    }

    @Override
    public R pushAllNodeConfigs() {
        List<Node> onlineNodes = this.list(new QueryWrapper<Node>().eq("status", 1));
        if (onlineNodes.isEmpty()) {
            return R.err("没有在线节点");
        }

        List<NodeSyncResult> results = new ArrayList<>();
        // 节点之间互不影响，可并行；单节点内部必须串行以保证转发链先于服务下发
        List<CompletableFuture<NodeSyncResult>> futures = onlineNodes.stream()
                .map(node -> CompletableFuture.supplyAsync(
                        () -> nodeConfigSyncAsync.pushNodeConfig(node.getId()), nodeSyncExecutor))
                .collect(Collectors.toList());
        for (CompletableFuture<NodeSyncResult> future : futures) {
            try {
                results.add(future.join());
            } catch (CompletionException e) {
                log.info("批量推送节点配置失败: {}", e.getMessage(), e);
            }
        }

        JSONObject data = new JSONObject();
        data.put("total", onlineNodes.size());
        data.put("successCount", results.stream().filter(NodeSyncResult::isOk).count());
        data.put("failCount", results.stream().filter(r -> !r.isOk()).count());
        data.put("results", results);
        return R.ok(data);
    }


    private Node buildUpdateNode(NodeUpdateDto nodeUpdateDto) {
        validatePortRange(nodeUpdateDto.getPort());
        Node node = new Node();
        node.setId(nodeUpdateDto.getId());
        node.setName(nodeUpdateDto.getName());
        node.setServerIp(nodeUpdateDto.getServerIp());
        node.setPort(nodeUpdateDto.getPort());
        node.setHttp(nodeUpdateDto.getHttp());
        node.setTls(nodeUpdateDto.getTls());
        node.setSocks(nodeUpdateDto.getSocks());
        node.setUpdatedTime(System.currentTimeMillis());
        node.setInterfaceName(nodeUpdateDto.getInterfaceName());
        node.setTcpListenAddr(nodeUpdateDto.getTcpListenAddr());
        node.setUdpListenAddr(nodeUpdateDto.getUdpListenAddr());
        return node;
    }


    private void validatePortRange(String port) {
        Pattern PORT_PATTERN = Pattern.compile(   "([0-9]{1,5})(-([0-9]{1,5}))?");
        if (port == null || port.isEmpty()) {
            throw new RuntimeException("可用端口不合法");
        }
        String[] parts = port.split(",");
        for (String part : parts) {
            part = part.trim();
            if (!PORT_PATTERN.matcher(part).matches()) {
                throw new RuntimeException("可用端口不合法");
            }
            if (part.contains("-")) {
                String[] range = part.split("-");
                int start = Integer.parseInt(range[0]);
                int end = Integer.parseInt(range[1]);
                if (start < 0 || end < 0 || end > 65535 || start > end) {
                    throw new RuntimeException("可用端口不合法");
                }
            } else {
                int ports = Integer.parseInt(part);
                if (ports < 0 || ports > 65535) {
                    throw new RuntimeException("可用端口不合法");
                }
            }
        }
    }




}

package com.admin.service.impl;

import com.admin.common.dto.*;

import com.admin.common.lang.R;
import com.admin.common.utils.GostUtil;
import com.admin.common.utils.JwtUtil;
import com.admin.common.utils.WebSocketServer;
import com.admin.entity.*;
import com.admin.mapper.TunnelMapper;
import com.admin.mapper.UserTunnelMapper;
import com.admin.service.*;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import lombok.Data;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.*;
import java.util.stream.Collectors;

/**
 *
 * @author QAQ
 * @since 2025-06-03
 */
@Service
public class TunnelServiceImpl extends ServiceImpl<TunnelMapper, Tunnel> implements TunnelService {


    @Resource
    UserTunnelMapper userTunnelMapper;

    @Resource
    NodeService nodeService;

    @Resource
    ForwardService forwardService;

    @Resource
    UserTunnelService userTunnelService;

    @Resource
    ChainTunnelService chainTunnelService;

    @Resource
    ForwardPortService forwardPortService;

    @Resource
    private com.admin.common.task.NodeConfigSyncAsync nodeConfigSyncAsync;

    @Override
    public R createTunnel(TunnelDto tunnelDto) {

        int count = this.count(new QueryWrapper<Tunnel>().eq("name", tunnelDto.getName()));
        if (count > 0) return R.err("隧道名称重复");
        if (tunnelDto.getType() == 2 && tunnelDto.getOutNodeId() == null) return R.err("出口不能为空");


        List<ChainTunnel> chainTunnels = new ArrayList<>();
        Map<Long, Node> nodes = new HashMap<>();

        List<Long> node_ids = new ArrayList<>();
        for (ChainTunnel in_node : tunnelDto.getInNodeId()) {
            node_ids.add(in_node.getNodeId());
            chainTunnels.add(in_node);

            Node node = nodeService.getById(in_node.getNodeId());
            if (node == null) return R.err("节点不存在");
            nodes.put(node.getId(), node);
        }

        if (tunnelDto.getType() == 2) {
            // 处理转发链节点，为每一跳设置inx
            int inx = 1;
            for (List<ChainTunnel> chainNode : tunnelDto.getChainNodes()) {
                for (ChainTunnel chain_node : chainNode) {
                    node_ids.add(chain_node.getNodeId());
                    Node node = nodeService.getById(chain_node.getNodeId());
                    if (node == null) return R.err("节点不存在");
                    nodes.put(node.getId(), node);
                    Integer nodePort = getNodePort(chain_node.getNodeId());
                    chain_node.setPort(nodePort);
                    chain_node.setInx(inx); // 设置转发链序号
                    chainTunnels.add(chain_node);
                }
                inx++; // 每一跳递增
            }
            for (ChainTunnel out_node : tunnelDto.getOutNodeId()) {
                node_ids.add(out_node.getNodeId());
                Node node = nodeService.getById(out_node.getNodeId());
                if (node == null) return R.err("节点不存在");
                nodes.put(node.getId(), node);
                Integer nodePort = getNodePort(out_node.getNodeId());
                out_node.setPort(nodePort);
                chainTunnels.add(out_node);
            }

        }
        Set<Long> set = new HashSet<>(node_ids);
        boolean hasDuplicate = set.size() != node_ids.size();
        if (hasDuplicate) return R.err("节点重复");

        List<Node> list = nodeService.list(new QueryWrapper<Node>().in("id", node_ids));
        if (list.size() != node_ids.size()) return R.err("部分节点不存在");
        for (Node node : list) {
            if (node.getStatus() != 1) return R.err("部分节点不在线");
        }


        Tunnel tunnel = new Tunnel();
        BeanUtils.copyProperties(tunnelDto, tunnel);
        tunnel.setStatus(1);
        long currentTime = System.currentTimeMillis();
        tunnel.setCreatedTime(currentTime);
        tunnel.setUpdatedTime(currentTime);
        if (StringUtils.isEmpty(tunnel.getInIp())){
            StringBuilder in_ip = new StringBuilder();
            for (ChainTunnel chainTunnel : tunnelDto.getInNodeId()) {
                Node node = nodes.get(chainTunnel.getNodeId());
                in_ip.append(node.getServerIp()).append(",");
            }
            in_ip.deleteCharAt(in_ip.length() - 1);
            tunnel.setInIp(in_ip.toString());
        }

        this.save(tunnel);
        for (ChainTunnel chainTunnel : chainTunnels) {
            chainTunnel.setTunnelId(tunnel.getId());
        }
        chainTunnelService.saveBatch(chainTunnels);

        List<JSONObject> chain_success = new ArrayList<>();
        List<JSONObject> service_success = new ArrayList<>();



        if (tunnel.getType() == 2) {

            for (ChainTunnel in_node : tunnelDto.getInNodeId()) {
                // 创建Chain， 指向chainNode的第一跳。如果chainNode为空就是指向出口
                if (tunnelDto.getChainNodes().isEmpty()) { // 指向出口
                    GostDto gostDto = GostUtil.AddChains(in_node.getNodeId(), tunnelDto.getOutNodeId(), nodes);
                    isError(gostDto);

                } else {
                    GostDto gostDto = GostUtil.AddChains(in_node.getNodeId(), tunnelDto.getChainNodes().getFirst(), nodes);// 指向第一跳
                    if (Objects.equals(gostDto.getMsg(), "OK")){
                        JSONObject data = new JSONObject();
                        data.put("node_id", in_node.getNodeId());
                        data.put("name", "chains_" + tunnel.getId());
                        chain_success.add(data);
                    }else {
                        this.removeById(tunnel.getId());
                        chainTunnelService.remove(new QueryWrapper<ChainTunnel>().eq("tunnel_id", tunnel.getId()));
                        for (JSONObject chainSuccess : chain_success) {
                            GostDto deleteChains = GostUtil.DeleteChains(chainSuccess.getLong("node_id"), chainSuccess.getString("name"));
                            System.out.println(deleteChains);
                        }
                        return R.err(gostDto.getMsg());
                    }
                }
            }

            for (int i = 0; i < tunnelDto.getChainNodes().size(); i++) {
                //  创建Chain和Service。每一条的Chain都是指向下一跳。最后一跳指向出口， Service是监听端口
                List<ChainTunnel> chainTunnels1 = tunnelDto.getChainNodes().get(i);
                for (ChainTunnel chainTunnel : chainTunnels1) {
                    int inx = i+1;
                    if (inx >= tunnelDto.getChainNodes().size()) { // 指向出口
                        GostDto gostDto = GostUtil.AddChains(chainTunnel.getNodeId(), tunnelDto.getOutNodeId(), nodes);
                        if (Objects.equals(gostDto.getMsg(), "OK")){
                            JSONObject data = new JSONObject();
                            data.put("node_id", chainTunnel.getNodeId());
                            data.put("name", "chains_" + tunnel.getId());
                            chain_success.add(data);
                        }else {
                            this.removeById(tunnel.getId());
                            chainTunnelService.remove(new QueryWrapper<ChainTunnel>().eq("tunnel_id", tunnel.getId()));
                            for (JSONObject chainSuccess : chain_success) {
                                GostDto deleteChains = GostUtil.DeleteChains(chainSuccess.getLong("node_id"), chainSuccess.getString("name"));
                                System.out.println(deleteChains);
                            }
                            return R.err(gostDto.getMsg());
                        }
                    } else {
                        GostDto gostDto = GostUtil.AddChains(chainTunnel.getNodeId(), tunnelDto.getChainNodes().get(inx), nodes);
                        if (Objects.equals(gostDto.getMsg(), "OK")){
                            JSONObject data = new JSONObject();
                            data.put("node_id", chainTunnel.getNodeId());
                            data.put("name", "chains_" + tunnel.getId());
                            chain_success.add(data);
                        }else {
                            this.removeById(tunnel.getId());
                            chainTunnelService.remove(new QueryWrapper<ChainTunnel>().eq("tunnel_id", tunnel.getId()));
                            for (JSONObject chainSuccess : chain_success) {
                                GostDto deleteChains = GostUtil.DeleteChains(chainSuccess.getLong("node_id"), chainSuccess.getString("name"));
                                System.out.println(deleteChains);
                            }
                            return R.err(gostDto.getMsg());
                        }
                    }

                    GostDto gostDto = GostUtil.AddChainService(chainTunnel.getNodeId(), chainTunnel, nodes);
                    if (Objects.equals(gostDto.getMsg(), "OK")){
                        JSONObject data = new JSONObject();
                        data.put("node_id", chainTunnel.getNodeId());
                        data.put("name", tunnel.getId() + "_tls");
                        service_success.add(data);
                    }else {
                        this.removeById(tunnel.getId());
                        chainTunnelService.remove(new QueryWrapper<ChainTunnel>().eq("tunnel_id", tunnel.getId()));
                        for (JSONObject serviceSuccess : service_success) {
                            JSONArray jsonArray = new JSONArray();
                            jsonArray.add(serviceSuccess.getString("name"));
                            GostDto deleteService = GostUtil.DeleteService(serviceSuccess.getLong("node_id"), jsonArray);
                            System.out.println(deleteService);
                        }
                        return R.err(gostDto.getMsg());
                    }
                }

            }


            for (ChainTunnel out_node : tunnelDto.getOutNodeId()) {
                GostDto gostDto = GostUtil.AddChainService(out_node.getNodeId(), out_node, nodes);
                if (Objects.equals(gostDto.getMsg(), "OK")){
                    JSONObject data = new JSONObject();
                    data.put("node_id", out_node.getNodeId());
                    data.put("name", tunnel.getId() + "_tls");
                    service_success.add(data);
                }else {
                    this.removeById(tunnel.getId());
                    chainTunnelService.remove(new QueryWrapper<ChainTunnel>().eq("tunnel_id", tunnel.getId()));
                    for (JSONObject serviceSuccess : service_success) {
                        JSONArray jsonArray = new JSONArray();
                        jsonArray.add(serviceSuccess.getString("name"));
                        GostDto deleteService = GostUtil.DeleteService(serviceSuccess.getLong("node_id"), jsonArray);
                        System.out.println(deleteService);
                    }
                    return R.err(gostDto.getMsg());
                }
            }

        }
        return R.ok();
    }


    @Override
    public R getAllTunnels() {
        List<Tunnel> tunnelList = this.list();
        
        // 查询所有隧道的ChainTunnel信息
        List<Long> tunnelIds = tunnelList.stream()
                .map(Tunnel::getId)
                .collect(Collectors.toList());
        
        if (tunnelIds.isEmpty()) {
            return R.ok(new ArrayList<TunnelDetailDto>());
        }
        
        // 批量查询所有ChainTunnel记录
        List<ChainTunnel> allChainTunnels = chainTunnelService.list(
                new QueryWrapper<ChainTunnel>().in("tunnel_id", tunnelIds)
        );
        
        // 按tunnelId分组
        Map<Long, List<ChainTunnel>> chainTunnelMap = allChainTunnels.stream()
                .collect(Collectors.groupingBy(ChainTunnel::getTunnelId));
        
        // 转换为TunnelDetailDto列表
        List<TunnelDetailDto> detailDtoList = tunnelList.stream()
                .map(tunnel -> {
                    TunnelDetailDto detailDto = new TunnelDetailDto();
                    BeanUtils.copyProperties(tunnel, detailDto);
                    
                    List<ChainTunnel> chainTunnels = chainTunnelMap.getOrDefault(tunnel.getId(), new ArrayList<>());
                    
                    // 按chainType分类节点
                    // 入口节点 (chainType = 1)
                    List<ChainTunnel> inNodes = chainTunnels.stream()
                            .filter(ct -> ct.getChainType() != null && ct.getChainType() == 1)
                            .collect(Collectors.toList());
                    detailDto.setInNodeId(inNodes);

                    detailDto.setInIp(tunnel.getInIp());
                    
                    // 转发链节点 (chainType = 2) - 按inx分组
                    Map<Integer, List<ChainTunnel>> chainNodesMap = chainTunnels.stream()
                            .filter(ct -> ct.getChainType() != null && ct.getChainType() == 2)
                            .collect(Collectors.groupingBy(
                                    ct -> ct.getInx() != null ? ct.getInx() : 0,
                                    Collectors.toList()
                            ));
                    
                    // 将Map转换为按inx排序的二维列表
                    List<List<ChainTunnel>> chainNodesList = chainNodesMap.entrySet().stream()
                            .sorted(Map.Entry.comparingByKey())
                            .map(Map.Entry::getValue)
                            .collect(Collectors.toList());
                    detailDto.setChainNodes(chainNodesList);
                    
                    // 出口节点 (chainType = 3)
                    List<ChainTunnel> outNodes = chainTunnels.stream()
                            .filter(ct -> ct.getChainType() != null && ct.getChainType() == 3)
                            .collect(Collectors.toList());
                    detailDto.setOutNodeId(outNodes);
                    
                    return detailDto;
                })
                .collect(Collectors.toList());
        
        return R.ok(detailDtoList);
    }


    @Override
    @Transactional
    public R updateTunnel(TunnelUpdateDto tunnelUpdateDto) {
        Tunnel existingTunnel = this.getById(tunnelUpdateDto.getId());
        if (existingTunnel == null) return R.err("隧道不存在");

        if (tunnelUpdateDto.getInNodeId() == null || tunnelUpdateDto.getInNodeId().isEmpty()) {
            return R.err("入口节点不能为空");
        }
        if (existingTunnel.getType() == 2 && (tunnelUpdateDto.getOutNodeId() == null
                || tunnelUpdateDto.getOutNodeId().isEmpty())) {
            return R.err("出口不能为空");
        }

        List<ChainTunnel> requested = buildUpdatedTopology(existingTunnel, tunnelUpdateDto);
        Set<Long> requestedNodeIds = requested.stream().map(ChainTunnel::getNodeId).collect(Collectors.toSet());
        Map<Long, Node> requestedNodes = loadNodes(requestedNodeIds);
        if (requestedNodes.size() != requestedNodeIds.size()) return R.err("部分节点不存在");
        if (requestedNodeIds.size() != requested.size()) return R.err("节点重复");

        List<ChainTunnel> oldTopology = chainTunnelService.list(
                new QueryWrapper<ChainTunnel>().eq("tunnel_id", existingTunnel.getId()));
        Set<Long> oldNodeIds = oldTopology.stream().map(ChainTunnel::getNodeId).collect(Collectors.toSet());
        cleanupOldTopology(existingTunnel, oldTopology);

        List<Forward> forwards = forwardService.list(
                new QueryWrapper<Forward>().eq("tunnel_id", existingTunnel.getId()));
        Set<Long> newEntryIds = requested.stream().filter(ct -> ct.getChainType() == 1)
                .map(ChainTunnel::getNodeId).collect(Collectors.toSet());
        reassignForwardPorts(forwards, newEntryIds);

        for (ChainTunnel chainTunnel : requested) {
            chainTunnel.setTunnelId(existingTunnel.getId());
            if (chainTunnel.getChainType() == 2 || chainTunnel.getChainType() == 3) {
                chainTunnel.setPort(getNodePort(chainTunnel.getNodeId()));
            }
        }
        chainTunnelService.saveBatch(requested);
        Tunnel tunnel = new Tunnel();
        tunnel.setId(tunnelUpdateDto.getId());
        tunnel.setName(tunnelUpdateDto.getName());
        tunnel.setFlow(tunnelUpdateDto.getFlow());
        tunnel.setTrafficRatio(tunnelUpdateDto.getTrafficRatio());
        tunnel.setInIp(tunnelUpdateDto.getInIp());

        if (StringUtils.isEmpty(tunnel.getInIp())){
            StringBuilder in_ip = new StringBuilder();
            List<ChainTunnel> chainTunnels = requested.stream().filter(ct -> ct.getChainType() == 1).toList();
            for (ChainTunnel chainTunnel : chainTunnels) {
                Node node = nodeService.getById(chainTunnel.getNodeId());
                if (node == null)return R.err("隧道节点数据错误，部分节点不存在");
                in_ip.append(node.getServerIp()).append(",");
            }
            in_ip.deleteCharAt(in_ip.length() - 1);
            tunnel.setInIp(in_ip.toString());
        }

        this.updateById(tunnel);
        Set<Long> syncNodeIds = new HashSet<>(requestedNodeIds);
        syncNodeIds.addAll(oldNodeIds);
        nodeConfigSyncAsync.syncNodes(syncNodeIds);
        return R.ok();
    }

    private List<ChainTunnel> buildUpdatedTopology(Tunnel tunnel, TunnelUpdateDto dto) {
        List<ChainTunnel> result = new ArrayList<>();
        for (ChainTunnel source : dto.getInNodeId()) {
            ChainTunnel item = copyChainTunnel(source, 1, null);
            result.add(item);
        }
        if (tunnel.getType() == 2) {
            List<List<ChainTunnel>> groups = dto.getChainNodes() == null ? Collections.emptyList() : dto.getChainNodes();
            for (int i = 0; i < groups.size(); i++) {
                for (ChainTunnel source : groups.get(i)) {
                    result.add(copyChainTunnel(source, 2, i + 1));
                }
            }
            for (ChainTunnel source : dto.getOutNodeId()) {
                result.add(copyChainTunnel(source, 3, null));
            }
        }
        return result;
    }

    private ChainTunnel copyChainTunnel(ChainTunnel source, int type, Integer inx) {
        ChainTunnel item = new ChainTunnel();
        item.setNodeId(source.getNodeId());
        item.setChainType(type);
        item.setInx(inx);
        item.setProtocol(source.getProtocol());
        item.setStrategy(source.getStrategy());
        return item;
    }

    private Map<Long, Node> loadNodes(Set<Long> nodeIds) {
        Map<Long, Node> nodes = new HashMap<>();
        for (Long nodeId : nodeIds) {
            Node node = nodeService.getById(nodeId);
            if (node != null) nodes.put(nodeId, node);
        }
        return nodes;
    }

    private void cleanupOldTopology(Tunnel tunnel, List<ChainTunnel> oldTopology) {
        List<Forward> forwards = forwardService.list(new QueryWrapper<Forward>().eq("tunnel_id", tunnel.getId()));
        for (ChainTunnel chainTunnel : oldTopology) {
            if (chainTunnel.getNodeId() == null) continue;
            if (chainTunnel.getChainType() == 1) {
                for (Forward forward : forwards) {
                    UserTunnel userTunnel = userTunnelService.getOne(new QueryWrapper<UserTunnel>()
                            .eq("user_id", forward.getUserId()).eq("tunnel_id", tunnel.getId()));
                    String serviceName = forward.getId() + "_" + forward.getUserId() + "_"
                            + (userTunnel == null ? 0 : userTunnel.getId());
                    JSONArray services = new JSONArray();
                    services.add(serviceName + "_tcp");
                    services.add(serviceName + "_udp");
                    GostUtil.DeleteService(chainTunnel.getNodeId(), services);
                }
                GostUtil.DeleteChains(chainTunnel.getNodeId(), "chains_" + tunnel.getId());
                continue;
            }
            if (chainTunnel.getChainType() == 1 || chainTunnel.getChainType() == 2) {
                GostUtil.DeleteChains(chainTunnel.getNodeId(), "chains_" + tunnel.getId());
            }
            if (chainTunnel.getChainType() == 2 || chainTunnel.getChainType() == 3) {
                JSONArray services = new JSONArray();
                services.add(tunnel.getId() + "_tls");
                GostUtil.DeleteService(chainTunnel.getNodeId(), services);
            }
        }
        chainTunnelService.remove(new QueryWrapper<ChainTunnel>().eq("tunnel_id", tunnel.getId()));
    }

    private void reassignForwardPorts(List<Forward> forwards, Set<Long> newEntryIds) {
        for (Forward forward : forwards) {
            List<ForwardPort> oldPorts = forwardPortService.list(
                    new QueryWrapper<ForwardPort>().eq("forward_id", forward.getId()));
            Map<Long, ForwardPort> byNode = oldPorts.stream().collect(Collectors.toMap(
                    ForwardPort::getNodeId, p -> p, (left, right) -> left));
            for (ForwardPort port : oldPorts) {
                if (!newEntryIds.contains(port.getNodeId())) forwardPortService.removeById(port.getId());
            }
            for (Long nodeId : newEntryIds) {
                if (byNode.containsKey(nodeId)) continue;
                ForwardPort port = new ForwardPort();
                port.setForwardId(forward.getId());
                port.setNodeId(nodeId);
                port.setPort(findFreeForwardPort(nodeId));
                forwardPortService.save(port);
            }
        }
    }

    private Integer findFreeForwardPort(Long nodeId) {
        Node node = nodeService.getById(nodeId);
        Set<Integer> used = new HashSet<>();
        chainTunnelService.list(new QueryWrapper<ChainTunnel>().eq("node_id", nodeId))
                .stream().map(ChainTunnel::getPort).filter(Objects::nonNull).forEach(used::add);
        forwardPortService.list(new QueryWrapper<ForwardPort>().eq("node_id", nodeId))
                .stream().map(ForwardPort::getPort).filter(Objects::nonNull).forEach(used::add);
        return parsePorts(node.getPort()).stream().filter(p -> !used.contains(p)).findFirst()
                .orElseThrow(() -> new IllegalStateException("节点端口已满，无可用端口"));
    }


    @Override
    public R deleteTunnel(Long id) {
        Tunnel tunnel = this.getById(id);
        if (tunnel == null) return R.err("隧道不存在");
        List<Forward> forwardList = forwardService.list(new QueryWrapper<Forward>().eq("tunnel_id", id));
        for (Forward forward : forwardList) {
            forwardService.deleteForward(forward.getId());
        }
        forwardService.remove(new QueryWrapper<Forward>().eq("tunnel_id", id));
        userTunnelService.remove(new QueryWrapper<UserTunnel>().eq("tunnel_id", id));
        this.removeById(id);

        List<ChainTunnel> chainTunnels = chainTunnelService.list(new QueryWrapper<ChainTunnel>().eq("tunnel_id", id));
        for (ChainTunnel chainTunnel : chainTunnels) {
            if (chainTunnel.getChainType() == 1){ // 入口
                GostUtil.DeleteChains(chainTunnel.getNodeId(), "chains_" + chainTunnel.getTunnelId());
            }
            else if (chainTunnel.getChainType() == 2){ // 链
                GostUtil.DeleteChains(chainTunnel.getNodeId(), "chains_" + chainTunnel.getTunnelId());
                JSONArray services = new JSONArray();
                services.add(chainTunnel.getTunnelId() + "_tls");
                GostUtil.DeleteService(chainTunnel.getNodeId(), services);
            }
            else { // 出口
                JSONArray services = new JSONArray();
                services.add(chainTunnel.getTunnelId() + "_tls");
                GostUtil.DeleteService(chainTunnel.getNodeId(), services);
            }
        }
        chainTunnelService.remove(new QueryWrapper<ChainTunnel>().eq("tunnel_id", id));
        return R.ok();
    }


    @Override
    public R userTunnel() {
        List<Tunnel> tunnelEntities;
        Integer roleId = JwtUtil.getRoleIdFromToken();
        Integer userId = JwtUtil.getUserIdFromToken();
        if (roleId == 0) {
            tunnelEntities = this.list(new QueryWrapper<Tunnel>().eq("status", 1));
        } else {
            tunnelEntities = java.util.Collections.emptyList(); // 返回空列表
            List<UserTunnel> userTunnels = userTunnelMapper.selectList(
                    new QueryWrapper<UserTunnel>().eq("user_id", userId)
            );
            if (!userTunnels.isEmpty()) {
                List<Integer> tunnelIds = userTunnels.stream()
                        .map(UserTunnel::getTunnelId)
                        .collect(Collectors.toList());
                tunnelEntities = this.list(new QueryWrapper<Tunnel>()
                        .in("id", tunnelIds)
                        .eq("status", 1));
            }

        }
        return R.ok(tunnelEntities);
    }


    @Override
    public R diagnoseTunnel(Long tunnelId) {
        Tunnel tunnel = this.getById(tunnelId);
        if (tunnel == null) {
            return R.err("隧道不存在");
        }

        List<ChainTunnel> chainTunnels = chainTunnelService.list(
                new QueryWrapper<ChainTunnel>().eq("tunnel_id", tunnelId)
        );

        if (chainTunnels.isEmpty()) {
            return R.err("隧道配置不完整");
        }

        List<ChainTunnel> inNodes = chainTunnels.stream()
                .filter(ct -> ct.getChainType() == 1)
                .toList();

        Map<Integer, List<ChainTunnel>> chainNodesMap = chainTunnels.stream()
                .filter(ct -> ct.getChainType() == 2)
                .collect(Collectors.groupingBy(
                        ct -> ct.getInx() != null ? ct.getInx() : 0,
                        Collectors.toList()
                ));

        List<List<ChainTunnel>> chainNodesList = chainNodesMap.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(Map.Entry::getValue)
                .toList();

        List<ChainTunnel> outNodes = chainTunnels.stream()
                .filter(ct -> ct.getChainType() == 3)
                .toList();

        List<DiagnosisResult> results = new ArrayList<>();

        if (tunnel.getType() == 1) {
            for (ChainTunnel inNode : inNodes) {
                Node node = nodeService.getById(inNode.getNodeId());
                if (node != null) {
                    DiagnosisResult result = performTcpPingDiagnosisWithConnectionCheck(
                            node, "www.google.com", 443, "入口(" + node.getName() + ")->外网"
                    );
                    result.setFromChainType(1); // 入口
                    results.add(result);
                }
            }
        } else if (tunnel.getType() == 2) {
            for (ChainTunnel inNode : inNodes) {
                Node fromNode = nodeService.getById(inNode.getNodeId());
                
                if (fromNode != null) {
                    if (!chainNodesList.isEmpty()) {
                        for (ChainTunnel firstChainNode : chainNodesList.getFirst()) {
                            Node toNode = nodeService.getById(firstChainNode.getNodeId());
                            if (toNode != null) {
                                DiagnosisResult result = performTcpPingDiagnosisWithConnectionCheck(
                                        fromNode, toNode.getServerIp(), firstChainNode.getPort(),
                                        "入口(" + fromNode.getName() + ")->第1跳(" + toNode.getName() + ")"
                                );
                                result.setFromChainType(1); // 入口
                                result.setToChainType(2); // 链
                                result.setToInx(firstChainNode.getInx());
                                results.add(result);
                            }
                        }
                    } else if (!outNodes.isEmpty()) {
                        for (ChainTunnel outNode : outNodes) {
                            Node toNode = nodeService.getById(outNode.getNodeId());
                            if (toNode != null) {
                                DiagnosisResult result = performTcpPingDiagnosisWithConnectionCheck(
                                        fromNode, toNode.getServerIp(), outNode.getPort(),
                                        "入口(" + fromNode.getName() + ")->出口(" + toNode.getName() + ")"
                                );
                                result.setFromChainType(1);
                                result.setToChainType(3);
                                results.add(result);
                            }
                        }
                    }
                }
            }

            for (int i = 0; i < chainNodesList.size(); i++) {
                List<ChainTunnel> currentHop = chainNodesList.get(i);
                
                for (ChainTunnel currentNode : currentHop) {
                    Node fromNode = nodeService.getById(currentNode.getNodeId());
                    
                    if (fromNode != null) {
                        if (i + 1 < chainNodesList.size()) {
                            for (ChainTunnel nextNode : chainNodesList.get(i + 1)) {
                                Node toNode = nodeService.getById(nextNode.getNodeId());
                                if (toNode != null) {
                                    DiagnosisResult result = performTcpPingDiagnosisWithConnectionCheck(
                                            fromNode, toNode.getServerIp(), nextNode.getPort(),
                                            "第" + (i + 1) + "跳(" + fromNode.getName() + ")->第" + (i + 2) + "跳(" + toNode.getName() + ")"
                                    );
                                    result.setFromChainType(2);
                                    result.setFromInx(currentNode.getInx());
                                    result.setToChainType(2);
                                    result.setToInx(nextNode.getInx());
                                    results.add(result);
                                }
                            }
                        } else if (!outNodes.isEmpty()) {
                            for (ChainTunnel outNode : outNodes) {
                                Node toNode = nodeService.getById(outNode.getNodeId());
                                if (toNode != null) {
                                    DiagnosisResult result = performTcpPingDiagnosisWithConnectionCheck(
                                            fromNode, toNode.getServerIp(), outNode.getPort(),
                                            "第" + (i + 1) + "跳(" + fromNode.getName() + ")->出口(" + toNode.getName() + ")"
                                    );
                                    result.setFromChainType(2);
                                    result.setFromInx(currentNode.getInx());
                                    result.setToChainType(3);
                                    results.add(result);
                                }
                            }
                        }
                    }
                }
            }
            for (ChainTunnel outNode : outNodes) {
                Node node = nodeService.getById(outNode.getNodeId());
                if (node != null) {
                    DiagnosisResult result = performTcpPingDiagnosisWithConnectionCheck(
                            node, "www.google.com", 443, "出口(" + node.getName() + ")->外网"
                    );
                    result.setFromChainType(3);
                    results.add(result);
                }
            }
        }

        Map<String, Object> diagnosisReport = new HashMap<>();
        diagnosisReport.put("tunnelId", tunnelId);
        diagnosisReport.put("tunnelName", tunnel.getName());
        diagnosisReport.put("tunnelType", tunnel.getType() == 1 ? "端口转发" : "隧道转发");
        diagnosisReport.put("results", results);
        diagnosisReport.put("timestamp", System.currentTimeMillis());

        return R.ok(diagnosisReport);
    }

    public Integer getNodePort(Long nodeId) {

        Node node = nodeService.getById(nodeId);
        if (node == null){
            throw new RuntimeException("节点不存在");
        }

        // 1. 查询隧道转发链占用的端口
        List<ChainTunnel> chainTunnels = chainTunnelService.list(
                new QueryWrapper<ChainTunnel>().eq("node_id", nodeId)
        );
        Set<Integer> usedPorts = chainTunnels.stream()
                .map(ChainTunnel::getPort)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());


        List<ForwardPort> list = forwardPortService.list(new QueryWrapper<ForwardPort>().eq("node_id", nodeId));
        Set<Integer> forwardUsedPorts = new HashSet<>();
        for (ForwardPort forwardPort : list) {
            forwardUsedPorts.add(forwardPort.getPort());
        }
        usedPorts.addAll(forwardUsedPorts);

        // 3. 从可用端口范围中筛选未被占用的端口
        List<Integer> parsedPorts = parsePorts(node.getPort());
        List<Integer> availablePorts = parsedPorts.stream()
                .filter(p -> !usedPorts.contains(p))
                .toList();

        if (availablePorts.isEmpty()) {
            throw new RuntimeException("节点端口已满，无可用端口");
        }
        return availablePorts.getFirst();
    }

    public static List<Integer> parsePorts(String input) {
        Set<Integer> set = new HashSet<>();
        String[] parts = input.split(",");
        for (String part : parts) {
            part = part.trim();
            if (part.contains("-")) {
                String[] range = part.split("-");
                int start = Integer.parseInt(range[0]);
                int end = Integer.parseInt(range[1]);
                for (int i = start; i <= end; i++) {
                    set.add(i);
                }
            } else {
                set.add(Integer.parseInt(part));
            }
        }
        return set.stream().sorted().collect(Collectors.toList());
    }

    private void isError(GostDto gostDto){

    }

    private DiagnosisResult performTcpPingDiagnosis(Node node, String targetIp, int port, String description) {
        try {
            // 构建TCP ping请求数据
            JSONObject tcpPingData = new JSONObject();
            tcpPingData.put("ip", targetIp);
            tcpPingData.put("port", port);
            tcpPingData.put("count", 4);
            tcpPingData.put("timeout", 5000); // 5秒超时

            // 发送TCP ping命令到节点
            GostDto gostResult = WebSocketServer.send_msg(node.getId(), tcpPingData, "TcpPing");

            DiagnosisResult result = new DiagnosisResult();
            result.setNodeId(node.getId());
            result.setNodeName(node.getName());
            result.setTargetIp(targetIp);
            result.setTargetPort(port);
            result.setDescription(description);
            result.setTimestamp(System.currentTimeMillis());

            if (gostResult != null && "OK".equals(gostResult.getMsg())) {
                // 尝试解析TCP ping响应数据
                try {
                    if (gostResult.getData() != null) {
                        JSONObject tcpPingResponse = (JSONObject) gostResult.getData();
                        boolean success = tcpPingResponse.getBooleanValue("success");

                        result.setSuccess(success);
                        if (success) {
                            result.setMessage("TCP连接成功");
                            result.setAverageTime(tcpPingResponse.getDoubleValue("averageTime"));
                            result.setPacketLoss(tcpPingResponse.getDoubleValue("packetLoss"));
                        } else {
                            result.setMessage(tcpPingResponse.getString("errorMessage"));
                            result.setAverageTime(-1.0);
                            result.setPacketLoss(100.0);
                        }
                    } else {
                        // 没有详细数据，使用默认值
                        result.setSuccess(true);
                        result.setMessage("TCP连接成功");
                        result.setAverageTime(0.0);
                        result.setPacketLoss(0.0);
                    }
                } catch (Exception e) {
                    // 解析响应数据失败，但TCP ping命令本身成功了
                    result.setSuccess(true);
                    result.setMessage("TCP连接成功，但无法解析详细数据");
                    result.setAverageTime(0.0);
                    result.setPacketLoss(0.0);
                }
            } else {
                result.setSuccess(false);
                result.setMessage(gostResult != null ? gostResult.getMsg() : "节点无响应");
                result.setAverageTime(-1.0);
                result.setPacketLoss(100.0);
            }

            return result;
        } catch (Exception e) {
            DiagnosisResult result = new DiagnosisResult();
            result.setNodeId(node.getId());
            result.setNodeName(node.getName());
            result.setTargetIp(targetIp);
            result.setTargetPort(port);
            result.setDescription(description);
            result.setSuccess(false);
            result.setMessage("诊断执行异常: " + e.getMessage());
            result.setTimestamp(System.currentTimeMillis());
            result.setAverageTime(-1.0);
            result.setPacketLoss(100.0);
            return result;
        }
    }

    private DiagnosisResult performTcpPingDiagnosisWithConnectionCheck(Node node, String targetIp, int port, String description) {
        DiagnosisResult result = new DiagnosisResult();
        result.setNodeId(node.getId());
        result.setNodeName(node.getName());
        result.setTargetIp(targetIp);
        result.setTargetPort(port);
        result.setDescription(description);
        result.setTimestamp(System.currentTimeMillis());

        try {
            return performTcpPingDiagnosis(node, targetIp, port, description);
        } catch (Exception e) {
            result.setSuccess(false);
            result.setMessage("连接检查异常: " + e.getMessage());
            result.setAverageTime(-1.0);
            result.setPacketLoss(100.0);
            return result;
        }
    }


}

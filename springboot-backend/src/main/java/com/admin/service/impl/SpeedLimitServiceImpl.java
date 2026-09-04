package com.admin.service.impl;

import com.admin.common.dto.GostDto;
import com.admin.common.dto.SpeedLimitDto;
import com.admin.common.dto.SpeedLimitUpdateDto;
import com.admin.common.lang.R;
import com.admin.common.utils.GostUtil;
import com.admin.entity.*;
import com.admin.mapper.SpeedLimitMapper;
import com.admin.service.*;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import lombok.Data;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * <p>
 * 限速规则服务实现类
 * 提供限速规则的增删改查功能，包括与Gost服务的集成
 * 支持限速器的创建、更新、删除和查询操作
 * </p>
 *
 * @author QAQ
 * @since 2025-06-04
 */
@Service
public class SpeedLimitServiceImpl extends ServiceImpl<SpeedLimitMapper, SpeedLimit> implements SpeedLimitService {

    @Resource
    @Lazy
    TunnelService tunnelService;

    @Resource
    NodeService nodeService;

    @Resource
    UserTunnelService userTunnelService;

    @Resource
    ChainTunnelService chainTunnelService;


    @Override
    public R createSpeedLimit(SpeedLimitDto speedLimitDto) {
        Tunnel tunnel = tunnelService.getById(speedLimitDto.getTunnelId());
        if (tunnel == null) return R.err("隧道不存在");

        SpeedLimit speedLimit = new SpeedLimit();
        BeanUtils.copyProperties(speedLimitDto, speedLimit);
        long currentTime = System.currentTimeMillis();
        speedLimit.setCreatedTime(currentTime);
        speedLimit.setUpdatedTime(currentTime);
        speedLimit.setStatus(1);
        this.save(speedLimit);

        String speedInMBps = convertBitsToMBps(speedLimit.getSpeed());

        List<Long> limit_success = new ArrayList<>();

        List<ChainTunnel> tunnelList = chainTunnelService.list(new QueryWrapper<ChainTunnel>().eq("tunnel_id", speedLimit.getTunnelId()));
        for (ChainTunnel chainTunnel : tunnelList) {
            Node node = nodeService.getById(chainTunnel.getNodeId());
            if (node != null) {
                GostDto gostDto = GostUtil.AddLimiters(node.getId(), speedLimit.getId(), speedInMBps);
                if (Objects.equals(gostDto.getMsg(), "OK")){
                    limit_success.add(node.getId());
                }else {
                    this.removeById(speedLimit.getId());
                    for (Long node_id : limit_success) {
                        GostDto deleteLimiters = GostUtil.DeleteLimiters(node_id, speedLimit.getId());
                        System.out.println(deleteLimiters);
                    }
                    return R.err(gostDto.getMsg());
                }
            }
        }
        return R.ok();
    }

    @Override
    public R getAllSpeedLimits() {
        List<SpeedLimit> speedLimits = this.list();
        return R.ok(speedLimits);
    }

    @Override
    public R updateSpeedLimit(SpeedLimitUpdateDto speedLimitUpdateDto) {
        SpeedLimit speedLimit = this.getById(speedLimitUpdateDto.getId());
        if (speedLimit == null) return R.err("限速不存在");

        BeanUtils.copyProperties(speedLimitUpdateDto, speedLimit);
        speedLimit.setUpdatedTime(System.currentTimeMillis());

        String speedInMBps = convertBitsToMBps(speedLimit.getSpeed());
        List<ChainTunnel> tunnelList = chainTunnelService.list(new QueryWrapper<ChainTunnel>().eq("tunnel_id", speedLimit.getTunnelId()));
        for (ChainTunnel chainTunnel : tunnelList) {
            Node node = nodeService.getById(chainTunnel.getNodeId());
            if (node != null) {
                GostDto gostDto = GostUtil.UpdateLimiters(node.getId(), speedLimit.getId(), speedInMBps);
                if (!Objects.equals(gostDto.getMsg(), "OK")) return R.err(gostDto.getMsg());
            }
        }
        this.updateById(speedLimit);
        return R.ok();
    }

    @Override
    public R deleteSpeedLimit(Long id) {
        // 1. 验证限速规则是否存在
        SpeedLimit speedLimit = this.getById(id);
        if (speedLimit == null) return R.err("限速规则不存在");


        int userCount = userTunnelService.count(new QueryWrapper<UserTunnel>().eq("speed_id", speedLimit.getId()));
        if (userCount != 0) return R.err("该限速规则还有用户在使用 请先取消分配");


        List<ChainTunnel> tunnelList = chainTunnelService.list(new QueryWrapper<ChainTunnel>().eq("tunnel_id", speedLimit.getTunnelId()));
        for (ChainTunnel chainTunnel : tunnelList) {
            Node node = nodeService.getById(chainTunnel.getNodeId());
            if (node != null) {
                GostDto gostDto = GostUtil.DeleteLimiters(node.getId(), speedLimit.getId());
                if (!Objects.equals(gostDto.getMsg(), "OK"))return R.err(gostDto.getMsg());
            }
        }
        this.removeById(id);
        return R.ok();
    }

    public static String convertBitsToMBps(Integer speedInBits) {
        double mbs = speedInBits / 8.0;
        BigDecimal bd = new BigDecimal(mbs).setScale(1, RoundingMode.HALF_UP);
        return bd.doubleValue() + "";
    }
}

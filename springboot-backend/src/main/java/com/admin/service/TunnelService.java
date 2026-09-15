package com.admin.service;

import com.admin.common.dto.TunnelDto;
import com.admin.common.dto.TunnelUpdateDto;

import com.admin.common.lang.R;
import com.admin.entity.Tunnel;
import com.baomidou.mybatisplus.extension.service.IService;

/**
 * <p>
 * 隧道服务类
 * </p>
 *
 * @author QAQ
 * @since 2025-06-03
 */
public interface TunnelService extends IService<Tunnel> {

    /**
     * 创建隧道
     * @param tunnelDto 隧道数据
     * @return 结果
     */
    R createTunnel(TunnelDto tunnelDto);

    /**
     * 获取隧道列表
     * @return 结果
     */
    R getAllTunnels();

    /**
     * 更新隧道及入口、转发链、出口拓扑
     * @param tunnelUpdateDto 更新数据
     * @return 结果
     */
    R updateTunnel(TunnelUpdateDto tunnelUpdateDto);

    /**
     * 删除隧道
     * @param id 隧道ID
     * @return 结果
     */
    R deleteTunnel(Long id);

    /**
     * 获取用户可用的隧道列表
     * @return 结果
     */
    R userTunnel();

    /**
     * 隧道诊断功能
     * @param tunnelId 隧道ID
     * @return 诊断结果
     */
    R diagnoseTunnel(Long tunnelId);
}

package com.admin.service;

import com.admin.common.dto.NodeDto;
import com.admin.common.dto.NodeUpdateDto;
import com.admin.common.lang.R;
import com.admin.entity.Node;
import com.baomidou.mybatisplus.extension.service.IService;

/**
 * <p>
 *  服务类
 * </p>
 *
 * @author QAQ
 * @since 2025-06-03
 */
public interface NodeService extends IService<Node> {

    R createNode(NodeDto nodeDto);

    R getAllNodes();

    R updateNode(NodeUpdateDto nodeUpdateDto);

    R deleteNode(Long id);

    R getInstallCommand(Long id);

    /**
     * 把面板中该节点的配置补齐到节点上，用于机器更换后恢复配置
     */
    R pushNodeConfig(Long id);

    /**
     * 对所有在线节点执行配置补齐
     */
    R pushAllNodeConfigs();

}

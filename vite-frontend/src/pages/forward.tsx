import { useState, useEffect } from "react";
import { Card, CardBody } from "@heroui/card";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Textarea } from "@heroui/input";
import { Select, SelectItem } from "@heroui/select";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/modal";
import { Chip } from "@heroui/chip";
import { Spinner } from "@heroui/spinner";
import { Switch } from "@heroui/switch";
import { Checkbox } from "@heroui/checkbox";
import { Alert } from "@heroui/alert";
import { Accordion, AccordionItem } from "@heroui/accordion";
import toast from 'react-hot-toast';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';


import { 
  createForward, 
  getForwardList, 
  updateForward, 
  deleteForward,
  forceDeleteForward,
  batchDeleteForward,
  batchChangeForwardStatus,
  userTunnel, 
  pauseForwardService,
  resumeForwardService,
  diagnoseForward,
  updateForwardOrder
} from "@/api";
import type { BatchItemResult } from "@/api";
import { JwtUtil } from "@/utils/jwt";
import { copyWithToast } from "@/utils/clipboard";

interface Forward {
  id: number;
  name: string;
  tunnelId: number;
  tunnelName: string;
  inIp: string;
  inPort: number;
  remoteAddr: string;
  interfaceName?: string;
  strategy: string;
  status: number;
  inFlow: number;
  outFlow: number;
  serviceRunning: boolean;
  createdTime: string;
  userName?: string;
  userId?: number;
  inx?: number;
}

interface Tunnel {
  id: number;
  name: string;
  inNodePortSta?: number;
  inNodePortEnd?: number;
}

interface ForwardForm {
  id?: number;
  userId?: number;
  name: string;
  tunnelId: number | null;
  inPort: number | null;
  remoteAddr: string;
  interfaceName?: string;
  strategy: string;
}

interface AddressItem {
  id: number;
  address: string;
  copying: boolean;
}

interface DiagnosisResult {
  forwardName: string;
  timestamp: number;
  results: Array<{
    success: boolean;
    description: string;
    nodeName: string;
    nodeId: string;
    targetIp: string;
    targetPort?: number;
    message?: string;
    averageTime?: number;
    packetLoss?: number;
    fromChainType?: number; // 1: 入口, 2: 链, 3: 出口
    fromInx?: number;
    toChainType?: number;
    toInx?: number;
  }>;
}

interface TunnelGroup {
  tunnelId: number;
  tunnelName: string;
  forwards: Forward[];
}

export default function ForwardPage() {
  const [loading, setLoading] = useState(true);
  const [forwards, setForwards] = useState<Forward[]>([]);
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  
  // 检测是否为移动端
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  // 显示模式状态 - 从localStorage读取，默认为平铺显示
  const [viewMode, setViewMode] = useState<'grouped' | 'direct'>(() => {
    try {
      const savedMode = localStorage.getItem('forward-view-mode');
      return (savedMode as 'grouped' | 'direct') || 'grouped';
    } catch {
      return 'grouped';
    }
  });
  
  // 拖拽排序相关状态
  const [forwardOrder, setForwardOrder] = useState<number[]>([]);

  // 批量删除相关状态
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchDeleteModalOpen, setBatchDeleteModalOpen] = useState(false);
  const [batchDeleteLoading, setBatchDeleteLoading] = useState(false);
  const [batchDeleteResults, setBatchDeleteResults] = useState<BatchItemResult[]>([]);
  const [batchStatusLoading, setBatchStatusLoading] = useState<'pause' | 'resume' | null>(null);
  const [batchStatusResults, setBatchStatusResults] = useState<BatchItemResult[]>([]);
  const [batchStatusModalOpen, setBatchStatusModalOpen] = useState(false);
  const [batchStatusAction, setBatchStatusAction] = useState<'pause' | 'resume'>('pause');
  
  // 模态框状态
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [diagnosisModalOpen, setDiagnosisModalOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [forwardToDelete, setForwardToDelete] = useState<Forward | null>(null);
  const [currentDiagnosisForward, setCurrentDiagnosisForward] = useState<Forward | null>(null);
  const [diagnosisResult, setDiagnosisResult] = useState<DiagnosisResult | null>(null);
  const [addressModalTitle, setAddressModalTitle] = useState('');
  const [addressList, setAddressList] = useState<AddressItem[]>([]);
  
  // 导出相关状态
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportData, setExportData] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [selectedTunnelForExport, setSelectedTunnelForExport] = useState<number | null>(null);
  
  // 导入相关状态
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importData, setImportData] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [selectedTunnelForImport, setSelectedTunnelForImport] = useState<number | null>(null);
  const [importResults, setImportResults] = useState<Array<{
    line: string;
    success: boolean;
    message: string;
    forwardName?: string;
  }>>([]);
  
  // 表单状态
  const [form, setForm] = useState<ForwardForm>({
    name: '',
    tunnelId: null,
    inPort: null,
    remoteAddr: '',
    interfaceName: '',
    strategy: 'fifo'
  });
  
  // 表单验证错误
  const [errors, setErrors] = useState<{[key: string]: string}>({});

  useEffect(() => {
    loadData();
  }, []);

  // 切换显示模式并保存到localStorage
  const handleViewModeChange = () => {
    const newMode = viewMode === 'grouped' ? 'direct' : 'grouped';
    setViewMode(newMode);
    try {
      localStorage.setItem('forward-view-mode', newMode);
      
      // 切换到直接显示模式时，初始化拖拽排序顺序
      if (newMode === 'direct') {
        // 在平铺模式下，只对当前用户的转发进行排序
        const currentUserId = JwtUtil.getUserIdFromToken();
        let userForwards = forwards;
        if (currentUserId !== null) {
          userForwards = forwards.filter((f: Forward) => f.userId === currentUserId);
        }
        
        // 检查数据库中是否有排序信息
        const hasDbOrdering = userForwards.some((f: Forward) => f.inx !== undefined && f.inx !== 0);
        
        if (hasDbOrdering) {
          // 使用数据库中的排序信息
          const dbOrder = userForwards
            .sort((a: Forward, b: Forward) => (a.inx ?? 0) - (b.inx ?? 0))
            .map((f: Forward) => f.id);
          setForwardOrder(dbOrder);
          
          // 同步到localStorage
          try {
            localStorage.setItem('forward-order', JSON.stringify(dbOrder));
          } catch (error) {
            console.warn('无法保存排序到localStorage:', error);
          }
        } else {
          // 使用本地存储的顺序
          const savedOrder = localStorage.getItem('forward-order');
          if (savedOrder) {
            try {
              const orderIds = JSON.parse(savedOrder);
              const validOrder = orderIds.filter((id: number) => 
                userForwards.some((f: Forward) => f.id === id)
              );
              userForwards.forEach((forward: Forward) => {
                if (!validOrder.includes(forward.id)) {
                  validOrder.push(forward.id);
                }
              });
              setForwardOrder(validOrder);
            } catch {
              setForwardOrder(userForwards.map((f: Forward) => f.id));
            }
          } else {
            setForwardOrder(userForwards.map((f: Forward) => f.id));
          }
        }
      }
    } catch (error) {
      console.warn('无法保存显示模式到localStorage:', error);
    }
  };

  // 加载所有数据
  const loadData = async (lod = true) => {
    setLoading(lod);
    try {
      const [forwardsRes, tunnelsRes] = await Promise.all([
        getForwardList(),
        userTunnel()
      ]);
      
      if (forwardsRes.code === 0) {
        const forwardsData = forwardsRes.data?.map((forward: any) => ({
          ...forward,
          serviceRunning: forward.status === 1
        })) || [];
        setForwards(forwardsData);
        
        // 初始化拖拽排序顺序
        if (viewMode === 'direct') {
          // 在平铺模式下，只对当前用户的转发进行排序
          const currentUserId = JwtUtil.getUserIdFromToken();
          let userForwards = forwardsData;
          if (currentUserId !== null) {
            userForwards = forwardsData.filter((f: Forward) => f.userId === currentUserId);
          }
          
          // 检查数据库中是否有排序信息
          const hasDbOrdering = userForwards.some((f: Forward) => f.inx !== undefined && f.inx !== 0);
          
          if (hasDbOrdering) {
            // 使用数据库中的排序信息
            const dbOrder = userForwards
              .sort((a: Forward, b: Forward) => (a.inx ?? 0) - (b.inx ?? 0))
              .map((f: Forward) => f.id);
            setForwardOrder(dbOrder);
            
            // 同步到localStorage
            try {
              localStorage.setItem('forward-order', JSON.stringify(dbOrder));
            } catch (error) {
              console.warn('无法保存排序到localStorage:', error);
            }
          } else {
            // 使用本地存储的顺序
            const savedOrder = localStorage.getItem('forward-order');
            if (savedOrder) {
              try {
                const orderIds = JSON.parse(savedOrder);
                // 验证保存的顺序是否仍然有效（只包含当前用户的转发）
                const validOrder = orderIds.filter((id: number) => 
                  userForwards.some((f: Forward) => f.id === id)
                );
                // 添加新的转发ID（如果存在）
                userForwards.forEach((forward: Forward) => {
                  if (!validOrder.includes(forward.id)) {
                    validOrder.push(forward.id);
                  }
                });
                setForwardOrder(validOrder);
              } catch {
                setForwardOrder(userForwards.map((f: Forward) => f.id));
              }
            } else {
              setForwardOrder(userForwards.map((f: Forward) => f.id));
            }
          }
        }
      } else {
        toast.error(forwardsRes.msg || '获取转发列表失败');
      }
      
      if (tunnelsRes.code === 0) {
        setTunnels(tunnelsRes.data || []);
      } else {
        console.warn('获取隧道列表失败:', tunnelsRes.msg);
      }
    } catch (error) {
      console.error('加载数据失败:', error);
      toast.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const groupForwardsByTunnel = (): TunnelGroup[] => {
    const tunnelMap = new Map<number, TunnelGroup>();

    getSortedForwards().forEach(forward => {
      let tunnelGroup = tunnelMap.get(forward.tunnelId);
      if (!tunnelGroup) {
        tunnelGroup = {
          tunnelId: forward.tunnelId,
          tunnelName: forward.tunnelName || '未知隧道',
          forwards: []
        };
        tunnelMap.set(forward.tunnelId, tunnelGroup);
      }
      tunnelGroup.forwards.push(forward);
    });

    return Array.from(tunnelMap.values()).sort((a, b) => a.tunnelName.localeCompare(b.tunnelName));
  };

  // 表单验证
  const validateForm = (): boolean => {
    const newErrors: {[key: string]: string} = {};
    
    if (!form.name.trim()) {
      newErrors.name = '请输入转发名称';
    } else if (form.name.length < 2 || form.name.length > 50) {
      newErrors.name = '转发名称长度应在2-50个字符之间';
    }
    
    if (!form.tunnelId) {
      newErrors.tunnelId = '请选择关联隧道';
    }
    
    // 验证入口端口（可选，如果填写则验证）
    if (form.inPort !== null && form.inPort !== undefined) {
      const port = Number(form.inPort);
      if (isNaN(port) || port < 1 || port > 65535) {
        newErrors.inPort = '端口必须在 1-65535 之间';
      }
    }
    
    if (!form.remoteAddr.trim()) {
      newErrors.remoteAddr = '请输入远程地址';
    } else {
      // 验证地址格式
      const addresses = form.remoteAddr.split('\n').map(addr => addr.trim()).filter(addr => addr);
      const ipv4Pattern = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?):\d+$/;
      const ipv6FullPattern = /^\[((([0-9a-fA-F]{1,4}:){7}([0-9a-fA-F]{1,4}|:))|(([0-9a-fA-F]{1,4}:){6}(:[0-9a-fA-F]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-fA-F]{1,4}:){5}(((:[0-9a-fA-F]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-fA-F]{1,4}:){4}(((:[0-9a-fA-F]{1,4}){1,3})|((:[0-9a-fA-F]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-fA-F]{1,4}:){3}(((:[0-9a-fA-F]{1,4}){1,4})|((:[0-9a-fA-F]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-fA-F]{1,4}:){2}(((:[0-9a-fA-F]{1,4}){1,5})|((:[0-9a-fA-F]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-fA-F]{1,4}:){1}(((:[0-9a-fA-F]{1,4}){1,6})|((:[0-9a-fA-F]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-fA-F]{1,4}){1,7})|((:[0-9a-fA-F]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))\]:\d+$/;
      const domainPattern = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*:\d+$/;
      
      for (let i = 0; i < addresses.length; i++) {
        const addr = addresses[i];
        if (!ipv4Pattern.test(addr) && !ipv6FullPattern.test(addr) && !domainPattern.test(addr)) {
          newErrors.remoteAddr = `第${i + 1}行地址格式错误`;
          break;
        }
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // 新增转发
  const handleAdd = () => {
    setIsEdit(false);
    setForm({
      name: '',
      tunnelId: null,
      inPort: null,
      remoteAddr: '',
      interfaceName: '',
      strategy: 'fifo'
    });
    setErrors({});
    setModalOpen(true);
  };

  // 编辑转发
  const handleEdit = (forward: Forward) => {
    setIsEdit(true);
    setForm({
      id: forward.id,
      userId: forward.userId,
      name: forward.name,
      tunnelId: forward.tunnelId,
      inPort: forward.inPort,
      remoteAddr: forward.remoteAddr.split(',').join('\n'),
      interfaceName: forward.interfaceName || '',
      strategy: forward.strategy || 'fifo'
    });
    setErrors({});
    setModalOpen(true);
  };

  // 显示删除确认
  const handleDelete = (forward: Forward) => {
    setForwardToDelete(forward);
    setDeleteModalOpen(true);
  };

  // 确认删除转发
  const confirmDelete = async () => {
    if (!forwardToDelete) return;
    
    setDeleteLoading(true);
    try {
      const res = await deleteForward(forwardToDelete.id);
      if (res.code === 0) {
        toast.success('删除成功');
        setDeleteModalOpen(false);
        loadData();
      } else {
        // 删除失败，询问是否强制删除
        const confirmed = window.confirm(`常规删除失败：${res.msg || '删除失败'}\n\n是否需要强制删除？\n\n⚠️ 注意：强制删除不会去验证节点端是否已经删除对应的转发服务。`);
        if (confirmed) {
          const forceRes = await forceDeleteForward(forwardToDelete.id);
          if (forceRes.code === 0) {
            toast.success('强制删除成功');
            setDeleteModalOpen(false);
            loadData();
          } else {
            toast.error(forceRes.msg || '强制删除失败');
          }
        }
      }
    } catch (error) {
      console.error('删除失败:', error);
      toast.error('删除失败');
    } finally {
      setDeleteLoading(false);
    }
  };
  // 选中集合必须与实际渲染的列表一致：平铺模式只含当前用户，分组模式含全部
  const getVisibleForwards = (): Forward[] => {
    if (viewMode === 'direct') return getSortedForwards();
    return groupForwardsByTunnel().flatMap(tunnelGroup => tunnelGroup.forwards);
  };

  // 退出多选模式时清空已选，避免残留选中项被下一次批量操作误删
  const handleSelectionModeToggle = () => {
    if (selectionMode) {
      setSelectedIds(new Set());
    }
    setSelectionMode(!selectionMode);
  };

  const toggleForwardSelection = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    const visibleIds = getVisibleForwards().map(f => f.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(visibleIds));
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) {
      toast.error('请先选择要删除的转发');
      return;
    }
    setBatchDeleteResults([]);
    setBatchDeleteModalOpen(true);
  };

  const runBatchStatus = async (resume: boolean) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      toast.error(`请先选择要${resume ? '开启' : '暂停'}的转发`);
      return;
    }

    const action = resume ? 'resume' : 'pause';
    setBatchStatusLoading(action);
    setBatchStatusAction(action);
    try {
      const res = await batchChangeForwardStatus(ids, resume);
      if (res.code !== 0 || !res.data) {
        toast.error(res.msg || '批量操作失败');
        return;
      }

      const { successCount, failCount, results } = res.data;
      if (failCount === 0) {
        toast.success(`已${resume ? '开启' : '暂停'} ${successCount} 条转发`);
        setSelectedIds(new Set());
        setSelectionMode(false);
      } else {
        toast.error(`成功 ${successCount} 条，失败 ${failCount} 条`);
        setBatchStatusResults(results);
        setBatchStatusModalOpen(true);
        setSelectedIds(new Set(results.filter(item => !item.success).map(item => item.id)));
      }
      loadData(false);
    } catch (error) {
      console.error('批量操作失败:', error);
      toast.error('批量操作失败');
    } finally {
      setBatchStatusLoading(null);
    }
  };

  const runBatchDelete = async (force: boolean) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    setBatchDeleteLoading(true);
    try {
      const res = await batchDeleteForward(ids, force);
      if (res.code !== 0 || !res.data) {
        toast.error(res.msg || '批量删除失败');
        return;
      }

      const { successCount, failCount, results } = res.data;
      setBatchDeleteResults(results);

      if (failCount === 0) {
        toast.success(`成功删除 ${successCount} 条转发`);
        setBatchDeleteModalOpen(false);
        setSelectedIds(new Set());
        setSelectionMode(false);
      } else {
        toast.error(`成功 ${successCount} 条，失败 ${failCount} 条`);
        // 只保留失败项，便于重试或强制删除
        setSelectedIds(new Set(results.filter(item => !item.success).map(item => item.id)));
      }
      loadData(false);
    } catch (error) {
      console.error('批量删除失败:', error);
      toast.error('批量删除失败');
    } finally {
      setBatchDeleteLoading(false);
    }
  };

  // 处理隧道选择变化
  const handleTunnelChange = (tunnelId: string) => {
    setForm(prev => ({ ...prev, tunnelId: parseInt(tunnelId) }));
  };

  // 提交表单
  const handleSubmit = async () => {
    if (!validateForm()) return;
    
    setSubmitLoading(true);
    try {
      const processedRemoteAddr = form.remoteAddr
        .split('\n')
        .map(addr => addr.trim())
        .filter(addr => addr)
        .join(',');

      const addressCount = processedRemoteAddr.split(',').length;
      
      let res;
      if (isEdit) {
        // 更新时确保包含必要字段
        const updateData = {
          id: form.id,
          userId: form.userId,
          name: form.name,
          tunnelId: form.tunnelId,
          inPort: form.inPort,
          remoteAddr: processedRemoteAddr,
          strategy: addressCount > 1 ? form.strategy : 'fifo'
        };
        res = await updateForward(updateData);
      } else {
        // 创建时不需要id和userId（后端会自动设置）
        const createData = {
          name: form.name,
          tunnelId: form.tunnelId,
          inPort: form.inPort,
          remoteAddr: processedRemoteAddr,
          strategy: addressCount > 1 ? form.strategy : 'fifo'
        };
        res = await createForward(createData);
      }
      
      if (res.code === 0) {
        toast.success(isEdit ? '修改成功' : '创建成功');
        setModalOpen(false);
        loadData();
      } else {
        toast.error(res.msg || '操作失败');
      }
    } catch (error) {
      console.error('提交失败:', error);
      toast.error('操作失败');
    } finally {
      setSubmitLoading(false);
    }
  };

  // 处理服务开关
  const handleServiceToggle = async (forward: Forward) => {
    if (forward.status !== 1 && forward.status !== 0) {
      toast.error('转发状态异常，无法操作');
      return;
    }

    const targetState = !forward.serviceRunning;
    
    try {
      // 乐观更新UI
      setForwards(prev => prev.map(f => 
        f.id === forward.id 
          ? { ...f, serviceRunning: targetState }
          : f
      ));

      let res;
      if (targetState) {
        res = await resumeForwardService(forward.id);
      } else {
        res = await pauseForwardService(forward.id);
      }
      
      if (res.code === 0) {
        toast.success(targetState ? '服务已启动' : '服务已暂停');
        // 更新转发状态
        setForwards(prev => prev.map(f => 
          f.id === forward.id 
            ? { ...f, status: targetState ? 1 : 0 }
            : f
        ));
      } else {
        // 操作失败，恢复UI状态
        setForwards(prev => prev.map(f => 
          f.id === forward.id 
            ? { ...f, serviceRunning: !targetState }
            : f
        ));
        toast.error(res.msg || '操作失败');
      }
    } catch (error) {
      // 操作失败，恢复UI状态
      setForwards(prev => prev.map(f => 
        f.id === forward.id 
          ? { ...f, serviceRunning: !targetState }
          : f
      ));
      console.error('服务开关操作失败:', error);
      toast.error('网络错误，操作失败');
    }
  };

  // 诊断转发
  const handleDiagnose = async (forward: Forward) => {
    setCurrentDiagnosisForward(forward);
    setDiagnosisModalOpen(true);
    setDiagnosisLoading(true);
    setDiagnosisResult(null);

    try {
      const response = await diagnoseForward(forward.id);
      if (response.code === 0) {
        setDiagnosisResult(response.data);
      } else {
        toast.error(response.msg || '诊断失败');
        setDiagnosisResult({
          forwardName: forward.name,
          timestamp: Date.now(),
          results: [{
            success: false,
            description: '诊断失败',
            nodeName: '-',
            nodeId: '-',
            targetIp: forward.remoteAddr.split(',')[0] || '-',
            message: response.msg || '诊断过程中发生错误'
          }]
        });
      }
    } catch (error) {
      console.error('诊断失败:', error);
      toast.error('网络错误，请重试');
      setDiagnosisResult({
        forwardName: forward.name,
        timestamp: Date.now(),
        results: [{
          success: false,
          description: '网络错误',
          nodeName: '-',
          nodeId: '-',
          targetIp: forward.remoteAddr.split(',')[0] || '-',
          message: '无法连接到服务器'
        }]
      });
    } finally {
      setDiagnosisLoading(false);
    }
  };

  // 获取连接质量
  const getQualityDisplay = (averageTime?: number, packetLoss?: number) => {
    if (averageTime === undefined || packetLoss === undefined) return null;
    
    if (averageTime < 30 && packetLoss === 0) return { text: '🚀 优秀', color: 'success' };
    if (averageTime < 50 && packetLoss === 0) return { text: '✨ 很好', color: 'success' };
    if (averageTime < 100 && packetLoss < 1) return { text: '👍 良好', color: 'primary' };
    if (averageTime < 150 && packetLoss < 2) return { text: '😐 一般', color: 'warning' };
    if (averageTime < 200 && packetLoss < 5) return { text: '😟 较差', color: 'warning' };
    return { text: '😵 很差', color: 'danger' };
  };

  // 格式化流量
  const formatFlow = (value: number): string => {
    if (value === 0) return '0 B';
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(2) + ' KB';
    if (value < 1024 * 1024 * 1024) return (value / (1024 * 1024)).toFixed(2) + ' MB';
    return (value / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  // 格式化入口地址
  const formatInAddress = (ipString: string, port: number): string => {
    if (!ipString) return '';
    
    const items = ipString.split(',').map(item => item.trim()).filter(item => item);
    if (items.length === 0) return '';
    
    // 检查第一项是否已经包含端口（格式：IP:端口）
    const firstItem = items[0];
    const hasPort = /:\d+$/.test(firstItem);
    
    if (hasPort) {
      // inIp 已经包含完整的 IP:Port 组合
      if (items.length === 1) {
        return items[0];
      }
      return `${items[0]} (+${items.length - 1}个)`;
    }
    
    // inIp 只包含IP，需要添加端口（兼容旧数据）
    if (!port) return '';
    
    if (items.length === 1) {
      const ip = items[0];
      if (ip.includes(':') && !ip.startsWith('[')) {
        return `[${ip}]:${port}`;
      } else {
        return `${ip}:${port}`;
      }
    }
    
    const firstIp = items[0];
    let formattedFirstIp;
    if (firstIp.includes(':') && !firstIp.startsWith('[')) {
      formattedFirstIp = `[${firstIp}]`;
    } else {
      formattedFirstIp = firstIp;
    }
    
    return `${formattedFirstIp}:${port} (+${items.length - 1}个)`;
  };

  // 格式化远程地址
  const formatRemoteAddress = (addressString: string): string => {
    if (!addressString) return '';
    
    const addresses = addressString.split(',').map(addr => addr.trim()).filter(addr => addr);
    if (addresses.length === 0) return '';
    if (addresses.length === 1) return addresses[0];
    
    return `${addresses[0]} (+${addresses.length - 1})`;
  };

  // 检查是否有多个地址
  const hasMultipleAddresses = (addressString: string): boolean => {
    if (!addressString) return false;
    const addresses = addressString.split(',').map(addr => addr.trim()).filter(addr => addr);
    return addresses.length > 1;
  };

  const splitAddresses = (addressString: string): string[] => {
    if (!addressString) return [];
    return addressString.split(',').map(addr => addr.trim()).filter(addr => addr);
  };

  // 入口地址：inIp 可能只有 IP（旧数据），需要补上端口
  const buildInAddresses = (ipString: string, port: number): string[] => {
    const items = splitAddresses(ipString);
    if (items.length === 0) return [];
    if (/:\d+$/.test(items[0])) return items;
    if (!port) return items;
    return items.map(ip => (ip.includes(':') && !ip.startsWith('[') ? `[${ip}]:${port}` : `${ip}:${port}`));
  };

  const renderAddressCell = ({ label, display, raw, multiple, onExpand }: {
    label: string;
    display: string;
    raw: string;
    multiple: boolean;
    onExpand: () => void;
  }) => (
    <div className="w-[calc(50%-0.375rem)] lg:w-auto lg:flex-1 min-w-0 flex items-center gap-1 px-2 py-1 bg-default-50 dark:bg-default-100/50 rounded border border-default-200 dark:border-default-300 order-4">
      <span className="text-xs font-medium text-default-600 flex-shrink-0">{label}：</span>
      <code
        className="text-xs font-mono text-foreground truncate min-w-0 flex-1 cursor-pointer hover:text-primary transition-colors"
        onClick={() => copyWithToast(raw, label)}
        title={`点击复制${label}：${display}`}
      >
        {display}
      </code>
      <button
        type="button"
        className="flex-shrink-0 p-0.5 text-default-400 hover:text-primary transition-colors"
        onClick={() => copyWithToast(raw, label)}
        title={`复制${label}`}
        aria-label={`复制${label}`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      </button>
      {multiple && (
        <button
          type="button"
          className="flex-shrink-0 p-0.5 text-default-400 hover:text-primary transition-colors"
          onClick={onExpand}
          title={`查看全部${label}`}
          aria-label={`查看全部${label}`}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
          </svg>
        </button>
      )}
    </div>
  );

  // 显示地址列表弹窗
  const showAddressModal = (addressString: string, port: number | null, title: string) => {
    if (!addressString) return;
    
    let addresses: string[];
    if (port !== null) {
      // 入口地址处理
      const items = addressString.split(',').map(item => item.trim()).filter(item => item);
      if (items.length <= 1) {
        copyToClipboard(formatInAddress(addressString, port), title);
        return;
      }
      
      // 检查是否已经包含端口
      const hasPort = /:\d+$/.test(items[0]);
      if (hasPort) {
        // 已经包含完整的 IP:Port 组合，直接使用
        addresses = items;
      } else {
        // 只包含IP，需要添加端口
        addresses = items.map(ip => {
          if (ip.includes(':') && !ip.startsWith('[')) {
            return `[${ip}]:${port}`;
          } else {
            return `${ip}:${port}`;
          }
        });
      }
    } else {
      // 远程地址处理
      addresses = addressString.split(',').map(addr => addr.trim()).filter(addr => addr);
      if (addresses.length <= 1) {
        copyToClipboard(addressString, title);
        return;
      }
    }
    
    setAddressList(addresses.map((address, index) => ({
      id: index,
      address,
      copying: false
    })));
    setAddressModalTitle(`${title} (${addresses.length}个)`);
    setAddressModalOpen(true);
  };

  const copyToClipboard = async (text: string, label: string = '内容') => {
    await copyWithToast(text, label);
  };

  // 复制地址
  const copyAddress = async (addressItem: AddressItem) => {
    setAddressList(prev => prev.map(item =>
      item.id === addressItem.id ? { ...item, copying: true } : item
    ));
    try {
      await copyWithToast(addressItem.address, '地址');
    } finally {
      setAddressList(prev => prev.map(item =>
        item.id === addressItem.id ? { ...item, copying: false } : item
      ));
    }
  };

  // 复制所有地址
  const copyAllAddresses = async () => {
    if (addressList.length === 0) return;
    const allAddresses = addressList.map(item => item.address).join('\n');
    await copyToClipboard(allAddresses, '所有地址');
  };

    // 导出转发数据
  const handleExport = () => {
    setSelectedTunnelForExport(null);
    setExportData('');
    setExportModalOpen(true);
  };

  // 执行导出
  const executeExport = () => {
    if (!selectedTunnelForExport) {
      toast.error('请选择要导出的隧道');
      return;
    }

    setExportLoading(true);
    
    try {
      // 根据当前显示模式获取要导出的转发列表
      let forwardsToExport: Forward[] = [];
      
      if (viewMode === 'grouped') {
        // 分组模式下，获取指定隧道的转发
        forwardsToExport = groupForwardsByTunnel()
          .filter(tunnelGroup => tunnelGroup.tunnelId === selectedTunnelForExport)
          .flatMap(tunnelGroup => tunnelGroup.forwards);
      } else {
        // 直接显示模式下，过滤指定隧道的转发
        forwardsToExport = getSortedForwards().filter(forward => forward.tunnelId === selectedTunnelForExport);
      }
      
      if (forwardsToExport.length === 0) {
        toast.error('所选隧道没有转发数据');
        setExportLoading(false);
        return;
      }
      
      // 格式化导出数据：remoteAddr|name|inPort
      const exportLines = forwardsToExport.map(forward => {
        return `${forward.remoteAddr}|${forward.name}|${forward.inPort}`;
      });
      
      const exportText = exportLines.join('\n');
      setExportData(exportText);
    } catch (error) {
      console.error('导出失败:', error);
      toast.error('导出失败');
    } finally {
      setExportLoading(false);
    }
  };

  // 复制导出数据
  const copyExportData = async () => {
    await copyToClipboard(exportData, '转发数据');
  };

  // 导入转发数据
  const handleImport = () => {
    setImportData('');
    setImportResults([]);
    setSelectedTunnelForImport(null);
    setImportModalOpen(true);
  };

  // 执行导入
  const executeImport = async () => {
    if (!importData.trim()) {
      toast.error('请输入要导入的数据');
      return;
    }

    if (!selectedTunnelForImport) {
      toast.error('请选择要导入的隧道');
      return;
    }

    setImportLoading(true);
    setImportResults([]); // 清空之前的结果

    try {
      const lines = importData.trim().split('\n').filter(line => line.trim());
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const parts = line.split('|');
        
        if (parts.length < 2) {
          setImportResults(prev => [{
            line,
            success: false,
            message: '格式错误：需要至少包含目标地址和转发名称'
          }, ...prev]);
          continue;
        }

        const [remoteAddr, name, inPort] = parts;
        
        if (!remoteAddr.trim() || !name.trim()) {
          setImportResults(prev => [{
            line,
            success: false,
            message: '目标地址和转发名称不能为空'
          }, ...prev]);
          continue;
        }

        // 验证远程地址格式 - 支持单个地址或多个地址用逗号分隔
        const addresses = remoteAddr.trim().split(',');
        const addressPattern = /^[^:]+:\d+$/;
        const isValidFormat = addresses.every(addr => addressPattern.test(addr.trim()));
        
        if (!isValidFormat) {
          setImportResults(prev => [{
            line,
            success: false,
            message: '目标地址格式错误，应为 地址:端口 格式，多个地址用逗号分隔'
          }, ...prev]);
          continue;
        }

        try {
          // 处理入口端口
          let portNumber: number | null = null;
          if (inPort && inPort.trim()) {
            const port = parseInt(inPort.trim());
            if (isNaN(port) || port < 1 || port > 65535) {
              setImportResults(prev => [{
                line,
                success: false,
                message: '入口端口格式错误，应为1-65535之间的数字'
              }, ...prev]);
              continue;
            }
            portNumber = port;
          }

          // 调用创建转发接口
          const response = await createForward({
            name: name.trim(),
            tunnelId: selectedTunnelForImport, // 使用用户选择的隧道
            inPort: portNumber, // 使用指定端口或自动分配
            remoteAddr: remoteAddr.trim(),
            strategy: 'fifo'
          });

          if (response.code === 0) {
            setImportResults(prev => [{
              line,
              success: true,
              message: '创建成功',
              forwardName: name.trim()
            }, ...prev]);
          } else {
            setImportResults(prev => [{
              line,
              success: false,
              message: response.msg || '创建失败'
            }, ...prev]);
          }
        } catch (error) {
          setImportResults(prev => [{
            line,
            success: false,
            message: '网络错误，创建失败'
          }, ...prev]);
        }
      }
      
      
      toast.success(`导入执行完成`);
      
      // 导入完成后刷新转发列表
      await loadData(false);
    } catch (error) {
      console.error('导入失败:', error);
      toast.error('导入过程中发生错误');
    } finally {
      setImportLoading(false);
    }
  };

  // 获取状态显示
  const getStatusDisplay = (status: number) => {
    switch (status) {
      case 1:
        return { color: 'success', text: '正常' };
      case 0:
        return { color: 'warning', text: '暂停' };
      case -1:
        return { color: 'danger', text: '异常' };
      default:
        return { color: 'default', text: '未知' };
    }
  };

  // 获取策略显示
  const getStrategyDisplay = (strategy: string) => {
    switch (strategy) {
      case 'fifo':
        return { color: 'primary', text: '主备' };
      case 'round':
        return { color: 'success', text: '轮询' };
      case 'rand':
        return { color: 'warning', text: '随机' };
      default:
        return { color: 'default', text: '未知' };
    }
  };

  // 获取地址数量
  const getAddressCount = (addressString: string): number => {
    if (!addressString) return 0;
    const addresses = addressString.split('\n').map(addr => addr.trim()).filter(addr => addr);
    return addresses.length;
  };

  // 处理拖拽结束
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!active || !over || active.id === over.id) return;
    
    // 确保 forwardOrder 存在且有效
    if (!forwardOrder || forwardOrder.length === 0) return;
    
    const activeId = Number(active.id);
    const overId = Number(over.id);
    
    // 检查 ID 是否有效
    if (isNaN(activeId) || isNaN(overId)) return;
    
    const oldIndex = forwardOrder.indexOf(activeId);
    const newIndex = forwardOrder.indexOf(overId);
    
    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      const newOrder = arrayMove(forwardOrder, oldIndex, newIndex);
      setForwardOrder(newOrder);
      
      // 保存到localStorage
      try {
        localStorage.setItem('forward-order', JSON.stringify(newOrder));
      } catch (error) {
        console.warn('无法保存排序到localStorage:', error);
      }
      
      // 持久化到数据库
      try {
        const forwardsToUpdate = newOrder.map((id, index) => ({
          id,
          inx: index
        }));
        
        const response = await updateForwardOrder({ forwards: forwardsToUpdate });
        if (response.code === 0) {
          // 更新本地数据中的 inx 字段
          setForwards(prev => prev.map(forward => {
            const updatedForward = forwardsToUpdate.find(f => f.id === forward.id);
            if (updatedForward) {
              return { ...forward, inx: updatedForward.inx };
            }
            return forward;
          }));
        } else {
          toast.error('保存排序失败：' + (response.msg || '未知错误'));
        }
      } catch (error) {
        console.error('保存排序到数据库失败:', error);
        toast.error('保存排序失败，请重试');
      }
    }
  };

  // 传感器配置 - 使用默认配置避免错误
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // 根据排序顺序获取转发列表
  const getSortedForwards = (): Forward[] => {
    // 确保 forwards 数组存在且有效
    if (!forwards || forwards.length === 0) {
      return [];
    }
    
    // 在平铺模式下，只显示当前用户的转发
    let filteredForwards = forwards;
    if (viewMode === 'direct') {
      const currentUserId = JwtUtil.getUserIdFromToken();
      if (currentUserId !== null) {
        filteredForwards = forwards.filter(forward => forward.userId === currentUserId);
      }
    }
    
    // 确保过滤后的转发列表有效
    if (!filteredForwards || filteredForwards.length === 0) {
      return [];
    }
    
    // 优先使用数据库中的 inx 字段进行排序
    const sortedForwards = [...filteredForwards].sort((a, b) => {
      const aInx = a.inx ?? 0;
      const bInx = b.inx ?? 0;
      return aInx - bInx;
    });
    
    // 如果数据库中没有排序信息，则使用本地存储的顺序
    if (forwardOrder && forwardOrder.length > 0 && sortedForwards.every(f => f.inx === undefined || f.inx === 0)) {
      const forwardMap = new Map(filteredForwards.map(f => [f.id, f]));
      const localSortedForwards: Forward[] = [];
      
      forwardOrder.forEach(id => {
        const forward = forwardMap.get(id);
        if (forward) {
          localSortedForwards.push(forward);
        }
      });
      
      // 添加不在排序列表中的转发（新添加的）
      filteredForwards.forEach(forward => {
        if (!forwardOrder.includes(forward.id)) {
          localSortedForwards.push(forward);
        }
      });
      
      return localSortedForwards;
    }
    
    return sortedForwards;
  };

  // 可拖拽的转发卡片组件
  const SortableForwardCard = ({ forward }: { forward: Forward }) => {
    // 确保 forward 对象有效
    if (!forward || !forward.id) {
      return null;
    }

    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: forward.id });

    const style = {
      transform: transform ? CSS.Transform.toString(transform) : undefined,
      transition: transition || undefined,
      opacity: isDragging ? 0.5 : 1,
    };

    return (
      <div ref={setNodeRef} style={style}>
        {renderForwardCard(forward, listeners, attributes)}
      </div>
    );
  };

  // 单行渲染，两种视图模式共用
  const renderForwardCard = (forward: Forward, listeners?: any, dragAttributes?: any) => {
    const statusDisplay = getStatusDisplay(forward.status);
    const strategyDisplay = getStrategyDisplay(forward.strategy);
    const isSelected = selectedIds.has(forward.id);

    return (
      <div
        key={forward.id}
        className={`group w-full flex flex-wrap lg:flex-nowrap items-center gap-x-3 gap-y-2 px-3 py-2.5 transition-colors duration-200 ${
          isSelected
            ? 'bg-primary-50 dark:bg-primary-900/20'
            : 'hover:bg-default-50 dark:hover:bg-default-100/40'
        }`}
      >
        {selectionMode && (
          <Checkbox
            size="sm"
            isSelected={isSelected}
            onValueChange={() => toggleForwardSelection(forward.id)}
            aria-label={`选择转发 ${forward.name}`}
            className="flex-shrink-0 order-1"
          />
        )}

        {viewMode === 'direct' && !selectionMode && (
          <div
            className={`cursor-grab active:cursor-grabbing p-1 text-default-400 hover:text-default-600 transition-colors touch-manipulation flex-shrink-0 order-2 ${
              isMobile
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100'
            }`}
            {...dragAttributes}
            {...listeners}
            title="拖拽排序"
            aria-label={`拖拽排序 ${forward.name}`}
            style={{ touchAction: 'none' }}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M7 2a2 2 0 1 1 .001 4.001A2 2 0 0 1 7 2zm0 6a2 2 0 1 1 .001 4.001A2 2 0 0 1 7 8zm0 6a2 2 0 1 1 .001 4.001A2 2 0 0 1 7 14zm6-8a2 2 0 1 1-.001-4.001A2 2 0 0 1 13 6zm0 2a2 2 0 1 1 .001 4.001A2 2 0 0 1 13 8zm0 6a2 2 0 1 1 .001 4.001A2 2 0 0 1 13 14z" />
            </svg>
          </div>
        )}

        <div className="w-[calc(100%-6rem)] lg:w-40 xl:w-48 min-w-0 flex-shrink-0 order-3">
          <div className="font-semibold text-foreground truncate text-sm" title={forward.name}>
            {forward.name}
          </div>
          <div className="text-xs text-default-500 truncate" title={forward.tunnelName}>
            {forward.tunnelName}
          </div>
        </div>

        {renderAddressCell({
          label: '入口',
          display: formatInAddress(forward.inIp, forward.inPort),
          raw: buildInAddresses(forward.inIp, forward.inPort).join('\n'),
          multiple: hasMultipleAddresses(forward.inIp),
          onExpand: () => showAddressModal(forward.inIp, forward.inPort, '入口端口'),
        })}

        {renderAddressCell({
          label: '目标',
          display: formatRemoteAddress(forward.remoteAddr),
          raw: splitAddresses(forward.remoteAddr).join('\n'),
          multiple: hasMultipleAddresses(forward.remoteAddr),
          onExpand: () => showAddressModal(forward.remoteAddr, null, '目标地址'),
        })}

        {/* 窄屏隐藏次要信息，保证操作按钮不被挤出行外 */}
        <div className="hidden 2xl:flex items-center gap-1.5 flex-shrink-0 order-5">
          <Chip color={strategyDisplay.color as any} variant="flat" size="sm" className="text-xs">
            {strategyDisplay.text}
          </Chip>
          <Chip variant="flat" size="sm" className="text-xs" color="primary">
            ↑{formatFlow(forward.inFlow || 0)}
          </Chip>
          <Chip variant="flat" size="sm" className="text-xs" color="success">
            ↓{formatFlow(forward.outFlow || 0)}
          </Chip>
        </div>

        <Chip
          color={statusDisplay.color as any}
          variant="flat"
          size="sm"
          className="text-xs flex-shrink-0 hidden sm:flex order-6"
        >
          {statusDisplay.text}
        </Chip>

        <Switch
          size="sm"
          isSelected={forward.serviceRunning}
          onValueChange={() => handleServiceToggle(forward)}
          isDisabled={forward.status !== 1 && forward.status !== 0}
          className="flex-shrink-0 order-7"
          aria-label={`${forward.name} 服务开关`}
        />

        <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto lg:ml-0 order-8">
          <Button
            size="sm"
            variant="flat"
            color="primary"
            onPress={() => handleEdit(forward)}
            className="min-h-8 px-2"
            startContent={
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
            }
          >
            编辑
          </Button>
          <Button
            size="sm"
            variant="flat"
            color="warning"
            onPress={() => handleDiagnose(forward)}
            className="min-h-8 px-2"
            startContent={
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            }
          >
            诊断
          </Button>
          <Button
            size="sm"
            variant="flat"
            color="danger"
            onPress={() => handleDelete(forward)}
            className="min-h-8 px-2"
            startContent={
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" clipRule="evenodd" />
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 012 0v4a1 1 0 11-2 0V7zM12 7a1 1 0 012 0v4a1 1 0 11-2 0V7z" clipRule="evenodd" />
              </svg>
            }
          >
            删除
          </Button>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3">
            <Spinner size="sm" />
            <span className="text-default-600">正在加载...</span>
          </div>
        </div>
      
    );
  }

  const tunnelGroups = groupForwardsByTunnel();
  const visibleForwards = getVisibleForwards();
  const isAllVisibleSelected = visibleForwards.length > 0 && visibleForwards.every(f => selectedIds.has(f.id));

  return (
    
      <div className="px-3 lg:px-6 py-8">
        {/* 页面头部 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex-1">
          </div>
          <div className="flex items-center gap-3">
            {/* 显示模式切换按钮 */}
            <Button
              size="sm"
              variant="flat"
              color="default"
              onPress={handleViewModeChange}
              isIconOnly
              className="text-sm"
              title={viewMode === 'grouped' ? '切换到直接显示' : '切换到分类显示'}
            >
              {viewMode === 'grouped' ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM3 16a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                </svg>
              )}
            </Button>
            
            {/* 多选 / 批量操作 */}
            <Button
              size="sm"
              variant={selectionMode ? 'solid' : 'flat'}
              color="default"
              onPress={handleSelectionModeToggle}
            >
              {selectionMode ? '取消多选' : '多选'}
            </Button>

            {selectionMode && (
              <>
                <Button
                  size="sm"
                  variant="flat"
                  color="default"
                  onPress={handleToggleSelectAll}
                >
                  {isAllVisibleSelected ? '取消全选' : '全选'}
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  color="success"
                  onPress={() => runBatchStatus(true)}
                  isLoading={batchStatusLoading === 'resume'}
                  isDisabled={selectedIds.size === 0 || batchStatusLoading !== null}
                >
                  批量开启
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  color="warning"
                  onPress={() => runBatchStatus(false)}
                  isLoading={batchStatusLoading === 'pause'}
                  isDisabled={selectedIds.size === 0 || batchStatusLoading !== null}
                >
                  批量暂停
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  color="danger"
                  onPress={handleBatchDelete}
                  isDisabled={selectedIds.size === 0}
                >
                  批量删除{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                </Button>
              </>
            )}

            {/* 导入按钮 */}
            <Button
              size="sm"
              variant="flat"
              color="warning"
              onPress={handleImport}
            >
              导入
            </Button>
            
            {/* 导出按钮 */}
            <Button
              size="sm"
              variant="flat"
              color="success"
              onPress={handleExport}
              isLoading={exportLoading}
          
            >
              导出
            </Button>

            <Button
              size="sm"
              variant="flat"
              color="primary"
              onPress={handleAdd}
             
            >
              新增
            </Button>
            
        
          </div>
        </div>


        {/* 根据显示模式渲染不同内容 */}
        {viewMode === 'grouped' ? (
          /* 按隧道分组的转发列表 */
          tunnelGroups.length > 0 ? (
            <Accordion
              variant="splitted"
              selectionMode="multiple"
              className="px-0 gap-3"
              defaultExpandedKeys={tunnelGroups.map((tg) => String(tg.tunnelId))}
            >
              {tunnelGroups.map((tunnelGroup) => (
                <AccordionItem
                  key={String(tunnelGroup.tunnelId)}
                  aria-label={tunnelGroup.tunnelName}
                  title={
                    <div className="flex items-center justify-between w-full min-w-0 pr-4">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-8 h-8 bg-success-100 dark:bg-success-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-medium text-foreground truncate">{tunnelGroup.tunnelName}</h3>
                          <p className="text-xs text-default-500">{tunnelGroup.forwards.length} 个转发</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <Chip variant="flat" size="sm" className="text-xs">
                          {tunnelGroup.forwards.filter(f => f.serviceRunning).length}/{tunnelGroup.forwards.length}
                        </Chip>
                      </div>
                    </div>
                  }
                  classNames={{ content: 'px-0 pt-0 pb-0' }}
                >
                  <div className="w-full divide-y divide-divider border-t border-divider">
                    {tunnelGroup.forwards.map((forward) => renderForwardCard(forward, undefined))}
                  </div>
                </AccordionItem>
              ))}
            </Accordion>
          ) : (
            /* 空状态 */
            <Card className="shadow-sm border border-gray-200 dark:border-gray-700">
              <CardBody className="text-center py-16">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 bg-default-100 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-default-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">暂无转发配置</h3>
                    <p className="text-default-500 text-sm mt-1">还没有创建任何转发配置，点击上方按钮开始创建</p>
                  </div>
                </div>
              </CardBody>
            </Card>
          )
        ) : (
          /* 直接显示模式 */
          getSortedForwards().length > 0 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
              onDragStart={() => {}} // 添加空的 onDragStart 处理器
            >
              <SortableContext
                items={getSortedForwards().map(f => f.id || 0).filter(id => id > 0)}
                strategy={verticalListSortingStrategy}
              >
                <Card className="shadow-sm border border-divider w-full overflow-hidden">
                  <div className="w-full divide-y divide-divider">
                    {getSortedForwards().map((forward) => (
                      forward && forward.id ? (
                        <SortableForwardCard key={forward.id} forward={forward} />
                      ) : null
                    ))}
                  </div>
                </Card>
              </SortableContext>
            </DndContext>
          ) : (
            /* 空状态 */
            <Card className="shadow-sm border border-gray-200 dark:border-gray-700">
              <CardBody className="text-center py-16">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 bg-default-100 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-default-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">暂无转发配置</h3>
                    <p className="text-default-500 text-sm mt-1">还没有创建任何转发配置，点击上方按钮开始创建</p>
                  </div>
                </div>
              </CardBody>
            </Card>
          )
        )}

        {/* 新增/编辑模态框 */}
        <Modal 
          isOpen={modalOpen}
          onOpenChange={setModalOpen}
          size="2xl"
          scrollBehavior="outside"
          backdrop="blur"
          placement="center"
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-xl font-bold">
                    {isEdit ? '编辑转发' : '新增转发'}
                  </h2>
                  <p className="text-small text-default-500">
                    {isEdit ? '修改现有转发配置的信息' : '创建新的转发配置'}
                  </p>
                </ModalHeader>
                <ModalBody>
                  <div className="space-y-4 pb-4">
                    <Input
                      label="转发名称"
                      placeholder="请输入转发名称"
                      value={form.name}
                      onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                      isInvalid={!!errors.name}
                      errorMessage={errors.name}
                      variant="bordered"
                    />
                    
                    <Select
                      label="选择隧道"
                      placeholder="请选择关联的隧道"
                      selectedKeys={form.tunnelId ? [form.tunnelId.toString()] : []}
                      onSelectionChange={(keys) => {
                        const selectedKey = Array.from(keys)[0] as string;
                        if (selectedKey) {
                          handleTunnelChange(selectedKey);
                        }
                      }}
                      isInvalid={!!errors.tunnelId}
                      errorMessage={errors.tunnelId}
                      variant="bordered"
                      isDisabled={isEdit}
                      description={isEdit ? "编辑时无法修改关联隧道" : undefined}
                    >
                      {tunnels.map((tunnel) => (
                        <SelectItem key={tunnel.id} >
                          {tunnel.name}
                        </SelectItem>
                      ))}
                    </Select>

                    <Input
                      label="入口端口"
                      placeholder="留空则自动分配可用端口"
                      type="number"
                      value={form.inPort !== null ? form.inPort.toString() : ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        setForm(prev => ({ 
                          ...prev, 
                          inPort: value ? parseInt(value) : null
                        }));
                      }}
                      isInvalid={!!errors.inPort}
                      errorMessage={errors.inPort}
                      variant="bordered"
                      description="指定入口端口，留空则从节点可用端口中自动分配"
                    />
                    
                    <Textarea
                      label="远程地址"
                      placeholder="请输入远程地址，多个地址用换行分隔&#10;例如:&#10;192.168.1.100:8080&#10;example.com:3000"
                      value={form.remoteAddr}
                      onChange={(e) => setForm(prev => ({ ...prev, remoteAddr: e.target.value }))}
                      isInvalid={!!errors.remoteAddr}
                      errorMessage={errors.remoteAddr}
                      variant="bordered"
                      description="格式: IP:端口 或 域名:端口，支持多个地址（每行一个）"
                      minRows={3}
                      maxRows={6}
                    />
                    
                    {getAddressCount(form.remoteAddr) > 1 && (
                      <Select
                        label="负载策略"
                        placeholder="请选择负载均衡策略"
                        selectedKeys={[form.strategy]}
                        onSelectionChange={(keys) => {
                          const selectedKey = Array.from(keys)[0] as string;
                          setForm(prev => ({ ...prev, strategy: selectedKey }));
                        }}
                        variant="bordered"
                        description="多个目标地址的负载均衡策略"
                      >
                        <SelectItem key="fifo" >主备模式 - 自上而下</SelectItem>
                        <SelectItem key="round" >轮询模式 - 依次轮换</SelectItem>
                        <SelectItem key="rand" >随机模式 - 随机选择</SelectItem>
                        <SelectItem key="hash" >哈希模式 - IP哈希</SelectItem>
                      </Select>
                    )}
                  </div>
                </ModalBody>
                <ModalFooter>
                  <Button variant="light" onPress={onClose}>
                    取消
                  </Button>
                  <Button 
                    color="primary" 
                    onPress={handleSubmit}
                    isLoading={submitLoading}
                  >
                    {isEdit ? '保存修改' : '创建转发'}
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

        {/* 删除确认模态框 */}
        <Modal 
          isOpen={deleteModalOpen}
          onOpenChange={setDeleteModalOpen}
          size="2xl"
        scrollBehavior="outside"
        backdrop="blur"
        placement="center"
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-lg font-bold text-danger">确认删除</h2>
                </ModalHeader>
                <ModalBody>
                  <p className="text-default-600">
                    确定要删除转发 <span className="font-semibold text-foreground">"{forwardToDelete?.name}"</span> 吗？
                  </p>
                  <p className="text-small text-default-500 mt-2">
                    此操作无法撤销，删除后该转发将永久消失。
                  </p>
                </ModalBody>
                <ModalFooter>
                  <Button variant="light" onPress={onClose}>
                    取消
                  </Button>
                  <Button 
                    color="danger" 
                    onPress={confirmDelete}
                    isLoading={deleteLoading}
                  >
                    确认删除
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

        {/* 批量暂停/开启失败详情 */}
        <Modal
          isOpen={batchStatusModalOpen}
          onOpenChange={setBatchStatusModalOpen}
          size="2xl"
          scrollBehavior="outside"
          backdrop="blur"
          placement="center"
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-lg font-bold">
                    批量{batchStatusAction === 'resume' ? '开启' : '暂停'}结果
                  </h2>
                </ModalHeader>
                <ModalBody>
                  <p className="text-default-600">
                    成功 <span className="font-semibold text-success">{batchStatusResults.filter(r => r.success).length}</span> 条，
                    失败 <span className="font-semibold text-danger">{batchStatusResults.filter(r => !r.success).length}</span> 条。
                  </p>
                  <div className="max-h-60 overflow-y-auto rounded border border-divider divide-y divide-divider">
                    {batchStatusResults.map(item => (
                      <div key={item.id} className="px-3 py-2 flex items-center justify-between gap-2">
                        <span className="text-sm text-foreground truncate">{item.name}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-default-500 truncate max-w-[220px]">{item.msg}</span>
                          <Chip size="sm" variant="flat" color={item.success ? 'success' : 'danger'} className="text-xs">
                            {item.success ? '成功' : '失败'}
                          </Chip>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-small text-default-500 mt-2">
                    失败项已保持选中，可修正后重试。
                  </p>
                </ModalBody>
                <ModalFooter>
                  <Button variant="light" onPress={onClose}>
                    关闭
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

        {/* 批量删除确认模态框 */}
        <Modal
          isOpen={batchDeleteModalOpen}
          onOpenChange={setBatchDeleteModalOpen}
          size="2xl"
          scrollBehavior="outside"
          backdrop="blur"
          placement="center"
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-lg font-bold text-danger">批量删除转发</h2>
                </ModalHeader>
                <ModalBody>
                  {batchDeleteResults.length === 0 ? (
                    <>
                      <p className="text-default-600">
                        确定要删除选中的 <span className="font-semibold text-foreground">{selectedIds.size}</span> 条转发吗？
                      </p>
                      <div className="max-h-60 overflow-y-auto rounded border border-divider divide-y divide-divider">
                        {visibleForwards
                          .filter(f => selectedIds.has(f.id))
                          .map(f => (
                            <div key={f.id} className="px-3 py-2 flex items-center justify-between gap-2">
                              <span className="text-sm text-foreground truncate">{f.name}</span>
                              <span className="text-xs text-default-500 truncate flex-shrink-0">{f.tunnelName}</span>
                            </div>
                          ))}
                      </div>
                      <p className="text-small text-default-500 mt-2">
                        此操作无法撤销，删除后这些转发将永久消失。
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-default-600">
                        成功 <span className="font-semibold text-success">{batchDeleteResults.filter(r => r.success).length}</span> 条，
                        失败 <span className="font-semibold text-danger">{batchDeleteResults.filter(r => !r.success).length}</span> 条。
                      </p>
                      <div className="max-h-60 overflow-y-auto rounded border border-divider divide-y divide-divider">
                        {batchDeleteResults.map(item => (
                          <div key={item.id} className="px-3 py-2 flex items-center justify-between gap-2">
                            <span className="text-sm text-foreground truncate">{item.name}</span>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-xs text-default-500 truncate max-w-[200px]">{item.msg}</span>
                              <Chip size="sm" variant="flat" color={item.success ? 'success' : 'danger'} className="text-xs">
                                {item.success ? '成功' : '失败'}
                              </Chip>
                            </div>
                          </div>
                        ))}
                      </div>
                      <Alert color="warning" className="mt-2">
                        失败项已保持选中。强制删除不会验证节点端是否已删除对应转发服务，可能在节点上残留服务。
                      </Alert>
                    </>
                  )}
                </ModalBody>
                <ModalFooter>
                  <Button variant="light" onPress={onClose}>
                    {batchDeleteResults.length === 0 ? '取消' : '关闭'}
                  </Button>
                  {batchDeleteResults.some(r => !r.success) && (
                    <Button
                      color="warning"
                      onPress={() => runBatchDelete(true)}
                      isLoading={batchDeleteLoading}
                    >
                      强制删除失败项
                    </Button>
                  )}
                  {batchDeleteResults.length === 0 && (
                    <Button
                      color="danger"
                      onPress={() => runBatchDelete(false)}
                      isLoading={batchDeleteLoading}
                    >
                      确认删除
                    </Button>
                  )}
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

        {/* 地址列表弹窗 */}
        <Modal isOpen={addressModalOpen} onClose={() => setAddressModalOpen(false)} size="lg" scrollBehavior="outside">
          <ModalContent>
            <ModalHeader className="text-base">{addressModalTitle}</ModalHeader>
            <ModalBody className="pb-6">
              <div className="mb-4 text-right">
                <Button size="sm" onClick={copyAllAddresses}>
                  复制
                </Button>
              </div>
              
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {addressList.map((item) => (
                  <div key={item.id} className="flex justify-between items-center p-3 border border-default-200 dark:border-default-100 rounded-lg">
                    <code className="text-sm flex-1 mr-3 text-foreground">{item.address}</code>
                    <Button
                      size="sm"
                      variant="light"
                      isLoading={item.copying}
                      onClick={() => copyAddress(item)}
                    >
                      复制
                    </Button>
                  </div>
                ))}
              </div>
            </ModalBody>
          </ModalContent>
        </Modal>

        {/* 导出数据模态框 */}
        <Modal 
          isOpen={exportModalOpen} 
          onClose={() => {
            setExportModalOpen(false);
            setSelectedTunnelForExport(null);
            setExportData('');
          }} 
          
          size="2xl"
        scrollBehavior="outside"
        backdrop="blur"
        placement="center"
        >
          <ModalContent>
            <ModalHeader className="flex flex-col gap-1">
              <h2 className="text-xl font-bold">导出转发数据</h2>
              <p className="text-small text-default-500">
                格式：目标地址|转发名称|入口端口
              </p>
            </ModalHeader>
            <ModalBody className="pb-6">
              <div className="space-y-4">
                {/* 隧道选择 */}
                <div>
                  <Select
                    label="选择导出隧道"
                    placeholder="请选择要导出的隧道"
                    selectedKeys={selectedTunnelForExport ? [selectedTunnelForExport.toString()] : []}
                    onSelectionChange={(keys) => {
                      const selectedKey = Array.from(keys)[0] as string;
                      setSelectedTunnelForExport(selectedKey ? parseInt(selectedKey) : null);
                    }}
                    variant="bordered"
                    isRequired
                  >
                    {tunnels.map((tunnel) => (
                      <SelectItem key={tunnel.id.toString()} textValue={tunnel.name}>
                        {tunnel.name}
                      </SelectItem>
                    ))}
                  </Select>
                </div>

                {/* 导出按钮和数据 */}
                {exportData && (
                  <div className="flex justify-between items-center">
                    <Button 
                      color="primary" 
                      size="sm" 
                      onPress={executeExport}
                      isLoading={exportLoading}
                      isDisabled={!selectedTunnelForExport}
                      startContent={
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                        </svg>
                      }
                    >
                      重新生成
                    </Button>
                    <Button 
                      color="secondary" 
                      size="sm" 
                      onPress={copyExportData}
                      startContent={
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                          <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                        </svg>
                      }
                    >
                      复制
                    </Button>
                  </div>
                )}

                {/* 初始导出按钮 */}
                {!exportData && (
                  <div className="text-right">
                    <Button 
                      color="primary" 
                      size="sm" 
                      onPress={executeExport}
                      isLoading={exportLoading}
                      isDisabled={!selectedTunnelForExport}
                      startContent={
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                        </svg>
                      }
                    >
                      生成导出数据
                    </Button>
                  </div>
                )}

                {/* 导出数据显示 */}
                {exportData && (
                  <div className="relative">
                    <Textarea
                      value={exportData}
                      readOnly
                      variant="bordered"
                      minRows={10}
                      maxRows={20}
                      className="font-mono text-sm"
                      classNames={{
                        input: "font-mono text-sm"
                      }}
                      placeholder="暂无数据"
                    />
                  </div>
                )}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button 
                variant="light" 
                onPress={() => setExportModalOpen(false)}
              >
                关闭
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* 导入数据模态框 */}
        <Modal 
          isOpen={importModalOpen} 
          onClose={() => setImportModalOpen(false)} 
          
          size="2xl"
        scrollBehavior="outside"
        backdrop="blur"
        placement="center"
        >
          <ModalContent>
            <ModalHeader className="flex flex-col gap-1">
              <h2 className="text-xl font-bold">导入转发数据</h2>
              <p className="text-small text-default-500">
                格式：目标地址|转发名称|入口端口，每行一个，入口端口留空将自动分配可用端口
              </p>
              <p className="text-small text-default-400">
                目标地址支持单个地址(如：example.com:8080)或多个地址用逗号分隔(如：3.3.3.3:3,4.4.4.4:4)
              </p>
            </ModalHeader>
            <ModalBody className="pb-6">
              <div className="space-y-4">
                {/* 隧道选择 */}
                <div>
                  <Select
                    label="选择导入隧道"
                    placeholder="请选择要导入的隧道"
                    selectedKeys={selectedTunnelForImport ? [selectedTunnelForImport.toString()] : []}
                    onSelectionChange={(keys) => {
                      const selectedKey = Array.from(keys)[0] as string;
                      setSelectedTunnelForImport(selectedKey ? parseInt(selectedKey) : null);
                    }}
                    variant="bordered"
                    isRequired
                  >
                    {tunnels.map((tunnel) => (
                      <SelectItem key={tunnel.id.toString()} textValue={tunnel.name}>
                        {tunnel.name}
                      </SelectItem>
                    ))}
                  </Select>
                </div>

                {/* 输入区域 */}
                <div>
                  <Textarea
                    label="导入数据"
                    placeholder="请输入要导入的转发数据，格式：目标地址|转发名称|入口端口"
                    value={importData}
                    onChange={(e) => setImportData(e.target.value)}
                    variant="flat"
                    minRows={8}
                    maxRows={12}
                    classNames={{
                      input: "font-mono text-sm"
                    }}
                  />

                
                </div>

                {/* 导入结果 */}
                {importResults.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-base font-semibold">导入结果</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-default-500">
                          成功：{importResults.filter(r => r.success).length} / 
                          总计：{importResults.length}
                        </span>
                      </div>
                    </div>
                    
                    <div className="max-h-40 overflow-y-auto space-y-1" style={{
                      scrollbarWidth: 'thin',
                      scrollbarColor: 'rgb(156 163 175) transparent'
                    }}>
                      {importResults.map((result, index) => (
                        <div 
                          key={index} 
                          className={`p-2 rounded border ${
                            result.success 
                              ? 'bg-success-50 dark:bg-success-100/10 border-success-200 dark:border-success-300/20' 
                              : 'bg-danger-50 dark:bg-danger-100/10 border-danger-200 dark:border-danger-300/20'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {result.success ? (
                              <svg className="w-3 h-3 text-success-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            ) : (
                              <svg className="w-3 h-3 text-danger-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                              </svg>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className={`text-xs font-medium ${
                                  result.success ? 'text-success-700 dark:text-success-300' : 'text-danger-700 dark:text-danger-300'
                                }`}>
                                  {result.success ? '成功' : '失败'}
                                </span>
                                <span className="text-xs text-default-500">|</span>
                                <code className="text-xs font-mono text-default-600 truncate">{result.line}</code>
                              </div>
                              <div className={`text-xs ${
                                result.success ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'
                              }`}>
                                {result.message}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button 
                variant="light" 
                onPress={() => setImportModalOpen(false)}
              >
                关闭
              </Button>
              <Button 
                color="warning" 
                onPress={executeImport}
                isLoading={importLoading}
                isDisabled={!importData.trim() || !selectedTunnelForImport}
              >
                开始导入
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* 诊断结果模态框 */}
        <Modal 
          isOpen={diagnosisModalOpen}
          onOpenChange={setDiagnosisModalOpen}
          size="4xl"
          scrollBehavior="inside"
          backdrop="blur"
          placement="center"
          classNames={{
            base: "rounded-2xl",
            header: "rounded-t-2xl",
            body: "rounded-none",
            footer: "rounded-b-2xl"
          }}
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1 bg-content1 border-b border-divider">
                  <h2 className="text-xl font-bold">转发诊断结果</h2>
                  {currentDiagnosisForward && (
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-small text-default-500 truncate flex-1 min-w-0">{currentDiagnosisForward.name}</span>
                      <Chip 
                        color="primary"
                        variant="flat" 
                        size="sm"
                        className="flex-shrink-0"
                      >
                        转发服务
                      </Chip>
                    </div>
                  )}
                </ModalHeader>
                <ModalBody className="bg-content1">
                  {diagnosisLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <div className="flex items-center gap-3">
                        <Spinner size="sm" />
                        <span className="text-default-600">正在诊断...</span>
                      </div>
                    </div>
                  ) : diagnosisResult ? (
                    <div className="space-y-4">
                      {/* 统计摘要 */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="text-center p-3 bg-default-100 dark:bg-gray-800 rounded-lg border border-divider">
                          <div className="text-2xl font-bold text-foreground">{diagnosisResult.results.length}</div>
                          <div className="text-xs text-default-500 mt-1">总测试数</div>
                        </div>
                        <div className="text-center p-3 bg-success-50 dark:bg-success-900/20 rounded-lg border border-success-200 dark:border-success-700">
                          <div className="text-2xl font-bold text-success-600 dark:text-success-400">
                            {diagnosisResult.results.filter(r => r.success).length}
                          </div>
                          <div className="text-xs text-success-600 dark:text-success-400/80 mt-1">成功</div>
                        </div>
                        <div className="text-center p-3 bg-danger-50 dark:bg-danger-900/20 rounded-lg border border-danger-200 dark:border-danger-700">
                          <div className="text-2xl font-bold text-danger-600 dark:text-danger-400">
                            {diagnosisResult.results.filter(r => !r.success).length}
                          </div>
                          <div className="text-xs text-danger-600 dark:text-danger-400/80 mt-1">失败</div>
                        </div>
                      </div>

                      {/* 桌面端表格展示 */}
                      <div className="hidden md:block space-y-3">
                        {(() => {
                          // 使用后端返回的 chainType 和 inx 字段进行分组
                          const groupedResults = {
                            entry: diagnosisResult.results.filter(r => r.fromChainType === 1),
                            chains: {} as Record<number, typeof diagnosisResult.results>,
                            exit: diagnosisResult.results.filter(r => r.fromChainType === 3)
                          };
                          
                          // 按 inx 分组链路测试
                          diagnosisResult.results.forEach(r => {
                            if (r.fromChainType === 2 && r.fromInx != null) {
                              if (!groupedResults.chains[r.fromInx]) {
                                groupedResults.chains[r.fromInx] = [];
                              }
                              groupedResults.chains[r.fromInx].push(r);
                            }
                          });

                          const renderTableSection = (title: string, results: typeof diagnosisResult.results) => {
                            if (results.length === 0) return null;
                            
                            return (
                              <div key={title} className="border border-divider rounded-lg overflow-hidden bg-white dark:bg-gray-800">
                                <div className="bg-primary/10 dark:bg-primary/20 px-3 py-2 border-b border-divider">
                                  <h3 className="text-sm font-semibold text-primary">{title}</h3>
                                </div>
                                <table className="w-full text-sm">
                                  <thead className="bg-default-100 dark:bg-gray-700">
                                    <tr>
                                      <th className="px-3 py-2 text-left font-semibold text-xs">路径</th>
                                      <th className="px-3 py-2 text-center font-semibold text-xs w-20">状态</th>
                                      <th className="px-3 py-2 text-center font-semibold text-xs w-24">延迟(ms)</th>
                                      <th className="px-3 py-2 text-center font-semibold text-xs w-24">丢包率</th>
                                      <th className="px-3 py-2 text-center font-semibold text-xs w-20">质量</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-divider bg-white dark:bg-gray-800">
                                    {results.map((result, index) => {
                              const quality = getQualityDisplay(result.averageTime, result.packetLoss);
                              
                              return (
                                <tr key={index} className={`hover:bg-default-50 dark:hover:bg-gray-700/50 ${
                                  result.success ? 'bg-white dark:bg-gray-800' : 'bg-danger-50 dark:bg-danger-900/30'
                                }`}>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-2">
                                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                                        result.success 
                                          ? 'bg-success text-white' 
                                          : 'bg-danger text-white'
                                      }`}>
                                        {result.success ? '✓' : '✗'}
                                      </span>
                                      <div className="flex-1 min-w-0">
                                        <div className="font-medium text-foreground truncate">{result.description}</div>
                                        <div className="text-xs text-default-500 truncate">
                                          {result.targetIp}:{result.targetPort}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <Chip 
                                      color={result.success ? 'success' : 'danger'} 
                                      variant="flat"
                                      size="sm"
                                      className="min-w-[50px]"
                                    >
                                      {result.success ? '成功' : '失败'}
                                    </Chip>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    {result.success ? (
                                      <span className="font-semibold text-primary">
                                        {result.averageTime?.toFixed(0)}
                                      </span>
                                    ) : (
                                      <span className="text-default-400">-</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    {result.success ? (
                                      <span className={`font-semibold ${
                                        (result.packetLoss || 0) > 0 ? 'text-warning' : 'text-success'
                                      }`}>
                                        {result.packetLoss?.toFixed(1)}%
                                      </span>
                                    ) : (
                                      <span className="text-default-400">-</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    {result.success && quality ? (
                                      <Chip 
                                        color={quality.color as any} 
                                        variant="flat" 
                                        size="sm"
                                        className="text-xs"
                                      >
                                        {quality.text}
                                      </Chip>
                                    ) : (
                                      <span className="text-default-400">-</span>
                                    )}
                                  </td>
                                </tr>
                              );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            );
                          };

                          return (
                            <>
                              {/* 入口测试 */}
                              {renderTableSection('🚪 入口测试', groupedResults.entry)}
                              
                              {/* 链路测试（按跳数排序） */}
                              {Object.keys(groupedResults.chains)
                                .map(Number)
                                .sort((a, b) => a - b)
                                .map(hop => renderTableSection(`🔗 转发链 - 第${hop}跳`, groupedResults.chains[hop]))}
                              
                              {/* 出口测试 */}
                              {renderTableSection('🚀 出口测试', groupedResults.exit)}
                            </>
                          );
                        })()}
                      </div>

                      {/* 移动端卡片展示 */}
                      <div className="md:hidden space-y-3">
                        {(() => {
                          // 使用后端返回的 chainType 和 inx 字段进行分组
                          const groupedResults = {
                            entry: diagnosisResult.results.filter(r => r.fromChainType === 1),
                            chains: {} as Record<number, typeof diagnosisResult.results>,
                            exit: diagnosisResult.results.filter(r => r.fromChainType === 3)
                          };
                          
                          // 按 inx 分组链路测试
                          diagnosisResult.results.forEach(r => {
                            if (r.fromChainType === 2 && r.fromInx != null) {
                              if (!groupedResults.chains[r.fromInx]) {
                                groupedResults.chains[r.fromInx] = [];
                              }
                              groupedResults.chains[r.fromInx].push(r);
                            }
                          });

                          const renderCardSection = (title: string, results: typeof diagnosisResult.results) => {
                            if (results.length === 0) return null;
                            
                            return (
                              <div key={title} className="space-y-2">
                                <div className="px-2 py-1.5 bg-primary/10 dark:bg-primary/20 rounded-lg border border-primary/30">
                                  <h3 className="text-sm font-semibold text-primary">{title}</h3>
                                </div>
                                {results.map((result, index) => {
                                  const quality = getQualityDisplay(result.averageTime, result.packetLoss);
                                  
                                  return (
                                    <div key={index} className={`border rounded-lg p-3 ${
                                      result.success 
                                        ? 'border-divider bg-white dark:bg-gray-800' 
                                        : 'border-danger-200 dark:border-danger-300/30 bg-danger-50 dark:bg-danger-900/30'
                                    }`}>
                                      <div className="flex items-start gap-2 mb-2">
                                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                                          result.success ? 'bg-success text-white' : 'bg-danger text-white'
                                        }`}>
                                          {result.success ? '✓' : '✗'}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                          <div className="font-semibold text-sm text-foreground break-words">
                                            {result.description}
                                          </div>
                                          <div className="text-xs text-default-500 mt-0.5 break-all">
                                            {result.targetIp}:{result.targetPort}
                                          </div>
                                        </div>
                                        <Chip 
                                          color={result.success ? 'success' : 'danger'} 
                                          variant="flat"
                                          size="sm"
                                          className="flex-shrink-0"
                                        >
                                          {result.success ? '成功' : '失败'}
                                        </Chip>
                                      </div>
                                      
                                      {result.success ? (
                                        <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-divider">
                                          <div className="text-center">
                                            <div className="text-lg font-bold text-primary">
                                              {result.averageTime?.toFixed(0)}
                                            </div>
                                            <div className="text-xs text-default-500">延迟(ms)</div>
                                          </div>
                                          <div className="text-center">
                                            <div className={`text-lg font-bold ${
                                              (result.packetLoss || 0) > 0 ? 'text-warning' : 'text-success'
                                            }`}>
                                              {result.packetLoss?.toFixed(1)}%
                                            </div>
                                            <div className="text-xs text-default-500">丢包率</div>
                                          </div>
                                          <div className="text-center">
                                            {quality && (
                                              <>
                                                <Chip 
                                                  color={quality.color as any} 
                                                  variant="flat" 
                                                  size="sm"
                                                  className="text-xs"
                                                >
                                                  {quality.text}
                                                </Chip>
                                                <div className="text-xs text-default-500 mt-0.5">质量</div>
                                              </>
                                            )}
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="mt-2 pt-2 border-t border-divider">
                                          <div className="text-xs text-danger">
                                            {result.message || '连接失败'}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          };

                          return (
                            <>
                              {/* 入口测试 */}
                              {renderCardSection('🚪 入口测试', groupedResults.entry)}
                              
                              {/* 链路测试（按跳数排序） */}
                              {Object.keys(groupedResults.chains)
                                .map(Number)
                                .sort((a, b) => a - b)
                                .map(hop => renderCardSection(`🔗 转发链 - 第${hop}跳`, groupedResults.chains[hop]))}
                              
                              {/* 出口测试 */}
                              {renderCardSection('🚀 出口测试', groupedResults.exit)}
                            </>
                          );
                        })()}
                      </div>

                      {/* 失败详情（仅桌面端显示，移动端已在卡片中显示） */}
                      {diagnosisResult.results.some(r => !r.success) && (
                        <div className="space-y-2 hidden md:block">
                          <h4 className="text-sm font-semibold text-danger">失败详情</h4>
                          <div className="space-y-2">
                            {diagnosisResult.results.filter(r => !r.success).map((result, index) => (
                              <Alert
                                key={index}
                                color="danger"
                                variant="flat"
                                title={result.description}
                                description={result.message || '连接失败'}
                                className="text-xs"
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-16">
                      <div className="w-16 h-16 bg-default-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-default-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-semibold text-foreground">暂无诊断数据</h3>
                    </div>
                  )}
                </ModalBody>
                <ModalFooter className="bg-content1 border-t border-divider">
                  <Button variant="light" onPress={onClose}>
                    关闭
                  </Button>
                  {currentDiagnosisForward && (
                    <Button 
                      color="primary" 
                      onPress={() => handleDiagnose(currentDiagnosisForward)}
                      isLoading={diagnosisLoading}
                    >
                      重新诊断
                    </Button>
                  )}
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>
      </div>
    
  );
} 
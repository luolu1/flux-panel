package com.admin.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

import java.util.concurrent.ThreadPoolExecutor;

/**
 * 异步与定时任务线程池。
 * <p>
 * 节点配置下发单次最坏阻塞 10 秒（WebSocket 响应超时），批量推送会长时间占用线程，
 * 因此单独建池，避免拖垮流量上报等其它 @Async 任务。
 * <p>
 * 注意：一旦容器中出现自定义 Executor，Spring Boot 就不再自动配置 applicationTaskExecutor，
 * 未指定名称的 @Async 会退回 SimpleAsyncTaskExecutor（每次新建线程）；同理多个 TaskScheduler
 * 会让 @Scheduled 失去默认调度器。所以这里必须把通用的 taskExecutor / taskScheduler 一并显式声明。
 */
@Configuration
public class NodeSyncExecutorConfig {

    public static final String NODE_SYNC_EXECUTOR = "nodeSyncExecutor";

    public static final String NODE_SYNC_SCHEDULER = "nodeSyncScheduler";

    @Bean("taskExecutor")
    @Primary
    public ThreadPoolTaskExecutor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(8);
        executor.setMaxPoolSize(32);
        executor.setQueueCapacity(500);
        executor.setThreadNamePrefix("async-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(20);
        executor.initialize();
        return executor;
    }

    @Bean("taskScheduler")
    @Primary
    public ThreadPoolTaskScheduler taskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(4);
        scheduler.setThreadNamePrefix("scheduled-");
        scheduler.setWaitForTasksToCompleteOnShutdown(false);
        scheduler.initialize();
        return scheduler;
    }

    @Bean(NODE_SYNC_EXECUTOR)
    public ThreadPoolTaskExecutor nodeSyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(8);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("node-sync-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }

    @Bean(NODE_SYNC_SCHEDULER)
    public ThreadPoolTaskScheduler nodeSyncScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(2);
        scheduler.setThreadNamePrefix("node-sync-delay-");
        scheduler.setWaitForTasksToCompleteOnShutdown(false);
        scheduler.initialize();
        return scheduler;
    }
}

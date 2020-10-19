---
layout: post
title: "（十一）How Tomcat Works - Tomcat ShutdownHook"
date: 2020-10-17 22:26:10 +0800
categories: Tomcat Http web shutdownhook
tags: Tomcat Http web shutdownhook
---

Tomcat启动后应该使用`shutdown.sh`脚本，给Server发送"SHUTDOWN"进行关闭，完成Tomcat lifecycle的stop阶段。但是如果用户直接强制退出了，还能执行清理阶段吗？

1. Table of Contents, ordered
{:toc}

# ShutdownHook
Java有关闭机制。在jvm退出（只有守护线程、或者Linux命令行Ctrl+C、或者Windows直接叉掉窗口）时，会调用注册在jvm里的shutdown hook。所以只要把关闭Server的行为添加到shutdown hook里就行了。

添加shutdown hook非常简单：
1. 获取全局Runtime对象：`Runtime.getRuntime()`；
2. 调用ShutdownHook方法：`Runtime.getRuntime().addShutdownHook(Thread hook)`；

所谓的hook，其实就是一个Thread对象。它记录着要做的事情（run），jvm在结束前会执行它一下。

并行执行（`hook.start()`）：
```
    /* Iterates over all application hooks creating a new thread for each
     * to run in. Hooks are run concurrently and this method waits for
     * them to finish.
     */
    static void runHooks() {
        Collection<Thread> threads;
        synchronized(ApplicationShutdownHooks.class) {
            threads = hooks.keySet();
            hooks = null;
        }

        for (Thread hook : threads) {
            hook.start();
        }
        for (Thread hook : threads) {
            while (true) {
                try {
                    hook.join();
                    break;
                } catch (InterruptedException ignored) {
                }
            }
        }
    }
```
使用`hook.join()`等待所有hook执行完。

# Catalina注册shutdownhook
清理Server残局的shutdown hook就一句话：`server.stop()`，然后按照Tomcat的lifecycle机制，一串子组件都依次关闭了。

```
    /**
     * Shutdown hook which will perform a clean shutdown of Catalina if needed.
     */
    protected class CatalinaShutdownHook extends Thread {

        public void run() {

            if (server != null) {
                try {
                    ((Lifecycle) server).stop();
                } catch (LifecycleException e) {
                    System.out.println("Catalina.stop: " + e);
                    e.printStackTrace(System.out);
                    if (e.getThrowable() != null) {
                        System.out.println("----- Root Cause -----");
                        e.getThrowable().printStackTrace(System.out);
                    }
                }
            }

        }
    }
```

有趣的是Catalina注册该shutdown hook的地方：
```
        Thread shutdownHook = new CatalinaShutdownHook();

        // Start the new server
        if (server instanceof Lifecycle) {
            try {
                server.initialize();
                ((Lifecycle) server).start();
                try {
                    // Register shutdown hook
                    Runtime.getRuntime().addShutdownHook(shutdownHook);
                } catch (Throwable t) {
                    // This will fail on JDK 1.2. Ignoring, as Tomcat can run
                    // fine without the shutdown hook.
                }
                // Wait for the server to be told to shut down
                server.await();
            } catch (LifecycleException e) {
                System.out.println("Catalina.start: " + e);
                e.printStackTrace(System.out);
                if (e.getThrowable() != null) {
                    System.out.println("----- Root Cause -----");
                    e.getThrowable().printStackTrace(System.out);
                }
            }
        }

        // Shut down the server
        if (server instanceof Lifecycle) {
            try {
                try {
                    // Remove the ShutdownHook first so that server.stop()
                    // doesn't get invoked twice
                    Runtime.getRuntime().removeShutdownHook(shutdownHook);
                } catch (Throwable t) {
                    // This will fail on JDK 1.2. Ignoring, as Tomcat can run
                    // fine without the shutdown hook.
                }
                ((Lifecycle) server).stop();
            } catch (LifecycleException e) {
                System.out.println("Catalina.stop: " + e);
                e.printStackTrace(System.out);
                if (e.getThrowable() != null) {
                    System.out.println("----- Root Cause -----");
                    e.getThrowable().printStackTrace(System.out);
                }
            }
        }
```
启动Server后，start server，紧接着注册stop Server的shutdown hook。

但是如果Server收到"SHUTDOWN"了（Server在8005端口阻塞接收消息，跟Connector在8080端口无关），`await`方法会结束while true循环。代码继续往后执行，这时候Server是正常结束的，要正常执行`server.stop()`。就不需要在stop Server的shutdown hook里再做一遍stop server操作了，所以**这里会把该shutdown hook删掉**。细致！


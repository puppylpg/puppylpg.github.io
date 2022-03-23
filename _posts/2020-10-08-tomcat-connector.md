---
layout: post
title: "（三）How Tomcat Works - Tomcat连接器Connector"
date: 2020-10-08 00:09:40 +0800
categories: Tomcat Http web servlet
tags: Tomcat Http web servlet
---

显然，servlet容器承担了两部分的职责：作为web server处理http请求；作为servlet容器处理servlet相关的内容。Tomcat在实现时按照这两部分，可以被归类为两个主要模块：
- 连接器（Connector）：处理http相关内容；
- servlet容器（Container）：处理servlet相关内容；

1. Table of Contents, ordered
{:toc}

# 朴素connector和processor
从[（一）How Tomcat Works - 原始Web服务器]({% post_url 2020-10-07-tomcat-web-server %})得知，一个朴素的web服务器的处理流程：
1. connector监听ServerSocket；
2. 每收到一个socket，交给processor去异步处理这个socket。**connector则继续循环监听**；
3. 处理器异步处理完socket之后，**关闭socket，然后processor线程终结**；

servlet container则应该在processor部分。

上述朴素模型有一点是必须优化的：**processor线程可以池化，没必要处理完就扔**。

# Tomcat的connector和processor
## `org.apache.catalina.Connector`：连接器接口
Connector是Tomcat的连接器必须实现的接口，主要作用是：
1. 创建`org.apache.catalina.Request`和`org.apache.catalina.Response`；
2. 调用`org.apache.catalina.Container`处理`org.apache.catalina.Request`和`org.apache.catalina.Response`；

所以Connector接口主要方法有：
- createRequest/createResponse；
- setContainer/getContainer：用于关联Container；

## `org.apache.catalina.connector.http.HttpConnector`：早期tomcat http连接器实现

> 这个http connector是Tomcat4的默认连接器，后来被速度更快的连接器取代了，不过这个连接器很适合学习。

**connector的主逻辑依旧和上面的朴素connector一致**！最大的不同是：这个connector收到socket，使用processor的时候，不是直接创建的新线程，而是优先从processor线程池取processor线程。

表面上看，它和朴素的connector做的别无二致：
```
            // 省略上面监听ServerSocket获取socket的代码
            ...
            // 只展示获取socket之后怎么交由processor处理的代码
            
            // Hand this socket off to an appropriate processor
            HttpProcessor processor = createProcessor();
            if (processor == null) {
                try {
                    log(sm.getString("httpConnector.noProcessor"));
                    socket.close();
                } catch (IOException e) {
                    ;
                }
                continue;
            }
            //            if (debug >= 3)
            //                log("run: Assigning socket to processor " + processor);
            processor.assign(socket);
```
把上面的流程进行拆分，大致三步：
1. 获取processor；
2. 如果获取不到processor，**关闭socket，直接返回**；
3. 如果获取到processor，将socket交由processor处理；

### 获取processor：池化
它对朴素的connector的“create processor”进行了偷梁换柱，名义上和以前一样还是“创建一个processor线程”，实际上是从线程池取的：
```
    /**
     * Create (or allocate) and return an available processor for use in
     * processing a specific HTTP request, if possible.  If the maximum
     * allowed processors have already been created and are in use, return
     * <code>null</code> instead.
     */
    private HttpProcessor createProcessor() {

        synchronized (processors) {
            if (processors.size() > 0) {
                // if (debug >= 2)
                // log("createProcessor: Reusing existing processor");
                return ((HttpProcessor) processors.pop());
            }
            if ((maxProcessors > 0) && (curProcessors < maxProcessors)) {
                // if (debug >= 2)
                // log("createProcessor: Creating new processor");
                return (newProcessor());
            } else {
                if (maxProcessors < 0) {
                    // if (debug >= 2)
                    // log("createProcessor: Creating new processor");
                    return (newProcessor());
                } else {
                    // if (debug >= 2)
                    // log("createProcessor: Cannot create new processor");
                    return (null);
                }
            }
        }

    }
```
1. 如果线程池已经有可用线程，那就直接拿走，用于处理socket；
2. **如果线程池没有可用线程，且已创建的线程数不到max**，那就继续创建线程；
2. 否则return null；

这个线程池是什么？**tomcat里用了`java.util.Stack`**，实际上用List之类的也是可以的。

为了让一开始的socket处理的也比较高效，可以提前在线程池里放置一些线程，使用min参数控制：
```
    /**
     * Begin processing requests via this Connector.
     *
     * @exception LifecycleException if a fatal startup error occurs
     */
    public void start() throws LifecycleException {
        // 其他无关代码不再展示
        // ...

        // Create the specified minimum number of processors
        while (curProcessors < minProcessors) {
            if ((maxProcessors > 0) && (curProcessors >= maxProcessors))
                break;
            HttpProcessor processor = newProcessor();
            recycle(processor);
        }

    }
```
所谓“recycle”，就是把processor对象push到线程池Stack里。

### 丢弃请求
**如果取到的processor是个null，connector关掉socket，继续监听下一个**。

这其实是一种超负荷时候的处理策略：丢弃。当然，**如果进一步优化，这里可以设置一个有界队列，处理不过来的socket先入队**。

> 队列：削峰填谷。

### 处理请求：线程不足时的请求处理策略
调用processor处理请求：`processor.assign(socket)`。接下来就介绍processor。

> 为什么说这个http connector比较朴素？**没有NIO啊！只是使用多线程实现了伪非阻塞而已**！（不过当时Java也没有NIO吧……）
> 
> 详见：[从阻塞IO到IO多路复用到异步IO]({% post_url 2022-02-24-io-nio-aio %}) 

## `org.apache.catalina.connector.http.HttpProcessor`：早期tomcat processor实现
每次HttpConnector获取一个socket，都会交给HttpProcessor处理。每一个HttpProcessor内部持有一个Request和一个Response，因为要解析http请求，填充到Request里。构造HttpProcessor的时候，调用HttpConnector的createRequest/createResponse创建这两个对象。

重要的是：
1. 线程启动之后，在线程池里无事可做的时候，**他们在干什么**？
2. **他们又是怎么在有socket要处理的时候开始工作的**？

这就用到了Java最基本的线程唤醒机制wait-notify：[生产者 - 消费者]({% post_url 2020-05-17-producer-consumer %})。

所以前两个问题的答案就是：
1. **他们在`wait()`。线程挂起**；
2. **他们被`notify()`了，线程进入runnable状态**。

### 生产者线程：notify唤醒消费者线程
继续上述connector里调用processor处理请求的方法：`processor.assign(socket)`。

在生产者-消费者模型中：
1. **connector是任务的生产者**；
2. processor是任务的消费者；

可容纳任务的队列大小为：1。其实就是没有队列，不允许积压任务，每次connector最多分配一个socket处理任务给processor。

connector线程唤醒processor线程：
```
    synchronized void assign(Socket socket) {

        // Wait for the Processor to get the previous Socket
        while (available) {
            try {
                wait();
            } catch (InterruptedException e) {
            }
        }

        // Store the newly available Socket and notify our thread
        this.socket = socket;
        available = true;
        notifyAll();

        if ((debug >= 1) && (socket != null))
            log(" An incoming request is being assigned");

    }
```
available代表是否已经有socket可处理，刚取出来的processor，肯定是没有socket要处理，为false。所以connector线程会把available设为true，然后 **notify挂起在processor对象上的消费者线程**。

### 生产者线程：wait挂起线程
如果available=true，说明已经在处理socket。connector线程（生产者）就会挂起。当然这是不存在的。因为所有从线程池取出来的processor（对象上的消费者线程）必然是挂起状态，没有要处理的socket。**所以生产者（connector线程）生产任务一定是可行的，因此不会被阻塞**。

实际上connector线程也不能被阻塞，否则没法处理客户端的连接请求了。

### 消费者线程：wait挂起线程
消费者线程在没有要处理的socket时会使用自己的`await()`方法挂起，否则开始处理数据：
```
    /**
     * The background thread that listens for incoming TCP/IP connections and
     * hands them off to an appropriate processor.
     */
    public void run() {

        // Process requests until we receive a shutdown signal
        while (!stopped) {

            // Wait for the next socket to be assigned 挂起
            Socket socket = await();
            if (socket == null)
                continue;

            // Process the request from this socket
            try {
                process(socket);
            } catch (Throwable t) {
                log("process.invoke", t);
            }

            // Finish up this request
            connector.recycle(this);

        }

        // Tell threadStop() we have shut ourselves down successfully
        synchronized (threadSync) {
            threadSync.notifyAll();
        }

    }
```
await方法：
```
    /**
     * Await a newly assigned Socket from our Connector, or <code>null</code>
     * if we are supposed to shut down.
     */
    private synchronized Socket await() {

        // Wait for the Connector to provide a new Socket
        while (!available) {
            try {
                wait();
            } catch (InterruptedException e) {
            }
        }

        // Notify the Connector that we have received this Socket
        Socket socket = this.socket;
        available = false;
        notifyAll();

        if ((debug >= 1) && (socket != null))
            log("  The incoming request has been awaited");

        return (socket);

    }
```

### 消费者线程：notify唤醒生产者线程
消费者线程处理完任务，唤醒阻塞的生产者线程，告诉它你可以继续给我分配任务了。

但是刚刚已经说过了，生产者线程压根不会wait，所以这里消费者线程其实也只是一个语义上的完整。**实际上这套wait-notify体系里，永远只有消费者在wait，生产者在notify**。

### 请求处理的细节
经过一通线程唤醒，终于开始处理socket了。process socket一步才是HttpProcessor的核心处理流程：
```
    /**
     * Process an incoming HTTP request on the Socket that has been assigned
     * to this Processor.  Any exceptions that occur during processing must be
     * swallowed and dealt with.
     *
     * @param socket The socket on which we are connected to the client
     */
    private void process(Socket socket) {
        boolean ok = true;
        boolean finishResponse = true;
        SocketInputStream input = null;
        OutputStream output = null;

        // Construct and initialize the objects we will need
        try {
            input = new SocketInputStream(socket.getInputStream(),
                                          connector.getBufferSize());
        } catch (Exception e) {
            log("process.create", e);
            ok = false;
        }

        keepAlive = true;

        while (!stopped && ok && keepAlive) {

            finishResponse = true;

            try {
                request.setStream(input);
                request.setResponse(response);
                output = socket.getOutputStream();
                response.setStream(output);
                response.setRequest(request);
                ((HttpServletResponse) response.getResponse()).setHeader
                    ("Server", SERVER_INFO);
            } catch (Exception e) {
                log("process.create", e);
                ok = false;
            }


            // Parse the incoming request
            try {
                if (ok) {
                    parseConnection(socket);
                    parseRequest(input, output);
                    if (!request.getRequest().getProtocol().startsWith("HTTP/0"))
                        parseHeaders(input);
                    if (http11) {
                        // Sending a request acknowledge back to the client if
                        // requested.
                        ackRequest(output);
                        // If the protocol is HTTP/1.1, chunking is allowed.
                        if (connector.isChunkingAllowed())
                            response.setAllowChunking(true);
                    }

                }
            } catch (EOFException e) {
            }

            // Ask our Container to process this request
            try {
                ((HttpServletResponse) response).setHeader
                    ("Date", FastHttpDateFormat.getCurrentDate());
                if (ok) {
                    connector.getContainer().invoke(request, response);
                }
            } catch (ServletException e) {
            }

            // Finish up the handling of the request
            if (finishResponse) {
                response.finishResponse();
            }

            // We have to check if the connection closure has been requested
            // by the application or the response stream (in case of HTTP/1.0
            // and keep-alive).
            if ( "close".equals(response.getHeader("Connection")) ) {
                keepAlive = false;
            }

            // End of request processing
            status = Constants.PROCESSOR_IDLE;

            // Recycling the request and the response objects
            request.recycle();
            response.recycle();
        }

        shutdownInput(input);
        socket.close();
        socket = null;
    }
```

#### keep-alive
首先注意到的是while循环，如果keepAlive为true，或者header里的Connection不为"close"，**则不关闭这个socket，而是继续在该socket上读写。这其实就是keep-alive的本质啊**！同一个socket发送多个request和response，而不是每次重建一个socket。

> **所以所谓的断开连接就是断开socket，重建连接就是重新获取一个socket。**

但这么做也有一个缺点：**这个processor线程被这个socket长期霸占了！这样就非常消耗服务器线程**！尤其是当接下来没有请求再从这个连接上发过来的时候！如果长连接的client多了，服务器会不堪重负。

#### http 1.1 100
如果是http 1.1协议，且Header里有：`Expect: 100-continue`，server先回复一个ack：`HTTP/1.1 100 Continue\r\n\r\n`。

这是客户端准备发送较长的请求体之前先确认server活着，不然白发那么大的请求了。

#### Transfer-Encoding
http1.1 keep-alive，可以发送多个请求响应，怎么确定一个请求响应结束了？

发送内容的时候带上特殊标记：每一块内容之前都有“这一块内容的字节大小（十六进制）\r\n”的标记，如果出现`0\r\n`，说明后面没内容了。

http1.1默认长连接，所以默认允许chunked，响应的header里会有`Transfer-Encoding: chunked`，除非请求的header用了`Connection: close`之类明确不允许长连接的设定。

#### parse request、parse header
不必多言，很复杂的plain text解析。

#### 调用servlet处理请求：下一篇文章再介绍container
如果前面的解析都没问题，这是一个合法的http请求，可以使用servlet处理request获取response了。

**是的，直到这里，才开始做servlet container相关的事！所以如果没有servlet container，那我们要实现之前那么多东西，才能开始进入真正的业务逻辑处理阶段！**

如开头所说，servlet的处理是由Container完成的：
```
        if (ok) {
            connector.getContainer().invoke(request, response);
        }
```
Connector和Container绑定，所以可以获取Container。

# Connector在tomcat配置中的体现形式
见下一篇：[（四）How Tomcat Works - Tomcat servlet容器Container]({% post_url 2020-10-08-tomcat-container %})

# 所谓线程池：其实是对象池
**线程池里放的是线程吗？不是，是processor对象。那为什么还要叫它线程池，而不是processor对象池？**

因为每个processor对象上，都挂起了一个消费者线程。由[Java Monitor]({% post_url 2021-04-07-monitor %})可知，线程挂起在processor对象的waitset里。

**所以，拿到一个processor对象，其实就相当于拿到了一个闲置的线程，只要把它notify了，它就可以异步处理任务了**！基于这种理解，把processor对象池称为线程池并没有什么问题。

# Tomcat线程池 vs. ThreadPoolExecutor
Java 1.5引入的ThreadPoolExecutor线程池，工作原理和上面类似，但小有区别——

Tomcat线程池是：
1. 一个生产者：connector线程；
2. 一堆消费者：processor对象池；

首先每次从stack里获取一个闲置processor对象，放入socket，nofity，使闲置的线程运行。**所以生产者一定不会阻塞**，除非拿不出来processor了。而此时tomcat默认会丢掉任务（close socket）。

tomcat的这一套线程池没有队列的概念。

ThreadPoolExecutor是：
1. 一个阻塞队列，用于放置任务；
2. 一堆消费者线程；

ThreadPoolExecutor有一个阻塞队列，专门用来放置任务。`ThreadPoolExecutor#execute`是每次扔一个Runnable任务给ThreadPoolExecutor的BlockingQueue，ThreadPoolExecutor里的线程都使用`BlockingQueue#take`阻塞着，一旦有内容，BlockingQueue notify一个线程执行该Runnable。

生产者线程是任务提交者，但它不是通过`BlockingQueue#put`提交的，**所以ThreadPoolExecutor并不打算阻塞生产者线程**。也因为如此，它设计了很多队列满之后的处理逻辑：
- AbortPolicy：默认，直接throw new RejectedExecutionException
- DiscardPolicy：tomcat其实是这么干的
- DiscardOldestPolicy
- CallerRunsPolicy

参阅：
- [生产者 - 消费者]({% post_url 2020-05-17-producer-consumer %})：对blocking queue的介绍；
- [Executor - Thread Pool]({% post_url 2020-06-03-Executor-Thread-Pool %})：对ThreadPoolExecutor、RejectedExecutionHandler和blocking queue的介绍；

> 至于池的底层表现，Tomcat用的是Stack，ThreadPoolExecutor用的是HashSet，这点倒没有特别大的区别。



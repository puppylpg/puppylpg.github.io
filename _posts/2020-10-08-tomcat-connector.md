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

# `org.apache.catalina.Connector`
Tomcat的连接器必须实现的接口。

Connector的主要作用是：
1. 创建`org.apache.catalina.Request`和`org.apache.catalina.Response`；
2. 调用`org.apache.catalina.Container`处理`org.apache.catalina.Request`和`org.apache.catalina.Response`；

所以Connector接口主要方法有：
- createRequest/createResponse；
- setContainer/getContainer：用于关联Container；

# `org.apache.catalina.connector.http.HttpConnector`

> 这个实现是Tomcat4的默认连接器，后来被速度更快的连接器取代了，不过这个连接器很适合学习。

对于一个web server，应该有一个监听端口的线程接收请求，另一堆工作线程用于处理请求，这样才能做到并发，一次同时处理多个请求。

HttpConnector就是这样做的。

## 工作线程池 - stack of HttpProcessor
每次HttpConnector获取一个socket，都会交给HttpProcessor处理。每一个HttpProcessor内部持有一个Request和一个Response，因为要解析http请求，填充到Request里。构造HttpProcessor的时候，调用HttpConnector的createRequest/createResponse创建这两个对象。

每一个HttpProcessor在一个线程中运行。所以线程池就是HttpProcessor池，可以简单地由Stack来代替。当pop不出HttpProcessor对象的时候，说明工作线程空了。

线程池的大小则可以指定。

初始化minProcessors个processor：
```
        // Create the specified minimum number of processors
        while (curProcessors < minProcessors) {
            if ((maxProcessors > 0) && (curProcessors >= maxProcessors))
                break;
            HttpProcessor processor = newProcessor();
            processors.push(processor);
        }
```
**使用新线程启动每一个processor（start方法内部使用了新的Thread启动）**：
```
    /**
     * Create and return a new processor suitable for processing HTTP
     * requests and returning the corresponding responses.
     */
    private HttpProcessor newProcessor() {

        //        if (debug >= 2)
        //            log("newProcessor: Creating new processor");
        HttpProcessor processor = new HttpProcessor(this, curProcessors++);
        if (processor instanceof Lifecycle) {
            try {
                ((Lifecycle) processor).start();
            } catch (LifecycleException e) {
                log("newProcessor", e);
                return (null);
            }
        }
        created.addElement(processor);
        return (processor);

    }
```
同时HttpConnector在监听socket，获取processor，把socket交给processor处理：
```
        while (!stopped) {
            // Accept the next incoming connection from the server socket
            Socket socket = null;

            socket = serverSocket.accept();
            if (connectionTimeout > 0)
                socket.setSoTimeout(connectionTimeout);
            socket.setTcpNoDelay(tcpNoDelay);


            // Hand this socket off to an appropriate processor
            HttpProcessor processor = createProcessor();
            
            if (processor == null) {
                socket.close();
                continue;
            }
            
            processor.assign(socket);
        }
    }
```
首先，获取的socket都设置了超时时间。

其次，获取processor并不是真的在create，毕竟是有processor池的，只有大于min小于max时才真正create：
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
                return ((HttpProcessor) processors.pop());
            }
            if ((maxProcessors > 0) && (curProcessors < maxProcessors)) {
                return (newProcessor());
            } else {
                if (maxProcessors < 0) {
                    return (newProcessor());
                } else {
                    return (null);
                }
            }
        }

    }
```

另外如果processor都在忙，获取到的processor为null，直接把socket close掉了，**相当于处理不过来时直接丢掉了请求**。这里复杂点儿的话可以考虑搞个队列，比如100，队列满了之后再丢掉socket。

## **线程池的线程启动之后都在做什么**？
如果不使用线程池，每次new一个processor，将socket传给processor，使用一个新线程去执行processor的处理方法就行了。

但是使用了processor池/线程池之后，线程池里的线程工作完之后怎么入池？入池之后在做什么？

先看线程池里的线程启动后在做什么。启动线程实际是用一个new thread启动了一个processor，看看processor的run方法：
```
    /**
     * The background thread that listens for incoming TCP/IP connections and
     * hands them off to an appropriate processor.
     */
    public void run() {

        // Process requests until we receive a shutdown signal
        while (!stopped) {

            // Wait for the next socket to be assigned
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
await:
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
1. 线程启动之后进入await方法；
    1. 首先判断当前processor有没有可处理的socket，没有就wait阻塞；
    2. 有的话就继续执行；
2. 继续执行是process socket；
3. 最后recycle processor，实际是processor入池（push到stack里）；

什么时候有可用的socket？

上面HttpConnector在获取到socket之后，通过`processor.assign(socket)`方法交给了processor：
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
**processor的assign是HttpConnector线程调用的**。HttpConnector线程发现processor里没有可用的socket就会继续执行下去，将socket放置在processor里，**然后唤醒执行processor的线程**。线程池里沉睡的线程现在起来干活了。

**所以available变量相当于processor里的一个单元素队列。HttpConnector是生产者线程，HttpProcessor是消费者线程，二者通过wait/notify机制实现了工作线程的沉睡/唤醒。**

> [生产者 - 消费者]({% post_url 2020-05-17-producer-consumer %})

## ThreadPoolExecutor
Java 1.5引入的ThreadPoolExecutor线程池，工作原理和上面类似，但小有区别。

Tomcat是每次从stack里获取一个processor，放入socket，nofity线程使之运行。ThreadPoolExecutor#execute是每次扔一个Runnable任务给ThreadPoolExecutor的BlockingQueue，ThreadPoolExecutor里的线程都使用BlockingQueue#take阻塞着，一旦有内容，BlockingQueue notify一个线程执行该Runnable。

所以Tomcat是先随便获取processor线程，再给他一个任务，通知他执行；ThreadPoolExecutor是每次扔进来一个任务，再随便通知一个线程去执行。**Tomcat是每个线程一个单元素阻塞队列，ThreadPoolExecutor是所有的线程共用一个多元素阻塞队列BlockingQueue。**

至于池的底层表现，Tomcat用的是Stack，ThreadPoolExecutor用的是HashSet，这点倒没有特别大的区别。

## 处理请求
线程池算HttpProcessor的一个亮点，process socket一步才是HttpProcessor的核心处理流程：
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

### keep-alive
首先注意到的是while循环，如果keepAlive为true，或者header里的Connection不为"close"，**则继续在该socket上读写**。这其实就是keep-alive的本质啊！同一个socket发送多个request和response，而不是每次重建一个socket。

> **所以所谓的断开连接就是断开socket，重建连接就是重新获取一个socket。**

### http 1.1 100
如果是http 1.1协议，且Header里有：`Expect: 100-continue`，server先回复一个ack：`HTTP/1.1 100 Continue\r\n\r\n`。

这是客户端准备发送较长的请求体之前先确认server活着，不然白发那么大的请求了。

### Transfer-Encoding
http1.1 keep-alive，可以发送多个请求响应，怎么确定一个请求响应结束了？

发送内容的时候带上特殊标记：每一块内容之前都有“这一块内容的字节大小（十六进制）\r\n”的标记，如果出现`0\r\n`，说明后面没内容了。

http1.1默认长连接，所以默认允许chunked，响应的header里会有`Transfer-Encoding: chunked`，除非请求的header用了`Connection: close`之类明确不允许长连接的设定。

### parse request、parse header
不必多言，很复杂的plain text解析。

### 调用servlet
如果前面的解析都没问题，这是一个合法的http请求，可以使用servlet处理request获取response了。

如开头所说，servlet的处理是由Container完成的：
```
        if (ok) {
            connector.getContainer().invoke(request, response);
        }
```
Connector和Container绑定，所以可以获取Container。


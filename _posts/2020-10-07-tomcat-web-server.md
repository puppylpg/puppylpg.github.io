---
layout: post
title: "（一）How Tomcat Works - 原始Web服务器"
date: 2020-10-07 22:13:39 +0800
categories: Tomcat Http web
tags: Tomcat Http web
---

Tomcat是一个Servlet容器，Servlet首先是一个web服务器。先来看一下最基础的web服务器怎么构造的。

1. Table of Contents, ordered
{:toc}

# Http
web server和client（browser）是通过http协议交互的。

http协议包括请求的格式和响应的格式，其实没有什么高端的地方，和html一样都是**plain text**，client和server负责按照协议规定的格式翻译这些plain text，获取内容。

http请求包括：
- 请求行；
    + 请求方法；
    + 资源路径URI；
    + http协议版本；
- 请求头；
- 请求体；

同理http响应包括：
- 状态行；
    + http协议版本；
    + 状态码；
    + 状态的英文描述（OK、Not Found等）；
- 响应头；
- 响应体；

请求和响应的正文和请求头之间都有一个空行（CRLF），方便client和server解析http请求。

关于Http协议，参考[HTTP]({% post_url 2020-10-07-http %})。

# Socket
web服务器和client使用http协议通信，通信是通过套接字完成的（ip + port）。通过套接字，不同计算机上的两个程序可以发送、接收字节流，达到通信的目的。

在Java中，套接字是Socket类。Socket有两个重要的方法：
- getInputStream；
- getOutputStream；

用于获取InputStream和OutputStream，向Socket中写入、从Socket读取数据。

**http活动总是由client发起，向server发送http请求，server不负责联系客户端。client或者server都可以提前关闭连接。** 所以Java还有一个ServerSocket类，用于服务器监听客户端请求。使用ServerSocket的**accept方法**可以阻塞式等待client的请求。返回一个Socket，供server读写http request/reponse。

# 一个原始的web服务器
这是一个最原始的web服务器：
```
public class HttpServer {

    /**
     * WEB_ROOT is the directory where our HTML and other files reside.
     * For this package, WEB_ROOT is the "webroot" directory under the working
     * directory.
     * The working directory is the location in the file system
     * from where the java command was invoked.
     */
    public static final String WEB_ROOT =
            System.getProperty("user.dir") + File.separator + "webroot";

    // shutdown command
    private static final String SHUTDOWN_COMMAND = "/SHUTDOWN";

    // the shutdown command received
    private boolean shutdown = false;

    public static void main(String[] args) {
        HttpServer server = new HttpServer();
        server.await();
    }

    public void await() {
        ServerSocket serverSocket = null;
        int port = 8080;
        try {
            serverSocket = new ServerSocket(port, 1, InetAddress.getByName("127.0.0.1"));
        } catch (IOException e) {
            e.printStackTrace();
            System.exit(1);
        }

        // Loop waiting for a request
        while (!shutdown) {
            Socket socket = null;
            InputStream input = null;
            OutputStream output = null;
            try {
                socket = serverSocket.accept();
                input = socket.getInputStream();
                output = socket.getOutputStream();

                // create Request object and parse
                Request request = new Request(input);
                request.parse();

                // create Response object
                Response response = new Response(output);
                response.setRequest(request);
                response.sendStaticResource();

                // Close the socket
                socket.close();

                //check if the previous URI is a shutdown command
                shutdown = request.getUri().equals(SHUTDOWN_COMMAND);
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
    }
}
```
1. 监听localhost:8080上的客户端请求；
2. 使用accept接收请求socket；
3. 解析socket的InputStream为自定义的Request对象；
4. 创建自定义的Response对象，写入socket的OutputStream；
5. 如果请求的uri不是`/SHUTDOWN`，就继续循环监听请求；

值得注意的是程序自定义了一个文件夹叫`webroot`，在当前程序的working directory下。

> **working directory: the location in the file system from where the java command was invoked**.

往socket的OutputStream写的内容，就是从这个webroot文件夹下获取的：
```
    public void sendStaticResource() throws IOException {
        byte[] bytes = new byte[BUFFER_SIZE];
        FileInputStream fis = null;
        try {
            File file = new File(HttpServer.WEB_ROOT, request.getUri());
            if (file.exists()) {
                fis = new FileInputStream(file);
                int ch = fis.read(bytes, 0, BUFFER_SIZE);
                while (ch != -1) {
                    output.write(bytes, 0, ch);
                    ch = fis.read(bytes, 0, BUFFER_SIZE);
                }
                output.flush();
            } else {
                // file not found
                String errorMessage = "HTTP/1.1 404 File Not Found\r\n" +
                        "Content-Type: text/html\r\n" +
                        "Content-Length: 23\r\n" +
                        "\r\n" +
                        "<h1>File Not Found</h1>";
                output.write(errorMessage.getBytes());
            }
        } catch (Exception e) {
            // thrown if cannot instantiate a File object
            System.out.println(e.toString());
        } finally {
            if (fis != null) {
              fis.close();
            }
        }
    }
```

> 这个webroot在Tomcat的实现里，就是WEB-INF一样的存在。

显然，这个web server足够简陋，而且是单线程执行，根本不足以做一个正常的web server。可以参阅：[Http Server线程模型：NIO vs. BIO]({% post_url 2019-11-25-http-server-nio-bio %})。



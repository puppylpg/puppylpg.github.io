---
layout: post
title: "Http Server线程模型：NIO vs. BIO"
date: 2019-11-25 00:20:43 +0800
categories: NIO
tags: NIO
---

如果想写个web服务，处理比如Http请求，首先要决定自己的server选用什么线程模型。不同的线程模型对系统的吞吐有极大的影响。最基本的两种模型有两种：基于线程（thread-based）的模型，事件驱动（event-driven）的模型。

1. Table of Contents, ordered                    
{:toc}

# Thread-based
基于线程的模型大概是最好理解的。
## 单线程server
server端只有一个线程，监听端口，接收并处理请求，处理完后再接收下一个请求。

### 类比
以老师批改学生作业答疑解惑的场景为例子，类比一下server处理client的请求。

假设：
- 老师：主线程；
- 学生：连接connection；
- 学生的疑惑：连接上的请求request，**一个连接可以有很多个request（http长连接）**；

那么单线程server的场景就是：
- 老师在班里等学生来答疑（监听端口，等待连接）；
- 有学生（Connection）到了，老师让学生进班（处理连接请求），对他说“进来吧”（连接成功）；
- 老师等学生掏作业/问问题（等待数据，或者说等待I/O），学生请求老师批改作业（request），老师批改（处理完任务，request）；
- 然后学生看半天，再问做错的地方为啥错了（连接上又一个request），老师讲解（继续处理任务，返回request）；
- 学生没问题了，告辞（断开连接）。

### 优劣
这就是单线程server，老师被一个学生（Connection）占用的时候，其他学生都无法被服务，在门口等着不能进来，体验极差。
所以这种模型基本不具备可用性。除非很久才来一个请求，否则在处理一个请求的时候，其他请求都不会得到处理。

## 多线程server
server有一个主线程，监听端口，每来一个请求，主线程和它建立连接，并新建一个线程去处理任务。

### 类比
新增假设：
- 研究生：工作线程；

那么多线程server的场景就是：
- 老师在班里等学生来答疑（监听端口，等待连接）；
- 有学生（Connection）到了，老师让学生进班（处理连接请求），对他说“进来吧”（连接成功）；
- 老师打电话给自己的一个研究生（新建线程）去帮这个本科生答疑；
- 老师继续等其他学生来答疑。

研究生则承担起了工作线程的任务：
- 研究生等学生掏作业/问问题（等待数据，或者说等待I/O），学生请求研究生批改作业（request），研究生批改（处理完任务，request）；
- 然后学生看半天，再问做错的地方为啥错了（连接上又一个request），研究生讲解（继续处理任务，返回request）；
- 学生没问题了，告辞（断开连接）。

### 优劣
结果，一次来三五个学生还行，老师手下有三五个研究生，所以还能应付过来。但是一点一次来二三十个学生，老师手下的研究生就不够用了，只能让学生先排队（请求队列），如果接下来学生来的少了，研究生慢慢从队列里取出学生处理，如果接下来学生还是来得很多，排队也排不下了，老师只好直接不理后面来的学生了（丢弃请求）。

所以说这种模型一般是科学的，但是当请求量非常大的时候，可能短时间内要创建成千上万个线程，服务器也许受不了。所以不适合请求量非常大的情况。

究其根本，**线程和连接是一对一的**，尤其是长连接将会加剧线程的闲置时间（访问文件系统、网络传输时间等等）。

### 引申：线程池
当然这里也可以使用线程池，避免线程经常创建销毁的开销。

如果类比的话，就是：
- 老师的研究生都在答疑教室（pool）待命（提前创建线程）；
- 老师需要研究生的时候就不需要打电话把研究生交过来（创建线程），只需要招手交过来一个研究生即可（从线程池借出线程）；
- 研究生答疑完毕，不要回寝室（线程销毁），而是继续在答疑教室待命（返回线程池），这样下次又能随叫随到。

确实从线程过来到开始干活省了不少时间:D （研究生哭了，彻彻底底的工具人…… worker thread）

# Event-driven
既然thread-based模型的硬伤在于线程和连接的一一绑定，过于空耗线程，那事件驱动的模型就是要解耦连接和线程之间的关系。

其中心思想和生产者消费者模型有点儿像：请求来了，扔到一个地方，在请求准备好之前，不会被访问，当需要处理的时候，来一个线程去处理。这样线程就不是从头到尾都和请求耦合在一起，而是只在需要线程做任务的时候，线程才出现。

关键点在于：**当某请求的read/write之类的资源准备好之后，线程再去读写请求，这时候不会有线程空等待io，也就避免了线程闲置时间**，线程和CPU都得到有效利用。

事件驱动的模型又分为[Reactor Pattern](https://en.wikipedia.org/wiki/Reactor_pattern)和[Proactor Pattern](https://en.wikipedia.org/wiki/Proactor_pattern)。

**强烈推荐[《高性能网络模式：Reactor 和 Proactor》](https://xiaolincoding.com/os/8_network_system/reactor.html)！****

## Reactor Pattern
以Java NIO为例，需要一个Selector，监听各个事件，它的`select()`方法会阻塞，直到有事件发生。一旦某个事件发生，可以将产生这种事件的请求筛选出来，交给工作线程去处理。

### 类比
新增假设：
- 助教：selector；

那么多线程server的场景就是：
- 老师在班里等学生来答疑（监听端口，等待连接）；
- 有学生（Connection）到了，老师让学生进班（处理连接请求），对他说“进来吧”（连接成功）；
- 助教管理一大帮学生。当有学生有请求（批改作业、答疑等）需要处理，等事件准备好了之后，助教才将该学生要做什么告诉老师；
- 老师打电话给自己的一个研究生（新建线程）去帮这个本科生批改作业/答疑；
- 老师继续等其他准备好的学生。

助教任务：
- 哪个学生（connection）有问题（request），且准备好了，比如批改作业事件，就通知老师，老师找一个线程处理批改作业事件；

研究生还是承担起了工作线程的任务，但是有两个很大的不同：
- 研究生**不用再等**学生掏作业（等待数据，或者说等待I/O）了，因为只有这些数据准备好了，助教才会通知这些请求需要被处理，所以研究生（thread）不用有多余的闲置事件。研究生批改（处理完任务，request）完作业，撤了。

其次没有之前这种后续情况：
- ~~然后学生看半天，再问做错的地方为啥错了（连接上又一个request），研究生讲解（继续处理任务，返回request）~~；
- ~~学生没问题了，告辞（断开连接）~~。

即，线程不用等待连接上的其他请求，线程只干活，干完活走人。由selector在事件发生时通知主线程，主线程调用工作线程来干活。

### 优劣
这样一来，就算一次来很多学生，老师也都能跟他们保持连接。助教通知哪个学生需要批改作业或者讲解，老师派个研究生过去。在学生思考的时候（IO）研究生入池，或处理另一个学生的事件。每一个研究生都不需要从头到尾都跟一个学生耗着了，所以少量的研究生（少量的worker）能扛得住大量的请求产生的事件。

**所以nio仅仅需要一个主线程处理连接，一个selector通知事件发生，一些工作线程就可以应付非常高并发的场景。**

（研究生哭晕，摸鱼时间更少了……）

> Java NIO的选择器允许一个单独的线程来监视多个输入通道，你可以注册多个通道使用一个选择器，然后使用一个单独的线程来“选择”通道：这些通道里已经有可以处理的输入，或者选择已准备写入的通道。这种选择机制，使得一个单独的线程很容易来管理多个通道。

## Proactor Pattern
TBD: https://www.dre.vanderbilt.edu/~schmidt/PDF/Proactor.pdf

# 适用场景
基于事件驱动的NIO模型显然是更复杂更现代的产物。但是世上的选择好像都一样：没有最好的，只有最合适的。以上各个模型还是要看场景选型的：
- 如果需要管理**同时打开的成千上万个连接，这些连接每次只是发送少量的数据**，例如**聊天服务器**，实现NIO的服务器可能是一个优势。同样，如果你需要维持许多打开的连接到其他计算机上，如**P2P网络**中，使用一个单独的线程来管理你所有出站连接，可能是一个优势。
- 如果你有**少量的连接使用非常高的带宽，一次发送大量的数据**，也许典型的IO服务器实现可能非常契合。

关于bio和nio，还看到过一个钓鱼的类比：
- bio：一个线程是一个人钓鱼，等待、收杆、放饵都是一个人。想钓的更多，需要更多线程，比如十个人钓鱼。需要十个杆，每个人搞自己的一个杆。
- nio：事件（可读、可写、异常等。如果是钓鱼那就是咬钩、换饵、拉鱼等）驱动。一个人（selector）看着100个杆，十个人（线程）干活。哪个杆有事件，就从十个人中派一个人处理这个事件，处理完就松手。所以工作线程不再只处理一个connection，而是由一个单独的线程同时看着好多connection，哪个有事儿就去通知别的线程做那个。从而一个worker可以不断服务于很多connection。

# 附：使用Java NIO实现一个server的细节
- 主线程监听端口，注册ACCEPT事件到Selector；
- 主线程接收Selector返回，并判断时间类型：
    + 如果是ACCEPT，则处理连接请求，然后对新连接注册READ/WRITE事件；
    + 如果是READ/WRITE事件，处理连接的读写；

这里作为演示，所有事件的处理都由主线程完成，没用到线程池。
```java
    private void go() throws IOException {
        // Create a new selector
        Selector selector = Selector.open();

        // Open a listener on each port, and register each one
        // with the selector
        for (int port : ports) {
            // 获得channel，设为非阻塞
            ServerSocketChannel serverSocketChannel = ServerSocketChannel.open();
            serverSocketChannel.configureBlocking(false);
            // channel绑定到相应的端口
            serverSocketChannel.socket().bind(new InetSocketAddress(port));

            registerServerSocket(serverSocketChannel, selector);

            System.out.println("Going to listen on " + port);
        }

        while (true) {
            // 这个方法会阻塞（如果没事儿干，你就歇着吧），直到至少有一个已注册的事件发生。
            // 当一个或者更多的事件发生时，select()方法将返回所发生的事件的数量
            int num = selector.select();

            // 发生了事件的 SelectionKey 对象的一个 集合
            Set<SelectionKey> selectedKeys = selector.selectedKeys();
            Iterator<SelectionKey> it = selectedKeys.iterator();

            // 依次判断每个事件发生的到底是啥事儿
            while (it.hasNext()) {
                SelectionKey key = it.next();

                // 处理过了，就删了，防止一会儿重复处理。（可认为Selector只往set里加，但是不删！！！）
                it.remove();

                // SelectionKey.channel()方法返回的通道需要转型成你要处理的类型，如ServerSocketChannel或SocketChannel等。
                // 是有新连接了
                if (key.isAcceptable()) {
                    acceptSocketAndRegisterIt(key, selector);

                    // 是socket上有可读的数据来了
                } else if (key.isReadable()) {
                    readSocket(key);
                }
            }
            // 如果上面没有一个一个删掉，这里直接清空也行
//            selectedKeys.clear();
        }
    }

    private void registerServerSocket(ServerSocketChannel serverSocketChannel, Selector selector) throws ClosedChannelException {
        // 告诉selector，我们对OP_ACCEPT事件感兴趣（这是适用于ServerSocketChannel的唯一事件类型）
        // SelectionKey的作用就是，当事件发生时，selector提供对应于那个事件的SelectionKey
        // 这里，ServerSocketChannel所支持的操作只有SelectionKey.OP_ACCEPT
        SelectionKey key = serverSocketChannel.register(selector, serverSocketChannel.validOps());
    }

    private void acceptSocketAndRegisterIt(SelectionKey key, Selector selector) throws IOException {
        // Accept the new connection
        ServerSocketChannel serverSocketChannel = (ServerSocketChannel) key.channel();
        // 不用担心accept()方法会阻塞，因为已经确定这个channel（这个端口）上是有一个新连接了
        SocketChannel socketChannel = serverSocketChannel.accept();
        socketChannel.configureBlocking(false);

        // 我们期望从这个socket上读取数据，所以也注册到selector，等通知再来读。这次注册的是OP_READ：“可读”就通知我
        // Add the new connection to the selector
        SelectionKey newKey = socketChannel.register(selector, SelectionKey.OP_READ);

        System.out.println("+++ New connection: " + socketChannel);
    }

    private void readSocket(SelectionKey key) throws IOException {
        // Read the data
        SocketChannel socketChannel = (SocketChannel) key.channel();

        // Echo data
        int bytesEchoed = 0, r = 0;
        while ((r = socketChannel.read(echoBuffer)) > 0) {
            // flip. ready to write: limit = position, position = 0
            echoBuffer.flip();
            socketChannel.write(echoBuffer);
            bytesEchoed += r;
            // clear. ready to read: position = 0, limit = capacity
            echoBuffer.clear();
        }
        System.out.println("Echoed " + bytesEchoed + " from " + socketChannel);
        // CLOSE SOCKET AFTER HANDLED
        socketChannel.close();
        System.out.println("--- Close connection: " + socketChannel);
    }
```

[toc]

---
layout: post
title: "各种各样的RPC"
date: 2023-03-01 23:45:16 +0800
categories: RPC proxy
tags: RPC proxy
---

既然当今[RPC]({% post_url 2023-02-26-rpc %})已经不追求大而全的统一方案，而是各有各的特点，那就来稍微细看一下这些数得出名号的rpc。

1. Table of Contents, ordered
{:toc}

# 原生态RPC
想做到简单，首要的一点就是不要跨语言，这样就不需要IDL。比如调用双方都是java。其次不要关心任何高级一点的功能，比如服务发现。只做rpc最核心最本质的东西：**client以网络通信的方式把要调用的方法、参数都发给server，并接收server返回**。

## jdk tcp传输数据
比如[这个client](https://blog.csdn.net/xlgen157387/article/details/53543009)，直接把方法、参数等要素塞到tcp里：
- 方法表示：用string表示`<接口名，方法名，方法参数列表>`
- 参数表示：string
- 数据传输方式：tcp
```java
        // 方法的表示
        String providerInterface = ProviderDemo.class.getName();
        Method method = ProviderDemo.class.getMethod("printMsg", java.lang.String.class);
        // 参数的表示
        Object[] rpcArgs = {"Hello RPC!"};
        
        // 数据传输方式
        // 这里作者用consumer代表rpc的caller（client），producer代表callee。所以往consumer的output写其实就是rpc client发送数据给rpc server
        Socket consumer = new Socket("127.0.0.1", 8899);
        ObjectOutputStream output = new ObjectOutputStream(consumer.getOutputStream());
        // 写入方法信息
        output.writeUTF(providerInterface);
        output.writeUTF(method.getName());
        output.writeObject(method.getParameterTypes());
        // 写入参数信息
        output.writeObject(rpcArgs);
 
        // 读取返回的结果
        ObjectInputStream input = new ObjectInputStream(consumer.getInputStream());
        Object result = input.readObject();
```
server监听tcp端口收到数据，做本地调用，往socket写回结果：
```java
        //用于存放生产者服务接口的Map,实际的框架中会有专门保存服务提供者的
        Map<String, Object> serviceMap = new HashedMap();
        serviceMap.put(ProviderDemo.class.getName(), new ProviderDemoImpl());

        //服务器
        ServerSocket server = new ServerSocket(8899);

        while (true) {
            Socket socket = server.accept();
            ObjectInputStream input = new ObjectInputStream(socket.getInputStream());
            
            // 可以理解为反序列化方法数据
            String interfaceName = input.readUTF();
            String methodName = input.readUTF();
            // 反序列化参数数据
            Class<?>[] parameterTypes = (Class<?>[]) input.readObject();
            Object[] rpcArgs = (Object[]) input.readObject();
 
            Class providerInteface = Class.forName(interfaceName); 
            
            // 本地方法调用
            Object provider = serviceMap.get(interfaceName);
            Method method = providerInteface.getMethod(methodName, parameterTypes);
            Object result = method.invoke(provider, rpcArgs);
 
            // 返回结果
            ObjectOutputStream output = new ObjectOutputStream(socket.getOutputStream());
            output.writeObject(result);
        }
```
虽然看起来很不rpc，但它确实展示了rpc的核心。只不过这个rpc很脆弱，基于约定的参数数据，毫无拓展性，毫无服务发现机制等等。但是话说回来，正是因为没有这些，所以它才很简单……

> 做人虽然想既要又要，但大多数情况下也只能想想了:(

## 静态代理屏蔽tcp传输细节
[这个](https://zhuanlan.zhihu.com/p/36528189)看起来就稍微规范一些，好歹把发过去的一堆散装零件封装为了一个request，而且使用静态代理把socket的细节屏蔽了：
```java
        // 静态代理
        Calculator calculator = new CalculatorRemoteImpl();
        int result = calculator.add(1, 2);
        log.info("result is {}", result);
```
实际socket细节在这个[静态代理类内部](https://github.com/puppylpg/simple-rpc/blob/master/src/main/java/com/sexycode/simplerpc/client/service/CalculatorRemoteImpl.java)：
```java
    public int add(int a, int b) {
        List<String> addressList = lookupProviders("Calculator.add");
        String address = chooseTarget(addressList);
        try {
            Socket socket = new Socket(address, PORT);

            // 将请求序列化
            CalculateRpcRequest calculateRpcRequest = generateRequest(a, b);
            ObjectOutputStream objectOutputStream = new ObjectOutputStream(socket.getOutputStream());

            // 将请求发给服务提供方
            objectOutputStream.writeObject(calculateRpcRequest);

            // 这是一个简单地阻塞式响应接收

            // 将响应体反序列化
            ObjectInputStream objectInputStream = new ObjectInputStream(socket.getInputStream());
            Object response = objectInputStream.readObject();

            log.info("response is {}", response);

            if (response instanceof Integer) {
                return (Integer) response;
            } else {
                throw new InternalError();
            }

        } catch (Exception e) {
            log.error("fail", e);
            throw new InternalError();
        }
    }

    private CalculateRpcRequest generateRequest(int a, int b) {
        CalculateRpcRequest calculateRpcRequest = new CalculateRpcRequest();
        calculateRpcRequest.setA(a);
        calculateRpcRequest.setB(b);
        calculateRpcRequest.setMethod("add");
        return calculateRpcRequest;
    }
```

server端也跟之前一样，只不过从socket里读出来的是一个request object，稍微不那么散装了，有点儿“协议”的意思了：
```java
        ServerSocket listener = new ServerSocket(9090);
        try {
            while (true) {
                Socket socket = listener.accept();
                try {
                    // 将请求反序列化
                    ObjectInputStream objectInputStream = new ObjectInputStream(socket.getInputStream());
                    Object object = objectInputStream.readObject();

                    log.info("request is {}", object);

                    // 调用服务
                    int result = 0;
                    if (object instanceof CalculateRpcRequest) {
                        CalculateRpcRequest calculateRpcRequest = (CalculateRpcRequest) object;
                        if ("add".equals(calculateRpcRequest.getMethod())) {
                            result = calculator.add(calculateRpcRequest.getA(), calculateRpcRequest.getB());
                        } else {
                            throw new UnsupportedOperationException();
                        }
                    }

                    // 返回结果
                    ObjectOutputStream objectOutputStream = new ObjectOutputStream(socket.getOutputStream());
                    objectOutputStream.writeObject(new Integer(result));
```
但是本质上，这俩就是rpc的原始雏形。**而`CalculateRpcRequest`就是约定好的rpc协议**，只不过它不能跨语言罢了。

> 当然，实际的rpc框架肯定是用的是动态代理，见后面的讨论。

## 协议类一定要在client和server同时存在吗
未必。比如[EasyRPC](https://github.com/yeecode/EasyRPC)这个demo里，通过注解配置把client里的类映射为server里的哪个类：
```java
package com.github.yeecode.easyrpc.client.remoteservice;


import com.github.yeecode.easyrpc.client.rpc.RemoteClass;

@RemoteClass("com.github.yeecode.easyrpc.server.service.SchoolService")
public interface SchoolService {
    String querySchoolName(Integer id);
}
```
然后在通信（放在动态代理g(x)里）的时候，使用注解里的类名就行了：
```java
    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        // 获取协议里要用的class名称
        RemoteClass remoteClass = method.getDeclaringClass().getAnnotation(RemoteClass.class);
        
        ...
        
        // 发送给rpc server
        Result result = HttpUtil.callRemoteService(remoteClass.value(), method.getName(), argTypes, argValues);
        
        ...
    }
```

**所以关键是要让server知道协议里用的哪个类，server只要能明白就行。client和server用同一个类作为协议只是其中最简单的一种实现罢了。**

> 毕竟在json-rpc里，直接用json格式告诉server用的是哪个方法也是可以的（甚至连参数类型都不用提，说明不支持override，也没有类的概念，真简单）。


# Thrift
来看看Facebook的[Thrift](https://thrift.apache.org/)。

正经的rpc就要考虑跨语言了，所以thrift有自己的[IDL](https://thrift.apache.org/docs/idl)，可以定义接口和各种[数据类型](https://thrift.apache.org/docs/types)，语法长得和c比较像。比如[shared.thrift](https://github.com/apache/thrift/blob/master/tutorial/shared.thrift)和[tutorial.thrift](https://github.com/apache/thrift/blob/master/tutorial/tutorial.thrift)，后者引用了前者：`include "shared.thrift"`。看起来更像c了。

之后把定义的接口和对象编译为java类，协议和对象就都有了：
```bash
thrift --gen java tutorial.thrift
```
接下来引入thrift的依赖。最后按照thrift的规范编程。thrift**直接就可以使用动态代理生成client端调用对象，socket的那一套都省了，比原始的rpc省了不少步骤**：
```java
TTransport  transport = new TSocket("localhost", 9090);
TProtocol protocol = new  TBinaryProtocol(transport);
Calculator.Client client = new Calculator.Client(protocol);

int sum = client.add(1,1);
```
这就是rpc框架的好处！

# gRPC
[grpc](https://grpc.io/docs/what-is-grpc/)和thrift几乎是一样的流程。定义接口和数据结构的IDL是熟悉的[protocol buffers](https://protobuf.dev/)，比如[route_guide.proto](https://github.com/grpc/grpc-java/blob/master/examples/src/main/proto/route_guide.proto)。

之后也是引入grpc的依赖开始写[client和server](https://github.com/grpc/grpc-java/tree/master/examples/src/main/java/io/grpc/examples/helloworld)，同样屏蔽了socket的细节。

具体可以看[对上述细节的详细阐述](https://grpc.io/docs/languages/java/basics/)。

> 看多了，发现都一样……这就是阅历吗？

> 倒是新学会了个浅克隆，`git clone --depth=1`

# Dubbo
[Dubbo](https://cn.dubbo.apache.org/)现在已经由阿里巴巴交给Apache了。虽然官网说：
> Dubbo 作为一款微服务框架，最重要的是向用户提供跨进程的 RPC 远程调用能力。

但很明显它已经不仅仅只是一个rpc框架了，rpc只是dubbo做的工作之一，它还能嵌入其他rpc，感觉它自己则更专注于为分布式服务更高层级的问题提供解决方案。

[dubbo接入springboot](https://cn.dubbo.apache.org/zh-cn/overview/quickstart/java/spring-boot/)，使用springboot[开发时非常快](https://github.com/apache/dubbo-samples/tree/master/1-basic/dubbo-samples-spring-boot)：
1. 如果只用java，不用考虑IDL，定义一个java的interface就行；
2. 服务发现的细节直接被（springboot）[封装](https://github.com/apache/dubbo-samples/blob/master/1-basic/dubbo-samples-spring-boot/dubbo-samples-spring-boot-consumer/src/main/resources/application.yml)了；
3. 直接通过`@DubboReference`给注入的接口做动态代理（代理远程的server），之后就像拿着本地的bean一样直接用；

[一个注解搞定动态代理工作](https://github.com/apache/dubbo-samples/blob/master/1-basic/dubbo-samples-spring-boot/dubbo-samples-spring-boot-consumer/src/main/java/org/apache/dubbo/springboot/demo/consumer/Task.java)：
```java
    @DubboReference
    private DemoService demoService;
```
就是这么猛！

当然之所以特别简单，springboot功不可没。[如果写个普通的dubbo](https://cn.dubbo.apache.org/zh-cn/overview/quickstart/java/brief/)和thrift/grpc进行对比，其实又差不多了。大家都是[手动获取一个动态代理对象](https://github.com/apache/dubbo-samples/blob/master/1-basic/dubbo-samples-api/src/main/java/org/apache/dubbo/samples/client/Application.java)：
```java
        ReferenceConfig<GreetingsService> reference = new ReferenceConfig<>();
        reference.setInterface(GreetingsService.class);

        DubboBootstrap.getInstance()
                .application("first-dubbo-consumer")
                .registry(new RegistryConfig(ZOOKEEPER_ADDRESS))
                .reference(reference)
                .start();

        GreetingsService service = reference.get();
        String message = service.sayHi("dubbo");
```
不同的是dubbo一般使用zookeeper做[服务发现](https://cn.dubbo.apache.org/zh-cn/docs3-v2/java-sdk/concepts-and-architecture/service-discovery/)，而不是直接搞个ip:port让client连接server。所以还要额外启动一个zk：
```bash
docker run --name dubbo-zk --restart always -p 2181:2181 -d zookeeper

docker run -it --rm --link dubbo-zk:zookeeper zookeeper zkCli.sh -server zookeeper
```

## IDL
当然也可以使用IDL做支持异构的接口和数据结构：
- https://cn.dubbo.apache.org/zh-cn/docs3-v2/java-sdk/quick-start/idl/

示例用的是grpc。这就是dubbo做的比较大的地方之一。

> Google：所以我成打工仔了？

还有其他rpc协议，比如dubbo自己的triple：
- triple，介绍了dubbo为什么造了个triple协议：https://cn.dubbo.apache.org/zh-cn/overview/what/ecosystem/protocol/triple/
- grpc：https://cn.dubbo.apache.org/zh-cn/overview/what/ecosystem/protocol/grpc/
- thrift：https://cn.dubbo.apache.org/zh-cn/overview/what/ecosystem/protocol/thrift/
- java rmi：https://cn.dubbo.apache.org/zh-cn/overview/what/ecosystem/protocol/rmi/

## 序列化
序列化和IDL一样，方法也多种多样。比如grpc的protobuf：
- https://cn.dubbo.apache.org/zh-cn/overview/what/ecosystem/serialization/

## 高级功能
比如上面提到的注册中心也支持多种，可以使用zk、nacos、consul、eureka等：
- https://cn.dubbo.apache.org/zh-cn/overview/what/ecosystem/registry/

还有其他种种高级功能都可以在生态里看到：
- https://cn.dubbo.apache.org/zh-cn/overview/what/ecosystem/

这些高级功能其实大致总结了分布式服务+rpc的各种要解决的问题：
- 协议
- 序列化
- 注册中心
- 配置中心
- 元数据中心
- 网关
- service mesh
- 限流降级
- 全局事务
- 链路追踪
- 监控

所以dubbo的野心还挺大的，成为Apache顶级项目名副其实。

# RMI
最后还是得提提RMI，[Remote Method Invocation](https://www.javatpoint.com/RMI)。毕竟它走的是oom路线，**以面向对象的方式搞rpc**，还是挺不同寻常的。而且它是java专属。

> 哪里面向对象还没看出来，毕竟thrift也是定义在client获取一个proxy对象。

整体感觉rmi也挺麻烦的，不过据说比rpc高效一丢丢：
- https://techdifferences.com/difference-between-rpc-and-rmi.html

而且可以操作对象（直接set value？），更强大：
> With RPC you can just call remote functions exported into a server, in RMI you can have references to remote objects and invoke their methods, and also pass and return more remote object references that can be distributed among many JVM instances, so it's much more powerful.
>
> https://stackoverflow.com/a/2728547/7676237

只面向java导致它应用面小，而现在的技术很**异构**，所以如果和其他系统配合的话，rmi的使用范围变小了：
> Gone are those days when the tech stack used to be around one technology(read ‘Java’). These days solutions span across multiple technologies, like front end in some javascript framework (like angular , knockout), backend is Java /Python. Database could be a mixture of RDBMS(like Oracle , MySql ) and NoSQL databases. RMI does not fit because of various technologies getting used.
>
> https://qr.ae/pra3f3

但是rmi也没凉，很多Java底层的东西在用：
> Traditional Java RMI is still widely used for remote management and monitoring, but I don't see it used much at the application level.
>
> https://stackoverflow.com/a/46863162/7676237

# 框架级RPC的实现
虽然一开头我们自己用Java tcp写了两个巨返璞归真的rpc框架，且第二个demo用了协议和静态代理来屏蔽远程调用的细节，看起来更像是可用的rpc。但真正的rpc框架必然是用动态代理来实现那么多rpc方法的代理实现的。

这一段就依托[《你应该知道的RPC原理》](https://www.cnblogs.com/LBSer/p/4853234.html)，探讨一下框架级rpc的一些关键设计。

## 动态代理
**和静态代理一样，动态代理的目的也是屏蔽rpc client和server通信的细节**。由[《Java反射与动态代理》]({% post_url 2020-08-02-java-reflection-dynamic-proxy %})可知：
1. 通信细节写在`InvocationHandler#invoke`里；
2. 使用`Proxy#newProxyInstance`生成动态代理对象；

大致代码：
```java
public class RPCProxyClient implements java.lang.reflect.InvocationHandler{
    private Object obj;

    public RPCProxyClient(Object obj){
        this.obj=obj;
    }

    /**
     * 得到被代理对象;
     */
    public static Object getProxy(Object obj){
        return java.lang.reflect.Proxy.newProxyInstance(obj.getClass().getClassLoader(),
                obj.getClass().getInterfaces(), new RPCProxyClient(obj));
    }

    /**
     * 调用此方法执行
     */
    public Object invoke(Object proxy, Method method, Object[] args)
            throws Throwable {
        //结果参数;
        Object result = new Object();
        // ...执行通信相关逻辑
        // ...
        return result;
    }
}
```
获取代理对象的`getProxy`方法放在哪里都行，这里放在`RPCProxyClient`里了。

之后就可以获取动态代理对象，无感知进行rpc调用了：
```java
public class Test {

    public static void main(String[] args) {
        HelloWorldService helloWorldService = (HelloWorldService)RPCProxyClient.getProxy(HelloWorldService.class);
        helloWorldService.sayHello("test");
    }
}
```

## 通信框架
开头的两个例子，用的都是jdk的tcp通信，典型的bio通信。实际上框架级的rpc必然都是nio。
1. **可以使用jdk的nio，但是实现起来较为复杂**，而且很有可能出现隐藏bug；
2. 早年一般基于mina通信，比如youdao的SimpleNet；
3. **现在基本都基于netty通信**，比如dubbo；

## 协议
协议的序列化反序列化往往考虑：
1. 通用性
2. 时间空间性能
3. 可拓展性

所以一般用protobuf，avro，thrift等。

在开头的例子里，协议的内容一般是：
- 为了表示方法，要有：
    - 接口名
    - 方法名
    - 参数类型
- 参数值

实际上框架级的rpc协议还要有一些额外信息用于控制通信的流程，比如：
- timeout
- **request id**
- status code

## 协议里为什么要有requestID？
如果使用netty的话，一般会用`channel.writeAndFlush()`方法来发送消息二进制串，这个方法调用后对于整个远程调用(从发出请求到接收到结果)来说是异步的，即对于当前线程来说，将请求发送出来后，线程就可以往后执行了，至于服务端的结果，是服务端处理完成后，再以消息的形式发送给客户端的。于是这里出现以下两个问题：

1. 怎么让当前线程“暂停”，等结果回来后，再向后执行？**在java里，让线程暂停的方法就是锁。线程应该在发送请求后wait到某个地方，然后由netty接收完返回结果后notify唤醒它**。
2. 如果有多个线程同时进行远程方法调用，这时建立在client server之间的socket连接上会有很多双方发送的消息传递，前后顺序也可能是随机的，server处理完结果后，将结果消息发送给client，client收到很多消息，怎么知道哪个消息结果是原先哪个线程调用的？**request和response要用同一个id标识**。

我们需要一种机制保证responseA丢给ThreadA，responseB丢给ThreadB。解决方案：
1. client线程每次通过socket调用一次远程接口前，生成一个唯一的ID，即requestID（requestID必需保证在一个Socket连接里面是唯一的），一般常常使用`AtomicLong`从0开始累计数字生成唯一ID；
2. **将处理结果的回调对象callback，存放到全局`ConcurrentHashMap`里面`put(requestID, callback)`**；
3. **让当前线程“暂停”，把callback当做锁**：当线程调用`channel.writeAndFlush()`发送消息后，**紧接着执行`callback#get()`方法试图获取远程返回的结果。在get()内部，则使用synchronized获取回调对象callback的锁，再先检测是否已经获取到结果，如果没有，然后调用callback的wait()方法，释放callback上的锁，让当前线程处于等待状态**。
    ```java
    public Object get() {
        // 获取该callback对象的锁
        synchronized(this) {
            // 使用while而非if判断是否完成（如果被恶意唤醒，实际还没完成，使用if就凉了）
            while(!isDone) {
                // 释放CPU，释放锁，阻塞线程，等待被唤醒
                wait();
            }
            // 被唤醒后，返回结果
            return result;
        }
    }
    ```
4. 服务端接收到请求并处理后，将response结果（此结果中包含了前面的requestID）发送给客户端，**客户端socket连接上专门监听消息的线程（想具有主动通知的功能，client里也必须有一个监听线程）收到消息，分析结果，取到requestID，再从前面的ConcurrentHashMap里面get(requestID)，从而找到callback对象，再用synchronized获取callback上的锁，将方法调用结果设置到callback对象里，再调用callback.notifyAll()唤醒前面处于等待状态的线程**。
    ```java
    private void doneJob(Object response) {
        // 获取该callback对象的锁
        synchronized(this) {
            // 设置结果
            this.result = response;
            // 设置完成标志
            this.isDone = true;
            // 唤醒阻塞的线程
            notifyAll();
        }
    }
    ```

> 想具有主动通知的功能，比如zookeeper，则zk的client里也必须有一个监听线程。

其实这就是个生产者消费者模型：
1. rpc client作为消费者，向rpc server请求资源（本次rpc调用的结果），并wait在callback上；
1. rpc client里的接收rpc server结果的通知线程作为生产者，根据request id找到消费者线程，并唤醒；

和普通生产者比起来，这里的生产者稍显抽象，它是要接收rpc server的结果之后才能产生新的资源。

## 发布服务
无需多言，zookeeper等服务注册中心。

# 和restful的区别
在[既然有 HTTP 请求，为什么还要用 RPC 调用？](https://www.zhihu.com/question/41609070/answer/1030913797)说的比较好。

首先，正如不应该从宽泛的概念的角度把rpc理解为ipc的一种一样，也不应该仅从概念的角度把restful理解为rpc的一种。

那么既然从并列的角度来看这两种方案的话，就各有利弊了：
1. restful基于http：
    1. 可读性高，效率低；
    2. 封装复杂，要构造http请求，导致易用性差；
    3. 80端口，可以穿过防火墙；
1. rpc可以基于多种通信协议，可以是http，但一般是tcp；
    1. 效率高，尤其是服务多rpc调用多的时候；
    2. 可读性差，但是易用性高，因为可以**在代码编写层面**无感知，好像在进行本地方法调用一样（在性能上肯定还是有感知的）；

# haha
感觉rpc之所以难，是难在第一步：什么是rpc，rpc要搞定什么问题。恰恰漫天的资料很少有能说清这些问题的。不知道这些，就无从谈起各类rpc框架的特点、技术路线、我们自己的使用选择。

当年没搞懂rpc究竟是啥的时候，还问了一些傻问题：
- rpc rest which is faster
- rpc tcp or http

再看以前收藏的一堆资料，只有这俩是不错的：
- [既然有 HTTP 请求，为什么还要用 RPC 调用？](https://www.zhihu.com/question/41609070/answer/1030913797)
- [你应该知道的RPC原理](https://www.cnblogs.com/LBSer/p/4853234.html)

当然，最好的还是[这个]({% post_url 2023-02-26-rpc %})。


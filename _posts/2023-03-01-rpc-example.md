---
layout: post
title: "各种各样的RPC"
date: 2023-03-01 23:45:16 +0800
categories: RPC
tags: RPC
---

既然当今[RPC]({% post_url 2023-02-26-rpc %})已经不追求大而全的统一方案，而是各有各的特点，那就来稍微细看一下这些数得出名号的rpc。

1. Table of Contents, ordered
{:toc}

# 原生态RPC
想做到简单，首要的一点就是不要跨语言，这样就不需要IDL。比如调用双方都是java。其次不要关心任何高级一点的功能，比如服务发现。只做rpc最核心最本质的东西：**client以网络通信的方式把要调用的方法、参数都发给server，并接收server返回**。

比如[这个client](https://blog.csdn.net/a15920804969/article/details/79053703)，直接把方法、参数等要素塞到tcp里：
```
        Socket consumer = new Socket("127.0.0.1", 8899);

        Object[] rpcArgs = {"Hello RPC!"};
        ObjectOutputStream output = new ObjectOutputStream(consumer.getOutputStream());
        output.writeUTF(providerInterface);
        output.writeUTF(method.getName());
        output.writeObject(method.getParameterTypes());
        output.writeObject(rpcArgs);
 
        // 读取返回的结果
        ObjectInputStream input = new ObjectInputStream(consumer.getInputStream());
        Object result = input.readObject();
```
server监听tcp端口收到数据，做本地调用，往socket写回结果：
```
        while (true) {
            Socket socket = server.accept();
            ObjectInputStream input = new ObjectInputStream(socket.getInputStream());
            String interfaceName = input.readUTF();
            String methodName = input.readUTF();
 
            Class<?>[] parameterTypes = (Class<?>[]) input.readObject();
            Object[] rpcArgs = (Object[]) input.readObject();
 
            Class providerInteface = Class.forName(interfaceName); 
            
            Object provider = serviceMap.get(interfaceName);
 
            Method method = providerInteface.getMethod(methodName, parameterTypes);

            Object result = method.invoke(provider, rpcArgs);
 
            ObjectOutputStream output = new ObjectOutputStream(socket.getOutputStream());
            output.writeObject(result);
        }
```
虽然看起来很不rpc，但它确实展示了rpc的核心。只不过这个rpc很脆弱，基于约定的参数数据，毫无拓展性，毫无服务发现机制等等。但是话说回来，正是因为没有这些，所以它才很简单……

> 做人虽然想既要又要，但大多数情况下也只能想想了:(

[这个](https://zhuanlan.zhihu.com/p/36528189)看起来就稍微规范一些，好歹把发过去的一堆散装零件封装为了一个request，另外使用静态代理把socket的细节屏蔽了：
```
        // 静态代理
        Calculator calculator = new CalculatorRemoteImpl();
        int result = calculator.add(1, 2);
        log.info("result is {}", result);
```
实际socket细节在这个[静态代理类内部](https://github.com/puppylpg/simple-rpc/blob/master/src/main/java/com/sexycode/simplerpc/client/service/CalculatorRemoteImpl.java)：
```
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
```
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

但是本质上，这俩就是rpc的原始雏形。

# Thrift
来看看Facebook的[Thrift](https://thrift.apache.org/)。

正经的rpc就要考虑跨语言了，所以thrift有自己的[IDL](https://thrift.apache.org/docs/idl)，可以定义接口和各种[数据类型](https://thrift.apache.org/docs/types)，语法长得和c比较像。比如[shared.thrift](https://github.com/apache/thrift/blob/master/tutorial/shared.thrift)和[tutorial.thrift](https://github.com/apache/thrift/blob/master/tutorial/tutorial.thrift)，后者引用了前者：`include "shared.thrift"`。看起来更像c了。

之后把定义的接口和对象编译为java类，协议和对象就都有了：
```
thrift --gen java tutorial.thrift
```
接下来引入thrift的依赖。最后按照thrift的规范编程，不过**直接就可以使用动态代理生成client端调用对象了，socket的那一套都省了，比原始的rpc省了不少步骤**：
```
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

> 看多了，发现都一样……

> 倒是新学会了个浅克隆，`git clone --depth=1`

# Dubbo
[Dubbo](https://cn.dubbo.apache.org/)现在已经由阿里巴巴交给Apache了。虽然官网说：
> Dubbo 作为一款微服务框架，最重要的是向用户提供跨进程的 RPC 远程调用能力。

但很明显它已经不仅仅只是一个rpc框架了，rpc只是dubbo做的工作之一，它还能嵌入其他rpc，自己更大的工作感觉是为分布式服务更高层级的问题提供解决方案。

[dubbo接入springboot](https://cn.dubbo.apache.org/zh-cn/overview/quickstart/java/spring-boot/)，使用springboot[开发时非常快](https://github.com/apache/dubbo-samples/tree/master/1-basic/dubbo-samples-spring-boot)：
1. 如果只用java，不用考虑IDL，定义一个java的interface就行；
2. 服务发现的细节直接被（springboot）[封装](https://github.com/apache/dubbo-samples/blob/master/1-basic/dubbo-samples-spring-boot/dubbo-samples-spring-boot-consumer/src/main/resources/application.yml)了；
3. 直接通过`@DubboReference`给注入的接口做动态代理（代理远程的server），之后就像拿着本地的bean直接用一样；

[一个注解搞定动态代理工作](https://github.com/apache/dubbo-samples/blob/master/1-basic/dubbo-samples-spring-boot/dubbo-samples-spring-boot-consumer/src/main/java/org/apache/dubbo/springboot/demo/consumer/Task.java)：
```
    @DubboReference
    private DemoService demoService;
```
就是这么猛。

当然之所以特别简单，springboot功不可没。[如果写个普通的方式](https://cn.dubbo.apache.org/zh-cn/overview/quickstart/java/brief/)和thrift/grpc进行对比，其实又差不多了。大家都是[手动获取一个动态代理对象](https://github.com/apache/dubbo-samples/blob/master/1-basic/dubbo-samples-api/src/main/java/org/apache/dubbo/samples/client/Application.java)：
```
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
```
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

# haha
感觉rpc之所以难，是难在第一步：什么是rpc，rpc要搞定什么问题。恰恰漫天的资料很少有能说清这些问题的。不知道这些，就无从谈起各类rpc框架的特点、技术路线、我们自己的使用选择。

当年没搞懂rpc究竟是啥的时候，还问了一些傻问题：
- rpc rest which is faster
- rpc tcp or http

再看以前收藏的一堆资料，只有这俩是不错的：
- [既然有 HTTP 请求，为什么还要用 RPC 调用？](https://www.zhihu.com/question/41609070/answer/1030913797)
- [你应该知道的RPC原理](https://www.cnblogs.com/LBSer/p/4853234.html)

当然，最好的还是[这个]({% post_url 2023-02-26-rpc %})。


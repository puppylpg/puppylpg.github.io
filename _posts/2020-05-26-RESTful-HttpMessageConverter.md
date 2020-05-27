---
layout: post
title: "RESTful - HttpMessageConverter"
date: 2020-05-26 02:07:59 +0800
categories: REST HttpMessageConverter
tags: REST HttpMessageConverter
# render_with_liquid: false
---

构建RESTful服务（算了，还是说RESTful服务比较顺口）的时候，HttpMessageConverter可以完成消息发出前的序列化、消息收到后的反序列化，使得我们在构建RESTful server或者RESTful client的时候可以不用太关心消息的序列化反序列化，专心构建业务逻辑即可。

1. Table of Contents, ordered                    
{:toc}

# 场景
假设client和server之间均通过json交互：
```
client -> json -> server
client <- json <- server
```
那么client的RestTemplate和server均只注册一个`MappingJackson2HttpMessageConverter`就行了。

其他场景同理，只是根据二者之间交互数据的不同，选用不同的HttpMessageConverter。比如：
```
client -> json -> server
client <- protobuf <- server
```
client和server都需要`MappingJackson2HttpMessageConverter`和`ProtobufHttpMessageConverter`。其中：
- client使用`MappingJackson2HttpMessageConverter`将Java对象序列化为json作为请求的body，使用`ProtobufHttpMessageConverter`反序列化响应的body（protobuf字节流）为Java对象；
- server使用`MappingJackson2HttpMessageConverter`反序列化请求的body中的json为Java对象，使用`ProtobufHttpMessageConverter`将Java对象序列化为protobuf字节，放入响应的body，返回给client。

# HttpMessageConverter interface
HttpMessageConverter作为序列化和反序列化的实际执行者，接口里有5个方法：
- `List<MediaType> getSupportedMediaTypes()`：该converter可以序列化反序列化的类型，比如json、xml或者protobuf字节；

2个读方法：
- `boolean canRead(Class<?> clazz, @Nullable MediaType mediaType)`
- `T read(Class<? extends T> clazz, HttpInputMessage inputMessage) throws IOException, HttpMessageNotReadableException`

用于读序列化后的数据，并反序列化为Java对象；

2个写方法：
- `boolean canWrite(Class<?> clazz, @Nullable MediaType mediaType)`
- `void write(T t, @Nullable MediaType contentType, HttpOutputMessage outputMessage) throws IOException, HttpMessageNotWritableException`

用于将Java对象序列化，并将序列化后的数据写入output。

# HttpMessageConverter的使用
HttpMessageConverter的使用基本可以总结为如下几条：
- 有哪些HttpMessageConverter可用；
- 实际该用哪一个HttpMessageConverter；
- 怎么用这个HttpMessageConverter；

以client使用RestTemplate为例，看RestTemplate是怎么使用HttpMessageConverter的。

## 注册converter
首先在new RestTemplate的时候，会自动注册几个基础的converter：
```
		this.messageConverters.add(new ByteArrayHttpMessageConverter());
		this.messageConverters.add(new StringHttpMessageConverter());
		this.messageConverters.add(new ResourceHttpMessageConverter(false));
		try {
			this.messageConverters.add(new SourceHttpMessageConverter<>());
		}
		catch (Error err) {
			// Ignore when no TransformerFactory implementation is available
		}
		this.messageConverters.add(new AllEncompassingFormHttpMessageConverter());
```
另外，如果classpath下有某些序列化反序列化库，也会注册上相应的converter，比如json：
```
		jackson2Present =
				ClassUtils.isPresent("com.fasterxml.jackson.databind.ObjectMapper", classLoader) &&
						ClassUtils.isPresent("com.fasterxml.jackson.core.JsonGenerator", classLoader);
		if (jackson2Present) {
			this.messageConverters.add(new MappingJackson2HttpMessageConverter());
		}
```

如果默认注册的converter不满足要求，比如需要进行protobuf的序列化，可以手动添加`ProtobufHttpMessageConverter`到RestTemplate：
```
        ProtobufHttpMessageConverter protobufConverter = new ProtobufHttpMessageConverter();
        RestTemplate restTemplate = new RestTemplate(Collections.singletonList(protobufConverter));
```
这样就可以把自定义的converter添加到RestTemplate的converter列表里。

> 如果使用`setMessageConverters`方法，需要注意RestTemplate会先清掉自己的converts，再设置手动设置的converters。所以调用set方法注册converter的时候，一定要把需要的converter全部手动注册上。

## 选择converter
如何选择converter，主要是根据请求头的信息。
- Accept：表明了request所接受的返回格式，比如json、protobuf；
- Content-Type：表明了request自身的格式，比如json、protobuf；

假设Content-Type是application/json，Accept是application/x-protobuf。converter根据Content-Type的内容，使用`MappingJackson2HttpMessageConverter`将Java对象序列化为json，放入request。根据Accept的内容，使用`ProtobufHttpMessageConverter`将response从protobuf字节反序列化为Java对象。

## 使用converter
比如RestTemplate的`exchange`方法。

实际使用的时候，构造了RequestCallback和ResponseExtractor，分别处理request和response。处理流程类似：
1. 遍历注册的converter；
2. 依次使用converter的canWrite和Content-Type比较，判断是否可序列化为Content-Type里声明的格式，如果可以就调用write进行序列化；
3. 反序列化同理，只不过用的是Accept和read；

## server怎么使用converter的 - TODO
```
ResourceHttpRequestHandler#
this.resourceHttpMessageConverter.write(resource, mediaType, outputMessage);
```

# spring boot
Spring拥有条件注解，可以实现自动注册bean的功能。想注册自定义的converter，直接将相应converter声明为bean即可：
```
@Configuration
public class AppConfig {

    @Bean
    ProtobufHttpMessageConverter protobufHttpMessageConverter() {
        return new ProtobufHttpMessageConverter();
    }
}
```

# 报错
如果server method声明了接收protobuf，且返回protobuf格式：
```
    @PostMapping(value = "hello", consumes = "application/x-protobuf", produces = "application/x-protobuf")
    public Bar hello(@RequestBody Hello                                     request) {
```
但是忘了注册`protobufHttpMessageConverter`，会报错（一开始AppConfig忘了添加@Configuration注解了……）如下：
```
2020-05-25 16:05:52.499 ERROR 15501 --- [nio-8642-exec-1] c.y.e.exception.GlobalExceptionHandler   : 

org.springframework.web.HttpMediaTypeNotSupportedException: Content type 'application/x-protobuf;charset=UTF-8' not supported
        at org.springframework.web.servlet.mvc.method.annotation.AbstractMessageConverterMethodArgumentResolver.readWithMessageConverters(AbstractMessageConverterMethodArgumentResolver.java:225) ~[spring-webmvc-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.springframework.web.servlet.mvc.method.annotation.RequestResponseBodyMethodProcessor.readWithMessageConverters(RequestResponseBodyMethodProcessor.java:158) ~[spring-webmvc-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.springframework.web.servlet.mvc.method.annotation.RequestResponseBodyMethodProcessor.resolveArgument(RequestResponseBodyMethodProcessor.java:131) ~[spring-webmvc-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.springframework.web.method.support.HandlerMethodArgumentResolverComposite.resolveArgument(HandlerMethodArgumentResolverComposite.java:121) ~[spring-web-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.springframework.web.method.support.InvocableHandlerMethod.getMethodArgumentValues(InvocableHandlerMethod.java:167) ~[spring-web-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.springframework.web.method.support.InvocableHandlerMethod.invokeForRequest(InvocableHandlerMethod.java:134) ~[spring-web-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.springframework.web.servlet.mvc.method.annotation.ServletInvocableHandlerMethod.invokeAndHandle(ServletInvocableHandlerMethod.java:105) ~[spring-webmvc-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerAdapter.invokeHandlerMethod(RequestMappingHandlerAdapter.java:879) ~[spring-webmvc-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerAdapter.handleInternal(RequestMappingHandlerAdapter.java:793) ~[spring-webmvc-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.springframework.web.servlet.mvc.method.AbstractHandlerMethodAdapter.handle(AbstractHandlerMethodAdapter.java:87) ~[spring-webmvc-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.springframework.web.servlet.DispatcherServlet.doDispatch(DispatcherServlet.java:1040) ~[spring-webmvc-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.springframework.web.servlet.DispatcherServlet.doService(DispatcherServlet.java:943) ~[spring-webmvc-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.springframework.web.servlet.FrameworkServlet.processRequest(FrameworkServlet.java:1006) [spring-webmvc-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.springframework.web.servlet.FrameworkServlet.doPost(FrameworkServlet.java:909) [spring-webmvc-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at javax.servlet.http.HttpServlet.service(HttpServlet.java:660) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.springframework.web.servlet.FrameworkServlet.service(FrameworkServlet.java:883) [spring-webmvc-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at javax.servlet.http.HttpServlet.service(HttpServlet.java:741) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.catalina.core.ApplicationFilterChain.internalDoFilter(ApplicationFilterChain.java:231) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.catalina.core.ApplicationFilterChain.doFilter(ApplicationFilterChain.java:166) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.tomcat.websocket.server.WsFilter.doFilter(WsFilter.java:53) [tomcat-embed-websocket-9.0.35.jar:9.0.35]
        at org.apache.catalina.core.ApplicationFilterChain.internalDoFilter(ApplicationFilterChain.java:193) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.catalina.core.ApplicationFilterChain.doFilter(ApplicationFilterChain.java:166) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.springframework.web.filter.RequestContextFilter.doFilterInternal(RequestContextFilter.java:100) [spring-web-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.springframework.web.filter.OncePerRequestFilter.doFilter(OncePerRequestFilter.java:119) [spring-web-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.apache.catalina.core.ApplicationFilterChain.internalDoFilter(ApplicationFilterChain.java:193) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.catalina.core.ApplicationFilterChain.doFilter(ApplicationFilterChain.java:166) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.springframework.web.filter.FormContentFilter.doFilterInternal(FormContentFilter.java:93) [spring-web-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.springframework.web.filter.OncePerRequestFilter.doFilter(OncePerRequestFilter.java:119) [spring-web-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.apache.catalina.core.ApplicationFilterChain.internalDoFilter(ApplicationFilterChain.java:193) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.catalina.core.ApplicationFilterChain.doFilter(ApplicationFilterChain.java:166) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.springframework.boot.actuate.metrics.web.servlet.WebMvcMetricsFilter.doFilterInternal(WebMvcMetricsFilter.java:93) [spring-boot-actuator-2.3.0.RELEASE.jar:2.3.0.RELEASE]
        at org.springframework.web.filter.OncePerRequestFilter.doFilter(OncePerRequestFilter.java:119) [spring-web-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.apache.catalina.core.ApplicationFilterChain.internalDoFilter(ApplicationFilterChain.java:193) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.catalina.core.ApplicationFilterChain.doFilter(ApplicationFilterChain.java:166) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.springframework.web.filter.CharacterEncodingFilter.doFilterInternal(CharacterEncodingFilter.java:201) [spring-web-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.springframework.web.filter.OncePerRequestFilter.doFilter(OncePerRequestFilter.java:119) [spring-web-5.2.6.RELEASE.jar:5.2.6.RELEASE]
        at org.apache.catalina.core.ApplicationFilterChain.internalDoFilter(ApplicationFilterChain.java:193) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.catalina.core.ApplicationFilterChain.doFilter(ApplicationFilterChain.java:166) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.catalina.core.StandardWrapperValve.invoke(StandardWrapperValve.java:202) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.catalina.core.StandardContextValve.invoke(StandardContextValve.java:96) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.catalina.authenticator.AuthenticatorBase.invoke(AuthenticatorBase.java:541) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.catalina.core.StandardHostValve.invoke(StandardHostValve.java:139) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.catalina.valves.ErrorReportValve.invoke(ErrorReportValve.java:92) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.catalina.core.StandardEngineValve.invoke(StandardEngineValve.java:74) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.catalina.valves.AbstractAccessLogValve.invoke(AbstractAccessLogValve.java:690) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.catalina.connector.CoyoteAdapter.service(CoyoteAdapter.java:343) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.coyote.http11.Http11Processor.service(Http11Processor.java:373) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.coyote.AbstractProcessorLight.process(AbstractProcessorLight.java:65) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.coyote.AbstractProtocol$ConnectionHandler.process(AbstractProtocol.java:868) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.tomcat.util.net.NioEndpoint$SocketProcessor.doRun(NioEndpoint.java:1590) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at org.apache.tomcat.util.net.SocketProcessorBase.run(SocketProcessorBase.java:49) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1149) [na:1.8.0_252]
        at java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:624) [na:1.8.0_252]
        at org.apache.tomcat.util.threads.TaskThread$WrappingRunnable.run(TaskThread.java:61) [tomcat-embed-core-9.0.35.jar:9.0.35]
        at java.lang.Thread.run(Thread.java:748) [na:1.8.0_252]
```

# 参阅
- https://spring.io/blog/2015/03/22/using-google-protocol-buffers-with-spring-mvc-based-rest-services
- https://www.baeldung.com/spring-httpmessageconverter-rest
- https://www.baeldung.com/spring-controller-return-image-file



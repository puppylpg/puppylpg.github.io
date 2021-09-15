---
layout: post
title: "RESTful - HttpMessageConverter"
date: 2020-05-26 02:07:59 +0800
categories: REST HttpMessageConverter RestTemplate
tags: REST HttpMessageConverter RestTemplate
# render_with_liquid: false
---

在[RESTful - RestTemplate]({% post_url 2020-05-08-RESTful-RestTemplate %})中，说了自动转换都是由Http消息转换器做的。

Controller产生数据之后，DispatcherServlet不再需要将模型数据传送给视图，**首先没有了模型Model，其次也没有视图View，只有控制器产生的数据，再使用消息转换器转换为一定格式的数据**。

1. Table of Contents, ordered                    
{:toc}

# 场景
Spring自动注册了几个消息转换器，比如`MappingJackson2HttpMessageConverter`，它的注册条件很简单，只要：
- Jackson2库在classpath上；

此时如果请求的Accept header表明可以接收"application/json"，就会使用该消息转换器将java object转换为json。

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

# `HttpMessageConverter`
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

以client使用RestTemplate为例，看RestTemplate是怎么使用HttpMessageConverter的。

## 有哪些converter可用 - 注册converter
### 手动添加
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

### 自动添加
当然在[RESTful - RestTemplate]({% post_url 2020-05-08-RESTful-RestTemplate %})中也说了，如果是以注入的方式构建RestTemplate，实例化为bean的converter也会自动注册到RestTemplate里。

## 选择converter
如何选择converter，主要是根据请求头的信息。
- Accept：表明了request所接受的返回格式，比如json、protobuf；
- Content-Type：表明了request自身的格式，比如json、protobuf；

假设Content-Type是application/json，Accept是application/x-protobuf。converter根据Content-Type的内容，使用`MappingJackson2HttpMessageConverter`将Java对象序列化为json，放入request。根据Accept的内容，使用`ProtobufHttpMessageConverter`将response从protobuf字节反序列化为Java对象。

比如RestTemplate的`exchange`方法。实际使用的时候，构造了RequestCallback和ResponseExtractor，分别处理request和response。处理流程类似：
1. 遍历注册的converter；
2. **依次使用converter的`canWrite`和Content-Type比较**，判断是否可序列化为Content-Type里声明的格式，如果可以就调用write进行序列化；
3. 反序列化同理，只不过用的是Accept和read；

# 无法序列化导致的错误
## 某个media type不支持
如果server method声明了接收protobuf，且返回protobuf格式：
```
    @PostMapping(value = "hello", consumes = "application/x-protobuf", produces = "application/x-protobuf")
    public Bar hello(@RequestBody Hello request);
```
但是忘了注册`protobufHttpMessageConverter`，会报错如下：
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
之所以不支持该media type（application/x-protobuf），因为没有能处理protobuf的converter。

## 没有特定的converter
假设我们要发送post一个请求，服务器只接受请求体为"application/x-www-form-urlencoded"格式。

那么我们必然先指定header的Content-Type为"application/x-www-form-urlencoded"：
```
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
```

然后发送过去：
```
        U request = ...
        RequestEntity<U> requestEntity = new RequestEntity<>(request, headers, HttpMethod.POST, new URI(url));
        ResponseEntity<V> rawResp = restTemplate.exchange(requestEntity, getResponseClass());
```
这里的U代表一个java类`com.entity.TextAsyncRequest`。就会报错：
```
2021-09-15 16:29:15.776 ERROR http-nio-8022-exec-1 o.a.c.c.C.[.[.[.[dispatcherServlet]:175 Servlet.service() for servlet [dispatcherServlet] in context with path [] threw exception [Request processing failed; nested exception is org.springframework.web.client.RestClientException: No Ht
tpMessageConverter for com.entity.TextAsyncRequest and content type "application/x-www-form-urlencoded"] with root cause
org.springframework.web.client.RestClientException: No HttpMessageConverter for com.entity.TextAsyncRequest and content type "application/x-www-form-urlencoded"
        at org.springframework.web.client.RestTemplate$HttpEntityRequestCallback.doWithRequest(RestTemplate.java:959)
        at org.springframework.web.client.RestTemplate.doExecute(RestTemplate.java:735)
        at org.springframework.web.client.RestTemplate.exchange(RestTemplate.java:639)
```
说我们的类U和"application/x-www-form-urlencoded"之间没有相互转换的converter。

既然指定Content-Type为"application/x-www-form-urlencoded"，spring boot就要把这个类转成"application/x-www-form-urlencoded"。一般spring boot里有通用的java object转json的convert，但是转"application/x-www-form-urlencoded"的还真没有，但这里又必须得要这种convert，所以报错了。

如果这里的Content-Type是application/json就不会报错了。

有两种方式解决：
1. 像`MappingJackson2HttpMessageConverter`一样，搞一个通用的java object转x-www-form-urlencoded的convert，这样spring boot还能自动帮我们转换请求体格式；
2. **手动把java对象转成x-www-form-urlencoded格式**，构造好请求体，再发过去。

## 自动转，需要converter
按照x-www-form-urlencoded的规范，**先搞成`&`和`=`拼接的kv对（允许相同key，也就是说value可以多值），再进行urlencode**：
- https://stackoverflow.com/questions/56564262/use-resttemplate-with-object-as-data-and-application-x-www-form-urlencoded-conte/56566601

当然，也可以做个折中：
1. java object转成MultiValueMap；
2. MultiValueMap再转成x-www-form-urlencoded格式；

**而实际上，spring boot已经有了MultiValueMap转x-www-form-urlencoded的converter：`FormHttpMessageConverter`**。所以我们只要把java object转成MultiValueMap就行了。

> header的类型也是MultiValueMap，233，所以x-www-form-urlencoded的header和body差不多了。

先设置header：
```
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        headers.set("pikachu", "springboot");
```
构建MultiValueMap，把java object里所有的属性和值都以kv的形式扔进去：
```
        MultiValueMap<String, String> bodyPair = new LinkedMultiValueMap();
        bodyPair.add(K1, V1);
        bodyPair.add(K1, V2);
        bodyPair.add(K2, V2);
        ...
```
如果k，v太多，可以考虑反射。

构建HttpEntity（request body + header），此时converter就进行请求体的转换了：
```
        HttpEntity<MultiValueMap<String, String>> requestEntity = new HttpEntity<>(bodyPair, headers);
```
发送post请求：
```
        ResponseEntity<V> rawResp = restTemplate.postForEntity(url, requestEntity , getResponseClass());
```
- https://stackoverflow.com/a/69196764/7676237

## 手动转

# post debug小技巧
想看看post请求的请求体长啥样，给以下网址发个post请求：
- https://httpbin.org/post

它会把请求的header和body都放到响应体里返回回来：
```
{
  "args": {},
  "data": "",
  "files": {},
  "form": {
    "callback": "120788_7QQF0U4-NuQ_TEXT",
    "version": "v4.2"
  },
  "headers": {
    "Accept": "text/plain, application/json, application/x-jackson-smile, application/cbor, application/*+json, */*",
    "Accept-Encoding": "gzip,deflate",
    "Content-Length": "68",
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    "Host": "httpbin.org",
    "Pikachu": "springboot",
    "User-Agent": "Apache-HttpClient/4.5.13 (Java/1.8.0_66)",
    "X-Amzn-Trace-Id": "Root=1-6141d68c-20df0a1c74d91ed839e84b95"
  },
  "json": null,
  "origin": "103.72.47.72",
  "url": "https://httpbin.org/post"
}
```
form说明我们是以x-www-form-urlencoded的格式发过去的。同理，json、files、data、分别对应post请求的其他请求体编码方式。headers使我们请求的header，里面还有自定义的pikachu。

# 参阅
- https://spring.io/blog/2015/03/22/using-google-protocol-buffers-with-spring-mvc-based-rest-services
- https://www.baeldung.com/spring-httpmessageconverter-rest
- https://www.baeldung.com/spring-controller-return-image-file



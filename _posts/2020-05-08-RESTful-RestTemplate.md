---
layout: post
title: "RESTful - RestTemplate"
date: 2020-05-08 00:21:43 +0800
categories: REST RestTemplate POST
tags: REST RestTemplate POST
# render_with_liquid: false
---

REST, Representational State Transfer，表述性、状态、转移。
- Representational：表述性，表述资源，用xml、json等任何合适的格式表述资源；
- State：REST关注的是资源的状态，而不是对资源所采取的行为；
- Transfer：资源从一个应用转移到另一个应用。

所以**REST就是以表述性的语言，将资源从一个地方转移到另一个地方**。REST是面向资源的，关注的是资源的表述形式和资源的转移（比如在server和client之间转移）。

RPC等是面向服务的，不是面向资源的。他们更关注行为和动作。

资源用URL进行识别和定位。REST使用HTTP的方法进行CRUD：
- Create: POST;
- Read: GET;
- Update: PUT/PATCH;
- Delete: DELETE;

1. Table of Contents, ordered                    
{:toc}

# 用Spring构建REST
普通SpringMVC服务：
Request -> [Controller Mapping] ->  Controller -[Model]-> [View Resolver] -> View -> Response(html)

REST：
Request -> [Controller Mapping] ->  Controller -[Data]-> Message Conversion ->  Response(json)

> MVC只剩下了C。

**SpringMVC服务一般是用于构建给人看的网页，所以返回数据被视图渲染为html。对于非人类的使用者（eg：client），资源的表述应该用xml或者json，主要是方便被服务解析。**

# http post 格式
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods/POST

server收到的http post请求的 **请求体** 是什么格式的？通过Content-Type来标识。

它可以是：
- `application/x-www-form-urlencoded`：键值对，并urlencode后的内容；
- `application/json`：json格式；
- `application/x-protobuf`：protobuf格式；
- `application/pdf`
- `application/xml`
- `text/plain`：普通文本；
- `text/html`：html文本；

等等各种奇奇怪怪的标准的格式。

但是restful服务能收的，一个是结构化的，比如json、xml、protobuf等等。plain这种没什么用，没法解析格式。也不会接收html，那是给人看的。

怎么知道收到的post的请求体是哪种格式？看它的Content-Type就行了。

那么怎么知道对方愿意接收哪种格式的响应体？看request的Accept。

# body格式自动转换

如果对方发过来的是json，想接收protobuf，那么我们没收到一个请求都要把它从json反序列化为java object，每次返回都要把java object序列化为protobuf吗？

的确如此，**但不必我们亲手做**。只需要通过下面的注解标注一下，springboot就会自动做这两种转换了。

> **实际是通过HTTP消息转换器（HTTP Message Converter）来完成转换的。**

## `@ResponseBody` - 将返回值转换为相应格式的响应体
我们的方法只管return java对象，springboot（消息转换器）会自动将其转换为格式化消息。
```
    @RequestMapping(value = "/{id}", method = RequestMethod.GET, produces = "application/json")
    @ResponseStatus(HttpStatus.OK)
    public @ResponseBody User getUserById(@PathVariable long id) {
        User user = userDao.getById(id);
        if (user == UserDao.EMPTY) {
            throw new UserNotFoundException(id);
        }
        return user;
    }
```
这里，**`@RequestMapping`的`producers`**：表明我们只返回json格式的数据。request的Accept应该说它接收json，这个方法的返回才能被client理解。

> 可以使用Jackson Annotations对对象的属性进行标注，以改变转换时的属性名等。

## `@RequestBody` - 将来自客户端的请求体转换为对象
免去了接收json，再序列化为对象的工作。
```
    @RequestMapping(value = "/add", method = RequestMethod.POST, consumes = "application/json", produces = "application/json")
    @ResponseStatus(HttpStatus.CREATED)
    public @ResponseBody User addUser(@RequestBody User user) {
        return userDao.add(user);
    }
```
同理，**`@RequestMapping`的`consumers`**：表明只处理Header的Content-Type为application/json的请求，即只将发过来的json转为对象。

同时该方法的@ResponseBody表明返回json。

## `@RestController` 
其实就是`@Controller` + `@ResponseBody`。类上只要标注了它，类不用标注`@Controller`了，所有的方法都不用标注`@ResponseBody`了。因为@RestController的注解定义上已经标注了这两个注解。

> **但是`@RequestBody`该写还是得写的**。

# 不止body，还想返回status
## `@ResponseStatus`
给返回的HTTP消息设置status code：
```
    @RequestMapping(value = "/{id}", method = RequestMethod.GET, produces = "application/json")
    @ResponseStatus(HttpStatus.OK)
    public @ResponseBody User getUserById(@PathVariable long id) {
        User user = userDao.getById(id);
        if (user == UserDao.EMPTY) {
            throw new UserNotFoundException(id);
        }
        return user;
    }
```
然后再配个全局异常拦截器：
```
@RestController
@ControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(UserNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public @ResponseBody ErrorResponse userNotFound(UserNotFoundException e) {
        return new ErrorResponse(11111, e.getMessage());
    }
}
```
正常的方法只需返回HttpStatus.OK，异常处理方法返回HttpStatus.NOT_FOUND即可。

> 这个UserNotFoundException一般定义为extends RuntimeException，就不用将异常加在方法签名里了。

# 甚至还想自定义返回的header

## `HttpEntity<T>`
`HttpEntity<T>`代表`ResponseEntity<T>`和`RequestEntity<T>`的公共部分：
1. header;
2. body;

所以构造HttpEntity只需要header和body两个（木有status code，继承它的ResponseEntity才加了status code）：
```
	/**
	 * Create a new {@code HttpEntity} with the given body and headers.
	 * @param body the entity body
	 * @param headers the entity headers
	 */
	public HttpEntity(@Nullable T body, @Nullable MultiValueMap<String, String> headers) {
		this.body = body;
		HttpHeaders tempHeaders = new HttpHeaders();
		if (headers != null) {
			tempHeaders.putAll(headers);
		}
		this.headers = HttpHeaders.readOnlyHttpHeaders(tempHeaders);
	}
```

## `ResponseEntity<T>` extends `HttpEntity<T>`
**status code + header + body的组合体**。代表整个HTTP response：
- status code;
- header + body ( = HttpEntity);

```
	/**
	 * Create a new {@code HttpEntity} with the given body, headers, and status code.
	 * @param body the entity body
	 * @param headers the entity headers
	 * @param status the status code
	 */
	public ResponseEntity(@Nullable T body, @Nullable MultiValueMap<String, String> headers, HttpStatus status) {
		super(body, headers);
		Assert.notNull(status, "HttpStatus must not be null");
		this.status = status;
	}
```
**主要用在想加一些自定义headers的场景下**：
```
    /**
     * 自定义headers返回.
     */
    @RequestMapping(value = "/entity/{id}", method = RequestMethod.GET, produces = "application/json")
    public ResponseEntity<User> getUserWithHeaders(@PathVariable long id) {
        User user = userDao.getById(id);
        if (user == UserDao.EMPTY) {
            throw new UserNotFoundException(id);
        }

        HttpHeaders headers = new HttpHeaders();
        headers.put("pokemon", Arrays.asList("pichu", "pikachu", "raichu"));
        return new ResponseEntity<>(user, headers, HttpStatus.OK);
    }
```
对于异常，也配个全局异常拦截器。

## `RequestEntity<T>` extends `HttpEntity<T>`
代表整个http request。RequestEntity包含：
- url；
- method；
- header + body ( = HttpEntity);

# `RestTemplate`
REST client请求资源的样板代码：
- new HttpClient;
- new HttpGet(set Header Accept application/json);
- client.execute(request);
- response.getEntity;
- mapper.readValue(entity.getContent) -> 反序列化

Spring使用RestTemplate将这些步骤全封装了！正如JdbcTemplate！

## 注入
springboot没有的自动配置机制没有直接配置RestTemplate，而是配置了RestTemplateBuilder：
```
	@Bean
	@Lazy
	@ConditionalOnMissingBean
	public RestTemplateBuilder restTemplateBuilder(ObjectProvider<HttpMessageConverters> messageConverters,
			ObjectProvider<RestTemplateCustomizer> restTemplateCustomizers,
			ObjectProvider<RestTemplateRequestCustomizer<?>> restTemplateRequestCustomizers) {
		RestTemplateBuilder builder = new RestTemplateBuilder();
		HttpMessageConverters converters = messageConverters.getIfUnique();
		if (converters != null) {
			builder = builder.messageConverters(converters.getConverters());
		}
		builder = addCustomizers(builder, restTemplateCustomizers, RestTemplateBuilder::customizers);
		builder = addCustomizers(builder, restTemplateRequestCustomizers, RestTemplateBuilder::requestCustomizers);
		return builder;
	}
```
builder接收一个`ObjectProvider<HttpMessageConverter<?>> converters`，看名字是一堆converters的封装。它也是自动配置：
```
    @Bean
    @Lazy
    @ConditionalOnMissingBean
    public RestTemplateBuilder restTemplateBuilder(ObjectProvider<HttpMessageConverters> messageConverters, ObjectProvider<RestTemplateCustomizer> restTemplateCustomizers, ObjectProvider<RestTemplateRequestCustomizer<?>> restTemplateRequestCustomizers) {
        RestTemplateBuilder builder = new RestTemplateBuilder(new RestTemplateCustomizer[0]);
        HttpMessageConverters converters = (HttpMessageConverters)messageConverters.getIfUnique();
        if (converters != null) {
            builder = builder.messageConverters(converters.getConverters());
        }

        builder = this.addCustomizers(builder, restTemplateCustomizers, RestTemplateBuilder::customizers);
        builder = this.addCustomizers(builder, restTemplateRequestCustomizers, RestTemplateBuilder::requestCustomizers);
        return builder;
    }
```
接收`ObjectProvider<HttpMessageConverter<?>> converters`，接收单个的converter。

如果我们自己配置一个converter：
```
    @Bean
    ProtobufHttpMessageConverter protobufHttpMessageConverter() {
        return new ProtobufHttpMessageConverter();
    }
```
这个converter就会通过上面的机制自动注入RestTemplateBuilder。

实际使用的时候可以在类里注入builder，再构建出RestTemplate：
```
    RestTemplate restTemplate;
    
    @Autowired
    public RestfulServer(RestTemplateBuilder restTemplateBuilder) {
        this.restTemplate = restTemplateBuilder.build();
    }
```

## 方法
- getForObject;
- postForObject;
- put;
- delete;

**上面ForObject的方法都有ForEntity的版本。不止返回body，还有header和status code。**

## exchange - 请求中带请求头
它比较灵活，我们可以将整个请求给拆碎开来，分别作为参数传入，比如url + method + (header + body = HttpEntity)：
```
public <T> ResponseEntity<T> exchange(String url, HttpMethod method,
			@Nullable HttpEntity<?> requestEntity, Class<T> responseType, Map<String, ?> uriVariables)
			throws RestClientException
```
可以达到普通getForEntity()的效果：
```java
    /**
     * exchange method, return value must be {@link ResponseEntity}, just like getForEntity method.
     */
    public User exchange(long id) {
        ResponseEntity<User> userEntity = restTemplate.exchange(URL_SERVER + "/{id}", HttpMethod.GET, null, User.class, id);
        return userEntity.getBody();
    }
```
但 **exchange方法主要是为了使用`HttpEntity<T>`同时自定义请求的header**：
```
    /**
     * 请求设置header信息。
     */
    public User exchangeWithHeaders(long id) {
        // 添加自定义header
        MultiValueMap<String, String> rawHeaders = new LinkedMultiValueMap<>();
        rawHeaders.add("whoami", "xiaozhi");
        rawHeaders.add("Accept", "application/json");
        // 设置通用header
        HttpHeaders headers = new HttpHeaders();
        headers.addAll(rawHeaders);
        headers.setLocation(URI.create("zhoukou"));

        System.out.println(headers);

        HttpEntity<Object> requestEntity = new HttpEntity<>(headers);
        ResponseEntity<User> userEntity = restTemplate.exchange(URL_SERVER + "/entity/{id}", HttpMethod.GET, requestEntity, User.class, id);
        return userEntity.getBody();
    }
```
**exchange的各种重载方法返回值只有ResponseEntity类型**。

---
layout: post
title: "Spring Mvc Test - MockMvc"
date: 2022-11-26 22:17:46 +0800
categories: spring test
tags: spring test
---

[`MockMvc`](https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#spring-mvc-test-framework)提供了对spring mvc层的测试能力。它能够模拟server的运行过程（实际上并没有真的server在运行），处理mock的请求和响应。说白了就是：**client和server本来应该是多进程的行为，现在不仅都放在一个进程里，甚至都放在了同一个线程里执行**！通过`MockMvc`，直接在一个线程里执行servlet！

> It performs full Spring MVC request handling but via mock request and response objects instead of a running server.

`MockMvc`还能插入`WebTestClient`，让client完整测试http api，但实际servlet还是在同一个线程里串行执行的。

> It can also be used through the `WebTestClient` where MockMvc is plugged in as the server to handle requests with. The advantage of `WebTestClient` is the option to work with higher level objects instead of raw data as well as the ability to switch to full, end-to-end HTTP tests against a live server and use the same test API.
>
> The `WebTestClient` provides a fluent API without static imports.

1. Table of Contents, ordered
{:toc}

# 为什么用`MockMvc`
为什么用`MockMvc`呢？直接实例化一个controller，注入依赖，测它的方法不行吗？可以，但这样测的就仅仅是controller的部分，这只是spring mvc流程里非常小的一部分（纯业务部分）。如果仅仅测试这一部分，其实和只测试service差不太多。这样测试controller，并没有办法测试http在SpringMVC里的整个流动：
1. 测不了api映射、数据参数绑定、rest数据转换等等：such tests do not verify request mappings, data binding, message conversion, type conversion, validation；
2. 更测不了SpringMVC提供的异常处理器等组件：and nor do they involve any of the supporting `@InitBinder`, `@ModelAttribute`, or `@ExceptionHandler` methods；

测试controller的精髓就在于测试SpringMVC这一套是否都正确运行，否则直接测service就差不多了。`MockMvc`就是spring提供的专门用来测SpringMVC的框架。

# 初始化`MockMvc`
有两种初始化`MockMvc`的方法：

## 直接绑定controller
在配置上完全不考虑spring的语境，只指定要测试的controller（可以额外加上filter、controller advice等组件），由`MockMvc`自动创建一个`WebApplicationContext`，用于构建`MockMvc`：
```java
class MyWebTests {

    MockMvc mockMvc;

    @BeforeEach
    void setup() {
        this.mockMvc = MockMvcBuilders.standaloneSetup(new AccountController()).build();
    }

    // ...

}
```

这种方式更像单元测试，一次只测试一个controller。它需要 **手动** 给controller注入需要的依赖（可以是真实的，也可以是mock的）。

**优点是非常简单：可以快速构建test、用来debug某个issue。**

等价的`WebTestClient`用法：
- https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#webtestclient-controller-config

## 使用SpringMVC配置
指定SpringMVC配置文件，根据配置文件自动创建好一个`WebApplicationContext`，用于构建`MockMvc`：
```java
@SpringJUnitWebConfig(locations = "my-servlet-context.xml")
class MyWebTests {

    MockMvc mockMvc;

    @BeforeEach
    void setup(WebApplicationContext wac) {
        this.mockMvc = MockMvcBuilders.webAppContextSetup(wac).build();
    }

    // ...

}
```

这种方法更“集成”一些，因为它加载的是真实的SpringMVC配置，而且可以在配置里指定很多bean，能把这些bean直接`@Autowired`到test class里。**不需要手动注入依赖到controller里。**

当然，也可以配置文件里声明mock的bean，未必都是真实的：
```xml
<bean id="accountService" class="org.mockito.Mockito" factory-method="mock">
    <constructor-arg value="org.example.AccountService"/>
</bean>
```
config class同理。

> 而且这个配置会被TestContext framework缓存下来，所以当这种测试变多的时候，速度会更快。

等价的`WebTestClient`用法：
- https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#webtestclient-context-config

# 使用`MockMvc`
以使用第一种方式初始化`MockMvc`为例——

## 构建`MockMvc`
`StandaloneMockMvcBuilder`有一堆配置方法，可以完善mvc组件，注册filter，也可以给请求默认添加一些全局设置，比如：
```java
// static import of MockMvcBuilders.standaloneSetup

MockMvc mockMvc = standaloneSetup(new MusicController())
    .addFilters(new CharacterEncodingFilter())
    .defaultRequest(get("/").accept(MediaType.APPLICATION_JSON))
    .alwaysExpect(status().isOk())
    .alwaysExpect(content().contentType("application/json;charset=UTF-8"))
    .build();
```
上面的示例给所有request默认添加accept header，内容为application/json。**如果传入的请求设置了同样的properties，以请求为准**。`MockMvc`本身不构建请求，它只提供一些默认的`RequestBuilder`。如果请求没设置的properties，使用默认的`RequestBuilder`设置一下。

> `DefaultMockMvcBuilder`同理。

还可以通过`MockMvcConfigurer`做配置（很像springboot自动配置提供的各种configurer，用于自定义自动配置的bean）。比如`SharedHttpSessionConfigurer`，能够让同一`MockMvc`的所有test method共享session。
> 其实就是在构建完`MockMvc`之后给它添加一个默认的`ResultHandler`、`RequestBuilder`。前者用于从response里取出session并保存下来，后者用于给传入的request设置上这个session（当然第一次request是设置不上这个session了，因为第一次请求之后才有session）。

## 构造请求 - `MockMvcRequestBuilders`
发送请求之前先使用`MockMvcRequestBuilders`构造请求。

一个post请求，带上accept header：
```java
post("/hotels/{id}", 42).accept(MediaType.APPLICATION_JSON)
```
file upload, multipart：
```java
multipart("/doc").file("a1", "ABC".getBytes("UTF-8"))
```
**通过URI template指定query parameters**：
```java
get("/hotels?thing={thing}", "somewhere")
```
**使用`param()`方法给Servlet request添加query parameters或者form parameters**：
```java
get("/hotels").param("thing", "somewhere")
```
**query parameter和form parameter只有在check query string的时候才有区别**：
- **`ServletRequest`定义了获取parameter的方法**，`public String getParameter(String name)`: Returns the value of a request parameter as a String, or null if the parameter does not exist. Request parameters are extra information sent with the request. **For HTTP servlets, parameters are contained in the query string or posted form data**.
- **`HttpServletRequest`才有获取query string的方法**，`public String getQueryString()`: **Returns the query string that is contained in the request URL after the path**. This method returns null if the URL does not have a query string.

**所以处理`HttpServletRequest`的时候，如果不调用`getQueryString()`，其实http用的到底是query parameter还是form parameter，并没什么区别**。事实上，我们从来没有直接处理过http，都是用的包装后的`HttpServletRequest`，调用的也基本都是`getParameter()`：
> If application code relies on Servlet request parameters and does not check the query string explicitly (as is most often the case), it does not matter which option you use.

既然`getParameter()`对于query parameter和form parameter来说都没有什么区别，`MockHttpServletRequestBuilder`的实现就非常粗暴，直接把`param()`方法传入的parameter放到了`MultiValueMap<String, String>`里，干脆就不区分了。反正在构建为`MockHttpServletRequest`的时候，也是放到了`Map<String, String[]> parameters`里。

> tomcat对`HttpServletRequest`的正式实现里，parameters用了一个自定义的`Parameters`对象，但它里面包装的其实还是一个`Map<String,ArrayList<String>>`，所以区别不大。

无论通过URI template还是`param()`指定参数，传入的都是url decode后的值。但是二者是有区别的：
- **前者传入的decode值是原始值**，后续发请求的时候会被encode，处理的时候会再次被decode；
- **后者传入的decode值是逻辑上已经被url decode了的值**，因为后续调用`ServletRequest#getParameter`的时候，直接就把它返回了；

虽然表面上看，他们都是url decode的值，但理解这两点区别还是很重要的，说明理解了他们在整个请求流程里所处的位置。
> Keep in mind, however, that query parameters provided with the URI template are decoded while request parameters provided through the `param(…)` method are expected to already be decoded.

**`MockMvc`推荐直接测controller mapping，不要加上context path和servlet path**。如果非要带上这俩测完整的url，要把他们指明了。否则`MockMvc`会把整个url当做controller mapping处理，不考虑context path和servlet path：
```java
mockMvc.perform(get("/app/main/hotels/{id}").contextPath("/app").servletPath("/main"))
```
context path和servlet path也可以设置到`MockMvc`的`defaultRequest()`里，就不用在每个请求里单独设置了：
```java
class MyWebTests {

    MockMvc mockMvc;

    @BeforeEach
    void setup() {
        mockMvc = standaloneSetup(new AccountController())
            .defaultRequest(get("/").contextPath("/app").servletPath("/main").accept(MediaType.APPLICATION_JSON))
            .build();
    }
}
```

## 断言响应 - `MockMvcResultMatchers`
使用`andExpect()`：
```java
mockMvc.perform(get("/accounts/1")).andExpect(status().isOk());
```
断言来自`MockMvcResultMatchers`。

使用`andExpectAll()`的好处是，会断言所有，即使有的失败了，也会继续执行后续的断言：
```java
mockMvc.perform(get("/accounts/1")).andExpectAll(
    status().isOk(),
    content().contentType("application/json;charset=UTF-8")
);
```

断言主要有两大类：
1. 断言response本身：比如response status, headers, and content等等；
2. **断言SpringMVC方面的东西**：
    1. which controller method processed the request, 
    2. whether an exception was raised and handled, 
    3. what the content of the model is, 
    4. what view was selected, 
    5. what flash attributes were added, 
    6. and so on.
    7. 包括servlet相关的：such as request and session attributes.

`model()`方法返回`ModelResultMatchers`，然后使用`ModelResultMatchers`断言binding or validation failed：
```java
mockMvc.perform(post("/persons"))
    .andExpect(status().isOk())
    .andExpect(model().attributeHasErrors("person"));
```
如果感觉断言的还不够，可以使用`andReturn()`获取结果，自己直接获取结果里的某一部分做断言：
```java
MvcResult mvcResult = mockMvc.perform(post("/persons")).andExpect(status().isOk()).andReturn();
// ...
```

也可以通过`MockMvc`给所有请求加上默认断言，`alwaysExpect()`：
```java
standaloneSetup(new SimpleController())
    .alwaysExpect(status().isOk())
    .alwaysExpect(content().contentType("application/json;charset=UTF-8"))
    .build()
```

> 和默认request builder不一样的是，`alwaysExpect`不能被覆盖：Note that common expectations are always applied and cannot be overridden without creating a separate `MockMvc` instance.

## 一些其他操作 - `MockMvcResultHandlers`
比如`print`，把response输出到`System.out`：
```java
mockMvc.perform(post("/persons"))
    .andDo(print())
    .andExpect(status().isOk())
    .andExpect(model().attributeHasErrors("person"));
```
当然还能传参输出到`OutputStream`或者`Writer`。还有一个`log()`方法，输出为DEBUG信息到`org.springframework.test.web.servlet.result`日志。

## 异步servlet
在[Servlet - NIO & Async]({% post_url 2021-03-24-servlet-nio-async %})中介绍过异步servlet，主要应用场景是server push：**由一个工作线程管理一堆长http request**，并在有消息的时候push回客户端。

> **主要原因在于：虽然request很长，还没结束，但是servlet线程可以结束了。之前同步servlet做不到这一点，对于长request，只能一直耗着。**

`MockMvc`测试异步servlet时生动地揭示了spring test和异步servlet的本质：
1. 先测试返回的异步结果；
2. **再手动调用异步dispatch，然后校验真正的（异步计算出来的）结果**；

**它不仅生动地说明了异步servlet就像`Future`一样分两部分：`Future`本身、通过`Future`获取到的真正的结果。还揭示了spring test的本质：其实是在一个线程里手动执行servlet**。

> In Spring MVC Test, **async requests can be tested by asserting the produced async value first, then manually performing the async dispatch, and finally verifying the response.**

第一次执行，因为是异步的，所以直接返回了，没有实质的结果。第二次执行的时候把第一次的结果放进去，并手动执行async逻辑，再对（真正的）结果进行判断：
```java
@Test
void test() throws Exception {
    MvcResult mvcResult = this.mockMvc.perform(get("/path"))
            .andExpect(status().isOk()) 
            .andExpect(request().asyncStarted()) 
            .andExpect(request().asyncResult("body")) 
            .andReturn();

    this.mockMvc.perform(asyncDispatch(mvcResult)) 
            .andExpect(status().isOk()) 
            .andExpect(content().string("body"));
}
```

## `MockMvc` vs End-to-End Tests
`MockMvc`是测试SpringMVC的mvc层的重要手段！**它其实介于单元测试和集成测试之间**，就好像我们单独测service层一样，不能说是集成测试，但比单元测试又多了一些。**`MockMvc`是spring test出的专门测web layer的非常方便的工具！**

- https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#spring-mvc-test-vs-end-to-end-integration-tests

# `MockMvc`模拟servlet容器：springmvc的本质
以一个纯手工打造`StandaloneMockMvcBuilder`的例子为入口，分析一下`MockMvc`初始化和处理请求的流程：
```java
@ExtendWith(MockitoExtension.class)
public class SuperHeroControllerMockMvcStandaloneTest {

    private MockMvc mvc;

    @Mock
    private SuperHeroRepository superHeroRepository;

    @InjectMocks
    private SuperHeroController superHeroController;

    @BeforeEach
    public void setup() {
        // MockMvc standalone approach
        mvc = MockMvcBuilders.standaloneSetup(superHeroController)
                .setControllerAdvice(new SuperHeroExceptionHandler())
                .addFilters(new SuperHeroFilter())
                .build();
    }

    @Test
    public void canRetrieveByIdWhenExists() throws Exception {
        // given
        given(superHeroRepository.getSuperHero(2))
                .willReturn(new SuperHero("Rob", "Mannon", "RobotMan"));

        // when
        MockHttpServletResponse response = mvc.perform(
                get("/superheroes/2")
                        .accept(MediaType.APPLICATION_JSON))
                .andReturn().getResponse();

        // then
        assertThat(response.getStatus()).isEqualTo(HttpStatus.OK.value());
        assertThat(response.getContentAsString()).isEqualTo(
                jsonSuperHero.write(new SuperHero("Rob", "Mannon", "RobotMan")).getJson()
        );
    }
}
```
`MockMvc`builder的前期设置无非是在set一些属性，只有最后的`build()`生成`MockMvc`对象这一步，揭示了`MockMvc`的本质，**同时也很大程度上揭示了SpringMVC的本质**：
```java
	public final MockMvc build() {
		WebApplicationContext wac = initWebAppContext();
		ServletContext servletContext = wac.getServletContext();
		MockServletConfig mockServletConfig = new MockServletConfig(servletContext);

		for (MockMvcConfigurer configurer : this.configurers) {
			RequestPostProcessor processor = configurer.beforeMockMvcCreated(this, wac);
			if (processor != null) {
				if (this.defaultRequestBuilder == null) {
					this.defaultRequestBuilder = MockMvcRequestBuilders.get("/");
				}
				if (this.defaultRequestBuilder instanceof ConfigurableSmartRequestBuilder) {
					((ConfigurableSmartRequestBuilder) this.defaultRequestBuilder).with(processor);
				}
			}
		}

		Filter[] filterArray = this.filters.toArray(new Filter[0]);

		return super.createMockMvc(filterArray, mockServletConfig, wac, this.defaultRequestBuilder,
				this.defaultResponseCharacterEncoding, this.globalResultMatchers, this.globalResultHandlers,
				this.dispatcherServletCustomizers);
	}
```
下面一步一步来分解——

## `WebApplicationContext`
对于`StandaloneMockMvcBuilder`来说，因为没有spring `WebApplicationContext`，所以首先要搞一个`WebApplicationContext`，wac：
```java
    	@Override
    	protected WebApplicationContext initWebAppContext() {
    		MockServletContext servletContext = new MockServletContext();
    		StubWebApplicationContext wac = new StubWebApplicationContext(servletContext);
    		registerMvcSingletons(wac);
    		servletContext.setAttribute(WebApplicationContext.ROOT_WEB_APPLICATION_CONTEXT_ATTRIBUTE, wac);
    		return wac;
    	}
```
**本质：SpringMVC是基于servlet做的，所以要把自己接入servlet标准。即：servlet要持有SpringMVC的`WebApplicationContext`**。

因此首先要搞一个`ServletContext`，然后才能让它关联wac。

### `ServletContext` - war包里共享的servlet配置
**[`ServletContext`里放的是一个war包里所有servlet需要共享的配置](https://www.javatpoint.com/servletcontext)，可以认为它是从`web.xml`读的数据**。因为servlet需要这些数据，所以servlet有`getServletContext`方法，以获取`ServletContext`。之后再调用它的：
- `getInitParameter`：**获取自定义的初始化参数**；
- `getAttribute`/`setAttribute`

等方法以获取数据、临时保存数据。

MockMvc里的`ServletContext`实现是`MockServletContext`：
```java
    	public MockServletContext(String resourceBasePath, @Nullable ResourceLoader resourceLoader) {
    		this.resourceLoader = (resourceLoader != null ? resourceLoader : new DefaultResourceLoader());
    		this.resourceBasePath = resourceBasePath;

    		// Use JVM temp dir as ServletContext temp dir.
    		String tempDir = System.getProperty(TEMP_DIR_SYSTEM_PROPERTY);
    		if (tempDir != null) {
    			this.attributes.put(WebUtils.TEMP_DIR_CONTEXT_ATTRIBUTE, new File(tempDir));
    		}

    		registerNamedDispatcher(this.defaultServletName, new MockRequestDispatcher(this.defaultServletName));
    	}
```
- 默认设置的resource地址（war包地址）是`""`；
- 默认注册了`RequestServlet`（实现为`MockRequestDispatcher`），名字就叫`"default"`。这个dispatcher貌似是作为默认请求dispatcher，能够重定向request到别的resource或servlet；
- 默认设置了context path（默认为`""`）

> 这个dispatcher应该用不到了，因为加下来给`DispatcherServlet`设置的context path和servlet name都是空字符串，所以一定都能匹配上请求，也就不需要这个`RequestDispatcher`了。

### 创建`WebApplicationContext`
有了`ServletContext`，就可以创建`WebApplicationContext`了，这里用到的是`WebApplicationContext`的mock实现，`StubWebApplicationContext`。创建它需要传入`ServletContext`。

`StubWebApplicationContext`是一种偷懒的实现，除了`getServletContext()`（**wac比`ApplicationContext`多出来的唯一一个方法就是`ServletContext getServletContext()`**），其他方法（`ApplicationContext`接口定义的方法）都delegate到内部包装的一个`StubBeanFactory`处理了。后者基于spring core的`StaticListableBeanFactory`实现，但是很多方法都是空实现。毕竟是测试用的。

### 双向关联`ServletContext`和`WebApplicationContext`
**这里的关联是双向的**：
1. 让`WebApplicationContext`持有`ServletContext`：set `ServletContext`到wac；
2. 让`ServletContext`持有`WebApplicationContext`：`org.springframework.web.context.WebApplicationContext.ROOT` -> `WebApplicationContext`；

第二个关联比较tricky：没办法像第一种方式一样去做关联，即使把wac set到`ServletContext`里，**仅根据`ServletContext`的接口仍然不能把wac get出来。毕竟`ServletContext`在前一层，不可能为SpringMVC提供专门的`getWebApplicationContext()`方法，没提供wac相关的setter/getter。但是servlet还是给基于它的框架提供了一种通用的实现：`ServletContext#setAttribute/getAttribute`**
```java
servletContext.setAttribute(WebApplicationContext.ROOT_WEB_APPLICATION_CONTEXT_ATTRIBUTE, wac);
```
这里用到的key是`org.springframework.web.context.WebApplicationContext.ROOT`。**它是和`ServletContext`关联的root wac**！

> SpringMVC里有非常多的这种关联方式。servlet只能提供这种关联方式了，没办法。

### 填充`WebApplicationContext`
**手动给wac塞一堆mvc所需要的bean**，其实就是塞到wac内部持有的`BeanFactory`里了。

#### 填充controller、controller advice
填充的都是SpringMVC需要的bean：
```java
    		wac.addBeans(this.controllers);
    		wac.addBeans(this.controllerAdvice);

    		FormattingConversionService mvcConversionService = config.mvcConversionService();
    		wac.addBean("mvcConversionService", mvcConversionService);
    		ResourceUrlProvider resourceUrlProvider = config.mvcResourceUrlProvider();
    		wac.addBean("mvcResourceUrlProvider", resourceUrlProvider);
    		ContentNegotiationManager mvcContentNegotiationManager = config.mvcContentNegotiationManager();
    		wac.addBean("mvcContentNegotiationManager", mvcContentNegotiationManager);
    		Validator mvcValidator = config.mvcValidator();
    		wac.addBean("mvcValidator", mvcValidator);
```

#### 填充`@RequestMapping`处理器
```java
    		RequestMappingHandlerAdapter ha = config.requestMappingHandlerAdapter(mvcContentNegotiationManager,
    				mvcConversionService, mvcValidator);
    		if (sc != null) {
    			ha.setServletContext(sc);
    		}
    		ha.setApplicationContext(wac);
    		ha.afterPropertiesSet();
    		wac.addBean("requestMappingHandlerAdapter", ha);

    		wac.addBean("handlerExceptionResolver", config.handlerExceptionResolver(mvcContentNegotiationManager));
```
- `HandlerMapping`的实现是`RequestMappingHandlerMapping`：根据url mapping找到处理请求的handler
- `RequestMappingHandlerAdapter`：处理url mapping对应的请求

`RequestMappingHandlerMapping`是一个`InitializingBean`：
```java
    	/**
    	 * Detects handler methods at initialization.
    	 * @see #initHandlerMethods
    	 */
    	@Override
    	public void afterPropertiesSet() {
    		initHandlerMethods();
    	}
```
bean创建之后会自动调用注册功能，把所有controller的mapping注册到`MappingRegistry`。

> 实际上注册的时候并没有区分是不是controller，而是把所有的bean都遍历一遍，把找到的所有controller都注册好。因为用的是`StandaloneMockMvcBuilder`，所以只注册了一个controller的mapping。

一个`注册好的MappingRegistry`的示例：
- 每个HTTP METHOD + URL是一个registry；
- 还有path lookup，前缀树？
- 还有method lookup，是controller的方法名；

#### 填充`ViewResolver`
```java
    		wac.addBeans(initViewResolvers(wac));
    		wac.addBean(DispatcherServlet.LOCALE_RESOLVER_BEAN_NAME, this.localeResolver);
    		wac.addBean(DispatcherServlet.THEME_RESOLVER_BEAN_NAME, new FixedThemeResolver());
    		wac.addBean(DispatcherServlet.REQUEST_TO_VIEW_NAME_TRANSLATOR_BEAN_NAME, new DefaultRequestToViewNameTranslator());
```
用的是`InternalResourceViewResolver`。

#### 填充session相关bean
```java
    		this.flashMapManager = new SessionFlashMapManager();
    		wac.addBean(DispatcherServlet.FLASH_MAP_MANAGER_BEAN_NAME, this.flashMapManager);
```

#### 填充自定义拓展的bean
```java
    		extendMvcSingletons(sc).forEach(wac::addBean);
```
它是protected方法，且默认实现返回空，摆明是让子类拓展的：
```java
    	protected Map<String, Object> extendMvcSingletons(@Nullable ServletContext servletContext) {
    		return Collections.emptyMap();
    	}
```

## servlet
准备好了`ServletContext`和`WebApplicationContext`，接下来就是要初始化servlet。

### `ServletConfig` - servlet独有的配置，不共享
[`ServletConfig`](https://stackoverflow.com/a/4223685/7676237)是每个servlet独有的一份配置信息。它和`ServletContext`一样，也可以读取自定义的初始化参数：
- `getInitParameter`：**自定义的初始化参数**；

**`ServletConfig`还关联了`ServletContext`（因为共享的配置肯定要被独有的配置获取嘛）**，有获取它的方法：
- `ServletContext getServletContext()`

所以创建`MockServletConfig`的时候，把之前创建的`ServletContext`放了进去。

`ServletConfig` vs. `ServletContext`：
1. **`ServletConfig`的主要作用，就是初始化servlet：在`Servlet#init`的时候从里面读取一些配置信息，过后就基本不用了**；
2. **`ServletContext`则是上下文信息，除了能获取一些公共配置之外，还能当做全局容器通过`getAttribute/setAttribute`放一些东西，起到传参的作用**；

SpringMVC就一个servlet——`DispatcherServlet`，所以创建的`ServletConfig`也仅仅是针对它一个人的config。**config里设置的servlet name是`""`，也就是说`DispatcherServlet`对应的名字是`""`**。即：url里不需要指定servlet的名字了。

### 创建`DispatcherServlet`
`ServletConfig`也准备好了，接下来就要创建SpringMVC里唯一的servlet了——`DispatcherServlet`。这里用到的实现是`TestDispatcherServlet`：它override了`DispatcherServlet`，把`DispatcherServlet`处理后的结果放到了spring test的`MvcResult`里，其他跟DispatcherServlet没啥区别。

**`DispatcherServlet`还要从wac里面取bean初始化自己呢，所以要把wac设置进来**。根据`ServletConfig`初始化`DispatcherServlet`，初始化过后`ServletConfig`就不需要了。

现在能初始化`DispatcherServlet`的材料有哪些？都设置了什么值？
1. `ServletConfig`：
    1. **servlet name设置为空**；
    2. init parameters没有设置；
2. `ServletConfig`内含`ServletContext`：`ServletContext`的名字为"`MockServletContext`"，不过这个名字没啥卵用。
    1. **context path设置为空**；
    2. default servlet name="`default`"；
    3. 通过一个特殊的key在attribute关联了wac：`org.springframework.web.context.WebApplicationContext.ROOT` -> `WebApplicationContext`；
    4. resource base path设置为空；

开始初始化。javadoc的介绍是，**先把servlet里的配置参数放到bean里：Map config parameters onto bean properties of this servlet**, and invoke subclass initialization
```java
    	@Override
    	public final void init() throws ServletException {

    		// Set bean properties from init parameters.
    		PropertyValues pvs = new ServletConfigPropertyValues(getServletConfig(), this.requiredProperties);
    		if (!pvs.isEmpty()) {
    			try {
    				BeanWrapper bw = PropertyAccessorFactory.forBeanPropertyAccess(this);
    				ResourceLoader resourceLoader = new ServletContextResourceLoader(getServletContext());
    				bw.registerCustomEditor(Resource.class, new ResourceEditor(resourceLoader, getEnvironment()));
    				initBeanWrapper(bw);
    				bw.setPropertyValues(pvs, true);
    			}
    			catch (BeansException ex) {
    				if (logger.isErrorEnabled()) {
    					logger.error("Failed to set bean properties on servlet '" + getServletName() + "'", ex);
    				}
    				throw ex;
    			}
    		}

    		// Let subclasses do whatever initialization they like.
    		initServletBean();
    	}
```
它所做的就是先把`ServletConfig`里的init parameter取出来，放到了properties里：
```java
    		public ServletConfigPropertyValues(ServletConfig config, Set<String> requiredProperties)
    				throws ServletException {

    			Set<String> missingProps = (!CollectionUtils.isEmpty(requiredProperties) ?
    					new HashSet<>(requiredProperties) : null);

    			Enumeration<String> paramNames = config.getInitParameterNames();
    			while (paramNames.hasMoreElements()) {
    				String property = paramNames.nextElement();
    				Object value = config.getInitParameter(property);
    				addPropertyValue(new PropertyValue(property, value));
    				if (missingProps != null) {
    					missingProps.remove(property);
    				}
    			}

    			// Fail if we are still missing properties.
    			if (!CollectionUtils.isEmpty(missingProps)) {
    				throw new ServletException(
    						"Initialization from ServletConfig for servlet '" + config.getServletName() +
    						"' failed; the following required properties were missing: " +
    						StringUtils.collectionToDelimitedString(missingProps, ", "));
    			}
    		}
```
**所以在`web.xml`里设置值和在spring配置文件里设置，都一样。**

然后继续init servlet，Javadoc的介绍是，**在bean properties设置完毕后，开始创建wac**：invoked after any bean properties have been set. Creates this servlet's `WebApplicationContext`
```java
    	@Override
    	protected final void initServletBean() throws ServletException {
    		getServletContext().log("Initializing Spring " + getClass().getSimpleName() + " '" + getServletName() + "'");
    		if (logger.isInfoEnabled()) {
    			logger.info("Initializing Servlet '" + getServletName() + "'");
    		}
    		long startTime = System.currentTimeMillis();

    		try {
    			this.webApplicationContext = initWebApplicationContext();
    			initFrameworkServlet();
    		}
    		catch (ServletException | RuntimeException ex) {
    			logger.error("Context initialization failed", ex);
    			throw ex;
    		}

    		if (logger.isDebugEnabled()) {
    			String value = this.enableLoggingRequestDetails ?
    					"shown which may lead to unsafe logging of potentially sensitive data" :
    					"masked to prevent unsafe logging of potentially sensitive data";
    			logger.debug("enableLoggingRequestDetails='" + this.enableLoggingRequestDetails +
    					"': request parameters and headers will be " + value);
    		}

    		if (logger.isInfoEnabled()) {
    			logger.info("Completed initialization in " + (System.currentTimeMillis() - startTime) + " ms");
    		}
    	}
```
**这里又创建了一个wac，不过它是属于`DispatcherServlet`的wac。之前创建的那个wac是和`ServletContext`关联的wac，是root wac。**

> 所以之前用来关联root wac的key是`org.springframework.web.context.WebApplicationContext.ROOT`，尾缀为root。不同wac之间出现了层级关系。
>
> `TestDispatcherServlet`的wac直接设置为了root wac，主要是为了省事儿。可以参考[Spring Web MVC]({% post_url 2022-12-03-spring-web-mvc %}) hierarchy。

对于`DispatcherServlet`来说，它的wac需要init这些东西：
```java
    	protected void initStrategies(ApplicationContext context) {
    		initMultipartResolver(context);
    		initLocaleResolver(context);
    		initThemeResolver(context);
    		initHandlerMappings(context);
    		initHandlerAdapters(context);
    		initHandlerExceptionResolvers(context);
    		initRequestToViewNameTranslator(context);
    		initViewResolvers(context);
    		initFlashMapManager(context);
    	}
```
**从`ApplicationContext`里取出相关组件，设置到`DispatcherServlet`里，比如`ViewResolver`、`HandlerMapping`、`HandlerAdapter`等等。**

**servlet的wac创建好了之后，要把自己的wac也放到ServletContext里！key为`FrameworkServlet.class.getName() + ".CONTEXT." + getServletName()`**。因为`TestDispatcherServlet`的servlet name是空字符串，所以它的key就是`org.springframework.web.servlet.FrameworkServlet.CONTEXT.`。

## 完成MockMvc
`DispatcherServlet`也创建好了，把`DispatcherServlet`、`filter`、`ServletContext`都放在一起，创建出`MockMvc`实例（**`MockMvc`为什么要拿到这些组件？因为没有servlet容器，它自己要调用servlet、filter的执行方法！**）：
```java
    MockMvc mockMvc = new MockMvc(dispatcherServlet, filters);
```
怎么获取`ServletContext`？都有servlet了，自然就有`ServletContext`：
```java
    this.servletContext = servlet.getServletContext();
```
**`Servlet`既能获取`ServletContext`，又能获取`ServletConfig`**
- `ServletContext getServletContext()`
- `ServletConfig getServletConfig()`

最后`MockMvc`会设置这几个东西以方便对结果做出处理：
```java
    		mockMvc.setDefaultRequest(defaultRequestBuilder);
    		mockMvc.setGlobalResultMatchers(globalResultMatchers);
    		mockMvc.setGlobalResultHandlers(globalResultHandlers);
    		mockMvc.setDefaultResponseCharacterEncoding(defaultResponseCharacterEncoding);
```

## 请求
先构造请求，再使用`MockMvc`处理请求。

### 构造请求
构造请求的时候，肯定涉及到url。**使用`UriComponentsBuilder`生成uri的方法不错，学学**：
```java
    	private static URI initUri(String url, Object[] vars) {
    		Assert.notNull(url, "'url' must not be null");
    		Assert.isTrue(url.startsWith("/") || url.startsWith("http://") || url.startsWith("https://"), "" +
    				"'url' should start with a path or be a complete HTTP URL: " + url);
    		return UriComponentsBuilder.fromUriString(url).buildAndExpand(vars).encode().toUri();
    	}
```
**还可以调用urlencode**，太方便了！

**构造请求的时候，会判断请求url是否符合context path，不符合tomcat就处理不了，趁早报错**：
```java
    	private void updatePathRequestProperties(MockHttpServletRequest request, String requestUri) {
    		if (!requestUri.startsWith(this.contextPath)) {
    			throw new IllegalArgumentException(
    					"Request URI [" + requestUri + "] does not start with context path [" + this.contextPath + "]");
    		}
    		request.setContextPath(this.contextPath);
    		request.setServletPath(this.servletPath);

    		if ("".equals(this.pathInfo)) {
    			if (!requestUri.startsWith(this.contextPath + this.servletPath)) {
    				throw new IllegalArgumentException(
    						"Invalid servlet path [" + this.servletPath + "] for request URI [" + requestUri + "]");
    			}
    			String extraPath = requestUri.substring(this.contextPath.length() + this.servletPath.length());
    			this.pathInfo = (StringUtils.hasText(extraPath) ?
    					UrlPathHelper.defaultInstance.decodeRequestString(request, extraPath) : null);
    		}
    		request.setPathInfo(this.pathInfo);
    	}
```
**因为context path设置的是`""`，所以必然符合。同样，还会校验servlet path。然后给url去掉context path，去掉servlet path，剩下的url作为mapping url，交给controller处理。处理之前会做urldecode。**

> 所以模拟的还挺全，先给url encode了，再给它decode了。

### 处理请求 - `perform()`
构建完request之后，开始用`MockMvc`处理请求，得到结果：
```java
    	public ResultActions perform(RequestBuilder requestBuilder) throws Exception {
    		if (this.defaultRequestBuilder != null && requestBuilder instanceof Mergeable) {
    			requestBuilder = (RequestBuilder) ((Mergeable) requestBuilder).merge(this.defaultRequestBuilder);
    		}

    		MockHttpServletRequest request = requestBuilder.buildRequest(this.servletContext);

    		AsyncContext asyncContext = request.getAsyncContext();
    		MockHttpServletResponse mockResponse;
    		HttpServletResponse servletResponse;
    		if (asyncContext != null) {
    			servletResponse = (HttpServletResponse) asyncContext.getResponse();
    			mockResponse = unwrapResponseIfNecessary(servletResponse);
    		}
    		else {
    			mockResponse = new MockHttpServletResponse();
    			servletResponse = mockResponse;
    		}

    		if (this.defaultResponseCharacterEncoding != null) {
    			mockResponse.setDefaultCharacterEncoding(this.defaultResponseCharacterEncoding.name());
    		}

    		if (requestBuilder instanceof SmartRequestBuilder) {
    			request = ((SmartRequestBuilder) requestBuilder).postProcessRequest(request);
    		}

    		MvcResult mvcResult = new DefaultMvcResult(request, mockResponse);
    		request.setAttribute(MVC_RESULT_ATTRIBUTE, mvcResult);

    		RequestAttributes previousAttributes = RequestContextHolder.getRequestAttributes();
    		RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request, servletResponse));

    		MockFilterChain filterChain = new MockFilterChain(this.servlet, this.filters);
    		filterChain.doFilter(request, servletResponse);

    		if (DispatcherType.ASYNC.equals(request.getDispatcherType()) &&
    				asyncContext != null && !request.isAsyncStarted()) {
    			asyncContext.complete();
    		}

    		applyDefaultResultActions(mvcResult);
    		RequestContextHolder.setRequestAttributes(previousAttributes);

    		return new ResultActions() {
    			@Override
    			public ResultActions andExpect(ResultMatcher matcher) throws Exception {
    				matcher.match(mvcResult);
    				return this;
    			}
    			@Override
    			public ResultActions andDo(ResultHandler handler) throws Exception {
    				handler.handle(mvcResult);
    				return this;
    			}
    			@Override
    			public MvcResult andReturn() {
    				return mvcResult;
    			}
    		};
    	}
```
**`MockMvc`为什么能得到结果，它又不是servlet容器？谜底在这两行：**
```java
    		MockFilterChain filterChain = new MockFilterChain(this.servlet, this.filters);
    		filterChain.doFilter(request, servletResponse);
```
**servlet（`DispatcherServlet`）被包装成一个filter，注册到filter chain的最后！然后执行这个filter chain的时候就执行了servlet的逻辑！所以`MockMvc`是在一个线程里调用了servlet的逻辑！！！单线程执行！！！**

> Registered filters are invoked through the `MockFilterChain` from spring-test, **and the last filter delegates to the `DispatcherServlet`**.

```java
    	public MockFilterChain(Servlet servlet, Filter... filters) {
    		Assert.notNull(filters, "filters cannot be null");
    		Assert.noNullElements(filters, "filters cannot contain null values");
    		this.filters = initFilterList(servlet, filters);
    	}
    	
    	private static List<Filter> initFilterList(Servlet servlet, Filter... filters) {
    		Filter[] allFilters = ObjectUtils.addObjectToArray(filters, new ServletFilterProxy(servlet));
    		return Arrays.asList(allFilters);
    	}
```
这个被包装成的filter就是个servlet的wrapper，包装的方式也很直白，就是**把`Servlet#service`的逻辑放到了`Filter#doFilter`里**：
```java
    	/**
    	 * A filter that simply delegates to a Servlet.
    	 */
    	private static final class ServletFilterProxy implements Filter {

    		private final Servlet delegateServlet;

    		private ServletFilterProxy(Servlet servlet) {
    			Assert.notNull(servlet, "servlet cannot be null");
    			this.delegateServlet = servlet;
    		}

    		@Override
    		public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
    				throws IOException, ServletException {

    			this.delegateServlet.service(request, response);
    		}

    		@Override
    		public void init(FilterConfig filterConfig) throws ServletException {
    		}

    		@Override
    		public void destroy() {
    		}

    		@Override
    		public String toString() {
    			return this.delegateServlet.toString();
    		}
    	}
```
从代码来看，整个filter只执行了第一个，而不是foreach遍历，为什么？
```java
    	@Override
    	public void doFilter(ServletRequest request, ServletResponse response) throws IOException, ServletException {
    		Assert.notNull(request, "Request must not be null");
    		Assert.notNull(response, "Response must not be null");
    		Assert.state(this.request == null, "This FilterChain has already been called!");

    		if (this.iterator == null) {
    			this.iterator = this.filters.iterator();
    		}

    		if (this.iterator.hasNext()) {
    			Filter nextFilter = this.iterator.next();
    			nextFilter.doFilter(request, response, this);
    		}

    		this.request = request;
    		this.response = response;
    	}
```
因为每一个filter处理逻辑的最后都要有`filterChain.doFilter(servletRequest, servletResponse)`这么一句话：
```java
        @Override
        public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain filterChain) throws IOException, ServletException {
            var httpServletResponse = (HttpServletResponse) servletResponse;
            httpServletResponse.setHeader("X-SUPERHERO-APP", "super-header");
            filterChain.doFilter(servletRequest, servletResponse);
        }
```
**上一个filter执行完后，如果请求符合条件，当前filter会主动触发filter chian的下一个filter，让请求继续执行下去。**

> 如果不调用下一个filter，就起到了阻止请求处理的作用，请求就返回了（不调用filter，也不会调用最后的servlet，请求就相当于提前结束了！）。比如spring security，就是通过这个阻止那些验证不通过的请求的！
>
> Either invoke the next entity in the chain using the FilterChain object (chain.doFilter()), or not pass on the request/response pair to the next entity in the filter chain **to block the request processing**

#### `DispatcherServlet`处理请求
`DispatcherServlet`处理请求的关键在于根据url mapping找到处理它的方法：
```java
    	@Override
    	@Nullable
    	protected HandlerMethod getHandlerInternal(HttpServletRequest request) throws Exception {
    		String lookupPath = initLookupPath(request);
    		this.mappingRegistry.acquireReadLock();
    		try {
    			HandlerMethod handlerMethod = lookupHandlerMethod(lookupPath, request);
    			return (handlerMethod != null ? handlerMethod.createWithResolvedBean() : null);
    		}
    		finally {
    			this.mappingRegistry.releaseReadLock();
    		}
    	}
```

> registry还有读写锁。查的时候先获取read lock。

找到匹配的方法之后（这个方法就是handler啊！！！），就去设置handler execution chain了（其实就是加上`HandlerInterceptor`）

后面的流程就不说了，都在[SpringMVC：HTTP请求处理全流程]({% post_url 2022-03-28-springmvc %})里了。

## 结果处理
结果处理可以直接`andExpect()`，也可以通过`andReturn()`获取`MvcResult`，或者更进一步`andReturn().getResponse()`，获取`HttpServletResponse`。

## tomcat在哪儿？
没有tomcat！**`MockMvc`的整个流程的重点其实就是构造出`DispatcherServlet`，之后手动运行`Servlet#service`获取结果**：
1. **构造`DispatcherServlet`**
    1. 构造`ServletContext`
	1. 构造root `WebApplicationContext`，填充mvc相关的bean
	1. 构造`ServletConfig`，创建`DispatcherServlet`，初始化servlet
1. 获取请求
1. **手动执行filter、`DispatcherServlet#service`**
1. 获取结果为`MvcResult`

servlet处理后的结果还被`TestDispatcherServlet`移花接木到了`MvcResult`上。所以整个流程里并不需要tomcat。

`MockMvc`为了绕过tomcat，煞费苦心了。

# 感想
`MockMvc`是测试SpringMVC的mvc层的重要手段，是spring test出的专门测web layer的非常方便的工具！大好评！

无心插柳柳成荫，本来是研究springboot test的，没想到通过spring test的MockMvc，更加深刻地理解了SpringMVC :D

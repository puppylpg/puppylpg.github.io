---
layout: post
title: "Spring - Async"
date: 2023-07-04 23:44:05 +0800
categories: spring proxy
tags: spring proxy
---

使用spring AOP [`@Async`](https://docs.spring.io/spring-framework/reference/integration/scheduling.html#scheduling-annotation-support-async)来实现异步，看起来会更优雅一些，因为使用`ExecutorService#submit(callable)`做任务的提交比较模板化，使用spring aop可以直接隐藏这些细节。另外如果需要使用回调函数异步处理异常（线程池线程），也会比较方便。

1. Table of Contents, ordered
{:toc}

# 职责划分
要使用spring的异步，主要是分清职责：
1. 正常的任务提交：
    1. 程序猿：写任务执行逻辑（callable）；
    2. executor：执行任务，返回`Futhre`，并set结果/异常到`Futhre`。如果返回的是`ListenableFuture`，还能在set结果的时候通过`done()`方法（`FutureTask`的protected方法）调用它的callback；
2. spring async：
    1. 程序猿：写任务执行逻辑，不过不再把任务写成一个形式上的callable，而是直接写一个普通函数，返回void或者`Future`；
    2. spring：要做原来流程里的程序猿，所以它现在是executor的使用者，要帮程序猿完成submit task这个动作。所以spring要先写自己的callable，callable里直接调用程序猿提供的函数，然后把它submit到executor：
        1. spring的callable是直接调用程序猿的函数；
        2. submit之后会返回一个`Future`。**如果程序猿本身的函数就返回一个`Future`，那么spring就要在自己的callable里把`Future`拆开，取出其值，不然自己的callable就返回`Future<Future<?>>`了**；

# 代码分析
## 程序猿的逻辑
程序猿的任务（不再写成callable的形式，而是一个返回`ListenableFuture`的函数）：
```java
@Slf4j
@Service
public class AsyncService {

    @Async("default-executor")
    public ListenableFuture<String> service(int i) {
        try {
            Thread.sleep(1000);
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        }

        if (i == 3) {
            throw new RuntimeException("what about now?");
        }

        if (i % 2 == 0) {
            ListenableFuture<String> result = AsyncResult.forValue(String.valueOf(i));
            log.info(i + " future instance is: " + result);
            return result;
        } else {
            ListenableFuture<String> result = AsyncResult.forExecutionException(new RuntimeException("exception for: " + i));
            log.info(i + " future instance is: " + result);
            return result;
        }
    }
}
```

异步回调：
```java
@Slf4j
public class Listener implements ListenableFutureCallback<String> {

    @Override
    public void onFailure(Throwable ex) {
        if ("what about now?".equals(ex.getMessage())) {
            log.warn("onFailure: this is not expected", ex);
        } else {
            log.info("onFailure: fail", ex);
        }
    }

    @Override
    public void onSuccess(String result) {
        log.info("onSuccess: {}", result);
    }
}
```

主线程进行任务结果获取，并添加callback：
```java
    Listener listener = new Listener();

    List<ListenableFuture<String>> l = new ArrayList<>();
    IntStream.range(1, 5).boxed().forEach(
            i -> {
                ListenableFuture<String> future = asyncService.service(i);
                future.addCallback(listener);
                l.add(future);
            }
    );
```

## spring aop的逻辑

`AsyncExecutionInterceptor#invoke`里，spring对程序猿的函数的代理操作：生成callable，submit到executor
```java
	/**
	 * Intercept the given method invocation, submit the actual calling of the method to
	 * the correct task executor and return immediately to the caller.
	 * @param invocation the method to intercept and make asynchronous
	 * @return {@link Future} if the original method returns {@code Future}; {@code null}
	 * otherwise.
	 */
	@Override
	@Nullable
	public Object invoke(final MethodInvocation invocation) throws Throwable {
		Class<?> targetClass = (invocation.getThis() != null ? AopUtils.getTargetClass(invocation.getThis()) : null);
		Method specificMethod = ClassUtils.getMostSpecificMethod(invocation.getMethod(), targetClass);
		final Method userDeclaredMethod = BridgeMethodResolver.findBridgedMethod(specificMethod);

		AsyncTaskExecutor executor = determineAsyncExecutor(userDeclaredMethod);
		if (executor == null) {
			throw new IllegalStateException(
					"No executor specified and no default executor set on AsyncExecutionInterceptor either");
		}

		Callable<Object> task = () -> {
			try {
				Object result = invocation.proceed();
				if (result instanceof Future) {
					return ((Future<?>) result).get();
				}
			}
			catch (ExecutionException ex) {
				handleError(ex.getCause(), userDeclaredMethod, invocation.getArguments());
			}
			catch (Throwable ex) {
				handleError(ex, userDeclaredMethod, invocation.getArguments());
			}
			return null;
		};

		return doSubmit(task, executor, invocation.getMethod().getReturnType());
	}
```
可以很明显的看到对程序猿函数的执行、拆`Future`的动作。（最后再封装为`Future`是executor的事儿）

callable的提交方式，就是提交给线程池执行。当然根据具体future类型，选择了不同的线程池提交方式：
```java
	protected Object doSubmit(Callable<Object> task, AsyncTaskExecutor executor, Class<?> returnType) {
		if (CompletableFuture.class.isAssignableFrom(returnType)) {
			return CompletableFuture.supplyAsync(() -> {
				try {
					return task.call();
				}
				catch (Throwable ex) {
					throw new CompletionException(ex);
				}
			}, executor);
		}
		else if (ListenableFuture.class.isAssignableFrom(returnType)) {
			return ((AsyncListenableTaskExecutor) executor).submitListenable(task);
		}
		else if (Future.class.isAssignableFrom(returnType)) {
			return executor.submit(task);
		}
		else {
			executor.submit(task);
			return null;
		}
	}
```
1. 如果返回jdk的CompletableFuture，就用jdk的CompletableFuture提交任务；
2. 如果返回spring的ListenableFuture，就用spring的ListenableFuture提交任务；
3. 否则就用jdk的Executor直接submit；
4. 如果返回值不是以上三种，就默认没有返回值（当做一个runnable），直接执行并返回null；

## 输出结果
最后看一眼上面程序的完整输出：
```
2023-07-04 11:28:22.576 [main] INFO  io.puppylpg.AsyncApp 41 - [org.springframework.util.concurrent.ListenableFutureTask@264c5d07[Not completed, task = org.springframework.aop.interceptor.AsyncExecutionInterceptor$$Lambda$448/0x0000000801288f58@2b9b7f1f], org.springframework.util.concurrent.ListenableFutureTask@69cac930[Not completed, task = org.springframework.aop.interceptor.AsyncExecutionInterceptor$$Lambda$448/0x0000000801288f58@847f3e7], org.springframework.util.concurrent.ListenableFutureTask@5d39f2d8[Not completed, task = org.springframework.aop.interceptor.AsyncExecutionInterceptor$$Lambda$448/0x0000000801288f58@19593091], org.springframework.util.concurrent.ListenableFutureTask@55ea2d70[Not completed, task = org.springframework.aop.interceptor.AsyncExecutionInterceptor$$Lambda$448/0x0000000801288f58@6ad6fa53]]
2023-07-04 11:28:23.584 [worker-thread-2] INFO  io.puppylpg.AsyncService 30 - 2 future instance is: org.springframework.scheduling.annotation.AsyncResult@456e7b2d
2023-07-04 11:28:23.584 [worker-thread-2] INFO  io.puppylpg.Listener 23 - onSuccess: 2
2023-07-04 11:28:23.584 [worker-thread-1] INFO  io.puppylpg.AsyncService 34 - 1 future instance is: org.springframework.scheduling.annotation.AsyncResult@1476ca7b
2023-07-04 11:28:23.586 [worker-thread-1] INFO  io.puppylpg.Listener 17 - onFailure: fail
java.lang.RuntimeException: exception for: 1
	at io.puppylpg.AsyncService.service(AsyncService.java:33)
	at io.puppylpg.AsyncService$$FastClassBySpringCGLIB$$6c8c24f0.invoke(<generated>)
	at org.springframework.cglib.proxy.MethodProxy.invoke(MethodProxy.java:218)
	at org.springframework.aop.framework.CglibAopProxy$CglibMethodInvocation.invokeJoinpoint(CglibAopProxy.java:793)
	at org.springframework.aop.framework.ReflectiveMethodInvocation.proceed(ReflectiveMethodInvocation.java:163)
	at org.springframework.aop.framework.CglibAopProxy$CglibMethodInvocation.proceed(CglibAopProxy.java:763)
	at org.springframework.aop.interceptor.AsyncExecutionInterceptor.lambda$invoke$0(AsyncExecutionInterceptor.java:115)
	at java.base/java.util.concurrent.FutureTask.run(FutureTask.java:264)
	at java.base/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1136)
	at java.base/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:635)
	at java.base/java.lang.Thread.run(Thread.java:833)
2023-07-04 11:28:24.585 [worker-thread-2] WARN  io.puppylpg.Listener 15 - onFailure: this is not expected
java.lang.RuntimeException: what about now?
	at io.puppylpg.AsyncService.service(AsyncService.java:25)
	at io.puppylpg.AsyncService$$FastClassBySpringCGLIB$$6c8c24f0.invoke(<generated>)
	at org.springframework.cglib.proxy.MethodProxy.invoke(MethodProxy.java:218)
	at org.springframework.aop.framework.CglibAopProxy$CglibMethodInvocation.invokeJoinpoint(CglibAopProxy.java:793)
	at org.springframework.aop.framework.ReflectiveMethodInvocation.proceed(ReflectiveMethodInvocation.java:163)
	at org.springframework.aop.framework.CglibAopProxy$CglibMethodInvocation.proceed(CglibAopProxy.java:763)
	at org.springframework.aop.interceptor.AsyncExecutionInterceptor.lambda$invoke$0(AsyncExecutionInterceptor.java:115)
	at java.base/java.util.concurrent.FutureTask.run(FutureTask.java:264)
	at java.base/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1136)
	at java.base/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:635)
	at java.base/java.lang.Thread.run(Thread.java:833)
2023-07-04 11:28:24.587 [worker-thread-1] INFO  io.puppylpg.AsyncService 30 - 4 future instance is: org.springframework.scheduling.annotation.AsyncResult@28e0768d
2023-07-04 11:28:24.588 [worker-thread-1] INFO  io.puppylpg.Listener 23 - onSuccess: 4

Process finished with exit code 0
```
- 代理future对象是`org.springframework.util.concurrent.ListenableFutureTask`；
    - 它的task为`org.springframework.aop.interceptor.AsyncExecutionInterceptor$$Lambda$448/0x0000000801288f58`，也就是上述`AsyncExecutionInterceptor#invoke`处的代码；
- 程序猿生成的future对象是`org.springframework.scheduling.annotation.AsyncResult`；
- 从打印出来的线程也可以看到调用程序猿的函数的和调用callback的都是executor（所以都是异步的）

# 代理对象
显然，**spring aop生成了原本程序猿所构建的`Future`对象的代理对象，作为最终函数的返回**。

> 这个`ListenableFuture`对象的实际类型为spring AOP所构建的`ListenableFutureTask`，而非程序猿自己写的`AsyncResult`。

**那么回调函数注册在哪个`Future`上面**？

显然，**callback注册在spring生成的代理`Future`上面，并非程序猿自己构造的`Future`**。因为submit之后，立刻返回的就是spring aop的`Future`。只不过程序猿的函数被wrap到spring的callable里了，所以后来实际执行的时候，“看起来”似乎调用的是程序猿的任务。

> spring `@Async`并非没改变被代理对象的功能，它所改变的功能点是“把同步调用修改为异步调用”，但并没有改变任务本身的功能。

回调注册好后，回调的触发就又是之前的老知识了：executor在给future set值的时候，在`done()`里根据它到底是值还是异常，决定调用哪个callback。

# 异常处理
从spring aop的代理代码中也可以看到[异常处理](https://docs.spring.io/spring-framework/docs/current/reference/html/integration.html#scheduling-annotation-support-exception)。这里也分几种情况：
1. 如果程序猿的callable返回的是`Future`：
    1. 手动构建`Future`（`AsyncResult.forValue(String.valueOf(i))`或者`AsyncResult.forExecutionException(new RuntimeException("exception for: " + i))`）并不会触发异常（确实没触发，只是new了一个对象而已）。spring的AOP在拆`Future`的时候（`Future#get`）会触发异常（会throw出异常），此时spring啥都不做即可，因为异常会自动被executor捕获，set到最终返回的`Future`里；
    2. 如果执行程序猿逻辑的时候出了异常，同上，也是什么都不用做，最终会被set到返回的`Future`里，由client接收；
1. 如果callable返回的是void：
    1. 因为原函数返回void，所以代理函数也只能返回void，此时没法通过`Future`把异常返回给client；

因此看spring此时的异常处理逻辑：
```java
	/**
	 * Handles a fatal error thrown while asynchronously invoking the specified
	 * {@link Method}.
	 * <p>If the return type of the method is a {@link Future} object, the original
	 * exception can be propagated by just throwing it at the higher level. However,
	 * for all other cases, the exception will not be transmitted back to the client.
	 * In that later case, the current {@link AsyncUncaughtExceptionHandler} will be
	 * used to manage such exception.
	 * @param ex the exception to handle
	 * @param method the method that was invoked
	 * @param params the parameters used to invoke the method
	 */
	protected void handleError(Throwable ex, Method method, Object... params) throws Exception {
		if (Future.class.isAssignableFrom(method.getReturnType())) {
			ReflectionUtils.rethrowException(ex);
		}
		else {
			// Could not transmit the exception to the caller with default executor
			try {
				this.exceptionHandler.obtain().handleUncaughtException(ex, method, params);
			}
			catch (Throwable ex2) {
				logger.warn("Exception handler for async method '" + method.toGenericString() +
						"' threw unexpected exception itself", ex2);
			}
		}
	}
```
是这么说的：
1. 啥都不干即可，原本来自程序猿函数里`Future`的异常会自动被executor捕获，封装到最终的代理`Future`里，相当于异常传递了：Handles a fatal error thrown while asynchronously invoking the specified Method. If the return type of the method is a Future object, the original exception can be propagated by just throwing it at the higher level. 
1. 如果程序猿的函数不返回future，却抛异常了，因为异常也不可能被传回到client端，**根据[线程池异常处理]({% post_url 2021-11-28-java-executor-exception %})可知，异常就“被吞了”（set到`Future`，但无人接收）**。但是，虽然不能把异常传回client，spring AOP依然能帮你处理异常，只需要设置`AsyncUncaughtExceptionHandler`就行了。（如果处理的过程中又出了异常，spring AOP弱弱帮你打个warn拉倒）：However, for all other cases, the exception will not be transmitted back to the client. In that later case, the current `AsyncUncaughtExceptionHandler` will be used to manage such exception.

因此，在哪里处理异常/值（使用回调函数还是`Future#get`），全看自己的打算：
1. 异步处理：用callback（onFailure是处理异常，onSuccess是处理值）；
2. 同步处理：在最终返回future后（实际是代理future），手动调用get触发异常/处理值；

# 返回void
如果程序猿任务代码返回void呢？**返回void最大的问题是没法使用callback了**！因为返回void，不再返回future，spring AOP也无法生成future的代理对象，也就没法在上面添加callback。

> 从代码编译的角度看更直观——程序员的函数不返回`ListenableFuture`，也就没法`ListenableFuture#addCallback`。**因此，放置代理对象和原始对象的代码框架的确是一模一样的，代理只把同步行为改成了异步行为，但依然兼容之前未代理对象的代码**！因此牢记：代理是增强后的对象。代理便很好理解。
>
> 由此也可以回答另一个问题——为什么spring不让我们写的异步方法直接返回`T`呢，这样就不用手动拆开future再让线程池包裹为future了？或者spring也可以给`@Async`增加一些配置，让我们手动指定期望返回哪种future。
>
> 因为这样的话我们的代码就编译不过去了……一个返回`T`的方法如何注册callback？还得返回`ListenableFuture`才能注册callback。所以**spring可以用代理改变你的行为，但是不能改变你的返回值啊（`T` -> `Future<T>`）**。

此时如果任务流程有未catch异常，spring AOP会用自己的`AsyncUncaughtExceptionHandler`处理异常。spring有一个默认的实现，`SimpleAsyncUncaughtExceptionHandler`，它会简简单单打个error：
```
2023-07-04 11:38:25.999 [worker-thread-2] ERROR org.springframework.aop.interceptor.SimpleAsyncUncaughtExceptionHandler 39 - Unexpected exception occurred invoking async method: public void io.puppylpg.AsyncService.service(int)
java.lang.RuntimeException: what about now?
	at io.puppylpg.AsyncService.service(AsyncService.java:25)
	at io.puppylpg.AsyncService$$FastClassBySpringCGLIB$$6c8c24f0.invoke(<generated>)
	at org.springframework.cglib.proxy.MethodProxy.invoke(MethodProxy.java:218)
	at org.springframework.aop.framework.CglibAopProxy$CglibMethodInvocation.invokeJoinpoint(CglibAopProxy.java:793)
	at org.springframework.aop.framework.ReflectiveMethodInvocation.proceed(ReflectiveMethodInvocation.java:163)
	at org.springframework.aop.framework.CglibAopProxy$CglibMethodInvocation.proceed(CglibAopProxy.java:763)
	at org.springframework.aop.interceptor.AsyncExecutionInterceptor.lambda$invoke$0(AsyncExecutionInterceptor.java:115)
	at java.base/java.util.concurrent.FutureTask.run(FutureTask.java:264)
	at java.base/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1136)
	at java.base/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:635)
	at java.base/java.lang.Thread.run(Thread.java:833)
```

# 总结
之前的代理（[Java反射与动态代理]({% post_url 2020-08-02-java-reflection-dynamic-proxy %})，[Spring - AOP]({% post_url 2021-11-22-spring-aop %})），代理的都是一个“小”功能。`@Async`的代理比较独特，把同步执行的对象代理为了异步执行的对象，看完之后代理似乎变得更通透了。



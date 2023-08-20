---
layout: post
title: "Servlet - NIO & Async"
date: 2021-03-24 01:34:06 +0800
categories: NIO servlet
tags: NIO servlet
---

servlet在“前”端基于jdk NIO实现了servlet nio，解绑了long connection与thread。同时在“后”端使用async servlet，解绑了long request与thread。二者都使得thread得到了解放，更适合高并发场景。

1. Table of Contents, ordered
{:toc}

# NIO servlet
在[Java NIO]({% post_url 2020-10-29-java-nio %})中，比较详细地介绍了NIO。由于线程等待从socket读取数据：
- 可能是client发数据发的比较慢；
- 可能是keep-alive导致client断开后server不自知，还在等connection上的新请求，直到timeout；

以上种种导致一个线程必须和一个connection绑定。NIO则使用一个看门人：selector，使用一个selector替n个thread监视n个connection，从而**以一个selector的代价解放了n个thread**。将thread和connection解耦，**模型从thread per connection变成了thread per request**。

在servlet 3.1标准里，添加了使用NIO读写servlet request/response的API。

servlet开发者需要关注的是`ServletInputStream`里的方法：
- `setReadListener(ReadListener rl)`：很明显这是一个回调，当socket可读时，servlet容器会调用开发者设置的`ReadListener`去读数据；

同理，`ServletOutputStream`需要关注的是`setWriterListener(WriteListener wl)`。

看一个例子：
```
@WebServlet(urlPatterns={"/asyncioservlet"}, asyncSupported=true)
public class AsyncIOServlet extends HttpServlet {
   @Override
   public void doPost(HttpServletRequest request, 
                      HttpServletResponse response)
                      throws IOException {
      final AsyncContext acontext = request.startAsync();
      final ServletInputStream input = request.getInputStream();
      
      input.setReadListener(new ReadListener() {
         byte buffer[] = new byte[4*1024];
         StringBuilder sb = new StringBuilder();
         @Override
         public void onDataAvailable() {
            // 在这里从request读数据到sb
         }
         
         @Override
         public void onAllDataRead() {
            // 在这里写数据到response
            try {
               acontext.getResponse().getWriter()
                                     .write("...the response...");
            } catch (IOException ex) { ... }
            acontext.complete();
         }
         @Override
         public void onError(Throwable t) { ... }
      });
   }
}
```

nio的细节在哪里？servlet容器负责实现了，servlet开发者可以不关注。如果深入研究，其实就是**servlet容器使用[Java NIO]({% post_url 2020-10-29-java-nio %})介绍的jdk的Selector/ServletSocketChannel/SocketChannel实现了nio的流程，servlet开发者只需要告诉servlet容器socket读到那儿（ReadListener）、写什么（WriteListener）就够了**。

拿tomcat这一servlet容器实现举例，查看它新的nio连接coyote的两个实现类`NioSelectorPool`和`NioBlockingSelector`，可以看到它是使用jdk提供的Selector作为自己的selector实现的：
```
    protected Selector getSharedSelector() throws IOException {
        if (shared && sharedSelector == null) {
            synchronized (NioSelectorPool.class) {
                if (sharedSelector == null) {
                    sharedSelector = Selector.open();
                }
            }
        }
        return  sharedSelector;
    }
```
使用servlet 3.1标准提供的`javax.servlet.ServletInputStream`和`javax.servlet.ServletOutputStream`里做NIO读写，对servlet开发者来讲相当简单。

（~~大哭，再也不用考虑单撸NIO实现了~~）

参阅：
- https://docs.oracle.com/javaee/7/tutorial/servlets013.htm

# Async servlet
- server读socket这一端：NIO在server读socket的时候，用一个selector干了n个thread监听connection的活儿，省了thread；
- server处理任务这一端：异步servlet则是从另一端省了thread——将长任务异步去做，解放servlet容器工作线程。

异步servlet的关键api是：
```
AsyncContext acontext = req.startAsync();
```
从请求获取`AsyncContext`。然后它的`start(Runnable run)`方法让一个新线程异步执行长任务，本工作线程直接返回。

也就是说，异步servlet是让工作线程在处理一个比较长的任务，比如读db、请求其他服务的时候，将任务解耦出来，异步去做，从而可以让工作线程直接解放。但是直观地想，把一件阻塞的活儿从一个线程交给另一个线程，似乎没什么意义，毕竟工作负担还是那么多，只不过干活的人换了一个，反而更麻烦了不是吗？



比如下面的例子：
```
@WebServlet(urlPatterns={"/asyncservlet"}, asyncSupported=true)
public class AsyncServlet extends HttpServlet {
   /* ... Same variables and init method as in SyncServlet ... */

   @Override
   public void doGet(HttpServletRequest request, 
                     HttpServletResponse response) {
      response.setContentType("text/html;charset=UTF-8");
      final AsyncContext acontext = request.startAsync();
      acontext.start(new Runnable() {
         public void run() {
            String param = acontext.getRequest().getParameter("param");
            String result = resource.process(param);
            HttpServletResponse response = acontext.getResponse();
            /* ... print to the response ... */
            acontext.complete();
   }
}
```
其实，上面的场景并不适合异步servlet，异步servlet主要用于server push的场景。

参阅：
- https://docs.oracle.com/javaee/7/tutorial/servlets012.htm

## server push：长request绑定thread
分析一下servlet容器的发展：
- https://www.infoworld.com/article/2077995/java-concurrency-asynchronous-processing-support-in-servlet-3-0.html
- https://www.infoworld.com/article/2077995/java-concurrency-asynchronous-processing-support-in-servlet-3-0.html?page=2

**server push**：server直接推送，比如看文字直播。十年前，文字直播是3s一刷新，就是典型的客户端不断请求，服务端不断返回新网页，显然消息有延迟，同时很费流量。现在基本都是server push场景，主播输入新的内容时，server会给所有的client推送过来一条消息，没有定时刷新所存在的延迟，而且很省流量。

server push本质上用的还是http，所以本质上还是client先请求，server再响应（server再怎么着也不可能主动找client建立连接）。但是server push场景下，client请求server建立完连接后，所有client的连接一直不断开，当有消息的时候，server给所有的client写回socket，将消息发给client，一直这么重复下去，直到client主动离开（或者也可能server直播结束，最终断开连接）。

这就是long polling，或者service streaming。

如果还用之前的servlet容器架构，无论thread per connection还是thread per request，实现这种功能都会导致server压力过大。因为**一个request一直不结束，至少绑定着一个线程**。一旦request并发量上来了，server负担不起这么多线程，就垮了。

想想nio怎么实现thread和connection的解耦的：通过一个selector，某个connection有request到来时，通知thread来处理，这样thread就不用绑定connection，和connection一直耗着了。本质上来讲，是把所有等待connection上请求的thread的活儿，都交给了selector。忙一个selector，却解放了一堆thread，血赚。

异步就可以在server push的场景下，解放一堆http thread，交给一个worker thread来做：
1. http thread通过异步，**将活儿交给一个工作线程。其实是将request和response，或者说servlet context放入queue，不管了。由一个工作线程来处理queue**；
2. 工作线程等待某个事件发生（比如产生了新的文字直播消息）；
3. 当有新事件发生了（比如新的文字直播消息），就取出queue里的每一个servlet context，往每一个response里写入消息。如果客户端特别多，servlet context也会特别多，可以考虑用多个工作线程来并发处理queue。如果处理每一个servlet context的时间比较长，只有一个工作线程顺次处理所有的context也会比较慢，也要用多个工作线程并发处理，或者再搞个线程池并发处理。

这样一来，相当于一堆http thread把自己监听消息写回socket的活，都交给了一个工作线程去做。解放一堆http thread，忙一个工作线程就够了。

所以在客户端连上服务器之后，如果没有消息需要通知，既不耗http线程，也不耗工作线程池线程，只耗一个等待从BlockingQueue里取消息的工作线程。

> **一个人的活交给另一个人没意义，并没有多解放一个人；一堆人的活交给一个人，就有意义了，解放了n-1个人。**

所以在server push的场景讨论servlet的异步才是有意义的。

**一开始oracle的那个例子显然就是一个线程的活交给另一个线程，并不能体现异步处理的意义，这种例子语法确实正确，但实际上非常误导人！**

> **就好像NIO的例子，为了演示它的语法，官方用while去读消息……这只会让人觉得NIO就是个傻逼，还不如BIO！再比如listener，总是举一些打印信息的例子，总让人觉得listener没啥卵用。但实际上，listener是一种回调，起到了“插件”的作用，插件能提供非常丰富的拓展功能！**

**这个阻塞，它可能是活干的时间太久（计算时间长、sleep等），用异步没意义，也可能是活暂时没有，需要等，这个时候用异步推送就很合适，让一个工作线程等就够了。**

```
@WebServlet(name="myServlet", urlPatterns={"/auctionservice"}, asyncSupported=true)
public class MyServlet extends HttpServlet {
   
   // track bid prices
   public void doGet(HttpServletRequest request, HttpServletResponse response) {
      AsyncContext aCtx = request.startAsync(request, response); 
      // This could be a cluser-wide cache.
      ServletContext appScope = request.getServletContext();    
      Map<String, List<AsyncContext>> aucWatchers = (Map<String, List<AsyncContext>>)appScope.getAttribute("aucWatchers");
      List<AsyncContext> watchers = (List<AsyncContext>)aucWatchers.get(request.getParameter("auctionId"));
      watchers.add(aCtx); // register a watcher
   }

   // place a bid
   public void doPost(HttpServletRequest request, HttpServletResponse response) {
      // run in a transactional context 
      // save a new bid
      AsyncContext aCtx = request.startAsync(request, response); 
      ServletContext appScope = request.getServletContext(); 
      Queue<Bid> aucBids = (Queue<Bid>)appScope.getAttribute("aucBids");
      aucBids.add((Bid)request.getAttribute("bid"));  // a new bid event is placed queued.  
   }
}

@WebServletContextListener
public class BidPushService implements ServletContextListener{

   public void contextInitialized(ServletContextEvent sce) {   
      Map<String, List<AsyncContext>> aucWatchers = new HashMap<String, List<AsyncContext>>();
      sce.getServletContext().setAttribute("aucWatchers", aucWatchers);
      // store new bids not published yet
      Queue<Bid> aucBids = new ConcurrentLinkedQueue<Bid>();
      sce.getServletContext().setAttribute("aucBids", aucBids);
        
      Executor bidExecutor = Executors.newCachedThreadPool(); 
      final Executor watcherExecutor = Executors.newCachedThreadPool();
      while(true)
      {        
         if(!aucBids.isEmpty()) // There are unpublished new bid events.
         {
            final Bid bid = aucBids.poll();
            bidExecutor.execute(new Runnable(){
               public void run() {
                  List<AsyncContext> watchers = aucWatchers.get(bid.getAuctionId()); 
                  for(final AsyncContext aCtx : watchers)
                  {
                     watcherExecutor.execute(new Runnable(){
                        public void run() {
                           // publish a new bid event to a watcher
                           aCtx.getResponse().getWriter().print("A new bid on the item was placed. The current price ..., next bid price is ...");
                        };
                     });
                  }                           
               }
            });
         }
      }
   }
    
   public void contextDestroyed(ServletContextEvent sce) {
   }
}
```
1. http thread把context扔到BlockingQueue里；
2. worker thread监听事件BlockingQueue，有消息就拿出来，依次给到context所在的BlockingQueue，写入每一个response；

**BidPushService，一个独立的listener线程，充当了从BlockingQueue等消息的那个工作线程。**

因为发一条消息特别快，所以这里给watcher发消息的时候，一个线程顺次发就行，没必要再搞一个线程池watcherExecutor并发执行。



这个例子是自己通过BlockingQueue搞异步线程协同（http线程和工作线程），然后从AsyncContext里取出response（aContext.getResponse），接下来是用线程池并发处理response，或者单线程串行处理response，都行。感觉只用到了AsyncContext这个东西。

oracle的例子是直接使用AsyncContext的start方法，start方法会自动用线程池异步处理任务。但是这种做法看起来不适合server push的场景。


**server push说白了就是超长时间的连接，又不是一直都有活要干。等活的过程就可以交给一个工作线程去干。（听起来像极了nio：超长connection，又不是一直有request，等request的过程可以交给一个selector去干……）**

- https://stackoverflow.com/a/10933726/7676237

周末代码实现一下，感觉可以直接搞个controller，使用httprequest获取AsyncContext即可。就像这里的spring boot例子一样：https://zhuanlan.zhihu.com/p/126495745

~~那么问题来了，spring的controller到底怎么和servlet联系起来的……~~ (2022年11月26日15:20:17)

# 总结
- bio：长连接，一个连接绑定一个thread；
- nio：一个请求绑定一个thread。**将长连接和thread解绑**，长连接上请求与请求的间隙，thread就闲出来了；
- async servlet：在server push的场景下，**将长请求和thread解绑**，thread又闲出来了；

**不同的理念，可能要意味着架构的变更。要不然新理念用在老架构上，并没有什么卵用，往往还会让人费解**：
- 在bio场景下用nio的读写api，会感觉很蛋疼——read一次socket，就算数据还没到，也直接返回了……还得不停循环读socket。所以只能nio用啊，nio有socket可读的通知机制；
- 在非server push场景下用async servlet，会感觉很蛋疼——这个异步并没起到什么作用。所以只能server push的时候用，async servlet可以将长request和thread解绑。


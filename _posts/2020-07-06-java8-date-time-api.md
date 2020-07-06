---
layout: post
title: "Java8 Date-Time API"
date: 2020-07-07 01:42:14 +0800
categories: Java time
tags: Java time
---

Java 8的Date Time API（java.time包下）定义了新的关于时间相关的类，包括人类时间、机器时间，本地时间、带时区的全球唯一时间等，供不同的场景选用不同的类。另外还有基本的Temporal支持，对计算时间的加减等操作提供了很强大的支持。

1. Table of Contents, ordered
{:toc}

主要参阅了Oracle的Java Tutorial：
- https://docs.oracle.com/javase/tutorial/datetime/iso/index.html
- https://docs.oracle.com/javase/tutorial/datetime/iso/overview.html
- JSR-310: https://jcp.org/aboutJava/communityprocess/pfd/jsr310/JSR-310-guide.html

# human time
人类用来表示日期时间的方式：年月日时分秒。

一般用来表示时间的：
- LocalDate：年月日，2020-07-06
- LocalTime：时分秒，08:16:26.937
- LocalDateTime：年月日时分秒，2013-08-20T08:16:26.937，**注意日和时之间有个T**
- ZonedDateTime：**带时区的**年月日时分秒，2013-08-21T00:16:26.941+09:00[Asia/Beijing]

需要注意：上树的秒是代指，实际上可以表示到nanosecond。也就是说秒、毫秒、微妙、纳秒，都是可以表示的。

关于年、月、日的：
- Year：年，2019；
- Month：月，07。实际上是个枚举，1-12分别代表月份；
- YearMonth：年月，2020-08；
- MonthDay：月日，08-09；
- LocalDate：年月日，2020-07-06；

年月日、年月、月日、年、月，就是没有单个的日。

需要用到星期几的时候：
- DayOfWeek：也是枚举，1-7分别代表星期一到星期天。

实际上Month和DayOfWeek是一类的，表示的是month of
year。但是一般说Month的时候说的就是month of year的意思。

## 本地时间
一般就是年月日时分秒的加加减减，直接用LocalDateTime或者LocalDate即可。

比如生成日期，主要用了LocalDate#plusDays，同理还有plusMonths等：
```
    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy/MM/*");
    private static final DateTimeFormatter INPUT_FORMATTER = DateTimeFormatter.ofPattern("yyyy/MM/dd");

    public static void main(String... args) {

        String start = "2019/12/02";
        String end = "2020/03/02";

//        LocalDate startDate = LocalDate.of(2019, 12, 2);
        LocalDate startDate = LocalDate.parse(start, INPUT_FORMATTER);
        LocalDate endDate = LocalDate.parse(end, INPUT_FORMATTER);

        while (startDate.isBefore(endDate)) {
            System.out.printf("%s%n", startDate.format(FORMATTER));
            startDate = startDate.plusDays(1);
        }
    }
```

## 时区
一般在各个时区间转换时间的时候用。
- ZoneId：时区，比如Asia/Shanghai，`ZoneId.of("Asia/Shanghai")`；
- ZoneOffset：时区相对于UTC的偏移，比如+08:00，`ZoneOffset.ofHours(8)`；

不带时区的LocalDateTime和ZoneId后者ZoneOffset分别能结合出：
- ZonedDateTime = LocalDateTime + ZoneId，表示年月日时分秒时区，比如2020-07-06T21:08:03.076+08:00[Asia/Shanghai]；
- OffsetDateTime = LocalDateTime + ZoneOffset，表示年月日时分秒时区偏移，比如2020-07-06T21:08:03.076+08:00；
- OffsetTime = LocalTime + ZoneOffset，表示时分秒时区偏移；

可看出ZonedDateTime其实不止有ZoneId Asia/Shanghai，也包含了ZoneOffset +8:00。

### 获取本时区的某时间
- 获取本时区某时间：LocalDateTime#of(int year, int month, int dayOfMonth, int hour, int minute, int second, int nanoOfSecond)；
- 获取本时区当前时间：LocalDateTime#now()；

### 获取其他时区的某时间
当然也可以用ZonedDateTime的of方法，和LocalDateTime的类似，只不过需要多指定个ZoneId：
- 获取其他时区某时间：ZonedDateTime#of(int year, int month, int dayOfMonth, int hour, int minute, int second, int nanoOfSecond, ZoneId zone)；
- 获取其他时区当前时间：ZonedDateTime#now()；

当然也可以使用LocalDateTime + ZoneId直接获取其他时区的该LocalDateTime的时间：
- LocalDateTime#atZone(zone id) -> ZonedDateTime；
- LocalDateTime#atOffset(zone offset) -> OffsetDateTime；

注意这个是北京21点转为比如日本的21点，但这两个时刻不是同一时刻。

### 同一时刻不同时区时间的转换
主要是用ZonedDateTime的`withZoneSameInstant(zone id)`方法：
```java
        ZonedDateTime myZonedDateTime = ZonedDateTime.now();

        Set<String> allZones = ZoneId.getAvailableZoneIds();
        List<String> zoneList = new ArrayList<>(allZones);
        Collections.sort(zoneList);

        for (String s : zoneList) {
            ZoneId anotherZone = ZoneId.of(s);
            // my zone to another zone
            ZonedDateTime zonedDateTime = myZonedDateTime.withZoneSameInstant(anotherZone);
            ZoneOffset offset = zonedDateTime.getOffset();
            System.out.printf("%s, %s, %s%n", anotherZone, offset, zonedDateTime);
        }
```

# machine time
机器用来表示时间的方式：epoch，1970-01-01起经过的nanosecond纳秒数。

## Instant
自UTC EPOCH（1970-01-01T00:00:00Z）起的纳秒数。在此之前的时间用负数表示。

Instant和ZonedDateTime之类的没啥区别，只不过后者是给人看的，Instant是机器时间，所以更利于计算。

它里面存储的就是距离EPOCH的second和nanosecond数：
```
    /**
     * The number of seconds from the epoch of 1970-01-01T00:00:00Z.
     */
    private final long seconds;
    /**
     * The number of nanoseconds, later along the time-line, from the seconds field.
     * This is always positive, and never exceeds 999,999,999.
     */
    private final int nanos;
```
**Instant表示的纳秒数是当前时间距1970-01-01T00:00:00Z的纳秒数。**

### 当前时间
- Instant#now()；

### 加减
- plus(long amountToSubtract, TemporalUnit unit)；
- plusSeconds(long secondsToAdd)；
- minus

### 前后
- isAfter
- isBefore

### 跨度
- until：计算两个Instant之间的nanosecond，long；

### 转换为人类时间
Instant不表示人类时间，所以也不会和时区有关系。但是Instant可以转为人类时间，转的时候需要指定一个时区：
- LocalDateTime#ofInstant(Instant, ZoneId)；
- ZonedDateTime#ofInstant(Instant, ZoneId)；

**表示希望把Instant转成某时区的date time。** 而Instant使用了SystemClock，默认表示的是UTC时区的

# 格式化 - DateTimeFormatter
格式化时间分为两类：
- 输入时间格式化；
- 输出时间格式化；

两种方式都只需要传入一个DateTimeFormatter，就可以按照该formatter指定的格式格式化时间。

比如：
```
private static DateTimeFormatter DATE_TIME_FORMAT = DateTimeFormatter.ofPattern("yyyy/MM/dd")
// input
LocalDate startDate = LocalDate.parse(start, INPUT_FORMATTER);
// output
System.out.printf("%s%n", startDate.format(FORMATTER));
```
LocalDate和LocalDateTime都有相应的parse/format方法。

DateTimeFormatter里还有一些预定义的formatter，比如BASIC_ISO_DATE等。但是平时应该基本用不到，输入输出的时候自定义一下简单的格式就可以了。

# Period &. Duration
## Duration - 机器时间的一段时间
基于机器时间的一段时间，一般和Instant一起用。Instant表示一个时刻，Duration表示一段时间。

比如：
```
Instant t1, t2;
long ns = Duration.between(t1, t2).toNanos();
```
计算两个Instant之间的时间。

```
Instant start;
Duration gap = Duration.ofSeconds(10);
Instant later = start.plus(gap);
```
Instant + Duration，得到另一个Instant。

Duration也可能是负的。

## Period - 人类日期的一段时间
基于date（年月日）的一段时间。比如一共持续了x年x月x日。

里面存储了：
```
    /**
     * The number of years.
     */
    private final int years;
    /**
     * The number of months.
     */
    private final int months;
    /**
     * The number of days.
     */
    private final int days;
```
也有getYears等方法获取这些时间。

**非常适合计算两个日期之间的年月日**：
```
LocalDate today = LocalDate.now();
LocalDate birthday = LocalDate.of(1960, Month.JANUARY, 1);

Period p = Period.between(birthday, today);
long p2 = ChronoUnit.DAYS.between(birthday, today);
System.out.println("You are " + p.getYears() + " years, " + p.getMonths() +
                   " months, and " + p.getDays() +
                   " days old. (" + p2 + " days total)");
```

## ChronoUnit - 基于单一unit的一段时间
比如上例计算了如果只用天来表达，一共持续了多少天。

# Clock与Instant
Instant#now()获取当前时间戳是基于Clock创建的：
```
    public static Instant now() {
        return Clock.systemUTC().instant();
    }
```
systemUTC方法返回的是Clock的一个实现类：SystemClock。它的instant()方法主要是基于millis()方法实现的，而millis方法实际是使用System.currentTimeMillis()获取的时间戳：
```
        @Override
        public long millis() {
            return System.currentTimeMillis();
        }
        @Override
        public Instant instant() {
            return Instant.ofEpochMilli(millis());
        }
```
如果想创建其他时间，还可以使用Instant#now(Clock)方法手动传一个Clock。LocalDate等类也是提供了这样两个now方法。

> System.currentTimeMillis()返回的其实距离UTC EPOCH的毫秒数。所以Instant其实虽然能表示到纳秒，但用这种方法创建的Instant只到毫秒精度。

Clock主要有两个抽象方法要实现：
- getZone();
- instant()，或者说millis()也行；

SystemClock的zone是UTC，instant是距离UTC EPOCH的毫秒数（millis()）转成的。

Clock除了SystemClock这个标准实现，还提供了两个实现：
- Clock.offset(Clock, Duration)：提供偏移Duration的Clock；
- Clock.fixed(Instant, ZoneId)：提供永远返回创建时传入的ZoneId和Instant的Clock。

这两个应该主要是测试的时候用的。

# 兼容旧的时间api
以上java.time包里的类都是java 8发布的。在此之前，java.util里提供了Date、Calendar、TimeZone等类。

主要缺陷为mutable，所以线程不安全；

比如Date可以setDate、setHours等，改变对象内容。而LocalDate的pulsXXX都是返回新的对象。

Java 8也修改了这些旧的类，增加了一些转为新类的方法，比如：
- Calendar.toInstant()，进而通过Instant转为其他的类LocalDate等;
- Date.toInstant();
- TimeZone.toZoneId();
- GregorianCalendar.toZonedDateTime();

具体见：https://docs.oracle.com/javase/tutorial/datetime/iso/legacy.html

# ISO-8601
国际标准化组织（ISO）规定的规范标识日期时间的办法。

## 时间
时分秒都用2位数表示，对UTC时间最后加一个大写字母Z，其他时区用实际时间加时差表示。

UTC时间下午2点30分5秒：
- 14:30:05Z
- 143005Z

此时的北京时间表示为：
- 22:30:05+08:00
- 223005+0800
- 223005+08。

## 日期+时间（Time）
日期和时间之间加大写字母T。

北京时间2004年5月3日下午5点30分8秒，可以写成：
- 2004-05-03T17:30:08+08:00
- 20040503T173008+08

## 时间段（Period）
不是某一刻，而是一段时间。开头需要加P。后面是数字加时间单位。

一年三个月五天六小时七分三十秒的跨度：
- P1Y3M5DT6H7M30S

## 重复时间（Repeat）
开头加R：重复次数/起始时间/每次重复时长。

从2004年5月6日北京时间下午1点起重复半年零5天3小时，要重复3次：
- R3/20040506T130000+08/P0Y6M5DT3H0M0S

# java.time.temporal
java.time.temporal才是java 8这些时间api的核心。该包下的接口定义了date、time，还能很方便地进行日期、时间的计算。尤其是例如“下周三”、“下个月最后一天”等操作，非常方便！

## Temporal
Temporal和TemporalAccessor是主要的定义日期时间的接口（后者主要是分离了一些只读方法，应该是用于一些Temporal只读的场合），参阅[JSR-310](https://jcp.org/aboutJava/communityprocess/pfd/jsr310/JSR-310-guide.html)，我们可以知道Temporal对日期和时间的定义主要有以下行为：
- get - Gets the specified value，获取某个field的值；
- with - Returns a copy of the object with the specified value changed，修改field，并返回新对象（immutable）；
- plus/minus - Returns a copy of the object with the specified value added/subtracted，也是返回新对象；
- multipliedBy/dividedBy/negated - Returns a copy of the object with the specified value multiplied/divided/negated
- to - Converts the object to another related type
- at - Returns a new object consisting of this date-time at the specified argument, acting as the builder pattern
- of - Factory methods that don't involve data conversion
- from - Factory methods that do involve data conversion

不知道为啥of/from之类的没在Temporal接口里，其实它的实现类Instant、LocalDate、LocalTime、LocalDateTime、ZonedDateTime基本也都有of/from方法。

## TemporalField/TemporalUnit
日期时间是由field和unit组成的。ChronoField和ChronoUnit是其实现类。
- unit定义了时间单位，年月日时分秒等。
- field定义了date-time的一部分，比如一年中的天数、（永远中的）年数等；

一月中的天数，小unit是ChronoUnit.DAYS，大unit是ChronoUnit.MONTHS，其他同理：
```
DAY_OF_MONTH("DayOfMonth", DAYS, MONTHS, ValueRange.of(1, 28, 31), "day"),
YEAR("Year", YEARS, FOREVER, ValueRange.of(Year.MIN_VALUE, Year.MAX_VALUE), "year"),
```

既然date-time是由这些field组成的，就可以使用`Temporal#with(TemporalField field, long newValue)`替换field生成新的date-time了。

另外Temporal中的时间加减操作也是通过TemporalUnit来完成的，比如：
- Temporal plus(long amountToAdd, TemporalUnit unit);

还提供了重载方法：
```
    default Temporal plus(TemporalAmount amount) {
        return amount.addTo(this);
    }
```
TemporalAmount的实际实现类就是Duration和Period。

## TemporalAdjuster/TemporalAdjusters
TemporalAdjuster就是用来将一个Temporal转换成另一个Temporal的行为：`Temporal adjustInto(Temporal temporal)`。

> 这种函数式接口主要就是表达一个动作行为的，所以感觉不称呼接口更好理解。

Temporal还定义了一种使用TemporalAdjuster的with的重载方法：`Temporal#with(TemporalAdjuster)`。
```
    default Temporal with(TemporalAdjuster adjuster) {
        return adjuster.adjustInto(this);
    }
```
这样的话，就不用使用`adjuster.adjustInto(temporal)`这种写法了，直接写成`temporal.with(adjuster)`。

TemporalAdjusters预定义好了一堆TemporalAdjuster，比如：
```
    public static TemporalAdjuster firstInMonth(DayOfWeek dayOfWeek) {
        return TemporalAdjusters.dayOfWeekInMonth(1, dayOfWeek);
    }
```
返回一月中的第一个周几（DayOfWeek）。

或者返回下一个周几：
```
    public static TemporalAdjuster next(DayOfWeek dayOfWeek) {
        int dowValue = dayOfWeek.getValue();
        return (temporal) -> {
            int calDow = temporal.get(DAY_OF_WEEK);
            int daysDiff = calDow - dowValue;
            return temporal.plus(daysDiff >= 0 ? 7 - daysDiff : -daysDiff, DAYS);
        };
    }
```
它的实现方式就是对于给定的Temporal，给一个DayOfWeek，获取给定的Temporal是周几，再看它比目标周几差几天，加上就好。

## TemporalQuery/TemporalQueries
用于从一个Temporal对象中提取相应的信息。设计模式和TemporalAdjuster一样。

比如想知道一个Temporal的本地时间：
```
    public static TemporalQuery<LocalTime> localTime() {
        return TemporalQueries.LOCAL_TIME;
    }
    
    /**
     * A query for {@code LocalTime} returning null if not found.
     */
    static final TemporalQuery<LocalTime> LOCAL_TIME = (temporal) -> {
        if (temporal.isSupported(NANO_OF_DAY)) {
            return LocalTime.ofNanoOfDay(temporal.getLong(NANO_OF_DAY));
        }
        return null;
    };
```
如果该Temporal支持时间（有ChronoField.NANO_OF_DAY这个field），就返回它转成LocalTime的值。

参阅：
- https://jcp.org/aboutJava/communityprocess/pfd/jsr310/JSR-310-guide.html
- https://docs.oracle.com/javase/tutorial/datetime/iso/temporal.html
- https://www.baeldung.com/java-temporal-adjuster
- https://stackoverflow.com/a/28229817/7676237
- javadoc: https://docs.oracle.com/javase/8/docs/api/java/time/temporal/TemporalAdjuster.html
- javadoc: https://docs.oracle.com/javase/8/docs/api/java/time/temporal/TemporalAdjusters.html

# 其他
LocalTime里定义的有一些好用的量，比如：SECONDS_PER_HOUR。

其他参阅：
- 介绍了java 8 time中上述除Temporal的部分：https://www.baeldung.com/java-8-date-time-intro

# 总结
唉，没想到上次都看过的东西这次总结优化了五六个小时。可能这就是学习吧，想搞懂还是挺难的。不过话说回来，懂得越多，再学新东西就更快了。


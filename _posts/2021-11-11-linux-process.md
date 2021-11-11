---
layout: post
title: "Linux - 进程"
date: 2021-11-11 15:32:41 +0800
categories: Linux
tags: Linux
---

通过ps仔细观察一下linux的进程。

1. Table of Contents, ordered
{:toc}

# ps
- `a`: all;
- `x`: 只显示有tty的process，一般和all连用;
- `j`: `job`，相当于多显示几列信息，把sid，tty之类的都显示出来；
- `f`: `forest`，层级显示。用这个去发现父进程、同一session下的进程，很形象。

打开yakuake，里面开启一个使用zsh的终端pts/0，然后在里面执行前后台两个命令，每个命令都是由管道连接的两个命令：
```
 ~ ping localhost -aq | grep icmp &
[1] 5989 5990
 ~ ping localhost -aq | grep icmp
```

然后在yakuake里再打开一个使用zsh的终端pts/1，查看所有终端0的进程：
```
~ % ps axj | grep pts/0
   PPID     PID    PGID     SID TTY        TPGID STAT   UID   TIME COMMAND
   1626    3564    3564    3564 pts/0       7887 Ss    1000   0:00 /usr/bin/zsh
   3564    5989    5989    3564 pts/0       7887 SN    1000   0:00 ping localhost -aq
   3564    5990    5989    3564 pts/0       7887 SN    1000   0:00 grep --color=auto --exclude-dir=.bzr --exclude-dir=CVS --exclude-dir=.git --exclude-dir=.hg --exclude-dir=.svn --exclude-dir=.idea --exclude-dir=.tox icmp
   3564    7887    7887    3564 pts/0       7887 S+    1000   0:00 ping localhost -aq
   3564    7888    7887    3564 pts/0       7887 S+    1000   0:00 grep --color=auto --exclude-dir=.bzr --exclude-dir=CVS --exclude-dir=.git --exclude-dir=.hg --exclude-dir=.svn --exclude-dir=.idea --exclude-dir=.tox icmp
```
- PID：process id；
- PPID：parent process id；
- PGID： process group id；
- SID：session id；
- TPGID：tty process group id，`tty + PGID`；
- TTY：teletypewriter，电传打字机；

# PPID - 判断进程fork关系
无论是ping还是grep，**都是在zsh里执行的，所以他们的父进程都是zsh**（PID=3564），所以他们的PPID=3564。

# PGID - 判断进程组
**shell里的每个进程都属于一个进程组。注意是“shell里的每个进程”**。如果内核支持`_POSIX_JOB_CONTROL`（该宏被定义）则内核会为Shell上的每一条命令行（可能由多个命令通过管道等连接）创建一个进程组。从这点上看，**进程组不是进程的概念，而是shell上才有，所以在`task_struct`里并没有存储进程组id之类的变量**。

进程组是为了方便管理进程，信号发给进程组，相当于发给进程组的所有进程。

后台ping和后台grep用管道连接，PGID都是ping的PID=5989，所以后台ping和后台grep **属于同一个进程组（PGID相同）**，**组长的PGID=PID**，所以组长是第一个命令ping。

前台ping和前台grep同理，也属于同一个进程组。

# SID - 判断是否属于同一个TTY
会话ID。一般一个用户登录后新建一个会话，可以理解为一个tty。登录后的第一个进程叫做会话领头进程（session leader），通常是一个shell/bash。**对于会话领头进程，其PID=SID**。而我是使用zsh的，所以第一个SID都是zsh的PID。

# TPGID - 判断前后台进程
当前TTY的PGID。一个TTY只能有一个前台进程，所以这个前台进程的组长id，即为TTY的PGID。所以TPGID就是该会话的前台进程的进程组组长ID。

**所以所有`PGID≠TPGID`的进程，都是后台进程**。否则都为前台进程。

没有TTY的进程，TTY为`?`，TPGID都为-1。

# STAT
上面判断是否是前台进程判断了半天，其实不如直接看STAT。它的含义可以直接`man ps`找到解释：
```
PROCESS STATE CODES
       Here are the different values that the s, stat and state output specifiers (header "STAT" or "S") will display
       to describe the state of a process:

               D    uninterruptible sleep (usually IO)
               I    Idle kernel thread
               R    running or runnable (on run queue)
               S    interruptible sleep (waiting for an event to complete)
               T    stopped by job control signal
               t    stopped by debugger during the tracing
               W    paging (not valid since the 2.6.xx kernel)
               X    dead (should never be seen)
               Z    defunct ("zombie") process, terminated but not reaped by its parent

       For BSD formats and when the stat keyword is used, additional characters may be displayed:

               <    high-priority (not nice to other users)
               N    low-priority (nice to other users)
               L    has pages locked into memory (for real-time and custom IO)
               s    is a session leader
               l    is multi-threaded (using CLONE_THREAD, like NPTL pthreads do)
               +    is in the foreground process group
```
- `+`就是前台进程。不用比较TPGID是否等于PGID了；
- `s`就是session leader。不用比较PID是否等于SID了；


# `f` - forest
层级显示，可以很容易看出来哪些进程是同一个会话的，进程间的继承关系是什么，再叠加STAT，可以找出来session leader和foreground process。唯一不能直接看出来的是进程组，需要观察一下PGID。
```
~ % ps axjf             
   PPID     PID    PGID     SID TTY        TPGID STAT   UID   TIME COMMAND
      1    1626    1625    1625 ?             -1 Sl    1000   0:17 /usr/bin/yakuake
   1626    3564    3564    3564 pts/0       7887 Ss    1000   0:00  \_ /usr/bin/zsh
   3564    5989    5989    3564 pts/0       7887 SN    1000   0:00  |   \_ ping localhost -aq
   3564    5990    5989    3564 pts/0       7887 SN    1000   0:00  |   \_ grep --color=auto --exclude-dir=.bzr --exclude-dir=CVS --exclude-dir=.git --exclude-dir=.hg --exclude-dir=.svn --
   3564    7887    7887    3564 pts/0       7887 S+    1000   0:00  |   \_ ping localhost -aq
   3564    7888    7887    3564 pts/0       7887 S+    1000   0:00  |   \_ grep --color=auto --exclude-dir=.bzr --exclude-dir=CVS --exclude-dir=.git --exclude-dir=.hg --exclude-dir=.svn --
   1626    5995    5995    5995 pts/2       8675 Ss    1000   0:00  \_ /usr/bin/zsh
   5995    8675    8675    5995 pts/2       8675 R+    1000   0:00      \_ ps axjf

```

# 系统process总览
最后总览一下Debian + KDE的所有进程表：
```
~ % ps axjf
   PPID     PID    PGID     SID TTY        TPGID STAT   UID   TIME COMMAND
      0       2       0       0 ?             -1 S        0   0:00 [kthreadd]
      2       3       0       0 ?             -1 I<       0   0:00  \_ [rcu_gp]
      2       4       0       0 ?             -1 I<       0   0:00  \_ [rcu_par_gp]
      2       6       0       0 ?             -1 I<       0   0:00  \_ [kworker/0:0H-events_highpri]
      2       9       0       0 ?             -1 I<       0   0:00  \_ [mm_percpu_wq]
      2      10       0       0 ?             -1 S        0   0:00  \_ [rcu_tasks_rude_]
      2      11       0       0 ?             -1 S        0   0:00  \_ [rcu_tasks_trace]
      2      12       0       0 ?             -1 S        0   0:00  \_ [ksoftirqd/0]
      2      13       0       0 ?             -1 I        0   0:07  \_ [rcu_sched]
      2      14       0       0 ?             -1 S        0   0:00  \_ [migration/0]
      2      15       0       0 ?             -1 S        0   0:00  \_ [cpuhp/0]
      2      16       0       0 ?             -1 S        0   0:00  \_ [cpuhp/1]
      2      17       0       0 ?             -1 S        0   0:00  \_ [migration/1]
      2      18       0       0 ?             -1 S        0   0:00  \_ [ksoftirqd/1]
      2      20       0       0 ?             -1 I<       0   0:00  \_ [kworker/1:0H-events_highpri]
      2      21       0       0 ?             -1 S        0   0:00  \_ [cpuhp/2]
      2      22       0       0 ?             -1 S        0   0:00  \_ [migration/2]
      2      23       0       0 ?             -1 S        0   0:00  \_ [ksoftirqd/2]
      2      25       0       0 ?             -1 I<       0   0:00  \_ [kworker/2:0H-events_highpri]
      2      26       0       0 ?             -1 S        0   0:00  \_ [cpuhp/3]
      2      27       0       0 ?             -1 S        0   0:00  \_ [migration/3]
      2      28       0       0 ?             -1 S        0   0:00  \_ [ksoftirqd/3]
      2      30       0       0 ?             -1 I<       0   0:00  \_ [kworker/3:0H-events_highpri]
      2      31       0       0 ?             -1 S        0   0:00  \_ [cpuhp/4]
      2      32       0       0 ?             -1 S        0   0:00  \_ [migration/4]
      2      33       0       0 ?             -1 S        0   0:00  \_ [ksoftirqd/4]
      2      35       0       0 ?             -1 I<       0   0:00  \_ [kworker/4:0H-events_highpri]
      2      36       0       0 ?             -1 S        0   0:00  \_ [cpuhp/5]
      2      37       0       0 ?             -1 S        0   0:00  \_ [migration/5]
      2      38       0       0 ?             -1 S        0   0:00  \_ [ksoftirqd/5]
      2      40       0       0 ?             -1 I<       0   0:00  \_ [kworker/5:0H-events_highpri]
      2      41       0       0 ?             -1 S        0   0:00  \_ [cpuhp/6]
      2      42       0       0 ?             -1 S        0   0:00  \_ [migration/6]
      2      43       0       0 ?             -1 S        0   0:00  \_ [ksoftirqd/6]
      2      45       0       0 ?             -1 I<       0   0:00  \_ [kworker/6:0H-events_highpri]
      2      46       0       0 ?             -1 S        0   0:00  \_ [cpuhp/7]
      2      47       0       0 ?             -1 S        0   0:00  \_ [migration/7]
      2      48       0       0 ?             -1 S        0   0:00  \_ [ksoftirqd/7]
      2      50       0       0 ?             -1 I<       0   0:00  \_ [kworker/7:0H-events_highpri]
      2      59       0       0 ?             -1 S        0   0:00  \_ [kdevtmpfs]
      2      60       0       0 ?             -1 I<       0   0:00  \_ [netns]
      2      61       0       0 ?             -1 S        0   0:00  \_ [kauditd]
      2      62       0       0 ?             -1 S        0   0:00  \_ [khungtaskd]
      2      63       0       0 ?             -1 S        0   0:00  \_ [oom_reaper]
      2      64       0       0 ?             -1 I<       0   0:00  \_ [writeback]
      2      65       0       0 ?             -1 S        0   0:00  \_ [kcompactd0]
      2      66       0       0 ?             -1 SN       0   0:00  \_ [ksmd]
      2      67       0       0 ?             -1 SN       0   0:00  \_ [khugepaged]
      2      87       0       0 ?             -1 I<       0   0:00  \_ [kintegrityd]
      2      88       0       0 ?             -1 I<       0   0:00  \_ [kblockd]
      2      89       0       0 ?             -1 I<       0   0:00  \_ [blkcg_punt_bio]
      2      92       0       0 ?             -1 I<       0   0:00  \_ [edac-poller]
      2      93       0       0 ?             -1 I<       0   0:00  \_ [devfreq_wq]
      2      94       0       0 ?             -1 I<       0   0:00  \_ [kworker/6:1H-events_highpri]
      2      98       0       0 ?             -1 S        0   0:00  \_ [kswapd0]
      2      99       0       0 ?             -1 I<       0   0:00  \_ [kthrotld]
      2     100       0       0 ?             -1 S        0   0:00  \_ [irq/123-aerdrv]
      2     101       0       0 ?             -1 S        0   0:00  \_ [irq/124-aerdrv]
      2     102       0       0 ?             -1 S        0   0:00  \_ [irq/125-aerdrv]
      2     103       0       0 ?             -1 I<       0   0:00  \_ [acpi_thermal_pm]
      2     105       0       0 ?             -1 I<       0   0:00  \_ [kworker/1:1H-kblockd]
      2     106       0       0 ?             -1 I<       0   0:00  \_ [ipv6_addrconf]
      2     115       0       0 ?             -1 I<       0   0:00  \_ [kstrp]
      2     118       0       0 ?             -1 I<       0   0:00  \_ [zswap-shrink]
      2     141       0       0 ?             -1 I<       0   0:00  \_ [kworker/5:1H-events_highpri]
      2     173       0       0 ?             -1 I<       0   0:00  \_ [kworker/0:1H-kblockd]
      2     181       0       0 ?             -1 S        0   0:34  \_ [irq/126-ELAN101]
      2     184       0       0 ?             -1 I        0   0:00  \_ [kworker/4:2-events]
      2     185       0       0 ?             -1 I<       0   0:00  \_ [ata_sff]
      2     186       0       0 ?             -1 I<       0   0:00  \_ [nvme-wq]
      2     187       0       0 ?             -1 I<       0   0:00  \_ [nvme-reset-wq]
      2     188       0       0 ?             -1 I<       0   0:00  \_ [nvme-delete-wq]
      2     189       0       0 ?             -1 S        0   0:00  \_ [scsi_eh_0]
      2     190       0       0 ?             -1 I<       0   0:00  \_ [scsi_tmf_0]
      2     191       0       0 ?             -1 S        0   0:00  \_ [scsi_eh_1]
      2     192       0       0 ?             -1 I<       0   0:00  \_ [scsi_tmf_1]
      2     193       0       0 ?             -1 S        0   0:00  \_ [scsi_eh_2]
      2     194       0       0 ?             -1 I<       0   0:00  \_ [scsi_tmf_2]
      2     196       0       0 ?             -1 I<       0   0:00  \_ [kworker/2:1H-events_highpri]
      2     197       0       0 ?             -1 S        0   0:00  \_ [card0-crtc0]
      2     198       0       0 ?             -1 S        0   0:00  \_ [card0-crtc1]
      2     199       0       0 ?             -1 S        0   0:00  \_ [card0-crtc2]
      2     201       0       0 ?             -1 I<       0   0:00  \_ [kworker/3:1H-events_highpri]
      2     202       0       0 ?             -1 I<       0   0:00  \_ [kworker/7:1H-events_highpri]
      2     204       0       0 ?             -1 I<       0   0:00  \_ [kworker/4:1H-events_highpri]
      2     207       0       0 ?             -1 I<       0   0:00  \_ [md]
      2     218       0       0 ?             -1 I<       0   0:00  \_ [raid5wq]
      2     260       0       0 ?             -1 S        0   0:00  \_ [jbd2/nvme0n1p5-]
      2     261       0       0 ?             -1 I<       0   0:00  \_ [ext4-rsv-conver]
      2     366       0       0 ?             -1 I<       0   0:00  \_ [tpm_dev_wq]
      2     376       0       0 ?             -1 S        0   0:00  \_ [irq/139-mei_me]
      2     385       0       0 ?             -1 I<       0   0:00  \_ [kmemstick]
      2     386       0       0 ?             -1 S        0   0:00  \_ [watchdogd]
      2     457       0       0 ?             -1 I<       0   0:00  \_ [cryptd]
      2     459       0       0 ?             -1 I<       0   0:00  \_ [cfg80211]
      2     477       0       0 ?             -1 S        0   0:04  \_ [irq/141-iwlwifi]
      2     542       0       0 ?             -1 I        0   0:00  \_ [kworker/0:2-events]
      2     587       0       0 ?             -1 S        0   0:00  \_ [jbd2/sda4-8]
      2     588       0       0 ?             -1 I<       0   0:00  \_ [ext4-rsv-conver]
      2     595       0       0 ?             -1 S        0   0:00  \_ [jbd2/sda3-8]
      2     596       0       0 ?             -1 I<       0   0:00  \_ [ext4-rsv-conver]
      2    1766       0       0 ?             -1 S<       0   0:00  \_ [krfcommd]
      2    5507       0       0 ?             -1 I        0   0:00  \_ [kworker/7:0-mm_percpu_wq]
      2    6015       0       0 ?             -1 I        0   0:01  \_ [kworker/u16:1-i915]
      2    6409       0       0 ?             -1 I        0   0:00  \_ [kworker/0:1-cgroup_destroy]
      2    6711       0       0 ?             -1 I        0   0:00  \_ [kworker/1:0-cgroup_destroy]
      2    6822       0       0 ?             -1 I        0   0:00  \_ [kworker/5:3-events]
      2    7438       0       0 ?             -1 I        0   0:00  \_ [kworker/3:2-events]
      2    7579       0       0 ?             -1 I        0   0:00  \_ [kworker/6:2-mm_percpu_wq]
      2    7637       0       0 ?             -1 I<       0   0:00  \_ [kworker/u17:1-rb_allocator]
      2    7681       0       0 ?             -1 I        0   0:00  \_ [kworker/7:2-cgroup_destroy]
      2    7685       0       0 ?             -1 I        0   0:00  \_ [kworker/5:1-mm_percpu_wq]
      2    7760       0       0 ?             -1 I        0   0:02  \_ [kworker/2:3-events]
      2    7858       0       0 ?             -1 I        0   0:00  \_ [kworker/u16:2-events_unbound]
      2    7882       0       0 ?             -1 I        0   0:00  \_ [kworker/4:0-events]
      2    7884       0       0 ?             -1 I        0   0:00  \_ [kworker/6:0-events]
      2    7893       0       0 ?             -1 I        0   0:00  \_ [kworker/u16:3-flush-259:0]
      2    8518       0       0 ?             -1 I        0   0:00  \_ [kworker/2:1-events]
      2    8553       0       0 ?             -1 D<       0   0:00  \_ [kworker/u17:2+i915_flip]
      2    8562       0       0 ?             -1 I        0   0:00  \_ [kworker/1:1-events]
      2    8564       0       0 ?             -1 I        0   0:00  \_ [kworker/3:3-events]
      2    8629       0       0 ?             -1 I        0   0:00  \_ [kworker/6:1]
      2    8630       0       0 ?             -1 I        0   0:00  \_ [kworker/4:1-events]
      2    8631       0       0 ?             -1 I        0   0:00  \_ [kworker/4:3-mm_percpu_wq]
      2    8636       0       0 ?             -1 I        0   0:00  \_ [kworker/u16:0-events_unbound]
      2    8637       0       0 ?             -1 I        0   0:00  \_ [kworker/7:1]
      2    8673       0       0 ?             -1 I        0   0:00  \_ [kworker/0:0-events]
      0       1       1       1 ?             -1 Ss       0   0:02 /sbin/init
      1     308     308     308 ?             -1 Ss       0   0:01 /lib/systemd/systemd-journald
      1     324     324     324 ?             -1 Ss       0   0:00 /lib/systemd/systemd-udevd
      1     624     624     624 ?             -1 Ssl    101   0:00 /lib/systemd/systemd-timesyncd
      1     631     631     631 ?             -1 Ss       0   0:00 /usr/sbin/haveged --Foreground --verbose=1
      1     634     634     634 ?             -1 Ssl      0   0:00 /usr/libexec/accounts-daemon
      1     636     636     636 ?             -1 Ss     112   0:00 avahi-daemon: running [linux.local]
    636     640     636     636 ?             -1 S      112   0:00  \_ avahi-daemon: chroot helper
      1     637     637     637 ?             -1 Ss       0   0:00 /usr/libexec/bluetooth/bluetoothd
      1     638     638     638 ?             -1 Ss       0   0:00 /usr/sbin/cron -f
      1     639     639     639 ?             -1 Ss     105   0:03 /usr/bin/dbus-daemon --system --address=systemd: --nofork --nopidfile --systemd-activation --syslog-only
      1     641     641     641 ?             -1 Ssl      0   0:04 /usr/sbin/NetworkManager --no-daemon
      1     646     646     646 ?             -1 Ssl      0   0:00 /usr/libexec/polkitd --no-debug
      1     647     647     647 ?             -1 Ssl      0   0:00 /usr/sbin/rsyslogd -n -iNONE
      1     648     648     648 ?             -1 Ss       0   0:00 /usr/sbin/smartd -n
      1     652     652     652 ?             -1 Ss       0   0:00 /lib/systemd/systemd-logind
      1     653     653     653 ?             -1 Ssl      0   0:00 /usr/libexec/udisks2/udisksd
      1     654     654     654 ?             -1 Ss       0   0:00 /sbin/wpa_supplicant -u -s -O /run/wpa_supplicant
      1     672     672     672 ?             -1 Ssl      0   0:00 /usr/sbin/ModemManager
      1     817     817     817 ?             -1 Ss       0   0:00 /usr/sbin/cupsd -l
      1     821     821     821 ?             -1 Ssl      0   0:00 /usr/bin/python3 /usr/share/unattended-upgrades/unattended-upgrade-shutdown --wait-for-signal
      1     822     822     822 ?             -1 Ssl      0   0:14 /usr/bin/containerd
      1     825     825     825 ?             -1 Ssl      0   0:00 /usr/bin/sddm
    825     839     839     839 tty7         839 Ssl+     0   3:27  \_ /usr/lib/xorg/Xorg -nolisten tcp -auth /var/run/sddm/{f3928438-0f85-4350-8dbe-b568f505d2ab} -background none -noreset
    825    1356     825     825 ?             -1 S        0   0:00  \_ /usr/lib/x86_64-linux-gnu/sddm/sddm-helper --socket /tmp/sddm-auth16984d6f-4fb6-4c5e-a75a-cb3d4fdc13bb --id 1 --start
   1356    1388     825     825 ?             -1 Sl    1000   0:00      \_ /usr/bin/startplasma-x11
   1388    1438    1438    1438 ?             -1 Ss    1000   0:00          \_ /usr/bin/ssh-agent /usr/bin/im-launch /usr/bin/startplasma-x11
      1     826     826     826 ?             -1 Ss       0   0:00 sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups
      1     828     828     828 ?             -1 Ssl      0   0:00 /usr/sbin/cups-browsed
      1     891     891     891 ?             -1 SNsl   110   0:00 /usr/libexec/rtkit-daemon
      1     920     920     920 ?             -1 Ssl      0   0:02 /usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock
      1    1183    1183    1183 ?             -1 Ss     106   0:00 /usr/sbin/exim4 -bd -q30m
      1    1358    1358    1358 ?             -1 Ss    1000   0:00 /lib/systemd/systemd --user
   1358    1359    1358    1358 ?             -1 S     1000   0:00  \_ (sd-pam)
   1358    1378    1378    1378 ?             -1 S<sl  1000   0:00  \_ /usr/bin/pipewire
   1378    1384    1378    1378 ?             -1 S<l   1000   0:00  |   \_ /usr/bin/pipewire-media-session
   1358    1379    1379    1379 ?             -1 S<sl  1000   0:26  \_ /usr/bin/pulseaudio --daemonize=no --log-target=journal
   1379    1459    1379    1379 ?             -1 Sl    1000   0:00  |   \_ /usr/libexec/pulse/gsettings-helper
   1358    1382    1382    1382 ?             -1 Ss    1000   0:02  \_ /usr/bin/dbus-daemon --session --address=systemd: --nofork --nopidfile --systemd-activation --syslog-only
   1358    1540    1382    1382 ?             -1 Sl    1000   0:01  \_ /usr/lib/x86_64-linux-gnu/libexec/kactivitymanagerd
   1358    1546    1546    1546 ?             -1 Ssl   1000   0:01  \_ /usr/bin/kglobalaccel5
   1358    1585    1382    1382 ?             -1 Sl    1000   0:00  \_ /usr/libexec/dconf-service
   1358    1713    1382    1382 ?             -1 Sl    1000   0:01  \_ /usr/lib/x86_64-linux-gnu/libexec/kf5/kscreen_backend_launcher
   1358    1718    1382    1382 ?             -1 Sl    1000   0:05  \_ /usr/bin/ksystemstats
   1718    1720    1382    1382 ?             -1 S     1000   0:06  |   \_ /usr/bin/ksysguardd
   1358    1762    1762    1762 ?             -1 Ss    1000   0:00  \_ /usr/libexec/bluetooth/obexd
   1358    7897    1382    1382 ?             -1 Sl    1000   0:00  \_ /usr/bin/krunner
      1    1387    1386    1386 ?             -1 Sl    1000   0:01 /usr/bin/kwalletd5 --pam-login 7 3
      1    1449    1448    1448 ?             -1 S     1000   0:06 /usr/bin/fcitx -d
      1    1455    1455    1455 ?             -1 Ss    1000   0:01 /usr/bin/dbus-daemon --syslog --fork --print-pid 5 --print-address 7 --config-file /usr/share/fcitx/dbus/daemon.conf
      1    1481     825     825 ?             -1 S     1000   0:00 /usr/lib/x86_64-linux-gnu/libexec/kf5/start_kdeinit
      1    1486    1486    1486 ?             -1 Ss    1000   0:00 kdeinit5: Running...
   1486    1488    1486    1486 ?             -1 Sl    1000   0:01  \_ /usr/lib/x86_64-linux-gnu/libexec/kf5/klauncher --fd=9
   1486    2618    1486    1486 ?             -1 S     1000   0:00  \_ file.so [kdeinit5] file local:/run/user/1000/klauncherNRjbkV.1.slave-socket local:/run/user/1000/kded5AVLYwh.1.slave-
   1486    2619    1486    1486 ?             -1 S     1000   0:00  \_ file.so [kdeinit5] file local:/run/user/1000/klauncherNRjbkV.1.slave-socket local:/run/user/1000/kded5QHbsdh.2.slave-
      1    1499    1498    1498 ?             -1 SN    1000   0:00 /usr/bin/fcitx-dbus-watcher unix:abstract=/tmp/dbus-fTAHPklDfF,guid=ef338b2fb2f5d014c3f9d9226180eda6 1455
      1    1512    1511    1511 ?             -1 Sl    1000   0:05 /usr/bin/kded5
      1    1518    1517    1517 ?             -1 Sl    1000   4:22 /usr/bin/kwin_x11
      1    1549    1548    1548 ?             -1 Sl    1000   0:01 /usr/bin/ksmserver
      1    1554    1553    1553 ?             -1 Sl    1000   2:18 /usr/bin/plasmashell
   1554    7909    1553    1553 ?             -1 Sl    1000   0:21  \_ /opt/google/chrome/chrome --enable-crashpad
   7909    7915    1553    1553 ?             -1 S     1000   0:00      \_ cat
   7909    7916    1553    1553 ?             -1 S     1000   0:00      \_ cat
   7909    7926    1553    1553 ?             -1 S     1000   0:00      \_ /opt/google/chrome/chrome --type=zygote --no-zygote-sandbox --enable-crashpad --crashpad-handler-pid=7918 --enabl
   7926    7951    1553    1553 ?             -1 Sl    1000   0:08      |   \_ /opt/google/chrome/chrome --type=gpu-process --field-trial-handle=9298843108180127399,16641463171786290886,13
   7909    7927    1553    1553 ?             -1 S     1000   0:00      \_ /opt/google/chrome/chrome --type=zygote --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-reporter=355
   7927    7928    1553    1553 ?             -1 S     1000   0:00      |   \_ /opt/google/chrome/nacl_helper
   7927    7931    1553    1553 ?             -1 S     1000   0:00      |   \_ /opt/google/chrome/chrome --type=zygote --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-reporter
   7931    7954    1553    1553 ?             -1 Sl    1000   0:00      |       \_ /opt/google/chrome/chrome --type=utility --utility-sub-type=storage.mojom.StorageService --field-trial-ha
   7931    8037    1553    1553 ?             -1 Sl    1000   0:00      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8051    1553    1553 ?             -1 Sl    1000   0:00      |       \_ /opt/google/chrome/chrome --type=utility --utility-sub-type=proxy_resolver.mojom.ProxyResolverFactory --f
   7931    8056    1553    1553 ?             -1 Sl    1000   0:06      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8072    1553    1553 ?             -1 Sl    1000   0:00      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8077    1553    1553 ?             -1 Sl    1000   0:00      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8098    1553    1553 ?             -1 Sl    1000   0:00      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8104    1553    1553 ?             -1 Sl    1000   0:00      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8117    1553    1553 ?             -1 Sl    1000   0:01      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8125    1553    1553 ?             -1 Sl    1000   0:00      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8150    1553    1553 ?             -1 Sl    1000   0:00      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8156    1553    1553 ?             -1 Sl    1000   0:00      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8175    1553    1553 ?             -1 Sl    1000   0:07      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8184    1553    1553 ?             -1 Sl    1000   0:00      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8198    1553    1553 ?             -1 Sl    1000   0:00      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8211    1553    1553 ?             -1 Sl    1000   0:00      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8225    1553    1553 ?             -1 Sl    1000   0:00      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8238    1553    1553 ?             -1 Sl    1000   0:02      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8274    1553    1553 ?             -1 Sl    1000   0:44      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8456    1553    1553 ?             -1 Sl    1000   0:00      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7931    8475    1553    1553 ?             -1 Sl    1000   0:00      |       \_ /opt/google/chrome/chrome --type=renderer --enable-crashpad --crashpad-handler-pid=7918 --enable-crash-re
   7909    7952    1553    1553 ?             -1 Sl    1000   0:02      \_ /opt/google/chrome/chrome --type=utility --utility-sub-type=network.mojom.NetworkService --field-trial-handle=929
      1    1560    1559    1559 ?             -1 Sl    1000   0:01 /usr/bin/kaccess
      1    1562    1561    1561 ?             -1 Sl    1000   0:00 /usr/lib/x86_64-linux-gnu/libexec/polkit-kde-authentication-agent-1
      1    1564    1563    1563 ?             -1 Sl    1000   0:00 /usr/bin/xembedsniproxy
      1    1594    1593    1593 ?             -1 Sl    1000   0:01 /usr/lib/x86_64-linux-gnu/libexec/kdeconnectd
      1    1596    1595    1595 ?             -1 Sl    1000   0:01 /usr/lib/x86_64-linux-gnu/libexec/DiscoverNotifier
      1    1603    1602    1602 ?             -1 Sl    1000   0:00 /usr/bin/gmenudbusmenuproxy
      1    1615    1614    1614 ?             -1 Sl    1000   0:00 /usr/libexec/geoclue-2.0/demos/agent
      1    1617    1616    1616 ?             -1 Sl    1000   0:01 /usr/bin/korgac
      1    1622    1621    1621 ?             -1 Sl    1000   0:01 /usr/lib/x86_64-linux-gnu/libexec/org_kde_powerdevil
      1    1624    1623    1623 ?             -1 Sl    1000   0:00 /usr/libexec/at-spi-bus-launcher --launch-immediately
   1624    1633    1623    1623 ?             -1 S     1000   0:00  \_ /usr/bin/dbus-daemon --config-file=/usr/share/defaults/at-spi2/accessibility.conf --nofork --print-address 3
      1    1626    1625    1625 ?             -1 Sl    1000   0:17 /usr/bin/yakuake
   1626    3564    3564    3564 pts/0       7887 Ss    1000   0:00  \_ /usr/bin/zsh
   3564    5989    5989    3564 pts/0       7887 SN    1000   0:00  |   \_ ping localhost -aq
   3564    5990    5989    3564 pts/0       7887 SN    1000   0:00  |   \_ grep --color=auto --exclude-dir=.bzr --exclude-dir=CVS --exclude-dir=.git --exclude-dir=.hg --exclude-dir=.svn --
   3564    7887    7887    3564 pts/0       7887 S+    1000   0:00  |   \_ ping localhost -aq
   3564    7888    7887    3564 pts/0       7887 S+    1000   0:00  |   \_ grep --color=auto --exclude-dir=.bzr --exclude-dir=CVS --exclude-dir=.git --exclude-dir=.hg --exclude-dir=.svn --
   1626    5995    5995    5995 pts/2       8675 Ss    1000   0:00  \_ /usr/bin/zsh
   5995    8675    8675    5995 pts/2       8675 R+    1000   0:00      \_ ps axjf
      1    1650    1650    1650 ?             -1 Ssl      0   0:03 /usr/libexec/packagekitd
      1    1654    1654    1654 ?             -1 Ssl      0   0:00 /usr/libexec/upowerd
      1    1697    1696    1696 ?             -1 Sl    1000   0:01 /usr/bin/akonadi_control
   1697    1702    1696    1696 ?             -1 Sl    1000   0:00  \_ /usr/bin/akonadiserver
   1702    1725    1696    1696 ?             -1 Sl    1000   0:01  |   \_ /usr/sbin/mysqld --defaults-file=/home/pichu/.local/share/akonadi/mysql.conf --datadir=/home/pichu/.local/share/a
   1697    1779    1696    1696 ?             -1 Sl    1000   0:01  \_ /usr/bin/akonadi_akonotes_resource --identifier akonadi_akonotes_resource_0
   1697    1780    1696    1696 ?             -1 SLl   1000   0:01  \_ /usr/bin/akonadi_archivemail_agent --identifier akonadi_archivemail_agent
   1697    1781    1696    1696 ?             -1 Sl    1000   0:01  \_ /usr/bin/akonadi_birthdays_resource --identifier akonadi_birthdays_resource
   1697    1782    1696    1696 ?             -1 Sl    1000   0:01  \_ /usr/bin/akonadi_contacts_resource --identifier akonadi_contacts_resource_0
   1697    1783    1696    1696 ?             -1 Sl    1000   0:01  \_ /usr/bin/akonadi_followupreminder_agent --identifier akonadi_followupreminder_agent
   1697    1784    1696    1696 ?             -1 Sl    1000   0:01  \_ /usr/bin/akonadi_ical_resource --identifier akonadi_ical_resource_0
   1697    1785    1696    1696 ?             -1 SNl   1000   0:01  \_ /usr/bin/akonadi_indexing_agent --identifier akonadi_indexing_agent
   1697    1786    1696    1696 ?             -1 Sl    1000   0:01  \_ /usr/bin/akonadi_maildir_resource --identifier akonadi_maildir_resource_0
   1697    1787    1696    1696 ?             -1 Sl    1000   0:01  \_ /usr/bin/akonadi_maildispatcher_agent --identifier akonadi_maildispatcher_agent
   1697    1788    1696    1696 ?             -1 SLl   1000   0:01  \_ /usr/bin/akonadi_mailfilter_agent --identifier akonadi_mailfilter_agent
   1697    1797    1696    1696 ?             -1 Sl    1000   0:01  \_ /usr/bin/akonadi_migration_agent --identifier akonadi_migration_agent
   1697    1798    1696    1696 ?             -1 Sl    1000   0:01  \_ /usr/bin/akonadi_newmailnotifier_agent --identifier akonadi_newmailnotifier_agent
   1697    1802    1696    1696 ?             -1 Sl    1000   0:02  \_ /usr/bin/akonadi_notes_agent --identifier akonadi_notes_agent
   1697    1804    1696    1696 ?             -1 SLl   1000   0:02  \_ /usr/bin/akonadi_sendlater_agent --identifier akonadi_sendlater_agent
   1697    1806    1696    1696 ?             -1 SLl   1000   0:02  \_ /usr/bin/akonadi_unifiedmailbox_agent --identifier akonadi_unifiedmailbox_agent
      1    1738    1737    1737 ?             -1 S     1000   0:00 /usr/bin/xsettingsd
      1    2115    1623    1623 ?             -1 Sl    1000   0:01 /usr/libexec/at-spi2-registryd --use-gnome-session
      1    7918    7917    7917 ?             -1 Sl    1000   0:00 /opt/google/chrome/chrome_crashpad_handler --monitor-self --monitor-self-annotation=ptype=crashpad-handler --database=/ho
      1    7920    7919    7919 ?             -1 Sl    1000   0:00 /opt/google/chrome/chrome_crashpad_handler --no-periodic-tasks --monitor-self-annotation=ptype=crashpad-handler --databas
```
可以观察到几点：
- PID=1是`/sbin/init`，也就是init进程，负责系统的启动关闭；
- PID=2是`[kthreadd]`，是kernel thread daemon；
- plasmashell桌面是由init启动的一个进程，后续启动的GUI的进程都是他的子进程，比如chrome；
- yakuake是由init进程直接启动的，不是由plasmashell启动的。可能是因为它是开机自启动？如果此时手动开启一个konsole，它的父进程应该还是plasmashell吧？如果启动一个kate，应该也是plasmashell的子进程；
- yakuake开了两个tty，启动了一些进程，就是之前我们讨论过的；
- 如果启动一个konsole，应该也是有tty的；

TODO：以上两个关于konsole的猜想需要验证一下。

关于pid=0的进程：
- https://unix.stackexchange.com/questions/83322/which-process-has-pid-0

关于init进程：
- https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/6/html/installation_guide/s2-boot-init-shutdown-init
- https://web.mit.edu/rhel-doc/3/rhel-rg-en-3/s1-boot-init-shutdown-process.html

Ref:
- https://zhuanlan.zhihu.com/p/266720121


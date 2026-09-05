# 214 换了网之后，写死地址的 git remote 不是超时，是被别人应答

## 现象

Mac 构建机上拉代码：

```
$ git fetch linux
Connection closed by 172.20.10.10 port 22
```

不是 `Connection timed out`，是**连上了又被关掉**。看起来像 SSH 配置坏了、key 掉了、Linux 那头的
sshd 出了问题，于是去查 key 和 sshd，全都好好的。

## 原因

Mac 上的 `linux` remote 是 `ssh://xinyuan@172.20.10.10/...`，那是坑 202 那次改成直连时 Linux
在热点网段上的地址。Linux 换了网络之后是 192.168.0.107，`172.20.10.10` 上现在是别的设备——
它的 22 端口有东西在听，握手到一半就把连接关了。

远端地址写死在 remote URL 里，换网就过期，而过期的表现取决于那个地址上现在是谁：没人就超时，
有人就是各种半通不通的错误。「Connection closed by <ip>」尤其误导，它像是对端 sshd 在拒绝你。

## 解法

先确认那个 IP 现在是不是目标机器，再去查 SSH：

```
ssh xinyuan@<ip> hostname
```

对不上就重指 remote：

```
git remote set-url linux ssh://xinyuan@192.168.0.107/home/xinyuan/Documents/Github/Reading-Partner
```

和坑 202 同一个病根，只是位置换了：那次写死在 Mac 的隧道配置里，这次写死在 Mac 的 git remote 里。
凡是把 Linux 的地址存在 Mac 上的东西，Linux 一换网就全部要过一遍。

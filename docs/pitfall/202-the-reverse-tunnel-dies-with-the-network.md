# 202 反向隧道换个网就断，两头在同一个热点上时直连更省事

## 现象

`ssh macmini` 突然不通，报的不是拒绝而是超时：

```
Connection timed out during banner exchange
Connection to 127.0.0.1 port 2222 timed out
```

端口还听着（本地 2222 有人 listen），所以看起来像"通的"，但握手永远不完成。跑到一半的构建和 `devicectl`
一起卡死，容器里的文件拉不出来。

## 原因

那条隧道是 Mac 那头主动连过来、把自己的 22 端口反射到 Linux 的 2222 上的，Linux 的地址写死在 Mac 的配置里。
Linux 换了网络（或者 Mac 换了网络），Mac 那头连不回来，隧道就没了；本地 2222 的 listen 是隧道进程留下的壳，
连上去只会挂在 banner 那一步。

## 解法

两头在同一个网段上的时候不要绕隧道，直连。热点下的网段是 `172.20.10.0/28`，Mac `.11`，Linux `.10`，
`~/.ssh/config` 里把 `macmini` 的 `HostName` 指过去就行，所有 `ssh macmini ...` 的命令一个字不用改。

下次再断，**先扫这个段找 Mac，别去修隧道**。

## 同一个病根的另一处：写死的 git remote

Mac 上的 `linux` remote 也写死过一次这个热点网段的地址（`ssh://xinyuan@172.20.10.10/...`）。Linux 换了网络（变成 192.168.0.107）之后，`172.20.10.10` 上是别的设备，`git fetch linux` 报的不是超时，是「连上了又被关掉」：

```
$ git fetch linux
Connection closed by 172.20.10.10 port 22
```

`Connection closed by <ip>` 尤其误导，看起来像对端 sshd 在拒绝你，其实是握手到一半被一个不相干的设备关掉。判据一样：先确认那个 IP 现在是不是目标机器（`ssh xinyuan@<ip> hostname`），对不上就 `git remote set-url` 重指。凡是把 Linux 地址存在 Mac 上的东西——隧道配置、git remote——Linux 一换网就要全部过一遍。

import type { Translation } from "../types";
import type en from "./en";

export default {
  "toast.cantOpenDownloading": "打不开——可能还没下载完成。",
  "toast.cantOpenFile": "打不开这个文件——可能已被移动或删除。",
  "toast.cantReadFile": "读不了这个文件——可能已被移动或删除。",
  "toast.asideGone": "这段旁支对话已经不在了。",
  "toast.conversationsUnloadable": "保存的 AI 对话无法加载",
  "toast.cantShareFile": "无法把这个文件交给其他应用。",

  "call.askAboutThisTitle": "问问这个",
  "call.askAboutThisPlaceholder": "问问这个…",
  "call.teachPlaceholder": "让我讲讲这本书的某一部分…",
  "call.thisBookFallback": "这本书",
  "call.configurePrompt": "先在设置里连接一个服务商，才能开始对话。",
  "call.openSettings": "打开设置",
  "call.retry": "重试",

  "action.dismiss": "关闭",
  "action.cancel": "取消",
  "action.delete": "删除",

  "savedArticle.backLabel": "收藏",

  "nav.settings": "设置",
  "nav.settingsNeedsAttention": "设置——同步需要处理",
  "sidebar.sections": "分区",
  "sidebar.expand": "展开侧栏",
  "sidebar.collapse": "收起侧栏",
  "sidebar.updating": "正在更新…",
  "sidebar.restartToUpdate": "重启以更新",

  "lumen.show": "显示 Lumen",
  "lumen.hide": "隐藏 Lumen",
  "lumen.needsDecision": "需要你定",

  "box.bookFallback": "一本书",
  "box.originBookPage": "{book} · 第{page}页",
  "box.originDoor": "在门口 · {date}",
  "box.originBriefing": "简报 · {date}",
  "box.originMeals": "三餐",
  "box.label": "盒子",
  "box.waiting": { other: "盒子，{count} 件待处理" },
  "box.empty": "盒子里什么都没有。",
  "box.notReadable": "这一条在一本书里，请在 iPad 或桌面端打开。",

  "figure.label": "图 {id} · 第{page}页",
  "figure.number": "图 {id}",
  "figure.pageSuffix": "· 第{page}页",
  "figure.notFound": "本文档中没有图 {id}。",
  "figure.loading": "正在加载插图…",
  "figure.notRendered": "这张插图无法渲染。",
  "figure.rendering": "正在渲染插图…",

  "peer.desktopMac": "Mac",
  "peer.desktopWindows": "Windows 电脑",
  "peer.desktopLinux": "Linux 电脑",
  "peer.desktopFallback": "电脑",
  "peer.notice": "你的{name}还在 {version}。请在那台设备上打开 Reading Partner 以更新到 {target}。",

  "sync.credentialsMissing": "自动同步已开启，但这台设备已退出 Google 登录——没有在同步。",
  "sync.engineStopped": "自动同步已开启，但同步引擎没有在运行。",
  "sync.neverSynced": "这台设备还没有完成过一次同步。",
  "sync.neverSyncedWithError": "这台设备还没有完成过一次同步。最近的错误：{error}",
  "sync.stalled": "已经超过一天没有成功同步。",
  "sync.stalledWithError": "已经超过一天没有成功同步。最近的错误：{error}",
  "sync.lastFailed": "上次同步失败：{error}",

  "auth.notConfigured": "未配置 Google 客户端",
  "auth.tokenRequestFailed": "Google 令牌请求失败（HTTP {status}）：{text}",
  "auth.redirectCaptureFailed": "Google 登录未能捕获回调：{error}",
  "auth.signInTimedOut": "Google 登录等待回调超时",
  "auth.authorizationError": "Google 授权出错：{error}",
  "auth.noRefreshToken": "Google 没有返回刷新令牌；请到 myaccount.google.com 移除这个应用后重新登录。",

  "image.noCanvasContext": "无法处理这张图片（没有 canvas 上下文）。",
  "image.tooLarge": "压缩后图片仍然太大（{mb} MB，上限 5 MB）。",
  "image.decodeFailed": "无法解码这张图片。",

  "nav.today": "今天",
  "nav.briefing": "简报",
  "nav.meals": "三餐",
  "nav.topics": "主题",
} satisfies Translation<typeof en>;

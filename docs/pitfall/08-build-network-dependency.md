# reader 构建期要联网下语言文件

现象：离线或 GitHub 被墙时 `scripts/build-reader.sh` 构建失败。

原因：webpack 的 ZoteroLocalePlugin 会实时从 `raw.githubusercontent.com/zotero/zotero/<commit>/...` 下载三个 .ftl 语言文件，commit 来自 `.zotero-locale-commit`。

解法：需要网络；CI/离线环境预先缓存 vendor/reader/locales/ 目录或配代理。

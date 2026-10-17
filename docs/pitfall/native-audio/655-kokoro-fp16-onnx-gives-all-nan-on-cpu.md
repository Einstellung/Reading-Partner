# 655 Kokoro 的 fp16 ONNX 在 CPU 上整句全是 NaN

## 现象

`onnx-community/Kokoro-82M-v1.1-zh-ONNX`（revision `6cc0f0d2`）的 `onnx/model_fp16.onnx`，经 `ort` 2.0.0-rc.13（ONNX Runtime 1.28，CPU provider）在 x86_64 Linux 上跑 13 句测试句：每句的样本数和 PyTorch 参考一模一样，但所有样本都是 NaN，一个有限值都没有。加载和推理都不报错，速度和 fp32 一样。

## 原因

时长预测那半是对的（样本数对得上），坏在解码器。CPU provider 大多数算子没有 fp16 内核，图里插了 Cast 来回转，fp16 的中间量在解码器里溢出成 inf，再变 NaN。没查到具体是哪个节点。

## 解法

Linux 上不用 fp16。端侧测速命令（`kokoro_bench`）对每句报 `nonFinite`、每组报 `brokenSentences`，ARM 上的 CPU provider 有一部分原生 fp16 内核，结果可能不同，iPad 上的数出来之前 fp16 不算候选。拿到音频先查有没有 NaN 再谈好不好听：播放器拿到 NaN 不会报错，只是一段静音或爆音。

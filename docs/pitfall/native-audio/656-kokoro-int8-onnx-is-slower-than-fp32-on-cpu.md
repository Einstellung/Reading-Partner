# 656 Kokoro 的 int8 ONNX 在 CPU 上比 fp32 慢五倍半

## 现象

同一个仓库（`onnx-community/Kokoro-82M-v1.1-zh-ONNX`，revision `6cc0f0d2`）的 `onnx/model_int8.onnx` 只有 fp32 的 38%（127 MB 对 339 MB），但在 x86_64 Linux（i5-14400F，4 线程，ONNX Runtime 1.28 CPU provider）上 RTF 是 1.12-1.23，fp32 是 0.20-0.24，慢了约 5.5 倍，比实时还慢。音质也掉：和 PyTorch 参考比，log-mel 平均差 4.5-9.4 dB（fp32 是 2.0-2.5 dB），13 句里 6 句时长差 25-75 ms（fp32 句句逐样本相同）。

## 原因

这是动态量化的导出，卷积变成 `ConvInteger` 加反量化。CPU provider 的 `ConvInteger` 没有像 fp32 卷积那样优化过的内核，Kokoro 的解码器又几乎全是卷积，省下的只有文件大小。时长差是因为时长预测器里的权重也被量化了，取整后帧数会变。

## 解法

不要按「int8 一定更快」选型。端侧测速命令对 fp32、fp16、int8 都测，ARM 的整数点积指令可能改变结论，以 iPad 的数为准；在那之前下载体积的省不能当理由。

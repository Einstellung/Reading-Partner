# Kokoro ONNX 同一输入两次合成的波形不逐字节相同

## 现象

安卓语音第 1 片要求 kokoro-onnx 搬家后 `linux_compare` 的输出和搬家前逐字节相同。搬家前在同一份代码上连跑两次（同一模型、同一 manifest、4 线程），fp32、fp16、int8 三个变体的每一条 `.f32` 都不一样，只有样本数每次相同。

## 原因

onnx-community/Kokoro-82M-v1.1-zh-ONNX 的图里有 `RandomNormalLike` 和 `RandomUniformLike`（声码器的正弦源和噪声），没有 `seed` 属性。没有 seed 时 ONNX Runtime 每个进程取不同的随机种子，C API 也没有设全局种子的入口（Python 的 `onnxruntime.set_seed` 不在 C API 里）。所以输出本来就逐次不同，和代码改没改无关。

## 解法

要做逐字节对比时，用 `onnx` 包把这两类节点都补上固定的 `seed` 属性另存一份模型，拿它跑前后两次：带 seed 的模型在不同进程间输出逐字节相同，搬家前后也相同。产品里的模型不动。不带 seed 的模型只能比样本数和频谱，不能比字节。

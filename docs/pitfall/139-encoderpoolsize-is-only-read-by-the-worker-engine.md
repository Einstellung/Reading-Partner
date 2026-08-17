# `encoderPoolSize` 只有 worker 引擎读，直连引擎收下就扔

## 现象

给 `createPdfiumEngine` 传 `encoderPoolSize`，首屏和滚动一个数都不动。类型检查全绿，控制台没有任何提示。

## 原因

两个引擎各自声明了一份一模一样的 `CreatePdfiumEngineOptions`，都带 `encoderPoolSize`，但只有 worker 版实现了它：

```js
// pdfium-worker-engine
const encoderPool = new ImageEncoderWorkerPool(encoderPoolSize ?? 2, ...);
return new PdfEngine(remoteExecutor, { imageConverter: createHybridImageConverter(encoderPool), logger });

// pdfium-direct-engine
return new PdfEngine(native, { imageConverter: browserImageDataToBlobConverter, logger });
```

直连版从头到尾没读过这个字段，编码写死在主线程 canvas 上。（顺带，d.ts 的注释说默认 0 - disabled，worker 的实际默认是 2。）

## 解法

要编码池就用 worker 引擎。手工拼一个"直连 + 池"走不通：`createWorkerPoolImageConverter`、`PdfEngine`、`PdfiumNative` 都能从 `@embedpdf/engines/pdfium` 拿到，唯独 `ImageEncoderWorkerPool` 不在包的 exports 里。

`engine-singleton.ts` 里 "encoderPoolSize was measured to not move first paint" 那句是 2026-07-16（dcaedfb）在直连引擎下测出来的，当时这个选项根本没接线，所以它什么也没证明；worker 下没测过。

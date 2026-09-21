# IDA4 Web

身份证 A4 复印件工具（手机 Web 端）。导入国徽面与人像面照片，在浏览器内用 ONNX 自动裁切、透视与朝向矫正，排版到 A4 并导出 PDF。

ONNX 推理完全在浏览器运行，仅使用模型：

- `cv_resnet18_card_correction.onnx`（票证检测 + 透视 + 朝向）

检测失败时自动降级为纯边缘检测（无需额外模型）。

## 功能

- 拍照 / 相册选择国徽面与人像面
- 检测引擎：票证矫正（浏览器 ONNX）、纯边缘检测
- 效果：图像增强、失败降级、随机倾斜、圆角黑边、黑白
- 可选平铺水印
- A4 预览、导出 PDF、系统分享 / 打印

## 开发

```powershell
npm install
npm run copy-assets
npm run dev
```

手机调试：在同一局域网访问终端打印的 Network 地址。

## 构建

```powershell
npm run build
npm run copy-assets
npm run preview
```

构建产物在 `dist/`，可部署到任意静态站点。模型与 ORT wasm 位于 `public/`。

## 模型

将 `cv_resnet18_card_correction.onnx` 放到：

```text
public/models/cv_resnet18_card_correction.onnx
```

可从 IDA4 桌面版 `ida4/models/` 复制。

## 结构

```text
IDA4-Web/
  public/
    models/     ONNX 模型
    ort/        onnxruntime-web wasm
  src/
    lib/        图像管线 / ONNX / A4 / PDF
    components/ 手机 UI
```

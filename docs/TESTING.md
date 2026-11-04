# 测试与验证

## 环境

- Node.js 22.18+、npm；建议使用 Node.js 24。
- 浏览器回归默认使用本机 Chrome、Edge，以及 Playwright Firefox。
- `npm ci` 后执行 `npx playwright install firefox` 安装测试版 Firefox。

## 自动检查

```sh
npm run check
```

此命令依次执行 TypeScript 类型检查、单元测试、扩展构建、Firefox 清单检查和浏览器回归测试。也可分别运行：

```sh
npm run typecheck
npm run test:unit
npm run build
npm run lint:firefox
npm run test:browser
```

`tests/fixtures/` 使用模拟播放器和自行生成的媒体样本，覆盖菜单、自定义倍速、收藏、图钉、跨标签页同步、临时倍速的视频边界和右箭头长按恢复。安装测试通过独立浏览器会话加载构建后的 MV3 扩展。

## 真实网页检查

完成构建后，可按需运行：

```sh
npm run test:live
npm run test:live:fast-forward
npm run test:live:unpin
npm run test:live:navigation
npm run test:live:menu
```

这些脚本访问真实 B 站页面，结果受网络、地区、内容可播放状态和播放器改版影响。它们使用独立测试会话，不需要导入日常浏览器的登录数据。真实网页日志和诊断截图仅保存在本地，不提交到源码仓库。

自动化回归通过代表测试覆盖范围内的行为正确；实际网站改版后仍需复核。商店审核状态与源码测试结果分别管理。

## 打包检查

```sh
npm run package
```

`release/` 中包括 Chrome、Edge、Firefox 安装包、源码包与 `SHA256SUMS`。源码包仅包含源码、构建与测试文件、许可证、隐私政策及经过筛选的公开文档，不含商店后台回执或本地浏览日志。

## 2026-11-04 开源发布验证

版本 1.9.5：`npm run check` 通过，包含类型检查、22 项单元测试、扩展构建、Firefox 清单零错误 / 提示 / 警告，以及 353 项浏览器回归（Chrome、Edge、Firefox 和真实 MV3 安装检查）。本次没有重跑真实 B 站联网脚本。

筛选后的公开源码在独立目录完成依赖安装与打包。该 Mac 上 Sharp 的 Homebrew 全局 libvips 探测发生等待，因此全新安装使用了 `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm ci`，随后 `npm run package` 成功；该变量仅跳过全局库探测，使用依赖中提供的预编译库。

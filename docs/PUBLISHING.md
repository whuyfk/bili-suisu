# 商店发布与审核资料

## 提交前的发布者信息

运行 `npm run package` 后使用 `release/` 内对应商店 ZIP。目录内文件是可复现的送审材料，不代表已获商店批准。

发布者需要自行在对应开发者后台填写真实的开发者身份、支持邮箱和必要的账户验证信息。将项目的 `PRIVACY.md` 发布到公开可访问的 HTTPS 页面，把该 URL 填入商店隐私政策字段；同时提供可用的支持入口。不要填写虚构网址或占位邮箱。

Firefox 使用的稳定扩展 ID 为 `bili-speed-four@yfk.extensions`，这是扩展标识，不是联系邮箱。首次正式提交前可改成发布者自己的唯一 ID；正式发布后保持 ID 不变。版本号由 `package.json` 统一生成，后续更新必须递增。

## 可直接使用的文案

**名称**：超好用B站倍速助手

**简短说明**：在 B 站原生菜单快捷调速，最高 10 倍，支持收藏常用倍速、图钉固定跨视频默认速度及删除清空。

**详细说明**：

看视频，随你的节奏。在熟悉的 B 站播放器倍速菜单内，直接选择 2.5 或 3 倍；也可用鼠标拖动滑块，在 0.25–10 倍之间选择，每档 0.1 倍，保留 0.25 倍最低档，实时预览数值，点击“确定”应用；也可点击数字旁的星标收藏常用速度，实心星标再次点击可取消收藏，后续从原菜单一键选择，支持逐项删除和清空。

支持长按右箭头临时加速：当前速度小于 3 倍时使用 3 倍，大于等于 3 倍时乘以 1.5，最高 10 倍；松开后恢复原速，不改收藏和图钉固定值。短按保留原生跳进度。

支持普通视频、合集/分 P、播放列表和番剧；普通播放、网页全屏及全屏均可使用。未固定时，临时速度仅用于当前视频及其分 P，切到另一视频、列表条目或番剧集恢复 1 倍；刷新或新开页面后插件不主动恢复临时速度；悬停任意倍速行并点击图钉，即可选中并固定该速度；固定后，新视频与刷新均使用保存的默认速度，再点可取消。删除被固定的自定义速度或点击“清空”会同时解除固定。解除固定不改变当前视频速度，下一视频释放旧固定值，播放器复用时也不会重新恢复已取消的固定速度。

扩展在本机工作，无需注册，无广告，不收集或上传个人信息、观看记录或使用统计。声音和音调采用浏览器原生处理，播放流畅度取决于设备、网络和视频本身。

本扩展是独立开发的非官方工具，与哔哩哔哩无隶属或合作关系。当前支持桌面浏览器，不支持直播和第三方网站中的嵌入播放器。

## 权限用途及审核备注

- 单一用途：增强 B 站网页播放器的倍速选择。
- `content_scripts.matches = https://www.bilibili.com/*`：自动识别主站播放器及站内路由切换。页面类型通过脚本进一步限制，其他主站页面不增强界面。匹配整个主站是为了支持从首页站内跳转到播放页。
- `storage`：仅将用户主动添加的快捷倍速数值及图钉指定的默认倍速保存在 `storage.local`，支持本机标签页同步、逐项删除与清空；不使用 `storage.sync`。
- 无其他额外扩展 API 权限，无后台服务，无远程代码、分析 SDK、Cookie 访问或登录信息读取。
- 临时播放倍速仅保存在当前文档内存；只有用户收藏的快捷项和主动固定的默认值会持久保存。不调用播放接口、下载接口或账户接口。
- Firefox 清单声明 `data_collection_permissions.required = ["none"]`。
- 使用 HTMLMediaElement.playbackRate 调整本地播放，原生倍速选项仍由网页原始处理器处理。

**复现步骤**：安装扩展 → 打开任意可正常播放的 B 站普通视频 → 悬停播放器倍速按钮 → 选择 3 倍 → 点击底栏滑杆图标（悬停提示“自定义”）并将滑块拖到 10 倍，点击“确定”→ 确认自动关闭 → 再次打开自定义并拖动到其他倍速后按 Enter → 验证按钮显示和播放速度 → 点击星标收藏 4.2 倍到倍速栏 → 刷新确认快捷项保留且插件不恢复当前播放速度 → 点击保存的 4.2 倍使用 → 点击选中速度左侧图钉固定 → 刷新或新开其他视频确认默认速度 → 删除被固定的自定义项，确认解除固定 → 添加两项后点击底栏垃圾桶图标（悬停提示“清空”），确认原生档位保留且无固定值。另选 3 倍，长按右箭头确认临时 4.5 倍并松开回到 3 倍；选 7 倍长按确认临时 10 倍并松开回到 7 倍；短按仍前进约 5 秒。番剧需使用审核人员所在地区可正常播放的剧集，扩展不改变内容访问权限。

**源码构建**：使用源码 ZIP，Node.js 24 LTS，依次执行 `npm ci`、`npm run build`。不需要密钥、服务端或环境变量。源码 ZIP 中的测试样本为 FFmpeg 自行生成，不含下载的视频媒体。

## 三个商店分别提交

| 商店 | 文件 | 要点 |
| --- | --- | --- |
| Chrome Web Store | `bili-suisu-chrome-1.9.5.zip` | 注册开发者并支付一次性注册费用；填写单一用途、站点访问说明和隐私披露 |
| Microsoft Edge Add-ons | `bili-suisu-edge-1.9.5.zip` | 注册 Partner Center 开发者；填写独立商店文案、隐私政策 URL 和视觉素材 |
| Firefox Add-ons | `bili-suisu-firefox-1.9.5.zip` | 选择公开上架；提交稳定 ID、无数据收集声明及按需提供的可复现源码；获得 Mozilla 签名 |

商店截图应从 `docs/screenshots/` 中选择实际测试成功的页面，不能使用名称含 `failure` 的诊断截图。截图需复核不含账号个人信息，符合商店当前尺寸要求。`assets/store/` 提供独立图标和宣传图，不含 B 站标识；宣传图不能替代真实截图。

上线后先用商店安装版本复核普通视频、番剧和更新流程。用户反馈播放器适配失效时，在原生菜单仍正常的前提下更新适配代码、重新运行测试、递增版本并向三家商店分别送审。

官方参考：

- [Chrome 开发者注册](https://developer.chrome.com/docs/webstore/register/)
- [Chrome 商店发布](https://developer.chrome.com/docs/webstore/publish/)
- [Chrome 图片素材要求](https://developer.chrome.com/docs/webstore/images/)
- [Edge 商店发布](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
- [Firefox 签名与分发](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
- [Firefox 数据声明](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)

- [Chrome 扩展存储权限与 API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Firefox 本地扩展存储](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local)

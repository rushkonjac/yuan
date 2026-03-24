# 渊（Yuan / Abyss）

双人联机战术棋类网页游戏原型：暗子、直线移动、碰撞结算、渊力卡牌与天命、可动的渊心（军旗式核心）等。当前版本聚焦 **与朋友在线测试** 的可玩闭环。

## 技术栈

| 部分 | 说明 |
|------|------|
| 前端 | HTML5 Canvas + 原生 JavaScript（ES Modules），`index.html` 为联机大厅与对局页 |
| 服务端 | Node.js 20+，`express` 托管静态资源，`ws` 处理 WebSocket |
| 实时通信 | 同域 `wss`，推荐路径 `/ws`（根路径 `/` 仍兼容 Upgrade） |

## 快速开始（本地）

```bash
cd yuan
npm install
npm start
```

浏览器打开 **http://127.0.0.1:3000**（若本机 `localhost` 解析到 IPv6 导致异常，请优先使用 `127.0.0.1`）。

**两人联机测试**：开两个标签页或两台设备；一人 **创建房间** 得到 4 位房间码，另一人 **加入房间**。

## 部署（Render 等）

1. 仓库根目录即为 `yuan`（或把 Render Root Directory 指到 `yuan`）。
2. **Build**：`npm install`（若平台需要可写 `npm ci`）。
3. **Start**：`npm start`（即 `node server/index.js`）。
4. **端口**：读取环境变量 `PORT`（Render 会自动注入）。

健康检查可配置为：`GET /health` → `{"status":"ok",...}`。

> **Render 免费实例** 冷休眠后首次访问会较慢；前端会先轮询 `/health` 再建立 WebSocket。PC 若长期停在「连接中」，请 **强制刷新**（Ctrl+Shift+R）并尽量关闭可能拦截 WebSocket 的扩展。

## 项目结构

```
yuan/
├── index.html          # 联机客户端（大厅 + 对局 UI）
├── package.json
├── server/
│   ├── index.js        # HTTP + WebSocket 入口、房间 create/join
│   └── room.js         # 房间与对局消息转发
└── src/
    ├── types.js        # 常量、棋子/卡牌池、棋盘配置
    ├── game.js         # 对局状态机
    ├── movement.js     # 移动路径、同回合执行与碰撞检测
    ├── collision.js    # 碰撞结算
    ├── renderer.js     # Canvas 绘制
    └── network.js      # 浏览器端 WebSocket 封装
```

## 玩法概要（极简）

- **棋盘**：7×9，固定地形（暗礁、洋流、裂隙等）。
- **部署**：双方同时部署；全部部署完成前 **看不到对方棋子位置**。
- **回合**：选牌 → 部署（首局）→ 指令（点击棋子高亮可达格，再点格移动）→ 同步执行移动与碰撞。
- **体型**：碰撞后按规则改变 **bodySize**，并 **真实占据多格**（蛇身式延伸）；移动时整段一起平移。
- **胜利**：摧毁对方渊心或达到回合限制后的判定（见 `game.js`）。

详细数值与卡牌效果以 `src/types.js` 与对局逻辑为准。

## 开发说明

- 修改 `src/*.js` 后刷新浏览器即可（ESM 直连，无打包步骤）。
- WebSocket 消息为 JSON：`{ event: "..." }` 下行，`{ action: "..." }` 上行；具体字段见 `server/room.js` 与 `index.html` 中的 `net.send` / `net.on`。

## 许可证

未指定默认许可证；如需开源请自行补充 `LICENSE`。

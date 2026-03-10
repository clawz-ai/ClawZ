/** Per-channel setup guide content with i18n support (zh-CN / en-US). */

export interface GuideStep {
  title: string;
  /** Supports markdown-style links [text](url) and images ![alt](url) */
  content: string;
  /** Optional image URL shown below the step content */
  image?: string;
  /** Optional action button rendered below the content */
  action?: {
    id: string;
    label: string;
  };
  /** Text shown after the action button */
  afterAction?: string;
}

export interface ChannelGuide {
  title: string;
  intro: string;
  steps: GuideStep[];
  tips?: string[];
  docUrl?: string; // OpenClaw official doc link for this channel
}

/* ---------- Chinese (zh-CN) ---------- */

export const CHANNEL_GUIDES_ZH: Record<string, ChannelGuide> = {
  telegram: {
    title: "Telegram Bot 配置指南",
    intro:
      "Telegram 是最快速的接入渠道之一，只需创建 Bot、获取 Token 并填写允许的用户 ID 即可。",
    docUrl: "https://docs.openclaw.ai/channels/telegram",
    steps: [
      {
        title: "1. 创建 Bot",
        content:
          '在 Telegram 中搜索 [@BotFather](https://t.me/BotFather) 并发送 /newbot 命令。按提示输入 Bot 名称和用户名（需以 "bot" 结尾）。',
      },
      {
        title: "2. 获取 Token",
        content:
          "创建成功后 BotFather 会返回一个 Bot Token（格式如 123456:ABC-DEF...），复制并粘贴到上方输入框。",
      },
      {
        title: "3. 获取你的用户 ID",
        content:
          "在 Telegram 中搜索 [@userinfobot](https://t.me/userinfobot) 并发送任意消息，它会回复你的数字用户 ID（如 123456789）。将此 ID 填入「允许私聊的用户 ID」输入框，多个 ID 用逗号分隔。",
      },
      {
        title: "4. 添加到群组（可选）",
        content:
          "将 Bot 添加到群组后，默认需要 @mention 才会响应。如需接收所有消息，请在 BotFather 中通过 /setprivacy 关闭隐私模式。",
      },
    ],
    tips: [
      "也可以转发消息给 @userinfobot 来获取其他用户的 ID",
      "关闭隐私模式后需要将 Bot 移出再重新添加到群组才能生效",
      "可通过 /setjoingroups 控制 Bot 是否允许被添加到群组",
      "群组中默认需要 @mention 才触发回复，可在配置中修改",
    ],
  },

  discord: {
    title: "Discord Bot 配置指南",
    intro: "通过 Discord Developer Portal 创建应用并获取 Bot Token。",
    docUrl: "https://docs.openclaw.ai/channels/discord",
    steps: [
      {
        title: "1. 创建应用",
        content:
          '访问 [Discord Developer Portal](https://discord.com/developers/applications)，点击 "New Application" 创建应用。',
      },
      {
        title: "2. 创建 Bot 并获取 Token",
        content:
          '进入应用设置的 "Bot" 页面，点击 "Reset Token" 生成 Bot Token，复制粘贴到上方输入框。',
      },
      {
        title: "3. 开启必要权限",
        content:
          "在 Bot 设置中开启 Message Content Intent（必须）和 Server Members Intent（推荐）。",
      },
      {
        title: "4. 邀请 Bot 到服务器",
        content:
          '在 OAuth2 → URL Generator 中勾选 "bot" 和 "applications.commands"，权限选择 Send Messages、Read Message History、Embed Links 等，生成链接并邀请到服务器。',
      },
      {
        title: "5. 获取你的用户 ID",
        content:
          "开启 Developer Mode（用户设置 → 高级），然后右键点击自己的头像选择「复制用户 ID」，将 ID 填入「允许私聊的用户 ID」输入框。",
      },
    ],
    tips: [
      "必须开启 Message Content Intent 否则 Bot 收不到消息内容",
      "开启 Developer Mode 后可右键复制任意用户/服务器/频道的 ID",
      "Bot Token 应妥善保管，泄露后可在 Developer Portal 重置",
    ],
  },

  slack: {
    title: "Slack App 配置指南",
    intro:
      "Slack 集成需要创建一个 Slack App，获取 Bot Token 和 App Token 两个凭据。推荐使用 Socket Mode。",
    steps: [
      {
        title: "1. 创建 Slack App",
        content:
          '访问 api.slack.com/apps，点击 "Create New App" → "From scratch"，输入名称并选择工作区。',
      },
      {
        title: "2. 开启 Socket Mode",
        content:
          '在左侧菜单 "Socket Mode" 中启用，系统会要求创建一个 App-Level Token（xapp-...），勾选 connections:write 权限。复制该 Token 填入 App Token 字段。',
      },
      {
        title: "3. 安装到工作区",
        content:
          '在 "Install App" 页面安装到工作区，获取 Bot Token（xoxb-...），复制填入 Bot Token 字段。',
      },
      {
        title: "4. 配置事件订阅",
        content:
          '在 "Event Subscriptions" 中订阅以下 Bot Events：app_mention、message.channels、message.groups、message.im、message.mpim。在 "App Home" 中启用 Messages Tab。',
      },
      {
        title: "5. 配置权限",
        content:
          "在 OAuth & Permissions 中确认 Bot 至少有以下 Scope：chat:write、channels:history、groups:history、im:history、app_mentions:read、reactions:read。",
      },
    ],
    tips: [
      "Socket Mode 无需公网 URL，适合本地开发和内网部署",
      "修改权限后需要重新安装 App 到工作区",
      "频道中默认需要 @mention 才触发回复",
    ],
  },

  feishu: {
    title: "飞书机器人配置指南",
    intro:
      "飞书集成通过 WebSocket 长连接接收事件，无需公网 Webhook。需要在飞书开放平台创建企业自建应用。",
    docUrl: "https://docs.openclaw.ai/channels/feishu",
    steps: [
      {
        title: "1. 创建企业自建应用",
        content:
          '访问 [open.feishu.cn/app](https://open.feishu.cn/app)（Lark 国际版使用 [open.larksuite.com/app](https://open.larksuite.com/app)），点击 "创建企业自建应用"，填写名称、描述和图标。',
        image:
          "https://mintcdn.com/clawdhub/6NERQ7Dymau_gJ4k/images/feishu-step2-create-app.png?fit=max&auto=format&n=6NERQ7Dymau_gJ4k&q=85&s=a3d0a511fea278250c353f5c33f03584",
      },
      {
        title: "2. 获取凭据",
        content:
          '在 "凭证与基础信息" 页面复制 App ID（格式 cli_xxx）和 App Secret，分别填入上方的两个输入框。',
        image:
          "https://mintcdn.com/clawdhub/6NERQ7Dymau_gJ4k/images/feishu-step3-credentials.png?fit=max&auto=format&n=6NERQ7Dymau_gJ4k&q=85&s=3a6ac22e96d76e4b85a1171ea207608b",
      },
      {
        title: "3. 配置权限",
        content:
          '在 "权限管理" 中点击「批量开通」，将以下 JSON 粘贴导入所需权限：\n\n`{"scopes":{"tenant":["aily:file:read","aily:file:write","application:application.app_message_stats.overview:readonly","application:application:self_manage","application:bot.menu:write","cardkit:card:read","cardkit:card:write","contact:user.employee_id:readonly","corehr:file:download","event:ip_list","im:chat.access_event.bot_p2p_chat:read","im:chat.members:bot_access","im:message","im:message.group_at_msg:readonly","im:message.p2p_msg:readonly","im:message:readonly","im:message:send_as_bot","im:resource"],"user":["aily:file:read","aily:file:write","im:chat.access_event.bot_p2p_chat:read"]}}`',
        image:
          "https://mintcdn.com/clawdhub/6NERQ7Dymau_gJ4k/images/feishu-step4-permissions.png?fit=max&auto=format&n=6NERQ7Dymau_gJ4k&q=85&s=a386d201628f65771d9d423056d9dc59",
      },
      {
        title: "4. 启用机器人能力",
        content:
          '在 "应用能力" → "机器人" 中启用机器人功能，设置机器人名称。',
        image:
          "https://mintcdn.com/clawdhub/6NERQ7Dymau_gJ4k/images/feishu-step5-bot-capability.png?fit=max&auto=format&n=6NERQ7Dymau_gJ4k&q=85&s=4c330500fd7db2e72569dc2a379697ee",
      },
      {
        title: "5. 配置事件订阅",
        content:
          '⚠️ 重要：配置事件订阅前，必须先将飞书渠道配置写入 OpenClaw 并启动网关，否则飞书开放平台无法验证长连接。请先点击下方按钮完成配置。',
        action: {
          id: "save-and-start-gateway",
          label: "保存渠道配置并启动网关",
        },
        afterAction:
          '完成后，再到飞书开放平台的「事件订阅」中选择「使用长连接接收事件」，然后添加 im.message.receive_v1 事件。',
        image:
          "https://mintcdn.com/clawdhub/6NERQ7Dymau_gJ4k/images/feishu-step6-event-subscription.png?fit=max&auto=format&n=6NERQ7Dymau_gJ4k&q=85&s=00aeb4809d9df159d846e0be19bc871e",
      },
      {
        title: "6. 发布应用",
        content:
          '在 "版本管理与发布" 中创建版本并提交审核。企业自建应用通常会自动通过审核。',
      },
    ],
    tips: [
      '使用 Lark 国际版时需额外配置 `domain: "lark"`',
      "App Secret 请妥善保管，泄露后需在开放平台重置并更新本地配置",
      '支持流式回复：在配置中设置 `streaming: true`',
    ],
  },

  whatsapp: {
    title: "WhatsApp 配置指南",
    intro:
      "WhatsApp 通过 Baileys 库连接，需要扫描二维码完成登录，无需额外 Token。",
    steps: [
      {
        title: "1. 运行登录命令",
        content:
          "在终端运行 openclaw channels login --channel whatsapp，屏幕上会显示一个二维码。",
      },
      {
        title: "2. 扫描二维码",
        content:
          '打开手机 WhatsApp → 设置 → 已关联的设备 → 关联设备，扫描终端中显示的二维码。',
      },
      {
        title: "3. 等待连接",
        content:
          "扫码成功后终端会显示连接成功信息。会话状态保存在本地磁盘。",
      },
    ],
    tips: [
      "WhatsApp 会话数据较多，存储在 ~/.openclaw/ 目录下",
      "如需断开连接：openclaw channels logout --channel whatsapp",
      "默认 dmPolicy 为 pairing，首次对话需要批准配对码",
    ],
  },

  signal: {
    title: "Signal 配置指南",
    intro: "Signal 通过 signal-cli 工具连接，需要提供已注册的手机号和 HTTP 服务地址。",
    steps: [
      {
        title: "1. 安装 signal-cli",
        content:
          "通过 Homebrew 安装：brew install signal-cli，或从 GitHub 下载。",
      },
      {
        title: "2. 注册/关联账号",
        content:
          "使用 signal-cli -u +手机号 register 注册，或 signal-cli -u +手机号 link 关联已有账号。",
      },
      {
        title: "3. 启动 HTTP 守护进程",
        content:
          "运行 signal-cli -u +手机号 daemon --http=127.0.0.1:8080，保持后台运行。",
      },
      {
        title: "4. 填写配置",
        content:
          "将手机号填入上方「手机号码」（如 +8613800138000），HTTP URL 填入 http://127.0.0.1:8080。",
      },
    ],
    tips: [
      "signal-cli 默认使用端口 8080",
      "OpenClaw 支持 autoStart 选项自动启动 signal-cli 守护进程",
    ],
  },

  imessage: {
    title: "iMessage 配置指南",
    intro:
      "iMessage 通过 macOS 原生接口连接，无需额外配置。仅限 macOS 系统。",
    steps: [
      {
        title: "1. 确认系统要求",
        content:
          "需要 macOS 系统，且已登录 iMessage 账号（系统设置 → 信息）。",
      },
      {
        title: "2. 授权全盘访问",
        content:
          "OpenClaw 需要「全盘访问」权限才能读取信息数据库。在系统设置 → 隐私与安全性 → 全盘访问 中添加 OpenClaw/终端应用。",
      },
      {
        title: "3. 启用渠道",
        content:
          '点击上方 "启用 iMessage" 按钮即可。',
      },
    ],
    tips: [
      "这是旧版集成方式，新项目推荐使用 BlueBubbles",
      "需要授予全盘访问权限才能读取 Messages 数据库",
    ],
  },

  msteams: {
    title: "Microsoft Teams 配置指南",
    intro:
      "通过 Azure Bot Framework 连接 Microsoft Teams，需要在 Azure Portal 注册 Bot。",
    steps: [
      {
        title: "1. 注册 Azure Bot",
        content:
          '在 Azure Portal 中创建 "Azure Bot" 资源，选择多租户类型，记录 App ID。',
      },
      {
        title: "2. 获取 App Password",
        content:
          '在 Bot 资源的 "配置" → "管理密码" 中创建 Client Secret，复制作为 App Password。',
      },
      {
        title: "3. 配置 Teams 渠道",
        content:
          '在 Bot 资源的 "渠道" 页面添加 Microsoft Teams 渠道。',
      },
      {
        title: "4. 安装到 Teams",
        content:
          "将 Bot 打包为 Teams App 并上传到 Teams 管理中心或直接侧载安装。",
      },
    ],
    tips: [
      "需要安装插件：openclaw plugins install @openclaw/msteams",
      "App Password 创建后只显示一次，请立即复制保存",
      "单租户 Bot 需要额外配置 tenantId",
    ],
  },

  matrix: {
    title: "Matrix 配置指南",
    intro: "连接到 Matrix 去中心化通讯网络，支持任何兼容的 Homeserver。",
    steps: [
      {
        title: "1. 准备 Bot 账号",
        content:
          "在目标 Homeserver 上注册一个用于 Bot 的账号（如 @mybot:matrix.org）。",
      },
      {
        title: "2. 填写配置",
        content:
          "将 Homeserver URL、用户 ID 和密码分别填入上方输入框。",
      },
      {
        title: "3. 邀请 Bot 到房间",
        content:
          "在 Matrix 客户端中邀请 Bot 账号加入目标房间。",
      },
    ],
    tips: [
      "需要安装插件：openclaw plugins install @openclaw/matrix",
      "推荐为 Bot 创建专用账号，不要使用个人账号",
    ],
  },

  googlechat: {
    title: "Google Chat 配置指南",
    intro: "通过 Google Cloud 服务账号和 HTTP Webhook 连接 Google Chat。",
    steps: [
      {
        title: "1. 创建 GCP 项目",
        content:
          "在 Google Cloud Console 中创建项目，启用 Chat API。",
      },
      {
        title: "2. 创建服务账号",
        content:
          '在 IAM → 服务账号中创建新账号，下载 JSON 密钥文件。将 JSON 内容粘贴到 "Service Account JSON" 字段。',
      },
      {
        title: "3. 配置 Chat App",
        content:
          "在 Chat API 配置中创建应用，设置 Webhook URL 指向 OpenClaw 网关地址。",
      },
      {
        title: "4. 填写 Audience",
        content:
          "将 GCP 项目编号或应用 URL 填入 Audience 字段。",
      },
    ],
    tips: [
      "Service Account JSON 包含敏感凭据，请妥善保管",
      "Audience 类型默认为 project-number，也可设置为 app-url",
    ],
  },

  mattermost: {
    title: "Mattermost 配置指南",
    intro: "通过 Bot API 和 WebSocket 连接自托管的 Mattermost 服务。",
    steps: [
      {
        title: "1. 创建 Bot 账号",
        content:
          '在 Mattermost 管理后台 → Integrations → Bot Accounts 中创建 Bot，记录生成的 Token。',
      },
      {
        title: "2. 配置 Token",
        content: "将 Bot Token 粘贴到上方输入框。",
      },
    ],
    tips: [
      "需要安装插件：openclaw plugins install @openclaw/mattermost",
      "确保 Mattermost 实例允许 Bot 账号的 WebSocket 连接",
    ],
  },

  line: {
    title: "LINE 配置指南",
    intro: "通过 LINE Messaging API 连接，需要在 LINE Developers 创建 Channel。",
    steps: [
      {
        title: "1. 创建 Provider 和 Channel",
        content:
          '访问 developers.line.biz/console，创建 Provider，再创建 "Messaging API" 类型的 Channel。',
      },
      {
        title: "2. 获取 Channel Access Token",
        content:
          '在 Channel 设置的 "Messaging API" 标签页中，点击 "Issue" 生成长期 Channel Access Token。',
      },
      {
        title: "3. 配置 Webhook",
        content:
          "将 OpenClaw 网关的公网地址配置为 Webhook URL。",
      },
    ],
    tips: [
      "需要安装插件：openclaw plugins install @openclaw/line",
      "Channel Access Token 可多次重新生成",
    ],
  },

  nostr: {
    title: "Nostr 配置指南",
    intro: "连接到 Nostr 去中心化社交网络，通过 NIP-04 加密私信通信。",
    steps: [
      {
        title: "1. 生成密钥对",
        content:
          "使用任意 Nostr 客户端或工具生成 nsec 私钥。",
      },
      {
        title: "2. 配置私钥",
        content: "将 nsec 格式的私钥粘贴到上方输入框。",
      },
    ],
    tips: [
      "需要安装插件：openclaw plugins install @openclaw/nostr",
      "私钥是你在 Nostr 网络上的唯一身份凭证，切勿泄露",
    ],
  },

  irc: {
    title: "IRC 配置指南",
    intro: "连接到 IRC 服务器，支持频道和私信。",
    steps: [
      {
        title: "1. 选择 IRC 服务器",
        content:
          "填入 IRC 服务器地址，如 irc.libera.chat（Libera.Chat）或其他服务器。",
      },
      {
        title: "2. 设置昵称",
        content:
          "为 Bot 设置一个唯一的 IRC 昵称。",
      },
      {
        title: "3. 加入频道（可选）",
        content:
          '启动后可在 openclaw.json 中配置 channels 数组（如 ["#mychannel"]）自动加入频道。',
      },
    ],
    tips: [
      "默认使用 TLS 加密连接（端口 6697）",
      "可配置 NickServ 密码进行身份认证",
    ],
  },
};

/* ---------- English (en-US) ---------- */

export const CHANNEL_GUIDES_EN: Record<string, ChannelGuide> = {
  telegram: {
    title: "Telegram Bot Setup Guide",
    intro:
      "Telegram is one of the quickest channels to set up. Just create a Bot, get the Token, and enter allowed user IDs.",
    docUrl: "https://docs.openclaw.ai/channels/telegram",
    steps: [
      {
        title: "1. Create a Bot",
        content:
          'Search for [@BotFather](https://t.me/BotFather) in Telegram and send the /newbot command. Follow the prompts to set a Bot name and username (must end with "bot").',
      },
      {
        title: "2. Get the Token",
        content:
          "After creation, BotFather will return a Bot Token (format: 123456:ABC-DEF...). Copy and paste it into the input field above.",
      },
      {
        title: "3. Get Your User ID",
        content:
          "Search for [@userinfobot](https://t.me/userinfobot) in Telegram and send any message. It will reply with your numeric user ID (e.g. 123456789). Enter this ID in the \"Allowed DM User IDs\" field. Separate multiple IDs with commas.",
      },
      {
        title: "4. Add to a Group (Optional)",
        content:
          "After adding the Bot to a group, it only responds to @mentions by default. To receive all messages, disable privacy mode via /setprivacy in BotFather.",
      },
    ],
    tips: [
      "You can also forward a message to @userinfobot to get another user's ID",
      "After disabling privacy mode, remove and re-add the Bot to the group for the change to take effect",
      "Use /setjoingroups to control whether the Bot can be added to groups",
      "In groups, @mention is required by default to trigger a reply; this can be changed in the config",
    ],
  },

  discord: {
    title: "Discord Bot Setup Guide",
    intro: "Create an application and obtain a Bot Token via the Discord Developer Portal.",
    docUrl: "https://docs.openclaw.ai/channels/discord",
    steps: [
      {
        title: "1. Create an Application",
        content:
          'Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click "New Application" to create one.',
      },
      {
        title: "2. Create a Bot and Get the Token",
        content:
          'Navigate to the "Bot" page in your application settings, click "Reset Token" to generate a Bot Token, and paste it into the input field above.',
      },
      {
        title: "3. Enable Required Intents",
        content:
          "In the Bot settings, enable Message Content Intent (required) and Server Members Intent (recommended).",
      },
      {
        title: "4. Invite the Bot to Your Server",
        content:
          'In OAuth2 > URL Generator, check "bot" and "applications.commands". Select permissions such as Send Messages, Read Message History, and Embed Links. Generate the link and invite the Bot to your server.',
      },
      {
        title: "5. Get Your User ID",
        content:
          'Enable Developer Mode (User Settings > Advanced), then right-click your avatar and select "Copy User ID". Enter this ID in the "Allowed DM User IDs" field.',
      },
    ],
    tips: [
      "Message Content Intent must be enabled, otherwise the Bot cannot read message content",
      "With Developer Mode on, you can right-click to copy any user/server/channel ID",
      "Keep your Bot Token safe; if leaked, reset it in the Developer Portal",
    ],
  },

  slack: {
    title: "Slack App Setup Guide",
    intro:
      "Slack integration requires creating a Slack App and obtaining both a Bot Token and an App Token. Socket Mode is recommended.",
    steps: [
      {
        title: "1. Create a Slack App",
        content:
          'Go to api.slack.com/apps, click "Create New App" > "From scratch", enter a name and select your workspace.',
      },
      {
        title: "2. Enable Socket Mode",
        content:
          'Under "Socket Mode" in the left menu, enable it. You will be prompted to create an App-Level Token (xapp-...) with the connections:write scope. Copy that token into the App Token field.',
      },
      {
        title: "3. Install to Workspace",
        content:
          'On the "Install App" page, install the app to your workspace and get the Bot Token (xoxb-...). Paste it into the Bot Token field.',
      },
      {
        title: "4. Configure Event Subscriptions",
        content:
          'Under "Event Subscriptions", subscribe to these Bot Events: app_mention, message.channels, message.groups, message.im, message.mpim. Under "App Home", enable the Messages Tab.',
      },
      {
        title: "5. Configure Permissions",
        content:
          "Under OAuth & Permissions, ensure the Bot has at least these scopes: chat:write, channels:history, groups:history, im:history, app_mentions:read, reactions:read.",
      },
    ],
    tips: [
      "Socket Mode does not require a public URL, making it ideal for local development and private networks",
      "After changing permissions, you need to reinstall the app to your workspace",
      "In channels, @mention is required by default to trigger a reply",
    ],
  },

  feishu: {
    title: "Feishu / Lark Bot Setup Guide",
    intro:
      "Feishu integration receives events via WebSocket, so no public Webhook is needed. You need to create a custom enterprise app on the Feishu Open Platform.",
    docUrl: "https://docs.openclaw.ai/channels/feishu",
    steps: [
      {
        title: "1. Create a Custom Enterprise App",
        content:
          'Go to [open.feishu.cn/app](https://open.feishu.cn/app) (for Lark international, use [open.larksuite.com/app](https://open.larksuite.com/app)), click "Create Custom App", and fill in the name, description, and icon.',
        image:
          "https://mintcdn.com/clawdhub/6NERQ7Dymau_gJ4k/images/feishu-step2-create-app.png?fit=max&auto=format&n=6NERQ7Dymau_gJ4k&q=85&s=a3d0a511fea278250c353f5c33f03584",
      },
      {
        title: "2. Get Credentials",
        content:
          'On the "Credentials & Basic Info" page, copy the App ID (format: cli_xxx) and App Secret, and paste them into the two input fields above.',
        image:
          "https://mintcdn.com/clawdhub/6NERQ7Dymau_gJ4k/images/feishu-step3-credentials.png?fit=max&auto=format&n=6NERQ7Dymau_gJ4k&q=85&s=3a6ac22e96d76e4b85a1171ea207608b",
      },
      {
        title: "3. Configure Permissions",
        content:
          'Under "Permissions", click "Batch Enable" and paste the following JSON to import the required permissions:\n\n`{"scopes":{"tenant":["aily:file:read","aily:file:write","application:application.app_message_stats.overview:readonly","application:application:self_manage","application:bot.menu:write","cardkit:card:read","cardkit:card:write","contact:user.employee_id:readonly","corehr:file:download","event:ip_list","im:chat.access_event.bot_p2p_chat:read","im:chat.members:bot_access","im:message","im:message.group_at_msg:readonly","im:message.p2p_msg:readonly","im:message:readonly","im:message:send_as_bot","im:resource"],"user":["aily:file:read","aily:file:write","im:chat.access_event.bot_p2p_chat:read"]}}`',
        image:
          "https://mintcdn.com/clawdhub/6NERQ7Dymau_gJ4k/images/feishu-step4-permissions.png?fit=max&auto=format&n=6NERQ7Dymau_gJ4k&q=85&s=a386d201628f65771d9d423056d9dc59",
      },
      {
        title: "4. Enable Bot Capability",
        content:
          'Under "App Capabilities" > "Bot", enable the bot feature and set the bot name.',
        image:
          "https://mintcdn.com/clawdhub/6NERQ7Dymau_gJ4k/images/feishu-step5-bot-capability.png?fit=max&auto=format&n=6NERQ7Dymau_gJ4k&q=85&s=4c330500fd7db2e72569dc2a379697ee",
      },
      {
        title: "5. Configure Event Subscriptions",
        content:
          "⚠️ Important: Before configuring event subscriptions, you must first save the Feishu channel config to OpenClaw and start the gateway. Otherwise, the Feishu Open Platform cannot verify the WebSocket connection. Click the button below to complete the setup first.",
        action: {
          id: "save-and-start-gateway",
          label: "Save Channel Config & Start Gateway",
        },
        afterAction:
          'Once done, go to "Event Subscriptions" on the Feishu Open Platform, select "Use long connection to receive events", then add the im.message.receive_v1 event.',
        image:
          "https://mintcdn.com/clawdhub/6NERQ7Dymau_gJ4k/images/feishu-step6-event-subscription.png?fit=max&auto=format&n=6NERQ7Dymau_gJ4k&q=85&s=00aeb4809d9df159d846e0be19bc871e",
      },
      {
        title: "6. Publish the App",
        content:
          'Under "Version Management & Release", create a version and submit for review. Custom enterprise apps are usually approved automatically.',
      },
    ],
    tips: [
      'For Lark international, add `domain: "lark"` to the config',
      "Keep your App Secret safe; if compromised, reset it on the Open Platform and update the local config",
      'Streaming replies are supported: set `streaming: true` in the config',
    ],
  },

  whatsapp: {
    title: "WhatsApp Setup Guide",
    intro:
      "WhatsApp connects via the Baileys library. You need to scan a QR code to log in; no additional Token is required.",
    steps: [
      {
        title: "1. Run the Login Command",
        content:
          "Run openclaw channels login --channel whatsapp in your terminal. A QR code will be displayed on screen.",
      },
      {
        title: "2. Scan the QR Code",
        content:
          "Open WhatsApp on your phone > Settings > Linked Devices > Link a Device, and scan the QR code shown in the terminal.",
      },
      {
        title: "3. Wait for Connection",
        content:
          "After a successful scan, the terminal will show a connection success message. Session data is saved to local disk.",
      },
    ],
    tips: [
      "WhatsApp session data is stored in the ~/.openclaw/ directory",
      "To disconnect: openclaw channels logout --channel whatsapp",
      "Default dmPolicy is pairing; the first conversation requires approving a pairing code",
    ],
  },

  signal: {
    title: "Signal Setup Guide",
    intro: "Signal connects via the signal-cli tool. You need a registered phone number and an HTTP service address.",
    steps: [
      {
        title: "1. Install signal-cli",
        content:
          "Install via Homebrew: brew install signal-cli, or download from GitHub.",
      },
      {
        title: "2. Register or Link an Account",
        content:
          "Use signal-cli -u +phonenumber register to register, or signal-cli -u +phonenumber link to link an existing account.",
      },
      {
        title: "3. Start the HTTP Daemon",
        content:
          "Run signal-cli -u +phonenumber daemon --http=127.0.0.1:8080 and keep it running in the background.",
      },
      {
        title: "4. Fill in the Config",
        content:
          'Enter your phone number in the "Phone Number" field above (e.g. +15551234567), and set the HTTP URL to http://127.0.0.1:8080.',
      },
    ],
    tips: [
      "signal-cli uses port 8080 by default",
      "OpenClaw supports the autoStart option to automatically launch the signal-cli daemon",
    ],
  },

  imessage: {
    title: "iMessage Setup Guide",
    intro:
      "iMessage connects via native macOS APIs and requires no additional configuration. macOS only.",
    steps: [
      {
        title: "1. Check System Requirements",
        content:
          "Requires macOS with an iMessage account signed in (System Settings > Messages).",
      },
      {
        title: "2. Grant Full Disk Access",
        content:
          "OpenClaw needs Full Disk Access to read the Messages database. Go to System Settings > Privacy & Security > Full Disk Access and add OpenClaw or your terminal app.",
      },
      {
        title: "3. Enable the Channel",
        content:
          'Click the "Enable iMessage" button above.',
      },
    ],
    tips: [
      "This is a legacy integration; for new projects, BlueBubbles is recommended",
      "Full Disk Access permission is required to read the Messages database",
    ],
  },

  msteams: {
    title: "Microsoft Teams Setup Guide",
    intro:
      "Connect to Microsoft Teams via Azure Bot Framework. You need to register a Bot in the Azure Portal.",
    steps: [
      {
        title: "1. Register an Azure Bot",
        content:
          'Create an "Azure Bot" resource in the Azure Portal, select the multi-tenant type, and note the App ID.',
      },
      {
        title: "2. Get the App Password",
        content:
          'Under the Bot resource\'s "Configuration" > "Manage Password", create a Client Secret and copy it as the App Password.',
      },
      {
        title: "3. Configure the Teams Channel",
        content:
          'On the Bot resource\'s "Channels" page, add the Microsoft Teams channel.',
      },
      {
        title: "4. Install to Teams",
        content:
          "Package the Bot as a Teams App and upload it to the Teams Admin Center or sideload it directly.",
      },
    ],
    tips: [
      "Plugin required: openclaw plugins install @openclaw/msteams",
      "The App Password is only shown once after creation; copy it immediately",
      "Single-tenant Bots require an additional tenantId configuration",
    ],
  },

  matrix: {
    title: "Matrix Setup Guide",
    intro: "Connect to the Matrix decentralized communication network. Works with any compatible Homeserver.",
    steps: [
      {
        title: "1. Prepare a Bot Account",
        content:
          "Register a Bot account on your target Homeserver (e.g. @mybot:matrix.org).",
      },
      {
        title: "2. Fill in the Config",
        content:
          "Enter the Homeserver URL, user ID, and password in the input fields above.",
      },
      {
        title: "3. Invite the Bot to a Room",
        content:
          "In your Matrix client, invite the Bot account to the target room.",
      },
    ],
    tips: [
      "Plugin required: openclaw plugins install @openclaw/matrix",
      "It is recommended to create a dedicated account for the Bot instead of using a personal one",
    ],
  },

  googlechat: {
    title: "Google Chat Setup Guide",
    intro: "Connect to Google Chat via a Google Cloud service account and HTTP Webhook.",
    steps: [
      {
        title: "1. Create a GCP Project",
        content:
          "Create a project in Google Cloud Console and enable the Chat API.",
      },
      {
        title: "2. Create a Service Account",
        content:
          'Under IAM > Service Accounts, create a new account and download the JSON key file. Paste the JSON content into the "Service Account JSON" field.',
      },
      {
        title: "3. Configure the Chat App",
        content:
          "In the Chat API configuration, create an app and set the Webhook URL to your OpenClaw gateway address.",
      },
      {
        title: "4. Fill in the Audience",
        content:
          "Enter your GCP project number or app URL in the Audience field.",
      },
    ],
    tips: [
      "The Service Account JSON contains sensitive credentials; keep it safe",
      "Audience type defaults to project-number but can also be set to app-url",
    ],
  },

  mattermost: {
    title: "Mattermost Setup Guide",
    intro: "Connect to a self-hosted Mattermost instance via the Bot API and WebSocket.",
    steps: [
      {
        title: "1. Create a Bot Account",
        content:
          "In the Mattermost admin panel, go to Integrations > Bot Accounts, create a Bot, and note the generated Token.",
      },
      {
        title: "2. Configure the Token",
        content: "Paste the Bot Token into the input field above.",
      },
    ],
    tips: [
      "Plugin required: openclaw plugins install @openclaw/mattermost",
      "Ensure your Mattermost instance allows WebSocket connections for Bot accounts",
    ],
  },

  line: {
    title: "LINE Setup Guide",
    intro: "Connect via the LINE Messaging API. You need to create a Channel in LINE Developers.",
    steps: [
      {
        title: "1. Create a Provider and Channel",
        content:
          'Go to developers.line.biz/console, create a Provider, then create a "Messaging API" type Channel.',
      },
      {
        title: "2. Get the Channel Access Token",
        content:
          'On the Channel settings "Messaging API" tab, click "Issue" to generate a long-lived Channel Access Token.',
      },
      {
        title: "3. Configure the Webhook",
        content:
          "Set the Webhook URL to the public address of your OpenClaw gateway.",
      },
    ],
    tips: [
      "Plugin required: openclaw plugins install @openclaw/line",
      "The Channel Access Token can be reissued multiple times",
    ],
  },

  nostr: {
    title: "Nostr Setup Guide",
    intro: "Connect to the Nostr decentralized social network via NIP-04 encrypted direct messages.",
    steps: [
      {
        title: "1. Generate a Key Pair",
        content:
          "Use any Nostr client or tool to generate an nsec private key.",
      },
      {
        title: "2. Configure the Private Key",
        content: "Paste your nsec-format private key into the input field above.",
      },
    ],
    tips: [
      "Plugin required: openclaw plugins install @openclaw/nostr",
      "Your private key is your sole identity credential on the Nostr network; never share it",
    ],
  },

  irc: {
    title: "IRC Setup Guide",
    intro: "Connect to an IRC server with support for channels and private messages.",
    steps: [
      {
        title: "1. Choose an IRC Server",
        content:
          "Enter the IRC server address, e.g. irc.libera.chat (Libera.Chat) or another server.",
      },
      {
        title: "2. Set a Nickname",
        content:
          "Choose a unique IRC nickname for the Bot.",
      },
      {
        title: "3. Join Channels (Optional)",
        content:
          'After starting, you can configure a channels array (e.g. ["#mychannel"]) in openclaw.json to auto-join channels.',
      },
    ],
    tips: [
      "TLS-encrypted connections are used by default (port 6697)",
      "NickServ password can be configured for identity authentication",
    ],
  },
};

/* ---------- Locale resolver ---------- */

/**
 * Returns the channel guide for the given channel ID and locale.
 * Chinese locales (zh-*) get the Chinese version; everything else gets English.
 */
export function getChannelGuide(
  channelId: string,
  locale: string,
): ChannelGuide | undefined {
  const guides = locale.startsWith("zh") ? CHANNEL_GUIDES_ZH : CHANNEL_GUIDES_EN;
  return guides[channelId];
}

/* ---------- Backward compatibility ---------- */

/** @deprecated Use `getChannelGuide(channelId, locale)` instead. */
export const CHANNEL_GUIDES = CHANNEL_GUIDES_ZH;

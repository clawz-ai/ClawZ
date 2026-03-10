// Provider logos
import openaiLogo from "../assets/logos/providers/openai.svg";
import claudeLogo from "../assets/logos/providers/claude.svg";
import minimaxLogo from "../assets/logos/providers/minimax.svg";
import zhipuLogo from "../assets/logos/providers/zhipu.svg";
import qwenLogo from "../assets/logos/providers/qwen.svg";
import deepseekLogo from "../assets/logos/providers/deepseek.svg";
import moonshotLogo from "../assets/logos/providers/moonshot.svg";
import doubaoLogo from "../assets/logos/providers/doubao.svg";
import githubLogo from "../assets/logos/providers/github.svg";

// Channel logos
import telegramLogo from "../assets/logos/channels/telegram.svg";
import discordLogo from "../assets/logos/channels/discord.svg";
import feishuLogo from "../assets/logos/channels/feishu.svg";
import slackLogo from "../assets/logos/channels/slack.svg";
import whatsappLogo from "../assets/logos/channels/whatsapp.svg";
import signalLogo from "../assets/logos/channels/signal.svg";
import imessageLogo from "../assets/logos/channels/imessage.svg";
import msteamsLogo from "../assets/logos/channels/msteams.svg";
import matrixLogo from "../assets/logos/channels/matrix.svg";
import googlechatLogo from "../assets/logos/channels/googlechat.svg";
import mattermostLogo from "../assets/logos/channels/mattermost.svg";
import lineLogo from "../assets/logos/channels/line.svg";
import nostrLogo from "../assets/logos/channels/nostr.svg";
import ircLogo from "../assets/logos/channels/irc.svg";

export const PROVIDER_LOGOS: Record<string, string> = {
  openai: openaiLogo,
  claude: claudeLogo,
  anthropic: claudeLogo,
  minimax: minimaxLogo,
  zhipu: zhipuLogo,
  zai: zhipuLogo,
  qwen: qwenLogo,
  "qwen-portal": qwenLogo,
  deepseek: deepseekLogo,
  moonshot: moonshotLogo,
  volcengine: doubaoLogo,
  "github-copilot": githubLogo,
};

export const CHANNEL_LOGOS: Record<string, string> = {
  telegram: telegramLogo,
  discord: discordLogo,
  feishu: feishuLogo,
  slack: slackLogo,
  whatsapp: whatsappLogo,
  signal: signalLogo,
  imessage: imessageLogo,
  msteams: msteamsLogo,
  matrix: matrixLogo,
  googlechat: googlechatLogo,
  mattermost: mattermostLogo,
  line: lineLogo,
  nostr: nostrLogo,
  irc: ircLogo,
};

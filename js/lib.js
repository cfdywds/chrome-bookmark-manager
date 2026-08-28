// ===== 书签管家 · 通用工具库 (lib.js) =====
// 暴露到全局 window.BM，供 analyzer.js / popup.js 使用
(function (global) {
  'use strict';

  // 常见多级公共后缀（简化版 Public Suffix List，覆盖主流场景）
  const PUB_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk',
    'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au',
    'co.jp', 'ne.jp', 'or.jp', 'go.jp', 'ac.jp', 'ad.jp',
    'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'com.cn',
    'com.tw', 'net.tw', 'org.tw', 'gov.tw', 'edu.tw',
    'com.hk', 'org.hk', 'gov.hk', 'edu.hk',
    'com.br', 'com.mx', 'co.in', 'net.in', 'org.in', 'gov.in',
    'com.sg', 'co.kr', 'or.kr', 'co.za', 'com.tr', 'co.nz'
  ]);

  // 提取注册域名（eTLD+1）。失败时回退到完整 hostname。
  function getRegisteredDomain(hostname) {
    if (!hostname) return '';
    let h = hostname.toLowerCase().replace(/^www\./, '').trim();
    const parts = h.split('.').filter(Boolean);
    if (parts.length <= 1) return h;
    const last2 = parts.slice(-2).join('.');
    if (PUB_SUFFIXES.has(last2) && parts.length >= 3) {
      return parts.slice(-3).join('.');
    }
    return last2;
  }

  function normalizeHost(host) {
    return (host || '').toLowerCase().replace(/^www\./, '');
  }

  function normalizeHttpUrl(rawUrl) {
    const raw = String(rawUrl == null ? '' : rawUrl).trim();
    if (!raw) throw new Error('网址不能为空');
    if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) {
      throw new Error('仅支持 http 或 https 网址');
    }
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
    } catch (e) {
      throw new Error('网址格式不正确');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('仅支持 http 或 https 网址');
    }
    return url;
  }

  function isHttpUrl(rawUrl) {
    try {
      normalizeHttpUrl(rawUrl);
      return true;
    } catch (e) {
      return false;
    }
  }

  function isLoopbackHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1';
  }

  function normalizeLlmBaseUrl(rawBaseUrl) {
    const url = normalizeHttpUrl(rawBaseUrl);
    if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
      throw new Error('LLM 服务必须使用 HTTPS；本地 Ollama 可使用 localhost 的 HTTP 地址');
    }
    return url.href.replace(/\/+$/, '');
  }

  function getLlmHostPermission(rawBaseUrl) {
    const url = new URL(normalizeLlmBaseUrl(rawBaseUrl));
    return url.protocol + '//' + url.hostname + '/*';
  }

  async function hasLlmHostPermission(rawBaseUrl) {
    const origin = getLlmHostPermission(rawBaseUrl);
    if (!global.chrome || !global.chrome.permissions || !global.chrome.permissions.contains) return true;
    return global.chrome.permissions.contains({ origins: [origin] });
  }

  async function requestLlmHostPermission(rawBaseUrl) {
    const origin = getLlmHostPermission(rawBaseUrl);
    if (!global.chrome || !global.chrome.permissions || !global.chrome.permissions.request) return true;
    const granted = await global.chrome.permissions.request({ origins: [origin] });
    if (!granted) throw new Error('未授予该 LLM 服务的网络访问权限');
    return true;
  }

  // URL 脱敏（发送给 LLM 前调用）：一律移除 query 与 fragment，仅保留 origin + pathname。

  function sanitizeUrlForAI(rawUrl) {
    try {
      const u = new URL(rawUrl);
      // chrome://、javascript:、data: 等非 http(s) 链接，origin 会返回 "null" 字符串，
      // 此时退化为 protocol://host，避免把 "null" 发给 LLM
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return u.protocol + '//' + (u.host || u.pathname.replace(/^\/+/, ''));
      }
      u.search = '';
      u.hash = '';
      return u.origin + u.pathname;
    } catch (e) {
      return String(rawUrl || '').split('#')[0].split('?')[0];
    }
  }

  // 精确重复判定键：忽略协议、www.、末尾斜杠和普通锚点，保留非默认端口。
  // `#/...` / `#!/...` 是 SPA 的实际路由，须保留以区分不同页面。
  function hashRouteOf(url) {
    return /^#!?\//.test(url.hash) ? url.hash.toLowerCase() : '';
  }

  function urlKeyFromParsedUrl(url) {
    const host = normalizeHost(url.hostname);
    // 非默认端口属于地址的一部分，不能与默认端口或其他服务合并。
    const port = url.port ? ':' + url.port : '';
    const path = url.pathname.replace(/\/+$/, '');
    const hashRoute = hashRouteOf(url);
    return (host + port + path + url.search + hashRoute).toLowerCase();
  }

  function urlKey(rawUrl) {
    try {
      const u = new URL(rawUrl);
      return urlKeyFromParsedUrl(u);
    } catch (e) {
      return rawUrl.trim().toLowerCase();
    }
  }

  // ---- 智能分类规则（v2 专业细分版，25 类）----
  // 匹配优先级 = 数组顺序（先声明的类先匹配，用于消解泛词冲突）。
  // 匹配方式：hay = host + url + title（小写），任一 key 命中（子串包含）即归类。
  // 设计原则：
  //  1. 优先使用域名级/品牌级 key（区分度高、误判少）
  //  2. 短词（≤3 字符）与泛词（book/read/tea/rag 等）不放或后置
  //  3. 同域多义时用具体子域（mail.qq.com→邮箱 / y.qq.com→音乐 / v.qq.com→视频 / news.qq.com→新闻）
  const CATEGORY_RULES = [
    { cat: '开发 / 编程', keys: [
      'github', 'gitlab', 'gitee', 'bitbucket', 'codeberg', 'sourceforge',
      'stackoverflow', 'stackexchange', 'segmentfault', 'stackblitz', 'codesandbox',
      'npmjs', 'npm.', 'pypi', 'maven', 'gradle', 'crates.io', 'jsdelivr', 'cdnjs',
      'mdn', 'w3schools', 'runoob', '菜鸟教程', 'javascript', 'typescript', 'python.org', 'go.dev', 'rust-lang', 'kotlin', 'swift.org',
      'spring', 'react.dev', 'vuejs', 'angular', 'next.js', 'nuxt', 'django', 'flask', 'fastapi',
      'eslint', 'webpack', 'vite', 'rollup', 'babel', 'prettier', 'husky',
      'docker', 'kubernetes', 'k8s', 'helm', 'rancher', 'nginx', 'haproxy',
      'terraform', 'ansible', 'jenkins', 'github actions', 'circleci', 'travis-ci',
      'postman', 'swagger', 'apidog', 'apifox', 'graphql', 'grpc', 'openapi',
      'redis', 'memcached', 'mongodb', 'mysql', 'postgresql', 'sqlite', 'mariadb', 'clickhouse', 'elasticsearch', 'kafka', 'rabbitmq',
      'aws', 'azure', 'gcp', 'aliyun', '阿里云', 'tencent cloud', '腾讯云', 'huawei cloud', '华为云', 'volcengine', '火山引擎', 'firebase', 'supabase',
      'vercel', 'netlify', 'render.com', 'heroku', 'railway', 'fly.io', 'digitalocean', 'vultr', 'linode', 'namecheap', 'godaddy',
      'deno', 'nodejs', 'bun.sh', 'pnpm', 'homebrew', 'developers.google', 'developer.chrome',
      'leetcode', 'hackerrank', 'codeforces', 'atcoder', 'codewars', 'exercism', '力扣',
      'csdn', 'cnblogs', '博客园', 'juejin', '掘金', 'oschina', '开源中国', 'dev.to', 'hackernews', 'news.ycombinator', 'v2ex',
      'flutter', 'reactnative', 'uniapp', 'taro', '小程序开发', 'weixin mini', 'svn', 'w3c', 'caniuse'
    ]},
    { cat: 'AI / 人工智能', keys: [
      'openai', 'chatgpt', 'gpt-', 'gpt4', 'gpt5', 'claude', 'anthropic', 'gemini.google', 'aistudio', 'bard.google',
      'deepseek', 'qwen', '通义千问', 'tongyi', 'moonshot', 'kimi', 'doubao', '豆包', 'ernie', '文心一言', 'hunyuan', '混元',
      'huggingface', 'hf.co', 'midjourney', 'stable diffusion', 'stability.ai', 'comfyui', 'runwayml', 'runway', 'pika', 'sora', 'suno', 'udio', 'elevenlabs', 'whisper',
      'lumalabs', 'luma ai', 'kling', '可灵', '即梦', 'jimeng', '通义万相', 'seedance',
      'ollama', 'langchain', 'llamaindex', 'llama', 'mistral', 'perplexity', 'poe.com', 'character.ai',
      'pytorch', 'tensorflow', 'keras', 'jax', 'colab', 'kaggle', 'notebooklm', 'machine learning', '深度学习', '机器学习', '大模型', '提示词', 'prompt engineering', '智能体', 'aigc', '文生图', '图生图', 'ai绘画', 'ai工具', 'ai应用'
    ]},
    { cat: '社交媒体', keys: [
      'twitter', '//x.com', 'facebook', 'instagram', 'threads', 'reddit', 'linkedin', 'tumblr', 'mastodon', 'quora', 'snapchat',
      'weibo', '微博', 'zhihu', '知乎', 'douyin', '抖音', 'tiktok', 'xiaohongshu', '小红书', 'kuaishou', '快手',
      'telegram', 't.me', 'discord', 'whatsapp', 'wechat', '微信', 'mp.weixin', '微信公众', '公众号', 'pinterest',
      '贴吧', 'tieba', 'bilibili 直播', '直播', '粉丝', '网红', '社区', 'community', 'forum', '论坛', 'v2ex 社区'
    ]},
    { cat: '视频 / 影音', keys: [
      'youtube', 'yt.be', 'bilibili', 'b23.tv', 'netflix', 'hulu', 'disney+', 'prime video', 'hbo.com', 'hbomax', 'twitch', 'kick.com',
      'iqiyi', '爱奇艺', 'youku', '优酷', 'v.qq.com', '腾讯视频', 'mango tv', '芒果tv', '西瓜视频', 'xigua', 'vimeo', 'dailymotion', 'niconico', 'crunchyroll', 'kodi', 'plex.tv', 'emby', 'jellyfin', '影视', '电影', 'movie', '影院', '视频', '短视频', '番剧 视频', '弹幕', '剧集', '美剧', '韩剧', '日剧'
    ]},
    { cat: '音乐 / 音频', keys: [
      'spotify', 'soundcloud', 'bandcamp', 'apple music', 'music.apple', 'y.qq.com', 'qq音乐', 'music.163.com', '网易云音乐', '酷狗', 'kugou', '酷我', 'kuwo', '咪咕音乐', 'podcast', '播客', '小宇宙', 'xiaoyuzhou', '喜马拉雅', 'radio', '电台', '收音机', '歌词', 'lyrics', '和弦', 'chord', '五线谱', 'midi', '伴奏', '翻唱', '混音', '音频', 'music', '音乐', '歌单'
    ]},
    { cat: '购物 / 电商', keys: [
      'amazon', 'taobao', '淘宝', 'tmall', '天猫', 'jd.com', '京东', 'pinduoduo', '拼多多', 'suning', '苏宁', 'ebay', 'aliexpress', 'alibaba', '1688', 'walmart', 'bestbuy', 'newegg',
      'shopify', 'etsy', 'shein', '希音', 'temu', 'zara', 'uniqlo', '优衣库', 'muji', '无印良品', '得物', '闲鱼', 'xianyu', '转转', 'zhuanzhuan', '什么值得买', 'smzdm',
      '购物', '商城', '秒杀', '优惠券', '打折', '折扣', '团购', '比价', '海淘', '代购', '退货', '售后', '下单', '订单', '购物车', '双十一', '618'
    ]},
    { cat: '邮箱 / 通信', keys: [
      'mail.qq.com', 'qq邮箱', 'mail.163.com', '163邮箱', '网易邮箱', 'mail.sina', 'gmail', 'outlook', 'foxmail', 'webmail', 'protonmail', 'icloud mail', 'zoho mail', 'yandex mail', '企业邮箱',
      'im.qq.com', 'im.wechat', '通信', '邮件', 'email', '收件箱', '发件箱', '通讯录', '联系人', '话费', '营业厅', '中国移动', '中国联通', '中国电信', '10086', '10010', '10000', 'sim卡', 'eSIM', '短信', '彩信', '语音通话', '视频通话'
    ]},
    { cat: '阅读 / 写作', keys: [
      '起点', 'qidian', '番茄小说', 'fanqie', '晋江', 'jjwxc', '红袖', '纵横', 'zongheng', '飞卢', '书旗', '掌阅', '阅文', '微信读书', 'weread', 'kindle', 'goodreads', 'book.douban', '豆瓣读书', '电子书', 'ebook', 'epub', '图书馆', 'library', '藏书', '书单', '读书笔记', '读后感',
      '写作', 'writing', '博客', 'blog', '简书', 'jianshu', 'wordpress', 'ghost.org', 'medium', 'substack', '投稿', '出版', '出版社', '编辑', '校对', '文学', 'literature', '小说', 'novel', '诗歌', 'poem', '散文', '随笔', '科幻', '奇幻', '悬疑', '推理', '历史', '传记', '经典', '名著', '文言文', '古文', '诗词', '唐诗', '宋词', '剧本', '编剧', '码字', '写作工具', '文风', '文笔', '书评', '影评书评'
    ]},
    { cat: '新闻 / 资讯', keys: [
      'news', 'bbc', 'cnn', 'reuters', 'nytimes', 'theguardian', 'washingtonpost', 'economist', '经济学人', 'bloomberg', '彭博', 'ft.com', '金融时报', 'nikkei', '日经',
      'thepaper', '澎湃', 'sina', '新浪', 'sohu', '搜狐', '163.com', '网易新闻', 'qq.com', '腾讯新闻', 'toutiao', '今日头条', 'people.com.cn', '人民网', 'xinhua', '新华网', 'cctv', '央视', 'guancha', '观察者',
      'jiemian', '界面', 'caixin', '财新', 'yicai', '第一财经', '36kr', '36氪', 'techcrunch', 'theverge', 'wired', 'engadget', 'ithome', '少数派', 'sspai', '虎嗅', 'huxiu', '钛媒体', '爱范儿', 'ifanr', '极客公园', 'pingwest', '品玩', 'solidot', 'jandan', '煎蛋', 'zealer', '爱否', 'geekerwan', '极客湾', '资讯', '日报', '晚报', '时政', '国际', '社会', '突发', '新闻头条'
    ]},
    { cat: '科技 / 数码', keys: [
      'xda', 'androidpolice', 'gsmarena', '中关村在线', 'zol', 'pconline', '太平洋电脑', '数字尾巴', 'geekbench', 'cpu-z',
      'intel', 'amd', 'nvidia', 'qualcomm', '骁龙', 'apple.com', 'iphone', 'ipad', 'macbook', 'imac', 'airpods', 'applewatch',
      'xiaomi', '小米', 'huawei', '华为', '荣耀', 'honor', 'oppo', 'vivo', 'oneplus', '一加', 'samsung', '三星', 'pixel',
      'app store', 'play.google', 'f-droid', 'apkmirror', '酷安', 'coolapk', 'miui', 'hyperos', 'harmonyos', '鸿蒙',
      'android', 'ios', 'windows', 'macos', 'linux', 'ubuntu', 'debian', 'centos', 'fedora', 'archlinux', 'manjaro', 'deepin', '统信',
      'microsoft.com', 'surface', 'surface pro', '刷机', 'root', 'rom', '固件', '驱动', 'driver', '跑分', '评测', '数码', '手机', '平板', '笔记本', '台式机', '显示器', '显卡', '内存', '硬盘', 'ssd', '机械键盘', '耳机', '音响', '智能手表', '手环', 'vr', 'vr设备'
    ]},
    { cat: '学习 / 教育', keys: [
      'coursera', 'udemy', 'edx', 'khanacademy', 'khan', 'mooc', '慕课', '中国大学mooc', 'icourse163', '学堂在线', 'xuetangx', 'udacity', 'skillshare', 'codecademy', 'freecodecamp',
      'duolingo', '多邻国', 'busuu', 'quizlet', 'anki', 'wikipedia', 'wiki', '维基百科', '百度百科', 'baike',
      'mit.edu', 'stanford', 'harvard', 'cambridge', 'oxford', 'princeton', 'yale', 'berkeley', '清华', 'tsinghua', '北大', 'pku', '复旦', '交大', 'zju', '浙大', 'ustc', '中科大', '南大', 'nju', '武大', '华科', 'hust',
      'education', 'edu.cn', '教育', '网课', '课程', '教程', 'tutorial', '公开课', 'lecture', '考试', 'exam.', '雅思', 'ielts', '托福', 'toefl', 'gre', '考研', '高考', '四六级', 'cet', '教师资格', '公务员', '行测', '申论', '题库', '刷题', '家教', '作业', 'homework', '留学', 'study abroad', '录取', '奖学金', '学习方法', '知识', '百科'
    ]},
    { cat: '学术 / 论文', keys: [
      'arxiv', 'scholar.google', '谷歌学术', '知网', 'cnki', '万方', 'wanfang', '维普', 'cqvip', 'sci-hub', 'researchgate', 'pubmed',
      'ieee', 'acm', 'elsevier', 'springer', 'nature.com', 'science.org', 'cell.com', 'lancet', 'bmj', 'nejm',
      '期刊', 'journal', '论文', 'paper', '预印本', 'preprint', '引用', 'citation', 'doi', '影响因子', 'ssrn', 'semanticscholar', 'zotero', 'endnote', 'mendeley', '学术', '科研', '研究', '文献', '综述', '实验报告', '开题报告', '毕业设计', '学位', '博士', '硕士', '课题'
    ]},
    { cat: '金融 / 投资', keys: [
      'bank', 'icbc', '工商银行', 'ccb', '建设银行', 'boc', '中国银行', 'abc', '农业银行', 'cmb', '招商银行', 'citibank', 'chase', 'hsbc', '汇丰', 'bofa', 'american express', 'amex', 'visa', 'mastercard', 'unionpay', '银联', '云闪付',
      'alipay', '支付宝', 'wechat pay', '微信支付', 'paypal', 'stripe', 'squareup', 'venmo', 'wise', 'revolut', 'payoneer',
      '股票', 'stock', '证券', '券商', '富途', 'futu', '老虎证券', 'tiger brokers', '东方财富', 'eastmoney', '同花顺', '10jqka', '雪球', 'xueqiu', '天天基金', '基金', 'fund', '理财', 'wealth', '投资', 'invest', '美股', 'a股', '港交所', 'hkex', 'nasdaq', 'nyse', 'sec.gov', 'edgar', '财报', '研报', '行情', '市值', '开户', 'etf', '指数基金', '债券', '国债', 'bond',
      'binance', '币安', 'coinbase', 'okx', 'bybit', 'kraken', 'bitfinex', 'huobi', '火币', 'gate.io', 'mexc', 'metamask', 'wallet', '加密钱包', 'crypto', '加密货币', 'btc', 'bitcoin', '比特币', 'ethereum', '以太坊', 'solana', 'bnb', 'web3', 'nft', '挖矿', '矿池', '空投', '合约交易', '杠杆',
      '期货', 'futures', '期权', 'options', '外汇', 'forex', '黄金', 'gold', '保险', 'insurance', '平安保险', 'pingan', '众安', 'zhongan', '泰康', '太平洋保险', '人寿', '车险', '理赔', '费率', '利率', '汇率', '征信', '信用', 'credit', '银行卡', '信用卡'
    ]},
    { cat: '政府 / 政务', keys: [
      '.gov', 'gov.cn', '政府', '政务', '国务院', '外交部', 'mfa.gov.cn', '公安部', '发改委', '税务局', '税务', '社保', '公积金', '12333', '政务服务', '出入境', '护照', '大使馆', 'embassy', '领事馆',
      'un.org', '联合国', 'who.int', 'oecd', 'imf', 'worldbank', '世界银行', 'wto',
      '法院', 'court', '裁判文书', 'wenshu', '检察院', '人大', '政协', '政策', '法规', 'law', '民法典', '立法', '信访', '12345', '市长热线', '不动产', '户口', '居住证', '驾驶证', '交警', '交管', '12315', '市场监管', '应急管理', '地震局', '气象局', '统计局', '海关', '检疫', '扶贫', '乡村振兴'
    ]},
    { cat: '云盘 / 文档', keys: [
      'drive.google', 'google drive', 'dropbox', 'onedrive', 'icloud drive', 'box.com', '百度网盘', 'pan.baidu', '蓝奏云', 'lanzou', '阿里云盘', 'aliyundrive', '夸克网盘', 'quark', '坚果云', 'jianguoyun', '腾讯微云', 'weiyun', '微云', '115.com', '迅雷', 'xunlei', '奶牛快传', 'cowtransfer', 'wetransfer', 'send-anywhere',
      'notion', '飞书', 'feishu', '语雀', 'yuque', '石墨文档', 'shimo', '腾讯文档', 'docs.qq.com', 'google docs', 'docs.google', 'sheets.google', 'slides.google', 'office.com', 'microsoft 365', 'office 365', '金山文档', 'wps', '幕布', 'mubu', '印象笔记', 'evernote', '有道云笔记', 'ynote', 'obsidian', '思源笔记', 'typora', 'markdown', '协作文档', '共享文档', '表格', 'excel', 'ppt', '云盘', '网盘', '云存储', '文件传输', '文件共享', '同步盘', '在线文档', '云笔记', '白板', 'mural', 'miro'
    ]},
    { cat: '设计 / 创意', keys: [
      'figma', 'sketch.com', 'adobe', 'photoshop', 'illustrator', 'behance', 'dribbble', '站酷', 'zcool', 'ui.cn', '花瓣', 'huaban',
      'unsplash', 'pexels', 'pixabay', '千图', '昵图', '摄图', 'iconfont', 'icons8', 'flaticon', 'font awesome', 'fonts.google', 'google fonts', '字体', 'typography', '排版', '配色', '色板', 'palette', '渐变', 'gradient',
      '设计', 'design', '插画', 'illustration', '矢量', 'vector', 'svg', 'logo', '品牌', 'brand', 'canva', '稿定', 'gaoding', '创客贴', '美图',
      'blender', 'cinema 4d', 'c4d', 'maya', 'unreal', 'unity', 'sketchfab', '原画', '概念设计', '作品集', 'portfolio', 'ui设计', 'ux', '交互设计', '视觉设计', '平面设计', '海报', 'banner', '电商设计'
    ]},
    { cat: '游戏', keys: [
      'steam', 'steampowered', 'epic games', 'epicgames', 'gog.com', 'itch.io', 'xbox', 'playstation', 'psn', 'nintendo', 'switch', '任天堂', 'wegame', '腾讯游戏',
      '米哈游', 'mihoyo', 'genshin', '原神', '崩坏', '星穹铁道', 'star rail', '绝区零', 'zzz', '王者荣耀', '和平精英', '英雄联盟', 'leagueoflegends', 'dota', 'csgo', 'counter-strike', 'valorant', 'overwatch', 'minecraft', '我的世界', 'roblox', 'fortnite', '堡垒之夜', '明日方舟', 'arknights', 'fgo', 'fate', 'wow', '魔兽世界', 'ff14', '最终幻想', 'zelda', '塞尔达', 'gta', 'rockstar', '侠盗猎车', '2k games', 'ea games', 'ubisoft', '育碧', 'bethesda', 'cd project', 'cyberpunk', '赛博朋克', 'fromsoftware', '艾尔登法环', 'elden ring', '怪物猎人', 'monster hunter', '暗黑', 'diablo', '炉石', 'hearthstone', '金铲铲', '云顶之弈', 'tft',
      '游戏', 'game', '攻略', 'fandom', 'wiki.gg', '3dm', '游侠', '游民星空', 'gamersky', 'ign', 'gamespot', 'metacritic', '小黑盒', 'steamdb', 'esports', '电竞', '电竞赛事', 'gameplay', '试玩', '模组', 'mod', '汉化补丁', '游戏库', '联机', '服务器列表'
    ]},
    { cat: '旅游 / 出行', keys: [
      '携程', 'ctrip', '去哪儿', 'qunar', '飞猪', 'fliggy', 'airbnb', 'booking.com', 'agoda', 'expedia', 'kayak', 'skyscanner', '天巡', '12306', '铁路', '火车票', 'trip.com', '马蜂窝', 'mafengwo', '穷游', 'qyer', '途牛', 'tuniu', '驴妈妈', 'ly.com', 'tripadvisor', '猫途鹰', 'lonely planet',
      '景点', '景区', '门票', '酒店', 'hotel', '民宿', 'homestay', '机票', 'flight', '航班', '值机', '航旅纵横', 'umetrip', '滴滴', 'didi', '高德', 'amap', '百度地图', 'map.baidu', 'maps.google', '谷歌地图', '地图', '导航', 'uber', 'lyft', '租车', 'hertz', 'avis', '共享单车', '火车', 'train', '地铁', 'metro', '公交', 'bus', '签证', '出国', '旅行', '旅游', '行程', 'itinerary', '出行', '打车', '叫车', '差旅', '商旅'
    ]},
    { cat: '美食 / 餐饮', keys: [
      '下厨房', 'xiachufang', '美食杰', 'meishij', '豆果美食', '菜谱', 'recipe', '食谱', '美食', 'food', '做饭', '烘焙', 'baking', '火锅', '烧烤', '蛋糕', '甜品', '奶茶', '咖啡', 'coffee', '茶道', '茶艺', '葡萄酒', 'wine', '啤酒', '米其林', 'michelin',
      '大众点评', 'dianping', '美团', 'meituan', '饿了么', 'ele.me', '口碑', '外卖', '餐厅', 'restaurant', '吃货', '料理', '日料', '韩料', '中餐', '西餐', '素食', 'vegan', '减脂餐', '轻食', '厨房', 'kitchen', '食材', '生鲜', '盒马', 'hema', '叮咚买菜', '朴朴超市', '每日优鲜', '山姆', 'costco', '开市客', '买菜', '点餐', '订餐', '探店', '夜宵', '下午茶', '自助餐'
    ]},
    { cat: '健康 / 健身', keys: [
      '健康', 'health', '医疗', 'medical', '医院', 'hospital', '诊所', 'clinic', '医生', 'doctor', '挂号', '微医', '丁香园', 'dxy', '丁香医生', '平安好医生', '好大夫', 'haodf', '春雨医生', '用药', '药品', 'drug', '药店', '药房', '医保', '体检', '疫苗', '疾控', '心理健康', '心理', 'psychology', '冥想', 'meditation', '正念', '睡眠', 'sleep',
      '健身', 'fitness', 'gym', '跑步', 'running', '马拉松', 'marathon', '咕咚', 'keep', '薄荷健康', '减肥', '减脂', '增肌', '瑜伽', 'yoga', '普拉提', 'pilates', '有氧', '拉伸', '运动', 'sport', '羽毛球', '篮球', '足球', '乒乓球', '网球', '游泳', '滑雪', '滑板', '骑行', 'cycling', '徒步', 'hiking', '登山', 'climbing', '户外', 'outdoor', '露营', 'camping', '钓鱼', 'fishing', '攀岩', '蛋白粉', '补剂', '营养', 'nutrition', '卡路里', 'calorie', '养生', '中医', '针灸', '推拿', '艾灸', '理疗', '康复', '骨科', '眼科', '牙科', '皮肤科', '妇产', '儿科', '血糖', '血压', '糖尿病', '心血管'
    ]},
    { cat: '动漫 / 二次元', keys: [
      '番剧', 'anime', 'manga', '漫画', '快看漫画', 'kuaikan', '哔哩哔哩漫画', '腾讯动漫', '动漫之家', 'dmzj', '汉化组', '同人', 'cosplay', '手办', '周边', '谷子', '痛车', 'acg', '二次元', '轻小说', 'pixiv', 'danbooru', 'safebooru', 'wallhaven', 'vtuber', 'hololive', 'nijisanji', '彩虹社', '虚拟主播', '漫展', 'comiket', '新番', '剧场版', 'ova', '声优', '虚拟歌姬', '初音', 'vocaloid', '插画社区', 'pixiv 插画'
    ]},
    { cat: '汽车 / 交通', keys: [
      '汽车', 'auto', '懂车帝', 'dongchedi', '汽车之家', 'autohome', '太平洋汽车', '易车', 'yiche', '瓜子二手车', '二手车', '新车', '试驾', '保养', '加油站', '油价', '车险', '违章', '交管12123', '驾照', '驾考', '科目一', '科目二', '改装',
      'tesla', '特斯拉', 'byd', '比亚迪', 'nio', '蔚来', 'xpeng', '小鹏', '理想汽车', 'xiaomi su7', '小米汽车', '极氪', 'zeekr', '领克', 'lynk', '五菱', '哈弗', '长安', '吉利', '奇瑞', '红旗', 'hongqi', '奔驰', 'mercedes', '宝马', 'bmw', '奥迪', 'audi', '保时捷', 'porsche', '大众', 'volkswagen', '丰田', 'toyota', '本田', 'honda', '日产', 'nissan', '福特', 'ford', '别克', 'buick', '凯迪拉克', 'cadillac', '雷克萨斯', 'lexus', '现代', 'hyundai', '起亚', 'kia', '马自达', 'mazda', '沃尔沃', 'volvo', '捷豹', 'jaguar', '路虎', 'landrover', '兰博基尼', 'lamborghini', '法拉利', 'ferrari', '迈凯伦', 'mclaren', '阿斯顿马丁', 'aston martin',
      '车辆', '买车', '卖车', '停车', '车位', '充电桩', '新能源', '电动车'
    ]},
    { cat: '房产 / 家居', keys: [
      '房产', '房价', '楼盘', '新房', '二手房', '租房', '出租', '安居客', '贝壳', 'beike', '链家', 'lianjia', '我爱我家', '自如', 'ziroom', '58同城', '58.com', '赶集', 'ganji', '房天下', 'fang.com', '房多多',
      '装修', '土巴兔', 'to8to', '齐家', '家居', '家具', '家电', '家装', '宜家', 'ikea', '红星美凯龙', '居然之家', '沙发', '床垫', '灯具', '卫浴', '瓷砖', '地板', '窗帘', '物业', '小区', '业委会', '房东', '房客', '中介', '看房', '样板间', '户型', '公摊', '容积率', '物业费', '租房合同', '购房合同'
    ]},
    { cat: '求职 / 职场', keys: [
      '求职', 'job', '招聘', '猎聘', 'liepin', 'boss直聘', 'zhipin', '前程无忧', '51job', '智联招聘', 'zhaopin', '拉勾', 'lagou', '脉脉', 'maimai', '简历', 'resume', '面试', '面经', '跳槽', '升职', '加薪', '职场',
      '副业', '兼职', '自由职业', 'freelance', 'upwork', 'fiverr', '远程办公', 'remote work', '居家办公', '外包', '猎头', '内推', '校招', '秋招', '春招', '实习', '应届生', 'offer', '工作机会', '职业规划', '劳动法', '五险一金', '个税', '报销', '考勤', '工位', '办公效率'
    ]},
    { cat: '网络代理 / 中转', keys: [
      'v2board', 'sspanel', 'ss-panel', 'xboard', 'whmcs', '机场', '订阅链接', '订阅地址', '订阅转换', 'subconverter', 'sub-web',
      'clash', 'v2ray', 'shadowsocks', 'shadowrocket', 'vmess://', 'trojan://', 'ss://', 'ssr://', 'wireguard', 'hysteria', 'tuic',
      '中转', '节点', '加速器', '梯子', '翻墙', '科学上网', 'proxy server', 'vpn.', 'vpn.net', 'vpn.com',
      'cloudreve', 'alist', 'aria2', '离线下载', '磁力', 'bt下载'
    ]},
    { cat: '生活 / 工具', keys: [
      '日历', 'calendar', '提醒', 'reminder', '待办', 'todo', '清单', '时间管理', 'pomodoro', '番茄钟', '效率', 'productivity', '记账', '随手记', '鲨鱼记账', '缴费', '家政', '保洁', '维修', '快递', '物流', '顺丰', 'sf-express', '中通', '圆通', '韵达', '申通', '邮政', 'ems', '菜鸟', 'cainiao', '快递查询', '邮编',
      '天气', 'weather', '墨迹天气', '空气质量', '台风', '时区', '世界时钟', '翻译', 'translate', '谷歌翻译', '有道翻译', '百度翻译', '词典', 'dictionary', '字典', '计算器', 'calculator', '单位换算', '汇率', '星座', '生肖', '运势', '壁纸', 'wallpaper', '表情包', 'meme', '二维码', '压缩', '格式转换', '视频下载', '下载工具', '测速', 'speedtest', '网速',
      '密码管理', 'password', '1password', 'lastpass', 'bitwarden', '密码', '加密', '隐私', '内网穿透', 'ngrok', 'frp', '域名', '备案', 'icp', '主机', 'vps', 'cdn', '站长', '站长工具', 'seo',
      '搜索引擎', 'google.com', 'baidu.com', 'bing.com', 'duckduckgo', '必应', '谷歌搜索', '百度搜索', '搜索', 'search', '导航网站', 'hao123', '网址导航', '工具箱', '在线工具', 'tool', 'utilities', '绿联', 'nas', '群晖', 'synology', '极空间', '路由器', 'wifi', '宽带', '光猫', '电视盒子', '机顶盒', '应用商店', 'app下载', '系统优化', '清理工具', '杀毒', '防火墙', '回收站', '系统工具'
    ]}
  ];

  // 分类规则是静态数据，预编译字面量匹配器，避免未命中书签逐个关键词调用 includes。
  const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const CATEGORY_MATCHERS = CATEGORY_RULES.map(rule =>
    new RegExp(rule.keys.map(key => escapeRegExp(key.toLowerCase())).join('|'), 'u')
  );

  function categorizeWithHay(host, hay, domain) {
    // 域名规则的首个标签优先作为分类名，其余走默认分类规则。
    const dg = matchDomainGroup(host, domain);
    if (dg) return dg;
    for (let i = 0; i < CATEGORY_RULES.length; i++) {
      if (CATEGORY_MATCHERS[i].test(hay)) return CATEGORY_RULES[i].cat;
    }
    return '未分类';
  }

  function categorize(host, url, title) {
    return categorizeWithHay(host, (host + ' ' + url + ' ' + title).toLowerCase());
  }

  // ---- AI 隐私保护：仅拦截有明确高风险信号的 HTTP(S) 书签 ----
  // 这些结果只用于决定是否允许发送至用户配置的 LLM，不作为独立安全评分。
  const LOGIN_HOST_LABELS = new Set(['login', 'signin', 'sign-in', 'auth', 'sso', 'oauth', 'passport', 'accounts']);
  const LOGIN_PATH_SEGMENTS = new Set(['login', 'signin', 'sign-in', 'auth', 'sso', 'oauth', 'passport']);
  const SENSITIVE_PARAM_KEYS = new Set([
    'token', 'access_token', 'refresh_token', 'session', 'sess', 'sid', 'phpsessid', 'jsessionid',
    'password', 'pwd', 'passwd', 'api_key', 'apikey', 'secret', 'authorization', 'code', 'ticket', 'jwt', 'bearer'
  ]);
  const FINANCIAL_HOST_LABELS = new Set(['bank', 'banking', 'paypal', 'alipay', 'metamask', 'binance', 'coinbase', 'okx', 'kraken', 'bybit']);
  const FINANCIAL_TITLE_PATTERN = /(网上银行|银行账户|支付账户|证券账户|加密钱包|数字钱包|crypto wallet)/i;

  function decodePathSegment(segment) {
    try { return decodeURIComponent(segment).toLowerCase(); }
    catch (e) { return segment.toLowerCase(); }
  }

  function isLoginEndpoint(url) {
    const hostLabels = url.hostname.toLowerCase().split('.');
    if (hostLabels.some(label => LOGIN_HOST_LABELS.has(label))) return true;
    return url.pathname.split('/').filter(Boolean).some(segment => {
      const normalized = decodePathSegment(segment).replace(/\.(?:html?|php|aspx?)$/, '');
      return LOGIN_PATH_SEGMENTS.has(normalized);
    });
  }

  function hasSensitiveUrlParameter(url) {
    const values = [url.search.slice(1)];
    const fragment = url.hash.slice(1);
    if (fragment) {
      values.push(fragment);
      const queryIndex = fragment.indexOf('?');
      if (queryIndex >= 0) values.push(fragment.slice(queryIndex + 1));
    }
    return values.some(value => {
      const params = new URLSearchParams(value);
      for (const [key, paramValue] of params) {
        if (SENSITIVE_PARAM_KEYS.has(key.toLowerCase()) && paramValue) return true;
      }
      return false;
    });
  }

  function isFinancialOrWalletService(url, title) {
    const hostLabels = url.hostname.toLowerCase().split('.');
    return hostLabels.some(label => FINANCIAL_HOST_LABELS.has(label)) || FINANCIAL_TITLE_PATTERN.test(title || '');
  }

  const SENSITIVE_RULES = [
    { label: '登录入口', sev: 'high', test: (url) => isLoginEndpoint(url) },
    { label: '含访问凭据参数', sev: 'high', test: (url) => hasSensitiveUrlParameter(url) },
    { label: '金融 / 钱包服务', sev: 'high', test: (url, title) => isFinancialOrWalletService(url, title) }
  ];

  function detectSensitive(host, rawUrl, title) {
    let url;
    try { url = new URL(rawUrl); }
    catch (e) { return []; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
    return SENSITIVE_RULES.filter(rule => rule.test(url, title || host || ''))
      .map(rule => ({ label: rule.label, sev: rule.sev }));
  }

  // ---- 分类体系（供 AI prompt 使用）----
  function getCategoryNames() {
    return CATEGORY_RULES.map(r => r.cat);
  }

  // ---- 域名分类名由统一的域名标签规则派生 ----
  // 每条域名规则的第一个标签同时作为概览分类名；其余标签只参与打标。
  let domainGroupsCache = null;   // null = 尚未从 storage 加载

  async function loadDomainGroups() {
    if (domainGroupsCache) return domainGroupsCache;
    try {
      const [rules, fixedTags] = await Promise.all([loadTagRules(), loadFixedTags()]);
      domainGroupsCache = Object.fromEntries(Object.entries(rules.domain).flatMap(([domain, tags]) => {
        // 与实际打标相同：只有固定池内的有效标签才能成为概览分类。
        const category = (Array.isArray(tags) ? tags : []).map(tag => fixedTags.find(poolTag =>
          String(poolTag).toLowerCase() === String(tag).toLowerCase() && poolTag !== FALLBACK_TAG
        )).find(Boolean);
        return category ? [[domain, category]] : [];
      }));
    } catch (e) { domainGroupsCache = {}; }
    return domainGroupsCache;
  }

  // 统一域名规则变更后调用，强制下次重新读取
  function invalidateDomainGroups() { domainGroupsCache = null; }

  // 同步读取（可能尚未加载，返回 null）
  function getDomainGroups() { return domainGroupsCache; }

  // 域名规则按声明顺序匹配；首个命中的首个有效标签即概览分类。
  function matchDomainGroup(host) {
    const g = domainGroupsCache;
    if (!g) return '';
    const h = (host || '').toLowerCase().replace(/^www\./, '');
    const matched = Object.entries(g).find(([signal]) => h.includes(String(signal).toLowerCase()));
    return matched ? matched[1] : '';
  }

  // 同步版全部候选分类：默认 26 类 + 域名规则首个标签（供下拉框使用）
  function getAllCategoryNames() {
    const names = getCategoryNames();
    const g = domainGroupsCache;
    if (g) {
      Object.keys(g).forEach(k => {
        const v = g[k];
        if (v && !names.includes(v)) names.push(v);
      });
    }
    return names;
  }

  // async 版：确保配置加载后再取（AI 分类的候选集包含域名规则首个标签）
  async function getCategoryNamesWithDomains() {
    await loadDomainGroups();
    return getAllCategoryNames();
  }

  // ---- 标签体系（多标签，作为主组织方式）----
  // 存储：chrome.storage.local 的 bmTags = { bookmarkId: ['标签1', '标签2'] }
  // 与「分类」不同：一个书签可有多个标签；删除书签时需联动清理。
  const TAGS_KEY = 'bmTags';
  const TAG_MUTATION_MESSAGE = 'bmTagMutation';
  const MAX_TAGS_PER_BOOKMARK = 6;   // 单书签标签数上限
  const MAX_TAG_LEN = 20;            // 单个标签长度上限

  let tagsCache = null;              // null = 未加载

  async function loadTags() {
    if (tagsCache) return tagsCache;
    try {
      const r = await chrome.storage.local.get(TAGS_KEY);
      tagsCache = (r[TAGS_KEY] && typeof r[TAGS_KEY] === 'object') ? r[TAGS_KEY] : {};
    } catch (e) { tagsCache = {}; }
    return tagsCache;
  }

  // popup/options 修改标签后调用，强制下次重新读取
  function invalidateTags() { tagsCache = null; }

  const sameTagList = (left, right) => left.length === right.length && left.every((tag, index) => tag === right[index]);

  // 合并多份标签列表为并集：已有标签优先（先到先保留），去除「其他」兜底，再限数。
  // 用于把同一地址的多个书签的标签收敛为一致集合，避免同址不同标。
  function unionTagLists(lists) {
    const seen = [];
    (lists || []).forEach(list => {
      (list || []).forEach(tag => {
        const t = normalizeTag(tag);
        if (!t || t === FALLBACK_TAG) return;
        if (!seen.includes(t) && seen.length < MAX_TAGS_PER_BOOKMARK) seen.push(t);
      });
    });
    return seen;
  }

  function applyTagChangesLocally(map, changes, mode) {
    let changed = false;
    Object.entries(changes || {}).forEach(([id, value]) => {
      const current = map[id] || [];
      let next = null;
      if (mode === 'merge' && Array.isArray(value)) next = [...new Set([...current, ...value])].slice(0, MAX_TAGS_PER_BOOKMARK);
      else if (mode === 'remove' && Array.isArray(value)) {
        const remove = new Set(value);
        next = current.filter(tag => !remove.has(tag));
      } else if (Array.isArray(value)) next = [...new Set(value)].slice(0, MAX_TAGS_PER_BOOKMARK);
      if (next && next.length) {
        if (!sameTagList(current, next)) { map[id] = next; changed = true; }
      } else if (Object.prototype.hasOwnProperty.call(map, id)) {
        delete map[id];
        changed = true;
      }
    });
    return changed;
  }

  // 所有 UI 标签写入交由后台 Service Worker 串行化，避免与原生收藏自动打标互相覆盖。
  async function persistTagChanges(changes, mode) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        const result = await chrome.runtime.sendMessage({ type: TAG_MUTATION_MESSAGE, changes, mode });
        if (result && result.ok) {
          invalidateTags();
          return result;
        }
      }
    } catch (e) { /* Service Worker 重启时回退本地写入 */ }
    try {
      const stored = await chrome.storage.local.get(TAGS_KEY);
      const next = stored[TAGS_KEY] && typeof stored[TAGS_KEY] === 'object' ? { ...stored[TAGS_KEY] } : {};
      const changed = applyTagChangesLocally(next, changes, mode);
      if (changed) await chrome.storage.local.set({ [TAGS_KEY]: next });
      tagsCache = next;
      return { ok: true, changed };
    } catch (e) {
      return { ok: false, changed: false };
    }
  }

  // 同步读（可能尚未加载，返回 null）
  function getTags() { return tagsCache; }

  // 规范化单个标签：去首尾空白、折叠内部空白、限长；非法返回空串
  function normalizeTag(raw) {
    return String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LEN);
  }

  // ---- 固定标签池（收敛标签种类，最多 ~50 个）----
  // AI 打标 / 建议标签 / 写入归一化都只允许池内标签；池外一律归 FALLBACK_TAG。
  // 存储：chrome.storage.local 的 bmFixedTags（数组，可配置覆盖；未配置用默认）。
  const FIXED_TAGS_KEY = 'bmFixedTags';
  const TAG_RULES_KEY = 'bmTagRules';
  const LEGACY_DOMAIN_GROUPS_MIGRATED_KEY = 'bmDomainGroupsMigrated';
  const FALLBACK_TAG = '其他';

  const LEGACY_DEFAULT_FIXED_TAGS = [
    'AI', '前端', '后端', '移动端', 'JAVA', 'Python', '数据库', '运维', '安全', '设计',
    '学习', '教程', '工具', '效率', '工作', '资讯', '阅读', '视频', '娱乐', '生活', '社交', '博客',
    'linux.do', 'GitHub', '掘金', '知乎', 'V2EX', '中转站', 'Telegram', '微信公众号'
  ];

  // 默认池（通用主题 + 场景语义；用户可在设置页增删改，最多 50）
  const DEFAULT_FIXED_TAGS = [
    // 主题 / 领域
    'AI', '代码', '前端', '后端', '移动端', 'JAVA', 'Python', '数据库', '运维', '安全', '设计',
    '学习', '教程', '工具', '效率', '工作',
    // 场景 / 生活
    '资讯', '阅读', '视频', '娱乐', '生活', '社交', '论坛', '博客'
  ];
  const MAX_FIXED_TAGS = 50;

  // 高置信域名规则优先于标题/路径泛词和 LLM。规则只产出固定池已有标签，
  // 因此用户自定义标签池仍是最终边界；数组顺序也是单书签标签的优先级。
  const DOMAIN_TAG_RULES = [
    { signals: ['figma', 'mastergo', 'js.design', 'modao'], tags: ['设计', '工作'] },
    { signals: ['github', 'gitlab', 'gitee', 'bitbucket', 'codeberg', 'sourceforge'], tags: ['代码'] },
    { signals: ['reddit', 'discourse', 'stackoverflow', 'stackexchange', 'segmentfault'], tags: ['论坛'] },
    { signals: ['tailscale', 'zerotier', 'wireguard'], tags: ['运维', '工具'] },
    { signals: ['docker', 'kubernetes', 'rancher', 'jenkins', 'grafana'], tags: ['运维'] },
    { signals: ['notion', 'feishu', 'dingtalk', 'yuque', 'shimo'], tags: ['工作', '效率'] },
    { signals: ['openai', 'anthropic', 'deepseek', 'huggingface'], tags: ['AI'] }
  ];

  let fixedTagsCache = null;   // null = 未加载
  let tagRulesCache = null;    // { domain: { keyword: tags[] }, keyword: { keyword: tags[] } }

  function upgradeDefaultFixedTags(tags) {
    if (!Array.isArray(tags) || tags.length !== LEGACY_DEFAULT_FIXED_TAGS.length) return tags;
    const isLegacyDefault = tags.every((tag, index) => tag === LEGACY_DEFAULT_FIXED_TAGS[index]);
    return isLegacyDefault ? [...DEFAULT_FIXED_TAGS] : tags;
  }

  async function loadFixedTags() {
    if (fixedTagsCache) return fixedTagsCache;
    try {
      const r = await chrome.storage.local.get(FIXED_TAGS_KEY);
      const stored = Array.isArray(r[FIXED_TAGS_KEY]) ? r[FIXED_TAGS_KEY].map(normalizeTag).filter(Boolean) : [];
      const cfg = upgradeDefaultFixedTags(stored);
      // 用户配置（含「其他」兜底）；未配置用默认池
      fixedTagsCache = cfg.length ? [...new Set(cfg)] : [...DEFAULT_FIXED_TAGS];
      if (!fixedTagsCache.includes(FALLBACK_TAG)) fixedTagsCache.push(FALLBACK_TAG);
      fixedTagsCache = fixedTagsCache.slice(0, MAX_FIXED_TAGS);
    } catch (e) {
      fixedTagsCache = [...DEFAULT_FIXED_TAGS, FALLBACK_TAG];
    }
    return fixedTagsCache;
  }

  // options/popup 修改池后调用
  function invalidateFixedTags() {
    fixedTagsCache = null;
    invalidateDomainGroups();
  }

  // 同步读池（可能未加载，返回 null）
  function getFixedTags() { return fixedTagsCache; }

  function normalizeTagRuleMap(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const entries = [];
    Object.entries(raw).forEach(([rawKey, rawTags]) => {
      const key = String(rawKey || '').trim();
      if (!key) return;
      const values = Array.isArray(rawTags) ? rawTags : String(rawTags || '').split(/[,，、;；]/);
      const tags = [...new Set(values.map(normalizeTag).filter(Boolean))];
      if (tags.length) entries.push([key, tags]);
    });
    return Object.fromEntries(entries);
  }

  function mergeLegacyDomainGroups(rules, legacyGroups) {
    const merged = {
      domain: { ...rules.domain },
      keyword: { ...rules.keyword }
    };
    if (!legacyGroups || typeof legacyGroups !== 'object' || Array.isArray(legacyGroups)) return merged;
    Object.entries(legacyGroups).forEach(([rawDomain, rawCategory]) => {
      const domain = String(rawDomain || '').trim().toLowerCase().replace(/^www\./, '');
      const category = normalizeTag(rawCategory);
      if (!domain || !category) return;
      const existing = Object.keys(merged.domain).some(key => key.toLowerCase() === domain);
      if (!existing) merged.domain[domain] = [category];
    });
    return merged;
  }

  function normalizeTagRules(raw, legacyGroups) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const rules = {
      domain: normalizeTagRuleMap(raw.domain),
      keyword: normalizeTagRuleMap(raw.keyword)
    };
    return mergeLegacyDomainGroups(rules, legacyGroups);
  }

  async function loadTagRules() {
    if (tagRulesCache) return tagRulesCache;
    try {
      const r = await chrome.storage.local.get([
        TAG_RULES_KEY, 'bmDomainGroups', LEGACY_DOMAIN_GROUPS_MIGRATED_KEY
      ]);
      const legacyGroups = r[LEGACY_DOMAIN_GROUPS_MIGRATED_KEY] ? null : r.bmDomainGroups;
      tagRulesCache = normalizeTagRules(r[TAG_RULES_KEY], legacyGroups);
    } catch (e) {
      tagRulesCache = normalizeTagRules();
    }
    return tagRulesCache;
  }

  function invalidateTagRules() {
    tagRulesCache = null;
    invalidateDomainGroups();
  }

  function getTagRules() { return tagRulesCache; }

  // 归一化任意标签到池：①精确 ②大小写不敏感 ③用户标签包含池标签（子串，防短词误伤）→ 池标签；否则 FALLBACK_TAG
  function normalizeToPool(tag) {
    const t = normalizeTag(tag);
    if (!t) return '';
    const pool = fixedTagsCache || [...DEFAULT_FIXED_TAGS, FALLBACK_TAG];
    if (pool.includes(t)) return t;
    const lower = t.toLowerCase();
    const byCase = pool.find(p => p.toLowerCase() === lower);
    if (byCase) return byCase;
    // 子串匹配：用户标签包含池标签才归并（"前端开发"→"前端"）；
    // 池标签为纯英文且 <3 字符（如 AI）不参与子串匹配，避免 "gmail"→"AI" 误伤；
    // 池标签含中文（如 前端）>=2 字符即可参与（中文 2 字是完整词）。
    if (lower.length >= 2) {
      const bySub = pool.find(p => {
        const pl = p.toLowerCase();
        if (pl === FALLBACK_TAG) return false;
        if (pl.length < 3 && !/[\u4e00-\u9fa5]/.test(pl)) return false; // 短英文池标签不做子串
        return pl.length <= lower.length && lower.includes(pl);
      });
      if (bySub) return bySub;
    }
    return FALLBACK_TAG;
  }

  function inferDomainTags(item, poolOverride) {
    let host = String(item && item.host || '').toLowerCase().replace(/^www\./, '');
    if (!host && item && item.url) {
      try { host = new URL(item.url).hostname.toLowerCase().replace(/^www\./, ''); }
      catch (e) { return []; }
    }
    if (!host) return [];
    const pool = Array.isArray(poolOverride) && poolOverride.length
      ? poolOverride
      : (fixedTagsCache || [...DEFAULT_FIXED_TAGS, FALLBACK_TAG]);
    const tags = [];
    const add = name => {
      const found = pool.find(tag => String(tag).toLowerCase() === name.toLowerCase());
      if (found && found !== FALLBACK_TAG && !tags.includes(found) && tags.length < 3) tags.push(found);
    };
    DOMAIN_TAG_RULES.forEach(rule => {
      if (rule.signals.some(signal => host.includes(signal))) rule.tags.forEach(add);
    });
    return tags;
  }

  function matchCustomTagRules(item, rulesOverride, poolOverride) {
    const rules = normalizeTagRules(rulesOverride || tagRulesCache);
    const pool = Array.isArray(poolOverride) && poolOverride.length
      ? poolOverride
      : (fixedTagsCache || [...DEFAULT_FIXED_TAGS, FALLBACK_TAG]);
    let host = String(item && item.host || '').toLowerCase().replace(/^www\./, '');
    let pathname = '';
    if (item && item.url) {
      try {
        const parsed = new URL(item.url);
        host = parsed.hostname.toLowerCase().replace(/^www\./, '') || host;
        try { pathname = decodeURIComponent(parsed.pathname); }
        catch (e) { pathname = parsed.pathname; }
      } catch (e) { /* 无效 URL 仍允许标题和显式 host 参与关键字规则 */ }
    }
    const keywordText = [item && item.title || '', host, pathname].join(' ').toLowerCase();
    const findTags = (map, text) => {
      const tags = [];
      Object.entries(map).forEach(([signal, values]) => {
        if (!text.includes(signal.toLowerCase())) return;
        values.forEach(value => {
          const found = pool.find(tag => String(tag).toLowerCase() === String(value).toLowerCase());
          if (found && found !== FALLBACK_TAG && !tags.includes(found) && tags.length < MAX_TAGS_PER_BOOKMARK) {
            tags.push(found);
          }
        });
      });
      return tags;
    };
    return {
      domain: findTags(rules.domain, host),
      keyword: findTags(rules.keyword, keywordText)
    };
  }

  function inferHighConfidenceTags(item, poolOverride) {
    const pool = Array.isArray(poolOverride) && poolOverride.length
      ? poolOverride
      : (fixedTagsCache || [...DEFAULT_FIXED_TAGS, FALLBACK_TAG]);
    const custom = matchCustomTagRules(item, tagRulesCache, pool);
    const tags = [];
    const add = value => {
      const found = pool.find(tag => String(tag).toLowerCase() === String(value || '').toLowerCase());
      if (found && found !== FALLBACK_TAG && !tags.includes(found) && tags.length < MAX_TAGS_PER_BOOKMARK) {
        tags.push(found);
      }
    };
    custom.domain.forEach(add);
    inferDomainTags(item, pool).forEach(add);
    custom.keyword.forEach(add);
    return tags;
  }

  // 覆盖设置（新增/编辑抽屉保存用）：归一化到固定池、去重、限数
  async function setTags(id, tags) {
    if (!id) return false;
    await loadFixedTags();
    const clean = [...new Set((tags || []).map(t => normalizeToPool(t)).filter(Boolean))].slice(0, MAX_TAGS_PER_BOOKMARK);
    const result = await persistTagChanges({ [id]: clean.length ? clean : null });
    if (!result.ok) return false;
    // 标签云同步（开启时）→ 防抖写入 storage.sync
    scheduleSyncTags();
    return true;
  }

  // 批量覆盖标签：先在内存中完成全部变更，再一次写入 local，避免大批操作反复序列化整张映射表。
  async function setTagsBatch(changes, mode) {
    await loadFixedTags();
    const next = {};
    Object.entries(changes || {}).forEach(([id, tags]) => {
      if (tags == null) {
        next[id] = null;
        return;
      }
      const clean = [...new Set((tags || []).map(tag => normalizeToPool(tag)).filter(Boolean))]
        .slice(0, MAX_TAGS_PER_BOOKMARK);
      next[id] = clean.length ? clean : null;
    });
    if (!Object.keys(next).length) return true;
    const result = await persistTagChanges(next, mode);
    if (result.ok) {
      scheduleSyncTags();
      return true;
    }
    return false;
  }

  async function mergeTagsBatch(changes) {
    return setTagsBatch(changes, 'merge');
  }

  // ================= 标签云同步（chrome.storage.sync，跨设备自动同步） =================
  // 数据量可能超过单项 sync 限额（8KB），因此按 2500 字符分片存储。
  // V2 使用规范化 URL 而非设备本地 bookmark id 作为跨设备主键。
  // 隐私：仅同步规范化 URL 键和标签名，不含标题或页面内容；需用户主动开启（bmSyncEnabled）。
  const SYNC_ENABLED_KEY = 'bmSyncEnabled';
  const SYNC_TAG_PREFIX = 'bmSyncTag_p';
  const SYNC_TAG_CNT = 'bmSyncTag_cnt';
  const SYNC_STATUS_KEY = 'bmTagSyncStatus';
  const SYNC_CHUNK_CHARS = 2500;      // 每片字符数（中文 UTF-8 3 字节 → ~7.5KB < 8KB 限制）
  let syncTimer = null;

  async function getTagSyncEnabled() {
    try {
      const synced = await chrome.storage.sync.get(SYNC_ENABLED_KEY);
      if (synced[SYNC_ENABLED_KEY]) return true;
      const local = await chrome.storage.local.get(SYNC_ENABLED_KEY);
      if (!local[SYNC_ENABLED_KEY]) return false;
      await chrome.storage.sync.set({ [SYNC_ENABLED_KEY]: true });
      return true;
    } catch (e) {
      try {
        const local = await chrome.storage.local.get(SYNC_ENABLED_KEY);
        return !!local[SYNC_ENABLED_KEY];
      } catch (e2) {
        return false;
      }
    }
  }

  async function setTagSyncStatus(lastError) {
    const at = Date.now();
    const status = lastError
      ? { lastError: String(lastError), at }
      : { lastError: '', at, lastSuccessAt: at };
    try {
      await chrome.storage.local.set({ [SYNC_STATUS_KEY]: status });
    } catch (e) { /* 状态写入不能掩盖真实同步错误 */ }
  }

  function projectTagsForSync(tagsMap, bookmarks) {
    const out = {};
    (bookmarks || []).forEach(bookmark => {
      if (!bookmark || !bookmark.id || !bookmark.url) return;
      const key = urlKey(bookmark.url);
      const tags = (tagsMap && tagsMap[bookmark.id]) || [];
      const clean = tags.filter(tag => tag && tag !== FALLBACK_TAG);
      if (!key || !clean.length) return;
      out[key] = [...new Set([...(out[key] || []), ...clean])].slice(0, MAX_TAGS_PER_BOOKMARK);
    });
    return out;
  }

  function resolveSyncTags(tagsMap, bookmarks) {
    const out = {};
    (bookmarks || []).forEach(bookmark => {
      if (!bookmark || !bookmark.id || !bookmark.url) return;
      const tags = tagsMap && tagsMap[urlKey(bookmark.url)];
      if (Array.isArray(tags) && tags.length) out[bookmark.id] = [...new Set(tags)].slice(0, MAX_TAGS_PER_BOOKMARK);
    });
    return out;
  }

  function collectBookmarks(nodes, out) {
    (nodes || []).forEach(node => {
      if (node && node.url) out.push(node);
      if (node && node.children) collectBookmarks(node.children, out);
    });
    return out;
  }

  function deserializeSyncTags(json) {
    try {
      const data = JSON.parse(json);
      if (!data || data.version !== 2 || !data.tags || typeof data.tags !== 'object') return null;
      const out = {};
      Object.keys(data.tags).forEach(key => {
        const tags = data.tags[key];
        if (Array.isArray(tags) && tags.length) out[key] = [...new Set(tags.filter(Boolean))].slice(0, MAX_TAGS_PER_BOOKMARK);
      });
      return out;
    } catch (e) {
      return null;
    }
  }

  // 分片序列化：{ urlKey: [tags] } → { 'bmSyncTag_p0': '...', ..., 'bmSyncTag_cnt': n }
  function serializeSyncTags(tagsMap) {
    const json = JSON.stringify({ version: 2, tags: tagsMap || {} });
    const chunks = [];
    for (let i = 0; i < json.length; i += SYNC_CHUNK_CHARS) {
      chunks.push(json.slice(i, i + SYNC_CHUNK_CHARS));
    }
    const out = {};
    chunks.forEach((c, i) => { out[SYNC_TAG_PREFIX + i] = c; });
    out[SYNC_TAG_CNT] = chunks.length;
    return out;
  }

  // 从 storage.sync 读分片并解析；返回标签映射（无数据 → null）
  async function parseSyncTags() {
    try {
      const r = await chrome.storage.sync.get(SYNC_TAG_CNT);
      const n = Number(r[SYNC_TAG_CNT]) || 0;
      if (!n) return null;
      const keys = [SYNC_TAG_CNT];
      for (let i = 0; i < n; i++) keys.push(SYNC_TAG_PREFIX + i);
      const rr = await chrome.storage.sync.get(keys);
      let json = '';
      for (let i = 0; i < n; i++) json += (rr[SYNC_TAG_PREFIX + i] || '');
      if (!json) return null;
      return deserializeSyncTags(json);
    } catch (e) { return null; }
  }

  async function pushTagsToCloud() {
    try {
      if (!await getTagSyncEnabled()) return false;
      const [tags, tree] = await Promise.all([loadTags(), chrome.bookmarks.getTree()]);
      await chrome.storage.sync.set(serializeSyncTags(projectTagsForSync(tags, collectBookmarks(tree, []))));
      await setTagSyncStatus('');
      return true;
    } catch (e) {
      await setTagSyncStatus((e && e.message) || e);
      throw e;
    }
  }

  // 防抖写入 sync（1.5s）
  function scheduleSyncTags() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      syncTimer = null;
      try {
        await pushTagsToCloud();
      } catch (e) { /* 超限/限频忽略 */ }
    }, 1500);
  }

  // 从 sync 拉取并合并进 local（union：不丢任何一端标签）；返回是否变化
  async function pullTagsFromCloud() {
    try {
      if (!await getTagSyncEnabled()) return false;
      const cloud = await parseSyncTags();
      if (!cloud) return false;
      const tree = await chrome.bookmarks.getTree();
      const result = await persistTagChanges(resolveSyncTags(cloud, collectBookmarks(tree, [])), 'merge');
      await setTagSyncStatus('');
      return !!(result.ok && result.changed);
    } catch (e) {
      await setTagSyncStatus((e && e.message) || e);
      return false;
    }
  }

  // 注册跨端同步监听：storage.sync 变化 → 拉取合并 → 返回变化（供 UI 决定是否刷新）
  function watchTagSync(onChange) {
    chrome.storage.sync.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (!Object.keys(changes).some(k => k === SYNC_ENABLED_KEY || k === SYNC_TAG_CNT || k.startsWith(SYNC_TAG_PREFIX))) return;
      pullTagsFromCloud().then(changed => { if (changed && onChange) onChange(); }).catch(() => {});
    });
  }

  // 追加单个标签（归一化到池、去重、限数）；返回是否新增成功
  async function addTag(id, tag) {
    await loadFixedTags();
    const t = normalizeToPool(tag);
    if (!t || !id) return false;
    const result = await persistTagChanges({ [id]: [t] }, 'merge');
    return !!(result.ok && result.changed);
  }

  // 移除单个标签；空数组时删除该书的标签记录
  async function removeTag(id, tag) {
    if (!id) return;
    await persistTagChanges({ [id]: [tag] }, 'remove');
  }

  // 删除书签时清理其标签记录
  async function clearTags(id) {
    if (!id) return;
    await persistTagChanges({ [id]: null });
  }

  // 全部标签及计数：{ tag: count }（仅统计已加载的数据）
  function getTagStats() {
    const g = tagsCache;
    const stats = {};
    if (g) {
      Object.keys(g).forEach(id => {
        (g[id] || []).forEach(t => { stats[t] = (stats[t] || 0) + 1; });
      });
    }
    return stats;
  }

  // 本地建议优先级：用户域名规则 → 公共预设 → 用户关键字规则 → 通用分类。
  function suggestTags(item) {
    const tags = inferHighConfidenceTags(item);
    const cat = categorize(item.host || '', item.url || '', item.title || '');
    if (cat && cat !== '未分类') tags.push(cat);
    const dom = getRegisteredDomain(item.host || '');
    if (dom && !tags.includes(dom)) tags.push(dom);
    // 只保留池内且非「其他」的建议
    return [...new Set(tags.map(t => normalizeToPool(t)))].filter(t => t && t !== FALLBACK_TAG).slice(0, MAX_TAGS_PER_BOOKMARK);
  }

  // ---- 隐藏书签：从日常视图（New Tab/标签页/清理统计）排除，但不删除 ----
  // 存储：chrome.storage.local 的 bmHiddenIds（书签 id 数组）
  const HIDDEN_KEY = 'bmHiddenIds';
  let hiddenCache = null;   // Set 或 null

  async function loadHiddenIds() {
    if (hiddenCache) return hiddenCache;
    try {
      const r = await chrome.storage.local.get(HIDDEN_KEY);
      hiddenCache = new Set(Array.isArray(r[HIDDEN_KEY]) ? r[HIDDEN_KEY] : []);
    } catch (e) { hiddenCache = new Set(); }
    return hiddenCache;
  }

  function invalidateHiddenIds() { hiddenCache = null; }

  // 同步判断（可能未加载，返回 false）
  function isHidden(id) { return hiddenCache ? hiddenCache.has(id) : false; }

  // 切换隐藏状态；返回新的状态（true = 已隐藏）
  async function toggleHidden(id) {
    if (!id) return false;
    await loadHiddenIds();
    let nowHidden;
    if (hiddenCache.has(id)) { hiddenCache.delete(id); nowHidden = false; }
    else { hiddenCache.add(id); nowHidden = true; }
    try { await chrome.storage.local.set({ [HIDDEN_KEY]: [...hiddenCache] }); } catch (e) { /* ignore */ }
    return nowHidden;
  }

  // 同域名+同路由检测用的路由键：普通页面取路径第一段（/index.html 视为首页）。
  // hash 路由携带实际页面位置，保留完整路由及参数，避免将不同 SPA 页面误判为同一路由。
  function routeKeyFromParsedUrl(url) {
    const hashRoute = hashRouteOf(url);
    if (hashRoute) return hashRoute;
    let segs = url.pathname.split('/').filter(Boolean);
    if (segs[0] === 'index.html') segs = [];
    return segs.length ? segs[0].toLowerCase() : '(首页)';
  }

  function routeKeyOf(url) {
    try {
      return routeKeyFromParsedUrl(new URL(url));
    } catch (e) { return '(无效)'; }
  }

  // 分析器热路径：一次 URL 解析生成全部派生字段，避免 host/key/route 各自重新解析。
  function getBookmarkMetadata(rawUrl, title) {
    const url = String(rawUrl || '');
    const safeTitle = String(title || '');
    let host = '';
    let domain = '';
    let key = url.trim().toLowerCase();
    let route = '(无效)';
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
      domain = getRegisteredDomain(host);
      key = urlKeyFromParsedUrl(parsed);
      route = routeKeyFromParsedUrl(parsed);
    } catch (e) { /* 与 urlKey / routeKeyOf 的无效 URL 回退一致 */ }
    const searchText = (host + ' ' + url + ' ' + safeTitle).toLowerCase();
    return {
      host,
      domain,
      key,
      route,
      category: categorizeWithHay(host, searchText, domain),
      sensitive: detectSensitive(host, url, safeTitle),
      searchText
    };
  }

  // ================= 检查更新（GitHub Releases API，方案 B） =================
  // 对比 manifest.version 与仓库最新 Release tag；返回 { current, latest, hasUpdate, url, body, error }
  const UPDATE_REPO = 'cfdywds/chrome-bookmark-manager';
  function compareVersions(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }
  function getVersion() {
    return (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '0.0.0';
  }
  // 内存缓存（避免 60次/小时 限流）：30 分钟内复用结果，包括失败结果
  let _lastCheck = null;   // { ts, result }
  async function checkForUpdate(force) {
    const current = getVersion();
    const now = Date.now();
    if (!force && _lastCheck && (now - _lastCheck.ts) < 30 * 60 * 1000) {
      return _lastCheck.result;   // 命中缓存：包括失败也复用，避免再触发限流
    }
    try {
      const resp = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
        // GitHub API 强制要求 User-Agent（裸 fetch 会被 403 拒绝）
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'chrome-ext-bookmark-manager'
        }
      });
      if (!resp.ok) {
        let err = '检查失败（HTTP ' + resp.status + '）';
        if (resp.status === 404) err = '仓库暂无 Release 发布';
        else if (resp.status === 403) err = 'GitHub API 拒绝（可能限流或网络问题），可去 GitHub Releases 页查看';
        else if (resp.status === 429) err = '请求太频繁（限流），稍后再试';
        const result = { current, latest: null, hasUpdate: false, error: err, releasesUrl: 'https://github.com/' + UPDATE_REPO + '/releases' };
        _lastCheck = { ts: now, result };
        return result;
      }
      const data = await resp.json();
      const latest = String(data.tag_name || '').replace(/^v/i, '');
      if (!latest) {
        const result = { current, latest: null, hasUpdate: false, error: 'Release 无版本号', releasesUrl: 'https://github.com/' + UPDATE_REPO + '/releases' };
        _lastCheck = { ts: now, result };
        return result;
      }
      const result = {
        current,
        latest,
        hasUpdate: compareVersions(latest, current) > 0,
        url: data.html_url || '',
        name: data.name || '',
        body: data.body || '',
        publishedAt: data.published_at || '',
        releasesUrl: 'https://github.com/' + UPDATE_REPO + '/releases'
      };
      _lastCheck = { ts: now, result };
      return result;
    } catch (e) {
      const result = { current, latest: null, hasUpdate: false, error: '网络错误：' + (e.message || e), releasesUrl: 'https://github.com/' + UPDATE_REPO + '/releases' };
      _lastCheck = { ts: now, result };
      return result;
    }
  }

  // ---- LLM 服务商预设（popup.js / options.js 共享，DRY）----
  const PROVIDERS = {
    openai:   { base: 'https://api.openai.com/v1',            model: 'gpt-4o-mini' },
    deepseek: { base: 'https://api.deepseek.com/v1',          model: 'deepseek-chat' },
    grok:     { base: 'https://api.x.ai/v1',                  model: 'grok-2-latest' },
    groq:     { base: 'https://api.groq.com/openai/v1',       model: 'llama-3.3-70b-versatile' },
    gemini:   { base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
    ollama:   { base: 'http://localhost:11434/v1',            model: 'llama3' },
    custom:   { base: '', model: '' }
  };

  // 归一化模型返回的分类名：优先精确匹配，其次子串包含，否则回退「未分类」
  function normalizeCategory(cat, validSet) {
    cat = String(cat || '').trim();
    if (!cat) return '未分类';
    if (validSet.has(cat)) return cat;
    for (const c of validSet) {
      if (cat.includes(c) || c.includes(cat)) return c;
    }
    return '未分类';
  }

  // 容错解析 LLM 返回的 JSON：支持 {"results":[{id,category}]} 或 {"<id>":"<cat>"}，
  // 自动剥离 ```json 代码围栏，并只保留传入 items 中存在的 id。
  // validSet：合法分类集合（默认 26 类；AI 分类时应传入含域名组的候选集）
  function parseAiCategories(content, items, validSet) {
    let txt = String(content || '').trim();
    const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) txt = fence[1].trim();
    const s = txt.indexOf('{');
    const e = txt.lastIndexOf('}');
    if (s >= 0 && e > s) txt = txt.slice(s, e + 1);
    let obj;
    try { obj = JSON.parse(txt); }
    catch (err) { throw new Error('无法解析 LLM 返回的 JSON：' + txt.slice(0, 120)); }
    if (!validSet) validSet = new Set(getCategoryNames());
    const map = {};
    const arr = Array.isArray(obj) ? obj : (obj.results || obj.data || null);
    if (Array.isArray(arr)) {
      arr.forEach(r => {
        if (r && r.id != null && r.category != null) {
          map[String(r.id)] = normalizeCategory(r.category, validSet);
        }
      });
    } else if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(k => {
        if (k === 'results' || k === 'data') return;
        map[String(k)] = normalizeCategory(obj[k], validSet);
      });
    }
    const ids = new Set(items.map(i => String(i.id)));
    Object.keys(map).forEach(k => { if (!ids.has(k)) delete map[k]; });
    return map;
  }

  // 启发式检测：Base URL 是否疑似「网页版」地址（chat./platform./console. 等前端子域，
  // 或已知的网页端域名）。这类地址当 API 端点请求必然返回 HTML。
  function isWebUiBaseUrl(base) {
    try {
      const host = new URL(base).hostname.toLowerCase();
      if (/^(chat|platform|console|studio)\./i.test(host)) return true;
      if (/(chatgpt\.com|claude\.ai|gemini\.google\.com|perplexity\.ai|poe\.com|aistudio\.google\.com)$/i.test(host)) return true;
    } catch (e) { /* noop */ }
    return false;
  }

  // 生成候选 API 端点：兼容服务商「带/不带 /v1」两种格式（deepseek / openai 等均支持）。
  // 填 https://api.deepseek.com 或 https://api.deepseek.com/v1 都能工作。
  function candidateEndpoints(base) {
    const b = normalizeLlmBaseUrl(base);
    const out = [b + '/chat/completions'];
    if (b.endsWith('/v1')) out.push(b.replace(/\/v1$/, '') + '/chat/completions');
    else out.push(b + '/v1/chat/completions');
    return [...new Set(out)];
  }

  // 统一响应解析：处理「HTTP 200 但返回 HTML/非 JSON」的常见误配置场景。
  // 直接 resp.json() 会抛 "Unexpected token '<'"，对用户毫无提示。
  // 这里先看 Content-Type，再尝试 json()，失败时抓取响应片段给出可操作的诊断。
  async function parseJsonResp(resp, ctx, baseUrl) {
    const shown = baseUrl ? '（你填的 Base URL：' + baseUrl + '）' : '';
    const webHint = baseUrl && isWebUiBaseUrl(baseUrl)
      ? '检测到该地址疑似「网页版」前缀（chat./platform./console.），请改为 API 端点，如 https://api.deepseek.com/v1。'
      : '通常是 Base URL 填错：请填 API 端点（如 https://api.deepseek.com/v1），而不是网页地址（如 chat.deepseek.com / chatgpt.com）。';
    const ct = (resp.headers.get('content-type') || '');
    if (ct.includes('text/html') || ct.includes('text/plain')) {
      let snippet = '';
      try { snippet = (await resp.text()).replace(/\s+/g, ' ').slice(0, 100); } catch (e) { /* noop */ }
      throw new Error(
        ctx + '返回了 HTML 页面而非 JSON（HTTP ' + resp.status + '）' + shown + '。' + webHint + '页面片段：' + snippet
      );
    }
    try {
      return await resp.json();
    } catch (e) {
      let snippet = '';
      try { snippet = (await resp.text()).replace(/\s+/g, ' ').slice(0, 100); } catch (e2) { /* noop */ }
      throw new Error(
        ctx + '返回的不是合法 JSON（HTTP ' + resp.status + '）' + shown + '：' + snippet +
        '——请检查 Base URL / API Key / 模型名 是否正确'
      );
    }
  }

  // 发起一次 OpenAI 兼容请求
  async function fetchChatOnce(endpoint, body, cfg) {
    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify(body)
    });
  }

  function isAiEligibleItem(item) {
    if (!item || !isHttpUrl(item.url)) return false;
    return !getBookmarkMetadata(item.url, item.title).sensitive.some(hit => hit.sev === 'high');
  }

  // 公共请求：候选端点逐个尝试（兼容带/不带 /v1；HTML 响应与 4xx 换端点重试）。
  // 返回 200 + 非 HTML 的可用 resp；全部失败抛出带诊断的错误。
  async function chatWithFallback(body, cfg) {
    const base = normalizeLlmBaseUrl(cfg.baseUrl);
    const endpoints = candidateEndpoints(base);
    let resp = null;
    let lastErr = null;
    for (const ep of endpoints) {
      try {
        resp = await fetchChatOnce(ep, body, cfg);
      } catch (e) {
        lastErr = e;
        continue; // 网络错误：试下一个端点
      }
      const ct = (resp.headers.get('content-type') || '');
      if (resp.ok && !ct.includes('text/html') && !ct.includes('text/plain')) return resp; // 200 + JSON：命中
      lastErr = new Error('端点 ' + ep + ' 返回 HTTP ' + resp.status + (ct.includes('html') ? '（HTML 页面）' : ''));
      if (resp.status === 401 || resp.status === 403) break; // 认证错误换端点无用
    }
    if (!resp) {
      throw new Error('网络请求失败（可能是 Base URL 错误或 CORS/网络问题）：' + (lastErr && lastErr.message || lastErr));
    }
    if (isWebUiBaseUrl(base)) {
      throw new Error('你填的 Base URL（' + base + '）疑似「网页版」地址（chat./platform./console. 前缀）。请改为 API 端点，例如：\n· DeepSeek: https://api.deepseek.com/v1\n· OpenAI: https://api.openai.com/v1');
    }
    let detail = '';
    try {
      const j = await resp.json();
      detail = (j.error && (j.error.message || j.error)) || JSON.stringify(j);
    } catch (e) { detail = resp.statusText; }
    throw new Error('LLM 返回 HTTP ' + resp.status + '：' + detail + '（Base URL：' + base + '）');
  }

  // 调用 OpenAI 兼容协议的 LLM 对书签做分类
  // items: [{id, title, url}]（函数内会过滤高敏感和非 HTTP(S) 书签）
  // cfg:   { baseUrl, apiKey, model }
  // 返回: Promise<{ "<id>": "<分类名>" }>
  async function aiClassify(items, cfg) {
    if (!cfg || !cfg.apiKey || !cfg.baseUrl || !cfg.model) {
      throw new Error('未配置 API：请在「⚙️ 设置」中填写 Base URL、API Key 与模型名');
    }
    const eligibleItems = (items || []).filter(isAiEligibleItem);
    if (!eligibleItems.length) return {};
    const base = normalizeLlmBaseUrl(cfg.baseUrl);
    // 候选分类包含域名组（await 确保 storage 配置已加载），LLM 才知道 linux.do→Linux.do
    const cats = await getCategoryNamesWithDomains();
    const system = [
      '你是一个浏览器书签分类助手。我会给你一批书签（id、标题、网址）。',
      '请为每个书签判断最合适的中文分类。',
      '必须从下面的候选分类中严格选择其一，不要自创分类；若都不合适，选「未分类」。',
      '候选分类：' + cats.join('、') + '。',
      '只返回 JSON，不要任何额外说明，格式：',
      '{"results":[{"id":"<书签id>","category":"<分类名>"}]}'
    ].join('\n');
    const list = eligibleItems.map((it, i) =>
      `${i + 1}. [id=${it.id}] ${(it.title || '').slice(0, 80)} — ${sanitizeUrlForAI(it.url)}`
    ).join('\n');
    const user = '请分类以下书签：\n' + list;

    const body = {
      model: cfg.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.2
    };
    // 部分服务商支持 json 模式；不支持时忽略（靠容错解析兜底）
    try { body.response_format = { type: 'json_object' }; } catch (e) { /* noop */ }

    const resp = await chatWithFallback(body, cfg);
    const data = await parseJsonResp(resp, 'LLM', base);
    let content = '';
    try { content = data.choices[0].message.content || ''; }
    catch (e) { throw new Error('LLM 响应格式异常（缺少 choices[0].message.content）'); }
    return parseAiCategories(content, eligibleItems, new Set(cats));
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // AI 分批分类：按 batchSize 分批调用，遇 429/限流 指数退避重试，避免单次 token 超限
  // opts: { batchSize=50, retries=2, onProgress(ratio, done, total) }
  // 返回: { "<id>": "<分类名>" }
  async function aiClassifyBatched(items, cfg, opts) {
    opts = opts || {};
    const batchSize = opts.batchSize || 50;
    const retries = opts.retries == null ? 2 : opts.retries;
    const out = {};
    const total = items.length;
    for (let i = 0; i < total; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      let map = null, lastErr = null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          map = await aiClassify(batch, cfg);
          break;
        } catch (e) {
          lastErr = e;
          const msg = String((e && e.message) || e);
          if (/429|限流|rate|too many|quota/i.test(msg)) {
            if (attempt < retries) await sleep(Math.min(8000, 500 * Math.pow(2, attempt)));
            else break;
          } else {
            break; // 非限流错误不重试
          }
        }
      }
      if (!map && lastErr) throw lastErr;
      Object.assign(out, map || {});
      if (opts.onProgress) {
        opts.onProgress(Math.min(i + batch.length, total) / total, Math.min(i + batch.length, total), total);
      }
    }
    return out;
  }

  // 轻量连通性测试：发一个最简消息验证 key / base / model 是否可用
  async function testLLM(cfg) {
    if (!cfg || !cfg.apiKey || !cfg.baseUrl || !cfg.model) {
      throw new Error('请先填写 Base URL、API Key 与模型名');
    }
    const base = normalizeLlmBaseUrl(cfg.baseUrl);
    const body = {
      model: cfg.model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 8
    };
    try {
      const resp = await chatWithFallback(body, cfg);
      await parseJsonResp(resp, 'LLM', base);
    } catch (e) {
      // 统一前缀，便于设置页识别是「测试」流程
      throw new Error('测试失败：' + (e.message || e));
    }
    return true;
  }

  // ---- AI 多标签：LLM 为书签生成 1-3 个标签（强制从固定池选择）----
  // 返回: Promise<{ "<id>": ["标签1", "标签2"] }>
  async function aiTag(items, cfg) {
    if (!cfg || !cfg.apiKey || !cfg.baseUrl || !cfg.model) {
      throw new Error('未配置 API：请在「⚙️ 设置」中填写 Base URL、API Key 与模型名');
    }
    const eligibleItems = (items || []).filter(isAiEligibleItem);
    if (!eligibleItems.length) return {};
    // 固定标签池：AI 只能从池里选，禁止自创（收敛标签种类）
    const [pool] = await Promise.all([loadFixedTags(), loadTagRules()]);
    const poolNoFallback = pool.filter(t => t !== FALLBACK_TAG);
    const ruleTags = {};
    eligibleItems.forEach(item => { ruleTags[String(item.id)] = inferHighConfidenceTags(item, pool); });
    const system = [
      '你是一个浏览器书签打标签助手。我会给你一批书签（id、标题、网址）。',
      '请为每个书签从下面的候选标签中选择 1-3 个最贴切的，不要自创任何新标签。',
      '优先依据域名判断站点的实际用途，标题和路径只作补充；代码托管选代码，论坛平台选论坛，设计协作选设计/工作，组网或运维平台选运维/工具。',
      '输入中若提供“本地高置信标签”，必须保留这些标签，再补充其余候选标签。',
      '候选标签：' + poolNoFallback.join('、') + '。',
      '只返回 JSON，不要任何额外说明，格式：',
      '{"results":[{"id":"<书签id>","tags":["标签1","标签2"]}]}'
    ].join('\n');
    const list = eligibleItems.map((it, i) => {
      const known = ruleTags[String(it.id)];
      const hint = known.length ? `；本地高置信标签=${known.join('、')}` : '';
      return `${i + 1}. [id=${it.id}] ${(it.title || '').slice(0, 80)} — ${sanitizeUrlForAI(it.url)}${hint}`;
    }).join('\n');
    const user = '请给以下书签打标签：\n' + list;
    const body = {
      model: cfg.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.2
    };
    try { body.response_format = { type: 'json_object' }; } catch (e) { /* noop */ }
    const ruleOnly = Object.fromEntries(Object.entries(ruleTags).filter(([, tags]) => tags.length));
    try {
      const base = normalizeLlmBaseUrl(cfg.baseUrl);
      const resp = await chatWithFallback(body, cfg);
      const data = await parseJsonResp(resp, 'LLM', base);
      let content = '';
      try { content = data.choices[0].message.content || ''; }
      catch (e) { throw new Error('LLM 响应格式异常（缺少 choices[0].message.content）'); }
      const aiTags = parseAiTags(content, eligibleItems);
      const merged = {};
      eligibleItems.forEach(item => {
        const id = String(item.id);
        const tags = [...new Set([...(ruleTags[id] || []), ...(aiTags[id] || [])])];
        const meaningful = tags.filter(tag => tag !== FALLBACK_TAG);
        const clean = (meaningful.length ? meaningful : tags).slice(0, 3);
        if (clean.length) merged[id] = clean;
      });
      return merged;
    } catch (e) {
      if (Object.keys(ruleOnly).length === eligibleItems.length) return ruleOnly;
      const error = e instanceof Error ? e : new Error(String(e));
      error.ruleTags = ruleOnly;
      throw error;
    }
  }

  // AI 批量打标：分批调用 aiTag，遇 429/限流指数退避重试，避免单次 token 超限
  // opts: { batchSize=40, retries=2, onBatch(map, done, total), onProgress(ratio, done, total), shouldStop() }
  // onBatch 可异步持久化当前成功批次；shouldStop 每批开始前调用，返回 true 立即终止。
  // 返回: { "<id>": ["标签1", "标签2"] }
  async function aiTagBatched(items, cfg, opts) {
    opts = opts || {};
    const batchSize = opts.batchSize || 40;
    const retries = opts.retries == null ? 2 : opts.retries;
    const out = {};
    const total = items.length;
    for (let i = 0; i < total; i += batchSize) {
      // 终止检查：用户点「终止打标」后，不再发起新的批次请求
      if (opts.shouldStop && opts.shouldStop()) break;
      const batch = items.slice(i, i + batchSize);
      let map = null, lastErr = null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          map = await aiTag(batch, cfg);
          break;
        } catch (e) {
          lastErr = e;
          const msg = String((e && e.message) || e);
          if (/429|限流|rate|too many|quota/i.test(msg)) {
            if (attempt < retries) await sleep(Math.min(8000, 500 * Math.pow(2, attempt)));
            else break;
          } else {
            break; // 非限流错误不重试
          }
        }
      }
      if (!map && lastErr) {
        const ruleTags = lastErr.ruleTags || {};
        if (Object.keys(ruleTags).length) {
          if (opts.onBatch) await opts.onBatch(ruleTags, Math.min(i + batch.length, total), total);
          Object.assign(out, ruleTags);
        }
        throw lastErr;
      }
      if (opts.onBatch) {
        await opts.onBatch(map || {}, Math.min(i + batch.length, total), total);
      }
      Object.assign(out, map || {});
      if (opts.onProgress) {
        opts.onProgress(Math.min(i + batch.length, total) / total, Math.min(i + batch.length, total), total);
      }
    }
    return out;
  }

  // 容错解析 LLM 返回的多标签 JSON：
  // {"results":[{"id":"1","tags":["a","b"]}]}、{"1":["a","b"]} 或 {"1":{"tags":["a"]}}
  function parseAiTags(content, items) {
    let txt = String(content || '').trim();
    const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) txt = fence[1].trim();
    const s = txt.indexOf('{');
    const e = txt.lastIndexOf('}');
    if (s >= 0 && e > s) txt = txt.slice(s, e + 1);
    let obj;
    try { obj = JSON.parse(txt); }
    catch (err) { throw new Error('无法解析 LLM 返回的 JSON：' + txt.slice(0, 120)); }
    const map = {};
    const collect = (id, tags) => {
      if (id == null) return;
      // 兼容 tags:["a"] / tag:"a" / tags:"a,b" / 对象 {tags:[...]}
      let arr = null;
      if (Array.isArray(tags)) arr = tags;
      else if (typeof tags === 'string') arr = tags.split(/[,，、;；]/);
      else if (tags && typeof tags === 'object' && Array.isArray(tags.tags)) arr = tags.tags;
      // 归一化到固定池（AI 自创标签 → FALLBACK_TAG），去重、限数
      const clean = [...new Set((arr || []).map(t => normalizeToPool(t)).filter(Boolean))].slice(0, MAX_TAGS_PER_BOOKMARK);
      if (clean.length) map[String(id)] = clean;
    };
    const arr = Array.isArray(obj) ? obj : (obj.results || obj.data || null);
    if (Array.isArray(arr)) {
      arr.forEach(r => { if (r && r.id != null) collect(r.id, r.tags != null ? r.tags : r.tag); });
    } else if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(k => { if (k !== 'results' && k !== 'data') collect(k, obj[k]); });
    }
    const ids = new Set(items.map(i => String(i.id)));
    Object.keys(map).forEach(k => { if (!ids.has(k)) delete map[k]; });
    return map;
  }

  // ---- 回收站（软删除）：删除前备份 → 30 天内可恢复 → 到期自动清除 ----
  // 存储于 chrome.storage.local 的 bmTrash 数组；仅保护「书签管家」内的删除操作。
  const TRASH_KEY = 'bmTrash';
  const TRASH_MAX = 5000;           // 回收站条数上限（防存储撑爆；入站时先清过期再截断）
  const TRASH_TTL_DAYS = 30;        // 保留天数，到期永久删除
  const TRASH_MUTATION_MESSAGE = 'bmTrashMutation';

  async function getTrash() {
    try {
      const r = await chrome.storage.local.get(TRASH_KEY);
      return Array.isArray(r[TRASH_KEY]) ? r[TRASH_KEY] : [];
    } catch (e) { return []; }
  }

  async function requestTrashMutation(action, payload) {
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      throw new Error('回收站后台服务不可用，请重新加载扩展');
    }
    const response = await chrome.runtime.sendMessage(Object.assign({
      type: TRASH_MUTATION_MESSAGE,
      action
    }, payload || {}));
    if (!response || !response.ok) {
      throw new Error((response && response.error) || '回收站操作失败');
    }
    return response;
  }

  // 删除前调用：把书签信息（含原位置）写入回收站；已存在的 id 不重复入站
  // 入站时先清理已过期记录（保证 30 天内记录不被上限挤出），再按 TRASH_MAX 截断
  async function addToTrash(items, opts) {
    if (!items || !items.length) return 0;
    const remote = await requestTrashMutation('add', {
      items,
      deletionPending: !!(opts && opts.deletionPending)
    });
    return remote.added || 0;
  }

  // 物理删除完成后一次性确认成功项，移除失败项的预写回收站记录。
  async function completeTrashDelete(removedIds, failedIds) {
    await requestTrashMutation('completeDelete', {
      removedIds: [...new Set(removedIds || [])],
      failedIds: [...new Set(failedIds || [])]
    });
  }

  // 删除页面仍在运行时续期后台保护，避免恢复操作与物理删除交错。
  async function touchTrashDelete(ids) {
    await requestTrashMutation('heartbeatDelete', {
      ids: [...new Set(ids || [])]
    });
  }

  // 恢复：重建书签（优先原文件夹，已删则回退书签栏）；成功即移出回收站
  async function restoreTrashItem(trash) {
    const result = await restoreTrashItems([trash]);
    if (result.persistenceError) throw result.persistenceError;
    if (!result.restored) {
      const failure = result.failed[0];
      throw (failure && failure.error) || new Error('该记录无法恢复');
    }
    return { created: result.created[0], fallback: result.fallback > 0 };
  }

  // 批量恢复由后台串行执行：先持久化恢复标记，创建后逐项移除成功记录。
  // 中断或保存失败时标记仍保留，下次恢复会先检查已创建书签，避免重复创建。
  async function restoreTrashItems(items, opts) {
    opts = opts || {};
    const requestedIds = new Set((items || []).map(item => item && item.id).filter(Boolean));
    const requested = requestedIds.size ? [...requestedIds] : (await getTrash()).map(item => item.id);
    const result = await requestTrashMutation('restore', { ids: requested });
    const total = result.total || requested.length;
    if (typeof opts.onProgress === 'function' && total) {
      try { opts.onProgress({ done: total, total, restored: result.restored || 0 }); } catch (e) { /* 进度回调失败不影响恢复 */ }
    }
    return {
      restored: result.restored || 0,
      fallback: result.fallback || 0,
      failed: result.failed || [],
      created: [],
      persistenceError: result.persistenceError ? new Error(result.persistenceError) : null
    };
  }

  // 永久删除（丢弃记录，不调用 bookmarks API——书签早已物理删除）
  async function discardTrashItem(id) {
    await requestTrashMutation('discard', { id });
  }

  async function clearTrash() {
    await requestTrashMutation('clear');
  }

  // 清理过期项（超过 TTL 天数的记录直接丢弃），返回清理条数
  async function purgeExpiredTrash() {
    const remote = await requestTrashMutation('purge');
    return remote.purged || 0;
  }

  // ---- 书签备份 / 恢复（JSON 导出 / 导入） ----
  const BACKUP_APP = 'bookmark-manager';
  const BACKUP_IMPORT_MESSAGE = 'bmBackupImportBookmark';

  async function sendBackupImportMessage(action, parentId, url, bookmarkId) {
    try {
      if (!chrome.runtime || !chrome.runtime.sendMessage) return;
      const message = {
        type: BACKUP_IMPORT_MESSAGE,
        action,
        parentId,
        url
      };
      if (bookmarkId) message.bookmarkId = bookmarkId;
      await chrome.runtime.sendMessage(message);
    } catch (e) { /* 消息通道不可用时降级，保持原有恢复能力 */ }
  }

  function countBookmarks(nodes) {
    let n = 0;
    for (const node of nodes || []) {
      if (node.url) n++;
      if (node.children) n += countBookmarks(node.children);
    }
    return n;
  }

  // 导出全部书签树 + 回收站记录为 JSON 字符串
  async function exportBookmarksJSON() {
    const tree = await chrome.bookmarks.getTree();
    const trash = await getTrash();
    const tags = (await loadTags()) || {};
    const hiddenIds = [...(await loadHiddenIds())];
    const fixedTags = (await loadFixedTags()).filter(t => t !== FALLBACK_TAG);
    const tagRules = (await loadTagRules()) || {};
    const data = {
      app: BACKUP_APP,
      version: 3,               // v3：增加统一域名与关键字标签规则
      exportedAt: Date.now(),
      bookmarks: tree,
      trash,
      tags,                     // { 旧bookmarkId: [标签] } —— 导入时按 id 映射恢复
      hiddenIds,
      fixedTags,
      tagRules
    };
    return { json: JSON.stringify(data, null, 2), count: countBookmarks(tree) };
  }

  // 导入书签备份：默认合并完整 URL 相同的书签；keepDuplicates=true 时保留副本。
  // dryRun=true 仅统计不写入；返回 { folders, bookmarks, merged, skipped, reused }
  async function importBookmarksJSON(json, opts) {
    opts = opts || {};
    const dryRun = !!opts.dryRun;
    const keepDuplicates = !!opts.keepDuplicates;
    let data;
    try { data = JSON.parse(json); }
    catch (e) { throw new Error('JSON 解析失败：' + (e.message || e)); }
    if (!data || data.app !== BACKUP_APP || !Array.isArray(data.bookmarks)) {
      throw new Error('不是有效的书签管家备份文件（缺少 app / bookmarks 字段）');
    }
    const stats = { folders: 0, bookmarks: 0, merged: 0, skipped: 0, reused: 0 };
    const tree = await chrome.bookmarks.getTree();
    const bar = tree[0].children && tree[0].children[0];
    if (!bar) throw new Error('未找到书签栏根目录');
    const barTitle = bar.title || '';
    // 与手动新增一致，只按完整规范化 URL 合并；不同协议、查询参数或路由仍是不同书签。
    const bookmarksByUrl = new Map();
    function indexBookmarks(nodes) {
      (nodes || []).forEach(node => {
        if (node.url) {
          try {
            const url = normalizeHttpUrl(node.url).href;
            if (!bookmarksByUrl.has(url)) bookmarksByUrl.set(url, node);
          } catch (e) { /* 忽略现有的非 HTTP(S) 书签 */ }
        }
        if (node.children) indexBookmarks(node.children);
      });
    }
    indexBookmarks(tree);
    function hasBookmarkToCreate(nodes) {
      for (const node of nodes || []) {
        if (node.url) {
          try {
            const url = normalizeHttpUrl(node.url).href;
            if (keepDuplicates || !bookmarksByUrl.has(url)) return true;
          } catch (e) { /* 无效 URL 不会创建书签 */ }
        } else if (node.children && hasBookmarkToCreate(node.children)) {
          return true;
        }
      }
      return false;
    }
    // 顶级同名文件夹只需在书签栏已有节点中查询一次。逐个调用 bookmarks.search()
    // 会在大备份中反复扫描整棵树，导入后会明显卡顿。
    const topLevelFolders = new Map();
    (bar.children || []).forEach(node => {
      if (!node.url && !topLevelFolders.has(node.title || '')) {
        topLevelFolders.set(node.title || '', node);
      }
    });

    // 递归创建（顶级文件夹同名复用，深层总是新建）；记录 旧id → 新id 映射（恢复标签/隐藏用）
    const idMap = {};   // { oldId: newId }
    async function walk(nodes, parentId, depth) {
      for (const node of nodes || []) {
        if (node.url) {
          let url;
          try { url = normalizeHttpUrl(node.url).href; } catch (e) { stats.skipped++; continue; }
          const existing = !keepDuplicates && bookmarksByUrl.get(url);
          if (existing) {
            if (node.id) idMap[node.id] = existing.id;
            stats.merged++;
            continue;
          }
          if (dryRun) {
            stats.bookmarks++;
            // 让同一备份内后续相同 URL 也计入合并预览。
            bookmarksByUrl.set(url, { id: 'preview-' + stats.bookmarks });
            continue;
          }
          const createInfo = { parentId, title: node.title || url, url };
          await sendBackupImportMessage('reserve', createInfo.parentId, createInfo.url);
          try {
            const created = await chrome.bookmarks.create(createInfo);
            if (node.id) idMap[node.id] = created.id;
            bookmarksByUrl.set(url, created);
            await sendBackupImportMessage('confirm', createInfo.parentId, createInfo.url, created.id);
            stats.bookmarks++;
          } catch (e) {
            await sendBackupImportMessage('cancel', createInfo.parentId, createInfo.url);
            stats.skipped++;
          }
          continue;
        }
        if (!node.children || !node.children.length) continue;
        // 所有后代都会合并时不创建空目录，但仍遍历以恢复标签和隐藏状态映射。
        if (!hasBookmarkToCreate(node.children)) {
          await walk(node.children, parentId, depth + 1);
          continue;
        }
        if (dryRun) { stats.folders++; await walk(node.children, parentId, depth + 1); continue; }
        let pid = parentId;
        if (depth === 0) {
          // 顶级文件夹：同名校验栏下已有则复用，避免重复导入
          const folderTitle = node.title || '';
          const dup = topLevelFolders.get(folderTitle);
          if (dup) { pid = dup.id; if (node.id) idMap[node.id] = dup.id; stats.reused++; }
          else {
            try {
              const f = await chrome.bookmarks.create({ parentId, title: node.title || '(未命名)' });
              pid = f.id;
              topLevelFolders.set(folderTitle, f);
              if (node.id) idMap[node.id] = f.id;
              stats.folders++;
            } catch (e) { stats.skipped++; continue; }
          }
        } else {
          try {
            const f = await chrome.bookmarks.create({ parentId, title: node.title || '(未命名)' });
            pid = f.id; if (node.id) idMap[node.id] = f.id; stats.folders++;
          } catch (e) { stats.skipped++; continue; }
        }
        await walk(node.children, pid, depth + 1);
      }
    }
    // 只导入「书签栏」内容；「其他书签」「移动设备」等根目录跳过。
    // 兼容两种结构：①导出的是 Chrome 根节点（tree[0]，children 里含书签栏）
    //               ②导出的是书签栏节点本身（title = 书签栏）
    for (const root of data.bookmarks) {
      let barNode = null;
      if (root.title === barTitle) barNode = root;
      else if (!root.title && root.children) barNode = (root.children || []).find(n => n.title === barTitle);
      if (barNode) await walk(barNode.children || [], bar.id, 0);
    }

    // ---- 恢复自定义数据（v2+ 备份）----
    if (!dryRun) {
      // 先恢复来源标签池，再归一化和写入来源标签，避免自定义标签退化为「其他」。
      if (Array.isArray(data.fixedTags) && data.fixedTags.length) {
        try {
          await chrome.storage.local.set({ [FIXED_TAGS_KEY]: data.fixedTags });
          invalidateFixedTags();
        } catch (e) { /* ignore */ }
      }
      // 标签：多个旧 id 可能合并到同一已有书签；由后台串行写入并集，避免覆盖自动打标。
      if (data.tags && typeof data.tags === 'object') {
        const newTags = {};
        Object.keys(data.tags).forEach(oldId => {
          const nid = idMap[oldId];
          if (nid && Array.isArray(data.tags[oldId]) && data.tags[oldId].length) {
            newTags[nid] = [...new Set([...(newTags[nid] || []), ...data.tags[oldId]])];
          }
        });
        if (Object.keys(newTags).length) {
          try {
            await mergeTagsBatch(newTags);
          } catch (e) { /* ignore */ }
        }
      }
      // 隐藏书签：旧id → 新id
      if (Array.isArray(data.hiddenIds) && data.hiddenIds.length) {
        const newHidden = data.hiddenIds.map(id => idMap[id]).filter(Boolean);
        if (newHidden.length) {
          try {
            const cur = new Set((await loadHiddenIds()));
            newHidden.forEach(id => cur.add(id));
            await chrome.storage.local.set({ [HIDDEN_KEY]: [...cur] });
            invalidateHiddenIds();
          } catch (e) { /* ignore */ }
        }
      }
      // v3 的统一规则直接恢复；旧 v2 没有关键字规则，导入时保留当前关键字配置。
      if ((data.tagRules && typeof data.tagRules === 'object') ||
        (data.domainGroups && typeof data.domainGroups === 'object')) {
        try {
          const hasUnifiedRules = data.tagRules && typeof data.tagRules === 'object' && !Array.isArray(data.tagRules);
          let rules;
          if (hasUnifiedRules) {
            rules = normalizeTagRules(data.tagRules, data.domainGroups);
          } else {
            const current = await chrome.storage.local.get(TAG_RULES_KEY);
            const currentRules = normalizeTagRules(current[TAG_RULES_KEY]);
            rules = normalizeTagRules({ domain: data.domainGroups, keyword: currentRules.keyword });
          }
          await chrome.storage.local.set({
            [TAG_RULES_KEY]: rules,
            [LEGACY_DOMAIN_GROUPS_MIGRATED_KEY]: true
          });
          invalidateTagRules();
        } catch (e) { /* ignore */ }
      }
    }
    return stats;
  }

  // ---- 错误日志（本地留存最近 50 条，便于排查） ----
  async function logError(tag, err) {
    try {
      const key = 'bmErrorLog';
      const r = await chrome.storage.local.get(key);
      const list = Array.isArray(r[key]) ? r[key] : [];
      list.push({ tag, msg: String((err && (err.message || err)) || err), at: Date.now() });
      await chrome.storage.local.set({ [key]: list.slice(-50) });
    } catch (e) { /* ignore */ }
  }

  // ---- storage 版本迁移 ----
  const STORAGE_VERSION = 3;
  async function migrateStorage() {
    try {
      const r = await chrome.storage.local.get([
        'bmStorageVersion', FIXED_TAGS_KEY, TAG_RULES_KEY,
        'bmDomainGroups', LEGACY_DOMAIN_GROUPS_MIGRATED_KEY
      ]);
      const version = Number(r.bmStorageVersion) || 0;
      if (version >= STORAGE_VERSION && r[LEGACY_DOMAIN_GROUPS_MIGRATED_KEY]) return;
      const updates = { bmStorageVersion: STORAGE_VERSION };
      const upgradedTags = upgradeDefaultFixedTags(r[FIXED_TAGS_KEY]);
      if (upgradedTags !== r[FIXED_TAGS_KEY]) updates[FIXED_TAGS_KEY] = upgradedTags;
      if (version < 3 || !r[LEGACY_DOMAIN_GROUPS_MIGRATED_KEY]) {
        updates[TAG_RULES_KEY] = normalizeTagRules(r[TAG_RULES_KEY], r.bmDomainGroups);
        updates[LEGACY_DOMAIN_GROUPS_MIGRATED_KEY] = true;
      }
      await chrome.storage.local.set(updates);
      if (updates[FIXED_TAGS_KEY]) invalidateFixedTags();
      if (updates[TAG_RULES_KEY]) invalidateTagRules();
    } catch (e) { /* ignore */ }
  }

  // 兼容浏览器/Popup 与 Service Worker 上下文：Chrome MV3 下没有 Node 的 `global`
  globalThis.BM = {
    PUB_SUFFIXES,
    getRegisteredDomain,
    normalizeHost,
    normalizeHttpUrl,
    isHttpUrl,
    normalizeLlmBaseUrl,
    getLlmHostPermission,
    hasLlmHostPermission,
    requestLlmHostPermission,
    sanitizeUrlForAI,
    isWebUiBaseUrl,
    candidateEndpoints,
    urlKey,
    CATEGORY_RULES,
    categorize,
    SENSITIVE_RULES,
    detectSensitive,
    getCategoryNames,
    loadDomainGroups,
    invalidateDomainGroups,
    getDomainGroups,
    matchDomainGroup,
    getAllCategoryNames,
    getCategoryNamesWithDomains,
    TAGS_KEY,
    MAX_TAGS_PER_BOOKMARK,
    MAX_TAG_LEN,
    loadTags,
    invalidateTags,
    getTags,
    unionTagLists,
    normalizeTag,
    FIXED_TAGS_KEY,
    TAG_RULES_KEY,
    LEGACY_DEFAULT_FIXED_TAGS,
    DEFAULT_FIXED_TAGS,
    DOMAIN_TAG_RULES,
    FALLBACK_TAG,
    MAX_FIXED_TAGS,
    loadFixedTags,
    invalidateFixedTags,
    getFixedTags,
    loadTagRules,
    invalidateTagRules,
    getTagRules,
    normalizeTagRules,
    matchCustomTagRules,
    normalizeToPool,
    upgradeDefaultFixedTags,
    loadHiddenIds,
    invalidateHiddenIds,
    isHidden,
    toggleHidden,
    routeKeyOf,
    getBookmarkMetadata,
    setTags,
    setTagsBatch,
    mergeTagsBatch,
    addTag,
    removeTag,
    clearTags,
    getTagStats,
    suggestTags,
    inferDomainTags,
    inferHighConfidenceTags,
    getTagSyncEnabled,
    pushTagsToCloud,
    pullTagsFromCloud,
    watchTagSync,
    projectTagsForSync,
    resolveSyncTags,
    deserializeSyncTags,
    serializeSyncTags,
    SYNC_ENABLED_KEY,
    SYNC_TAG_CNT,
    SYNC_STATUS_KEY,
    checkForUpdate,
    getVersion,
    parseAiCategories,
    aiTag,
    aiTagBatched,
    parseAiTags,
    PROVIDERS,
    aiClassify,
    aiClassifyBatched,
    testLLM,
    TRASH_TTL_DAYS,
    TRASH_MAX,
    getTrash,
    addToTrash,
    completeTrashDelete,
    touchTrashDelete,
    restoreTrashItem,
    restoreTrashItems,
    discardTrashItem,
    clearTrash,
    purgeExpiredTrash,
    exportBookmarksJSON,
    importBookmarksJSON,
    logError,
    migrateStorage,
    STORAGE_VERSION
  };
})(typeof window !== 'undefined' ? window : globalThis);

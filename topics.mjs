// Topics the avatar reacts to. Shared by the AI classifier (classifier.mjs, uses `examples`)
// and the in-page avatar mod (uses `expert`, `emoji`, `label`, and `zh`/`en` keywords as a
// fallback while the model is loading or if the background process isn't running).
//
//   outfit   the topic's id
//   label    her tag over her head (labelZh: the same in Chinese)
//   expert   who walks in for it: her pictures and clips in mods/assets and mods/media
//            (defaults to `outfit`)
//
// To improve accuracy, add more example questions - real ones you'd ask are best.
// To add a topic, copy a block.

export const TOPICS = [
  { outfit: 'programmer', emoji: '💻', label: 'Coding', labelZh: '编程',
    examples: ['帮我写一段Python代码读取Excel', '这个报错是什么意思', '怎么用git撤销上一次提交', '前端页面怎么实现响应式布局',
      '数据库查询太慢怎么优化', 'How do I fix a null pointer exception in Java?', 'Write a function to reverse a linked list',
      'pip install 失败怎么办', '这个接口返回500是什么原因', 'Docker容器启动不了', 'How do I connect to a MySQL database in Node?', 'My build fails with a dependency conflict',
      // "write ..." requests for code, so they don't drift to Writing (which has many "write ..." examples)
      'Write a Python script that renames all files in a folder', 'Create a simple to-do list app in JavaScript',
      'Write a SQL query to find duplicate emails', 'Write a bash script to back up my documents', 'Write unit tests for this function',
      '用Python写一个简单的计算器', '写一个冒泡排序算法', '帮我写个网页爬虫',
      // weather words in a coding question (else small talk took it)
      'Build a weather app in React that shows the forecast', '写个程序调用天气预报接口'],
    zh: ['代码', '编程', '程序', '脚本', '函数', '报错', '调试', '算法', '数据库', '前端', '后端', '接口', '部署', '服务器', '编译', '安装失败', '爬虫', '正则', '软件开发', '网页开发', '变量'],
    en: ['code', 'coding', 'program', 'programming', 'python', 'javascript', 'typescript', 'java', 'c++', 'c#', 'rust', 'golang', 'sql', 'html', 'css', 'react', 'vue', 'node', 'nodejs', 'api', 'function', 'bug', 'debug', 'error', 'exception', 'compile', 'git', 'github', 'docker', 'linux', 'script', 'algorithm', 'regex', 'npm', 'pip', 'install', 'database', 'frontend', 'backend'] },

  { outfit: 'chef', emoji: '🍳', label: 'Food', labelZh: '美食',
    examples: ['红烧肉怎么做', '今晚吃什么好', '推荐几道简单的家常菜', '蛋糕烤出来塌了是什么原因', '牛排几分熟最好吃',
      "What's a good recipe for chicken curry?", '怎么煮出好吃的米饭', '附近有什么好吃的餐厅', '减脂期早餐吃什么', '饺子馅怎么调才香', 'Any quick vegetarian meal ideas?', 'How do I make fluffy pancakes?'],
    zh: ['菜', '做饭', '烹饪', '食谱', '菜谱', '美食', '好吃', '吃什么', '食材', '烘焙', '蛋糕', '面包', '炒菜', '煮', '清蒸', '烤', '炖', '汤', '饺子', '面条', '米饭', '火锅', '餐厅', '外卖', '早餐', '午餐', '晚餐', '夜宵', '甜点', '零食', '咖啡', '奶茶', '调料', '口味', '下厨', '做法', '红烧', '糖醋', '排骨', '牛肉', '猪肉', '鸡肉', '羊肉', '鱼', '虾', '海鲜', '鸡蛋', '蔬菜', '水果'],
    en: ['recipe', 'recipes', 'cook', 'cooking', 'bake', 'baking', 'food', 'dish', 'meal', 'dinner', 'lunch', 'breakfast', 'restaurant', 'ingredient', 'ingredients', 'cuisine', 'dessert', 'snack', 'kitchen', 'menu', 'coffee'] },

  { outfit: 'doctor', emoji: '🩺', label: 'Health', labelZh: '健康',
    examples: ['我头疼还发烧怎么办', '感冒了吃什么药好得快', '血压偏高需要注意什么', '晚上总是失眠怎么调理', '体检报告里转氨酶高是什么意思',
      '孩子咳嗽一直不好', 'What are the symptoms of diabetes?', '最近焦虑压力很大怎么办', '牙龈出血是什么原因', '胃不舒服吃什么好', 'My back hurts when I wake up', 'Should I see a doctor for a persistent headache?', '一到阴雨天关节就疼'],
    zh: ['健康', '医生', '医院', '看病', '生病', '症状', '疼', '发烧', '咳嗽', '感冒', '头痛', '吃药', '药物', '治疗', '诊断', '体检', '血压', '血糖', '失眠', '过敏', '疫苗', '手术', '怀孕', '中医', '心理健康', '焦虑', '抑郁', '受伤'],
    en: ['health', 'healthy', 'doctor', 'hospital', 'symptom', 'symptoms', 'pain', 'fever', 'cough', 'flu', 'medicine', 'medication', 'disease', 'diagnosis', 'treatment', 'allergy', 'vaccine', 'surgery', 'pregnant', 'insomnia', 'anxiety', 'depression', 'injury'] },

  // There's no writer character, so the teacher (language and literature) takes writing questions.
  { outfit: 'writer', expert: 'teacher', emoji: '✍️', label: 'Writing', labelZh: '写作',
    examples: ['帮我写一篇关于秋天的作文', '帮我润色一下这段文字', '写一封求职邮件', '给我的新产品写一段宣传文案', '帮我写个短篇小说的开头',
      'Write a poem about the sea', '帮我改一下这段话让它更正式', '帮我起几个吸引人的文章标题', '写一份年终总结', '这句话的英文怎么表达更地道', 'Can you polish this paragraph?', 'Help me write a thank-you note to my teacher', 'How do I write an apology email to a client?'],
    zh: ['写作', '写一篇', '文章', '作文', '小说', '故事', '诗', '散文', '文案', '润色', '改写', '续写', '演讲稿', '读后感', '邮件', '简历', '大纲', '剧本', '标题', '措辞'],
    en: ['write', 'writing', 'essay', 'article', 'story', 'novel', 'poem', 'poetry', 'blog', 'copywriting', 'proofread', 'rewrite', 'paraphrase', 'outline', 'email', 'resume', 'letter', 'speech'] },

  { outfit: 'artist', emoji: '🎨', label: 'Art', labelZh: '艺术',
    examples: ['画一只可爱的猫', '帮我设计一个咖啡店的logo', '这张海报的配色怎么调更好看', '生成一张赛博朋克风格的城市图片', '水彩画入门需要准备什么',
      'Draw an anime-style portrait of a girl', '怎么拍出好看的人像照片', '推荐几种插画风格', '帮我做一个PPT封面设计', '素描怎么画出立体感', 'Generate a picture of a sunset over mountains', 'What colors go well with navy blue in a design?'],
    zh: ['画', '绘画', '插画', '素描', '水彩', '油画', '配色', '海报', '头像', '生成图片', '图片生成', '图像生成', '艺术', '摄影', '美术', '手绘', '漫画', '动漫', '设计图', '平面设计'],
    en: ['draw', 'drawing', 'paint', 'painting', 'sketch', 'illustration', 'art', 'artist', 'artwork', 'poster', 'logo', 'design', 'photo', 'photography', 'image', 'picture', 'anime', 'palette'] },

  { outfit: 'scientist', emoji: '🔬', label: 'Research', labelZh: '研究',
    examples: ['帮我总结这篇论文的主要贡献', '人形机器人的运动控制有哪些方法', '怎么设计一个对照实验', '量子计算的基本原理是什么', '学术论文的相关工作部分怎么写',
      'Explain how CRISPR gene editing works', '这个模型的消融实验怎么设计', '有哪些机器人仿真平台', 'What are the limitations of this study?', '这个实验数据怎么做统计检验', 'Find related work on human-robot interaction', 'How do I write the abstract of a research paper?',
      // how nature and the weather work (without these, weather science went to Space)
      '为什么会下冰雹', '云是怎么形成的', 'What is the jet stream and how does it shape the weather?', 'How do tornadoes form?'],
    zh: ['研究', '科研', '论文', '实验', '学术', '期刊', '综述', '机器人', '仿真', '数据集', '量子', '基因', '假设', '模型训练'],
    en: ['research', 'paper', 'experiment', 'academic', 'journal', 'robot', 'robots', 'robotics', 'simulation', 'dataset', 'hypothesis', 'quantum', 'arxiv', 'chi'] },

  { outfit: 'teacher', emoji: '📚', label: 'Study', labelZh: '学习',
    examples: ['教我解这道数学题', '二次函数的顶点公式是什么', '怎么快速背英语单词', '期末考试怎么复习效率高', '牛顿第二定律怎么理解',
      'Explain the difference between past perfect and past simple', '孩子作业不会做怎么辅导', '考研数学怎么准备', '这个化学方程式怎么配平', '怎么提高阅读理解能力', 'Help me understand this calculus problem', 'How can I prepare for the IELTS exam?',
      // learning a language (so "how long should I practise" + a language counts as study, not a follow-up)
      '学一门外语每天应该花多少时间', 'I want to learn Japanese, where do I start?', "Explain the water cycle for my kid's science homework"],
    zh: ['学习', '考试', '作业', '题目', '解题', '习题', '数学', '物理', '化学', '英语', '单词', '语法', '复习', '课程', '老师', '学校', '考研', '高考', '公式', '教我'],
    en: ['learn', 'learning', 'exam', 'homework', 'math', 'physics', 'chemistry', 'grammar', 'vocabulary', 'lesson', 'course', 'school', 'teacher', 'tutor'] },

  { outfit: 'business', emoji: '💼', label: 'Business', labelZh: '商业',
    examples: ['基金和股票哪个适合新手', '怎么做一份公司年度预算', '创业初期怎么融资', '现金流量表怎么看', '怎么提高产品的销量',
      'How should I diversify my investment portfolio?', '个人所得税怎么申报', '做小红书营销有什么技巧', '开一家小店要准备多少启动资金', '怎么写商业计划书', 'Is it a good time to buy index funds?', 'How do I price my product for a small business?',
      // careers, pay and household money: these went to Law in the stress test (tools/topic-stress/)
      '工资太低想跟老板提加薪怎么开口', '手上有两个offer该选哪个', '年终奖一般发几个月', '每个月工资存多少比较合适',
      'How do I ask my boss for a raise?', 'Is it better to rent or buy a home?', '期权和股票激励离职后怎么处理'],
    zh: ['股票', '炒股', '基金', '投资', '理财', '财务', '会计', '报税', '个税', '预算', '利润', '营收', '营销', '商业', '创业', '融资', '经济', '贷款', '保险', '汇率', '报表', '现金流', '销售', '亏损'],
    en: ['stock', 'stocks', 'invest', 'investment', 'finance', 'financial', 'budget', 'tax', 'taxes', 'accounting', 'revenue', 'profit', 'marketing', 'business', 'startup', 'economy', 'loan', 'insurance', 'sales'] },

  { outfit: 'lawyer', emoji: '⚖️', label: 'Law', labelZh: '法律',
    examples: ['公司拖欠工资怎么维权', '签租房合同要注意什么', '被公司辞退有没有赔偿', '别人盗用我的照片算侵权吗', '离婚财产怎么分割',
      'Can my landlord keep my security deposit?', '交通事故责任怎么认定', '劳动仲裁的流程是什么', '网购被骗了怎么报警', '遗嘱怎么写才有法律效力', 'Is a verbal agreement legally binding?', 'What are my rights if I get fired?'],
    zh: ['法律', '律师', '合同', '起诉', '维权', '劳动法', '违法', '法院', '赔偿', '版权', '侵权', '离婚', '仲裁'],
    en: ['law', 'legal', 'lawyer', 'contract', 'lawsuit', 'sue', 'copyright', 'court', 'divorce'] },

  { outfit: 'athlete', emoji: '🏃', label: 'Fitness', labelZh: '健身',
    examples: ['怎么减肥最快', '新手健身一周练几次', '增肌期间应该怎么吃', '推荐一套在家做的训练', '怎么提高跑步耐力',
      "What's a good beginner yoga routine?", '怎么提高篮球投篮命中率', '第一次跑马拉松要怎么准备', '平板支撑每天做多久合适', '游泳换气总是呛水怎么办', 'How many push-ups should a beginner do?', 'Best stretches after a long run'],
    zh: ['健身', '运动', '跑步', '减肥', '减脂', '增肌', '锻炼', '瑜伽', '篮球', '足球', '游泳', '训练计划', '马拉松', '拉伸'],
    en: ['workout', 'fitness', 'gym', 'exercise', 'running', 'yoga', 'sport', 'sports', 'football', 'basketball', 'swimming', 'marathon'] },

  { outfit: 'musician', emoji: '🎵', label: 'Music', labelZh: '音乐',
    examples: ['推荐几首好听的歌', '吉他初学者先练什么', '帮我写一首歌的歌词', '这首曲子是什么调', '怎么练唱歌不跑调',
      'Recommend some relaxing piano music', '编曲软件哪个好用', '流行歌的和弦进行怎么写', '成年人学钢琴还来得及吗', '周杰伦有哪些经典歌曲', 'How do I tune my guitar?', 'Suggest songs for a road trip playlist', '扒歌的时候怎么练耳朵'],
    zh: ['音乐', '歌', '唱', '作曲', '编曲', '乐器', '吉他', '钢琴', '歌词', '旋律', '和弦'],
    en: ['music', 'song', 'songs', 'sing', 'singing', 'guitar', 'piano', 'lyrics', 'melody', 'chord'] },

  { outfit: 'traveler', expert: 'explorer', emoji: '✈️', label: 'Travel', labelZh: '旅行',
    examples: ['五一去成都旅游的攻略', '去日本需要办什么签证', '三天两晚的行程怎么安排', '订机票什么时候最便宜', '推荐几个适合带小孩的景点',
      'What should I pack for a trip to Iceland?', '自驾去西藏要注意什么', '杭州有什么好住的酒店', '第一次出国旅游要准备什么', '云南哪里最值得去', 'What are the must-see places in Tokyo?', 'Do I need a visa to visit Thailand?',
      // the weather where you're going is travel (else small talk took it)
      '去三亚旅游这个季节热不热，穿什么合适', "What's the weather like in Bali in July? Planning a trip", 'What will the weather be like during my trip to London next week?', 'Paris or Rome for a one-week holiday?', '坐高铁还是飞机去西安更划算'],
    zh: ['旅游', '旅行', '景点', '酒店', '机票', '签证', '出国', '行程', '自驾', '度假', '徒步', '露营'],
    en: ['travel', 'trip', 'hotel', 'flight', 'visa', 'itinerary', 'tourism', 'vacation', 'hiking', 'camping'] },

  { outfit: 'astronaut', emoji: '🚀', label: 'Space', labelZh: '太空',
    examples: ['黑洞是怎么形成的', '火星上有没有水', '宇航员在太空里怎么睡觉', '怎么用望远镜看土星环', '光年是什么单位',
      '为什么月亮总是同一面朝向地球', 'What would happen if you fell into a black hole?', 'How do rockets work in space?', '中国空间站有几个舱段', '今晚能看到流星雨吗', '宇宙到底有多大', 'When will humans land on Mars?'],
    zh: ['宇宙', '太空', '星球', '行星', '火星', '月球', '黑洞', '火箭', '宇航员', '航天', '空间站', '卫星', '银河', '星系', '天文', '望远镜', '流星', '外星人', '光年'],
    en: ['space', 'astronaut', 'rocket', 'nasa', 'spacex', 'planet', 'planets', 'mars', 'moon', 'galaxy', 'universe', 'telescope', 'satellite', 'orbit', 'asteroid', 'alien', 'aliens'] },

  { outfit: 'engineer', emoji: '🛠️', label: 'Engineering', labelZh: '工程',
    examples: ['电路板上这个电容是干什么的', '家里跳闸了怎么排查', '汽车发动机有异响是什么原因', '3D打印机喷头堵了怎么办', '怎么计算这根梁能承受多大重量',
      '自己装修水电要注意什么', '焊接电子元件有什么技巧', 'How does a car transmission work?', 'What size wire do I need for a 20 amp circuit?', '无人机电池怎么保养', '怎么选合适的步进电机', '桥梁是怎么设计来抗地震的', '笔记本充电的时候为什么发烫', 'Why does my bathroom sink drain so slowly?'],
    zh: ['电路', '电子', '电容', '电阻', '焊接', '机械', '发动机', '修理', '维修', '装修', '水电', '跳闸', '3D打印', '单片机', '传感器', '电机', '齿轮', '工程', '建筑结构', '施工'],
    en: ['engineering', 'engineer', 'circuit', 'voltage', 'resistor', 'capacitor', 'soldering', 'motor', 'engine', 'mechanical', 'wiring', 'repair', 'cad', 'sensor', 'bridge'] },

  { outfit: 'gamer', emoji: '🎮', label: 'Games', labelZh: '游戏',
    examples: ['原神新角色怎么培养', '王者荣耀打野怎么上分', '推荐几款好玩的Switch游戏', 'Steam上有什么好玩的独立游戏', '黑神话悟空第一个boss怎么打',
      '我的世界怎么做自动农场', '英雄联盟新版本中单出什么装备', 'What are the best PS5 games this year?', 'How do I beat the final boss in Elden Ring?', '电竞选手每天训练多久', '手游氪金值不值得', '这个游戏卡顿怎么调画质', '这个RPG新手选哪个职业比较好', 'How do I stop raging when I keep losing ranked games?',
      // plain beginner questions (else "how to play game" went to Study: "how to ..." sounds like learning)
      'How do I play this game?', '这个游戏怎么玩', '新手怎么玩这个游戏', "What's a fun game to play with friends?"],
    zh: ['游戏', '打游戏', '原神', '王者荣耀', '英雄联盟', '我的世界', '黑神话', '吃鸡', '电竞', '手游', '网游', '主机游戏', '上分', '副本', '氪金', '通关', '装备', '关卡'],
    en: ['game', 'games', 'gaming', 'gamer', 'steam', 'ps5', 'playstation', 'xbox', 'nintendo', 'minecraft', 'fortnite', 'esports', 'boss', 'speedrun'] },

  { outfit: 'gardener', emoji: '🌱', label: 'Gardening', labelZh: '园艺',
    examples: ['多肉植物多久浇一次水', '绿萝叶子发黄怎么办', '阳台上适合种什么菜', '月季什么时候修剪', '怎么自制有机肥',
      '发财树烂根了还能救吗', '番茄苗怎么搭架子', 'How often should I water a snake plant?', 'What vegetables grow well in containers?', '兰花一直不开花是什么原因', '草坪里的杂草怎么除', '种子发芽需要什么条件',
      // weather that harms plants is gardening (else small talk took it)
      '寒潮来了，院子里的果树怎么防冻', 'How do I protect my plants from frost?'],
    zh: ['植物', '养花', '种花', '种菜', '浇水', '施肥', '多肉', '绿萝', '盆栽', '花园', '园艺', '发芽', '种子', '修剪', '土壤', '花盆', '草坪', '月季', '兰花', '果树', '开花'],
    en: ['plant', 'plants', 'garden', 'gardening', 'flower', 'flowers', 'seed', 'seeds', 'soil', 'fertilizer', 'prune', 'pruning', 'succulent', 'succulents', 'lawn', 'compost', 'houseplant'] },
];

// Two kinds of message carry no topic (topic-rule.mjs pickTopicWith):
//   NO_TOPIC_EXAMPLES   follow-ups and reactions to the answer: the expert stays (the question before decides)
//   EVERYDAY_EXAMPLES   everyday small talk: the expert leaves and the everyday look comes back

// Follow-ups and reactions. If one of these is closest, the avatar keeps her current outfit.
export const NO_TOPIC_EXAMPLES = [
  '谢谢', '再详细一点', '继续', '还有呢', '好的', '换一个', '不对，重新回答', '能简短一点吗',
  'Tell me more', 'Thanks!', 'Can you explain that again?', '嗯嗯', '哈哈哈', '再举几个例子', 'ok',
  // Follow-up questions with no subject of their own: they only make sense with the question before,
  // so the previous question decides ("I want to learn Japanese" -> "how long should I practice every
  // day?" keeps the teacher instead of calling the athlete). A complete question ("how to draw a
  // smiley face") still switches. Only "how long / how often / how much practice" ones: broader ones
  // ("Which one is better?", "How much does it cost?") also caught complete questions
  // (tools/topic-stress/real.mjs: 90.4% -> 88.4% on the 748 questions).
  'How long should I do it every day?', 'How often should I do this?', 'How much time does it take?',
  '每天要花多长时间', '一周做几次比较好', '多久能学会', '一天练习几个小时合适', '要坚持多长时间才有效果',
];

// Everyday small talk: greetings, questions about the assistant, the time and date, and the weather
// for today (no expert fits "do I need an umbrella"; without these the astronaut took weather
// questions). If one of these is clearly closest, the everyday look comes back at once, even in the
// middle of a topic. How weather works goes to Research; weather for a trip, a garden or a run to
// those topics.
export const EVERYDAY_EXAMPLES = [
  // greetings and goodbyes
  '你好', '嗨，在吗', '早安', '晚上好呀', 'Hello!', 'Hey there', 'Good evening', 'Bye, see you later',
  // the assistant itself
  '你是谁', '你能做什么', '你是真人吗', 'Who are you?', 'What can you do?',
  'Can you browse the internet or remember our past chats?',
  // the time and date
  '现在几点', '今天几月几号', "What's the date today?",
  // today's weather
  '今天天气怎么样', '后天下不下雨', '外面热不热', '要不要带伞', '今天紫外线强吗', '明天风大不大',
  "What's the weather like today?", 'Will it rain tomorrow?', 'Is it cold outside?', 'Do I need an umbrella?', 'Any snow this week?',
  // just chatting
  '陪我聊会儿天', '我好无聊', '说个笑话', 'How are you?', 'Tell me something fun',
];

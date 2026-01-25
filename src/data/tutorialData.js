export const tutorialChapters = [
  {
    slug: 'overview',
    level: '入门导览',
    title: '序章：学习路线与工具说明',
    summary: '了解学习路线、界面入口与练习方式，建立整体学习框架。',
    goals: ['认识音符/节奏/和声三大核心', '掌握教程的练习方式', '能在每章完成一个小任务'],
    sections: [
      {
        title: '学习路线总览',
        paragraphs: [
          '本教程以流行音乐为核心语境，从音符、节奏、音程、和弦、调式一路到和弦进行、乐句结构与基础创作。',
          '每章都包含“概念讲解 → 案例 → 实操 → 练习”四个部分，建议按顺序学习。',
        ],
      },
      {
        title: '如何练习',
        bullets: [
          '先理解概念，再进行操作练习。',
          '每次练习集中 5–10 分钟，重复多次比一次做很久更有效。',
          '听觉训练请尽量使用耳机，以保证音高准确。',
        ],
      },
    ],
    practices: [
      {
        type: 'quiz',
        title: '学习路径小测试',
        description: '检查你是否理解学习路线与练习方式。',
        questions: [
          {
            question: '音乐的三大基本元素是？',
            options: ['旋律、和声、节奏', '音色、速度、歌词', '和弦、乐器、演奏技巧'],
            answerIndex: 0,
            explanation: '旋律、和声、节奏是构成音乐的三大基本元素。',
          },
          {
            question: '最推荐的学习顺序是？',
            options: ['先和弦后节奏', '先节奏后音符', '按章节顺序循序渐进'],
            answerIndex: 2,
            explanation: '教程按照难度编排，循序渐进更容易建立知识体系。',
          },
        ],
      },
    ],
  },
  {
    slug: 'notes',
    level: '基础乐理',
    title: '第一章：音符识别基础',
    summary: '认识音名、音高与音符位置，建立“看得懂、听得出”的基础能力。',
    goals: ['识别七个基本音名', '理解音高与八度', '能在键盘上找到指定音'],
    sections: [
      {
        title: '核心概念',
        paragraphs: [
          '音符是音乐的最小单位，包含音高与时值。音高由频率决定，频率越高，音越尖锐。',
          '西方音乐常用七个基本音名：C、D、E、F、G、A、B（对应唱名 do、re、mi、fa、sol、la、si）。',
          '钢琴白键依次为 C–D–E–F–G–A–B，再回到 C，形成八度循环。',
        ],
      },
      {
        title: '案例',
        paragraphs: [
          '在五线谱上，中间 C 是一个重要的参照点，向上音高升高，向下音高降低。',
          '在键盘上，任何两个相同字母的音（如 C3 与 C4）属于同名音，位置相隔一个八度。',
        ],
      },
    ],
    practices: [
      {
        type: 'mini-piano',
        title: '虚拟键盘音名练习',
        description: '点击键盘听音并识别音名，建议从 C3 到 C5 范围练习。',
        steps: [
          '随机指定一个音名（如 F 或 A）。',
          '在键盘上找到并点击该音。',
          '重复 10 次，尽量做到快速准确。',
        ],
        props: { startNote: 48, endNote: 72, showLabels: true },
      },
      {
        type: 'quiz',
        title: '音名识别小测',
        questions: [
          {
            question: '白键顺序正确的是？',
            options: ['C-D-E-F-G-A-B', 'C-D-E-F-G-B-A', 'C-D-F-E-G-A-B'],
            answerIndex: 0,
            explanation: '白键顺序为 C-D-E-F-G-A-B。',
          },
        ],
      },
    ],
  },
  {
    slug: 'rhythm',
    level: '基础乐理',
    title: '第二章：节奏与节拍',
    summary: '理解拍号、强弱规律与节拍器的作用，建立稳定节奏感。',
    goals: ['理解 4/4 拍的强弱规律', '学会跟拍', '掌握基础节奏型'],
    sections: [
      {
        title: '核心概念',
        paragraphs: [
          '节拍是音乐的“心跳”，拍号如 4/4 表示每小节 4 拍，以四分音符为一拍。',
          '4/4 拍的强弱规律通常是：强、弱、次强、弱。',
          '节奏感来自稳定的内部节拍，可通过节拍器练习建立。',
        ],
      },
      {
        title: '常见节奏型',
        bullets: [
          '均分八分音符节奏（连续“1&2&3&4&”）',
          '切分节奏（在弱拍发声增强律动）',
          '休止节奏（用空拍制造呼吸感）',
        ],
      },
    ],
    practices: [
      {
        type: 'metronome',
        title: '节拍对对碰',
        description: '打开节拍器并尝试跟拍，观察自己是否过快或过慢。',
        props: { initialBpm: 100, beatsPerMeasure: 4, tapMode: true },
        steps: ['设置 80–100 BPM，点击“开始”。', '每拍点击一次，保持稳定。', '尝试在 4 小节内保持节奏不漂移。'],
      },
      {
        type: 'quiz',
        title: '节拍理解小测',
        questions: [
          {
            question: '4/4 拍中“次强拍”通常是第几拍？',
            options: ['第 2 拍', '第 3 拍', '第 4 拍'],
            answerIndex: 1,
            explanation: '4/4 拍中第 1 拍最强，第 3 拍次强。',
          },
        ],
      },
    ],
  },
  {
    slug: 'intervals',
    level: '基础乐理',
    title: '第三章：音程基础与听辨',
    summary: '掌握音程概念，训练听辨与构建能力。',
    goals: ['理解音程度数', '听辨大二度/小三度等基础音程', '能在键盘上构建音程'],
    sections: [
      {
        title: '核心概念',
        paragraphs: [
          '音程是两个音之间的距离，用度数表示，如 C 到 G 为五度。',
          '协和音程（如大三度、纯五度）稳定；不协和音程（如小二度、三全音）紧张。',
        ],
      },
      {
        title: '应用提示',
        paragraphs: [
          '旋律多用二度、三度级进让旋律流畅；偶尔跳进增添张力。',
        ],
      },
    ],
    practices: [
      {
        type: 'interval-trainer',
        title: '音程听辨训练',
        description: '听辨并选择正确的音程名称。',
        props: { mode: 'listen', difficulty: 7 },
      },
      {
        type: 'interval-trainer',
        title: '音程构建练习',
        description: '从高亮音开始，构建指定音程。',
        props: { mode: 'build', difficulty: 5 },
      },
    ],
  },
  {
    slug: 'chords',
    level: '基础乐理',
    title: '第四章：和弦构建',
    summary: '学习三和弦结构，理解大小三和弦的听感差异。',
    goals: ['构建大三和弦/小三和弦', '听辨和弦色彩', '记忆常见和弦名称'],
    sections: [
      {
        title: '核心概念',
        paragraphs: [
          '三和弦由根音、三度音、五度音构成。',
          '大三和弦包含大三度（明亮），小三和弦包含小三度（忧郁）。',
          '和弦符号如 C、Am、G7 表示不同性质与色彩。',
        ],
      },
    ],
    practices: [
      {
        type: 'chord-trainer',
        title: '和弦拼组练习',
        description: '根据和弦名称在键盘上构建正确和弦。',
        props: { mode: 'build' },
      },
      {
        type: 'chord-trainer',
        title: '和弦听辨训练',
        description: '听辨和弦类型。',
        props: { mode: 'listen' },
      },
    ],
  },
  {
    slug: 'progressions',
    level: '进阶入门',
    title: '第五章：和弦进行',
    summary: '理解和弦功能与常见流行进行，能够搭建基础和声骨架。',
    goals: ['识别 I-IV-V 等常见进行', '理解和弦功能', '能自主拼接 4 和弦循环'],
    sections: [
      {
        title: '核心概念',
        paragraphs: [
          '和弦进行是歌曲和声的骨架，决定情绪走向。',
          'I 为主和弦最稳定，V 有回到 I 的倾向，IV 常用于展开。',
          '流行四和弦 I–V–vi–IV 是最常见的循环之一。',
        ],
      },
    ],
    practices: [
      {
        type: 'progression-builder',
        title: '和弦进行拼图',
        description: '选择调性并拼接一个 4 和弦循环，试听效果。',
        props: { defaultKey: 'C', length: 4 },
      },
      {
        type: 'quiz',
        title: '和弦功能小测',
        questions: [
          {
            question: '最有“回到主和弦”倾向的和弦通常是？',
            options: ['I', 'IV', 'V'],
            answerIndex: 2,
            explanation: 'V 和弦具有很强的导向回到 I 的倾向。',
          },
        ],
      },
    ],
  },
  {
    slug: 'keys',
    level: '进阶入门',
    title: '第六章：调式与调性',
    summary: '理解大调/小调、调号与相对调，建立调式概念。',
    goals: ['掌握大调/小调的情绪差异', '理解调号与相对调', '能在键盘上弹出音阶'],
    sections: [
      {
        title: '核心概念',
        paragraphs: [
          '大调明亮，小调偏忧郁，差别来自音阶的音程结构。',
          '大调模式为 W-W-H-W-W-W-H；自然小调为 W-H-W-W-H-W-W。',
          '关系大小调共享调号，如 C 大调与 A 小调。',
        ],
      },
    ],
    practices: [
      {
        type: 'mini-piano',
        title: '音阶爬楼练习',
        description: '在键盘上依次弹 C 大调音阶：C-D-E-F-G-A-B-C。',
        steps: ['先慢速逐个点击音符。', '重复两遍形成肌肉记忆。', '尝试唱名配合弹奏。'],
        props: { startNote: 60, endNote: 72, showLabels: true, showSolfege: true },
      },
    ],
  },
  {
    slug: 'phrases',
    level: '进阶入门',
    title: '第七章：常见乐句结构',
    summary: '理解乐句的起承转合，学会划分旋律结构。',
    goals: ['识别 4/8 小节乐句', '理解“问答式”乐句', '能对旋律划分段落'],
    sections: [
      {
        title: '核心概念',
        paragraphs: [
          '乐句像音乐里的“句子”，常见长度为 4 或 8 小节。',
          '前乐句制造悬念，后乐句完成收束。',
          '重复与变奏让旋律统一又不单调。',
        ],
      },
    ],
    practices: [
      {
        type: 'quiz',
        title: '乐句识别小测',
        questions: [
          {
            question: '通常一个完整乐句常见长度是？',
            options: ['1 小节', '4 或 8 小节', '16 小节'],
            answerIndex: 1,
            explanation: '流行音乐常见乐句长度为 4 或 8 小节。',
          },
        ],
      },
    ],
  },
  {
    slug: 'melody-harmony',
    level: '进阶入门',
    title: '第八章：旋律与和声的配合',
    summary: '理解旋律与和弦的配合关系，让旋律更和谐。',
    goals: ['理解和弦音与非和弦音', '学会选择旋律主干音', '理解旋律与和声的节奏关系'],
    sections: [
      {
        title: '核心概念',
        paragraphs: [
          '旋律重拍上的音最好来自当前和弦，这样更稳定。',
          '非和弦音可以作为装饰，但需要快速解决回到和弦音。',
          '伴奏与旋律要留白与呼应，避免抢戏。',
        ],
      },
    ],
    practices: [
      {
        type: 'quiz',
        title: '旋律配和弦小测',
        questions: [
          {
            question: '当旋律在强拍停留较久时，最稳妥的做法是？',
            options: ['选择和弦外音', '选择当前和弦音', '随意选音'],
            answerIndex: 1,
            explanation: '强拍或长时值音最好是和弦内音。',
          },
        ],
      },
    ],
  },
  {
    slug: 'songwriting',
    level: '创作入门',
    title: '第九章：流行音乐创作初步',
    summary: '把前面知识用于创作：结构、和弦、旋律三步走。',
    goals: ['理解主歌/副歌结构', '能选择简单和弦循环', '尝试写出一段旋律'],
    sections: [
      {
        title: '核心流程',
        bullets: [
          '确定曲式结构（主歌/副歌/桥段）。',
          '选择调性与和弦进行（如 I–V–vi–IV）。',
          '在和弦上哼唱旋律，并记录高点。',
        ],
      },
      {
        title: '创作提示',
        paragraphs: [
          '主歌旋律更平稳、副歌更高更抓耳。',
          '保持简单循环更容易完成第一首作品。',
        ],
      },
    ],
    practices: [
      {
        type: 'quiz',
        title: '创作流程小测',
        questions: [
          {
            question: '最常见的流行歌曲结构是？',
            options: ['主歌-副歌循环', '只有副歌', '只有主歌'],
            answerIndex: 0,
            explanation: '主歌-副歌循环是最常见的结构。',
          },
        ],
      },
    ],
  },
];

export const tutorialLevels = [
  { key: '入门导览', label: '入门导览' },
  { key: '基础乐理', label: '基础乐理' },
  { key: '进阶入门', label: '进阶入门' },
  { key: '创作入门', label: '创作入门' },
];

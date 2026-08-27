# Round 2 / 3 — 法律边界

> 第二轮调研，2026-08-27 跑。原始输出是 JSON，本文件机械转写，措辞未改。每条保留原文、来源 URL、日期和置信度；核实阶段推翻或修正过的条目在 Fact-check 一节，以那一节为准。
>
> 维度：legal-boundary

---

## Headline

Dropping the character sheds almost no legal exposure: SB 243's "anthropomorphic features" is an illustrative example, not a required element, and every binding obligation is triggered by the voice, the memory, or where the users are — meanwhile Qwen3-TTS is 33% more expensive than the incumbent, not cheaper.

## Verdict

Dropping the character removes far less legal exposure than the premise assumes, and none of what it removes is currently binding. SB 243's definition is not a checklist of elements you can fail one of: "anthropomorphic features" appears inside an illustrative "including by" clause modifying the operative element "capable of meeting a user's social needs", and that clause pairs anthropomorphism conjunctively with "being able to sustain a relationship across multiple interactions" — which cross-session memory keeps regardless of the art. The genuine exit from SB 243 is exclusion (A), a bot "used only for... productivity and analysis related to source information", and what threatens it is not the mascot but an observations system that distills the user rather than the book; New York's law is cleanly escaped on a different ground, because its three elements are expressly conjunctive and a reading app never "ask[s] unprompted or unsolicited emotion-based questions". In any case both statutes hook on user location — SB 243's operator is one who makes the platform available "to a user in the state" — so with a sole user in mainland China neither reaches the app today, and that fact, not the character, is what actually holds the exposure at zero. On the China side the character changes literally nothing: 《生成式人工智能服务管理暂行办法》第二条 turns the whole stack off for a build not offered 向境内公众, and when it does turn on, the labelling duty is triggered by 智能对话 and 合成人声 under 深度合成规定第十七条第一款 — the chat and the synthesized voice, both of which the voice-orb form retains and arguably foregrounds. The one Chinese provision where the change does real work is 第十条's duty to prevent minors' 过度依赖或者沉迷, against which a growth mechanic and an affection/energy bar would have been affirmative evidence. On Apple, two of the three premises are wrong: there is no AI-chatbot question in the age-rating questionnaire (verified against both the live page and a 2025 snapshot), the 2026 guidelines added nothing on AI assistants or companions, and the only rule that genuinely bites — 5.1.2(i)'s third-party-AI disclosure, correctly dated 2025-11-13 — gets heavier with memory, not lighter without a face. Separately, the TTS premise does not survive the numbers: qwen3-tts-flash-realtime lists at ¥1 per 10,000 characters with a Chinese character billed as two, i.e. ¥0.0002/字 against CosyVoice2's ¥0.00015/字, so it is 33% more expensive, and Alibaba publishes no TTFB figure at all — the latency claim remains exactly as unverified as the prior round found. Ship the simple orb if it is worth it for the reduced engineering, which is a real and sufficient reason; do not justify it as a legal move, because the legal argument is weak and the three levers that actually matter are user geography, the voice, and how much the memory is about the user rather than the book.

## Findings

### SB 243's "anthropomorphic features" is NOT a required element — it sits in an illustrative "including by" clause, so dropping the character does not exit the definition


Cal. Bus. & Prof. Code §22601(b)(1) verbatim: "'Companion chatbot' means an artificial intelligence system with a natural language interface that provides adaptive, human-like responses to user inputs and is capable of meeting a user's social needs, including by exhibiting anthropomorphic features and being able to sustain a relationship across multiple interactions." Parsed: the conjunctive REQUIRED core is (1) AI system, (2) natural language interface, (3) adaptive human-like responses, (4) capable of meeting a user's social needs. Everything after "including by" modifies element (4) and names one illustrative route to it — and that route is itself conjunctive (anthropomorphic features AND cross-session relationship). Under settled California canon "including" is a term of enlargement, not limitation. So removing the face/name/personality art deletes one half of one illustration while leaving the operative element ("capable of meeting a user's social needs") and the other half ("sustain a relationship across multiple interactions", satisfied by cross-session memory) fully intact. The character drop has evidentiary weight only; it does not settle the question.

- Source: https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22601
- Date: 2025-10-13 (Stats. 2025, Ch. 677; effective 2026-01-01)
- Confidence: high

### The real SB 243 exit for a reading app is exclusion (A) "productivity and analysis related to source information" — and cross-session "observations" about the user is what threatens it


§22601(b)(2)(A) verbatim: "A bot that is used only for customer service, a business' operational purposes, productivity and analysis related to source information, internal research, or technical assistance." A companion that analyzes the book the user is reading is squarely "analysis related to source information" — the book is the source information. The load-bearing word is "only". An AI that stays on the book keeps this exclusion; an "observations" system that distills what the USER is like (rather than what the BOOK says), or an AI that discusses the user's life or moods, destroys it. This is a memory-design decision, not a character-art decision, and it is far more determinative than the mascot.

- Source: https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22601
- Date: 2025-10-13
- Confidence: high

### The SB 243 "voice-activated assistant" exclusion is NOT available to an app — it is a hardware-device exclusion


§22601(b)(2)(C) verbatim: "A stand-alone consumer electronic device that functions as a speaker and voice command interface, acts as a voice-activated virtual assistant, and does not sustain a relationship across multiple interactions or generate outputs that are likely to elicit emotional responses in the user." This carves out Alexa/HomePod-class hardware. An iPadOS app is not a stand-alone consumer electronic device, so "we're just a voice assistant now" does not get the app out. It also independently fails the clause's own "does not sustain a relationship across multiple interactions" condition, because the app has cross-session memory.

- Source: https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22601
- Date: 2025-10-13
- Confidence: high

### SB 243's jurisdictional hook is the USER's location, not the developer's — a mainland-China developer with no California users is not an "operator"


§22601(e) verbatim: "'Operator' means a person who makes a companion chatbot platform available to a user in the state." There is no developer-domicile element, no revenue threshold and no employee threshold. Liability attaches on making the platform available to a user located in California. With a sole user in mainland China, SB 243 does not reach the app at all today — and this, not the character, is what currently keeps it out. The character has zero effect on this analysis. Note §22606: "The duties, remedies, and obligations imposed by this chapter are cumulative to the duties, remedies, or obligations imposed under other law."

- Source: https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22601
- Date: 2025-10-13
- Confidence: high

### SB 243's full obligation set if in scope: conditional AI disclosure, a crisis protocol that gates the chatbot entirely, minor-only 3-hour break reminders, a minors-suitability notice, and annual reporting from 2027-07-01


§22602(a): disclosure is CONDITIONAL — "If a reasonable person interacting with a companion chatbot would be misled to believe that the person is interacting with a human, an operator shall issue a clear and conspicuous notification indicating that the companion chatbot is artificially generated and not human." §22602(b)(1): "An operator shall prevent a companion chatbot on its companion chatbot platform from engaging with users unless the operator maintains a protocol for preventing the production of suicidal ideation, suicide, or self-harm content to the user, including... by providing a notification to the user that refers the user to crisis service providers, including a suicide hotline or crisis text line"; (b)(2) publish the protocol on the operator's website. §22602(c), only "for a user that the operator knows is a minor": (1) disclose AI interaction; (2) "a clear and conspicuous notification to the user at least every three hours for continuing companion chatbot interactions that reminds the user to take a break"; (3) reasonable measures against sexually explicit material. §22604: disclose "that companion chatbots may not be suitable for some minors." §22603: from 2027-07-01 annual report to the Office of Suicide Prevention of crisis-referral counts and protocols, no user identifiers, and "An operator shall use evidence-based methods for measuring suicidal ideation." A reading app would already do essentially NONE of these automatically; the crisis protocol is the one genuine engineering item, and note it is structured as a gate on the chatbot engaging at all, not an add-on.

- Source: https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260SB243
- Date: 2025-10-13
- Confidence: high

### New York's AI companion law is expressly CONJUNCTIVE across three elements, and a reading app fails element (ii) — this is a cleaner exit than SB 243 offers


N.Y. Gen. Bus. Law §1700(4)(a) verbatim: "'AI companion' means a system using artificial intelligence, generative artificial intelligence, and/or emotional recognition algorithms designed to simulate a sustained human or human-like relationship with a user by: (i) retaining information on prior interactions or user sessions and user preferences to personalize the interaction and facilitate ongoing engagement with the AI companion; (ii) asking unprompted or unsolicited emotion-based questions that go beyond a direct response to a user prompt; and (iii) sustaining an ongoing dialogue concerning matters personal to the user." The "and" joining (ii) to (iii) makes all three required. The app satisfies (i) via cross-session memory, but if the AI never asks unprompted emotion-based questions it fails (ii) and falls outside the definition regardless of the character. Exclusion §1700(4)(c)(ii) also helps: "any system that is primarily designed and marketed for providing efficiency improvements or, research or technical assistance." Jurisdictional hook, §1700(8): "'User' means any person who uses an AI companion for personal use within the state."

- Source: https://newyork.public.law/laws/n.y._general_business_law_section_1700
- Date: Last modified 2025-11-07; verified current 2026-08-22
- Confidence: high

### New York's break-reminder is STRICTER than California's — it applies to all users, not just minors — and enforcement is AG-only at up to $15,000/day


§1702 verbatim: "An operator shall provide a clear and conspicuous notification to a user at the beginning of any AI companion interaction which need not exceed once per day and at least every three hours for continuing AI companion interactions which states either verbally or in writing that the user is not communicating with a human." No minor limitation, unlike SB 243 §22602(c)(2). §1701 requires a suicidal-ideation/self-harm detection protocol with referral to the 988 hotline or a crisis text line. §1703: only the Attorney General may sue, "civil penalties of up to fifteen thousand dollars per day", proceeds to the suicide prevention fund. Unlike SB 243 there is NO private right of action.

- Source: https://newyork.public.law/laws/n.y._general_business_law_section_1702
- Date: Last modified 2025-11-07; verified current 2026-08-22
- Confidence: high

### The federal GUARD Act is NOT law but advanced further than commonly believed — reported out of Senate Judiciary on 2026-05-11 with a substitute amendment and 20 cosponsors


S. 3062, 119th Congress, "Guidelines for User Age-verification and Responsible Dialogue Act of 2025". Introduced 2025-10-28 by Hawley with Blumenthal, Britt, Warner, Murphy, Kelly. The Reported-in-Senate version is dated 2026-05-11: "May 11, 2026 Reported by Mr. Grassley, with an amendment / Strike out all after the enacting clause and insert the part printed in italic", Calendar No. 406, cosponsor list grown to 20 including Lee, Lankford, Cotton, Blackburn, Durbin, Coons, Gillibrand, Whitehouse. Status verified structurally: congress.gov serves the -is (Introduced) and -rs (Reported in Senate) text files, but -es (Engrossed in Senate), -eh, and -enr (Enrolled) all return 404, so it has passed neither chamber and is not law as of 2026-08-27.

- Source: https://www.congress.gov/119/bills/s3062/BILLS-119s3062rs.xml
- Date: 2026-05-11
- Confidence: high

### If enacted as reported, the GUARD Act would be the largest exposure of all — and dropping the character would barely help, because its core duties attach to ANY AI chatbot, not to companions


§5 obligations attach to a "covered entity" = "any person who makes publicly available to end consumers an artificial intelligence chatbot": (a) "shall require each individual accessing an artificial intelligence chatbot to make a user account"; (b) verify every user's age, freeze all pre-existing accounts on the effective date until verified, and re-verify periodically; (c)(1)(A) "at the initiation of each conversation with a user and at 30-minute intervals, clearly and conspicuously disclose... that the chatbot is an artificial intelligence system and not a human being"; (c)(2)(B) disclose that it "does not provide medical, legal, financial, or psychological services." Only §6 (barring minors outright) keys to "AI companion", which IS conjunctive: "(A) provides adaptive, human-like responses to user inputs; and (B) is designed to encourage or facilitate the simulation of interpersonal or emotional interaction, friendship, companionship, or therapeutic communication" — a book tutor fails (B). So the character drop escapes §6 but not §5's account/age-verification/disclosure regime. The chatbot exclusion is narrow and conjunctive: responses "limited to contextualized replies" AND "unable to respond on a range of topics outside of a narrow specified purpose" — an AI that discusses any book arguably fails the second prong.

- Source: https://www.congress.gov/119/bills/s3062/BILLS-119s3062rs.xml
- Date: 2026-05-11
- Confidence: high

### Utah's AI chatbot law is mental-health-only and does not reach a reading app, with or without a character


Utah H.B. 452 (2025 General Session, "Artificial Intelligence Amendments", enrolled), §9: "This bill takes effect on May 7, 2025." Definition verbatim: "'Mental health chatbot' means an artificial intelligence technology that: (i) uses generative artificial intelligence to engage in interactive conversations with a user of the mental health chatbot similar to the confidential communications that an individual would have with a licensed mental health therapist; and (ii) a supplier represents, or a reasonable person would believe, can or will provide mental health therapy or help a user manage or treat mental health conditions." Conjunctive, and a book-discussion assistant meets neither prong. Character irrelevant either way.

- Source: https://le.utah.gov/~2025/bills/hbillenr/HB0452.pdf
- Date: 2025-05-07
- Confidence: high

### California's broader kids-AI bill AB 1064 was vetoed and is dead — SB 243 is the only California companion-chatbot law in force, and it has not been amended


AB 1064 (Leading Ethical AI Development (LEAD) for Kids Act) passed both houses in September 2025, was "Vetoed by Governor" on 2025-10-13 — the same day SB 243 was signed — and "Consideration of Governor's veto stricken from file" on 2026-01-22, ending it. Separately, the codified text of Bus. & Prof. Code §22601 carries only the note "(Added by Stats. 2025, Ch. 677, Sec. 1. (SB 243) Effective January 1, 2026.)" with no amendment note, confirming Chapter 22.6 stands as enacted as of 2026-08-27.

- Source: https://leginfo.legislature.ca.gov/faces/billHistoryClient.xhtml?bill_id=202520260AB1064
- Date: 2026-01-22
- Confidence: high

### China's generative-AI Measures do not apply at all to a TestFlight build used only by its developer — the scope gate is "providing to the domestic public"


《生成式人工智能服务管理暂行办法》第二条第一款: "利用生成式人工智能技术向中华人民共和国境内公众提供生成文本、图片、音频、视频等内容的服务（以下称生成式人工智能服务），适用本办法。" And 第二条第三款 states the exclusion outright: "行业组织、企业、教育和科研机构、公共文化机构、有关专业机构等研发、应用生成式人工智能技术，未向境内公众提供生成式人工智能服务的，不适用本办法的规定。" A build distributed via TestFlight and used by one person — the developer himself — is not 向境内公众提供. The entire Chinese generative-AI compliance stack, including the 标识办法 (whose 第二条 scopes it to providers already caught by these Measures), therefore does not attach today. Dropping the character has nothing to do with this; the user count does.

- Source: https://www.gov.cn/zhengce/zhengceku/202307/content_6891752.htm
- Date: 2023-07-13 (effective 2023-08-15)
- Confidence: high

### The 算法备案 trigger is 舆论属性或者社会动员能力, and its statutory definition does not fit a private reading app — the character is irrelevant to it


《生成式人工智能服务管理暂行办法》第十七条: "提供具有舆论属性或者社会动员能力的生成式人工智能服务的，应当按照国家有关规定开展安全评估，并按照《互联网信息服务算法推荐管理规定》履行算法备案和变更、注销备案手续。" The trigger term is defined in 《具有舆论属性或社会动员能力的互联网信息服务安全评估规定》第二条: "（一）开办论坛、博客、微博客、聊天室、通讯群组、公众账号、短视频、网络直播、信息分享、小程序等信息服务或者附设相应功能；（二）开办提供公众舆论表达渠道或者具有发动社会公众从事特定活动能力的其他互联网信息服务。" A single-user reading app has no forum, group, public account, sharing feature, public-expression channel, or capacity to mobilize the public, under either limb. Note the practical caveat: CAC practice has tended to expect 备案 from public-facing LLM apps regardless, so this is a legal-text reading, not a prediction of regulator behaviour.

- Source: https://www.cac.gov.cn/2018-11/15/c_1123716072.htm
- Date: 2018-11-15
- Confidence: medium

### China's AI-audio labelling duty is triggered by the SYNTHESIZED VOICE and the CHAT — the two things the ChatGPT-voice-mode form keeps. Dropping the character changes not one clause


《人工智能生成合成内容标识办法》第四条 applies where the service falls within 《互联网信息服务深度合成管理规定》第十七条第一款, whose enumerated triggers are: "（一）智能对话、智能写作等模拟自然人进行文本的生成或者编辑服务；（二）合成人声、仿声等语音生成或者显著改变个人身份特征的编辑服务" — qualified by "可能导致公众混淆或者误认的". The app hits BOTH limbs: the chat is 智能对话, the TTS is 合成人声. 第四条（二） for audio verbatim: "在音频的起始、末尾或者中间适当位置添加语音提示或者音频节奏提示等标识，或者在交互场景界面中添加显著的提示标识。" An abstract voice orb is if anything MORE squarely within 合成人声 than an illustrated mascot would be, since the voice is the whole product surface. Effective 2025-09-01 (第十四条).

- Source: https://www.gov.cn/zhengce/zhengceku/202503/content_7014286.htm
- Date: 2025-03-14 (effective 2025-09-01)
- Confidence: high

### GB 45438-2025 specifies exactly what the AI-speech label must be, and the per-turn audio option is brutal — but the mandatory standard expressly permits a cheap persistent on-screen text label instead


GB 45438-2025 §5.3 (音频内容显式标识) verbatim: "a) 音频内容显式标识应采用语音标识或音频节奏标识。b) 语音标识应包含以下要素：1) 人工智能要素：包含'人工智能'或'AI'…；2) 生成合成要素：包含'生成'和/或'合成'…。c) 音频节奏标识应为'短长短短'的节奏。注1：'短长短短'节奏为'AI'的摩斯码表示。d) 音频内容显式标识应位于以下一个或多个位置：1) 音频的起始位置；2) 音频的末尾位置；3) 音频的中间适当位置。e) 语音标识应使用正常语速。注4：汉语正常语速约在120字/min~160字/min。" Critically, 注3: "在智能语音助手、智能客服、智能导航等音频的高频交互场景中，音频的起始位置、末尾位置是指一轮交互的起始位置和末尾位置" — i.e. EVERY TURN would need a spoken "AI生成" tag or the Morse rhythm. The escape hatch is §6 (交互场景界面显式标识): "a) 应采用文字提示。b) 应同时包含…人工智能要素…生成合成要素…。c) 应采取以下一种或多种方式：1) 在内容附近持续显示提示文字；2) 在交互场景界面顶部、底部、背景等适当位置持续显示提示文字。" So a persistent on-screen "AI生成" string near the audio control or pinned to the interface discharges the duty — a one-line UI change, not a per-turn audio prefix.

- Source: https://www.tc260.org.cn/upload/2025-03-15/1742009439794081593.pdf
- Date: 2025-03-14 (effective 2025-09-01)
- Confidence: high

### Using Alibaba's Qwen3-TTS does NOT shift the labelling duty to Alibaba — both layers are 服务提供者, and the user-facing duty stays with the app


《生成式人工智能服务管理暂行办法》第二十二条（二）: "生成式人工智能服务提供者，是指利用生成式人工智能技术提供生成式人工智能服务（包括通过提供可编程接口等方式提供生成式人工智能服务）的组织、个人。" GB 45438-2025 §3.7 mirrors it: "生成合成服务提供者：利用人工智能技术(包括通过提供可编程接口等方式)向公众提供生成合成文本、图片、音频、视频、虚拟场景等服务的组织或个人。" The API provider is a provider for what it emits; the app is a provider for what it puts in front of the user. The duties layer, they do not transfer. Because the 显式标识 duty is defined by what the USER perceives, it lands on the app. Negative finding: Alibaba's Bailian TTS documentation (both the realtime and non-realtime guides) contains no mention of 水印 or embedded content labelling in the returned audio — I found zero hits.

- Source: https://www.gov.cn/zhengce/zhengceku/202307/content_6891752.htm
- Date: 2023-07-13
- Confidence: high

### The 隐式标识 metadata duty has nowhere to attach in this architecture — raw PCM has no metadata container, and the duty only bites on download/copy/export


《标识办法》第五条 requires 隐式标识 "在生成合成内容的文件元数据中", and defines 文件元数据 as "按照特定编码格式嵌入到文件头部的描述性信息". 第四条 final paragraph limits the file-level obligation: "服务提供者提供生成合成内容下载、复制、导出等功能时，应当确保文件中含有满足要求的显式标识。" The architecture in docs/33 streams raw PCM over a WebSocket straight into Swift for playback; PCM carries no header metadata and the audio is played and discarded. With no download/copy/export feature there is no file and no metadata duty. If the app ever adds "save this narration", the duty appears — and that is a feature decision unrelated to the character.

- Source: https://www.gov.cn/zhengce/zhengceku/202503/content_7014286.htm
- Date: 2025-03-14
- Confidence: high

### The one place in Chinese law where dropping the character does real work: the minors over-reliance duty, which targets exactly the nurture/affection/energy mechanics


《生成式人工智能服务管理暂行办法》第十条 verbatim: "提供者应当明确并公开其服务的适用人群、场合、用途，指导使用者科学理性认识和依法使用生成式人工智能技术，采取有效措施防范未成年人用户过度依赖或者沉迷生成式人工智能服务。" The operative words are 过度依赖 (over-reliance) and 沉迷 (addiction/absorption). A growth/nurture mechanic, an affection state and a token-fed energy bar are engagement-maximizing loops of exactly the kind this article asks providers to guard against — they are affirmative evidence against the developer. Dropping them removes the app's single most incriminating artifact under this article. But the duty only attaches once the app is 向境内公众提供 (see 第二条), so today it is dormant.

- Source: https://www.gov.cn/zhengce/zhengceku/202307/content_6891752.htm
- Date: 2023-07-13
- Confidence: high

### China App Store listing triggers an app-store-level verification duty on AI labelling that TestFlight does not


《标识办法》第七条 verbatim: "互联网应用程序分发平台在应用程序上架或者上线审核时，应当要求互联网应用程序服务提供者说明是否提供人工智能生成合成服务。互联网应用程序服务提供者提供人工智能生成合成服务的，互联网应用程序分发平台应当核验其生成合成内容标识相关材料。" This is a duty on the distribution platform (Apple's China App Store) that converts into a documentation demand on the developer at listing review: state whether the app provides AI generation/synthesis services, and produce labelling materials. It fires on China App Store release, not on TestFlight. Also 第八条 requires the labelling method and style to be spelled out in the user service agreement. None of this is affected by the character.

- Source: https://www.gov.cn/zhengce/zhengceku/202503/content_7014286.htm
- Date: 2025-03-14
- Confidence: high

### Apple guideline 5.1.2(i)'s third-party-AI clause is real, dated 2025-11-13 exactly as believed — and it is the one Apple rule that genuinely binds this app, independent of the character


Current guideline 5.1.2(i) verbatim: "You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so." Dated by differential archive capture: the 2025-11-01 snapshot carries "Updated: June 9, 2025" and zero occurrences of "third-party AI"; the 2025-11-14 snapshot carries "Updated: November 13, 2025" and one occurrence. This app sends book text plus a distilled profile of the user's reading to a third-party LLM and text to a third-party TTS vendor, so it needs clear disclosure and explicit permission. Removing the mascot does nothing here; adding cross-session memory and an observations system makes the disclosure obligation HEAVIER, because more personal data goes to the third party.

- Source: https://web.archive.org/web/20251114175346/https://developer.apple.com/app-store/review/guidelines/
- Date: 2025-11-13
- Confidence: high

### NEGATIVE FINDING: there is no "AI chatbot" question in Apple's age-rating questionnaire — the premise is false, so neither the orb nor persistent memory changes any age-rating answer


Checked the live App Store Connect reference page (fetched 2026-08-27) and a 2025-10-01 archive snapshot: zero occurrences of "chatbot" in either. The questionnaire's In-App Controls are Parental Controls and Age Assurance. Its Capabilities are exactly: Unrestricted Web Access, User-Generated Content, Social Media, Social Media Disabled for Users Under 13, Messaging and Chat, Advertising. The only chat-adjacent one is scoped to human-to-human: "Messaging and Chat: Users can directly communicate with one another through features within the app. May include: text, voice and/or video chat, direct and/or group messaging, or public posting." An AI assistant is not users communicating with one another, so it does not trigger the descriptor. An abstract voice orb changes the age-rating answer by exactly zero, and so does a memory feature.

- Source: https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions
- Date: Live page fetched 2026-08-27; archive snapshot 2025-10-01
- Confidence: high

### NEGATIVE FINDING: the 2026 App Review Guidelines added nothing on AI assistants, voice, or companion apps


The current guidelines are stamped "Updated: June 8, 2026". Diffing them against the 2025-11-14 archive capture on every AI-related term yields identical counts: "third-party AI" 1/1, "companion" 1/1 — and that single "companion" hit is guideline 3.1.3(f) "Free apps acting as a stand-alone companion to a paid web based tool", which is about payments, not companionship. There is no companion-chatbot rule, no AI-assistant rule and no AI-voice rule anywhere in the guidelines. Guideline 4.7 does govern "chatbots", but only as software "not embedded in the binary" — HTML5/JavaScript mini apps and plug-ins offered inside your app — which does not describe a first-party embedded assistant.

- Source: https://developer.apple.com/app-store/review/guidelines/
- Date: 2026-06-08
- Confidence: high

## Numbers

### SB 243 statutory damages, private right of action (§22605(b)) — greater of actual damages or this figure, per violation, plus injunctive relief and attorney's fees

- Value: USD $1,000 per violation
- Source: https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260SB243
- Vendor claim: no

### SB 243 effective date (Cal. Bus. & Prof. Code ch. 22.6, Stats. 2025 Ch. 677)

- Value: 2026-01-01
- Source: https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22601
- Vendor claim: no

### SB 243 Office of Suicide Prevention annual reporting start date (§22603(a))

- Value: 2027-07-01
- Source: https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260SB243
- Vendor claim: no

### SB 243 break-reminder interval for known minors (§22602(c)(2))

- Value: at least every 3 hours
- Source: https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260SB243
- Vendor claim: no

### New York GBL §1703(1) civil penalty ceiling, AG enforcement only, no private right of action

- Value: USD $15,000 per day
- Source: https://newyork.public.law/laws/n.y._general_business_law_section_1703
- Vendor claim: no

### New York GBL §1702 non-human notification cadence — applies to ALL users, not only minors

- Value: once at start of interaction (need not exceed once/day) + at least every 3 hours continuing
- Source: https://newyork.public.law/laws/n.y._general_business_law_section_1702
- Vendor claim: no

### GUARD Act (S.3062) as reported: non-human disclosure interval required of every AI chatbot, not just companions

- Value: at conversation start + every 30 minutes
- Source: https://www.congress.gov/119/bills/s3062/BILLS-119s3062rs.xml
- Vendor claim: no

### GUARD Act (S.3062) criminal penalty per offense under proposed 18 U.S.C. §91(b)-(c)

- Value: up to USD $100,000 per offense
- Source: https://www.congress.gov/119/bills/s3062/BILLS-119s3062rs.xml
- Vendor claim: no

### GUARD Act status as of 2026-08-27: reported from Senate Judiciary with substitute amendment; -es/-eh/-enr text versions all 404, so not passed by either chamber

- Value: Reported 2026-05-11, Calendar No. 406, 20 cosponsors — NOT law
- Source: https://www.congress.gov/119/bills/s3062/BILLS-119s3062rs.xml
- Vendor claim: no

### 《人工智能生成合成内容标识办法》 and GB 45438-2025 effective date

- Value: 2025-09-01
- Source: https://www.gov.cn/zhengce/zhengceku/202503/content_7014286.htm
- Vendor claim: no

### GB 45438-2025 §5.3(c) audio rhythm label specification — the Morse code for "AI"

- Value: 短长短短 (short-long-short-short)
- Source: https://www.tc260.org.cn/upload/2025-03-15/1742009439794081593.pdf
- Vendor claim: no

### GB 45438-2025 §5.3 note 4: normal Chinese speech rate the spoken AI label must use

- Value: 120-160 字/min
- Source: https://www.tc260.org.cn/upload/2025-03-15/1742009439794081593.pdf
- Vendor claim: no

### Utah HB 452 effective date (mental health chatbots only)

- Value: 2025-05-07
- Source: https://le.utah.gov/~2025/bills/hbillenr/HB0452.pdf
- Vendor claim: no

### qwen3-tts-flash-realtime list price — the streaming model the app would actually use (Alibaba Bailian, 华北2/Beijing)

- Value: ¥1.00 per 10,000 billing characters, input only; output 不计费
- Source: https://help.aliyun.com/zh/model-studio/model-pricing
- Vendor claim: yes

### Alibaba character-counting rule: one Chinese character counts as 2 billing characters, so realtime cost per Chinese character = ¥1/10000*2

- Value: ¥0.0002 per Chinese character
- Source: https://help.aliyun.com/zh/model-studio/model-pricing
- Vendor claim: yes

### Incumbent CosyVoice2 via SiliconFlow per docs/33: ¥0.05/1000 UTF-8 bytes at ~3 bytes per Chinese character

- Value: ¥0.00015 per Chinese character
- Source: https://help.aliyun.com/zh/model-studio/model-pricing
- Vendor claim: yes

### Cost delta: Qwen3-TTS realtime vs incumbent CosyVoice2, per Chinese character — Qwen3 is MORE expensive, contradicting the premise

- Value: +33% (¥0.0002 vs ¥0.00015)
- Source: https://help.aliyun.com/zh/model-studio/model-pricing
- Vendor claim: yes

### qwen3-tts-flash NON-realtime (batch, no streaming — wrong shape for a voice assistant, listed for completeness)

- Value: ¥0.80 per 10,000 chars = ¥0.00016 per Chinese character (+7%)
- Source: https://help.aliyun.com/zh/model-studio/model-pricing
- Vendor claim: yes

### Qwen3-TTS free tier

- Value: 10,000 characters, valid 90 days from activation
- Source: https://help.aliyun.com/zh/model-studio/model-pricing
- Vendor claim: yes

### Qwen3-TTS realtime time-to-first-byte — Alibaba's docs claim only "首包延迟低" with NO figure; the SDK merely exposes get_first_package_delay() for you to measure yourself. No third-party reproducible benchmark found

- Value: UNVERIFIED — no number published
- Source: https://help.aliyun.com/zh/model-studio/realtime-tts-user-guide
- Vendor claim: yes

## Fact-check

### 1. SB 243's 'anthropomorphic features' is not a required element -- it sits in an illustrative 'including by' clause

- Verdict: **confirmed**

Evidence: leginfo.legislature.ca.gov §22601(b)(1) verbatim matches the quote exactly: '...capable of meeting a user's social needs, including by exhibiting anthropomorphic features and being able to sustain a relationship across multiple interactions.' The required conjunctive core is the four elements before 'including by'; the clause after it illustrates one route to element (4) and is itself conjunctive ('features AND sustain'). This is a defensible parse of the actual statutory language -- confirmed against primary text.

### 2. The real SB 243 exit is exclusion (A) 'productivity and analysis related to source information'

- Verdict: **confirmed**

Evidence: §22601(b)(2)(A) verbatim matches the quote exactly, confirmed directly from leginfo.legislature.ca.gov. The word 'only' does govern the whole list of excluded uses as claimed.

### 3. SB 243's 'voice-activated assistant' exclusion (b)(2)(C) is a hardware-device exclusion, not available to an app

- Verdict: **confirmed**

Evidence: §22601(b)(2)(C) verbatim matches the quote exactly ('a stand-alone consumer electronic device that functions as a speaker and voice command interface, acts as a voice-activated virtual assistant, and does not sustain a relationship...'), confirmed from leginfo.legislature.ca.gov. An iPadOS app is not a stand-alone consumer electronic device, so the reasoning holds.

### 4. SB 243's jurisdictional hook is the user's location (§22601(e) 'operator'), not the developer's

- Verdict: **confirmed**

Evidence: §22601(e) verbatim matches exactly ('a person who makes a companion chatbot platform available to a user in the state'), and §22606 verbatim also confirmed directly from leginfo.legislature.ca.gov: 'The duties, remedies, and obligations imposed by this chapter are cumulative to the duties, remedies, or obligations imposed under other law and shall not be construed to relieve an operator from any duties, remedies, or obligations imposed under any other law.' No domicile/revenue/employee threshold appears anywhere in §22601.

### 5. SB 243's full obligation set if in scope (conditional disclosure, crisis-protocol gate, minor break reminders, minors-suitability notice, 2027-07-01 reporting)

- Verdict: **confirmed**

Evidence: Pulled verbatim text of §22602(a), (b)(1), (b)(2), (c) intro+(1)(2)(3), §22603, and §22604 directly from leginfo.legislature.ca.gov billTextClient; every quoted clause in the claim matches the statute word for word, including the 'unless the operator maintains a protocol' gating structure and the 'at least every three hours' minor-only cadence.

### 6. New York's AI companion law is conjunctive across three elements (i)-(iii), and a reading app can fail element (ii)

- Verdict: **corrected**

Correction: §1700(8) full text: "'User' means any person who uses an AI companion for personal use within the state and who is not an operator or agent or affiliate of the operator." (https://newyork.public.law/laws/n.y._general_business_law_section_1700)

Evidence: §1700(4)(a) confirmed verbatim from newyork.public.law, including the 'and' joining (ii) to (iii), which does make all three required as claimed. However the claim also quotes §1700(8) as 'verbatim' with a period after 'within the state' -- the actual sentence continues: '...within the state and who is not an operator or agent or affiliate of the operator.' The claim silently truncates without an ellipsis. This does not undermine the jurisdictional-hook argument (still user-location-based), so the substantive conclusion stands, but the 'verbatim' label on §1700(8) is inaccurate as quoted.

### 7. NY's break-reminder applies to all users (not just minors) and enforcement is AG-only at up to $15,000/day

- Verdict: **confirmed**

Evidence: §1702 verbatim confirmed from newyork.public.law: applies to 'a user' generally with no minor-only limitation, cadence 'at the beginning of any AI companion interaction which need not exceed once per day and at least every three hours for continuing.' §1703 confirmed: AG-only enforcement, 'civil penalties of up to fifteen thousand dollars per day,' no private right of action found. §1701 confirmed to require the crisis-detection protocol with explicit reference to '9-8-8 suicide prevention and behavioral health crisis hotline' and 'a crisis text line.'

### N1. SB 243 statutory damages, private right of action = $1,000 per violation

- Verdict: **confirmed**

Evidence: §22605 verbatim confirmed: 'the greater of actual damages or one thousand dollars ($1,000) per violation,' plus injunctive relief and attorney's fees. (leginfo.legislature.ca.gov billTextClient)

### N2. SB 243 effective date = 2026-01-01

- Verdict: **confirmed**

Evidence: Confirmed on leginfo.legislature.ca.gov §22601 page: 'Effective Date: January 1, 2026 (Stats. 2025, Ch. 677, Sec. 1 - SB 243),' and separately confirmed chaptered 2025-10-13.

### N3. SB 243 Office of Suicide Prevention annual reporting start = 2027-07-01

- Verdict: **confirmed**

Evidence: §22603 confirmed: 'Beginning July 1, 2027' annual reporting requirement, verified from leginfo.legislature.ca.gov billTextClient.

### N4. SB 243 break-reminder interval for known minors = at least every 3 hours

- Verdict: **confirmed**

Evidence: §22602(c)(2) verbatim confirmed: '...at least every three hours for continuing companion chatbot interactions...' -- applies only 'for a user that the operator knows is a minor.'

### N5. NY GBL §1703(1) civil penalty ceiling, AG-only, no private right of action = $15,000/day

- Verdict: **confirmed**

Evidence: Confirmed verbatim from newyork.public.law/laws/n.y._general_business_law_section_1703: 'civil penalties of up to fifteen thousand dollars per day,' enforcement described as exclusively the Attorney General.

### N6. NY GBL §1702 notification cadence applies to all users = once/day at start + every 3 hours continuing

- Verdict: **confirmed**

Evidence: Verbatim confirmed, no age qualifier present in §1702's text: 'at the beginning of any AI companion interaction which need not exceed once per day and at least every three hours for continuing AI companion interactions.'

### N7. GUARD Act (S.3062) as reported: non-human disclosure interval = at conversation start + every 30 minutes

- Verdict: **refuted**

Correction: Current reported (2026-05-11, Calendar No. 406) requirement is disclosure only 'at the initiation of each conversation with a user' -- the 30-minute periodic requirement was struck by the Senate Judiciary Committee's substitute amendment and does not appear in the operative text. https://www.congress.gov/119/bills/s3062/BILLS-119s3062rs.xml

Evidence: Downloaded and grepped the actual BILLS-119s3062rs.xml (the cited URL). The document contains TWO legis-body blocks: the first is marked changed="deleted" reported-display-style="strikethrough" (the original introduced-bill text being struck by the Senate Judiciary Committee's amendment-in-the-nature-of-a-substitute), and the second is marked changed="added" reported-display-style="italic" (the actual current/operative reported text). The '30-minute intervals' clause ('at the initiation of each conversation with a user and at 30-minute intervals, clearly and conspicuously disclose...') sits ONLY inside the first (deleted/struck) block, at byte offset 22410, well within legis-body 1 (2883-28552). The operative reported text (legis-body 2) instead reads: '(A) at the initiation of each conversation with a user, clearly and conspicuously disclose to the user that the chatbot is an artificial intelligence system and not a human being.' No periodic reminder requirement survives in the reported bill -- the 30-minute cadence was deleted by the committee substitute, not enacted or currently pending.

### N8. GUARD Act (S.3062) criminal penalty per offense under proposed 18 U.S.C. §91(b)-(c) = up to $100,000 per offense

- Verdict: **refuted**

Correction: Current reported penalty is $250,000 per offense under both 91(b) and 91(c) (and $250,000 for the separate civil-penalty provision), not $100,000. $100,000 was the original introduced-bill figure, superseded by the Senate Judiciary Committee's substitute. https://www.congress.gov/119/bills/s3062/BILLS-119s3062rs.xml

Evidence: Same document, same struck/added structure as N7. All three instances of '$100,000 per offense' (offsets 15489, 16279, 26742) fall inside legis-body 1 (the deleted/struck original bill text, boundary at 28552). All three instances of '$250,000 per offense' (offsets 42432, 43275, 55121) fall inside legis-body 2 (the added/current committee-substitute text). The committee substitute increased both the §91(b) sexually-explicit-conduct penalty and the §91(c) physical-violence penalty from $100,000 to $250,000 per offense, and also raised the separate civil penalty provision (§5/6 violations) from $100,000 to $250,000.

### N9. GUARD Act status as of 2026-08-27: Reported 2026-05-11, Calendar No. 406, 20 cosponsors, not law, -es/-eh/-enr all 404

- Verdict: **corrected**

Correction: Primary-source bill text lists 19 cosponsors at introduction (not 20); could not verify any later additions due to 403 on the live cosponsors page. All other elements of N9 (Reported 2026-05-11, Calendar No. 406, not law, -es/-eh/-enr all 404) confirmed. https://www.congress.gov/119/bills/s3062/BILLS-119s3062rs.xml

Evidence: Confirmed from the rs.xml metadata: bill-stage="Reported-in-Senate", dc:date 2026-05-11, Calendar No. 406. Confirmed via curl HEAD checks that BILLS-119s3062es.xml, -eh.xml, and -enr.xml all return HTTP 404 -- consistent with not having passed either chamber. However, the bill's own action-desc (sponsor/cosponsor list at introduction, embedded in the same primary-source XML) lists Hawley as sponsor plus 19 named cosponsors (Blumenthal, Britt, Warner, Murphy, Kelly, Gallego, Lee, Lankford, Cotton, Welch, Hassan, Cortez Masto, Kaine, Gillibrand, Ricketts, Blackburn, Whitehouse, Durbin, Coons), not 20. The live congress.gov cosponsors tracker (which could show additions/withdrawals since introduction) returned HTTP 403 and could not be checked, so a 20th cosponsor added after introduction cannot be ruled out, but the only verifiable primary-source count found is 19.

### N10. 人工智能生成合成内容标识办法 and GB 45438-2025 effective date = 2025-09-01

- Verdict: **confirmed**

Evidence: gov.cn page for the 办法 confirms '自2025年9月1日起施行'. GB 45438-2025 PDF front matter (downloaded and OCR'd with pdftotext from tc260.org.cn) shows '2025-02-28 发布' and '2025-09-01 实施' -- both documents independently confirmed effective 2025-09-01.

### N11. GB 45438-2025 §5.3(c) audio rhythm label -- Morse code for 'AI' = 短长短短

- Verdict: **confirmed**

Evidence: Extracted text from the downloaded PDF (tc260.org.cn), §5.3(c) and note 1: '音频节奏标识应为“短长 短短”的节奏' and '注 1:“短长 短短”节奏为“AI”的摩斯码表示' -- matches the claim exactly (A = dot-dash = 短长, I = dot-dot = 短短).

### N12. GB 45438-2025 §5.3 note 4: normal Chinese speech rate = 120-160 字/min

- Verdict: **confirmed**

Evidence: Extracted text from the same PDF, note 4: '汉语正常语速约在 120 字/min~160 字/min' (OCR-reflowed but unambiguous) -- matches the claim's 120-160字/min exactly.

## Risks

- The strongest SB 243 defence — exclusion (A), a bot "used only for... productivity and analysis related to source information" — is destroyed by the word "only". An observations system that profiles the reader rather than analyzing the book converts a study tool into something that looks like it meets social needs. This is the single most consequential design decision in the whole analysis, and it is a memory-scope decision, not an art decision.
- GB 45438-2025 §5.3 note 3 defines a voice assistant's "start" and "end" positions as per-turn, so a literal reading of the audio-label route would require an "AI生成" tag or the short-long-short-short Morse rhythm on every single turn. The §6 persistent on-screen text label avoids this, but only if it is implemented deliberately — it must contain BOTH an AI element and a generation element ("AI生成" qualifies; a bare "AI" badge does not).
- The GUARD Act was reported out of Senate Judiciary on 2026-05-11 with 20 bipartisan cosponsors and sits on the Senate calendar. If enacted as reported, §5 would impose mandatory account creation, age verification of every user, and 30-minute non-human disclosures on ANY AI chatbot — a reading assistant included. Only the minors ban (§6) keys to "AI companion", so dropping the character buys almost nothing against it.
- Apple 5.1.2(i) is the one rule in force that this app plausibly violates today if consent is not explicit. Book text plus a distilled reader profile going to a third-party LLM and a third-party TTS vendor is exactly "personal data... shared with third parties, including with third-party AI". Rejection risk is real and rises with every memory feature added.
- The China analysis flips the moment the app goes from TestFlight to the China App Store: 标识办法第七条 converts into a documentation demand at listing review, 第八条 requires the labelling method to be written into the user service agreement, and the 生成式AI暂行办法 scope gate (向境内公众提供) opens. Plan the labelling UI before that, not during review.
- My reading that a private reading app lacks 舆论属性或社会动员能力 is a reading of the statutory text. CAC practice has tended to expect 备案 from public-facing LLM apps more broadly than the text alone implies, so do not treat this as a prediction of regulator behaviour.

## Open questions

- I could not run a comprehensive 50-state survey: every search engine reachable from this session (DuckDuckGo, Brave, Ecosia, Mojeek, Startpage, SearxNG instances) was rate-limited, captcha-walled or blocked, and the WebSearch budget was exhausted before I started. I verified California, New York and Utah from primary sources and the federal GUARD Act from congress.gov, but other states with 2026 AI-companion or AI-disclosure laws may exist and were not checked.
- The exact effective date of N.Y. GBL Article 47 is not confirmed from a .gov primary source — nysenate.gov is Cloudflare-protected and returned a JS challenge. public.law shows the article as current law, last modified 2025-11-07, verified 2026-08-22, so it is certainly in force now; the commonly cited 2025-11-05 date (180 days after the FY2026 budget signing) is unverified here.
- Whether a China App Store listing additionally requires MIIT ICP app filing, and whether a personal (non-corporate) developer can obtain one, is unresolved — the MIIT notice URLs I tried returned 404 and beian.miit.gov.cn returned HTTP 521.
- Qwen3-TTS per-sentence TTFB from a device in mainland China is still unmeasured, and Alibaba publishes no figure. This is the same gap the prior round found for CosyVoice2, so the two candidates are currently tied at "unknown" on the one axis that motivated the switch. A 30-minute measurement against wss://dashscope.aliyuncs.com/api-ws/v1/realtime using the SDK's get_first_package_delay() would settle it — and given the +33% price, the latency win would need to be large to justify the move.
- Whether Alibaba embeds any implicit label or watermark in returned Qwen3-TTS audio is undocumented — I found zero mentions of 水印 in the Bailian TTS guides. Worth asking Alibaba directly if the app ever gains an export/save-narration feature, since that is when the 隐式标识 metadata duty attaches.

/**
 * Flavrly starter training library: delivery riders.
 *
 * Seed data only. Lesson bodies use the supported markdown subset (headings,
 * paragraphs, bullets, numbered lists, bold, italic, links). App-specific
 * lessons (cash, using the app, unreachable customers) describe only what the
 * rider app actually does: button labels and screen names are taken from
 * apps/rider-native.
 */
import type { SeedModule } from '../types';

export const RIDER_MODULES: SeedModule[] = [
  // ───────────────────────────────────────────────────────────────────────────
  // 1. Road safety & helmet
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'rider-road-safety-helmet',
    legacyAliases: ['Staying safe on the road', 'Road safety basics'],
    title: 'Road safety and your helmet',
    summary:
      'Helmet, visibility, speed, phone use, lane discipline, fatigue and daily vehicle checks. The basics that get you home safe after every shift.',
    category: 'SAFETY',
    audience: 'RIDER',
    isRequired: true,
    blocksShift: true,
    durationMin: 15,
    order: 10,
    passMarkPct: 80,
    maxAttempts: null,
    retakeCooldownMin: 5,
    dueDays: 7,
    translations: {
      hi: {
        title: 'सड़क सुरक्षा और आपका हेलमेट',
        summary:
          'हेलमेट, दिखाई देना, स्पीड, फ़ोन का इस्तेमाल, लेन अनुशासन, थकान और रोज़ की गाड़ी जांच। हर शिफ़्ट के बाद सुरक्षित घर पहुंचने की बुनियादी बातें।',
      },
    },
    lessons: [
      {
        kind: 'TEXT',
        title: 'Your helmet, every ride',
        body: `## No helmet, no ride

Your head is the one thing a new phone or a new bike cannot replace. Wear your helmet on every ride, even a two-minute trip to the restaurant next door. Traffic law requires a helmet on a two-wheeler, and Flavrly expects it on every order.

### What a good helmet looks like

- It carries the **ISI mark**. This shows it meets the Indian safety standard.
- It fits snugly. It should not wobble when you shake your head.
- The **chin strap is fastened** every time. An open strap means the helmet can fly off in a fall.
- The visor is clean and not badly scratched, so you can see clearly, day and night.
- A full-face helmet protects your jaw and face as well as your head.

### Replace it when

- It has taken a hard hit or a fall, even if it looks fine from outside.
- The inner padding is broken or the strap buckle does not lock.
- The shell has cracks.

*A helmet hanging from your mirror protects nobody.* Strap it on before you start the engine.`,
        translations: {
          hi: {
            title: 'हर राइड पर हेलमेट',
            body: `## हेलमेट नहीं, तो राइड नहीं

नया फ़ोन या नई बाइक मिल सकती है, लेकिन आपका सिर नहीं। हर राइड पर हेलमेट पहनें, चाहे बगल वाले रेस्टोरेंट तक दो मिनट का ही रास्ता हो। ट्रैफ़िक कानून के अनुसार दोपहिया पर हेलमेट ज़रूरी है, और Flavrly हर ऑर्डर पर यही उम्मीद करता है।

### अच्छा हेलमेट कैसा होता है

- उस पर **ISI मार्क** होना चाहिए। इसका मतलब है कि वह भारतीय सुरक्षा मानक पर खरा है।
- वह सिर पर कसकर बैठे। सिर हिलाने पर हिलना नहीं चाहिए।
- **चिन स्ट्रैप हर बार बंद हो।** खुला स्ट्रैप हो तो गिरने पर हेलमेट उछलकर निकल सकता है।
- वाइज़र साफ़ हो और उस पर ज़्यादा खरोंच न हों, ताकि दिन और रात में साफ़ दिखे।
- फ़ुल-फ़ेस हेलमेट सिर के साथ-साथ जबड़े और चेहरे को भी बचाता है।

### हेलमेट कब बदलें

- अगर उसे ज़ोर की चोट लगी हो या वह गिरा हो, भले ही बाहर से ठीक दिखे।
- अंदर की गद्दी टूट गई हो या स्ट्रैप का बकल लॉक न हो।
- शेल में दरार हो।

*शीशे पर लटका हेलमेट किसी को नहीं बचाता।* इंजन चालू करने से पहले हेलमेट पहनकर स्ट्रैप बंद करें।`,
          },
        },
      },
      {
        kind: 'CHECKLIST',
        title: 'Before you go online: vehicle and gear check',
        body: 'Take two minutes before every shift. Small problems found in the parking lot do not become big problems on the road.',
        checklistItems: [
          'Tyres have enough air and no cuts or bulges',
          'Front and rear brakes work and do not feel spongy',
          'Headlight, tail light, brake light and both indicators work',
          'Horn works',
          'Both mirrors are fitted and adjusted so you can see behind you',
          'Chain is not loose or dry (for bikes with a chain)',
          'Enough fuel or battery charge for your shift',
          'Driving licence, registration, insurance and pollution papers are valid and with you',
          'ISI-marked helmet with a working chin strap',
          'Phone charged and mounted securely on the handlebar',
        ],
        translations: {
          hi: {
            title: 'ऑनलाइन होने से पहले: गाड़ी और सामान की जांच',
            body: 'हर शिफ़्ट से पहले दो मिनट निकालें। पार्किंग में पकड़ी गई छोटी दिक्कत सड़क पर बड़ी मुसीबत नहीं बनती।',
            checklistItems: [
              'टायरों में पूरी हवा है और कोई कट या उभार नहीं है',
              'आगे और पीछे के ब्रेक ठीक काम कर रहे हैं, ढीले नहीं लगते',
              'हेडलाइट, टेल लाइट, ब्रेक लाइट और दोनों इंडिकेटर चल रहे हैं',
              'हॉर्न काम कर रहा है',
              'दोनों शीशे लगे हैं और ऐसे सेट हैं कि पीछे दिखे',
              'चेन ढीली या सूखी नहीं है (चेन वाली बाइक के लिए)',
              'शिफ़्ट के लिए पूरा पेट्रोल या बैटरी चार्ज है',
              'ड्राइविंग लाइसेंस, RC, इंश्योरेंस और प्रदूषण के कागज़ वैध हैं और साथ में हैं',
              'ISI मार्क वाला हेलमेट जिसका चिन स्ट्रैप ठीक है',
              'फ़ोन चार्ज है और हैंडल पर मज़बूती से लगा है',
            ],
          },
        },
      },
      {
        kind: 'TEXT',
        title: 'Speed, lanes and being seen',
        body: `## A late order is better than an accident

No delivery is worth a crash. Customers would rather wait five more minutes than have you hurt. Ride at a speed that lets you stop in time if someone steps out or a vehicle brakes in front of you.

### Speed

- Follow the speed limit and slow down further near schools, markets, hospitals and crowded lanes.
- Keep a safe gap from the vehicle in front. You need room to brake.
- Slow down before speed breakers, potholes and turns, not on them.

### Lane discipline

- Ride on the correct side of the road. **Never ride the wrong way**, even for a short distance to save a U-turn.
- Do not weave between vehicles or squeeze between buses and trucks.
- Do not ride on footpaths. They are for people walking.
- Stop at red lights and stop lines. Traffic law applies to delivery riders like everyone else.
- Use your indicator before every turn or lane change, and check your mirror.

### Being seen

- Keep your headlight on and clean.
- Wear bright or reflective clothing, especially in the evening and at night.
- Stay out of the blind spots of buses and trucks. If you cannot see the driver's mirror, the driver cannot see you.`,
        translations: {
          hi: {
            title: 'स्पीड, लेन और दिखाई देना',
            body: `## देर से पहुंचा ऑर्डर, एक्सीडेंट से बेहतर है

कोई भी डिलीवरी एक्सीडेंट के लायक नहीं है। ग्राहक पांच मिनट और इंतज़ार कर लेगा, लेकिन आपका चोटिल होना नहीं चाहेगा। इतनी स्पीड रखें कि कोई अचानक सामने आए या आगे की गाड़ी ब्रेक लगाए तो आप समय पर रुक सकें।

### स्पीड

- स्पीड लिमिट का पालन करें। स्कूल, बाज़ार, अस्पताल और भीड़ वाली गलियों में और धीमे चलें।
- आगे वाली गाड़ी से सुरक्षित दूरी रखें। ब्रेक लगाने के लिए जगह चाहिए।
- स्पीड ब्रेकर, गड्ढे और मोड़ से पहले धीमे हों, उन पर पहुंचकर नहीं।

### लेन अनुशासन

- सड़क की सही साइड पर चलें। **कभी भी उल्टी दिशा में न चलें**, चाहे U-टर्न बचाने के लिए थोड़ी दूर ही क्यों न हो।
- गाड़ियों के बीच से टेढ़ा-मेढ़ा न निकलें और बस या ट्रक के बीच न घुसें।
- फ़ुटपाथ पर गाड़ी न चलाएं। वह पैदल चलने वालों के लिए है।
- लाल बत्ती और स्टॉप लाइन पर रुकें। ट्रैफ़िक कानून डिलीवरी राइडर पर भी बाकी सबकी तरह लागू होता है।
- हर मोड़ या लेन बदलने से पहले इंडिकेटर दें और शीशे में देखें।

### दिखाई देना

- हेडलाइट चालू और साफ़ रखें।
- चमकीले या रिफ़्लेक्टिव कपड़े पहनें, ख़ासकर शाम और रात में।
- बस और ट्रक के ब्लाइंड स्पॉट से दूर रहें। अगर आपको ड्राइवर का शीशा नहीं दिख रहा, तो ड्राइवर भी आपको नहीं देख पा रहा।`,
          },
        },
      },
      {
        kind: 'TEXT',
        title: 'Your phone: only when stopped or mounted',
        body: `## Eyes on the road

The Flavrly app sends you orders, maps and alerts, but none of it is worth taking your eyes off the road while moving.

### The rules

1. **Mount your phone** on the handlebar with a proper holder before you start. Never hold it in your hand while riding.
2. **Set up navigation before you move.** Open the route, check it, then start riding.
3. **Do not type, tap buttons or read messages while moving.** If a new order or message pops up, it can wait until you stop.
4. **Pull over safely** to the side of the road before you call a customer, reply to support or update an order step.
5. Do not hold the phone between your ear and helmet to talk while riding.

### Why it matters

A glance at your phone for two seconds means you travel several metres without looking. That is enough to miss a pothole, a pedestrian or a car stopping suddenly.

*Tip:* keep your phone charged with a power bank, so you are never tempted to fiddle with a low-battery phone on the move.`,
        translations: {
          hi: {
            title: 'फ़ोन: सिर्फ़ रुककर या होल्डर में',
            body: `## नज़र सड़क पर

Flavrly ऐप आपको ऑर्डर, मैप और अलर्ट भेजता है, लेकिन चलती गाड़ी पर इनमें से किसी के लिए सड़क से नज़र हटाना ठीक नहीं।

### नियम

1. **फ़ोन को हैंडल पर अच्छे होल्डर में लगाएं** और फिर चलें। चलाते समय फ़ोन कभी हाथ में न पकड़ें।
2. **चलने से पहले नेविगेशन सेट करें।** रास्ता खोलें, देखें, फिर निकलें।
3. **चलते हुए टाइप न करें, बटन न दबाएं और मैसेज न पढ़ें।** नया ऑर्डर या मैसेज आए तो रुकने तक इंतज़ार कर सकता है।
4. ग्राहक को कॉल करने, सपोर्ट को जवाब देने या ऑर्डर का स्टेप अपडेट करने से पहले **सुरक्षित जगह पर साइड में रुकें**।
5. चलाते समय फ़ोन को कान और हेलमेट के बीच फंसाकर बात न करें।

### यह क्यों ज़रूरी है

दो सेकंड फ़ोन देखने का मतलब है कई मीटर बिना देखे चलना। इतने में गड्ढा, पैदल आदमी या अचानक रुकती कार छूट सकती है।

*सुझाव:* पावर बैंक से फ़ोन चार्ज रखें, ताकि कम बैटरी वाले फ़ोन से चलते-चलते छेड़छाड़ करने की ज़रूरत न पड़े।`,
          },
        },
      },
      {
        kind: 'TEXT',
        title: 'Fatigue: know when to stop',
        body: `## A tired rider is a slow-reacting rider

Long hours, heat and traffic wear you down. When you are tired, you react late, misjudge gaps and miss things you would normally see.

### Warning signs

- Your eyes feel heavy or you keep blinking and yawning.
- You cannot remember the last few minutes of the road.
- You drift in your lane or miss a turn.
- You feel irritated or rushed for no clear reason.

### What to do

- **Take a real break.** Stop, get off the bike, drink water and eat something.
- Use **Take a break** on the Flavrly app Home screen to pause for 15, 30 or 60 minutes without going offline. Tap **End break now** when you are ready.
- If you are too tired to ride safely, go offline for the day. Your safety comes first.
- Get enough sleep before an early or long shift.
- Do not ride after drinking alcohol or taking anything that makes you drowsy. Traffic law forbids riding under the influence, and it puts you and others in danger.`,
        translations: {
          hi: {
            title: 'थकान: कब रुकना है, यह पहचानें',
            body: `## थका हुआ राइडर देर से रिएक्ट करता है

लंबे घंटे, गर्मी और ट्रैफ़िक आपको थका देते हैं। थकान में आप देर से रिएक्ट करते हैं, दूरी का अंदाज़ा गलत लगाते हैं और वो चीज़ें छूट जाती हैं जो आम तौर पर दिख जातीं।

### चेतावनी के संकेत

- आंखें भारी लगें या बार-बार पलकें झपकें और उबासी आए।
- पिछले कुछ मिनट का रास्ता याद न आए।
- गाड़ी लेन में इधर-उधर हो या मोड़ छूट जाए।
- बिना वजह चिड़चिड़ापन या जल्दबाज़ी महसूस हो।

### क्या करें

- **सच में ब्रेक लें।** रुकें, गाड़ी से उतरें, पानी पिएं और कुछ खाएं।
- Flavrly ऐप की Home स्क्रीन पर **Take a break** से 15, 30 या 60 मिनट का ब्रेक लें, ऑफ़लाइन हुए बिना। तैयार होने पर **End break now** दबाएं।
- अगर इतने थके हैं कि सुरक्षित नहीं चला सकते, तो उस दिन ऑफ़लाइन हो जाएं। आपकी सुरक्षा सबसे पहले है।
- सुबह जल्दी या लंबी शिफ़्ट से पहले पूरी नींद लें।
- शराब पीकर या नींद लाने वाली कोई चीज़ लेकर गाड़ी न चलाएं। ट्रैफ़िक कानून नशे में गाड़ी चलाने से मना करता है, और इससे आप और दूसरे ख़तरे में पड़ते हैं।`,
          },
        },
      },
    ],
    questions: [
      {
        prompt: 'Which helmet should you wear on a Flavrly delivery?',
        options: [
          'Any cap or light helmet, as long as it is on your head',
          'An ISI-marked helmet with the chin strap fastened',
          'An ISI-marked helmet, strap open so it is quick to remove',
          'No helmet is needed for short trips inside the colony',
        ],
        correctIndex: 1,
        explanation:
          'Only an ISI-marked helmet with the chin strap fastened protects you properly. An open strap lets the helmet come off in a fall.',
        translations: {
          hi: {
            prompt: 'Flavrly डिलीवरी पर कौन-सा हेलमेट पहनना चाहिए?',
            options: [
              'कोई भी टोपी या हल्का हेलमेट, बस सिर पर हो',
              'ISI मार्क वाला हेलमेट, चिन स्ट्रैप बंद करके',
              'ISI मार्क वाला हेलमेट, स्ट्रैप खुला ताकि जल्दी उतर जाए',
              'कॉलोनी के अंदर छोटे रास्ते पर हेलमेट की ज़रूरत नहीं',
            ],
            explanation:
              'सिर्फ़ ISI मार्क वाला हेलमेट, जिसका चिन स्ट्रैप बंद हो, ठीक से बचाता है। खुला स्ट्रैप हो तो गिरने पर हेलमेट निकल सकता है।',
          },
        },
      },
      {
        prompt: 'A new order alert pops up while you are riding. What should you do?',
        options: [
          'Read it quickly at the next speed breaker',
          'Tap to view it with one hand while riding slowly',
          'Ask a pillion or passer-by to read it for you',
          'Keep riding and check it only after you have pulled over safely',
        ],
        correctIndex: 3,
        explanation:
          'Never read or tap your phone while moving. Pull over safely first; the alert can wait a few seconds.',
        translations: {
          hi: {
            prompt: 'राइड करते समय नए ऑर्डर का अलर्ट आता है। आपको क्या करना चाहिए?',
            options: [
              'अगले स्पीड ब्रेकर पर जल्दी से पढ़ लें',
              'धीरे चलाते हुए एक हाथ से टैप करके देख लें',
              'किसी और से पढ़वा लें',
              'चलते रहें और सुरक्षित जगह रुकने के बाद ही देखें',
            ],
            explanation:
              'चलते हुए फ़ोन न पढ़ें, न टैप करें। पहले सुरक्षित जगह रुकें; अलर्ट कुछ सेकंड इंतज़ार कर सकता है।',
          },
        },
      },
      {
        prompt: 'The restaurant is just across the road, but the U-turn is 300 metres away. What is the right choice?',
        options: [
          'Take the U-turn and ride on the correct side',
          'Ride the wrong way slowly for the short distance',
          'Ride on the footpath to cross over',
          'Cut across the divider gap with your horn on',
        ],
        correctIndex: 0,
        explanation:
          'Riding the wrong way, even briefly, is against traffic law and a common cause of head-on crashes. Take the proper U-turn.',
        translations: {
          hi: {
            prompt: 'रेस्टोरेंट सड़क के ठीक उस पार है, लेकिन U-टर्न 300 मीटर दूर है। सही रास्ता क्या है?',
            options: [
              'U-टर्न लें और सही साइड पर चलें',
              'थोड़ी दूरी के लिए धीरे-धीरे उल्टी दिशा में चलें',
              'फ़ुटपाथ पर चलकर पार करें',
              'हॉर्न बजाते हुए डिवाइडर के गैप से काट लें',
            ],
            explanation:
              'उल्टी दिशा में चलना, थोड़ी देर के लिए भी, ट्रैफ़िक कानून के ख़िलाफ़ है और आमने-सामने की टक्कर की बड़ी वजह है। सही U-टर्न लें।',
          },
        },
      },
      {
        prompt: 'You keep yawning and missed a turn twice. What is the safest action?',
        options: [
          'Ride faster to finish the shift sooner',
          'Turn up music in your earphones to stay alert',
          'Stop, take a break with water and food, or go offline if you are still too tired',
          'Accept one more order and then rest',
        ],
        correctIndex: 2,
        explanation:
          'These are fatigue warning signs. Stop and rest; use Take a break in the app, or go offline if you cannot ride safely.',
        translations: {
          hi: {
            prompt: 'आपको बार-बार उबासी आ रही है और दो बार मोड़ छूट गया। सबसे सुरक्षित कदम क्या है?',
            options: [
              'शिफ़्ट जल्दी ख़त्म करने के लिए तेज़ चलाएं',
              'जागते रहने के लिए ईयरफ़ोन में गाना तेज़ करें',
              'रुकें, पानी और खाने के साथ ब्रेक लें, या फिर भी थके हों तो ऑफ़लाइन हो जाएं',
              'एक और ऑर्डर ले लें, फिर आराम करें',
            ],
            explanation:
              'ये थकान के संकेत हैं। रुककर आराम करें; ऐप में Take a break का इस्तेमाल करें, या सुरक्षित नहीं चला सकते तो ऑफ़लाइन हो जाएं।',
          },
        },
      },
      {
        prompt: 'During your pre-shift check, your brake light does not come on. What should you do?',
        options: [
          'Ignore it; brake lights only matter at night',
          'Get it fixed before riding, because drivers behind you need to know when you stop',
          'Ride anyway and use hand signals all day',
          'Go online and fix it after the dinner rush',
        ],
        correctIndex: 1,
        explanation:
          'A working brake light warns the vehicle behind you that you are slowing down. Fix lighting faults before you go online.',
        translations: {
          hi: {
            prompt: 'शिफ़्ट से पहले जांच में आपकी ब्रेक लाइट नहीं जल रही। क्या करना चाहिए?',
            options: [
              'नज़रअंदाज़ करें; ब्रेक लाइट सिर्फ़ रात में ज़रूरी है',
              'चलाने से पहले ठीक करवाएं, क्योंकि पीछे वाले को पता चलना चाहिए कि आप रुक रहे हैं',
              'फिर भी चलाएं और दिनभर हाथ से इशारा करें',
              'ऑनलाइन हो जाएं और डिनर की भीड़ के बाद ठीक करवाएं',
            ],
            explanation:
              'चालू ब्रेक लाइट पीछे वाली गाड़ी को बताती है कि आप धीमे हो रहे हैं। ऑनलाइन होने से पहले लाइट की ख़राबी ठीक करवाएं।',
          },
        },
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Food hygiene in transit
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'rider-food-hygiene-transit',
    title: 'Food hygiene in transit',
    summary:
      'Keep every order safe from the restaurant counter to the customer: a clean insulated bag, sealed packages, hot and cold kept apart, clean hands, and what to do about illness or spills.',
    category: 'SAFETY',
    audience: 'RIDER',
    isRequired: true,
    durationMin: 12,
    order: 20,
    passMarkPct: 80,
    maxAttempts: null,
    retakeCooldownMin: 5,
    dueDays: 7,
    translations: {
      hi: {
        title: 'रास्ते में खाने की साफ़-सफ़ाई',
        summary:
          'रेस्टोरेंट काउंटर से ग्राहक तक हर ऑर्डर सुरक्षित रखें: साफ़ इंसुलेटेड बैग, सील बंद पैकेट, गर्म और ठंडा अलग, साफ़ हाथ, और बीमारी या खाना गिरने पर क्या करें।',
      },
    },
    lessons: [
      {
        kind: 'TEXT',
        title: 'You are part of the food safety chain',
        body: `## Food safety does not stop at the kitchen

The restaurant cooks the food safely. Your job is to keep it that way until it reaches the customer. FSSAI food safety guidance covers the whole journey of food, including how it is carried. On Flavrly, that part of the journey is you.

### The three things that matter most

- **Clean:** a clean bag, clean hands, nothing dirty touching the food.
- **Sealed:** the package leaves the restaurant sealed and reaches the customer sealed.
- **On time and at the right temperature:** hot food stays hot, cold food stays cold, and nothing sits around longer than needed.

When customers open a Flavrly order, they are trusting that nobody has touched their food on the way. Every rider keeps that trust, or breaks it for everyone.`,
        translations: {
          hi: {
            title: 'आप खाद्य सुरक्षा की कड़ी का हिस्सा हैं',
            body: `## खाद्य सुरक्षा किचन पर ख़त्म नहीं होती

रेस्टोरेंट खाना सुरक्षित तरीके से बनाता है। आपका काम है कि ग्राहक तक पहुंचने तक वह वैसा ही रहे। FSSAI की खाद्य सुरक्षा गाइडलाइन खाने के पूरे सफ़र पर लागू होती है, उसे ले जाने के तरीके पर भी। Flavrly पर सफ़र का वह हिस्सा आप हैं।

### तीन सबसे ज़रूरी बातें

- **साफ़:** साफ़ बैग, साफ़ हाथ, कोई गंदी चीज़ खाने को न छुए।
- **सील बंद:** पैकेट रेस्टोरेंट से सील होकर निकले और ग्राहक तक सील ही पहुंचे।
- **समय पर और सही तापमान पर:** गर्म खाना गर्म रहे, ठंडा खाना ठंडा, और कुछ भी ज़रूरत से ज़्यादा देर पड़ा न रहे।

जब ग्राहक Flavrly का ऑर्डर खोलता है, तो उसे भरोसा होता है कि रास्ते में किसी ने उसका खाना नहीं छुआ। हर राइडर या तो यह भरोसा बनाए रखता है, या सबके लिए तोड़ देता है।`,
          },
        },
      },
      {
        kind: 'CHECKLIST',
        title: 'Your delivery bag: daily care',
        body: 'Your insulated bag is a food container. Treat it like one. Run through this list at the start of every shift.',
        checklistItems: [
          'Wipe the inside and outside of the bag with a clean cloth and food-safe cleaner',
          'Check there are no crumbs, spills or bad smells left from yesterday',
          'Let the bag dry fully before you put food in it',
          'Keep personal things out of the food bag: no helmet, shoes, raincoat, tools or fuel',
          'Check the zip or flap closes fully so heat and dust stay out',
          'Carry a separate liner or divider to keep hot and cold items apart',
          'Keep the bag closed between pickup and handover',
        ],
        translations: {
          hi: {
            title: 'डिलीवरी बैग की रोज़ की देखभाल',
            body: 'आपका इंसुलेटेड बैग खाने का डिब्बा है। उसके साथ वैसा ही बर्ताव करें। हर शिफ़्ट की शुरुआत में यह लिस्ट देखें।',
            checklistItems: [
              'बैग को अंदर और बाहर साफ़ कपड़े और खाने के लिए सुरक्षित क्लीनर से पोंछें',
              'देखें कि कल का कोई टुकड़ा, गिरा खाना या बदबू न बची हो',
              'खाना रखने से पहले बैग पूरी तरह सूखने दें',
              'खाने के बैग में निजी सामान न रखें: हेलमेट, जूते, रेनकोट, औज़ार या पेट्रोल नहीं',
              'देखें कि ज़िप या ढक्कन पूरा बंद होता है ताकि गर्मी और धूल बाहर रहे',
              'गर्म और ठंडी चीज़ें अलग रखने के लिए अलग लाइनर या डिवाइडर रखें',
              'पिकअप से हैंडओवर तक बैग बंद रखें',
            ],
          },
        },
      },
      {
        kind: 'TEXT',
        title: 'Sealed packages and hot and cold',
        body: `## Never open a sealed package

Restaurants seal orders so the customer knows nobody has touched the food. **Never open, peel back or re-tape a seal**, for any reason. Do not taste, smell or check inside.

- If a seal is broken or missing at pickup, tell the restaurant staff before you leave and ask them to reseal or repack it.
- If a package gets damaged on the way, do not try to fix it yourself. See the next lesson for what to do.

### Keep hot and cold apart

- Put hot items on one side of the bag and cold items (drinks, desserts, ice cream) on the other, with a divider in between.
- Keep containers upright. Curries, soups and drinks spill if they lie flat.
- Put heavy items at the bottom and light or fragile items on top.
- Do not stack the bag so tightly that boxes get crushed.

### Do not keep food waiting

- Go straight from pickup to the customer. Do not run personal errands with food in the bag.
- Do not leave the bag open in the sun or rain while you wait.`,
        translations: {
          hi: {
            title: 'सील बंद पैकेट, गर्म और ठंडा',
            body: `## सील बंद पैकेट कभी न खोलें

रेस्टोरेंट ऑर्डर सील करते हैं ताकि ग्राहक को पता रहे कि किसी ने खाना नहीं छुआ। **किसी भी वजह से सील न खोलें, न उखाड़ें, न दोबारा टेप लगाएं।** न चखें, न सूंघें, न अंदर झांकें।

- अगर पिकअप के समय सील टूटी है या नहीं है, तो निकलने से पहले रेस्टोरेंट स्टाफ़ को बताएं और दोबारा सील या पैक करने को कहें।
- अगर रास्ते में पैकेट ख़राब हो जाए, तो ख़ुद ठीक करने की कोशिश न करें। क्या करना है, अगले पाठ में देखें।

### गर्म और ठंडा अलग रखें

- गर्म चीज़ें बैग की एक तरफ़ और ठंडी चीज़ें (ड्रिंक, मिठाई, आइसक्रीम) दूसरी तरफ़ रखें, बीच में डिवाइडर लगाएं।
- डिब्बे सीधे रखें। करी, सूप और ड्रिंक लेटाने पर गिर जाते हैं।
- भारी चीज़ें नीचे और हल्की या नाज़ुक चीज़ें ऊपर रखें।
- बैग इतना ठूंसकर न भरें कि डिब्बे दब जाएं।

### खाने को इंतज़ार न कराएं

- पिकअप से सीधे ग्राहक के पास जाएं। बैग में खाना रखकर निजी काम न निपटाएं।
- इंतज़ार करते समय बैग धूप या बारिश में खुला न छोड़ें।`,
          },
        },
      },
      {
        kind: 'TEXT',
        title: 'Clean hands, illness and spills',
        body: `## Clean hands

- Wash your hands with soap, or use hand sanitiser, before your shift, after using the toilet, after eating and after handling cash.
- Keep your nails short and clean.
- Cover any cut or wound on your hands with a clean bandage.
- Do not touch your face, nose or mouth while handling orders.

## Feeling unwell? Do not ride

If you have fever, vomiting, loose motions, a bad cough or any infection that could pass to others, **do not take orders**. Go offline and rest.

- Let Flavrly know by raising a ticket in **Help & Support** in the app. Pick the category that fits best and describe what is happening.
- Come back online only when you feel well again.

## If food spills or a package is damaged

1. Do not open, repack or wipe the inside of the package yourself.
2. If you are still at the restaurant, show the staff and ask them to fix or remake it.
3. If it happens on the road, pull over safely and message **Platform Support** from the **Messages** screen, or raise an **Order issue** ticket in Help & Support. Follow their instructions.
4. Be honest with the customer. Never hand over a damaged or leaking order as if nothing happened.
5. Clean and dry your bag before the next order.`,
        translations: {
          hi: {
            title: 'साफ़ हाथ, बीमारी और गिरा खाना',
            body: `## साफ़ हाथ

- शिफ़्ट से पहले, टॉयलेट के बाद, खाने के बाद और कैश संभालने के बाद हाथ साबुन से धोएं या सैनिटाइज़र लगाएं।
- नाख़ून छोटे और साफ़ रखें।
- हाथ पर कोई कट या घाव हो तो साफ़ पट्टी से ढकें।
- ऑर्डर संभालते समय चेहरा, नाक या मुंह न छुएं।

## तबीयत ठीक नहीं? गाड़ी न चलाएं

अगर बुख़ार, उल्टी, दस्त, तेज़ खांसी या कोई ऐसा संक्रमण है जो दूसरों को लग सकता है, तो **ऑर्डर न लें**। ऑफ़लाइन होकर आराम करें।

- ऐप में **Help & Support** में टिकट बनाकर Flavrly को बताएं। सबसे सही कैटेगरी चुनें और बताएं क्या हो रहा है।
- तबीयत ठीक होने पर ही दोबारा ऑनलाइन आएं।

## अगर खाना गिर जाए या पैकेट ख़राब हो

1. पैकेट को ख़ुद न खोलें, न दोबारा पैक करें, न अंदर से पोंछें।
2. अगर अभी रेस्टोरेंट पर हैं, तो स्टाफ़ को दिखाएं और ठीक करने या दोबारा बनाने को कहें।
3. अगर रास्ते में हुआ, तो सुरक्षित जगह रुकें और **Messages** स्क्रीन से **Platform Support** को मैसेज करें, या Help & Support में **Order issue** टिकट बनाएं। उनके निर्देश मानें।
4. ग्राहक से सच बोलें। ख़राब या रिसता हुआ ऑर्डर ऐसे न दें जैसे कुछ हुआ ही नहीं।
5. अगले ऑर्डर से पहले बैग साफ़ करके सुखा लें।`,
          },
        },
      },
    ],
    questions: [
      {
        prompt: 'At pickup, you notice the seal on a biryani box is torn. What should you do?',
        options: [
          'Press the seal back down and deliver it',
          'Tell the restaurant staff before leaving and ask them to reseal or repack it',
          'Open it to check the food is fine, then tape it shut',
          'Deliver it and let the customer decide',
        ],
        correctIndex: 1,
        explanation:
          'Never fix or open a seal yourself. Ask the restaurant to reseal or repack before you leave.',
        translations: {
          hi: {
            prompt: 'पिकअप पर आप देखते हैं कि बिरयानी के डिब्बे की सील फटी है। क्या करें?',
            options: [
              'सील को दबाकर वापस चिपका दें और डिलीवर कर दें',
              'निकलने से पहले रेस्टोरेंट स्टाफ़ को बताएं और दोबारा सील या पैक करने को कहें',
              'खोलकर देख लें कि खाना ठीक है, फिर टेप लगा दें',
              'डिलीवर कर दें और ग्राहक को तय करने दें',
            ],
            explanation:
              'सील को ख़ुद कभी ठीक न करें, न खोलें। निकलने से पहले रेस्टोरेंट से दोबारा सील या पैक करवाएं।',
          },
        },
      },
      {
        prompt: 'An order has hot dal and a cold kulfi. How should you pack them in your bag?',
        options: [
          'Kulfi on top of the dal so it stays steady',
          'Both together in one corner to save space',
          'Kulfi in your jacket pocket',
          'On opposite sides of the bag with a divider, both upright',
        ],
        correctIndex: 3,
        explanation:
          'Keep hot and cold items apart with a divider, and keep containers upright so nothing spills.',
        translations: {
          hi: {
            prompt: 'एक ऑर्डर में गर्म दाल और ठंडी कुल्फ़ी है। बैग में कैसे रखें?',
            options: [
              'कुल्फ़ी को दाल के ऊपर रखें ताकि टिकी रहे',
              'जगह बचाने के लिए दोनों एक कोने में साथ रखें',
              'कुल्फ़ी जैकेट की जेब में रखें',
              'बैग की उल्टी तरफ़ों में, बीच में डिवाइडर के साथ, दोनों सीधे',
            ],
            explanation:
              'गर्म और ठंडी चीज़ें डिवाइडर से अलग रखें, और डिब्बे सीधे रखें ताकि कुछ न गिरे।',
          },
        },
      },
      {
        prompt: 'You woke up with fever and loose motions. What is the right step?',
        options: [
          'Stay offline, rest, and let Flavrly know through Help & Support',
          'Ride anyway but wear a mask',
          'Take only short-distance orders today',
          'Ride and wash your hands more often',
        ],
        correctIndex: 0,
        explanation:
          'Illness can pass to customers through food. Do not take orders until you are well, and tell Flavrly through Help & Support.',
        translations: {
          hi: {
            prompt: 'सुबह उठे तो बुख़ार और दस्त है। सही कदम क्या है?',
            options: [
              'ऑफ़लाइन रहें, आराम करें, और Help & Support से Flavrly को बताएं',
              'फिर भी चलाएं लेकिन मास्क पहन लें',
              'आज सिर्फ़ पास के ऑर्डर लें',
              'चलाएं और ज़्यादा बार हाथ धोएं',
            ],
            explanation:
              'बीमारी खाने के ज़रिए ग्राहकों तक पहुंच सकती है। ठीक होने तक ऑर्डर न लें, और Help & Support से Flavrly को बताएं।',
          },
        },
      },
      {
        prompt: 'Which item can you keep inside your insulated food bag?',
        options: [
          'Your wet raincoat',
          'A spare can of fuel',
          'A clean divider to separate hot and cold orders',
          'Your shoes, in a plastic cover',
        ],
        correctIndex: 2,
        explanation:
          'The food bag is for food only. A clean divider helps keep orders safe; personal items, wet gear and fuel never go inside.',
        translations: {
          hi: {
            prompt: 'इंसुलेटेड खाने के बैग के अंदर क्या रख सकते हैं?',
            options: [
              'आपका गीला रेनकोट',
              'पेट्रोल का अतिरिक्त डिब्बा',
              'गर्म और ठंडे ऑर्डर अलग करने वाला साफ़ डिवाइडर',
              'प्लास्टिक कवर में आपके जूते',
            ],
            explanation:
              'खाने का बैग सिर्फ़ खाने के लिए है। साफ़ डिवाइडर ऑर्डर को सुरक्षित रखता है; निजी सामान, गीला सामान और पेट्रोल कभी अंदर न रखें।',
          },
        },
      },
      {
        prompt: 'A drink leaks inside the bag while you are on the road. What should you do?',
        options: [
          'Wipe the cup and deliver without saying anything',
          'Pull over safely and contact Platform Support or raise an Order issue ticket, then follow their instructions',
          'Throw the order away and go offline',
          'Buy a similar drink from a shop and swap it',
        ],
        correctIndex: 1,
        explanation:
          'Do not hide or fix damage yourself. Contact Flavrly support from the app, follow their instructions and be honest with the customer.',
        translations: {
          hi: {
            prompt: 'रास्ते में बैग के अंदर ड्रिंक गिर जाती है। क्या करें?',
            options: [
              'कप पोंछकर बिना कुछ बताए डिलीवर कर दें',
              'सुरक्षित जगह रुकें, Platform Support से संपर्क करें या Order issue टिकट बनाएं, फिर उनके निर्देश मानें',
              'ऑर्डर फेंक दें और ऑफ़लाइन हो जाएं',
              'दुकान से वैसी ही ड्रिंक ख़रीदकर बदल दें',
            ],
            explanation:
              'नुकसान को छिपाएं नहीं, न ख़ुद ठीक करें। ऐप से Flavrly सपोर्ट से संपर्क करें, उनके निर्देश मानें और ग्राहक से सच बोलें।',
          },
        },
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Customer handover etiquette
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'rider-handover-etiquette',
    legacyAliases: ['Five-star customer service', '5-star customer service', 'Customer service basics'],
    title: 'Customer handover etiquette',
    summary:
      'How to hand over an order politely and safely: finding the door, greeting the customer, contactless handover, the delivery code, privacy and staying calm when things go wrong.',
    category: 'CUSTOMER_SERVICE',
    audience: 'RIDER',
    isRequired: true,
    durationMin: 10,
    order: 30,
    passMarkPct: 80,
    maxAttempts: null,
    retakeCooldownMin: 5,
    dueDays: 7,
    lessons: [
      {
        kind: 'TEXT',
        title: 'Arriving at the address',
        body: `## Read before you ring

When you reach the customer, the delivery screen shows everything the customer told Flavrly. Read it before you call or ring the bell.

- **DROP**: the address, plus *Floor / flat* and *Landmark* when the customer added them.
- **Note**: special instructions such as "ring the second bell" or "leave with security".
- **CUSTOMER NOTE**: anything the customer wrote about the order itself.

### At the gate

- Park safely and legally. Do not block gates, driveways or ambulances.
- Be polite with security guards and follow the society's rules for delivery riders.
- Take your helmet off or lift the visor when you speak to people, so they can see and hear you.
- Carry the bag to the door; do not swing it around. The food inside should arrive the way it left the restaurant.`,
      },
      {
        kind: 'TEXT',
        title: 'The handover',
        body: `## Small things make a big difference

A calm, polite handover is often the only part of Flavrly a customer sees in person.

1. Greet the customer: "Hello, your Flavrly order."
2. Confirm it is the right person or flat before you hand anything over.
3. Hand the package over upright, the way it was packed.
4. Ask for the **delivery code** and enter it in the app (more on this below).
5. Thank them and leave.

### Do

- Stay polite even if the customer is in a hurry or unhappy.
- Keep your voice low late at night.
- Wear clean clothes and keep your bag clean.

### Do not

- Do not ask for ratings, tips or reviews.
- Do not enter the customer's home. Hand over at the door.
- Do not comment on the customer, their home or their food.
- Do not open the package to "show" the customer the food.`,
      },
      {
        kind: 'TEXT',
        title: 'Delivery code and contactless handover',
        body: `## The delivery code protects you

Every Flavrly order has a delivery code. The customer reads it to you, you type it in the app and tap **Confirm delivery**. This proves the order reached the right person.

- Always ask the customer for the code. **Never guess it, and never confirm an order without it.**
- If the app says the code is incorrect, politely ask the customer to read it again.
- You can also tap **Add proof-of-delivery photo** to take a photo of the handover. It is optional but helpful if there is ever a question later.

## Contactless handover

Some customers prefer not to meet face to face. If the customer asks for contactless delivery:

1. Ask them to share the delivery code over the phone or through the door.
2. Place the package on a clean, dry surface at the door, never directly on the ground or in a puddle.
3. Step back a little and wait until the customer collects it, or until they confirm they have it.
4. Take a proof-of-delivery photo if useful.

Only leave an order at a door or with security when the customer has clearly asked for it.`,
      },
      {
        kind: 'TEXT',
        title: 'Privacy and difficult moments',
        body: `## Respect the customer's privacy

The app shows you the customer's name, address and a call button so you can complete the order. That information is for this delivery only.

- Do not save the customer's number or contact them after the delivery.
- Do not share their address, name or order details with anyone.
- Do not take photos of the customer or the inside of their home.

## When things go wrong

Sometimes a customer is upset about a late order, a missing item or something else.

- Stay calm and polite. Do not argue or raise your voice.
- Explain what you know honestly. Do not make promises about refunds or replacements.
- For order problems, message **Platform Support** from **Messages** or raise an **Order issue** ticket in **Help & Support**.
- If you feel unsafe, leave the situation. Open **Safety Centre** and use **SOS** if you need urgent help.
- If a customer is abusive or a serious dispute happens, file it afterwards under **Report an Incident** and choose *Customer dispute* or *Harassment*.`,
      },
    ],
    questions: [
      {
        prompt: 'Where in the app do you find the floor, landmark and the customer\'s special instructions?',
        options: [
          'In the Earnings tab',
          'In the DROP section of the active delivery screen',
          'Only by calling the restaurant',
          'In the Refer & Earn screen',
        ],
        correctIndex: 1,
        explanation:
          'The DROP section shows the address, Floor / flat, Landmark and the customer Note. Read it before you call or ring.',
      },
      {
        prompt: 'The customer cannot find their delivery code. What should you do?',
        options: [
          'Guess a likely code and try it',
          'Hand over the food and confirm later',
          'Wait while they find it, and never confirm without the correct code',
          'Leave the order at the door and go',
        ],
        correctIndex: 2,
        explanation:
          'The delivery code proves the order reached the right person. Never guess it or skip it.',
      },
      {
        prompt: 'A customer asks for a contactless handover. Which is correct?',
        options: [
          'Get the code by phone or through the door and place the order on a clean, dry surface at the door',
          'Put the bag on the ground and leave immediately without the code',
          'Insist on handing it over by hand',
          'Enter the home and leave it on the dining table',
        ],
        correctIndex: 0,
        explanation:
          'For contactless delivery, collect the code without contact and place the package on a clean, dry surface. Never skip the code.',
      },
      {
        prompt: 'After delivery, may you message the customer to ask for a good rating?',
        options: [
          'Yes, politely, once',
          'Yes, if the order was late',
          'Only on festival days',
          'No. Do not ask for ratings or contact customers after the delivery',
        ],
        correctIndex: 3,
        explanation:
          'Customer details are for the delivery only. Asking for ratings or contacting customers afterwards is not allowed.',
      },
      {
        prompt: 'A customer starts shouting at you about a missing item. What should you do first?',
        options: [
          'Argue back so they know it is not your fault',
          'Stay calm, be polite, and contact Flavrly support from the app about the missing item',
          'Promise a full refund',
          'Take the order back to the restaurant without telling anyone',
        ],
        correctIndex: 1,
        explanation:
          'Stay calm and do not promise refunds. Raise the order problem with Flavrly support; if you feel unsafe, leave and use Safety Centre.',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Cash and payments
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'rider-cash-and-payments',
    legacyAliases: ['Handling cash-on-delivery orders', 'Handling COD orders', 'COD basics'],
    title: 'Cash on delivery and payments',
    summary:
      'How cash-on-delivery orders work in the Flavrly app: collecting cash or a digital payment at the door, tracking your cash in hand, depositing it, and withdrawing your earnings.',
    category: 'EARNINGS',
    audience: 'RIDER',
    isRequired: true,
    durationMin: 12,
    order: 40,
    passMarkPct: 80,
    maxAttempts: null,
    retakeCooldownMin: 5,
    dueDays: 7,
    lessons: [
      {
        kind: 'TEXT',
        title: 'Cash on delivery: the basics',
        body: `## What a COD order means

On a cash-on-delivery (COD) order, the customer has not paid yet. They pay when you hand over the food. The money you collect belongs to Flavrly, not to you, until you deposit it.

### Know the amount

At the top of the active delivery screen you can see the order code, the number of items and the **order total in ₹**. That total is what the customer pays. The amount in the small pill on the right is *your earning* for the trip, not the amount to collect.

### At the door

- Tell the customer the order total clearly.
- Count the cash in front of the customer, and give the correct change.
- Keep your cash in a safe, separate place, not loose in the food bag.
- Do not accept payment into your personal UPI or bank account. If the customer wants to pay digitally, use the app (next lesson).

### Never mix cash with your own money

Keep COD cash separate from your personal money. Do not spend it, lend it or use it for fuel. You will deposit it, and the records must match.`,
      },
      {
        kind: 'TEXT',
        title: 'Customer wants to pay by UPI or card',
        body: `## Collect digitally from the app

Many customers on COD orders prefer to pay by UPI or card at the door. The Flavrly app lets you take that payment properly.

When you have tapped **I've reached the customer** on a COD order, a card appears on the delivery screen: **Customer wants to pay digitally?**

1. Tap **Collect via UPI / Card**.
2. The app asks **Collect digitally?** and shows the amount. Tap **Open payment page**.
3. A secure payment page opens on your phone. The customer pays the order total by UPI or card on that page.
4. Close the page when they are done. The app shows **Confirming payment…** while it checks with the payment provider.
5. When it is confirmed, you see **Paid digitally** with the amount and the message *Don't collect any cash for this order.*

### Important

- The amount is always the order total. You cannot change it.
- **Do not take cash as well** once a digital payment is confirmed.
- Closing the payment page does not mean the money arrived. Only the **Paid digitally** message means it did.
- If the payment fails or is not confirmed, the button changes to **Try digital payment again**. You can try again or collect cash instead.
- A confirmed digital payment does not count against your cash in hand.

After payment, you still ask for the delivery code and tap **Confirm delivery** as usual.`,
      },
      {
        kind: 'TEXT',
        title: 'Cash in Hand and depositing',
        body: `## Track what you are holding

Open the **Earnings** tab and tap **Cash in Hand**. At the top you see **CASH TO DEPOSIT**: the COD cash you have collected that has not been settled yet.

COD cash you collect stays with you until you deposit it **at your branch**. Deposit regularly so your balance always matches. The screen will tell you when you are all settled.

### What the statuses mean

Your COD orders are grouped by status:

- **To collect**: still to be collected from the customer.
- **Collected**, **Partial** or **Deposit pending**: cash is with you. Deposit it soon.
- **Mismatch**: the amount recorded does not match. This needs attention.
- **Reconciled** or **Waived**: settled. Nothing more to do.

The Flavrly team updates these records when your deposit is checked. Digital payments taken through the app update automatically once the payment is confirmed. Pull down on the screen to refresh.

### If you see a Mismatch

Do not ignore it. Open **Help & Support**, tap **Raise a ticket**, choose the **Payment** category and explain what happened with that order code.`,
      },
      {
        kind: 'TEXT',
        title: 'Your earnings and withdrawals',
        body: `## Where your earnings show

When you confirm a delivery, the app shows **Delivered!** and adds that trip's earnings to your account. You can see your totals in the **Earnings** tab.

## Withdrawing money

In the **Earnings** tab, tap **Payouts**. Payouts are not instant: you send a request, and the Flavrly team processes it and makes the transfer.

- The screen shows your available balance, your lifetime earnings and how much has been paid out.
- Your available balance is your earnings minus withdrawals already paid or still being processed.
- Enter an amount (tap the max option to fill your full balance), then choose **UPI** or **Bank account**.
- For UPI, type your UPI ID carefully. For Bank account, money goes to the bank account on file with Flavrly.
- Tap **Request withdrawal**, then **Request** to confirm.

### After you request

- Your request appears under **PAYOUT HISTORY** with its status: **Requested**, then **Processing**, then **Paid** once the money is sent.
- The amount is held from your balance straight away, so you cannot withdraw it twice.
- If a request shows **Failed**, that amount returns to your available balance and you can request it again.
- If something looks wrong, raise a **Payment** ticket in Help & Support.

*Remember:* COD cash is not your earnings. Your earnings come through Payouts. Cash you collect is deposited at your branch.`,
      },
      {
        kind: 'CHECKLIST',
        title: 'End-of-shift cash checklist',
        body: 'Before you finish for the day, run through this list.',
        checklistItems: [
          'Open Cash in Hand and check the CASH TO DEPOSIT amount',
          'Count the COD cash you are carrying and make sure it matches',
          'Keep COD cash separate from your personal money',
          'Deposit the cash at your branch as soon as you can',
          'Check for any Mismatch status and raise a Payment ticket if you see one',
          'Check the status of any withdrawal you requested in Payouts',
        ],
      },
    ],
    questions: [
      {
        prompt: 'On the active delivery screen, which amount does a COD customer pay?',
        options: [
          'The amount in the earnings pill on the right',
          'Whatever the customer has in cash',
          'The order total shown under the order code',
          'The order total plus your earning',
        ],
        correctIndex: 2,
        explanation:
          'The customer pays the order total shown under the order code. The pill on the right is your earning for the trip.',
      },
      {
        prompt: 'A COD customer wants to pay by UPI. What is the right way?',
        options: [
          'Use Collect via UPI / Card in the app and let them pay on the payment page',
          'Give them your personal UPI ID',
          'Ask them to pay the restaurant directly',
          'Refuse and insist on cash',
        ],
        correctIndex: 0,
        explanation:
          'The app lets you collect digitally through Collect via UPI / Card. Never take payment into a personal account.',
      },
      {
        prompt: 'The customer closed the payment page, but the app still shows Confirming payment… What does that mean?',
        options: [
          'The payment definitely went through, so hand over the food',
          'You should collect cash as well, just in case',
          'The payment failed, so cancel the order',
          'The app is still checking; only Paid digitally means the money arrived',
        ],
        correctIndex: 3,
        explanation:
          'Closing the page is not proof of payment. Wait for Paid digitally. If it fails or is not confirmed, try again or collect cash instead.',
      },
      {
        prompt: 'Where should you deposit COD cash you have collected?',
        options: [
          'Into your own bank account first, then transfer it',
          'At your branch, as the Cash in Hand screen says',
          'Hand it to the next customer as change',
          'Keep it until the end of the month',
        ],
        correctIndex: 1,
        explanation:
          'The Cash in Hand screen tells you to deposit at your branch. Deposit regularly so your balance reconciles.',
      },
      {
        prompt: 'One of your COD orders shows Mismatch in Cash in Hand. What should you do?',
        options: [
          'Ignore it; it will clear itself',
          'Pay the difference to the next customer',
          'Raise a ticket in Help & Support under the Payment category',
          'Withdraw your earnings quickly before it is noticed',
        ],
        correctIndex: 2,
        explanation:
          'A Mismatch needs attention. Raise a Payment ticket in Help & Support with the order code so the Flavrly team can sort it out.',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Using the rider app
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'rider-using-the-app',
    legacyAliases: [
      'Completing a delivery, step-by-step',
      'Completing a delivery, step by step',
      'Completing a delivery',
    ],
    title: 'Using the Flavrly rider app',
    summary:
      'A step-by-step guide to the Flavrly rider app: going online, getting orders, navigating, pickup, confirming delivery, SOS and safety tools, reporting incidents and getting help.',
    category: 'APP_GUIDE',
    audience: 'RIDER',
    isRequired: true,
    durationMin: 18,
    order: 50,
    passMarkPct: 80,
    maxAttempts: null,
    retakeCooldownMin: 5,
    dueDays: 7,
    lessons: [
      {
        kind: 'TEXT',
        title: 'Going online',
        body: `## The Home tab

The app has five tabs at the bottom: **Home**, **Orders**, **Activity**, **Earnings** and **Profile**.

On **Home**, use the switch at the top to change your status:

- **You're online**: you are receiving delivery requests.
- **You're offline**: you will not get new orders.

Below the switch, a small line shows when the app last synced. While you are online, the app keeps checking in with Flavrly in the background, so keep the app running and your internet on.

### Before you switch on

- Allow **location** permission. Flavrly needs your location to match you with nearby orders and to show your position to the customer during a delivery.
- Allow **notifications**, so you hear new orders.
- Keep your phone charged.

### Need a short pause?

On Home, tap **Take a break** and pick 15, 30 or 60 minutes. You stay online but pause new pings. Tap **End break now** to come back early.

Your current delivery, if you have one, also appears on Home. Tap it to open the delivery screen.`,
      },
      {
        kind: 'TEXT',
        title: 'Getting orders',
        body: `## Three ways orders reach you

### 1. New order popup

When a new order is ready while you are online, a full-screen alert appears with a sound and vibration: **New order ready**. It shows the restaurant, the customer area, **YOU EARN** and how far the **PICKUP** is.

- Tap **VIEW ORDER** to go to the Orders tab.
- Tap **DISMISS** to close it. If you do nothing, it closes by itself after about 20 seconds.

### 2. The Orders tab (order pool)

The **Orders** tab lists **Available orders** that restaurants have marked ready. Each card shows the route, the items and what you earn.

- Tap **Claim this order** to take it. You must be online to claim.
- If you see **Order claimed**, it is now your active delivery.
- If you see **Just missed it**, another rider claimed it first. Try another one.

### 3. Assigned orders and batch offers

- Sometimes an order is assigned to you directly. It shows on Home as **New request**. Open it and tap **Accept this delivery**.
- While you are on a trip, you may get a **Quick batch offer**: **Add this delivery?** It shows the **EXTRA EARNINGS**, the detour and the pickup time. Tap **Accept** or **Decline**. A countdown ring runs for 15 seconds; if you do not answer, the offer is declined automatically.

*Safety first:* do not tap offers while riding. Pull over if you want to respond.`,
      },
      {
        kind: 'TEXT',
        title: 'Pickup and navigation',
        body: `## The delivery screen

When you have an active order, the delivery screen guides you through four steps, shown as a progress tracker: **Reach restaurant**, **Pick up order**, **Reach customer**, **Hand over**. The big button at the bottom always shows the next action.

### Getting to the restaurant

- The map shows the pickup, the drop and your live position. When the app knows your location, a banner shows the distance and rough time to the next stop.
- Tap **Navigate to pickup** to open turn-by-turn directions in Google Maps. Set this up *before* you start riding.
- When you arrive, tap **I've reached the restaurant**.

### At the restaurant

- Show the order code (at the top of the delivery screen) to the restaurant staff.
- Check the number of items against what the screen shows, and check that every package is sealed.
- Pack the bag properly: hot and cold apart, containers upright.
- Tap **I've picked up the order**.

### Location permission

If location is switched off, the app warns that your live position will not show on the customer's tracker. Turn it on in your phone settings so the customer can follow the order.`,
      },
      {
        kind: 'TEXT',
        title: 'Delivering and confirming the handover',
        body: `## Getting to the customer

- Tap **Navigate to customer** to open directions to the drop.
- Read the **DROP** details: address, *Floor / flat*, *Landmark* and any *Note*. Check the **CUSTOMER NOTE** too.
- If you need to speak to the customer, pull over and tap the **call** button next to their details.
- When you arrive, tap **I've reached the customer**.

## Confirming delivery

At the customer, the screen shows **Confirm hand-over**.

1. Optional: tap **Add proof-of-delivery photo** to take a photo of the handover. Once it uploads you see **Proof photo attached — retake**.
2. Hand over the order and ask the customer for their **delivery code**.
3. Type the code in the box and tap **Confirm delivery**.
4. If the code is wrong, the app tells you. Ask the customer to read it again.
5. When it is accepted, you see **Delivered!** and your earnings for the trip are added. Tap **Back to home**.

On a cash-on-delivery order, a **Customer wants to pay digitally?** card also appears at this step. See the *Cash on delivery and payments* module for how it works.`,
      },
      {
        kind: 'TEXT',
        title: 'SOS and the Safety Centre',
        body: `## Your safety tools

Open **Safety Centre** from **Profile**, or tap **Safety** on the Home screen.

### SOS

At the top of Safety Centre is the red **SOS — Emergency** button.

1. Tap it. The app asks **Trigger SOS?** to confirm.
2. Tap **Trigger SOS**. The app captures your location and sends the alert to Flavrly's safety team. Every emergency contact you have saved also gets a text message with your name, the time and a map link to your location (when SMS is set up).
3. While the alert is live, you see **SOS ACTIVE**.
4. When you are safe, tap **Mark safe / resolve** to close the alert.

**In a medical emergency or a crime, dial 112 first, then trigger SOS** so Flavrly can help too.

### Emergency Contacts

Tap **Emergency Contacts** to add the people who should be texted when you use SOS. Add a name and phone number. All your saved contacts get the SOS text, so keep the numbers up to date; **Set as primary contact** puts your main contact at the top of the list. Add at least one contact before you start riding.

### Share my live trip

Tap **Share my live trip** to send family a live-location link that works for four hours. Your phone's share sheet opens so you can send it on WhatsApp, SMS or any app. The link shows your first name, your status and your last known location on a map, never the customer's details. It stops working after four hours, or as soon as you share a new link. Useful on late-night shifts.`,
      },
      {
        kind: 'TEXT',
        title: 'Reporting incidents and getting help',
        body: `## Report an Incident

From **Safety Centre**, tap **Report an Incident** to tell Flavrly's safety team about something that happened on the road.

1. Pick a type: **Accident**, **Harassment**, **Vehicle breakdown**, **Theft**, **Unsafe location**, **Customer dispute** or **Something else**.
2. Describe what happened in a sentence or two.
3. Optionally tap **Add a photo** to take or choose a picture.
4. Your location is attached automatically.
5. Tap submit and confirm with **Submit report**. If the photo cannot upload, choose **Submit without photo** to send the report anyway, or **Cancel** to try again later.

Your past reports appear below with a status such as **Open**, **Under review** or **Resolved**. Report incidents when you are safe; in an emergency use SOS and call 112 first.

## Messages

Open **Messages** from **Profile** to chat with **Platform Support**, the Flavrly support desk. If you are a dedicated rider for one restaurant, you also have a **My Restaurant** thread.

## Help & Support

Open **Help & Support** from **Profile** to:

- **Raise a ticket**: add a subject, pick a category (**Payment**, **App bug**, **Order issue**, **KYC**, **Account**, **Safety** or **Other**), describe the problem and tap **Submit ticket**.
- Track your tickets under **YOUR TICKETS**. If a ticket says **Needs your reply**, open it and answer.
- Browse **FREQUENTLY ASKED** questions.

You can also find this course and others under **Training & Certification** in Profile.`,
      },
    ],
    questions: [
      {
        prompt: 'How do you start receiving delivery requests?',
        options: [
          'Open the Orders tab and wait',
          'Raise a ticket asking for orders',
          'Turn the switch on the Home tab so it shows You\'re online',
          'Tap Take a break',
        ],
        correctIndex: 2,
        explanation:
          'Use the switch on the Home tab. When it shows You\'re online, you receive delivery requests.',
      },
      {
        prompt: 'You tap Claim this order and see Just missed it. What happened?',
        options: [
          'Another rider claimed that order first',
          'You are offline',
          'The order was cancelled by the customer',
          'Your account is blocked',
        ],
        correctIndex: 0,
        explanation:
          'Claiming is first come, first served. Just missed it means another rider got it first; try another order.',
      },
      {
        prompt: 'What must you enter before tapping Confirm delivery?',
        options: [
          'The restaurant\'s phone number',
          'The order total',
          'Your own login OTP',
          'The delivery code the customer gives you',
        ],
        correctIndex: 3,
        explanation:
          'The customer reads their delivery code to you. Type it in and tap Confirm delivery. The proof photo is optional.',
      },
      {
        prompt: 'Where do you find the SOS button?',
        options: [
          'In the Earnings tab',
          'At the top of the Safety Centre',
          'Inside the Orders tab',
          'Only on the Help & Support screen',
        ],
        correctIndex: 1,
        explanation:
          'SOS is at the top of Safety Centre, which you can open from Profile or the Safety shortcut on Home. In an emergency, dial 112 first.',
      },
      {
        prompt: 'Your bike breaks down in the middle of a delivery. Which app action records it for Flavrly\'s safety team?',
        options: [
          'Tap DISMISS on the next order popup',
          'Change your Delivery Preferences',
          'Report an Incident and choose Vehicle breakdown',
          'Tap Take a break',
        ],
        correctIndex: 2,
        explanation:
          'Report an Incident lets you choose Vehicle breakdown. Also message Platform Support so they can help with the order.',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Cancellations and unreachable customers
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'rider-cancellations-unreachable',
    title: 'Cancellations and unreachable customers',
    summary:
      'What to do when you cannot reach the customer, when an order is cancelled, or when you cannot finish a delivery. Use the tools the app gives you and let Flavrly Support guide you.',
    category: 'CUSTOMER_SERVICE',
    audience: 'RIDER',
    isRequired: false,
    durationMin: 10,
    order: 60,
    passMarkPct: 80,
    maxAttempts: null,
    retakeCooldownMin: 0,
    dueDays: 30,
    lessons: [
      {
        kind: 'TEXT',
        title: 'Before you call it unreachable',
        body: `## Most "unreachable" customers are just hard to find

Before you decide a customer cannot be reached, check everything the app already gives you.

1. Re-read the **DROP** details: address, *Floor / flat*, *Landmark* and the *Note*.
2. Check the **CUSTOMER NOTE** for instructions.
3. Ask the security guard or a neighbour politely, if there is one.
4. Pull over and tap the **call** button next to the customer's details. Let it ring fully.
5. Wait a few minutes and call again. People may be in the lift, in a meeting or unable to hear the phone.

Stay at the address while you try. Keep the food bag closed so the order stays hot.`,
      },
      {
        kind: 'TEXT',
        title: 'When you still cannot reach the customer',
        body: `## Tap Customer unreachable and let Flavrly Support decide

Once you have tapped **I've reached the customer**, the delivery screen shows a **Customer unreachable** button under the delivery code box.

1. Tap **Customer unreachable**. The app first asks you to call the customer: tap **Call customer** to try again, or **I've already called** if you have.
2. Add a short note for support if you like, for example how many times you called or that the gate is locked. The note is optional.
3. Tap **Alert support** and confirm. Flavrly Support gets an urgent alert straight away.
4. The screen now shows **Customer unreachable** with *Flavrly support has been alerted; wait for instructions*. Stay at the location with the order. Support will contact you and tell you whether to wait longer, leave the order somewhere or take it elsewhere. Tap **Check for updates** to refresh.
5. If the customer turns up while you wait, ask for their delivery code and tap **Confirm delivery** as usual.

If the app says you are offline, support was **not** alerted. Try again when you have signal, or call rider support. You can also message **Platform Support** from **Messages** with the order code at any time.

If support closes the order, the delivery screen shows **Closed by Flavrly support**. Follow the instructions support gave you for the food.

### Never

- Never type a guessed code or tap **Confirm delivery** for an order you have not handed over.
- Never leave food at a door or with a guard unless the customer or Flavrly Support has told you to.
- Never keep, eat or give away the food.
- Never open the package.`,
      },
      {
        kind: 'TEXT',
        title: 'When an order is cancelled',
        body: `## How a cancellation looks in the app

If an order is cancelled while you are on it, it stops being an active delivery. When you open it, the delivery screen shows **Not an active delivery** and *This delivery is no longer in progress*, or **Closed by Flavrly support** if support closed it while you had the food. Tap **Back to home**.

### What to do

- If you have not picked up the food yet, you do not need to go to the restaurant for that order.
- If you already have the food with you, **do not throw it away or keep it**. Message **Platform Support** or raise an **Order issue** ticket and ask what to do with it.
- If you think an order disappeared by mistake, contact Platform Support straight away with the order code.

### Wrong or unsafe address

- If the address looks wrong, call the customer first, then contact Platform Support if it cannot be sorted out.
- If the drop location feels unsafe, do not go in. Trust your instincts, contact support, and use **Safety Centre** if you need urgent help.`,
      },
      {
        kind: 'TEXT',
        title: 'When you cannot finish a delivery',
        body: `## Breakdowns, accidents and emergencies

Sometimes you cannot finish an order yourself: your vehicle breaks down, you have a minor accident, or you feel unwell.

1. Get to a safe place first. In an emergency, dial 112 and use **SOS** in Safety Centre.
2. Message **Platform Support** with the order code and what happened, so they can sort out the order and the customer.
3. Afterwards, file a **Report an Incident** with the right type, such as **Vehicle breakdown** or **Accident**.

## Turning down orders

- On the **New order ready** popup, tap **DISMISS** if you do not want it.
- In the **Orders** tab, simply do not claim an order you cannot take.
- On a **Quick batch offer**, tap **Decline**.
- Once you have claimed or accepted an order, there is no cancel button in the app. If you cannot complete it, contact Platform Support straight away rather than abandoning it.`,
      },
    ],
    questions: [
      {
        prompt: 'You reach the address but nobody answers the door. What should you do first?',
        options: [
          'Leave the food at the door and confirm delivery',
          'Check the DROP details and customer note, then call the customer using the call button',
          'Go offline and take the food home',
          'Return the food to the restaurant immediately',
        ],
        correctIndex: 1,
        explanation:
          'Start with what the app gives you: re-read the address, landmark and notes, then call the customer, and try again after a few minutes.',
      },
      {
        prompt: 'You have called twice and waited, and the customer is still unreachable. What is next?',
        options: [
          'Tap Customer unreachable on the delivery screen, then wait for Flavrly Support\'s instructions',
          'Guess the delivery code',
          'Give the food to the security guard without asking anyone',
          'Eat the food since it will go cold',
        ],
        correctIndex: 0,
        explanation:
          'Tap Customer unreachable on the delivery screen, add a note and confirm. Flavrly Support is alerted straight away; stay with the order and follow their instructions.',
      },
      {
        prompt: 'You open your delivery and see Not an active delivery. What does this usually mean?',
        options: [
          'The app has crashed and you must reinstall it',
          'You have been paid twice',
          'The customer has already received the food from someone else',
          'The delivery is no longer in progress, for example because it was cancelled',
        ],
        correctIndex: 3,
        explanation:
          'This message means the order is no longer an active delivery. If you are holding the food, contact Platform Support for what to do with it.',
      },
      {
        prompt: 'You accepted an order but your bike breaks down. How do you cancel it in the app?',
        options: [
          'Tap the cancel button on the delivery screen',
          'Switch yourself offline; the order cancels itself',
          'There is no cancel button: get safe, contact Platform Support, then report the breakdown',
          'Tap DISMISS on the delivery screen',
        ],
        correctIndex: 2,
        explanation:
          'Once accepted, there is no in-app cancel. Contact Platform Support so they can handle the order, and file a Vehicle breakdown report.',
      },
      {
        prompt: 'When may you leave an order at the door or with a security guard?',
        options: [
          'Whenever the customer does not answer within one minute',
          'Only when the customer or Flavrly Support has told you to',
          'Always, to save time',
          'Only on cash orders',
        ],
        correctIndex: 1,
        explanation:
          'Leave an order unattended only when the customer or Flavrly Support asks you to. Otherwise, wait and follow support\'s instructions.',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Weather and night riding
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'rider-weather-night-riding',
    title: 'Riding in bad weather and at night',
    summary:
      'Stay safe in monsoon rain, summer heat, winter fog and after dark: how to ride, what to wear, how to protect the food, and when to stop.',
    category: 'SAFETY',
    audience: 'RIDER',
    isRequired: false,
    durationMin: 12,
    order: 70,
    passMarkPct: 80,
    maxAttempts: null,
    retakeCooldownMin: 0,
    dueDays: 30,
    lessons: [
      {
        kind: 'TEXT',
        title: 'Monsoon riding',
        body: `## Rain changes everything

Wet roads are slippery, brakes take longer to work, and potholes hide under water. Ride slower than you think you need to.

### On the road

- Reduce speed and double your gap from the vehicle in front.
- Brake gently and early. Use both brakes together; do not grab the front brake hard.
- Avoid painted road markings, metal covers and leaves. They are extra slippery when wet.
- **Do not ride through water when you cannot see the bottom.** It can hide open drains, manholes or deep potholes. Find another route.
- If your engine stalls in water, do not keep restarting it. Push the vehicle to higher ground.
- During heavy lightning, stop in a safe building, not under a tree or a metal shed.

### Gear

- A proper two-piece raincoat is safer than an umbrella or a loose poncho. Never ride holding an umbrella.
- Keep your visor clean; an anti-fog visor helps.
- Use a waterproof pouch for your phone.
- Use a rain cover on your delivery bag so the food stays dry.

If waterlogging makes riding unsafe, take a break or go offline. No order is worth being swept away.`,
      },
      {
        kind: 'TEXT',
        title: 'Summer heat',
        body: `## Heat wears you down quietly

Hours in the sun and hot traffic can cause heat exhaustion before you notice it.

### Stay cool

- Drink water regularly, even when you are not thirsty. Carry a bottle.
- Take short breaks in the shade. Use **Take a break** in the app to pause pings.
- Wear light, breathable clothing under your jacket. Keep your helmet on; a helmet liner or cloth helps with sweat.
- Eat light meals during the day.

### Warning signs of heat illness

- Headache, dizziness or feeling faint
- Very heavy sweating, or no sweating at all with hot, dry skin
- Nausea or muscle cramps
- Confusion

If you notice these, stop riding, move to shade, drink water and rest. If you feel confused or faint, call 112 or ask someone to get help.

### Protect the food too

Keep your bag closed and out of direct sun while you wait. Cold items warm up fast in summer, so go straight from pickup to the customer.`,
      },
      {
        kind: 'TEXT',
        title: 'Fog and night riding',
        body: `## When you cannot see far

In winter fog and at night, other road users may not see you, and you may not see them.

### Fog

- Slow right down. Ride at a speed that lets you stop within the distance you can see.
- Use your **low beam**. High beam reflects off fog and makes it harder to see.
- Keep a larger gap and avoid overtaking.
- Follow the left edge of the road and lane markings, not the tail light of a fast vehicle.
- If the fog is too thick to see the road, pull over somewhere safe and wait.

### At night

- Check your headlight, tail light and indicators before you go online.
- Wear reflective clothing or a reflective vest so drivers see you.
- Choose well-lit main roads over dark shortcuts, even if they are a little longer.
- Watch out for unlit vehicles, stray animals and speed breakers.
- Keep your phone charged.
- Use **Share my live trip** in **Safety Centre** to send family a live-location link while you ride late.

Trust your instincts. If a drop-off feels unsafe, contact support before going in. In an emergency, dial 112 first, then trigger **SOS**.`,
      },
      {
        kind: 'CHECKLIST',
        title: 'Bad-weather and night shift checklist',
        body: 'Before a monsoon, summer or late-night shift, check you have these.',
        checklistItems: [
          'Two-piece raincoat that does not flap or block your view',
          'Waterproof pouch for your phone',
          'Rain cover for your delivery bag',
          'Clean visor, anti-fog if possible',
          'Water bottle',
          'Reflective clothing or vest',
          'Headlight, tail light and indicators working',
          'Phone fully charged, and a power bank',
          'Emergency contacts saved in the app',
        ],
      },
    ],
    questions: [
      {
        prompt: 'The road ahead is flooded and you cannot see how deep the water is. What should you do?',
        options: [
          'Ride through fast so the engine does not stall',
          'Follow a car through it',
          'Find another route instead of riding through',
          'Ride through on the footpath',
        ],
        correctIndex: 2,
        explanation:
          'Water can hide open drains, manholes and deep potholes. If you cannot see the bottom, find another route.',
      },
      {
        prompt: 'Which headlight setting is best in thick fog?',
        options: [
          'Low beam',
          'High beam',
          'No headlight, to avoid glare',
          'Flash the high beam constantly',
        ],
        correctIndex: 0,
        explanation:
          'High beam reflects off fog and reduces what you can see. Use low beam and slow down.',
      },
      {
        prompt: 'It is a hot afternoon and you feel dizzy with a headache. What should you do?',
        options: [
          'Ride faster to finish and go home',
          'Drink a cold soft drink and keep riding',
          'Take off your helmet to cool down while riding',
          'Stop, move to shade, drink water and rest before riding again',
        ],
        correctIndex: 3,
        explanation:
          'These are signs of heat illness. Stop, cool down and rehydrate. If you feel confused or faint, get help.',
      },
      {
        prompt: 'It starts raining heavily. What is the right way to brake?',
        options: [
          'Grab the front brake hard',
          'Brake gently and early, using both brakes',
          'Use only the rear brake and skid to a stop',
          'Do not brake; use the engine only',
        ],
        correctIndex: 1,
        explanation:
          'Wet roads need longer stopping distances. Brake early and smoothly with both brakes to avoid skidding.',
      },
      {
        prompt: 'You are riding late at night. Which app feature lets your family follow your location?',
        options: [
          'Payouts',
          'Delivery Preferences',
          'Share my live trip in Safety Centre',
          'Refer & Earn',
        ],
        correctIndex: 2,
        explanation:
          'Share my live trip in Safety Centre sends a live-location link that works for four hours.',
      },
    ],
  },
];

/**
 * Rider training — curated default content (Flavrly brand).
 *
 * This file is the single source of truth for the 6 default training modules
 * that ship with every Flavrly installation. It is consumed by:
 *   • `prisma/upgrade-training-modules.ts` — replaces stale seed rows on prod
 *   • `src/server/training-cms.ts`         — re-exports as TRAINING_DEFAULTS
 *
 * Each module is intentionally substantial (10–15 min of reading + interactive
 * checks) so onboarding is no longer a 4-minute formality — it's a proper
 * lesson series with images, safety callouts, checklists, and a quick quiz
 * at the end of every module to confirm comprehension.
 *
 * Image URLs are Unsplash (hot-link friendly with `?auto=format` params); the
 * lesson player wraps every image in <ImageWithFallback> so a dead URL
 * degrades to a branded gradient placeholder.
 */
import type { ContentBlock } from './training-cms';

export interface TrainingDefault {
  /** Stable slug used by the upgrade script to find/replace existing rows. */
  slug: string;
  title: string;
  summary: string;
  category: 'ONBOARDING' | 'SAFETY' | 'CUSTOMER_SERVICE' | 'EARNINGS' | 'APP_GUIDE';
  durationMin: number;
  order: number;
  isRequired: boolean;
  heroImageUrl: string;
  contentBlocks: ContentBlock[];
}

// Unsplash photo helper (1200px wide, format-auto, lossy compression).
const img = (id: string, w = 1200) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&auto=format&fit=crop&q=80`;

let _seq = 0;
const id = (k: string) => `seed_${k}_${_seq++}`;

// ─────────────────────────── 1. Welcome to Flavrly ──────────────────────────
const WELCOME: TrainingDefault = {
  slug: 'welcome-to-flavrly',
  title: 'Welcome to Flavrly',
  summary: 'How Flavrly works, what to expect on your first week, and where to find help.',
  category: 'ONBOARDING',
  durationMin: 12,
  order: 1,
  isRequired: true,
  heroImageUrl: img('1542838132-92c53300491e'),
  contentBlocks: [
    { id: id('w-h1'), type: 'heading', text: 'You\'re officially on the road with Flavrly 🎉' },
    { id: id('w-p1'), type: 'paragraph', text: 'Flavrly is a two-sided marketplace — customers order, restaurants cook, and you deliver. Every order you complete keeps the platform running and puts money in your wallet. This module covers everything you need to know in your first week: how the app works, what your day looks like, who to contact, and how you get paid.' },
    { id: id('w-img1'), type: 'image', src: img('1556909114-f6e7ad7d3136'), alt: 'A delivery rider on a scooter', caption: 'Most Flavrly deliveries are within 5 km. We dispatch the closest available rider.' },

    { id: id('w-h2'), type: 'heading', text: 'A typical day, end-to-end' },
    { id: id('w-p2'), type: 'paragraph', text: 'You start by going online from the app\'s home screen — tap the big toggle at the top. Within seconds the dispatch engine notices you and starts considering you for nearby orders. When a job matches, you\'ll get a popup with the customer\'s area, distance to the restaurant, distance to the customer, and the estimated payout.' },
    { id: id('w-p3'), type: 'paragraph', text: 'Accept the order and the app routes you to the restaurant. Show the kitchen your pickup code, collect the food, then head to the customer. At drop-off you confirm the delivery OTP (or take a photo if the customer asked for contact-less). The earnings hit your wallet the moment the order is marked delivered.' },

    { id: id('w-kp1'), type: 'keyPoints', title: 'The 5 stages of every Flavrly order', points: [
      'NOTIFY — A popup with the order summary and payout',
      'ACCEPT — You confirm; we route you to the restaurant',
      'PICKUP — Show the pickup code, collect the food',
      'DELIVER — Navigate to the customer, confirm the delivery OTP',
      'PAID — Earnings land in your in-app wallet instantly',
    ] },

    { id: id('w-h3'), type: 'heading', text: 'Going online — and when not to' },
    { id: id('w-p4'), type: 'paragraph', text: 'You decide when you\'re online. Most riders set a daily target (3–5 deliveries during lunch, 5–7 during dinner) and finish in 4–6 hours of active riding. You don\'t need permission to log off — just toggle offline when you\'re done. We strongly recommend NOT going online if you\'re tired, the weather is poor, or you don\'t have a charged phone with mobile data; missed pickups hurt your rating.' },

    { id: id('w-cta1'), type: 'callout', tone: 'tip', title: 'Tip: lunch and dinner are your friends',
      body: 'Order volumes spike 12:00–14:30 and 19:00–22:00 every day. Going online during these windows means shorter idle gaps between deliveries and higher overall payouts. Plan your day around them if you can.' },

    { id: id('w-h4'), type: 'heading', text: 'Your dashboard' },
    { id: id('w-p5'), type: 'paragraph', text: 'The home tab shows today\'s earnings, deliveries done, and your current order if you have one. The Earnings tab breaks down per-delivery payouts, tips, surge bonuses, and tier rewards. The Profile tab is where you upload documents (KYC), edit your avatar, see your rating, and contact support.' },
    { id: id('w-img2'), type: 'image', src: img('1556157382-97eda2d62296'), alt: 'A rider checking their phone', caption: 'Keep your phone mounted and charged — you\'ll be looking at it a lot.' },

    { id: id('w-h5'), type: 'heading', text: 'Documents you need (one-time)' },
    { id: id('w-cl1'), type: 'checklist', title: 'Submit these in Profile → KYC before your first paid delivery', items: [
      'Aadhaar card (front + back)',
      'PAN card',
      'Driving licence (valid + non-expired)',
      'Vehicle registration certificate (RC)',
      'Vehicle insurance certificate (PDF or photo)',
      'A clear selfie for your rider profile',
    ] },
    { id: id('w-cta2'), type: 'callout', tone: 'warning', title: 'You can ride immediately, but…',
      body: 'You can accept orders before KYC is verified, but your earnings are HELD in your wallet until our team approves your documents. Most KYC approvals take under 24 hours. Upload everything on day one to avoid delays.' },

    { id: id('w-h6'), type: 'heading', text: 'How you get paid' },
    { id: id('w-p6'), type: 'paragraph', text: 'Every completed delivery credits your in-app wallet immediately. Your wallet balance is real money — you can request a payout to your bank account anytime from the Earnings tab. Payouts process daily on bank business days (T+1 for most banks). Tips, surge bonuses, and tier rewards land in the same wallet.' },

    { id: id('w-h7'), type: 'heading', text: 'When something goes wrong' },
    { id: id('w-p7'), type: 'paragraph', text: 'Stuff happens — a customer\'s phone is off, a restaurant is closed, you have a flat tyre. The Help button at the top of the home screen connects you instantly to Flavrly support (in-app chat + phone). For genuine safety emergencies, use the SOS button on the active-order screen — it pings our ops team AND notifies the emergency contact you set up in Profile.' },
    { id: id('w-cta3'), type: 'callout', tone: 'info', title: 'Save the support number',
      body: 'Rider support: +91 92139 95005 (24×7). Save it as "Flavrly Support" in your phone so it\'s one tap away even if the app is acting up.' },

    { id: id('w-d1'), type: 'divider' },
    { id: id('w-q1'), type: 'quiz', question: 'A customer\'s phone is switched off when you arrive at their address. What\'s the right first step?',
      options: [
        'Mark the order undelivered and leave',
        'Wait at the door for 30 minutes',
        'Tap "Customer unreachable" in the app — support will help locate them',
        'Eat the food yourself',
      ],
      correct: 2,
      explanation: 'Use the in-app "Customer unreachable" flow. We try a backup contact + WhatsApp, and support steps in within minutes. Never abandon an order or take it home without the official flow — both can affect your rating and earnings.' },
  ],
};

// ───────────────────── 2. Completing a delivery, step-by-step ────────────────
const DELIVERY: TrainingDefault = {
  slug: 'completing-a-delivery',
  title: 'Completing a delivery, step-by-step',
  summary: 'Notification → accept → pickup OTP → delivery OTP → proof. The full happy-path and the common bumps.',
  category: 'APP_GUIDE',
  durationMin: 15,
  order: 2,
  isRequired: true,
  heroImageUrl: img('1526367790999-0150786686a2'),
  contentBlocks: [
    { id: id('d-h1'), type: 'heading', text: 'Every delivery — exactly the same 5 steps' },
    { id: id('d-p1'), type: 'paragraph', text: 'Once you\'re online, the dispatch engine evaluates every new order against the nearest available riders. If you\'re the best match (closest, available, not on a current order), you\'ll get a "New order" popup with sound + vibration. You have 30 seconds to accept or skip.' },
    { id: id('d-cta1'), type: 'callout', tone: 'info', title: 'What\'s in the popup',
      body: 'The popup shows: restaurant name + distance, customer area + distance, estimated total trip time, and the estimated payout (base fare + distance + any active surge). It\'s everything you need to decide in 30 seconds.' },

    { id: id('d-h2'), type: 'heading', text: 'Step 1 — Accept' },
    { id: id('d-p2'), type: 'paragraph', text: 'Tap "Accept" on the popup. The order locks to you, the popup closes, and the active-order screen opens with turn-by-turn navigation to the restaurant. The customer is notified that a rider has been assigned. If you skip or let the popup time out, the order goes to the next closest rider — no penalty, but skipping too many in a row temporarily lowers your dispatch priority.' },

    { id: id('d-h3'), type: 'heading', text: 'Step 2 — Pickup at the restaurant' },
    { id: id('d-p3'), type: 'paragraph', text: 'Navigate to the restaurant. When you arrive, the app prompts you to enter the 4-digit PICKUP OTP — this code is shown to the kitchen team on their order screen. They\'ll read it out to you, you type it in, the app marks the order PICKED UP and switches to navigation to the customer.' },
    { id: id('d-img1'), type: 'image', src: img('1571805341302-f857a8559b14'), alt: 'A rider picking up an order from a restaurant', caption: 'Always check the bag is sealed before you leave. Once you tap PICKED UP you own the food.' },
    { id: id('d-cl1'), type: 'checklist', title: 'Before you leave the restaurant', items: [
      'Bag is sealed (Flavrly sticker / staple)',
      'You have the right number of items',
      'Hot food is in your insulated bag',
      'Cold items are separated from hot',
      'Pickup OTP entered → status says PICKED UP',
    ] },

    { id: id('d-h4'), type: 'heading', text: 'Step 3 — Navigate to the customer' },
    { id: id('d-p4'), type: 'paragraph', text: 'The active-order screen now shows turn-by-turn nav to the drop-off pin. Tap the navigation icon to open Google Maps if you prefer. The customer can see your live location during this leg — that\'s the small dot they\'re tracking on their order page. Keep your phone\'s GPS on; if it drops, the customer sees a stale location and starts calling.' },
    { id: id('d-cta2'), type: 'callout', tone: 'tip', title: 'Quick win: tap-to-call the customer',
      body: 'There\'s a phone icon at the top of the active-order screen — it dials the customer without revealing your real number (we masked it via a relay service). Use it if the pin is wrong, the gate is locked, or you can\'t find the flat.' },

    { id: id('d-h5'), type: 'heading', text: 'Step 4 — Drop off + the DELIVERY OTP' },
    { id: id('d-p5'), type: 'paragraph', text: 'When you arrive, the app prompts you for the 4-digit DELIVERY OTP. The customer sees this code on their order page. They read it out, you type it in, the app marks the order DELIVERED. Your wallet credits within 5 seconds and the home screen returns to the "Looking for orders" state.' },
    { id: id('d-cta3'), type: 'callout', tone: 'warning', title: 'Never skip the OTP step',
      body: 'The OTP is how Flavrly proves the food reached the right person. If a customer says "just leave it at the door," ask them to read the OTP first — they have it on their order page. No OTP = the order can be flagged as "unverified" and you may not get paid for it.' },

    { id: id('d-h6'), type: 'heading', text: 'Step 5 — Proof of delivery (when requested)' },
    { id: id('d-p6'), type: 'paragraph', text: 'Some orders (contact-less, gifts, high-value) ask for a photo. After you tap DELIVERED, the app prompts you to take a photo of the food at the door / handed over. This is automatic on contact-less orders. Take the photo straight away — don\'t skip it; the customer sees it on their tracker as confirmation.' },
    { id: id('d-img2'), type: 'image', src: img('1604908176997-125f25cc6f3d'), alt: 'A bag of takeaway food left at a doorstep', caption: 'A clear photo of the bag at the door is the gold-standard proof. Frame the door number if you can.' },

    { id: id('d-d1'), type: 'divider' },
    { id: id('d-h7'), type: 'heading', text: 'Edge cases — the ones that catch new riders' },

    { id: id('d-p7'), type: 'paragraph', text: 'Restaurant says the order doesn\'t exist: open the order in the app, tap "Restaurant issue," and the in-app chat opens with restaurant support. Don\'t leave or cancel on your end — let support reconcile.' },
    { id: id('d-p8'), type: 'paragraph', text: 'Customer not answering at the door: tap-to-call first. If still no answer after 2 attempts, use "Customer unreachable" — this triggers a 5-minute timer. If they still don\'t respond, follow the support prompts; do NOT just leave the food.' },
    { id: id('d-p9'), type: 'paragraph', text: 'Item missing from the bag: this is the restaurant\'s problem, not yours. Hand over what you have and tap "Item missing" on the active-order screen. Flavrly auto-refunds the customer for the missing item and you still get your full payout.' },
    { id: id('d-p10'), type: 'paragraph', text: 'Wrong address / dropped pin: the customer\'s pin is what shows on your map. If they meant a different building, call them and update via the in-app chat. We never pay penalties for moving to a corrected address.' },

    { id: id('d-d2'), type: 'divider' },
    { id: id('d-q1'), type: 'quiz', question: 'You\'re at the customer\'s door. They say "Just leave the bag, no need for OTP." What do you do?',
      options: [
        'Leave the bag and mark delivered',
        'Ask them to read the OTP from their order page first, then mark delivered',
        'Take a photo and skip the OTP',
        'Refuse to deliver',
      ],
      correct: 1,
      explanation: 'The OTP is mandatory — it\'s how we prove the food reached the right person. The customer has it on their tracker; it takes them 5 seconds to read it out. Never mark delivered without an OTP unless the order is officially flagged contact-less (you\'ll know because the app skips the OTP step for those).' },
  ],
};

// ─────────────────────── 3. Staying safe on the road ────────────────────────
const SAFETY: TrainingDefault = {
  slug: 'staying-safe-on-the-road',
  title: 'Staying safe on the road',
  summary: 'SOS, sharing your trip, weather, night riding, and what to do if there\'s an accident.',
  category: 'SAFETY',
  durationMin: 14,
  order: 3,
  isRequired: true,
  heroImageUrl: img('1517021897933-0e0319cfbc28'),
  contentBlocks: [
    { id: id('s-h1'), type: 'heading', text: 'Your safety is non-negotiable.' },
    { id: id('s-p1'), type: 'paragraph', text: 'You can always cancel an order, log off, or hit SOS if something feels wrong. Flavrly does not penalise you for prioritising your safety — ever. This module covers the basics every rider needs: gear, weather, traffic rules, and the SOS / trip-share features in the app.' },

    { id: id('s-h2'), type: 'heading', text: 'Gear — the non-negotiables' },
    { id: id('s-img1'), type: 'image', src: img('1606820854416-439b3305ff39'), alt: 'A helmet on a scooter', caption: 'A full-face or open-face ISI-marked helmet is mandatory for every Flavrly rider.' },
    { id: id('s-cl1'), type: 'checklist', title: 'Wear / carry every ride', items: [
      'ISI-marked helmet, strap buckled (no exceptions, even for 1 km)',
      'Closed shoes — never slippers or flip-flops',
      'Reflective vest (or jacket with reflective strips) after sunset',
      'A second phone charger or power bank — your phone running out mid-trip is a safety issue',
      'A small basic first-aid kit (bandages, antiseptic) under your seat',
    ] },

    { id: id('s-h3'), type: 'heading', text: 'Weather' },
    { id: id('s-p2'), type: 'paragraph', text: 'Heavy rain, fog, and sandstorms dramatically increase accident risk. The app puts a yellow weather banner on the home screen when conditions are poor in your area. You\'re free to log off or finish your current order and stop — your dispatch priority will not be affected.' },
    { id: id('s-cta1'), type: 'callout', tone: 'warning', title: 'During monsoon',
      body: 'Reduce your speed by at least 30% on wet roads. Avoid waterlogged streets — even small puddles can hide potholes that wreck a scooter. Keep your phone in a waterproof pouch; we\'ve seen drowned phones cost riders ₹15,000+.' },

    { id: id('s-h4'), type: 'heading', text: 'Night riding' },
    { id: id('s-p3'), type: 'paragraph', text: 'A huge slice of Flavrly orders happen after sunset. Visibility drops, drivers are more tired, and lone streets feel different. Use a reflective vest, keep your headlight on, ride a tier wider from the kerb, and avoid shortcuts through unlit lanes — even if they\'re faster.' },

    { id: id('s-h5'), type: 'heading', text: 'Traffic rules — the ones that protect YOU' },
    { id: id('s-kp1'), type: 'keyPoints', title: 'Top 5 fines we see riders get', points: [
      'No helmet — ₹1,000 (and we suspend you on the spot)',
      'Riding on the footpath — ₹2,000',
      'Triple-riding or carrying a passenger — ₹1,000',
      'Phone in hand while riding (use a phone mount) — ₹5,000',
      'Wrong-way driving on a one-way — ₹1,500',
    ] },
    { id: id('s-p4'), type: 'paragraph', text: 'Beyond the fine, every one of these dramatically raises your chance of an accident. We will not reimburse a fine, and any incident on a wrong-way or footpath is automatically your liability.' },

    { id: id('s-d1'), type: 'divider' },
    { id: id('s-h6'), type: 'heading', text: 'SOS — the red button' },
    { id: id('s-p5'), type: 'paragraph', text: 'Inside any active order screen, there\'s a red SOS button at the bottom-right. Press and hold it for 2 seconds. It immediately:' },
    { id: id('s-kp2'), type: 'keyPoints', points: [
      'Sends your live GPS to Flavrly ops (24×7)',
      'Pages your in-app emergency contact (set this up in Profile!)',
      'Opens a one-tap call to support',
      'Logs your last 5 minutes of location history',
    ] },
    { id: id('s-cta2'), type: 'callout', tone: 'danger', title: 'Use SOS for any of these',
      body: 'You\'ve been in an accident · Someone is threatening you · You feel followed · You\'re lost in an unsafe area · You\'re injured and can\'t continue. Never feel embarrassed about pressing SOS — false alarms have zero penalty.' },

    { id: id('s-h7'), type: 'heading', text: 'Share My Trip' },
    { id: id('s-p6'), type: 'paragraph', text: 'In Profile → Safety, turn on "Share my trip with…" and add a friend or family member. They\'ll get a WhatsApp link with your live map view whenever you\'re online. It\'s a great low-effort safety net — they can spot if you\'ve been stationary too long and call to check in.' },

    { id: id('s-d2'), type: 'divider' },
    { id: id('s-h8'), type: 'heading', text: 'If you\'re in an accident' },
    { id: id('s-cl2'), type: 'checklist', title: 'Step by step', items: [
      'Move out of moving traffic if you can — your safety first, food second',
      'Press SOS — this notifies Flavrly ops + your emergency contact',
      'If anyone is injured, call 112 (universal Indian emergency number)',
      'Take photos: damage, the other vehicle, the scene, your injuries',
      'Don\'t leave the scene until ops or police have your statement',
      'Open the active order in the app and tap "Accident" → we reassign it',
    ] },
    { id: id('s-cta3'), type: 'callout', tone: 'success', title: 'Insurance is built in',
      body: 'Every active Flavrly delivery is covered by our group accident insurance: ₹2 lakh personal accident cover, ₹1 lakh medical reimbursement. The claim form lives in Profile → Insurance. Ops can help you file it.' },

    { id: id('s-d3'), type: 'divider' },
    { id: id('s-q1'), type: 'quiz', question: 'You\'ve just had a minor scrape with another scooter. No one is injured, but his light is broken. What\'s the FIRST thing you do?',
      options: [
        'Pay him in cash and ride off',
        'Press SOS, then take photos of both vehicles + the scene',
        'Cancel the order in the app',
        'Carry on with the delivery and report later',
      ],
      correct: 1,
      explanation: 'SOS first — it notifies ops and your emergency contact, and starts a 24×7 trail. Photos protect you later if there\'s a dispute. Never pay cash on-the-spot for an incident; let our insurance + ops handle it.' },
  ],
};

// ─────────────────────── 4. Five-star customer service ──────────────────────
const SERVICE: TrainingDefault = {
  slug: 'five-star-customer-service',
  title: 'Five-star customer service',
  summary: 'Small habits that compound: greetings, communication, presentation, and what to do when something\'s wrong.',
  category: 'CUSTOMER_SERVICE',
  durationMin: 12,
  order: 4,
  isRequired: false,
  heroImageUrl: img('1556909114-f6e7ad7d3136'),
  contentBlocks: [
    { id: id('cs-h1'), type: 'heading', text: 'Your rating is your business card.' },
    { id: id('cs-p1'), type: 'paragraph', text: 'A 4.8+ rider gets dispatched on more orders, qualifies for higher tier rewards, and gets first dibs on surge zones. A 4.2 rider gets fewer orders and gets warned. The good news: 90% of your rating comes from 4 tiny habits.' },

    { id: id('cs-kp1'), type: 'keyPoints', title: 'The 4 habits of 4.9-star riders', points: [
      'Greet by name — "Hi, this is your order from Bowl & Barbeque"',
      'Confirm the OTP politely, then thank them',
      'Hand the bag carefully — both hands, food side up',
      'Smile (yes, even at midnight)',
    ] },

    { id: id('cs-h2'), type: 'heading', text: 'On WhatsApp / call' },
    { id: id('cs-p2'), type: 'paragraph', text: 'You\'ll occasionally need to ring the customer (gate is locked, can\'t find the flat, etc). Keep it short, warm, and professional. Indians appreciate respectful tone — start with "Sir/Madam, your Flavrly delivery here…" and you\'ll never go wrong.' },
    { id: id('cs-cta1'), type: 'callout', tone: 'tip', title: 'A line that works every time',
      body: '"Hi, this is your Flavrly delivery — I\'m at the gate, what\'s the easiest way up?" It\'s neutral, polite, and gets the answer you need without sounding impatient.' },

    { id: id('cs-h3'), type: 'heading', text: 'Presentation matters' },
    { id: id('cs-img1'), type: 'image', src: img('1565299624946-b28f40a0ae38'), alt: 'A clean, well-organised insulated delivery bag', caption: 'A clean bag earns silent five-stars. Customers notice.' },
    { id: id('cs-cl1'), type: 'checklist', title: 'A 5-second check before handover', items: [
      'Bag is clean (no spilled gravy, no grease stains)',
      'Hot food is still warm (didn\'t sit at the bottom)',
      'No items have shifted / leaked inside the bag',
      'You\'re holding it the right way up',
    ] },

    { id: id('cs-h4'), type: 'heading', text: 'When something\'s wrong' },
    { id: id('cs-p3'), type: 'paragraph', text: 'A missing item, a cold biryani, a spilled drink — the customer\'s frustration is rarely at you, but you\'re the face of the brand in that moment. Apologise sincerely (without taking the blame), use the app\'s "Item issue" flow on the spot, and tell the customer Flavrly support will follow up. That single behaviour turns a 1-star into a 4-star.' },
    { id: id('cs-cta2'), type: 'callout', tone: 'warning', title: 'Never argue with the customer',
      body: 'Even if they\'re wrong, an argument is an automatic 1-star. Stay calm, say "I\'m really sorry — Flavrly support will sort this out within minutes," and move on. Ops will handle it.' },

    { id: id('cs-h5'), type: 'heading', text: 'Tips' },
    { id: id('cs-p4'), type: 'paragraph', text: 'About 1 in 6 Flavrly customers tips. Tips go directly to your wallet (100% — Flavrly takes nothing). Never ask for a tip, never look disappointed if there isn\'t one — but a sincere "thank you, enjoy your meal" makes future tips far more likely.' },

    { id: id('cs-d1'), type: 'divider' },
    { id: id('cs-q1'), type: 'quiz', question: 'A customer is angry that her chicken biryani is cold. She wants the food replaced free. What\'s the right action?',
      options: [
        'Argue that you delivered it fast and it wasn\'t cold when you picked it up',
        'Apologise, tap "Item issue → Quality" in the app, tell her Flavrly support will reach out',
        'Offer her cash from your own pocket',
        'Take the food back to the restaurant',
      ],
      correct: 1,
      explanation: 'You\'re not the chef — but you ARE the face of the brand. Apologise, log the issue in the app (this triggers an auto-refund flow), and let support handle it. You stay calm; ops fixes the problem; your rating survives.' },
  ],
};

// ─────────────────────── 5. Maximising your earnings ────────────────────────
const EARNINGS: TrainingDefault = {
  slug: 'maximising-your-earnings',
  title: 'Maximising your earnings',
  summary: 'How payouts work, surge zones, peak hours, the tier system, and the math behind your weekly cheque.',
  category: 'EARNINGS',
  durationMin: 14,
  order: 5,
  isRequired: false,
  heroImageUrl: img('1554224155-6726b3ff858f'),
  contentBlocks: [
    { id: id('e-h1'), type: 'heading', text: 'Your earnings, decoded.' },
    { id: id('e-p1'), type: 'paragraph', text: 'Every Flavrly payout is the sum of FIVE things: base fare + distance + (optional) surge + (optional) tier bonus + tip. This module shows you exactly how each one is calculated and where the levers are — because riders who understand the math typically out-earn the average by 25–40%.' },

    { id: id('e-h2'), type: 'heading', text: '1. Base fare' },
    { id: id('e-p2'), type: 'paragraph', text: 'A fixed ₹25–₹35 per delivery (set by your region\'s ops team). This is the floor — even the shortest delivery pays this much.' },

    { id: id('e-h3'), type: 'heading', text: '2. Distance' },
    { id: id('e-p3'), type: 'paragraph', text: 'You\'re paid for the route from the restaurant to the customer — typically ₹5–₹7 per km. The app calculates this on actual GPS distance, not straight-line. Idle riding (between deliveries) is unpaid, which is why batching matters (more on that below).' },

    { id: id('e-h4'), type: 'heading', text: '3. Surge zones' },
    { id: id('e-img1'), type: 'image', src: img('1597366605946-b5b00de4ea6c'), alt: 'A map showing busy areas', caption: 'Surge is automatic — the engine knows when demand is outpacing supply in an area.' },
    { id: id('e-p4'), type: 'paragraph', text: 'When demand outstrips supply in an area (e.g. lunch hour in HSR, a sudden downpour in Indiranagar), that area goes "surge" — every delivery picked up there pays an extra 1.2×, 1.5×, or 2.0× of the base + distance. The home screen shows a heat-map of currently surging zones. Positioning yourself in or near a surge zone is the single biggest lever you have.' },
    { id: id('e-cta1'), type: 'callout', tone: 'tip', title: 'Park, don\'t roam',
      body: 'Once you\'re inside a surge zone, park somewhere safe and wait. Riding around burns fuel + time. The next order will find you in under 3 minutes during a real surge.' },

    { id: id('e-h5'), type: 'heading', text: '4. Tier bonuses' },
    { id: id('e-p5'), type: 'paragraph', text: 'Flavrly has 4 rider tiers: Bronze → Silver → Gold → Platinum. Each tier kicks in at a delivery-count milestone, and each tier earns a fixed % top-up on every payout. Your tier resets every month — it\'s "how hard you worked THIS month," not lifetime.' },
    { id: id('e-kp1'), type: 'keyPoints', title: 'Tier bonuses (per delivery)', points: [
      'Bronze (0–60 deliveries / month): +0%',
      'Silver (61–150): +5%',
      'Gold (151–300): +10%',
      'Platinum (301+): +15% + priority dispatch',
    ] },

    { id: id('e-h6'), type: 'heading', text: '5. Tips' },
    { id: id('e-p6'), type: 'paragraph', text: 'You keep 100% of every tip. Tips land in your wallet within 24h of the customer rating your order. Five-star service (see the Customer Service module) is the single biggest factor — riders rated 4.8+ get 2.3× the tip volume of riders rated below 4.5.' },

    { id: id('e-d1'), type: 'divider' },
    { id: id('e-h7'), type: 'heading', text: 'Putting it together — a real example' },
    { id: id('e-p7'), type: 'paragraph', text: 'A 4-km delivery during dinner surge (1.5×) for a Gold-tier rider with a ₹20 tip:' },
    { id: id('e-kp2'), type: 'keyPoints', points: [
      'Base ₹30',
      'Distance 4 km × ₹6 = ₹24',
      'Subtotal ₹54 × 1.5 surge = ₹81',
      'Gold tier +10% = ₹89.10',
      'Plus ₹20 tip = ₹109.10 total payout for one delivery',
    ] },
    { id: id('e-p8'), type: 'paragraph', text: 'Doing 25 deliveries like this in a day = ₹2,700+. That\'s what consistent Platinum / Gold riders earn on busy weekends.' },

    { id: id('e-d2'), type: 'divider' },
    { id: id('e-h8'), type: 'heading', text: 'The 3 biggest mistakes new riders make' },
    { id: id('e-cl1'), type: 'checklist', title: 'Avoid these — they cost you ~30% of potential earnings', items: [
      'Riding around looking for orders instead of parking near demand',
      'Skipping orders for the "perfect" one — the engine drops you in priority',
      'Going offline at exactly the start of a surge (it almost always extends)',
    ] },

    { id: id('e-d3'), type: 'divider' },
    { id: id('e-q1'), type: 'quiz', question: 'A surge bonus of 1.5× has just kicked in your area. You\'re a Silver-tier rider. You finish your current delivery — what\'s the next best move?',
      options: [
        'Log off and rest, surges burn you out',
        'Ride to a totally different area in case the surge spreads',
        'Park inside or near the surge zone and wait for the next order',
        'Decline the next order in the hope of a longer one',
      ],
      correct: 2,
      explanation: 'Park in/near the surge zone. Riding away is unpaid fuel + time; declining drops your dispatch priority. The next order will find you in 2–3 minutes during a genuine surge, and it\'ll pay 1.5× the usual.' },
  ],
};

// ─────────────────────── 6. Handling COD orders ─────────────────────────────
const COD: TrainingDefault = {
  slug: 'handling-cod-orders',
  title: 'Handling cash-on-delivery orders',
  summary: 'Collecting cash, giving change, depositing daily, and avoiding the most common mistakes.',
  category: 'APP_GUIDE',
  durationMin: 10,
  order: 6,
  isRequired: false,
  heroImageUrl: img('1601581875309-fafbf2d3ed3a'),
  contentBlocks: [
    { id: id('c-h1'), type: 'heading', text: 'COD — the basics' },
    { id: id('c-p1'), type: 'paragraph', text: 'About 1 in 4 Flavrly orders is Cash on Delivery — the customer pays you in cash at the door instead of online. Your job: collect the exact amount, hand over the food, and deposit the day\'s COD takings back to Flavrly within 24 hours. It sounds simple — and it is — but a few small habits avoid 95% of all COD-related disputes.' },

    { id: id('c-h2'), type: 'heading', text: 'Before you ring the doorbell' },
    { id: id('c-cl1'), type: 'checklist', title: 'The 4-second pre-handover check', items: [
      'The active-order screen shows the EXACT amount in big text',
      'You have enough change to break a ₹500 note',
      'Your wallet / pouch is somewhere you can reach with one hand',
    ] },
    { id: id('c-cta1'), type: 'callout', tone: 'tip', title: 'Start your day with ₹500 change',
      body: 'Five ₹100 notes is the sweet spot. About 1 in 8 COD customers hand you a ₹500 expecting change. If you can\'t break it, you waste 5 minutes finding change at a nearby shop — and your rating takes a small hit.' },

    { id: id('c-h3'), type: 'heading', text: 'At handover' },
    { id: id('c-p2'), type: 'paragraph', text: 'Confirm the OTP first, then state the COD amount: "₹482 please." Take the money, count it openly in front of the customer, give exact change. Then tap "Cash collected" in the app. The app marks the order CASH_COLLECTED and credits Flavrly your COD balance.' },

    { id: id('c-h4'), type: 'heading', text: 'Depositing your COD float' },
    { id: id('c-p3'), type: 'paragraph', text: 'At the end of every day, your Earnings tab shows two numbers: your wallet (what Flavrly owes you) and your COD balance (what you owe Flavrly). Deposit your COD balance by either UPI to the Flavrly merchant ID shown in the app, OR cash at the nearest collection point (also in the app).' },
    { id: id('c-cta2'), type: 'callout', tone: 'warning', title: 'Don\'t let COD pile up',
      body: 'You have 24 hours to deposit. After 24h, the unpaid COD is auto-deducted from your wallet — and if your wallet doesn\'t cover it, your account is suspended until you reconcile. Deposit daily. Set a 9 PM reminder.' },

    { id: id('c-h5'), type: 'heading', text: 'The 3 disputes we see most' },
    { id: id('c-p4'), type: 'paragraph', text: 'Customer says they paid online but the app shows COD: trust the app. The app is the source of truth — if it says COD, you collect cash. If the customer insists they\'ve paid, ask them to refresh their order page; 99% of the time it shows the correct status.' },
    { id: id('c-p5'), type: 'paragraph', text: 'Customer pays the wrong amount: politely count, ask for the missing rupees. If they refuse, tap "Cash short" in the app — Flavrly support takes over and you\'re not held liable for the shortfall.' },
    { id: id('c-p6'), type: 'paragraph', text: 'Customer hands you a fake note: rare, but it happens. Tap "Cash short" + "Counterfeit suspected." Ops will reverse the order amount and there\'s no charge to you. NEVER argue or threaten the customer — your safety first.' },

    { id: id('c-d1'), type: 'divider' },
    { id: id('c-q1'), type: 'quiz', question: 'A customer hands you ₹500 for a ₹420 COD order. You don\'t have ₹80 change. What\'s the right move?',
      options: [
        'Tell them keep the food until you find change',
        'Take the ₹500 and "owe" them ₹80',
        'Politely ask if they can find ₹420 exact, then run to the nearest shop for change',
        'Refuse the order',
      ],
      correct: 2,
      explanation: 'Start a polite ask: "I\'m sorry — do you have exact change?" If not, hand them the food, tell them you\'ll be back in 5 minutes with the change. Owing the customer is the worst option — they\'ll rate 1-star and it counts as a dispute against you.' },
  ],
};

export const DEFAULT_TRAINING_CONTENT: TrainingDefault[] = [
  WELCOME,
  DELIVERY,
  SAFETY,
  SERVICE,
  EARNINGS,
  COD,
];

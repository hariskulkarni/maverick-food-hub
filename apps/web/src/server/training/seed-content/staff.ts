/**
 * Starter training library: restaurant staff (KITCHEN + RESTAURANT_ADMIN).
 *
 * App-specific lessons describe Flavrly screens as they exist in code
 * (kitchen board, /admin/menu, /admin/combos, /admin/reviews,
 * /admin/feedback, /admin/reports, admin dashboard). Food-safety content is
 * deliberately general good practice; it cites no legal sections or figures.
 */
import type { SeedModule } from '../types';

export const STAFF_MODULES: SeedModule[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // KITCHEN
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'kitchen-fssai-hygiene-basics',
    title: 'FSSAI hygiene basics',
    summary:
      'Personal hygiene, handwashing, clean-as-you-go, safe temperatures, cross-contamination, pest control and cleaning schedules for every Flavrly kitchen.',
    category: 'HYGIENE',
    audience: 'KITCHEN',
    isRequired: true,
    durationMin: 15,
    order: 110,
    passMarkPct: 80,
    maxAttempts: null,
    retakeCooldownMin: 5,
    dueDays: 14,
    lessons: [
      {
        kind: 'TEXT',
        title: 'Why hygiene matters on Flavrly',
        body: `## Food safety is part of every order

Every restaurant on Flavrly is a food business. In India, food businesses work under the **Food Safety and Standards Act** and the rules set by **FSSAI** (Food Safety and Standards Authority of India). Your restaurant's licence or registration depends on following safe hygiene practices every day.

A customer cannot see your kitchen. They trust that the food in the bag was made safely. One careless moment can make someone ill and damage your restaurant's name.

### What this module covers

- Personal hygiene and handwashing
- Cleaning as you go
- Keeping food at safe temperatures
- Stopping cross-contamination
- Keeping pests out
- Following a cleaning schedule

Your manager and your restaurant's food safety supervisor are your first point of contact for local rules. When in doubt, ask them.`
      },
      {
        kind: 'TEXT',
        title: 'Personal hygiene and handwashing',
        body: `## Start clean, stay clean

### Before your shift

- Wear a clean uniform or apron. Keep outdoor clothes out of the cooking area.
- Cover your hair with a cap or hairnet. Tie back long hair.
- Keep nails short and clean. No nail polish or false nails.
- Remove rings, bangles and watches. Food and germs collect under them.
- If you have fever, vomiting, loose motions or an infected cut, **tell your manager before you start**. Do not handle food.

### How to wash your hands

1. Wet your hands with clean running water.
2. Apply soap.
3. Rub palms, backs of hands, between fingers, thumbs and under nails for at least 20 seconds.
4. Rinse well under running water.
5. Dry with a clean single-use towel or a hand dryer.

### When to wash

- Before starting work and after every break
- After using the toilet
- After touching raw meat, fish, poultry or eggs
- After handling waste or cleaning chemicals
- After touching your face, hair, phone or money
- Between handling raw food and ready-to-eat food

Gloves do not replace handwashing. Wash before you put gloves on, and change gloves whenever you would wash your hands.`
      },
      {
        kind: 'TEXT',
        title: 'Safe temperatures and cross-contamination',
        body: `## Keep hot food hot and cold food cold

Germs grow fastest when food sits at room temperature. This warm middle range is often called the **temperature danger zone**. The goal is simple: keep food out of it as much as possible.

- Store chilled items in the fridge. As general good practice, keep the fridge at or below 5°C.
- Keep cooked food that is waiting to be served hot, not lukewarm.
- Cool leftovers quickly in shallow containers, then refrigerate. Do not leave them on the counter to cool for hours.
- Thaw frozen items in the fridge, not on the counter.
- Reheat food until it is steaming hot all the way through.
- If you are not sure how long food has been sitting out, tell your manager. *When in doubt, throw it out.*

## Stop cross-contamination

Cross-contamination is when germs or allergens move from one food or surface to another.

- Use separate boards and knives for raw meat, fish and vegetables. Follow your kitchen's colour code if you have one.
- Store raw meat and fish on the **lowest** shelf of the fridge, covered, so juices cannot drip onto other food.
- Keep ready-to-eat food away from raw food.
- Clean and sanitise boards, knives and counters after raw food, before you use them again.
- Use clean spoons for tasting. Never put a used spoon back in the pot.`
      },
      {
        kind: 'TEXT',
        title: 'Pest control',
        body: `## Keep pests out

Rats, cockroaches, flies and lizards spread disease. A single sighting can shut a kitchen.

- Keep doors and windows closed or screened.
- Store dry goods in sealed containers, off the floor.
- Clean spills straight away. Do not leave food out overnight.
- Empty bins regularly and keep lids closed.
- Check deliveries for signs of pests before you store them.

### If you see signs of pests

Droppings, gnaw marks, dead insects or a strange smell are all warning signs.

1. Do not ignore it and do not try to hide it.
2. Tell your manager immediately.
3. Move any food that may be affected away from use until your manager decides what to do.

Only trained pest control staff should apply pest control chemicals. Never spray chemicals near open food.`
      },
      {
        kind: 'CHECKLIST',
        title: 'Clean-as-you-go and daily cleaning',
        body: `Clean as you go during service, and follow your kitchen's cleaning schedule so nothing is missed. Use this checklist on every shift.`,
        checklistItems: [
          'Wash hands before starting and after every break',
          'Hair covered, nails short, no jewellery on hands',
          'Fridge running cold; chilled items stored inside, raw meat on the lowest shelf',
          'Separate boards and knives ready for raw and cooked food',
          'Wipe and sanitise counters after each task, not just at the end of the shift',
          'Clean spills on the floor immediately',
          'Bins emptied and lids closed',
          'Dry goods sealed and stored off the floor',
          'Cleaning chemicals stored away from food, in labelled containers',
          'Today\'s tasks on the cleaning schedule signed off'
        ]
      }
    ],
    questions: [
      {
        prompt: 'You wake up with loose motions before a shift. What should you do?',
        options: [
          'Come in and wear gloves',
          'Tell your manager before starting and do not handle food',
          'Work only on packaging',
          'Take medicine and work as normal'
        ],
        correctIndex: 1,
        explanation: 'Staff with stomach illness can spread germs to food. Tell your manager first and stay away from food handling.'
      },
      {
        prompt: 'Where should raw chicken be stored in the fridge?',
        options: [
          'Top shelf, so it is easy to reach',
          'Next to cooked curries',
          'Door shelf',
          'Lowest shelf, covered'
        ],
        correctIndex: 3,
        explanation: 'Storing raw meat covered on the lowest shelf stops juices dripping onto other food.'
      },
      {
        prompt: 'Which statement about the temperature danger zone is correct?',
        options: [
          'Keep hot food hot and cold food cold, and limit time at room temperature',
          'Food is safe at room temperature for a full day',
          'Thawing on the counter is the safest method',
          'Leftovers should cool on the counter overnight'
        ],
        correctIndex: 0,
        explanation: 'Germs grow fastest at room temperature. Keep food hot or cold and cool leftovers quickly.'
      },
      {
        prompt: 'You notice droppings near the rice sacks. What is the right first step?',
        options: [
          'Sweep them up and say nothing',
          'Spray insecticide on the sacks',
          'Tell your manager immediately and keep that stock out of use',
          'Move the sacks to another corner'
        ],
        correctIndex: 2,
        explanation: 'Pest signs must be reported straight away so the manager can act and affected food is not used.'
      },
      {
        prompt: 'Do gloves replace handwashing?',
        options: [
          'Yes, gloves are always enough',
          'Yes, if the gloves are new',
          'Only for vegetarian food',
          'No. Wash hands first and change gloves when you would wash hands'
        ],
        correctIndex: 3,
        explanation: 'Gloves pick up germs too. Wash before wearing them and change them as often as you would wash your hands.'
      }
    ]
  },

  {
    slug: 'kitchen-allergen-handling',
    title: 'Allergen handling',
    summary:
      'Know the common allergens, read customer notes on the Flavrly kitchen board and KOT, keep allergen-free food separate, and never guess.',
    category: 'HYGIENE',
    audience: 'KITCHEN',
    isRequired: true,
    durationMin: 12,
    order: 120,
    passMarkPct: 80,
    maxAttempts: null,
    retakeCooldownMin: 5,
    dueDays: 14,
    lessons: [
      {
        kind: 'TEXT',
        title: 'What an allergen is',
        body: `## Small amounts, serious reactions

A food allergy is when a person's body reacts badly to a normal food. For some people even a tiny amount, like a few crumbs or a used spoon, can cause a serious reaction that needs urgent medical help.

You cannot cook an allergen away. Heat does not make peanuts or prawns safe for someone who is allergic.

### Common allergens

- Peanuts (groundnuts)
- Tree nuts such as cashew, almond, pistachio and walnut
- Milk and dairy, including paneer, ghee, butter, cream and curd
- Egg
- Gluten and wheat, including atta, maida and suji
- Soy
- Fish
- Shellfish such as prawns, crab and lobster
- Sesame (til)

### Hidden allergens in Indian cooking

Many allergens hide inside gravies, marinades and garnishes. Cashew paste in a korma. Ghee in a dal tadka. Peanuts in a poha. Sesame in a chutney. Wheat in a batter. Know what goes into every dish you make.`
      },
      {
        kind: 'TEXT',
        title: 'Reading customer notes on Flavrly',
        body: `## Where allergy requests appear

Customers can add notes to their order. On your Flavrly kitchen board, the order's customer note appears on the order card as a highlighted warning line, just below the list of items. You cannot miss it if you read the whole card.

When you print the KOT from the card, the printed ticket also shows the customer's notes at the bottom, and any note attached to a single item is printed under that item.

### Make it a habit

1. Read every line of the card before you start, including the highlighted note.
2. If the note mentions an allergy, such as "no peanuts" or "nut allergy", tell everyone working on that order.
3. Keep the printed KOT with the order while you cook and pack it.

### What the menu shows customers

In your Flavrly menu, each item has a **Vegetarian** marker and a **Spicy level**. There is no separate allergen field. Restaurants describe ingredients in the item **Description**, and the editor prompts them with "What's in it? Any allergens?". Vegetarian does not mean allergen-free. A veg dish can still contain milk, nuts, wheat or sesame.`
      },
      {
        kind: 'TEXT',
        title: 'Keeping allergen-free food separate',
        body: `## Prepare it as if it were the only order

When an order has an allergy note:

- Wash your hands and put on fresh gloves.
- Use clean boards, knives, pans and ladles. Do not reuse a spoon that touched another dish.
- Prepare the dish first or in a separate, cleaned area if you can.
- Do not use shared fryer oil if it has been used for items with the allergen.
- Leave off garnishes that contain the allergen, such as cashews, sesame or cream.
- Pack the dish separately and seal it.

### Labelling

- Label the allergy-safe container clearly, for example with the customer's note written on the lid or a sticker.
- Keep it apart from other containers in the bag so it is not confused with another dish.
- Store ingredients in labelled containers in the kitchen so nobody mistakes cashew paste for onion paste.`
      },
      {
        kind: 'TEXT',
        title: 'If you are not sure, do not guess',
        body: `## Never guess about an allergen

If you do not know whether a dish contains an allergen, **do not guess and do not say "it should be fine"**.

1. Stop and tell your manager.
2. Check the recipe and the labels on ready-made ingredients like sauces, masalas and breads.
3. If you still cannot be sure the dish is safe, your manager should contact the customer before the food is sent, so they can choose something else.

It is always better to delay or change an order than to send something that could harm someone.

### If a customer reports a reaction

Tell your manager immediately. Your manager will handle the customer and contact Flavrly Support. Keep the KOT and any remaining ingredients aside so the team can check what happened.`
      },
      {
        kind: 'CHECKLIST',
        title: 'Allergy order checklist',
        body: `Run through this every time an order card or KOT mentions an allergy.`,
        checklistItems: [
          'Read the highlighted customer note on the order card',
          'Told everyone working on the order about the allergy',
          'Washed hands and changed gloves',
          'Used clean boards, knives, pans and spoons',
          'Checked the recipe and ingredient labels for hidden allergens',
          'Left off allergen garnishes',
          'Packed and labelled the dish separately',
          'Asked the manager if anything was unclear'
        ]
      }
    ],
    questions: [
      {
        prompt: 'An order card shows a highlighted note: "Nut allergy". The dish normally has cashew paste. What do you do?',
        options: [
          'Make it as usual; a little cashew is fine',
          'Pick out the visible cashews before packing',
          'Tell your manager, because the dish cannot be made safely without changing it, and the customer may need to be contacted',
          'Add extra cream to hide the taste'
        ],
        correctIndex: 2,
        explanation: 'Cashew paste is in the gravy itself. Do not guess; the manager should decide and contact the customer if needed.'
      },
      {
        prompt: 'Where do customer notes appear on the Flavrly kitchen board?',
        options: [
          'As a highlighted warning line on the order card, below the items',
          'Only in the admin reports',
          'They are never shown to the kitchen',
          'Only after the order is marked ready'
        ],
        correctIndex: 0,
        explanation: 'The kitchen board shows the order\'s customer note on the card, and the printed KOT shows it too.'
      },
      {
        prompt: 'A dish is marked Vegetarian on the menu. Does that mean it is free of allergens?',
        options: [
          'Yes, veg dishes have no allergens',
          'Yes, unless it is spicy',
          'Only if it is a combo',
          'No. Veg dishes can still contain milk, nuts, wheat or sesame'
        ],
        correctIndex: 3,
        explanation: 'Vegetarian only describes meat and fish. Many veg dishes contain common allergens.'
      },
      {
        prompt: 'Which of these is a common hidden allergen in Indian cooking?',
        options: [
          'Plain boiled water',
          'Ghee in a dal tadka',
          'Fresh coriander',
          'Salt'
        ],
        correctIndex: 1,
        explanation: 'Ghee is a dairy product, so it is a milk allergen.'
      },
      {
        prompt: 'Can cooking at high heat make peanuts safe for someone with a peanut allergy?',
        options: [
          'Yes, frying removes the allergen',
          'Yes, if cooked for more than ten minutes',
          'No. Heat does not remove allergens',
          'Only in a pressure cooker'
        ],
        correctIndex: 2,
        explanation: 'Allergens are not destroyed by cooking. The only safe approach is keeping them out of the dish.'
      }
    ]
  },

  {
    slug: 'kitchen-order-prep-packaging',
    title: 'Order prep and packaging for delivery',
    summary:
      'Check every item against the ticket, seal and spill-proof the bag, keep hot and cold apart, and mark orders ready on time so Flavrly riders do not wait.',
    category: 'KITCHEN_OPS',
    audience: 'KITCHEN',
    isRequired: true,
    durationMin: 12,
    order: 130,
    passMarkPct: 80,
    maxAttempts: null,
    retakeCooldownMin: 5,
    dueDays: 14,
    lessons: [
      {
        kind: 'TEXT',
        title: 'Check against the ticket',
        body: `## The ticket is the source of truth

Missing items and wrong items are the most common delivery complaints. Most of them are caught by one simple habit: check the bag against the ticket before it leaves.

- Count every line on the order card or printed KOT. "2x Veg Biryani" means two.
- For combos, the kitchen board lists each item inside the combo under the combo name. Pack every one.
- If the card shows a **Free** item, pack the free item too. The customer expects it.
- Read the customer note and follow it, for example "less spicy" or "no onion".
- Add the cutlery, sauces and sides that come with the dish.

### If something is missing

If an item has run out, do not quietly send the order without it. Tell your manager straight away so they can decide what to do and update the customer.`
      },
      {
        kind: 'TEXT',
        title: 'Sealing and spill-proofing',
        body: `## The food has to survive the ride

A rider on a two-wheeler goes over speed breakers, potholes and turns. Pack for that.

- Use containers with tight lids that suit the food. Gravies and dals need leak-proof containers.
- Do not overfill. Leave a little space below the lid.
- Seal liquid containers with tape, cling film or a sealing machine if your kitchen has one.
- Pack gravies, raitas and drinks upright.
- Put heavy items at the bottom and light items like breads and salads on top.
- Close the bag securely, using a tamper-evident seal or sticker if your restaurant uses one.

### Keep crisp food crisp

Keep fried and crisp items, like pakoras, dosas and fries, in vented or separate containers so steam does not make them soggy. Pack chutneys and gravies separately instead of pouring them on top.`
      },
      {
        kind: 'TEXT',
        title: 'Hot and cold separation',
        body: `## Keep hot food hot and cold food cold

- Pack hot dishes together and cold items, like desserts, cold drinks, salads and raita, separately.
- Use a separate bag or a divider for cold items when you can.
- Never put ice cream or a cold drink next to a hot biryani.
- Pack hot food last, just before handover, so it does not sit and cool.

Packing hot and cold together spoils both and is a common cause of "cold food" complaints in your restaurant's customer feedback.`
      },
      {
        kind: 'TEXT',
        title: 'Mark ready on time',
        body: `## Do not make the rider wait

On your Flavrly kitchen board, press **Mark ready** only when the order is fully packed, sealed and at the handover point.

For delivery orders, marking an order ready is what tells Flavrly to send it to available riders. So:

- Do not mark ready too early. A rider who arrives to find the food not packed is stuck waiting, and the food that is ready gets cold.
- Do not mark ready too late. If the bag is packed and sitting on the counter but not marked ready, the rider is not called and the customer waits longer.

For pickup orders, the card shows a pickup **Code**. The customer collects the order at your counter, so no rider is sent. When you hand it over, press **Mark collected** to complete the order. For dine-in orders, press **Mark served — complete** once the food is at the table.

Keep ready orders in one clear handover spot so riders and staff can find them quickly.`
      },
      {
        kind: 'CHECKLIST',
        title: 'Before you hand over the bag',
        body: `Run through this checklist for every delivery order.`,
        checklistItems: [
          'Every line on the ticket packed, with the right quantity',
          'Combo items and any free item packed',
          'Customer note followed',
          'Lids tight, liquids sealed and upright',
          'Crisp items vented or packed separately',
          'Hot and cold items kept apart',
          'Cutlery, sauces and sides added',
          'Bag closed and sealed',
          'Order marked ready on the kitchen board only when fully packed'
        ]
      }
    ],
    questions: [
      {
        prompt: 'When should you press Mark ready for a delivery order?',
        options: [
          'As soon as cooking starts',
          'When the order is fully packed, sealed and at the handover point',
          'After the rider arrives',
          'At the end of the shift for all orders together'
        ],
        correctIndex: 1,
        explanation: 'For delivery orders, Mark ready is what sends the order to riders, so the food should be packed and waiting.'
      },
      {
        prompt: 'An order has a hot biryani and a cold kulfi. How should you pack them?',
        options: [
          'In the same container to save space',
          'Kulfi on top of the biryani',
          'Biryani wrapped around the kulfi',
          'Separately, with the cold item kept apart from the hot food'
        ],
        correctIndex: 3,
        explanation: 'Keeping hot and cold apart protects both and avoids cold food complaints.'
      },
      {
        prompt: 'A combo shows three items listed under the combo name on the board. What do you pack?',
        options: [
          'All three items, in the quantities shown',
          'Only the combo name item',
          'Any one of the three',
          'Whatever is ready first'
        ],
        correctIndex: 0,
        explanation: 'The board lists each item inside the combo so the kitchen packs every one of them.'
      },
      {
        prompt: 'One item on the ticket has run out. What should you do?',
        options: [
          'Send the order without it and say nothing',
          'Swap it for something similar without asking',
          'Tell your manager straight away',
          'Cancel the whole order yourself'
        ],
        correctIndex: 2,
        explanation: 'Your manager decides how to handle a missing item and updates the customer.'
      },
      {
        prompt: 'What is the best way to stop a dal from leaking during delivery?',
        options: [
          'Fill the container to the very top',
          'Pack it lying on its side',
          'Put it under heavy items',
          'Use a leak-proof container, do not overfill, seal it and keep it upright'
        ],
        correctIndex: 3,
        explanation: 'A tight, sealed, upright container with a little headroom is the most spill-proof.'
      }
    ]
  },

  {
    slug: 'kitchen-kot-workflow',
    title: 'Using the Flavrly kitchen board',
    summary:
      'How the Flavrly kitchen board works: the New, Accepted, Preparing and Ready columns, the buttons that move orders, new-order alerts, overdue warnings and KOT printing.',
    category: 'KITCHEN_OPS',
    audience: 'KITCHEN',
    isRequired: true,
    durationMin: 12,
    order: 140,
    passMarkPct: 80,
    maxAttempts: null,
    retakeCooldownMin: 5,
    dueDays: 14,
    lessons: [
      {
        kind: 'TEXT',
        title: 'The four columns',
        body: `## How the board is laid out

Your Flavrly kitchen board shows every active order in four columns. Each column header shows how many orders are in it.

1. **New** - the customer has just placed the order. It needs to be accepted.
2. **Accepted** - the order is accepted but cooking has not started.
3. **Preparing** - the order is being cooked and packed.
4. **Ready** - the order is packed and waiting to be handed over.

Once an order moves past Ready it leaves the board: a delivery order when the rider picks it up, a pickup order when you press **Mark collected**, and a dine-in order when you press **Mark served — complete**.

### What is on each card

- The order code and the customer's name
- Minutes since the order was placed (or accepted)
- Whether it is Delivery, Pickup or Dine-in
- A **Scheduled** time if the customer ordered for later
- A pickup **Code** for pickup orders
- A **Free** item if the order includes one
- Each item with its quantity, and the items inside any combo
- The customer's note, shown as a highlighted warning line

If your account runs more than one restaurant, filter tabs at the top let you see **All** orders or one restaurant at a time, and each card shows the restaurant's name.`
      },
      {
        kind: 'TEXT',
        title: 'Moving an order along',
        body: `## One button per step

Each card shows one button to move the order to the next column:

1. In **New**, press **Accept order**. The order moves to Accepted.
2. In **Accepted**, press **Start preparing** when cooking begins. The order moves to Preparing.
3. In **Preparing**, press **Mark ready** when the order is fully packed. The order moves to Ready.
4. In **Ready**, pickup and dine-in orders have one more button. Press **Mark collected** when the customer collects a pickup order, or **Mark served — complete** when a dine-in order is served. The order is then complete. Delivery orders have no button here; the rider completes them at handover.

Orders can only move forward one step at a time. You cannot skip from New straight to Ready.

### Things to know

- If your restaurant has auto-accept switched on, new orders may skip New and appear straight in **Accepted**.
- Your restaurant admin can also accept orders from the admin orders page. Both update the same order, so the board stays in step.
- For delivery orders, **Mark ready** is what sends the order out to Flavrly riders. Press it only when the bag is packed.
- There is no reject or cancel button on the kitchen board. If you cannot make an order, tell your manager straight away.`
      },
      {
        kind: 'TEXT',
        title: 'New-order alerts and staying live',
        body: `## The chime and the banner

When a new order arrives, the board:

- Shows a large **New order - needs attention** banner at the top with the number of waiting orders
- Plays a repeating chime every few seconds
- Shows a pop-up message, and a browser notification if you allowed notifications

The chime keeps playing until someone presses **ACKNOWLEDGE** on the banner. Acknowledging stops the alert. It does not accept the order, so you still need to press **Accept order** on the card.

Use the **Sound on / Sound off** button to control the chime. Keep the sound on during service.

## Is the board live?

A small badge at the top shows **Live** when the board is up to date. If it changes to **Synced ... ago**, the connection may be delayed. Press **Refresh** to pull the latest orders. The board also refreshes by itself every few seconds and whenever you come back to the tab.

Keep the board open on a screen in the kitchen, with the tab visible, during service.`
      },
      {
        kind: 'TEXT',
        title: 'Overdue warnings and printing the KOT',
        body: `## Red cards need attention

A card turns red with a warning sign when it is overdue:

- A **New** order turns red after about 5 minutes without being accepted. The customer is waiting with no confirmation.
- An **Accepted** or **Preparing** order turns red after about 25 minutes.

Deal with red cards first, and tell your manager if you are falling behind.

## Printing the KOT

Each card has a **KOT** button. It opens a printable kitchen order ticket in a new tab and starts printing straight away. The KOT shows:

- Your branch name, the order code and the time it was placed
- Each item with its quantity, and any note on a single item
- The customer's notes at the bottom

Keep the printed KOT with the order while you cook and pack so nothing is missed.`
      },
      {
        kind: 'CHECKLIST',
        title: 'Kitchen board shift checklist',
        body: `Set up the board at the start of every shift and keep it running.`,
        checklistItems: [
          'Kitchen board open on a screen the whole team can see',
          'Sound is on',
          'Status badge shows Live (press Refresh if not)',
          'Acknowledge the banner and accept new orders quickly',
          'Press Start preparing when cooking begins',
          'Print the KOT and read the customer note on every order',
          'Press Mark ready only when the order is packed',
          'Check for red overdue cards and deal with them first'
        ]
      }
    ],
    questions: [
      {
        prompt: 'What are the four columns on the Flavrly kitchen board, in order?',
        options: [
          'New, Accepted, Preparing, Ready',
          'Open, Cooking, Done, Delivered',
          'Pending, Kitchen, Packed, Picked up',
          'Received, Cooking, Dispatched, Closed'
        ],
        correctIndex: 0,
        explanation: 'Orders move through New, Accepted, Preparing and Ready.'
      },
      {
        prompt: 'You press ACKNOWLEDGE on the new-order banner. What happens?',
        options: [
          'The order is accepted',
          'The order is cancelled',
          'The alert stops, but you still need to press Accept order on the card',
          'The order moves to Ready'
        ],
        correctIndex: 2,
        explanation: 'Acknowledge only silences the alert. Accepting is a separate button on the card.'
      },
      {
        prompt: 'Which button moves an order from Accepted to Preparing?',
        options: [
          'Accept order',
          'Mark ready',
          'KOT',
          'Start preparing'
        ],
        correctIndex: 3,
        explanation: 'In the Accepted column, the card shows Start preparing.'
      },
      {
        prompt: 'The status badge says "Synced 45s ago" instead of "Live". What should you do?',
        options: [
          'Ignore it',
          'Press Refresh to pull the latest orders',
          'Close the board for the rest of the shift',
          'Turn the sound off'
        ],
        correctIndex: 1,
        explanation: 'The badge warns that real-time updates may be delayed. Refresh pulls the latest order list.'
      },
      {
        prompt: 'A card in the New column has turned red. What does that mean?',
        options: [
          'The customer cancelled',
          'The order is paid',
          'The order is a combo',
          'It has waited too long without being accepted'
        ],
        correctIndex: 3,
        explanation: 'New orders turn red after about 5 minutes without being accepted.'
      }
    ]
  },

  // ─────────────────────────────────────────────────────────────────────────
  // RESTAURANT_ADMIN
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'admin-menu-management',
    title: 'Managing your menu',
    summary:
      'Add and edit items and categories, set prices and availability, upload photos, add sizes and add-ons, build combos and bulk import your menu in your Flavrly admin.',
    category: 'RESTAURANT_OPS',
    audience: 'RESTAURANT_ADMIN',
    isRequired: true,
    durationMin: 15,
    order: 210,
    passMarkPct: 80,
    maxAttempts: null,
    retakeCooldownMin: 5,
    dueDays: 14,
    lessons: [
      {
        kind: 'TEXT',
        title: 'Categories',
        body: `## Organise your menu

Open **Menu** in your Flavrly admin. The page has two tabs: **Items** and **Categories**. Each tab shows a count.

### Add a category

On the **Categories** tab, type a name in **New category name** and press **Add**. Examples: Starters, Biryani, Breads, Desserts, Beverages.

### Turn a category on or off

Each category has a switch. Use the **More actions** menu for two bulk options:

- **Disable category + all items** - hides the category and everything in it
- **Enable category + all items** - brings them all back

### Category schedules

Press **Set schedule** to choose the days and time windows when a category is offered, for example breakfast items only in the morning. Use **Add window** for each time slot and **Copy to all 7 days** to repeat it. The category badge shows whether it is **Available now**, in **Off-hours**, **Always on** or **Disabled**.

You cannot delete a category that still has items in it. Move or delete the items first.`
      },
      {
        kind: 'TEXT',
        title: 'Items, prices and photos',
        body: `## Add or edit an item

On the **Items** tab, press **New item**, or press the pencil icon on an existing item to edit it. The item form has:

- **Photo** - upload a clear, well-lit photo of the actual dish
- **Name**
- **Description** - say what is in it. The form prompts you with "What's in it? Any allergens?"
- **Price (₹)**
- **Prep time (min)**
- **Category**
- **Spicy level** - Mild or one to three chillies
- Switches for **Vegetarian**, **Available**, **Popular** and **Recommended**

Press **Create item** for a new item or **Save changes** for an edit.

### Sizes and add-ons

After an item is saved, open it again to see more sections:

- **Sizes / variants** - for example Half and Full, each with its own price. With no variants, the item uses its base price.
- **Add-on groups** - for example "Add-ons" with options like "Extra cheese" and a **+ Price (₹)**. Set a **Min** and **Max** for how many options a customer can pick.
- **Availability schedule** - override branch hours for this one item.

### Good practice

- Write descriptions that list key ingredients and allergens. There is no separate allergen field, so the description is where customers look.
- Check the Vegetarian switch carefully on every item.
- Keep prices and photos accurate to what you actually serve.`
      },
      {
        kind: 'TEXT',
        title: 'Availability and bulk actions',
        body: `## Sold out? Hide it

Each item row has a switch showing **Available** or **Hidden**. Flip it to **Hidden** when you run out, so customers cannot order something you cannot make. Flip it back when it is in stock.

Do this as soon as an item runs out. Hiding an item is much better than accepting an order and then calling the customer to say it is not available.

### Bulk actions

Tick items to select them, or use **Select all**. Then use:

- **Make available** / **Make hidden**
- **Mark popular** / **Unmark popular**
- **Mark recommended** / **Unmark recommended**
- **Delete selected**

### Deleting items

The trash icon deletes an item. Deleting cannot be undone. If an item cannot be deleted, Flavrly offers to hide it from the storefront instead. When you only want to stop selling an item for a while, hide it rather than delete it.`
      },
      {
        kind: 'TEXT',
        title: 'Combos',
        body: `## Bundle items into a combo

Open **Combos** in your Flavrly admin. A combo groups two or more menu items into a single bundle with its own price, image and availability switch.

Press **New combo** and fill in:

- **Name** and **Slug** (the short web name)
- **Description**, for example "2 mains + 1 starter + 1 dessert, serves 4."
- **Price** and **Sort order**
- **Available**
- **Image**
- **Items (pick at least 2)**, with a **Qty** for each

Press **Save**. The Combos page also shows totals such as **Total combos**, **Active** and **Avg combo price**, and lets you search combos or the items inside them.

On the kitchen board, combos appear with each item inside listed underneath, so the kitchen knows exactly what to pack. If an item inside a combo runs out, remember to hide the combo too.`
      },
      {
        kind: 'TEXT',
        title: 'Bulk import and export',
        body: `## Load a whole menu at once

At the top of the Menu page, the **Bulk import & export** panel lets you work in a spreadsheet.

- **Blank template** - an empty spreadsheet with the right columns
- **Indian catalog template** - a pre-filled starting point of common Indian dishes
- **Export current menu** - download your live menu to edit or keep as a backup

The columns are: Category, Item Name, Description, Price, Veg, Spicy Level, Prep Time (min) and Available.

### How to import

1. Fill in the spreadsheet. You can upload a CSV or Excel (.xlsx) file.
2. Choose the file and press **Preview import**.
3. Check the summary of **new** items, **updates** and **errors**, and the row-by-row table.
4. If there are errors, fix those rows in your file and preview again.
5. Press **Confirm & apply** to save.

Items are matched by category name and item name. A matching item is updated; a new one is created, and missing categories are created for you. Import only covers basic item details. Add photos, sizes and add-ons afterwards in the item editor.`
      }
    ],
    questions: [
      {
        prompt: 'Your paneer tikka has run out mid-service. What is the best action in your Flavrly admin?',
        options: [
          'Delete the item',
          'Change its price to zero',
          'Switch the item to Hidden, and switch it back when it is in stock',
          'Leave it and call customers who order it'
        ],
        correctIndex: 2,
        explanation: 'The availability switch hides the item temporarily without losing its details.'
      },
      {
        prompt: 'Where do you add Half and Full portions with different prices?',
        options: [
          'Sizes / variants, in the item editor after the item is saved',
          'As two separate categories',
          'In the combo editor',
          'In the Reports page'
        ],
        correctIndex: 0,
        explanation: 'Sizes / variants let one item have several sizes, each with its own price.'
      },
      {
        prompt: 'What does the menu import NOT set up for you?',
        options: [
          'Item prices',
          'Categories',
          'Veg markers',
          'Photos, sizes and add-ons'
        ],
        correctIndex: 3,
        explanation: 'Import covers basic item fields. Photos, variants and add-ons are added in the item editor.'
      },
      {
        prompt: 'How many menu items must a combo contain at minimum?',
        options: [
          'One',
          'Two',
          'Three',
          'Five'
        ],
        correctIndex: 1,
        explanation: 'The combo editor asks you to pick at least 2 menu items.'
      },
      {
        prompt: 'Where should you tell customers that a dish contains nuts or dairy?',
        options: [
          'In the item name only',
          'Nowhere; customers should ask',
          'In the item Description, since there is no separate allergen field',
          'In the Sort order'
        ],
        correctIndex: 2,
        explanation: 'The Description field is where ingredients and allergens are shown; the form prompts "What\'s in it? Any allergens?".'
      }
    ]
  },

  {
    slug: 'admin-reviews-complaints',
    title: 'Handling reviews and complaints',
    summary:
      'Reply to customer feedback and Google reviews from your Flavrly admin, use AI drafts and auto-reply safely, and handle complaints with care.',
    category: 'RESTAURANT_OPS',
    audience: 'RESTAURANT_ADMIN',
    isRequired: true,
    durationMin: 14,
    order: 220,
    passMarkPct: 80,
    maxAttempts: null,
    retakeCooldownMin: 5,
    dueDays: 14,
    lessons: [
      {
        kind: 'TEXT',
        title: 'How to reply well',
        body: `## Four steps for every complaint

Every reply is read by the customer and by everyone who reads your reviews later. A calm, helpful reply can win back trust.

1. **Acknowledge** - thank them and show you have read their exact issue. "Thank you for telling us the dal arrived cold."
2. **Apologise** - say sorry sincerely, without excuses or blame.
3. **Fix** - say what you are doing about it. "We have changed how we pack hot dishes."
4. **Take it offline** - invite them to contact you or Flavrly Support for anything that needs personal details, like a refund.

### Do

- Reply promptly
- Keep it short and polite
- Use the customer's words so they know you listened
- Thank people for positive reviews too

### Do not

- Argue, blame the customer or blame the rider in public
- Share order details, phone numbers or addresses in a public reply
- Promise refunds or compensation you cannot arrange
- Copy and paste the same reply to everyone`
      },
      {
        kind: 'TEXT',
        title: 'Customer feedback on Flavrly',
        body: `## The Customer feedback page

Open **Feedback** in your Flavrly admin. It shows ratings and comments from your recent Flavrly orders.

At the top you see summary numbers: **Avg Food**, **Avg Overall**, **Total Feedback** and **Low-Rated %**.

### Filters

- **All** or **Low-rated only (≤2)**
- **Range**: 7d, 30d or 90d
- **Status**: All, Published, Hidden or Flagged

A tag cloud shows how often customers report issues such as **Missing item**, **Wrong item**, **Cold food**, **Packaging issue** and **Food quality**. These food-related tags are highlighted because your kitchen can fix them.

### What you can do on each row

- **Reply** - write a public reply and press **Post reply**
- **Hide** or **Unhide** - control whether the feedback is shown publicly
- **Flag** - flag feedback with a reason, for example if it is abusive or about the wrong restaurant
- **Open order** - see the full order the feedback is about

You can also select several rows and hide or unhide them together.

Use Hide and Flag only for feedback that is genuinely abusive, irrelevant or wrong. Hiding fair criticism does not fix the problem.

### Auto-publish

In **Settings**, the **Auto-publish customer reviews** switch decides whether new customer reviews go live immediately or stay hidden until you publish them.`
      },
      {
        kind: 'TEXT',
        title: 'Google reviews in your Flavrly admin',
        body: `## Google Reviews page

Open **Reviews** in your Flavrly admin to read and reply to your Google reviews. First connect your Google listing in **Settings**, then press **Sync from Google** to bring reviews in.

Filter by **Rating** (1 to 5 stars) and by **Reply** status: All replies, Pending approval, Posted, Failed or Skipped.

### Replying

How you reply depends on how your Google listing is connected:

- **Google Business Profile connected** - type in the reply box and press **Post reply**, or press **Generate draft** to get an AI-written draft first. Your reply is shown under the review once posted.
- **Quick connect (Google Places)** - these reviews are read-only in Flavrly. Press **AI draft** to get a suggested reply, **Copy** it, then press **Reply on Google** and paste it into Google. Replies to these reviews are posted on Google, not in Flavrly.

Always read and edit an AI draft before posting. Make sure it mentions the customer's real issue and sounds like your restaurant.`
      },
      {
        kind: 'TEXT',
        title: 'Auto-reply and the Draft inbox',
        body: `## Let Flavrly help, but stay in control

In **Settings**, the **Auto-reply** section lets you switch on **Enable auto-reply** for Google reviews and choose two thresholds:

- **Auto-post at or above** - reviews with this star rating or higher get a reply posted automatically
- **Draft for approval at or below** - reviews with this rating or lower get a draft that waits for you

The draft threshold must be lower than the auto-post threshold. Ratings in between are skipped. You can also add **Tone instructions (optional)**, such as "Warm, brief, sign off with the owner's name."

### The Draft inbox

Drafts waiting for you appear at the top of the Reviews page in the **Draft inbox**, marked **Suggested reply - edit before posting**.

- Edit the text so it fits the review
- Press **Approve & Post** to publish it
- Press **Regenerate** for a new draft

Low ratings are exactly where a careless automatic reply does the most harm. Keep low-rated reviews in draft so a person always reads them first.`
      },
      {
        kind: 'CHECKLIST',
        title: 'Weekly reviews routine',
        body: `Set aside time each week, and check low ratings daily.`,
        checklistItems: [
          'Check Feedback with Low-rated only (≤2) switched on',
          'Look at the issue tags and share the top kitchen issues with your team',
          'Reply to every low-rated feedback: acknowledge, apologise, fix, take offline',
          'Sync from Google and clear the Draft inbox',
          'Edit every AI draft before posting',
          'Thank customers for positive reviews',
          'Hide or flag only abusive or irrelevant feedback',
          'Contact Flavrly Support for refunds or disputes you cannot resolve'
        ]
      }
    ],
    questions: [
      {
        prompt: 'A customer writes: "Biryani arrived cold and the raita leaked." Which reply follows good practice?',
        options: [
          '"Our rider was late, not our fault."',
          '"Thank you for telling us. We are sorry the biryani was cold and the raita leaked. We have changed how we pack hot dishes and liquids. Please contact us so we can make this right."',
          '"Everyone else liked it."',
          '"Please call me on my number and share your address here."'
        ],
        correctIndex: 1,
        explanation: 'It acknowledges, apologises, explains the fix and takes it offline without blaming anyone or sharing personal details.'
      },
      {
        prompt: 'In auto-reply settings, what happens to a review rated at or below "Draft for approval at or below"?',
        options: [
          'It is deleted',
          'A reply is posted automatically',
          'It is hidden from customers',
          'A draft reply waits in the Draft inbox for you to approve'
        ],
        correctIndex: 3,
        explanation: 'Low ratings get a draft held for approval, so a person reviews it before it is posted.'
      },
      {
        prompt: 'Your Google listing uses Quick connect (Google Places). How do you reply to a review?',
        options: [
          'Use AI draft, copy it, then press Reply on Google and paste it there',
          'Type in the Post reply box in Flavrly',
          'Reply through the Feedback page',
          'You cannot reply at all'
        ],
        correctIndex: 0,
        explanation: 'Places reviews are read-only in Flavrly, so replies are posted on Google itself.'
      },
      {
        prompt: 'On the Feedback page, when should you use Hide or Flag?',
        options: [
          'For any negative review',
          'For every review older than a week',
          'Only for feedback that is abusive, irrelevant or about the wrong restaurant',
          'To improve your average rating'
        ],
        correctIndex: 2,
        explanation: 'Hiding fair criticism does not fix the problem and loses customer trust.'
      },
      {
        prompt: 'Which Feedback filter helps you find the most serious complaints quickly?',
        options: [
          'Range: 90d only',
          'Status: Published',
          'Sort by newest',
          'Low-rated only (≤2)'
        ],
        correctIndex: 3,
        explanation: 'Low-rated only shows feedback rated 2 or below, which needs attention first.'
      }
    ]
  },

  {
    slug: 'admin-reading-reports',
    title: 'Reading your reports',
    summary:
      'Understand the dashboard and Reports pages in your Flavrly admin, download the right report, and turn the numbers into action.',
    category: 'RESTAURANT_OPS',
    audience: 'RESTAURANT_ADMIN',
    isRequired: false,
    durationMin: 10,
    order: 230,
    passMarkPct: 80,
    maxAttempts: null,
    retakeCooldownMin: 0,
    dueDays: 30,
    lessons: [
      {
        kind: 'TEXT',
        title: 'Your dashboard at a glance',
        body: `## The Dashboard

The **Dashboard** is the first page in your Flavrly admin. The top row shows four numbers:

- **Orders today** - all orders placed today
- **Revenue today** - the value of today's orders, not counting cancelled or failed-payment orders
- **Pending** - new orders that have not been accepted yet. It says **Action required** when this is above zero, and **All caught up** when it is zero.
- **Out for delivery** - orders currently on the way to customers

Below that you will find:

- **Revenue, last 14 days** - a chart of daily sales
- **Payment mix (today)** - how customers paid today
- **Best sellers**
- **Peak hours** - when your orders come in
- **Customers** - Customers, Repeat rate, Avg order value and Avg orders / customer
- **Recent menu changes** - the latest menu updates, with **View all**
- **Latest orders** - your newest orders, with **All orders**

### Act on it

- If **Pending** is not zero, check the kitchen board now. Customers are waiting.
- Use **Peak hours** to plan staff and prep before your busiest times.`
      },
      {
        kind: 'TEXT',
        title: 'The Reports page',
        body: `## Charts and lists

Open **Reports** in your Flavrly admin. It shows:

- **Sales (30 days)** - a chart of the last month
- **Best sellers** and **Least sellers**
- **Customer insights** - Customers, Repeat rate, AOV (average order value) and Orders / customer
- **Rider performance (30d)** - for each rider: Done, Failed, Avg min and Rating

If your restaurant heads a group and group report sharing is on, sales are rolled up across the group with a **By restaurant (30 days)** table.

## Downloadable reports

Pick a date range: **Today**, **7 days**, **30 days**, **90 days** or **Custom** (with **From** and **To** dates). Then download any report with **Download CSV** or **Download XLSX**:

- **Daily sales** - per-day orders, net sales, tax, delivery fee and gross totals
- **Item sales** - quantity sold and revenue for each item
- **Cancelled orders** - order code, customer, reason and refunded amount
- **Payment mode** - count and total for each payment method
- **Taxes** - daily tax collected
- **Delivery fees** - daily delivery fee revenue and order counts`
      },
      {
        kind: 'TEXT',
        title: 'Turning numbers into action',
        body: `## Ask what the number is telling you

Reports are only useful if you act on them. Some practical examples:

- **Least sellers** - is the photo poor, the description unclear or the price too high? Improve it, try it in a combo, or hide it to simplify your menu and kitchen.
- **Best sellers** - make sure these are always in stock, well photographed and prepped ahead of peak hours.
- **Cancelled orders** - read the reasons. If many are about items running out, update availability faster. If they are about delays, look at your prep times.
- **Repeat rate** - if few customers come back, read your feedback for the reasons, such as cold food or missing items.
- **AOV** - if it is low, consider combos or add-ons that make a natural meal.
- **Daily sales, Taxes and Payment mode** - download these for your accountant and to match against your own records.

### A simple routine

1. Daily: check **Pending** and **Orders today** on the Dashboard.
2. Weekly: look at best and least sellers and the cancelled orders report.
3. Monthly: download daily sales, taxes and payment mode for your records.

If a number looks wrong, or you have a question about payouts, contact Flavrly Support.`
      }
    ],
    questions: [
      {
        prompt: 'The Dashboard shows Pending: 3 with "Action required". What does that mean?',
        options: [
          'Three refunds are waiting',
          'Three new orders have not been accepted yet',
          'Three riders are offline',
          'Three menu items are hidden'
        ],
        correctIndex: 1,
        explanation: 'Pending counts new orders that are still waiting to be accepted.'
      },
      {
        prompt: 'Which downloadable report shows the reason for each cancellation?',
        options: [
          'Item sales',
          'Taxes',
          'Cancelled orders',
          'Delivery fees'
        ],
        correctIndex: 2,
        explanation: 'The Cancelled orders report lists order code, customer, reason and refunded amount.'
      },
      {
        prompt: 'Which dashboard section helps you plan staff for your busiest times?',
        options: [
          'Peak hours',
          'Recent menu changes',
          'Latest orders',
          'Payment mix (today)'
        ],
        correctIndex: 0,
        explanation: 'Peak hours shows when your orders come in.'
      },
      {
        prompt: 'In which formats can you download reports from the Reports page?',
        options: [
          'PDF only',
          'Word and PDF',
          'Image files',
          'CSV and XLSX'
        ],
        correctIndex: 3,
        explanation: 'Each report has Download CSV and Download XLSX buttons.'
      },
      {
        prompt: 'An item keeps appearing in Least sellers. What is a sensible first step?',
        options: [
          'Raise its price',
          'Ignore it',
          'Check its photo, description and price, and consider a combo or hiding it',
          'Delete all your other items'
        ],
        correctIndex: 2,
        explanation: 'Improve how the item is presented, or simplify your menu by hiding it.'
      }
    ]
  }
];

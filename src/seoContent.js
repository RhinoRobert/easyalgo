// The words search engines and first-time visitors read. One source for: the FAQ shown in the app, the static guide pages and the pre-rendered home
// page built at deploy time (scripts/build-seo.mjs), and the FAQ structured data. Keeping them in one file means the visible text and the data can never
// disagree. Plain strings only: `[label](/path/)` becomes a link, nothing else is markup. Every claim here describes what the launchpad contract does.

export const SITE = {
  origin: "https://easyalgo.org",
  name: "PNET LaunchLab",
  tagline: "Algorand launchpad",
  parent: { name: "TestedProfit", url: "https://www.testedprofit.com" },
  source: "https://github.com/RhinoRobert/easyalgo",
  updated: "2026-10-25",
};

export const HOME = {
  title: "Algorand Launchpad: Launch a Token with Liquidity | LaunchLab",
  description: "Launch an Algorand token with a live Tinyman pool in two wallet approvals. 80% of liquidity is burned, the token is immutable, and every launch is verifiable.",
  h1: "One asset. One Tinyman pool. Two approvals.",
  intro: "PNET LaunchLab is an Algorand launchpad: name your token, approve twice in Pera, and it goes live on Tinyman with its whole supply in the pool. 80% of the liquidity is burned and cannot be pulled out.",
  steps: [
    { title: "Name your token", text: "Pick a name, a ticker and a supply. Nothing is sent until you press Launch." },
    { title: "Approve twice in Pera", text: "The first approval creates the token, the second opens its trading pool." },
    { title: "Trade straight away", text: "It is live on Tinyman and Vestige, and most of its liquidity is burned for good." },
  ],
  facts: [
    "The token is created by the launchpad contract with no manager, reserve, freeze or clawback address, so its supply is fixed and nobody can mint more, freeze or claw back.",
    "The whole supply goes into a Tinyman v2 pool, paired with PNET bought with exactly 1 ALGO.",
    "80% of the pool's liquidity tokens are burned in the ARC-54 burn contract. The creator and the platform each hold 10%.",
    "A launch costs about 2.7 ALGO in total; keep 3 ALGO in the wallet. Two wallet approvals in Pera, each checked on chain before you sign.",
  ],
};

export const FAQ = [
  {
    q: "What is an Algorand launchpad?",
    a: "An Algorand launchpad is a service that helps a project create a token (an Algorand Standard Asset, or ASA) and start trading it. Some launchpads run token sales for a fixed period. An instant-liquidity launchpad like PNET LaunchLab skips the sale: it creates the token and immediately opens a Tinyman liquidity pool, so the token can be traded as soon as the launch finishes.",
  },
  {
    q: "How do I launch a token on Algorand with PNET LaunchLab?",
    a: "Connect Pera Wallet, enter a name, a ticker and a supply, and press Launch. You approve two transaction groups in Pera: the first creates your token and buys PNET with exactly 1 ALGO, the second creates the Tinyman pool, adds the whole supply as liquidity and splits the liquidity tokens. The page then links to your token's page, its pool and the burn transaction.",
  },
  {
    q: "How much does it cost to launch an Algorand token here?",
    a: "About 2.7 ALGO in total, and the page asks you to keep 3 ALGO in the wallet. 1 ALGO of that is swapped into PNET and becomes the other half of the pool. The rest covers Tinyman's pool creation (about 1.06 ALGO), refundable storage deposits and network fees. The exact figures are shown before you sign.",
  },
  {
    q: "What happens to the liquidity?",
    a: "The token's whole supply and the PNET go into a Tinyman v2 pool. Of the liquidity tokens the pool returns, 80% are sent to the ARC-54 burn contract, which has no way to give them back. 10% are held for the creator to claim and 10% are held by the platform. Anyone can check the burn transaction from the token's page.",
  },
  {
    q: "Can the creator pull the liquidity out (a rug pull)?",
    a: "Not the 80% that is burned. The creator's own 10% share can be claimed and could be withdrawn, and the platform holds another 10%, so the creator and platform together can never remove more than a fifth of the pool. The token itself has no mint, freeze or clawback authority, so no one can create extra supply or freeze holders.",
  },
  {
    q: "Can the token be changed or more of it created later?",
    a: "No. The token is created by the launchpad contract with every control address left empty, which on Algorand means its name, supply and settings can never change. Only its off-chain profile (logo, description and links) can be edited, on Vestige, by the wallet that launched it.",
  },
  {
    q: "Which wallet do I need?",
    a: "Pera Wallet, on a phone or through Pera Connect on the web. You sign every transaction yourself in Pera; the site never has your keys, and each transaction group is simulated on chain before you are asked to sign it.",
  },
  {
    q: "What if the second approval does not go through?",
    a: "Your launch is saved on chain, so you can close the page and continue later from the same wallet. If it can not be finished, you can cancel after about 2.3 hours and the contract returns half of the token and half of the PNET to you; the other half goes to the platform.",
  },
  {
    q: "Where can people trade the token?",
    a: "Right away in its Tinyman pool, and on Vestige, which lists Tinyman pools. Every launched token has a Trade button that opens its Vestige page.",
  },
  {
    q: "How do I add a logo and description?",
    a: "When the launch finishes, the contract adds your wallet as a metadata manager on Vestige. Open the token's page and use Edit on Vestige to set a logo, a description and your links. The logo then appears on this site as well.",
  },
  {
    q: "Is it safe, and has it been audited?",
    a: "It is beta software. The contract can not be upgraded or paused, its code is public on GitHub, it comes with an automated test suite that includes attack-style tests, and the contract's balances are checked against its own records. It has not yet had a paid third-party audit, so only use amounts you can afford to lose. Nothing here is financial advice.",
  },
  {
    q: "What is PNET, and why is 1 ALGO swapped into it?",
    a: "PNET is the Profitnet token on Algorand. Each pool pairs the new token with PNET, so the launchpad swaps exactly 1 ALGO into PNET through the PNET/ALGO Tinyman pool and uses it as the other side of the new pool. Every launch therefore starts with about the same pool size.",
  },
];

// Guide pages. `sections[].list` items and `paragraphs` may contain [label](/path/) links.
export const PAGES = [
  {
    slug: "algorand-launchpad",
    title: "What Is an Algorand Launchpad? Types and How to Choose",
    description: "How Algorand launchpads work: token sales versus instant-liquidity launches, what to check before you launch, and how PNET LaunchLab compares.",
    h1: "What is an Algorand launchpad?",
    lead: "An Algorand launchpad helps a project create a token on the Algorand blockchain and get it trading. This guide explains the main kinds, what each one costs you in control and risk, and what to check before launching.",
    sections: [
      {
        h2: "Two kinds of Algorand launchpad",
        paragraphs: [
          "Sale-style launchpads run an initial offering. You set a token amount, a time window and sometimes soft and hard caps, buyers send ALGO during the window, and when it ends the raised ALGO and some tokens are used to start trading. They suit teams who want to raise funds from a community.",
          "Instant-liquidity launchpads skip the sale. They create the token and open a trading pool in one step, so there is no raise and no waiting: the token is tradable as soon as the launch finishes. [PNET LaunchLab](/) is this second kind.",
        ],
      },
      {
        h2: "What an instant-liquidity launch does on Algorand",
        paragraphs: ["On Algorand a token is an Algorand Standard Asset (ASA), and trading happens in automated market-maker pools such as Tinyman. An instant launch on PNET LaunchLab does this in two wallet approvals:"],
        list: [
          "Approval 1 creates the ASA with every control address left empty, and swaps exactly 1 ALGO into PNET.",
          "Approval 2 creates the Tinyman v2 pool, puts the whole supply and the PNET into it, and splits the liquidity tokens: 80% burned, 10% for the creator, 10% for the platform.",
        ],
      },
      {
        h2: "What to check before you launch anywhere",
        list: [
          "Can the token be changed? Look for a manager, reserve, freeze or clawback address on the asset. A fixed token has none.",
          "Who holds the liquidity? Liquidity tokens that were burned can not be withdrawn; ones held by a wallet can. See [how liquidity burning works](/burn-liquidity-on-algorand/).",
          "Can the contract be upgraded or paused? An upgradeable contract can be changed by its owner; an immutable one can not, which is safer against abuse and harder to fix if a bug is found.",
          "Is the code public and tested, and has it been audited by an outside firm?",
          "What does it really cost? Count pool creation, deposits and fees, not only the headline price. Here the total is about 2.7 ALGO, see the [cost breakdown](/how-to-create-an-algorand-token/).",
        ],
      },
      {
        h2: "What it takes for people to trade a new Algorand token",
        paragraphs: [
          "Every Algorand token has to be added to a wallet before the wallet can hold it. That step is called an opt-in, and it raises the wallet's minimum balance by 0.1 ALGO for each asset it holds. Wallets such as Pera handle this when you add the token, and Tinyman and Vestige prompt for it when you trade, so buyers only need a little spare ALGO.",
          "Trading itself happens in a pool: a pair of assets locked in a smart contract that sets the price from the ratio of the two. The pool is created once, funded with both assets by whoever launches, and from then on anyone can swap against it. That is why who holds the pool's liquidity tokens matters so much, and why this launchpad burns most of them.",
        ],
      },
      {
        h2: "Common mistakes when launching a token",
        list: [
          "Leaving a freeze, clawback, manager or reserve address on the token. Holders then have to trust whoever controls it. A launch here leaves all four empty.",
          "Keeping the liquidity tokens in your own wallet. It tells buyers you can withdraw the pool whenever you like.",
          "Starting with a supply the pool can not accept. Tinyman needs a minimum first deposit, so this launchpad asks for at least 1 whole token.",
          "Running short of ALGO. A launch needs about 2.7 ALGO; keep 3 ALGO so a fee or deposit never stops the second step.",
          "Putting private information in the token's website field. It is public and fixed forever.",
        ],
      },      {
        h2: "How PNET LaunchLab compares",
        paragraphs: [
          "Every launch gets the same structure, so tokens are easy to compare: an immutable token, a Tinyman v2 pool seeded with the whole supply and 1 ALGO of PNET, and 80% of the liquidity burned. Each token has a page that reads these facts from the chain and shows them as a checklist, with a price chart and top holders.",
          "It is beta software: the contract is public and tested but has not had a paid third-party audit yet. Read the [FAQ](/faq/) for the details, then [launch a token](/#launch) when you are ready.",
        ],
      },
    ],
  },
  {
    slug: "how-to-create-an-algorand-token",
    title: "How to Create an Algorand Token With Liquidity (Cost + Steps)",
    description: "Step by step: create an Algorand token (ASA) and open a Tinyman liquidity pool in two Pera approvals. Real costs, what you need and what happens next.",
    h1: "How to create an Algorand token with liquidity",
    lead: "You can create an Algorand token and have it trading in a Tinyman pool in a few minutes. This is what you need, what each step does and what it costs.",
    sections: [
      {
        h2: "What you need",
        list: [
          "Pera Wallet with about 3 ALGO spendable. The launch itself costs about 2.7 ALGO, and keeping a little extra avoids a failed step.",
          "A token name (up to 32 characters), a ticker (1 to 8 letters or numbers) and a total supply.",
          "Optionally a website for the token. It is fixed forever and shown only as plain text.",
        ],
      },
      {
        h2: "The steps",
        list: [
          "Open the [launch page](/#launch) and connect Pera.",
          "Enter the name, ticker and supply. The supply shortcuts cover 1 million up to 1 trillion tokens; all of the supply goes into the pool.",
          "Press Launch and approve the first group in Pera. This creates your token and buys PNET with exactly 1 ALGO.",
          "Approve the second group. This creates the Tinyman pool, adds the liquidity and splits the liquidity tokens.",
          "Your token's page opens with its safety checklist, chart and share button. Use Edit on Vestige to add a logo and description.",
        ],
      },
      {
        h2: "What it costs",
        paragraphs: ["The total is about 2.7 ALGO, shown to the cent before you sign. It is made of:"],
        list: [
          "1 ALGO swapped into PNET, which becomes the other half of your pool.",
          "About 1.06 ALGO for Tinyman to create the pool.",
          "Storage deposits for the launch records and the liquidity tokens (part of which is refunded) and network fees.",
        ],
      },
      {
        h2: "What happens to the token and the liquidity",
        paragraphs: [
          "The token is created with no manager, reserve, freeze or clawback address, so its supply is fixed. 80% of the pool's liquidity tokens are burned. You can claim your 10% later from My launches. Read [how liquidity burning works](/burn-liquidity-on-algorand/).",
          "If something stops the second approval, your launch is saved on chain and you can continue later or cancel after about 2.3 hours to get half of the token and PNET back. More answers are in the [FAQ](/faq/).",
        ],
      },
    ],
  },
  {
    slug: "algorand-memecoin-launchpad",
    title: "Algorand Memecoin Launchpad: Fair Launches, Burned Liquidity",
    description: "Launch an Algorand memecoin where every token starts with the same pool, 80% of the liquidity is burned and nobody can mint more. See how fair launches work.",
    h1: "An Algorand memecoin launchpad for fair launches",
    lead: "A fair launch means everyone starts from the same rules: no pre-mine hidden in a wallet, no extra supply later, and liquidity that can not simply be pulled. Here is how PNET LaunchLab sets that up for an Algorand memecoin.",
    sections: [
      {
        h2: "What makes a launch fair",
        list: [
          "The whole supply is in the pool at the start. The launchpad contract holds the supply until it moves it into the pool, and keeps none back.",
          "Nobody can mint more. The token has no reserve or manager address, so the supply is fixed.",
          "No one can freeze or claw back holdings, because those authorities are empty too.",
          "Most of the liquidity is burned. 80% of the pool's liquidity tokens go to the burn contract.",
        ],
      },
      {
        h2: "The same start for every token",
        paragraphs: [
          "Every launch is paired with PNET bought with exactly 1 ALGO, so every pool starts at about the same size. That makes growth the thing that matters. The [Popular tab](/#popular) ranks launches by what their pools hold, and the launch page crowns a King of the Hill: the launch with the biggest pool.",
        ],
      },
      {
        h2: "Check any token yourself",
        paragraphs: ["Each token has a page that reads the chain and shows a checklist: the token can not be changed, nothing is held back by the launchpad, the pool is the official Tinyman pool, and the burned share of the liquidity. It also lists the top holders and links to the burn transaction. The creator's and the platform's 10% shares are shown as information, not hidden."],
      },
      {
        h2: "Launch yours",
        paragraphs: [
          "You need a Pera wallet and about 3 ALGO. See [how to create an Algorand token](/how-to-create-an-algorand-token/) for the steps and costs, or go straight to the [launch page](/#launch).",
          "Memecoins are risky and prices can fall to zero. Nothing here is financial advice; only use amounts you can afford to lose.",
        ],
      },
    ],
  },
  {
    slug: "burn-liquidity-on-algorand",
    title: "Burned Liquidity on Algorand: What It Means and How to Verify",
    description: "What burning liquidity tokens means on Algorand, why it protects against rug pulls, and how to check the burn on Tinyman and ARC-54 yourself.",
    h1: "Burned liquidity on Algorand, explained",
    lead: "When a token launches with a liquidity pool, whoever holds the pool's liquidity tokens can take the money back out. Burning those tokens takes that power away. Here is what that means and how to check it.",
    sections: [
      {
        h2: "Liquidity tokens in one minute",
        paragraphs: [
          "When someone adds liquidity to a Tinyman pool, the pool gives back liquidity tokens (LP tokens) that represent their share. Whoever holds them can remove that share of the pool at any time. If a creator holds all of them, they can drain the pool: that is a rug pull.",
        ],
      },
      {
        h2: "How burning works on Algorand",
        paragraphs: [
          "LaunchLab sends the liquidity tokens to the ARC-54 burn contract, the Algorand standard for burning assets. It can receive assets but has no function that sends them out, so anything sent there can never be withdrawn.",
          "On each launch, 80% of the liquidity tokens go there in the same transaction group that creates the pool. The other 20% is split 10% to the creator and 10% to the platform, and both are shown openly.",
        ],
      },
      {
        h2: "What burning does and does not guarantee",
        list: [
          "It does mean the burned 80% of the pool can not be withdrawn by anyone.",
          "It does not mean the price can not fall. Burned liquidity protects the pool, not the value of the token.",
          "It does not cover the unburned 20%. The creator's and the platform's shares could be withdrawn, so the most that can ever leave is a fifth of the pool.",
          "It says nothing about the token's supply. That is protected separately: the token is created with no mint, freeze or clawback authority.",
        ],
      },
      {
        h2: "Verify a burn yourself",
        list: [
          "Open the token's page on [PNET LaunchLab](/#recent). The safety checklist shows the burned percentage read from the chain.",
          "Follow the Burn transaction link to see the transfer of liquidity tokens to the ARC-54 contract.",
          "Compare the liquidity token's total supply on an Algorand explorer with the amount the burn contract holds.",
        ],
      },
      {
        h2: "Next",
        paragraphs: ["Read the [FAQ](/faq/) for common questions, or [launch a token](/#launch) with burned liquidity built in."],
      },
    ],
  },
];

export const FAQ_PAGE = {
  slug: "faq",
  title: "Algorand Launchpad FAQ: Costs, Liquidity, Safety | LaunchLab",
  description: "Answers about launching a token on Algorand with PNET LaunchLab: cost, burned liquidity, rug-pull risk, logos, cancelling and trading.",
  h1: "Algorand launchpad FAQ",
  lead: "Short answers about launching a token with PNET LaunchLab. If something is missing, the guides below go deeper.",
};

export const ALL_PATHS = ["/", ...PAGES.map((page) => `/${page.slug}/`), `/${FAQ_PAGE.slug}/`];

export const GUIDE_LINKS = [
  { href: "/algorand-launchpad/", label: "What is an Algorand launchpad?" },
  { href: "/how-to-create-an-algorand-token/", label: "How to create an Algorand token" },
  { href: "/algorand-memecoin-launchpad/", label: "Algorand memecoin launchpad" },
  { href: "/burn-liquidity-on-algorand/", label: "Burned liquidity explained" },
  { href: "/faq/", label: "FAQ" },
];

/** The text without its `[label](/path/)` link markup, for places that cannot show links (structured data, the in-app FAQ). */
export const plain = (text) => String(text).replace(/\[([^\]]+)\]\((\/[^)\s]*|https:\/\/[^)\s]+)\)/g, "$1");
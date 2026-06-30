/**
 * A complete sample StrategyResult — used ONLY for local/dev testing of the deck format,
 * themes, and print output (generation can't run under plain `bun run dev`, and the live
 * site's saved result lives in a different browser origin). Not used in production flows.
 */
import type { StrategyResult } from '../domain/strategy'

export const SAMPLE_RESULT: StrategyResult = {
  generatedAt: 1751000000000,
  brief: {
    brandName: 'Ankur Sharma',
    primaryNiche: 'Real Estate + Dubai Consultancy',
    subNiche: 'Visas, schools, compliance, real estate',
    offer: 'Dubai relocation & end-to-end consultancy services',
    language: 'hinglish',
    audience: 'HNIs and individuals worldwide who want to relocate to Dubai',
    competitors: ['propertytalkswithad', 'arman.dubai.investments', 'shifasells.dxb', 'youngrealtor.dxb', 'selling.withsimrit'],
    aspirational: ['rizwan.sajan', 'rsm30', 'naderthebroker'],
    brandColors: '',
    dislikes: 'no cringe videos',
    offLimits: 'anything negative about Dubai',
    theme: { preset: 'black-gold', accent: '', bg: '' },
  },
  accounts: [
    { username: 'propertytalkswithad', fullName: 'Akash Deep', followers: 56328, engagementRate: 19.79, verified: true, source: 'competitor', profilePicUrl: '' },
    { username: 'youngrealtor.dxb', fullName: 'Sahitya Sidharth', followers: 99307, engagementRate: 0.66, verified: true, source: 'competitor', profilePicUrl: '' },
    { username: 'arman.dubai.investments', fullName: '', followers: 190355, engagementRate: 1.38, verified: true, source: 'competitor', profilePicUrl: '' },
    { username: 'thezeinakhoury', fullName: 'Zeina Khoury', followers: 1325408, engagementRate: 5.49, verified: true, source: 'discovered', profilePicUrl: '' },
    { username: 'alessia_sheglova', fullName: 'Alessia', followers: 313566, engagementRate: 6.60, verified: true, source: 'discovered', profilePicUrl: '' },
    { username: 'lewis_allsoppdubai', fullName: 'Lewis Allsopp', followers: 37014, engagementRate: 6.27, verified: true, source: 'discovered', profilePicUrl: '' },
    { username: 'rizwan.sajan', fullName: 'Rizwan Sajan', followers: 1476081, engagementRate: 0.43, verified: true, source: 'aspirational', profilePicUrl: '' },
    { username: 'rsm30', fullName: 'Rashid Saud Al Musallam', followers: 101576, engagementRate: 0.32, verified: true, source: 'aspirational', profilePicUrl: '' },
  ],
  hookSummaries: [
    { handle: 'rizwan.sajan', reelCount: 9, dominantHooks: [{ pattern: 'Direct question to a group', count: 2, example: '' }, { pattern: 'Call to imagine a hypothetical', count: 1, example: '' }], recurringOpenings: [], whatConsistentlyWorks: [], replicableTemplates: [], narrative: '', benchmarks: { medianViews: 202530, medianLikes: 0, commentsLikesRatio: 0 } },
    { handle: 'propertytalkswithad', reelCount: 7, dominantHooks: [{ pattern: 'Bold statement about a market', count: 2, example: '' }, { pattern: 'Real-estate dilemma question', count: 1, example: '' }], recurringOpenings: [], whatConsistentlyWorks: [], replicableTemplates: [], narrative: '', benchmarks: { medianViews: 57991, medianLikes: 0, commentsLikesRatio: 0 } },
  ],
  doc: {
    positioning: 'Ankur Sharma is the definitive end-to-end Dubai relocation and investment consultant for HNIs — guidance that goes far beyond just real estate.',
    audienceInsight: 'HNIs relocating to Dubai want a secure, efficient, luxurious transition for their families — they fear bureaucracy, misinformed investments, and a fragmented process.',
    competitiveSummary: 'The niche is saturated with agents focused on property transactions and high-energy sales. There is a clear gap for a trusted advisor offering a holistic 360° solution across visas, schools, compliance and real estate.',
    whatsWorking: [
      'Direct questions to the audience drive the strongest opens (e.g. "Par main aapse kyun lun, main toh direct developer se bhi le sakta hun?")',
      'Addressing Dubai misconceptions head-on builds trust ("Logon ko galat lagta hai, sach yeh hai…")',
      'Bold market statements travel ("Dubai ke Golden Visa ne pura relocation game change kar diya boss")',
      'Specific, tangible facts beat vague tips ("2026 mein 150,000 units hand over ho rahe hain")',
      'Outcome-led framing ("yeh aapke liye best kyun hai") keeps retention high',
    ],
    contentPillars: [
      { name: 'Dubai Relocation Blueprint', description: 'Guides on visas, legal compliance, business setup and the admin steps for a smooth move.' },
      { name: 'Smart Real Estate Investments', description: 'Market trends and high-value property opportunities tailored to HNI investors.' },
      { name: 'Family & Lifestyle in Dubai', description: 'Premium education, healthcare, community and the aspirational lifestyle for families.' },
      { name: 'HNI Success Stories', description: 'Testimonials and case studies of successful relocations and investment journeys.' },
    ],
    hookFormulas: [
      { name: 'Direct Question to HNIs', template: 'So [HNIs], I want to ask you a simple question…', example: 'So HNIs, Dubai mein aapka next big move kya hai?' },
      { name: 'Addressing Common Fears', template: 'Kya aapko darr hai ki aapka Dubai investment [X] nahi dega?', example: 'Kya aapko darr hai ki aapka Dubai investment expected returns nahi dega?' },
      { name: 'Bold Market Statement', template: 'Dubai ke [X] ne pura [game] ka scene change kar diya boss', example: 'Dubai ke Golden Visa ne pura relocation game change kar diya boss' },
      { name: 'Relocation Dilemma', template: 'Dubai relocation: [Option A] ya [Option B]?', example: 'Dubai relocation: DIY ya expert guide? Kaunsa best hai?' },
    ],
    contentIdeas: [
      { title: 'Dubai Golden Visa: The Ultimate HNI Guide', hook: 'Dubai ka Golden Visa sirf ek paper nahi, yeh golden opportunity hai. Kaise apply karein?', format: 'Reel', pillar: 'Dubai Relocation Blueprint' },
      { title: 'Top 3 Luxury Property Investments in Dubai', hook: 'Agar aap high returns chahte hain, toh yeh 3 properties miss mat karna.', format: 'Carousel', pillar: 'Smart Real Estate Investments' },
      { title: 'Choosing the Best International School in Dubai', hook: 'Apne bachchon ke liye Dubai mein best school dhoondh rahe ho? Yeh list dekho.', format: 'Reel', pillar: 'Family & Lifestyle in Dubai' },
      { title: 'How a UK Investor Relocated His Business to Dubai', hook: 'Ek UK investor ne kaise apna business Dubai mein relocate kiya? Suniye unki kahani.', format: 'Reel', pillar: 'HNI Success Stories' },
      { title: 'Compliance Checklist for HNIs Setting Up in Dubai', hook: 'Dubai mein business set up kar rahe ho? Yeh tips future problems se bachayenge.', format: 'Carousel', pillar: 'Dubai Relocation Blueprint' },
      { title: 'Off-Plan vs Ready Property in Dubai', hook: 'Dubai mein off-plan ya ready property? Kaunsa best hai, jaaniye.', format: 'Reel', pillar: 'Smart Real Estate Investments' },
    ],
    formatMix: [
      { format: 'Reels', weight: '60%', rationale: 'Highest reach + engagement; ideal for hooks and direct address.' },
      { format: 'Carousels', weight: '30%', rationale: 'Best for detailed checklists and step-by-step HNI guides.' },
      { format: 'Stories', weight: '10%', rationale: 'Real-time Q&A, polls and behind-the-scenes engagement.' },
    ],
    cadence: { postsPerWeek: '4–5 posts per week', notes: '3–4 Reels + 1–2 Carousels weekly, supplemented with daily Stories.' },
    voiceAndTone: 'Authoritative, knowledgeable, sophisticated and trustworthy — aspirational yet approachable, in a natural Hinglish blend that resonates with a global HNI audience.',
    dos: ['Use Hinglish in Latin script only', 'Lead with high-value, comprehensive information', 'Showcase the luxury, aspirational lifestyle', 'Engage directly with audience questions'],
    donts: ['Produce cringe or inauthentic content', 'Post anything negative about Dubai', 'Use Devanagari script', 'Focus only on real estate, ignoring relocation + compliance'],
  },
}

import React, { useState } from 'react';
import { useTerminal } from '../context/TerminalContext.tsx';
import {
  BookOpen,
  CheckCircle,
  Clock,
  Compass,
  FileText,
  HelpCircle,
  Layers,
  ShieldAlert,
  Sparkles,
  Target,
} from 'lucide-react';

export const SmcAcademyPage: React.FC = () => {
  const { language, t } = useTerminal();
  const [activeTopic, setActiveTopic] = useState<string>('bos_choch');

  const topics = [
    {
      id: 'bos_choch',
      title: 'BOS vs CHoCH (Market Structure)',
      titleKm: 'BOS និង CHoCH (រចនាសម្ព័ន្ធទីផ្សារ)',
      contentEn: `
### Break of Structure (BOS) vs Change of Character (CHoCH)
- **BOS (Break of Structure):** Occurs when price continues an established trend by breaking past the most recent swing high (in an uptrend) or swing low (in a downtrend).
  - **Golden Rule:** Must close with a full candle body beyond the swing level—wick breaches are treated as potential liquidity sweeps, not structural confirmation!
- **CHoCH (Change of Character):** The first signal of potential trend reversal. Occurs when an uptrend breaks below the last key higher low, or when a downtrend breaks above the last key lower high.
      `,
      contentKm: `
### ការបែងចែករវាង BOS និង CHoCH
- **BOS (Break of Structure - ការបន្តរចនាសម្ព័ន្ធ):** កើតឡើងពេលតម្លៃបន្តនិន្នាការចាស់ ដោយបំបែកទម្លុះ Swing High ចុងក្រោយ (ក្នុង Uptrend) ឬទម្លុះ Swing Low ចុងក្រោយ (ក្នុង Downtrend)។
  - **ច្បាប់ដែកថែប:** ទៀនត្រូវតែបិទ **Body ពេញ** ឆ្លងកាត់កម្រិត Swing—បើគ្រាន់តែ Wick ឆ្លង នោះជា Liquidity Sweep មិនមែន BOS ទេ។
- **CHoCH (Change of Character - ការផ្លាស់ប្តូរចរិតលក្ខណៈ):** ជាសញ្ញាដំបូងនៃការផ្លាស់ប្តូរនិន្នាការ។ កើតឡើងនៅពេលដែល Uptrend បំបែកធ្លាក់ក្រោម Higher Low ចុងក្រោយ ឬ Downtrend បំបែកឡើងលើ Lower High ចុងក្រោយ។
      `,
    },
    {
      id: 'order_blocks',
      title: 'Order Blocks (OB Mechanics)',
      titleKm: 'Order Block (យន្តការស្ថាប័ន)',
      contentEn: `
### Institutional Order Blocks
- **Bullish Order Block:** The last bearish (down) candle before a swift, aggressive upward displacement that causes a BOS or CHoCH.
- **Bearish Order Block:** The last bullish (up) candle before an aggressive downward displacement causing a structure break.
- **Mitigation:** When price returns to test the Order Block and fills remaining institutional limit orders. Unmitigated OBs carry significantly higher trading weight.
      `,
      contentKm: `
### Order Block របស់ស្ថាប័នធនាគារ
- **Bullish Order Block (OB ឡើង):** ជាទៀនចុះចុងក្រោយបង្អស់ មុនពេលមានចលនារុញឡើងយ៉ាងលឿន និងខ្លាំង (Displacement) ដែលបង្កើត BOS ឬ CHoCH។
- **Bearish Order Block (OB ចុះ):** ជាទៀនឡើងចុងក្រោយបង្អស់ មុនពេលមានចលនារុញធ្លាក់ចុះយ៉ាងខ្លាំង។
- **Mitigation (ការប៉ះតេស្ត):** ពេលតម្លៃវិលត្រឡប់មកតេស្តតំបន់ OB ហើយស្រូបយក Limit Orders ដែលនៅសល់។ OB ដែលមិនទាន់ Mitigation (Unmitigated) មានទម្ងន់ខ្ពស់បំផុត។
      `,
    },
    {
      id: 'fvg',
      title: 'Fair Value Gaps (FVG)',
      titleKm: 'Fair Value Gap (FVG - ចន្លោះអតុល្យភាព)',
      contentEn: `
### Fair Value Gaps & Imbalances
- An FVG is a 3-candle price imbalance created when massive aggressive buying or selling leaves unfilled orders.
- **Bullish FVG:** Occurs when Candle 1 High and Candle 3 Low do not overlap (Candle 3 Low > Candle 1 High).
- **Bearish FVG:** Occurs when Candle 1 Low and Candle 3 High do not overlap (Candle 3 High < Candle 1 Low).
- Price naturally seeks to balance these inefficiencies before resuming the trend.
      `,
      contentKm: `
### Fair Value Gap (FVG - ចន្លោះអតុល្យភាពតម្លៃ)
- FVG គឺជារូបរាងទៀន ៣ ដើម ដែលមានចន្លោះទំនេរដោយសារកម្លាំងទិញ ឬលក់ខ្លាំងពេក រហូតដល់មិនមានការ match order ស្មើគ្នា។
- **Bullish FVG:** កើតឡើងពេលចុង Wick ខាងលើរបស់ទៀនទី ១ មិនជាន់គ្នាជាមួយចុង Wick ខាងក្រោមរបស់ទៀនទី ៣ (ទៀនកណ្តាលវែង)។
- **Bearish FVG:** កើតឡើងពេលចុង Wick ខាងក្រោមរបស់ទៀនទី ១ មិនជាន់គ្នាជាមួយចុង Wick ខាងលើរបស់ទៀនទី ៣។
- តម្លៃតែងតែមាននិន្នាការស្រូបទាញត្រឡប់មកបំពេញចន្លោះ (Fill Gap) នេះជានិច្ច។
      `,
    },
    {
      id: 'liquidity_sweeps',
      title: 'Liquidity Sweeps & Stop Hunts',
      titleKm: 'Liquidity Sweeps (ការកម្ទេច Stop Loss)',
      contentEn: `
### Liquidity Sweeps
- Retail traders often place obvious stop losses above double tops (Equal Highs) or below double bottoms (Equal Lows).
- Institutional algorithms push prices briefly past these levels to trigger liquidity pools (stops), only to rapidly reverse back into the dealing range.
- **Confirmation:** Long rejection wick through the key level with the candle closing back inside the range.
      `,
      contentKm: `
### Liquidity Sweeps (ការបោសសម្អាត Liquidity)
- Trader ទូទៅច្រើនដាក់ Stop Loss នៅខាងលើកំពូលពីរស្មើគ្នា (Equal Highs) ឬខាងក្រោមកម្រាលពីរស្មើគ្នា (Equal Lows)។
- ស្ថាប័នធំៗរុញតម្លៃឲ្យជ្រុលបន្តិចដើម្បីទាញយក Stop Loss ទាំងនោះ រួចបកក្បាលត្រឡប់ចូលក្នុង Dealing Range វិញភ្លាមៗ។
- **ការបញ្ជាក់ (Confirmation):** ទៀនទម្លុះកម្រិតដោយ Wick វែង រួចបិទត្រឡប់ចូលក្នុង Range វិញ។
      `,
    },
    {
      id: 'kill_zones',
      title: 'ICT Kill Zones & Timing',
      titleKm: 'ICT Kill Zones (ម៉ោងមាសសម្រាប់ Trade)',
      contentEn: `
### ICT Kill Zones (UTC Timings)
- **Asia Session (00:00 - 07:00 UTC):** Consolidation and liquidity building phase ("ASIA BUILD").
- **London Open (07:00 - 10:00 UTC):** High liquidity breakout, often creating the low or high of the day (Judas swing).
- **New York Open (12:30 - 15:30 UTC):** High volume continuation or major trend reversal.
- **London / NY Overlap (12:00 - 16:00 UTC):** Peak volatility window for XAUUSD (Gold).
- **Rollover Window (21:45 - 23:15 UTC):** Spread widening & bank rollover. Trading strictly blocked!
      `,
      contentKm: `
### ម៉ោងមាស ICT Kill Zones (ម៉ោង UTC)
- **Asia Session (00:00 - 07:00 UTC):** ដំណាក់កាលកកើត Range និងប្រមូលផ្តុំ Liquidity (ASIA BUILD)។
- **London Open (07:00 - 10:00 UTC):** ចាប់ផ្តើមបំបែក Range ហើយជារឿយៗបង្កើត High ឬ Low នៃថ្ងៃ (Judas Swing)។
- **New York Open (12:30 - 15:30 UTC):** បរិមាណទិញលក់ខ្ពស់បំផុត និងមានចលនារុញយ៉ាងខ្លាំង។
- **Overlap (12:00 - 16:00 UTC):** ពេលវេលាដែល London និង NY ជាន់គ្នា ជាពេល Gold រើខ្លាំងបំផុត។
- **Rollover Window (21:45 - 23:15 UTC):** ម៉ោងធនាគារប្តូរវេន Spread ឡើងខ្ពស់ខ្លាំង → ប្រព័ន្ធបិទការ Trade ដាច់ខាត!
      `,
    },
  ];

  const currentTopic = topics.find((t) => t.id === activeTopic) || topics[0];

  return (
    <div className="flex-1 bg-[#07090d] p-5 space-y-5 overflow-y-auto select-none font-mono">
      <div className="bg-[#0b0f17] border border-white/[0.06] rounded-xl p-4 shadow-lg flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-[#F5C451]" />
            SMC & ICT QUANTITATIVE ACADEMY
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Rulebook, mechanics, and institutional order flow logic for XAUUSD (Gold).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Left Topic List */}
        <div className="bg-[#0b0f17] border border-white/[0.06] rounded-xl p-2 space-y-1">
          {topics.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTopic(item.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-xs font-mono transition-all ${
                activeTopic === item.id
                  ? 'bg-[#F5C451]/15 text-[#F5C451] font-bold border border-[#F5C451]/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              {language === 'km' ? item.titleKm : item.title}
            </button>
          ))}
        </div>

        {/* Right Content */}
        <div className="lg:col-span-3 bg-[#0b0f17] border border-white/[0.06] rounded-xl p-5 shadow-lg space-y-4">
          <div className="border-b border-white/[0.06] pb-3 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-100">
              {language === 'km' ? currentTopic.titleKm : currentTopic.title}
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-white/[0.05] text-[#F5C451]">
              Institutional Grade
            </span>
          </div>

          <div className="prose prose-invert max-w-none text-xs text-slate-300 leading-relaxed font-sans">
            <div className="whitespace-pre-line">
              {language === 'km' ? currentTopic.contentKm : currentTopic.contentEn}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
